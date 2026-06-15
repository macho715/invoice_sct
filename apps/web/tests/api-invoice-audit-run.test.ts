import { beforeEach, describe, it, expect, vi } from 'vitest';

const putMock = vi.fn(async (_n: string, b: Blob) => ({ url: 'https://blob/x', pathname: 'x' }));
vi.mock('@vercel/blob', () => ({ put: putMock }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { POST } from '../src/app/api/invoice-audit/run/route';
import { POST as INGEST_POST } from '../src/app/api/files/ingest/route';
import { STORE } from '../src/lib/job-store';

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.PARSER_WORKER_URL;
  delete process.env.WORKER_URL;
  delete process.env.PARSER_WORKER_TOKEN;
  // Phase 1 NotebookLM trigger is flag-gated; keep it OFF for all existing tests so
  // the sequential fetch mocks below are not consumed by a background trigger call.
  delete process.env.NOTEBOOKLM_ENABLED;
  delete process.env.NOTEBOOKLM_NOTEBOOK_ID;
});

// Wait for the fire-and-forget NotebookLM trigger (void async in the route) to flush.
async function waitFor(pred: () => boolean, timeoutMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

function calledNotebookLm(): boolean {
  return fetchMock.mock.calls.some((c) => String(c[0]).includes('/v1/notebooklm/run'));
}

const PARSE_OK = (jobId: string) => ({
  ok: true, status: 200,
  json: async () => ({ parse_result_id: 'pr1', job_id: jobId, file_id: 'f1', normalized: { invoice_id: 'inv1', invoice_header: { currency: 'AED' }, invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100, qty: 2, rate: 50, source_ref: { sheet: 'S', row: 2, col: '0' } }], evidence_candidates: [], parser_confidence: 0.9, parser_version: 'parser-0.1.0' } })
});

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

  it('allows token-protected parser workers hosted on vercel.app', async () => {
    const { jobId } = await setupJob();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        parse_result_id: 'pr_vercel',
        job_id: jobId,
        file_id: 'f1',
        normalized: {
          invoice_id: 'inv1',
          invoice_header: { currency: 'AED' },
          invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100, qty: 2, rate: 50, source_ref: { sheet: 'S', row: 2, col: '0' } }],
          evidence_candidates: [],
          parser_confidence: 0.9,
          parser_version: 'parser-0.1.0'
        }
      })
    });
    process.env.PARSER_WORKER_URL = 'https://sct-ontology-worker.vercel.app';
    process.env.PARSER_WORKER_TOKEN = 't';

    const r = await POST(new Request('http://test/api/invoice-audit/run', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
      headers: { 'content-type': 'application/json' }
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://sct-ontology-worker.vercel.app'),
      expect.any(Object)
    );
    if (!r.ok) {
      await expect(r.json()).resolves.not.toMatchObject({ code: 'STORAGE_AUTH_FAILED' });
    }
  });

  it('returns structured error when PARSER_WORKER_TOKEN is missing', async () => {
    const { jobId } = await setupJob();
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    delete process.env.PARSER_WORKER_TOKEN;

    const r = await POST(new Request('http://test/api/invoice-audit/run', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
      headers: { 'content-type': 'application/json' }
    }));

    expect(r.status).toBe(500);
    await expect(r.json()).resolves.toMatchObject({
      code: 'STORAGE_AUTH_FAILED',
      message: 'PARSER_WORKER_TOKEN not configured'
    });
    await expect(STORE.getJob(jobId)).resolves.toMatchObject({ status: 'FAILED', verdict: 'FAILED' });
  });

  it('returns structured error when worker URL allowlist rejects the host', async () => {
    const { jobId } = await setupJob();
    process.env.PARSER_WORKER_TOKEN = 't';
    process.env.PARSER_WORKER_URL = 'https://example.com';

    const r = await POST(new Request('http://test/api/invoice-audit/run', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
      headers: { 'content-type': 'application/json' }
    }));

    expect(r.status).toBe(500);
    await expect(r.json()).resolves.toMatchObject({
      code: 'STORAGE_AUTH_FAILED',
      message: 'WORKER_URL must point to an allowed parser worker host'
    });
    await expect(STORE.getJob(jobId)).resolves.toMatchObject({ status: 'FAILED', verdict: 'FAILED' });
  });

  it('accepts a PDF-only upload as the invoice source and routes to AMBER review (Rule #0 OR semantics)', async () => {
    const fd = new FormData();
    fd.set('file', new File(['%PDF-1.4 minimal'], 'pod.pdf', { type: 'application/pdf' }));
    const ingest = await INGEST_POST(new Request('http://test/api/files/ingest', {
      method: 'POST',
      body: fd,
      headers: { 'x-user-id': 'u1' }
    }));
    const uploaded = await ingest.json();

    // Worker parses a PDF into evidence candidates with zero structured invoice lines.
    // Persistent mock (not Once): the zero-lines guard returns AMBER before any MCP
    // validation, and stray background tasks must not starve the parse call's mock.
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ parse_result_id: 'pr_pdf', job_id: uploaded.job_id, file_id: 'f_pdf', normalized: { invoice_id: 'inv_pdf', invoice_header: { currency: 'AED' }, invoice_lines: [], evidence_candidates: [{ source_file_id: 'f_pdf', text_span: 'POD', confidence: 0.9 }], parser_confidence: 0.9, parser_version: 'parser-0.2.0-pdf-0.1.0' } })
    });
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';

    const run = await POST(new Request('http://test/api/invoice-audit/run', {
      method: 'POST',
      body: JSON.stringify({ job_id: uploaded.job_id }),
      headers: { 'content-type': 'application/json' }
    }));

    // No 409: the PDF becomes the invoice source. Zero structured lines -> AMBER review,
    // so a result still exists and the final Excel workbook can be built (Rule #0).
    expect(run.status).toBe(202);
    const body = await run.json();
    expect(body.status).toBe('REVIEW_REQUIRED');
    expect(body.verdict).toBe('AMBER');
    expect(body.action_items[0].issue_type).toBe('NO_INVOICE_LINES_EXTRACTED');
    await expect(STORE.getJob(uploaded.job_id)).resolves.toMatchObject({ status: 'REVIEW_REQUIRED', verdict: 'AMBER' });
  });

  it('does NOT trigger NotebookLM when NOTEBOOKLM_ENABLED is unset', async () => {
    const { jobId } = await setupJob();
    fetchMock
      .mockResolvedValueOnce(PARSE_OK(jobId))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) });
    process.env.CF_MCP_BASE_URL = 'https://cf.example';
    process.env.CF_MCP_TIMEOUT_MS = '1000';
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';
    const r = await POST(new Request('http://test/api/invoice-audit/run', { method: 'POST', body: JSON.stringify({ job_id: jobId }), headers: { 'content-type': 'application/json' } }));
    expect(r.status).toBe(202);
    await waitFor(() => calledNotebookLm(), 150); // give any stray background task a chance
    expect(calledNotebookLm()).toBe(false);
  });

  it('triggers /v1/notebooklm/run when NOTEBOOKLM_ENABLED=true, without changing the verdict', async () => {
    const { jobId } = await setupJob();
    process.env.NOTEBOOKLM_ENABLED = 'true';
    process.env.CF_MCP_BASE_URL = 'https://cf.example';
    process.env.CF_MCP_TIMEOUT_MS = '1000';
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/v1/notebooklm/run')) return { ok: true, status: 200, json: async () => ({ job_id: jobId, status: 'CALLBACK_SENT' }) };
      if (u.includes('/v1/parse')) return PARSE_OK(jobId);
      return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) }; // CF MCP — benign, tools fall back
    });
    const r = await POST(new Request('http://test/api/invoice-audit/run', { method: 'POST', body: JSON.stringify({ job_id: jobId }), headers: { 'content-type': 'application/json' } }));
    expect(r.status).toBe(202); // verdict pipeline unaffected by the parallel trigger
    const triggered = await waitFor(() => calledNotebookLm());
    expect(triggered).toBe(true);
  });

  it('NotebookLM trigger failure is isolated — route still returns its verdict', async () => {
    const { jobId } = await setupJob();
    process.env.NOTEBOOKLM_ENABLED = 'true';
    process.env.CF_MCP_BASE_URL = 'https://cf.example';
    process.env.CF_MCP_TIMEOUT_MS = '1000';
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/v1/notebooklm/run')) throw Object.assign(new Error('worker down'), { name: 'TypeError' });
      if (u.includes('/v1/parse')) return PARSE_OK(jobId);
      return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) };
    });
    const r = await POST(new Request('http://test/api/invoice-audit/run', { method: 'POST', body: JSON.stringify({ job_id: jobId }), headers: { 'content-type': 'application/json' } }));
    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.status).toBe('REVIEW_REQUIRED');
  });
});
