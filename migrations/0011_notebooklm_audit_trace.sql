BEGIN;

ALTER TABLE audit_traces
  ADD COLUMN IF NOT EXISTS notebooklm_source_id TEXT,
  ADD COLUMN IF NOT EXISTS notebooklm_summary_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notebooklm_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS notebooklm_flags JSONB,
  ADD COLUMN IF NOT EXISTS dual_extraction_mismatches JSONB;

COMMIT;
