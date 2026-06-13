import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJobStore } from '../src/lib/job-store';

describe('job-store MCP sync', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('save_job_store_data is called when creating a job', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: { success: true, message: 'Saved successfully in D1.' } }
      })
    });

    const store = createJobStore();
    const job = await store.createJob({ created_by: 'u1' });

    expect(job.created_by).toBe('u1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.name).toBe('save_job_store_data');
    expect(body.params.arguments.entityType).toBe('job');
    expect(body.params.arguments.data.created_by).toBe('u1');
  });

  it('get_job_store_data is called when getting a job', async () => {
    const mockJob = {
      job_id: 'job_123',
      status: 'QUEUED',
      verdict: null,
      created_by: 'u2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      rule_version: 'rule-0.1.0',
      parser_version: 'parser-0.1.0'
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: { result: mockJob } }
      })
    });

    const store = createJobStore();
    const job = await store.getJob('job_123');

    expect(job).toBeDefined();
    expect(job?.job_id).toBe('job_123');
    expect(job?.status).toBe('QUEUED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.name).toBe('get_job_store_data');
    expect(body.params.arguments.entityType).toBe('job');
    expect(body.params.arguments.jobId).toBe('job_123');
  });
});
