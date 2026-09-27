#!/usr/bin/env python3
"""Local-only Qwen model manager for SatQuery.

Runs Qwen3-4B on CPU for planning/synthesis and temporarily swaps the shared
A10G from RSCoVLM/TerraMind to Qwen3-VL for bi-temporal interpretation.
Every GPU swap restores the baseline services in a finally block.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import threading
import time
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.getenv("QWEN_MANAGER_HOST", "127.0.0.1")
PORT = int(os.getenv("QWEN_MANAGER_PORT", "8003"))
LLAMA_CLI = os.getenv("QWEN_LLAMA_CLI", "/opt/satquery/llama.cpp-v0.5.0/build/bin/llama-cli")
MTMD_CLI = os.getenv("QWEN_MTMD_CLI", "/opt/satquery/llama.cpp-v0.5.0/build/bin/llama-mtmd-cli")
PLANNER_MODEL = os.getenv("QWEN_PLANNER_MODEL", "/opt/satquery/models/qwen/qwen3-4b-gguf/Qwen3-4B-Q4_K_M.gguf")
VL_MODEL = os.getenv("QWEN_VL_MODEL", "/opt/satquery/models/qwen/qwen3-vl-8b-instruct-gguf/Qwen3VL-8B-Instruct-Q4_K_M.gguf")
VL_MMPROJ = os.getenv("QWEN_VL_MMPROJ", "/opt/satquery/models/qwen/qwen3-vl-8b-instruct-gguf/mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf")
MODEL_TIMEOUT = int(os.getenv("QWEN_MODEL_TIMEOUT_SECONDS", "720"))
CPU_TIMEOUT = int(os.getenv("QWEN_CPU_TIMEOUT_SECONDS", "240"))
MAX_BODY = int(os.getenv("QWEN_MANAGER_MAX_BODY_BYTES", str(2 * 1024 * 1024)))
ALLOWED_ROOTS = tuple(
    pathlib.Path(p).resolve()
    for p in os.getenv(
        "QWEN_ALLOWED_IMAGE_ROOTS",
        "/home/ec2-user/SatQuery-AIPR-production/frontend/storage:/home/ec2-user/SatQuery-AIPR/frontend/storage",
    ).split(":")
    if p.strip()
)
BASELINE_SERVICES = ("satquery-model.service", "satquery-terramind.service")
WEB_SERVICES = ("satquery-web.service", "caddy.service")

INFERENCE_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()
STATE: dict[str, Any] = {
    "busy": False,
    "operation": None,
    "queued": 0,
    "started_at": None,
    "last_error": None,
    "last_duration_seconds": None,
}


def _run(command: list[str], timeout: int, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env=env,
    )


def _systemctl(action: str, services: tuple[str, ...], *, ignore_dependencies: bool = False) -> None:
    command = ["systemctl", action]
    if ignore_dependencies:
        command.append("--job-mode=ignore-dependencies")
    command.extend(services)
    result = _run(command, 180)
    if result.returncode != 0:
        raise RuntimeError(f"systemctl {action} failed: {(result.stderr or result.stdout).strip()}")


def _service_active(service: str) -> bool:
    return _run(["systemctl", "is-active", "--quiet", service], 10).returncode == 0


def _gpu_used_mib() -> int | None:
    result = _run(
        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
        15,
    )
    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return None


def _wait_gpu_free(timeout: int = 120, threshold_mib: int = 1000) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        used = _gpu_used_mib()
        if used is not None and used < threshold_mib:
            return
        time.sleep(2)
    raise TimeoutError("GPU memory did not return below the safe threshold.")


def _url_healthy(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def _wait_baseline_health(timeout: int = 360) -> dict[str, bool]:
    deadline = time.monotonic() + timeout
    health = {"rscovlm": False, "terramind": False}
    while time.monotonic() < deadline:
        health["rscovlm"] = _url_healthy("http://127.0.0.1:8001/health")
        health["terramind"] = _url_healthy("http://127.0.0.1:8002/health")
        if all(health.values()):
            return health
        time.sleep(5)
    return health


def _restore_baseline() -> dict[str, Any]:
    errors: list[str] = []
    try:
        _systemctl("start", BASELINE_SERVICES)
    except Exception as exc:
        errors.append(str(exc))
    for service in WEB_SERVICES:
        if not _service_active(service):
            try:
                _systemctl("start", (service,))
            except Exception as exc:
                errors.append(str(exc))
    health = _wait_baseline_health()
    return {
        "services": {service: _service_active(service) for service in BASELINE_SERVICES + WEB_SERVICES},
        "health": health,
        "errors": errors,
        "ok": all(health.values()) and not errors,
    }


def _validate_image_path(raw: Any) -> pathlib.Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("Image path must be a non-empty string.")
    path = pathlib.Path(raw).resolve(strict=True)
    if not path.is_file():
        raise ValueError(f"Image does not exist: {path}")
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
        raise ValueError(f"Unsupported image extension: {path.suffix}")
    if not any(path == root or root in path.parents for root in ALLOWED_ROOTS):
        raise ValueError("Image path is outside the configured SatQuery storage roots.")
    return path


def _require_file(path: str, label: str) -> None:
    if not pathlib.Path(path).is_file():
        raise RuntimeError(f"{label} is missing: {path}")


def _extract_json(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            candidates.append(value)
    if not candidates:
        raise ValueError("Model output did not contain a valid JSON object.")
    return candidates[-1]


def _acquire(operation: str):
    class Guard:
        def __enter__(self):
            with STATE_LOCK:
                STATE["queued"] += 1
            INFERENCE_LOCK.acquire()
            with STATE_LOCK:
                STATE["queued"] -= 1
                STATE["busy"] = True
                STATE["operation"] = operation
                STATE["started_at"] = time.time()
                STATE["last_error"] = None
            self.started = time.monotonic()
            return self

        def __exit__(self, exc_type, exc, tb):
            with STATE_LOCK:
                STATE["busy"] = False
                STATE["operation"] = None
                STATE["started_at"] = None
                STATE["last_duration_seconds"] = round(time.monotonic() - self.started, 3)
                STATE["last_error"] = str(exc) if exc else None
            INFERENCE_LOCK.release()
            return False

    return Guard()


def _planner_prompt(query: str, mode: str) -> str:
    return (
        "You are SatQuery's planner. Return only one JSON object with keys task and target. "
        "task must be one of vqa, caption, grounding, change_vqa, optical_sar. "
        f"Input mode is {mode}. User query: {json.dumps(query)}"
    )


def _target_from_query(query: str) -> str | None:
    lower = query.lower()
    targets = {
        "water": ("water", "flood", "river", "lake", "reservoir", "wet"),
        "built_up": ("built-up", "built up", "urban", "building", "settlement", "infrastructure"),
        "vegetation": ("vegetation", "forest", "tree", "crop", "agricult", "green cover"),
        "road": ("road", "highway"),
        "bare_soil": ("bare soil", "barren"),
        "cloud": ("cloud",),
    }
    for target, words in targets.items():
        if any(word in lower for word in words):
            return target
    return None


def _enforce_route(raw_task: Any, query: str, mode: str) -> tuple[str, bool]:
    allowed = {"vqa", "caption", "grounding", "change_vqa", "optical_sar"}
    task = raw_task if isinstance(raw_task, str) and raw_task in allowed else "vqa"
    enforced = False
    if mode == "bitemporal" and task != "change_vqa":
        task, enforced = "change_vqa", True
    elif mode == "optical_sar" and task != "optical_sar":
        task, enforced = "optical_sar", True
    elif mode == "single_image" and task in {"change_vqa", "optical_sar"}:
        task, enforced = "vqa", True
    return task, enforced


def plan(payload: dict[str, Any]) -> dict[str, Any]:
    query = payload.get("query")
    mode = payload.get("mode")
    if not isinstance(query, str) or not query.strip() or len(query) > 4000:
        raise ValueError("query must be a non-empty string up to 4000 characters.")
    if mode not in {"single_image", "optical_sar", "bitemporal"}:
        raise ValueError("mode must be single_image, optical_sar, or bitemporal.")
    _require_file(LLAMA_CLI, "llama-cli")
    _require_file(PLANNER_MODEL, "Qwen3-4B model")
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = ""
    result = _run(
        [
            LLAMA_CLI,
            "-m",
            PLANNER_MODEL,
            "-ngl",
            "0",
            "-t",
            "4",
            "-c",
            "2048",
            "-n",
            "96",
            "--temp",
            "0",
            "--reasoning",
            "off",
            "--reasoning-budget",
            "0",
            "-st",
            "--simple-io",
            "--no-display-prompt",
            "-p",
            _planner_prompt(query.strip(), mode),
        ],
        CPU_TIMEOUT,
        env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Qwen planner failed: {result.stderr[-2000:]}")
    raw = _extract_json(result.stdout)
    task, route_enforced = _enforce_route(raw.get("task"), query, mode)
    raw_target = raw.get("target") if isinstance(raw.get("target"), str) else None
    target = _target_from_query(query) or raw_target
    return {
        "task": task,
        "target": target,
        "route_enforced": route_enforced,
        "planner_raw": raw,
        "model": "Qwen3-4B-Q4_K_M",
    }


def synthesize(payload: dict[str, Any]) -> dict[str, Any]:
    query = payload.get("query")
    grounded_answer = payload.get("grounded_answer")
    facts = payload.get("facts")
    if not isinstance(query, str) or not isinstance(grounded_answer, str) or not isinstance(facts, list):
        raise ValueError("query, grounded_answer, and facts are required.")
    if len(query) > 4000 or len(grounded_answer) > 12000 or len(json.dumps(facts)) > 100000:
        raise ValueError("Synthesis payload is too large.")
    _require_file(LLAMA_CLI, "llama-cli")
    _require_file(PLANNER_MODEL, "Qwen3-4B model")
    prompt = (
        "Rewrite the grounded remote-sensing answer as one clear paragraph. Do not add, remove, "
        "or change any number, coordinate, unit, or fact. Return only JSON as {\"text\":\"the rewritten paragraph\"}.\n"
        f"Question: {query}\nFacts: {json.dumps(facts, ensure_ascii=False)}\n"
        f"Grounded draft: {grounded_answer}"
    )
    env = os.environ.copy()
    env["CUDA_VISIBLE_DEVICES"] = ""
    result = _run(
        [
            LLAMA_CLI,
            "-m",
            PLANNER_MODEL,
            "-ngl",
            "0",
            "-t",
            "4",
            "-c",
            "4096",
            "-n",
            "320",
            "--temp",
            "0.1",
            "--reasoning",
            "off",
            "--reasoning-budget",
            "0",
            "-st",
            "--simple-io",
            "--no-display-prompt",
            "-p",
            prompt,
        ],
        CPU_TIMEOUT,
        env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Qwen synthesis failed: {result.stderr[-2000:]}")
    parsed = _extract_json(result.stdout)
    text = parsed.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Qwen synthesis returned invalid JSON or an empty answer.")
    return {"text": text.strip(), "model": "Qwen3-4B-Q4_K_M"}


def change(payload: dict[str, Any]) -> dict[str, Any]:
    t1 = _validate_image_path(payload.get("t1_path"))
    t2 = _validate_image_path(payload.get("t2_path"))
    if t1 == t2:
        raise ValueError("T1 and T2 must be different files.")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        prompt = "Compare T1 and T2 for remote-sensing change."
    if len(prompt) > 8000:
        raise ValueError("prompt is too long.")
    _require_file(MTMD_CLI, "llama-mtmd-cli")
    _require_file(VL_MODEL, "Qwen3-VL model")
    _require_file(VL_MMPROJ, "Qwen3-VL projector")

    qwen_prompt = (
        "Image 1 is T1 and image 2 is T2. " + prompt.strip() + " "
        "Return only valid JSON with keys summary, major_changes, possible_flood_change, confidence, limitations. "
        "Do not claim exact area; quantitative area and pixel counts are supplied separately by the GIS evidence layer. "
        "If the images are not spatially comparable, say so and do not invent changes."
    )

    inference: dict[str, Any] | None = None
    restore: dict[str, Any] | None = None
    try:
        _systemctl("stop", BASELINE_SERVICES, ignore_dependencies=True)
        _wait_gpu_free()
        result = _run(
            [
                MTMD_CLI, "-m", VL_MODEL, "--mmproj", VL_MMPROJ,
                "--image", f"{t1},{t2}", "-p", qwen_prompt,
                "-ngl", "99", "-mg", "0", "-t", "4", "-c", "4096", "-n", "384",
                "--image-min-tokens", "1024", "--image-max-tokens", "1024", "--temp", "0",
            ],
            MODEL_TIMEOUT,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Qwen3-VL failed: {result.stderr[-3000:]}")
        inference = {
            "model": "Qwen3-VL-8B-Instruct-Q4_K_M",
            "output": _extract_json(result.stdout),
            "runtime": {
                "stderr_tail": result.stderr[-2000:],
                "gpu_used_mib_after_inference": _gpu_used_mib(),
            },
        }
    finally:
        restore = _restore_baseline()
        if not restore["ok"]:
            with STATE_LOCK:
                STATE["last_error"] = f"Baseline restoration incomplete: {restore}"

    if inference is None:
        raise RuntimeError("Qwen3-VL inference completed without a result.")
    inference["restoration"] = restore
    return inference


def health() -> dict[str, Any]:
    files = {
        "llama_cli": pathlib.Path(LLAMA_CLI).is_file(),
        "mtmd_cli": pathlib.Path(MTMD_CLI).is_file(),
        "qwen3_4b": pathlib.Path(PLANNER_MODEL).is_file(),
        "qwen3_vl": pathlib.Path(VL_MODEL).is_file(),
        "qwen3_vl_mmproj": pathlib.Path(VL_MMPROJ).is_file(),
    }
    with STATE_LOCK:
        state = dict(STATE)
    return {
        "ok": all(files.values()),
        "files": files,
        "state": state,
        "gpu_used_mib": _gpu_used_mib(),
        "services": {service: _service_active(service) for service in BASELINE_SERVICES + WEB_SERVICES},
        "allowed_roots": [str(path) for path in ALLOWED_ROOTS],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "SatQueryQwenManager/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length.") from exc
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Request body is empty or too large.")
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("JSON request body must be an object.")
        return payload

    def do_GET(self) -> None:
        if self.path in {"/health", "/v1/status"}:
            result = health()
            self._send(HTTPStatus.OK if result["ok"] else HTTPStatus.SERVICE_UNAVAILABLE, result)
            return
        self._send(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:
        operations = {
            "/v1/plan": ("planner", plan),
            "/v1/synthesize": ("synthesis", synthesize),
            "/v1/change": ("qwen3-vl", change),
        }
        selected = operations.get(self.path)
        if selected is None:
            self._send(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        operation, function = selected
        try:
            payload = self._read_json()
            with _acquire(operation):
                result = function(payload)
            self._send(HTTPStatus.OK, result)
        except (ValueError, FileNotFoundError) as exc:
            self._send(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except subprocess.TimeoutExpired:
            self._send(HTTPStatus.GATEWAY_TIMEOUT, {"error": f"{operation} timed out."})
        except Exception as exc:
            self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"SatQuery Qwen manager listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
