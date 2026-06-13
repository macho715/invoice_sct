# Feature Specification: Decision Card v2

Feature ID/Branch: `042-decision-card-v2`
Created: 2026-05-17
Status: In Review
Owner: Product / UX / Frontend / Platform
Input: `Decision Card v2 상세 방법 문서` 기반 재구성
Last Updated: 2026-05-17
Version: v0.1.0

---

## Summary

### Problem

기존 Decision Card는 판단 결과 자체보다 설명과 근거가 길게 노출되어, 운영자가 다음 5가지를 즉시 판단하기 어렵다.

1. 현재 상태가 `PASS`, `WARN`, `BLOCK` 중 무엇인지
2. 왜 해당 상태인지
3. 무엇을 보완하면 해제되는지
4. 누가 다음 조치를 수행해야 하는지
5. 어떤 evidence와 approval trace가 남는지

특히 `Cost`, `Invoice`, `Tariff`, `BOE`, `DO`, `P2`, `PII`, `Report Publication` 관련 판단은 잘못된 `PASS`가 발생하면 승인 오류, 비용 오판, NDA/PII 노출, 외부 발행 사고로 이어질 수 있다. 따라서 Decision Card v2는 “설명 카드”가 아니라 “운영 의사결정 카드”로 동작해야 한다.

### Goals

- G1: 사용자가 Decision Card 상단에서 `PASS/WARN/BLOCK`, primary reason, unblock input을 5초 이내에 파악한다.
- G2: `BLOCK` 상태에서 사용자가 missing evidence를 1 click 이내에 확인한다.
- G3: `Cost judgment`, `Invoice approval`, `Report publication`, `External send/share`, `P2 export`는 approval gate 없이는 실행되지 않는다.
- G4: P2 원문, 단가, 실명, 연락처, 내부 링크는 카드 본문에 직접 노출되지 않는다.
- G5: 모든 판단은 `ruleId`, `evidenceId`, `sourceHash`, `generatedAt`, `approvalStatus`로 audit trace를 남긴다.
- G6: `E2E`, `a11y`, `redaction`, `export guard`, `approval gate` 테스트가 release gate에 포함된다.
- G7: v1 대비 Time-to-Decision과 missing evidence 식별 시간을 측정 가능하게 만든다.

### Non-Goals

- NG1: 전체 대시보드 리디자인은 포함하지 않는다.
- NG2: 실제 계약 단가, 운임, 세관 규정, 통관 적정성 검증 자체는 포함하지 않는다.
- NG3: 자동 승인, 자동 송신, 자동 정산, 자동 외부 발행은 포함하지 않는다.
- NG4: P2 원문 저장소 또는 권한 시스템 자체 구축은 포함하지 않는다.
- NG5: AI agent가 irreversible tool execution을 승인 없이 수행하는 기능은 포함하지 않는다.
- NG6: 모든 route document를 카드 안에 원문 렌더링하는 기능은 포함하지 않는다.

---

## Product Principles

| No | Principle | Definition | Enforcement |
|---:|---|---|---|
| 1 | Decision-first | 카드의 첫 목적은 읽기보다 판단이다. | Header에 verdict/reason/unblock을 고정한다. |
| 2 | Evidence-bound | 모든 판단은 evidence와 rule trace에 연결된다. | `blockedBy[]`, `evidenceCoverage[]`, `trace` 필수화 |
| 3 | Human-gated | 위험 행동은 승인 전 실행되지 않는다. | `approvalRequired=true`이면 publish/export/approval disabled |
| 4 | Masked by default | 민감 데이터는 원문 대신 ID, 요약, redacted snippet만 표시한다. | P2/PII redaction test 필수 |
| 5 | Testable contract | Spec, schema, UI, tests가 같은 ID 체계를 공유한다. | FR/NFR/SC/AC/Rule ID traceability 유지 |

---

## User Scenarios & Testing

### User Story 1 - BLOCK 상태 즉시 판단 (Priority: P1)

운영자는 Decision Card를 열었을 때 `BLOCK` 여부, 차단 사유, 해제 입력, 차단된 행동을 즉시 확인해야 한다.

Why this priority: `BLOCK` 판단을 빠르게 이해하지 못하면 Cost/Invoice/Report 작업이 잘못 진행될 수 있다.

Independent Test: `RateRef`, `TariffRef`가 누락된 `DecisionCardPayload`를 입력했을 때 Header와 BlockReasonBox가 기대값을 표시하는지 단독 검증한다.

Acceptance Scenarios:

1. Given `missingRequiredInputs`에 `RateRef`, `TariffRef`가 포함되어 있고 `verdict=BLOCK`인 payload가 있다, When 사용자가 Decision Card를 연다, Then 상단 Header는 `VERDICT: BLOCK`, primary reason, unblock summary를 표시한다.
2. Given `blockedBy[]`에 `SCT-COST-001`이 있다, When 사용자가 BLOCK 영역을 본다, Then `ruleId`, `ruleName`, reason, required inputs, blocked actions가 표시된다.
3. Given `Cost judgment`가 blocked action에 포함되어 있다, When 사용자가 Cost judgment 버튼을 본다, Then 버튼은 disabled 상태이고 disable reason을 표시한다.

### User Story 2 - Missing Evidence 해제 작업 수행 (Priority: P1)

Cost Owner 또는 Docs Owner는 누락된 입력을 확인하고, 해당 evidence 업로드 또는 연결 액션을 수행해야 한다.

