# SCT_ONTOLOGY Card Upgrade Progress Report

- 작성일: 2026-05-18 00:15:14 +04:00
- 최신 갱신: 2026-05-18 02:04:46 +04:00
- 세션 기준: 현재 Windows Codex 세션
- 작업 위치: `C:\Users\jichu\Downloads\HVDC Ontology Grounded`
- 기준 사양: `SCT_ONTOLOGY_CARD_UPGRADE_SPEC_v1.0.md`, `SCT_ONTOLOGY_CARD_GOVERNANCE_SPEC_v2.md`
- 현재 판정: PARTIAL

## 0. 현재 스냅샷

현재까지 작업은 문서화 기준으로 `PARTIAL`이다.
P0 핵심 라우팅과 DecisionCard v2, EvidenceRanker v2, Renderer tab, traceability report 생성, smoke metrics report, P2 raw exposure ZERO gate, Governance v2 system QA intent/verdict contract, ActionGate card contract, SystemComponent graph context, real browser smoke, SCT output-surface PII/NDA scanner, source-corpus raw sensitive-pattern audit는 구현과 검증을 마쳤다.
정적 widget a11y smoke와 브라우저 accessibility snapshot은 추가했지만, CI Playwright E2E, axe a11y scan, approved-size KPI 평가 리포트, source-corpus person-name/NDA marker semantic adjudication는 남아 있으므로 전체 사양 완료로 판정하지 않는다.

현재 사용자가 바로 확인할 문서는 이 파일이다.

- 진행 문서: `docs/plans/sct-ontology-card-upgrade-progress-2026-05-18.md`
- QA 요약 문서: `docs/QA_REPORT.md`
- 자동 생성 보고서 스크립트: `scripts/report-sct-card.ts`
- PII/NDA output scanner: `scripts/scan-sct-card-pii.mjs`
- source-corpus audit: `scripts/audit-source-corpus-pii.mjs`
- 브라우저 smoke 서버: `scripts/serve-widget-smoke.mjs`
- 브라우저 smoke harness: `tests/fixtures/widget-browser-smoke.html`
- completion audit: `docs/traceability/sct-card/governance-v2-completion-audit.md`
- traceability 산출물 폴더: `docs/traceability/sct-card/`

현재 세션에서 확인한 주요 작업트리 상태는 다음과 같다.

- 수정된 추적 파일: `package.json`, `docs/QA_REPORT.md`, `docs/plans/sct-ontology-card-upgrade-progress-2026-05-18.md`, `server/src/answer.ts`, `server/src/decision-card.ts`, `server/src/router.ts`, `server/src/types.ts`, `server/src/hvdc-server.ts`, `server/src/claude-server.ts`, `schemas/sct-answer-contract.schema.json`, `public/hvdc-answer-widget.html`, `server/src/generated/widget-html.ts`, `tests/decision-card.test.ts`, `tests/intent-router.test.ts`, `tests/pipeline.test.ts`, `tests/sct-operating-contract.test.ts`, `tests/widget.test.ts`
- 새 산출물 파일: `docs/traceability/sct-card/decision-log.md`, `simulation-log.md`, `validation-report.md`, `metrics-report.md`, `browser-smoke-report.md`, `pii-nda-scan-report.md`, `source-corpus-pii-nda-audit.md`, `governance-v2-completion-audit.md`, `widget-browser-smoke.png`, `changelog.md`
- 새 스크립트 파일: `scripts/report-sct-card.ts`, `scripts/serve-widget-smoke.mjs`, `scripts/scan-sct-card-pii.mjs`, `scripts/audit-source-corpus-pii.mjs`
- 새 테스트/검증 파일: `tests/p2-zero-gate.test.ts`, `tests/fixtures/widget-browser-smoke.html`
- 작업 범위 밖으로 보이는 미추적 파일: `.codex/root-docs-*.json`, `.vitest-cache/`, `SCT_ONTOLOGY_CARD_GOVERNANCE_SPEC_v2.md`

## 1. 요약

