"use client";
// ═════════════════════════════════════════════════════════════════════════
// Technical details.
//
// The escape hatch for anyone who does not trust the presentation layer: the
// resolved intent, the tool parameters, the spatial availability verdict, and
// the untouched response body exactly as it came off the wire. Every value in
// the rest of the rail can be traced back to something visible here.
// ═════════════════════════════════════════════════════════════════════════
import type { FullAnalysis } from "@/lib/api";
import { API_BASE_LABEL, apiUrl } from "@/lib/api";
import type { SpatialReading } from "@/lib/evidence";
import { formatBbox, formatDimensions, shortCrs, stableJson, taskLabel } from "@/lib/format";
import Chip from "./primitives/Chip";
import CopyButton from "./primitives/CopyButton";
import JsonTree from "./primitives/JsonTree";
import KeyValue from "./primitives/KeyValue";
import type { KeyValueRow } from "./primitives/KeyValue";
import Panel from "./primitives/Panel";

export interface TechnicalDetailsProps {
  result: FullAnalysis;
  spatial: SpatialReading | null;
  /** Whether /api/status answered while the job ran. */
  statusWasLive: boolean;
}

export default function TechnicalDetails({ result, spatial, statusWasLive }: TechnicalDetailsProps) {
  const intent = result.intent;
  const paramKeys = Object.keys(result.parameters);

  const jobRows: KeyValueRow[] = [
    { key: "jobId", label: "job_id", value: result.jobId, mono: true, full: true },
    { key: "status", label: "status", value: result.status, mono: true },
    { key: "mode", label: "mode", value: result.mode ?? "—", mono: true },
    { key: "workflow", label: "workflow", value: result.workflow ?? "—", mono: true },
    {
      key: "stages",
      label: "live stages",
      value: statusWasLive ? "streamed via /api/status" : "not exposed by this backend",
    },
    { key: "endpoint", label: "api base", value: API_BASE_LABEL, mono: true, full: true },
  ];

  const intentRows: KeyValueRow[] = intent
    ? [
        { key: "task", label: "task", value: `${intent.task} · ${taskLabel(intent.task)}`, mono: true, full: true },
        { key: "target", label: "target", value: intent.target ?? "—" },
        { key: "method", label: "method", value: intent.method, mono: true },
        { key: "coerced", label: "coerced", value: intent.coerced ? "yes" : "no", mono: true },
        ...(intent.coercionReason
          ? [{ key: "coercionReason", label: "coercion_reason", value: intent.coercionReason, full: true }]
          : []),
        { key: "rawQuery", label: "raw_query", value: intent.rawQuery, full: true },
      ]
    : [];

  const spatialRows: KeyValueRow[] = spatial
    ? [
        { key: "kind", label: "geometry", value: spatial.kind, mono: true },
        { key: "crs", label: "crs", value: shortCrs(spatial.crs) ?? "—", mono: true },
        { key: "geoBoxes", label: "geo boxes", value: spatial.geoBoxCount, mono: true },
        { key: "pixelBoxes", label: "pixel boxes", value: spatial.pixelBoxCount, mono: true },
        {
          key: "dims",
          label: "frame",
          value: spatial.pixelDimensions
            ? formatDimensions(spatial.pixelDimensions.width, spatial.pixelDimensions.height)
            : "—",
          mono: true,
        },
        {
          key: "bounds",
          label: "image bounds",
          value: spatial.imageBounds ? formatBbox(spatial.imageBounds) : "—",
          mono: true,
          full: true,
        },
        ...(spatial.limitation
          ? [{ key: "limitation", label: "limitation", value: spatial.limitation, full: true }]
          : []),
      ]
    : [];

  return (
    <Panel
      title="Technical details"
      icon="grid"
      quiet
      padding="tight"
      collapsible
      defaultOpen={false}
      actions={<CopyButton text={stableJson(result.raw)} label="Copy payload" />}
    >
      <section>
        <h4 className="sq-label-hi">Job</h4>
        <div className="mt-1.5">
          <KeyValue rows={jobRows} columns={2} />
        </div>
      </section>

      {intentRows.length > 0 && (
        <section className="mt-3">
          <h4 className="sq-label-hi">Resolved intent</h4>
          <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--color-ink-4)]">
            What the query-understanding stage decided the question was asking for.
          </p>
          <div className="mt-1.5">
            <KeyValue rows={intentRows} columns={2} />
          </div>
        </section>
      )}

      {spatialRows.length > 0 && (
        <section className="mt-3">
          <h4 className="sq-label-hi">Spatial availability</h4>
          <div className="mt-1.5">
            <KeyValue rows={spatialRows} columns={2} />
          </div>
        </section>
      )}

      <section className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="sq-label-hi">Tool parameters</h4>
          <Chip tone="neutral">{paramKeys.length}</Chip>
        </div>
        {paramKeys.length === 0 ? (
          <p className="mt-1 text-[11px] text-[var(--color-ink-4)]">
            The workflow reported no parameters for this run.
          </p>
        ) : (
          <div className="mt-1.5">
            <JsonTree data={result.parameters} name={null} defaultOpenDepth={2} />
          </div>
        )}
      </section>

      <section className="mt-3 border-t border-[var(--hair)] pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="sq-label-hi">Raw response</h4>
          <a
            className="sq-mono text-[10px] text-[var(--color-signal)] hover:underline"
            href={apiUrl(`/api/result/${encodeURIComponent(result.jobId)}`)}
            target="_blank"
            rel="noreferrer"
          >
            GET /api/result/{result.jobId}
          </a>
        </div>
        <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--color-ink-4)]">
          Exactly as returned — no normalisation applied to this view.
        </p>
        <div className="mt-1.5">
          <JsonTree data={result.raw} name={null} defaultOpenDepth={1} />
        </div>
      </section>
    </Panel>
  );
}
