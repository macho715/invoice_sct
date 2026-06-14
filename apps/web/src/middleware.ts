import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const RATE_LIMIT = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_REQ = 60;

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const apiKey = process.env.API_SECRET_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token || token !== apiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ip = req.headers.get('x-forwarded-for') || 'unknown';
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
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
