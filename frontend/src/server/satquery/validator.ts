// Input validator — the gatekeeper (backend/validator/input_validator.py +
// metadata_extractor.py in the reference architecture).
//
// Nothing downstream (query understanding, controller, tools) runs unless
// this module returns `valid: true`.
import { detectFormat, readRaster } from "./gis";
import type {
  FileRole,
  Modality,
  UploadedFileMeta,
  ValidationResult,
  InputMode,
} from "./types";

const ALLOWED_EXTENSIONS = new Set(["tif", "tiff", "png", "jpg", "jpeg"]);
const MAX_FILES = 2;

export interface RawUploadFile {
  originalName: string;
  buffer: Buffer;
  role: FileRole;
}

function inferModality(
  role: FileRole,
  bandCount: number | null,
  filename: string,
): Modality {
  const lower = filename.toLowerCase();
  if (
    role === "sar" ||
    lower.includes("sar") ||
    lower.includes("sentinel-1") ||
    lower.includes("s1")
  )
    return "sar";
  if (bandCount === 1 || bandCount === 2) return "sar"; // Sentinel-1 VV/VH is two-band; one-band remains a SAR/panchromatic candidate
  if (bandCount && bandCount >= 4) return "multispectral";
  return "optical";
}

/** Extract metadata + build an UploadedFileMeta for a single raw file. */
export async function extractFileMeta(
  file: RawUploadFile,
  storedPath: string,
  id: string,
): Promise<UploadedFileMeta> {
  const warnings: string[] = [];
  const ext = file.originalName.toLowerCase().split(".").pop() ?? "";
  const format = detectFormat(file.originalName, file.buffer);

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    warnings.push(
      `Unrecognized file extension ".${ext}" — proceeding based on detected magic bytes (${format}).`,
    );
  }
  if (format === "unknown") {
    warnings.push(
      "Could not detect a supported raster format from file contents.",
    );
  }

  let raster;
  try {
    const data = await readRaster(
      file.buffer,
      format === "unknown" ? "PNG" : format,
    );
    raster = data.metadata;
    if (
      !raster.hasGeoTransform &&
      (format === "GeoTIFF" || format === "TIFF")
    ) {
      warnings.push(
        "Raster has no embedded geotransform/CRS — spatial coordinates will be reported in pixel space only.",
      );
    }
    if (!raster.acquisitionDate) {
      warnings.push("No acquisition date found in file metadata.");
    }
  } catch (err) {
    warnings.push(`Failed to parse raster contents: ${(err as Error).message}`);
    raster = {
      width: null,
      height: null,
      bandCount: null,
      crs: null,
      resolution: { x: null, y: null, unit: null },
      bbox: null,
      acquisitionDate: null,
      sensor: null,
      hasGeoTransform: false,
    };
  }

  const modality = inferModality(
    file.role,
    raster.bandCount,
    file.originalName,
  );

  return {
    id,
    originalName: file.originalName,
    storedPath,
    sizeBytes: file.buffer.byteLength,
    format,
    modality,
    role: file.role,
    raster,
    warnings,
  };
}

function determineMode(files: UploadedFileMeta[]): InputMode | null {
  if (files.length === 1) return "single_image";
  if (files.length === 2) {
    const roles = files.map((f) => f.role);
    if (roles.includes("t1") && roles.includes("t2")) return "bitemporal";
    if (roles.includes("optical") && roles.includes("sar"))
      return "optical_sar";
    const modalities = new Set(files.map((f) => f.modality));
    if (
      modalities.has("sar") &&
      (modalities.has("optical") || modalities.has("multispectral"))
    )
      return "optical_sar";
    return "bitemporal"; // two same-modality images default to bitemporal comparison
  }
  return null;
}

