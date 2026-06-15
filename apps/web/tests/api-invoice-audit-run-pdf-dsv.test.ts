import { beforeEach, describe, it, expect, vi } from 'vitest';

// E2E for the DSV SHPT hybrid parser landing in the worker: a PDF invoice now yields real
// invoice_lines (doc_type-classified charge lines), so the run route must take the normal
// parse -> MCP validation -> gate path instead of the zero-lines forced-AMBER guard.

const putMock = vi.fn(async (_n: string, _b: Blob) => ({ url: 'https://blob/x', pathname: 'x' }));
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
  delete process.env.NOTEBOOKLM_ENABLED;
  delete process.env.NOTEBOOKLM_NOTEBOOK_ID;
  delete process.env.VISION_FALLBACK_ENABLED;
  delete process.env.GCS_OCR_BUCKET;
});

describe('POST /api/invoice-audit/run — PDF with DSV charge lines', () => {
  it('runs full validation instead of the zero-lines AMBER guard', async () => {
    const fd = new FormData();
    fd.set('file', new File(['%PDF-1.4 minimal'], 'HVDC-ADOPT-SCT-0175_SuppDocs.pdf', { type: 'application/pdf' }));
    const ingest = await INGEST_POST(new Request('http://test/api/files/ingest', {
      method: 'POST', body: fd, headers: { 'x-user-id': 'u1' }
    }));
    const uploaded = await ingest.json();

    // Route by URL so an extra pre-parse fetch (signed-url etc.) cannot offset the mock chain.
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/v1/parse')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            parse_result_id: 'pr_pdf_dsv', job_id: uploaded.job_id, file_id: 'f_pdf',
            normalized: {
              invoice_id: 'inv_pdf',
              invoice_header: { invoice_no: null, currency: 'AED' },
              invoice_lines: [{
                line_id: 'L001', shipment_ref: 'HVDC-ADOPT-SCT-0175', description: 'Container Inspection',
                currency: 'AED', amount: 105, type_b: 'Inspection',
                source_ref: { source: 'text:carrier_row', page: 1, doc_type: 'CARRIER_RHS', evidence_status: 'MATCHED_AMOUNT' }
              }],
              evidence_candidates: [], parser_confidence: 0.9, parser_version: 'parser-0.2.0-dsv-hybrid-2.1'
            }
          })
        };
      }
      // CF MCP tool calls (route_question / type_b / rate_lookup / cost_guard / doc_guardian)
      if (u.includes('route_question') || u.includes('/cf') || u.includes('cf.example')) {
        return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { domain: 'invoice-cost', requiredCorpus: [] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) };
    });
    process.env.CF_MCP_BASE_URL = 'https://cf.example';
    process.env.CF_MCP_TIMEOUT_MS = '1000';
    process.env.PARSER_WORKER_URL = 'http://localhost:8000';
    process.env.PARSER_WORKER_TOKEN = 't';

    const r = await POST(new Request('http://test/api/invoice-audit/run', {
      method: 'POST', body: JSON.stringify({ job_id: uploaded.job_id }), headers: { 'content-type': 'application/json' }
    }));

    expect(r.status).toBe(202);
    const body = await r.json();
    // It must reach the real gate, NOT the zero-lines guard.
    const issueTypes = (body.action_items ?? []).map((a: any) => a.issue_type);
    expect(issueTypes).not.toContain('NO_INVOICE_LINES_EXTRACTED');
    // A validation result was produced for the extracted line.
    await expect(STORE.getValidationResult(uploaded.job_id)).resolves.toBeTruthy();
  });
});
