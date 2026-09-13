"""Evidence engine (backend/evidence/evidence_engine.py)."""
from __future__ import annotations

from typing import Any


def build_evidence(facts: list[dict], statistics: dict[str, Any], tool_agreement: float, model_probability: float) -> dict:
    return {
        "facts": facts,
        "statistics": statistics,
        "tool_agreement": tool_agreement,
        "model_probability": model_probability,
    }
