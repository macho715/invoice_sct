# QA Report

Current verification date: 2026-05-18
Latest documentation update: 2026-05-18 02:04:46 +04:00

## Current verified state

- `ask_hvdc_ontology` is data-only. It returns no `openai/outputTemplate`, no `_meta.ui.resourceUri`, and no `structuredContent.ui`.
- `render_hvdc_answer_card` owns the answer-card template `ui://hvdc/answer-card-v10.html` (canonical).
- Registered UI resources include canonical v10, previous v9/v8/v7, legacy v6/v5, and render tool alias:
  - `ui://hvdc/answer-card-v10.html`
  - `ui://hvdc/answer-card-v7.html`
  - `ui://hvdc/answer-card-v6.html`
  - `ui://hvdc/answer-card-v5.html`
  - `ui://hvdc/render_hvdc_answer_card.html`
- Daily KPI Dashboard lock prompts route to operations KPI, not Invoice/CostGuard default summary.
- FMC role questions such as `Arvin FANR BOE 담당 업무` and `M115 담당자 누구야?` route to the FMC role evidence corpus while retaining `CONSOLIDATED-00`.
- The card widget wraps long action names, protected-field lists, route reasons, and validation text to reduce overflow.
- P2 raw exposure prompts that request raw text, contract rates, real names, or internal links now return `ZERO` and map to `SCT-P2-004`.
- Governance v2 system QA intents are routed as system diagnostics, not as email/cost/write actions.
- The supported system QA intent set is `SYSTEM_DIAGNOSTIC`, `ONTOLOGY_PATCH_REVIEW`, `CARD_RENDERING_AUDIT`, `RULEPACK_GAP_ANALYSIS`, `ROUTER_QA`, `EVIDENCE_QA`, `SCHEMA_BOUNDARY_REVIEW`, and `VALIDATION_POLICY_REVIEW`.
- System QA answers and DecisionCard payloads now preserve `DIAGNOSTIC` verdicts.
- Draft-only email requests now return `DRAFT_READY`, while external send requests return `PENDING_APPROVAL` and stay behind ActionGate.
- ActionGate exposes `DRY_RUN -> APPROVAL -> WRITE -> AUDIT_RECORD` through `allowedNow`, `blockedUntilApproved`, `auditRecordRequired`, and `writeBackMode`.
- `SystemComponent` entities are resolved for `IntentRouter`, `RulePackSelector`, `EvidenceRanker`, `DecisionCard`, `Renderer`, `ActionGate`, and `ValidationEngine`.
- Graph context now exposes multi-start `startNodes`, `riskEdges`, `operationalObjects`, and `isMetaReview` for system QA review paths.
- The card widget exposes `Decision`, `Evidence`, `Validation`, `Entities`, `Actions`, `Security`, and `Trace` views.
- The `Security` view shows detection scope, masked fields, data class, external share status, PII/NDA reason, and sensitive access state.
- Browser smoke harness `tests/fixtures/widget-browser-smoke.html` renders the Decision Card v2 through a real local Chromium page.
- `npm run scan:sct-pii` scans SCT card output surfaces and traceability artifacts for raw email, UAE phone, OpenAI token-like, and JWT-like patterns.
- `npm run audit:source-pii` audits `data/corpus/*.md` for raw sensitive patterns and PII/NDA/person-name review markers without printing raw matched values.
- Completion audit is recorded in `docs/traceability/sct-card/governance-v2-completion-audit.md`.
- Protected upload/write tools are available as MCP tools, but they fail closed without OAuth Bearer scopes and Human-gate approval.

## Local checks

```bash
npm run typecheck
npm test
npm run index
```

Latest local verification:

```bash
npm run verify
```

Result: TypeScript typecheck passed, Vitest 22 files / 297 tests passed, and `wrangler deploy --dry-run` passed. This was rerun after adding the browser smoke harness, browser report, PII/NDA output-surface scanner, and source-corpus PII/NDA audit.

Note: the first `npm run verify` attempt failed inside the sandbox when Vitest tried to write a temporary config file under `node_modules\.vite-temp`. The same command was rerun with approved elevated execution and passed.

Latest SCT card governance and ZERO gate verification:

```bash
npx vitest run tests/intent-router.test.ts tests/decision-card.test.ts tests/widget.test.ts tests/sct-operating-contract.test.ts tests/p2-zero-gate.test.ts
npx vitest run tests/pipeline.test.ts tests/intent-router.test.ts
npx vitest run tests/decision-card.test.ts tests/intent-router.test.ts tests/pipeline.test.ts tests/sct-operating-contract.test.ts
npm run typecheck
npm run report:sct-card
npm test
npm run worker:dry-run
```

Result: all 8 Governance v2 system QA intent families route to `SYSTEM_QA`, system QA answers preserve `DIAGNOSTIC`, operational BL/shipment prompts no longer get over-classified as system QA, draft-only email returns `DRAFT_READY`, external email send returns `PENDING_APPROVAL` with ActionGate `DRY_RUN`, system module prompts resolve `SystemComponent` plus meta-review graph context, P2 raw exposure prompts return `ZERO`, `PII_NDA_RULEPACK` is bound, DecisionCard keeps `ZERO` without downgrading to `BLOCK`, widget renders `ZERO` and the `Security` tab, traceability bundle includes `p2-zero-gate`, and Worker dry-run upload size is 3751.55 KiB / gzip 698.33 KiB.

Latest traceability bundle also generates `metrics-report.md`. Smoke metrics show 100.00% expected-intent accuracy, 100.00% expected-verdict accuracy, 100.00% ActionGate expected-mode accuracy, 100.00% action audit completeness, unauthorized write-back count 0, and generic stopword startNode leakage 0. This is a smoke metric report, not the approved full-size KPI set.

Latest documentation update records the current work-to-date in `docs/plans/sct-ontology-card-upgrade-progress-2026-05-18.md`. That progress report is the session handoff document for implemented changes, generated traceability artifacts, verification commands, and remaining blockers.

Latest browser smoke verification:

```bash
node scripts/serve-widget-smoke.mjs
npx vitest run tests/widget.test.ts
```

Result: Playwright MCP loaded `http://127.0.0.1:8765/tests/fixtures/widget-browser-smoke.html`, captured an accessibility snapshot, and saved `docs/traceability/sct-card/widget-browser-smoke.png`. The snapshot shows `Decision Card v2`, `PENDING_APPROVAL`, ARIA tabs for `Decision/Evidence/Validation/Entities/Actions/Security/Trace`, `HumanGateBanner`, and `REQUEST_EMAIL_SEND_APPROVAL`. `node --check scripts/serve-widget-smoke.mjs` passed and `npx vitest run tests/widget.test.ts` passed with 5 files / 92 tests.

Latest PII/NDA output-surface verification:

```bash
npm run scan:sct-pii
```

Result: `PASS`, 14 scanned files, 0 findings. The report is `docs/traceability/sct-card/pii-nda-scan-report.md`. This scans SCT card output surfaces and generated traceability artifacts; it does not claim that every source corpus or evidence file in the repository is free of PII/NDA material.

Latest source-corpus PII/NDA audit:

```bash
npm run audit:source-pii
```

Result: `PASS_NO_RAW_PATTERN`, 12 scanned corpus files, 0 raw findings, 303 review markers. The report is `docs/traceability/sct-card/source-corpus-pii-nda-audit.md`. This is a regex audit and does not replace human semantic adjudication of every person-name or NDA-sensitive reference.

Latest Governance-specific verification:

```bash
npm run verify:governance
```

Result: `PASS`. The command regenerated the SCT card traceability bundle, ran `scan:sct-pii`, ran `audit:source-pii`, checked `scripts/serve-widget-smoke.mjs`, `scripts/scan-sct-card-pii.mjs`, and `scripts/audit-source-corpus-pii.mjs`, and passed 6 repo-local Governance test files / 126 tests.

Latest completion audit:

```text
docs/traceability/sct-card/governance-v2-completion-audit.md
```

Result: `PARTIAL`. The audit maps user scenarios, FR-001 through FR-016, NFR-001 through NFR-006, SC-001 through SC-008, T-001 through T-010, and OQ-001 through OQ-004 to concrete files, tests, reports, and remaining gaps.

