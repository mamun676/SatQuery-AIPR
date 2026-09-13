"""Model/tool registry (backend/agent/registry.py), YAML-driven from
backend/config/models.yaml. Provides the controller with the primary model
+ fallback for each task without hardcoding routing decisions throughout
the codebase.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import yaml

from backend.models.rscovlm import RSCoVLMWrapper
from backend.models.croma import CROMAWrapper
from backend.models.qwen3_vl import Qwen3VLWrapper

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "models.yaml")

_MODEL_CLASSES = {
    "rscovlm_7b_lora": RSCoVLMWrapper,
    "qwen2_5_vl_7b": None,  # external hosted fallback — integration point
    "qwen3_vl_8b": Qwen3VLWrapper,
    "croma_rscovlm_fusion": CROMAWrapper,
    "rule_based_fusion": None,  # implemented directly in tools/optical_sar_tool.py
    "pixel_change_detector": None,  # implemented directly in tools/change_tool.py
    "rule_based_raster_analyzer": None,  # implemented directly in tools/*.py fallbacks
}


@dataclass
class RegistryEntry:
    task: str
    tool: str
    primary_name: str
    fallback_name: Optional[str]
    allowed_parameters: list[str]


def load_registry() -> dict[str, RegistryEntry]:
    with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    registry: dict[str, RegistryEntry] = {}
    for task, cfg in raw.items():
        registry[task] = RegistryEntry(
            task=task,
            tool=cfg["tool"],
            primary_name=cfg["primary"],
            fallback_name=cfg.get("fallback"),
            allowed_parameters=cfg.get("allowed_parameters", []),
        )
    return registry


def resolve_model(model_name: str):
    """Instantiate a model wrapper by registry name, if it maps to a real class."""
    cls = _MODEL_CLASSES.get(model_name)
    return cls() if cls else None
