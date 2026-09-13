"use client";
// ═════════════════════════════════════════════════════════════════════════
// Measured evidence.
//
// Every number here comes from evidence.facts / evidence.statistics as the
// backend returned them. Nothing is estimated, interpolated or rounded into
// existence: a fact with a null value renders as "unavailable", and a result
// with no facts at all gets an explicit empty state instead of an empty grid.
//
// Region rows are clickable and drive the highlight in the viewport, so the
// number and the pixels it was measured from stay connected.
// ═════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import type { Evidence } from "@/server/satquery/types";
import {
  groupFacts,
  hasMeasurableEvidence,
  headlineMetrics,
  readRegions,
  readStatistics,
  remainingFacts,
} from "@/lib/evidence";
import { formatFactValue, formatNumber, humanizeKey, pixelBoxArea, formatPixelBox } from "@/lib/format";
import Chip from "./primitives/Chip";
import Icon from "./primitives/Icon";
import JsonTree from "./primitives/JsonTree";
import Meter from "./primitives/Meter";
import Panel from "./primitives/Panel";
import Reveal from "./primitives/Reveal";
import Unavailable from "./primitives/Unavailable";

export interface EvidencePanelProps {
  evidence: Evidence | null;
  /** Index of the highlighted region box in the viewport, or null. */
  activeBox: number | null;
  onActiveBoxChange: (index: number | null) => void;
}

