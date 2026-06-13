-- 0001_initial.sql
-- Invoice Audit Platform MVP - initial schema (P0-6)
-- Targets: Neon Postgres 16+

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Jobs: durable job store
CREATE TABLE jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL CHECK (status IN ('pending', 'parsing', 'validating', 'review', 'exporting', 'completed', 'failed', 'zero_blocked')),
    verdict TEXT CHECK (verdict IN ('PASS', 'AMBER', 'ZERO') OR verdict IS NULL),
    source_files JSONB NOT NULL DEFAULT '[]'::jsonb,
    normalized_invoice JSONB,
    validation_results JSONB,
    audit_traces JSONB NOT NULL DEFAULT '[]'::jsonb,
    approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
    exports JSONB NOT NULL DEFAULT '[]'::jsonb,
    error TEXT,
    created_by TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_created_at ON jobs (created_at DESC);

-- Source files: P2 file references (private blob)
CREATE TABLE source_files (
    file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    blob_pathname TEXT NOT NULL,        -- Vercel Blob private path
    blob_access TEXT NOT NULL DEFAULT 'private' CHECK (blob_access IN ('private')),
    mime_type TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('invoice_excel', 'invoice_pdf', 'evidence_pdf', 'evidence_image', 'other')),
    parsed BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_source_files_job_id ON source_files (job_id);
CREATE INDEX idx_source_files_sha256 ON source_files (sha256);

-- Invoices: deduped normalized invoice headers (for check_duplicate_invoice)
CREATE TABLE invoices (
    invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_hash TEXT NOT NULL,           -- SHA-256 of vendor_id (P2 masked)
    invoice_no_hash TEXT NOT NULL,       -- SHA-256 of invoice_no (P2 masked)
    amount NUMERIC(18, 4) NOT NULL,
    currency TEXT NOT NULL,
    issue_date DATE NOT NULL,
    job_id UUID NOT NULL REFERENCES jobs(job_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vendor_hash, invoice_no_hash)
);
CREATE INDEX idx_invoices_vendor ON invoices (vendor_hash);
CREATE INDEX idx_invoices_issue_date ON invoices (issue_date DESC);

-- Audit traces: FR-025 compliance (approval state, approver identity, verdict, export type, trace_id)
CREATE TABLE audit_traces (
    trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type TEXT NOT NULL,            -- 'parse', 'validate', 'approve', 'export', 'redact'
    actor TEXT,                          -- user/agent identity
    verdict TEXT CHECK (verdict IN ('PASS', 'AMBER', 'ZERO') OR verdict IS NULL),
    approver_role TEXT,                  -- 'Ops Lead' | 'Finance Manager' | 'Contract/Admin'
    approver_identity TEXT,
    approval_state TEXT CHECK (approval_state IN ('pending', 'approved', 'rejected') OR approval_state IS NULL),
    export_type TEXT,                    -- 'final_approved' | 'review_pack' | 'raw'
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    trace_id_chain UUID REFERENCES audit_traces(trace_id)  -- chain for traceable flow
);
CREATE INDEX idx_audit_traces_job_id ON audit_traces (job_id);
CREATE INDEX idx_audit_traces_event_type ON audit_traces (event_type);
CREATE INDEX idx_audit_traces_created_at ON audit_traces (created_at DESC);

-- Approvals: role-based approval records
CREATE TABLE approvals (
    approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approval_state TEXT NOT NULL CHECK (approval_state IN ('pending', 'approved', 'rejected')),
    approver_role TEXT NOT NULL CHECK (approver_role IN ('Ops Lead', 'Finance Manager', 'Contract/Admin')),
    approver_identity TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('PASS', 'AMBER', 'ZERO')),
    variance_aed NUMERIC(18, 4),
    comments TEXT,
    trace_id UUID REFERENCES audit_traces(trace_id)
);
CREATE INDEX idx_approvals_job_id ON approvals (job_id);
CREATE INDEX idx_approvals_state ON approvals (approval_state);
