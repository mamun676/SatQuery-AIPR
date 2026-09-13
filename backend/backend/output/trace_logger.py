"""Observable execution trace logger (backend/output/trace_logger.py).

Only operational/execution information is recorded — never hidden
chain-of-thought or private reasoning.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any


class TraceLogger:
    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []

    def log(self, stage: str, message: str, data: dict[str, Any] | None = None) -> None:
        self._events.append(
            {
                "stage": stage,
                "timestamp": _dt.datetime.utcnow().isoformat() + "Z",
                "message": message,
                "data": data or {},
            }
        )

    def all(self) -> list[dict[str, Any]]:
        return self._events
