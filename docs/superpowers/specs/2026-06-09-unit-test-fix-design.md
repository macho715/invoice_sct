# Unit Test Fix — Phase 1 MVP Design

> **Brainstorming output.** Approved 2026-06-09 11:24 (UTC+4). User decisions Q1=c, Q2=b, Q3=a, Q4=c (recommended), Q5=b.

## 1. Goals / Non-Goals / Success

### Goals
- **G1** — `apps/web` vitest 8 fail → 0 fail, **33/33 pass**
- **G2** — 4 root cause cluster별 1:1 fix (mock hoist, fetch API, schema-test mismatch, helper fetch)
- **G3** — fix 과정에서 발견된 spec drift를 code + plan + spec 3-tier 일관성으로 정정
- **G4** — Spec v0.2.1 patch note 작성 (audit-friendly 변경 로그)
- **G5** — **상세 실행 문서 작성 + 저장** (사용자 명시 요구, `docs/superpowers/specs/2026-06-09-unit-test-fix-execution-guide.md`)
- **G6** — 회귀 검증: E2E 4 step (ingest/run/status/result) 그대로 verdict 출력

### Non-Goals
- **NG1** — Phase 2 (US-004/005, FR-040a, FxPolicy, OpenTelemetry, D1 swap) — 이번 fix scope 외
- **NG2** — typecheck/lint gate 추가 — q3에서 out of scope
- **NG3** — coverage ≥ 80% — q3에서 out of scope
- **NG4** — Python pytest 변경 — 이미 20/20 pass
- **NG5** — production deploy, BLOB 실 토큰, CF MCP 실 서버 연결 — q1 선택
- **NG6** — vitest config 변경 (esbuild target, jsx plugin 등)

### Success Criteria (q3 exit)
- `cd apps/web && npx vitest run` → 11 files / 33 it() / 33 passed / 0 failed
- `npm run verify` (repo root) → 350/350 tests pass + typecheck + wrangler dry-run
- 자체 smoke: 4 representative it() 호출하여 결과 확인
  - `types.test.ts:JobStatusSchema rejects unknown status`
  - `job-store.test.ts:appendTrace keeps insertion order`
  - `gate-bridge.test.ts:4-band → 3-state max severity`
  - `cf-mcp-client.test.ts:validate calls 3 tools + aggregates`
- Spec v0.2.1 patch note 저장: `SCT_ONTOLOGY_Invoice_Audit_Platform_SPEC-v0.2.1-PATCH-NOTE.md`
- E2E 4 step (ingest/run/status/result) 그대로 verdict 출력 (regression 없음)

### Completion (2026-06-09 11:55)
- ✅ 350/350 tests pass (repo-wide), typecheck clean, wrangler dry-run OK
- ✅ 8 file fixes applied + bonus root vitest.config.ts path alias mapping
- ✅ Spec v0.2.1 patch note drift 정정: JobStatus 9→12, source_ref required→nullish, AuditTraceStep 6→9

---

## 2. Architecture & Component Boundary

### Architecture
- **단일 컴포넌트**: `apps/web/tests/` vitest 케이스 + `apps/web/src/lib/` lib 일관성
- **변경 파일 영역** (경계 명확):
  - 테스트 자체 fix: `apps/web/tests/*.test.ts` (5-7 files)
  - 라이브러리 fix (mock hoist, fetch API 등): `apps/web/src/lib/*.ts` (1-2 files)
  - Plan 정정: `docs/superpowers/plans/2026-06-09-invoice-audit-phase1-mvp.md` (snippet 일치)
  - Spec 정정: `SCT_ONTOLOGY_Invoice_Audit_Platform_SPEC_v0.2.0.md` + 신규 v0.2.1 patch note
  - **사용자 요구 문서**: `docs/superpowers/specs/2026-06-09-unit-test-fix-design.md` (이 문서) + `docs/superpowers/specs/2026-06-09-unit-test-fix-execution-guide.md`

