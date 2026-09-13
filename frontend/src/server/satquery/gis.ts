// GIS / raster processing layer.
//
// Mirrors backend/gis/processor.py + backend/gis/overlay_generator.py from
// the reference architecture. This is the ONLY place in the system allowed
// to produce quantitative spatial numbers (pixel counts, areas, bounding
// boxes, coordinates). The LLM synthesis layer is never allowed to invent
// these numbers — it may only restate values computed here.
import { fromArrayBuffer } from "geotiff";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import type { RasterFormat, RasterMetadata } from "./types";

export interface RasterData {
  width: number;
  height: number;
  bandCount: number;
  bands: Float64Array[]; // one Float64Array per band, row-major
  metadata: RasterMetadata;
}

export interface Region {
  pixelCount: number;
  bbox: [number, number, number, number]; // x0,y0,x1,y1 inclusive
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export function detectFormat(filename: string, buffer: Buffer): RasterFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const magic = buffer.subarray(0, 4);
  const isTiff =
    (magic[0] === 0x49 && magic[1] === 0x49 && magic[2] === 0x2a && magic[3] === 0x00) ||
    (magic[0] === 0x4d && magic[1] === 0x4d && magic[2] === 0x00 && magic[3] === 0x2a);
  const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
  const isJpeg = magic[0] === 0xff && magic[1] === 0xd8;
  if (isTiff) return ext === "tif" || ext === "tiff" ? "GeoTIFF" : "TIFF";
  if (isPng) return "PNG";
  if (isJpeg) return "JPEG";
  return "unknown";
}

const EPSG_TO_UNIT: Record<number, "degree" | "meter"> = {
  4326: "degree",
  4269: "degree",
};

/** Read a raster file (GeoTIFF/TIFF/PNG/JPEG) into typed per-band arrays + metadata. */
export async function readRaster(buffer: Buffer, format: RasterFormat): Promise<RasterData> {
  if (format === "GeoTIFF" || format === "TIFF") {
    return readGeoTiff(buffer);
  }
  if (format === "PNG") {
    return readPng(buffer);
  }
  if (format === "JPEG") {
    return readJpeg(buffer);
  }
  throw new Error(`Unsupported raster format: ${format}`);
}

async function readGeoTiff(buffer: Buffer): Promise<RasterData> {
  const tiff = await fromArrayBuffer(toArrayBuffer(buffer));
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bandCount = image.getSamplesPerPixel();
  const rasters = await image.readRasters();

  const bands: Float64Array[] = [];
  for (let b = 0; b < bandCount; b++) {
    const src = (rasters as unknown as ArrayLike<number>[])[b];
    bands.push(Float64Array.from(src));
  }

  let bbox: [number, number, number, number] | null = null;
  let hasGeoTransform = false;
  let crs: string | null = null;
  let resolution: { x: number | null; y: number | null; unit: string | null } = {
    x: null,
    y: null,
    unit: null,
  };

  try {
    const bb = image.getBoundingBox();
    if (bb && bb.every((v) => Number.isFinite(v))) {
      bbox = [bb[0], bb[1], bb[2], bb[3]];
      hasGeoTransform = true;
    }
  } catch {
    /* no geo transform present — plain TIFF */
  }

  try {
    const res = image.getResolution();
    if (res && Number.isFinite(res[0]) && Number.isFinite(res[1])) {
      resolution = { x: Math.abs(res[0]), y: Math.abs(res[1]), unit: null };
    }
  } catch {
    /* ignore */
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoKeys = (image as any).geoKeys as Record<string, number> | undefined;
    const epsg = geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? null;
    if (epsg && epsg > 0 && epsg < 32767) {
      crs = `EPSG:${epsg}`;
      resolution.unit = EPSG_TO_UNIT[epsg] ?? "meter";
    }
  } catch {
    /* ignore */
  }

  let acquisitionDate: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fd = (image as any).fileDirectory as Record<string, unknown> | undefined;
    const dt = fd?.DateTime as string | undefined;
    if (dt) acquisitionDate = dt;
  } catch {
    /* ignore */
  }

  const metadata: RasterMetadata = {
    width,
    height,
    bandCount,
    crs,
    resolution,
    bbox,
    acquisitionDate,
    sensor: bandCount === 1 ? "unknown-single-band (possibly SAR/panchromatic)" : "unknown-multiband (possibly optical)",
    hasGeoTransform,
  };

  return { width, height, bandCount, bands, metadata };
}

