import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../src/app/api/files/create-upload-url/route';

const ORIGINAL_ENV = { ...process.env };

function makeRequest(body: unknown) {
  return new Request('http://test/api/files/create-upload-url', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

describe('POST /api/files/create-upload-url (GCS)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.GCS_UPLOAD_ENABLED = 'true';
    process.env.GCS_SOURCE_BUCKET = 'dsv-invoice-source';
    process.env.GCS_CLIENT_EMAIL = 'svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com';
    process.env.GCS_PRIVATE_KEY = testPrivateKey();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns a V4 signed PUT URL and GCS URI when GCS upload is enabled', async () => {
    const response = await POST(makeRequest({
      filename: 'HVDC-ADOPT-SCT-0122_DO.pdf',
      mime_type: 'application/pdf',
      size_bytes: 446172,
      file_role: 'EVIDENCE',
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.gcs_uri).toMatch(/^gs:\/\/dsv-invoice-source\/source\/job_[^/]+\/file_[^/]+\/HVDC-ADOPT-SCT-0122_DO\.pdf$/);
    expect(body.signed_upload_url).toContain('https://storage.googleapis.com/dsv-invoice-source/source/');
    expect(body.signed_upload_url).toContain('X-Goog-Algorithm=GOOG4-RSA-SHA256');
    expect(body.signed_upload_url).toContain('X-Goog-Signature=');
    expect(body.upload_method).toBe('PUT');
    expect(body.required_headers).toEqual({ 'content-type': 'application/pdf' });
    expect(body.file_role).toBe('EVIDENCE');
  });

  it('keeps the dev ingest fallback when GCS upload is disabled', async () => {
    process.env.GCS_UPLOAD_ENABLED = 'false';
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';

    const response = await POST(makeRequest({
      filename: 'invoice.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 1234,
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.signed_upload_url).toBe('http://localhost:3000/api/files/ingest');
    expect(body.gcs_uri).toContain('gs://hvdc-invoice-source-prod/source/');
  });
});
