"use client";
// ═════════════════════════════════════════════════════════════════════════
// SatQuery AI — motion utilities
//
// The motion system is pure CSS (see globals.css); these helpers only feed it
// custom properties and expose the browser signals React needs. No animation
// library is bundled, so nothing here adds weight to the client payload.
// ═════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/** Stagger delay for `.sq-rv` / `.sq-rv-x` / `.sq-rv-scale`. */
export function reveal(index: number, stepMs = 45, baseMs = 0): CSSProperties {
  return { ["--d" as string]: `${baseMs + index * stepMs}ms` };
}

/** Path length for `.sq-draw` stroke-dasharray animation. */
export function draw(length: number, delayMs = 0): CSSProperties {
  return { ["--len" as string]: String(length), ["--d" as string]: `${delayMs}ms` };
}

/** Orbit period for `.sq-orbit`. */
export function orbit(seconds: number, delayMs = 0): CSSProperties {
  return { ["--sp" as string]: `${seconds}s`, ["--d" as string]: `${delayMs}ms` };
}

/** Generic CSS custom-property bag, typed without `any`. */
export function vars(entries: Record<string, string | number>): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k.startsWith("--") ? k : `--${k}`] = String(v);
  }
  return out as CSSProperties;
}

/** True once the component has mounted on the client. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

/** Live media-query subscription; false during SSR. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Honours the OS reduced-motion setting; drives conditional decorations. */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * Real elapsed milliseconds since `active` became true, measured client-side
 * with performance.now(). This is an honest wall-clock reading, not a
 * simulated progress value.
 */
export function useElapsed(active: boolean, tickMs = 100): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      return;
    }
    startRef.current = performance.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      if (startRef.current !== null) setElapsed(performance.now() - startRef.current);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [active, tickMs]);

  return elapsed;
}

/** Debounced value, for search/filter inputs over large trace lists. */
export function useDebounced<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Registers a global keyboard shortcut. Ignores keystrokes typed into inputs
 * unless `allowInFields` is set, so ⌘K-style bindings do not hijack typing.
 */
export function useHotkey(
  combo: { key: string; meta?: boolean; shift?: boolean; allowInFields?: boolean },
  handler: () => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const { key, meta = false, shift = false, allowInFields = false } = combo;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      const wantsMeta = meta;
      const hasMeta = event.metaKey || event.ctrlKey;
      if (wantsMeta !== hasMeta) return;
      if (shift !== event.shiftKey) return;
      if (!allowInFields) {
        const target = event.target;
        if (target instanceof HTMLElement) {
          const tag = target.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
            return;
          }
        }
      }
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, meta, shift, allowInFields]);
}

/** Observed element size, used by the imagery canvas and compare slider. */
export function useElementSize<T extends HTMLElement>(): {
  ref: (node: T | null) => void;
  size: { width: number; height: number };
} {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateSize = (width: number, height: number) => {
      setSize((previous) => {
        if (previous.width === width && previous.height === height) {
          return previous;
        }
        return { width, height };
      });
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      updateSize(
        Math.round(entry.contentRect.width),
        Math.round(entry.contentRect.height),
      );
    });

    ro.observe(node);
    observerRef.current = ro;

    updateSize(node.clientWidth, node.clientHeight);
  }, []);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return { ref, size };
}