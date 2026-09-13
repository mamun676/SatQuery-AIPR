"use client";
// Dense definition rows for metadata read straight off the raster.
import type { ReactNode } from "react";

export interface KeyValueRow {
  key: string;
  label: string;
  value: ReactNode;
  /** Rendered in monospace — for ids, CRS strings, paths. */
  mono?: boolean;
  full?: boolean;
}

export default function KeyValue({
  rows,
  columns = 2,
}: {
  rows: KeyValueRow[];
  columns?: 1 | 2 | 3;
}) {
  if (rows.length === 0) return null;
  return (
    <dl
      className="grid gap-x-4 gap-y-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {rows.map((row) => (
        <div
          key={row.key}
          className="min-w-0"
          style={row.full ? { gridColumn: `span ${columns} / span ${columns}` } : undefined}
        >
          <dt className="sq-label mb-1 truncate" title={row.label}>
            {row.label}
          </dt>
          <dd
            className={[
              "min-w-0 break-words text-[12px] leading-[1.45] text-[var(--color-ink)]",
              row.mono ? "sq-num" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
