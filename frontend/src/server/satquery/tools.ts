// Specialist tools (backend/tools/{vqa,caption,grounding,change,optical_sar}_tool.py).
//
// Each tool is executed by the agentic controller after a model/fallback has
// been selected from the registry. Tools call into gis.ts for every
// quantitative computation — no numbers are invented here either.
import {
  basicStats,
  computeAreaKm2,
  computeSeparability,
  computeTargetIndex,
  connectedComponents,
  countMaskPixels,
  encodeGrayscalePreview,
  encodeMaskOverlay,
  iou,
  otsuThreshold,
  pixelBoxToGeoBox,
  resampleNearest,
  thresholdToMask,
  type RasterData,
  type Region,
} from "./gis";
import type { EvidenceFact, GeoOverlay } from "./types";

export interface ToolOutput {
  answer: string;
  facts: EvidenceFact[];
  statistics: Record<string, unknown>;
  overlay: GeoOverlay | null;
  toolAgreement: number;
  modelProbability: number;
  previewPngs: { name: string; buffer: Buffer }[];
}

const DEFAULT_TARGET_LABELS = ["water", "vegetation", "built_up", "bare_soil"];

function regionsToOverlay(regions: Region[], raster: RasterData, label: string): GeoOverlay {
  const hasGeo = raster.metadata.hasGeoTransform && raster.metadata.bbox;
  return {
    type: hasGeo ? "geojson" : "pixel",
    crs: raster.metadata.crs,
    imageBounds: hasGeo ? raster.metadata.bbox : null,
    pixelDimensions: { width: raster.width, height: raster.height },
    boxes: regions.map((r) => ({
      pixelBox: r.bbox,
      geoBox: hasGeo ? pixelBoxToGeoBox(r.bbox, raster.width, raster.height, raster.metadata.bbox!) : undefined,
      label,
      score: r.pixelCount,
    })),
  };
}

/** VQA: answer a natural-language question grounded in computed indices. */
export function runVqaTool(raster: RasterData, question: string, target: string | null): ToolOutput {
  const previewPngs: { name: string; buffer: Buffer }[] = [
    { name: "preview.png", buffer: encodeGrayscalePreview(raster.bands[0], raster.width, raster.height) },
  ];

  if (target) {
    const { index, method } = computeTargetIndex(raster.bands, raster.bandCount, target);
    const threshold = otsuThreshold(index);
    const mask = thresholdToMask(index, threshold);
    const maskPixels = countMaskPixels(mask);
    const coverage = maskPixels / mask.length;
    const modelProbability = computeSeparability(index, threshold);
    const present = coverage > 0.02;
    const { areaKm2, note } = computeAreaKm2(maskPixels, raster.metadata.resolution, raster.metadata.bbox);
    const regions = connectedComponents(mask, raster.width, raster.height);

    previewPngs.push({ name: "mask.png", buffer: encodeMaskOverlay(mask, raster.width, raster.height) });

    const answer = present
      ? `Yes — the analysis detects "${target.replace("_", " ")}" covering approximately ${(coverage * 100).toFixed(1)}% of the image` +
        (areaKm2 != null ? ` (~${areaKm2.toFixed(3)} km²).` : ".")
      : `No significant presence of "${target.replace("_", " ")}" was detected (coverage ${(coverage * 100).toFixed(1)}%, below the 2% detection threshold).`;

    return {
      answer,
      facts: [
        { fact: `${target}_present`, value: present, extra: { coverage_percent: Number((coverage * 100).toFixed(2)) } },
        { fact: `${target}_coverage_percent`, value: Number((coverage * 100).toFixed(2)), unit: "%" },
        ...(areaKm2 != null ? [{ fact: `${target}_area_km2`, value: Number(areaKm2.toFixed(4)), unit: "km2", extra: { note } } as EvidenceFact] : []),
        { fact: "index_method", value: method },
      ],
      statistics: { coverage, maskPixels, totalPixels: mask.length, regionCount: regions.length, indexMethod: method },
      overlay: regionsToOverlay(regions, raster, target),
      toolAgreement: 1.0,
      modelProbability,
      previewPngs,
    };
  }

  // No explicit target: describe dominant land-cover proxy composition.
  const composition: Record<string, number> = {};
  for (const label of DEFAULT_TARGET_LABELS) {
    const { index } = computeTargetIndex(raster.bands, raster.bandCount, label);
    const threshold = otsuThreshold(index);
    const mask = thresholdToMask(index, threshold);
    composition[label] = countMaskPixels(mask) / mask.length;
  }
  const dominant = Object.entries(composition).sort((a, b) => b[1] - a[1])[0];
  const stats = basicStats(raster.bands[0]);

  return {
    answer:
      `Based on spectral/intensity indices, the dominant land-cover proxy is "${dominant[0].replace("_", " ")}" ` +
      `(~${(dominant[1] * 100).toFixed(1)}% coverage). Question: "${question}" — see evidence for full per-class breakdown.`,
    facts: Object.entries(composition).map(([k, v]) => ({ fact: `${k}_coverage_percent`, value: Number((v * 100).toFixed(2)), unit: "%" })),
    statistics: { composition, band0Stats: stats },
    overlay: null,
    toolAgreement: 1.0,
    modelProbability: 0.6,
    previewPngs,
  };
}

