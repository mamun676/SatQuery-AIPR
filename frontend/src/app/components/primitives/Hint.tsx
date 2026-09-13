"use client";
// Inline explanation disclosure. Keyboard-operable, no hover-only content.
import { useId, useState } from "react";
import type { ReactNode } from "react";
import Icon from "./Icon";

export default function Hint({
  children,
  label = "What this means",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // The label is optional, so the toggle keeps an accessible name either way.
  const fallbackName = label ? undefined : "Show explanation";
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={fallbackName}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 self-start text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-4)] transition-colors hover:text-[var(--color-signal)]"
      >
        <Icon name="info" size={11} />
        {label}
      </button>
      {open && (
        <span
          id={id}
          className="mt-1.5 block max-w-[62ch] border-l border-[var(--hair-hi)] pl-2.5 text-[11px] leading-[1.6] text-[var(--color-ink-3)]"
        >
          {children}
        </span>
      )}
    </span>
  );
}