Why this priority: `BLOCK` 해제는 evidence 보강 없이는 불가능하다.

Independent Test: `UnblockChecklist`에 missing/provided/invalid/pending approval 상태를 주입하고 각 상태별 UI와 동작을 검증한다.

Acceptance Scenarios:

1. Given `RateRef`가 missing 상태다, When 사용자가 `RateRef` 항목을 클릭한다, Then 업로드 또는 evidence 연결 모달이 열린다.
2. Given `BOE Evidence`가 provided 상태다, When 사용자가 해당 항목을 클릭한다, Then Evidence Drawer가 열리고 redacted snippet과 sourceHash가 표시된다.
3. Given `TariffRef`가 invalid 상태다, When 사용자가 해당 항목을 클릭한다, Then Validation 탭으로 이동하고 invalid reason이 표시된다.

### User Story 3 - Evidence 검증 및 감사 추적 (Priority: P1)

Reviewer 또는 Auditor는 판단에 사용된 evidence의 출처, confidence, PII status, sourceHash를 확인해야 한다.

Why this priority: 판단 결과가 있어도 evidence trace가 없으면 감사와 재현이 불가능하다.

Independent Test: `EvidenceItem` 2건을 입력하고 Drawer, Evidence table, Trace panel이 동일한 evidence ID를 참조하는지 검증한다.

Acceptance Scenarios:

1. Given `E-001` evidence가 있다, When 사용자가 Evidence table에서 `E-001`을 클릭한다, Then Drawer는 doc type, section, redacted snippet, confidence, sourceHash, dataClass, piiStatus를 표시한다.
2. Given evidence가 P2 원문 접근을 요구한다, When 사용자가 View original을 보려 한다, Then 버튼은 disabled 상태이고 `P2 material requires approved access` reason을 표시한다.
3. Given `sourceHash`가 누락되어 있다, When Validation 탭이 실행된다, Then 해당 evidence는 decision-usable 상태가 아니라 `WARN` 또는 `BLOCK`으로 표시된다.

### User Story 4 - Human-gate 승인 전 위험 행동 차단 (Priority: P1)

운영자는 승인되지 않은 상태에서 Invoice approval, Cost judgment, Report publication, External send/share, P2 export를 실행할 수 없어야 한다.

Why this priority: 위험 행동 자동 실행은 비용, 계약, 보안 사고로 이어질 수 있다.

Independent Test: `approvalRequired=true`, `approvalStatus=Pending` 상태에서 publish/export/action 버튼이 차단되는지 검증한다.

Acceptance Scenarios:

1. Given `approvalRequired=true`이고 `approvalStatus=Pending`이다, When 사용자가 Publish Report를 클릭한다, Then 실행은 차단되고 HumanGateBanner가 표시된다.
2. Given approver가 action summary, target data, risk, reversibility를 확인했다, When approver가 승인한다, Then `approvalActor`, `approvedAt`, `approvalStatus=Approved`가 trace에 저장된다.
3. Given approver가 취소한다, When action is rejected, Then action status는 `Rejected`가 되고 publish/export는 계속 disabled 상태다.

### User Story 5 - PASS/WARN 상태에서 안전한 Export 수행 (Priority: P2)

사용자는 상태에 따라 허용된 export만 수행해야 한다.

Why this priority: `WARN` 또는 `BLOCK` 상태의 외부 발행은 통제되어야 하지만, 내부 검토용 dry-run은 허용될 수 있다.

Independent Test: verdict별 export policy matrix를 입력하고 `Copy JSON`, `Export PDF Draft`, `Publish Report` 버튼 상태를 검증한다.

Acceptance Scenarios:

1. Given `verdict=BLOCK`이고 `piiStatus=Masked`다, When 사용자가 Export PDF Draft를 선택한다, Then watermark `DRY-RUN`이 포함된 draft만 생성 가능하다.
2. Given `verdict=PASS`이고 `approvalStatus=Approved`다, When 사용자가 Publish Report를 선택한다, Then audit trace가 포함된 report publication이 허용된다.
3. Given `piiStatus=Risk`다, When 사용자가 export를 시도한다, Then Copy redacted JSON 외 export/publish는 차단된다.

### User Story 6 - Keyboard-only 및 접근성 사용 (Priority: P2)

Keyboard-only 사용자와 screen reader 사용자는 모든 핵심 정보를 접근 가능하게 확인해야 한다.

Why this priority: Decision Card는 운영 도구이므로 접근성 차단은 release blocker다.

Independent Test: keyboard-only tab sequence와 screen reader label을 E2E/a11y smoke로 검증한다.

Acceptance Scenarios:

1. Given 사용자가 keyboard만 사용한다, When Tab key로 이동한다, Then focus order는 Header → Checklist → Actions → Tabs → Drawer trigger 순서를 유지한다.
2. Given Evidence Drawer가 열린다, When 사용자가 ESC를 누른다, Then Drawer가 닫히고 focus는 원래 trigger로 복귀한다.
3. Given `PASS/WARN/BLOCK` badge가 표시된다, When color perception 없이 확인한다, Then 텍스트만으로 상태 의미를 이해할 수 있다.

### Edge Cases

