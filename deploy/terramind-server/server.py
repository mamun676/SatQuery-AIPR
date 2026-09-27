"""Local-only TerraMind GPU API for SatQuery.

Serves the existing single-image RGB -> provisional LULC endpoint and a real
TerraMind multimodal Optical + Sentinel-1 GRD endpoint. The paired endpoint
accepts base64-encoded files; quantitative GIS claims remain the responsibility
of the Next.js GIS layer, not this generative model service.
"""

from __future__ import annotations

import asyncio
from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from functools import partial
from io import BytesIO
from typing import Any

import numpy as np
import rasterio
import torch
import torch.nn as nn
from fastapi import FastAPI, HTTPException, Request
from PIL import Image
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from terratorch.models.backbones.terramind.model import terramind_register as r
from terratorch.models.backbones.terramind.model.terramind_generation import (
    TerraMindGeneration,
)
from terratorch.models.backbones.terramind.model.tm_utils import LayerNorm

MODEL_PATH = "/root/satquery/models/TerraMind/TerraMind_v1_base.pt"
OPTICAL_MODALITY = "untok_sen2rgb@224"
SAR_MODALITY = "untok_sen1grd@224"
OUTPUT_MODALITY = "tok_lulc@224"
IMAGE_SIZE = 224
MAX_FILE_BYTES = 128 * 1024 * 1024
SAR_GRD_MEAN = np.asarray([-12.599, -20.293], dtype=np.float32)[:, None, None]
SAR_GRD_STD = np.asarray([5.195, 5.890], dtype=np.float32)[:, None, None]

app = FastAPI(title="TerraMind GPU API")
INFERENCE_LOCK = asyncio.Lock()


def load_model() -> TerraMindGeneration:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU is not available")
    print("Loading TerraMind multimodal model...")
    model = TerraMindGeneration(
        img_size=IMAGE_SIZE,
        modalities=[OPTICAL_MODALITY, SAR_MODALITY],
        output_modalities=[OUTPUT_MODALITY],
        decoding_steps=1,
        temps=1.0,
        top_p=0.8,
        top_k=0,
        timesteps=1,
        patch_size=16,
        dim=768,
        encoder_depth=12,
        decoder_depth=12,
        num_heads=12,
        mlp_ratio=4,
        qkv_bias=False,
        proj_bias=False,
        mlp_bias=False,
        num_register_tokens=0,
        act_layer=nn.SiLU,
        norm_layer=partial(LayerNorm, eps=1e-6, bias=False),
        gated_mlp=True,
        tokenizer_dict=r.tokenizer_dict["v1"],
        pretrained=True,
    )
    state = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
    remapped = {"sampler.model." + key: value for key, value in state.items()}
    result = model.load_state_dict(remapped, strict=False)
    missing = [
        key
        for key in result.missing_keys
        if not key.startswith("tokenizer.")
    ]
    if missing:
        raise RuntimeError("Core checkpoint mismatch: " + str(missing[:10]))
    del state, remapped
    model.eval().float().to("cuda")
    torch.cuda.synchronize()
    print(
        "TerraMind loaded on GPU. Memory:",
        round(torch.cuda.memory_allocated() / (1024**3), 2),
        "GiB",
    )
    return model


MODEL = load_model()


def _decode_file(payload: dict[str, Any], key: str) -> bytes:
    encoded = payload.get(key)
    if not isinstance(encoded, str) or not encoded:
        raise HTTPException(status_code=400, detail=f'Missing base64 field "{key}"')
    try:
        data = b64decode(encoded, validate=True)
    except (Base64Error, ValueError) as error:
        raise HTTPException(status_code=400, detail=f'Invalid base64 field "{key}": {error}') from error
    if not data:
        raise HTTPException(status_code=400, detail=f'File field "{key}" is empty')
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f'File field "{key}" exceeds 128 MiB')
    return data


