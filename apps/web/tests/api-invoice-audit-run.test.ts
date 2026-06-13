import { describe, it, expect, vi } from 'vitest';

const putMock = vi.fn(async (_n: string, b: Blob) => ({ url: 'https://blob/x', pathname: 'x' }));
vi.mock('@vercel/blob', () => ({ put: putMock }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { POST } from '../src/app/api/invoice-audit/run/route';
import { POST as INGEST_POST } from '../src/app/api/files/ingest/route';

async function setupJob(): Promise<{ jobId: string; fileId: string }> {
  const fd = new FormData();
  fd.set('file', new File(['hello'], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const r1 = await INGEST_POST(new Request('http://test/api/files/ingest', { method: 'POST', body: fd, headers: { 'x-user-id': 'u1' } }));
  const j = await r1.json();
  return { jobId: j.job_id, fileId: j.file_ids[0] };
}

describe('POST /api/invoice-audit/run', () => {
  it('JOB_NOT_FOUND for unknown job', async () => {
    const r = await POST(new Request('http://test/api/invoice-audit/run', { method: 'POST', body: JSON.stringify({ job_id: 'job_nope' }), headers: { 'content-type': 'application/json' } }));
    expect(r.status).toBe(404);
    expect((await r.json()).code).toBe('JOB_NOT_FOUND');
  });

  it('happy path: parse -> CF MCP -> gate -> 202 + verdict', async () => {
    const { jobId } = await setupJob();
    fetchMock
      // parser worker
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ parse_result_id: 'pr1', job_id: jobId, file_id: 'f1', normalized: { invoice_id: 'inv1', invoice_header: { currency: 'AED' }, invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100, qty: 2, rate: 50, source_ref: { sheet: 'S', row: 2, col: '0' } }], evidence_candidates: [], parser_confidence: 0.9, parser_version: 'parser-0.1.0' } }) })
      // route_question
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { domain: 'invoice-cost', requiredCorpus: [] } }) })
      // dryrun_type_b_classify
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 2, result: { classifications: [{ line_id: 'l1', type_b: 'THC', sct_code: '', confidence: 0.9 }] } }) })
      // dryrun_rate_lookup (l1)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 3, result: { status: 'VALID' } }) })
      // check_cost_guard
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 4, result: { lineResults: [{ lineId: 'l1', band: 'PASS', deltaPct: 1.0, verdict: 'ACCEPTABLE', proofRef: 'proof_1' }] } }) })
      // check_doc_guardian
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 5, result: { findings: [] } }) });
    process.env.CF_MCP_BASE_URL = 'https://cf.example';
    process.env.CF_MCP_TIMEOUT_MS = '1000';
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';
    const r = await POST(new Request('http://test/api/invoice-audit/run', { method: 'POST', body: JSON.stringify({ job_id: jobId }), headers: { 'content-type': 'application/json' } }));
    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.job_id).toBe(jobId);
    expect(body.status).toBe('REVIEW_REQUIRED');
  });
});