이번 작업은 `SCT_ONTOLOGY CARD`를 단순 evidence drawer에서 운영 의사결정 카드로 올리는 사양 중 P0와 일부 P1/P2 항목을 구현한 상태다.

완료된 핵심 범위는 다음과 같다.

- 시스템 점검 요청을 이메일 답장 또는 비용 승인으로 오분류하지 않도록 IntentRouter를 보강했다.
- RulePack Binder에 intent, domain, action 기반 rulepack 선택 구조를 추가했다.
- DecisionCard v2에 `intent`, `schemaVersion`, `allowedNow`, `blockedUntilApproved`, `humanGateState`, `rulePackIds`를 연결했다.
- EvidenceRanker v2의 `EvidenceScore`를 도입했다.
- ActionPlanner v2에 `requiredInput` 추출과 `dueBasis` 표시를 추가했다.
- Renderer에 `Decision`, `Evidence`, `Validation`, `Entities`, `Actions`, `Trace` 탭 구조를 추가했다.
- 관련 unit test와 contract test를 추가 또는 갱신했다.

아직 전체 Definition of Done은 끝나지 않았다.
React/Next.js 성능 audit, CI Playwright E2E, axe a11y scan, source-corpus person-name/NDA marker semantic adjudication는 남아 있다.

## 2. 변경 파일

주요 변경 파일은 다음과 같다.

- `server/src/router.ts`: intent 분류, hard-negative, rulepack registry, action allow/block matrix를 추가했다.
- `server/src/answer.ts`: system diagnostic 응답 분기와 `SYS-ROUTER-001` validation finding을 추가했다.
- `server/src/corpus.ts`: EvidenceRanker v2 scoring과 requiredDoc 보존 로직을 추가했다.
- `server/src/decision-card.ts`: DecisionCard v2 필드, HumanGate state, `directSupportRatio`, `dueBasis`를 추가했다.
- `server/src/types.ts`: `IntentCode`, `EvidenceScore`, `HumanGateState` 관련 타입을 확장했다.
- `server/src/hvdc-server.ts`: ChatGPT Apps output schema를 DecisionCard v2와 EvidenceScore에 맞췄다.
- `server/src/claude-server.ts`: Claude MCP output schema를 같은 계약으로 맞췄다.
- `public/hvdc-answer-widget.html`: DecisionCard 탭 UI, HumanGate, EvidenceCoverage, ActionTable, Trace 표시를 보강했다.
- `server/src/generated/widget-html.ts`: 위젯 HTML 생성 산출물을 갱신했다.
- `schemas/sct-answer-contract.schema.json`: 외부 contract schema에 DecisionCard v2, EvidenceScore, directSupportRatio, dueBasis를 반영했다.
- `tests/intent-router.test.ts`: P0 intent hard-negative 회귀 테스트를 추가했다.
- `tests/evidence-ranker.test.ts`: P1 EvidenceRanker 회귀 테스트를 추가했다.
- `tests/decision-card.test.ts`: DecisionCard consistency, HumanGate, coverage, action 필드 테스트를 갱신했다.
- `tests/widget.test.ts`: 탭 UI와 card field 렌더링 테스트를 갱신했다.
- `tests/sct-operating-contract.test.ts`: contract schema 필수 필드 테스트를 갱신했다.
- `tests/claude-descriptor.test.ts`, `tests/pipeline.test.ts`: 확장된 route/card 계약에 맞게 fixture를 갱신했다.

## 3. Prompt-to-artifact checklist

