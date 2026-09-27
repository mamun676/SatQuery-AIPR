"""TerraMind Optical+SAR model wrapper for the reference Python backend.

The deployed Next.js application calls the same local endpoint from its
TypeScript wrapper. Quantitative GIS evidence remains deterministic.
"""
from __future__ import annotations

from base64 import b64encode
import os
from pathlib import Path


class TerraMindOpticalSarWrapper:
    name = "TerraMind-v1-base"
    role = "native optical + Sentinel-1 GRD multimodal LULC inference"

    def __init__(self) -> None:
        self.endpoint = os.environ.get("TERRAMIND_ENDPOINT")

    def load(self) -> None:
        return None

    def health_check(self) -> dict:
        if not self.endpoint:
            return {"available": False, "reason": "TERRAMIND_ENDPOINT is not configured."}
        import requests  # type: ignore

        try:
            response = requests.get(self.endpoint.rstrip("/") + "/health", timeout=30)
            response.raise_for_status()
            data = response.json()
            modalities = set(data.get("input_modalities") or [])
            available = (
                data.get("status") == "ok"
                and data.get("device") == "cuda"
                and data.get("optical_sar_ready") is True
                and {"untok_sen2rgb@224", "untok_sen1grd@224"}.issubset(modalities)
            )
            return {"available": available, "reason": None if available else "Optical+SAR adapters are not ready."}
        except Exception as error:
            return {"available": False, "reason": str(error)}

    def predict(self, optical_path: str, sar_path: str) -> dict:
        if not self.endpoint:
            raise RuntimeError("TERRAMIND_ENDPOINT is not configured.")
        import requests  # type: ignore

        optical = Path(optical_path).read_bytes()
        sar = Path(sar_path).read_bytes()
        response = requests.post(
            self.endpoint.rstrip("/") + "/predict-optical-sar",
            json={
                "optical_base64": b64encode(optical).decode("ascii"),
                "optical_filename": Path(optical_path).name,
                "sar_base64": b64encode(sar).decode("ascii"),
                "sar_filename": Path(sar_path).name,
            },
            timeout=600,
        )
        response.raise_for_status()
        return response.json()

    def metadata(self) -> dict:
        return {
            "input_modalities": ["untok_sen2rgb@224", "untok_sen1grd@224"],
            "sar_bands": ["VV", "VH"],
            "output_modality": "tok_lulc@224",
        }
