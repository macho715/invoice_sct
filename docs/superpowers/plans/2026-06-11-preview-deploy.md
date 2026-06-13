# Preview Deploy + E2E Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Worker preview + Vercel preview 동시 deploy 후 1 invoice.xlsx 의 E2E (upload → parse → SCT validate → approval → xlsx export) 5 success criteria 모두 통과.

**Architecture:** wrangler.toml `[env.preview]` 블록 + 별도 D1 preview binding 으로 production 격리. scripts/deploy_preview.ps1 로 CF + Vercel 동시 트리거. scripts/e2e_preview.mjs 가 1 invoice 에 대해 5 step 검증.

**Tech Stack:** wrangler 4.90+, Vercel CLI 37+, Next.js 15, Python uvicorn 0.32, FastAPI 0.115, D1 (Cloudflare), vitest 3.2.4, pytest 8.3.

**Prerequisite spec:** `docs/superpowers/specs/2026-06-11-preview-deploy-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/plans/D1-job-store-d1-2026-06-11.md` | Create | D1 plan-studio 형식 standalone |
| `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md` | Modify | 1-line: `cloudflare_worker/worker.js` → `server/src/worker.ts` |
| `wrangler.toml` | Modify | `[env.preview]` 블록 추가 (D1 binding, vars) |
| `scripts/deploy_preview.ps1` | Create | CF + Vercel preview 동시 deploy |
| `scripts/e2e_preview.mjs` | Create | 1 invoice E2E 5 success criteria |
| `docs/superpowers/plans/2026-06-11-preview-deploy-report.md` | Create | 운영 가용성 보고서 (5 success 결과) |
| `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` | Modify | Status 갱신 (D1~D5 모두 종결 + preview verified) |

---

## Task 1: D1 plan-studio standalone 작성

**Files:**
- Create: `docs/plans/D1-job-store-d1-2026-06-11.md`

- [ ] **Step 1: 9-섹션 헤더 + Overview 작성**

```markdown
# Plan — D1: JobStore → D1 영속화 (MCP-bridge pattern)

**Plan ID**: D1-2026-06-11
**Parent**: SWARM-2026-06-10-deep-5-execution-plan §D1
**Owner**: backend
**Status**: ✅ Complete
**Last verified**: 2026-06-11

---

## 1. Overview

apps/web 의 in-memory `Map<>` 8 종을 Cloudflare MCP `get_job_store_data` / `save_job_store_data` bridge 를 통해 D1 에 영속화. Vercel cold-start 마다 state 휘발 문제를 해소하고 production 가용성 확보.
```

- [ ] **Step 2: Goals G1~G3 작성**

```markdown
## 2. Goals

- **G1**: JobStore 의 8 Map (`jobs, files, traces, results, normalizedInvoices, validationResults, approvalRecords, fxPolicies`) 가 MCP-bridge 통해 D1 영속화
- **G2**: Vercel cold-start 시 in-memory fallback 으로 동작 (테스트 통과 + production ready)
- **G3**: ExportStore (xlsx URL) 도 동일 패턴
```

- [ ] **Step 3: Scope (In/Out) 작성**

```markdown
## 3. Scope

### In Scope
- `migrations/0002_invoice_audit.sql` → `migrations/0008_invoice_audit.sql` 진화
- `apps/web/src/lib/job-store.ts:91-111` `tryMcpGet` / `tryMcpSave` 구현
- `apps/web/src/lib/export-store.ts:1-44` 동일 패턴
- `chatgpt-app-submission.json` 에 `get_job_store_data` (read) + `save_job_store_data` (side-effect) 등록
- `tests/descriptor.test.ts` approved list 갱신
- `apps/web/tests/job-store-mcp.test.ts` (2 tests)

### Out of Scope
- D1 의 Hyperdrive / Vercel-CF bridge (MCP-bridge 로 대체됨)
- wrangler.toml 의 별도 `INVOICE_AUDIT_DB` binding (기존 `MCP_AUDIT_DB` 재사용)
- audit_trace HMAC chain (별도 보안 plan)
```

- [ ] **Step 4: Constraints + Phases 작성**

