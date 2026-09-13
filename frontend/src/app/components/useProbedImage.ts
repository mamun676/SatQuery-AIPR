"use client";
// Loads the first URL in a candidate list that actually resolves.
//
// The backend reports one mask URL; the tools write several differently-named
// previews. Rather than rendering a broken image or inventing a filename, each
// candidate is probed in order and the outcome is reported truthfully.
import { useEffect, useState } from "react";

export type ProbeState = "idle" | "loading" | "ready" | "missing";

export interface ProbedImage {
  state: ProbeState;
  url: string | null;
  natural: { width: number; height: number } | null;
  /** URLs that were tried and failed — surfaced in the technical view. */
  attempted: string[];
}

const EMPTY: ProbedImage = { state: "idle", url: null, natural: null, attempted: [] };

export function useProbedImage(candidates: string[]): ProbedImage {
  const key = candidates.join("|");
  const [result, setResult] = useState<ProbedImage>(EMPTY);

  useEffect(() => {
    const list = key === "" ? [] : key.split("|");
    if (list.length === 0) {
      setResult(EMPTY);
      return;
    }
    let cancelled = false;
    setResult({ state: "loading", url: null, natural: null, attempted: [] });

    const tried: string[] = [];
    const attempt = (i: number) => {
      if (cancelled) return;
      if (i >= list.length) {
        setResult({ state: "missing", url: null, natural: null, attempted: tried });
        return;
      }
      const url = list[i];
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        setResult({
          state: "ready",
          url,
          natural: { width: img.naturalWidth, height: img.naturalHeight },
          attempted: tried,
        });
      };
      img.onerror = () => {
        tried.push(url);
        attempt(i + 1);
      };
      img.src = url;
    };
    attempt(0);

    return () => {
      cancelled = true;
    };
  }, [key]);

  return result;
}
