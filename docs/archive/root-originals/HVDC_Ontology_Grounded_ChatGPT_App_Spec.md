# Feature Specification: HVDC Ontology Grounded ChatGPT App

Feature ID/Branch: 001-hvdc-ontology-grounded-chatgpt-app  
Created: 2026-05-10  
Status: Draft  
Owner: HVDC Logistics / App Platform Team  
Input: HVDC Ontology Grounded ChatGPT App UI/UX Specification v2.00-final-draft  
Last Updated: 2026-05-10  
Version: v0.1.0  

## Summary

### Problem

- HVDC Project Logistics 사용자가 ChatGPT에서 업무 질문을 할 때, 일반 LLM 지식이나 개인별 대화 기억에 의존하면 용어, 책임경계, 증빙 기준, compliance 판단이 사용자마다 달라질 수 있다.
- 현재 목표는 ChatGPT App이 HVDC 온톨로지 문서와 Knowledge Graph를 먼저 조회한 뒤, evidence-backed answer만 반환하도록 만드는 것이다.
- 업무 사실, CostGuard, AGI/DAS closure, BOE/DO status, WH/MOSB/site movement, Incoterms/compliance 판단은 반드시 source traceability, validation status, Human-gate 여부를 포함해야 한다.

### Goals

- G1: 모든 factual 업무 답변은 ontology corpus 또는 KG 조회 결과에 grounded되어야 한다.
- G2: CONSOLIDATED-00 master ontology를 canonical semantic spine으로 사용하여 용어와 책임경계를 표준화한다.
- G3: Answer Card, Evidence Drawer, Ontology Path Viewer, Validation Gate Panel을 통해 답변 근거와 검증 상태를 ChatGPT 대화 안에서 표시한다.
- G4: BL, BOE, DO, Invoice No., HVDC_CODE 등 any-key 입력을 ShipmentUnit, Document, Invoice, MilestoneEvent, PersonRole 중 하나 이상으로 resolve한다.
- G5: evidence 없음, stale source, PII leakage, unsupported write action, missing Human-gate 상태에서는 ZERO/BLOCK으로 답변 또는 action을 중단한다.
- G6: Codex Agent Skills는 runtime 답변 엔진이 아니라 app/tool/UI/validation 개발 workflow 재사용 도구로 분리한다.

### Non-Goals

- NG1: MVP에서 ERP, WMS, ATLP, Foundry live data를 transaction source of truth로 직접 수정하지 않는다.
- NG2: WhatsApp, email, ERP, WMS, ATLP, Foundry에 자동 전송, 자동 등록, 자동 승인, 자동 삭제를 수행하지 않는다.
- NG3: 온톨로지 문서에 없는 최신 법규, 요율, 항만 상태, customs ruling을 추측하지 않는다.
- NG4: Flow Code를 route classification, port routing, customs stage, invoice bucket, operations KPI bucket으로 사용하지 않는다.
- NG5: Codex Skills를 ChatGPT App runtime tool로 오해하지 않는다.
- NG6: PII 원문 전화번호와 이메일을 Answer Card, Evidence Drawer, export report, audit log에 표시하지 않는다.

## User Scenarios & Testing

### User Story 1 - Ontology-grounded 업무 질문 답변 (Priority: P1)

사용자는 ChatGPT 안에서 자연어로 HVDC 물류 질문을 입력한다. App은 질문을 route하고 CONSOLIDATED-00 및 관련 extension documents를 조회한 후 근거 기반 답변을 반환한다.

Why this priority: App의 핵심 가치는 일반 ChatGPT 답변이 아니라 HVDC ontology-grounded answer이다.

Independent Test: 20개 golden prompt를 입력했을 때 모든 factual answer가 EvidenceSnippet ≥ 1, CONSOLIDATED-00 route 포함, verdict 포함 조건을 만족하는지 확인한다.

Acceptance Scenarios:

1. Given 사용자가 “AGI M130 닫아도 돼?”라고 묻고 관련 source가 존재한다, When 질문이 제출된다, Then App은 route_question, search_ontology_corpus, validate_answer를 실행하고 GroundedAnswer를 반환한다.
2. Given 질문에 factual claim이 포함된다, When EvidenceSnippet이 0개다, Then App은 답변을 생성하지 않고 NO_EVIDENCE 또는 BLOCK 상태를 표시한다.
3. Given CONSOLIDATED-00 조회가 누락된다, When 답변 생성 단계가 시작된다, Then App은 답변을 BLOCK하고 master source 조회 필요 상태를 반환한다.

### User Story 2 - Evidence Drawer로 근거 검증 (Priority: P1)

사용자는 답변 문장 옆 evidence badge를 눌러 source document, version/date, sectionPath, snippet, docHash, confidence, sourceOwner를 확인한다.

Why this priority: 업무 보고와 비용/claim 검토에서는 답변 근거가 재현 가능해야 한다.

Independent Test: 답변 10건을 생성하고 각 핵심 claim에서 Evidence Drawer를 열었을 때 docId, sectionPath, docHash, confidence가 모두 표시되는지 확인한다.

Acceptance Scenarios:

1. Given GroundedAnswer가 표시된다, When 사용자가 Evidence badge를 클릭한다, Then Evidence Drawer가 열리고 linked EvidenceSnippet 목록이 표시된다.
2. Given EvidenceSnippet에 전화번호 또는 이메일이 포함된다, When Drawer가 렌더링된다, Then 전화번호와 이메일은 masked format으로 표시된다.
3. Given source document version이 stale로 판정된다, When Drawer가 열린다, Then stale source badge와 owner review 필요 상태가 표시된다.

### User Story 3 - Any-key Resolver (Priority: P1)

사용자는 BL, BOE, DO, Invoice No., HVDC_CODE, Case No. 등 하나의 key만 입력해 관련 ShipmentUnit 또는 Document를 찾는다.

Why this priority: 현장 질문은 완전한 object ID가 아니라 BL/BOE/DO/Invoice/Case 기반으로 들어오는 경우가 많다.

Independent Test: 샘플 identifier 50개를 입력하고 expected ShipmentUnit 또는 Document candidate가 confidence ≥ 0.95로 반환되는지 확인한다.

Acceptance Scenarios:

1. Given 사용자가 “BOE 123 지연 원인?”이라고 묻는다, When identifier extraction이 실행된다, Then BOE 123은 Document candidate로 표시되고 관련 ShipmentUnit candidate가 반환된다.
2. Given identifier가 복수 candidate로 resolve된다, When confidence가 0.95 미만이다, Then App은 MULTIPLE_CANDIDATES 상태를 표시하고 사용자 선택 또는 Data Steward review를 요청한다.
3. Given identifier가 어떤 corpus/KG object에도 매칭되지 않는다, When resolver가 종료된다, Then App은 NOT_FOUND 상태와 필요한 추가 key 목록을 반환한다.

### User Story 4 - AGI/DAS M130 Closure Guard (Priority: P1)

사용자는 AGI/DAS site receiving 또는 M130 closure 가능 여부를 묻는다. App은 MOSB/LCT chain evidence, M115/M116/M117 milestone evidence, approved exception 여부를 검증한다.

Why this priority: site closure 오판은 false site receipt, claim exposure, cost audit risk를 만든다.

Independent Test: MOSB/LCT evidence complete, missing, stale, exception-approved 4개 fixture로 PASS/BLOCK/WARN이 정확히 반환되는지 확인한다.

Acceptance Scenarios:

1. Given AGI/DAS route가 MOSB-inclusive이고 M115/M116/M117 evidence가 모두 존재한다, When M130 closure 질문이 들어온다, Then App은 PASS 또는 WARN verdict와 evidence list를 반환한다.
2. Given M115/M116/M117 evidence 중 하나 이상이 누락된다, When M130 closure 질문이 들어온다, Then App은 BLOCK verdict와 missing evidence list를 반환한다.
3. Given approved exception record가 존재한다, When evidence 일부가 누락된다, Then App은 exception condition, approver role, audit record를 표시하고 limited PASS/WARN을 반환한다.

