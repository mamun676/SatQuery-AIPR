"use client";
// ═════════════════════════════════════════════════════════════════════════
// Acquisition screen — the pre-analysis state of the viewport stage.
//
// It carries no analysis data because none exists yet: what it shows is the
// real pipeline topology, the real service reachability probe, and the query
// forms the router actually recognises. Nothing here is a placeholder result.
// ═════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import type { HealthReport } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useReducedMotion } from "@/lib/motion";
import Icon from "./primitives/Icon";
import { Wordmark } from "./primitives/Icon";
import OrbitalField from "./OrbitalField";
import Reveal from "./primitives/Reveal";
import StatusDot from "./primitives/StatusDot";

export interface AcquisitionScreenProps {
  health: HealthReport | null;
  probing: boolean;
  onRecheck: () => void;
  onUseExample: (query: string) => void;
  hasStagedFiles: boolean;
  apiBaseLabel: string;
}

const STAGES = [
  { key: "ingest", label: "Ingest", icon: "layers" as const, note: "Raster read, modality inferred" },
  { key: "validate", label: "Validate", icon: "check" as const, note: "CRS, bands, pairing rules" },
  { key: "understand", label: "Understand", icon: "query" as const, note: "Task + target extraction" },
  { key: "route", label: "Route", icon: "model" as const, note: "Workflow and model selection" },
  { key: "measure", label: "Measure", icon: "target" as const, note: "GIS operators over pixels" },
  { key: "attest", label: "Attest", icon: "gauge" as const, note: "Evidence, confidence, trace" },
];

const WORKFLOWS = [
  {
    task: "vqa",
    label: "Visual question answering",
    input: "Single image",
    example: "Is there standing water in this scene?",
  },
  {
    task: "caption",
    label: "Scene captioning",
    input: "Single image",
    example: "Describe the land cover in this image.",
  },
  {
    task: "grounding",
    label: "Visual grounding",
    input: "Single image",
    example: "Locate the vegetated areas.",
  },
  {
    task: "change_vqa",
    label: "Bi-temporal change",
    input: "T1 + T2 pair",
    example: "How has the water extent changed between the two dates?",
  },
  {
    task: "optical_sar",
    label: "Optical–SAR fusion",
    input: "Optical + SAR pair",
    example: "Do the optical and SAR returns agree on the flooded area?",
  },
];

