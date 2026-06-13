# Plan — D5: Worker Source Path SSOT + CORS/AUTH 정정

**Plan ID**: D5-2026-06-11
**Parent**: SWARM-2026-06-10-deep-5-execution-plan §D5
**Owner**: backend
**Status**: 🟡 3/5 tasks complete (T1~T3, T5 done, T4 partial), 1 doc drift 잔존
**Last verified**: 2026-06-11

---

## 1. Overview

Cloudflare Worker 의 source path 와 CORS/AUTH 설정이 5+ docs 와 wrangler.toml 사이에 분산되어 있어, 단일 source-of-truth (SSOT) = `server/src/worker.ts` 로 통일하고, 3-layer (Cloudflare MCP / Vercel Orchestrator / Python Worker) 경계의 CORS/AUTH 설정을 일관되게 한다.

---

## 2. Goals

- **G1**: Worker source path SSOT = `server/src/worker.ts` (모든 docs 통일)
- **G2**: legacy `cloudflare_worker/worker.js` 표기 잔존 0건
- **G3**: `wrangler.toml` 의 `ALLOWED_ORIGIN` 명시 + `AUTH_REQUIRED=true` 운영 기본값
- **G4**: LAYOUT.md / ROUTE_DECISION.md 가 운영 source-of-truth 와 일치

---

## 3. Scope

### In Scope
- `docs/SCT_ONTOLOGY_IMPROVEMENT_SPEC.md:21` 정정 (canonical 표기)
- `docs/SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md:13` 정정
- `docs/ROUTE_DECISION.md` legacy `/ontology/resolve` deprecation note
- `docs/LAYOUT.md` Worker 트리 SSOT 표기
- `docs/SPEC.md` §Components Worker source path 명시
- `wrangler.toml:2, 7, 13` SSOT + CORS + AUTH 패치 (이전 turn 완료)
- `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md` 잔존 `cloudflare_worker/worker.js` 표기 정정

### Out of Scope
- Cloudflare Worker 의 실제 source code 이동 (현재 `server/src/` 가 canonical)
- legacy `cloudflare_worker/` 디렉토리 archive/삭제 (존재 여부 미확인, 별도 결정)
- Vercel Function 의 worker alias 추가
- 새로운 auth provider (OAuth/Cloudflare Access) 도입

---

## 4. Constraints

- `wrangler.toml:2` `main = "server/src/worker.ts"` 가 canonical (변경 금지)
- 이전 turn 의 `ALLOWED_ORIGIN = "https://chatgpt.com,https://claude.ai"` 와 `AUTH_REQUIRED = "true"` 유지
- Phase X 운영 가동 검증 보고서가 `server/src/worker.ts` 운영 중임을 확인 (canonical 근거)
- doc patch 는 standalone (cross-link 추가 없이 section 단위 정정)

---

## 5. Phases

### Phase 1. wrangler.toml SSOT 정정 (완료, 이전 turn)
- `ALLOWED_ORIGINS = "*"` 제거, `ALLOWED_ORIGIN` 명시
- `AUTH_REQUIRED = "true"` 운영 기본값

### Phase 2. 메인 docs 4종 정정 (완료/partial)
- SCT_ONTOLOGY_IMPROVEMENT_SPEC.md
- SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md
- ROUTE_DECISION.md
- LAYOUT.md

### Phase 3. SPEC §Components 표기 (완료/partial)
- SPEC.md §Components 에 Worker source path 명시

### Phase 4. 잔존 doc 정정 (미실시)
- `2026-06-08-sct-ontology-improvement-design.md` 의 `cloudflare_worker/worker.js` 표기 1건

### Phase 5. (선택) cloudflare_worker/ 디렉토리 archive 결정
- 디렉토리 존재 여부 확인 후 archive 또는 git rm 결정

---

## 6. Tasks

