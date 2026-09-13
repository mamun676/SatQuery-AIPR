"""GeoJSON / overlay generation (backend/gis/overlay_generator.py)."""
from __future__ import annotations

from typing import Optional


def pixel_box_to_geo_box(box: list[int], width: int, height: int, bbox: list[float]) -> list[float]:
    min_x, min_y, max_x, max_y = bbox
    res_x = (max_x - min_x) / width
    res_y = (max_y - min_y) / height
    geo_min_x = min_x + box[0] * res_x
    geo_max_x = min_x + (box[2] + 1) * res_x
    geo_max_y = max_y - box[1] * res_y
    geo_min_y = max_y - (box[3] + 1) * res_y
    return [geo_min_x, geo_min_y, geo_max_x, geo_max_y]


def regions_to_geojson(regions: list[dict], width: int, height: int, bbox: Optional[list[float]], label: str) -> dict:
    features = []
    for r in regions:
        if bbox:
            gx0, gy0, gx1, gy1 = pixel_box_to_geo_box(r["bbox"], width, height, bbox)
            geometry = {
                "type": "Polygon",
                "coordinates": [[[gx0, gy0], [gx1, gy0], [gx1, gy1], [gx0, gy1], [gx0, gy0]]],
            }
        else:
            x0, y0, x1, y1 = r["bbox"]
            geometry = {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}
        features.append({"type": "Feature", "properties": {"label": label, "pixel_count": r["pixel_count"]}, "geometry": geometry})
    return {"type": "FeatureCollection", "features": features}
