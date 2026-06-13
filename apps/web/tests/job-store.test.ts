import { describe, it, expect, beforeEach } from 'vitest';
import { createJobStore } from '../src/lib/job-store';

describe('job-store', () => {
  let store: ReturnType<typeof createJobStore>;
  beforeEach(() => { store = createJobStore(); });

  it('createJob returns a job with CREATED status and a unique job_id', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    expect(j.job_id).toMatch(/^job_/);
    expect(j.status).toBe('CREATED');
    expect(j.created_by).toBe('u1');
  });

  it('getJob returns undefined for unknown job_id', async () => {
    expect(await store.getJob('job_nope')).toBeUndefined();
  });

  it('updateJob mutates status and updated_at', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    const before = j.updated_at;
    await new Promise(r => setTimeout(r, 5));
    const updated = await store.updateJob(j.job_id, { status: 'UPLOADED' });
    expect(updated?.status).toBe('UPLOADED');
    expect(updated?.updated_at).not.toBe(before);
  });

  it('addSourceFile and listSourceFiles', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    await store.addSourceFile(j.job_id, {
      file_id: 'f1', job_id: j.job_id, original_filename: 'inv.xlsx',
      file_type: 'xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 1024, sha256: 'a'.repeat(64), blob_ref: 'blob:abc',
      parser_status: 'PENDING', uploaded_by: 'u1', uploaded_at: new Date().toISOString()
    });
    const files = await store.listSourceFiles(j.job_id);
    expect(files).toHaveLength(1);
    expect(files[0].file_id).toBe('f1');
  });

  it('appendTrace keeps insertion order and assigns trace_id', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    await store.appendTrace(j.job_id, { step: 'UPLOAD', input_ref: 'i', output_ref: 'o' });
    await store.appendTrace(j.job_id, { step: 'PARSE',  input_ref: 'i', output_ref: 'o' });
    const tr = await store.listTrace(j.job_id);
    expect(tr.map(t => t.step)).toEqual(['UPLOAD','PARSE']);
    for (const t of tr) expect(t.trace_id).toMatch(/^trace_/);
  });

  it('setResult and getResult are typed', async () => {
    const j = await store.createJob({ created_by: 'u1' });
    await store.setResult(j.job_id, { verdict: 'AMBER', line_results: [], action_items: [] });
    const r = await store.getResult(j.job_id);
    expect(r?.verdict).toBe('AMBER');
  });
});
