import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handleUploadMock } = vi.hoisted(() => ({ handleUploadMock: vi.fn() }));

vi.mock('@vercel/blob/client', () => ({ handleUpload: handleUploadMock }));

import { POST } from './route';

function makeRequest(body: unknown, headers: Record<string, string> = { 'x-user-id': 'u1' }) {
  return new Request('http://test/api/files/ingest/large', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('POST /api/files/ingest/large (P0-2)', () => {
  beforeEach(() => {
    handleUploadMock.mockReset();
  });

  it('returns 400 use_small_upload_route when fileSize < 4.5MB', async () => {
    const req = makeRequest({
      filename: 'inv.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 4_000_000,  // 4MB, under threshold
      jobId: 'job_abc'
    });
    const r = await POST(req);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('use_small_upload_route');
    expect(handleUploadMock).not.toHaveBeenCalled();
  });

  it('returns 200 with signed URL when fileSize > 4.5MB and valid mime', async () => {
    handleUploadMock.mockResolvedValueOnce({
      type: 'blob.generate-client-token',
      clientToken: 'vercel_blob_client_st_mocktokenpayload'
    });

    const req = makeRequest({
      filename: 'big-invoice.pdf',
      mimeType: 'application/pdf',
      fileSize: 5_000_000,  // 5MB, over threshold
      jobId: 'job_xyz'
    });
    const r = await POST(req);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.url).toBe('vercel_blob_client_st_mocktokenpayload');
    expect(body.pathname).toBeDefined();
    expect(body.access).toBe('private');
    expect(handleUploadMock).toHaveBeenCalledOnce();
  });

  it('returns 400 for invalid mime type', async () => {
    const req = makeRequest({
      filename: 'evil.exe',
      mimeType: 'application/x-msdownload',
      fileSize: 5_000_000,
      jobId: 'job_xyz'
    });
    const r = await POST(req);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('unsupported_mime_type');
    expect(handleUploadMock).not.toHaveBeenCalled();
  });
});
