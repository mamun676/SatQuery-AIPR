"""Bi-temporal change tool (backend/tools/change_tool.py).

Distinguishes language-level change interpretation (Qwen3-VL when available)
from spatial change evidence (deterministic pixel-difference detector).
"""
from __future__ import annotations

import numpy as np

from backend.models.qwen3_vl import Qwen3VLWrapper
from backend.gis.processor import connected_components, otsu_threshold, compute_area_km2


def run_change(t1_path: str, t2_path: str, question: str, target: str | None, idx_t1: np.ndarray, idx_t2: np.ndarray, res: dict) -> dict:
    model = Qwen3VLWrapper()
    health = model.health_check()

    language_interpretation = None
    if health["available"]:
        try:
            language_interpretation = model.predict(t1_path, t2_path, question).get("answer")
        except Exception:  # noqa: BLE001
            language_interpretation = None

    diff = idx_t2 - idx_t1
    abs_diff = np.abs(diff)
    threshold = otsu_threshold(abs_diff)
    mask = abs_diff >= threshold
    changed_pixels = int(mask.sum())
    regions = connected_components(mask)
    area_km2 = compute_area_km2(changed_pixels, res.get("resolution_x"), res.get("resolution_y"), res.get("is_degree", False), res.get("mean_lat", 0.0))

    direction = "increase" if idx_t2.mean() > idx_t1.mean() else ("decrease" if idx_t2.mean() < idx_t1.mean() else "no significant change")
    spatial_evidence = (
        f"{changed_pixels} of {mask.size} pixels changed"
        + (f" (~{area_km2:.3f} km^2)" if area_km2 is not None else "")
        + f" across {len(regions)} region(s)."
    )
    answer = language_interpretation or f'Change-reasoning: "{target}" shows a {direction} between T1 and T2. Spatial evidence: {spatial_evidence}'

    return {
        "answer": answer,
        "used_fallback": not health["available"],
        "changed_pixels": changed_pixels,
        "area_km2": area_km2,
        "regions": regions,
        "direction": direction,
    }