| Spec requirement | Current status | Evidence artifact | Verification |
| --- | --- | --- | --- |
| P0 IntentRouter: `SYSTEM_DIAGNOSTIC`, `ONTOLOGY_PATCH_REVIEW`, `CARD_RENDERING_AUDIT` | DONE | `server/src/router.ts`, `tests/intent-router.test.ts` | 시스템 점검 프롬프트 30개가 `EMAIL_DRAFT`로 가지 않는 테스트 통과 |
| P0 hard-negative: 점검/패치/CARD/router/validation/evidence/schema는 email/cost/send 금지 | DONE | `server/src/router.ts` | `tests/intent-router.test.ts` 통과 |
| P0 RulePack Binder: intent x domain x action matrix | DONE | `RULEPACK_REGISTRY`, `resolveRulePackIds` | system intent에서 `COMM_RULEPACK`, `COST_RULEPACK` 제외 테스트 통과 |
| Governance v2 FR-001: 8개 system QA intent | DONE | `server/src/router.ts`, `server/src/types.ts`, `tests/intent-router.test.ts` | `SYSTEM_DIAGNOSTIC`, `ONTOLOGY_PATCH_REVIEW`, `CARD_RENDERING_AUDIT`, `RULEPACK_GAP_ANALYSIS`, `ROUTER_QA`, `EVIDENCE_QA`, `SCHEMA_BOUNDARY_REVIEW`, `VALIDATION_POLICY_REVIEW` 라우팅 테스트 통과 |
| Governance v2 FR-006: `DIAGNOSTIC` verdict contract | PARTIAL | `server/src/types.ts`, `server/src/decision-card.ts`, zod/json schema, widget | system QA 답변과 DecisionCard는 `DIAGNOSTIC`을 유지한다. 나머지 verdict(`DRAFT_READY`, `NEEDS_INPUT`, `PENDING_APPROVAL`, `DRY_RUN_ONLY`)는 계약 enum에는 추가했지만 실제 derivation은 아직 제한적이다 |
| Governance v2 FR-006: draft/send verdict derivation | PARTIAL | `server/src/answer.ts`, `server/src/decision-card.ts`, `tests/pipeline.test.ts` | draft-only email은 `DRAFT_READY`, external send는 `PENDING_APPROVAL`로 검증했다. `NEEDS_INPUT`, `DRY_RUN_ONLY`, `PASS_WITH_FINDINGS`의 전체 derivation matrix는 아직 제한적이다 |
| P0 DecisionCard consistency | DONE | `server/src/decision-card.ts` | BLOCK card의 `blockedBy`, `primaryReason`, `blockedActions` 테스트 통과 |
| P0 HumanGate state machine | PARTIAL | `deriveHumanGateState`, widget HumanGate 표시 | state field와 pending/approved 표시 검증 완료. 실제 write/send/publish 실행 레벨 차단은 별도 작업 필요 |
| P0 6 regression scenarios | DONE | `tests/intent-router.test.ts`, `tests/evals.test.ts` | focused tests와 golden eval 통과 |
| P1 EvidenceRanker score | PARTIAL | `EvidenceScore`, `tests/evidence-ranker.test.ts` | directSupport top-3 threshold 테스트 통과. 전체 도메인 평가셋 80.00% 리포트는 아직 없음 |
| P1 ValidationEngine rulepack 분리와 coverage KPI | PARTIAL | 기존 validation + `SYS-ROUTER-001` | rulepack 분리는 일부 반영. missing input 검출률 90.00% KPI 리포트는 아직 없음 |
| P1 ActionPlanner v2 | PARTIAL | `ActionItem.requiredInput`, `dueBasis`, `allowedNow`, `blockedUntilApproved`, `auditRecordRequired`, `writeBackMode` | card action table와 ActionGate 테스트 통과. owner workflow SLA나 due rule registry는 아직 없음 |
| Governance v2 FR-012: ActionGate sequence | DONE | `evaluateActionGate`, `tests/decision-card.test.ts`, `tests/pipeline.test.ts`, traceability bundle | external send는 `DRY_RUN -> APPROVAL -> WRITE -> AUDIT_RECORD` 순서로 차단되고 `PENDING_APPROVAL`로 표시된다. 실제 Foundry write-back 실행은 사양상 non-goal |
| P1 EntityResolver stopword/system component classification | PARTIAL | `resolveAnyKey`, `tests/intent-router.test.ts` | generic stopword는 entity로 승격하지 않고, system module은 `SystemComponent`로 해석한다. 전체 운영 startNode leakage 측정 리포트는 아직 없음 |
| P2 Renderer tabs | PARTIAL | `public/hvdc-answer-widget.html` | `Decision/Evidence/Validation/Entities/Actions/Security/Trace` 탭 HTML/JS, widget test, Playwright MCP browser smoke 통과. ChatGPT iframe host 수동 검증은 아직 없음 |
| NFR-004 static widget a11y smoke | PARTIAL | `tests/widget.test.ts`, Playwright MCP snapshot | static HTML smoke와 browser accessibility snapshot으로 tab/button ARIA와 text-only/color-only 의존 방지를 확인했다. axe 검증은 아직 없음 |
| Browser smoke for Renderer/ActionGate | DONE | `tests/fixtures/widget-browser-smoke.html`, `scripts/serve-widget-smoke.mjs`, `docs/traceability/sct-card/browser-smoke-report.md`, `widget-browser-smoke.png` | Playwright MCP accessibility snapshot에서 `Decision Card v2`, `PENDING_APPROVAL`, ARIA tabs, `HumanGateBanner`, `REQUEST_EMAIL_SEND_APPROVAL` 표시 확인 |
| P2 React/Next.js performance audit | NOT DONE | 없음 | 이 repo는 현재 Next.js frontend가 아니며 Lighthouse/Playwright/real browser a11y smoke 미실행 |
| P2 Traceability bundle 자동 생성 | DONE | `scripts/report-sct-card.ts`, `docs/traceability/sct-card/*` | `npm run report:sct-card` 실행으로 decision-log, simulation-log, validation-report, changelog 생성 확인 |
| Governance v2 smoke success metrics | PARTIAL | `docs/traceability/sct-card/metrics-report.md` | smoke set에서 intent/verdict/ActionGate/audit/writeback/stopword leakage 지표는 PASS_SMOKE. approved-size regression set은 아직 없음 |
| P3 Multi-entity GraphPath/riskEdges | PARTIAL | `GraphPath.startNodes`, `riskEdges`, `operationalObjects`, `isMetaReview`, `tests/intent-router.test.ts`, traceability bundle | system QA meta-review graph context는 multi-start와 riskEdges를 표시한다. 전체 운영 그래프 traversal 평가는 아직 없음 |
| P3 PII/NDA scanner와 ZERO gate 자동화 | PARTIAL | `server/src/answer.ts`, `server/src/decision-card.ts`, `tests/p2-zero-gate.test.ts`, `scripts/scan-sct-card-pii.mjs`, `scripts/audit-source-corpus-pii.mjs`, `docs/traceability/sct-card/pii-nda-scan-report.md`, `source-corpus-pii-nda-audit.md` | P2 원문·계약 단가·실명·내부 링크 노출 요청은 `ZERO`로 차단한다. SCT output-surface scan은 14 files / 0 findings, source-corpus raw scan은 12 files / 0 raw findings / 303 review markers로 통과했다. person-name/NDA marker semantic adjudication는 아직 없음 |