function PipelineSpine({ reduced }: { reduced: boolean }) {
  // One horizontal spine with a node per stage. The stroke draws once on mount
  // so the topology reads as a signal path rather than a stepper widget.
  const nodes = useMemo(() => {
    const step = 920 / (STAGES.length - 1);
    return STAGES.map((s, i) => ({ ...s, x: 30 + i * step }));
  }, []);

  return (
    <svg viewBox="0 0 980 96" className="w-full" role="img" aria-label="Analysis pipeline stages">
      <line
        x1="30"
        y1="34"
        x2="950"
        y2="34"
        stroke="var(--color-line-hi)"
        strokeWidth="1"
        className={reduced ? undefined : "sq-draw"}
        style={reduced ? undefined : { ["--len" as string]: "920", ["--d" as string]: "180ms" }}
      />
      {nodes.map((n, i) => (
        <g key={n.key}>
          <circle
            cx={n.x}
            cy="34"
            r="12.5"
            fill="var(--color-panel)"
            stroke={i === 0 ? "var(--color-signal)" : "var(--color-line-hi)"}
            strokeWidth="1"
            className={reduced ? undefined : "sq-rv-scale"}
            style={reduced ? undefined : { ["--d" as string]: `${300 + i * 90}ms` }}
          />
          <circle
            cx={n.x}
            cy="34"
            r="2.4"
            fill={i === 0 ? "var(--color-signal)" : "var(--color-ink-4)"}
            className={reduced ? undefined : "sq-rv-scale"}
            style={reduced ? undefined : { ["--d" as string]: `${340 + i * 90}ms` }}
          />
          <text
            x={n.x}
            y="66"
            textAnchor="middle"
            fill="var(--color-ink-3)"
            style={{ fontSize: 9.5, letterSpacing: "0.18em", fontFamily: "var(--font-mono)" }}
          >
            {n.label.toUpperCase()}
          </text>
          <text
            x={n.x}
            y="82"
            textAnchor="middle"
            fill="var(--color-ink-4)"
            style={{ fontSize: 9, fontFamily: "var(--font-sans)" }}
          >
            {n.note}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ServiceProbe({
  health,
  probing,
  onRecheck,
  apiBaseLabel,
}: {
  health: HealthReport | null;
  probing: boolean;
  onRecheck: () => void;
  apiBaseLabel: string;
}) {
  const tone = probing ? "signal" : health === null ? "neutral" : health.ok ? "verified" : "fault";
  const text = probing
    ? "Probing analysis service"
    : health === null
      ? "Service not yet probed"
      : health.ok
        ? "Analysis service reachable"
        : "Analysis service unreachable";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex items-center gap-2">
        <StatusDot tone={tone} pulse={probing} size={7} />
        <span className="text-[11.5px] text-[var(--color-ink-2)]">{text}</span>
      </span>
      <span className="sq-num text-[10.5px] text-[var(--color-ink-4)]">{apiBaseLabel}</span>
      {health !== null && (
        <span className="sq-num text-[10.5px] text-[var(--color-ink-4)]">
          {health.ok ? formatDuration(health.latencyMs) : (health.detail ?? `HTTP ${health.status ?? "—"}`)}
        </span>
      )}
      <button type="button" className="sq-btn sq-btn-sm" onClick={onRecheck} disabled={probing}>
        <Icon name="refresh" size={12} className={probing ? "sq-rot" : undefined} />
        Re-probe
      </button>
    </div>
  );
}

export default function AcquisitionScreen({
  health,
  probing,
  onRecheck,
  onUseExample,
  hasStagedFiles,
  apiBaseLabel,
}: AcquisitionScreenProps) {
  const reduced = useReducedMotion();

  return (
    <div className="sq-vignette relative h-full w-full overflow-hidden">
      <OrbitalField className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="sq-grat pointer-events-none absolute inset-0 opacity-60" />

      <div className="sq-scroll relative z-10 flex h-full w-full flex-col items-center overflow-y-auto px-5 py-7 sm:px-8">
        <div className="flex w-full max-w-[880px] flex-col items-center">
          <Reveal className="flex items-center gap-3" index={0}>
            <Wordmark size={34} animated={!reduced} />
            <div className="flex flex-col">
              <span className="sq-wordmark text-[19px] leading-none">SatQuery AI</span>
              <span className="sq-label mt-1.5">Remote-sensing intelligence workbench</span>
            </div>
          </Reveal>

          <Reveal index={1} className="mt-5 max-w-[64ch] text-center">
            <p className="text-[13px] leading-[1.7] text-[var(--color-ink-2)]">
              Ask a question in natural language over optical, SAR or bi-temporal imagery. Every
              answer is returned with the GIS measurements it was derived from, the models that ran,
              a confidence decomposition and the full execution trace.
            </p>
          </Reveal>

          <Reveal index={2} className="mt-5">
            <ServiceProbe
              health={health}
              probing={probing}
              onRecheck={onRecheck}
              apiBaseLabel={apiBaseLabel}
            />
          </Reveal>

          <Reveal index={3} className="mt-8 w-full">
            <PipelineSpine reduced={reduced} />
          </Reveal>

          <Reveal index={4} className="mt-7 w-full">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="sq-label">Recognised workflows</span>
              <span className="sq-hair flex-1" />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {WORKFLOWS.map((w, i) => (
                <li key={w.task}>
                  <button
                    type="button"
                    onClick={() => onUseExample(w.example)}
                    className="sq-panel-quiet group flex h-full w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors hover:border-[var(--color-line-hi)]"
                    style={{ ["--d" as string]: `${380 + i * 60}ms` }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-[var(--color-ink)]">{w.label}</span>
                      <Icon
                        name="plus"
                        size={11}
                        className="shrink-0 text-[var(--color-ink-4)] transition-colors group-hover:text-[var(--color-signal)]"
                      />
                    </span>
                    <span className="sq-num text-[9.5px] uppercase tracking-[0.16em] text-[var(--color-ink-4)]">
                      {w.input}
                    </span>
                    <span className="text-[11px] leading-[1.5] text-[var(--color-ink-3)]">
                      “{w.example}”
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal index={5} className="mt-6 w-full">
            <div className="sq-panel-quiet flex flex-col gap-2 px-3.5 py-3">
              <span className="sq-label">Before you run</span>
              <ol className="flex flex-col gap-1.5">
                {[
                  hasStagedFiles
                    ? "Imagery is staged — assign roles if you are running a pair."
                    : "Stage one raster, or two for change detection and optical–SAR fusion.",
                  "Write the question in the console below; the router picks the workflow.",
                  "Model availability is reported per job — nothing is assumed in advance.",
                ].map((line, i) => (
                  <li key={i} className="flex gap-2 text-[11.5px] leading-[1.55] text-[var(--color-ink-3)]">
                    <span className="sq-num shrink-0 text-[var(--color-ink-4)]">{i + 1}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