| ID | Edge Case | Expected Behavior |
|---|---|---|
| EC1 | payload가 비어 있음 | `Empty` 상태와 retry/action 안내 표시 |
| EC2 | schema validation 실패 | `Error` 상태, invalid field list, raw P2 data 미표시 |
| EC3 | `verdict=PASS`이나 `blockedBy[]` 존재 | fail-safe로 `BLOCK` 우선 적용 및 validation warning 표시 |
| EC4 | `piiStatus=Risk` | export/publish/action 차단, PII remediation action 생성 |
| EC5 | `confidence < 0.60` | high-risk domain이면 `BLOCK`, 그 외 manual review |
| EC6 | approval이 expired 상태 | approval 재요청 전 publish/export 차단 |
| EC7 | unblock input이 5개 초과 | Header는 5개까지만 표시하고 `+N more` 표시 |
| EC8 | owner가 비어 있음 | Action status를 `Unassigned`로 표시하고 Owner assignment action 생성 |
| EC9 | duplicate evidenceId 존재 | validation warning, latest/selected version 표시 기준 필요 |
| EC10 | 원문 접근 권한 없음 | View original disabled + reason 표시 |
| EC11 | generatedAt timezone 누락 | UTC로 표시하되 Trace에 timezone missing warning 기록 |
| EC12 | long reason text | Header는 80자 이내 truncate, 상세는 BlockReasonBox에 표시 |

---

## Requirements

### Functional Requirements

| ID | Requirement | Priority | Verification |
|---|---|---:|---|
| FR-001 | System MUST render a fixed `VerdictHeader` at the top of the card. | P0 | UI/E2E |
| FR-002 | System MUST display `PASS`, `WARN`, or `BLOCK` as text, not color only. | P0 | a11y |
| FR-003 | System MUST display primary reason in the Header within 80 characters. | P0 | UI unit |
| FR-004 | System MUST display unblock summary with a maximum of 5 inputs and `+N more` for overflow. | P0 | UI unit |
| FR-005 | System MUST render `BlockReasonBox` when verdict is `BLOCK`. | P0 | UI/E2E |
| FR-006 | `BlockReasonBox` MUST include `ruleId`, `ruleName`, human-readable reason, required inputs, and blocked actions. | P0 | UI/E2E |
| FR-007 | System MUST derive or validate `BLOCK` when any required evidence is missing. | P0 | rule unit |
| FR-008 | System MUST derive or validate `BLOCK` when `piiStatus=Risk`. | P0 | rule/security test |
| FR-009 | System MUST derive or validate `BLOCK` when approval is required but not approved. | P0 | rule/E2E |
| FR-010 | System MUST display `UnblockChecklist` for missing/provided/invalid/pending approval states. | P0 | UI/E2E |
| FR-011 | Clicking a missing input MUST open an upload/link workflow or show an unavailable reason. | P1 | E2E |
| FR-012 | Clicking a provided evidence item MUST open `EvidenceDrawer`. | P1 | E2E |
| FR-013 | `EvidenceDrawer` MUST show doc type, section, redacted snippet, confidence, sourceHash, dataClass, and piiStatus. | P1 | UI/E2E |
| FR-014 | System MUST never render P2 original text, raw rates, personal contact data, or internal links in the card body. | P0 | redaction/security test |
| FR-015 | System MUST represent P2 data using Material ID, redacted snippet, and sourceHash. | P0 | security review |
| FR-016 | System MUST show `HumanGateBanner` when approval-gated actions are present and not approved. | P0 | UI/E2E |
| FR-017 | System MUST block `Invoice approval`, `Cost judgment`, `Report publication`, `External send/share`, `P2 export`, and irreversible tool execution until approved. | P0 | E2E/security |
| FR-018 | Approval UI MUST show action summary, target data, risk, reversibility, approve/cancel controls, and trace output. | P0 | UI review |
| FR-019 | System MUST persist approval actor, approval status, approval timestamp, and action result in trace. | P0 | integration |
| FR-020 | System MUST display `EvidenceCoverageBar` by domain with `PASS/WARN/BLOCK` status. | P1 | UI unit |
| FR-021 | System MUST display `ActionTable` with owner, action, required input, due, gate, evidence status, and current status. | P1 | UI/E2E |
| FR-022 | System MUST support action statuses: `Open`, `Pending Input`, `Pending Approval`, `Done`, `Rejected`, `Expired`, `Unassigned`. | P1 | unit |
| FR-023 | System MUST provide tabs: `Summary`, `Evidence`, `Actions`, `Validation`, `Trace`. | P1 | UI/E2E |
| FR-024 | Validation tab MUST show rule ID, severity, message, result, and remediation guidance. | P1 | UI/E2E |
| FR-025 | Trace tab MUST show generatedAt, routeId, sourceHash, rulePackVersion, promptVersion, approvalActor, approvalStatus, and sensitiveAccessed. | P1 | UI/E2E |
| FR-026 | Copy JSON MUST always export only redacted payload. | P0 | security test |
| FR-027 | Export PDF Draft MUST be allowed for `WARN/BLOCK` only with `DRY-RUN` watermark and redacted content. | P1 | E2E/security |
| FR-028 | Publish Report MUST require `PASS` and approved approval trace. | P0 | E2E/security |
| FR-029 | System MUST produce traceability artifacts for decision log, simulation log, validation report, changelog, screenshots, and perf. | P2 | release checklist |
| FR-030 | System MUST fail safe to `BLOCK` when high-risk required fields are missing or contradictory. | P0 | rule/security test |

### Non-Functional Requirements