## 4. 검증 기록

현재 세션에서 실행한 검증은 다음과 같다.

| Command | Result | Meaning |
| --- | --- | --- |
| `npm run typecheck` | PASS | 생성 산출물 갱신 후 TypeScript compile check 통과 |
| `npx vitest run tests/intent-router.test.ts tests/decision-card.test.ts tests/widget.test.ts tests/sct-operating-contract.test.ts tests/decision-card-attach.test.ts` | PASS | P0 router/card/widget/contract focused regression 통과 |
| `npx vitest run tests/widget.test.ts tests/sct-operating-contract.test.ts tests/decision-card.test.ts tests/evidence-ranker.test.ts` | PASS, 11 matched test files / 166 tests | Renderer tab 추가 후 focused verification 통과 |
| `npm test` | PASS, 21 test files / 282 tests | Renderer tab 변경 후 전체 unit suite 최종 회귀 통과 |
| `npm run worker:dry-run` | PASS, Total Upload 3733.10 KiB / gzip 693.93 KiB | Renderer tab 변경 후 Cloudflare Worker dry-run bundle 검증 통과 |
| `npm run report:sct-card` | PASS | `docs/traceability/sct-card/decision-log.md`, `simulation-log.md`, `validation-report.md`, `changelog.md` 생성 |
| `npm run typecheck` | PASS | `report:sct-card` 추가 후 TypeScript compile check 통과 |
| `npx vitest run tests/p2-zero-gate.test.ts tests/intent-router.test.ts tests/decision-card.test.ts tests/widget.test.ts` | PASS, 8 matched test files / 150 tests | P2 ZERO gate, PII_NDA rulepack binding, DecisionCard ZERO verdict, widget ZERO 표시 focused verification 통과. 직접 지정 테스트 외 `.claude/worktrees` 중복 테스트도 같이 발견되어 함께 통과 |
| `npm run typecheck` | PASS | ZERO verdict 타입, zod schema, generated widget asset compile check 통과 |
| `npm run report:sct-card` | PASS | `p2-zero-gate` 시나리오가 traceability bundle에 추가됨 |
| `npm test` | PASS, 22 test files / 287 tests | repo-local unit suite 전체 통과 |
| `npm run worker:dry-run` | PASS, Total Upload 3737.28 KiB / gzip 695.21 KiB | Worker dry-run bundle 검증 통과 |
| `npx vitest run tests/widget.test.ts tests/sct-operating-contract.test.ts tests/intent-router.test.ts` | PASS, 12 matched test files / 135 tests | Governance v2 intent vocabulary, `DIAGNOSTIC` contract, Security tab 표시 focused verification 통과. 직접 지정 테스트 외 `.claude/worktrees` 중복 테스트도 같이 발견되어 함께 통과 |
| `npx vitest run tests/pipeline.test.ts tests/intent-router.test.ts` | PASS, 9 matched test files / 198 tests | 운영 객체 질문이 system QA로 과분류되지 않는 회귀 검증 통과 |
| `npm run typecheck` | PASS | Governance v2 intent/verdict/schema/widget 변경 후 TypeScript compile check 통과 |
| `npm run report:sct-card` | PASS | Governance v2 라우팅 변경 후 traceability bundle 재생성 |
| `npm test` | PASS, 22 test files / 291 tests | repo-local unit suite 전체 통과 |
| `npm run worker:dry-run` | PASS, Total Upload 3743.32 KiB / gzip 696.47 KiB | Worker dry-run bundle 검증 통과 |
| `npx vitest run tests/decision-card.test.ts tests/intent-router.test.ts tests/pipeline.test.ts tests/sct-operating-contract.test.ts` | PASS, 17 matched test files / 347 tests | ActionGate, draft/send verdict split, SystemComponent, graph context, schema contract focused verification 통과. 직접 지정 테스트 외 `.claude/worktrees` 중복 테스트도 같이 발견되어 함께 통과 |
| `npm run typecheck` | PASS | ActionGate/action payload/graph schema 변경 후 TypeScript compile check 통과 |
| `npm run report:sct-card` | PASS | `email-send-action-gate`, `system-component-graph`, ActionGate modes를 traceability bundle에 반영 |
| `npx vitest run tests/intent-router.test.ts` | PASS, 2 matched test files / 15 tests | FR-009 stopword startNode 차단 테스트 추가 후 focused verification 통과 |
| `npm test` | PASS, 22 test files / 297 tests | repo-local unit suite 전체 통과 |
| `npm run worker:dry-run` | PASS, Total Upload 3751.55 KiB / gzip 698.33 KiB | Worker dry-run bundle 검증 통과 |
| `npm run verify` | PASS | browser smoke harness/report 추가 후 typecheck, npm test 22 files / 297 tests, worker dry-run 3751.55 KiB / gzip 698.33 KiB 통과 |
| `npm run report:sct-card` | PASS | `metrics-report.md` 생성. smoke metrics: intent 100.00%, verdict 100.00%, ActionGate 100.00%, audit completeness 100.00%, unauthorized write-back 0, generic startNode leakage 0 |
| `npm run typecheck` | PASS | metrics-report script 변경 후 TypeScript compile check 통과 |
| `npx vitest run tests/widget.test.ts` | PASS, 5 matched test files / 92 tests | NFR-004 static widget a11y smoke 추가 후 widget focused verification 통과. 직접 지정 테스트 외 `.claude/worktrees` 중복 테스트도 같이 발견되어 함께 통과 |
| Playwright MCP browser smoke | PASS_SMOKE | `http://127.0.0.1:8765/tests/fixtures/widget-browser-smoke.html` 로드, accessibility snapshot, full-page screenshot `docs/traceability/sct-card/widget-browser-smoke.png` 생성 |
| `node --check scripts/serve-widget-smoke.mjs` | PASS | browser smoke 정적 서버 스크립트 syntax check 통과 |
| `npm run scan:sct-pii` | PASS, 14 scanned files / 0 findings | SCT card output surfaces와 generated traceability artifacts에서 raw email, UAE phone, OpenAI token-like, JWT-like pattern 미검출. 보고서: `docs/traceability/sct-card/pii-nda-scan-report.md` |
| `node --check scripts/scan-sct-card-pii.mjs` | PASS | PII/NDA output-surface scanner syntax check 통과 |
| Completion audit | PARTIAL | `docs/traceability/sct-card/governance-v2-completion-audit.md`에서 US/FR/NFR/SC/T/OQ를 실제 파일·테스트·보고서와 남은 gap에 매핑 |
| `npm run audit:source-pii` | PASS_NO_RAW_PATTERN, 12 corpus files / 0 raw findings / 303 review markers | `data/corpus/*.md` raw email, UAE phone, OpenAI token-like, JWT-like pattern 미검출. PII/NDA/person-name marker inventory 생성 |
| `node --check scripts/audit-source-corpus-pii.mjs` | PASS | source-corpus PII/NDA audit script syntax check 통과 |
| `npm run verify:governance` | PASS, 6 repo-local test files / 126 tests | traceability bundle 재생성, `scan:sct-pii`, `audit:source-pii`, smoke/scanner syntax check, Governance-focused Vitest 통과 |

