import { randomUUID } from 'node:crypto';
import { createPgJobStore } from './job-store-pg';
import type {
  JobStatus, Verdict, SourceFile, AuditTraceStep, AuditTraceEntry,
  NormalizedInvoice, SctValidationResult, ApprovalRecord, FxPolicy,
  SourceDataRow, WorkflowType
} from './types';
import {
  mapLegacyStatus,
  assertCanTransition,
  InvalidStateTransitionError,
  type InvoiceJobStatus,
} from './invoice/statusMachine';

export interface Job {
  job_id: string;
  status: JobStatus;
  verdict: Verdict | null;
  workflow_type: WorkflowType;
  created_by: string;
  created_at: string;
  updated_at: string;
  rule_version: string;
  parser_version: string;
}

export interface GateResultLite {
  verdict: Verdict;
  line_results: Array<{
    line_id: string;
    verdict: Verdict;
    band: 'PASS'|'WARN'|'HIGH'|'CRITICAL' | null;
    delta_pct: number | null;
    reason_codes: string[];
  }>;
  action_items: Array<{
    action_id: string;
    severity: Verdict;
    line_id: string | null;
    issue_type: string;
    required_action: string;
  }>;
}

export interface TraceInput {
  step: AuditTraceStep;
  input_ref: string;
  output_ref: string;
  rule_version?: string;
  source_hash?: string;
  calculation_hash?: string;
  latency_ms?: number;
  wasDerivedFrom?: string;
  attributedTo?: string;
  notebooklm_source_id?: string;
  notebooklm_summary_received_at?: string;
  notebooklm_confidence?: number;
  notebooklm_flags?: string[];
  dual_extraction_mismatches?: AuditTraceEntry['dual_extraction_mismatches'];
}

export interface JobStore {
  createJob(input: { created_by: string; workflow_type?: WorkflowType; rule_version?: string; parser_version?: string; job_id?: string }): Promise<Job>;
  getJob(jobId: string): Promise<Job | undefined>;
  updateJob(jobId: string, patch: Partial<Pick<Job, 'status' | 'verdict' | 'workflow_type'>>): Promise<Job | undefined>;
  addSourceFile(jobId: string, sf: SourceFile): Promise<void>;
  updateSourceFile(jobId: string, fileId: string, patch: Partial<Pick<SourceFile, 'sha256' | 'size_bytes' | 'parser_status'>>): Promise<SourceFile | undefined>;
  listSourceFiles(jobId: string): Promise<SourceFile[]>;
  appendTrace(jobId: string, t: TraceInput): Promise<AuditTraceEntry>;
  listTrace(jobId: string): Promise<AuditTraceEntry[]>;
  setResult(jobId: string, r: GateResultLite): Promise<void>;
  getResult(jobId: string): Promise<GateResultLite | undefined>;

  // Phase 2 Methods
  setNormalizedInvoice(jobId: string, ni: NormalizedInvoice): Promise<void>;
  getNormalizedInvoice(jobId: string): Promise<NormalizedInvoice | undefined>;
  setParseSourceData(jobId: string, rows: SourceDataRow[]): Promise<void>;
  getParseSourceData(jobId: string): Promise<SourceDataRow[]>;
  setValidationResult(jobId: string, vr: SctValidationResult): Promise<void>;
  getValidationResult(jobId: string): Promise<SctValidationResult | undefined>;
  setApprovalRecord(jobId: string, record: ApprovalRecord): Promise<void>;
  getApprovalRecord(jobId: string): Promise<ApprovalRecord | undefined>;
  createFxPolicy(policy: FxPolicy): Promise<void>;
  getFxPolicy(policyId: string): Promise<FxPolicy | undefined>;
  listFxPolicies(): Promise<FxPolicy[]>;

  // PR 2: invoice audit log
  setInvoiceAuditLog(input: {
    invoiceId: string;
    jobId: string;
    validatorVersion: string;
    rateManifestVersion?: string | null;
    executedRateSnapshotId?: string | null;
    inputFileHash?: string | null;
    resultStatus?: string | null;
    issues?: import('./invoice/schema').ValidationIssue[];
  }): Promise<void>;
  getInvoiceAuditLog(invoiceId: string, validatorVersion: string, inputFileHash?: string | null): Promise<{
    invoice_id: string;
    job_id: string;
    validator_version: string;
    rate_manifest_version: string | null;
    executed_rate_snapshot_id: string | null;
    input_file_hash: string | null;
    validation_started_at: string;
    validation_finished_at: string | null;
    result_status: string | null;
    issues: import('./invoice/schema').ValidationIssue[] | null;
  } | null>;
}