def _scale_optical(array: np.ndarray) -> tuple[np.ndarray, str]:
    array = np.nan_to_num(array, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
    p99 = float(np.percentile(array, 99))
    p01 = float(np.percentile(array, 1))
    if p99 <= 1.5 and p01 >= -0.1:
        return np.clip(array, 0.0, 1.0), "unit_reflectance"
    if p99 <= 255.0 and p01 >= 0.0:
        return np.clip(array / 255.0, 0.0, 1.0), "uint8_scaled"
    if p99 <= 12000.0 and p01 >= 0.0:
        return np.clip(array / 10000.0, 0.0, 1.0), "sentinel2_reflectance_scaled"
    low = float(np.percentile(array, 2))
    high = float(np.percentile(array, 98))
    if not np.isfinite(low) or not np.isfinite(high) or high <= low:
        raise HTTPException(status_code=400, detail="Optical raster has no usable dynamic range")
    return np.clip((array - low) / (high - low), 0.0, 1.0), "robust_percentile_scaled"


def _load_optical(data: bytes, filename: str) -> tuple[torch.Tensor, dict[str, Any]]:
    is_tiff = data[:4] in (b"II*\x00", b"MM\x00*")
    if is_tiff:
        try:
            with MemoryFile(data) as memory_file, memory_file.open() as source:
                if source.count < 3:
                    raise HTTPException(
                        status_code=400,
                        detail="Optical GeoTIFF requires at least three bands",
                    )
                indexes = [4, 3, 2] if source.count >= 4 else [1, 2, 3]
                array = source.read(
                    indexes=indexes,
                    out_shape=(3, IMAGE_SIZE, IMAGE_SIZE),
                    resampling=Resampling.bilinear,
                    masked=True,
                ).filled(np.nan).astype(np.float32)
                metadata = {
                    "filename": filename,
                    "source_shape": [source.height, source.width],
                    "source_bands": source.count,
                    "selected_bands": indexes,
                    "crs": str(source.crs) if source.crs else None,
                    "bounds": list(source.bounds) if source.crs else None,
                }
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"Invalid optical GeoTIFF: {error}") from error
    else:
        try:
            image = Image.open(BytesIO(data)).convert("RGB").resize(
                (IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BICUBIC
            )
            array = np.asarray(image, dtype=np.float32).transpose(2, 0, 1)
            metadata = {
                "filename": filename,
                "source_shape": [image.height, image.width],
                "source_bands": 3,
                "selected_bands": [1, 2, 3],
                "crs": None,
                "bounds": None,
            }
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"Invalid optical image: {error}") from error

    scaled, scaling = _scale_optical(array)
    metadata["scaling"] = scaling
    tensor = torch.from_numpy(np.ascontiguousarray(scaled)).unsqueeze(0).to(
        "cuda", dtype=torch.float32
    )
    return tensor, metadata


def _load_sar_grd(data: bytes, filename: str) -> tuple[torch.Tensor, dict[str, Any]]:
    if data[:4] not in (b"II*\x00", b"MM\x00*"):
        raise HTTPException(
            status_code=400,
            detail="Sentinel-1 GRD input must be a two-band VV/VH GeoTIFF or TIFF",
        )
    try:
        with MemoryFile(data) as memory_file, memory_file.open() as source:
            if source.count < 2:
                raise HTTPException(
                    status_code=400,
                    detail="Sentinel-1 GRD input requires two bands ordered VV, VH",
                )
            array = source.read(
                indexes=[1, 2],
                out_shape=(2, IMAGE_SIZE, IMAGE_SIZE),
                resampling=Resampling.bilinear,
                masked=True,
            ).filled(np.nan).astype(np.float32)
            metadata = {
                "filename": filename,
                "source_shape": [source.height, source.width],
                "source_bands": source.count,
                "selected_bands": ["VV", "VH"],
                "crs": str(source.crs) if source.crs else None,
                "bounds": list(source.bounds) if source.crs else None,
            }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Invalid Sentinel-1 GRD raster: {error}") from error

    finite = array[np.isfinite(array)]
    if finite.size == 0:
        raise HTTPException(status_code=400, detail="Sentinel-1 GRD raster has no finite pixels")
    p50 = float(np.percentile(finite, 50))
    p99 = float(np.percentile(finite, 99))
    if p50 >= 0.0:
        if p99 > 2.0:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Positive Sentinel-1 values exceed the calibrated linear sigma0 range; "
                    "provide calibrated sigma0 (0..1) or dB backscatter"
                ),
            )
        db = 10.0 * np.log10(np.clip(array, 1e-6, None))
        input_scale = "linear_sigma0_to_db"
    else:
        db = array
        input_scale = "db"
    db = np.nan_to_num(db, nan=-50.0, posinf=10.0, neginf=-50.0)
    db = np.clip(db, -50.0, 10.0).astype(np.float32)
    normalized = (db - SAR_GRD_MEAN) / SAR_GRD_STD
    metadata.update(
        {
            "input_scale": input_scale,
            "normalization_mean": SAR_GRD_MEAN[:, 0, 0].tolist(),
            "normalization_std": SAR_GRD_STD[:, 0, 0].tolist(),
            "db_range_after_clipping": [float(db.min()), float(db.max())],
        }
    )
    tensor = torch.from_numpy(np.ascontiguousarray(normalized)).unsqueeze(0).to(
        "cuda", dtype=torch.float32
    )
    return tensor, metadata


