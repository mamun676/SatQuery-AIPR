// ═════════════════════════════════════════════════════════════════════════
// SatQuery AI — evidence interpretation
//
// Pure derivation from what the backend actually returned. Every helper here
// either reports a real value or reports that it is unavailable; nothing is
// estimated, substituted or filled in.
// ═════════════════════════════════════════════════════════════════════════
import type {
  ConfidenceBreakdown,
  Evidence,
  EvidenceFact,
  GeoOverlay,
  ModelUsed,
  RasterMetadata,
} from "@/server/satquery/types";
import { clamp01, formatFactValue, humanizeKey, type FormattedValue } from "./format";

// ── fact grouping ────────────────────────────────────────────────────────
export type FactGroupId = "detection" | "extent" | "change" | "agreement" | "regions" | "method" | "raster";

export interface FactGroup {
  id: FactGroupId;
  title: string;
  /** Short explanation of what this group of numbers means. */
  note: string;
  facts: EvidenceFact[];
}

const GROUP_META: Record<FactGroupId, { title: string; note: string }> = {
  detection: {
    title: "Detection",
    note: "Whether the queried target was found in the raster at all.",
  },
  extent: {
    title: "Extent",
    note: "How much of the scene the target occupies, in pixels and ground units.",
  },
  change: {
    title: "Change",
    note: "Differences measured between the two acquisition dates.",
  },
  agreement: {
    title: "Cross-sensor agreement",
    note: "Overlap between the independent sensor-derived masks.",
  },
  regions: {
    title: "Connected regions",
    note: "Discrete blobs found by connected-component labelling.",
  },
  method: { title: "Method", note: "The index and algorithm the tool applied." },
  raster: { title: "Raster", note: "Properties read directly from the source file." },
};

function classifyFact(name: string): FactGroupId {
  const n = name.toLowerCase();
  if (n.endsWith("_present")) return "detection";
  if (n.includes("agreement") || n.includes("_iou")) return "agreement";
  if (n.startsWith("changed_") || n.includes("_change_") || n.includes("_index_before") || n.includes("_index_after")) {
    return "change";
  }
  if (n.includes("region")) return "regions";
  if (n.includes("coverage") || n.includes("area") || n.includes("pixel")) return "extent";
  if (n.includes("method")) return "method";
  if (n.includes("dimension") || n.includes("band")) return "raster";
  return "extent";
}

const GROUP_ORDER: FactGroupId[] = [
  "detection",
  "extent",
  "change",
  "agreement",
  "regions",
  "method",
  "raster",
];

/** Buckets real facts into readable groups; empty groups are dropped. */
export function groupFacts(facts: EvidenceFact[]): FactGroup[] {
  const buckets = new Map<FactGroupId, EvidenceFact[]>();
  for (const fact of facts) {
    const id = classifyFact(fact.fact);
    const list = buckets.get(id);
    if (list) list.push(fact);
    else buckets.set(id, [fact]);
  }
  return GROUP_ORDER.filter((id) => (buckets.get(id)?.length ?? 0) > 0).map((id) => ({
    id,
    title: GROUP_META[id].title,
    note: GROUP_META[id].note,
    facts: buckets.get(id) ?? [],
  }));
}

// ── headline metrics ─────────────────────────────────────────────────────
export interface HeadlineMetric {
  key: string;
  label: string;
  value: FormattedValue;
  /** Ratio 0..1 when the fact is a percentage, for the inline bar. */
  ratio: number | null;
  note: string | null;
}

const HEADLINE_PATTERNS: Array<{ test: (n: string) => boolean; rank: number }> = [
  { test: (n) => n.endsWith("_present"), rank: 0 },
  { test: (n) => n.endsWith("_coverage_percent") || n.endsWith("_fused_coverage_percent"), rank: 1 },
  { test: (n) => n === "changed_pixel_percent", rank: 1 },
  { test: (n) => n.endsWith("_area_km2"), rank: 2 },
  { test: (n) => n === "optical_sar_agreement_iou", rank: 2 },
  { test: (n) => n.endsWith("_change_direction"), rank: 3 },
  { test: (n) => n.endsWith("_region_count") || n === "changed_region_count", rank: 4 },
];

