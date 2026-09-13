"use client";
// ═════════════════════════════════════════════════════════════════════════
// Ambient orbital field.
//
// Decorative only — it depicts no measured data and is labelled as such for
// assistive tech. Pure SVG + CSS transforms so it costs no dependency and
// stops entirely under prefers-reduced-motion.
// ═════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useReducedMotion } from "@/lib/motion";

interface Track {
  rx: number;
  ry: number;
  rotate: number;
  period: number;
  dot: number;
  opacity: number;
  tone: string;
}

const TRACKS: Track[] = [
  { rx: 330, ry: 96, rotate: -18, period: 44, dot: 2.6, opacity: 0.5, tone: "var(--color-signal)" },
  { rx: 262, ry: 150, rotate: 22, period: 33, dot: 2.1, opacity: 0.36, tone: "var(--color-violet)" },
  { rx: 400, ry: 62, rotate: -6, period: 58, dot: 2.9, opacity: 0.3, tone: "var(--color-verified)" },
  { rx: 196, ry: 196, rotate: 0, period: 26, dot: 1.8, opacity: 0.22, tone: "var(--color-ink-3)" },
];

export default function OrbitalField({
  /** Slight brightening while a job is genuinely in flight. */
  active = false,
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const stars = useMemo(() => {
    // Deterministic pseudo-random field: stable across renders and SSR.
    const out: Array<{ x: number; y: number; r: number; o: number }> = [];
    let seed = 20260903;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 90; i += 1) {
      out.push({
        x: next() * 1000,
        y: next() * 620,
        r: 0.35 + next() * 0.85,
        o: 0.1 + next() * 0.42,
      });
    }
    return out;
  }, []);

  return (
    <svg
      viewBox="0 0 1000 620"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ opacity: active ? 1 : 0.82, transition: "opacity 700ms var(--ease)" }}
    >
      <defs>
        <radialGradient id="sq-of-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0d1a2a" />
          <stop offset="62%" stopColor="#081120" />
          <stop offset="100%" stopColor="#04060b" />
        </radialGradient>
        <linearGradient id="sq-of-limb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-signal)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--color-signal)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sq-of-swath" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-signal)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-signal)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g>
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#cfe4ff" opacity={s.o} />
        ))}
      </g>

      <g transform="translate(500 330)">
        <circle r="188" fill="url(#sq-of-core)" />
        <circle r="188" fill="none" stroke="var(--color-line-hi)" strokeWidth="1" opacity="0.75" />
        <circle r="196" fill="none" stroke="url(#sq-of-limb)" strokeWidth="10" opacity="0.5" />
        {[-60, -30, 0, 30, 60].map((lat) => {
          const ry = 188 * Math.cos((lat * Math.PI) / 180);
          const cy = 188 * Math.sin((lat * Math.PI) / 180) * 0.42;
          return (
            <ellipse
              key={lat}
              cx="0"
              cy={cy}
              rx={188 * 0.99}
              ry={Math.max(4, ry * 0.42)}
              fill="none"
              stroke="rgba(148,175,208,0.13)"
              strokeWidth="0.7"
            />
          );
        })}
        {[0, 30, 60, 90, 120, 150].map((lon) => (
          <ellipse
            key={lon}
            cx="0"
            cy="0"
            rx={188 * Math.abs(Math.cos((lon * Math.PI) / 180)) * 0.98 + 0.4}
            ry="188"
            fill="none"
            stroke="rgba(148,175,208,0.1)"
            strokeWidth="0.7"
          />
        ))}
        <path
          d="M-118 -34 L-46 -96 L58 -74 L102 -6 L44 62 L-56 54 Z"
          fill="rgba(74,227,171,0.05)"
          stroke="rgba(74,227,171,0.24)"
          strokeWidth="0.9"
        />
        <path
          d="M-150 78 L-92 108 L-22 96 L16 132"
          fill="none"
          stroke="rgba(79,227,255,0.22)"
          strokeWidth="0.9"
        />
      </g>

      {TRACKS.map((t, i) => (
        <g key={i} transform={`translate(500 330) rotate(${t.rotate})`}>
          <ellipse
            cx="0"
            cy="0"
            rx={t.rx}
            ry={t.ry}
            fill="none"
            stroke="var(--color-line-hi)"
            strokeWidth="0.9"
            opacity={t.opacity}
            strokeDasharray="3 7"
          />
          <g
            className={reduced ? undefined : "sq-orbit"}
            style={
              reduced
                ? undefined
                : ({ ["--sp" as string]: `${t.period}s`, transformOrigin: "0px 0px" } as CSSProperties)
            }
          >
            <g transform={`translate(${t.rx} 0)`}>
              <circle r={t.dot * 3.4} fill={t.tone} opacity="0.1" />
              <circle r={t.dot} fill={t.tone} />
              <path
                d={`M0 ${t.dot} L${-t.rx * 0.09} ${t.ry * 0.55} L${t.rx * 0.02} ${t.ry * 0.6} Z`}
                fill="url(#sq-of-swath)"
              />
            </g>
          </g>
        </g>
      ))}

      <g opacity="0.5">
        <path d="M40 40 h26 M40 40 v26" stroke="var(--color-line-hi)" strokeWidth="1" fill="none" />
        <path d="M960 580 h-26 M960 580 v-26" stroke="var(--color-line-hi)" strokeWidth="1" fill="none" />
        <path d="M960 40 h-26 M960 40 v26" stroke="var(--color-line-hi)" strokeWidth="1" fill="none" />
        <path d="M40 580 h26 M40 580 v-26" stroke="var(--color-line-hi)" strokeWidth="1" fill="none" />
      </g>
    </svg>
  );
}
