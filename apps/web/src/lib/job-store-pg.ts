import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { JobStore, Job, GateResultLite, TraceInput } from './job-store';
import type {
  SourceFile, AuditTraceEntry, NormalizedInvoice,
  SctValidationResult, ApprovalRecord, FxPolicy, SourceDataRow
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
