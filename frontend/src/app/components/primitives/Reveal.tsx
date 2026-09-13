"use client";
// Declarative wrapper over the CSS reveal keyframes. `key`-change re-triggers.
import type { CSSProperties, ElementType, ReactNode } from "react";

export interface RevealProps {
  children: ReactNode;
  /** Stagger index; multiplied by `step`. */
  index?: number;
  step?: number;
  delay?: number;
  axis?: "y" | "x" | "scale";
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

const CLASS: Record<NonNullable<RevealProps["axis"]>, string> = {
  y: "sq-rv",
  x: "sq-rv-x",
  scale: "sq-rv-scale",
};

export default function Reveal({
  children,
  index = 0,
  step = 45,
  delay = 0,
  axis = "y",
  as,
  className,
  style,
}: RevealProps) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={[CLASS[axis], className].filter(Boolean).join(" ")}
      style={{ ["--d" as string]: `${delay + index * step}ms`, ...style }}
    >
      {children}
    </Tag>
  );
}
