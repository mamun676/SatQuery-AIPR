// Top-level pipeline glue: loads a persisted job, runs the agentic
// controller, persists evidence/confidence/answer/trace/report back to
// Postgres. This is what backend/main.py + api/routes.py would call in the
// reference FastAPI implementation.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, uploads } from "@/db/schema";
import { orchestrate } from "./controller";
import { buildEvidence, computeConfidence } from "./evidence";
import { synthesizeAnswer } from "./synthesis";
import { generateReportText } from "./report";
import { TraceLogger } from "./trace";
import { saveDerived } from "./storage";
import type { AnalysisResult, InputMode, UploadedFileMeta, ValidationResult } from "./types";

export async function runAnalysis(jobId: string): Promise<void> {
  const startedAt = Date.now();
  const trace = new TraceLogger();

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);

  const [upload] = await db.select().from(uploads).where(eq(uploads.id, job.uploadId));
  if (!upload) throw new Error(`Upload ${job.uploadId} not found for job ${jobId}`);

  const files = upload.files as unknown as UploadedFileMeta[];
  const validation = upload.validation as unknown as ValidationResult;
  const mode = validation.mode as InputMode;

  trace.log("input", "Loaded validated upload for analysis", {
    files: files.map((f) => f.originalName),
    modalities: validation.modalities,
    format: validation.format,
    crs: validation.crs,
  });

  await db.update(jobs).set({ status: "running", mode, updatedAt: new Date() }).where(eq(jobs.id, jobId));

  try {
    const controllerOutput = await orchestrate({ query: job.query, mode, files }, trace);
    const { intent, workflow, modelsUsed, parameters, toolOutput, usedFallback } = controllerOutput;

    trace.log("evidence", "Building structured evidence from tool output", { factCount: toolOutput.facts.length });
    const evidence = buildEvidence(toolOutput.facts, toolOutput.statistics, toolOutput.overlay, toolOutput.toolAgreement, toolOutput.modelProbability);

    const confidence = computeConfidence(toolOutput.modelProbability, toolOutput.toolAgreement, validation.validationScore);
    trace.log("confidence", `Computed confidence estimate: ${confidence.confidenceEstimate}`, { confidence });

    // Persist mask/preview PNGs and rewrite overlay URLs to be servable.
    // NOTE: tools emit differently-named rasters (mask.png, change_mask.png,
    // fused_mask.png, preview.png ...) so the URLs are derived from what was
    // actually written instead of assuming a fixed "mask.png".
    const derivedUrls: Array<{ name: string; url: string }> = [];
    for (const preview of toolOutput.previewPngs) {
      await saveDerived("masks", jobId, preview.name, preview.buffer);
      derivedUrls.push({ name: preview.name, url: `/api/files/masks/${jobId}/${preview.name}` });
    }
    evidence.assets = derivedUrls;
    if (evidence.overlay) {
      const maskAsset = derivedUrls.find((d) => d.name.includes("mask"));
      evidence.overlay.maskPreviewUrl = maskAsset ? maskAsset.url : null;
      evidence.overlay.previewUrls = derivedUrls;
    }

    const warnings = [...validation.warnings];

    trace.log("synthesis", "Synthesizing human-readable answer grounded in evidence", {});
    const answer = await synthesizeAnswer(job.query, toolOutput.answer, toolOutput.facts, confidence, warnings);
    trace.log("synthesis", "Synthesis complete", {});

    const durationMs = Date.now() - startedAt;
    trace.log("completed", `Analysis completed in ${durationMs}ms`, { usedFallback });

    const result: AnalysisResult = {
      jobId,
      status: "completed",
      mode,
      intent,
      workflow,
      modelsUsed,
      parameters,
      evidence,
      confidence,
      answer,
      warnings,
      errorMessage: null,
      trace: trace.all(),
      usedFallback,
      durationMs,
    };

    const reportText = generateReportText(result, job.query, new Date().toISOString());
    await saveDerived("reports", jobId, "report.md", reportText);
    await saveDerived("traces", jobId, "trace.json", JSON.stringify(trace.all(), null, 2));

    await db
      .update(jobs)
      .set({
        status: "completed",
        mode,
        intent: intent as unknown as Record<string, unknown>,
        workflow,
        modelsUsed: modelsUsed as unknown as Record<string, unknown>[],
        parameters,
        evidence: evidence as unknown as Record<string, unknown>,
        confidence: confidence.confidenceEstimate,
        confidenceBreakdown: confidence as unknown as Record<string, unknown>,
        answer,
        warnings,
        trace: { events: trace.all() } as unknown as Record<string, unknown>,
        reportText,
        usedFallback,
        durationMs,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.log("error", `Analysis failed: ${message}`, {});
    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage: message,
        trace: { events: trace.all() } as unknown as Record<string, unknown>,
        durationMs: Date.now() - startedAt,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    throw err;
  }
}
