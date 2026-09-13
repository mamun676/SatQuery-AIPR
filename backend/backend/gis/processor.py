"""GIS / raster processing (backend/gis/processor.py).

The only place in the reference backend allowed to produce quantitative
spatial numbers (pixel counts, areas, bounding boxes, coordinates). Uses
Rasterio + NumPy; GDAL is a transitive dependency of Rasterio.

INTEGRATION BOUNDARY: requires `rasterio` and `numpy` to be installed.
"""
from __future__ import annotations

from typing import Optional

import numpy as np


def read_bands(path: str) -> tuple[np.ndarray, dict]:
    """Read all bands of a raster as a (bands, height, width) array + profile."""
    import rasterio  # type: ignore

    with rasterio.open(path) as src:
        data = src.read().astype("float64")
        profile = src.profile
    return data, profile


def otsu_threshold(values: np.ndarray) -> float:
    """Deterministic Otsu global threshold."""
    hist, bin_edges = np.histogram(values, bins=256)
    bin_mids = (bin_edges[:-1] + bin_edges[1:]) / 2
    weight1 = np.cumsum(hist)
    weight2 = np.cumsum(hist[::-1])[::-1]
    mean1 = np.cumsum(hist * bin_mids) / np.maximum(weight1, 1)
    mean2 = (np.cumsum((hist * bin_mids)[::-1])[::-1]) / np.maximum(weight2, 1)
    variance12 = weight1[:-1] * weight2[1:] * (mean1[:-1] - mean2[1:]) ** 2
    idx = np.argmax(variance12)
    return float(bin_mids[idx])


def connected_components(mask: np.ndarray, min_size: int = 16, max_regions: int = 20) -> list[dict]:
    """Label connected regions in a boolean mask and return bounding boxes,
    largest first. Uses a simple flood-fill (scipy.ndimage.label if available,
    otherwise a pure-Python BFS fallback)."""
    try:
        from scipy import ndimage  # type: ignore

        labeled, n = ndimage.label(mask)
        regions = []
        for i in range(1, n + 1):
            ys, xs = np.where(labeled == i)
            if len(xs) < min_size:
                continue
            regions.append({"pixel_count": int(len(xs)), "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
        regions.sort(key=lambda r: r["pixel_count"], reverse=True)
        return regions[:max_regions]
    except ImportError:
        return _connected_components_bfs(mask, min_size, max_regions)


def _connected_components_bfs(mask: np.ndarray, min_size: int, max_regions: int) -> list[dict]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    regions = []
    for y0 in range(height):
        for x0 in range(width):
            if not mask[y0, x0] or visited[y0, x0]:
                continue
            stack = [(y0, x0)]
            visited[y0, x0] = True
            pixels = []
            while stack:
                y, x = stack.pop()
                pixels.append((y, x))
                for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            if len(pixels) >= min_size:
                ys = [p[0] for p in pixels]
                xs = [p[1] for p in pixels]
                regions.append({"pixel_count": len(pixels), "bbox": [min(xs), min(ys), max(xs), max(ys)]})
    regions.sort(key=lambda r: r["pixel_count"], reverse=True)
    return regions[:max_regions]


def compute_area_km2(pixel_count: int, res_x: Optional[float], res_y: Optional[float], is_degree: bool, mean_lat: float = 0.0) -> Optional[float]:
    """changed_pixels x pixel_area -> changed_area. Returns None (never a
    fabricated number) if resolution is unavailable."""
    if res_x is None or res_y is None:
        return None
    if is_degree:
        m_per_deg_lat = 111320.0
        m_per_deg_lon = 111320.0 * np.cos(np.radians(mean_lat))
        pixel_area_m2 = (res_x * m_per_deg_lon) * (res_y * m_per_deg_lat)
    else:
        pixel_area_m2 = res_x * res_y
    return float(pixel_count * pixel_area_m2 / 1_000_000.0)
