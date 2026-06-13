# SCT_ONTOLOGY CARD Governance v2 Completion Audit

- audit date: 2026-05-18 02:04:46 +04:00
- objective file: `SCT_ONTOLOGY_CARD_GOVERNANCE_SPEC_v2.md`
- session basis: current Windows Codex session
- verdict: PARTIAL

## Objective Restatement

The concrete objective is to implement and verify the Governance v2 contract for `IntentRouter -> RulePackSelector -> DecisionCard -> ActionGate -> Renderer`.

The system must:

- isolate system/card diagnostic prompts from operational logistics actions;
- require rulepack alignment by intent, domain, and object evidence;
- preserve the Governance v2 verdict vocabulary;
- enforce write/send safety through ActionGate;
- render the required card tabs and security display;
- make metrics, traceability, PII/NDA, and accessibility evidence reproducible.

## Prompt-to-Artifact Checklist

| Item | Requirement | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| US-001 | System diagnostic prompt isolation | DONE | `server/src/router.ts`, `tests/intent-router.test.ts`, `docs/traceability/sct-card/decision-log.md` | None |
| US-002 | Cost review needs object evidence | PARTIAL | `resolveRulePackIds`, `tests/intent-router.test.ts`, `docs/traceability/sct-card/validation-report.md` | Cost object/rate/tariff approved-size regression set is not complete |
| US-003 | Email draft boundary | DONE | `server/src/answer.ts`, `tests/pipeline.test.ts`, `docs/traceability/sct-card/simulation-log.md` | None |
| US-004 | Flow Code boundary enforcement | DONE | `server/src/answer.ts`, `tests/evals.test.ts`, `docs/traceability/sct-card/decision-log.md` | None |
| US-005 | Renderer operator clarity | PARTIAL | `public/hvdc-answer-widget.html`, `tests/widget.test.ts`, `docs/traceability/sct-card/browser-smoke-report.md` | SC-007 rubric-based 95.00% clarity review is not complete |
| US-006 | Write-back safety | DONE | `evaluateActionGate`, `tests/decision-card.test.ts`, `tests/pipeline.test.ts`, `docs/traceability/sct-card/metrics-report.md` | Actual Foundry write-back is non-goal |

## Functional Requirements

| ID | Status | Evidence | Notes |
| --- | --- | --- | --- |
| FR-001 | DONE | `IntentCode`, `classifyIntent`, `tests/intent-router.test.ts` | All 8 system QA intents are represented and tested |
| FR-002 | DONE | hard-negative terms in `server/src/router.ts`, router tests | System/card QA prompts do not route to email/cost/send lanes |
| FR-003 | PARTIAL | `RULEPACK_REGISTRY`, `resolveRulePackIds`, validation report | Smoke-covered; larger matrix still needed |
| FR-004 | PARTIAL | `COST_RULEPACK` selection gates, `cost-guard` traceability scenario | Needs approved invoice/rate/tariff object evidence set |
| FR-005 | DONE | email draft/send branch in `server/src/answer.ts`, `tests/pipeline.test.ts` | Draft-only and external-send split is tested |
| FR-006 | PARTIAL | verdict enums in `server/src/types.ts`, zod/json schemas, decision card tests | Enum coverage is complete; derivation matrix for `NEEDS_INPUT`, `DRY_RUN_ONLY`, `PASS_WITH_FINDINGS` remains limited |
| FR-007 | DONE | Flow Code boundary validation, golden evals | Flow Code route/customs misuse blocks |
| FR-008 | PARTIAL | `EvidenceScore`, `tests/evidence-ranker.test.ts` | Top-3 direct evidence KPI report is not full-size |
| FR-009 | DONE | stopword guard in `resolveAnyKey`, `tests/intent-router.test.ts` | Generic operational startNode leakage smoke metric is 0 |
| FR-010 | DONE | `SystemComponent` entity type and resolver map | IntentRouter, RulePackSelector, EvidenceRanker, DecisionCard, Renderer, ActionGate, ValidationEngine covered |
| FR-011 | DONE | `ActionRecommendation`/DecisionCard action payload fields | Required action fields are in type, schema, zod, and tests |
| FR-012 | DONE | `evaluateActionGate`, decision-card tests, pipeline send test | `DRY_RUN -> APPROVAL -> WRITE -> AUDIT_RECORD` is enforced at card contract level |
| FR-013 | DONE | `GraphPath.startNodes`, `riskEdges`, `operationalObjects`, `isMetaReview` | System QA meta-review graph context is tested |
| FR-014 | DONE | widget tabs, widget tests, browser smoke | Decision/Evidence/Validation/Entities/Actions/Trace/Security are rendered |
| FR-015 | DONE | widget header and decision card panels | Verdict, why/primary reason, blockedBy, nextAction/actions, humanGate are visible |
| FR-016 | DONE | Security tab and `scan:sct-pii` | Security display exists; output-surface PII/NDA scan passes |