| ID | Category | Requirement | Target | Verification |
|---|---|---|---:|---|
| NFR-001 | Performance | Card summary area SHOULD render quickly for normal payloads. | Header visible ≤ 1.00 sec for 100 evidence items | perf test |
| NFR-002 | Decision Speed | Users SHOULD identify verdict/reason/unblock quickly. | 90.00% of test users within 5.00 sec | usability test |
| NFR-003 | Security/Privacy | P2/PII raw exposure MUST be zero. | 0.00 raw P2/PII leaks in test suite | redaction test |
| NFR-004 | Reliability | Invalid or partial payload MUST not produce false `PASS`. | 100.00% fail-safe to `WARN/BLOCK` for invalid high-risk data | rule test |
| NFR-005 | Auditability | All gated actions MUST be traceable. | 100.00% approval-gated actions have actor/status/timestamp | integration test |
| NFR-006 | Accessibility | Core flows MUST be keyboard accessible. | 100.00% P1 keyboard flows pass | a11y E2E |
| NFR-007 | Accessibility | Status meaning MUST not rely on color only. | 100.00% badge states include visible text | a11y check |
| NFR-008 | Maintainability | Rule, schema, UI, and tests SHOULD share stable IDs. | 100.00% P0 rules mapped to FR/AC/SC | traceability review |
| NFR-009 | Observability | Decision and action events SHOULD be measurable. | 95.00% card sessions emit analytics events | analytics QA |
| NFR-010 | Data Minimization | Card payload SHOULD exclude raw source documents. | 100.00% source docs replaced by IDs/snippets/hash | schema/security review |

---

## Key Entities / Data

### Entity Definitions

| Entity | Description | Key Attributes | Notes |
|---|---|---|---|
| `DecisionCardPayload` | Card rendering and decision contract | cardId, routeId, generatedAt, verdict, primaryReason, blockedBy, evidenceCoverage, actions, trace, piiStatus | Frontend/backend contract |
| `Verdict` | Final decision state | PASS, WARN, BLOCK | BLOCK has fail-safe precedence |
| `BlockedRule` | Rule that caused block/warn | ruleId, ruleName, reason, requiredInputs, missingInputs, severity | Displayed in BlockReasonBox |
| `EvidenceItem` | Redacted evidence reference | evidenceId, domain, docType, section, snippetRedacted, confidence, sourceHash, dataClass, piiStatus, usableForDecision | No raw P2/PII |
| `ActionItem` | Work queue item | actionId, ownerRole, ownerNameMasked, actionType, requiredInput, gate, evidenceStatus, status, dueAt | ActionTable source |
| `ApprovalTrace` | Human-gate record | approvalRequired, approvalStatus, approvalActor, approvedAt, rejectedReason | Required for publish/export |
| `ExportPolicy` | Export permission matrix | exportType, allowedVerdicts, requiredApproval, watermark, redactionRequired | Drives ExportControls |
| `ValidationResult` | Rule validation output | ruleId, severity, message, result, remediation | Validation tab source |

### Enum Definitions

| Enum | Values |
|---|---|
| `Verdict` | `PASS`, `WARN`, `BLOCK` |
| `PiiStatus` | `None`, `Masked`, `Risk` |
| `EvidenceStatus` | `PASS`, `WARN`, `BLOCK` |
| `ApprovalStatus` | `NotRequired`, `Pending`, `Approved`, `Rejected`, `Expired` |
| `ActionStatus` | `Open`, `Pending Input`, `Pending Approval`, `Done`, `Rejected`, `Expired`, `Unassigned` |
| `ExportType` | `Copy JSON`, `Export PDF Draft`, `Publish Report` |
| `DataClass` | `P0`, `P1`, `P2` 또는 조직 표준 분류값 [NEEDS CLARIFICATION: 실제 data classification 체계 확인 필요] |

---

## Interfaces & Contracts

### DecisionCardPayload Contract

| Field | Required | Type | Rule |
|---|---:|---|---|
| `cardId` | Yes | string | Unique card ID |
| `routeId` | Yes | string | Route/material ID; sensitive part redacted |
| `generatedAt` | Yes | datetime | Asia/Dubai 또는 UTC 표시 |
| `verdict` | Yes | enum | `PASS/WARN/BLOCK` |
| `severity` | Yes | enum/string | P0/P1/P2 등 |
| `primaryReason` | Yes | string | Header 80자 이내 권장 |
| `unblockSummary` | Required when BLOCK/WARN | string | Missing inputs summary |
| `piiStatus` | Yes | enum | `None/Masked/Risk` |
| `dataClass` | Yes | enum/string | P2면 raw render 금지 |
| `blockedBy[]` | Required when BLOCK | array | Rule trace |
| `allowedActions[]` | Yes | array | Allowed actions |
| `blockedActions[]` | Required when BLOCK/WARN | array | Disabled actions |
| `evidenceCoverage[]` | Yes | array | Domain-level evidence status |
| `actions[]` | Yes | array | Operational queue |
| `trace` | Yes | object | sourceHash, versions, approval trace |

### Minimum Rule Matrix

