"use client";
// ═════════════════════════════════════════════════════════════════════════
// Execution trace.
//
// A real timeline built from result.trace: one entry per event the backend
// actually emitted, with wall-clock offsets computed from the event
// timestamps. There is no synthetic progress and no interpolated stages — if
// the backend emitted three events, three events are shown.
//
// Per-event `data` payloads are rendered as-is through JsonTree, because the
// point of a trace is to be inspectable rather than pretty.
// ═════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import type { TraceEvent } from "@/server/satquery/types";
import { formatClockMs, formatDuration, offsetMs, stableJson } from "@/lib/format";
import Chip from "./primitives/Chip";
import CopyButton from "./primitives/CopyButton";
import Icon from "./primitives/Icon";
import JsonTree from "./primitives/JsonTree";
import Panel from "./primitives/Panel";
import Unavailable from "./primitives/Unavailable";

const STAGE_TONE: Record<string, "signal" | "verified" | "caution" | "fault" | "neutral" | "violet"> = {
  validate: "signal",
  validation: "signal",
  understand: "violet",
  query_understanding: "violet",
  route: "violet",
  controller: "violet",
  registry: "violet",
  tool: "signal",
  run: "signal",
  postprocess: "signal",
  evidence: "verified",
  gis: "verified",
  confidence: "verified",
  synthesis: "verified",
  synthesize: "verified",
  fallback: "caution",
  warning: "caution",
  error: "fault",
  failed: "fault",
};

function toneFor(stage: string): "signal" | "verified" | "caution" | "fault" | "neutral" | "violet" {
  const key = stage.toLowerCase();
  if (STAGE_TONE[key]) return STAGE_TONE[key];
  for (const [k, v] of Object.entries(STAGE_TONE)) if (key.includes(k)) return v;
  return "neutral";
}

export interface TracePanelProps {
  trace: TraceEvent[];
  /** False when the backend never streamed live stages for this job. */
  statusWasLive: boolean;
}

export default function TracePanel({ trace, statusWasLive }: TracePanelProps) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  const rows = useMemo(() => {
    const first = trace[0]?.timestamp ?? null;
    return trace.map((event, i) => {
      const prev = i > 0 ? trace[i - 1].timestamp : null;
      return {
        event,
        index: i,
        fromStart: offsetMs(first, event.timestamp),
        fromPrev: offsetMs(prev, event.timestamp),
        hasData: event.data !== undefined && Object.keys(event.data).length > 0,
      };
    });
  }, [trace]);

  const total = rows.length > 0 ? rows[rows.length - 1].fromStart : null;

  if (trace.length === 0) {
    return (
      <Panel title="Execution trace" icon="trace" quiet padding="tight">
        <Unavailable
          compact
          icon="trace"
          title="No trace events were recorded"
          body="This job returned an empty trace array. A timeline is not reconstructed from timestamps elsewhere in the payload, because that would be a guess."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Execution trace"
      icon="trace"
      quiet
      padding="tight"
      meta={
        <div className="flex items-center gap-1.5">
          <span className="sq-num text-[10px] text-[var(--color-ink-4)]">{trace.length} events</span>
          {total !== null && total > 0 && <Chip tone="neutral">{formatDuration(total)}</Chip>}
        </div>
      }
      actions={<CopyButton text={stableJson(trace)} label="Copy JSON" />}
    >
      {!statusWasLive && (
        <p className="mb-2 flex gap-1.5 text-[10.5px] leading-snug text-[var(--color-ink-4)]">
          <Icon name="info" size={12} className="mt-[1px] shrink-0" />
          <span>
            This backend runs the pipeline synchronously and does not expose intermediate stages, so
            the trace below was read once the job finished rather than streamed while it ran.
          </span>
        </p>
      )}

      <ol className="relative flex flex-col">
        <span
          className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-[var(--hair-hi)]"
          aria-hidden
        />
        {rows.map((row) => {
          const tone = toneFor(row.event.stage);
          const isOpen = open.has(row.index);
          return (
            <li key={`${row.event.stage}-${row.event.timestamp}-${row.index}`} className="relative pl-5">
              <span
                className="absolute left-0 top-[6px] block h-[11px] w-[11px] rounded-full border-2"
                style={{
                  borderColor: `var(--color-${tone === "neutral" ? "ink-4" : tone})`,
                  background: "var(--color-void)",
                }}
                aria-hidden
              />
              <div className="border-b border-[var(--hair)] py-1.5">
                <div className="flex items-baseline gap-2">
                  <span
                    className="sq-label shrink-0"
                    style={{ color: `var(--color-${tone === "neutral" ? "ink-4" : tone})` }}
                  >
                    {row.event.stage}
                  </span>
                  <span className="sq-num ml-auto shrink-0 text-[9.5px] text-[var(--color-ink-4)]">
                    {row.fromStart === null
                      ? formatClockMs(row.event.timestamp)
                      : `+${formatDuration(row.fromStart)}`}
                  </span>
                  {row.fromPrev !== null && row.fromPrev > 0 && (
                    <span className="sq-num shrink-0 text-[9.5px] text-[var(--color-ink-4)]">
                      Δ{formatDuration(row.fromPrev)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-ink-2)]">
                  {row.event.message}
                </p>
                {row.hasData && (
                  <>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-4)] transition-colors hover:text-[var(--color-signal)]"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.index)) next.delete(row.index);
                          else next.add(row.index);
                          return next;
                        })
                      }
                    >
                      <Icon
                        name="chevron"
                        size={10}
                        className={isOpen ? "rotate-90 transition-transform" : "transition-transform"}
                      />
                      stage data
                    </button>
                    {isOpen && (
                      <div className="mt-1.5 border-l border-[var(--hair-hi)] pl-2">
                        <JsonTree data={row.event.data} name={null} defaultOpenDepth={2} />
                      </div>
                    )}
                  </>
                )}
                <p className="sq-mono mt-0.5 text-[9px] text-[var(--color-ink-4)]">
                  {formatClockMs(row.event.timestamp)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