/** Picks up to `limit` facts worth promoting to large type. */
export function headlineMetrics(facts: EvidenceFact[], limit = 4): HeadlineMetric[] {
  const scored: Array<{ fact: EvidenceFact; rank: number }> = [];
  for (const fact of facts) {
    const name = fact.fact.toLowerCase();
    const hit = HEADLINE_PATTERNS.find((p) => p.test(name));
    if (hit) scored.push({ fact, rank: hit.rank });
  }
  scored.sort((a, b) => a.rank - b.rank);
  return scored.slice(0, limit).map(({ fact }) => {
    const value = formatFactValue(fact);
    const unit = (fact.unit ?? "").toLowerCase();
    const isPercent = unit === "%" || unit === "percent";
    const numeric = typeof fact.value === "number" ? fact.value : null;
    let ratio: number | null = isPercent && numeric !== null ? clamp01(numeric / 100) : null;
    if (ratio === null && fact.fact.toLowerCase() === "optical_sar_agreement_iou" && numeric !== null) {
      ratio = clamp01(numeric);
    }
    let note: string | null = null;
    const extra = fact.extra;
    if (extra) {
      const rawNote = extra.note;
      if (typeof rawNote === "string" && rawNote.trim() !== "") note = rawNote;
      const cov = extra.coverage_percent ?? extra.coveragePercent;
      if (note === null && typeof cov === "number") note = `${cov.toFixed(2)}% of scene pixels`;
    }
    return { key: fact.fact, label: humanizeKey(fact.fact), value, ratio, note };
  });
}

/** Facts not promoted to headline, in original backend order. */
export function remainingFacts(facts: EvidenceFact[], headline: HeadlineMetric[]): EvidenceFact[] {
  const used = new Set(headline.map((h) => h.key));
  return facts.filter((f) => !used.has(f.fact));
}

// ── confidence explanation ───────────────────────────────────────────────
export interface ConfidenceTerm {
  key: "modelProbability" | "toolAgreement" | "validationScore";
  label: string;
  /** Raw 0..1 component as returned by the backend. */
  value: number;
  weight: number;
  /** weight × value — the contribution to the final estimate. */
  contribution: number;
  /** Share of the achieved estimate attributable to this term, 0..1. */
  share: number;
  /** How much this term still leaves on the table (weight − contribution). */
  deficit: number;
  what: string;
}

export type ConfidenceBand = "low" | "moderate" | "substantial" | "high";

export interface ConfidenceReading {
  estimate: number;
  band: ConfidenceBand;
  bandLabel: string;
  terms: ConfidenceTerm[];
  /** The weighted term costing the estimate the most. */
  limiter: ConfidenceTerm | null;
  /** Sum of weight×value, recomputed client-side to cross-check the backend. */
  recomputed: number;
  /** True when the backend estimate matches the published formula. */
  formulaConsistent: boolean;
  formula: string;
}

const TERM_META: Record<ConfidenceTerm["key"], { label: string; weight: number; what: string }> = {
  modelProbability: {
    label: "Model probability",
    weight: 0.5,
    what: "Confidence reported by the model or tool that produced the answer.",
  },
  toolAgreement: {
    label: "Tool agreement",
    weight: 0.3,
    what: "How closely the independent GIS measurements corroborate each other.",
  },
  validationScore: {
    label: "Input validation",
    weight: 0.2,
    what: "Quality of the submitted rasters: errors and warnings reduce this term.",
  },
};

function bandOf(estimate: number): { band: ConfidenceBand; label: string } {
  if (estimate >= 0.8) return { band: "high", label: "High" };
  if (estimate >= 0.6) return { band: "substantial", label: "Substantial" };
  if (estimate >= 0.4) return { band: "moderate", label: "Moderate" };
  return { band: "low", label: "Low" };
}

/**
 * Decomposes the heuristic so the operator can see which term is holding the
 * estimate down. Deliberately not described as a calibrated probability.
 */
export function readConfidence(c: ConfidenceBreakdown | null): ConfidenceReading | null {
  if (!c) return null;
  const estimate = clamp01(c.confidenceEstimate);
  const keys: ConfidenceTerm["key"][] = ["modelProbability", "toolAgreement", "validationScore"];
  const raw = keys.map((key) => {
    const meta = TERM_META[key];
    const value = clamp01(c[key]);
    const contribution = value * meta.weight;
    return { key, meta, value, contribution };
  });
  const recomputed = raw.reduce((sum, t) => sum + t.contribution, 0);
  const terms: ConfidenceTerm[] = raw.map((t) => ({
    key: t.key,
    label: t.meta.label,
    value: t.value,
    weight: t.meta.weight,
    contribution: t.contribution,
    share: recomputed > 0 ? t.contribution / recomputed : 0,
    deficit: t.meta.weight - t.contribution,
    what: t.meta.what,
  }));
  const limiter = terms.reduce<ConfidenceTerm | null>(
    (worst, t) => (worst === null || t.deficit > worst.deficit ? t : worst),
    null,
  );
  const { band, label } = bandOf(estimate);
  return {
    estimate,
    band,
    bandLabel: label,
    terms,
    limiter: limiter && limiter.deficit > 0.001 ? limiter : null,
    recomputed,
    formulaConsistent: Math.abs(recomputed - estimate) <= 0.02,
    formula: c.formula,
  };
}

