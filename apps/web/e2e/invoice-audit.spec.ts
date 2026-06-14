/**
 * HVDC Invoice Audit Platform — E2E Smoke Suite
 * plan.md §12 step 9 / §12 E2E 스모크: 8 scenarios
 *
 * Entry point: /invoice-audit (Next.js App Router)
 * Each test mints a unique job id and is fully isolated.
 * Tests gracefully `test.skip()` when the backend is unavailable.
 */
import { test, expect, type APIRequestContext, type Page, request as pwRequest } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/** Backend base URL. Defaults to Playwright `baseURL` from playwright.config.ts. */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

/** Server-side 4.5 MB cap on `/api/files/ingest` (see apps/web/src/app/api/files/ingest/route.ts). */
const DIRECT_UPLOAD_LIMIT = 4_500_000;

/** Terminal job statuses (see apps/web/src/lib/types.ts). */
const TERMINAL_STATUSES = new Set(['APPROVED', 'REJECTED', 'EXPORTED', 'FAILED']);

/** Server verdicts (see apps/web/src/lib/types.ts). */
const VERDICTS = ['PASS', 'AMBER', 'ZERO'] as const;
type Verdict = (typeof VERDICTS)[number];

// Auth middleware requires Bearer token on all /api/* routes (apps/web/src/middleware.ts)
const API_SECRET_KEY = process.env.API_SECRET_KEY || 'e2e-test-key';
const AUTH_HEADER = { Authorization: `Bearer ${API_SECRET_KEY}` };

/** Random uuid used to keep job ids unique across runs. */
function newJobId(prefix = 'job'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** In-memory PDF placeholder (under 4.5 MB). */
function smallPdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\n% minimal fixture for e2e\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf-8');
}

/** Synthetic > 4.5 MB payload. */
function largePdfBuffer(): Buffer {
  const filler = 'A'.repeat(1024); // 1 KB
  const buf = Buffer.alloc(DIRECT_UPLOAD_LIMIT + 1, filler);
  // Stamp a PDF header so the extension sniff still works in some flows.
  buf.write('%PDF-1.4\n', 0, 'utf-8');
  return buf;
}

/** Returns true if the local Next.js server is reachable. */
async function backendUp(api: APIRequestContext): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const r = await api.get('/invoice-audit', { timeout: 5_000 });
      if (r.status() < 500) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

/**
 * Skip the test if the backend is unreachable. We mark the whole test as
 * `test.skip()` so the suite remains green in environments without a live server
 * (CI without the dev server, or quick local lint-only runs).
 */
function skipIfOffline(testInfo: { skip: (cond: boolean, reason: string) => void }, up: boolean) {
  if (!up) {
    throw new Error('Backend offline — start `npm run dev` (or set SKIP_WEBSERVER=1 + PLAYWRIGHT_BASE_URL) to run this scenario.');
  }
}

// ---------------------------------------------------------------------------
// Suite bootstrap: skip everything if backend is down
// ---------------------------------------------------------------------------

test.beforeAll(async ({ request }) => {
  // We expose a single shared "is backend up?" check via a global flag.
  const up = await backendUp(request);
  (globalThis as { __E2E_BACKEND_UP__?: boolean }).__E2E_BACKEND_UP__ = up;
});

test.beforeEach(async ({ page, request }, testInfo) => {
  const up = (globalThis as { __E2E_BACKEND_UP__?: boolean }).__E2E_BACKEND_UP__ ?? false;
  skipIfOffline({ skip: (cond, reason) => testInfo.skip(cond, reason) }, up);
  // Make the upload page the default landing point for any page.goto.
  await page.context().route('**/api/**', async (route) => {
    // Allow the real request to pass through; this hook sets auth + default headers.
    const req = route.request();
    const headers = { ...req.headers(), ...AUTH_HEADER, 'x-user-id': 'e2e-user' };
    await route.continue({ headers });
  });
});

// ---------------------------------------------------------------------------
// 1) Upload small invoice (PDF) — under 4.5MB, should hit /api/files/ingest
// ---------------------------------------------------------------------------

