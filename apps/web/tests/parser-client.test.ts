import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { createParserClient } from '../src/lib/parser-client';

describe('parser-client', () => {
  beforeEach(() => fetchMock.mockReset());

  it('parse POSTs to /parse and returns normalized', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ parse_result_id: 'pr1', job_id: 'j1', file_id: 'f1',
        normalized: { invoice_id: 'inv1', invoice_header: { currency: 'AED' },
          invoice_lines: [{ line_id: 'l1', description: 'X', currency: 'AED', amount: 1 }], evidence_candidates: [], parser_confidence: 0.9, parser_version: 'parser-0.1.0' } })
    });
    const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 't' });
    const r = await c.parse({ blob_ref: 'b', file_id: 'f1', job_id: 'j1', file_type: 'xlsx', parser_version: 'parser-0.1.0', blob_url: 'http://signed/x' });
    expect((r.normalized as { invoice_lines: { description: string }[] }).invoice_lines[0].description).toBe('X');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws PARSE_FAILED on 4xx/5xx', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => JSON.stringify({ detail: 'bad' }) });
    const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 't' });
    await expect(c.parse({ blob_ref:'b', file_id:'f', job_id:'j', file_type:'xlsx', parser_version:'p', blob_url:'u' })).rejects.toThrow(/PARSE_FAILED/);
  });

  it('parsePdfText POSTs for pdf (P3B)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ parse_result_id: 'pr_pdf', job_id: 'j1', file_id: 'f_pdf',
        normalized: { invoice_id: 'inv_pdf', invoice_header: { currency: 'AED' }, invoice_lines: [], evidence_candidates: [{source_file_id:'f_pdf', text_span:'INV-1', confidence:0.9}], parser_confidence: 0.91, parser_version: 'parser-0.2.0-pdf-0.1.0' } })
    });
    const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 't' });
    const r = await c.parsePdfText({ blob_ref: 'b', file_id: 'f_pdf', job_id: 'j1', file_type: 'pdf', parser_version: 'parser-0.2.0-pdf-0.1.0', blob_url: 'http://signed/pdf' });
    expect((r.normalized as { parser_confidence: number }).parser_confidence).toBe(0.91);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
