-- Bootstrap DDL for SatQuery AI, matching db/schema.ts exactly.
-- Apply once against the database referenced by DATABASE_URL:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS uploads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  files       jsonb NOT NULL,
  validation  jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id             uuid NOT NULL,
  query                 text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  mode                  text,
  intent                jsonb,
  workflow              text,
  models_used           jsonb,
  parameters            jsonb,
  evidence              jsonb,
  confidence            real,
  confidence_breakdown  jsonb,
  answer                text,
  warnings              jsonb,
  trace                 jsonb,
  report_text           text,
  error_message         text,
  used_fallback         boolean DEFAULT false,
  duration_ms           integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_upload_id_idx ON jobs (upload_id);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);
