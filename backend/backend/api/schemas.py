"""Pydantic request/response schemas (backend/api/schemas.py)."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field

Modality = Literal["optical", "sar", "multispectral", "unknown"]
RasterFormat = Literal["GeoTIFF", "TIFF", "PNG", "JPEG", "unknown"]
InputMode = Literal["single_image", "optical_sar", "bitemporal"]
FileRole = Literal["single", "optical", "sar", "t1", "t2"]
TaskType = Literal["vqa", "caption", "grounding", "change_vqa", "optical_sar"]


class RasterMetadata(BaseModel):
    width: int | None = None
    height: int | None = None
    band_count: int | None = None
    crs: str | None = None
    resolution_x: float | None = None
    resolution_y: float | None = None
    bbox: list[float] | None = None
    acquisition_date: str | None = None
    sensor: str | None = None
    has_geo_transform: bool = False


class UploadedFileMeta(BaseModel):
    id: str
    original_name: str
    stored_path: str
    size_bytes: int
    format: RasterFormat
    modality: Modality
    role: FileRole
    raster: RasterMetadata
    warnings: list[str] = Field(default_factory=list)


class ValidationResult(BaseModel):
    valid: bool
    mode: InputMode | None
    files: int
    modalities: list[Modality]
    format: RasterFormat | None
    crs: str | None
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    validation_score: float = 1.0


class UploadResponse(BaseModel):
    upload_id: str
    validation: ValidationResult
    files: list[UploadedFileMeta]


class AnalyzeRequest(BaseModel):
    upload_id: str
    query: str


class QueryIntent(BaseModel):
    task: TaskType
    target: str | None
    method: Literal["rule-based", "llm-assisted"]
    raw_query: str
    coerced: bool = False
    coercion_reason: str | None = None


class ModelUsed(BaseModel):
    name: str
    role: str
    status: Literal["used", "fallback_used", "unavailable"]
    reason: str | None = None


class TraceEvent(BaseModel):
    stage: str
    timestamp: str
    message: str
    data: dict[str, Any] | None = None


class EvidenceFact(BaseModel):
    fact: str
    value: Any = None
    unit: str | None = None
    region: str | None = None
    extra: dict[str, Any] | None = None


class ConfidenceBreakdown(BaseModel):
    model_probability: float
    tool_agreement: float
    validation_score: float
    confidence_estimate: float
    formula: str


class AnalysisResult(BaseModel):
    job_id: str
    status: str
    mode: InputMode | None
    intent: QueryIntent | None
    workflow: str | None
    models_used: list[ModelUsed] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] | None = None
    confidence: ConfidenceBreakdown | None = None
    answer: str | None = None
    warnings: list[str] = Field(default_factory=list)
    error_message: str | None = None
    trace: list[TraceEvent] = Field(default_factory=list)
