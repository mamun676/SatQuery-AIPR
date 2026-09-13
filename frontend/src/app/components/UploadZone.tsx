"use client";
// ═════════════════════════════════════════════════════════════════════════
// Ingestion slots.
//
// Two slots maximum, matching the backend's MAX_FILES. Every role the
// validator understands is selectable here — the previous build only ever
// emitted single/t1/t2, which made optical–SAR fusion unreachable from the UI.
//
// The predicted mode shown below mirrors validator.determineMode exactly and
// is labelled as a prediction: the server's validation response is what counts.
// ═════════════════════════════════════════════════════════════════════════
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { FileRole, InputMode } from "@/server/satquery/types";
import { formatBytes, modeLabel, roleLabel } from "@/lib/format";
import Chip from "./primitives/Chip";
import Icon from "./primitives/Icon";

export interface PendingFile {
  file: File;
  role: FileRole;
}

export const MAX_FILES = 2;
const ALLOWED_EXT = new Set(["tif", "tiff", "png", "jpg", "jpeg"]);
const ROLES: FileRole[] = ["single", "optical", "sar", "t1", "t2"];

export function extensionOf(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function isSupportedName(name: string): boolean {
  return ALLOWED_EXT.has(extensionOf(name));
}

/** Mirrors server/satquery/validator.ts determineMode(). */
export function predictMode(pending: PendingFile[]): InputMode | null {
  if (pending.length === 1) return "single_image";
  if (pending.length === 2) {
    const roles = pending.map((p) => p.role);
    if (roles.includes("t1") && roles.includes("t2")) return "bitemporal";
    if (roles.includes("optical") && roles.includes("sar")) return "optical_sar";
    return "bitemporal";
  }
  return null;
}

/** Default roles for a fresh pair: bi-temporal, the commoner two-file case. */
function defaultRole(index: number, total: number): FileRole {
  if (total <= 1) return "single";
  return index === 0 ? "t1" : "t2";
}

export interface UploadZoneProps {
  pending: PendingFile[];
  onChange: (next: PendingFile[]) => void;
  disabled: boolean;
  /** True once the current selection has been uploaded and validated. */
  validated: boolean;
}

/** Roles that only make sense in a two-file job. */
const PAIR_ONLY: FileRole[] = ["optical", "sar", "t1", "t2"];

export default function UploadZone({ pending, onChange, disabled, validated }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  const accept = useMemo(
    () => Array.from(ALLOWED_EXT).map((e) => `.${e}`).join(","),
    [],
  );

  const absorb = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const bad = list.filter((f) => !isSupportedName(f.name)).map((f) => f.name);
      const good = list.filter((f) => isSupportedName(f.name));
      setRejected(bad);
      if (good.length === 0) return;

      // Keep what is already staged, top up to MAX_FILES, then re-derive the
      // default roles only when the caller had not customised them.
      const merged = [...pending];
      for (const file of good) {
        if (merged.length >= MAX_FILES) break;
        if (merged.some((p) => p.file.name === file.name && p.file.size === file.size)) continue;
        merged.push({ file, role: "single" });
      }
      const total = merged.length;
      const next = merged.map((p, i) => ({ file: p.file, role: defaultRole(i, total) }));
      onChange(next);
    },
    [onChange, pending],
  );

  const onPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) absorb(e.target.files);
      // Allow re-selecting the same file after a removal.
      e.target.value = "";
    },
    [absorb],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      if (e.dataTransfer?.files) absorb(e.dataTransfer.files);
    },
    [absorb, disabled],
  );

  const setRole = useCallback(
    (index: number, role: FileRole) => {
      onChange(pending.map((p, i) => (i === index ? { ...p, role } : p)));
    },
    [onChange, pending],
  );

  const remove = useCallback(
    (index: number) => {
      const kept = pending.filter((_, i) => i !== index);
      const total = kept.length;
      onChange(kept.map((p, i) => (total === 1 ? { ...p, role: "single" } : { ...p, role: defaultRole(i, total) })));
      setRejected([]);
    },
    [onChange, pending],
  );

  const mode = predictMode(pending);
  const full = pending.length >= MAX_FILES;
  const roleClash =
    pending.length === 2 && pending[0].role === pending[1].role
      ? `Both slots are marked “${roleLabel(pending[0].role)}” — the validator will treat this as a bi-temporal pair.`
      : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="sq-panel-quiet relative overflow-hidden rounded-md px-3 py-3 transition-colors"
        style={{
          borderColor: dragging ? "var(--color-signal)" : undefined,
          background: dragging ? "color-mix(in oklab, var(--color-signal) 8%, transparent)" : undefined,
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="sq-tk" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="sq-label-hi">Imagery ingest</div>
            <p className="mt-1 text-[11.5px] leading-snug text-[var(--color-ink-3)]">
              GeoTIFF, TIFF, PNG or JPEG · up to {MAX_FILES} rasters ·{" "}
              <span className="sq-mono">multipart/form-data</span> to{" "}
              <span className="sq-mono">/api/upload</span>
            </p>
          </div>
          <button
            type="button"
            className="sq-btn sq-btn-sm shrink-0"
            disabled={disabled || full}
            onClick={() => inputRef.current?.click()}
            title={full ? "Both slots are occupied — remove one to stage a different raster." : undefined}
          >
            <Icon name="plus" size={13} />
            {pending.length === 0 ? "Select rasters" : "Add raster"}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={onPick}
          disabled={disabled}
          aria-label="Select satellite rasters to analyse"
        />

        {pending.length === 0 ? (
          <div className="mt-2.5 flex items-center gap-2 rounded border border-dashed border-[var(--hair-hi)] px-2.5 py-3">
            <Icon name="layers" size={15} className="text-[var(--color-ink-4)]" />
            <span className="text-[11.5px] text-[var(--color-ink-4)]">
              Drop imagery here, or select files. Nothing is uploaded until you run a query.
            </span>
          </div>
        ) : (
          <ul className="mt-2.5 flex flex-col gap-1.5" aria-label="Staged rasters">
            {pending.map((p, i) => (
              <li
                key={`${p.file.name}-${p.file.size}-${i}`}
                className="sq-panel flex items-center gap-2 rounded px-2 py-1.5"
              >
                <span className="sq-num shrink-0 text-[10px] text-[var(--color-ink-4)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Icon name="file" size={14} className="shrink-0 text-[var(--color-signal)]" />
                <span className="min-w-0 flex-1 truncate text-[11.5px]" title={p.file.name}>
                  {p.file.name}
                </span>
                <span className="sq-num shrink-0 text-[10px] text-[var(--color-ink-4)]">
                  {formatBytes(p.file.size)}
                </span>
                <label className="shrink-0">
                  <span className="sr-only">Role for {p.file.name}</span>
                  <select
                    className="sq-select text-[10.5px]"
                    value={p.role}
                    disabled={disabled}
                    onChange={(e) => setRole(i, e.target.value as FileRole)}
                  >
                    {ROLES.filter((r) => (pending.length === 1 ? !PAIR_ONLY.includes(r) || r === p.role : true)).map(
                      (r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  className="sq-icon-btn shrink-0"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  aria-label={`Remove ${p.file.name}`}
                  title="Remove"
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(mode || rejected.length > 0 || roleClash) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {mode && (
            <Chip
              tone={validated ? "verified" : "signal"}
              icon={mode === "bitemporal" ? "bitemporal" : mode === "optical_sar" ? "sar" : "aperture"}
              title={
                validated
                  ? "Mode confirmed by the server's validation response."
                  : "Predicted locally from file count and roles — the server's validation response is authoritative."
              }
            >
              {validated ? "Mode" : "Predicted mode"} · {modeLabel(mode)}
            </Chip>
          )}
          {rejected.length > 0 && (
            <Chip tone="caution" icon="warn" title={rejected.join(", ")}>
              {rejected.length} file{rejected.length === 1 ? "" : "s"} skipped · unsupported format
            </Chip>
          )}
          {roleClash && (
            <Chip tone="caution" icon="info" title={roleClash}>
              Duplicate roles
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}
