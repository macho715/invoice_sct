import { describe, it, expect } from 'vitest';
import { POST } from '../src/app/api/files/confirm/route';
import { STORE } from '../src/lib/job-store';
import { verifyJobToken } from '../src/lib/job-token';

const SHA = 'a'.repeat(64);

function confirmReq(body: unknown, headers: Record<string, string> = { 'x-user-id': 'u1' }) {
  return new Request('http://test/api/files/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as any;
}

describe('POST /api/files/confirm (GCS object -> SourceFile)', () => {
  it('requires job_id, file_id, and sha256', async () => {
    const r = await POST(confirmReq({ job_id: 'j', file_id: 'f' }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('INVALID_REQUEST');
  });

  it('registers a gs:// blob_ref source file and marks the job UPLOADED', async () => {
    const gcsUri = 'gs://dsv-invoice-source/source/job_confirm_1/file_1/HVDC-DO.pdf';
    const r = await POST(confirmReq({
      job_id: 'job_confirm_1',
      file_id: 'file_1',
      sha256: SHA,
      size_bytes: 4096,
      gcs_uri: gcsUri,
    }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('UPLOADED');
    expect(body.gcs_uri).toBe(gcsUri);
    expect(body.job_token).toEqual(expect.any(String));

    const sources = await STORE.listSourceFiles('job_confirm_1');
    const job = await STORE.getJob('job_confirm_1');
    expect(job).not.toBeNull();
    expect(verifyJobToken(job!, body.job_token)).toBe(true);
    expect(sources).toHaveLength(1);
    expect(sources[0].blob_ref).toBe(gcsUri);
    expect(sources[0].file_type).toBe('pdf');
    expect(sources[0].size_bytes).toBe(4096);
  });

  it('accumulates multiple files under the same job_id', async () => {
    const job = 'job_confirm_multi';
    await POST(confirmReq({ job_id: job, file_id: 'f1', sha256: SHA, size_bytes: 10, gcs_uri: `gs://b/source/${job}/f1/a.pdf` }));
    await POST(confirmReq({ job_id: job, file_id: 'f2', sha256: 'b'.repeat(64), size_bytes: 20, gcs_uri: `gs://b/source/${job}/f2/b.pdf` }));

    const sources = await STORE.listSourceFiles(job);
    expect(sources).toHaveLength(2);
    expect(sources.every(s => s.blob_ref.startsWith('gs://'))).toBe(true);
  });
});
