// Shared type definitions for the SatQuery AI pipeline.
// These mirror the schemas described in backend/api/schemas.py of the
// reference Python architecture (see /backend for the FastAPI reference
// implementation of the same contracts).

export type Modality = "optical" | "sar" | "multispectral" | "unknown";
export type RasterFormat = "GeoTIFF" | "TIFF" | "PNG" | "JPEG" | "unknown";
export type InputMode = "single_image" | "optical_sar" | "bitemporal";
export type FileRole = "single" | "optical" | "sar" | "t1" | "t2";

export type TaskType =
  | "vqa"
  | "caption"
  | "grounding"
  | "change_vqa"
  | "optical_sar";

export interface RasterMetadata {
  width: number | null;
  height: number | null;
  bandCount: number | null;
  crs: string | null;
  resolution: { x: number | null; y: number | null; unit: string | null };
  bbox: [number, number, number, number] | null; // minX, minY, maxX, maxY
  acquisitionDate: string | null;
  sensor: string | null;
  hasGeoTransform: boolean;
}

export interface UploadedFileMeta {
  id: string;
  originalName: string;
  storedPath: string;
  sizeBytes: number;
  format: RasterFormat;
  modality: Modality;
  role: FileRole;
  raster: RasterMetadata;
  warnings: string[];
}

export interface ValidationResult {
  valid: boolean;
  mode: InputMode | null;
  files: number;
  modalities: Modality[];
  format: RasterFormat | null;
  crs: string | null;
  errors: string[];
  warnings: string[];
  validationScore: number; // 1.0 = no issues, decreases per warning/error
}

export interface QueryIntent {
  task: TaskType;
  target: string | null;
  method: "rule-based" | "llm-assisted";
  rawQuery: string;
  coerced: boolean;
  coercionReason: string | null;
}

export interface ModelUsed {
  name: string;
  role: string;
  status: "used" | "fallback_used" | "unavailable";
  reason?: string;
}

export interface TraceEvent {
  stage: string;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface EvidenceFact {
  fact: string;
  value?: number | string | boolean | null;
  unit?: string;
  region?: string | null;
  extra?: Record<string, unknown>;
}

export interface GeoOverlay {
  type: "geojson" | "pixel";
  crs: string | null;
  boxes: Array<{
    pixelBox: [number, number, number, number]; // x0,y0,x1,y1
    geoBox?: [number, number, number, number]; // minX,minY,maxX,maxY
    label: string;
    score?: number;
  }>;
  maskPreviewUrl?: string | null;
  imageBounds?: [number, number, number, number] | null; // geo bbox for image overlay
  pixelDimensions?: { width: number; height: number };
  /**
   * Every derived raster the tool rendered for this job, exposed through
   * GET /api/files/masks/<jobId>/<name>. Purely additive: existing consumers
   * that only read `maskPreviewUrl` are unaffected.
   */
  previewUrls?: Array<{ name: string; url: string }>;
}

export interface Evidence {
  facts: EvidenceFact[];
  /**
   * Derived rasters rendered by the executed tool (source preview, masks),
   * served through GET /api/files/masks/<jobId>/<name>. Additive field: it is
   * always present alongside `overlay`, including when there is no overlay.
   */
  assets?: Array<{ name: string; url: string }>;
  statistics: Record<string, unknown>;
  overlay: GeoOverlay | null;
  toolAgreement: number; // 0..1
  modelProbability: number; // 0..1, heuristic separability-derived
}

export interface ConfidenceBreakdown {
  modelProbability: number;
  toolAgreement: number;
  validationScore: number;
  confidenceEstimate: number;
  formula: string;
}

export interface AnalysisResult {
  jobId: string;
  status: string;
  mode: InputMode | null;
  intent: QueryIntent | null;
  workflow: string | null;
  modelsUsed: ModelUsed[];
  parameters: Record<string, unknown>;
  evidence: Evidence | null;
  confidence: ConfidenceBreakdown | null;
  answer: string | null;
  warnings: string[];
  errorMessage: string | null;
  trace: TraceEvent[];
  /** True when the registry's primary model was unavailable and a fallback ran. */
  usedFallback?: boolean;
  /** Wall-clock duration of the run in milliseconds, when recorded. */
  durationMs?: number | null;
}
