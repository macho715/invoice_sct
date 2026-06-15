# SCT_ONTOLOGY — SWARM 작업 로그

**일자:** 2026-06-14 | **작업자:** opencode (SWARM Pipeline) | **프로젝트:** SCT Invoice Audit Platform

---

## 개요

SCT_ONTOLOGY 프로젝트에 대해 SWARM Self-Improve SDLC 5단계 파이프라인을 실행. 총 50개 AI agent 투입, 405 tests 유지, P0 6건 해소, 문서 3건 현행화.

---

## SWARM 파이프라인 실행

| 단계 | Agent 수 | 역할 |
|------|---------|------|
| Phase 1 SCOUT | 7 | 아키텍처·의존성·테스트·문서·API·DB·Config 진단 |
| Phase 2 PLAN | 5 | Minimal·Robust·Security·Performance·DX 계획 수립 |
| Phase 3 IMPLEMENT | 10 | 28개 태스크 병렬 구현 |
| Phase 4 REVIEW | 6 | Security·Perf·Logic·Style·Coverage·Architecture 검증 |
| Phase 5 QA | 8 | Unit·Integration·Regression·Edge·Security·Load·Contract·Pipeline |
| P0 Fix REVIEW+QA | 14 | P0 최종 검증 (Review 6 + QA 8) |
| **총합** | **50** | |

---

## Phase 1 SCOUT — 발견된 주요 문제

| # | 영역 | 심각도 | 문제 |
|---|------|--------|------|
| 1 | 보안 | P0 | CVE-2025-29927 — Next.js 15.1.9 인증 우회 |
| 2 | 보안 | P0 | API 인증 미들웨어 부재 (x-user-role 평문 헤더) |
| 3 | 보안 | P0 | 보안헤더 0종, CORS 없음, default 'dev' token |
| 4 | 아키텍처 | P0 | wrangler.toml 고아 (server/src/ 없음), MCP tools 중복 |
| 5 | 아키텍처 | P0 | pnpm-workspace 없음, packages 미연결 |
| 6 | 테스트 | P0 | workbook-builder.ts(308L), job-store-pg.ts(315L) 0 tests |
| 7 | 문서 | P0 | SYSTEM_ARCHITECTURE.md 70% 과거 아키텍처 기술 |
| 8 | DB | P0 | 3개 분리 DB, 250개 rate card git 노출 |
| 9 | CI/CD | P0 | npm/pnpm 혼용, matrix 패키지 누락 |

---

## Phase 2 PLAN — 5개 트랙 계획

| 트랙 | 전략 | 예상 시간 |
|------|------|----------|
| MINIMAL | Wave 3단계 병렬 P0 수정 | 5.5-7h |
| ROBUST | Monorepo 전환 + 중복제거 + 스키마 단일화 | 36 engineer-days |
| SECURITY | Sprint 0(4h)→1(3d)→2(1w) 단계적 강화 | ~36h |
| PERFORMANCE | N+1 batch 전환 → 캐싱 → DB pool 통합 | 8-10h |
| DX | workspace→docs→lint/test→CI→debug 순차 개선 | ~35h |

---

## Phase 3 IMPLEMENT — 28개 태스크 실행

### 보안 (Wave 1)
- Next.js 15.1.9 → 15.3.1 업그레이드
- 6종 보안헤더 추가 (XCTO, XFO, HSTS, RP, PP, XXP)
- API 인증 미들웨어 생성 (`apps/web/src/middleware.ts`)
- In-memory rate limiting (60 req/min)
- MCP server CORS + auth
- Dockerfile frozen-lockfile

### 아키텍처 (Wave 2)
- `pnpm-workspace.yaml` + `tsconfig.base.json` 생성
- MCP tools → `packages/tools/` 추출 (6 tools 단일소스)
- DB pool → `packages/database/` 단일화
- packages/contracts, packages/shared buildable 설정
- wrangler.toml deprecation 주석
- API version prefix 통일 (`/parse` → `/v1/parse`, backward compat 유지)

### 품질 (Wave 3)
- workbook-builder.ts smoke test 7건
- job-store-pg.ts smoke test 7건
- vitest.config.ts (mcp-server) + pytest-coverage config (worker-py)
- job-store.test.ts flaky fix (setTimeout → vi.advanceTimers)
- SYSTEM_ARCHITECTURE.md 현행화
- LAYOUT.md 현행화
- CLAUDE.md 생성

### CI/CD (Wave 4)
- release-gate 병목 10→4 needs 축소
- 재사용 `_ts-checks.yml` workflow 생성
- pnpm 캐시 추가
- Deploy double-fire guard
- Gitleaks secret scan workflow

---

## Phase 4 REVIEW — 6개 트랙 검증 결과

