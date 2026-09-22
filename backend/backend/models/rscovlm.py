"""RSCoVLM model wrapper.

Remote inference client for the Kaggle-hosted RSCoVLM-7B model.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import requests


class RSCoVLMWrapper:
    name = "RSCoVLM-7B"
    role = "single-image VQA / captioning / grounding"

    def __init__(self) -> None:
        self.endpoint = os.environ.get("RSCOVLM_ENDPOINT", "").rstrip("/")

    def load(self) -> None:
        return None

    def health_check(self) -> dict:
        if not self.endpoint:
            return {
                "available": False,
                "reason": "RSCOVLM_ENDPOINT is not configured.",
            }

        try:
            response = requests.get(
                f"{self.endpoint}/health",
                timeout=30,
            )
            response.raise_for_status()

            data = response.json()

            return {
                "available": True,
                "remote": data,
            }

        except Exception as exc:
            return {
                "available": False,
                "reason": f"RSCoVLM endpoint unavailable: {exc}",
            }

    def predict(
        self,
        image_path: str,
        question: str,
        task: str,
    ) -> dict[str, Any]:

        if not self.endpoint:
            raise RuntimeError(
                "RSCOVLM_ENDPOINT is not configured."
            )

        path = Path(image_path)

        if not path.exists():
            raise FileNotFoundError(
                f"Image file not found: {image_path}"
            )

        image_bytes = path.read_bytes()

        image_base64 = base64.b64encode(
            image_bytes
        ).decode("utf-8")

        response = requests.post(
            f"{self.endpoint}/predict",
            json={
                "image": image_base64,
                "filename": path.name,
                "question": question,
                "task": task,
            },
            timeout=300,
        )

        response.raise_for_status()

        result = response.json()

        return {
            "answer": result.get("answer", ""),
            "facts": result.get("facts", []),
            "model_probability": result.get(
                "model_probability",
                0.85,
            ),
            "tool_agreement": result.get(
                "tool_agreement",
                1.0,
            ),
            "model": result.get(
                "model",
                self.name,
            ),
            "used_fallback": False,
        }

    def metadata(self) -> dict:
        return {
            "params": "7B",
            "adapter": "none",
            "model": "RSCoVLM-7B",
            "inference": "remote GPU",
        }