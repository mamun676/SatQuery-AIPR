"""API routes for SatQuery AI."""

from __future__ import annotations

from PIL import Image

import json
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse

from backend.api.schemas import AnalyzeRequest, UploadResponse
from backend.validator.input_validator import (
    validate_files,
    RawUploadFile,
)

from backend.agent.controller import AgentController
from backend.output.trace_logger import TraceLogger
from backend.output.report_generator import generate_report_text


router = APIRouter()


# -------------------------------------------------------------------
# Reference in-memory stores
# -------------------------------------------------------------------
_UPLOADS: dict[str, dict[str, Any]] = {}
_JOBS: dict[str, dict[str, Any]] = {}


# -------------------------------------------------------------------
# Upload directory
# -------------------------------------------------------------------
UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# -------------------------------------------------------------------
# Role parser
# -------------------------------------------------------------------
def _parse_roles(roles: str | None, file_count: int) -> list[str]:
    """
    Parse optional roles supplied by the frontend/Swagger.

    Supported examples:

        optical
        sar
        optical,sar
        ["optical", "sar"]
        t1,t2

    If roles are not provided, all files default to "single".
    """

    if not roles:
        return ["single"] * file_count

    value = roles.strip()

    parsed: list[str]

    # Try JSON first.
    try:
        json_value = json.loads(value)

        if isinstance(json_value, list):
            parsed = [str(item).strip().lower() for item in json_value]
        else:
            parsed = [str(json_value).strip().lower()]

    except json.JSONDecodeError:
        parsed = [
            item.strip().lower()
            for item in value.split(",")
            if item.strip()
        ]

    allowed_roles = {"single", "optical", "sar", "t1", "t2"}

    if any(role not in allowed_roles for role in parsed):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid role. Allowed roles: "
                "single, optical, sar, t1, t2."
            ),
        )

    if len(parsed) != file_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Number of roles ({len(parsed)}) must match "
                f"number of uploaded files ({file_count})."
            ),
        )

    return parsed


# -------------------------------------------------------------------
# Upload endpoint
# -------------------------------------------------------------------


@router.get("/files/{file_path:path}")
async def serve_generated_file(file_path: str):
    """Serve generated preview/mask files safely."""
    base_dir = (Path(__file__).resolve().parents[1] / "uploads").resolve()
    target = (base_dir / file_path).resolve()

    if not str(target).startswith(str(base_dir)):
        return {"status": "error", "error": "Invalid file path"}

    if not target.exists() or not target.is_file():
        return {"status": "error", "error": "File not found"}

    return FileResponse(target)

@router.post("/upload", response_model=UploadResponse)
async def upload(
    files: list[UploadFile] = File(...),
    roles: str | None = Form(None),
) -> Any:

    if not files:
        raise HTTPException(
            status_code=400,
            detail="No files provided.",
        )

    if len(files) > 2:
        raise HTTPException(
            status_code=400,
            detail="At most 2 files are supported per request.",
        )

    parsed_roles = _parse_roles(roles, len(files))

    raw_files: list[RawUploadFile] = []
    stored_paths: list[str] = []

    # ---------------------------------------------------------------
    # Save uploaded files
    # ---------------------------------------------------------------
    for index, uploaded_file in enumerate(files):

        content = await uploaded_file.read()

        if not content:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Uploaded file is empty: "
                    f"{uploaded_file.filename}"
                ),
            )

        original_name = uploaded_file.filename or "unnamed"

        suffix = Path(original_name).suffix.lower()

        file_id = str(uuid.uuid4())

        stored_name = f"{file_id}{suffix}"

        stored_path = UPLOAD_DIR / stored_name

        stored_path.write_bytes(content)

        stored_paths.append(str(stored_path))

        raw_files.append(
            RawUploadFile(
                original_name=original_name,
                content=content,
                role=parsed_roles[index],
            )
        )

    # ---------------------------------------------------------------
    # Validate files using actual stored paths
    # ---------------------------------------------------------------
    file_metas, validation = validate_files(
        raw_files,
        stored_paths=stored_paths,
    )

    # ---------------------------------------------------------------
    # Create upload ID
    # ---------------------------------------------------------------
    upload_id = str(uuid.uuid4())

    _UPLOADS[upload_id] = {
        "files": file_metas,
        "validation": validation,
    }

    return {
        "upload_id": upload_id,
        "validation": validation,
        "files": file_metas,
    }


