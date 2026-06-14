import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { JobStore, Job, GateResultLite, TraceInput } from './job-store';
import type {
  SourceFile, AuditTraceEntry, NormalizedInvoice,
  SctValidationResult, ApprovalRecord, FxPolicy
} from './types';

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

export function createPgJobStore(): JobStore | null {
  const pool = getPool();
  if (!pool) return null;

  return {
    async createJob({ created_by, rule_version = 'rule-0.1.0', parser_version = 'parser-0.1.0', job_id }) {
      const jid = job_id ?? newId('job');
      const now = nowIso();
      const result = await pool.query(
        `INSERT INTO jobs (job_id, status, verdict, created_by, created_at, updated_at, rule_version, parser_version)
         VALUES ($1, 'CREATED', NULL, $2, $3, $4, $5, $6)
         RETURNING *`,
        [jid, created_by, now, now, rule_version, parser_version]
      );
      return mapJobRow(result.rows[0]);
    },

    async getJob(jobId: string) {
      const result = await pool.query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
      return result.rows[0] ? mapJobRow(result.rows[0]) : undefined;
    },

    async updateJob(jobId: string, patch: Partial<Pick<Job, 'status' | 'verdict'>>) {
      const now = nowIso();
      const result = await pool.query(
        `UPDATE jobs SET
           status = COALESCE($1, status),
           verdict = COALESCE($2, verdict),
           updated_at = $3
         WHERE job_id = $4
         RETURNING *`,
        [patch.status ?? null, patch.verdict ?? null, now, jobId]
      );
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
        `INSERT INTO audit_traces (trace_id, job_id, step, input_ref, output_ref, timestamp, rule_version, source_hash, calculation_hash, latency_ms, was_derived_from, attributed_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [traceId, jobId, t.step, t.input_ref, t.output_ref, now,
         t.rule_version ?? null, t.source_hash ?? null, t.calculation_hash ?? null,
         t.latency_ms ?? null, t.wasDerivedFrom ?? null, t.attributedTo ?? null]
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
        attributedTo: t.attributedTo ?? null
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
    attributedTo: (row.attributed_to as string) ?? null
  };
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
