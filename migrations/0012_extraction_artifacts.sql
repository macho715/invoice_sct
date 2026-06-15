-- 0012_extraction_artifacts.sql
-- Tracks extraction engine outputs (pdfplumber, google_vision, markitdown,
-- notebooklm) per job/file and pairwise field-level comparisons between
-- artifacts. Stores only hashed values and GCS URIs — never raw PII, BL
-- numbers, TRN, BOE, container references, or extracted text (DLP / P2 policy).

BEGIN;

CREATE TABLE IF NOT EXISTS extraction_artifacts (
  artifact_id    TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL,
  file_id        TEXT NOT NULL,
  engine         TEXT NOT NULL,  -- 'pdfplumber', 'google_vision', 'markitdown', 'notebooklm'
  artifact_type  TEXT NOT NULL,  -- 'text_spans', 'vision_json', 'markdown', 'normalized'
  gcs_uri        TEXT,
  sha256         TEXT NOT NULL,
  confidence     DOUBLE PRECISION DEFAULT 0.0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by job — all artifacts for a single audit run.
CREATE INDEX IF NOT EXISTS idx_extraction_artifacts_job_id
  ON extraction_artifacts (job_id);

-- Lookup by file — all extraction passes for the same source file.
CREATE INDEX IF NOT EXISTS idx_extraction_artifacts_file_id
  ON extraction_artifacts (file_id);

CREATE TABLE IF NOT EXISTS extraction_comparisons (
  comparison_id       TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL,
  field_name          TEXT NOT NULL,  -- 'invoice_no', 'vendor', 'total', 'line_count'
  left_artifact_id    TEXT,
  right_artifact_id   TEXT,
  left_value_hash     TEXT NOT NULL,
  right_value_hash    TEXT NOT NULL,
  match_status        TEXT NOT NULL,  -- 'MATCH', 'MISMATCH', 'MISSING', 'LOW_CONFIDENCE'
  severity            TEXT NOT NULL DEFAULT 'PASS',  -- 'PASS', 'AMBER', 'ZERO', 'FAILED'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index: all comparisons for a given job ordered by severity.
CREATE INDEX IF NOT EXISTS idx_extraction_comparisons_job_id
  ON extraction_comparisons (job_id, severity);

COMMIT;