/** One-sentence plain-language reason, driven by the limiting term. */
export function confidenceReason(reading: ConfidenceReading | null): string | null {
  if (!reading) return null;
  const { limiter, band } = reading;
  if (!limiter) {
    return band === "high"
      ? "All three heuristic terms scored near their maximum."
      : "The three terms contributed evenly; no single factor dominates.";
  }
  const pct = `${Math.round(limiter.value * 100)}%`;
  switch (limiter.key) {
    case "modelProbability":
      return `Held back mainly by model probability (${pct} at weight 0.5) — the tool itself was not certain.`;
    case "toolAgreement":
      return `Held back mainly by tool agreement (${pct} at weight 0.3) — the independent measurements diverge.`;
    default:
      return `Held back mainly by input validation (${pct} at weight 0.2) — the submitted rasters raised errors or warnings.`;
  }
}

// ── model provenance ─────────────────────────────────────────────────────
export type ModelState = "used" | "fallback_used" | "unavailable";

export interface ModelReading {
  model: ModelUsed;
  state: ModelState;
  stateLabel: string;
  tone: "verified" | "caution" | "neutral";
  /** Verbatim backend reason; never paraphrased or invented. */
  reason: string | null;
}

const STATE_META: Record<ModelState, { label: string; tone: ModelReading["tone"] }> = {
  used: { label: "Executed", tone: "verified" },
  fallback_used: { label: "Fallback executed", tone: "caution" },
  unavailable: { label: "Not available", tone: "neutral" },
};

export function readModels(models: ModelUsed[]): ModelReading[] {
  return models.map((model) => {
    const meta = STATE_META[model.status];
    return {
      model,
      state: model.status,
      stateLabel: meta.label,
      tone: meta.tone,
      reason: model.reason && model.reason.trim() !== "" ? model.reason : null,
    };
  });
}

export interface ProvenanceSummary {
  executed: ModelReading[];
  fallbacks: ModelReading[];
  unavailable: ModelReading[];
  /** The model that actually produced the answer, if identifiable. */
  primary: ModelReading | null;
  usedFallback: boolean;
  /** Honest one-liner for the mission bar. */
  headline: string;
}

export function summariseProvenance(models: ModelUsed[]): ProvenanceSummary {
  const readings = readModels(models);
  const executed = readings.filter((r) => r.state === "used");
  const fallbacks = readings.filter((r) => r.state === "fallback_used");
  const unavailable = readings.filter((r) => r.state === "unavailable");
  const primary = executed[0] ?? fallbacks[0] ?? null;
  const usedFallback = fallbacks.length > 0;
  let headline: string;
  if (primary === null) {
    headline = "No model reported execution for this job.";
  } else if (usedFallback && executed.length === 0) {
    headline = `Answered by the deterministic fallback ${fallbacks[0].model.name}; the primary model was unavailable.`;
  } else if (usedFallback) {
    headline = `Answered by ${primary.model.name} with ${fallbacks.length} fallback path also engaged.`;
  } else {
    headline = `Answered by ${primary.model.name}.`;
  }
  return { executed, fallbacks, unavailable, primary, usedFallback, headline };
}

// ── spatial availability ─────────────────────────────────────────────────
export type SpatialKind = "georeferenced" | "pixel" | "unavailable";

export interface SpatialReading {
  kind: SpatialKind;
  /** Boxes carrying real geographic coordinates. */
  geoBoxCount: number;
  /** Boxes carrying pixel coordinates only. */
  pixelBoxCount: number;
  /** Source-image extent in map units, when the backend supplied one. */
  imageBounds: [number, number, number, number] | null;
  pixelDimensions: { width: number; height: number } | null;
  crs: string | null;
  /** Backend-reported mask URL, unresolved. */
  maskPreviewUrl: string | null;
  /** Why a basemap cannot be shown, when it cannot. */
  limitation: string | null;
  /** Copy for the empty state. */
  emptyTitle: string;
  emptyBody: string;
}

const NO_OVERLAY: SpatialReading = {
  kind: "unavailable",
  geoBoxCount: 0,
  pixelBoxCount: 0,
  imageBounds: null,
  pixelDimensions: null,
  crs: null,
  maskPreviewUrl: null,
  limitation: "The workflow produced no spatial overlay.",
  emptyTitle: "Spatial evidence unavailable for this result",
  emptyBody:
    "This workflow answered from scene-level statistics and did not emit region geometry. Nothing is drawn rather than showing an approximate footprint.",
};

/**
 * Decides — from real fields only — whether this result can be placed on a
 * basemap, must be shown in pixel space, or has no geometry at all.
 */
