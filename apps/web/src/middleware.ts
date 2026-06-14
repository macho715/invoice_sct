import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const RATE_LIMIT = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_REQ = 60;

let reqCounter = 0;
const MAX_MAP_SIZE = 10_000;

function sweepExpired() {
  const now = Date.now();
  for (const [key, entry] of RATE_LIMIT) {
    if (now > entry.reset) RATE_LIMIT.delete(key);
  }
}

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const apiKey = process.env.API_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    const tokenBuf = Buffer.from(token || '');
    const keyBuf = Buffer.from(apiKey);
    if (!token || tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