# -------------------------------------------------------------------
# Analyze endpoint
# -------------------------------------------------------------------
@router.post("/analyze")
async def analyze(req: AnalyzeRequest) -> Any:

    upload = _UPLOADS.get(req.upload_id)

    if not upload:
        raise HTTPException(
            status_code=404,
            detail=f"Upload {req.upload_id} not found.",
        )

    if not upload["validation"]["valid"]:
        raise HTTPException(
            status_code=422,
            detail="Upload failed validation; cannot analyze.",
        )

    job_id = str(uuid.uuid4())

    trace = TraceLogger()
    controller = AgentController()

    try:

        controller_output = controller.orchestrate(
            query=req.query,
            mode=upload["validation"]["mode"],
            files=upload["files"],
            trace=trace,
        )

        # -----------------------------------------------------------
        # Generate browser-viewable preview for the analyzed image
        # -----------------------------------------------------------
        try:
            preview_dir = UPLOAD_DIR / "masks" / job_id
            preview_dir.mkdir(parents=True, exist_ok=True)

            source_path = Path(upload["files"][0]["stored_path"])

            with Image.open(source_path) as src:
                img = src.convert("RGB")
                img.thumbnail((1600, 1600))

                preview_path = preview_dir / "preview.png"
                img.save(preview_path, format="PNG", optimize=True)

                # VQA does not produce a segmentation mask.
                # Keep mask transparent instead of inventing detections.
                mask = Image.new("RGBA", img.size, (0, 0, 0, 0))
                mask_path = preview_dir / "mask.png"
                mask.save(mask_path, format="PNG")

            evidence = controller_output.setdefault("evidence", {})
            overlay = evidence.setdefault("overlay", {})

            overlay["maskPreviewUrl"] = (
                f"/api/files/masks/{job_id}/preview.png"
            )
            overlay["maskUrl"] = (
                f"/api/files/masks/{job_id}/mask.png"
            )

            trace.log(
                "gis",
                "Generated preview files for job.",
                {
                    "preview": str(preview_path),
                    "mask": str(mask_path),
                },
            )

        except Exception as exc:
            controller_output.setdefault("warnings", [])
            controller_output["warnings"].append(
                f"Preview generation failed: {exc}"
            )

        _JOBS[job_id] = {
            "status": "completed",
            "query": req.query,
            **controller_output,
            "trace": trace.all(),
        }

    except Exception as exc:

        trace.log(
            "error",
            f"Analysis failed: {exc}",
        )

        _JOBS[job_id] = {
            "status": "failed",
            "query": req.query,
            "error_message": str(exc),
            "trace": trace.all(),
        }

    return {
        "job_id": job_id,
        "status": _JOBS[job_id]["status"],
    }


# -------------------------------------------------------------------
# Job status
# -------------------------------------------------------------------
@router.get("/status/{job_id}")
async def status(job_id: str) -> Any:

    job = _JOBS.get(job_id)

    if not job:
        raise HTTPException(
            status_code=404,
            detail=f"Job {job_id} not found.",
        )

    return {
        "job_id": job_id,
        "status": job["status"],
    }


# -------------------------------------------------------------------
# Analysis result
# -------------------------------------------------------------------
@router.get("/result/{job_id}")
async def result(job_id: str) -> Any:

    job = _JOBS.get(job_id)

    if not job:
        raise HTTPException(
            status_code=404,
            detail=f"Job {job_id} not found.",
        )

    return {
        "job_id": job_id,
        **job,
    }


# -------------------------------------------------------------------
# Report
# -------------------------------------------------------------------
@router.get("/report/{job_id}")
async def report(job_id: str) -> Any:

    job = _JOBS.get(job_id)

    if not job:
        raise HTTPException(
            status_code=404,
            detail=f"Job {job_id} not found.",
        )

    return {
        "report": generate_report_text(
            job_id,
            job,
        ),
    }
