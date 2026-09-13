"""Optical + SAR joint-analysis tool (backend/tools/optical_sar_tool.py).

Explicit joint-analysis step: optical spectral index + SAR backscatter proxy
are combined via CROMA (when available) or an explicit weighted rule-based
fusion — never a raw pass-through of two images to a generic VLM.
"""
from __future__ import annotations

import numpy as np

from backend.models.croma import CROMAWrapper
from backend.gis.processor import connected_components, otsu_threshold, compute_area_km2


def run_optical_sar(optical_path: str, sar_path: str, target: str | None, optical_idx: np.ndarray, sar_idx: np.ndarray, res: dict) -> dict:
    model = CROMAWrapper()
    health = model.health_check()

    if health["available"]:
        joint = model.predict(optical_path, sar_path)
        fused = np.array(joint.get("fused_index", (optical_idx + sar_idx) / 2))
        used_fallback = False
    else:
        # rule_based_fusion: explicit weighted combination (see registry.py)
        fused = 0.5 * optical_idx + 0.5 * sar_idx
        used_fallback = True

    threshold = otsu_threshold(fused)
    mask = fused >= threshold
    changed_pixels = int(mask.sum())
    regions = connected_components(mask)
    area_km2 = compute_area_km2(changed_pixels, res.get("resolution_x"), res.get("resolution_y"), res.get("is_degree", False), res.get("mean_lat", 0.0))

    optical_mask = optical_idx >= otsu_threshold(optical_idx)
    sar_mask = sar_idx >= otsu_threshold(sar_idx)
    intersection = np.logical_and(optical_mask, sar_mask).sum()
    union = np.logical_or(optical_mask, sar_mask).sum()
    agreement = float(intersection / union) if union > 0 else 1.0

    coverage = changed_pixels / mask.size * 100
    answer = (
        f'Joint optical+SAR fusion detects "{target}" covering ~{coverage:.1f}% of the co-registered area'
        + (f" (~{area_km2:.3f} km^2)." if area_km2 is not None else ".")
        + f" Optical/SAR agreement (IoU): {agreement:.2f}."
    )
    return {
        "answer": answer,
        "used_fallback": used_fallback,
        "changed_pixels": changed_pixels,
        "area_km2": area_km2,
        "regions": regions,
        "tool_agreement": agreement,
    }
