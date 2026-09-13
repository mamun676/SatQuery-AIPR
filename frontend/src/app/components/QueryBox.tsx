"use client";
// ═════════════════════════════════════════════════════════════════════════
// Query console.
//
// The single input that drives the whole pipeline. Two rules govern it:
//   1. It never lies about readiness — the run control states exactly what
//      is missing (imagery, text, or a healthy service) instead of just
//      going grey.
//   2. It never claims to know the task. The workflow is chosen server-side
//      by the controller; the hint here is labelled as a guess and drops out
//      the moment a real result arrives.
// ═════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import type { InputMode } from "@/server/satquery/types";
import { useHotkey } from "@/lib/motion";
import { formatDuration } from "@/lib/format";
import Chip from "./primitives/Chip";
import Icon from "./primitives/Icon";

/** Mirrors server/satquery/queryUnderstanding.ts keyword routing, loosely. */
const TASK_HINTS: { test: RegExp; label: string }[] = [
  { test: /\b(change|difference|before|after|new|removed|grew|shrank|expanded)\b/i, label: "change detection" },
  { test: /\b(where|locate|find|show me|highlight|segment|mask|extent|boundar)\b/i, label: "grounding" },
  { test: /\b(describe|caption|summar|overview|what does|tell me about)\b/i, label: "captioning" },
  { test: /\b(sar|radar|backscatter|fuse|fusion|flood|water under|cloud)\b/i, label: "optical–SAR fusion" },
];

function guessTask(query: string): string | null {
  for (const h of TASK_HINTS) if (h.test.test(query)) return h.label;
  return query.trim().length > 0 ? "visual question answering" : null;
}

export const MAX_QUERY_LENGTH = 1000;

export interface QueryBoxProps {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  onAbort: () => void;
  running: boolean;
  /** Null when the console is ready; otherwise the reason it is not. */
  blockedReason: string | null;
  /** Real client-measured elapsed time for the active run, in ms. */
  elapsedMs: number;
  /** Live phase text from the orchestrator — never synthesised. */
  phaseLabel: string | null;
  /** False when the backend exposes no intermediate stages. */
  phaseIsLive: boolean;
  mode: InputMode | null;
  /** True once a result exists, so the local task guess is retired. */
  hasResult: boolean;
}

export default function QueryBox({
  value,
  onChange,
  onRun,
  onAbort,
  running,
  blockedReason,
  elapsedMs,
  phaseLabel,
  phaseIsLive,
  mode,
  hasResult,
}: QueryBoxProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const focus = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // ⌘/Ctrl+K focuses the console from anywhere; ⌘/Ctrl+Enter runs it.
  useHotkey({ key: "k", meta: true, allowInFields: true }, focus);
  useHotkey({ key: "Enter", meta: true, allowInFields: true }, () => {
    if (!running && !blockedReason) onRun();
  });

  // Grow the textarea with its content rather than scrolling a 3-line box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(180, Math.max(64, el.scrollHeight))}px`;
  }, [value]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!running && !blockedReason) onRun();
      }
    },
    [blockedReason, onRun, running],
  );

  const guess = useMemo(() => (hasResult ? null : guessTask(value)), [hasResult, value]);
  const over = value.length > MAX_QUERY_LENGTH;
  const runnable = !running && !blockedReason && !over;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="sq-query" className="sq-label-hi">
          Query console
        </label>
        <span className="sq-mono text-[10px] text-[var(--color-ink-4)]">
          <kbd>⌘K</kbd> focus · <kbd>⌘↵</kbd> run
        </span>
      </div>

      <div className={`sq-panel-quiet relative rounded-md ${running ? "sq-armed" : ""}`}>
        <textarea
          id="sq-query"
          ref={ref}
          className="sq-input w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[12.5px] leading-relaxed"
          placeholder="Ask about the imagery — e.g. “Which areas changed between the two acquisitions?”"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          rows={3}
          spellCheck
          aria-describedby="sq-query-state"
          aria-invalid={over || undefined}
        />
        <div className="flex items-center justify-between gap-2 border-t border-[var(--hair)] px-2.5 py-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {guess && (
              <Chip
                tone="neutral"
                icon="query"
                title="Guessed locally from keywords so you know roughly what will run. The server's query-understanding stage makes the real decision."
              >
                likely {guess}
              </Chip>
            )}
            {mode && !running && (
              <span className="sq-mono text-[10px] text-[var(--color-ink-4)]">{mode}</span>
            )}
            <span
              className={`sq-num text-[10px] ${over ? "text-[var(--color-fault)]" : "text-[var(--color-ink-4)]"}`}
            >
              {value.length}/{MAX_QUERY_LENGTH}
            </span>
          </div>
          {running ? (
            <button type="button" className="sq-btn sq-btn-sm shrink-0" onClick={onAbort}>
              <Icon name="stop" size={12} />
              Abort
            </button>
          ) : (
            <button
              type="button"
              className="sq-btn sq-btn-primary sq-btn-sm shrink-0"
              onClick={onRun}
              disabled={!runnable}
              title={over ? `Trim the query to ${MAX_QUERY_LENGTH} characters or fewer.` : blockedReason ?? undefined}
            >
              <Icon name="run" size={12} />
              Run analysis
            </button>
          )}
        </div>
      </div>

      <p id="sq-query-state" className="min-h-[15px] text-[11px] leading-snug">
        {running ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--color-ink-3)]">
            <span className="sq-num text-[var(--color-signal)]">{formatDuration(elapsedMs)}</span>
            <span>{phaseLabel ?? "Working"}</span>
            {!phaseIsLive && (
              <span className="text-[var(--color-ink-4)]">
                · stage detail unavailable from this backend
              </span>
            )}
          </span>
        ) : over ? (
          <span className="text-[var(--color-fault)]">
            {value.length - MAX_QUERY_LENGTH} characters over the limit.
          </span>
        ) : blockedReason ? (
          <span className="text-[var(--color-caution)]">{blockedReason}</span>
        ) : (
          <span className="text-[var(--color-ink-4)]">
            Ready · imagery uploads when you run, nothing is sent before that.
          </span>
        )}
      </p>
    </div>
  );
}
