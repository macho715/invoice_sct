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

  describe('runNotebookLm', () => {
    it('POSTs to /v1/notebooklm/run with bearer + job_id/blob_url and returns worker status', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job_id: 'j1', status: 'CALLBACK_SENT', notebooklm_source_id: 'src1' }) });
      const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 'tok' });
      const r = await c.runNotebookLm({ job_id: 'j1', blob_url: 'http://signed/inv', notebook_id: 'nb1' });
      expect(r.status).toBe('CALLBACK_SENT');
      expect(r.notebooklm_source_id).toBe('src1');
      const [url, opts] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/v1/notebooklm/run');
      expect((opts as any).headers.authorization).toBe('Bearer tok');
      expect(JSON.parse((opts as any).body)).toEqual({ job_id: 'j1', blob_url: 'http://signed/inv', notebook_id: 'nb1' });
    });

    it('omits notebook_id from body when not provided (worker schema is extra-forbid)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job_id: 'j1', status: 'CALLBACK_SENT' }) });
      const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 'tok' });
      await c.runNotebookLm({ job_id: 'j1', blob_url: 'http://signed/inv' });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body).not.toHaveProperty('notebook_id');
      expect(body).toEqual({ job_id: 'j1', blob_url: 'http://signed/inv' });
    });

    it('returns TRIGGER_REJECTED on non-2xx without throwing', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'down' });
      const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 'tok' });
      const r = await c.runNotebookLm({ job_id: 'j1', blob_url: 'http://signed/inv' });
      expect(r.status).toBe('TRIGGER_REJECTED');
      expect(r.error_code).toBe('503');
    });

    it('treats abort/timeout as a successful TRIGGER (worker keeps running)', async () => {
      const timeoutErr = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      fetchMock.mockRejectedValueOnce(timeoutErr);
      const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 'tok' });
      const r = await c.runNotebookLm({ job_id: 'j1', blob_url: 'http://signed/inv' });
      expect(r.status).toBe('TRIGGERED');
    });

    it('rethrows unexpected network errors', async () => {
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'TypeError' }));
      const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 'tok' });
      await expect(c.runNotebookLm({ job_id: 'j1', blob_url: 'http://signed/inv' })).rejects.toThrow(/boom/);
    });
  });

  describe('startVisionOcr', () => {
    it('POSTs to /v1/vision/start with bearer token and returns STARTED', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: 'j1',
          file_id: 'pdf1',
          operation_name: 'operations/op1',
          output_gcs_prefix: 'gs://dsv-invoice-ocr/jobs/j1/pdf1/',
          status: 'STARTED',
        }),
      });
      const c = createParserClient({ baseUrl: 'http://localhost:8000/', token: 'tok' });

      const r = await c.startVisionOcr({
        job_id: 'j1',
        file_id: 'pdf1',
        source_gcs_uri: 'gs://dsv-invoice-source/source/j1/pdf1/input.pdf',
        output_gcs_prefix: 'gs://dsv-invoice-ocr/jobs/j1/pdf1/',
      });

      expect(r.status).toBe('STARTED');
      expect(r.operation_name).toBe('operations/op1');
      const [url, opts] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('http://localhost:8000/v1/vision/start');
      expect((opts as any).headers.authorization).toBe('Bearer tok');
      expect(JSON.parse((opts as any).body)).toEqual({
        job_id: 'j1',
        file_id: 'pdf1',
        source_gcs_uri: 'gs://dsv-invoice-source/source/j1/pdf1/input.pdf',
        output_gcs_prefix: 'gs://dsv-invoice-ocr/jobs/j1/pdf1/',
      });
    });

    it('returns VISION_DISABLED on non-2xx without throwing', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'down' });
      const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 'tok' });

      const r = await c.startVisionOcr({
        job_id: 'j1',
        file_id: 'pdf1',
        source_gcs_uri: 'gs://source/input.pdf',
        output_gcs_prefix: 'gs://ocr/out/',
      });

      expect(r).toEqual({ job_id: 'j1', file_id: 'pdf1', status: 'VISION_DISABLED', error_code: 'HTTP_503' });
    });

    it('returns VISION_DISABLED on timeout or unexpected fetch failure', async () => {
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
      const c = createParserClient({ baseUrl: 'http://localhost:8000', token: 'tok' });

      const timedOut = await c.startVisionOcr({
        job_id: 'j1',
        file_id: 'pdf1',
        source_gcs_uri: 'gs://source/input.pdf',
        output_gcs_prefix: 'gs://ocr/out/',
      });

      expect(timedOut.error_code).toBe('TRIGGER_TIMEOUT');

      fetchMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'TypeError' }));
      const failed = await c.startVisionOcr({
        job_id: 'j1',
        file_id: 'pdf1',
        source_gcs_uri: 'gs://source/input.pdf',
        output_gcs_prefix: 'gs://ocr/out/',
      });

      expect(failed.error_code).toBe('TRIGGER_FAILED');
    });
  });
});
