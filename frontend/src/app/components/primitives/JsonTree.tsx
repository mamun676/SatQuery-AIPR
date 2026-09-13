"use client";
// Collapsible reader for the untouched backend payload. Renders exactly what
// it is given — no key renaming, no value coercion, no hidden fields.
import { useState } from "react";
import Icon from "./Icon";

type Json = unknown;

function typeOf(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

const SCALAR_COLOR: Record<string, string> = {
  string: "var(--color-verified)",
  number: "var(--color-signal)",
  boolean: "var(--color-violet)",
  null: "var(--color-ink-4)",
  undefined: "var(--color-ink-4)",
};

function Scalar({ value }: { value: Json }) {
  const t = typeOf(value);
  const text =
    t === "string" ? `"${String(value)}"` : t === "undefined" ? "undefined" : String(value);
  return (
    <span className="sq-num break-all text-[11px]" style={{ color: SCALAR_COLOR[t] ?? "var(--color-ink-2)" }}>
      {text}
    </span>
  );
}

interface NodeProps {
  name: string | null;
  value: Json;
  depth: number;
  defaultOpenDepth: number;
}

function Node({ name, value, depth, defaultOpenDepth }: NodeProps) {
  const t = typeOf(value);
  const branch = t === "object" || t === "array";
  const [open, setOpen] = useState(depth < defaultOpenDepth);

  if (!branch) {
    return (
      <div className="flex items-baseline gap-1.5 py-[1.5px]" style={{ paddingLeft: depth * 12 }}>
        {name !== null && <span className="sq-num text-[11px] text-[var(--color-ink-3)]">{name}</span>}
        {name !== null && <span className="text-[11px] text-[var(--color-ink-4)]">:</span>}
        <Scalar value={value} />
      </div>
    );
  }

  const entries: Array<[string, Json]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, Json>);
  const count = entries.length;
  const brace = Array.isArray(value) ? `[${count}]` : `{${count}}`;

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 py-[1.5px] text-left transition-colors hover:text-[var(--color-ink)]"
      >
        <Icon
          name="chevron"
          size={10}
          className="shrink-0 text-[var(--color-ink-4)] transition-transform duration-150"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        />
        <span className="sq-num text-[11px] text-[var(--color-ink-2)]">{name ?? "root"}</span>
        <span className="sq-num text-[10px] text-[var(--color-ink-4)]">{brace}</span>
      </button>
      {open &&
        (count === 0 ? (
          <div className="py-[1.5px] pl-[14px] text-[10.5px] italic text-[var(--color-ink-4)]">empty</div>
        ) : (
          entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} defaultOpenDepth={defaultOpenDepth} />
          ))
        ))}
    </div>
  );
}

export default function JsonTree({
  data,
  name = null,
  defaultOpenDepth = 1,
}: {
  data: unknown;
  name?: string | null;
  defaultOpenDepth?: number;
}) {
  return (
    <div className="sq-mono leading-[1.55]">
      <Node name={name} value={data} depth={0} defaultOpenDepth={defaultOpenDepth} />
    </div>
  );
}