export function readSpatial(
  overlay: GeoOverlay | null,
  raster: RasterMetadata | null,
): SpatialReading {
  if (!overlay) return NO_OVERLAY;

  const geoBoxCount = overlay.boxes.filter((b) => Array.isArray(b.geoBox)).length;
  const pixelBoxCount = overlay.boxes.length;
  const hasImageBounds = Array.isArray(overlay.imageBounds);
  const georeferenced = overlay.type === "geojson" && (geoBoxCount > 0 || hasImageBounds);

  if (pixelBoxCount === 0 && !hasImageBounds && !overlay.maskPreviewUrl) {
    return {
      ...NO_OVERLAY,
      crs: overlay.crs,
      limitation: "The overlay object carried no boxes, bounds or mask.",
    };
  }

  const base: SpatialReading = {
    kind: georeferenced ? "georeferenced" : "pixel",
    geoBoxCount,
    pixelBoxCount,
    imageBounds: overlay.imageBounds ?? null,
    pixelDimensions: overlay.pixelDimensions ?? null,
    crs: overlay.crs,
    maskPreviewUrl: overlay.maskPreviewUrl ?? null,
    limitation: null,
    emptyTitle: "",
    emptyBody: "",
  };

  if (georeferenced) return base;

  const why =
    raster && raster.hasGeoTransform === false
      ? "The source raster has no geotransform, so pixel coordinates cannot be projected onto a basemap."
      : overlay.crs === null
        ? "No CRS was reported for this raster, so pixel coordinates cannot be projected onto a basemap."
        : "The workflow returned pixel-space geometry only.";

  return { ...base, limitation: why };
}

/** Flags a mask that does not match the geometry it is being drawn over. */
export function maskDimensionMismatch(
  spatial: SpatialReading,
  natural: { width: number; height: number } | null,
): string | null {
  if (!natural || !spatial.pixelDimensions) return null;
  const { width, height } = spatial.pixelDimensions;
  if (natural.width === width && natural.height === height) return null;
  return `Mask raster is ${natural.width}×${natural.height} px but the evidence frame is ${width}×${height} px; the overlay is scaled to fit.`;
}

// ── statistics ───────────────────────────────────────────────────────────
export interface StatRow {
  key: string;
  label: string;
  kind: "scalar" | "nested";
  scalar: string | number | boolean | null;
  nested: unknown;
}

const STAT_LABELS: Record<string, string> = {
  coverage: "Coverage ratio",
  maskPixels: "Mask pixels",
  totalPixels: "Total pixels",
  regionCount: "Region count",
  indexMethod: "Index method",
  composition: "Band composition",
  band0Stats: "Band 0 statistics",
  regions: "Region table",
  changedPixels: "Changed pixels",
  meanBefore: "Mean index — before",
  meanAfter: "Mean index — after",
  toolAgreement: "Tool agreement",
};

/** Flattens the statistics record into ordered rows without dropping keys. */
export function readStatistics(statistics: Record<string, unknown>): StatRow[] {
  const preferred = Object.keys(STAT_LABELS);
  const keys = Object.keys(statistics);
  keys.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map((key) => {
    const value = statistics[key];
    const label = STAT_LABELS[key] ?? humanizeKey(key);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      return { key, label, kind: "scalar", scalar: value, nested: null };
    }
    return { key, label, kind: "nested", scalar: null, nested: value };
  });
}

export interface RegionRow {
  index: number;
  pixels: number | null;
  box: [number, number, number, number] | null;
  label: string | null;
}

/** Reads `statistics.regions` when the tool emitted a region table. */
export function readRegions(statistics: Record<string, unknown>): RegionRow[] {
  const raw = statistics.regions;
  if (!Array.isArray(raw)) return [];
  const rows: RegionRow[] = [];
  raw.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) return;
    const rec = entry as Record<string, unknown>;
    const pixelsRaw = rec.pixels ?? rec.pixelCount ?? rec.pixel_count ?? rec.area;
    const boxRaw = rec.box ?? rec.bbox ?? rec.pixelBox ?? rec.pixel_box;
    let box: [number, number, number, number] | null = null;
    if (Array.isArray(boxRaw) && boxRaw.length === 4 && boxRaw.every((n) => typeof n === "number")) {
      box = [boxRaw[0], boxRaw[1], boxRaw[2], boxRaw[3]] as [number, number, number, number];
    }
    const labelRaw = rec.label ?? rec.name;
    rows.push({
      index: i + 1,
      pixels: typeof pixelsRaw === "number" ? pixelsRaw : null,
      box,
      label: typeof labelRaw === "string" ? labelRaw : null,
    });
  });
  return rows;
}

/** True when the result genuinely carries something measurable. */
export function hasMeasurableEvidence(evidence: Evidence | null): boolean {
  if (!evidence) return false;
  return (
    evidence.facts.length > 0 ||
    Object.keys(evidence.statistics).length > 0 ||
    (evidence.overlay?.boxes.length ?? 0) > 0
  );
}
