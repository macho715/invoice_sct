BEGIN;

-- Add workflow_type column to support SHIPMENT vs DOMESTIC workflow routing.
-- Default to 'SHIPMENT' for backward compatibility with existing jobs.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_type TEXT NOT NULL DEFAULT 'SHIPMENT';

-- Add check constraint to enforce valid workflow types.
ALTER TABLE jobs ADD CONSTRAINT chk_workflow_type CHECK (workflow_type IN ('SHIPMENT', 'DOMESTIC'));

-- Index for querying jobs by workflow type (dashboard/filtering use cases).
CREATE INDEX IF NOT EXISTS idx_jobs_workflow_type ON jobs(workflow_type);

COMMIT;
