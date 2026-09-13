// GET /api/files/<relative storage path> — serves generated previews/masks
// from the local storage/ directory (see server/satquery/storage.ts). This
// is the local-filesystem stand-in for what would be a signed S3 URL in
// production.
import { readFileBuffer, resolveStorageRelative } from "@/server/satquery/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function contentTypeFor(filename: string): string {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const relative = segments.join("/");
  const fullPath = resolveStorageRelative(relative);
  if (!fullPath) {
    return Response.json({ error: "Invalid path." }, { status: 400 });
  }
  try {
    const buffer = await readFileBuffer(fullPath);
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": contentTypeFor(fullPath) } });
  } catch {
    return Response.json({ error: "File not found." }, { status: 404 });
  }
}
