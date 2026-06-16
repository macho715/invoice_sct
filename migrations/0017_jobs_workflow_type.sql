BEGIN;

-- Add workflow_type to the jobs table.
--
-- Background: migration 0009 created `jobs` without a workflow_type column, but
-- the application (apps/web/src/lib/job-store-pg.ts) reads and writes
-- workflow_type on every createJob / updateJob / SELECT. On databases provisioned
-- from 0009 (before workflow_type was introduced) the ingest path fails with
--   column "workflow_type" of relation "jobs" does not exist   (Postgres 42703)
-- surfaced to the client as STORAGE_AUTH_FAILED.
--
-- workflow_type distinguishes the two audit pipelines:
--   'SHIPMENT' (default) — HVDC shipment invoices (charge_code rate cards)
--   'DOMESTIC'           — Korean domestic delivery invoices (lane rate cards)
-- Mirrors the same column/constraint added to rate_cards in migration 0016.
--
-- Idempotent: safe to run on databases that already have the column.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS workflow_type TEXT NOT NULL DEFAULT 'SHIPMENT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_jobs_workflow_type'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT chk_jobs_workflow_type
      CHECK (workflow_type IN ('SHIPMENT', 'DOMESTIC'));
  END IF;
END $$;

COMMIT;
