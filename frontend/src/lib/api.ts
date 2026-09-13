// ═════════════════════════════════════════════════════════════════════════
// SatQuery AI — API client
//
// The backend contract is fixed and must not drift:
//   POST /api/upload            multipart: files[] + roles (JSON array)
//   POST /api/analyze           { upload_id | uploadId, query }
//   GET  /api/status/{job_id}
//   GET  /api/result/{job_id}
//   GET  /api/report/{job_id}   text/markdown
//   GET  /api/health
//
// Two implementations of that contract exist in this project: the FastAPI
// service (snake_case payloads, default origin http://127.0.0.1:8001) and the
// in-repo Next.js route handlers under src/app/api (camelCase payloads).
// Every reader below accepts BOTH spellings, and /api/analyze is attempted
// snake_case first (the historical, proven wire format) with a camelCase
// retry, so either backend works without renaming a single backend field.
// ═════════════════════════════════════════════════════════════════════════
import type {
  AnalysisResult,
  ConfidenceBreakdown,
  Evidence,
  EvidenceFact,
  FileRole,
  GeoOverlay,
  InputMode,
  ModelUsed,
  QueryIntent,
  RasterFormat,
  RasterMetadata,
  TraceEvent,
  UploadedFileMeta,
  ValidationResult,
} from "@/server/satquery/types";

const DEFAULT_API_BASE = "http://127.0.0.1:8001";

function resolveApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_SATQUERY_API_BASE;
  if (raw === undefined) return DEFAULT_API_BASE;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "" || trimmed.toLowerCase() === "same-origin") return "";
  return trimmed;
}

/** Resolved backend origin. Empty string means "same origin as this app". */
export const API_BASE = resolveApiBase();

/** Human-readable origin for the mission bar / diagnostics. */
export const API_BASE_LABEL = API_BASE === "" ? "same-origin /api" : API_BASE;

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * The backend hands back mask/preview URLs as app-relative paths
 * (`/api/files/masks/{jobId}/mask.png`). When the API lives on another origin
 * those must be re-based, or <img>/Leaflet will fetch them from the Next.js
 * dev server and 404.
 */
export function resolveAssetUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;
  if (/^(?:https?:|blob:|data:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return `${API_BASE}${trimmed}`;
  return `${API_BASE}/${trimmed}`;
}

// ── errors ───────────────────────────────────────────────────────────────
export type ApiFailureKind =
  | "network"
  | "timeout"
  | "http"
  | "payload"
  | "not_found"
  | "rejected"
  | "aborted";

/** Error carrying enough context for the UI to render an honest recovery hint. */
export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly hint: string;
  readonly detail: string | null;

  constructor(
    kind: ApiFailureKind,
    message: string,
    opts: { status?: number | null; hint?: string; detail?: string | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.detail = opts.detail ?? null;
    this.hint = opts.hint ?? defaultHint(kind, this.status);
  }
}

function defaultHint(kind: ApiFailureKind, status: number | null): string {
  switch (kind) {
    case "network":
      return `Could not reach the analysis service at ${API_BASE_LABEL}. Start the backend, then retry.`;
    case "timeout":
      return "The service did not respond in time. Large rasters take longer — retry, or reduce image size.";
    case "not_found":
      return "The requested job or artefact no longer exists on the server.";
    case "rejected":
      return "The service rejected the request. Review the validation report above.";
    case "aborted":
      return "Request cancelled.";
    case "payload":
      return "The service replied with a body this client could not read.";
    default:
      return status && status >= 500
        ? "The analysis service failed internally. Check its logs for the stack trace."
        : "The service refused the request.";
  }
}

export function describeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new ApiError("aborted", "Request cancelled");
  }
  if (err instanceof Error) {
    return new ApiError("network", err.message || "Network request failed");
  }
  return new ApiError("network", "Unknown network failure");
}

// ── narrowing helpers (keeps this file free of `any`) ─────────────────────
type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asRec(v: unknown): Rec | null {
  return isRec(v) ? v : null;
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}
function asStrArr(v: unknown): string[] {
  return asArr(v).filter((x): x is string => typeof x === "string");
}

/** Reads the first present key — the whole snake_case/camelCase bridge. */
function pick(obj: Rec | null, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}
function pickAny(obj: Rec | null, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  return undefined;
}