| Rule ID | Condition | Verdict | Required Inputs | Blocked Actions | Severity |
|---|---|---|---|---|---|
| SCT-COST-001 | Cost evidence missing | BLOCK | InvoiceLine, RateRef, TariffRef | Cost judgment, Invoice approval | P0 |
| SCT-DOC-002 | BOE/DO/Port evidence missing for operational decision | BLOCK/WARN | BOE, DO, Port evidence | Report publication | P0/P1 |
| SCT-PII-003 | PII unmasked or suspected | BLOCK | Redaction proof | Export, Publish, External share | P0 |
| SCT-P2-004 | P2 raw text/rate/internal link exposed | BLOCK | Material ID, redacted snippet, sourceHash | Export, Publish | P0 |
| SCT-APP-005 | Approval required but not approved | BLOCK | Approval actor/status | Invoice approval, Publish, External send | P0 |
| SCT-CONF-006 | Confidence below high-risk threshold | BLOCK/WARN | Manual review or stronger evidence | Cost judgment, Publish | P1 |
| SCT-SCHEMA-007 | Required contract fields missing | BLOCK | Valid DecisionCardPayload | All high-risk actions | P0 |

### Export Policy Matrix

| Export | PASS | WARN | BLOCK | Approval Required | Data Rule |
|---|---:|---:|---:|---:|---|
| Copy JSON | Yes | Yes | Yes | No | Redacted payload only |
| Export PDF Draft | Yes | Yes | Yes | Optional by org policy | Watermark `DRY-RUN` for WARN/BLOCK |
| Publish Report | Yes | No | No | Yes | Audit trace included |
| External Send/Share | Yes | No | No | Yes | P2/PII policy check required |
| P2 Material Export | Conditional | No | No | Yes | Role-based access required |

### UI Component Contract

| Component | Input | Output | Required States |
|---|---|---|---|
| `DecisionCard` | DecisionCardPayload | Full card container | Loading, Empty, Error, Ready |
| `VerdictHeader` | verdict, reason, unblock, piiStatus, generatedAt | Top fixed decision summary | PASS, WARN, BLOCK |
| `BlockReasonBox` | blockedBy[], blockedActions[] | BLOCK reason panel | Visible when BLOCK |
| `UnblockChecklist` | required/missing inputs | Input checklist | Missing, Provided, Invalid, Pending Approval |
| `HumanGateBanner` | approvalRequired/status/action | Approval guard | Required, Pending, Approved, Rejected |
| `EvidenceCoverageBar` | evidenceCoverage[] | Domain evidence status | PASS, WARN, BLOCK |
| `ActionTable` | actions[] | Operational queue | Open, Pending, Done, Rejected, Expired |
| `EvidenceDrawer` | EvidenceItem | Evidence detail | Open, Closed, Access denied |
| `TracePanel` | trace | Audit details | Redacted, Available, Missing |
| `ExportControls` | verdict, piiStatus, approvalStatus | Export/publish controls | Dry-run, Approved, Disabled |

### Events / Analytics Contract

| Event | Trigger | Required Properties |
|---|---|---|
| `decision_card_viewed` | Card ready state | cardId, verdict, generatedAt, userRoleMasked |
| `block_reason_viewed` | BLOCK panel expanded | cardId, ruleId, severity |
| `unblock_input_clicked` | Checklist item clicked | cardId, inputName, inputStatus |
| `evidence_drawer_opened` | Evidence opened | cardId, evidenceId, docType, piiStatus |
| `approval_requested` | Human gate request | cardId, actionId, actionType |
| `approval_completed` | Approve/reject | cardId, actionId, approvalStatus |
| `export_attempted` | Export button clicked | cardId, exportType, allowed, blockedReason |
| `validation_failed` | Rule/schema validation fails | cardId, ruleId, severity |

---

## UX Requirements

### Layout Order

1. Verdict Header
2. Human-gate Banner, when applicable
3. Executive Summary
4. Evidence Coverage
5. Action Queue
6. Tabs: Summary / Evidence / Actions / Validation / Trace

### Header Display Rules

| Field | Rule |
|---|---|
| Verdict | Always visible, text-based |
| Primary Reason | 80 characters max in Header |
| Unblock Summary | 3-5 inputs; overflow as `+N more` |
| PII Badge | exactly one of `PII: None`, `PII: Masked`, `PII: Risk` |
| Generated At | Same value as Trace tab |

### BlockReasonBox Display Rules

When `verdict=BLOCK`, this section is mandatory.

| Field | Requirement |
|---|---|
| Blocked by | `ruleId + ruleName` 표시 |
| Reason | 사람이 읽을 수 있는 설명 |
| Required Inputs | 해제에 필요한 입력 목록 |
| Blocked Actions | 현재 금지된 행동 목록 |
| Remediation | 다음 owner/action 연결 |

### Tab Requirements

| Tab | Purpose | Mandatory Content |
|---|---|---|
| Summary | 빠른 판단 | verdict, reason, business impact, next action, owner, due |
| Evidence | 감사/검증 | evidenceId, domain, docType, section, confidence, PII, usable |
| Actions | 운영 실행 | owner, action, due, gate, evidence, status |
| Validation | 시스템 검증 | ruleId, severity, message, result, remediation |
| Trace | audit | generatedAt, routeId, sourceHash, rulePackVersion, promptVersion, approvalActor, approvalStatus, sensitiveAccessed |

---

## Security, Privacy & Compliance Rules

### Data Rendering Policy

| Data | Card Display | Original Access | Rule |
|---|---|---|---|
| Contract original text | clause ID + summary | Separate Materials store | Raw render forbidden |
| Rate / unit price | RateRef ID / range / Masked | Permission required | Raw rate forbidden |
| Real name/contact | masked owner | Permission required | PII raw forbidden |
| Internal links | Not displayed | Permission required | Link render forbidden |
| BOE/DO | doc ID + section + redacted snippet | Permission required | Redacted only |