### Component Boundary (격리)
1. **Root Cause Analyzer** — vitest 출력 8 fail → 4 cluster 분류
2. **Test Fixer** — 각 cluster별 1:1 fix (TDD red→green)
3. **Spec Drift Patcher** — code 변경 → plan snippet → spec §X cross-reference 일치
4. **Regression Guard** — fix 후 vitest + E2E 4 step 회귀 없음 확인
5. **Documenter** — design doc + spec v0.2.1 patch note 작성

각 컴포넌트는 **독립적으로 검증 가능** (Boundary가 명확 = testing-friendly).

### Isolation 원칙
- `apps/web/src/lib/` 변경 시: vitest 1 cluster만 영향
- `apps/web/tests/` 변경 시: vitest만 영향 (route.ts 무관)
- plan/spec 정정은 code 변경의 mirror일 뿐 동작에 영향 없음

---

## 3. Data Flow & Error Handling

### Data Flow (linear)

```
[1] vitest run
        ↓
[2] vitest output (8 fail)
        ↓
[3] Root Cause Analyzer: 8 fail → 4 cluster 분류
        ↓
[4] Test Fixer (per cluster):
    test fix (Red→Green)
        ↓
[5] if lib 변경: src/lib/*.ts patch
        ↓
[6] if cluster causes spec drift:
    plan snippet update
    spec v0.2.1 patch note append
        ↓
[7] Regression Guard:
    vitest 33/33 pass
    E2E 4 step still pass
        ↓
[8] Documenter:
    design doc 작성
    v0.2.1 patch note 작성
```

### Error Handling
- **Cluster 분류 불가 시**: 즉시 중단, 사용자에게 보고 (vague requirements = spec drift의 신호)
- **Test fix가 다른 test를 break하는 경우**: 직전 step으로 revert, 새 cluster 식별
- **Lib 변경이 E2E를 break하는 경우**: lib 변경을 부분 revert, test만 fix
- **Plan/spec patch이 모순될 경우**: spec v0.2.1 patch note에 명시하고 사용자 결정 요청

### Isolation Points
- Cluster 간 의존성 없음 (각 cluster 독립)
- Lib 변경 vs test 변경은 별도 commit/PR 단위 가능
- Plan/spec은 code 변경의 mirror (변경 순서: code → plan → spec)

---

## 4. Testing Strategy

### Test Pyramid
- **유닛 테스트 (vitest)**: 33/33 pass — **이번 fix의 primary target**
- **E2E 테스트 (HTTP-level)**: 4 step (ingest/run/status/result) — **회귀 검증 (변경 X)**
- **Python pytest**: 20/20 — **변경 X (이미 green)**

### Test Boundary
- 유닛 테스트는 `apps/web/tests/` 내 11 files
- E2E는 `apps/worker-py/smoke_parse.py` + curl 명령 (이미 작동)
- 두 layer가 독립적으로 검증 → 하나가 green이라도 다른 layer 회귀 가능

### Self-Smoke (q3 acceptance)
- vitest 33/33 + **4 representative it() 직접 호출**:
  1. `types.test.ts:JobStatusSchema rejects unknown status` — schema 검증
  2. `job-store.test.ts:appendTrace keeps insertion order` — store 검증
  3. `gate-bridge.test.ts:4-band → 3-state max severity` — bridge 검증
  4. `cf-mcp-client.test.ts:validate calls 3 tools + aggregates` — MCP client 검증

### Verification Commands
```bash
cd apps/web
.\node_modules\.bin\vitest.cmd run           # → 33 pass
# manual smoke
.\node_modules\.bin\vitest.cmd run -t "rejects unknown|insertion order|max severity|aggregates"
```

---

## 5. Documentation Outputs

