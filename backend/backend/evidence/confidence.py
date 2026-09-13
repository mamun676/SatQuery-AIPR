"""Confidence ESTIMATE (backend/evidence/confidence.py) — explicitly not a
calibrated probability unless proper calibration is implemented later.

confidence_estimate = 0.5*model_probability + 0.3*tool_agreement + 0.2*validation_score
"""
from __future__ import annotations


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


def compute_confidence(model_probability: float, tool_agreement: float, validation_score: float) -> dict:
    mp, ta, vs = _clamp(model_probability), _clamp(tool_agreement), _clamp(validation_score)
    estimate = 0.5 * mp + 0.3 * ta + 0.2 * vs
    return {
        "model_probability": mp,
        "tool_agreement": ta,
        "validation_score": vs,
        "confidence_estimate": round(estimate, 4),
        "formula": "confidence_estimate = 0.5*model_probability + 0.3*tool_agreement + 0.2*validation_score (uncalibrated heuristic)",
    }
