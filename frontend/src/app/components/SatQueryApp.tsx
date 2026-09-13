"use client";
// ═════════════════════════════════════════════════════════════════════════
// Orchestrator.
//
// Owns every piece of run state and passes only real values down: the upload
// response, the analysis result, the client-measured elapsed time, and
// whether the backend actually streamed stage transitions. Three rules:
//
//   1. No optimistic UI. A panel appears when its data exists, not before.
//   2. Aborts are real — the AbortController cancels the in-flight fetch and
//      the UI returns to the pre-run state rather than pretending to stop.
//   3. Failures surface the backend's own message plus an actionable hint,
//      and never leave a stale result on screen next to a new error.
// ═════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FullAnalysis, HealthReport, JobStatus, RunPhase, UploadOutcome } from "@/lib/api";
import { describeError, probeHealth, runFullAnalysis } from "@/lib/api";
import { readSpatial, summariseProvenance } from "@/lib/evidence";
import { useElapsed, useMediaQuery } from "@/lib/motion";
import type { RasterFormat } from "@/server/satquery/types";
import Icon from "./primitives/Icon";
import AnalysisRail from "./AnalysisRail";
import MissionBar from "./MissionBar";
import CommandConsole from "./CommandConsole";
import ViewportStage from "./ViewportStage";
import type { StagedPreview } from "./ViewportStage";
import { extensionOf, type PendingFile } from "./UploadZone";

/** Formats the browser can decode for the staged-frame inspector. */
const DECODABLE = new Set(["png", "jpg", "jpeg"]);

const FORMAT_BY_EXT: Record<string, RasterFormat> = {
  tif: "GeoTIFF",
  tiff: "TIFF",
  png: "PNG",
  jpg: "JPEG",
  jpeg: "JPEG",
};

interface RunError {
  message: string;
  hint: string;
  detail: string | null;
}