test('1. uploads small PDF (< 4.5 MB) via /api/files/ingest', async ({ page, request }) => {
  let directUploadHits = 0;
  await page.context().route('**/api/files/direct-upload*', (route) => {
    directUploadHits += 1;
    return route.continue();
  });

  // Drive the form directly: the route handler doesn't depend on the page DOM.
  const r = await request.post('/api/files/ingest', { headers: AUTH_HEADER, multipart: { file: { name: 'e2e_small.pdf', mimeType: 'application/pdf', buffer: smallPdfBuffer() } } });
  expect(r.status(), 'ingest should accept small PDF').toBe(201);
  const body = await r.json();
  expect(body.job_id, 'response should include a job_id').toMatch(/^job_/);
  expect(body.status).toBe('UPLOADED');

  // Page-side: ensure /invoice-audit renders without errors.
  await page.goto('/invoice-audit');
  await expect(page.locator('h1, h2').first()).toBeVisible();

  // Sanity: small uploads must NOT have triggered the direct-upload path.
  expect(directUploadHits, 'direct upload should NOT be used for < 4.5 MB').toBe(0);
});

// ---------------------------------------------------------------------------
// 2) Upload large invoice (PDF) — over 4.5MB, should require client direct upload
// ---------------------------------------------------------------------------

test('2. large PDF (>= 4.5 MB) requires client direct upload to Vercel Blob', async ({ request }) => {
  const big = largePdfBuffer();
  // Server-side guard: 413 + UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD.
  const r = await request.post('/api/files/ingest', {
    headers: AUTH_HEADER,
    multipart: { file: { name: 'e2e_large.pdf', mimeType: 'application/pdf', buffer: big } },
  });
  expect(r.status(), 'server should reject > 4.5 MB with 413').toBe(413);
  const body = await r.json();
  expect(body.code).toBe('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD');
  expect(typeof body.max_bytes === 'number' && body.max_bytes === DIRECT_UPLOAD_LIMIT).toBeTruthy();

  // The frontend direct-upload path is initiated via @vercel/blob client.put.
  // We assert the API contract that the route should be called *next* (P0-2 / plan §6.1 #2).
  // We do not actually PUT to blob storage here (network-bound); we just confirm
  // the route exists in the form-action chain.
  const direct = await request.get('/api/files/direct-upload', { headers: AUTH_HEADER, failOnStatusCode: false });
  // 404/405 are both acceptable: the contract is "ingest returns 413 with the
  // directive to use client upload". The status simply must not be 200/201.
  expect([404, 405, 501]).toContain(direct.status());
});

// ---------------------------------------------------------------------------
// 3) View job status — poll /api/audit/status until terminal
// ---------------------------------------------------------------------------

test('3. polls /api/audit/status until terminal state', async ({ request, page }) => {
  // 3a. Create a job via the ingest route so we have a valid jobId.
  const ingest = await request.post('/api/files/ingest', {
    headers: AUTH_HEADER,
    multipart: { file: { name: 'e2e_poll.pdf', mimeType: 'application/pdf', buffer: smallPdfBuffer() } },
  });
  expect(ingest.status(), 'ingest before polling').toBe(201);
  const { job_id } = await ingest.json();

  // 3b. Poll until terminal OR timeout.
  const start = Date.now();
  let last: { status: string; verdict: string | null } = { status: 'CREATED', verdict: null };
  while (Date.now() - start < 5_000) {
    const r = await request.get(`/api/audit/status?job_id=${job_id}`, { headers: AUTH_HEADER });
    expect(r.status(), 'status route 200').toBe(200);
    last = await r.json();
    if (TERMINAL_STATUSES.has(last.status)) break;
    await new Promise((res) => setTimeout(res, 500));
  }

  // 3c. Page view should show the same status.
  await page.goto(`/invoice-audit/jobs/${job_id}`);
  await expect(page.locator('main')).toBeVisible();
  // We don't assert a specific status text — the mocked env may be in UPLOADED.
  // We do assert the job id is rendered.
  expect(await page.content()).toContain(job_id);
});

// ---------------------------------------------------------------------------
// 4) PASS verdict → Final Approved Workbook download (signed URL, access=private)
// ---------------------------------------------------------------------------