function readPng(buffer: Buffer): RasterData {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png; // RGBA Uint8Array
  const bandCount = 3;
  const bands = [new Float64Array(width * height), new Float64Array(width * height), new Float64Array(width * height)];
  for (let i = 0; i < width * height; i++) {
    bands[0][i] = data[i * 4];
    bands[1][i] = data[i * 4 + 1];
    bands[2][i] = data[i * 4 + 2];
  }
  const metadata: RasterMetadata = {
    width,
    height,
    bandCount,
    crs: null,
    resolution: { x: null, y: null, unit: null },
    bbox: null,
    acquisitionDate: null,
    sensor: "unknown (non-georeferenced RGB)",
    hasGeoTransform: false,
  };
  return { width, height, bandCount, bands, metadata };
}

function readJpeg(buffer: Buffer): RasterData {
  const decoded = jpeg.decode(buffer, { useTArray: true });
  const { width, height, data } = decoded;
  const bandCount = 3;
  const bands = [new Float64Array(width * height), new Float64Array(width * height), new Float64Array(width * height)];
  for (let i = 0; i < width * height; i++) {
    bands[0][i] = data[i * 4];
    bands[1][i] = data[i * 4 + 1];
    bands[2][i] = data[i * 4 + 2];
  }
  const metadata: RasterMetadata = {
    width,
    height,
    bandCount,
    crs: null,
    resolution: { x: null, y: null, unit: null },
    bbox: null,
    acquisitionDate: null,
    sensor: "unknown (non-georeferenced RGB)",
    hasGeoTransform: false,
  };
  return { width, height, bandCount, bands, metadata };
}

export function basicStats(band: Float64Array): { mean: number; std: number; min: number; max: number } {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / band.length;
  let variance = 0;
  for (let i = 0; i < band.length; i++) {
    variance += (band[i] - mean) ** 2;
  }
  variance /= band.length;
  return { mean, std: Math.sqrt(variance), min, max };
}

