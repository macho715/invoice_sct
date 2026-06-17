-- 0019_jobs_re_run.sql
-- 2026-06-17 — OCR re-run pipeline (rule #0 compliance).
-- When Vision OCR completes with new lines/evidence, a re-run replays
-- parse → validate → export so the 13-sheet workbook reflects the OCR-
-- augmented data. State is stored per-job and polled via
-- POST /api/audit/re-run-status.
--
-- Self-heal: the read paths in job-store-pg.ts catch 42703 (undefined_column)
-- and 42P01 (undefined_table) and ALTER / CREATE idempotently, so audit
-- delivery is never blocked on a pending migration (Rule #0).

BEGIN;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS re_run_status                TEXT,
  ADD COLUMN IF NOT EXISTS re_run_id                    TEXT,
  ADD COLUMN IF NOT EXISTS re_run_triggered_by          TEXT,
  ADD COLUMN IF NOT EXISTS re_run_trigger               TEXT,
  ADD COLUMN IF NOT EXISTS re_run_pdf_sha256            TEXT,
  ADD COLUMN IF NOT EXISTS re_run_vision_operation_name TEXT,
  ADD COLUMN IF NOT EXISTS re_run_started_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS re_run_completed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS re_run_error_code            TEXT,
  ADD COLUMN IF NOT EXISTS re_run_error_message         TEXT,
  ADD COLUMN IF NOT EXISTS re_run_workbook_sha256       TEXT,
  ADD COLUMN IF NOT EXISTS re_run_workbook_size_bytes   INTEGER,
  ADD COLUMN IF NOT EXISTS re_run_workbook_blob_url     TEXT,
  ADD COLUMN IF NOT EXISTS re_run_prior_variance_aed    NUMERIC,
  ADD COLUMN IF NOT EXISTS re_run_new_variance_aed      NUMERIC,
  ADD COLUMN IF NOT EXISTS re_run_prior_verdict         TEXT,
  ADD COLUMN IF NOT EXISTS re_run_new_verdict           TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_re_run_status
  ON jobs(re_run_status)
  WHERE re_run_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_re_run_pdf_sha256
  ON jobs(re_run_pdf_sha256)
  WHERE re_run_pdf_sha256 IS NOT NULL;

COMMIT;
