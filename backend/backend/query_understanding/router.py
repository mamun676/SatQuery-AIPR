"""Query understanding router (backend/query_understanding/router.py).

Deterministic rules handle obvious cases; an optional LLM-assisted path can
be wired in via `llm_classifier` for ambiguous phrasing, but its output is
always validated against TASK_VOCAB — it can never introduce a new workflow.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from backend.query_understanding.prompts import TASK_VOCAB

TARGET_KEYWORDS = {
    "water": ["water", "flood", "river", "lake", "reservoir", "wet"],
    "built_up": ["built-up", "built up", "urban", "building", "buildings", "settlement", "infrastructure"],
    "vegetation": ["vegetation", "forest", "tree", "trees", "crop", "crops", "agricult", "green cover"],
    "road": ["road", "roads", "highway"],
    "bare_soil": ["bare soil", "barren"],
    "cloud": ["cloud", "clouds"],
}

CHANGE_WORDS = ["change", "changed", "increase", "increased", "decrease", "decreased", "compare", "difference", "between these", "over time"]
OPTICAL_SAR_WORDS = ["sar", "radar", "backscatter", "fuse", "fusion", "optical and sar", "sentinel-1"]
CAPTION_WORDS = ["describe", "caption", "summary", "summarize", "what is in this image", "what does this image show"]
GROUNDING_WORDS = ["locate", "find the", "where is", "where are", "bounding box", "detect the", "point out", "highlight the"]


@dataclass
class QueryIntent:
    task: str
    target: Optional[str]
    method: str
    raw_query: str
    coerced: bool = False
    coercion_reason: Optional[str] = None


def _extract_target(query: str) -> Optional[str]:
    lower = query.lower()
    for target, keywords in TARGET_KEYWORDS.items():
        if any(k in lower for k in keywords):
            return target
    return None


def _rule_based_task(query: str, mode: Optional[str]) -> str:
    lower = query.lower()
    if mode == "bitemporal" and any(w in lower for w in CHANGE_WORDS):
        return "change_vqa"
    if any(w in lower for w in CHANGE_WORDS) and mode != "optical_sar":
        return "change_vqa"
    if mode == "optical_sar" or any(w in lower for w in OPTICAL_SAR_WORDS):
        return "optical_sar"
    if any(w in lower for w in CAPTION_WORDS):
        return "caption"
    if any(w in lower for w in GROUNDING_WORDS):
        return "grounding"
    return "vqa"


def _coerce_for_mode(task: str, mode: Optional[str]) -> tuple[str, bool, Optional[str]]:
    if mode == "bitemporal" and task != "change_vqa":
        return "change_vqa", True, f'Task "{task}" not supported for bi-temporal input; coerced to "change_vqa".'
    if mode == "optical_sar" and task != "optical_sar":
        return "optical_sar", True, f'Task "{task}" not supported for optical+SAR input; coerced to "optical_sar".'
    if mode == "single_image" and task in ("change_vqa", "optical_sar"):
        return "vqa", True, f'Task "{task}" requires two images; coerced to "vqa" for single-image input.'
    return task, False, None


LlmClassifier = Callable[[str, Optional[str]], Optional[dict]]


def classify_intent(query: str, mode: Optional[str], llm_classifier: Optional[LlmClassifier] = None) -> QueryIntent:
    query = query.strip()
    rule_task = _rule_based_task(query, mode)
    rule_target = _extract_target(query)

    task, target, method = rule_task, rule_target, "rule-based"

    if rule_task == "vqa" and not rule_target and llm_classifier is not None:
        llm_result = llm_classifier(query, mode)
        if llm_result and llm_result.get("task") in TASK_VOCAB:
            task = llm_result["task"]
            target = llm_result.get("target")
            method = "llm-assisted"

    final_task, coerced, reason = _coerce_for_mode(task, mode)
    return QueryIntent(task=final_task, target=target, method=method, raw_query=query, coerced=coerced, coercion_reason=reason)
