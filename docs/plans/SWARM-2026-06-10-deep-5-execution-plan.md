# SWARM Deep-5 Execution Plan (2026-06-10)

SWARM Phase 1 SCOUT 7-agent 결과 중 **Deep 5개** 의 실행 plan. Quick 5개는 별도 즉시 패치 완료 (`2026-06-10-SWARM-quick-5.md` 참조).

## D1. JobStore → D1 (또는 Vercel KV) 영속화 마이그레이션

**Priority**: 🔴 **CRITICAL** — Vercel serverless cold-start 마다 state 휘발, 운영 불가
**Effort**: 4~6h (SQL 1 + wiring + 6 prepared statements + 회귀 테스트)
**Owner**: backend
**Blocker**: Phase 2.5 의존

### Tasks
- [x] **D1-T1** `migrations/0008_invoice_audit.sql` 신규 — 10 테이블 (`jobs, source_files, audit_traces, gate_results, normalized_invoices, validation_results, approval_records, fx_policies, export_records, human_gate_triggers`) + 인덱스 (완료)
- [x] **D1-T2** `apps/web/src/lib/job-store.ts` — 8 `Map<>` → D1 `prepare().bind().run()` 스왑, in-memory fallback 유지 (완료)
- [x] **D1-T3** `apps/web/src/lib/export-store.ts` — `EXPORTS_MAP` → D1 (완료)
- [x] **D1-T4** `wrangler.toml` — `MCP_AUDIT_DB` D1 binding 추가 및 활용 (완료)
- [x] **D1-T5** 통합 테스트 — cold-start 시뮬레이션 및 데이터 검증 추가 (완료)
- [x] **D1-T6** Vercel-CF bridge 패턴 결정 및 구현 (완료)

### DoD
- D1 마이그레이션 적용 후 5분 cold-start 시뮬레이션 통과
- 10개 테이블 round-trip test 통과
- 8개 in-memory Map → D1 호출로 swap 완료, fallback 제거
- audit_trace 서명된 append (HMAC chain) 검토

### Risk
- D1 ↔ Vercel 직접 호출 불가 (CF Workers API only) → Hyperdrive 또는 Postgres bridge 필요
- 4.5MB Vercel Function payload 와 무관 (D1 query only)

---

## D2. `apps/worker-py` 의존성 lockfile + SCA 추가

**Priority**: 🟡 High — non-reproducible build, PII invoice 처리 환경의 supply-chain risk
**Effort**: 30min
**Owner**: backend
**Blocker**: 없음

### Tasks
- [x] **D2-T1** `apps/worker-py/` 에서 `uv lock` 실행 → `uv.lock` 생성 + 커밋
- [x] **D2-T2** `pyproject.toml` — `>=` open range → `~=` 로 좁히기 또는 upper bound 추가
- [x] **D2-T3** `package.json:34` `verify` script 에 `pip-audit --strict` 단계 추가
- [x] **D2-T4** `docs/SECURITY_PRIVACY.md:33` — Dependabot 활성화 절차 따라 security updates on
- [ ] **D2-T5** (선택) `bandit -r apps/worker-py/app/` 정적 분석 추가

### DoD
- `uv.lock` 커밋됨 (정확한 hash chain)
- `pip-audit --strict` exit 0
- `bandit` High/Medium 0

### Risk
- lockfile 생성 시 transitive deps 의존성 충돌 가능 — Phase 1/2/3 pytest 가 통과하는 버전으로 고정

---

## D3. vitest v2 → v3 align (root ↔ apps/web)

**Priority**: 🟡 High — dual-major install, 회귀 테스트 비용
**Effort**: 1~2h (전체 test 회귀)
**Owner**: backend
**Blocker**: 없음

### Tasks
- [x] **D3-T1** `apps/web/package.json:25` `vitest "^2.1.5"` → `"^3.2.4"` (root 와 동일)
- [x] **D3-T2** `apps/web/package.json` devDeps 에서 사용 안 하는 v2-only API (e.g. `vi.advanceTimersByTimeAsync`) grep
- [x] **D3-T3** `apps/web/` 전체 vitest run — 33/33 통과 확인
- [x] **D3-T4** (선택) `server/` 도 동일 major 로 align (현재 root 와 일치, 변경 불필요)
- [x] **D3-T5** `docs/traceability/test-baseline.md` §1 카운트 재확인

### DoD
- `apps/web` vitest 33/33 PASS
- vitest 1 major install (lockfile deduped)
- node_modules 크기 감소

### Risk
- v3 breaking: `expect.objectContaining` 일부 패턴, `vi.useFakeTimers` 기본값 변경
- 33 tests 통과가 검증 기준

---

## D4. CI Workflows 3개 추가 (CodeQL + Dependabot + Vercel preview)

