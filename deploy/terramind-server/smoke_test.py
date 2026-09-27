#!/usr/bin/env python3
"""End-to-end local smoke test for both TerraMind HTTP endpoints."""

from __future__ import annotations

import argparse
from base64 import b64decode, b64encode
from io import BytesIO
import json
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
from rasterio.io import MemoryFile
from rasterio.transform import from_origin


def post(url: str, body: bytes, content_type: str) -> dict:
    request = Request(url, data=body, headers={"content-type": content_type}, method="POST")
    with urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def optical_png() -> bytes:
    x = np.linspace(0, 255, 224, dtype=np.uint8)
    y = np.linspace(255, 0, 224, dtype=np.uint8)
    red = np.tile(x, (224, 1))
    green = np.tile(y[:, None], (1, 224))
    blue = np.full((224, 224), 96, dtype=np.uint8)
    image = Image.fromarray(np.stack([red, green, blue], axis=-1), mode="RGB")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def sar_tiff() -> bytes:
    yy, xx = np.mgrid[0:224, 0:224]
    vv = (-12.599 + 1.2 * np.sin(xx / 24.0)).astype(np.float32)
    vh = (-20.293 + 1.0 * np.cos(yy / 28.0)).astype(np.float32)
    profile = {
        "driver": "GTiff",
        "height": 224,
        "width": 224,
        "count": 2,
        "dtype": "float32",
        "crs": "EPSG:32643",
        "transform": from_origin(500000, 3000000, 10, 10),
    }
    with MemoryFile() as memory_file:
        with memory_file.open(**profile) as dataset:
            dataset.write(vv, 1)
            dataset.write(vh, 2)
            dataset.set_band_description(1, "VV")
            dataset.set_band_description(2, "VH")
        return memory_file.read()


def validate_result(result: dict, expected_inputs: int) -> None:
    assert result.get("model") == "TerraMind-v1-base", result
    assert result.get("output_shape") == [10, 224, 224], result.get("output_shape")
    mask = b64decode(result["mask_png_base64"], validate=True)
    image = Image.open(BytesIO(mask))
    assert image.size == (224, 224), image.size
    if expected_inputs == 2:
        assert result.get("input_modalities") == [
            "untok_sen2rgb@224",
            "untok_sen1grd@224",
        ]
        assert result.get("fusion") == "native TerraMind multimodal attention"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://127.0.0.1:8002")
    args = parser.parse_args()
    optical = optical_png()

    single = post(
        f"{args.endpoint}/predict",
        optical,
        "application/octet-stream",
    )
    validate_result(single, expected_inputs=1)
    print("Single-image endpoint: PASS")

    paired_body = json.dumps(
        {
            "optical_base64": b64encode(optical).decode("ascii"),
            "optical_filename": "controlled-optical.png",
            "sar_base64": b64encode(sar_tiff()).decode("ascii"),
            "sar_filename": "controlled-sentinel1-grd-vv-vh.tif",
        }
    ).encode("utf-8")
    paired = post(
        f"{args.endpoint}/predict-optical-sar",
        paired_body,
        "application/json",
    )
    validate_result(paired, expected_inputs=2)
    print("Optical+SAR endpoint: PASS")
    print("TerraMind HTTP regression: PASS")


if __name__ == "__main__":
    main()
