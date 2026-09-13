"""Grounding tool (backend/tools/grounding_tool.py) — localizes a target
concept as bounding boxes."""
from __future__ import annotations

from backend.models.rscovlm import RSCoVLMWrapper
from backend.gis.processor import connected_components, otsu_threshold


def run_grounding(image_path: str, target: str, index_array) -> dict:
    model = RSCoVLMWrapper()
    health = model.health_check()
    if health["available"]:
        return model.predict(image_path, question=f"Locate {target}.", task="grounding")

    threshold = otsu_threshold(index_array)
    mask = index_array >= threshold
    regions = connected_components(mask)
    answer = f'Located {len(regions)} candidate region(s) matching "{target}".' if regions else f'No regions matching "{target}" found.'
    return {"answer": answer, "used_fallback": True, "regions": regions}
