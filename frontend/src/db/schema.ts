// Drizzle ORM schema for SatQuery AI.
//
// Two tables back the whole pipeline:
//  - `uploads`   : the result of POST /api/upload — validated file metadata.
//  - `jobs`      : the result of POST /api/analyze — the full agentic run
//                  (query understanding, controller routing, tool outputs,
//                  evidence, confidence, synthesis, trace, report).
import { pgTable, uuid, text, jsonb, real, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  files: jsonb("files").$type<Record<string, unknown>[]>().notNull(),
  validation: jsonb("validation").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull(),
  query: text("query").notNull(),
  status: text("status").notNull().default("pending"), // pending|validating|understanding|routing|running|postprocessing|evidence|synthesizing|completed|failed
  mode: text("mode"), // single_image | optical_sar | bitemporal
  intent: jsonb("intent").$type<Record<string, unknown>>(),
  workflow: text("workflow"),
  modelsUsed: jsonb("models_used").$type<Record<string, unknown>[]>(),
  parameters: jsonb("parameters").$type<Record<string, unknown>>(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  confidence: real("confidence"),
  confidenceBreakdown: jsonb("confidence_breakdown").$type<Record<string, unknown>>(),
  answer: text("answer"),
  warnings: jsonb("warnings").$type<string[]>(),
  trace: jsonb("trace").$type<Record<string, unknown>>(),
  reportText: text("report_text"),
  errorMessage: text("error_message"),
  usedFallback: boolean("used_fallback").default(false),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