export function validateFiles(files: UploadedFileMeta[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (files.length === 0) {
    errors.push("No files were provided.");
  }
  if (files.length > MAX_FILES) {
    errors.push(
      `Too many files (${files.length}). SatQuery AI supports at most ${MAX_FILES} co-registered images per request.`,
    );
  }

  for (const f of files) {
    warnings.push(...f.warnings.map((w) => `${f.originalName}: ${w}`));
    if (f.format === "unknown") {
      errors.push(`${f.originalName}: unsupported/undetectable raster format.`);
    }
    if (f.raster.width == null || f.raster.height == null) {
      errors.push(
        `${f.originalName}: raster could not be read (corrupted or unsupported).`,
      );
    }
  }

  const mode = files.length > 0 ? determineMode(files) : null;

  if (files.length === 2) {
    const [a, b] = files;
    if (
      a.raster.width &&
      b.raster.width &&
      a.raster.height &&
      b.raster.height
    ) {
      const ratioW = a.raster.width / b.raster.width;
      const ratioH = a.raster.height / b.raster.height;
      if (ratioW < 0.5 || ratioW > 2 || ratioH < 0.5 || ratioH > 2) {
        warnings.push(
          `Image pair dimensions differ substantially (${a.raster.width}x${a.raster.height} vs ${b.raster.width}x${b.raster.height}); will be resampled to a common grid for joint analysis.`,
        );
      }
    }
    if (a.raster.crs && b.raster.crs && a.raster.crs !== b.raster.crs) {
      const message = `Image pair uses different CRS (${a.raster.crs} vs ${b.raster.crs}).`;
      if (mode === "optical_sar") {
        errors.push(
          `${message} Optical+SAR fusion requires a co-registered pair in the same CRS.`,
        );
      } else {
        warnings.push(`${message} Results may be spatially approximate.`);
      }
    }
    if (
      mode === "bitemporal" &&
      a.raster.acquisitionDate &&
      b.raster.acquisitionDate &&
      a.raster.acquisitionDate === b.raster.acquisitionDate
    ) {
      warnings.push(
        "Both images report the same acquisition date — bi-temporal change analysis may not be meaningful.",
      );
    }
    if (mode === "optical_sar") {
      const optical =
        files.find((file) => file.role === "optical") ??
        files.find((file) => file.modality !== "sar");
      const sar =
        files.find((file) => file.role === "sar") ??
        files.find((file) => file.modality === "sar");
      if (!optical || !sar || optical.id === sar.id) {
        errors.push(
          "Optical+SAR fusion requires one file assigned Optical and one assigned SAR.",
        );
      } else {
        if ((optical.raster.bandCount ?? 0) < 3) {
          errors.push(
            `${optical.originalName}: optical input requires at least three bands.`,
          );
        }
        if (sar.raster.bandCount !== 2) {
          errors.push(
            `${sar.originalName}: TerraMind Sentinel-1 GRD input requires exactly two bands ordered VV, VH.`,
          );
        }
        if (sar.format !== "GeoTIFF" && sar.format !== "TIFF") {
          errors.push(
            `${sar.originalName}: Sentinel-1 GRD input must be a two-band GeoTIFF/TIFF.`,
          );
        }
        if (!optical.raster.hasGeoTransform || !sar.raster.hasGeoTransform) {
          warnings.push(
            "Optical+SAR geospatial co-registration cannot be verified because one or both files lack an embedded transform/CRS; inference will be treated as pixel-space only.",
          );
        }
        const opticalBox = optical.raster.bbox;
        const sarBox = sar.raster.bbox;
        if (opticalBox && sarBox && optical.raster.crs === sar.raster.crs) {
          const overlaps =
            Math.max(opticalBox[0], sarBox[0]) <
              Math.min(opticalBox[2], sarBox[2]) &&
            Math.max(opticalBox[1], sarBox[1]) <
              Math.min(opticalBox[3], sarBox[3]);
          if (!overlaps) {
            errors.push(
              "Optical and SAR raster bounds do not overlap; a co-registered pair is required.",
            );
          }
        }
      }
    }
  }

  const validationScore = Math.max(
    0,
    1 - errors.length * 0.5 - warnings.length * 0.05,
  );

  return {
    valid: errors.length === 0,
    mode,
    files: files.length,
    modalities: [...new Set(files.map((f) => f.modality))],
    format: files[0]?.format ?? null,
    crs: files[0]?.raster.crs ?? null,
    errors,
    warnings,
    validationScore,
  };
}