### PII Badge Semantics

| Badge | Meaning | Result |
|---|---|---|
| `PII: None` | No PII detected | Display allowed |
| `PII: Masked` | PII detected and masked | Display allowed |
| `PII: Risk` | PII suspected or masking failed | BLOCK |

### Fail-safe Rules

- Any unmasked P2/PII exposure MUST force `BLOCK`.
- Any approval-gated action without `Approved` status MUST force `BLOCK` for that action.
- Any high-risk contradiction between verdict and validation rules MUST force `BLOCK`.
- Any missing `sourceHash` for decision-critical evidence MUST force `WARN` or `BLOCK` depending on domain severity.
- No UI path may expose raw P2 original through hover, tooltip, debug output, copy JSON, PDF draft, or browser console logs.

---

## Assumptions & Dependencies

### Assumptions

| ID | Assumption | Status |
|---|---|---|
| A1 | 구현 환경은 React/Next.js 계열 web dashboard다. | [NEEDS CLARIFICATION: 실제 stack 확인 필요] |
| A2 | Backend는 `DecisionCardPayload` 형태의 JSON을 제공한다. | Draft assumption |
| A3 | P2 original material은 별도 권한 저장소에서 관리된다. | Draft assumption |
| A4 | Rule matrix는 backend 또는 shared rule package에서 관리된다. | Draft assumption |
| A5 | Initial confidence threshold는 High ≥ 0.80, Medium 0.60-0.79, Low < 0.60이다. | Needs calibration |
| A6 | External SaaS/license 추가비는 AED 0.00으로 가정한다. | Cost assumption |
| A7 | 내부 인건비 단가는 제공되지 않았으므로 금액 산정은 제외한다. | ZERO for cost estimate |
| A8 | Asia/Dubai timezone을 운영 기본 표시 timezone으로 사용한다. | Draft assumption |

### Dependencies

| ID | Dependency | Owner | Risk |
|---|---|---|---|
| D1 | Backend schema provider | Platform | Schema drift |
| D2 | Rule matrix / rule pack | Product / Platform | False PASS risk |
| D3 | Materials permission store | Security / Platform | P2 access control gap |
| D4 | Design system components | Frontend / UX | Inconsistent UI states |
| D5 | E2E test framework | QA / Frontend | Missing regression coverage |
| D6 | a11y test tooling | QA / Frontend | Release blocker |
| D7 | Analytics/event pipeline | Data / Platform | KPI measurement gap |
| D8 | Approval actor identity source | IAM / Platform | Weak audit trace |

---

## Success Criteria

### Measurable Outcomes

| ID | Metric | Target | Measurement |
|---|---|---:|---|
| SC-001 | Time-to-Decision | 90.00% users identify verdict/reason/unblock within 5.00 sec | usability test |
| SC-002 | Missing evidence discoverability | 95.00% test users find missing evidence within 1 click | usability/E2E |
| SC-003 | BLOCK reason completeness | 100.00% BLOCK cards show ruleId, reason, required inputs, blocked actions | UI/E2E |
| SC-004 | P2/PII raw exposure | 0.00 raw P2/PII exposure in UI/export/log tests | security/redaction test |
| SC-005 | Approval gate enforcement | 100.00% gated actions blocked until approved | E2E/security |
| SC-006 | Publish guard correctness | 100.00% Publish Report requires PASS + approval | E2E |
| SC-007 | Trace completeness | 100.00% decision-critical cards include generatedAt, routeId, sourceHash, rulePackVersion, approvalStatus | integration |
| SC-008 | Evidence Drawer completeness | 100.00% opened evidence shows required redacted metadata | E2E |
| SC-009 | Accessibility | 100.00% P1 keyboard flows pass | a11y smoke |
| SC-010 | Regression suite | 100.00% P0 rule tests pass before release | CI |
| SC-011 | Schema validity | 100.00% accepted payloads validate against schema | contract test |
| SC-012 | False PASS prevention | 100.00% invalid high-risk payloads fail safe to WARN/BLOCK | rule test |

---

## Acceptance Criteria

| ID | Acceptance Criteria | Linked Requirements |
|---|---|---|
| AC-001 | BLOCK 카드 최상단에 verdict, primary reason, unblock inputs가 보인다. | FR-001, FR-003, FR-004 |
| AC-002 | BLOCK 카드에는 `BlockReasonBox`가 표시되고 ruleId/reason/required inputs/blocked actions가 모두 보인다. | FR-005, FR-006 |
| AC-003 | 사용자는 1 click 이내에 missing evidence 목록을 확인한다. | FR-010, FR-011 |
| AC-004 | Evidence ID 클릭 시 doc type, section, redacted snippet, confidence, sourceHash가 표시된다. | FR-012, FR-013 |
| AC-005 | `PII: Risk`이면 Copy redacted JSON 외 모든 export/publish는 차단된다. | FR-008, FR-026, FR-028 |
| AC-006 | 승인 필요 action은 approval actor 없이 실행되지 않는다. | FR-016, FR-017, FR-019 |
| AC-007 | 모든 action은 owner, due, gate, evidence status, current status를 가진다. | FR-021, FR-022 |
| AC-008 | Trace 탭은 generatedAt, routeId, sourceHash, rulePackVersion, promptVersion, approvalStatus를 표시한다. | FR-025 |
| AC-009 | Keyboard-only 사용자가 모든 탭과 drawer를 사용할 수 있다. | NFR-006 |
| AC-010 | E2E-smoke, a11y-smoke, redaction, export guard 결과가 validation report에 저장된다. | FR-029, NFR-008 |
| AC-011 | `verdict=PASS`라도 `blockedBy[]`가 존재하면 fail-safe validation warning 또는 BLOCK이 발생한다. | FR-030 |
| AC-012 | Header의 status badge는 색상 없이 텍스트만으로 의미가 구분된다. | FR-002, NFR-007 |

