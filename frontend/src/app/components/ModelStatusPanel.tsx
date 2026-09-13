"use client";
// ═════════════════════════════════════════════════════════════════════════
// Model provenance.
//
// The rule this panel exists to enforce: never claim a model was used when it
// was not. Each entry renders the backend's own `status` field —
// used / fallback_used / unavailable — with its verbatim `reason` string, and
// the three states are visually distinct so a fallback answer can never be
// mistaken for a primary-model answer.
//
// RSCoVLM-7B is the real remote-sensing model behind the VQA / captioning /
// grounding paths; whatever name the backend reports is what is shown here.
// ═════════════════════════════════════════════════════════════════════════
import type { ModelUsed } from "@/server/satquery/types";
import { readModels, summariseProvenance } from "@/lib/evidence";
import type { ModelReading } from "@/lib/evidence";
import Chip from "./primitives/Chip";
import Icon from "./primitives/Icon";
import Panel from "./primitives/Panel";
import StatusDot from "./primitives/StatusDot";
import Unavailable from "./primitives/Unavailable";

const STATE_ICON = {
  used: "check",
  fallback_used: "refresh",
  unavailable: "close",
} as const;

function ModelRow({ reading, primary }: { reading: ModelReading; primary: boolean }) {
  const { model, state, stateLabel, tone, reason } = reading;
  return (
    <li
      className="sq-panel rounded px-2.5 py-2"
      style={
        state === "unavailable"
          ? { opacity: 0.72, borderStyle: "dashed" }
          : primary
            ? { borderColor: "color-mix(in oklab, var(--color-verified) 34%, transparent)" }
            : undefined
      }
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} pulse={false} label={stateLabel} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-ink)]" title={model.name}>
          {model.name}
        </span>
        {primary && <Chip tone="verified">answered</Chip>}
        <Chip tone={tone} icon={STATE_ICON[state]}>
          {stateLabel}
        </Chip>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="sq-label shrink-0">{model.role}</span>
      </div>
      {reason && (
        <p className="mt-1 border-l border-[var(--hair-hi)] pl-2 text-[10.5px] leading-snug text-[var(--color-ink-4)]">
          {reason}
        </p>
      )}
    </li>
  );
}

export interface ModelStatusPanelProps {
  models: ModelUsed[];
}

export default function ModelStatusPanel({ models }: ModelStatusPanelProps) {
  if (models.length === 0) {
    return (
      <Panel title="Model provenance" icon="model" quiet padding="tight">
        <Unavailable
          compact
          icon="model"
          title="No model provenance reported"
          body="The job returned an empty models_used array. Which model answered cannot be determined from this response, so nothing is asserted."
        />
      </Panel>
    );
  }

  const summary = summariseProvenance(models);
  const readings = readModels(models);
  // The single entry credited with the answer, identified by position so two
  // models sharing a name cannot both be badged. Mirrors summariseProvenance:
  // first executed model, else first fallback.
  const firstUsed = readings.findIndex((r) => r.state === "used");
  const primaryIndex =
    firstUsed >= 0 ? firstUsed : readings.findIndex((r) => r.state === "fallback_used");

  return (
    <Panel
      title="Model provenance"
      icon="model"
      quiet
      padding="tight"
      meta={
        <div className="flex items-center gap-1.5">
          <Chip tone="verified">{summary.executed.length} executed</Chip>
          {summary.fallbacks.length > 0 && (
            <Chip tone="caution">{summary.fallbacks.length} fallback</Chip>
          )}
          {summary.unavailable.length > 0 && (
            <Chip tone="neutral">{summary.unavailable.length} unavailable</Chip>
          )}
        </div>
      }
    >
      <p className="text-[11.5px] leading-snug text-[var(--color-ink-2)]">{summary.headline}</p>

      <ul className="mt-2 flex flex-col gap-1.5">
        {readings.map((r, i) => (
          <ModelRow
            key={`${r.model.name}-${r.model.role}-${i}`}
            reading={r}
            primary={i === primaryIndex}
          />
        ))}
      </ul>

      {summary.usedFallback && (
        <p className="mt-2 flex gap-1.5 text-[11px] leading-snug text-[var(--color-caution)]">
          <Icon name="warn" size={12} className="mt-[1px] shrink-0" />
          <span>
            A deterministic fallback produced part of this answer. Fallback paths are rule-based
            index computations, not learned models — treat the finding as a measurement, not a
            model inference.
          </span>
        </p>
      )}
      {summary.unavailable.length > 0 && (
        <p className="mt-2 text-[10.5px] leading-snug text-[var(--color-ink-4)]">
          Unavailable entries are listed so the absence is visible: the pipeline reported these
          models as not loadable for this job and did not run them.
        </p>
      )}
    </Panel>
  );
}
