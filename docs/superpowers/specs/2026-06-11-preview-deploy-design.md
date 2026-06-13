# Design — Preview Deploy + E2E Validation (2026-06-11)

**Status**: Design approved (4/4 sections) — ready for implementation via writing-plans
**Parent**: Deep-5 close-out + Release-Ready verification
**Owner**: backend
**Target**: 1.5~2h

---

## 1. Overview

SCT_ONTOLOGY Invoice Audit Platform 의 production 가용성 확보를 위해 Cloudflare Worker preview + Vercel preview 동시 deploy 후, 실 invoice 1건의 end-to-end (upload → parse → SCT validate → approval → xlsx export) 를 검증한다. Deep-5 (D1~D5) plan 의 모든 산출물을 preview 환경에서 실측으로 close-out 한다.

## 2. Goals

- **G1**: Cloudflare Worker preview 환경에 16 MCP tools + D1 bridge 가동
- **G2**: Vercel preview 환경에 6 Next.js API routes 가동
- **G3**: Python worker (FastAPI) + D1 preview 의 end-to-end 1회 성공
- **G4**: 실 invoice 1건의 5 success criteria 모두 충족
- **G5**: Deep-5 plan 모든 산출물의 운영 검증 close-out 보고서

## 3. Scope

### In Scope
- Cloudflare Worker preview deploy (`wrangler deploy --env preview`)
- Vercel preview deploy (수동 트리거, PR 없이)
- Python Worker local (`uvicorn` background)
- 실 invoice.xlsx 1건 E2E
- 잔여 D1 plan-studio 작성 + D5-T7 1-line 정정
- 운영 가용성 보고서 (`2026-06-11-preview-deploy-report.md`)

### Out of Scope
- Production deploy (`--env production`)
- OAuth provider 실 integration
- 4.5MB payload 한도 실측 (small invoice 만 검증)
- 새 feature 추가
- axe/lighthouse (D4-T5)
- bandit (D2-T5)
- cloudflare_worker/ 디렉토리 archive (D5-T8)

## 4. Constraints

- GitHub Secrets (CF_API_TOKEN, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, AXIOM_TOKEN) organization-level 사전 등록 필요
- `wrangler.toml` `[env.preview]` 블록 추가 시 기존 `[vars]` 와 충돌 없도록
- preview 환경 D1 binding 은 격리 (production D1 영향 0)
- 1.5~2h 시간 예산 (단일 owner = backend)

## 5. Phases

### Phase 1. Pre-deploy gates (5min)
- `npm run verify` → 392/392 + 36/36 PASS
- `wrangler deploy --env preview --dry-run` → 0 error
- `vercel build` → 0 type error

### Phase 2. Out-of-band immediate (10min)
- **OOB-T1**: D1 plan-studio standalone 작성
- **OOB-T2**: D5-T7 1-line 정정

### Phase 3. Deploy (30~60min)
- **DEP-T1**: `wrangler deploy --env preview` (5~10min)
- **DEP-T2**: `vercel --target preview` (3~5min)
- **DEP-T3**: `uvicorn` background (5s)
- **DEP-T4**: `e2e_preview.mjs` (1~2min)

### Phase 4. Reporting (15min)
- **REP-T1**: `2026-06-11-preview-deploy-report.md` 작성
- **REP-T2**: Deep-5 plan status 갱신

## 6. Tasks

| ID | Task | Phase | Owner | Est | Status |
|---|---|---|---|---|---|
| **OOB-T1** | D1 plan-studio 작성 | 2 | backend | 5min | ⏳ |
| **OOB-T2** | D5-T7 잔존 `cloudflare_worker/worker.js` 정정 | 2 | backend | 5min | ⏳ |
| **DEP-T1** | wrangler preview deploy | 3 | backend | 5~10min | ⏳ |
| **DEP-T2** | vercel preview deploy | 3 | backend | 3~5min | ⏳ |
| **DEP-T3** | uvicorn background | 3 | backend | 5s | ⏳ |
| **DEP-T4** | e2e_preview.mjs 실행 | 3 | backend | 1~2min | ⏳ |
| **REP-T1** | 운영 가용성 보고서 | 4 | backend | 10min | ⏳ |
| **REP-T2** | Deep-5 plan status 갱신 | 4 | backend | 5min | ⏳ |

## 7. Success Criteria (5)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Upload 200 OK + job_id 발급 | `e2e_preview.mjs` 로그 |
| 2 | Parse → JSON with invoice_lines ≥ 1 | response body |
| 3 | SCT validate → cf_mcp_tool_calls ≥ 1, verdict ∈ {PASS, AMBER, ZERO} | response body |
| 4 | Approval → AMBER 면 FINANCE_APPROVER 승인, xlsx export | xlsx SHA-256 |
| 5 | xlsx hash 가 baseline 과 일치 (regression) | `git diff` 또는 manual hash |

## 8. Risks

- **R1 (Medium)**: OAuth 미연동 → `X-User-Role` dev header 의존 (preview 만)
- **R2 (Medium)**: 4.5MB payload 한도 실측 부재 → small invoice 만 검증
- **R3 (Medium)**: Vercel preview Next.js cold start 5s+ 지연 → 첫 E2E timeout 가능, retry 1회
- **R4 (Low)**: GitHub Secrets 미등록 시 deploy fail → 사전 확인 필수
- **R5 (Low)**: D1 preview binding 누락 시 MCP-bridge fallback 만 동작 → in-memory 결과물

## 9. Rollback (preview only, instant)

- `wrangler rollback --env preview` (CF preview instant)
- `vercel rm <preview-url> --target preview --yes`
- D1 preview 격리 (production 영향 0)

## 10. References

- SWARM plan: `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md`
- Deep-5 close-out: `docs/plans/D2~D5-*-2026-06-11.md`
- Phase X 보고서: `docs/superpowers/plans/Phase X 운영 가동 검증 완료.MD`
- 3-way 교차검증: `docs/# 3-Way 교차검증 보고서 (...).md`

## Assumptions

- Assumption: GitHub Secrets (CF_API_TOKEN, VERCEL_TOKEN 등) 가 organization-level 에 등록되어 있다
- Assumption: D1 preview database 가 별도 생성 가능 (production database_id 와 다른 ID)
- Assumption: `e2e_preview.mjs` 가 sample invoice (e.g. `apps/worker-py/tests/fixtures/sample-invoice.xlsx`) 를 사용한다
- Assumption: workspace 가 git repo 가 아니므로 commit 단계는 skip (직접 write 만)
- Assumption: Vercel preview 의 cold start delay 는 1회 retry 로 흡수 가능
