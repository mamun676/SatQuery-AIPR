"use client";
// ═════════════════════════════════════════════════════════════════════════
// Curtain comparison between two rasters the tool actually wrote.
//
// The two sides are labelled with the artefacts they are — e.g. "t1_preview"
// against "change_mask" — rather than being presented as a generic
// before/after, because the pipeline does not emit a T2 preview.
// ═════════════════════════════════════════════════════════════════════════
import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import Icon from "./primitives/Icon";

export interface CompareSide {
  url: string;
  label: string;
  /** Original artefact filename, shown as monospace provenance. */
  artefact: string;
}

export default function CompareSlider({
  left,
  right,
  dims,
}: {
  left: CompareSide;
  right: CompareSide;
  dims: { width: number; height: number } | null;
}) {
  const [position, setPosition] = useState(50);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width === 0) return;
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) setFromClientX(e.clientX);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPosition((p) => Math.max(0, p - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPosition((p) => Math.min(100, p + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPosition(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPosition(100);
    }
  };

  const aspect = dims && dims.width > 0 ? `${dims.width} / ${dims.height}` : "16 / 10";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hair)] px-2.5 py-1.5">
        <span className="sq-label">Curtain compare</span>
        <span className="sq-num text-[10px] text-[var(--color-ink-4)]">
          {position.toFixed(0)}%
        </span>
        <span className="flex-1" />
        <span className="sq-num text-[9.5px] text-[var(--color-ink-4)]">
          drag · ←/→ · shift for 10%
        </span>
      </div>

      <div className="sq-grat flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
        <div
          ref={hostRef}
          className="relative max-h-full w-full select-none overflow-hidden rounded-[6px] border border-[var(--hair-hi)]"
          style={{ aspectRatio: aspect, maxWidth: dims ? `min(100%, ${dims.width}px)` : "100%" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={right.url}
            alt={right.label}
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {/* Clipped rather than resized, so the left frame stays registered
              pixel-for-pixel with the right one at every curtain position. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={left.url}
            alt={left.label}
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          />

          <div
            role="slider"
            tabIndex={0}
            aria-label={`Compare ${left.label} with ${right.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(position)}
            aria-valuetext={`${Math.round(position)}% ${left.label}`}
            onKeyDown={onKeyDown}
            className="absolute inset-y-0 z-10 flex w-8 -translate-x-1/2 cursor-ew-resize items-center justify-center outline-none focus-visible:bg-[rgba(79,227,255,0.12)]"
            style={{ left: `${position}%` }}
          >
            <span className="absolute inset-y-0 w-[1.5px]" style={{ background: "var(--color-signal)" }} />
            <span
              className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-signal)]"
              style={{ background: "rgba(4,6,11,0.9)" }}
            >
              <Icon name="compare" size={13} className="text-[var(--color-signal)]" />
            </span>
          </div>

          <span className="pointer-events-none absolute left-2 top-2 flex flex-col gap-0.5 rounded border border-[var(--hair-hi)] bg-[rgba(4,6,11,0.8)] px-2 py-1">
            <span className="sq-label sq-label-hi">{left.label}</span>
            <span className="sq-num text-[9px] text-[var(--color-ink-4)]">{left.artefact}</span>
          </span>
          <span className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-0.5 rounded border border-[var(--hair-hi)] bg-[rgba(4,6,11,0.8)] px-2 py-1">
            <span className="sq-label">{right.label}</span>
            <span className="sq-num text-[9px] text-[var(--color-ink-4)]">{right.artefact}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
