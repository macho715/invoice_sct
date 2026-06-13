import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.BLOB_READ_WRITE_TOKEN = 'mock-prod-token';

const putMock = vi.fn(async (_name: string, body?: Blob) => ({
  url: `https://blob.vercel-storage.com/${body?.size ?? 0}`,
  pathname: 'inv.xlsx'
}));

vi.mock('@vercel/blob', () => ({ put: putMock }));

import { uploadToBlob } from '../src/lib/blob';

describe('blob', () => {
  beforeEach(() => putMock.mockClear());

  it('uploadToBlob returns blob_ref, sha256, size_bytes', async () => {
    const file = new File(['hello world'], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const out = await uploadToBlob(file, 'job_abc');
    expect(out.blob_ref).toMatch(/^blob:/);
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.size_bytes).toBe(11);
    expect(out.mime_type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(putMock).toHaveBeenCalledOnce();
  });
});
