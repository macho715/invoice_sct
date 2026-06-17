-- 0018_jobs_vision_status.sql
-- 2026-06-17 — Approval-gated Vision OCR (rule #0 compliance).
-- Vision OCR is now triggered by reviewer approval
-- (POST /api/audit/approve { enable_vision: true }), not by the first parse
-- or a global env flag. This migration stores the per-job Vision operation
-- state (operation_name, status, source/target GCS URIs, OCR result) so
-- POST /api/audit/vision-status can poll and the run route can merge
-- OCR-derived lines after the operation completes.
--
-- Self-heal: the read paths in job-store-pg.ts catch 42703 (undefined_column)
-- and 42P01 (undefined_table) and ALTER / CREATE idempotently, so audit
-- delivery is never blocked on a pending migration (Rule #0).

BEGIN;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS vision_status                 TEXT,
  ADD COLUMN IF NOT EXISTS vision_operation_name        TEXT,
  ADD COLUMN IF NOT EXISTS vision_pdf_file_id           TEXT,
  ADD COLUMN IF NOT EXISTS vision_pdf_sha256            TEXT,
  ADD COLUMN IF NOT EXISTS vision_source_gcs_uri        TEXT,
  ADD COLUMN IF NOT EXISTS vision_output_gcs_prefix     TEXT,
  ADD COLUMN IF NOT EXISTS vision_started_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vision_completed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vision_updated_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vision_error_code            TEXT,
  ADD COLUMN IF NOT EXISTS vision_error_message         TEXT,
  ADD COLUMN IF NOT EXISTS vision_ocr_result_json       JSONB;

CREATE INDEX IF NOT EXISTS idx_jobs_vision_status
  ON jobs(vision_status)
  WHERE vision_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_vision_pdf_sha256
  ON jobs(vision_pdf_sha256)
  WHERE vision_pdf_sha256 IS NOT NULL;

COMMIT;