/** Captioning: template description grounded in real computed statistics. */
export function runCaptionTool(raster: RasterData): ToolOutput {
  const composition: Record<string, number> = {};
  for (const label of DEFAULT_TARGET_LABELS) {
    const { index } = computeTargetIndex(raster.bands, raster.bandCount, label);
    const threshold = otsuThreshold(index);
    const mask = thresholdToMask(index, threshold);
    composition[label] = countMaskPixels(mask) / mask.length;
  }
  const sorted = Object.entries(composition).sort((a, b) => b[1] - a[1]);
  const stats = basicStats(raster.bands[0]);
  const preview = encodeGrayscalePreview(raster.bands[0], raster.width, raster.height);

  // Some target labels share the same proxy index when the raster lacks the
  // bands needed to separate them (e.g. built-up vs. bare soil on RGB-only
  // input). Reporting them as two distinct findings with identical coverage
  // would overstate what the proxy can actually distinguish, so collapse
  // labels whose coverage is indistinguishable into a single hedged phrase.
  const describe = (entry: [string, number]) => entry[0].replace(/_/g, " ");
  const leadCoverage = sorted[0][1];
  const tied = sorted.filter(([, v]) => Math.abs(v - leadCoverage) < 1e-9);
  const dominant =
    tied.length > 1
      ? `${tied.map(describe).join(" / ")} (${(leadCoverage * 100).toFixed(1)}%, not separable with the available bands)`
      : sorted
          .slice(0, 2)
          .map((e) => `${describe(e)} (${(e[1] * 100).toFixed(1)}%)`)
          .join(" and ");

  const answer =
    `A ${raster.width}x${raster.height} pixel ${raster.bandCount}-band scene. ` +
    `Dominant surface types (proxy classification): ${dominant}. ` +
    (raster.metadata.crs ? `Coordinate reference system: ${raster.metadata.crs}.` : "No georeferencing metadata found.");

  return {
    answer,
    facts: [
      ...Object.entries(composition).map(([k, v]) => ({ fact: `${k}_coverage_percent`, value: Number((v * 100).toFixed(2)), unit: "%" } as EvidenceFact)),
      { fact: "image_dimensions", value: `${raster.width}x${raster.height}` },
      { fact: "band_count", value: raster.bandCount },
    ],
    statistics: { composition, band0Stats: stats },
    overlay: null,
    toolAgreement: 1.0,
    modelProbability: 0.65,
    previewPngs: [{ name: "preview.png", buffer: preview }],
  };
}

/** Grounding: locate regions matching a target concept as bounding boxes. */
export function runGroundingTool(raster: RasterData, target: string): ToolOutput {
  const { index, method } = computeTargetIndex(raster.bands, raster.bandCount, target);
  const threshold = otsuThreshold(index);
  const mask = thresholdToMask(index, threshold);
  const regions = connectedComponents(mask, raster.width, raster.height, 25, 10);
  const modelProbability = computeSeparability(index, threshold);
  const preview = encodeGrayscalePreview(raster.bands[0], raster.width, raster.height);
  const overlayPng = encodeMaskOverlay(mask, raster.width, raster.height);

  const answer =
    regions.length > 0
      ? `Located ${regions.length} candidate region(s) matching "${target.replace("_", " ")}" (largest covers ${regions[0].pixelCount} pixels).`
      : `No distinct regions matching "${target.replace("_", " ")}" could be localized above the detection threshold.`;

  return {
    answer,
    facts: [
      { fact: `${target}_region_count`, value: regions.length },
      ...regions.slice(0, 5).map((r, i) => ({ fact: `${target}_region_${i + 1}_pixels`, value: r.pixelCount } as EvidenceFact)),
      { fact: "index_method", value: method },
    ],
    statistics: { regionCount: regions.length, regions },
    overlay: regionsToOverlay(regions, raster, target),
    toolAgreement: 1.0,
    modelProbability,
    previewPngs: [
      { name: "preview.png", buffer: preview },
      { name: "mask.png", buffer: overlayPng },
    ],
  };
}

