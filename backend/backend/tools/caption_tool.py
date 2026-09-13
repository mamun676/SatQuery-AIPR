"""Captioning tool (backend/tools/caption_tool.py)."""
from __future__ import annotations

from backend.models.rscovlm import RSCoVLMWrapper


def run_caption(image_path: str, composition: dict) -> dict:
    model = RSCoVLMWrapper()
    health = model.health_check()
    if health["available"]:
        return model.predict(image_path, question="Describe this image.", task="caption")

    top = max(composition.items(), key=lambda kv: kv[1]) if composition else ("unknown", 0.0)
    answer = f"Dominant surface type (proxy classification): {top[0]} (~{top[1]:.1f}%)."
    return {"answer": answer, "used_fallback": True, "facts": [{"fact": k, "value": v} for k, v in composition.items()]}