type McpResponse<T> = {
  result?: {
    structuredContent?: T;
  };
};

const isMockFetch = () => typeof (globalThis.fetch as unknown as { mock?: unknown })?.mock !== 'undefined';

const getJobStoreMcpUrl = (): string | null => {
  const configured = process.env.JOB_STORE_MCP_URL ?? process.env.CF_MCP_BASE_URL;
  if (configured) return `${configured.replace(/\/$/, '')}/mcp`;
  return isMockFetch() ? '/mcp' : null;
};

const callJobStoreTool = async <T>(name: string, args: Record<string, unknown>): Promise<T | undefined> => {
  const url = getJobStoreMcpUrl();
  if (!url) return undefined;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args }
      })
    });
    if (!response.ok) return undefined;
    const json = await response.json() as McpResponse<T>;
    return json.result?.structuredContent;
  } catch {
    return undefined;
  }
};

const syncJobToMcp = async (job: Job): Promise<void> => {
  await callJobStoreTool('save_job_store_data', {
    entityType: 'job',
    jobId: job.job_id,
    data: job
  });
};

const getJobFromMcp = async (jobId: string): Promise<Job | undefined> => {
  const content = await callJobStoreTool<{ result?: Job }>('get_job_store_data', {
    entityType: 'job',
    jobId
  });
  return content?.result;
};

