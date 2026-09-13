"""LLM synthesis (backend/synthesis/llm_synthesizer.py).

CRITICAL RULE: the synthesizer may only restate facts already present in
evidence. Any numeric value in an LLM-polished answer that cannot be
grounded back to the evidence facts is discarded in favor of the
deterministic template answer produced by the tool layer.
"""
from __future__ import annotations

import os
import re
from typing import Any


def _extract_numbers(text: str) -> list[float]:
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", text)]


def _numbers_grounded(candidate: list[float], grounded: list[float], tol: float = 0.05) -> bool:
    for n in candidate:
        if not any(abs(g - n) <= max(tol, abs(g) * 0.02) for g in grounded):
            return False
    return True


def synthesize_answer(query: str, grounded_answer: str, facts: list[dict], confidence: dict, warnings: list[str]) -> str:
    grounded_numbers = _extract_numbers(grounded_answer)
    for f in facts:
        if isinstance(f.get("value"), (int, float)):
            grounded_numbers.append(float(f["value"]))

    final_answer = grounded_answer
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        try:
            import requests  # type: ignore

            resp = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                    "temperature": 0.2,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Rewrite the draft answer naturally. Do NOT invent, add, or change any number or fact.",
                        },
                        {"role": "user", "content": f'Question: "{query}"\nFacts: {facts}\nDraft: "{grounded_answer}"'},
                    ],
                },
                timeout=20,
            )
            if resp.ok:
                polished = resp.json()["choices"][0]["message"]["content"]
                if _numbers_grounded(_extract_numbers(polished), grounded_numbers):
                    final_answer = polished.strip()
        except Exception:  # noqa: BLE001 - synthesis must never crash the pipeline
            pass

    final_answer += f" (Confidence estimate: {confidence['confidence_estimate'] * 100:.0f}% — heuristic, not calibrated.)"
    if warnings:
        final_answer += f" Note: {len(warnings)} validation warning(s) recorded."
    return final_answer