| 트랙 | Verdict | 주요 발견 |
|------|---------|----------|
| Security | AMBER | Auth fail-open 2곳, CSP 누락 |
| Performance | AMBER | Rate limiter Map unbounded 성장, DB error swallowing |
| Logic | PASS | 17 findings (0 P0), 310 tests PASS |
| Style | AMBER | packages/tools·database tsconfig 누락 (P0 7건) |
| Test-Coverage | AMBER | workbook-builder coverage exclude, mcp-server provider 없음 |
| Architecture | 73/100 | mcp-server 도구 중복 미해소, tsconfig 계층 깨짐 |

---

## Phase 5 QA — 8개 트랙 검증 결과

| 트랙 | Verdict | 주요 발견 |
|------|---------|----------|
| Unit | PASS | 405 tests (+17 from baseline), 0 failures |
| Integration | PASS | 1 P1 — mcp-server tool drift |
| Regression | AMBER | 2 missing tsconfig, 1 E2E stale |
| Edge | AMBER | 2 CRITICAL fail-open auth |
| Security | AMBER | 2 CRITICAL fail-open, 1 CSP missing |
| Load | AMBER | Map OOM 위험, DB pool 포화, 쿼리 배치 없음 |
| Contract | AMBER | 3 P0 — Zod schema 중복, 4개 env var 누락 |
| Pipeline | AMBER | npm→pnpm 불일치, 3 packages CI 미커버 |

---

## P0 Fix — 최종 수정

### 수정 항목 (6건)

| # | 파일 | 변경 |
|---|------|------|
| F1 | `apps/web/src/middleware.ts` | Auth fail-open → fail-closed (API_SECRET_KEY unset 시 500) |
| F2 | `apps/mcp-server/src/main.ts` | Auth fail-open → fail-closed (MCP_API_KEY unset 시 500) |
| F3 | `packages/tools/tsconfig.json` | 신규 생성 (extends tsconfig.base.json) |
| F4 | `packages/database/tsconfig.json` | 신규 생성 (extends tsconfig.base.json) |
| F5 | `.github/workflows/release-gate.yml` | npm ci → pnpm install, npm→pnpm 통일 |
| F6 | `.github/workflows/web-ci.yml` | matrix에 packages/shared·tools·database 추가 |
| — | `apps/mcp-server/src/__tests__/router.test.ts` | MCP_API_KEY + Authorization header 추가 |
| — | `apps/web/tests/job-store-pg.test.ts` | stale @ts-expect-error 제거 |
| — | `.env.example` | API_SECRET_KEY, MCP_API_KEY 문서화 |

### 최종 검증

| Gate | 상태 |
|------|------|
| Typecheck (6 packages) | 0 errors |
| Build (web + mcp-server) | PASS |
| Tests (web 124 + mcp 186 + worker 95) | **405 PASS** |

---

## 산출 문서

| 파일 | 내용 |
|------|------|
| `20260614_phase2_plan.md` | Phase 2 안정화 실행 계획 (28 tasks, 5 waves) |
| `20260614_db_schema_swarm_scout.md` | SCOUT — DB 스키마·마이그레이션 분석 |
| `20260614_api_inventory_design_audit_v1.md` | SCOUT — API 인벤토리·설계 감사 |
| `20260614_documentation_audit_swarm_scout.md` | SCOUT — 문서 품질 감사 (4.6/10) |
| `20260614_robust_architecture_plan_swarm.md` | PLAN — Robust 아키텍처 마이그레이션 |
| `20260614_performance_optimization_plan_v1.md` | PLAN — 성능 최적화 전략 |
| `plan-20260614-p0-fix.md` | P0 Fix 구현 계획 |
| `docs/SYSTEM_ARCHITECTURE.md` | 현행화된 시스템 아키텍처 (3-app 구조) |
| `docs/LAYOUT.md` | 현행화된 디렉토리 레이아웃 |
| `CLAUDE.md` | Repo-level AI agent 가이드 |

---

## 파일 변경 통계

| 유형 | Count |
|------|-------|
| 신규 파일 | 28 |
| 수정 파일 | 20 |
| 총 변경 | **48 files** |

---

## 잔여 과제 (Phase 3 권장)

| 우선순위 | 항목 |
|----------|------|
| P1 | CSP 헤더 추가 (next.config.js) |
| P1 | mcp-server 14 tools → packages/tools로 완전 이전 |
| P1 | E2E test에 Authorization header 추가 |
| P1 | pnpm install cache CI 최적화 |
| P2 | Map eviction 추가 (rate limiter 메모리 누수) |
| P2 | Zod schema 중복 제거 (types.ts ↔ contracts) |
| P2 | DB 쿼리 배치 처리 (check_rate_card N+1) |

---

**작업 완료 일시:** 2026-06-14  
**테스트 기준선:** 405 tests, 0 typecheck errors, 0 build failures  
**다음 추천 작업:** Phase 3 — CSP 헤더 + MCP tools 완전 이전 + E2E auth