export function createJobStore(): JobStore {
  const jobs = new Map<string, Job>();
  const files = new Map<string, SourceFile[]>();
  const traces = new Map<string, AuditTraceEntry[]>();
  const results = new Map<string, GateResultLite>();
  const normalizedInvoices = new Map<string, NormalizedInvoice>();
  const parseSourceData = new Map<string, SourceDataRow[]>();
  const validationResults = new Map<string, SctValidationResult>();
  const approvalRecords = new Map<string, ApprovalRecord>();
  const fxPolicies = new Map<string, FxPolicy>();
  const invoiceAuditLogs = new Map<string, {
    invoice_id: string;
    job_id: string;
    validator_version: string;
    rate_manifest_version: string | null;
    executed_rate_snapshot_id: string | null;
    input_file_hash: string | null;
    validation_started_at: string;
    validation_finished_at: string | null;
    result_status: string | null;
    issues: import('./invoice/schema').ValidationIssue[];
  }>();

  const nowIso = () => new Date().toISOString();
  const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  return {
    async createJob({ created_by, workflow_type = 'SHIPMENT', rule_version = 'rule-0.1.0', parser_version = 'parser-0.1.0', job_id }) {
      const job: Job = {
        job_id: job_id ?? newId('job'),
        status: 'CREATED',
        verdict: null,
        workflow_type,
        created_by,
        created_at: nowIso(),
        updated_at: nowIso(),
        rule_version,
        parser_version
      };
      jobs.set(job.job_id, job);
      files.set(job.job_id, []);
      traces.set(job.job_id, []);
      await syncJobToMcp(job);
      return job;
    },
    async getJob(jobId) { return jobs.get(jobId) ?? await getJobFromMcp(jobId); },
    async updateJob(jobId, patch) {
      const j = jobs.get(jobId);
      if (!j) return undefined;
      // PR 2: status transition guard. Map both sides to canonical 9-state,
      // throw InvalidStateTransitionError (409 INVALID_STATE) on violation.
      if (patch.status && patch.status !== j.status) {
        const fromCanonical = mapLegacyStatus(j.status);
        const toCanonical = mapLegacyStatus(patch.status);
        if (fromCanonical && toCanonical) {
          assertCanTransition(fromCanonical, toCanonical);
        }
      }
      const next: Job = { ...j, ...patch, updated_at: nowIso() };
      if (patch.workflow_type) next.workflow_type = patch.workflow_type;
      jobs.set(jobId, next);
      await syncJobToMcp(next);
      return next;
    },
    async addSourceFile(jobId, sf) {
      const arr = files.get(jobId) ?? [];
      arr.push(sf);
      files.set(jobId, arr);
      await callJobStoreTool('save_job_store_data', { entityType: 'source_files', jobId, data: { files: arr } });
    },
    async updateSourceFile(jobId, fileId, patch) {
      const arr = files.get(jobId) ?? [];
      const idx = arr.findIndex(f => f.file_id === fileId);
      if (idx === -1) return undefined;
      const next = { ...arr[idx], ...patch };
      arr[idx] = next;
      files.set(jobId, arr);
      await callJobStoreTool('save_job_store_data', { entityType: 'source_files', jobId, data: { files: arr } });
      return next;
    },
    async listSourceFiles(jobId) {
      const local = files.get(jobId);
      if (local && local.length > 0) return local;
      const mcpData = await callJobStoreTool<{ result?: { files: SourceFile[] } }>('get_job_store_data', { entityType: 'source_files', jobId });
      if (mcpData?.result?.files) return mcpData.result.files;
      return local ?? [];
    },
    async appendTrace(jobId, t) {
      const entry: AuditTraceEntry = {
        trace_id: newId('trace'),
        job_id: jobId,
        step: t.step,
        input_ref: t.input_ref,
        output_ref: t.output_ref,
        timestamp: nowIso(),
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
      const arr = traces.get(jobId) ?? [];
      arr.push(entry);
      traces.set(jobId, arr);
      return entry;
    },
    async listTrace(jobId) { return traces.get(jobId) ?? []; },
    async setResult(jobId, r) { results.set(jobId, r); },
    async getResult(jobId) { return results.get(jobId); },

    // Phase 2 Implementations
    async setNormalizedInvoice(jobId, ni) { normalizedInvoices.set(jobId, ni); },
    async getNormalizedInvoice(jobId) { return normalizedInvoices.get(jobId); },
    async setParseSourceData(jobId, rows) { parseSourceData.set(jobId, rows); },
    async getParseSourceData(jobId) { return parseSourceData.get(jobId) ?? []; },
    async setValidationResult(jobId, vr) { validationResults.set(jobId, vr); },
    async getValidationResult(jobId) { return validationResults.get(jobId); },
    async setApprovalRecord(jobId, record) { approvalRecords.set(jobId, record); },
    async getApprovalRecord(jobId) { return approvalRecords.get(jobId); },
    async createFxPolicy(policy) { fxPolicies.set(policy.fx_policy_id, policy); },
    async getFxPolicy(policyId) { return fxPolicies.get(policyId); },
    async listFxPolicies() { return Array.from(fxPolicies.values()); },

    // PR 2: in-memory audit log (dev/test). PG version has 42P01 self-heal.
    async setInvoiceAuditLog(input) {
      const key = `${input.invoiceId}|${input.validatorVersion}|${input.inputFileHash ?? ''}`;
      invoiceAuditLogs.set(key, {
        invoice_id: input.invoiceId,
        job_id: input.jobId,
        validator_version: input.validatorVersion,
        rate_manifest_version: input.rateManifestVersion ?? null,
        executed_rate_snapshot_id: input.executedRateSnapshotId ?? null,
        input_file_hash: input.inputFileHash ?? null,
        validation_started_at: new Date().toISOString(),
        validation_finished_at: new Date().toISOString(),
        result_status: input.resultStatus ?? null,
        issues: input.issues ?? [],
      });
    },
    async getInvoiceAuditLog(invoiceId, validatorVersion, inputFileHash) {
      const key = `${invoiceId}|${validatorVersion}|${inputFileHash ?? ''}`;
      return invoiceAuditLogs.get(key) ?? null;
    }
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __invoice_audit_store: JobStore | undefined;
}

const isVercelRuntime = () => process.env.VERCEL === '1';

const getStore = (): JobStore => {
  const existing = globalThis.__invoice_audit_store;
  if (existing && typeof (existing as any).setNormalizedInvoice === 'function' && typeof (existing as any).getParseSourceData === 'function') {
    return existing;
  }

  if (process.env.DATABASE_URL) {
    try {
      const pgStore = createPgJobStore();
      if (pgStore) {
        globalThis.__invoice_audit_store = pgStore;
        return pgStore;
      }
    } catch (err) {
      if (isVercelRuntime()) {
        throw new Error('[job-store] Vercel deployment requires a working Postgres job store. PG init failed; check DATABASE_URL.', { cause: err });
      }
      console.warn('[job-store] PG init failed, falling back to in-memory:', err);
    }
  } else if (isVercelRuntime()) {
    throw new Error('[job-store] Vercel deployment requires DATABASE_URL; refusing to use in-memory job store.');
  }

  console.warn('[job-store] DATABASE_URL not set or PG init failed — using in-memory job store (data will not persist across restarts)');
  const fresh = createJobStore();
  globalThis.__invoice_audit_store = fresh;
  return fresh;
};

export const STORE: JobStore = getStore();