### User Story 5 - Invoice/CostGuard 답변 및 Human-gate (Priority: P2)

사용자는 invoice line, rate, tariff, DEM/DET, overcharge 여부를 질문한다. App은 CostGuard rule, RateRef, TariffRef, InvoiceLine arithmetic을 검증하고 Human-gate 필요 여부를 표시한다.

Why this priority: 비용 답변은 AED/USD 원금 보존, threshold, approval gate가 필요하다.

Independent Test: 샘플 invoice 10건을 입력하고 PASS/WARN/HIGH/CRITICAL band와 Human-gate 조건이 expected result와 일치하는지 확인한다.

Acceptance Scenarios:

1. Given invoice total 또는 variance가 100,000.00 AED를 초과한다, When CostGuard answer가 생성된다, Then App은 Finance approval gate required 상태를 표시한다.
2. Given standard rate reference가 없다, When overcharge 여부를 묻는다, Then App은 NO_RATE_REFERENCE 또는 NEEDS_REVIEW 상태를 반환하고 추정 답변을 하지 않는다.
3. Given line arithmetic이 source와 draft invoice 간 불일치한다, When validation이 실행된다, Then App은 line-level finding과 evidenceIds를 반환한다.

### User Story 6 - Compliance Freshness Guard (Priority: P2)

사용자는 MOIAT, FANR, DCD, ADNOC/CICPA/GatePass, Incoterms 관련 판단을 묻는다. App은 current approved source 또는 owner review 없이는 authoritative answer를 반환하지 않는다.

Why this priority: 규정과 요율은 최신성 리스크가 높으며 잘못된 답변은 customs, HSE, access, claim risk를 만든다.

Independent Test: current source available, stale source, missing source 3개 fixture로 PASS/STALE_SOURCE/BLOCK 상태가 정확히 표시되는지 확인한다.

Acceptance Scenarios:

1. Given current approved SOP/source가 존재한다, When compliance question이 들어온다, Then App은 freshness badge와 source evidence를 포함한 answer를 반환한다.
2. Given source가 stale이거나 date가 불명확하다, When compliance question이 들어온다, Then App은 STALE_SOURCE를 표시하고 owner review를 요청한다.
3. Given 사용자가 legal authority decision을 요구한다, When App이 evidence completeness만 판단할 수 있다, Then App은 “Evidence not approval” banner를 표시한다.

### User Story 7 - Corpus Admin 및 Codex Skill Console (Priority: P3)

관리자는 온톨로지 문서 변경, corpus index, validation pass, skill QA 상태를 관리한다.

Why this priority: ontology answer quality는 corpus version, index health, validation fixtures에 의존한다.

Independent Test: 문서 1개를 수정한 뒤 corpus refresh를 실행했을 때 version diff, docHash, validation_passes, stale badge가 갱신되는지 확인한다.

Acceptance Scenarios:

1. Given 새 CONSOLIDATED document가 추가된다, When corpus refresh가 실행된다, Then corpus_index.json에 docId, version, sectionPath, docHash가 등록된다.
2. Given validation test가 fail한다, When Admin Console이 열린다, Then 해당 corpus version은 publish-ready로 표시되지 않는다.
3. Given Codex Skill이 answer-grounding workflow를 수정한다, When skill QA가 실행된다, Then answer contract, PII tests, no-evidence tests가 모두 통과해야 release candidate가 된다.

### Edge Cases