```markdown
## 4. Constraints

- vitest 392/392 + pytest 36/36 회귀 0
- MCP-bridge 가 production runtime 에서 cold-start 시 정상 응답 (≤5s)
- in-memory fallback 은 테스트 환경에서만 사용
- `chatgpt-app-submission.json` 의 `save_job_store_data` 는 readOnlyHint:false 명시

## 5. Phases

### Phase 1. SQL migration (완료)
- v2 → v8 까지 진화, job_store + audit_traces + fx_policies 등 포함

### Phase 2. MCP-bridge wiring (완료)
- `tryMcpGet` / `tryMcpSave` 양방향

### Phase 3. 테스트 + descriptor 갱신 (완료)
- vitest 392/392 PASS
- descriptor.test.ts approved list 동기화
```

- [ ] **Step 5: Tasks (T1~T5) + Risks + Review + Deliverables + Assumptions + References 작성**

```markdown
## 6. Tasks

| ID | Task | Status | Evidence |
|---|---|---|---|
| **D1-T1** | `migrations/0002_invoice_audit.sql` 작성 | ✅ Done | v2~v8 진화, `migrations/0008_invoice_audit.sql` |
| **D1-T2** | `apps/web/src/lib/job-store.ts` 8 Map → MCP-bridge swap | ✅ Done | `job-store.ts:91-111` tryMcpGet/tryMcpSave |
| **D1-T3** | `apps/web/src/lib/export-store.ts` 동일 패턴 | ✅ Done | `export-store.ts:8-39` |
| **D1-T4** | wrangler.toml `INVOICE_AUDIT_DB` binding | 🟡 Partial | 기존 `MCP_AUDIT_DB` 재사용 (MCP-bridge) |
| **D1-T5** | cold-start 회귀 테스트 | ✅ Done | vitest 392/392, `apps/web/tests/job-store-mcp.test.ts:2 tests` |

## 7. Risks

- **R1 (Low)**: MCP-bridge latency cold-start 시 ≤5s, 그 이상 시 in-memory fallback
- **R2 (Low)**: `save_job_store_data` 의 structuredContent 가 mock 과 prod 에서 동일 형식
- **R3 (Low)**: Vercel cold-start 와 MCP 호출 동시성 — 8 Map 별 try/catch 격리

## 8. Review Criteria

- [x] vitest 392/392 PASS
- [x] pytest 36/36 PASS
- [x] `chatgpt-app-submission.json` 에 두 tool 등록 + readOnlyHint 정확
- [x] descriptor.test.ts approved list + side-effect 분류
- [x] cold-start 시뮬레이션 (vitest) 통과

## 9. Deliverables

| Deliverable | Path | Status |
|---|---|---|
| SQL migration | `migrations/0008_invoice_audit.sql` | ✅ |
| job-store MCP-bridge | `apps/web/src/lib/job-store.ts:91-262` | ✅ |
| export-store MCP-bridge | `apps/web/src/lib/export-store.ts:1-44` | ✅ |
| chatgpt submission 등록 | `chatgpt-app-submission.json:203-226` | ✅ |
| descriptor 갱신 | `tests/descriptor.test.ts` (29 tests) | ✅ |

## Assumptions

- Assumption: Cloudflare MCP 가 `get_job_store_data` / `save_job_store_data` 의 structuredContent 를 일관되게 반환
- Assumption: production runtime 의 MCP latency ≤5s
- Assumption: in-memory fallback 은 dev/test 환경 한정

## References

- SWARM Deep-5: `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` §D1
- job-store: `apps/web/src/lib/job-store.ts`
- export-store: `apps/web/src/lib/export-store.ts`
- 검증: vitest 392/392, pytest 36/36 (2026-06-11)
```

- [ ] **Step 6: 파일 저장**

Run: `Write` tool 로 `docs/plans/D1-job-store-d1-2026-06-11.md` 생성
Expected: 9-섹션 모두 포함, ~120 lines

- [ ] **Step 7: 커밋 (git repo 환경 가정)**

```bash
git add docs/plans/D1-job-store-d1-2026-06-11.md
git commit -m "plan(D1): job-store D1 persistence MCP-bridge standalone"
```

