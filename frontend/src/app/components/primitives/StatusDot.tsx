"use client";
// Live indicator. The ping ring only runs while state is genuinely active.
import type { Tone } from "./Chip";

const COLOR: Record<Tone, string> = {
  neutral: "var(--color-ink-4)",
  signal: "var(--color-signal)",
  verified: "var(--color-verified)",
  caution: "var(--color-caution)",
  fault: "var(--color-fault)",
  violet: "var(--color-violet)",
};

export default function StatusDot({
  tone = "neutral",
  pulse = false,
  size = 7,
  label,
}: {
  tone?: Tone;
  pulse?: boolean;
  size?: number;
  label?: string;
}) {
  const color = COLOR[tone];
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {pulse && (
        <span
          className="sq-ping absolute inset-0 rounded-full"
          style={{ background: color, opacity: 0.5 }}
        />
      )}
      <span className="absolute inset-0 rounded-full" style={{ background: color }} />
    </span>
  );
}
