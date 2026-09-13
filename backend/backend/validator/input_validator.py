"""Input validation gatekeeper for SatQuery AI."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from backend.validator.metadata_extractor import extract_metadata


ALLOWED_EXTENSIONS = {
    "tif",
    "tiff",
    "png",
    "jpg",
    "jpeg",
}

MAX_FILES = 2


@dataclass
class RawUploadFile:

    original_name: str
    content: bytes

    role: Literal[
        "single",
        "optical",
        "sar",
        "t1",
        "t2",
    ] = "single"


# -------------------------------------------------------------------
# Format detection
# -------------------------------------------------------------------
def _detect_format(
    name: str,
    content: bytes,
) -> str:

    ext = (
        name.lower().rsplit(".", 1)[-1]
        if "." in name
        else ""
    )

    magic = content[:4]

    # TIFF / GeoTIFF
    if magic[:2] in (b"II", b"MM"):

        if ext in ("tif", "tiff"):
            return "GeoTIFF"

        return "TIFF"

    # PNG
    if magic[:4] == b"\x89PNG":
        return "PNG"

    # JPEG
    if magic[:2] == b"\xff\xd8":
        return "JPEG"

    return "unknown"


# -------------------------------------------------------------------
# Modality inference
# -------------------------------------------------------------------
def _infer_modality(
    role: str,
    band_count: int | None,
    filename: str,
) -> str:

    lower = filename.lower()

    # Explicit SAR role
    if role == "sar":
        return "sar"

    # Explicit optical role
    if role == "optical":
        return "optical"

    # Temporal roles are not modalities.
    # Infer modality from filename/content when possible.
    if (
        "sar" in lower
        or "sentinel-1" in lower
        or "_s1" in lower
        or "-s1" in lower
    ):
        return "sar"

    # Multispectral imagery normally has multiple bands.
    if band_count is not None and band_count >= 4:
        return "multispectral"

    # Do NOT automatically classify every single-band raster as SAR.
    return "optical"


# -------------------------------------------------------------------
# Build file metadata
# -------------------------------------------------------------------
def build_file_meta(
    raw: RawUploadFile,
    stored_path: str,
    file_id: str,
) -> dict:

    fmt = _detect_format(
        raw.original_name,
        raw.content,
    )

    warnings: list[str] = []

    # Extract metadata from the REAL saved raster.
    meta = extract_metadata(stored_path)

    warnings.extend(meta.warnings)

    modality = _infer_modality(
        raw.role,
        meta.band_count,
        raw.original_name,
    )

    return {
        "id": file_id,
        "original_name": raw.original_name,
        "stored_path": stored_path,
        "size_bytes": len(raw.content),
        "format": fmt,
        "modality": modality,
        "role": raw.role,
        "raster": meta.__dict__,
        "warnings": warnings,
    }


# -------------------------------------------------------------------
# Determine input mode
# -------------------------------------------------------------------
def _determine_mode(
    files: list[dict],
) -> str | None:

    if len(files) == 1:
        return "single_image"

    if len(files) != 2:
        return None

    roles = [f["role"] for f in files]

    modalities = {
        f["modality"]
        for f in files
    }

    # Explicit temporal pair
    if set(roles) == {"t1", "t2"}:
        return "bitemporal"

    # Explicit optical + SAR
    if set(roles) == {"optical", "sar"}:
        return "optical_sar"

    # Modality-based optical + SAR
    if (
        "sar" in modalities
        and (
            "optical" in modalities
            or "multispectral" in modalities
        )
    ):
        return "optical_sar"

    # Two images otherwise represent a temporal pair.
    return "bitemporal"


# -------------------------------------------------------------------
# Main validation function
# -------------------------------------------------------------------
def validate_files(
    raw_files: list[RawUploadFile],
    stored_paths: list[str] | None = None,
) -> tuple[list[dict], dict]:

    errors: list[str] = []
    warnings: list[str] = []

    file_metas: list[dict] = []

    if not raw_files:
        errors.append(
            "No files were provided."
        )

    if len(raw_files) > MAX_FILES:
        errors.append(
            f"Too many files ({len(raw_files)}). "
            f"At most {MAX_FILES} are supported."
        )

    if stored_paths is None:
        stored_paths = [""] * len(raw_files)

    if len(stored_paths) != len(raw_files):
        errors.append(
            "Internal error: number of stored paths "
            "does not match number of uploaded files."
        )
        stored_paths = [""] * len(raw_files)

    # ---------------------------------------------------------------
    # Validate each file
    # ---------------------------------------------------------------
    for index, raw in enumerate(raw_files):

        stored_path = stored_paths[index]

        meta = build_file_meta(
            raw=raw,
            stored_path=stored_path,
            file_id=str(index),
        )

        file_metas.append(meta)

        warnings.extend(
            f"{raw.original_name}: {warning}"
            for warning in meta["warnings"]
        )

        if meta["format"] == "unknown":
            errors.append(
                f"{raw.original_name}: "
                "unsupported/undetectable raster format."
            )

        extension = (
            raw.original_name.lower()
            .rsplit(".", 1)[-1]
            if "." in raw.original_name
            else ""
        )

        if extension not in ALLOWED_EXTENSIONS:
            errors.append(
                f"{raw.original_name}: "
                f"unsupported extension '.{extension}'."
            )

    # ---------------------------------------------------------------
    # Determine processing mode
    # ---------------------------------------------------------------
    mode = (
        _determine_mode(file_metas)
        if file_metas
        else None
    )

    # ---------------------------------------------------------------
    # Validation score
    # ---------------------------------------------------------------
    validation_score = max(
        0.0,
        1.0
        - len(errors) * 0.5
        - len(warnings) * 0.05,
    )

    validation = {
        "valid": len(errors) == 0,
        "mode": mode,
        "files": len(file_metas),
        "modalities": sorted(
            {
                f["modality"]
                for f in file_metas
            }
        ),
        "format": (
            file_metas[0]["format"]
            if file_metas
            else None
        ),
        "crs": (
            file_metas[0]["raster"].get("crs")
            if file_metas
            else None
        ),
        "errors": errors,
        "warnings": warnings,
        "validation_score": validation_score,
    }

    return file_metas, validation