- EC1: 질문이 너무 짧거나 domain이 불명확함 -> route_question은 clarification prompt 또는 candidate domains를 반환한다.
- EC2: Retrieval 결과가 상충됨 -> App은 conflict summary와 source precedence를 표시하고 PASS를 반환하지 않는다.
- EC3: CONSOLIDATED-00은 hit되었으나 target extension이 없음 -> App은 limited answer 또는 NO_TARGET_EXTENSION 상태를 반환한다.
- EC4: userRole 권한이 부족함 -> App은 restricted fields를 mask하고 role-level answer만 반환한다.
- EC5: KG/SPARQL timeout 발생 -> App은 corpus-only fallback 가능 여부를 표시하고 status claim은 제한한다.
- EC6: UI component load 실패 -> App은 structuredContent text fallback을 표시한다.
- EC7: MCP tool unavailable -> App은 answer generation을 중단하고 TOOL_UNAVAILABLE 상태를 반환한다.
- EC8: Prompt injection이 retrieved document에 포함됨 -> server-side validation은 instruction-like text를 무시하고 evidence text로만 처리한다.
- EC9: PII redaction 실패 감지 -> App은 report/export/action을 중단하고 REDACTION_FAILED를 반환한다.
- EC10: Rate/compliance 질문에 최신 source 없음 -> App은 STALE_SOURCE 또는 BLOCK을 반환하고 owner review를 요청한다.
- EC11: Flow Code를 route 의미로 묻는 질문 -> App은 WHP-only rule을 설명하고 route classification 사용을 차단한다.
- EC12: ActionRecommendation이 write action을 포함함 -> human confirmation과 AuditRecord 없이는 실행하지 않는다.

## Requirements

### Functional Requirements

- FR-001: System MUST accept Korean and English natural-language questions in the ChatGPT conversation context.
- FR-002: System MUST run route_question before generating a factual HVDC logistics answer.
- FR-003: System MUST include CONSOLIDATED-00 in requiredDocs for ontology or operation questions.
- FR-004: System MUST call search_ontology_corpus or query_knowledge_graph before composing any factual answer.
- FR-005: System MUST return GroundedAnswer with verdict, summary, businessImpact, details, evidenceIds, validationStatus, and actions.
- FR-006: System MUST return PASS, WARN, BLOCK, INFO, NO_EVIDENCE, STALE_SOURCE, or MULTIPLE_CANDIDATES as explicit answer state.
- FR-007: System MUST attach at least one EvidenceSnippet to each core factual claim.
- FR-008: System MUST stop answer generation with NO_EVIDENCE if no evidence supports a factual claim.
- FR-009: System MUST expose Evidence Drawer data with docId, title, version/date, sectionPath, snippet, docHash, confidence, and sourceType.
- FR-010: System MUST preserve operational truth and evidence separation; documents, OCR, communication, port, and cost records MUST NOT mutate transaction truth by themselves.
- FR-011: System MUST resolve BL, BOE, DO, Invoice No., HVDC_CODE, Case No., and other configured identifiers through resolve_any_key.
- FR-012: System MUST show MULTIPLE_CANDIDATES when any-key confidence is below 0.95 or multiple candidates are plausible.
- FR-013: System MUST render Ontology Path Viewer from identifier to relevant object path when GraphPath is available.
- FR-014: System MUST validate answers using SHACL/SPARQL/RAG freshness/Human-gate rules before final display.
- FR-015: System MUST block AGI/DAS M130 closure answer unless M115/M116/M117 evidence or approved exception exists.
- FR-016: System MUST enforce Flow Code as WHP-only and block route classification use.
- FR-017: System MUST mask phone numbers and email addresses in UI, logs, reports, and exports.
- FR-018: System MUST allow operational names to be displayed only where project policy permits and only when relevant to role routing.
- FR-019: System MUST mark regulatory/rate/current authority claims as STALE_SOURCE unless current approved source or owner review exists.
- FR-020: System MUST require Human-gate for write/action recommendations, external message sending, report publication, cost approval, or transaction mutation.
- FR-021: System MUST require Finance approval gate for invoice or CostGuard answers above 100,000.00 AED or HIGH/CRITICAL risk.
- FR-022: System MUST provide create_action_request output with actionType, ownerRole, parameters, humanGateRequired, dueAt, and evidenceIds.
- FR-023: System MUST provide export_answer_report only after PII redaction and evidence coverage checks pass.
- FR-024: System MUST record ToolCallAudit for each app tool call with toolName, inputHash, outputHash, userRole, timestamp, and piiMasked.
- FR-025: System MUST support corpus refresh that updates docHash, sectionPath, version/date, validation_passes, and index health.
- FR-026: System MUST keep Codex Agent Skills as development workflow artifacts and not expose them as runtime user-facing answer tools.
- FR-027: System MUST include fallback text output when UI components cannot render.
- FR-028: System MUST provide Open Questions and [NEEDS CLARIFICATION] markers for unresolved product, deployment, auth, or data source decisions.

