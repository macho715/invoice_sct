import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const RATE_LIMIT = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_REQ = 60;
const TEXT_ENCODER = new TextEncoder();
const PUBLIC_UI_API_ROUTES = [
  '/api/files/ingest',
  '/api/audit/status',
  '/api/invoice-audit/run',
  '/api/export/download'
];

let reqCounter = 0;
const MAX_MAP_SIZE = 10_000;

function sweepExpired() {
  const now = Date.now();
  for (const [key, entry] of RATE_LIMIT) {
    if (now > entry.reset) RATE_LIMIT.delete(key);
  }
}

function constantTimeEqualEdge(actual: string, expected: string): boolean {
  const actualBytes = TEXT_ENCODER.encode(actual);
  const expectedBytes = TEXT_ENCODER.encode(expected);
  const maxLength = Math.max(actualBytes.length, expectedBytes.length);
  let diff = actualBytes.length ^ expectedBytes.length;

  for (let i = 0; i < maxLength; i++) {
    diff |= (actualBytes[i] ?? 0) ^ (expectedBytes[i] ?? 0);
  }

  return diff === 0;
}

function isPublicUiApiRoute(pathname: string): boolean {
  return PUBLIC_UI_API_ROUTES.includes(pathname);
}

function applyRateLimit(req: NextRequest): NextResponse | null {
  const rawIp = req.headers.get('x-forwarded-for') || 'unknown';
  const ip = rawIp.split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const entry = RATE_LIMIT.get(ip);
  if (!entry || now > entry.reset) {
    RATE_LIMIT.set(ip, { count: 1, reset: now + WINDOW_MS });
  } else {
    entry.count++;
    if (entry.count > MAX_REQ) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
  }

  reqCounter++;
  if (reqCounter % 100 === 0 || RATE_LIMIT.size > MAX_MAP_SIZE) {
    sweepExpired();
  }

  return null;
}

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const rateLimitResponse = applyRateLimit(req);
    if (rateLimitResponse) return rateLimitResponse;

    if (isPublicUiApiRoute(req.nextUrl.pathname)) {
      return NextResponse.next();
    }

    const apiKey = process.env.API_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token || !constantTimeEqualEdge(token, apiKey)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
