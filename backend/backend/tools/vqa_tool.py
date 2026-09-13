"""Single-image VQA tool (backend/tools/vqa_tool.py).

Calls RSCoVLMWrapper.predict() when available; otherwise falls back to a
deterministic spectral-index analysis so the system never silently produces
a fake result (see backend/models/rscovlm.py health_check()).
"""
from __future__ import annotations

from backend.models.rscovlm import RSCoVLMWrapper


def run_vqa(image_path: str, question: str, target: str | None, band_stats: dict) -> dict:
    model = RSCoVLMWrapper()
    health = model.health_check()
    if health["available"]:
        model_result = model.predict(image_path, question, task="vqa"); model_result["facts"] = model_result.get("facts", []) + [{"fact": "model_observation", "value": model_result.get("answer", "")}]; return model_result

    # Rule-based fallback: see gis/processor.py + Next.js src/server/satquery/tools.ts
    # runVqaTool for the fully worked implementation used by the live app.
    coverage = band_stats.get("target_coverage_percent", 0.0)
    present = coverage > 2.0
    answer = (
        f'Yes — "{target}" detected (~{coverage:.1f}% coverage).'
        if present
        else f'No significant "{target}" detected ({coverage:.1f}% coverage).'
    )
    return {"answer": answer, "used_fallback": True, "facts": [{"fact": f"{target}_coverage_percent", "value": coverage}]}