### Non-Functional Requirements

- NFR-001 (Performance): Corpus-only MVP answer validation p95 latency MUST be < 5.00s for golden prompts.
- NFR-002 (Performance): Any-key resolver p95 latency SHOULD be < 3.00s for indexed corpus/KG candidate search.
- NFR-003 (Security/Privacy): PII leakage in UI, export, and audit logs MUST be 0.00.
- NFR-004 (Security/Privacy): App MUST apply least-privilege access to corpus, KG, report export, and action creation.
- NFR-005 (Security/Privacy): Retrieved document text MUST NOT override system, app, validation, or tool policy.
- NFR-006 (Reliability): Tool failures MUST fail closed with TOOL_UNAVAILABLE, NO_EVIDENCE, STALE_SOURCE, or BLOCK rather than returning ungrounded answers.
- NFR-007 (Reliability): Every blocked action MUST retain an audit trail.
- NFR-008 (UX): Answer Card MUST show verdict, source route, evidence count, validation state, and next action above detailed explanation.
- NFR-009 (UX): Evidence Drawer MUST be reachable from each evidence badge.
- NFR-010 (Data Quality): corpus_index.json MUST include docId, version/date, sectionPath, chunk offset or equivalent, docHash, and domain role.
- NFR-011 (Maintainability): MCP tool input/output schemas MUST be versioned and covered by schema tests.
- NFR-012 (Maintainability): Codex Skills MUST include SKILL.md and optional references/scripts/assets only where needed.
- NFR-013 (Compliance): Incoterms, MOIAT, FANR, DCD, ADNOC/CICPA/GatePass answers MUST display source freshness and evidence-not-approval status where applicable.
- NFR-014 (Auditability): Answer, evidence, validation, action, and export objects MUST be traceable through IDs and hashes.
- NFR-015 (Accessibility): Core answer state MUST be readable without relying only on color.

## Key Entities / Data

| Entity | Meaning | Key Attributes |
|---|---|---|
| OntologyQuerySession | 한 번의 질문, route, retrieval, validation, answer session | sessionId, userRole, questionText, language, createdAt, queryMode |
| IntentRoute | 질문을 domain, docs, tools로 연결한 routing result | routeId, domains, requiredDocs, confidence, routingReason |
| ResolvedEntity | Any-key가 resolve한 object candidate | entityType, identifierScheme, identifierValue, normalizedValue, targetRid, confidence |
| EvidenceSnippet | 답변 근거 조각 | docId, title, version, sectionPath, snippet, docHash, confidence, sourceType |
| GraphPath | 질문 entity에서 업무 object까지 KG 경로 | startNode, edges, endNode, pathConfidence |
| GroundedAnswer | 사용자에게 표시되는 최종 answer object | answerId, verdict, summary, businessImpact, details, evidenceIds, validationStatus |
| ValidationFinding | rule check 결과 | ruleId, severity, status, targetObject, evidenceIds, message |
| ActionRecommendation | 다음 조치 또는 승인 요청 | actionType, ownerRole, parameters, humanGateRequired, dueAt |
| ToolCallAudit | MCP tool 호출 감사 로그 | toolName, inputHash, outputHash, userRole, timestamp, piiMasked |
| CorpusDocument | 승인된 ontology/source document | docId, title, version/date, domain, docHash, validation_passes |
| ReportArtifact | export 대상 답변/보고서 산출물 | reportId, answerId, format, redactionStatus, evidencePack |

