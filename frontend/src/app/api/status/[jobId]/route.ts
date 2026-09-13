// GET /api/status/{job_id} — lightweight polling endpoint.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { isUuid } from "@/server/satquery/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isUuid(jobId)) {
    return Response.json({ error: `'${jobId}' is not a valid job id.` }, { status: 400 });
  }
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) {
    return Response.json({ error: `Job ${jobId} not found.` }, { status: 404 });
  }
  return Response.json({
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    workflow: job.workflow,
    usedFallback: job.usedFallback,
    errorMessage: job.errorMessage,
    durationMs: job.durationMs,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}