주의:

- 이전 `npm test`와 `worker:dry-run` 일부는 sandbox 권한 문제 때문에 승인된 elevated 실행으로 검증했다.
- 2026-05-18 00:53 기준 `npm test`와 `npm run worker:dry-run`은 현재 세션에서 다시 실행했고 둘 다 통과했다.
- 2026-05-18 01:10 기준 첫 `npm run verify`는 sandbox에서 `node_modules\.vite-temp` EPERM으로 실패했고, 같은 명령을 승인된 elevated 실행으로 재실행해 통과했다.

## 5. 현재 남은 위험

남은 실제 위험은 다음과 같다.

- P1/P2/P3 요구사항이 모두 끝난 것은 아니다.
- 현재 widget tab은 HTML/JS unit과 Playwright MCP browser smoke 수준에서 검증했다. 실제 ChatGPT iframe host 수동 검증은 아직 없다.
- React/Next.js 관련 요구사항은 이 저장소 구조와 직접 맞지 않는다. 별도 frontend가 생기면 별도 audit가 필요하다.
- validation coverage 90.00%, direct evidence 80.00%는 일부 canonical query 테스트만 있다. 전체 평가 리포트는 아직 없다.
- P2 raw exposure ZERO gate, SCT output-surface scanner, source-corpus raw sensitive-pattern audit는 구현했다. person-name/NDA marker의 의미 기반 판정은 아직 남아 있다.
- Governance v2의 `ActionGate`와 system QA multi-start graph context는 card contract 수준에서 구현했다. smoke metrics report는 생겼지만 approved-size success metric 보고서는 아직 남아 있다.
- 정적 widget a11y smoke와 실제 브라우저 smoke snapshot은 추가했지만, CI Playwright E2E와 axe a11y 자동화는 아직 구현하지 않았다.

## 6. 다음 작업 1개

axe a11y scan 또는 CI Playwright E2E 중 하나를 repo 구조에 맞게 추가한다.
