// GET /api/report/{job_id} — downloadable PDF report.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { isUuid } from "@/server/satquery/ids";
import { generateReportPdf } from "@/server/satquery/reportPdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isUuid(jobId)) {
    return Response.json({ error: `'${jobId}' is not a valid job id.` }, { status: 400 });
  }
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || !job.reportText) {
    return Response.json({ error: `Report for job ${jobId} not found (job may still be running or failed).` }, { status: 404 });
  }
  const pdf = generateReportPdf(job.reportText, jobId);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="satquery-report-${jobId}.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
