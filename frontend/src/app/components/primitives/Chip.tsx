"use client";
// Compact state token. Tone maps to the palette's semantic colours.
import type { ReactNode } from "react";
import Icon from "./Icon";
import type { IconName } from "./Icon";

export type Tone = "neutral" | "signal" | "verified" | "caution" | "fault" | "violet";

export interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  icon?: IconName;
  title?: string;
  className?: string;
}

export default function Chip({ children, tone = "neutral", icon, title, className }: ChipProps) {
  return (
    <span
      className={["sq-chip", className].filter(Boolean).join(" ")}
      data-tone={tone === "neutral" ? undefined : tone}
      title={title}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}
