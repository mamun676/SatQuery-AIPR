import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    const endpoint = process.env.QWEN_MANAGER_ENDPOINT?.replace(/\/+$/, "");
    let qwenManager: "ready" | "unavailable" | "not_configured" =
      "not_configured";
    if (endpoint) {
      try {
        const response = await fetch(`${endpoint}/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(2_000),
        });
        qwenManager = response.ok ? "ready" : "unavailable";
      } catch {
        qwenManager = "unavailable";
      }
    }
    return Response.json({ ok: true, database: "ready", qwenManager });
  } catch {
    return Response.json(
      { ok: false, database: "unavailable" },
      { status: 500 },
    );
  }
}
