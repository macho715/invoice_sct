BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'CREATED',
  verdict TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rule_version TEXT NOT NULL DEFAULT 'rule-0.1.0',
  parser_version TEXT NOT NULL DEFAULT 'parser-0.1.0'
);

CREATE TABLE IF NOT EXISTS source_files (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  blob_ref TEXT NOT NULL,
  blob_url TEXT,
  parser_status TEXT NOT NULL DEFAULT 'PENDING',
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, file_id)
);

CREATE TABLE IF NOT EXISTS audit_traces (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  input_ref TEXT NOT NULL,
  output_ref TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rule_version TEXT,
  source_hash TEXT,
  calculation_hash TEXT,
  latency_ms INTEGER,
  was_derived_from TEXT,
  attributed_to TEXT
);

CREATE TABLE IF NOT EXISTS gate_results (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE UNIQUE,
  verdict TEXT NOT NULL,
  result_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS normalized_invoices (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE UNIQUE,
  invoice_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS validation_results (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE UNIQUE,
  validation_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_records (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE UNIQUE,
  approval_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fx_policies (
  fx_policy_id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  fx_rate DOUBLE PRECISION NOT NULL,
  rate_date DATE NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  approved_by TEXT NOT NULL,
  proof_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_files_job_id ON source_files(job_id);
CREATE INDEX IF NOT EXISTS idx_audit_traces_job_id ON audit_traces(job_id);
CREATE INDEX IF NOT EXISTS idx_fx_policies_currencies ON fx_policies(from_currency, to_currency);

COMMIT;