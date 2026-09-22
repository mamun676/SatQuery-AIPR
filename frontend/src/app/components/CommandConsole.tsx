"use client";
// ═══════════════════════════════════════════════════════════════════════
// Command dock — the bottom band.
//
// Laid out as a ground-station console rather than a chat panel: ingest slots
// on the left, the query console in the middle, and the server's validation
// verdict on the right. The verdict is deliberately terse — score, mode,
// counts — with the full report (errors, warnings, per-file raster metadata)
// one click away in a sheet, so the dock never grows tall enough to eat the
// imagery stage.
//
// Everything on the right-hand side is the server's own /api/upload response.
// Before an upload exists, nothing is asserted about the staged files beyond
// what the browser can read from them.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import type { UploadOutcome } from "@/lib/api";
import { API_BASE_LABEL } from "@/lib/api";
import { formatDimensions, formatResolution, modeLabel, roleLabel, shortCrs } from "@/lib/format";
import type { InputMode } from "@/server/satquery/types";
import Chip from "./primitives/Chip";
import Icon from "./primitives/Icon";
import Meter from "./primitives/Meter";
import Sheet from "./primitives/Sheet";
import UploadZone, { type PendingFile } from "./UploadZone";
import QueryBox from "./QueryBox";

export interface CommandConsoleProps {
  pending: PendingFile[];
  onPendingChange: (next: PendingFile[]) => void;
  query: string;
  onQueryChange: (next: string) => void;
  onRun: () => void;
  onAbort: () => void;
  running: boolean;
  blockedReason: string | null;
  elapsedMs: number;
  phaseLabel: string | null;
  phaseIsLive: boolean;
  mode: InputMode | null;
  hasResult: boolean;
  /** The last /api/upload response, if the current selection has been sent. */
  upload: UploadOutcome | null;
  /** True when `pending` has changed since `upload` was captured. */
  uploadStale: boolean;
}

export default function CommandConsole({
  pending,
  onPendingChange,
  query,
  onQueryChange,
  onRun,
  onAbort,
  running,
  blockedReason,
  elapsedMs,
  phaseLabel,
  phaseIsLive,
  mode,
  hasResult,
  upload,
  uploadStale,
}: CommandConsoleProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const fresh = upload !== null && !uploadStale;
  const validation = fresh ? upload.validation : null;
  const files = fresh ? upload.files : [];

  const warnings = useMemo(() => {
    const out: string[] = validation ? [...validation.warnings] : [];
    for (const f of files) for (const w of f.warnings) if (!out.includes(w)) out.push(w);
    return out;
  }, [files, validation]);

  const issueCount = (validation?.errors.length ?? 0) + warnings.length;

  return (
    <div className="border-t border-[var(--hair-hi)] bg-[color-mix(in_oklab,var(--color-panel)_72%,transparent)] backdrop-blur">
      <div className="sq-hair" aria-hidden />
      {/* ── LAYOUT CHANGE: 2-column only (imagery ingest | query console) ── */}
      <div className="grid gap-x-4 gap-y-3 px-3 py-3 grid-cols-[minmax(260px,20rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <UploadZone
            pending={pending}
            onChange={onPendingChange}
            disabled={running}
            validated={validation !== null && validation.valid}
          />
        </div>

        <div className="min-w-0">
          <QueryBox
            value={query}
            onChange={onQueryChange}
            onRun={onRun}
            onAbort={onAbort}
            running={running}
            blockedReason={blockedReason}
            elapsedMs={elapsedMs}
            phaseLabel={phaseLabel}
            phaseIsLive={phaseIsLive}
            mode={mode}
            hasResult={hasResult}
          />
        </div>
      </div>

      <Sheet open={detailOpen} onClose={() => setDetailOpen(false)} title="Validation report" height="72vh">
        {validation === null ? (
          <p className="text-[12px] text-[var(--color-ink-3)]">
            No server validation response is available yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <section>
              <h4 className="sq-label-hi">Verdict</h4>
              <p className="mt-1 text-[12px] leading-snug text-[var(--color-ink-2)]">
                {validation.valid
                  ? `Accepted as ${modeLabel(validation.mode)} with a validation score of ${validation.validationScore.toFixed(2)}.`
                  : `Rejected — ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"} must be resolved before the pipeline will run.`}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-[var(--color-ink-4)]">
                The score enters the confidence estimate at weight 0.2. Each error costs 0.5 and each
                warning 0.05, floored at zero.
              </p>
            </section>

            {validation.errors.length > 0 && (
              <section>
                <h4 className="sq-label-hi">Errors</h4>
                <ul className="mt-1 flex flex-col gap-1">
                  {validation.errors.map((e) => (
                    <li key={e} className="flex gap-1.5 text-[12px] leading-snug text-[var(--color-fault)]">
                      <Icon name="fault" size={13} className="mt-[1px] shrink-0" />
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {warnings.length > 0 && (
              <section>
                <h4 className="sq-label-hi">Warnings</h4>
                <ul className="mt-1 flex flex-col gap-1">
                  {warnings.map((w) => (
                    <li key={w} className="flex gap-1.5 text-[12px] leading-snug text-[var(--color-caution)]">
                      <Icon name="warn" size={13} className="mt-[1px] shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h4 className="sq-label-hi">Raster metadata read by the server</h4>
              <ul className="mt-1.5 flex flex-col gap-2.5">
                {files.map((f) => (
                  <li key={f.id} className="sq-panel rounded px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <Icon name="file" size={13} className="shrink-0 text-[var(--color-signal)]" />
                      <span className="min-w-0 flex-1 truncate text-[12px]" title={f.originalName}>
                        {f.originalName}
                      </span>
                      <Chip tone="signal">{roleLabel(f.role)}</Chip>
                      <Chip tone="neutral">{f.modality}</Chip>
                    </div>
                    <dl className="sq-mono mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px] text-[var(--color-ink-4)] sm:grid-cols-3">
                      <div className="flex justify-between gap-2">
                        <dt>size</dt>
                        <dd className="text-[var(--color-ink-2)]">
                          {formatDimensions(f.raster.width, f.raster.height)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>bands</dt>
                        <dd className="text-[var(--color-ink-2)]">{f.raster.bandCount ?? "—"}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>gsd</dt>
                        <dd className="text-[var(--color-ink-2)]">{formatResolution(f.raster.resolution)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>crs</dt>
                        <dd className="truncate text-[var(--color-ink-2)]">{shortCrs(f.raster.crs) ?? "none"}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>geotransform</dt>
                        <dd className={f.raster.hasGeoTransform ? "text-[var(--color-verified)]" : "text-[var(--color-caution)]"}>
                          {f.raster.hasGeoTransform ? "present" : "absent"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>sensor</dt>
                        <dd className="truncate text-[var(--color-ink-2)]">{f.raster.sensor ?? "unreported"}</dd>
                      </div>
                    </dl>
                    {f.warnings.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {f.warnings.map((w) => (
                          <li key={w} className="text-[10.5px] leading-snug text-[var(--color-caution)]">
                            · {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </Sheet>
    </div>
  );
}