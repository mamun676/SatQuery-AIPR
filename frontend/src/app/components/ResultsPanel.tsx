"use client";
// ═════════════════════════════════════════════════════════════════════════
// Finding.
//
// The answer the pipeline produced, presented as a finding rather than a chat
// message: the query that produced it, the workflow that ran, the task the
// query-understanding stage settled on, and — when the intent was coerced —
// the backend's own reason for coercing it.
//
// A failed or answerless job gets an explicit state. No placeholder prose is
// ever synthesised in place of a missing answer.
// ═════════════════════════════════════════════════════════════════════════
import type { FullAnalysis } from "@/lib/api";
import { isFailure } from "@/lib/api";
import { modeLabel, taskLabel } from "@/lib/format";
import Chip from "./primitives/Chip";
import CopyButton from "./primitives/CopyButton";
import Icon from "./primitives/Icon";
import Panel from "./primitives/Panel";
import Unavailable from "./primitives/Unavailable";

export interface ResultsPanelProps {
  result: FullAnalysis;
  /** Verbatim provenance headline from summariseProvenance. */
  provenanceHeadline: string;
}

export default function ResultsPanel({ result, provenanceHeadline }: ResultsPanelProps) {
  const failed = isFailure(result.status);
  const answer = result.answer && result.answer.trim() !== "" ? result.answer.trim() : null;
  const intent = result.intent;

  return (
    <Panel
      title="Finding"
      icon="spark"
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          {result.mode && <Chip tone="neutral">{modeLabel(result.mode)}</Chip>}
          {intent && <Chip tone="signal" icon="query">{taskLabel(intent.task)}</Chip>}
          {failed && <Chip tone="fault" icon="fault">{result.status}</Chip>}
        </div>
      }
      actions={answer ? <CopyButton text={answer} label="Copy" /> : undefined}
    >
      {result.query.trim() !== "" && (
        <blockquote className="mb-3 border-l-2 border-[var(--color-signal-2)] pl-2.5">
          <p className="text-[11.5px] leading-snug text-[var(--color-ink-3)]">{result.query}</p>
        </blockquote>
      )}

      {failed ? (
        <Unavailable
          icon="fault"
          title="The job did not complete"
          body="No answer was produced. The backend's own error message is shown below, unmodified."
          detail={result.errorMessage}
        />
      ) : answer ? (
        <p className="text-[14px] leading-[1.6] text-[var(--color-ink)]">{answer}</p>
      ) : (
        <Unavailable
          icon="info"
          title="No answer text was returned"
          body="The job reached a terminal state without synthesising an answer string. The evidence and trace below are still available."
          detail={result.errorMessage}
        />
      )}

      <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--hair)] pt-2.5">
        <p className="flex gap-1.5 text-[11px] leading-snug text-[var(--color-ink-3)]">
          <Icon name="model" size={12} className="mt-[1px] shrink-0 text-[var(--color-ink-4)]" />
          <span>{provenanceHeadline}</span>
        </p>
        {result.workflow && (
          <p className="flex gap-1.5 text-[11px] leading-snug text-[var(--color-ink-3)]">
            <Icon name="trace" size={12} className="mt-[1px] shrink-0 text-[var(--color-ink-4)]" />
            <span>
              Workflow <span className="sq-mono text-[var(--color-ink-2)]">{result.workflow}</span>
              {intent ? ` · intent resolved ${intent.method}` : ""}
            </span>
          </p>
        )}
        {intent?.target && (
          <p className="flex gap-1.5 text-[11px] leading-snug text-[var(--color-ink-3)]">
            <Icon name="target" size={12} className="mt-[1px] shrink-0 text-[var(--color-ink-4)]" />
            <span>
              Target <span className="text-[var(--color-ink)]">{intent.target}</span>
            </span>
          </p>
        )}
        {intent?.coerced && (
          <p className="flex gap-1.5 text-[11px] leading-snug text-[var(--color-caution)]">
            <Icon name="warn" size={12} className="mt-[1px] shrink-0" />
            <span>
              The requested task was coerced to <strong>{taskLabel(intent.task)}</strong> for the
              staged input
              {intent.coercionReason ? `: ${intent.coercionReason}` : "."}
            </span>
          </p>
        )}
        {result.warnings.map((w) => (
          <p key={w} className="flex gap-1.5 text-[11px] leading-snug text-[var(--color-caution)]">
            <Icon name="warn" size={12} className="mt-[1px] shrink-0" />
            <span>{w}</span>
          </p>
        ))}
        {!failed && result.errorMessage && (
          <p className="flex gap-1.5 text-[11px] leading-snug text-[var(--color-fault)]">
            <Icon name="fault" size={12} className="mt-[1px] shrink-0" />
            <span>{result.errorMessage}</span>
          </p>
        )}
      </div>
    </Panel>
  );
}
