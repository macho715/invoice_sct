#!/usr/bin/env node
/**
 * e2e_preview.mjs — 1 invoice E2E (upload → parse → SCT validate → approval → xlsx export)
 * 5 success criteria 검증 후 JSON 보고 출력
 */
import { readFileSync, createHash } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=');
    return [k.replace(/^--/, ''), v];
  })
);

const WORKER = args.worker || process.env.WORKER_PREVIEW_URL;
const VERCEL = args.vercel || process.env.VERCEL_PREVIEW_URL;
const SAMPLE_INVOICE = resolve(__dirname, '..', 'apps', 'worker-py', 'tests', 'fixtures', 'sample-invoice.xlsx');
const USER_ID = 'e2e-preview-bot';
const USER_ROLE = 'FINANCE_APPROVER';

if (!WORKER || !VERCEL) {
  console.error(JSON.stringify({ error: 'WORKER or VERCEL missing', args }, null, 2));
  process.exit(1);
}

const results = { worker: WORKER, vercel: VERCEL, criteria: [] };
let jobId;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    results.criteria.push({ name, status: 'PASS', latency_ms: Date.now() - t0, ...out });
    return out;
  } catch (e) {
    results.criteria.push({ name, status: 'FAIL', latency_ms: Date.now() - t0, error: e.message });
    throw e;
  }
}

async function main() {
  // Criterion 1: Upload
  const uploadRes = await fetch(`${VERCEL}/api/files/ingest`, {
    method: 'POST',
    headers: { 'x-user-id': USER_ID, 'x-user-role': USER_ROLE, 'content-type': 'application/octet-stream' },
    body: readFileSync(SAMPLE_INVOICE),
  });
  await step('upload', async () => {
    if (uploadRes.status !== 200) throw new Error(`status ${uploadRes.status}`);
    const body = await uploadRes.json();
    jobId = body.job_id;
    if (!jobId) throw new Error('job_id missing');
    return { job_id: jobId };
  });

  // Criterion 2: Parse (run)
  await step('parse', async () => {
    const r = await fetch(`${VERCEL}/api/invoice-audit/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    if (r.status !== 202 && r.status !== 200) throw new Error(`status ${r.status}`);
    return { run_status: r.status };
  });

  // Poll status
  let status, body;
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${VERCEL}/api/audit/status?job_id=${jobId}`);
    body = await r.json();
    status = body.status;
    if (status === 'REVIEW_REQUIRED' || status === 'APPROVED' || status === 'EXPORTED') break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  if (!status) throw new Error('timeout waiting for status');

  // Criterion 3: SCT validate result
  await step('sct_validate', async () => {
    const r = await fetch(`${VERCEL}/api/audit/result?job_id=${jobId}`);
    const result = await r.json();
    if (!['PASS', 'AMBER', 'ZERO'].includes(result.verdict)) throw new Error(`unexpected verdict ${result.verdict}`);
    return { verdict: result.verdict, action_items: result.action_items?.length ?? 0 };
  });

  // Criterion 4: Approval + export
  await step('approval_export', async () => {
    if (body.verdict === 'AMBER') {
      const approveRes = await fetch(`${VERCEL}/api/audit/approve`, {
        method: 'POST',
        headers: { 'x-user-id': USER_ID, 'x-user-role': USER_ROLE, 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, decision: 'APPROVE' }),
      });
      if (approveRes.status !== 200) throw new Error(`approve status ${approveRes.status}`);
    }
    const exportRes = await fetch(`${VERCEL}/api/audit/export`, {
      method: 'POST',
      headers: { 'x-user-id': USER_ID, 'x-user-role': USER_ROLE, 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    if (exportRes.status !== 200) throw new Error(`export status ${exportRes.status}`);
    return { approve_status: 'OK', export_status: exportRes.status };
  });

  // Criterion 5: xlsx hash
  await step('xlsx_hash', async () => {
    const r = await fetch(`${VERCEL}/api/export/download?job_id=${jobId}`);
    if (r.status !== 200) throw new Error(`download status ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const sha256 = createHash('sha256').update(buf).digest('hex');
    return { sha256, size: buf.length };
  });

  results.status = 'SUCCESS';
}

try {
  await main();
} catch (e) {
  results.status = 'FAIL';
  results.error = e.message;
} finally {
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.status === 'SUCCESS' ? 0 : 1);
}
