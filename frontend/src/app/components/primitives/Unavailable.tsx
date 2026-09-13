"use client";
// The designed "genuinely not available" state. Used instead of fabricating a
// value, a footprint or a placeholder number.
import type { ReactNode } from "react";
import Icon from "./Icon";
import type { IconName } from "./Icon";

export interface UnavailableProps {
  title: string;
  body?: string;
  icon?: IconName;
  /** Verbatim backend reason, shown as monospace detail. */
  detail?: string | null;
  action?: ReactNode;
  compact?: boolean;
}

export default function Unavailable({
  title,
  body,
  icon = "info",
  detail,
  action,
  compact = false,
}: UnavailableProps) {
  return (
    <div
      className={[
        "sq-panel-quiet flex flex-col items-center text-center",
        compact ? "gap-1.5 px-3 py-4" : "gap-2 px-5 py-7",
      ].join(" ")}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(148,175,208,0.028) 0 1px, transparent 1px 7px)",
      }}
    >
      <span
        className="mb-0.5 flex items-center justify-center rounded-full border border-[var(--hair-hi)]"
        style={{ width: compact ? 24 : 30, height: compact ? 24 : 30 }}
      >
        <Icon name={icon} size={compact ? 12 : 14} className="text-[var(--color-ink-4)]" />
      </span>
      <p
        className={[
          "font-medium text-[var(--color-ink-2)]",
          compact ? "text-[11.5px]" : "text-[12.5px]",
        ].join(" ")}
      >
        {title}
      </p>
      {body && (
        <p className="max-w-[46ch] text-[11px] leading-[1.55] text-[var(--color-ink-4)]">{body}</p>
      )}
      {detail && (
        <p className="sq-mono max-w-[52ch] break-words text-[10px] leading-[1.5] text-[var(--color-ink-4)]">
          {detail}
        </p>
      )}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
