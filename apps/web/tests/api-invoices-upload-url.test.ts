import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handleUploadMock } = vi.hoisted(() => ({ handleUploadMock: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ handleUpload: handleUploadMock }));

import { POST } from '../src/app/api/invoices/upload-url/route';

beforeEach(() => handleUploadMock.mockReset());

describe('POST /api/invoices/upload-url (client token minter)', () => {
  it('returns the handleUpload token payload', async () => {
    handleUploadMock.mockResolvedValueOnce({ type: 'blob.generate-client-token', clientToken: 'tok_123' });
    const r = await POST(new Request('http://test/api/invoices/upload-url', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname: 'inv.pdf', callbackUrl: 'http://test/api/invoices/upload-url' } }),
    }));
    expect(r.status).toBe(200);
    expect((await r.json()).clientToken).toBe('tok_123');
  });

  it('constrains content types and size via onBeforeGenerateToken', async () => {
    handleUploadMock.mockImplementationOnce(async (opts: any) => {
      const cfg = await opts.onBeforeGenerateToken('inv.pdf', null, false);
      expect(cfg.allowedContentTypes).toContain('application/pdf');
      expect(cfg.maximumSizeInBytes).toBe(50 * 1024 * 1024);
      return { type: 'blob.generate-client-token', clientToken: 'tok' };
    });
    const r = await POST(new Request('http://test/api/invoices/upload-url', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'blob.generate-client-token', payload: {} }),
    }));
    expect(r.status).toBe(200);
  });

  it('400 on invalid JSON', async () => {
    const r = await POST(new Request('http://test/api/invoices/upload-url', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('INVALID_REQUEST');
  });
});