// ── fetch plumbing ───────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 20_000;
const ANALYZE_TIMEOUT_MS = 15 * 60_000; // /api/analyze runs the pipeline inline

/**
 * Combines an external signal with a timeout. Written by hand instead of
 * AbortSignal.any() so the bundle stays compatible with older runtimes.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const ctrl = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    ctrl.abort();
  }, ms);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => expired,
    done: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    },
  };
}

interface RawResponse {
  status: number;
  ok: boolean;
  json: unknown;
  text: string;
}

/** Tolerant body reader: JSON when possible, raw text otherwise. */
async function readBody(res: Response): Promise<RawResponse> {
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  if (text !== "") {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: res.status, ok: res.ok, json, text };
}

/** Extracts the message from `{error}` (Next), `{detail}` (FastAPI) or `{message}`. */
function serverMessage(body: RawResponse): string | null {
  const rec = asRec(body.json);
  if (rec) {
    const direct = asStr(pick(rec, "error", "detail", "message", "error_message", "errorMessage"));
    if (direct) return direct;
    // FastAPI validation errors: detail is an array of {loc,msg,type}
    const detailArr = asArr(rec.detail);
    if (detailArr.length > 0) {
      const msgs = detailArr
        .map((d) => asStr(pick(asRec(d), "msg", "message")))
        .filter((m): m is string => m !== null);
      if (msgs.length > 0) return msgs.join("; ");
    }
  }
  const t = body.text.trim();
  if (t !== "" && t.length < 400 && !t.startsWith("<")) return t;
  return null;
}

function failFromBody(body: RawResponse, fallback: string): ApiError {
  const msg = serverMessage(body);
  const kind: ApiFailureKind =
    body.status === 404 ? "not_found" : body.status === 422 ? "rejected" : "http";
  return new ApiError(kind, msg ?? fallback, { status: body.status, detail: msg });
}