export default function SatQueryApp() {
  // ── ingestion ──────────────────────────────────────────────────────────
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [query, setQuery] = useState("");

  // ── run state ──────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<RunPhase | null>(null);
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);
  const [phaseIsLive, setPhaseIsLive] = useState(false);
  const [statusWasLive, setStatusWasLive] = useState(false);
  const [lastRunMs, setLastRunMs] = useState<number | null>(null);

  // ── results ────────────────────────────────────────────────────────────
  const [result, setResult] = useState<FullAnalysis | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [uploadKey, setUploadKey] = useState<string | null>(null);
  const [uploadOutcome, setUploadOutcome] = useState<UploadOutcome | null>(null);
  const [error, setError] = useState<RunError | null>(null);

  // ── service + view ─────────────────────────────────────────────────────
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [probing, setProbing] = useState(true);
  const [activeBox, setActiveBox] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const elapsed = useElapsed(running);
  const stacked = useMediaQuery("(max-width: 1099px)");

  // Signature of the current selection, used to tell a stale upload from a
  // fresh one without comparing File objects.
  const pendingKey = useMemo(
    () => pending.map((p) => `${p.file.name}:${p.file.size}:${p.role}`).join("|"),
    [pending],
  );
  const uploadStale = uploadOutcome !== null && uploadKey !== pendingKey;

  // ── staged previews ────────────────────────────────────────────────────
  // Object URLs are minted per selection and revoked when it changes, so the
  // inspector never holds a reference to a file the operator removed.
  const [previews, setPreviews] = useState<StagedPreview[]>([]);
  useEffect(() => {
    const made: StagedPreview[] = pending.map((p, i) => {
      const ext = extensionOf(p.file.name);
      const decodable = DECODABLE.has(ext);
      return {
        key: `${p.file.name}-${p.file.size}-${i}`,
        name: p.file.name,
        role: p.role,
        sizeBytes: p.file.size,
        url: decodable ? URL.createObjectURL(p.file) : null,
        format: FORMAT_BY_EXT[ext] ?? "unknown",
        dimensions: null,
        modality: null,
      };
    });
    setPreviews(made);
    return () => {
      for (const m of made) if (m.url) URL.revokeObjectURL(m.url);
    };
  }, [pending]);

  // Server-read metadata is folded in once the upload has been validated, so
  // the inspector shows real dimensions instead of whatever the browser guessed.
  const staged = useMemo<StagedPreview[]>(() => {
    if (!uploadOutcome || uploadStale) return previews;
    return previews.map((p, i) => {
      const f = uploadOutcome.files[i];
      if (!f) return p;
      return {
        ...p,
        role: f.role,
        format: f.format,
        modality: f.modality,
        dimensions: { width: f.raster.width, height: f.raster.height },
      };
    });
  }, [previews, uploadOutcome, uploadStale]);

  // ── service probe ──────────────────────────────────────────────────────
  const recheck = useCallback(async () => {
    setProbing(true);
    const report = await probeHealth();
    setHealth(report);
    setProbing(false);
  }, []);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  // On a stacked layout the analysis section starts collapsed: before a result
  // exists the ingestion dock is what the operator needs, and an empty rail
  // would only steal vertical space. Runs once, so a manual toggle always wins.
  const stackedInitRef = useRef(false);
  useEffect(() => {
    if (!stacked || stackedInitRef.current) return;
    stackedInitRef.current = true;
    if (!result) setRailOpen(false);
  }, [result, stacked]);

  // Reveal the stacked analysis section when a new job lands on it.
  const lastJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (!result) return;
    if (lastJobRef.current === result.jobId) return;
    lastJobRef.current = result.jobId;
    if (stacked) setRailOpen(true);
  }, [result, stacked]);

  // ── the run ────────────────────────────────────────────────────────────
  const blockedReason = useMemo(() => {
    if (pending.length === 0) return "Stage at least one raster to run an analysis.";
    if (query.trim() === "") return "Enter a question about the staged imagery.";
    if (health !== null && !health.ok) {
      return `The analysis service at ${health.base} is not responding. Start the backend, then re-probe.`;
    }
    return null;
  }, [health, pending.length, query]);

  const run = useCallback(async () => {
    if (running || blockedReason) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();

    setRunning(true);
    setError(null);
    setResult(null);
    setJobStatus(null);
    setActiveBox(null);
    setPhase("uploading");
    setPhaseLabel("Transferring imagery to the analysis service");
    setPhaseIsLive(false);
    setStatusWasLive(false);
    setLastRunMs(null);

    try {
      const outcome = await runFullAnalysis(
        pending.map((p) => ({ file: p.file, role: p.role })),
        query.trim(),
        {
          signal: controller.signal,
          onProgress: (p) => {
            setPhase(p.phase);
            setPhaseLabel(p.message);
            setPhaseIsLive(p.statusIsLive);
          },
        },
      );
      setUploadOutcome(outcome.upload);
      setUploadKey(pendingKey);
      setJobStatus(outcome.status);
      setResult(outcome.result);
      setStatusWasLive(outcome.statusWasLive);
      setLastRunMs(performance.now() - startedAt);
    } catch (err) {
      const apiErr = describeError(err);
      if (apiErr.kind === "aborted") {
        setPhase(null);
        setPhaseLabel(null);
      } else {
        setError({ message: apiErr.message, hint: apiErr.hint, detail: apiErr.detail });
        setLastRunMs(performance.now() - startedAt);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [blockedReason, pending, pendingKey, query, running]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ── derived reads ──────────────────────────────────────────────────────
  const spatial = useMemo(() => {
    if (!result) return null;
    const firstFile = uploadOutcome && !uploadStale ? uploadOutcome.files[0] : undefined;
    return readSpatial(result.evidence?.overlay ?? null, firstFile?.raster ?? null);
  }, [result, uploadOutcome, uploadStale]);

  const provenance = useMemo(
    () => (result ? summariseProvenance(result.modelsUsed).headline : null),
    [result],
  );

  const useExample = useCallback((example: string) => {
    setQuery(example);
    const el = document.getElementById("sq-query");
    if (el instanceof HTMLTextAreaElement) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  // Collapsing unmounts the rail rather than shrinking it to zero width, so a
  // hidden column never lingers in the accessibility tree.
  const showRail = railOpen;

  return (
    <div className="sq-app" data-rail={railOpen ? "open" : "closed"}>
      <div className="sq-vignette" aria-hidden />
      <div className="sq-grat" aria-hidden />

      <div className="sq-area-bar relative z-20">
        <MissionBar
          health={health}
          probing={probing}
          onRecheck={recheck}
          running={running}
          phase={phase}
          phaseLabel={phaseLabel}
          phaseIsLive={phaseIsLive}
          elapsedMs={elapsed}
          jobId={result?.jobId ?? null}
          jobStatus={jobStatus?.status ?? result?.status ?? null}
          provenance={provenance}
          railOpen={railOpen}
          onRailToggle={() => setRailOpen((v) => !v)}
          stacked={stacked}
        />
      </div>

      <main className="sq-area-stage relative z-10 min-w-0 overflow-hidden p-3">
        <ViewportStage
          result={result}
          spatial={spatial}
          running={running}
          runningLabel={phaseLabel}
          staged={staged}
          health={health}
          probing={probing}
          onRecheck={recheck}
          onUseExample={useExample}
          activeBox={activeBox}
          onActiveBoxChange={setActiveBox}
        />
      </main>

      {showRail && (
        <aside className="sq-area-rail relative z-10" aria-label="Analysis">
          <AnalysisRail
            result={result}
            spatial={spatial}
            running={running}
            lastRunMs={lastRunMs}
            statusWasLive={statusWasLive}
            activeBox={activeBox}
            onActiveBoxChange={setActiveBox}
          />
        </aside>
      )}

      <div className="sq-area-dock relative z-20">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border-t border-[var(--color-fault)] bg-[color-mix(in_oklab,var(--color-fault)_9%,transparent)] px-3 py-2"
          >
            <Icon name="fault" size={14} className="mt-[2px] shrink-0 text-[var(--color-fault)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-snug text-[var(--color-ink)]">{error.message}</p>
              {error.hint && (
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-3)]">{error.hint}</p>
              )}
              {error.detail && (
                <p className="sq-mono mt-1 break-words text-[10px] leading-snug text-[var(--color-ink-4)]">
                  {error.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              className="sq-icon-btn shrink-0"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}

        <CommandConsole
          pending={pending}
          onPendingChange={setPending}
          query={query}
          onQueryChange={setQuery}
          onRun={run}
          onAbort={abort}
          running={running}
          blockedReason={blockedReason}
          elapsedMs={elapsed}
          phaseLabel={phaseLabel}
          phaseIsLive={phaseIsLive}
          mode={uploadOutcome && !uploadStale ? uploadOutcome.validation.mode : null}
          hasResult={result !== null}
          upload={uploadOutcome}
          uploadStale={uploadStale}
        />
      </div>
    </div>
  );
}
