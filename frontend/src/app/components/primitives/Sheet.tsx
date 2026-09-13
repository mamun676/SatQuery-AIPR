"use client";
// Mobile/tablet drawer. Focus is trapped to the panel and Escape closes it.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import Icon from "./Icon";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Fraction of viewport height the sheet occupies. */
  height?: string;
}

export default function Sheet({ open, onClose, title, children, height = "86vh" }: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div
      className="fixed inset-0 z-[900]"
      style={{ pointerEvents: open ? "auto" : "none" }}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default border-0 transition-opacity duration-300"
        style={{
          background: "rgba(2,4,8,0.72)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open}
        aria-label={title}
        tabIndex={-1}
        data-open={open}
        className="sq-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[14px] border-t border-[var(--hair-hi)] outline-none"
        style={{ height, background: "var(--color-panel)" }}
      >
        <div className="flex items-center justify-between border-b border-[var(--hair)] px-4 py-3">
          <span className="sq-label">{title}</span>
          <button type="button" className="sq-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="sq-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
        <div
          className="mx-auto mb-2 mt-1 h-1 w-10 shrink-0 rounded-full"
          style={{ background: "var(--hair-hi)" }}
        />
      </div>
    </div>
  );
}
