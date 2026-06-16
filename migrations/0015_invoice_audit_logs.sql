-- 0015_invoice_audit_logs.sql — PR 2: 감사 로그 테이블
--
-- 검증 결과를 재현 가능하게 보존:
--   - invoice_id, job_id, validator_version, rate_manifest_version
--   - input_file_hash (sha256)
--   - validation_started_at / validation_finished_at
--   - result_status (PASS/AMBER/ZERO/FAILED)
--   - issues_json (JSONB)
--
-- UNIQUE(invoice_id, validator_version, input_file_hash):
--   동일 입력 + 동일 validator → 중복 저장 방지.
--   Rule #0 self-heal: job-store-pg.ts가 테이블 부재 시 자동 생성하므로
--   이 마이그레이션이 미적용된 환경에서도 코드는 동작한다.
--
-- @see PLAN_20260616_160103.md PR 2.3
-- @see patch_g.md §"핵심 문제 7: 감사 로그와 재현 가능한 검증 결과"

CREATE TABLE IF NOT EXISTS invoice_audit_logs (
  id                          BIGSERIAL PRIMARY KEY,
  invoice_id                  TEXT NOT NULL,
  job_id                      TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  validator_version           TEXT NOT NULL,
  rate_manifest_version       TEXT,
  executed_rate_snapshot_id   TEXT,
  input_file_hash             TEXT,
  validation_started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validation_finished_at      TIMESTAMPTZ,
  result_status               TEXT,
  issues_json                 JSONB,
  CONSTRAINT invoice_audit_logs_unique UNIQUE (invoice_id, validator_version, input_file_hash)
);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_logs_job_id
  ON invoice_audit_logs (job_id);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_logs_invoice_id
  ON invoice_audit_logs (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_audit_logs_result_status
  ON invoice_audit_logs (result_status)
  WHERE result_status IS NOT NULL;

COMMENT ON TABLE invoice_audit_logs IS
  'PR 2: 검증 결과 재현용 감사 로그. validator_version + input_file_hash UNIQUE.';
COMMENT ON COLUMN invoice_audit_logs.rate_manifest_version IS
  'PR 4의 RateReferenceProvider가 반환한 manifest version (nullable)';
COMMENT ON COLUMN invoice_audit_logs.issues_json IS
  'lib/invoice/validateInvoice의 ValidationIssue[] (code, severity, message, path, expected, actual)';
