CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  verdict TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  parser_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_files (
  file_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  blob_ref TEXT NOT NULL,
  blob_url TEXT,
  parser_status TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(job_id)
);

CREATE TABLE IF NOT EXISTS audit_traces (
  trace_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  step TEXT NOT NULL,
  input_ref TEXT NOT NULL,
  output_ref TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  rule_version TEXT,
  source_hash TEXT,
  calculation_hash TEXT,
  latency_ms INTEGER,
  wasDerivedFrom TEXT,
  attributedTo TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(job_id)
);

CREATE TABLE IF NOT EXISTS gate_results (
  job_id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  line_results TEXT NOT NULL,
  action_items TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(job_id)
);

CREATE TABLE IF NOT EXISTS normalized_invoices (
  invoice_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  invoice_header TEXT NOT NULL,
  invoice_lines TEXT NOT NULL,
  evidence_candidates TEXT NOT NULL,
  parser_confidence REAL NOT NULL,
  parser_version TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(job_id)
);

CREATE TABLE IF NOT EXISTS validation_results (
  validation_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  sct_trace_id TEXT NOT NULL,
  cf_mcp_tool_calls TEXT NOT NULL,
  type_b_results TEXT NOT NULL,
  rate_checks TEXT NOT NULL,
  evidence_requirements TEXT NOT NULL,
  costguard_results TEXT NOT NULL,
  doc_guardian_results TEXT NOT NULL,
  gate_results TEXT NOT NULL,
  confidence REAL NOT NULL,
  reason_codes TEXT NOT NULL,
  warnings TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(job_id)
);

CREATE TABLE IF NOT EXISTS approval_records (
  approval_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  approval_scope TEXT NOT NULL,
  acknowledgement_reason TEXT,
  prism_kernel_proof_ref TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(job_id)
);

CREATE TABLE IF NOT EXISTS human_gate_triggers (
  trigger_id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  name TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  required_role TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  FOREIGN KEY (approval_id) REFERENCES approval_records(approval_id)
);

CREATE TABLE IF NOT EXISTS fx_policies (
  fx_policy_id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  fx_rate REAL NOT NULL,
  rate_date TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  proof_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_records (
  export_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  export_data TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(job_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_source_files_job_id ON source_files(job_id);
CREATE INDEX IF NOT EXISTS idx_audit_traces_job_id ON audit_traces(job_id);
CREATE INDEX IF NOT EXISTS idx_human_gate_triggers_approval_id ON human_gate_triggers(approval_id);
CREATE INDEX IF NOT EXISTS idx_export_records_job_id ON export_records(job_id);