/** Bi-temporal change: distinguishes language-level interpretation from spatial evidence. */
export function runChangeTool(t1: RasterData, t2: RasterData, target: string | null): ToolOutput {
  const dstW = Math.min(t1.width, t2.width);
  const dstH = Math.min(t1.height, t2.height);

  const targetLabel = target ?? "built_up";
  const idx1 = computeTargetIndex(t1.bands, t1.bandCount, targetLabel);
  const idx2 = computeTargetIndex(t2.bands, t2.bandCount, targetLabel);
  const r1 = resampleNearest(idx1.index, t1.width, t1.height, dstW, dstH);
  const r2 = resampleNearest(idx2.index, t2.width, t2.height, dstW, dstH);

  const diff = new Float64Array(dstW * dstH);
  for (let i = 0; i < diff.length; i++) diff[i] = r2[i] - r1[i];

  const absDiff = new Float64Array(diff.length);
  for (let i = 0; i < diff.length; i++) absDiff[i] = Math.abs(diff[i]);
  const threshold = otsuThreshold(absDiff);
  const changeMask = thresholdToMask(absDiff, threshold);
  const changedPixels = countMaskPixels(changeMask);
  const regions = connectedComponents(changeMask, dstW, dstH);
  const modelProbability = computeSeparability(absDiff, threshold);

  const meanBefore = basicStats(r1).mean;
  const meanAfter = basicStats(r2).mean;
  const direction = meanAfter > meanBefore ? "increase" : meanAfter < meanBefore ? "decrease" : "no significant change";

  const resolution = t1.metadata.hasGeoTransform ? t1.metadata.resolution : t2.metadata.resolution;
  const bboxForArea = t1.metadata.hasGeoTransform ? t1.metadata.bbox : t2.metadata.bbox;
  const { areaKm2, note } = computeAreaKm2(changedPixels, resolution, bboxForArea);

  const preview1 = encodeGrayscalePreview(r1, dstW, dstH);
  const overlayPng = encodeMaskOverlay(changeMask, dstW, dstH);

  const rasterForOverlay: RasterData = {
    width: dstW,
    height: dstH,
    bandCount: 1,
    bands: [absDiff],
    metadata: t1.metadata.hasGeoTransform ? t1.metadata : t2.metadata,
  };

  const languageInterpretation =
    `Change-reasoning: the "${targetLabel.replace("_", " ")}" indicator shows a ${direction} between T1 and T2 ` +
    `(mean index ${meanBefore.toFixed(3)} → ${meanAfter.toFixed(3)}).`;
  const spatialEvidence =
    `Spatial evidence: ${changedPixels.toLocaleString()} of ${changeMask.length.toLocaleString()} pixels (${((changedPixels / changeMask.length) * 100).toFixed(1)}%) changed` +
    (areaKm2 != null ? `, approximately ${areaKm2.toFixed(3)} km², across ${regions.length} region(s).` : ` across ${regions.length} region(s) (${note}).`);

  return {
    answer: `${languageInterpretation} ${spatialEvidence}`,
    facts: [
      { fact: `${targetLabel}_change_direction`, value: direction },
      { fact: `${targetLabel}_index_before`, value: Number(meanBefore.toFixed(4)) },
      { fact: `${targetLabel}_index_after`, value: Number(meanAfter.toFixed(4)) },
      { fact: "changed_pixel_count", value: changedPixels },
      { fact: "changed_pixel_percent", value: Number(((changedPixels / changeMask.length) * 100).toFixed(2)), unit: "%" },
      ...(areaKm2 != null ? [{ fact: "changed_area_km2", value: Number(areaKm2.toFixed(4)), unit: "km2", extra: { note } } as EvidenceFact] : []),
      { fact: "changed_region_count", value: regions.length },
    ],
    statistics: { changedPixels, totalPixels: changeMask.length, regionCount: regions.length, meanBefore, meanAfter },
    overlay: regionsToOverlay(regions, rasterForOverlay, `${targetLabel}_change`),
    toolAgreement: 1.0,
    modelProbability,
    previewPngs: [
      { name: "t1_preview.png", buffer: preview1 },
      { name: "change_mask.png", buffer: overlayPng },
    ],
  };
}