---

## Test Plan

### Test Matrix

| Test Type | Scenario | Expected Result | Priority |
|---|---|---|---:|
| Unit | derive/validate verdict with missing RateRef | BLOCK | P0 |
| Unit | `piiStatus=Risk` | BLOCK | P0 |
| Unit | approvalRequired + Pending | BLOCK/action disabled | P0 |
| Unit | long unblock inputs | first 5 + `+N more` | P1 |
| Contract | missing required payload field | schema invalid | P0 |
| Contract | P2 raw field appears in payload | schema/security failure | P0 |
| UI | Header renders verdict/reason/unblock | visible | P0 |
| UI | BlockReasonBox appears only for BLOCK | correct visibility | P0 |
| UI | EvidenceDrawer opens from Evidence table | drawer content visible | P1 |
| E2E | Cost evidence missing | Cost judgment disabled | P0 |
| E2E | PII risk | export/publish disabled | P0 |
| E2E | Approval missing | publish blocked | P0 |
| E2E | PASS + approved | Publish Report allowed | P1 |
| a11y | Keyboard navigation | all P1 controls reachable | P1 |
| a11y | Drawer focus trap | ESC closes, focus returns | P1 |
| Security | Copy JSON | redacted payload only | P0 |
| Security | PDF Draft | DRY-RUN + redacted | P1 |
| Observability | events emitted | required event props present | P2 |

### Release Gate Commands

명령은 프로젝트 script 이름에 맞게 조정한다.

```bash
pnpm lint && pnpm typecheck
```

```bash
pnpm test && pnpm build
```

```bash
pnpm exec playwright test tests/decision-card-v2.spec.ts
```

```bash
pnpm exec playwright test tests/decision-card-a11y.spec.ts
```

---

## Traceability

| Item | Links to Requirements | Links to Success Criteria | Links to Acceptance Criteria |
|---|---|---|---|
| User Story 1 - BLOCK 상태 즉시 판단 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-030 | SC-001, SC-003, SC-012 | AC-001, AC-002, AC-011, AC-012 |
| User Story 2 - Missing Evidence 해제 작업 수행 | FR-010, FR-011, FR-021, FR-022 | SC-002 | AC-003, AC-007 |
| User Story 3 - Evidence 검증 및 감사 추적 | FR-012, FR-013, FR-015, FR-020, FR-025 | SC-007, SC-008 | AC-004, AC-008 |
| User Story 4 - Human-gate 승인 전 위험 행동 차단 | FR-016, FR-017, FR-018, FR-019, FR-028 | SC-005, SC-006 | AC-005, AC-006 |
| User Story 5 - PASS/WARN 상태에서 안전한 Export 수행 | FR-026, FR-027, FR-028 | SC-004, SC-006 | AC-005, AC-010 |
| User Story 6 - Keyboard-only 및 접근성 사용 | FR-002, NFR-006, NFR-007 | SC-009 | AC-009, AC-012 |

---

## Implementation Milestones

| Milestone | Scope | Exit Criteria | Risk |
|---|---|---|---|
| M1 | Schema + Rule Matrix | `DecisionCardPayload` contract and P0 rules documented/tested | Backend/frontend mismatch |
| M2 | P0 UI | VerdictHeader, BlockReasonBox, UnblockChecklist, HumanGateBanner | UI shows status but action remains weak |
| M3 | Evidence + Actions | EvidenceCoverageBar, EvidenceDrawer, ActionTable | Evidence trace incomplete |
| M4 | Export + Approval | ExportControls, approval trace, publish guard | Approval bypass |
| M5 | Trace + Validation | TracePanel, Validation tab, validation report | Audit gap |
| M6 | Release Hardening | E2E, a11y, redaction, performance, analytics | Regression or release blocker |

Recommended rollout:

1. Option B first: JSON contract + UI + rule matrix.
2. Option C next: audit trace + approval gate + E2E/a11y CI.
3. Option A alone is not recommended for production because it improves layout without stabilizing decision logic.

---

## Options

| Option | Scope | External Cost | Risk | Time | Suitable When |
|---|---|---:|---|---|---|
| A | Front-only UI 재배치: Header, BLOCK Box, Action Table | AED 0.00 가정 | Medium | 2-3 MD | Backend 변경이 어려운 경우 |
| B | JSON contract + UI + rule matrix | AED 0.00 가정 | Low | 5-8 MD | 운영 카드 v2 정식 적용 |
| C | B + audit trace + approval gate + E2E/a11y CI | AED 0.00 가정 | Low | 10-15 MD | 보고서 발행/정산/승인까지 연결 |

Cost note: 내부 인건비 단가가 제공되지 않았으므로 내부 비용 산정은 제외한다.

---

## Open Questions & Clarifications

### Open Questions