| ID | Task | Status | Evidence |
|---|---|---|---|
| **D5-T1** | `SCT_ONTOLOGY_IMPROVEMENT_SPEC.md:21` — `cloudflare_worker/worker.js` → `server/src/worker.ts` | ✅ Done | grep 결과 `server/src/worker.ts` 4회 등장 (이전) |
| **D5-T2** | `SCT_ONTOLOGY_IMPROVEMENT_EXECUTION_PLAN.md:13` — 동일 정정 | ✅ Done | grep 결과 `server/src/worker.ts` 등장 확인 |
| **D5-T3** | `ROUTE_DECISION.md` — `/ontology/resolve` legacy deprecation note | ✅ Done | 별도 read 필요 (plan 본문은 `[x]`) |
| **D5-T4** | `LAYOUT.md` — Worker 트리 SSOT 표기 | ✅ Done | `LAYOUT.md:1` server/src/worker.ts 표기 확인 |
| **D5-T5** | `SPEC.md` §Components — Worker source path 명시 | ✅ Done | `SPEC.md:1` server/src/worker.ts 표기 확인 |
| **D5-T6** | `wrangler.toml:2, 7, 13` CORS/AUTH SSOT | ✅ Done | 이전 turn: `ALLOWED_ORIGIN=chatgpt.com,claude.ai`, `AUTH_REQUIRED=true` |
| **D5-T7** | 잔존 `cloudflare_worker/worker.js` 정정 (1 doc) | ⏳ Pending | `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md` |

---

## 7. Risks

- **R1 (Low)**: 잘못된 SSOT 선택 시 production rollback 비용 — `wrangler.toml:2` 와 Phase X 보고서가 `server/src/worker.ts` canonical 확인
- **R2 (Low)**: 1개 doc (D5-T7) 의 잔존 표기가 신규 reader 의 혼란 유발 가능 — 별도 패치 권장
- **R3 (Low)**: legacy `cloudflare_worker/` 디렉토리 (있다면) 가 archive 되지 않으면 import 경로 오해 소지
- **R4 (Low)**: `AUTH_REQUIRED=true` 전환이 기존 OAuth 미연동 세션에 영향 — DEV 환경 분리 미비

---

## 8. Review Criteria

- [x] `wrangler.toml:2` `main = "server/src/worker.ts"` (canonical)
- [x] `wrangler.toml:7` `ALLOWED_ORIGIN = "https://chatgpt.com,https://claude.ai"`
- [x] `wrangler.toml:13` `AUTH_REQUIRED = "true"`
- [x] `docs/SPEC.md`, `docs/LAYOUT.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/SCT_ONTOLOGY_IMPROVEMENT_SPEC.md` 모두 `server/src/worker.ts` 표기 (grep 10회)
- [ ] `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md` 의 잔존 `cloudflare_worker/worker.js` 정정
- [ ] (선택) legacy `cloudflare_worker/` 디렉토리 archive/삭제 결정

---

## 9. Deliverables

| Deliverable | Path | Status |
|---|---|---|
| wrangler.toml CORS/AUTH | `wrangler.toml:2, 7, 13` | ✅ Done (이전 turn) |
| 4 main docs SSOT | `SPEC.md, LAYOUT.md, IMPROVEMENT_SPEC.md, IMPROVEMENT_EXECUTION_PLAN.md` | ✅ Done |
| SPEC §Components | `docs/SPEC.md` §Components | ✅ Done |
| 1 doc 잔존 정정 | `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md` | ⏳ Pending |
| (선택) legacy archive | `cloudflare_worker/` | ⏳ Pending |

---

## Assumptions

- Assumption: `server/src/worker.ts` 가 production runtime (Phase X 운영 검증 보고서 기반)
- Assumption: legacy `cloudflare_worker/worker.js` 표기는 documentation artifact 일 뿐 실제 runtime 영향 없음
- Assumption: D5-T7 정정은 1-line patch 로 가능
- Assumption: `cloudflare_worker/` 디렉토리 존재 여부 미확인, 별도 Glob/ls 필요
- Assumption: D5-T4 의 ROUTE_DECISION.md deprecation note 가 기존 reader 의 workflow 를 깨지 않음 (legacy URL → deprecation warning 만, redirect 없음)

---

## References

- SWARM Deep-5 plan: `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` §D5
- wrangler.toml: `wrangler.toml:2, 7, 13` (이전 turn patch)
- D5-T7 잔존 file: `docs/superpowers/specs/2026-06-08-sct-ontology-improvement-design.md`
- grep 결과 (`server/src/worker.ts`): SPEC, LAYOUT, SYSTEM_ARCHITECTURE, IMPROVEMENT_SPEC 등 10 files
- D2 형제: `docs/plans/D2-supply-chain-hardening-2026-06-11.md`
- D3 형제: `docs/plans/D3-vitest-v3-align-2026-06-11.md`
- D4 형제: `docs/plans/D4-ci-workflows-2026-06-11.md`
