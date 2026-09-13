// POST /api/analyze — creates a job from a validated upload + natural
// language query, and runs the full agentic pipeline
// (query understanding -> controller -> tools -> GIS -> evidence -> synthesis).
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, uploads } from "@/db/schema";
import { isUuid } from "@/server/satquery/ids";
import { runAnalysis } from "@/server/satquery/pipeline";
import type { ValidationResult } from "@/server/satquery/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { uploadId?: string; query?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Request body must be JSON with { uploadId, query }." }, { status: 400 });
  }

  const { uploadId, query } = body;
  if (!uploadId || typeof uploadId !== "string") {
    return Response.json({ error: "'uploadId' is required." }, { status: 400 });
  }
  if (!isUuid(uploadId)) {
    return Response.json({ error: `'${uploadId}' is not a valid upload id.` }, { status: 400 });
  }
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return Response.json({ error: "'query' is required." }, { status: 400 });
  }

  const [upload] = await db.select().from(uploads).where(eq(uploads.id, uploadId));
  if (!upload) {
    return Response.json({ error: `Upload ${uploadId} not found.` }, { status: 404 });
  }

  const validation = upload.validation as unknown as ValidationResult;
  if (!validation.valid) {
    return Response.json({ error: "The referenced upload failed input validation and cannot be analyzed.", validation }, { status: 422 });
  }

  const [job] = await db
    .insert(jobs)
    .values({ uploadId, query: query.trim(), status: "pending" })
    .returning({ id: jobs.id });

  try {
    await runAnalysis(job.id);
  } catch (err) {
    // Job row already carries status=failed + errorMessage from the pipeline.
    console.error(`Analysis job ${job.id} failed:`, err);
  }

  const [finalJob] = await db.select().from(jobs).where(eq(jobs.id, job.id));
  return Response.json({ jobId: job.id, status: finalJob?.status ?? "failed" });
}