def _mask_png(mask: np.ndarray) -> bytes:
    palette = [
        65, 155, 223,
        57, 125, 73,
        136, 176, 83,
        214, 203, 126,
        194, 136, 73,
        173, 106, 177,
        221, 78, 65,
        160, 160, 160,
        238, 238, 238,
        35, 35, 35,
    ]
    image = Image.fromarray(mask.astype(np.uint8), mode="P")
    image.putpalette(palette + [0] * (768 - len(palette)))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _result_payload(raw: torch.Tensor, mask: np.ndarray, **extra: Any) -> dict[str, Any]:
    values, counts = np.unique(mask, return_counts=True)
    return {
        "model": "TerraMind-v1-base",
        "output_modality": OUTPUT_MODALITY,
        "output_shape": list(raw.shape),
        "output_min": float(raw.min()),
        "output_max": float(raw.max()),
        "output_mean": float(raw.mean()),
        "class_histogram": {str(int(value)): int(count) for value, count in zip(values, counts)},
        "mask_is_provisional": True,
        "mask_png_base64": b64encode(_mask_png(mask)).decode("ascii"),
        **extra,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": "TerraMind-v1-base",
        "input_modality": OPTICAL_MODALITY,
        "input_modalities": [OPTICAL_MODALITY, SAR_MODALITY],
        "output_modality": OUTPUT_MODALITY,
        "optical_sar_ready": True,
        "sar_product": "Sentinel-1 GRD VV/VH",
        "device": "cuda",
        "dtype": "float32",
    }


@app.post("/predict")
async def predict(request: Request) -> dict[str, Any]:
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Request body is empty")
    optical, metadata = _load_optical(body, "single-image")
    try:
        async with INFERENCE_LOCK:
            with torch.inference_mode():
                output = MODEL({OPTICAL_MODALITY: optical}, timesteps=1, verbose=False)
            torch.cuda.synchronize()
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"TerraMind inference failed: {error}") from error
    raw = output[OUTPUT_MODALITY][0].detach().float().cpu()
    mask = raw.argmax(dim=0).to(torch.uint8).numpy()
    return _result_payload(
        raw,
        mask,
        input_shape=list(optical.shape),
        input_modality=OPTICAL_MODALITY,
        optical=metadata,
    )


@app.post("/predict-optical-sar")
async def predict_optical_sar(request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Request must be JSON: {error}") from error
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request JSON must be an object")

    optical_data = _decode_file(payload, "optical_base64")
    sar_data = _decode_file(payload, "sar_base64")
    optical_name = str(payload.get("optical_filename") or "optical-image")
    sar_name = str(payload.get("sar_filename") or "sentinel1-grd.tif")

    optical, optical_metadata = _load_optical(optical_data, optical_name)
    sar, sar_metadata = _load_sar_grd(sar_data, sar_name)

    try:
        async with INFERENCE_LOCK:
            with torch.inference_mode():
                output = MODEL(
                    {
                        OPTICAL_MODALITY: optical,
                        SAR_MODALITY: sar,
                    },
                    timesteps=1,
                    verbose=False,
                )
            torch.cuda.synchronize()
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"TerraMind Optical+SAR inference failed: {error}",
        ) from error

    raw = output[OUTPUT_MODALITY][0].detach().float().cpu()
    mask = raw.argmax(dim=0).to(torch.uint8).numpy()
    return _result_payload(
        raw,
        mask,
        input_modalities=[OPTICAL_MODALITY, SAR_MODALITY],
        input_shapes={"optical": list(optical.shape), "sar": list(sar.shape)},
        optical=optical_metadata,
        sar=sar_metadata,
        fusion="native TerraMind multimodal attention",
    )
