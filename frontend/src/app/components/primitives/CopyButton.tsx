"use client";
// Clipboard control with a real success/failure state — never a fake tick.
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export default function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    const reset = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 1600);
    };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setState("done");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
    reset();
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={["sq-icon-btn", className].filter(Boolean).join(" ")}
      aria-label={state === "done" ? "Copied" : state === "error" ? "Copy unavailable" : label}
      title={state === "error" ? "Clipboard unavailable in this context" : label}
    >
      <Icon
        name={state === "done" ? "check" : state === "error" ? "warn" : "copy"}
        size={13}
        style={{
          color:
            state === "done"
              ? "var(--color-verified)"
              : state === "error"
                ? "var(--color-caution)"
                : undefined,
        }}
      />
    </button>
  );
}