/** Optical+SAR: explicit joint fusion (never a raw pass-through to a generic VLM). */
export function runOpticalSarTool(optical: RasterData, sar: RasterData, target: string | null): ToolOutput {
  const targetLabel = target ?? "water";
  const dstW = Math.min(optical.width, sar.width);
  const dstH = Math.min(optical.height, sar.height);

  const opticalIdxFull = computeTargetIndex(optical.bands, optical.bandCount, targetLabel);
  const sarIdxFull = computeTargetIndex(sar.bands, sar.bandCount, targetLabel);
  const opticalIdx = resampleNearest(opticalIdxFull.index, optical.width, optical.height, dstW, dstH);
  const sarIdx = resampleNearest(sarIdxFull.index, sar.width, sar.height, dstW, dstH);

  // Explicit joint-analysis fusion step (rule-based fallback fusion, since
  // CROMA weights are not available — see models.ts RuleBasedFusion).
  const fused = new Float64Array(dstW * dstH);
  for (let i = 0; i < fused.length; i++) fused[i] = 0.5 * opticalIdx[i] + 0.5 * sarIdx[i];

  const fusedThreshold = otsuThreshold(fused);
  const fusedMask = thresholdToMask(fused, fusedThreshold);

  const opticalThreshold = otsuThreshold(opticalIdx);
  const sarThreshold = otsuThreshold(sarIdx);
  const opticalMask = thresholdToMask(opticalIdx, opticalThreshold);
  const sarMask = thresholdToMask(sarIdx, sarThreshold);
  const toolAgreement = iou(opticalMask, sarMask);

  const changedPixels = countMaskPixels(fusedMask);
  const regions = connectedComponents(fusedMask, dstW, dstH);
  const modelProbability = computeSeparability(fused, fusedThreshold);

  const resolution = optical.metadata.hasGeoTransform ? optical.metadata.resolution : sar.metadata.resolution;
  const bboxForArea = optical.metadata.hasGeoTransform ? optical.metadata.bbox : sar.metadata.bbox;
  const { areaKm2, note } = computeAreaKm2(changedPixels, resolution, bboxForArea);

  const preview = encodeGrayscalePreview(opticalIdx, dstW, dstH);
  const overlayPng = encodeMaskOverlay(fusedMask, dstW, dstH);
  const rasterForOverlay: RasterData = {
    width: dstW,
    height: dstH,
    bandCount: 1,
    bands: [fused],
    metadata: optical.metadata.hasGeoTransform ? optical.metadata : sar.metadata,
  };

  const coverage = changedPixels / fusedMask.length;
  const answer =
    `Joint optical+SAR fusion (weighted index combination) detects "${targetLabel.replace("_", " ")}" covering ~${(coverage * 100).toFixed(1)}% ` +
    `of the co-registered area` +
    (areaKm2 != null ? ` (~${areaKm2.toFixed(3)} km²).` : ".") +
    ` Optical-only and SAR-only indicators agree on ${(toolAgreement * 100).toFixed(0)}% (IoU) of the flagged area.`;

  return {
    answer,
    facts: [
      { fact: `${targetLabel}_fused_coverage_percent`, value: Number((coverage * 100).toFixed(2)), unit: "%" },
      ...(areaKm2 != null ? [{ fact: `${targetLabel}_fused_area_km2`, value: Number(areaKm2.toFixed(4)), unit: "km2", extra: { note } } as EvidenceFact] : []),
      { fact: "optical_sar_agreement_iou", value: Number(toolAgreement.toFixed(3)) },
      { fact: "fusion_method", value: "weighted(0.5*optical_index + 0.5*sar_index)" },
    ],
    statistics: { changedPixels, totalPixels: fusedMask.length, regionCount: regions.length, toolAgreement },
    overlay: regionsToOverlay(regions, rasterForOverlay, `${targetLabel}_fused`),
    toolAgreement,
    modelProbability,
    previewPngs: [
      { name: "optical_index_preview.png", buffer: preview },
      { name: "fused_mask.png", buffer: overlayPng },
    ],
  };
}
