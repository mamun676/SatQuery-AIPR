// Observable execution trace logger (backend/output/trace_logger.py).
//
// Only operational/execution information is recorded here — never hidden
// chain-of-thought or private reasoning.
import type { TraceEvent } from "./types";

export class TraceLogger {
  private events: TraceEvent[] = [];

  log(stage: string, message: string, data?: Record<string, unknown>): void {
    this.events.push({ stage, timestamp: new Date().toISOString(), message, data });
  }

  all(): TraceEvent[] {
    return this.events;
  }
}