## Interfaces & Contracts

### MCP Tools

| Tool | Input | Output | Primary UI |
|---|---|---|---|
| route_question | question, userRole, language | IntentRoute | Domain Route Banner |
| search_ontology_corpus | query, requiredDocs, domainHints, topK | EvidenceSnippet[] | Evidence Drawer |
| resolve_any_key | identifierScheme, identifierValue | ResolvedEntity[] | Any-key Resolver |
| query_knowledge_graph | templateId, params | GraphPath, object facts | Ontology Path Viewer |
| validate_answer | answerDraft, evidenceIds, ruleSet | ValidationFinding[] | Validation Gate Panel |
| compose_grounded_answer | sessionId, evidenceIds, graphPathIds | GroundedAnswer | Grounded Answer Card |
| create_action_request | targetObject, reason, ownerRole, evidenceIds | ActionRecommendation | Action Composer |
| export_answer_report | answerId, format | ReportArtifact | Download/export |

### StructuredContent Contract

```json
{
  "answerId": "string",
  "verdict": "PASS|WARN|BLOCK|INFO|NO_EVIDENCE|STALE_SOURCE|MULTIPLE_CANDIDATES",
  "summary": "string",
  "businessImpact": "string",
  "usedSources": [
    {
      "docId": "string",
      "role": "string",
      "version": "string"
    }
  ],
  "resolvedEntities": [
    {
      "entityType": "ShipmentUnit|Document|Invoice|MilestoneEvent|PersonRole",
      "targetRid": "string",
      "confidence": 0.0
    }
  ],
  "evidenceIds": ["string"],
  "validation": [
    {
      "ruleId": "string",
      "status": "PASS|WARN|BLOCK",
      "severity": "INFO|WARN|BLOCK"
    }
  ],
  "actions": [
    {
      "actionType": "string",
      "ownerRole": "string",
      "humanGateRequired": true
    }
  ],
  "_meta": {
    "uiTemplate": "ui://hvdc/answer-card.html",
    "piiMasked": true
  }
}
```

### Files

| File | Purpose | Constraints |
|---|---|---|
| corpus_index.json | indexed source registry | docId, version/date, sectionPath, docHash, validation_passes required |
| answer_contract.json | GroundedAnswer schema fixture | versioned, schema-tested |
| validation_tests.json | golden prompts and fail cases | includes no-evidence, stale-source, PII, Flow Code, AGI/DAS cases |
| skill directories | Codex development workflow | `.agents/skills/<skill-name>/SKILL.md` required |
| audit log | tool/action/export trace | no raw PII; hashed input/output |

## Assumptions & Dependencies

### Assumptions

- A1: MVP starts as corpus-only RAG without live ERP/WMS/ATLP/Foundry transaction mutation.
- A2: CONSOLIDATED-00 through CONSOLIDATED-09 and Team/Person docs can be indexed with docHash and sectionPath.
- A3: The project permits operational names to appear where role routing requires them, but phone numbers and emails remain PII and must be masked.
- A4: KG/SPARQL integration may be mocked in MVP and replaced with GraphDB or Foundry functions in later phases.
- A5: Current regulatory/rate/source freshness cannot be guaranteed by ontology corpus alone.
- A6: Codex Agent Skills are used by developers to build, test, and maintain the app, not by runtime end users.
- A7: ChatGPT App UI components are rendered from MCP tool structured results and must have text fallback.
- A8: Source snippets are limited to minimum necessary operational evidence.

### Dependencies

