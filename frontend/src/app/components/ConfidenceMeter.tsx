"use client";
// ═════════════════════════════════════════════════════════════════════════
// Confidence estimate.
//
// The backend computes
//   confidence_estimate = 0.5*model_probability
//                       + 0.3*tool_agreement
//                       + 0.2*validation_score
// which is an UNCALIBRATED HEURISTIC, not a probability. This panel says so
// on the face of it, shows each weighted term, recomputes the sum in the
// browser as a cross-check, and names the term that is holding the number
// down — so the operator can see *why* the estimate is what it is.
// ═════════════════════════════════════════════════════════════════════════
import type { ConfidenceBreakdown } from "@/server/satquery/types";
import { confidenceReason, readConfidence } from "@/lib/evidence";
import type { ConfidenceReading, ConfidenceTerm } from "@/lib/evidence";
import { formatRatioPercent } from "@/lib/format";
import type { Tone } from "./primitives/Chip";
import Chip from "./primitives/Chip";
import Hint from "./primitives/Hint";
import Icon from "./primitives/Icon";
import Meter from "./primitives/Meter";
import Panel from "./primitives/Panel";
import Unavailable from "./primitives/Unavailable";

const BAND_TONE: Record<ConfidenceReading["band"], Tone> = {
  high: "verified",
  substantial: "signal",
  moderate: "caution",
  low: "fault",
};

function termTone(t: ConfidenceTerm): Tone {
  if (t.value >= 0.75) return "verified";
  if (t.value >= 0.5) return "signal";
  if (t.value >= 0.25) return "caution";
  return "fault";
}

export interface ConfidenceMeterProps {
  confidence: ConfidenceBreakdown | null;
  /** Highlighted when the backend reports a fallback path was taken. */
  usedFallback: boolean;
}

export default function ConfidenceMeter({ confidence, usedFallback }: ConfidenceMeterProps) {
  const reading = readConfidence(confidence);

  if (!reading) {
    return (
      <Panel title="Confidence estimate" icon="gauge" quiet padding="tight">
        <Unavailable
          compact
          icon="gauge"
          title="No confidence breakdown returned"
          body="The job did not report model probability, tool agreement or a validation score, so no estimate can be shown. Nothing is substituted."
        />
      </Panel>
    );
  }

  const reason = confidenceReason(reading);
  const pct = Math.round(reading.estimate * 100);

  return (
    <Panel
      title="Confidence estimate"
      icon="gauge"
      quiet
      padding="tight"
      meta={<Chip tone={BAND_TONE[reading.band]}>{reading.bandLabel}</Chip>}
    >
      <div className="flex items-end gap-3">
        <div className="flex items-baseline gap-1">
          <span
            className="sq-num text-[38px] leading-none"
            style={{ color: `var(--color-${BAND_TONE[reading.band]})` }}
          >
            {pct}
          </span>
          <span className="sq-num text-[15px] text-[var(--color-ink-4)]">%</span>
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <Meter
            value={reading.estimate}
            tone={BAND_TONE[reading.band]}
            label="Confidence estimate"
            height={8}
            scale
          />
          <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-4)]">
            uncalibrated heuristic — not a probability
          </p>
        </div>
      </div>

      {reason && (
        <p className="mt-2.5 border-l-2 pl-2.5 text-[11.5px] leading-snug text-[var(--color-ink-2)]"
           style={{ borderColor: `var(--color-${BAND_TONE[reading.band]})` }}>
          {reason}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2.5">
        {reading.terms.map((t) => (
          <li key={t.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-1.5 text-[11.5px]">
                {reading.limiter?.key === t.key && (
                  <Icon
                    name="warn"
                    size={11}
                    className="text-[var(--color-caution)]"
                    label="Limiting term"
                  />
                )}
                {t.label}
              </span>
              <span className="sq-num shrink-0 text-[10.5px] text-[var(--color-ink-3)]">
                {formatRatioPercent(t.value, 0)}
                <span className="text-[var(--color-ink-4)]"> × {t.weight}</span>
                <span className="text-[var(--color-ink-2)]"> = {t.contribution.toFixed(3)}</span>
              </span>
            </div>
            <div className="mt-1">
              <Meter
                value={t.value}
                tone={termTone(t)}
                label={`${t.label} component`}
                height={4}
              />
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-[var(--color-ink-4)]">{t.what}</p>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-[var(--hair)] pt-2">
        {!reading.formulaConsistent && (
          <p className="mb-2 flex gap-1.5 text-[11px] leading-snug text-[var(--color-caution)]">
            <Icon name="warn" size={12} className="mt-[1px] shrink-0" />
            <span>
              The reported estimate ({reading.estimate.toFixed(3)}) differs from the weighted sum of
              its own terms ({reading.recomputed.toFixed(3)}). The backend value is shown above
              unchanged; this note flags the discrepancy rather than hiding it.
            </span>
          </p>
        )}
        {usedFallback && (
          <p className="mb-2 flex gap-1.5 text-[11px] leading-snug text-[var(--color-caution)]">
            <Icon name="info" size={12} className="mt-[1px] shrink-0" />
            <span>
              A fallback path was engaged for this job, so the model-probability term reflects the
              fallback tool rather than the primary model.
            </span>
          </p>
        )}
        <Hint label="How this number is built">
          <span className="sq-mono block break-words text-[10.5px] text-[var(--color-ink-2)]">
            {reading.formula}
          </span>
          <span className="mt-1.5 block">
            The three terms are combined with fixed weights that were chosen by hand, not fitted to
            labelled data. A high value means the tool was confident, the independent GIS
            measurements agreed, and the input rasters were clean — it does not mean the answer is
            80% likely to be correct. Treat it as a triage signal and read the evidence below before
            acting on the finding.
          </span>
        </Hint>
      </div>
    </Panel>
  );
}
