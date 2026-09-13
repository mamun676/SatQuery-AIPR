"use client";
// ═════════════════════════════════════════════════════════════════════════
// SatQuery AI — icon set
//
// Purpose-drawn on a 24-unit grid for this product: sensor optics, SAR
// returns, bi-temporal pairs, graticules, orbital tracks. Nothing is imported
// from an icon library, so the vocabulary is specific to remote sensing
// rather than generic dashboard furniture.
// ═════════════════════════════════════════════════════════════════════════
import type { CSSProperties } from "react";

export type IconName =
  | "aperture"
  | "sar"
  | "layers"
  | "bitemporal"
  | "graticule"
  | "orbit"
  | "target"
  | "query"
  | "run"
  | "stop"
  | "check"
  | "warn"
  | "fault"
  | "info"
  | "chevron"
  | "close"
  | "plus"
  | "download"
  | "copy"
  | "trace"
  | "model"
  | "gauge"
  | "grid"
  | "compare"
  | "expand"
  | "collapse"
  | "refresh"
  | "pin"
  | "eye"
  | "eyeOff"
  | "file"
  | "spark"
  | "terminal"
  | "link";

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Provide a label to expose the icon to assistive tech; omit for decoration. */
  label?: string;
  strokeWidth?: number;
}

const PATHS: Record<IconName, string> = {
  // Sensor aperture — hexagonal iris with an off-centre pupil.
  aperture:
    "M12 3.2 19.4 7.4v9.2L12 20.8 4.6 16.6V7.4Z M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z M12 3.2 12 8.6 M19.4 16.6 14.9 14 M4.6 16.6 9.1 14",
  // SAR — side-looking radar wavefronts striking a surface.
  sar: "M4 19.5h16 M6.5 19.5 6.5 15.6 M10.2 19.5 10.2 12.9 M6 4.5a10 10 0 0 1 8.4 5.2 M8.6 3.4a13 13 0 0 1 9.6 6.4 M4 6.4a7 7 0 0 1 5.8 3.5",
  layers:
    "M12 3.4 20.6 8 12 12.6 3.4 8Z M3.4 12 12 16.6 20.6 12 M3.4 16 12 20.6 20.6 16",
  // Bi-temporal — two frames offset in time with a delta arrow.
  bitemporal:
    "M3.4 6.2h9.2v9.2H3.4Z M11.4 8.6h9.2v9.2h-9.2Z M6 12.6h4.2 M8.4 10.8l1.9 1.8-1.9 1.8",
  graticule:
    "M3.2 12a8.8 8.8 0 1 0 17.6 0 8.8 8.8 0 0 0-17.6 0Z M3.2 12h17.6 M12 3.2v17.6 M6.1 5.4a13 13 0 0 0 0 13.2 M17.9 5.4a13 13 0 0 1 0 13.2",
  orbit:
    "M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Z M20.4 8.2c1.1 2.2.6 4.4-1.6 6.6-3.2 3.2-8.9 4.2-12.7 2.3-2.6-1.3-3.4-3.6-2.1-6 M18.3 5.7l2.4 2.3-3.2.8",
  target:
    "M12 3.6v3 M12 17.4v3 M3.6 12h3 M17.4 12h3 M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z M12 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z",
  query:
    "M10.4 4.2a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4Z M15.1 15.1 20 20 M8.2 9.2h4.4 M8.2 11.9h2.9",
  run: "M7.4 4.8 18.6 12 7.4 19.2Z",
  stop: "M7 7h10v10H7Z",
  check: "M4.8 12.6 9.6 17.4 19.2 6.6",
  warn: "M12 4 21 19.4H3Z M12 9.6v4.6 M12 16.6v.1",
  fault: "M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2Z M8.6 8.6l6.8 6.8 M15.4 8.6l-6.8 6.8",
  info: "M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2Z M12 10.6v6 M12 7.5v.1",
  chevron: "M9 5.4 15.6 12 9 18.6",
  close: "M6 6l12 12 M18 6 6 18",
  plus: "M12 5.4v13.2 M5.4 12h13.2",
  download: "M12 4v10.4 M7.6 10.6 12 15l4.4-4.4 M4.6 19.4h14.8",
  copy: "M9 3.6h8.4a1.8 1.8 0 0 1 1.8 1.8v8.4 M6.6 7.2h8.4a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8H6.6a1.8 1.8 0 0 1-1.8-1.8V9a1.8 1.8 0 0 1 1.8-1.8Z",
  trace: "M5.4 5.4h13.2 M5.4 12h9 M5.4 18.6h11 M20.4 12a1.4 1.4 0 1 0-2.8 0 1.4 1.4 0 0 0 2.8 0Z M18.8 18.6a1.4 1.4 0 1 0-2.8 0 1.4 1.4 0 0 0 2.8 0Z",
  model:
    "M12 3.6 18.6 7.2v7.2L12 18 5.4 14.4V7.2Z M12 10.8 18.6 7.2 M12 10.8 5.4 7.2 M12 10.8V18 M9.5 20.6h5",
  gauge: "M4.4 17.6a8.6 8.6 0 1 1 15.2 0 M12 17.6 16 9.8 M12 17.6h.1",
  grid: "M4.4 4.4h6v6h-6Z M13.6 4.4h6v6h-6Z M4.4 13.6h6v6h-6Z M13.6 13.6h6v6h-6Z",
  compare: "M12 3.6v16.8 M4.2 6.6h5.4v10.8H4.2Z M14.4 6.6h5.4v10.8h-5.4Z",
  expand: "M9 4.6H4.6V9 M15 4.6h4.4V9 M9 19.4H4.6V15 M15 19.4h4.4V15",
  collapse: "M4.6 9H9V4.6 M19.4 9H15V4.6 M4.6 15H9v4.4 M19.4 15H15v4.4",
  refresh:
    "M19.4 12a7.4 7.4 0 1 1-2.2-5.3 M19.4 4.8v4.2h-4.2",
  pin: "M12 20.6s6-6.1 6-10.2a6 6 0 1 0-12 0c0 4.1 6 10.2 6 10.2Z M12 8.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z",
  eye: "M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12Z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z",
  eyeOff:
    "M4.2 4.2 19.8 19.8 M9.4 9.6a2.8 2.8 0 0 0 4 4 M6.2 6.5C4.1 8.1 2.8 12 2.8 12s3.7 6.2 9.2 6.2c1.5 0 2.8-.4 4-1 M15 6.4c-.9-.4-1.9-.6-3-.6-.5 0-1 0-1.4.1",
  file: "M6.2 3.6h7.2L18.4 8.6v11.8H6.2Z M13.4 3.6v5h5",
  spark: "M12 3.4 13.6 9.4 19.6 11 13.6 12.6 12 18.6 10.4 12.6 4.4 11 10.4 9.4Z",
  terminal: "M4.4 5.4h15.2v13.2H4.4Z M7.6 10 10 12.4l-2.4 2.4 M12.8 14.8h4",
  link: "M10.2 13.8 13.8 10.2 M9 15l-1.6 1.6a3.4 3.4 0 0 1-4.8-4.8L4.2 10.2 M15 9l1.6-1.6a3.4 3.4 0 0 1 4.8 4.8L19.8 13.8",
};

