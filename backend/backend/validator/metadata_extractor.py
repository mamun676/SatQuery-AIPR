"""Raster metadata extraction using Rasterio."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RasterMetadata:

    width: Optional[int] = None
    height: Optional[int] = None
    band_count: Optional[int] = None

    crs: Optional[str] = None

    resolution_x: Optional[float] = None
    resolution_y: Optional[float] = None

    bbox: Optional[list] = None

    acquisition_date: Optional[str] = None
    sensor: Optional[str] = None

    has_geo_transform: bool = False

    warnings: list[str] = field(
        default_factory=list
    )


def extract_metadata(
    path_or_bytes,
) -> RasterMetadata:

    try:

        import rasterio  # type: ignore

    except ImportError:

        return RasterMetadata(
            warnings=[
                "rasterio is not installed in this environment; "
                "metadata extraction skipped."
            ]
        )

    meta = RasterMetadata()

    try:

        with rasterio.open(path_or_bytes) as src:

            meta.width = src.width
            meta.height = src.height
            meta.band_count = src.count

            meta.crs = (
                str(src.crs)
                if src.crs
                else None
            )

            meta.has_geo_transform = (
                src.transform is not None
                and not src.transform.is_identity
            )

            if src.res:
                meta.resolution_x = src.res[0]
                meta.resolution_y = src.res[1]

            if src.bounds:

                meta.bbox = [
                    src.bounds.left,
                    src.bounds.bottom,
                    src.bounds.right,
                    src.bounds.top,
                ]

            tags = src.tags()

            meta.acquisition_date = (
                tags.get("TIFFTAG_DATETIME")
                or tags.get("acquisition_date")
                or tags.get("ACQUISITION_DATE")
            )

            meta.sensor = (
                tags.get("sensor")
                or tags.get("SENSOR")
            )

            if not meta.crs:

                meta.warnings.append(
                    "No CRS found in raster metadata."
                )

            if not meta.acquisition_date:

                meta.warnings.append(
                    "No acquisition date found in raster metadata."
                )

    except Exception as exc:

        meta.warnings.append(
            f"Failed to read raster: {exc}"
        )

    return meta