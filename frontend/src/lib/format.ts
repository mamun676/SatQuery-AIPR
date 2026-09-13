// ═════════════════════════════════════════════════════════════════════════
// SatQuery AI — presentation formatters
//
// The backend emits machine-shaped fact names (`water_coverage_percent`,
// `optical_sar_agreement_iou`, `changed_area_km2`). Nothing here invents,
// rounds away or reinterprets a value: names are made readable and numbers
// are given a sensible precision, and the raw name is always still available
// to the caller for the technical view.
// ═════════════════════════════════════════════════════════════════════════
import type { EvidenceFact } from "@/server/satquery/types";

const ACRONYMS = new Set([
  "sar",
  "iou",
  "crs",
  "vqa",
  "ndvi",
  "ndwi",
  "nir",
  "rgb",
  "gis",
  "km2",
  "utm",
  "epsg",
  "dn",
  "id",
]);

/** `water_coverage_percent` → `Water coverage percent`; keeps acronyms upper. */
export function humanizeKey(key: string): string {
  const cleaned = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim();
  if (cleaned === "") return key;
  const words = cleaned.split(/\s+/).map((w) => {
    const lower = w.toLowerCase();
    if (ACRONYMS.has(lower)) return lower === "km2" ? "km²" : lower.toUpperCase();
    return w;
  });
  const first = words[0];
  words[0] = ACRONYMS.has(first.toLowerCase())
    ? words[0]
    : first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  for (let i = 1; i < words.length; i += 1) {
    if (!ACRONYMS.has(words[i].toLowerCase())) words[i] = words[i].toLowerCase();
  }
  return words.join(" ");
}

/** Chooses a precision that keeps small magnitudes legible. */
export function formatNumber(value: number, opts: { max?: number; min?: number } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  let digits = opts.max;
  if (digits === undefined) {
    if (Number.isInteger(value)) digits = 0;
    else if (abs >= 1000) digits = 0;
    else if (abs >= 100) digits = 1;
    else if (abs >= 1) digits = 2;
    else if (abs >= 0.01) digits = 3;
    else digits = 4;
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: opts.min ?? 0,
    maximumFractionDigits: digits,
  });
}

/** 0.732 → `73.2%`. Input is a 0..1 ratio, not a percentage. */
export function formatRatioPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

const UNIT_LABELS: Record<string, string> = {
  "%": "%",
  percent: "%",
  km2: "km²",
  "km^2": "km²",
  m2: "m²",
  m: "m",
  px: "px",
  pixels: "px",
  deg: "°",
  degrees: "°",
};

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return "";
  const key = unit.trim().toLowerCase();
  return UNIT_LABELS[key] ?? unit.trim();
}

export interface FormattedValue {
  /** Display string, unit excluded. */
  text: string;
  /** Unit suffix, already prettified (`km²`, `%`). */
  unit: string;
  /** Semantic tone for chips / colour coding. */
  tone: "neutral" | "verified" | "caution" | "fault" | "signal";
  /** True for boolean facts, which render as a state pill rather than a number. */
  isBoolean: boolean;
}