export default function EvidencePanel({ evidence, activeBox, onActiveBoxChange }: EvidencePanelProps) {
  const facts = evidence?.facts ?? [];
  const headline = useMemo(() => headlineMetrics(facts), [facts]);
  const rest = useMemo(() => remainingFacts(facts, headline), [facts, headline]);
  const groups = useMemo(() => groupFacts(rest), [rest]);
  const stats = useMemo(() => readStatistics(evidence?.statistics ?? {}), [evidence]);
  const regions = useMemo(() => readRegions(evidence?.statistics ?? {}), [evidence]);
  const boxes = evidence?.overlay?.boxes ?? [];

  if (!hasMeasurableEvidence(evidence)) {
    return (
      <Panel title="Measured evidence" icon="grid" quiet padding="tight">
        <Unavailable
          compact
          icon="grid"
          title="No quantitative evidence for this result"
          body="The workflow returned an answer without emitting facts, statistics or geometry. Nothing is fabricated to fill the panel."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Measured evidence"
      icon="grid"
      quiet
      padding="tight"
      meta={
        <span className="sq-num text-[10px] text-[var(--color-ink-4)]">
          {facts.length} fact{facts.length === 1 ? "" : "s"}
        </span>
      }
    >
      {headline.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {headline.map((m, i) => (
            <Reveal key={m.key} as="li" index={i} className="sq-panel rounded px-2.5 py-2">
              <div className="sq-label truncate" title={m.label}>
                {m.label}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span
                  className={`${m.value.isBoolean ? "text-[15px]" : "sq-num text-[21px]"} leading-none`}
                  style={{ color: `var(--color-${m.value.tone === "neutral" ? "ink" : m.value.tone})` }}
                >
                  {m.value.text}
                </span>
                {m.value.unit && (
                  <span className="sq-num text-[11px] text-[var(--color-ink-4)]">{m.value.unit}</span>
                )}
              </div>
              {m.ratio !== null && (
                <div className="mt-1.5">
                  <Meter value={m.ratio} tone="signal" label={`${m.label} share of scene`} height={3} />
                </div>
              )}
              {m.note && (
                <p className="mt-1 text-[10px] leading-snug text-[var(--color-ink-4)]">{m.note}</p>
              )}
            </Reveal>
          ))}
        </ul>
      )}

      {groups.map((g) => (
        <section key={g.id} className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="sq-label-hi">{g.title}</h4>
            <span className="sq-num text-[10px] text-[var(--color-ink-4)]">{g.facts.length}</span>
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--color-ink-4)]">{g.note}</p>
          <dl className="mt-1.5 flex flex-col">
            {g.facts.map((f) => {
              const v = formatFactValue(f);
              return (
                <div
                  key={`${f.fact}-${f.region ?? ""}`}
                  className="flex items-baseline justify-between gap-2 border-b border-[var(--hair)] py-1 last:border-b-0"
                >
                  <dt className="min-w-0 text-[11px] text-[var(--color-ink-3)]">
                    {humanizeKey(f.fact)}
                    {f.region && (
                      <span className="ml-1 text-[var(--color-ink-4)]">· {f.region}</span>
                    )}
                  </dt>
                  <dd className="shrink-0 text-[11px]">
                    <span
                      className={v.isBoolean ? "" : "sq-num"}
                      style={{ color: `var(--color-${v.tone === "neutral" ? "ink-2" : v.tone})` }}
                    >
                      {v.text}
                    </span>
                    {v.unit && <span className="ml-0.5 text-[var(--color-ink-4)]">{v.unit}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}

      {boxes.length > 0 && (
        <section className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="sq-label-hi">Detected regions</h4>
            <span className="sq-num text-[10px] text-[var(--color-ink-4)]">{boxes.length}</span>
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--color-ink-4)]">
            Select a row to isolate it in the viewport. Areas are pixel counts from the bounding box,
            not ground area.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {boxes.map((b, i) => {
              const active = activeBox === i;
              const region = regions[i];
              return (
                <li key={`${b.label}-${i}`}>
                  <button
                    type="button"
                    className={`sq-panel flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${active ? "sq-evi-active" : ""}`}
                    aria-pressed={active}
                    onClick={() => onActiveBoxChange(active ? null : i)}
                  >
                    <span className="sq-num shrink-0 text-[10px] text-[var(--color-ink-4)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px]">{b.label}</span>
                    {typeof b.score === "number" && (
                      <Chip tone="signal">{formatNumber(b.score, { max: 2 })}</Chip>
                    )}
                    <span className="sq-mono shrink-0 text-[9.5px] text-[var(--color-ink-4)]">
                      {formatPixelBox(b.pixelBox)}
                    </span>
                    <span className="sq-num shrink-0 text-[9.5px] text-[var(--color-ink-4)]">
                      {region?.pixels !== null && region?.pixels !== undefined
                        ? `${formatNumber(region.pixels)} px`
                        : `${formatNumber(pixelBoxArea(b.pixelBox))} px box`}
                    </span>
                    <Icon
                      name={active ? "eye" : "target"}
                      size={12}
                      className={`shrink-0 ${active ? "text-[var(--color-signal)]" : "text-[var(--color-ink-4)]"}`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {stats.length > 0 && (
        <details className="group mt-3 border-t border-[var(--hair)] pt-2">
          <summary className="sq-label-hi flex cursor-pointer list-none items-center gap-1.5">
            <Icon
              name="chevron"
              size={11}
              className="transition-transform group-open:rotate-90 text-[var(--color-ink-4)]"
            />
            Tool statistics
            <span className="sq-num ml-auto text-[10px] text-[var(--color-ink-4)]">
              {stats.length} key{stats.length === 1 ? "" : "s"}
            </span>
          </summary>
          <dl className="mt-2 flex flex-col">
            {stats.map((row) =>
              row.kind === "scalar" ? (
                <div
                  key={row.key}
                  className="flex items-baseline justify-between gap-2 border-b border-[var(--hair)] py-1 last:border-b-0"
                >
                  <dt className="text-[11px] text-[var(--color-ink-3)]">{row.label}</dt>
                  <dd className="sq-num shrink-0 text-[11px] text-[var(--color-ink-2)]">
                    {row.scalar === null
                      ? "unavailable"
                      : typeof row.scalar === "number"
                        ? formatNumber(row.scalar)
                        : String(row.scalar)}
                  </dd>
                </div>
              ) : (
                <div key={row.key} className="border-b border-[var(--hair)] py-1.5 last:border-b-0">
                  <dt className="text-[11px] text-[var(--color-ink-3)]">{row.label}</dt>
                  <dd className="mt-1">
                    <JsonTree data={row.nested} name={null} defaultOpenDepth={1} />
                  </dd>
                </div>
              ),
            )}
          </dl>
        </details>
      )}

      <p className="mt-2.5 text-[10px] leading-snug text-[var(--color-ink-4)]">
        Values are reported exactly as the GIS tool measured them. Percentages are shares of the
        analysed raster, not of any georeferenced ground area unless a unit says otherwise.
      </p>
    </Panel>
  );
}
