// GET /api/result/{job_id} — full structured result: answer, evidence,
// confidence, models used, warnings, and the observable execution trace.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { isUuid } from "@/server/satquery/ids";
import type { AnalysisResult, ConfidenceBreakdown, Evidence, ModelUsed, QueryIntent, TraceEvent } from "@/server/satquery/types";

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

  const traceEvents = ((job.trace as Record<string, unknown> | null)?.events as TraceEvent[] | undefined) ?? [];

  const result: AnalysisResult = {
    jobId: job.id,
    status: job.status,
    mode: job.mode as AnalysisResult["mode"],
    intent: (job.intent as unknown as QueryIntent) ?? null,
    workflow: job.workflow,
    modelsUsed: (job.modelsUsed as unknown as ModelUsed[]) ?? [],
    parameters: (job.parameters as Record<string, unknown>) ?? {},
    evidence: (job.evidence as unknown as Evidence) ?? null,
    confidence: (job.confidenceBreakdown as unknown as ConfidenceBreakdown) ?? null,
    answer: job.answer,
    warnings: (job.warnings as string[]) ?? [],
    errorMessage: job.errorMessage,
    trace: traceEvents,
    usedFallback: job.usedFallback ?? false,
    durationMs: job.durationMs ?? null,
  };

  return Response.json({ query: job.query, ...result });
}
