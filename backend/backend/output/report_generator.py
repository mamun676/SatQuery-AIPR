"""Downloadable report generator (backend/output/report_generator.py)."""
from __future__ import annotations

import datetime as _dt
from typing import Any


def generate_report_text(job_id: str, job: dict[str, Any]) -> str:
    lines = [
        "# SatQuery AI — Analysis Report",
        "",
        f"Generated: {_dt.datetime.utcnow().isoformat()}Z",
        f"Job ID: {job_id}",
        "",
        "## Query",
        job.get("query", ""),
        "",
        "## Detected Task & Workflow",
        f"Task: {job.get('intent', {}).get('task', 'n/a')}",
        f"Workflow: {job.get('workflow', 'n/a')}",
        "",
        "## Models / Tools Used",
    ]
    for m in job.get("models_used", []):
        lines.append(f"- {m['name']} ({m['role']}) — {m['status']}")
    lines += ["", "## Result", job.get("answer") or "(no answer generated)", "", "## Evidence"]
    evidence = job.get("evidence") or {}
    for f in evidence.get("facts", []):
        lines.append(f"- {f.get('fact')}: {f.get('value')}")
    lines += ["", "## Confidence Estimate"]
    confidence = job.get("confidence") or {}
    if confidence:
        lines.append(f"Confidence estimate: {confidence.get('confidence_estimate', 0) * 100:.1f}%")
        lines.append(f"Formula: {confidence.get('formula', '')}")
    lines += ["", "## Warnings"]
    warnings = job.get("warnings") or []
    lines += [f"- {w}" for w in warnings] if warnings else ["None"]
    lines += ["", "## Execution Trace"]
    for ev in job.get("trace", []):
        lines.append(f"- [{ev.get('timestamp')}] ({ev.get('stage')}) {ev.get('message')}")
    return "\n".join(lines)
