// Storage abstraction (backend/config: local filesystem today, S3-ready later).
//
// Every function here is the only place that touches the filesystem so that
// swapping to an S3-backed implementation later means editing this file only.
import { promises as fs } from "fs";
import path from "path";

const STORAGE_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "storage");

export const STORAGE_DIRS = {
  uploads: path.join(STORAGE_ROOT, "uploads"),
  processed: path.join(STORAGE_ROOT, "processed"),
  masks: path.join(STORAGE_ROOT, "masks"),
  reports: path.join(STORAGE_ROOT, "reports"),
  traces: path.join(STORAGE_ROOT, "traces"),
};

export async function ensureStorageDirs(): Promise<void> {
  await Promise.all(Object.values(STORAGE_DIRS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function saveUpload(uploadId: string, filename: string, buffer: Buffer): Promise<string> {
  const dir = path.join(STORAGE_DIRS.uploads, uploadId);
  await fs.mkdir(dir, { recursive: true });
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fullPath = path.join(dir, safeName);
  await fs.writeFile(fullPath, buffer);
  return fullPath;
}

export async function saveDerived(
  kind: "processed" | "masks" | "reports" | "traces",
  jobId: string,
  filename: string,
  data: Buffer | string,
): Promise<string> {
  const dir = path.join(STORAGE_DIRS[kind], jobId);
  await fs.mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, data);
  return fullPath;
}

export async function readFileBuffer(fullPath: string): Promise<Buffer> {
  return fs.readFile(fullPath);
}

/** Resolve a storage-relative path (e.g. "masks/<jobId>/preview.png") safely. */
export function resolveStorageRelative(relativePath: string): string | null {
  const resolved = path.normalize(path.join(STORAGE_ROOT, relativePath));
  if (!resolved.startsWith(STORAGE_ROOT)) return null;
  return resolved;
}

export function toStorageRelative(fullPath: string): string {
  return path.relative(STORAGE_ROOT, fullPath).split(path.sep).join("/");
}