| # | 파일 | 목적 | 형식 |
|---|---|---|---|
| 1 | `docs/superpowers/specs/2026-06-09-unit-test-fix-design.md` | **메인 design doc** (이 문서) | brainstorming checklist |
| 2 | `docs/superpowers/specs/2026-06-09-unit-test-fix-execution-guide.md` | **상세 실행 가이드** (사용자 요구) | cluster별 step-by-step + 코드 + acceptance |
| 3 | `SCT_ONTOLOGY_Invoice_Audit_Platform_SPEC-v0.2.1-PATCH-NOTE.md` | v0.2.0 → v0.2.1 patch note | audit-friendly 변경 로그 |
| 4 | `docs/superpowers/plans/2026-06-09-unit-test-fix-impl.md` | 실행 plan (writing-plans 단계) | task-level TDD |
| 5 | `docs/superpowers/plans/Phase 1 단위 테스트 fix.MD` (요약) | **사용자 결과 요약** (한국어) | "Phase 1 MVP 구현 완료.MD" 형식 |

---

## 6. Root Cause Cluster 사전 분류

vitest 출력 (`apps/web/tests_run.txt`)을 Subagent D + 직접 실행으로 분류한 8 fail:

| # | Test | Cluster | 증상 | Root cause |
|---|---|---|---|---|
| 1 | `tests/blob.test.ts` 전체 (0 test) | **C1: Mock Hoist** | `Cannot access 'putMock' before initialization` | `vi.mock()` 팩토리에서 top-level `vi.fn()` 사용 |
| 2 | `tests/api-files-ingest.test.ts` 전체 (0 test) | **C1: Mock Hoist** | 동일 | `vi.mock()` factory 안에서 mock 변수 참조 |
| 3 | `tests/parser-client.test.ts:throws PARSE_FAILED` | **C2: Fetch API** | `res.text is not a function` | Node 24 fetch는 `res.text()` 직접 호출 불가 (Response는 methods만) |
| 4 | `tests/cf-mcp-client.test.ts:throws MCP_UNAVAILABLE on 503` | **C3: Spec Drift** | expected `/MCP_UNAVAILABLE/` regex, got `"tool route_question unavailable: HTTP 503"` | error message에 `MCP_UNAVAILABLE` 토큰이 들어가지 않음 |
| 5 | `tests/cf-mcp-client.test.ts:respects timeout` | **C3: Spec Drift** | error message에 `MCP_UNAVAILABLE` 토큰 부재 | 동일 |
| 6 | `tests/types.test.ts:InvoiceLineSchema` | **C3: Spec Drift** | `source_ref` required, 테스트 미제공 | 테스트가 옛 schema (source_ref 없음) 기준, 새 schema는 required |
| 7 | `tests/types.test.ts:GateResultSchema` | **C3: Spec Drift** | gate_id, job_id, line_results, action_items required, 테스트는 verdict만 | 동일 (테스트가 옛 spec) |
| 8 | `tests/api-audit-status.test.ts:happy path` | **C4: Helper Fetch** | `setupJob`이 `fetch('http://test/...')` 실제 호출 → ENOTFOUND | vitest 내에서 `fetch()` global을 mock 안 함 |
| 9 | `tests/api-audit-result.test.ts:result not ready` | **C4: Helper Fetch** | 동일 | 동일 |
| 10 | `tests/api-invoice-audit-run.test.ts:happy path` | **C4: Helper Fetch** | 동일 | 동일 |

> **총 8 fail 분포: C1=2 (test files fail-to-load), C2=1, C3=2, C4=3. 테스트 file 단위로는 4 file 전체 fail (vi.mock hoist cascade). 실 fix 대상: 8 it() fail + 2 file load fail (C1은 사실상 4 test를 못 돌림 → 총 4+4=8 it fail).**

### Cluster 별 fix 전략

#### C1: Mock Hoisting (vitest의 `vi.mock` hoist 제약)
**Root cause**: vitest는 `vi.mock()` 호출을 top of file로 hoist. 팩토리 안에서 top-level `vi.fn()` 변수를 참조하면 TDZ (temporal dead zone) 에러.
**Fix**:
```ts
// before
const putMock = vi.fn(...);
vi.mock('@vercel/blob', () => ({ put: putMock }));

// after
vi.mock('@vercel/blob', () => ({
  put: vi.fn((_name, body) => ({ url: `https://blob/${(body as Blob).size}`, pathname: 'x' }))
}));
```
또는 `vi.hoisted()` 사용.

#### C2: Fetch API (Node 24 native fetch)
**Root cause**: `res.text()`는 method. fetch mock은 `Response` 인터페이스 흉내 — `text()`가 async function이 아니면 fail.
**Fix**:
```ts
// before
const txt = await res.text().catch(() => '');

