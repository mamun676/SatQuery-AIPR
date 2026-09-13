// POST /api/upload — validates and stores one or two co-registered images.
// This is the "input validator" boundary: nothing is analyzed here, only
// inspected and validated (backend/api/routes.py `/api/upload`).
import { randomUUID } from "crypto";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { ensureStorageDirs, saveUpload } from "@/server/satquery/storage";
import { extractFileMeta, validateFiles, type RawUploadFile } from "@/server/satquery/validator";
import type { FileRole } from "@/server/satquery/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_ROLES: FileRole[] = ["single", "optical", "sar", "t1", "t2"];

export async function POST(req: Request) {
  try {
    await ensureStorageDirs();
    const formData = await req.formData();
    const fileEntries = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (fileEntries.length === 0) {
      return Response.json({ error: "No files provided. Attach one or two images under the 'files' field." }, { status: 400 });
    }
    if (fileEntries.length > 2) {
      return Response.json({ error: "At most 2 files are supported per request." }, { status: 400 });
    }

    let roles: string[] = [];
    const rolesRaw = formData.get("roles");
    if (typeof rolesRaw === "string") {
      try {
        roles = JSON.parse(rolesRaw);
      } catch {
        return Response.json({ error: "'roles' must be a JSON array of strings." }, { status: 400 });
      }
    }
    if (roles.length !== fileEntries.length) {
      roles = fileEntries.map((_, i) => (fileEntries.length === 1 ? "single" : i === 0 ? "t1" : "t2"));
    }
    for (const r of roles) {
      if (!VALID_ROLES.includes(r as FileRole)) {
        return Response.json({ error: `Invalid role "${r}". Must be one of ${VALID_ROLES.join(", ")}.` }, { status: 400 });
      }
    }

    const uploadId = randomUUID();
    const rawFiles: RawUploadFile[] = [];
    for (const file of fileEntries) {
      const arrayBuffer = await file.arrayBuffer();
      rawFiles.push({ originalName: file.name, buffer: Buffer.from(arrayBuffer), role: roles[fileEntries.indexOf(file)] as FileRole });
    }

    const fileMetas = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const raw = rawFiles[i];
      const id = randomUUID();
      const storedPath = await saveUpload(uploadId, raw.originalName, raw.buffer);
      const meta = await extractFileMeta(raw, storedPath, id);
      fileMetas.push(meta);
    }

    const validation = validateFiles(fileMetas);

    await db.insert(uploads).values({
      id: uploadId,
      files: fileMetas as unknown as Record<string, unknown>[],
      validation: validation as unknown as Record<string, unknown>,
    });

    return Response.json({
      uploadId,
      validation,
      files: fileMetas.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        format: f.format,
        modality: f.modality,
        role: f.role,
        raster: f.raster,
        warnings: f.warnings,
      })),
    });
  } catch (err) {
    return Response.json({ error: `Upload failed: ${(err as Error).message}` }, { status: 500 });
  }
}