| ID | Question | Owner | Impact |
|---|---|---|---|
| Q1 | 실제 frontend/backend stack은 React/Next.js가 맞는가? | Tech Lead | Component/file structure |
| Q2 | `DataClass` 값은 P0/P1/P2 체계가 맞는가, 아니면 조직 보안 분류를 사용해야 하는가? | Security | Redaction rules |
| Q3 | confidence threshold 0.80/0.60은 운영 기준으로 승인 가능한가? | Product / Risk | False PASS/WARN risk |
| Q4 | Approval actor identity source는 IAM, app user, 또는 external workflow 중 무엇인가? | Platform | Audit trace |
| Q5 | Publish Report의 외부 발행 대상과 채널은 무엇인가? | Product | Export policy |
| Q6 | BOE/DO/Port evidence의 required 조건은 route type별로 다른가? | Logistics SME | Rule matrix |
| Q7 | Action owner role list는 `Cost Owner`, `Docs Owner`, `Ops Owner`, `Security Reviewer`로 충분한가? | Operations | Action routing |
| Q8 | Redacted JSON의 허용 필드 allowlist는 누가 승인하는가? | Security | Data minimization |
| Q9 | Time-to-Decision analytics를 어떤 event pipeline에 저장할 것인가? | Data / Platform | KPI measurement |
| Q10 | Draft PDF watermark, footer, disclaimer 문구 표준은 무엇인가? | Product / Legal | Report governance |

### Clarifications Log

- 2026-05-17 Session:
  - Q: 기존 상세 방법 문서를 Spec.md 계약 문서로 변환해야 하는가?
  - A: 사용자가 md 문서 형태의 상세 Spec 작성을 요청함.

---

## Risks & Mitigations

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Schema drift between backend and frontend | Wrong card state | Contract tests and schema versioning |
| R2 | False PASS on missing evidence | Cost/approval error | Fail-safe BLOCK precedence |
| R3 | P2/PII raw exposure | NDA/PII incident | Redaction allowlist + security tests |
| R4 | Approval bypass | Unauthorized publish/export | HumanGateBanner + backend enforcement |
| R5 | Action owner missing | BLOCK unresolved | Unassigned state + owner assignment action |
| R6 | UI overload | User misses decision | Decision-first header and progressive disclosure |
| R7 | a11y failure | Release blocker | Keyboard and screen reader smoke tests |
| R8 | Trace missing | Audit failure | Required trace fields in schema |
| R9 | Analytics missing | No proof of improvement | Event contract before rollout |
| R10 | Rule matrix under-specified | Inconsistent verdict | SME review and rule ID governance |

---

## ZERO Log

| Stage | ZERO Condition | Risk | Input Required | Next Action |
|---|---|---|---|---|
| Data | P2 원문·단가·PII가 payload/card/export에 직접 포함됨 | NDA/PII 유출 | Material ID, redacted snippet, sourceHash | 원문 제거 후 재검증 |
| Rule | requiredEvidence 기준 없음 | 잘못된 PASS | Rule matrix, required inputs | Rule matrix 작성 |
| Approval | publish/export/action이 approval 없이 가능 | 무단 발행/승인 | approval actor/status | Human-gate 추가 |
| A11y | drawer/table/action이 keyboard 접근 불가 | 접근성 차단 | a11y test log | release 중단 후 수정 |
| KPI | Time-to-Decision 측정 불가 | 개선 효과 입증 불가 | analytics event schema | event 추가 |
| Security | redacted export allowlist 없음 | 민감정보 노출 | allowlist owner/approval | export 차단 |
| Contract | backend payload schema 미확정 | frontend 재작업 | schema version, required fields | contract freeze |

---

## Reviewer Checklist

- [ ] `Summary`, `User Scenarios & Testing`, `Requirements`, `Assumptions & Dependencies`, `Success Criteria`가 모두 포함되어 있다.
- [ ] P1 user story는 독립적으로 테스트 가능하다.
- [ ] 모든 acceptance scenario는 observable outcome을 가진다.
- [ ] `FR-###`, `NFR-###`, `SC-###` ID가 안정적으로 부여되어 있다.
- [ ] P2/PII redaction rule이 export, UI, log에 모두 적용되어 있다.
- [ ] approval-gated action은 UI와 backend 양쪽에서 차단된다.
- [ ] `Traceability`가 User Story → FR/NFR → SC/AC로 연결되어 있다.
- [ ] open question이 critical ambiguity를 숨기지 않는다.
- [ ] `WARN/BLOCK` 상태의 allowed/blocked actions가 명확하다.
- [ ] approval-ready 전에 Q1-Q10 중 P0/P1 영향 질문이 해결되어야 한다.

---

## Approval Readiness Assessment

Current status: `In Review`

This spec is not yet `Approved` because the following critical items require confirmation:

1. Actual stack and schema ownership: Q1, Q4
2. Data classification and redaction allowlist: Q2, Q8
3. Domain rule thresholds and required evidence: Q3, Q6
4. Publish/export governance: Q5, Q10

Approval-ready conditions:

- `NEEDS CLARIFICATION` markers for P0/P1 requirements are resolved or explicitly accepted.
- `DecisionCardPayload` schema is frozen for v0.1.0.
- Rule matrix includes at least all P0 rules.
- Security approves P2/PII redaction and export allowlist.
- P1 E2E, a11y, redaction, approval gate tests pass.

---

## Changelog

- v0.1.0 (2026-05-17): Initial detailed Spec.md draft for Decision Card v2.