## Non-Functional Requirements

| ID | Status | Evidence | Gap |
| --- | --- | --- | --- |
| NFR-001 | PARTIAL | `docs/traceability/sct-card/metrics-report.md` | Reproducible smoke set exists; approved full prompt set is not defined |
| NFR-002 | DONE | ActionGate tests and metrics report | Unauthorized write-back count is 0 in smoke metrics |
| NFR-003 | PARTIAL | deterministic traceability script and unit tests | Snapshot-style deterministic output test is limited to current smoke outputs |
| NFR-004 | PARTIAL | static widget a11y test and Playwright MCP accessibility snapshot | axe-core automated scan is not complete |
| NFR-005 | DONE | simulation/validation/metrics reports | Evidence and action outputs have trace fields and audit flags |
| NFR-006 | PARTIAL | Security tab, PII/NDA ZERO gate, `pii-nda-scan-report.md`, `source-corpus-pii-nda-audit.md` | Source corpus raw pattern audit is complete; human semantic adjudication of person-name/NDA-sensitive references remains |

## Success Criteria

| ID | Target | Status | Evidence | Gap |
| --- | --- | --- | --- | --- |
| SC-001 | Router accuracy >= 95.00% | PARTIAL | `metrics-report.md` smoke accuracy 100.00% | Approved QA/operational prompt set size is unresolved |
| SC-002 | False CostGuard block reduction >= 80.00% | NOT DONE | None | Before/after QA set missing |
| SC-003 | Top-3 direct evidence coverage >= 90.00% | PARTIAL | evidence-ranker unit tests | Full report missing |
| SC-004 | Action audit completeness 100.00% | DONE | `metrics-report.md` smoke audit completeness 100.00% | None for smoke scope |
| SC-005 | Unauthorized write-back 0.00% | DONE | `metrics-report.md`, ActionGate tests | None for smoke scope |
| SC-006 | Generic operational startNode leakage 0.00% | DONE | generic-stopword scenario, intent-router tests | None for smoke scope |
| SC-007 | Renderer nextAction clarity >= 95.00% | PARTIAL | browser smoke and widget tests | Manual or rubric-based UX review missing |
| SC-008 | Monthly router/rulepack regression pass >= 98.00% | NOT DONE | None | Monthly regression runner/report missing |

## Acceptance Tests

| Test ID | Status | Evidence | Gap |
| --- | --- | --- | --- |
| T-001 | DONE | `system-diagnostic` scenario, router tests | None |
| T-002 | DONE | hard-negative router tests and validation report | None for smoke scope |
| T-003 | PARTIAL | `cost-guard` scenario | Needs richer invoice/rate/tariff evidence fixture |
| T-004 | PARTIAL | customs validation tests in existing suite | Needs explicit Governance v2 traceability row |
| T-005 | DONE | MOSB route gate tests in `tests/dual-mcp.test.ts` | None |
| T-006 | DONE | `email-draft` scenario and pipeline tests | None |
| T-007 | DONE | `email-send-action-gate` scenario and pipeline tests | None |
| T-008 | DONE | `flow-code-boundary` scenario and evals | None |
| T-009 | DONE | widget tests and browser smoke | None for smoke/browser scope |
| T-010 | DONE | ActionGate tests and send scenario | None |

## Explicit Open Questions

| ID | Status | Blocking effect |
| --- | --- | --- |
| OQ-001 | OPEN | Prevents full SC-001 approval-size accuracy claim |
| OQ-002 | OPEN | Prevents full SC-007 operator clarity claim |
| OQ-003 | OPEN | Audit store authority remains undefined for future real write-back |
| OQ-004 | PARTIALLY ADDRESSED | Literal accessible tabs are implemented, but final acceptance still depends on reviewer interpretation |

## Current Verdict

PARTIAL

The implementation covers the high-risk runtime safety path, system QA isolation, ActionGate, Renderer/Security tabs, browser smoke, and SCT output-surface PII/NDA scan.

It is not complete against the full spec because approved-size KPI evidence, before/after CostGuard reduction, human semantic adjudication of source-corpus person-name/NDA markers, CI Playwright E2E, axe scan, and rubric-based operator clarity review remain open.