/** Otsu's method: deterministic global threshold from a histogram of scores. */
export function otsuThreshold(values: Float64Array): number {
  const bins = 256;
  const { min, max } = basicStats(values);
  if (max === min) return min;
  const hist = new Array(bins).fill(0);
  const scale = (bins - 1) / (max - min);
  for (let i = 0; i < values.length; i++) {
    hist[Math.round((values[i] - min) * scale)]++;
  }
  const total = values.length;
  let sum = 0;
  for (let t = 0; t < bins; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 0;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    // Use >= so that ties (e.g. sparse/bimodal histograms with empty bins
    // between two clusters) resolve to the LATEST bin achieving max
    // separation, placing the threshold just below the upper cluster
    // instead of coinciding with the lower cluster's own value.
    if (between >= maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return min + threshold / scale;
}

/** Normalize a band to 0..1 using min-max scaling. */
export function normalize(band: Float64Array): Float64Array {
  const { min, max } = basicStats(band);
  const range = max - min || 1;
  const out = new Float64Array(band.length);
  for (let i = 0; i < band.length; i++) out[i] = (band[i] - min) / range;
  return out;
}

/**
 * Compute a per-pixel "target-likeness" index for a given semantic concept.
 * These are explicit, documented, deterministic proxy heuristics used only
 * because no pretrained remote-sensing model weights are available in this
 * environment (see backend/models for the real-model integration boundary).
 */
export function computeTargetIndex(
  bands: Float64Array[],
  bandCount: number,
  target: string,
): { index: Float64Array; method: string } {
  const size = bands[0].length;
  const t = (target || "").toLowerCase();

  if (bandCount === 1) {
    // Single-band: typically SAR backscatter or panchromatic.
    const norm = normalize(bands[0]);
    if (t.includes("water") || t.includes("flood")) {
      // Calm water => low backscatter/intensity => invert.
      const idx = new Float64Array(size);
      for (let i = 0; i < size; i++) idx[i] = 1 - norm[i];
      return { index: idx, method: "single-band inverted intensity (low value ~ water/calm surface)" };
    }
    return { index: norm, method: "single-band normalized intensity (high value ~ built-up/rough surface)" };
  }

  if (bandCount >= 4) {
    // Assume band order [R, G, B, NIR, ...] — common 4-band optical convention.
    const red = bands[0];
    const green = bands[1];
    const nir = bands[3];
    if (t.includes("water") || t.includes("flood")) {
      const idx = new Float64Array(size);
      for (let i = 0; i < size; i++) {
        const denom = green[i] + nir[i] || 1;
        idx[i] = (green[i] - nir[i]) / denom; // NDWI
      }
      return { index: normalize(idx), method: "NDWI = (Green-NIR)/(Green+NIR); assumes band order R,G,B,NIR" };
    }
    if (t.includes("veget") || t.includes("forest") || t.includes("crop") || t.includes("agricult")) {
      const idx = new Float64Array(size);
      for (let i = 0; i < size; i++) {
        const denom = nir[i] + red[i] || 1;
        idx[i] = (nir[i] - red[i]) / denom; // NDVI
      }
      return { index: normalize(idx), method: "NDVI = (NIR-Red)/(NIR+Red); assumes band order R,G,B,NIR" };
    }
    // built-up / generic bright & low-vegetation proxy
    const idx = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const ndvi = (nir[i] - red[i]) / (nir[i] + red[i] || 1);
      const brightness = (red[i] + green[i] + bands[2][i]) / 3;
      idx[i] = normalizeScalar(brightness, 0, 255) * (1 - Math.max(0, ndvi));
    }
    return { index: normalize(idx), method: "brightness x (1-NDVI) built-up proxy; assumes band order R,G,B,NIR" };
  }

  // 3-band RGB or 2-band: use brightness / channel-dominance proxies.
  const r = bands[0];
  const g = bands[1];
  const b = bands[Math.min(2, bandCount - 1)];
  const idx = new Float64Array(size);
  if (t.includes("water") || t.includes("flood")) {
    for (let i = 0; i < size; i++) {
      const brightness = (r[i] + g[i] + b[i]) / 3;
      idx[i] = normalizeScalar(b[i] - brightness, -128, 128); // blue dominance ~ water
    }
    return { index: normalize(idx), method: "blue-channel dominance proxy (no NIR band available)" };
  }
  if (t.includes("veget") || t.includes("forest") || t.includes("crop")) {
    for (let i = 0; i < size; i++) {
      idx[i] = g[i] - r[i]; // greenness
    }
    return { index: normalize(idx), method: "green-red greenness proxy (no NIR band available)" };
  }
  for (let i = 0; i < size; i++) idx[i] = (r[i] + g[i] + b[i]) / 3;
  return { index: normalize(idx), method: "RGB brightness proxy" };
}

function normalizeScalar(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

/**
 * Otsu's between-class variance ratio (eta): a deterministic 0..1 measure of
 * how well-separated the two classes are around `threshold`. Used as a
 * heuristic stand-in for "model probability" in the confidence formula —
 * it is a real statistical property of the pixel distribution, not an
 * invented number, but it is explicitly NOT a calibrated ML probability.
 */
export function computeSeparability(values: Float64Array, threshold: number): number {
  let sumA = 0;
  let sumB = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= threshold) {
      sumA += values[i];
      nA++;
    } else {
      sumB += values[i];
      nB++;
    }
  }
  if (nA === 0 || nB === 0) return 0.5;
  const meanA = sumA / nA;
  const meanB = sumB / nB;
  const grandMean = (sumA + sumB) / (nA + nB);
  let totalVar = 0;
  for (let i = 0; i < values.length; i++) totalVar += (values[i] - grandMean) ** 2;
  const betweenVar = nA * (meanA - grandMean) ** 2 + nB * (meanB - grandMean) ** 2;
  if (totalVar === 0) return 0.5;
  return Math.max(0, Math.min(1, betweenVar / totalVar));
}

