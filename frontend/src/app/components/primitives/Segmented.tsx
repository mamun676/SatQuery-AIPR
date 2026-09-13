"use client";
// Tab strip driven by aria-selected, so styling and semantics cannot diverge.
import Icon from "./Icon";
import type { IconName } from "./Icon";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** Reason shown on hover when disabled — never a silent dead control. */
  disabledReason?: string;
  badge?: string | number;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={["flex items-stretch", className].filter(Boolean).join(" ")}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={opt.disabled}
            title={opt.disabled ? opt.disabledReason : undefined}
            onClick={() => {
              if (!opt.disabled && !selected) onChange(opt.value);
            }}
            className="sq-tab"
            style={size === "sm" ? { padding: "5px 9px", fontSize: "9px" } : undefined}
          >
            {opt.icon && <Icon name={opt.icon} size={12} />}
            <span>{opt.label}</span>
            {opt.badge !== undefined && (
              <span className="sq-num ml-0.5 text-[9px] text-[var(--color-ink-4)]">{opt.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
