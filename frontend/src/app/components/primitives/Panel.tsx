"use client";
// Instrument panel: bezel, monospace header rail, optional collapse.
import { useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Icon from "./Icon";
import type { IconName } from "./Icon";

export interface PanelProps {
  title?: string;
  /** Small right-aligned reading in the header rail (counts, units, ids). */
  meta?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Corner brackets. On by default; off for nested panels. */
  bezel?: boolean;
  quiet?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Rendered instead of children when there is genuinely nothing to show. */
  padding?: "none" | "tight" | "normal";
}

const PAD: Record<NonNullable<PanelProps["padding"]>, string> = {
  none: "",
  tight: "px-3 py-2.5",
  normal: "px-3.5 py-3",
};

export default function Panel({
  title,
  meta,
  icon,
  actions,
  children,
  className,
  style,
  bezel = true,
  quiet = false,
  collapsible = false,
  defaultOpen = true,
  padding = "normal",
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shell = [quiet ? "sq-panel-quiet" : "sq-panel", bezel && !quiet ? "sq-tk" : "", className]
    .filter(Boolean)
    .join(" ");
  const showBody = !collapsible || open;

  return (
    <section className={shell} style={style}>
      {title !== undefined && (
        <header className="flex items-center gap-2 border-b border-[var(--hair)] px-3.5 py-2">
          {icon && <Icon name={icon} size={13} className="text-[var(--color-ink-4)] shrink-0" />}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="sq-label flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-[var(--color-ink-2)]"
            >
              <Icon
                name="chevron"
                size={11}
                className="shrink-0 transition-transform duration-200"
                style={{ transform: open ? "rotate(90deg)" : "none" }}
              />
              <span className="truncate">{title}</span>
            </button>
          ) : (
            <h2 className="sq-label min-w-0 flex-1 truncate">{title}</h2>
          )}
          {meta !== undefined && (
            <div className="sq-num shrink-0 text-[10.5px] text-[var(--color-ink-3)]">{meta}</div>
          )}
          {actions !== undefined && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      {showBody && (
        <div id={bodyId} className={PAD[padding]}>
          {children}
        </div>
      )}
    </section>
  );
}