- D1: Approved HVDC ontology corpus, including CONSOLIDATED-00 as canonical semantic spine.
- D2: Section-level document indexing pipeline with docHash and version/date metadata.
- D3: MCP server runtime with defined tools and output schemas.
- D4: UI component bundle for Answer Card, Evidence Drawer, Ontology Path Viewer, Validation Gate Panel, Action Composer.
- D5: Validation engine supporting SHACL/SPARQL/RAG freshness/Human-gate checks.
- D6: PII redaction middleware for phone, email, token, internal sensitive identifiers, and export content.
- D7: Golden prompt dataset covering WH, Port, Material, Cost, MOSB, Role, Compliance, Flow Code, AGI/DAS closure.
- D8: Human approval workflow for action requests and export/report publication.
- D9: Current approved SOP or owner review process for MOIAT/FANR/DCD/ADNOC/CICPA/GatePass/rate claims.
- D10: Codex repository conventions for AGENTS.md and `.agents/skills`.

## Success Criteria

### Measurable Outcomes

- SC-001: Grounding Coverage = 100.00% for core factual claims across 20 MVP golden prompts, measured by evidenceIds per claim.
- SC-002: Source Traceability ≥ 95.00%, measured by answers showing docId, version/date, sectionPath, docHash, and confidence.
- SC-003: CONSOLIDATED-00 Route Inclusion = 100.00% for ontology/operation questions.
- SC-004: Any-key Resolution Precision ≥ 95.00% on 50 labeled identifier fixtures.
- SC-005: Validation p95 latency < 5.00s for corpus-only MVP prompts.
- SC-006: PII Leakage = 0.00 across UI, report export, and audit log test fixtures.
- SC-007: Human-gate Enforcement = 100.00% for write/action/export/cost approval scenarios.
- SC-008: Flow Code Misuse = 0.00 route classification outputs across Flow Code test prompts.
- SC-009: AGI/DAS Closure Guard Accuracy ≥ 95.00% across complete/missing/stale/exception fixtures.
- SC-010: CostGuard band accuracy ≥ 95.00% against labeled invoice fixtures.
- SC-011: Tool schema test pass rate = 100.00% before release candidate.
- SC-012: No-evidence hallucination rate = 0.00 for factual questions with empty retrieval results.
- SC-013: UI fallback coverage = 100.00% for simulated UI component load failures.
- SC-014: Audit trail coverage = 100.00% for blocked actions and exports.

## Open Questions & Clarifications

### Open Questions

- Q1: App deployment target은 내부-only ChatGPT App인가, limited beta용 ChatGPT App인가? (Owner: Product/App Platform)
- Q2: 사용자 인증과 role policy는 어떤 identity provider를 사용할 것인가? [NEEDS CLARIFICATION: auth provider and user role source]
- Q3: MVP corpus는 어떤 repository 또는 storage bucket에서 로드할 것인가? [NEEDS CLARIFICATION: source location]
- Q4: CONSOLIDATED-00~09의 approved version/date 기준은 무엇인가? [NEEDS CLARIFICATION: canonical version registry]
- Q5: Team/Person docs에서 이름 표시 허용 범위는 어디까지인가? 전화/이메일은 masked로 확정.
- Q6: GraphDB, Foundry Ontology, local RDF store 중 Phase 2 KG runtime은 무엇인가? [NEEDS CLARIFICATION: KG runtime]
- Q7: Regulatory/current source refresh는 어떤 owner가 승인하는가? [NEEDS CLARIFICATION: compliance owner and SLA]
- Q8: Report export format은 Markdown, PDF, XLSX, JSON 중 무엇을 MVP에 포함하는가?
- Q9: Human-gate approval record는 어느 system에 저장하는가? [NEEDS CLARIFICATION: approval audit store]
- Q10: CostGuard standard rate reference는 어떤 table/schema를 기준으로 삼는가? [NEEDS CLARIFICATION: rate reference SSOT]

### Clarifications Log

