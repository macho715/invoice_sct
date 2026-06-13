# Test Baseline — Canonical Inventory (2026-06-10)

SSOT for vitest/pytest counts. Resolves the 5-number drift (302/310/350/384/67) discovered during 3-way cross-validation.

## 1. Cloudflare Worker (운영 SSOT) — 22 vitest files / **310 cases**

Source: `docs/SCT_ONTOLOGY 개발 현황 보고서.md:212, 240`
- raw `it()` 284 + `it.each` 16+10 = 310
- Verify: `cd server && npx vitest run --reporter=basic`

## 2. apps/web (Invoice Audit Platform Phase 2/X) — 19 vitest files / **70 cases**

Source: Phase X verification and latest vitest runs (2026-06-10)
- Verify: `cd apps/web && npx vitest run --reporter=basic`

## 3. apps/worker-py (Python Worker) — **36+ pytest**

Source: `Phase 1 MVP 구현 완료.MD:25` (20/20 baseline) + `Phase 2 완료.MD:53` (36/36) + `implement.md` (36/36 실측)
- Verify: `cd apps/worker-py && python -m pytest --co -q`

## 4. Resolution: 5 numbers found

| Number | Source | Verdict |
|---|---|---|
| 302 | `README.md:38` | **stale** (it.each 파라미터화 8건 underestimate) |
| 310 | `개발현황 보고서.md:212, 240` | **SSOT (운영 Cloudflare Worker)** |
| 350 | `unit-test-fix-execution-guide.md:4` | **별도 suite** (Invoice Audit Platform repo-wide, web 70 + server 310) |
| 384 | `Phase 2 완료.MD:53` | **별도 suite** (Phase 2 FxPolicy 추가 후 350+34) |
| 67 | implement.md 주장 | **미출처 / 폐기** (별도 측정값, 어디에도 없음) |

**Action**: README.md:38 302 → 310, 차이 8은 it.each expand 후속 패치.

## 5. Verify commands

```bash
# 운영 Cloudflare Worker
cd server && npm run verify         # → 310 cases
# Invoice Audit Platform (web)
cd apps/web && npm test              # → 70 cases
# Python Worker
cd apps/worker-py && python -m pytest # → 36 cases
```

## 6. Coverage matrix (latest)

| Surface | Files | Tests | Status |
|---|---|---|---|
| Cloudflare Worker | 22 | 310 | ✅ SSOT |
| apps/web API | 19 | 70 | ✅ Phase X |
| apps/worker-py parsers | 4 | 36 | ✅ Phase 1+2+3 |

## 7. Known gaps (2026-06-10)

1. `/api/audit/trace` route-level isolation test (Phase X 신규, 격리 테스트 완료)
2. `/api/fx-policy` 422 vs 403 분기 + 소수점 4자리 라운딩 (Phase 2 부분 검증)
3. `/api/audit/export` POST 다운로드 trace (Track A 패치 완료, 2026-06-10)

## 8. Change log

- 2026-06-10: 신규 작성. 5-number vitest drift 해결. apps/web 테스트 개수를 33개에서 70개(19개 파일)로 업데이트. 8-line README.md patch queued.