/** Formats one EvidenceFact value without altering its meaning. */
export function formatFactValue(fact: EvidenceFact): FormattedValue {
  const unit = unitLabel(fact.unit);
  const v = fact.value;

  if (typeof v === "boolean") {
    return {
      text: v ? "Detected" : "Not detected",
      unit: "",
      tone: v ? "verified" : "neutral",
      isBoolean: true,
    };
  }
  if (v === null || v === undefined) {
    return { text: "unavailable", unit: "", tone: "neutral", isBoolean: false };
  }
  if (typeof v === "number") {
    const digits = unit === "%" ? 2 : undefined;
    return {
      text: formatNumber(v, digits === undefined ? {} : { max: digits }),
      unit,
      tone: "signal",
      isBoolean: false,
    };
  }
  const s = v.trim();
  const lower = s.toLowerCase();
  const tone: FormattedValue["tone"] =
    lower === "increase" || lower === "increased"
      ? "caution"
      : lower === "decrease" || lower === "decreased"
        ? "signal"
        : lower === "none" || lower === "no change"
          ? "neutral"
          : "neutral";
  return { text: s, unit, tone, isBoolean: false };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

/** Wall-clock time only — dates are not invented when the stamp is unparseable. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function formatClockMs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const base = d.toLocaleTimeString("en-GB", { hour12: false });
  return `${base}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Offset in ms between two ISO stamps; null when either is unusable. */
export function offsetMs(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b - a;
}

/** Decimal degrees with hemisphere suffix. */
export function formatLatLon(lat: number, lon: number, digits = 5): string {
  const la = `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? "E" : "W"}`;
  return `${la} ${lo}`;
}

export function formatBbox(bbox: [number, number, number, number] | null | undefined, digits = 4): string {
  if (!bbox) return "—";
  return bbox.map((n) => n.toFixed(digits)).join(", ");
}

export function formatPixelBox(box: [number, number, number, number]): string {
  return `x ${Math.round(box[0])}–${Math.round(box[2])} · y ${Math.round(box[1])}–${Math.round(box[3])}`;
}

export function pixelBoxArea(box: [number, number, number, number]): number {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

/** Short CRS token for dense chips: `EPSG:4326` from a full WKT-ish string. */
export function shortCrs(crs: string | null | undefined): string | null {
  if (!crs) return null;
  const epsg = /epsg[:\s]*(\d{4,6})/i.exec(crs);
  if (epsg) return `EPSG:${epsg[1]}`;
  const trimmed = crs.trim();
  if (trimmed === "") return null;
  return trimmed.length > 28 ? `${trimmed.slice(0, 27)}…` : trimmed;
}

export function formatResolution(
  res: { x: number | null; y: number | null; unit: string | null } | null | undefined,
): string {
  if (!res || (res.x === null && res.y === null)) return "—";
  const unit = res.unit ? ` ${unitLabel(res.unit)}` : "";
  if (res.x !== null && res.y !== null) {
    const same = Math.abs(Math.abs(res.x) - Math.abs(res.y)) < 1e-9;
    return same
      ? `${formatNumber(Math.abs(res.x))}${unit}/px`
      : `${formatNumber(Math.abs(res.x))} × ${formatNumber(Math.abs(res.y))}${unit}/px`;
  }
  const only = res.x ?? res.y ?? 0;
  return `${formatNumber(Math.abs(only))}${unit}/px`;
}

export function formatDimensions(width: number | null, height: number | null): string {
  if (width === null || height === null) return "—";
  return `${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} px`;
}

export function formatMegapixels(width: number | null, height: number | null): string | null {
  if (width === null || height === null) return null;
  const mp = (width * height) / 1e6;
  if (mp < 0.01) return null;
  return `${mp.toFixed(mp >= 10 ? 0 : 2)} MP`;
}

const TASK_LABELS: Record<string, string> = {
  vqa: "Visual question answering",
  caption: "Scene captioning",
  grounding: "Visual grounding",
  change_vqa: "Bi-temporal change analysis",
  optical_sar: "Optical–SAR fusion",
};

export function taskLabel(task: string | null | undefined): string {
  if (!task) return "—";
  return TASK_LABELS[task.toLowerCase()] ?? humanizeKey(task);
}

const MODE_LABELS: Record<string, string> = {
  single_image: "Single image",
  optical_sar: "Optical + SAR pair",
  bitemporal: "Bi-temporal pair",
};

export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return "—";
  return MODE_LABELS[mode.toLowerCase()] ?? humanizeKey(mode);
}

const ROLE_LABELS: Record<string, string> = {
  single: "Single",
  optical: "Optical",
  sar: "SAR",
  t1: "T1 · before",
  t2: "T2 · after",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? humanizeKey(role);
}

export function modalityLabel(modality: string | null | undefined): string {
  if (!modality || modality === "unknown") return "Unclassified";
  return modality === "sar" ? "SAR" : humanizeKey(modality);
}

/** Truncates on a word boundary; never mid-word ellipses inside a sentence. */
export function truncateWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const cut = slice.lastIndexOf(" ");
  return `${(cut > maxChars * 0.6 ? slice.slice(0, cut) : slice).trimEnd()}…`;
}

/** Stable identifier fragment for dense UI (`3f9c…a12b`). */
export function shortId(id: string | null | undefined, head = 4, tail = 4): string {
  if (!id) return "—";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** JSON with stable key order so the technical view does not reshuffle. */
export function stableJson(value: unknown, space = 2): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, val: unknown) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[circular]";
        seen.add(val);
        if (!Array.isArray(val)) {
          const rec = val as Record<string, unknown>;
          return Object.keys(rec)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = rec[k];
              return acc;
            }, {});
        }
      }
      if (typeof val === "number" && !Number.isFinite(val)) return String(val);
      return val;
    },
    space,
  );
}
