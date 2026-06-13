-- 0010_invoices.sql
-- Adds the `invoices` table backing the `check_duplicate_invoice` MCP tool.
-- The table stores only hashed identifiers and numeric amounts — never raw
-- PII, BL numbers, vendor emails or raw contract rates (DLP / P2 policy).

BEGIN;

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id        TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL,
  vendor_hash       TEXT NOT NULL,
  invoice_no_hash   TEXT NOT NULL,
  amount            NUMERIC(18, 2) NOT NULL,
  currency          TEXT,
  issue_date        DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Same logical invoice (vendor + invoice_no) must never appear twice.
  -- Different amounts for the same (vendor, invoice_no) ARE allowed — that
  -- surfaces as AMBER (AMOUNT_MISMATCH) at audit time rather than being
  -- silently dropped.
  CONSTRAINT invoices_vendor_invoice_uniq
    UNIQUE (vendor_hash, invoice_no_hash, amount)
);

-- Lookup index used by `check_duplicate_invoice`. Composite so the
-- (vendor_hash, invoice_no_hash) probe is index-only.
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_invoice
  ON invoices (vendor_hash, invoice_no_hash);

CREATE INDEX IF NOT EXISTS idx_invoices_job_id
  ON invoices (job_id);

COMMIT;
