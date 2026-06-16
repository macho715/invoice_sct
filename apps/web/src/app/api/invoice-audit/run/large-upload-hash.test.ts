import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { STORE } from '@/lib/job-store';
import { uploadToBlob } from '@/lib/blob';
import { SourceFileSchema, type SourceFile } from '@/lib/types';

const parserMock = {
  parse: vi.fn(),
  parsePdfText: vi.fn(),
  runNotebookLm: vi.fn()
};

vi.mock('@/lib/parser-client', () => ({
  createParserClient: () => parserMock
}));

vi.mock('@/lib/cf-mcp-client', () => ({
  McpUnavailableError: class McpUnavailableError extends Error {},
  createCfMcpClient: () => ({ validate: vi.fn() })
}));

const PENDING_SHA256_PLACEHOLDER = '0'.repeat(64);

function fileId(name: string) {
  return `file_${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
}

async function addSource(jobId: string, file: File, sha256?: string): Promise<SourceFile> {
  const blob = await uploadToBlob(file, jobId);
  const source = SourceFileSchema.parse({
    file_id: fileId(file.name),
    job_id: jobId,
    original_filename: file.name,
    file_type: file.name.endsWith('.pdf') ? 'pdf' : 'xlsx',
    mime_type: file.type || 'application/octet-stream',
    size_bytes: blob.size_bytes,
    sha256: sha256 ?? blob.sha256,
    blob_ref: blob.blob_ref,
    blob_url: blob.blob_url,
    parser_status: 'PENDING',
    uploaded_by: 'test-user',
    uploaded_at: new Date().toISOString()
  });
  await STORE.addSourceFile(jobId, source);
  return source;
}

async function runJob(jobId: string) {
  const { POST } = await import('./route');
  return POST(new Request('http://test/api/invoice-audit/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ job_id: jobId })
  }));
}

describe('invoice audit run large upload hash guard', () => {
  beforeEach(() => {
    process.env.PARSER_WORKER_TOKEN = 'test-token';
    process.env.PARSER_WORKER_URL = 'http://127.0.0.1:8000';
    parserMock.parse.mockReset();
    parserMock.parsePdfText.mockReset();
    parserMock.runNotebookLm.mockReset();
    parserMock.parse.mockResolvedValue({
      parse_result_id: 'parse_zero_lines',
      normalized: { invoice_header: {}, invoice_lines: [], evidence_candidates: [] }
    });
  });

  it('re-hashes mixed small xlsx + large pdf evidence before parsing', async () => {
    const job = await STORE.createJob({ created_by: 'test-user' });
    await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
    await addSource(job.job_id, new File(['invoice'], 'invoice.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const evidence = await addSource(job.job_id, new File(['large evidence bytes'], 'evidence.pdf', { type: 'application/pdf' }), PENDING_SHA256_PLACEHOLDER);

    const response = await runJob(job.job_id);

    expect(response.status).toBe(202);
    const files = await STORE.listSourceFiles(job.job_id);
    const updatedEvidence = files.find(f => f.file_id === evidence.file_id);
    expect(updatedEvidence?.sha256).toBe(createHash('sha256').update('large evidence bytes').digest('hex'));
    expect(parserMock.parse).toHaveBeenCalledOnce();
  });

  it('re-hashes a large pdf-only source placeholder before PDF-only AMBER flow', async () => {
    const job = await STORE.createJob({ created_by: 'test-user' });
    await STORE.updateJob(job.job_id, { status: 'UPLOADED' });
    const pdf = await addSource(job.job_id, new File(['large pdf invoice bytes'], 'invoice.pdf', { type: 'application/pdf' }), PENDING_SHA256_PLACEHOLDER);

    const response = await runJob(job.job_id);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.verdict).toBe('AMBER');
    const files = await STORE.listSourceFiles(job.job_id);
    const updatedPdf = files.find(f => f.file_id === pdf.file_id);
    expect(updatedPdf?.sha256).toBe(createHash('sha256').update('large pdf invoice bytes').digest('hex'));
    expect(parserMock.parse).toHaveBeenCalledWith(expect.objectContaining({ file_type: 'pdf' }));
  });
});
