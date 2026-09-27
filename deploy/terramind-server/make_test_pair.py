#!/usr/bin/env python3
"""Create a co-registered synthetic Optical + Sentinel-1 GRD browser test pair.

This validates routing and integration only; it is not scientific ground truth.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", nargs="?", default="/tmp/satquery-optical-sar-pair")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    height = 448
    width = 448
    yy, xx = np.mgrid[0:height, 0:width]
    water = ((xx - 235) ** 2 / 115**2 + (yy - 230) ** 2 / 80**2) <= 1.0

    red = np.where(water, 0.08, 0.30 + 0.05 * np.sin(xx / 31.0))
    green = np.where(water, 0.12, 0.42 + 0.08 * np.cos(yy / 37.0))
    blue = np.where(water, 0.30, 0.16 + 0.04 * np.sin((xx + yy) / 45.0))
    optical = np.stack([red, green, blue]).astype(np.float32)

    vv = np.where(water, -19.0, -10.8 + 1.0 * np.sin(xx / 29.0))
    vh = np.where(water, -27.0, -18.5 + 0.8 * np.cos(yy / 33.0))
    sar = np.stack([vv, vh]).astype(np.float32)

    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "dtype": "float32",
        "crs": "EPSG:32643",
        "transform": from_origin(500000, 3000000, 10, 10),
        "compress": "deflate",
    }

    optical_path = output / "controlled-optical-rgb.tif"
    with rasterio.open(optical_path, "w", count=3, **profile) as dataset:
        dataset.write(optical)
        for index, name in enumerate(("Red", "Green", "Blue"), 1):
            dataset.set_band_description(index, name)

    sar_path = output / "controlled-sentinel1-grd-vv-vh.tif"
    with rasterio.open(sar_path, "w", count=2, **profile) as dataset:
        dataset.write(sar)
        dataset.set_band_description(1, "VV")
        dataset.set_band_description(2, "VH")

    task = output / "TASK.txt"
    task.write_text(
        "Do the co-registered optical and Sentinel-1 GRD VV/VH observations "
        "agree on the water-covered area? Use TerraMind multimodal evidence "
        "and deterministic GIS measurements. State that this controlled pair "
        "is synthetic and must not be treated as real-world flood ground truth.\n",
        encoding="utf-8",
    )

    print(optical_path)
    print(sar_path)
    print(task)
    print("CONTROLLED OPTICAL+SAR TEST PAIR CREATED")


if __name__ == "__main__":
    main()
