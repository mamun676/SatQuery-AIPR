"""Agentic controller (backend/agent/controller.py) — the central
orchestration state machine.

Responsibilities: receive validated input + structured intent, select a
workflow/model from the registry, execute the corresponding tool, and
record an observable trace at every stage. This mirrors
src/server/satquery/controller.ts in the live Next.js implementation.
"""
from __future__ import annotations

from typing import Any, Optional

from backend.query_understanding.router import classify_intent
from backend.agent.registry import load_registry, resolve_model
from backend.output.trace_logger import TraceLogger
from backend.tools.vqa_tool import run_vqa
from backend.tools.caption_tool import run_caption
from backend.tools.grounding_tool import run_grounding
from backend.tools.change_tool import run_change
from backend.tools.optical_sar_tool import run_optical_sar
from backend.evidence.evidence_engine import build_evidence
from backend.evidence.confidence import compute_confidence


class AgentController:
    def __init__(self) -> None:
        self.registry = load_registry()

    def orchestrate(self, query: str, mode: Optional[str], files: list[dict], trace: TraceLogger) -> dict[str, Any]:
        trace.log("query_understanding", "Classifying natural-language query", {"query": query, "mode": mode})
        intent = classify_intent(query, mode)
        trace.log("query_understanding", f'Resolved task="{intent.task}" target="{intent.target}"', {})
        if intent.coerced:
            trace.log("query_understanding", f"Coerced: {intent.coercion_reason}", {})

        entry = self.registry[intent.task]
        trace.log("routing", f'Selected workflow "{entry.tool}" for task "{intent.task}"', {})

        primary = resolve_model(entry.primary_name)
        models_used = []
        used_fallback = False
        if primary is not None:
            health = primary.health_check()
        else:
            health = {"available": False, "reason": f"{entry.primary_name} has no local wrapper class configured."}

        if health["available"]:
            models_used.append({"name": primary.name, "role": primary.role, "status": "used"})
        else:
            models_used.append({"name": entry.primary_name, "role": entry.tool, "status": "unavailable", "reason": health.get("reason")})
            used_fallback = True
            if entry.fallback_name:
                models_used.append({"name": entry.fallback_name, "role": "fallback", "status": "fallback_used"})
                trace.log("fallback", f'Falling back to "{entry.fallback_name}" per registry policy.', {})

        trace.log("execution", f'Executing tool "{entry.tool}"', {})

        target = intent.target
        tool_output = self._execute_tool(intent.task, query, files, target, entry)

        trace.log("execution", f'Tool "{entry.tool}" completed.', {})

        evidence = build_evidence(tool_output.get("facts", []), tool_output, tool_output.get("tool_agreement", 1.0), tool_output.get("model_probability", 0.6))
        confidence = compute_confidence(tool_output.get("model_probability", 0.6), tool_output.get("tool_agreement", 1.0), 1.0)
        trace.log("evidence", "Built structured evidence.", {})
        trace.log("confidence", f"Confidence estimate: {confidence['confidence_estimate']}", {})

        return {
            "mode": mode,
            "intent": intent.__dict__,
            "workflow": entry.tool,
            "models_used": models_used,
            "used_fallback": used_fallback,
            "evidence": evidence,
            "confidence": confidence,
            "answer": tool_output.get("answer"),
            "warnings": [],
        }

    def _execute_tool(self, task: str, query: str, files: list[dict], target: Optional[str], entry) -> dict:
        # NOTE: this reference implementation focuses on interface fidelity.
        # Real raster loading (rasterio -> numpy arrays) is implemented in
        # gis/processor.py; wiring it end-to-end requires actual GeoTIFF
        # fixtures + rasterio/GDAL installed. The fully worked, end-to-end
        # numeric pipeline is implemented in the live Next.js app under
        # src/server/satquery/{tools,gis,controller}.ts.
        if task == "vqa":
            from backend.gis.processor import read_bands

            image_path = files[0]["stored_path"]

            try:
                data, profile = read_bands(image_path)

                band_stats = {
                    "width": int(data.shape[2]),
                    "height": int(data.shape[1]),
                    "band_count": int(data.shape[0]),
                    "target_coverage_percent": 0.0,
                }

                result = run_vqa(
                    image_path,
                    query,
                    target,
                    band_stats=band_stats,
                )

                result["raster"] = {
                    "width": int(data.shape[2]),
                    "height": int(data.shape[1]),
                    "band_count": int(data.shape[0]),
                    "crs": str(profile.get("crs")) if profile.get("crs") else None,
                }

                return result

            except Exception as exc:
                result = run_vqa(
                    image_path,
                    query,
                    target,
                    band_stats={"target_coverage_percent": 0.0},
                )

                result.setdefault("warnings", []).append(
                    f"Raster processing unavailable: {exc}"
                )

                return result
        if task == "caption":
            return run_caption(files[0]["stored_path"], composition={})
        if task == "grounding":
            import numpy as np

            return run_grounding(files[0]["stored_path"], target or "built_up", index_array=np.zeros((1, 1)))
        if task == "change_vqa":
            import numpy as np

            return run_change(files[0]["stored_path"], files[1]["stored_path"], query, target, np.zeros((1, 1)), np.zeros((1, 1)), res={})
        if task == "optical_sar":
            import numpy as np

            return run_optical_sar(files[0]["stored_path"], files[1]["stored_path"], target, np.zeros((1, 1)), np.zeros((1, 1)), res={})
        raise ValueError(f"Unhandled task: {task}")

