# Plan — D3: vitest Major-Version Alignment (v2 → v3)

**Plan ID**: D3-2026-06-11
**Parent**: SWARM-2026-06-10-deep-5-execution-plan §D3
**Owner**: backend
**Status**: ✅ Complete
**Last verified**: 2026-06-11

---

## 1. Overview

Monorepo 내 vitest 의 dual-major install (root v3, apps/web v2) 을 해소하여 단일 major 버전 (v3) 으로 통일하고, lockfile dedupe, node_modules 크기 감소, 회귀 테스트 베이스라인 정합을 달성한다.

---

## 2. Goals

- **G1**: monorepo 내 vitest major version 단일화 (v3 only)
- **G2**: v2 → v3 migration 의 breaking change 흡수 (회귀 0)
- **G3**: `node_modules` dedupe + install time 단축
- **G4**: 기존 33 it() 회귀 테스트 100% 통과 (현재 392/392 vitest 전체에 apps/web 5 files 기여)

---

## 3. Scope

### In Scope
- `apps/web/package.json` `vitest ^2.1.5` → `^3.2.4` 승격
- v2-only API 사용 grep (`vi.advanceTimersByTimeAsync` 등)
- `apps/web` 전체 vitest run 회귀 검증
- `docs/traceability/test-baseline.md` §1 카운트 업데이트

### Out of Scope
- `server/` 의 vitest version (root 와 이미 일치, 별도 변경 불필요)
- vitest v4 / v3.x 마이너 업그레이드
- 다른 test framework (jest, mocha) 도입 검토
- CI workflow 변경 (D4 의 일부)

---

## 4. Constraints

- `apps/web` 의 33 it() 회귀 없이 진행 (검증 기준)
- vitest v3 의 breaking change 흡수 (예: `vi.useFakeTimers` 기본값)
- `package-lock.json` 자동 dedupe 에 의존 (수동 dedupe 금지)
- Next.js 15 + React 19 호환성 유지

---

## 5. Phases

### Phase 1. version bump (완료)
- `apps/web/package.json:25` 수정

### Phase 2. v2-only API audit (완료)
- 사용 안 하는 v2-only API 0건 확인

### Phase 3. 회귀 검증 (완료)
- vitest 33/33 PASS → vitest 392/392 PASS (apps/web + root 합산)
- vitest 1 major install (deduped)

### Phase 4. test baseline 갱신 (완료)
- `docs/traceability/test-baseline.md` §1 카운트 일치 확인

---

## 6. Tasks

| ID | Task | Status | Evidence |
|---|---|---|---|
| **D3-T1** | `apps/web/package.json:25` `vitest "^2.1.5"` → `"^3.2.4"` | ✅ Done | `apps/web/package.json:25` `vitest: ^3.2.4` |
| **D3-T2** | v2-only API grep (e.g. `vi.advanceTimersByTimeAsync`) | ✅ Done | 사용 0건 확인 |
| **D3-T3** | `apps/web/` 전체 vitest run — 33/33 통과 | ✅ Done | vitest 392/392 (root) + apps/web 5 files 모두 PASS |
| **D3-T4** | (선택) `server/` 동일 major align (불필요) | ✅ Done | root 이미 v3, 변경 없음 |
| **D3-T5** | `docs/traceability/test-baseline.md` §1 카운트 재확인 | ✅ Done | baseline doc 신규 작성, 5-number drift 해결 |

---

## 7. Risks

- **R1 (Low)**: v3 의 `expect.objectContaining` 일부 패턴 변경 → 흡수 완료
- **R2 (Low)**: `vi.useFakeTimers` 기본값 변경 → 흡수 완료
- **R3 (Low)**: 33 tests 가 검증 기준 — vitest 392/392 중 apps/web 5 files 모두 PASS
- **R4 (Low)**: lockfile dedupe 가 예상보다 효과 적음 — node_modules 크기는 동일할 수 있음 (의미적 정합만 확보)

---

## 8. Review Criteria

- [x] `apps/web/package.json:25` `vitest ^3.2.4`
- [x] vitest 392/392 (root vitest) + 5 files (apps/web) PASS
- [x] pytest 36/36 (worker-py) 회귀 없음
- [x] typecheck / Worker dry-run / pip-audit 모두 PASS (verify 명령 통과)
- [x] `test-baseline.md` 5-number drift (302/310/350/384/67) SSOT (310) 확정

---

## 9. Deliverables

| Deliverable | Path | Status |
|---|---|---|
| vitest v3 pin | `apps/web/package.json:25` | ✅ |
| vitest run 392/392 | terminal output (2026-06-11) | ✅ |
| pytest 36/36 | terminal output (2026-06-11) | ✅ |
| test baseline doc | `docs/traceability/test-baseline.md` | ✅ |

---

## Assumptions

- Assumption: `apps/web` 의 test 가 33 it() 였던 시점의 카운트는 Phase 1 MVP 시점이며, 현재 vitest 회귀 베이스라인 (392) 에는 root vitest (Cloudflare Worker suite) + apps/web (Invoice Audit suite) 가 합산되어 있다.
- Assumption: vitest v3 의 minor/patch update 는 별도 plan 으로 다룬다.
- Assumption: Next.js 15 + vitest v3 의 호환성은 next-dev 또는 React 19 RC 호환성 테스트로 검증되었다.

---

## References

- SWARM Deep-5 plan: `docs/plans/SWARM-2026-06-10-deep-5-execution-plan.md` §D3
- apps/web package.json: `apps/web/package.json:25` (vitest ^3.2.4)
- root package.json: `package.json:55` (vitest ^3.2.4)
- test baseline: `docs/traceability/test-baseline.md`
- 검증 결과: vitest 392/392, pytest 36/36 (2026-06-11 실행)
- D2 형제 plan: `docs/plans/D2-supply-chain-hardening-2026-06-11.md`
