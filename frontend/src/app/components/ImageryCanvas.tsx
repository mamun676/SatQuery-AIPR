"use client";
// ═════════════════════════════════════════════════════════════════════════
// Pixel-space imagery viewer.
//
// Draws the tool's own preview raster with its mask and region boxes in the
// raster's native pixel coordinates. No projection is implied and none is
// drawn — the header states plainly that this is image space.
// ═════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { GeoOverlay } from "@/server/satquery/types";
import { formatPixelBox } from "@/lib/format";
import { useElementSize } from "@/lib/motion";
import Icon from "./primitives/Icon";
import Unavailable from "./primitives/Unavailable";
import { useProbedImage } from "./useProbedImage";

export interface ImageryCanvasProps {
  baseCandidates: string[];
  maskCandidates: string[];
  overlay: GeoOverlay | null;
  /** Frame size in pixels, from the overlay; falls back to the base image. */
  frame: { width: number; height: number } | null;
  activeBox: number | null;
  onActiveBoxChange: (index: number | null) => void;
  running: boolean;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 24;

export default function ImageryCanvas({
  baseCandidates,
  maskCandidates,
  overlay,
  frame,
  activeBox,
  onActiveBoxChange,
  running,
}: ImageryCanvasProps) {
  const base = useProbedImage(baseCandidates);
  const mask = useProbedImage(maskCandidates);
  const { ref: hostRef, size } = useElementSize<HTMLDivElement>();

  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [maskOpacity, setMaskOpacity] = useState(0.7);
  const [showMask, setShowMask] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const dims = useMemo(() => {
    if (frame) return frame;
    if (base.natural) return base.natural;
    if (mask.natural) return mask.natural;
    return null;
  }, [frame, base.natural, mask.natural]);

  const fit = useCallback(() => {
    if (!dims || size.width === 0 || size.height === 0) return;
    const pad = 26;
    const scale = Math.min(
      (size.width - pad) / dims.width,
      (size.height - pad) / dims.height,
    );
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    setView({
      scale: s,
      x: (size.width - dims.width * s) / 2,
      y: (size.height - dims.height * s) / 2,
    });
  }, [dims, size.width, size.height]);

  useEffect(() => {
    fit();
  }, [fit]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      setView((v) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
        const k = next / v.scale;
        return { scale: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    },
    [],
  );

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!dims) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - rect.left, e.clientY - rect.top);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dims || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag && drag.id === e.pointerId) {
      setView((v) => ({ ...v, x: drag.ox + (e.clientX - drag.sx), y: drag.oy + (e.clientY - drag.sy) }));
      return;
    }
    if (!dims) return;
    const px = (e.clientX - rect.left - view.x) / view.scale;
    const py = (e.clientY - rect.top - view.y) / view.scale;
    setCursor(
      px >= 0 && py >= 0 && px <= dims.width && py <= dims.height
        ? { x: Math.floor(px), y: Math.floor(py) }
        : null,
    );
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  const boxes = overlay?.boxes ?? [];
  const loading = base.state === "loading" || mask.state === "loading";

  if (base.state === "missing" && mask.state === "missing" && boxes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Unavailable
          icon="aperture"
          title="No preview raster was produced for this job"
          body="The workflow answered without emitting a viewable preview. Region geometry, when present, is listed in the evidence panel."
          detail={
            [...base.attempted, ...mask.attempted].length > 0
              ? `probed: ${[...base.attempted, ...mask.attempted].join(", ")}`
              : null
          }
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--hair)] px-2.5 py-1.5">
        <span className="sq-label">Image space</span>
        {dims && (
          <span className="sq-num text-[10px] text-[var(--color-ink-3)]">
            {dims.width}×{dims.height} px
          </span>
        )}
        <span className="sq-vrule mx-1 h-4" />
        <button type="button" className="sq-icon-btn" onClick={() => zoomAt(1.3, size.width / 2, size.height / 2)} aria-label="Zoom in">
          <Icon name="plus" size={13} />
        </button>
        <button type="button" className="sq-icon-btn" onClick={() => zoomAt(1 / 1.3, size.width / 2, size.height / 2)} aria-label="Zoom out">
          <Icon name="collapse" size={13} />
        </button>
        <button type="button" className="sq-btn sq-btn-sm" onClick={fit}>
          Fit
        </button>
        <button
          type="button"
          className="sq-btn sq-btn-sm"
          onClick={() => {
            if (!dims) return;
            setView({
              scale: 1,
              x: (size.width - dims.width) / 2,
              y: (size.height - dims.height) / 2,
            });
          }}
        >
          1:1
        </button>
        <span className="sq-num ml-0.5 text-[10px] text-[var(--color-ink-4)]">
          {(view.scale * 100).toFixed(view.scale < 1 ? 1 : 0)}%
        </span>

        <span className="flex-1" />

        {mask.state === "ready" && (
          <>
            <button
              type="button"
              className="sq-icon-btn"
              aria-pressed={showMask}
              onClick={() => setShowMask((v) => !v)}
              aria-label={showMask ? "Hide mask" : "Show mask"}
              title="Mask overlay"
            >
              <Icon name={showMask ? "eye" : "eyeOff"} size={13} />
            </button>
            <input
              type="range"
              className="sq-range w-20"
              min={0}
              max={100}
              value={Math.round(maskOpacity * 100)}
              onChange={(e) => setMaskOpacity(Number(e.target.value) / 100)}
              aria-label="Mask opacity"
              disabled={!showMask}
            />
          </>
        )}
        {boxes.length > 0 && (
          <button
            type="button"
            className="sq-icon-btn"
            aria-pressed={showBoxes}
            onClick={() => setShowBoxes((v) => !v)}
            aria-label={showBoxes ? "Hide regions" : "Show regions"}
            title={`${boxes.length} region${boxes.length === 1 ? "" : "s"}`}
          >
            <Icon name="target" size={13} />
          </button>
        )}
      </div>

      <div
        ref={hostRef}
        className={[
          "sq-grat relative min-h-0 flex-1 touch-none overflow-hidden",
          running ? "sq-sweep" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ cursor: dragRef.current ? "grabbing" : "grab", background: "var(--color-void)" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setCursor(null)}
      >
        {dims && (
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: dims.width,
              height: dims.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              imageRendering: view.scale >= 2 ? "pixelated" : "auto",
              outline: "1px solid var(--hair-hi)",
              outlineOffset: 0,
            }}
          >
            {base.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={base.url}
                alt="Source raster preview generated by the analysis tool"
                width={dims.width}
                height={dims.height}
                draggable={false}
                className="absolute inset-0 h-full w-full select-none"
              />
            )}
            {mask.url && showMask && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mask.url}
                alt="Detection mask returned by the analysis tool"
                width={dims.width}
                height={dims.height}
                draggable={false}
                className="absolute inset-0 h-full w-full select-none"
                style={{
                  opacity: maskOpacity,
                  mixBlendMode: base.url ? "screen" : "normal",
                }}
              />
            )}
            {showBoxes && boxes.length > 0 && (
              <svg
                viewBox={`0 0 ${dims.width} ${dims.height}`}
                className="absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                {boxes.map((b, i) => {
                  const [x0, y0, x1, y1] = b.pixelBox;
                  const active = activeBox === i;
                  return (
                    <rect
                      key={i}
                      x={Math.min(x0, x1)}
                      y={Math.min(y0, y1)}
                      width={Math.abs(x1 - x0)}
                      height={Math.abs(y1 - y0)}
                      fill={active ? "rgba(79,227,255,0.14)" : "transparent"}
                      stroke={active ? "var(--color-signal)" : "var(--color-caution)"}
                      strokeWidth={Math.max(1, 1.6 / view.scale)}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>
            )}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="sq-label sq-breathe">Loading raster preview</span>
          </div>
        )}

        {cursor && (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-[var(--hair-hi)] bg-[rgba(4,6,11,0.82)] px-2 py-1">
            <span className="sq-num text-[10px] text-[var(--color-ink-2)]">
              px {cursor.x}, {cursor.y}
            </span>
          </div>
        )}
      </div>

      {boxes.length > 0 && (
        <div className="sq-scroll flex max-h-[86px] shrink-0 flex-wrap gap-1.5 overflow-y-auto border-t border-[var(--hair)] px-2.5 py-2">
          {boxes.map((b, i) => {
            const active = activeBox === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onActiveBoxChange(active ? null : i)}
                aria-pressed={active}
                className={[
                  "sq-chip transition-colors",
                  active ? "sq-evi-active" : "hover:border-[var(--color-line-hi)]",
                ].join(" ")}
                data-tone={active ? "signal" : undefined}
                title={formatPixelBox(b.pixelBox)}
              >
                <Icon name="target" size={10} />
                {b.label}
                {typeof b.score === "number" && (
                  <span className="sq-num text-[9px] text-[var(--color-ink-4)]">
                    {b.score.toFixed(2)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