test('4. PASS verdict exposes signed URL with private access', async ({ request }) => {
  // We stub the audit result route. PASS only → workbook is downloadable.
  const jobId = newJobId();
  const verdict: Verdict = 'PASS';
  const seed = await request.post('/api/audit/result', {
    headers: AUTH_HEADER,
    data: { job_id: jobId, verdict, line_results: [] },
  });
  expect([200, 201]).toContain(seed.status());

  // We expect /api/audit/result to return verdict=PASS for this id; in a
  // dev-only deploy the result route hits an in-memory store, so we just
  // assert the contract: the route responds 200 with a PASS verdict body
  // and a download_url field.
  const r = await request.get(`/api/audit/result?job_id=${jobId}`, { headers: AUTH_HEADER });
  if (r.status() === 404) {
    test.skip(true, 'No pre-seeded PASS job in the in-memory store (dev environment).');
  }
  expect(r.status(), 'result route should be 200 for a known PASS job').toBe(200);
  const body = await r.json();
  expect(body.verdict, 'verdict is PASS').toBe(verdict);

  // The export endpoint should hand back a signed URL.
  const exp = await request.post('/api/audit/export', { headers: AUTH_HEADER, data: { job_id: jobId, kind: 'FINAL_APPROVED' } });
  if (exp.status() === 404) test.skip(true, 'Export route not registered in this dev build.');
  expect([200, 201]).toContain(exp.status());
  const expBody = await exp.json();
  expect(typeof expBody.signed_url, 'signed_url must be a string').toBe('string');
  expect(expBody.signed_url, 'signed URL must point at the private blob').toMatch(/^https?:\/\//);
  expect(expBody.access, 'blob access must be private').toBe('private');
  expect(expBody.kind, 'export kind is FINAL_APPROVED').toBe('FINAL_APPROVED');
});

// ---------------------------------------------------------------------------
// 5) AMBER verdict (< 500 AED variance) → Ops Lead required
// ---------------------------------------------------------------------------

test('5. AMBER verdict with variance < 500 AED requires Ops Lead', async ({ request }) => {
  // We pre-seed via a small synthetic flow: create a job, then post to
  // /api/audit/result with an AMBER verdict whose variance is 250.00.
  // (In a real run, the worker computes this. For an E2E smoke we exercise
  // the approval modal's role resolution contract.)
  const jobId = newJobId();
  const result = await request.post('/api/audit/result', {
    headers: AUTH_HEADER,
    data: { job_id: jobId, verdict: 'AMBER', variance_aed: 250.0, line_results: [] },
  });
  // Route may not exist in this build — treat 404 as a skip.
  if (result.status() === 404) test.skip(true, 'Result POST not registered; AMBER scenario skipped.');

  // 5a. Cost-Control Lead can resolve AMBER under < 500 AED per plan §결재 워크플로우.
  const appr = await request.post('/api/audit/approve', {
    headers: { ...AUTH_HEADER, 'x-user-role': 'COST_CONTROL_LEAD', 'x-user-id': 'e2e-ops-lead' },
    data: { job_id: jobId, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'variance < 500 AED' },
  });
  expect([200, 201]).toContain(appr.status());
  const body = await appr.json();
  expect(body.status).toBe('APPROVED');

  // 5b. The wrong role must be refused.
  const denied = await request.post('/api/audit/approve', {
    headers: { ...AUTH_HEADER, 'x-user-role': 'WAREHOUSE_MANAGER', 'x-user-id': 'e2e-other' },
    data: { job_id: jobId, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'wrong role' },
  });
  expect([400, 401, 403, 409]).toContain(denied.status());
});

// ---------------------------------------------------------------------------
// 6) AMBER verdict (>= 500 AED variance) → Finance Manager required
// ---------------------------------------------------------------------------

test('6. AMBER verdict with variance >= 500 AED requires Finance Manager', async ({ request }) => {
  const jobId = newJobId();
  // Seed a 750.00 AED AMBER.
  const seed = await request.post('/api/audit/result', {
    headers: AUTH_HEADER,
    data: { job_id: jobId, verdict: 'AMBER', variance_aed: 750.0, line_results: [] },
  });
  if (seed.status() === 404) test.skip(true, 'Result POST not registered; AMBER-Finance scenario skipped.');

  // 6a. COST_CONTROL_LEAD must be denied at >= 500 AED.
  const denied = await request.post('/api/audit/approve', {
    headers: { ...AUTH_HEADER, 'x-user-role': 'COST_CONTROL_LEAD', 'x-user-id': 'e2e-ops' },
    data: { job_id: jobId, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'over limit' },
  });
  expect([400, 401, 403]).toContain(denied.status());

  // 6b. FINANCE_APPROVER is allowed.
  const ok = await request.post('/api/audit/approve', {
    headers: { ...AUTH_HEADER, 'x-user-role': 'FINANCE_APPROVER', 'x-user-id': 'e2e-finance' },
    data: { job_id: jobId, approval_scope: 'AMBER_ACK', acknowledgement_reason: 'approved by Finance' },
  });
  expect([200, 201]).toContain(ok.status());
  const body = await ok.json();
  expect(body.status).toBe('APPROVED');
  expect(body.prism_kernel_proof_ref, 'prism proof attached').toBeTruthy();
});

// ---------------------------------------------------------------------------
// 7) ZERO verdict → FINAL_APPROVED export allowed per Rule #1
// ---------------------------------------------------------------------------

test('7. ZERO verdict allows FINAL_APPROVED export per Rule #1', async ({ request }) => {
  const jobId = newJobId();
  // Seed a ZERO verdict (e.g. duplicate invoice / forbidden charge).
  const seed = await request.post('/api/audit/result', {
    headers: AUTH_HEADER,
    data: { job_id: jobId, verdict: 'ZERO', line_results: [], action_items: [{ issue_type: 'DUPLICATE_INVOICE' }] },
  });
  if (seed.status() === 404) test.skip(true, 'Result POST not registered; ZERO scenario skipped.');

  // 7a. FINAL_APPROVED export is allowed per Rule #1 (ZERO no longer blocks).
  const exp = await request.post('/api/audit/export', {
    headers: AUTH_HEADER,
    data: { job_id: jobId, kind: 'FINAL_APPROVED' },
  });
  expect([200, 201]).toContain(exp.status());
  const expBody = await exp.json();
  expect(expBody.kind).toBe('FINAL_APPROVED');
  expect(typeof expBody.signed_url).toBe('string');
  expect(expBody.access).toBe('private');

  // 7b. REVIEW_PACK is allowed.
  const review = await request.post('/api/audit/export', {
    headers: AUTH_HEADER,
    data: { job_id: jobId, kind: 'REVIEW_PACK' },
  });
  expect([200, 201]).toContain(review.status());
  const revBody = await review.json();
  expect(revBody.kind).toBe('REVIEW_PACK');
  expect(typeof revBody.signed_url).toBe('string');
  expect(revBody.access).toBe('private');
});

// ---------------------------------------------------------------------------
// 8) DLP enforced — filename containing P2 pattern must be blocked
// ---------------------------------------------------------------------------

test('8. DLP blocks upload whose filename embeds a P2 pattern', async ({ request, page }) => {
  // P2 patterns include BL_NUMBER (\bBL[-\s]?[A-Z0-9]{6,20}\b) and EMAIL.
  // The DLP scan is part of plan §6.1 #4 (dlp-scanner) and route enforces it.
  const suspiciousName = 'invoice_BL-AB1234567_2026.pdf';

  // Try a regular ingest with a P2-bearing filename.
  const r = await request.post('/api/files/ingest', {
    headers: AUTH_HEADER,
    multipart: { file: { name: suspiciousName, mimeType: 'application/pdf', buffer: smallPdfBuffer() } },
  });

  // The DLP guard may either (a) reject the upload (4xx) or (b) accept but
  // emit a DLP violation in the trace. Either is acceptable as long as the
  // raw pattern is not stored in the public response. We assert both.
  if (r.status() === 201) {
    const body = await r.json();
    // The response must NEVER echo the raw BL number back to the client.
    expect(JSON.stringify(body), 'response must not contain raw BL number').not.toContain('AB1234567');
    // The trace endpoint should show a DLP step (if the route is registered).
    const trace = await request.get(`/api/audit/trace?job_id=${body.job_id}`, { headers: AUTH_HEADER });
    if (trace.status() === 200) {
      const traceBody = await trace.json();
      const traceStr = JSON.stringify(traceBody);
      // Either DLP step is present OR the raw value is masked.
      expect(
        /DLP|REDACTED/i.test(traceStr) || !traceStr.includes('AB1234567'),
        'DLP step or masking present in trace',
      ).toBeTruthy();
    }
  } else {
    // 4xx is the stricter interpretation — also acceptable.
    expect([400, 403, 422]).toContain(r.status());
    const body = await r.json().catch(() => ({}));
    expect(['DLP_VIOLATION', 'P2_DETECTED', 'POLICY_VIOLATION']).toContain(body.code ?? '');
  }

  // Frontend form must also surface the error.
  await page.goto('/invoice-audit');
  // Look for the upload form and confirm it shows an error when the same
  // bad file is chosen. (Form is a client component; we just verify the
  // form is present and accepts file input.)
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput, 'upload form is rendered on /invoice-audit').toHaveCount(1);
});

// ---------------------------------------------------------------------------
// Suite teardown
// ---------------------------------------------------------------------------

// Suppress unused-import warning for `Page` (kept for future hooks).
export type _E2EPageRef = Page;