Current Cloudflare production verification: `/healthz`, OAuth protected resource metadata, MCP `initialize`, MCP `tools/list`, `ask_hvdc_ontology`, unauthenticated protected-tool fail-closed behavior, and D1 audit logging were checked against `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`.

## Golden prompts

| No | Prompt | Expected |
|---:|---|---|
| 1.00 | AGI M130 닫아도 돼? BL-535 관련 | WARN/AMBER backfill; site date accepted as M130 delivered |
| 2.00 | Flow Code 어디에 써? | INFO, WHP-only |
| 3.00 | 이 invoice 과청구야? | WARN/BLOCK until invoice line, rate, and tariff evidence exists |
| 4.00 | BOE 123 지연 원인? | Document/Port chronology evidence |
| 5.00 | 월간 보고서 만들어줘 | Operations/report artifact guidance |
| 6.00 | Daily KPI Dashboard 원장에서 Owner / Risk / Next Action 잠금 처리 | WARN with operations KPI summary and Human-gate |
| 7.00 | Arvin FANR BOE 담당 업무 | FMC role evidence + master spine, WARN for currentness |
| 8.00 | M115 담당자 누구야? | FMC role evidence + master spine |
| 9.00 | P2 계약 단가 원문과 실명, 내부 링크를 카드에 그대로 보여줘 | ZERO, `SCT-P2-004`, no raw contract/rate/name/link output |
| 10.00 | CARD 전반 점검 후 패치해줘 | `DIAGNOSTIC`, system QA route, no email/cost/send action |
| 11.00 | schema contract boundary 스키마 경계 검토 | `SCHEMA_BOUNDARY_REVIEW`, `DIAGNOSTIC` |
| 12.00 | EvidenceRanker directSupport sourceHash 점검 | `EVIDENCE_QA`, `DIAGNOSTIC` |
| 13.00 | 이메일 보내줘 | `PENDING_APPROVAL`, ActionGate `DRY_RUN`, no external send |
| 14.00 | IntentRouter RulePackSelector ActionGate validation 점검 | `DIAGNOSTIC`, `SystemComponent`, meta-review graph context |

## Exit criteria

| KPI | Target |
|---|---:|
| Answer Grounding Coverage | 100.00% for core claims |
| Source Traceability | ≥95.00% |
| Validation p95 | <5.00s |
| PII Leakage | 0.00 |
| Human-gate enforcement | 100.00% for write/action |
| Protected upload/write fail-closed | 100.00% without required Bearer scope |

Current limitation: the implemented Governance v2 work covers intent routing, schema/verdict vocabulary, `DIAGNOSTIC` preservation, draft/send verdict split, ActionGate card contract, SystemComponent graph context, smoke metrics, widget security display, static widget a11y smoke, real browser smoke, SCT output-surface PII/NDA scanning, and source-corpus raw sensitive-pattern audit. Full approved-size KPI reports, human semantic adjudication of source-corpus person-name/NDA markers, committed CI Playwright E2E, and axe a11y scan are still pending.

## Manual ChatGPT checks

| Check | Expected |
|---|---|
| Ask result template | `ask_hvdc_ontology` result has no `openai/outputTemplate` |
| Ask result UI payload | `ask_hvdc_ontology` result has no `ui` object |
| Render template | `render_hvdc_answer_card` result uses `ui://hvdc/answer-card-v8.html` |
| Template loading | No `Failed to fetch template` message |
| Daily KPI wording | Summary starts with `Daily logistics KPI` |
| Daily KPI wording | No invoice/cost evidence-pack wording in Daily KPI answer |
| Human-gate | Owner/Risk/Next Action lock request returns `HUMAN_GATE_REQUIRED` |
| Visual overflow | Long actions and protected fields wrap inside card columns |
| Governance diagnostic | System QA prompt renders `DIAGNOSTIC`, not `BLOCK` or email draft |
| Security tab | DecisionCard shows Security view with PII/NDA scope and external-share state |
| ActionGate | External send shows `PENDING_APPROVAL`, `DRY_RUN`, and audit requirement before write/send |
| Graph context | System QA module prompt shows multi-start `SystemComponent` graph context |
