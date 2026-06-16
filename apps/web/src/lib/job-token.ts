import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { httpForError } from './error-codes';
import type { Job } from './job-store';

type TokenBody = Record<string, unknown> | FormData | null | undefined;

function secret(): string {
  const configured = process.env.JOB_TOKEN_SECRET ?? process.env.API_SECRET_KEY ?? process.env.CALLBACK_HMAC_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'test' || process.env.VERCEL !== '1') return 'dev-job-token-secret';
  throw new Error('JOB_TOKEN_SECRET or API_SECRET_KEY is required');
}

function payloadFor(job: Pick<Job, 'job_id' | 'created_at'>): string {
  return `${job.job_id}.${job.created_at}`;
}

function shouldBypassForTest(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.ENFORCE_JOB_TOKEN_IN_TESTS !== '1';
}

function hasApiSecret(req: Request): boolean {
  const configured = process.env.API_SECRET_KEY;
  if (!configured) return false;
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(configured);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createJobToken(job: Pick<Job, 'job_id' | 'created_at'>): string {
  const payload = payloadFor(job);
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

export function verifyJobToken(job: Pick<Job, 'job_id' | 'created_at'>, token: string | null | undefined): boolean {
  if (shouldBypassForTest()) return true;
  if (!token) return false;
  const [payload64, signature] = token.split('.');
  if (!payload64 || !signature) return false;
  let payload: string;
  try {
    payload = Buffer.from(payload64, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  if (payload !== payloadFor(job)) return false;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function extractJobToken(req: Request, body?: TokenBody): string | null {
  const headerToken = req.headers.get('x-job-token');
  if (headerToken) return headerToken;
  const auth = req.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

  try {
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('job_token');
    if (queryToken) return queryToken;
  } catch {}

  if (body instanceof FormData) {
    const value = body.get('job_token');
    return typeof value === 'string' && value ? value : null;
  }
  if (body && typeof body === 'object') {
    const value = body.job_token;
    return typeof value === 'string' && value ? value : null;
  }
  return null;
}

export function requireJobToken(req: Request, job: Pick<Job, 'job_id' | 'created_at'>, body?: TokenBody): Response | null {
  if (hasApiSecret(req)) return null;
  if (verifyJobToken(job, extractJobToken(req, body))) return null;
  return NextResponse.json(
    { code: 'FORBIDDEN', message: 'valid job_token required' },
    { status: httpForError('FORBIDDEN') },
  );
}