const FILLED = new Set<IconName>(["run", "stop"]);

export default function Icon({
  name,
  size = 16,
  className,
  style,
  label,
  strokeWidth = 1.5,
}: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} />
    </svg>
  );
}

/** The product mark: an aperture reticle over an orbital track. */
export function Wordmark({ size = 26, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="SatQuery AI"
      focusable="false"
    >
      <defs>
        <linearGradient id="sq-mark-g" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--color-signal)" />
          <stop offset="1" stopColor="var(--color-violet)" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="17" stroke="var(--color-line-hi)" strokeWidth="1" opacity="0.75" />
      <ellipse
        cx="20"
        cy="20"
        rx="17"
        ry="6.4"
        stroke="var(--color-line-hi)"
        strokeWidth="1"
        opacity="0.5"
        transform="rotate(-24 20 20)"
      />
      <path
        d="M20 5.6 32.5 12.8v14.4L20 34.4 7.5 27.2V12.8Z"
        stroke="url(#sq-mark-g)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="4.6" stroke="var(--color-signal)" strokeWidth="1.4" />
      <circle cx="20" cy="20" r="1.5" fill="var(--color-signal)" />
      <path d="M20 5.6V15.4 M32.5 27.2 24.3 22.6 M7.5 27.2 15.7 22.6" stroke="var(--color-signal-2)" strokeWidth="1.1" />
      <circle
        cx="20"
        cy="3"
        r="1.9"
        fill="var(--color-verified)"
        className={animated ? "sq-orbit" : undefined}
        style={animated ? ({ ["--sp" as string]: "9s", transformOrigin: "20px 20px" } as CSSProperties) : undefined}
      />
    </svg>
  );
}
