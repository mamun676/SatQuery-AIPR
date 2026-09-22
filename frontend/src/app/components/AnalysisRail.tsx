"use client";
// ═════════════════════════════════════════════════════════════════════════
// Analysis rail — the right column.
//
// Reads top-down the way an analyst defends a conclusion: the finding, then
// how much to trust it, then the measurements behind it, then which model
// produced it, then the execution trace, then the raw payload. A sticky
// section index jumps between them without hiding any of it behind tabs.
//
// The rail renders nothing speculative: each section is either backed by a
// real field in the response or replaced by an explicit unavailable state.
// ═════════════════════════════════════════════════════════════════════════
import { useCallback, useMemo, useRef, useState } from "react";
import type { FullAnalysis } from "@/lib/api";
import { isFailure } from "@/lib/api";
import type { SpatialReading } from "@/lib/evidence";
import { hasMeasurableEvidence, summariseProvenance } from "@/lib/evidence";
import { formatDuration } from "@/lib/format";
import type { IconName } from "./primitives/Icon";
import Icon from "./primitives/Icon";
import Reveal from "./primitives/Reveal";
import Unavailable from "./primitives/Unavailable";
import ConfidenceMeter from "./ConfidenceMeter";
import EvidencePanel from "./EvidencePanel";
import ModelStatusPanel from "./ModelStatusPanel";
import ReportButton from "./ReportButton";
import ResultsPanel from "./ResultsPanel";
import TechnicalDetails from "./TechnicalDetails";
import TracePanel from "./TracePanel";

type SectionId = "finding" | "confidence" | "evidence" | "models" | "trace" | "technical";

const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: "finding", label: "Finding", icon: "spark" },
  { id: "confidence", label: "Confidence", icon: "gauge" },
  { id: "evidence", label: "Evidence", icon: "grid" },
  { id: "models", label: "Models", icon: "model" },
  { id: "trace", label: "Trace", icon: "trace" },
  { id: "technical", label: "Raw", icon: "file" },
];

export interface AnalysisRailProps {
  result: FullAnalysis | null;
  spatial: SpatialReading | null;
  running: boolean;
  /** Real client-measured duration of the last completed run, in ms. */
  lastRunMs: number | null;
  statusWasLive: boolean;
  activeBox: number | null;
  onActiveBoxChange: (index: number | null) => void;
}

export default function AnalysisRail({
  result,
  spatial,
  running,
  lastRunMs,
  statusWasLive,
  activeBox,
  onActiveBoxChange,
}: AnalysisRailProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState<SectionId>("finding");

  const jump = useCallback((id: SectionId) => {
    setCurrent(id);
    const host = scrollRef.current;
    const target = host?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!host || !target) return;
    host.scrollTo({ top: target.offsetTop - 8, behavior: "smooth" });
  }, []);

  const provenance = useMemo(
    () => (result ? summariseProvenance(result.modelsUsed) : null),
    [result],
  );

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-5 py-8">
        <div className="relative flex items-center justify-center">
          <div className="absolute h-20 w-20 rounded-full" style={{background:"radial-gradient(circle,rgba(79,227,255,0.12) 0%,transparent 70%)"}}/>
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--hair-hi)]" style={{background:"linear-gradient(135deg,rgba(79,227,255,0.08),rgba(156,140,255,0.05))",boxShadow:"0 0 28px rgba(79,227,255,0.08)"}}>
            <Icon name={running ? "trace" : "gauge"} size={26} className="text-[var(--color-signal)]"/>
          </div>
        </div>
        <div className="text-center">
          <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{running ? "Analysis in progress" : "No analysis yet"}</h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-4)]">{running ? "RSCoVLM is processing your imagery — results appear the moment the backend responds." : "Upload a satellite image, ask a question, and SatQuery AI will return a full intelligence report."}</p>
        </div>
        {!running && (
          <div className="w-full rounded-lg border border-[var(--hair)] bg-[var(--color-panel-2)] px-3 py-2.5">
            <p className="mb-2 text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-4)]">What you'll get</p>
            <ul className="flex flex-col gap-1.5">
              {[{icon:"spark",text:"Natural language finding + confidence"},{icon:"grid",text:"GIS measurements & spatial overlay"},{icon:"model",text:"Model provenance & execution trace"},{icon:"gauge",text:"Full confidence decomposition"}].map(item=>(
                <li key={item.text} className="flex items-center gap-2">
                  <Icon name={item.icon as any} size={11} className="shrink-0 text-[var(--color-signal)] opacity-70"/>
                  <span className="text-[10.5px] text-[var(--color-ink-3)]">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const failed = isFailure(result.status);
  const measurable = hasMeasurableEvidence(result.evidence);

  const available: Record<SectionId, boolean> = {
    finding: true,
    confidence: result.confidence !== null,
    evidence: measurable,
    models: result.modelsUsed.length > 0,
    trace: result.trace.length > 0,
    technical: true,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--hair)] px-3 py-2">
        <nav className="sq-scroll -mx-0.5 flex min-w-0 flex-1 gap-0.5 overflow-x-auto" aria-label="Analysis sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="sq-tab shrink-0"
              aria-selected={current === s.id}
              aria-controls={`sq-section-${s.id}`}
              disabled={!available[s.id]}
              title={available[s.id] ? undefined : "Not reported for this job"}
              onClick={() => jump(s.id)}
            >
              <Icon name={s.icon} size={11} />
              <span className="hidden xl:inline">{s.label}</span>
            </button>
          ))}
        </nav>
        <ReportButton
          jobId={result.jobId}
          disabledReason={
            failed
              ? "The job failed, so no report was written."
              : running
                ? "Wait for the run to finish."
                : null
          }
        />
      </div>

      {lastRunMs !== null && (
        <p className="sq-mono border-b border-[var(--hair)] px-3 py-1 text-[9.5px] text-[var(--color-ink-4)]">
          job {result.jobId} · client round-trip {formatDuration(lastRunMs)}
          {statusWasLive ? " · stages streamed" : " · stages not streamed"}
        </p>
      )}

      <div ref={scrollRef} className="sq-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <section data-section="finding" id="sq-section-finding">
          <Reveal index={0}>
            <ResultsPanel result={result} provenanceHeadline={provenance?.headline ?? ""} />
          </Reveal>
        </section>

        <section data-section="confidence" id="sq-section-confidence">
          <Reveal index={1}>
            <ConfidenceMeter
              confidence={result.confidence}
              usedFallback={provenance?.usedFallback ?? false}
            />
          </Reveal>
        </section>

        <section data-section="evidence" id="sq-section-evidence">
          <Reveal index={2}>
            <EvidencePanel
              evidence={result.evidence}
              activeBox={activeBox}
              onActiveBoxChange={onActiveBoxChange}
            />
          </Reveal>
        </section>

        <section data-section="models" id="sq-section-models">
          <Reveal index={3}>
            <ModelStatusPanel models={result.modelsUsed} />
          </Reveal>
        </section>

        <section data-section="trace" id="sq-section-trace">
          <Reveal index={4}>
            <TracePanel trace={result.trace} statusWasLive={statusWasLive} />
          </Reveal>
        </section>

        <section data-section="technical" id="sq-section-technical">
          <Reveal index={5}>
            <TechnicalDetails result={result} spatial={spatial} statusWasLive={statusWasLive} />
          </Reveal>
        </section>
      </div>
    </div>
  );
}