- 2026-05-10 Session:
  - Q: 일반 ChatGPT 앱인가, 온톨로지 문서를 조회해 업무 답변하는 앱인가?
  - A: 온톨로지 프로젝트 문서를 기반으로 질문에 답하는 ChatGPT App이다.
- 2026-05-10 Session:
  - Q: Codex Skills는 runtime 답변 기능인가?
  - A: 아니다. Codex Skills는 앱, MCP tool, UI, validation, corpus update 개발 workflow용이다.

## Risks & Mitigations

| Risk ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Corpus가 stale 또는 승인되지 않은 문서를 포함함 | 잘못된 업무 판단 | doc version registry, validation_passes, admin publish gate |
| R2 | Evidence 없이 답변 생성 | hallucination risk | NO_EVIDENCE fail closed |
| R3 | CONSOLIDATED-00 누락 | semantic drift | A-ROUTE-001 equivalent validation |
| R4 | Flow Code 오용 | route/WH semantics 충돌 | WHP-only guard and semantic block |
| R5 | PII leakage | NDA/privacy breach | redaction middleware and export gate |
| R6 | Current regulation/rate 오답 | compliance/cost risk | STALE_SOURCE and owner review |
| R7 | Any-key ambiguity | wrong ShipmentUnit or Document | confidence threshold 0.95 and human review |
| R8 | UI component failure | user cannot inspect evidence visually | structuredContent text fallback |
| R9 | Human-gate bypass | unauthorized action | server-side action policy and audit log |
| R10 | Codex Skill/runtime confusion | unsafe architecture | repo AGENTS.md and skill boundaries |
| R11 | Prompt injection in retrieved docs | validation bypass attempt | retrieved text treated as evidence only |
| R12 | KG and corpus conflict | inconsistent answer | source precedence and conflict display |

## Traceability

| Item | Links to |
|---|---|
| User Story 1 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, NFR-001, NFR-006, SC-001, SC-003, SC-012 |
| User Story 2 | FR-009, FR-017, FR-023, NFR-003, NFR-008, NFR-009, SC-002, SC-006 |
| User Story 3 | FR-011, FR-012, FR-013, NFR-002, SC-004 |
| User Story 4 | FR-014, FR-015, FR-020, NFR-006, NFR-007, SC-009, SC-014 |
| User Story 5 | FR-014, FR-021, FR-022, FR-023, NFR-013, SC-010, SC-007 |
| User Story 6 | FR-019, FR-020, NFR-013, SC-006, SC-007 |
| User Story 7 | FR-024, FR-025, FR-026, NFR-010, NFR-011, NFR-012, SC-011 |
| Edge Cases | FR-006, FR-008, FR-012, FR-016, FR-017, FR-019, FR-020, FR-027, NFR-006, SC-006, SC-008, SC-012, SC-013 |

## Release Scope

### MVP Scope

- Corpus-only retrieval for approved ontology documents.
- route_question, search_ontology_corpus, validate_answer, compose_grounded_answer.
- Answer Card, Evidence Drawer, Domain Route Banner.
- ZERO/BLOCK states for no evidence, no CONSOLIDATED-00, PII detected, stale source.
- Any-key mock resolver for BL, BOE, DO, Invoice No., HVDC_CODE.
- Golden prompt tests for WH, Port, Material, Cost, MOSB, Role, Compliance, Flow Code, AGI/DAS.

### Phase 2 Scope

- GraphDB or Foundry-backed query_knowledge_graph.
- Ontology Path Viewer with real graph path.
- Action Composer with Human-gate audit.
- Report export with evidence pack.
- CostGuard and AGI/DAS closure fixtures expanded.

### Phase 3 Scope

- Foundry Object/Function integration.
- Live WMS/ERP/ATLP read-only connectors.
- Corpus Admin and Skill Console hardening.
- Enterprise role policy and rollout governance.

## Changelog

- v0.1.0 (2026-05-10): Initial Spec.md generated from UI/UX specification and Spec.md project rules.