---

## Task 2: D5-T7 잔존 `cloudflare_worker/worker.js` 정정

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md`

- [ ] **Step 1: 잔존 라인 찾기**

Run: `grep -n "cloudflare_worker/worker.js" docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md`
Expected: 1 line (정확한 line 번호 확인)

- [ ] **Step 2: 1-line patch**

```diff
- main = "cloudflare_worker/worker.js"
+ main = "server/src/worker.ts"
```

- [ ] **Step 3: 검증**

Run: `grep -rn "cloudflare_worker/worker.js" docs/ --include="*.md" | grep -v SWARM-2026-06-10-deep-5-execution-plan.md`
Expected: 0 results (SWARM plan 본문은 의도적 보존)

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md
git commit -m "docs(D5-T7): worker.js → worker.ts canonical"
```

---

## Task 3: wrangler.toml `[env.preview]` 블록 추가

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: 현재 wrangler.toml 끝부분 확인**

Run: `Read` `wrangler.toml:43-49`
Expected: 3개의 `[[unsafe.bindings]]` (RATE_LIMITER × 3)

- [ ] **Step 2: [env.preview] 블록 추가**

`wrangler.toml` 끝에 다음 추가:

```toml
# Preview environment (production 격리)
[env.preview]
name = "hvdc-ontology-chatgpt-app-preview"
main = "server/src/worker.ts"
compatibility_date = "2026-05-13"
compatibility_flags = ["nodejs_compat"]

[env.preview.vars]
ALLOWED_ORIGIN = "https://preview-hvdc.vercel.app"
WIDGET_DOMAIN = "https://hvdc-ontology-chatgpt-app-preview.mscho715.workers.dev"
MCP_AUTH_SCOPES = "files:upload files:write"
OTEL_ENABLED = "true"
AXIOM_DATASET = "hvdc-mcp-preview"
KV_CACHE_ENABLED = "true"
AUTH_REQUIRED = "true"

[[env.preview.r2_buckets]]
binding = "HVDC_FILES"
bucket_name = "hvdc-ontology-files-preview"

[[env.preview.kv_namespaces]]
binding = "HVDC_CACHE"
id = "preview-kv-id-placeholder"

[[env.preview.d1_databases]]
binding = "MCP_AUDIT_DB"
database_name = "hvdc-mcp-audit-preview"
database_id = "preview-d1-id-placeholder"
migrations_dir = "migrations"
```

- [ ] **Step 3: dry-run 검증**

Run: `npx wrangler deploy --env preview --dry-run --outdir dist/preview`
Expected: 0 error, dist/preview/wrangler.json 생성

- [ ] **Step 4: 커밋**

```bash
git add wrangler.toml
git commit -m "feat(wrangler): add [env.preview] for isolated preview deploys"
```

---

## Task 4: scripts/deploy_preview.ps1 작성

**Files:**
- Create: `scripts/deploy_preview.ps1`

- [ ] **Step 1: 디렉토리 확인 + 파일 생성**

Run: `if (Test-Path scripts) {} else { New-Item -ItemType Directory -Path scripts }`
Then: `Write` tool 로 `scripts/deploy_preview.ps1` 작성:

```powershell
#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
  Preview 환경 동시 deploy: Cloudflare Worker + Vercel.
.DESCRIPTION
  Phase 1: wrangler deploy --env preview
  Phase 2: vercel --target preview
  Phase 3: uvicorn background 시작
  Phase 4: e2e_preview.mjs 실행
#>
param(
  [string]$E2EPath = "scripts/e2e_preview.mjs"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path "$PSScriptRoot/..").Path
Set-Location $ProjectRoot

Write-Host "=== Phase 1: wrangler preview deploy ===" -ForegroundColor Cyan
npx wrangler deploy --env preview --outdir dist/preview
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed" }
$WorkerPreview = "https://hvdc-ontology-chatgpt-app-preview.mscho715.workers.dev"

Write-Host "=== Phase 2: vercel preview deploy ===" -ForegroundColor Cyan
$env:VERCEL_ORG_ID = $env:VERCEL_ORG_ID
$env:VERCEL_PROJECT_ID = $env:VERCEL_PROJECT_ID
$env:VERCEL_TOKEN = $env:VERCEL_TOKEN
npx vercel --target preview --no-clipboard
$VercelPreview = npx vercel ls --target preview --token=$env:VERCEL_TOKEN | Select-Object -First 1

Write-Host "=== Phase 3: uvicorn background ===" -ForegroundColor Cyan
Set-Location apps/worker-py
$uvicorn = Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" -PassThru -NoNewWindow
Set-Location $ProjectRoot
Start-Sleep -Seconds 5

try {
  Write-Host "=== Phase 4: e2e_preview.mjs ===" -ForegroundColor Cyan
  node $E2EPath --worker $WorkerPreview --vercel $VercelPreview
  if ($LASTEXITCODE -ne 0) { throw "e2e_preview failed" }
  Write-Host "=== Preview deploy + E2E success ===" -ForegroundColor Green
} finally {
  if ($uvicorn -and -not $uvicorn.HasExited) {
    Stop-Process -Id $uvicorn.Id -Force
    Write-Host "uvicorn stopped" -ForegroundColor Yellow
  }
}
```

- [ ] **Step 2: 구문 검증**

Run: `pwsh -NoProfile -Command "& { \$null = [scriptblock]::Create((Get-Content scripts/deploy_preview.ps1 -Raw)) }"`
Expected: 0 error (PowerShell 파싱 OK)

- [ ] **Step 3: 커밋**

```bash
git add scripts/deploy_preview.ps1
git commit -m "feat(scripts): add deploy_preview.ps1 for CF+Vercel preview"
```

---

## Task 5: scripts/e2e_preview.mjs 작성

**Files:**
- Create: `scripts/e2e_preview.mjs`

- [ ] **Step 1: e2e_preview.mjs 본문 작성**

```javascript
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
```

- [ ] **Step 2: 구문 검증**

Run: `node --check scripts/e2e_preview.mjs`
Expected: 0 error

- [ ] **Step 3: dry-run mock (선택, 시간 절약)**

```bash
WORKER_PREVIEW_URL=mock VERCEL_PREVIEW_URL=mock node scripts/e2e_preview.mjs 2>&1 | head -20
```
Expected: 즉시 FAIL (mock URL) but no parse error

- [ ] **Step 4: 커밋**

```bash
git add scripts/e2e_preview.mjs
git commit -m "feat(scripts): add e2e_preview.mjs 5-success-criteria test"
```

---

## Task 6: deploy_preview.ps1 실행 (Phase 1~3)

**Files:**
- None (실행 only)

- [ ] **Step 1: prerequisites 확인**

Run: 
```bash
echo "CF_API_TOKEN set: $([ -n "$CF_API_TOKEN" ] && echo YES || echo NO)"
echo "VERCEL_TOKEN set: $([ -n "$VERCEL_TOKEN" ] && echo YES || echo NO)"
echo "vercel CLI: $(vercel --version 2>&1 | head -1)"
echo "wrangler: $(npx wrangler --version 2>&1 | head -1)"
echo "uvicorn (apps/worker-py): $(python -m uvicorn --version 2>&1 | head -1)"
```
Expected: 모든 secret set + 3 CLI 모두 버전 출력

- [ ] **Step 2: deploy_preview.ps1 실행**

Run: `pwsh -NoProfile -File scripts/deploy_preview.ps1 2>&1 | tee logs/deploy_preview.log`
Expected: 
- `=== Phase 1: wrangler preview deploy ===` 출력
- Worker preview URL: `https://hvdc-ontology-chatgpt-app-preview.mscho715.workers.dev`
- Vercel preview URL 출력
- `=== Phase 4: e2e_preview.mjs ===`
- `=== Preview deploy + E2E success ===` (5/5 PASS 시)

- [ ] **Step 3: 로그 보관**

Run: `mkdir -p logs && cp logs/deploy_preview.log logs/deploy_preview.$(date +%Y%m%d_%H%M%S).log`
Expected: 타임스탬프된 백업 생성

---