export function iou(maskA: Uint8Array, maskB: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < maskA.length; i++) {
    const a = maskA[i] === 1;
    const b = maskB[i] === 1;
    if (a || b) union++;
    if (a && b) intersection++;
  }
  if (union === 0) return 1; // both empty => trivially agree
  return intersection / union;
}

export function thresholdToMask(index: Float64Array, threshold: number, above = true): Uint8Array {
  const mask = new Uint8Array(index.length);
  for (let i = 0; i < index.length; i++) {
    mask[i] = (above ? index[i] >= threshold : index[i] < threshold) ? 1 : 0;
  }
  return mask;
}

/** 4-connectivity connected-component labeling returning bounding boxes, largest first. */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minSize = 16,
  maxRegions = 20,
): Region[] {
  const visited = new Uint8Array(mask.length);
  const regions: Region[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || visited[start]) continue;
    stack.push(start);
    visited[start] = 1;
    let count = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      count++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
      for (const n of neighbors) {
        if (n < 0 || n >= mask.length) continue;
        if (n % width === 0 && idx % width === width - 1) continue;
        if (idx % width === 0 && n % width === width - 1) continue;
        if (mask[n] === 1 && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    if (count >= minSize) {
      regions.push({ pixelCount: count, bbox: [x0, y0, x1, y1] });
    }
  }

  regions.sort((a, b) => b.pixelCount - a.pixelCount);
  return regions.slice(0, maxRegions);
}

export function countMaskPixels(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return count;
}

/**
 * Convert pixel count -> area. If resolution/CRS are unknown, returns null
 * and the caller must surface a warning rather than fabricate a number.
 */
export function computeAreaKm2(
  pixelCount: number,
  resolution: { x: number | null; y: number | null; unit: string | null },
  bbox: [number, number, number, number] | null,
): { areaKm2: number | null; note: string } {
  if (!resolution.x || !resolution.y) {
    return { areaKm2: null, note: "resolution unavailable — area could not be computed" };
  }
  if (resolution.unit === "degree") {
    const lat = bbox ? (bbox[1] + bbox[3]) / 2 : 0;
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
    const pixelAreaM2 = resolution.x * metersPerDegLon * (resolution.y * metersPerDegLat);
    return {
      areaKm2: (pixelCount * pixelAreaM2) / 1_000_000,
      note: `approximated from degree resolution at latitude ${lat.toFixed(2)}`,
    };
  }
  const pixelAreaM2 = resolution.x * resolution.y;
  return { areaKm2: (pixelCount * pixelAreaM2) / 1_000_000, note: "computed from projected resolution (meters)" };
}

export function pixelBoxToGeoBox(
  box: [number, number, number, number],
  width: number,
  height: number,
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = bbox;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const geoMinX = minX + box[0] * resX;
  const geoMaxX = minX + (box[2] + 1) * resX;
  const geoMaxY = maxY - box[1] * resY;
  const geoMinY = maxY - (box[3] + 1) * resY;
  return [geoMinX, geoMinY, geoMaxX, geoMaxY];
}

/** Nearest-neighbor resample so two rasters of different size can be fused pixel-wise. */
export function resampleNearest(band: Float64Array, srcW: number, srcH: number, dstW: number, dstH: number): Float64Array {
  const out = new Float64Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      out[y * dstW + x] = band[sy * srcW + sx];
    }
  }
  return out;
}

/** Encode a grayscale preview (band 0, normalized) as a PNG buffer. */
export function encodeGrayscalePreview(band: Float64Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  const norm = normalize(band);
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(norm[i] * 255);
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Encode a mask as a semi-transparent red overlay PNG buffer (RGBA). */
export function encodeMaskOverlay(mask: Uint8Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    if (mask[i] === 1) {
      png.data[i * 4] = 239;
      png.data[i * 4 + 1] = 68;
      png.data[i * 4 + 2] = 68;
      png.data[i * 4 + 3] = 150;
    } else {
      png.data[i * 4] = 0;
      png.data[i * 4 + 1] = 0;
      png.data[i * 4 + 2] = 0;
      png.data[i * 4 + 3] = 0;
    }
  }
  return PNG.sync.write(png);
}
