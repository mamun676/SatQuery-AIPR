"""GIS + evidence/confidence tests (pytest)."""
import numpy as np

from backend.gis.processor import otsu_threshold, connected_components, compute_area_km2
from backend.gis.overlay_generator import pixel_box_to_geo_box, regions_to_geojson
from backend.evidence.evidence_engine import build_evidence
from backend.evidence.confidence import compute_confidence


def test_otsu_threshold_separates_bimodal_data():
    low = np.zeros(100)
    high = np.ones(100) * 10
    values = np.concatenate([low, high])
    threshold = otsu_threshold(values)
    assert 0 < threshold < 10


def test_connected_components_bbox():
    mask = np.zeros((10, 10), dtype=bool)
    mask[2:5, 2:5] = True
    regions = connected_components(mask, min_size=1)
    assert len(regions) == 1
    assert regions[0]["pixel_count"] == 9


def test_pixel_area_computation_meters():
    area = compute_area_km2(pixel_count=1_000_000, res_x=1.0, res_y=1.0, is_degree=False)
    assert area == 1.0  # 1,000,000 m^2 == 1 km^2


def test_pixel_area_none_when_resolution_missing():
    assert compute_area_km2(1000, None, None, False) is None


def test_geojson_conversion_produces_polygon():
    geojson = regions_to_geojson([{"bbox": [0, 0, 1, 1], "pixel_count": 4}], width=10, height=10, bbox=[0, 0, 10, 10], label="water")
    assert geojson["type"] == "FeatureCollection"
    assert geojson["features"][0]["geometry"]["type"] == "Polygon"


def test_evidence_creation():
    evidence = build_evidence([{"fact": "water_present", "value": True}], {"coverage": 0.1}, tool_agreement=1.0, model_probability=0.8)
    assert evidence["facts"][0]["fact"] == "water_present"


def test_confidence_formula_matches_spec():
    result = compute_confidence(model_probability=1.0, tool_agreement=1.0, validation_score=1.0)
    assert result["confidence_estimate"] == 1.0
    result_zero = compute_confidence(0.0, 0.0, 0.0)
    assert result_zero["confidence_estimate"] == 0.0
