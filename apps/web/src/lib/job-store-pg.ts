import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { JobStore, Job, GateResultLite, TraceInput } from './job-store';
import type {
  SourceFile, AuditTraceEntry, NormalizedInvoice,
  SctValidationResult, ApprovalRecord, FxPolicy, SourceDataRow,
  VisionStatusRecord, VisionOcrResult, ReRunRecord
} from './types';
import {
  mapLegacyStatus,
  assertCanTransition,
  type InvoiceJobStatus,
} from './invoice/statusMachine';
import type { ValidationIssue } from './invoice/schema';

const { Pool } = pg;

type PgPool = pg.Pool;

let _pool: PgPool | null = null;

function getPool(): PgPool | null {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  _pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000),
    // Neon Postgres uses a publicly trusted CA, so proper SSL verification works without extra config.
    ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') ? { rejectUnauthorized: true } : undefined
  });

  _pool.on('error', (err) => {
    console.error('[job-store-pg] idle client error:', err);
  });

  return _pool;
}

export async function verifyPgConnection(): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (err) {
    console.error('[job-store-pg] connection verification failed:', err);
    return false;
  }
}

export async function closePgPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

// Self-heal for databases provisioned from migration 0009, where the `jobs`
// table predates the workflow_type column (added in migration 0017). When a
// query hits `column "workflow_type" of relation "jobs" does not exist`
// (Postgres 42703 = undefined_column), add the column idempotently and let the
// caller retry once — so ingest is never blocked on a pending migration
// (Rule #0). Mirrors the 42P01 table self-heal used elsewhere in this file.
async function healJobsWorkflowType(pool: PgPool, e: unknown): Promise<boolean> {
  if ((e as { code?: string }).code !== '42703') return false;
  await pool.query(
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_type TEXT NOT NULL DEFAULT 'SHIPMENT'`
  );
  return true;
}

export function createPgJobStore(): JobStore | null {
  const pool = getPool();
  if (!pool) return null;

  return {
    async createJob({ created_by, workflow_type = 'SHIPMENT', rule_version = 'rule-0.1.0', parser_version = 'parser-0.1.0', job_id }) {
      const jid = job_id ?? newId('job');
      const now = nowIso();
      const insert = () => pool.query(
        `INSERT INTO jobs (job_id, status, verdict, workflow_type, created_by, created_at, updated_at, rule_version, parser_version)
         VALUES ($1, 'CREATED', NULL, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [jid, workflow_type, created_by, now, now, rule_version, parser_version]
      );
      let result;
      try {
        result = await insert();
      } catch (e) {
        if (!(await healJobsWorkflowType(pool, e))) throw e;
        result = await insert();
      }
      return mapJobRow(result.rows[0]);
    },

    async getJob(jobId: string) {
      const result = await pool.query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
      return result.rows[0] ? mapJobRow(result.rows[0]) : undefined;
    },

    async updateJob(jobId: string, patch: Partial<Pick<Job, 'status' | 'verdict' | 'workflow_type'>>) {
      // PR 2: status transition guard. Same matrix as in-memory store.
      // Map both sides to canonical 9-state, throw on violation.
      if (patch.status) {
        const current = await this.getJob(jobId);
        if (current && patch.status !== current.status) {
          const fromCanonical = mapLegacyStatus(current.status);
          const toCanonical = mapLegacyStatus(patch.status);
          if (fromCanonical && toCanonical) {
            assertCanTransition(fromCanonical, toCanonical);
          }
        }
      }
      const now = nowIso();
      const update = () => pool.query(
        `UPDATE jobs SET
           status = COALESCE($1, status),
           verdict = COALESCE($2, verdict),
           workflow_type = COALESCE($3, workflow_type),
           updated_at = $4
         WHERE job_id = $5
         RETURNING *`,
        [patch.status ?? null, patch.verdict ?? null, patch.workflow_type ?? null, now, jobId]
      );
      let result;
      try {
        result = await update();
      } catch (e) {
        if (!(await healJobsWorkflowType(pool, e))) throw e;
        result = await update();
      }
      return result.rows[0] ? mapJobRow(result.rows[0]) : undefined;
    },

    async addSourceFile(jobId: string, sf: SourceFile) {
      await pool.query(
        `INSERT INTO source_files (job_id, file_id, original_filename, file_type, mime_type, size_bytes, sha256, blob_ref, blob_url, parser_status, uploaded_by, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (job_id, file_id) DO UPDATE SET
           original_filename = EXCLUDED.original_filename,
           parser_status = EXCLUDED.parser_status`,
        [jobId, sf.file_id, sf.original_filename, sf.file_type, sf.mime_type,
         sf.size_bytes, sf.sha256, sf.blob_ref, sf.blob_url ?? null,
         sf.parser_status, sf.uploaded_by, sf.uploaded_at]
      );
    },

    async updateSourceFile(jobId: string, fileId: string, patch: Partial<Pick<SourceFile, 'sha256' | 'size_bytes' | 'parser_status'>>) {
      const current = await pool.query('SELECT * FROM source_files WHERE job_id = $1 AND file_id = $2', [jobId, fileId]);
      if (!current.rows[0]) return undefined;
      const next = { ...mapSourceFileRow(current.rows[0]), ...patch };
      const result = await pool.query(
        `UPDATE source_files SET sha256 = $1, size_bytes = $2, parser_status = $3
         WHERE job_id = $4 AND file_id = $5
         RETURNING *`,
        [next.sha256, next.size_bytes, next.parser_status, jobId, fileId]
      );
      return result.rows[0] ? mapSourceFileRow(result.rows[0]) : undefined;
    },

    async listSourceFiles(jobId: string) {
      const result = await pool.query(
        'SELECT * FROM source_files WHERE job_id = $1 ORDER BY uploaded_at',
        [jobId]
      );
      return result.rows.map(mapSourceFileRow);
    },

    async appendTrace(jobId: string, t: TraceInput) {
      const traceId = newId('trace');
      const now = nowIso();
      await pool.query(
        `INSERT INTO audit_traces (
           trace_id, job_id, step, input_ref, output_ref, timestamp, rule_version,
           source_hash, calculation_hash, latency_ms, was_derived_from, attributed_to,
           notebooklm_source_id, notebooklm_summary_received_at, notebooklm_confidence,
           notebooklm_flags, dual_extraction_mismatches
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [traceId, jobId, t.step, t.input_ref, t.output_ref, now,
         t.rule_version ?? null, t.source_hash ?? null, t.calculation_hash ?? null,
         t.latency_ms ?? null, t.wasDerivedFrom ?? null, t.attributedTo ?? null,
         t.notebooklm_source_id ?? null,
         t.notebooklm_summary_received_at ?? null,
         t.notebooklm_confidence ?? null,
         t.notebooklm_flags ? JSON.stringify(t.notebooklm_flags) : null,
         t.dual_extraction_mismatches ? JSON.stringify(t.dual_extraction_mismatches) : null]
      );
      return {
        trace_id: traceId,
        job_id: jobId,
        step: t.step,
        input_ref: t.input_ref,
        output_ref: t.output_ref,
        timestamp: now,
        rule_version: t.rule_version ?? null,
        source_hash: t.source_hash ?? null,
        calculation_hash: t.calculation_hash ?? null,
        latency_ms: t.latency_ms ?? null,
        wasDerivedFrom: t.wasDerivedFrom ?? null,
        attributedTo: t.attributedTo ?? null,
        notebooklm_source_id: t.notebooklm_source_id ?? null,
        notebooklm_summary_received_at: t.notebooklm_summary_received_at ?? null,
        notebooklm_confidence: t.notebooklm_confidence ?? null,
        notebooklm_flags: t.notebooklm_flags ?? null,
        dual_extraction_mismatches: t.dual_extraction_mismatches ?? null
      };
    },

    async listTrace(jobId: string) {
      const result = await pool.query(
        'SELECT * FROM audit_traces WHERE job_id = $1 ORDER BY timestamp',
        [jobId]
      );
      return result.rows.map(mapTraceRow);
    },

    async setResult(jobId: string, r: GateResultLite) {
      await pool.query(
        `INSERT INTO gate_results (job_id, verdict, result_json)
         VALUES ($1, $2, $3)
         ON CONFLICT (job_id) DO UPDATE SET verdict = EXCLUDED.verdict, result_json = EXCLUDED.result_json`,
        [jobId, r.verdict, JSON.stringify(r)]
      );
    },

    async getResult(jobId: string) {
      const result = await pool.query(
        'SELECT * FROM gate_results WHERE job_id = $1',
        [jobId]
      );
      if (!result.rows[0]) return undefined;
      const row = result.rows[0];
      const parsed = typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json;
      return parsed as GateResultLite;
    },

    async setNormalizedInvoice(jobId: string, ni: NormalizedInvoice) {
      await pool.query(
        `INSERT INTO normalized_invoices (job_id, invoice_json)
         VALUES ($1, $2)
         ON CONFLICT (job_id) DO UPDATE SET invoice_json = EXCLUDED.invoice_json`,
        [jobId, JSON.stringify(ni)]
      );
    },

    async getNormalizedInvoice(jobId: string) {
      const result = await pool.query(
        'SELECT invoice_json FROM normalized_invoices WHERE job_id = $1',
        [jobId]
      );
      if (!result.rows[0]) return undefined;
      const row = result.rows[0];
      return (typeof row.invoice_json === 'string' ? JSON.parse(row.invoice_json) : row.invoice_json) as NormalizedInvoice;
    },

    async setParseSourceData(jobId: string, rows: SourceDataRow[]) {
      const insert = () => pool.query(
        `INSERT INTO parse_source_data (job_id, source_data_json)
         VALUES ($1, $2)
         ON CONFLICT (job_id) DO UPDATE SET source_data_json = EXCLUDED.source_data_json, updated_at = NOW()`,
        [jobId, JSON.stringify(rows)]
      );
      try {
        await insert();
      } catch (e) {
        // Self-heal when migration 0013 has not been applied to this database yet
        // (relation does not exist = Postgres 42P01): create the table idempotently
        // and retry once, so the audit deliverable is never blocked (Rule #0).
        if ((e as { code?: string }).code !== '42P01') throw e;
        await pool.query(
          `CREATE TABLE IF NOT EXISTS parse_source_data (
             id BIGSERIAL PRIMARY KEY,
             job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE UNIQUE,
             source_data_json JSONB NOT NULL DEFAULT '[]',
             created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
             updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
           )`
        );
        await pool.query('CREATE INDEX IF NOT EXISTS idx_parse_source_data_job_id ON parse_source_data(job_id)');
        await insert();
      }
    },

    async getParseSourceData(jobId: string) {
      let result;
      try {
        result = await pool.query(
          'SELECT source_data_json FROM parse_source_data WHERE job_id = $1',
          [jobId]
        );
      } catch (e) {
        // Table absent (migration 0013 not yet applied on this DB) — degrade to no
        // source rows instead of failing the whole export (Rule #0: always produce
        // the final Excel; the workbook still carries evidence-derived source rows).
        if ((e as { code?: string }).code === '42P01') return [];
        throw e;
      }
      if (!result.rows[0]) return [];
      const row = result.rows[0];
      return (typeof row.source_data_json === 'string' ? JSON.parse(row.source_data_json) : row.source_data_json) as SourceDataRow[];
    },

    // PR 2: invoice_audit_logs self-healing persistence.
    // Rule #0: table absence must not block the audit deliverable; degrade to noop.
    async setInvoiceAuditLog(input: {
      invoiceId: string;
      jobId: string;
      validatorVersion: string;
      rateManifestVersion?: string | null;
      executedRateSnapshotId?: string | null;
      inputFileHash?: string | null;
      resultStatus?: string | null;
      issues?: ValidationIssue[];
    }) {
      const insert = () => pool.query(
        `INSERT INTO invoice_audit_logs
           (invoice_id, job_id, validator_version, rate_manifest_version,
            executed_rate_snapshot_id, input_file_hash, result_status, issues_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (invoice_id, validator_version, input_file_hash) DO UPDATE SET
           rate_manifest_version = EXCLUDED.rate_manifest_version,
           executed_rate_snapshot_id = EXCLUDED.executed_rate_snapshot_id,
           result_status = EXCLUDED.result_status,
           issues_json = EXCLUDED.issues_json,
           validation_finished_at = NOW()`,
        [
          input.invoiceId,
          input.jobId,
          input.validatorVersion,
          input.rateManifestVersion ?? null,
          input.executedRateSnapshotId ?? null,
          input.inputFileHash ?? null,
          input.resultStatus ?? null,
          JSON.stringify(input.issues ?? []),
        ]
      );
      try {
        await insert();
      } catch (e) {
        // Self-heal when migration 0015 has not been applied (42P01).
        // Create table + index idempotently, then retry once.
        if ((e as { code?: string }).code !== '42P01') throw e;
        await pool.query(
          `CREATE TABLE IF NOT EXISTS invoice_audit_logs (
             id BIGSERIAL PRIMARY KEY,
             invoice_id TEXT NOT NULL,
             job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
             validator_version TEXT NOT NULL,
             rate_manifest_version TEXT,
             executed_rate_snapshot_id TEXT,
             input_file_hash TEXT,
             validation_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
             validation_finished_at TIMESTAMPTZ,
             result_status TEXT,
             issues_json JSONB,
             UNIQUE (invoice_id, validator_version, input_file_hash)
           )`
        );
        await pool.query('CREATE INDEX IF NOT EXISTS idx_invoice_audit_logs_job_id ON invoice_audit_logs(job_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_invoice_audit_logs_invoice_id ON invoice_audit_logs(invoice_id)');
        await insert();
      }
    },

    async getInvoiceAuditLog(invoiceId: string, validatorVersion: string, inputFileHash?: string | null) {
      let result;
      try {
        result = await pool.query(
          `SELECT invoice_id, job_id, validator_version, rate_manifest_version,
                  executed_rate_snapshot_id, input_file_hash,
                  validation_started_at, validation_finished_at, result_status, issues_json
           FROM invoice_audit_logs
           WHERE invoice_id = $1 AND validator_version = $2
             AND ($3::text IS NULL OR input_file_hash = $3)
           ORDER BY validation_started_at DESC
           LIMIT 1`,
          [invoiceId, validatorVersion, inputFileHash ?? null]
        );
      } catch (e) {
        // Table absent → return null (Rule #0: don't block, callers handle missing).
        if ((e as { code?: string }).code === '42P01') return null;
        throw e;
      }
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      return {
        invoice_id: row.invoice_id,
        job_id: row.job_id,
        validator_version: row.validator_version,
        rate_manifest_version: row.rate_manifest_version,
        executed_rate_snapshot_id: row.executed_rate_snapshot_id,
        input_file_hash: row.input_file_hash,
        validation_started_at: (row.validation_started_at as Date).toISOString(),
        validation_finished_at: row.validation_finished_at ? (row.validation_finished_at as Date).toISOString() : null,
        result_status: row.result_status,
        issues: typeof row.issues_json === 'string' ? JSON.parse(row.issues_json) : row.issues_json,
      };
    },

    async setValidationResult(jobId: string, vr: SctValidationResult) {
      await pool.query(
        `INSERT INTO validation_results (job_id, validation_json)
         VALUES ($1, $2)
         ON CONFLICT (job_id) DO UPDATE SET validation_json = EXCLUDED.validation_json`,
        [jobId, JSON.stringify(vr)]
      );
    },

    async getValidationResult(jobId: string) {
      const result = await pool.query(
        'SELECT validation_json FROM validation_results WHERE job_id = $1',
        [jobId]
      );
      if (!result.rows[0]) return undefined;
      const row = result.rows[0];
      return (typeof row.validation_json === 'string' ? JSON.parse(row.validation_json) : row.validation_json) as SctValidationResult;
    },

    async setApprovalRecord(jobId: string, record: ApprovalRecord) {
      await pool.query(
        `INSERT INTO approval_records (job_id, approval_json)
         VALUES ($1, $2)
         ON CONFLICT (job_id) DO UPDATE SET approval_json = EXCLUDED.approval_json`,
        [jobId, JSON.stringify(record)]
      );
    },

    async getApprovalRecord(jobId: string) {
      const result = await pool.query(
        'SELECT approval_json FROM approval_records WHERE job_id = $1',
        [jobId]
      );
      if (!result.rows[0]) return undefined;
      const row = result.rows[0];
      return (typeof row.approval_json === 'string' ? JSON.parse(row.approval_json) : row.approval_json) as ApprovalRecord;
    },

    // 2026-06-17: approval-gated Vision OCR state. Persisted on jobs
    // (migration 0018). Self-heals missing columns / missing migration
    // like 0017 — Rule #0: never block the audit deliverable on DDL drift.
    async setVisionStatus(jobId: string, status: VisionStatusRecord) {
      const write = () => pool.query(
        `UPDATE jobs SET
           vision_status              = $1,
           vision_operation_name      = $2,
           vision_pdf_file_id         = $3,
           vision_pdf_sha256          = $4,
           vision_source_gcs_uri      = $5,
           vision_output_gcs_prefix   = $6,
           vision_started_at          = $7,
           vision_completed_at        = $8,
           vision_updated_at          = $9,
           vision_error_code          = $10,
           vision_error_message       = $11,
           vision_ocr_result_json     = $12
         WHERE job_id = $13`,
        [
          status.vision_status,
          status.vision_operation_name,
          status.vision_pdf_file_id,
          status.vision_pdf_sha256,
          status.vision_source_gcs_uri,
          status.vision_output_gcs_prefix,
          status.vision_started_at,
          status.vision_completed_at,
          status.vision_updated_at,
          status.vision_error_code,
          status.vision_error_message,
          status.vision_ocr_result ? JSON.stringify(status.vision_ocr_result) : null,
          jobId
        ]
      );
      try {
        await write();
      } catch (e) {
        // 42703 = undefined_column (migration 0018 not applied yet).
        // Apply the migration idempotently and retry once.
        if ((e as { code?: string }).code !== '42703') throw e;
        await pool.query(
          `ALTER TABLE jobs
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
             ADD COLUMN IF NOT EXISTS vision_ocr_result_json       JSONB`
        );
        await write();
      }
    },

    async getVisionStatus(jobId: string) {
      let result;
      try {
        result = await pool.query(
          `SELECT vision_status, vision_operation_name, vision_pdf_file_id,
                  vision_pdf_sha256, vision_source_gcs_uri, vision_output_gcs_prefix,
                  vision_started_at, vision_completed_at, vision_updated_at,
                  vision_error_code, vision_error_message, vision_ocr_result_json
             FROM jobs WHERE job_id = $1`,
          [jobId]
        );
      } catch (e) {
        // 42703 = columns missing (migration 0018 not applied yet). Degrade to
        // "no Vision state" so callers behave as if Vision was never requested.
        if ((e as { code?: string }).code === '42703') return undefined;
        throw e;
      }
      const row = result.rows[0];
      if (!row || !row.vision_status) return undefined;
      return mapVisionStatusRow(row);
    },

    // 2026-06-17: re-run pipeline. Stores the post-OCR re-run state per
    // job. Self-heals 42703 (undefined column) by applying migration 0019
    // idempotently — Rule #0: never block the audit on DDL drift.
    async setReRunRecord(jobId: string, record: ReRunRecord) {
      const write = () => pool.query(
        `UPDATE jobs SET
           re_run_status                  = $1,
           re_run_id                      = $2,
           re_run_triggered_by            = $3,
           re_run_trigger                 = $4,
           re_run_pdf_sha256              = $5,
           re_run_vision_operation_name   = $6,
           re_run_started_at              = $7,
           re_run_completed_at            = $8,
           re_run_error_code              = $9,
           re_run_error_message           = $10,
           re_run_workbook_sha256         = $11,
           re_run_workbook_size_bytes     = $12,
           re_run_workbook_blob_url       = $13,
           re_run_prior_variance_aed      = $14,
           re_run_new_variance_aed        = $15,
           re_run_prior_verdict           = $16,
           re_run_new_verdict             = $17
         WHERE job_id = $18`,
        [
          record.re_run_status,
          record.re_run_id,
          record.re_run_triggered_by,
          record.re_run_trigger,
          record.re_run_pdf_sha256,
          record.re_run_vision_operation_name,
          record.re_run_started_at,
          record.re_run_completed_at,
          record.re_run_error_code,
          record.re_run_error_message,
          record.re_run_workbook_sha256,
          record.re_run_workbook_size_bytes,
          record.re_run_workbook_blob_url,
          record.re_run_prior_variance_aed,
          record.re_run_new_variance_aed,
          record.re_run_prior_verdict,
          record.re_run_new_verdict,
          jobId
        ]
      );
      try {
        await write();
      } catch (e) {
        // 42703 = undefined_column (migration 0019 not applied yet).
        // Apply the migration idempotently and retry once.
        if ((e as { code?: string }).code !== '42703') throw e;
        await pool.query(
          `ALTER TABLE jobs
             ADD COLUMN IF NOT EXISTS re_run_status                TEXT,
             ADD COLUMN IF NOT EXISTS re_run_id                    TEXT,
             ADD COLUMN IF NOT EXISTS re_run_triggered_by          TEXT,
             ADD COLUMN IF NOT EXISTS re_run_trigger               TEXT,
             ADD COLUMN IF NOT EXISTS re_run_pdf_sha256            TEXT,
             ADD COLUMN IF NOT EXISTS re_run_vision_operation_name TEXT,
             ADD COLUMN IF NOT EXISTS re_run_started_at            TIMESTAMPTZ,
             ADD COLUMN IF NOT EXISTS re_run_completed_at          TIMESTAMPTZ,
             ADD COLUMN IF NOT EXISTS re_run_error_code            TEXT,
             ADD COLUMN IF NOT EXISTS re_run_error_message         TEXT,
             ADD COLUMN IF NOT EXISTS re_run_workbook_sha256       TEXT,
             ADD COLUMN IF NOT EXISTS re_run_workbook_size_bytes   INTEGER,
             ADD COLUMN IF NOT EXISTS re_run_workbook_blob_url     TEXT,
             ADD COLUMN IF NOT EXISTS re_run_prior_variance_aed    NUMERIC,
             ADD COLUMN IF NOT EXISTS re_run_new_variance_aed      NUMERIC,
             ADD COLUMN IF NOT EXISTS re_run_prior_verdict         TEXT,
             ADD COLUMN IF NOT EXISTS re_run_new_verdict           TEXT`
        );
        await write();
      }
    },

    async getReRunRecord(jobId: string) {
      let result;
      try {
        result = await pool.query(
          `SELECT re_run_status, re_run_id, re_run_triggered_by, re_run_trigger,
                  re_run_pdf_sha256, re_run_vision_operation_name,
                  re_run_started_at, re_run_completed_at,
                  re_run_error_code, re_run_error_message,
                  re_run_workbook_sha256, re_run_workbook_size_bytes, re_run_workbook_blob_url,
                  re_run_prior_variance_aed, re_run_new_variance_aed,
                  re_run_prior_verdict, re_run_new_verdict
             FROM jobs WHERE job_id = $1`,
          [jobId]
        );
      } catch (e) {
        // 42703 = columns missing (migration 0019 not applied yet). Degrade
        // to "no re-run state" so callers behave as if Vision was never run.
        if ((e as { code?: string }).code === '42703') return undefined;
        throw e;
      }
      const row = result.rows[0];
      if (!row || !row.re_run_status) return undefined;
      return mapReRunRow(row);
    },

    async createFxPolicy(policy: FxPolicy) {
      await pool.query(
        `INSERT INTO fx_policies (fx_policy_id, from_currency, to_currency, fx_rate, rate_date, valid_from, valid_to, approved_by, proof_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (fx_policy_id) DO UPDATE SET
           fx_rate = EXCLUDED.fx_rate, rate_date = EXCLUDED.rate_date,
           valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to`,
        [policy.fx_policy_id, policy.from_currency, policy.to_currency,
         policy.fx_rate, policy.rate_date, policy.valid_from, policy.valid_to,
         policy.approved_by, policy.proof_hash]
      );
    },

    async getFxPolicy(policyId: string) {
      const result = await pool.query(
        'SELECT * FROM fx_policies WHERE fx_policy_id = $1',
        [policyId]
      );
      return result.rows[0] ? mapFxPolicyRow(result.rows[0]) : undefined;
    },

    async listFxPolicies() {
      const result = await pool.query('SELECT * FROM fx_policies ORDER BY from_currency, to_currency');
      return result.rows.map(mapFxPolicyRow);
    }
  };
}

function mapJobRow(row: Record<string, unknown>): Job {
  return {
    job_id: row.job_id as string,
    status: row.status as Job['status'],
    verdict: (row.verdict as Job['verdict']) ?? null,
    workflow_type: (row.workflow_type as Job['workflow_type']) ?? 'SHIPMENT',
    created_by: row.created_by as string,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
    rule_version: row.rule_version as string,
    parser_version: row.parser_version as string
  };
}

function mapSourceFileRow(row: Record<string, unknown>): SourceFile {
  return {
    file_id: row.file_id as string,
    job_id: row.job_id as string,
    original_filename: row.original_filename as string,
    file_type: row.file_type as SourceFile['file_type'],
    mime_type: row.mime_type as string,
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256 as string,
    blob_ref: row.blob_ref as string,
    blob_url: (row.blob_url as string) ?? undefined,
    parser_status: row.parser_status as SourceFile['parser_status'],
    uploaded_by: row.uploaded_by as string,
    uploaded_at: (row.uploaded_at as Date).toISOString()
  };
}

function mapTraceRow(row: Record<string, unknown>): AuditTraceEntry {
  return {
    trace_id: row.trace_id as string,
    job_id: row.job_id as string,
    step: row.step as AuditTraceEntry['step'],
    input_ref: row.input_ref as string,
    output_ref: row.output_ref as string,
    timestamp: (row.timestamp as Date).toISOString(),
    rule_version: (row.rule_version as string) ?? null,
    source_hash: (row.source_hash as string) ?? null,
    calculation_hash: (row.calculation_hash as string) ?? null,
    latency_ms: (row.latency_ms as number) ?? null,
    wasDerivedFrom: (row.was_derived_from as string) ?? null,
    attributedTo: (row.attributed_to as string) ?? null,
    notebooklm_source_id: (row.notebooklm_source_id as string) ?? null,
    notebooklm_summary_received_at: row.notebooklm_summary_received_at
      ? (row.notebooklm_summary_received_at as Date).toISOString()
      : null,
    notebooklm_confidence: row.notebooklm_confidence === null || row.notebooklm_confidence === undefined ? null : Number(row.notebooklm_confidence),
    notebooklm_flags: parseJsonField<string[]>(row.notebooklm_flags) ?? null,
    dual_extraction_mismatches: parseJsonField<AuditTraceEntry['dual_extraction_mismatches']>(row.dual_extraction_mismatches) ?? null
  };
}

function parseJsonField<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function mapFxPolicyRow(row: Record<string, unknown>): FxPolicy {
  return {
    fx_policy_id: row.fx_policy_id as string,
    from_currency: row.from_currency as string,
    to_currency: row.to_currency as string,
    fx_rate: Number(row.fx_rate),
    rate_date: (row.rate_date as Date).toISOString().split('T')[0],
    valid_from: (row.valid_from as Date).toISOString().split('T')[0],
    valid_to: (row.valid_to as Date).toISOString().split('T')[0],
    approved_by: row.approved_by as string,
    proof_hash: row.proof_hash as string
  };
}

function mapVisionStatusRow(row: Record<string, unknown>): VisionStatusRecord {
  const toIso = (v: unknown) => v ? (v as Date).toISOString() : null;
  const ocrJson = parseJsonField<VisionOcrResult>(row.vision_ocr_result_json) ?? null;
  return {
    vision_status: (row.vision_status as VisionStatusRecord['vision_status']) ?? null,
    vision_operation_name: (row.vision_operation_name as string) ?? null,
    vision_pdf_file_id: (row.vision_pdf_file_id as string) ?? null,
    vision_pdf_sha256: (row.vision_pdf_sha256 as string) ?? null,
    vision_source_gcs_uri: (row.vision_source_gcs_uri as string) ?? null,
    vision_output_gcs_prefix: (row.vision_output_gcs_prefix as string) ?? null,
    vision_started_at: toIso(row.vision_started_at),
    vision_completed_at: toIso(row.vision_completed_at),
    vision_updated_at: toIso(row.vision_updated_at),
    vision_error_code: (row.vision_error_code as string) ?? null,
    vision_error_message: (row.vision_error_message as string) ?? null,
    vision_ocr_result: ocrJson
  };
}

function mapReRunRow(row: Record<string, unknown>): ReRunRecord {
  const toIso = (v: unknown) => v ? (v as Date).toISOString() : null;
  const toNum = (v: unknown) => v == null ? null : Number(v);
  return {
    re_run_status: row.re_run_status as ReRunRecord['re_run_status'],
    re_run_id: (row.re_run_id as string) ?? '',
    re_run_triggered_by: (row.re_run_triggered_by as string) ?? '',
    re_run_trigger: (row.re_run_trigger as ReRunRecord['re_run_trigger']) ?? 'manual',
    re_run_pdf_sha256: (row.re_run_pdf_sha256 as string) ?? null,
    re_run_vision_operation_name: (row.re_run_vision_operation_name as string) ?? null,
    re_run_started_at: toIso(row.re_run_started_at),
    re_run_completed_at: toIso(row.re_run_completed_at),
    re_run_error_code: (row.re_run_error_code as string) ?? null,
    re_run_error_message: (row.re_run_error_message as string) ?? null,
    re_run_workbook_sha256: (row.re_run_workbook_sha256 as string) ?? null,
    re_run_workbook_size_bytes: toNum(row.re_run_workbook_size_bytes) as number | null,
    re_run_workbook_blob_url: (row.re_run_workbook_blob_url as string) ?? null,
    re_run_prior_variance_aed: toNum(row.re_run_prior_variance_aed),
    re_run_new_variance_aed: toNum(row.re_run_new_variance_aed),
    re_run_prior_verdict: (row.re_run_prior_verdict as string) ?? null,
    re_run_new_verdict: (row.re_run_new_verdict as string) ?? null
  };
}
