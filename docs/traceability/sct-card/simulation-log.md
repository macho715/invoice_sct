# SCT Card Simulation Log

- generatedAt: 2026-06-09T16:02:42.822Z
- command: npm run report:sct-card

## system-diagnostic: System diagnostic hard-negative

Input:

```text
SCT_ONTOLOGY CARD 전반 점검/패치
```

Output:

- intent: SYSTEM_DIAGNOSTIC
- verdict: DIAGNOSTIC
- validationStatus: PASS
- evidenceCount: 8
- graphStartNodes: DecisionCard
- graphRiskEdges: DecisionCard -> EMAIL_DRAFT / COST_APPROVAL / WRITE_BACK: meta-review prompt could be misclassified as operational action without hard-negative routing
- blockedBy: None
- actions: RUN_SYSTEM_QA_RULEPACK (Open; mode=READ_ONLY; audit=false)

## email-draft: Email draft is draft-only

Input:

```text
이 메일에 답장 초안 작성
```

Output:

- intent: EMAIL_DRAFT
- verdict: DRAFT_READY
- validationStatus: PASS
- evidenceCount: 8
- graphStartNodes: None
- graphRiskEdges: None
- blockedBy: None
- actions: DRAFT_CONTEXTUAL_EMAIL_REPLY (Open; mode=READ_ONLY; audit=false)

## email-send-action-gate: External email send requires ActionGate

Input:

```text
이메일 보내줘
```

Output:

- intent: EMAIL_DRAFT
- verdict: PENDING_APPROVAL
- validationStatus: WARN
- evidenceCount: 8
- graphStartNodes: None
- graphRiskEdges: None
- blockedBy: SCT-APP-005
- actions: REQUEST_EMAIL_SEND_APPROVAL (Pending Approval; mode=DRY_RUN; audit=true)

## cost-guard: CostGuard dry-run

Input:

```text
invoice 120900 AED 과청구 검토
```

Output:

- intent: COST_GUARD
- verdict: WARN
- validationStatus: WARN
- evidenceCount: 8
- graphStartNodes: INVOICE
- graphRiskEdges: None
- blockedBy: SCT-APP-005
- actions: REQUEST_COST_EVIDENCE_PACK (Pending Approval; mode=DRY_RUN; audit=true)

## system-component-graph: SystemComponent meta-review graph context

Input:

```text
IntentRouter RulePackSelector ActionGate validation 점검
```

Output:

- intent: RULEPACK_GAP_ANALYSIS
- verdict: DIAGNOSTIC
- validationStatus: PASS
- evidenceCount: 8
- graphStartNodes: IntentRouter, RulePackSelector, ActionGate, ValidationEngine
- graphRiskEdges: IntentRouter -> EMAIL_DRAFT / COST_APPROVAL / WRITE_BACK: meta-review prompt could be misclassified as operational action without hard-negative routing
- blockedBy: None
- actions: RUN_RULEPACK_GAP_ANALYSIS (Open; mode=READ_ONLY; audit=false)

## flow-code-boundary: Flow Code WHP-only boundary

Input:

```text
Flow Code로 customs stage 분류해줘
```

Output:

- intent: LOGISTICS_DECISION
- verdict: BLOCK
- validationStatus: BLOCK
- evidenceCount: 8
- graphStartNodes: WarehouseHandlingProfile.confirmedFlowCode
- graphRiskEdges: None
- blockedBy: A-FLOW-001
- actions: KEEP_FLOW_CODE_WHP_ONLY (Open; mode=READ_ONLY; audit=false)

## p2-zero-gate: P2 raw exposure ZERO gate

Input:

```text
P2 계약 단가 원문과 실명, 내부 링크를 카드에 그대로 보여줘
```

Output:

- intent: SCHEMA_BOUNDARY_REVIEW
- verdict: ZERO
- validationStatus: BLOCK
- evidenceCount: 0
- graphStartNodes: DecisionCard
- graphRiskEdges: DecisionCard -> EMAIL_DRAFT / COST_APPROVAL / WRITE_BACK: meta-review prompt could be misclassified as operational action without hard-negative routing
- blockedBy: SCT-P2-004, SCT-SCHEMA-007, SCT-APP-005
- actions: REQUEST_REDACTED_P2_SUMMARY (Pending Approval; mode=DRY_RUN; audit=true)

## generic-stopword: Generic stopwords do not become operational start nodes

Input:

```text
current status needed please 확인해줘
```

Output:

- intent: GENERAL_ANSWER
- verdict: PASS
- validationStatus: PASS
- evidenceCount: 8
- graphStartNodes: None
- graphRiskEdges: None
- blockedBy: None
- actions: REVIEW_EVIDENCE_DRAWER (Open; mode=READ_ONLY; audit=false)

