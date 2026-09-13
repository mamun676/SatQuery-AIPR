"""Qwen3-VL model wrapper (backend/models/qwen3_vl.py) — bi-temporal
change-VQA / language reasoning.

INTEGRATION BOUNDARY: requires access to a Qwen3-VL inference endpoint
(local vLLM/TGI server or hosted API). Falls back to the deterministic
pixel_change_detector tool when unavailable.
"""
from __future__ import annotations

import os


class Qwen3VLWrapper:
    name = "Qwen3-VL-8B"
    role = "bi-temporal change reasoning / language synthesis"

    def __init__(self) -> None:
        self.endpoint = os.environ.get("QWEN3VL_ENDPOINT")

    def load(self) -> None:
        return None

    def health_check(self) -> dict:
        if self.endpoint:
            return {"available": True}
        return {"available": False, "reason": "Qwen3-VL endpoint not provisioned (set QWEN3VL_ENDPOINT)."}

    def predict(self, t1_path: str, t2_path: str, question: str) -> dict:
        if not self.endpoint:
            raise RuntimeError("Qwen3-VL endpoint not configured; use pixel_change_detector instead.")
        import requests  # type: ignore

        resp = requests.post(self.endpoint, json={"t1_path": t1_path, "t2_path": t2_path, "question": question}, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def metadata(self) -> dict:
        return {"params": "8B", "role": "change-vqa language reasoning"}
