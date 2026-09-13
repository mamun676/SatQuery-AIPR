"use client";
// ═════════════════════════════════════════════════════════════════════════
// Mission bar.
//
// A status strip, not a navigation header. It reports four real things: the
// service probe result, the active job and its backend status, whether the
// pipeline's stage transitions were actually observed, and which model
// answered. Where a value is unknown it says so.
// ═════════════════════════════════════════════════════════════════════════
import type { HealthReport, RunPhase } from "@/lib/api";
import { API_BASE_LABEL } from "@/lib/api";
import { formatDuration, shortId } from "@/lib/format";
import type { Tone } from "./primitives/Chip";
import Chip from "./primitives/Chip";
import Icon from "./primitives/Icon";
import { Wordmark } from "./primitives/Icon";
import StatusDot from "./primitives/StatusDot";

const PHASE_LABEL: Record<RunPhase, string> = {
  uploading: "Uploading",
  validating: "Validating",
  dispatching: "Routing",
  processing: "Processing",
  collecting: "Collecting",
  done: "Complete",
};

export interface MissionBarProps {
  health: HealthReport | null;
  probing: boolean;
  onRecheck: () => void;
  running: boolean;
  phase: RunPhase | null;
  phaseLabel: string | null;
  phaseIsLive: boolean;
  elapsedMs: number;
  jobId: string | null;
  jobStatus: string | null;
  /** Verbatim provenance headline, or null before a result exists. */
  provenance: string | null;
  railOpen: boolean;
  onRailToggle: () => void;
  /** True on viewports where the rail is stacked rather than docked. */
  stacked: boolean;
}

export default function MissionBar({
  health,
  probing,
  onRecheck,
  running,
  phase,
  phaseLabel,
  phaseIsLive,
  elapsedMs,
  jobId,
  jobStatus,
  provenance,
  railOpen,
  onRailToggle,
  stacked,
}: MissionBarProps) {
  const serviceTone: Tone = probing ? "signal" : health === null ? "neutral" : health.ok ? "verified" : "fault";
  const serviceText = probing
    ? "probing"
    : health === null
      ? "unprobed"
      : health.ok
        ? `online · ${health.latencyMs} ms`
        : "unreachable";

  return (
    <header className="sq-noprint relative flex items-center gap-2 border-b border-[var(--hair-hi)] px-3 py-2">
      <div className="sq-hair absolute inset-x-0 bottom-0" aria-hidden />

      <div className="flex min-w-0 items-center gap-2">
        <Wordmark size={26} animated={!running} />
        <div className="min-w-0 leading-none">
          <div className="sq-wordmark truncate text-[13px]">SATQUERY&nbsp;AI</div>
          <div className="sq-label mt-[3px] hidden sm:block">Remote-sensing intelligence</div>
        </div>
      </div>

      <div className="sq-vrule mx-1 hidden h-7 sm:block" aria-hidden />

      <button
        type="button"
        onClick={onRecheck}
        disabled={probing}
        className="group flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-[var(--color-panel-2)]"
        title={
          health === null
            ? `Probe ${API_BASE_LABEL}/api/health`
            : health.ok
              ? `${API_BASE_LABEL} responded in ${health.latencyMs} ms`
              : health.detail ?? "The health endpoint did not respond"
        }
      >
        <StatusDot tone={serviceTone} pulse={probing || (health?.ok ?? false)} label={`Service ${serviceText}`} />
        <span className="hidden text-[11px] text-[var(--color-ink-3)] md:inline">{serviceText}</span>
        <Icon
          name="refresh"
          size={11}
          className={`text-[var(--color-ink-4)] transition-opacity ${probing ? "sq-rot" : "opacity-0 group-hover:opacity-100"}`}
        />
      </button>

      <div className="sq-scroll ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {running && phase && (
          <Chip tone="signal" icon="orbit">
            {PHASE_LABEL[phase]}
            <span className="sq-num ml-1 text-[var(--color-ink-3)]">{formatDuration(elapsedMs)}</span>
          </Chip>
        )}
        {running && phaseLabel && (
          <span className="hidden max-w-[26ch] truncate text-[11px] text-[var(--color-ink-3)] lg:inline" title={phaseLabel}>
            {phaseLabel}
          </span>
        )}
        {running && !phaseIsLive && (
          <Chip tone="neutral" icon="info" title="This backend does not expose intermediate pipeline stages, so no stage-by-stage progress is shown.">
            no stage feed
          </Chip>
        )}
        {!running && jobId && (
          <Chip
            tone={jobStatus === "completed" || jobStatus === "complete" ? "verified" : jobStatus ? "caution" : "neutral"}
            icon="target"
            title={`job_id ${jobId}`}
          >
            <span className="sq-mono">{shortId(jobId, 6, 4)}</span>
            {jobStatus && <span className="ml-1 text-[var(--color-ink-3)]">{jobStatus}</span>}
          </Chip>
        )}
        {!running && provenance && (
          <span className="hidden max-w-[34ch] truncate text-[11px] text-[var(--color-ink-3)] xl:inline" title={provenance}>
            {provenance}
          </span>
        )}
      </div>

      <button
        type="button"
        className="sq-icon-btn ml-1 shrink-0"
        aria-pressed={railOpen}
        aria-label={railOpen ? "Collapse analysis rail" : "Expand analysis rail"}
        title={
          stacked
            ? railOpen
              ? "Collapse the analysis section"
              : "Expand the analysis section"
            : railOpen
              ? "Collapse the analysis rail for a wider viewport"
              : "Show the analysis rail"
        }
        onClick={onRailToggle}
      >
        <Icon name={railOpen ? "collapse" : "expand"} size={13} />
      </button>
    </header>
  );
}
