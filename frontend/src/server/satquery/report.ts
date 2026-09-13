// Downloadable report generator (backend/output/report_generator.py).
import type { AnalysisResult } from "./types";

export function generateReportText(result: AnalysisResult, query: string, generatedAt: string): string {
  const lines: string[] = [];
  lines.push("# SatQuery AI — Analysis Report");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Job ID: ${result.jobId}`);
  lines.push("");
  lines.push("## Query");
  lines.push(query);
  lines.push("");
  lines.push("## Input");
  lines.push(`Mode: ${result.mode ?? "unknown"}`);
  lines.push("");
  lines.push("## Detected Task & Workflow");
  lines.push(`Task: ${result.intent?.task ?? "n/a"}`);
  lines.push(`Target concept: ${result.intent?.target ?? "n/a"}`);
  lines.push(`Workflow/tool: ${result.workflow ?? "n/a"}`);
  if (result.intent?.coerced) {
    lines.push(`Note: ${result.intent.coercionReason}`);
  }
  lines.push("");
  lines.push("## Models / Tools Used");
  for (const m of result.modelsUsed) {
    lines.push(`- ${m.name} (${m.role}) — ${m.status}${m.reason ? `: ${m.reason}` : ""}`);
  }
  lines.push("");
  lines.push("## Result");
  lines.push(result.answer ?? "(no answer generated)");
  lines.push("");
  lines.push("## Evidence");
  if (result.evidence) {
    for (const f of result.evidence.facts) {
      lines.push(`- ${f.fact}: ${JSON.stringify(f.value)}${f.unit ? ` ${f.unit}` : ""}`);
    }
  } else {
    lines.push("(no structured evidence)");
  }
  lines.push("");
  lines.push("## Confidence Estimate");
  if (result.confidence) {
    lines.push(`Confidence estimate: ${(result.confidence.confidenceEstimate * 100).toFixed(1)}%`);
    lines.push(`Formula: ${result.confidence.formula}`);
    lines.push(
      `Breakdown — model_probability: ${result.confidence.modelProbability.toFixed(3)}, tool_agreement: ${result.confidence.toolAgreement.toFixed(3)}, validation_score: ${result.confidence.validationScore.toFixed(3)}`,
    );
  }
  lines.push("");
  lines.push("## Warnings");
  if (result.warnings.length === 0) {
    lines.push("None");
  } else {
    result.warnings.forEach((w) => lines.push(`- ${w}`));
  }
  lines.push("");
  lines.push("## Execution Trace Summary");
  for (const ev of result.trace) {
    lines.push(`- [${ev.timestamp}] (${ev.stage}) ${ev.message}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("This report was generated automatically by SatQuery AI. Quantitative values are computed deterministically");
  lines.push("by the GIS/evidence layer; the confidence value is a heuristic estimate, not a calibrated probability.");
  return lines.join("\n");
}
