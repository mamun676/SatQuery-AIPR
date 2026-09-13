// Evidence engine + confidence estimation
// (backend/evidence/evidence_engine.py + confidence.py).
import type { ConfidenceBreakdown, Evidence, EvidenceFact, GeoOverlay } from "./types";

export function buildEvidence(
  facts: EvidenceFact[],
  statistics: Record<string, unknown>,
  overlay: GeoOverlay | null,
  toolAgreement: number,
  modelProbability: number,
): Evidence {
  return { facts, statistics, overlay, toolAgreement, modelProbability };
}

/**
 * Confidence ESTIMATE (explicitly not a calibrated probability).
 *
 * confidence = 0.5 * model_probability + 0.3 * tool_agreement + 0.2 * validation_score
 *
 * `modelProbability` here is a deterministic separability statistic (see
 * gis.computeSeparability), not a calibrated ML confidence — this keeps the
 * formula modular so a real calibrated model score can be substituted later
 * without changing callers.
 */
export function computeConfidence(modelProbability: number, toolAgreement: number, validationScore: number): ConfidenceBreakdown {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const mp = clamp(modelProbability);
  const ta = clamp(toolAgreement);
  const vs = clamp(validationScore);
  const confidenceEstimate = 0.5 * mp + 0.3 * ta + 0.2 * vs;
  return {
    modelProbability: mp,
    toolAgreement: ta,
    validationScore: vs,
    confidenceEstimate: Number(confidenceEstimate.toFixed(4)),
    formula: "confidence_estimate = 0.5*model_probability + 0.3*tool_agreement + 0.2*validation_score (uncalibrated heuristic)",
  };
}
