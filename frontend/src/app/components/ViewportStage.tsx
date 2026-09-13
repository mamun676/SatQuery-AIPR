"use client";
// ═════════════════════════════════════════════════════════════════════════
// Viewport stage — the large left-hand surface.
//
// Four exclusive states, each driven by what actually exists:
//   • no imagery staged, no result  → acquisition screen
//   • imagery staged, no result     → staged-frame inspector
//   • job in flight                 → the stage it applies to, with a sweep
//   • result present                → imagery / geospatial / compare tabs
// ═════════════════════════════════════════════════════════════════════════
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { FullAnalysis, HealthReport } from "@/lib/api";
import {
  comparePreviewCandidates,
  maskUrlCandidates,
  previewUrlCandidates,
  resolveAssetUrl,
} from "@/lib/api";
import type { SpatialReading } from "@/lib/evidence";
import { formatBytes, formatDimensions, modalityLabel, roleLabel } from "@/lib/format";
import type { FileRole, RasterFormat } from "@/server/satquery/types";
import AcquisitionScreen from "./AcquisitionScreen";
import CompareSlider from "./CompareSlider";
import ImageryCanvas from "./ImageryCanvas";
import Icon from "./primitives/Icon";
import KeyValue from "./primitives/KeyValue";
import Segmented from "./primitives/Segmented";
import Unavailable from "./primitives/Unavailable";
import { useProbedImage } from "./useProbedImage";

// Leaflet touches window at module scope, so the map is client-only.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="sq-label sq-breathe">Initialising map engine</span>
    </div>
  ),
});

export interface StagedPreview {
  key: string;
  name: string;
  role: FileRole;
  sizeBytes: number;
  /** Object URL when the browser can decode the format, otherwise null. */
  url: string | null;
  format: RasterFormat;
  /** Server-reported raster metadata, once the upload has been validated. */
  dimensions: { width: number | null; height: number | null } | null;
  modality: string | null;
}

export type StageTab = "imagery" | "geospatial" | "compare";

export interface ViewportStageProps {
  result: FullAnalysis | null;
  spatial: SpatialReading | null;
  running: boolean;
  runningLabel: string | null;
  staged: StagedPreview[];
  health: HealthReport | null;
  probing: boolean;
  onRecheck: () => void;
  onUseExample: (query: string) => void;
  activeBox: number | null;
  onActiveBoxChange: (index: number | null) => void;
}

const ARTEFACT_LABEL: Record<string, string> = {
  "preview.png": "Source preview",
  "t1_preview.png": "T1 preview",
  "mask.png": "Detection mask",
  "change_mask.png": "Change mask",
  "fused_mask.png": "Fused mask",
  "optical_index_preview.png": "Optical index",
};

function artefactName(url: string | null): string {
  if (!url) return "—";
  const last = url.split("/").pop();
  return last ?? url;
}