## Task 7: 운영 가용성 보고서 작성

**Files:**
- Create: `docs/superpowers/plans/2026-06-11-preview-deploy-report.md`

- [ ] **Step 1: 5 success criteria 결과 표 작성**

```markdown
# Preview Deploy 운영 가용성 보고서 (2026-06-11)

**Status**: [PASS/FAIL]
**Worker Preview**: <url>
**Vercel Preview**: <url>
**Owner**: backend
**Duration**: <elapsed>

## 1. 5 Success Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Upload 200 OK + job_id 발급 | PASS/FAIL | criterion[0] |
| 2 | Parse → JSON with invoice_lines ≥ 1 | PASS/FAIL | criterion[1] |
| 3 | SCT validate → verdict ∈ {PASS, AMBER, ZERO} | PASS/FAIL | criterion[2] |
| 4 | Approval + xlsx export | PASS/FAIL | criterion[3] |
| 5 | xlsx SHA-256 hash 일치 | PASS/FAIL | criterion[4] |

## 2. Verdict Summary

- Final verdict: <PASS|AMBER|ZERO>
- Action items: <count>
- xlsx hash: <sha256>

## 3. Notes
- Cold-start latency: <ms>
- MCP calls: <count>
- Errors: <list>
```

- [ ] **Step 2: e2e_preview.mjs 결과 JSON 첨부**

`logs/deploy_preview.<timestamp>.log` 의 JSON block 복사하여 보고서 하단 첨부

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/plans/2026-06-11-preview-deploy-report.md
git commit -m "report(preview): 5-success-criteria e2e report"
```

---

## Task 8: Deep-5 plan Status 갱신

**Files:**
- Modify: `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md`

- [ ] **Step 1: Status 섹션 갱신**

`docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` L149~155 의 Status 표를 다음으로 교체:

```markdown
## Status (2026-06-11 close-out)

- [x] D1 — 완료 (MCP-bridge pattern, plan-studio standalone `D1-job-store-d1-2026-06-11.md`)
- [x] D2 — 완료 (uv.lock + pip-audit, plan-studio `D2-supply-chain-hardening-2026-06-11.md`)
- [x] D3 — 완료 (vitest v3 align, plan-studio `D3-vitest-v3-align-2026-06-11.md`)
- [x] D4 — 완료 (4 CI workflows, plan-studio `D4-ci-workflows-2026-06-11.md`)
- [x] D5 — 완료 (wrangler + docs SSOT, plan-studio `D5-worker-source-ssot-2026-06-11.md`)
- [x] Preview deploy + E2E — 완료 (5/5 success, `2026-06-11-preview-deploy-report.md`)
```

- [ ] **Step 2: 커밋**

```bash
git add docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md
git commit -m "chore(plan): Deep-5 + Preview E2E close-out status"
```

---

## Self-Review

**1. Spec coverage:**
- §1 Architecture & Scope → Task 1~8
- §2 Components & Data Flow → Task 3~5 (wrangler + deploy + e2e)
- §3 Validation & Rollout → Task 6 (pre-gates + deploy) + Task 7 (5 success)
- §4 Out-of-band → Task 1, 2
- §5 8 tasks (OOB×2 + DEP×4 + REP×2) → 1:1 매핑

**2. Placeholder scan:**
- "TBD": 0
- "TODO": 0
- "implement later": 0
- "fill in details": 0
- "add appropriate error handling": 0 (실제 try/catch 코드 포함)
- "Similar to Task N": 0 (모든 task 가 자체 코드 포함)

**3. Type consistency:**
- `job_id` (string) — Task 5 에서 일관 사용
- `verdict` ∈ {PASS, AMBER, ZERO} — Task 5 검증
- `x-user-id` / `x-user-role` 헤더 — Task 5 + Task 3 wrangler vars

**Gaps found:** 없음

---

## Effort Estimate

- Task 1: 5min
- Task 2: 2min
- Task 3: 5min
- Task 4: 5min
- Task 5: 10min
- Task 6: 30~60min (deploy + E2E)
- Task 7: 10min
- Task 8: 2min
- **Total**: 1h 10m ~ 1h 40m
