"""CROMA model wrapper (backend/models/croma.py) — optical-SAR joint
representation / fusion backbone.

INTEGRATION BOUNDARY: requires CROMA pretrained weights + a GPU inference
server. Falls back to `rule_based_fusion` in tools/optical_sar_tool.py when
unavailable (see registry.py fallback policy).
"""
from __future__ import annotations

import os


class CROMAWrapper:
    name = "CROMA"
    role = "optical-SAR joint representation / fusion backbone"

    def __init__(self) -> None:
        self.endpoint = os.environ.get("CROMA_ENDPOINT")

    def load(self) -> None:
        return None

    def health_check(self) -> dict:
        if self.endpoint:
            return {"available": True}
        return {"available": False, "reason": "CROMA weights/endpoint not provisioned (set CROMA_ENDPOINT)."}

    def predict(self, optical_path: str, sar_path: str) -> dict:
        if not self.endpoint:
            raise RuntimeError("CROMA endpoint not configured; use rule_based_fusion instead.")
        import requests  # type: ignore

        resp = requests.post(self.endpoint, json={"optical_path": optical_path, "sar_path": sar_path}, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def metadata(self) -> dict:
        return {"modality": "optical+SAR", "output": "joint embedding"}
