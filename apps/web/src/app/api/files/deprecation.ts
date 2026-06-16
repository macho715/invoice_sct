import { NextResponse } from 'next/server';

/**
 * deprecation-headers.ts — PR 3.4
 *
 * Adds Deprecation / Sunset / Link headers to NextResponse so clients can
 * detect sunset endpoints. Sunset 2026-09-15 (90 days from 2026-06-16).
 *
 * Existing routes that received this marker:
 *   - /api/files/ingest      (replaced by /api/invoices for new flow)
 *   - /api/files/register    (replaced by /api/invoices)
 *   - /api/files/blob-upload (replaced by /api/invoices/upload-url)
 *   - /api/files/confirm     (GCS legacy path)
 *
 * @see PLAN_20260616_160103.md PR 3.4
 */

export const SUNSET_DATE = '2026-09-15';

/** Replacement endpoint label (for the Link header). */
const REPLACEMENTS: Record<string, string> = {
  '/api/files/ingest': '</api/invoices>; rel="successor-version"',
  '/api/files/register': '</api/invoices>; rel="successor-version"',
  '/api/files/blob-upload': '</api/invoices/upload-url>; rel="successor-version"',
  '/api/files/confirm': '</api/invoices>; rel="successor-version"',
};

/**
 * withDeprecation — wrap a NextResponse with Deprecation/Sunset headers.
 *
 * Usage:
 *   return withDeprecation(NextResponse.json({ ... }), '/api/files/ingest');
 *
 * The `req` parameter is reserved for future per-request deprecation policy
 * (e.g. internal vs external callers) and is currently unused.
 */
export function withDeprecation(
  res: NextResponse,
  routePath: keyof typeof REPLACEMENTS | string,
  _req?: Request,
): NextResponse {
  res.headers.set('Deprecation', 'true');
  res.headers.set('Sunset', SUNSET_DATE);
  const link = REPLACEMENTS[routePath];
  if (link) res.headers.set('Link', link);
  return res;
}
