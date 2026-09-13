"use client";
// Linear meter with a graduated scale. Value is a real 0..1 ratio; when it is
// unknown the track renders empty with an explicit "no reading" hatch.
import type { Tone } from "./Chip";

const COLOR: Record<Tone, string> = {
  neutral: "var(--color-ink-4)",
  signal: "var(--color-signal)",
  verified: "var(--color-verified)",
  caution: "var(--color-caution)",
  fault: "var(--color-fault)",
  violet: "var(--color-violet)",
};

export interface MeterProps {
  /** 0..1, or null when the backend reported no value. */
  value: number | null;
  tone?: Tone;
  height?: number;
  /** Draw 0/25/50/75/100 graduations under the track. */
  scale?: boolean;
  label: string;
  /** Secondary marker, e.g. the client-recomputed estimate. */
  marker?: number | null;
  markerLabel?: string;
  animate?: boolean;
}

export default function Meter({
  value,
  tone = "signal",
  height = 6,
  scale = false,
  label,
  marker = null,
  markerLabel,
  animate = true,
}: MeterProps) {
  const known = value !== null && Number.isFinite(value);
  const pct = known ? Math.min(100, Math.max(0, value * 100)) : 0;
  const color = COLOR[tone];

  return (
    <div className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-full"
        style={{
          height,
          background: known
            ? "rgba(255,255,255,0.055)"
            : "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 4px, transparent 4px 9px)",
        }}
        role="meter"
        aria-valuenow={known ? Number(pct.toFixed(1)) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={known ? `${pct.toFixed(1)} percent` : "no reading"}
        aria-label={label}
      >
        {known && (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${color}44, ${color})`,
              boxShadow: `0 0 12px -2px ${color}`,
              transition: animate ? "width 760ms var(--ease-out)" : "none",
            }}
          />
        )}
        {marker !== null && Number.isFinite(marker) && (
          <div
            className="absolute inset-y-0 w-[1.5px]"
            style={{
              left: `${Math.min(100, Math.max(0, marker * 100))}%`,
              background: "var(--color-ink-2)",
              opacity: 0.85,
            }}
            title={markerLabel}
          />
        )}
      </div>
      {scale && (
        <div className="mt-1 flex justify-between">
          {[0, 25, 50, 75, 100].map((t) => (
            <span key={t} className="sq-num text-[9px] tracking-normal text-[var(--color-ink-4)]">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