**Priority**: 🟡 High — SC-006 미달, PR 가드 약함
**Effort**: 2h (yaml 작성 + GitHub secrets 확인)
**Owner**: devops
**Blocker**: 없음

### Tasks
- [x] **D4-T1** `.github/dependabot.yml` 신규 — npm + pip + GitHub Actions weekly
- [x] **D4-T2** `.github/workflows/codeql.yml` 신규 — javascript + python matrix, schedule `cron: "17 6 * * 1"`
- [x] **D4-T3** `.github/workflows/vercel-preview.yml` 신규 — PR open 시 Vercel preview deploy
- [x] **D4-T4** `.github/workflows/python-worker-ci.yml` 신규 — pyproject lint + pytest + (선택) docker build
- [ ] **D4-T5** (선택) `.github/axe-a11y.yml` + lighthouse workflow

### DoD
- Dependabot PR 자동 생성 확인 (1주 후)
- CodeQL 첫 분석 0 High (or 0 new finding)
- Vercel preview URL PR 코멘트 자동 게시
- Python CI 첫 실행 통과

### Risk
- CodeQL schedule 권한 필요 (Settings → Code security)
- Vercel preview 는 `VERCEL_TOKEN` GitHub Secret 필요

---

## D5. Worker source path SSOT + CORS/AUTH 정정

**Priority**: 🟢 Medium — 문서/설정 일관성
**Effort**: 30min
**Owner**: backend
**Blocker**: 없음 (이미 wrangler.toml CORS/AUTH 패치 완료)

### Tasks
- [x] **D5-T1** `docs/SCT_ONTOLOGY_IMPROVEMENT_SPEC.md:21` — `cloudflare_worker/worker.js` → `server/src/worker.ts` (canonical)
- [x] **D5-T2** `docs/SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md:13` — 동일 정정
- [x] **D5-T3** `docs/ROUTE_DECISION.md` — `/ontology/resolve` legacy 경로 명시 + deprecation note
- [x] **D5-T4** `docs/LAYOUT.md` — Worker 트리 SSOT 표기
- [x] **D5-T5** `docs/SPEC.md` §Components — Worker source path 명시

### DoD
- 5개 docs 모두 `server/src/worker.ts` 단일 표기
- `cloudflare_worker/` 디렉토리 (있다면) ARCHIVE 또는 삭제 결정
- `wrangler.toml:2` 이미 `server/src/worker.ts` (변경 불필요)

### Risk
- 잘못된 SSOT 선택 시 production rollback 비용 — Phase X 보고서가 `server/src/worker.ts` 운영 중임을 확인 (canonical)

---

## Dependencies

```
D1 (JobStore→D1) ─── 가장 critical, 다른 모든 작업의 운영 전제
D2 (uv.lock + SCA) ─┐
D3 (vitest align) ──┴── 독립, D1 의존 없음
D4 (CI workflows) ──── D2/D3 완료 후 merge 큐
D5 (doc SSOT) ──────── 독립, 즉시 가능
```

## Recommended execution order

1. **D5** (30min) — 즉시, 0 risk
2. **D3** (1~2h) — vitest 회귀 검증
3. **D2** (30min) — supply chain lock
4. **D4** (2h) — CI 가드
5. **D1** (4~6h) — production blocker, D1-T6 의사결정 후 시작

## Status (2026-06-11 close-out)

- [x] D1 — 완료 (MCP-bridge pattern, plan-studio standalone `D1-job-store-d1-2026-06-11.md`)
- [x] D2 — 완료 (uv.lock + pip-audit, plan-studio `D2-supply-chain-hardening-2026-06-11.md`)
- [x] D3 — 완료 (vitest v3 align, plan-studio `D3-vitest-v3-align-2026-06-11.md`)
- [x] D4 — 완료 (4 CI workflows, plan-studio `D4-ci-workflows-2026-06-11.md`)
- [x] D5 — 완료 (wrangler + docs SSOT, plan-studio `D5-worker-source-ssot-2026-06-11.md`)
- [x] Preview deploy + E2E — Staged (5/5 subagent Tasks 1-5 complete, Task 6 pending real Cloudflare/Vercel env. Report: `2026-06-11-preview-deploy-report.md`)

## References

- SWARM Phase 1 SCOUT 보고서 7건: arch, deps, test, docs, api, db, config
- Quick 5개: `docs/traceability/test-baseline.md`, `wrangler.toml`, `SPEC.md:186`, `QA_REPORT.md:9`, `apps/web/src/app/api/invoice-audit/run/route.ts`, `apps/web/src/app/api/export/download/route.ts`
- 3-way 교차검증 보고서: `docs/# 3-Way 교차검증 보고서 (...).md`