async function request(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RawResponse> {
  const gate = withTimeout(signal, timeoutMs);
  try {
    const res = await fetch(apiUrl(path), { ...init, signal: gate.signal, cache: "no-store" });
    return await readBody(res);
  } catch (err) {
    if (gate.timedOut()) {
      throw new ApiError("timeout", `Timed out after ${Math.round(timeoutMs / 1000)}s on ${path}`);
    }
    if (signal?.aborted) throw new ApiError("aborted", "Request cancelled");
    throw describeError(err);
  } finally {
    gate.done();
  }
}

// ── normalizers ──────────────────────────────────────────────────────────
const FORMATS: RasterFormat[] = ["GeoTIFF", "TIFF", "PNG", "JPEG", "unknown"];

function normFormat(v: unknown): RasterFormat {
  const s = asStr(v);
  if (!s) return "unknown";
  const hit = FORMATS.find((f) => f.toLowerCase() === s.toLowerCase());
  return hit ?? "unknown";
}

function normModality(v: unknown): UploadedFileMeta["modality"] {
  const s = (asStr(v) ?? "").toLowerCase();
  if (s === "optical" || s === "sar" || s === "multispectral") return s;
  return "unknown";
}

function normRole(v: unknown, fallback: FileRole): FileRole {
  const s = (asStr(v) ?? "").toLowerCase();
  if (s === "single" || s === "optical" || s === "sar" || s === "t1" || s === "t2") return s;
  return fallback;
}

function normMode(v: unknown): InputMode | null {
  const s = (asStr(v) ?? "").toLowerCase();
  if (s === "single_image" || s === "optical_sar" || s === "bitemporal") return s;
  return null;
}

function normBbox(v: unknown): [number, number, number, number] | null {
  const arr = asArr(v);
  if (arr.length !== 4) return null;
  const nums = arr.map(asNum);
  if (nums.some((n) => n === null)) return null;
  return [nums[0] as number, nums[1] as number, nums[2] as number, nums[3] as number];
}

function normRaster(v: unknown): RasterMetadata {
  const r = asRec(v);
  const res = asRec(pick(r, "resolution"));
  return {
    width: asNum(pick(r, "width")),
    height: asNum(pick(r, "height")),
    bandCount: asNum(pick(r, "bandCount", "band_count", "bands")),
    crs: asStr(pick(r, "crs", "CRS", "projection")),
    resolution: {
      x: asNum(pick(res, "x")),
      y: asNum(pick(res, "y")),
      unit: asStr(pick(res, "unit", "units")),
    },
    bbox: normBbox(pick(r, "bbox", "bounds")),
    acquisitionDate: asStr(pick(r, "acquisitionDate", "acquisition_date")),
    sensor: asStr(pick(r, "sensor")),
    hasGeoTransform: asBool(pick(r, "hasGeoTransform", "has_geo_transform")) ?? false,
  };
}

export interface UploadFileSummary {
  id: string;
  originalName: string;
  format: RasterFormat;
  modality: UploadedFileMeta["modality"];
  role: FileRole;
  raster: RasterMetadata;
  warnings: string[];
  sizeBytes: number | null;
}

function normUploadFile(v: unknown, index: number): UploadFileSummary {
  const r = asRec(v);
  return {
    id: asStr(pick(r, "id", "file_id", "fileId")) ?? `file-${index}`,
    originalName:
      asStr(pick(r, "originalName", "original_name", "filename", "name")) ?? `file-${index + 1}`,
    format: normFormat(pick(r, "format")),
    modality: normModality(pick(r, "modality")),
    role: normRole(pick(r, "role"), "single"),
    raster: normRaster(pick(r, "raster", "metadata")),
    warnings: asStrArr(pick(r, "warnings")),
    sizeBytes: asNum(pick(r, "sizeBytes", "size_bytes", "size")),
  };
}

function normValidation(v: unknown): ValidationResult {
  const r = asRec(v);
  const modalities = asStrArr(pick(r, "modalities")).map(normModality);
  return {
    valid: asBool(pick(r, "valid", "is_valid", "isValid")) ?? false,
    mode: normMode(pick(r, "mode", "input_mode", "inputMode")),
    files: asNum(pick(r, "files", "file_count", "fileCount")) ?? 0,
    modalities,
    format: pick(r, "format") === undefined ? null : normFormat(pick(r, "format")),
    crs: asStr(pick(r, "crs")),
    errors: asStrArr(pick(r, "errors")),
    warnings: asStrArr(pick(r, "warnings")),
    validationScore: asNum(pick(r, "validationScore", "validation_score")) ?? 0,
  };
}

function normIntent(v: unknown): QueryIntent | null {
  const r = asRec(v);
  if (!r) return null;
  const task = (asStr(pick(r, "task")) ?? "vqa").toLowerCase();
  const known = ["vqa", "caption", "grounding", "change_vqa", "optical_sar"];
  const method = asStr(pick(r, "method")) === "llm-assisted" ? "llm-assisted" : "rule-based";
  return {
    task: (known.includes(task) ? task : "vqa") as QueryIntent["task"],
    target: asStr(pick(r, "target")),
    method,
    rawQuery: asStr(pick(r, "rawQuery", "raw_query", "query")) ?? "",
    coerced: asBool(pick(r, "coerced")) ?? false,
    coercionReason: asStr(pick(r, "coercionReason", "coercion_reason")),
  };
}

function normModels(v: unknown): ModelUsed[] {
  return asArr(v).map((m, i) => {
    const r = asRec(m);
    if (!r) return { name: `model-${i + 1}`, role: "unknown", status: "unavailable" as const };
    const rawStatus = (asStr(pick(r, "status")) ?? "").toLowerCase();
    const status: ModelUsed["status"] =
      rawStatus === "used"
        ? "used"
        : rawStatus === "fallback_used" || rawStatus === "fallback"
          ? "fallback_used"
          : "unavailable";
    const out: ModelUsed = {
      name: asStr(pick(r, "name", "model", "model_name", "modelName")) ?? `model-${i + 1}`,
      role: asStr(pick(r, "role", "purpose")) ?? "unspecified",
      status,
    };
    const reason = asStr(pick(r, "reason", "error", "message"));
    if (reason) out.reason = reason;
    return out;
  });
}

function normFacts(v: unknown): EvidenceFact[] {
  return asArr(v)
    .map((f): EvidenceFact | null => {
      const r = asRec(f);
      if (!r) return null;
      const name = asStr(pick(r, "fact", "name", "key"));
      if (!name) return null;
      const out: EvidenceFact = { fact: name };
      const rawValue = pickAny(r, "value", "val");
      if (
        typeof rawValue === "number" ||
        typeof rawValue === "string" ||
        typeof rawValue === "boolean"
      ) {
        out.value = rawValue;
      } else if (rawValue === null) {
        out.value = null;
      }
      const unit = asStr(pick(r, "unit", "units"));
      if (unit) out.unit = unit;
      const region = asStr(pick(r, "region"));
      if (region) out.region = region;
      const extra = asRec(pick(r, "extra", "meta"));
      if (extra) out.extra = extra;
      return out;
    })
    .filter((f): f is EvidenceFact => f !== null);
}

function normOverlay(v: unknown): GeoOverlay | null {
  const r = asRec(v);
  if (!r) return null;
  const rawBoxes = asArr(pick(r, "boxes", "regions"));
  const boxes = rawBoxes
    .map((b, i) => {
      const br = asRec(b);
      if (!br) return null;
      const pixelBox = normBbox(pick(br, "pixelBox", "pixel_box", "bbox", "box"));
      if (!pixelBox) return null;
      const geoBox = normBbox(pick(br, "geoBox", "geo_box"));
      const score = asNum(pick(br, "score", "confidence"));
      const entry: GeoOverlay["boxes"][number] = {
        pixelBox,
        label: asStr(pick(br, "label", "name", "class")) ?? `region ${i + 1}`,
      };
      if (geoBox) entry.geoBox = geoBox;
      if (score !== null) entry.score = score;
      return entry;
    })
    .filter((b): b is GeoOverlay["boxes"][number] => b !== null);

  const dims = asRec(pick(r, "pixelDimensions", "pixel_dimensions"));
  const width = asNum(pick(dims, "width"));
  const height = asNum(pick(dims, "height"));
  const typeStr = (asStr(pick(r, "type")) ?? "").toLowerCase();

  return {
    type: typeStr === "geojson" ? "geojson" : "pixel",
    crs: asStr(pick(r, "crs")),
    boxes,
    maskPreviewUrl: asStr(pick(r, "maskPreviewUrl", "mask_preview_url", "mask_url")),
    imageBounds: normBbox(pick(r, "imageBounds", "image_bounds")),
    pixelDimensions: width !== null && height !== null ? { width, height } : undefined,
  };
}

function normEvidence(v: unknown): Evidence | null {
  const r = asRec(v);
  if (!r) return null;
  return {
    facts: normFacts(pick(r, "facts")),
    statistics: asRec(pick(r, "statistics", "stats")) ?? {},
    overlay: normOverlay(pick(r, "overlay", "geo_overlay", "geoOverlay")),
    toolAgreement: asNum(pick(r, "toolAgreement", "tool_agreement")) ?? 0,
    modelProbability: asNum(pick(r, "modelProbability", "model_probability")) ?? 0,
  };
}

const CONFIDENCE_FORMULA =
  "confidence_estimate = 0.5*model_probability + 0.3*tool_agreement + 0.2*validation_score (uncalibrated heuristic)";

function normConfidence(v: unknown): ConfidenceBreakdown | null {
  const r = asRec(v);
  if (!r) return null;
  const modelProbability = asNum(pick(r, "modelProbability", "model_probability"));
  const toolAgreement = asNum(pick(r, "toolAgreement", "tool_agreement"));
  const validationScore = asNum(pick(r, "validationScore", "validation_score"));
  const confidenceEstimate = asNum(pick(r, "confidenceEstimate", "confidence_estimate"));
  if (
    modelProbability === null &&
    toolAgreement === null &&
    validationScore === null &&
    confidenceEstimate === null
  ) {
    return null;
  }
  return {
    modelProbability: modelProbability ?? 0,
    toolAgreement: toolAgreement ?? 0,
    validationScore: validationScore ?? 0,
    confidenceEstimate: confidenceEstimate ?? 0,
    formula: asStr(pick(r, "formula")) ?? CONFIDENCE_FORMULA,
  };
}

function normTrace(v: unknown): TraceEvent[] {
  return asArr(v)
    .map((e): TraceEvent | null => {
      const r = asRec(e);
      if (!r) return null;
      const stage = asStr(pick(r, "stage", "step", "name"));
      if (!stage) return null;
      const out: TraceEvent = {
        stage,
        timestamp: asStr(pick(r, "timestamp", "time", "ts")) ?? "",
        message: asStr(pick(r, "message", "detail", "msg")) ?? "",
      };
      const data = asRec(pick(r, "data", "payload", "extra"));
      if (data) out.data = data;
      return out;
    })
    .filter((e): e is TraceEvent => e !== null);
}

// ── public payload shapes ────────────────────────────────────────────────
export interface UploadOutcome {
  uploadId: string;
  validation: ValidationResult;
  files: UploadFileSummary[];
  raw: unknown;
}

export interface JobStatus {
  jobId: string;
  status: string;
  mode: InputMode | null;
  workflow: string | null;
  usedFallback: boolean | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** A completed analysis plus the query that produced it and the untouched body. */
export interface FullAnalysis extends AnalysisResult {
  query: string;
  raw: unknown;
}

export const TERMINAL_STATUSES = new Set([
  "completed",
  "complete",
  "failed",
  "error",
  "cancelled",
  "canceled",
]);

export function isTerminal(status: string | null | undefined): boolean {
  return TERMINAL_STATUSES.has((status ?? "").toLowerCase());
}

export function isFailure(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "failed" || s === "error" || s === "cancelled" || s === "canceled";
}

/** Pipeline stage order, mirroring src/db/schema.ts jobs.status. */
export const PIPELINE_STAGES = [
  "pending",
  "validating",
  "understanding",
  "routing",
  "running",
  "postprocessing",
  "evidence",
  "synthesizing",
  "completed",
] as const;

export function stageIndex(status: string | null | undefined): number {
  const s = (status ?? "").toLowerCase();
  const i = PIPELINE_STAGES.indexOf(s as (typeof PIPELINE_STAGES)[number]);
  if (i >= 0) return i;
  if (s === "complete") return PIPELINE_STAGES.length - 1;
  return -1;
}

function normStatus(v: unknown, fallbackId: string): JobStatus {
  const r = asRec(v);
  return {
    jobId: asStr(pick(r, "jobId", "job_id", "id")) ?? fallbackId,
    status: (asStr(pick(r, "status", "state")) ?? "unknown").toLowerCase(),
    mode: normMode(pick(r, "mode", "input_mode", "inputMode")),
    workflow: asStr(pick(r, "workflow")),
    usedFallback: asBool(pick(r, "usedFallback", "used_fallback")),
    errorMessage: asStr(pick(r, "errorMessage", "error_message", "error")),
    durationMs: asNum(pick(r, "durationMs", "duration_ms")),
    createdAt: asStr(pick(r, "createdAt", "created_at")),
    updatedAt: asStr(pick(r, "updatedAt", "updated_at")),
  };
}

function normAnalysis(v: unknown, fallbackId: string, fallbackQuery: string): FullAnalysis {
  const r = asRec(v);
  const intent = normIntent(pick(r, "intent"));
  return {
    jobId: asStr(pick(r, "jobId", "job_id", "id")) ?? fallbackId,
    status: (asStr(pick(r, "status", "state")) ?? "unknown").toLowerCase(),
    mode: normMode(pick(r, "mode", "input_mode", "inputMode")),
    intent,
    workflow: asStr(pick(r, "workflow")),
    modelsUsed: normModels(pick(r, "modelsUsed", "models_used")),
    parameters: asRec(pick(r, "parameters", "params")) ?? {},
    evidence: normEvidence(pick(r, "evidence")),
    confidence: normConfidence(pick(r, "confidence", "confidence_breakdown", "confidenceBreakdown")),
    answer: asStr(pick(r, "answer", "response", "text")),
    warnings: asStrArr(pick(r, "warnings")),
    errorMessage: asStr(pick(r, "errorMessage", "error_message")),
    trace: normTrace(pick(r, "trace", "trace_events", "traceEvents")),
    query: asStr(pick(r, "query", "raw_query", "rawQuery")) ?? intent?.rawQuery ?? fallbackQuery,
    raw: v,
  };
}

// ── endpoints ────────────────────────────────────────────────────────────
export interface HealthReport {
  ok: boolean;
  latencyMs: number;
  status: number | null;
  detail: string | null;
  base: string;
}

/** GET /api/health — never throws; the mission bar renders whatever it gets. */
export async function probeHealth(signal?: AbortSignal): Promise<HealthReport> {
  const started = Date.now();
  try {
    const body = await request("/api/health", { method: "GET" }, 8_000, signal);
    const rec = asRec(body.json);
    const ok = body.ok && (asBool(pick(rec, "ok", "healthy", "status")) ?? body.ok);
    return {
      ok,
      latencyMs: Date.now() - started,
      status: body.status,
      detail: serverMessage(body),
      base: API_BASE_LABEL,
    };
  } catch (err) {
    const apiErr = describeError(err);
    return {
      ok: false,
      latencyMs: Date.now() - started,
      status: apiErr.status,
      detail: apiErr.message,
      base: API_BASE_LABEL,
    };
  }
}

export interface UploadCandidate {
  file: File;
  role: FileRole;
}

/**
 * POST /api/upload — multipart with repeated `files` parts and a single
 * `roles` part holding a JSON array. This is the exact wire format the
 * existing backend expects; it is deliberately unchanged.
 */
export async function uploadImagery(
  candidates: UploadCandidate[],
  signal?: AbortSignal,
): Promise<UploadOutcome> {
  if (candidates.length === 0) {
    throw new ApiError("rejected", "No imagery staged for upload", {
      hint: "Add at least one raster before running an analysis.",
    });
  }
  const form = new FormData();
  for (const c of candidates) form.append("files", c.file, c.file.name);
  form.append("roles", JSON.stringify(candidates.map((c) => c.role)));

  const body = await request("/api/upload", { method: "POST", body: form }, 5 * 60_000, signal);
  if (!body.ok) throw failFromBody(body, "Upload failed");

  const rec = asRec(body.json);
  const uploadId = asStr(pick(rec, "uploadId", "upload_id", "id"));
  if (!uploadId) {
    throw new ApiError("payload", "Upload succeeded but no upload id was returned", {
      status: body.status,
      hint: "The service response is missing upload_id / uploadId. Check the backend version.",
    });
  }
  return {
    uploadId,
    validation: normValidation(pick(rec, "validation")),
    files: asArr(pick(rec, "files")).map(normUploadFile),
    raw: body.json,
  };
}

/**
 * POST /api/analyze
 *
 * snake_case (`upload_id`) is attempted first because that is the format the
 * shipped FastAPI service accepts. If the backend is the in-repo Next.js
 * route handler it answers 400 for a missing `uploadId`, so a single
 * camelCase retry is issued. 422 (validation rejected) is never retried —
 * that is a real answer, not a wire-format mismatch.
 */
export async function startAnalysis(
  uploadId: string,
  query: string,
  signal?: AbortSignal,
): Promise<{ jobId: string; status: string; raw: unknown }> {
  const send = (payload: Record<string, string>) =>
    request(
      "/api/analyze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      ANALYZE_TIMEOUT_MS,
      signal,
    );

  let body = await send({ upload_id: uploadId, query });
  if (!body.ok && body.status !== 422 && body.status < 500) {
    const retry = await send({ uploadId, query });
    if (retry.ok || retry.status === 422) body = retry;
  }
  if (!body.ok) throw failFromBody(body, "Analysis request rejected");

  const rec = asRec(body.json);
  const jobId = asStr(pick(rec, "jobId", "job_id", "id"));
  if (!jobId) {
    throw new ApiError("payload", "Analysis started but no job id was returned", {
      status: body.status,
      hint: "The service response is missing job_id / jobId.",
    });
  }
  return { jobId, status: (asStr(pick(rec, "status")) ?? "pending").toLowerCase(), raw: body.json };
}

/** GET /api/status/{job_id} */
export async function fetchStatus(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  const body = await request(
    `/api/status/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    DEFAULT_TIMEOUT_MS,
    signal,
  );
  if (!body.ok) throw failFromBody(body, "Could not read job status");
  return normStatus(body.json, jobId);
}

/** GET /api/result/{job_id} */
export async function fetchResult(
  jobId: string,
  query = "",
  signal?: AbortSignal,
): Promise<FullAnalysis> {
  const body = await request(
    `/api/result/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    60_000,
    signal,
  );
  if (!body.ok) throw failFromBody(body, "Could not read analysis result");
  if (!isRec(body.json)) {
    throw new ApiError("payload", "Result payload was not a JSON object", { status: body.status });
  }
  return normAnalysis(body.json, jobId, query);
}

/** GET /api/report/{job_id} — direct link target for the download control. */
export function reportUrl(jobId: string): string {
  return apiUrl(`/api/report/${encodeURIComponent(jobId)}`);
}

/** GET /api/report/{job_id} as text, so the report can be previewed in-app. */
export async function fetchReportText(jobId: string, signal?: AbortSignal): Promise<string> {
  const body = await request(
    `/api/report/${encodeURIComponent(jobId)}`,
    { method: "GET", headers: { Accept: "text/markdown, text/plain, */*" } },
    60_000,
    signal,
  );
  if (!body.ok) {
    throw failFromBody(
      body,
      body.status === 404 ? "No report was generated for this job" : "Could not fetch report",
    );
  }
  return body.text;
}

/**
 * pipeline.ts writes every tool preview to masks/{jobId}/{name} but always
 * reports `mask.png` as the overlay URL. For change / fusion workflows the
 * real artefact is change_mask.png or fused_mask.png, so the viewer probes a
 * short ordered candidate list instead of rendering a broken image.
 */
export function maskUrlCandidates(
  jobId: string | null,
  reported: string | null | undefined,
  task: string | null | undefined,
): string[] {
  const out: string[] = [];
  const push = (u: string | null) => {
    if (u && !out.includes(u)) out.push(u);
  };
  push(resolveAssetUrl(reported));
  if (jobId) {
    const byTask: Record<string, string[]> = {
      change_vqa: ["change_mask.png", "mask.png"],
      optical_sar: ["fused_mask.png", "mask.png"],
    };
    const names = byTask[(task ?? "").toLowerCase()] ?? ["mask.png"];
    for (const n of names) {
      push(resolveAssetUrl(`/api/files/masks/${encodeURIComponent(jobId)}/${n}`));
    }
  }
  return out;
}

/** Base-image preview candidates written by the tools alongside the masks. */
export function previewUrlCandidates(jobId: string | null, task: string | null | undefined): string[] {
  if (!jobId) return [];
  const dir = `/api/files/masks/${encodeURIComponent(jobId)}`;
  const t = (task ?? "").toLowerCase();
  const names =
    t === "change_vqa"
      ? ["t1_preview.png", "preview.png"]
      : t === "optical_sar"
        ? ["optical_index_preview.png", "preview.png"]
        : ["preview.png"];
  return names
    .map((n) => resolveAssetUrl(`${dir}/${n}`))
    .filter((u): u is string => u !== null);
}

/** Second frame for the compare view (bi-temporal / optical-SAR only). */
export function comparePreviewCandidates(jobId: string | null, task: string | null | undefined): string[] {
  if (!jobId) return [];
  const dir = `/api/files/masks/${encodeURIComponent(jobId)}`;
  const t = (task ?? "").toLowerCase();
  if (t !== "change_vqa" && t !== "optical_sar") return [];
  const names = t === "change_vqa" ? ["change_mask.png"] : ["fused_mask.png"];
  return names
    .map((n) => resolveAssetUrl(`${dir}/${n}`))
    .filter((u): u is string => u !== null);
}

// ── orchestrator ─────────────────────────────────────────────────────────
export type RunPhase =
  | "uploading"
  | "validating"
  | "dispatching"
  | "processing"
  | "collecting"
  | "done";

export interface RunProgress {
  phase: RunPhase;
  /** Real backend status string when one is known, otherwise null. */
  status: string | null;
  jobId: string | null;
  /** True while /api/status is answering — i.e. the stage label is real. */
  statusIsLive: boolean;
  message: string;
  poll: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: RunProgress) => void;
  /** Milliseconds between /api/status polls. */
  pollIntervalMs?: number;
  /** Hard ceiling on the wait for a terminal status. */
  maxWaitMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new ApiError("aborted", "Request cancelled"));
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new ApiError("aborted", "Request cancelled"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export interface RunOutcome {
  upload: UploadOutcome;
  status: JobStatus | null;
  result: FullAnalysis;
  /** False when the backend never exposed live stage transitions. */
  statusWasLive: boolean;
}

/**
 * Upload → analyze → (poll status) → result.
 *
 * The in-repo Next.js route runs the pipeline inline, so /api/analyze already
 * returns a terminal status and no polling happens. The FastAPI service may
 * answer earlier, in which case /api/status/{job_id} is polled. If that
 * endpoint is absent the result endpoint is polled instead, and
 * `statusWasLive` reports false so the UI can say so rather than animate a
 * fictional progress bar.
 */
export async function runFullAnalysis(
  candidates: UploadCandidate[],
  query: string,
  opts: RunOptions = {},
): Promise<RunOutcome> {
  const { signal, onProgress } = opts;
  const pollInterval = Math.max(300, opts.pollIntervalMs ?? 1_200);
  const maxWait = Math.max(10_000, opts.maxWaitMs ?? 15 * 60_000);
  let poll = 0;
  let statusWasLive = false;

  const emit = (
    phase: RunPhase,
    message: string,
    status: string | null,
    jobId: string | null,
    live: boolean,
  ) => {
    onProgress?.({ phase, message, status, jobId, statusIsLive: live, poll });
  };

  emit("uploading", "Transferring imagery to the analysis service", null, null, false);
  const upload = await uploadImagery(candidates, signal);

  emit("validating", "Validating raster metadata", null, null, false);
  if (!upload.validation.valid) {
    const first = upload.validation.errors[0];
    throw new ApiError("rejected", first ?? "Input validation failed", {
      status: 422,
      hint: "The staged imagery does not satisfy the pipeline's input contract. See the validation report.",
      detail: upload.validation.errors.join("; ") || null,
    });
  }

  emit("dispatching", "Routing the query to a workflow", null, null, false);
  const started = await startAnalysis(upload.uploadId, query, signal);
  const jobId = started.jobId;

  let status: JobStatus | null = null;
  let currentStatus = started.status;

  if (!isTerminal(currentStatus)) {
    const deadline = Date.now() + maxWait;
    let statusEndpointMissing = false;

    while (Date.now() < deadline) {
      poll += 1;
      if (!statusEndpointMissing) {
        try {
          status = await fetchStatus(jobId, signal);
          statusWasLive = true;
          currentStatus = status.status;
          emit("processing", stageLabel(status.status), status.status, jobId, true);
          if (isTerminal(currentStatus)) break;
        } catch (err) {
          const apiErr = describeError(err);
          if (apiErr.kind === "aborted") throw apiErr;
          if (apiErr.kind === "not_found") statusEndpointMissing = true;
          else if (apiErr.kind === "http" && (apiErr.status ?? 0) >= 500) statusEndpointMissing = true;
          else throw apiErr;
        }
      }
      if (statusEndpointMissing) {
        emit("processing", "Awaiting result — this backend does not expose live stages", null, jobId, false);
        try {
          const early = await fetchResult(jobId, query, signal);
          if (isTerminal(early.status)) {
            emit("done", "Analysis complete", early.status, jobId, false);
            return { upload, status, result: early, statusWasLive };
          }
        } catch (err) {
          const apiErr = describeError(err);
          if (apiErr.kind === "aborted") throw apiErr;
          if (apiErr.kind !== "not_found") throw apiErr;
        }
      }
      await sleep(pollInterval, signal);
    }

    if (!isTerminal(currentStatus) && !statusEndpointMissing) {
      throw new ApiError("timeout", "The job did not reach a terminal state in time", {
        hint: `Job ${jobId} is still running server-side. Check the backend logs, then reload the result.`,
      });
    }
  }

  emit("collecting", "Reading evidence and trace", currentStatus, jobId, statusWasLive);
  const result = await fetchResult(jobId, query, signal);
  emit("done", "Analysis complete", result.status, jobId, statusWasLive);
  return { upload, status, result, statusWasLive };
}

const STAGE_LABELS: Record<string, string> = {
  pending: "Queued",
  validating: "Validating raster metadata",
  understanding: "Parsing the query",
  routing: "Selecting workflow and models",
  running: "Running the remote-sensing tool",
  postprocessing: "Post-processing rasters",
  evidence: "Deriving GIS evidence",
  synthesizing: "Synthesising the answer",
  completed: "Complete",
  failed: "Failed",
};

export function stageLabel(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  return STAGE_LABELS[s] ?? (s === "" ? "Working" : s.replace(/_/g, " "));
}

/** Re-reads a job that already exists (used by the retry / reload control). */
export async function reloadAnalysis(
  jobId: string,
  query = "",
  signal?: AbortSignal,
): Promise<{ status: JobStatus | null; result: FullAnalysis }> {
  let status: JobStatus | null = null;
  try {
    status = await fetchStatus(jobId, signal);
  } catch (err) {
    const apiErr = describeError(err);
    if (apiErr.kind === "aborted") throw apiErr;
  }
  const result = await fetchResult(jobId, query, signal);
  return { status, result };
}