function StagedInspector({ staged }: { staged: StagedPreview[] }) {
  const [index, setIndex] = useState(0);
  const current = staged[Math.min(index, staged.length - 1)];

  useEffect(() => {
    if (index > staged.length - 1) setIndex(0);
  }, [index, staged.length]);

  if (!current) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--hair)] px-2.5 py-1.5">
        <span className="sq-label">Staged imagery</span>
        <span className="sq-num text-[10px] text-[var(--color-ink-4)]">
          not yet analysed
        </span>
        <span className="flex-1" />
        {staged.length > 1 && (
          <Segmented
            label="Staged frame"
            size="sm"
            value={String(Math.min(index, staged.length - 1))}
            onChange={(v) => setIndex(Number(v))}
            options={staged.map((s, i) => ({ value: String(i), label: roleLabel(s.role) }))}
          />
        )}
      </div>

      <div className="sq-grat flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {current.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={`Staged file ${current.name}`}
            className="max-h-full max-w-full rounded-[6px] border border-[var(--hair-hi)] object-contain"
          />
        ) : (
          <Unavailable
            icon="file"
            title="This format cannot be decoded by the browser"
            body={`${current.format} rasters are read server-side. The file is staged and will be analysed normally — only the in-browser thumbnail is unavailable.`}
            detail={current.name}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--hair)] px-3 py-2.5">
        <KeyValue
          columns={3}
          rows={[
            { key: "name", label: "File", value: current.name, mono: true, full: true },
            { key: "role", label: "Role", value: roleLabel(current.role) },
            { key: "format", label: "Format", value: current.format },
            { key: "size", label: "Size", value: formatBytes(current.sizeBytes), mono: true },
            ...(current.modality
              ? [{ key: "modality", label: "Modality", value: modalityLabel(current.modality) }]
              : []),
            ...(current.dimensions
              ? [
                  {
                    key: "dims",
                    label: "Dimensions",
                    value: formatDimensions(current.dimensions.width, current.dimensions.height),
                    mono: true,
                  },
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}

export default function ViewportStage({
  result,
  spatial,
  running,
  runningLabel,
  staged,
  health,
  probing,
  onRecheck,
  onUseExample,
  activeBox,
  onActiveBoxChange,
}: ViewportStageProps) {
  const jobId = result?.jobId ?? null;
  const task = result?.intent?.task ?? null;
  const overlay = result?.evidence?.overlay ?? null;

  const baseCandidates = useMemo(() => previewUrlCandidates(jobId, task), [jobId, task]);
  const maskCandidates = useMemo(
    () => maskUrlCandidates(jobId, overlay?.maskPreviewUrl ?? null, task),
    [jobId, overlay?.maskPreviewUrl, task],
  );
  const compareCandidates = useMemo(() => comparePreviewCandidates(jobId, task), [jobId, task]);

  const compareRight = useProbedImage(compareCandidates);
  const compareLeft = useProbedImage(baseCandidates);
  const maskProbe = useProbedImage(maskCandidates);

  const canGeospatial = spatial !== null && spatial.kind !== "unavailable";
  const canCompare = compareLeft.state === "ready" && compareRight.state === "ready";

  const [tab, setTab] = useState<StageTab>("imagery");
  useEffect(() => {
    if (tab === "geospatial" && !canGeospatial) setTab("imagery");
    if (tab === "compare" && !canCompare) setTab("imagery");
  }, [tab, canGeospatial, canCompare]);

  if (!result) {
    const stageBody =
      staged.length > 0 ? (
        <StagedInspector staged={staged} />
      ) : (
        <AcquisitionScreen
          health={health}
          probing={probing}
          onRecheck={onRecheck}
          onUseExample={onUseExample}
          hasStagedFiles={false}
          apiBaseLabel={health?.base ?? ""}
        />
      );
    return (
      <div className={["relative h-full", running ? "sq-sweep" : ""].filter(Boolean).join(" ")}>
        {stageBody}
        {running && runningLabel && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t border-[var(--hair-hi)] bg-[rgba(4,6,11,0.9)] px-3 py-2">
            <Icon name="aperture" size={13} className="sq-rot text-[var(--color-signal)]" />
            <span className="sq-label sq-label-hi">{runningLabel}</span>
          </div>
        )}
      </div>
    );
  }

  const frame = overlay?.pixelDimensions ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--hair)] px-1.5">
        <Segmented
          label="Viewport mode"
          value={tab}
          onChange={setTab}
          options={[
            { value: "imagery", label: "Imagery", icon: "aperture" },
            {
              value: "geospatial",
              label: "Geospatial",
              icon: "graticule",
              disabled: !canGeospatial,
              disabledReason:
                spatial?.limitation ?? "This result carries no spatial geometry to place on a map.",
            },
            {
              value: "compare",
              label: "Compare",
              icon: "compare",
              disabled: !canCompare,
              disabledReason:
                "Comparison needs two rasters; this workflow produced a single frame.",
            },
          ]}
        />
        <span className="flex-1" />
        {overlay && overlay.boxes.length > 0 && (
          <span className="sq-num mr-2 text-[10px] text-[var(--color-ink-4)]">
            {overlay.boxes.length} region{overlay.boxes.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className={["relative min-h-0 flex-1", running ? "sq-sweep" : ""].filter(Boolean).join(" ")}>
        {tab === "imagery" && (
          <ImageryCanvas
            baseCandidates={baseCandidates}
            maskCandidates={maskCandidates}
            overlay={overlay}
            frame={frame}
            activeBox={activeBox}
            onActiveBoxChange={onActiveBoxChange}
            running={running}
          />
        )}

        {tab === "geospatial" &&
          (canGeospatial && overlay && spatial ? (
            <MapView
              overlay={overlay}
              spatial={spatial}
              maskUrl={maskProbe.state === "ready" ? maskProbe.url : resolveAssetUrl(spatial.maskPreviewUrl)}
              activeBox={activeBox}
              onActiveBoxChange={onActiveBoxChange}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <Unavailable
                icon="graticule"
                title={spatial?.emptyTitle || "Spatial evidence unavailable for this result"}
                body={spatial?.emptyBody || undefined}
                detail={spatial?.limitation ?? null}
              />
            </div>
          ))}

        {tab === "compare" &&
          (canCompare && compareLeft.url && compareRight.url ? (
            <CompareSlider
              dims={compareLeft.natural ?? frame}
              left={{
                url: compareLeft.url,
                label: ARTEFACT_LABEL[artefactName(compareLeft.url)] ?? "Frame A",
                artefact: artefactName(compareLeft.url),
              }}
              right={{
                url: compareRight.url,
                label: ARTEFACT_LABEL[artefactName(compareRight.url)] ?? "Frame B",
                artefact: artefactName(compareRight.url),
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <Unavailable
                icon="compare"
                title="Nothing to compare for this result"
                body="Curtain comparison needs two rasters from the same job. This workflow wrote a single frame."
              />
            </div>
          ))}
      </div>
    </div>
  );
}
