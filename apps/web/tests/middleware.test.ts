import { describe, expect, it, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

function apiRequest(token?: string, ip = '203.0.113.10', path = '/api/audit/approve') {
  const headers = new Headers({ 'x-forwarded-for': ip });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(`https://example.test${path}`, { headers });
}

afterEach(() => {
  delete process.env.API_SECRET_KEY;
});

describe('middleware API auth', () => {
  it('allows public UI API routes without bearer token', () => {
    expect(middleware(apiRequest(undefined, '203.0.113.20', '/api/files/ingest')).status).toBe(200);
    expect(middleware(apiRequest(undefined, '203.0.113.21', '/api/audit/status?job_id=j1')).status).toBe(200);
    expect(middleware(apiRequest(undefined, '203.0.113.22', '/api/invoice-audit/run')).status).toBe(200);
    expect(middleware(apiRequest(undefined, '203.0.113.23', '/api/export/download?job_id=j1')).status).toBe(200);
    // Browser-initiated export must be public too (Rule #0: the EXPORT_FAILED root
    // cause was this route being auth-gated for the unauthenticated UI fetch).
    expect(middleware(apiRequest(undefined, '203.0.113.24', '/api/audit/export')).status).toBe(200);
    // dev-stub blob serving (prefix) — the worker fetches it without a bearer token.
    expect(middleware(apiRequest(undefined, '203.0.113.25', '/api/dev/blob/job_x/file.pdf')).status).toBe(200);
  });

  it('rejects API requests when API_SECRET_KEY is missing', async () => {
    const res = middleware(apiRequest('secret', '203.0.113.11'));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Server misconfigured' });
  });

  it('rejects missing and mismatched bearer tokens', async () => {
    process.env.API_SECRET_KEY = 'correct-secret';

    expect(middleware(apiRequest(undefined, '203.0.113.12')).status).toBe(401);
    expect(middleware(apiRequest('wrong-secret', '203.0.113.13')).status).toBe(401);
  });

  it('allows matching bearer tokens without Node crypto or Buffer', () => {
    process.env.API_SECRET_KEY = 'correct-secret';

    const res = middleware(apiRequest('correct-secret', '203.0.113.14'));

    expect(res.status).toBe(200);
  });
});