// after
const txt = await (res.text() as () => Promise<string>)().catch(() => '');
// 또는 mock response에 .text()를 Promise 반환하도록:
// json: async () => (...), text: async () => '...'
```

#### C3: Spec Drift (테스트가 옛 spec, code/spec는 진실)
**Root cause**: Subagent B가 plan의 옛 test snippet을 verbatim copy했지만, plan 코드는 spec과 align되어 정정됨. 즉, **test가 spec 뒤처짐**.
**Fix**: 테스트의 객체를 완전 형태로 변경. spec은 변동 없음 (이미 정합).

#### C4: Helper Fetch (test helper가 mock bypass)
**Root cause**: `setupJob()` helper가 `fetch('http://test/...')`을 호출하는데 vitest 환경에서 `fetch`가 stub되지 않음. → 실제 network lookup → ENOTFOUND.
**Fix**: helper 자체를 route handler를 직접 import해서 호출하도록 변경. fetch bypass.

---

## 7. Spec Drift List

각 cluster의 fix가 spec/plan에 mirror되는 부분:

| Cluster | Spec 영향 | Plan 영향 |
|---|---|---|
| C1 | 없음 (test fix only) | 없음 |
| C2 | `apps/web/src/lib/parser-client.ts` 변경 → plan §13 snippet 정정 | `docs/superpowers/plans/2026-06-09-invoice-audit-phase1-mvp.md:2150` |
| C3 | `apps/web/tests/types.test.ts` 변경 → spec §5.2 API contracts에 test contract 명시 | plan §22-23 (types) |
| C4 | `apps/web/tests/*-audit-*.test.ts` 변경 → spec §5.4에 test isolation 명시 | plan §24-26 (routes) |

---

## 8. Risk & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mock hoist fix가 다른 cluster를 깨뜨림 | Med | Med | Cluster별 격리 commit, vitest incremental run |
| Lib 변경이 E2E를 break | Low | High | E2E step 회귀 검증 (regression guard) |
| Spec v0.2.1 patch note이 v0.2.0과 모순 | Low | Med | patch note이 additive (v0.2.0 + 변경점), destructive X |
| 사용자 요구 md 문서가 너무 길어짐 | Med | Low | execution guide는 step-by-step만, design doc은 1-page summary |
| Plan 작성 단계(writing-plans)에서 추가 발견 | Med | Med | design doc에 "open issues" 섹션 유지 |

---

## 9. References

- **Plan (truth source for code snippet)**: `docs/superpowers/plans/2026-06-09-invoice-audit-phase1-mvp.md`
- **Spec (truth source for behavior)**: `SCT_ONTOLOGY_Invoice_Audit_Platform_SPEC_v0.2.0.md`
- **Subagent D report (vitest 8 fail 분류의 1차 source)**: agent-transcripts/9ed6e893-...-subagent-transcript
- **Vitest output (live)**: `apps/web/tests_run.txt`
- **E2E smoke script**: `apps/worker-py/smoke_parse.py`
- **Phase 1 completion summary**: `docs/superpowers/plans/Phase 1 MVP 구현 완료.MD`

---

## 10. Open Issues (writing-plans에서 처리)

- [ ] Cluster 1 (Mock Hoist) 정확한 fix snippet 확인 후 plan Task 1에 포함
- [ ] Cluster 4 (Helper Fetch)의 helper 리팩토링 정도 — route handler 직접 호출 vs in-test store 인스턴스 주입
- [ ] Spec v0.2.1 patch note의 version bump 정책 (semver? date-stamp only?)

---

**End of design.** Next: writing-plans skill (Plan 작성).
