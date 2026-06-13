**HVDC Ontology Grounded
ChatGPT App UI/UX Specification**

온톨로지 프로젝트 문서를 조회한 후 업무 답변을 생성하는 ChatGPT App 설계서

| **항목** | **값** |
| --- | --- |
| 문서 버전 | 2.00-final-draft |
| 작성일 | 2026-05-10 (Asia/Dubai) |
| 제품명 | HVDC Ontology Answer App for ChatGPT |
| 핵심 목적 | ChatGPT 대화 중 사용자 질문을 HVDC 온톨로지 문서·지식그래프·증빙 규칙으로 grounding하여 업무 답변을 표준화 |
| 기술 기준 | OpenAI Apps SDK + MCP Server + Codex Agent Skills + Ontology RAG/KG |
| 적용 범위 | HVDC Project Logistics: Port/Customs/WH/MOSB/Site/Invoice/Document/Communication/Operations |

|  |
| --- |
| **제품 판정**  가능. 단, 이 앱은 일반 챗봇이 아니라 ‘Ontology-grounded Answer App’으로 설계해야 한다. ChatGPT는 먼저 MCP tool을 통해 온톨로지 corpus와 KG를 조회하고, 답변은 근거 문서·검증 결과·Human-gate 상태를 함께 반환한다. |

# 문서 목차

* 1. ExecSummary
* 2. 사용자 의도 재정의: ‘내 프로젝트 온톨로지로 답하는 ChatGPT App’
* 3. OpenAI 공식문서 기준 설계 원칙
* 4. Ontology Corpus Grounding Model
* 5. Schema: App Object / RDF-OWL / SHACL 요약
* 6. UI/UX Information Architecture
* 7. 핵심 화면 상세 설계
* 8. MCP Tool Contract 및 Answer Contract
* 9. Codex Skill Pack 설계
* 10. Integration: Foundry/GraphDB/ERP/WMS/ATLP/Invoices
* 11. Validation: SPARQL/RAG/Human-gate
* 12. Compliance: Incoterms/MOIAT/FANR/DCD/ADNOC/PII
* 13. Options ≥3
* 14. Roadmap: Prepare→Pilot→Build→Operate→Scale
* 15. Automation notes
* 16. QA checklist & Assumptions
* 17. CmdRec
* Appendix A. Wireframes
* Appendix B. Sample SKILL.md / AGENTS.md / MCP payload

# 1. ExecSummary

비즈니스 임팩트: 같은 HVDC 물류 업무를 하는 사용자가 ChatGPT에서 질문하면, 앱이 온톨로지 문서와 KG를 먼저 조회하여 동일한 기준·용어·책임경계로 답변한다. 개인별 기억이나 일반 LLM 추측에 의존하지 않는다.

기술 해법: ChatGPT App은 MCP server를 통해 `resolve\_any\_key`, `search\_ontology\_corpus`, `query\_knowledge\_graph`, `validate\_answer`, `create\_action\_request`를 호출한다. UI는 답변, 근거, 그래프 경로, 검증 상태, Human-gate를 한 화면에서 보여준다.

KPI/ROI: Answer Grounding Coverage 100.00%, Source Traceability ≥ 95.00%, Any-key Resolution ≥ 95.00%, Validation p95 < 5.00s, PII Leakage = 0.00건을 MVP 기준으로 둔다.

**ENG-KR one-liner: The app is not a chatbot; it is an ontology-grounded operational answer layer for HVDC logistics.**

| **구분** | **기존 ChatGPT 대화** | **제안 ChatGPT App** |
| --- | --- | --- |
| 답변 기준 | 모델 일반지식 + 현재 대화 맥락 | HVDC 온톨로지 문서 + KG + 검증룰 + 권한 |
| 업무 용어 | 사용자별 편차 발생 | CONSOLIDATED-00 master spine 기준으로 통일 |
| 근거 제시 | 선택적 | 필수: Source document, section, evidence snippet, validation verdict |
| 오류 방지 | 후행 사용자 검토 | 조회 실패/충돌/규정 이슈는 ZERO/Failsafe로 답변 중단 |
| 팀 확장성 | 개인 대화에 종속 | 동일 업무 사용자에게 동일 corpus 기반 답변 제공 |

# 2. 사용자 의도 재정의

|  |
| --- |
| **요청 해석**  사용자는 ‘Codex로 일반 앱을 만들자’가 아니라, 온톨로지 프로젝트 안의 문서를 ChatGPT App이 업무 지식 기반으로 삼아 질문에 답하는 구조를 원한다. 즉, 질문 → 온톨로지 문서/KG 조회 → 업무 도메인 해석 → 검증된 답변 → 증빙/다음 액션 반환 흐름이다. |

| **사용자 질문 유형** | **앱이 해야 할 일** | **주 조회 문서** |
| --- | --- | --- |
| ‘이 자재 현재 상태?’ | Any-key 추출 → ShipmentUnit 연결 → milestone/currentStage 반환 | 00, 06, 09 |
| ‘AGI/DAS M130 닫아도 돼?’ | RoutingPattern + site date + M115/M116/M117 evidence check → delivered/warn/pass 판단 | 00, 04, 06, 08 |
| ‘이 invoice 과청구야?’ | InvoiceLine → RateRef/TariffRef → CostGuardResult → Human-gate | 05, 03, 07 |
| ‘Flow Code 어디에 써?’ | WHP-only rule 설명, route classification 금지 표시 | 00, 02, AGENTS |
| ‘누가 담당?’ | Milestone/role matrix 조회, PII masking 후 role-level 답변 | Team Matrix, person docs, 08 |
| ‘통관/BOE/DO 지연 원인?’ | M90/M91/M92/M100 chronology + document/port evidence 조회 | 03, 06, 07 |
| ‘월간 보고서 만들어줘’ | OperationDataset/KPIObservation/ReportArtifact 기준으로 report 생성 | 09 |

# 3. OpenAI 공식문서 기준 설계 원칙

OpenAI 공식문서 기준으로 ChatGPT App은 MCP를 통해 ChatGPT와 연결된다. MCP server는 app capability인 tool을 정의하고, 선택적으로 UI component를 iframe으로 렌더링한다. 따라서 본 앱은 ‘질문을 받으면 모델이 임의로 답변’하는 구조가 아니라, 모델이 tool metadata를 보고 적절한 MCP tool을 호출하도록 설계한다.

| **공식 기준** | **제품 적용** |
| --- | --- |
| Apps SDK Quickstart | MCP server는 필수. UI component는 선택이지만, 본 제품은 Evidence Viewer와 Graph Path Viewer가 필요하므로 iframe UI를 사용한다. |
| Build MCP Server | 서버는 tools/auth/data/UI bundle 연결을 담당한다. `structuredContent`는 모델 narration과 UI rendering의 공통 데이터가 된다. |
| Build ChatGPT UI | UI component는 tool result를 `structuredContent`에서 받아 대화 내부에 렌더링한다. Evidence Drawer는 별도 앱이 아니라 ChatGPT 대화 안의 component다. |
| Apps SDK Reference | tool마다 `outputSchema`를 선언하고 `\_meta.ui.resourceUri`로 UI resource를 연결한다. |
| Security & Privacy | least privilege, explicit consent, server-side validation, audit log, PII redaction을 기본값으로 둔다. |
| App Submission Guidelines | tool name/description은 명확하고 실제 동작과 일치해야 한다. 넓은 트리거 문구로 모델 선택을 유도하지 않는다. |
| Codex Agent Skills | Codex Skill은 reusable workflow authoring format이며 `SKILL.md`와 optional scripts/references/assets로 구성한다. 본 앱의 build/QA/ontology update workflow를 skill로 만든다. |

|  |
| --- |
| **설계 결론**  ChatGPT App의 runtime은 MCP tools + structuredContent + UI bundle이다. Codex Skills는 runtime 사용자 답변 엔진이 아니라, 앱·tool·RAG·검증룰을 반복 개발/수정/배포하기 위한 reusable workflow로 둔다. |

# 4. Ontology Corpus Grounding Model

앱은 모든 질문에 대해 `CONSOLIDATED-00-master-ontology.md`를 semantic spine으로 먼저 조회한다. 이후 질문 도메인에 따라 확장 문서를 선택한다. 문서 간 충돌이 있으면 `CONSOLIDATED-00`을 우선하고, evidence layer는 operational truth가 아니라 근거로만 사용한다.

| **문서** | **앱 내 역할** | **답변 사용 방식** |
| --- | --- | --- |
| CONSOLIDATED-00 | Canonical semantic spine | 항상 우선 조회. Any-key, ShipmentUnit, RoutingPattern, MilestoneEvent, Evidence policy 결정 |
| CONSOLIDATED-01 | Framework/Infra/Compliance anchor | Node/authority/standard 기반 blocker 질문에 사용 |
| CONSOLIDATED-02 | Warehouse/WHP | 창고, WHP, confirmedFlowCode 질문에 사용. route 답변에는 Flow Code 금지 |
| CONSOLIDATED-03 | Document/OCR evidence | CI/PL/BL/BOE/DO/Permit/OCR confidence/cross-doc mismatch 답변 |
| CONSOLIDATED-04 | Marine/Barge/Bulk/OOG | MOSB, LCT, stability/lashing/lifting, marine readiness 답변 |
| CONSOLIDATED-05 | Invoice/CostGuard | invoice, rate, tariff, DEM/DET, CostGuard band 답변 |
| CONSOLIDATED-06 | Material chain | M90~M160 custody, customs→WH→MOSB→site, AGI/DAS gate |
| CONSOLIDATED-07 | Port/OFCO | PortCall, Rotation, release chronology, OFCO service evidence |
| CONSOLIDATED-08 | Communication evidence | email/chat/approval/action/SLA/PII redaction. Truth mutation 금지 |
| CONSOLIDATED-09 | Operations analytics | dashboard, KPI, report artifact, data mapping, snapshot |
| Team/Person docs | Role grounding | 담당자/역할 질문에서 사용. 전화/이메일 마스킹 |
| Palantir Semantic Digital Twin PDF | Architecture blueprint | Semantic Digital Twin, RDF/OWL/SPARQL/SHACL, dashboard/automation framing |

## 4.1 Runtime Grounding Flow

**Grounding flow**

User question
 -> Language/key extraction: KR/EN, BL/BOE/DO/HVDC\_CODE/Invoice/Person/Route
 -> Intent route: master spine + target extension candidates
 -> Mandatory source load: CONSOLIDATED-00 first
 -> Retrieve: section chunks + KG triples + evidence snippets
 -> Resolve: Any-key -> nearest ShipmentUnit / Document / Invoice / PersonRole
 -> Validate: SHACL/SPARQL/RAG/Human-gate
 -> Compose answer: verdict + 업무 영향 + 근거 + next action
 -> Render UI: Answer Card + Evidence Drawer + Ontology Path + Action Gate

## 4.2 Corpus Ranking Rule

| **Rank** | **Source** | **Rule** |
| --- | --- | --- |
| 1.00 | CONSOLIDATED-00 | 항상 포함. conflicting source가 있으면 master spine 우선. |
| 2.00 | Target extension | 질문 도메인과 직접 관련된 1~3개 extension만 조회. |
| 3.00 | Evidence layer | 문서/OCR/communication/port/cost evidence는 truth owner가 아닌 근거로 사용. |
| 4.00 | Team role docs | 담당자/role 질문에서만 사용. PII masking 필수. |
| 5.00 | External/current sources | 법·요율·공식 API 등 현재성이 필요한 항목은 RAG refresh 후 표시. |
| BLOCK | Deprecated/legacy route-coded Flow Code | 명시적 deprecation/migration 설명 외에는 답변 근거로 사용 금지. |

# 5. Schema (RDF/OWL + App Object + SHACL 요약)

Schema-first 원칙: UI와 MCP tool은 먼저 answer object, evidence object, validation object의 contract를 정의해야 한다. 그래야 모델·서버·UI가 같은 구조를 공유한다.

## 5.1 App Object Model

| **Object** | **Required fields** | **Purpose** |
| --- | --- | --- |
| OntologyQuerySession | sessionId, userRole, questionText, language, createdAt, queryMode | 한 번의 질문-조회-답변 세션 |
| IntentRoute | routeId, domains[], requiredDocs[], confidence, routingReason | 질문을 domain/doc/tool로 라우팅 |
| ResolvedEntity | entityType, identifierScheme, identifierValue, normalizedValue, targetRid, confidence | Any-key 결과: ShipmentUnit/Invoice/Document/PersonRole 등 |
| EvidenceSnippet | docId, title, version, sectionPath, snippet, docHash, confidence, sourceType | 답변 근거 조각 |
| GraphPath | startNode, edges[], endNode, pathConfidence | 질문에서 답변까지 이어지는 ontology/KG 경로 |
| GroundedAnswer | answerId, verdict, summary, businessImpact, details[], evidenceIds[], validationStatus | 사용자에게 표시되는 최종 답변 |
| ValidationFinding | ruleId, reasonCode, severity, status, targetObject, evidenceIds, message | SHACL/SPARQL/RAG/Human-gate 검증 결과 |
| ActionRecommendation | actionType, ownerRole, parameters, humanGateRequired, dueAt | 승인/추가 확인/보고서 생성 등 다음 액션 |
| ToolCallAudit | toolName, inputHash, outputHash, userRole, timestamp, piiMasked | 감사 로그 |

## 5.2 RDF/OWL 핵심 연결

**Ontology answer layer**

hvdcapp:GroundedAnswer a owl:Class .
hvdcapp:EvidenceSnippet a owl:Class .
hvdcapp:ValidationFinding a owl:Class .
hvdcapp:OntologyQuerySession a owl:Class .

hvdcapp:answersQuestion rdfs:domain hvdcapp:GroundedAnswer ; rdfs:range hvdcapp:OntologyQuerySession .
hvdcapp:groundedBy rdfs:domain hvdcapp:GroundedAnswer ; rdfs:range hvdcapp:EvidenceSnippet .
hvdcapp:validatedBy rdfs:domain hvdcapp:GroundedAnswer ; rdfs:range hvdcapp:ValidationFinding .
hvdcapp:resolvesTo rdfs:domain hvdcapp:ResolvedEntity ; rdfs:range owl:Thing .
hvdcapp:referencesCoreTwin rdfs:domain hvdcapp:GroundedAnswer ; rdfs:range hvdc:ShipmentUnit .

## 5.3 SHACL Guard 요약

| **Rule** | **Target** | **UX behavior** |
| --- | --- | --- |
| A-ANS-001 | GroundedAnswer | 업무 사실 답변은 최소 1개 EvidenceSnippet 없으면 `NO\_EVIDENCE`로 중단 |
| A-ANS-002 | GroundedAnswer | verdict는 PASS/WARN/BLOCK/INFO/NO\_EVIDENCE 중 하나 |
| A-EVID-001 | EvidenceSnippet | docId, version/date, sectionPath, docHash required |
| A-ROUTE-001 | IntentRoute | CONSOLIDATED-00을 requiredDocs에 포함하지 않으면 BLOCK |
| A-PII-001 | EvidenceSnippet/Answer | 전화/이메일 원문 노출 금지. masked 또는 role-only |
| A-CURRENT-001 | Regulatory/Rate answer | 현재 규정·요율 질문은 approved SOP/current source refresh 없으면 `STALE\_SOURCE` |
| A-ACTION-001 | ActionRecommendation | write/action은 human confirmation과 AuditRecord 없으면 실행 금지 |

# 6. UI/UX Information Architecture

앱의 UI는 ChatGPT 대화 안에서 작동한다. 모델 답변만 보여주지 않고, ontology route, evidence, validation, action gate를 함께 보여주는 구조다.

| **Layer** | **UI Component** | **User Value** |
| --- | --- | --- |
| Conversation | Question Composer | 자연어/키 입력. 예: ‘AGI M130 닫아도 돼?’, ‘BOE 123 지연 원인?’ |
| Routing | Domain Route Banner | 어떤 문서를 보고 답하는지 즉시 표시: Master + target extensions |
| Answer | Grounded Answer Card | 판정, 업무 영향, 근거 요약, 다음 액션 |
| Evidence | Evidence Drawer | 문서명/버전/section/snippet/hash/confidence |
| Graph | Ontology Path Viewer | Identifier → ShipmentUnit → Milestone/Document/Cost/Owner 경로 |
| Validation | Validation Gate Panel | SHACL/SPARQL/RAG/Human-gate 결과 |
| Action | Action Composer | 승인 요청, 추가증빙 요청, TG/WhatsApp summary, report export |
| Admin | Corpus & Skill Console | 문서 색인 상태, version drift, skill QA, tool contract test |

## 6.1 Core UX Principle

* 답변 전에 조회한다: factual 업무 답변은 `search\_ontology\_corpus` 또는 `query\_knowledge\_graph` 없는 상태로 생성 금지.
* 근거를 먼저 노출한다: 답변 card 상단에 사용 문서와 validation verdict를 표시한다.
* 운영 truth와 evidence를 분리한다: 문서/OCR/communication은 evidence로 표시하고, ShipmentUnit/CostGuard/SiteReceipt 등 truth owner를 명시한다.
* 충돌은 숨기지 않는다: 문서 간 충돌/구버전/owner mismatch가 있으면 BLOCK 또는 WARN으로 표시한다.
* UI 실패를 업무 실패로 승격하지 않는다: card template 로딩 실패는 `uiRenderStatus=TEMPLATE_FETCH_FAILED`로 표시하고, `verdict`, `validationStatus`, `evidenceIds`, `actions`는 보존한다.
* 다음 액션을 명확히 한다: 담당 role, 필요한 증빙, human-gate 여부, SLA를 함께 제시한다.

# 7. 핵심 화면 상세 설계

| **Screen** | **목적** | **주요 요소** | **UX behavior** |
| --- | --- | --- | --- |
| S01. Ask Workspace | 질문 입력 및 키 추출 | 텍스트 입력, file/key chips, mode selector(Ask/Trace/Validate/Report), language toggle | 질문 입력 즉시 key candidate를 chip으로 표시. Submit 시 MCP tool routing. |
| S02. Domain Route Banner | 조회 기준 투명화 | Master doc chip, extension chips, confidence meter, stale badge | 예: `00 Master + 06 Material + 04 Marine + 08 Evidence`. 사용자에게 어떤 corpus로 답하는지 노출. |
| S03. Grounded Answer Card | 업무 답변 표시 | Verdict, 3-line summary, business impact, recommended action, confidence | PASS/WARN/BLOCK/INFO 상태. No evidence면 답변 대신 ZERO table. |
| S04. Evidence Drawer | 근거 검증 | Document title, version/date, section path, snippet, doc hash, confidence, source owner | 각 답변 문장 옆 evidence badge를 누르면 drawer open. |
| S05. Ontology Path Viewer | 지식그래프 경로 이해 | Graph path: Identifier -> ShipmentUnit -> Milestone -> Document -> Cost/Owner | 현장 사용자가 ‘왜 이 답변이 나왔는지’ 시각적으로 확인. |
| S06. Any-key Resolver | BL/BOE/DO/Invoice/HVDC\_CODE 검색 | Identifier input, scheme selector, candidate list, confidence, resolve button | 복수 후보 시 사용자가 선택하거나 Data Steward review 요청. |
| S07. Validation Gate Panel | 검증 결과 | SHACL, SPARQL, RAG freshness, Human-gate tabs | 규칙별 PASS/WARN/BLOCK 및 필요한 source/action 표시. |
| S08. Action Composer | 업무 실행 연결 | request evidence, create approval, send summary, export report | write action은 confirmation prompt와 AuditRecord 필요. |
| S09. Corpus Admin | 문서/색인 관리 | doc status, version, changedAt, validation\_passes, index health | 새 온톨로지 문서 반영, stale source 알림. |
| S10. Skill Console | Codex build workflow | skill list, trigger examples, test prompts, output schema diff | Codex가 app/tool/UI/validation 수정 시 반복 사용. |

## 7.1 Answer Card Layout

**Grounded Answer Card sample**

[Verdict: WARN] AGI/DAS M130 is accepted from site date; MOSB evidence backfill required
- Why: MOSB/LCT chain evidence is missing or stale.
- Ontology route: CONSOLIDATED-00 -> CONSOLIDATED-06 -> CONSOLIDATED-04 -> CONSOLIDATED-08
- Evidence: M115/M116/M117 required for MOSB-inclusive AGI/DAS route.
- Next action: Request MOSB staging evidence from Marine owner and attach approval record.

[Evidence badges]
 00.Master 06.MaterialHandling 04.Marine 08.Communication

[Actions]
 Request Evidence | Create Approval Gate | Export Note | Open Graph Path

## 7.2 Evidence Drawer Layout

| **Field** | **Display** | **Rule** |
| --- | --- | --- |
| Source | CONSOLIDATED-06-material-handling.md | file name + domain + version/date |
| Section | Governance / AGI-DAS Gate | section path required |
| Snippet | short Korean/English excerpt | copyright/sensitive constraints 준수; 필요한 최소 문장 |
| Ownership | Material Handling owns milestone continuity | truth owner/evidence owner 분리 |
| Validation | PASS/WARN/BLOCK | rule IDs 표시 |
| Hash | docHash/sourceHash | audit reproducibility |
| PII | masked | email/tel raw 표시 금지 |

# 8. MCP Tool Contract 및 Answer Contract

MCP tool은 ChatGPT에게 앱 사용법을 알려주는 ‘manual’ 역할을 한다. 도구명은 동사형으로 구체적으로 작성하고, input/output schema를 좁게 설계한다.

| **Tool** | **Input** | **Output** | **UI** |
| --- | --- | --- | --- |
| route\_question | question, userRole, language | IntentRoute | Domain Route Banner |
| search\_ontology\_corpus | query, requiredDocs, domainHints, topK | EvidenceSnippet[] | Evidence Drawer |
| resolve\_any\_key | identifierScheme, identifierValue | ResolvedEntity[] | Any-key Resolver |
| query\_knowledge\_graph | templateId, params | GraphPath + object facts | Ontology Path Viewer |
| ask\_hvdc\_ontology | question, userRole, language | GroundedAnswer without `ui` | Text fallback / data result |
| render\_hvdc\_answer\_card | GroundedAnswer | GroundedAnswer with render-only `ui` | Answer Card |
| validate\_answer | answerDraft, evidenceIds, ruleSet | ValidationFinding[] | Validation Gate Panel |
| compose\_grounded\_answer | sessionId, evidenceIds, graphPathIds | GroundedAnswer | Planned extension |
| create\_action\_request | targetObject, reason, ownerRole, evidenceIds | ActionRecommendation | Action Composer |
| export\_answer\_report | answerId, format | ReportArtifact | Download/export |

## 8.1 StructuredContent Contract

**Example structuredContent**

{
 "answerId": "ans\_20260510\_001",
 "verdict": "WARN",
 "dataStatus": "OK",
 "businessResultVisible": true,
 "fallbackUsed": false,
 "summary": "AGI/DAS site date is accepted as M130 Site Arrived; MOSB/LCT chain evidence must be backfilled.",
 "businessImpact": "Blocking delivered site receipts may distort KPI and inventory; missing MOSB evidence remains an audit backfill gap.",
 "usedSources": [
 {"docId":"CONSOLIDATED-00", "role":"canonical spine", "version":"2.0-final"},
 {"docId":"CONSOLIDATED-06", "role":"material-chain owner", "version":"2.0-final"}
 ],
 "resolvedEntities": [{"entityType":"ShipmentUnit", "targetRid":"su\_...", "confidence":0.97}],
 "validation": [{"ruleId":"V-AGIDAS-001", "reasonCode":"MOSB_EVIDENCE_MISSING", "status":"WARN", "severity":"WARN"}],
 "actions": [{"actionType":"BACKFILL\_MOSB\_CHAIN\_EVIDENCE", "ownerRole":"Marine Lead", "humanGateRequired":false}]
}

`uiTemplate` metadata belongs to `render_hvdc_answer_card`. Data tools such as `ask_hvdc_ontology` and `search_ontology_corpus` return structured evidence data without directly attaching the iframe. In the current runtime, `ask_hvdc_ontology` also omits `structuredContent.ui`; `render_hvdc_answer_card` adds `ui.templateUrl`, `templateVersion`, and `schemaVersion` only when the card is actually rendered.

Render-only UI state example:

{
 "ui": {
   "dataStatus": "OK",
   "uiRenderStatus": "READY",
   "businessResultVisible": true,
   "fallbackUsed": false,
   "templateUrl": "ui://hvdc/answer-card-v6.html",
   "templateVersion": "answer-card-v6",
   "schemaVersion": "1.0.0",
   "doNotChange": ["verdict", "validationStatus", "evidenceIds", "actions"]
 }
}

If the ChatGPT client cannot load the card template or the widget falls back after a render error, the app must show a text fallback with `dataStatus=OK`, `uiRenderStatus=TEMPLATE_FETCH_FAILED` or `FALLBACK_RENDERED`, `businessResultVisible=true`, and `fallbackUsed=true`. This warning is UI-only and must not change the business answer verdict or evidence.

The widget must wrap long action names, protected-field lists, route reasons, and validation messages inside the card. It uses responsive grid columns, `overflow-wrap:anywhere`, `word-break:break-word`, and a small-screen one-column metadata layout to prevent clipped text.

## 8.2 Tool Descriptor Sketch

**MCP tool descriptor concept**

registerAppTool(server, "ask\_hvdc\_ontology", {
 title: "Ask HVDC ontology",
 description: "Use this when the user asks an HVDC logistics question that must be answered from the approved ontology corpus with evidence, validation, and next action.",
 inputSchema: AskQuestionSchema,
 outputSchema: GroundedAnswerSchema,
 \_meta: {
   "openai/toolInvocation/invoking": "Searching HVDC ontology corpus",
   "openai/toolInvocation/invoked": "HVDC ontology answer ready"
 }
});

registerAppTool(server, "render\_hvdc\_answer\_card", {
 title: "Render HVDC answer card",
 description: "Use this after ask_hvdc_ontology to render the final HVDC answer card. Pass through the complete ask_hvdc_ontology structured answer.",
 inputSchema: GroundedAnswerSchema,
 outputSchema: GroundedAnswerSchema,
 \_meta: {
   "\_meta.ui.resourceUri": "ui://hvdc/answer-card-v6.html",
   "openai/outputTemplate": "ui://hvdc/answer-card-v6.html",
   "openai/widgetAccessible": true
 }
});

# 9. Codex Skill Pack 설계

Codex는 앱을 만드는 개발 에이전트다. Skill은 앱 runtime 기능이 아니라, 반복되는 개발·검증·문서화·배포 workflow를 안정화하는 도구다. 2026년 기준 OpenAI Codex docs는 `.agents/skills` 경로와 `SKILL.md`의 name/description을 기준으로 한다. 기존 `.codex/skills` 구조는 repo 관례가 있다면 symlink 또는 migration layer로 유지할 수 있다.

| **Skill** | **Trigger** | **Codex가 수행할 일** | **Output** |
| --- | --- | --- | --- |
| ontology-corpus-indexer | 온톨로지 문서 추가/수정 | frontmatter, section, hash, validation\_passes, role matrix를 재색인 | corpus\_index.json |
| mcp-tool-contract | tool 추가/수정 | input/output schema, tool description, UI resource URI, tests 작성 | server tool module |
| answer-grounding | 답변 품질 개선 | answer contract, evidence coverage, hallucination ban test 작성 | answer composer |
| sparql-template | KG query 추가 | Any-key, ETA, CostGuard, AGI/DAS gate SPARQL template 작성 | sparql templates |
| uiux-component | UI 화면 추가 | Answer Card/Evidence Drawer/Graph Viewer React component scaffold | web component |
| validation-gate | 검증룰 변경 | SHACL/SPARQL/Human-gate tests 및 ZERO state 추가 | validation module |
| privacy-redactor | PII 정책 | phone/email masking, role-only display, audit log field review | redaction middleware |
| submission-readiness | ChatGPT App 배포 전 | tool names, privacy policy, screenshots, stability checklist | release checklist |

## 9.1 Skill Directory

**Recommended Codex skill tree**

.agents/
 skills/
 ontology-corpus-indexer/
 SKILL.md
 scripts/index\_corpus.py
 references/corpus\_schema.md
 mcp-tool-contract/
 SKILL.md
 scripts/validate\_tool\_schema.py
 answer-grounding/
 SKILL.md
 references/answer\_contract.md
 validation-gate/
 SKILL.md
 scripts/run\_validation\_tests.py
 uiux-component/
 SKILL.md
 assets/wireframe\_tokens.json

## 9.2 SKILL.md 예시

**answer-grounding/SKILL.md**

---
name: answer-grounding
description: Build and test ontology-grounded answer flows for the HVDC ChatGPT App. Trigger when editing answer contracts, evidence retrieval, citation display, ZERO/Failsafe states, or hallucination guard tests.
---

Workflow
1. Load CONSOLIDATED-00 as the canonical semantic spine.
2. Identify target extension documents from the user intent.
3. Require EvidenceSnippet coverage for every factual claim.
4. Separate operational truth from evidence-only sources.
5. Run validation: SHACL/SPARQL/RAG/Human-gate.
6. Return PASS/WARN/BLOCK/NO\_EVIDENCE and UI payload.

Output
- answer\_contract.json
- validation\_tests.json
- UI state examples
- failure cases for no evidence, stale source, conflicting owner, PII leakage

# 10. Integration (Foundry↔ERP/WMS/ATLP/Invoice/Ontology Corpus)

본 앱은 온톨로지 문서만 읽는 FAQ가 아니다. 향후 live KG/Foundry/GraphDB와 연결하여 실제 ShipmentUnit, Document, Invoice, MilestoneEvent를 조회할 수 있어야 한다.

| **Integration** | **Data source** | **App behavior** | **Guard** |
| --- | --- | --- | --- |
| Ontology corpus | CONSOLIDATED docs, Team docs, PDF | section/chunk/evidence search | docHash/version/validation status |
| RDF/KG | GraphDB/SPARQL or Foundry Ontology Functions | Any-key -> object -> graph path | SPARQL templates + SHACL |
| Foundry | Object Types/Links/Actions/Functions | resolveAnyKey, computeCurrentStage, CostGuard view | transaction-gated Actions |
| ERP/Procurement | Project, PO, package, vendor, material | procurement context answer | master data ownership |
| WMS | M110/M111/M120/M121, stock, WHP | warehouse/storage/dwell answer | WHP-only Flow Code |
| ATLP/Customs | BOE, DO, permits, gate-out | release blocker and customs status | current SOP/RAG refresh |
| Invoice/Cost | InvoiceLine, RateRef, TariffRef, CostGuard | cost variance and approval gate | AED/USD preservation; Human-gate >100,000.00 AED |
| Communication | Email/chat/approval evidence | SLA/action/evidence linkage | PII redaction; no transaction mutation |

## 10.1 Target Runtime Architecture

**Runtime architecture**

ChatGPT Host
 -> MCP App Tools
 -> Auth / role policy / consent
 -> Ontology Corpus Retriever
 -> Markdown/PDF section index
 -> vector + lexical + metadata ranking
 -> Knowledge Graph Query Engine
 -> SPARQL templates / Foundry Functions
 -> Validation Engine
 -> SHACL + SPARQL + RAG freshness + Human-gate
 -> Answer Composer
 -> structuredContent + evidence pack + UI state
 -> UI Components
 -> Answer Card / Evidence Drawer / Graph Path / Action Composer

# 11. Validation (SPARQL/RAG/Human-gate)

Validation은 답변 후 장식이 아니라 답변 생성 전 필수 gate다. factual claim은 evidence, operational action은 human-gate, current regulation/rate는 RAG freshness가 필요하다.

| **Gate** | **Trigger** | **Pass condition** | **UI state** |
| --- | --- | --- | --- |
| Source Coverage | 업무 사실 답변 | 모든 핵심 claim에 EvidenceSnippet ≥ 1 | NO\_EVIDENCE if fail |
| Master Spine | 모든 질문 | CONSOLIDATED-00 조회 완료 | BLOCK if omitted |
| Any-key | identifier 포함 질문 | candidate confidence ≥ 0.95 또는 human review | MULTIPLE\_CANDIDATES |
| Flow Code | route/warehouse 질문 | Flow Code는 WHP-only로 제한 | SEMANTIC\_BLOCK |
| AGI/DAS | M130/Site closure | site date plus M115/M116/M117 backfill evidence | WARN/AMBER |
| CostGuard | invoice/rate 질문 | line arithmetic + band + threshold check | PASS/WARN/HIGH/CRITICAL |
| PII | role/person 답변 | phone/email masked; role-only where possible | REDACTED |
| Currentness | 법/요율/SOP 질문 | approved current source refreshed | STALE\_SOURCE |

## 11.1 SPARQL Template: Any-key → ShipmentUnit

**SPARQL template**

PREFIX hvdc: <http://samsung.com/project-logistics#>
SELECT ?unit ?scheme ?value ?stage ?routing ?doc ?milestone ?cost ?exception
WHERE {
 ?id hvdc:identifierScheme ?scheme ;
 hvdc:normalizedValue ?value ;
 hvdc:resolvesTo ?resolved .
 BIND(COALESCE(?resolved, ?id) AS ?seed)
 ?seed (hvdc:belongsToShipmentUnit|^hvdc:hasDocument|^hvdc:packedIn|^hvdc:hasCustomsEntry|^hvdc:hasReleaseOrder)\* ?unit .
 ?unit a hvdc:ShipmentUnit ;
 hvdc:hasCurrentStage ?stage ;
 hvdc:hasRoutingPattern ?routing .
 OPTIONAL { ?unit hvdc:hasDocument ?doc . }
 OPTIONAL { ?unit hvdc:hasMilestone ?milestone . }
 OPTIONAL { ?unit hvdc:hasCostItem ?cost . }
 OPTIONAL { ?unit hvdc:hasException ?exception . }
}

## 11.2 ZERO / Failsafe UX

| **단계** | **이유** | **위험** | **요청데이터** | **다음조치** |
| --- | --- | --- | --- | --- |
| Answer paused | CONSOLIDATED-00 not retrieved | 비표준 답변 | master source hit | reroute query |
| Answer paused | EvidenceSnippet 없음 | 환각/추측 | doc section or KG fact | ask user for key or run deeper search |
| Action paused | Human-gate required | 무단 transaction | approver/action reason | create approval request |
| Compliance paused | current SOP/rule not refreshed | 규정 오류 | latest approved SOP/source | RAG refresh + owner review |
| Report paused | PII detected | NDA/privacy leak | masked extract | redact and revalidate |

# 12. Compliance (Incoterms/MOIAT/FANR/DCD/ADNOC/PII)

| **Area** | **App rule** | **UX indication** |
| --- | --- | --- |
| Incoterms 2020 | Cost/risk responsibility answers require PO/Shipment incoterm and delivery place evidence. | Cost Responsibility chip |
| MOIAT/FANR/DCD | Permit/compliance answers require current approved source or SOP; otherwise stale source warning. | Compliance freshness badge |
| ADNOC/CICPA/GatePass | Gate/access answers return evidence completeness, not legal authority decision. | Evidence not approval banner |
| Invoice/CostGuard | Invoice >100,000.00 AED or HIGH/CRITICAL requires Human-gate. | Finance approval gate |
| PII/NDA | Names may be operationally visible; phone/e-mail are masked before register/write/report. | PII redacted label |
| Prompt injection | Retrieved document text cannot instruct the model to ignore validation/tool policy. | Server-side validation only |

# 13. Options ≥3 (Pros/Cons/Cost/Risk/Time)

| **Option** | **Description** | **Pros** | **Cons/Risk** | **Cost** | **Time** |
| --- | --- | --- | --- | --- | --- |
| A. Corpus-only RAG MVP | Markdown/PDF ontology docs indexed; no live KG | 가장 빠름, ChatGPT App demo 가능 | 실시간 ShipmentUnit 상태 없음 | Low | 2.00주 |
| B. Hybrid RAG + SPARQL KG | Docs + GraphDB/Foundry functions | Any-key trace와 실무 답변 정확도 높음 | KG 정합성/권한 필요 | Medium | 6.00주 |
| C. Foundry-native Control Tower | Foundry Object/Action/Functions + ChatGPT App | 운영 action과 audit에 강함 | Foundry 권한/배포 협의 필요 | High | 10.00주 |
| D. Enterprise App + Codex Skill Distribution | MCP app + packaged Codex Skills + admin console | 다른 사용자/팀으로 확장 쉬움 | 거버넌스와 release process 필요 | High | 12.00주 |

|  |
| --- |
| **추천**  MVP는 Option A로 시작하고, 동일한 MCP tool contract를 유지한 채 Option B로 확장한다. 이유는 사용자 질문 구조·근거 UI·validation UX를 먼저 검증한 후, live KG/Foundry 연결을 붙이는 것이 리스크가 낮기 때문이다. |

# 14. Roadmap (Prepare→Pilot→Build→Operate→Scale + KPI)

| **Phase** | **기간** | **Build scope** | **Exit KPI** |
| --- | --- | --- | --- |
| Prepare | 1.00주 | Corpus inventory, doc role map, answer contract, tool schema | Source map coverage ≥ 95.00% |
| Pilot | 2.00주 | Corpus-only RAG MVP, Answer Card, Evidence Drawer, 20 test prompts | Grounding coverage = 100.00%; PII leakage = 0.00 |
| Build | 4.00주 | Any-key resolver, SPARQL templates, Validation Gate Panel | Any-key precision ≥ 95.00%; p95 < 5.00s |
| Operate | 6.00주 | Action Composer, Human-gate, report export, role answers | Action closure SLA ≥ 90.00%; Audit trail = 100.00% for blocked actions |
| Scale | 8.00~12.00주 | Foundry/GraphDB live KG, Codex Skill plugin, admin governance | Ontology answer adoption ≥ 80.00%; repeat issue reduction ≥ 30.00% |

## 14.1 2.00주 MVP Sprint

| **Day** | **Task** | **Deliverable** |
| --- | --- | --- |
| D1 | OpenAI Apps SDK project scaffold + MCP server | server/web skeleton |
| D2 | Corpus ingestion for 00~09 + Team Matrix | corpus\_index.json |
| D3 | route\_question + search\_ontology\_corpus tools | tool tests |
| D4 | Answer Card + Evidence Drawer UI | iframe UI |
| D5 | Answer contract + ZERO states | validation fixtures |
| D6 | Any-key mock resolver | BL/BOE/DO/HVDC\_CODE demo |
| D7 | Domain prompts: WH/Port/Material/Cost/MOSB/Role | golden prompt set |
| D8 | Privacy redaction + audit log | PII test pass |
| D9 | QA: latency, source coverage, hallucination block | QA report |
| D10 | Demo package + screenshots + rollout note | MVP release |

# 15. Automation notes (RPA/LLM/Sheets/TG hooks)

| **Hook** | **Trigger** | **Automation** | **Safety** |
| --- | --- | --- | --- |
| Corpus refresh | new/modified ontology doc | re-index, version diff, validation\_passes update | admin review before publish |
| Answer QA | new answer template | golden prompts + no-evidence tests | fail closed |
| TG/WhatsApp summary | ActionRecommendation created | send role-specific summary | PII masking, user confirmation |
| Invoice audit | invoice question/upload | CostGuard skill + evidence pack | Human-gate for >100,000.00 AED |
| Port delay | M92 without M100 | DEM/DET risk alert | source timestamp required |
| Monthly report | scheduled snapshot | CONSOLIDATED-09 5-sheet report generation | source hash + mapping version |

# 16. QA checklist & Assumptions(가정:)

| **#** | **Check** | **Target** |
| --- | --- | --- |
| 1.00 | All factual answers call retrieval tool before final answer | PASS |
| 2.00 | CONSOLIDATED-00 is included for ontology/operation questions | PASS |
| 3.00 | Evidence Drawer shows doc/version/section/hash/confidence | PASS |
| 4.00 | Flow Code not used as route classification | PASS |
| 5.00 | MOSB not typed as Warehouse | PASS |
| 6.00 | Document/OCR/Communication evidence cannot mutate operational truth | PASS |
| 7.00 | PII redaction for tel/email | 0.00 leakage |
| 8.00 | Regulatory/rate questions show freshness state | PASS |
| 9.00 | Tool descriptions match actual behavior | PASS |
| 10.00 | App latency p95 | < 5.00s for corpus-only MVP |
| 11.00 | Answer grounding coverage | 100.00% for core claims |
| 12.00 | Human-gate blocks write/action when required | 100.00% |

## 16.1 Assumptions(가정:)

| **Assumption** | **Impact** | **Mitigation** |
| --- | --- | --- |
| 초기 MVP는 live ERP/WMS 없이 ontology corpus만 조회한다. | 실시간 상태 답변은 제한됨 | 답변에 ‘corpus-based’ badge를 표시하고 live 연결 전에는 status claim을 제한 |
| 문서 section line/page metadata는 색인 시 생성 가능하다. | 근거 추적 품질 좌우 | docHash + sectionPath + chunk offset 저장 |
| 팀원 역할 문서는 업무상 이름 사용이 허용되지만 연락처는 PII다. | privacy risk | phone/email mask; role-only output option |
| OpenAI Apps SDK/MCP 사양은 변경 가능하다. | tool descriptor drift | release 전 official docs 재확인 |
| 법/요율/authority SOP는 온톨로지 문서만으로 최신 보장 불가 | 규정 오답 위험 | RAG current source + Compliance owner review |
| Codex Skills는 개발 workflow용이다. | runtime 오해 가능 | MCP runtime과 Codex build workflow를 문서에서 분리 |

# 17. CmdRec

**Recommended commands**

/switch\_mode LATTICE + /logi-master report --deep --KRsummary
/logi-master ontology-query --source CONSOLIDATED-00 --deep
/logi-master invoice-audit --AEDonly --evidence-first

# Appendix A. Wireframes

## A1. Ask Workspace + Answer Card

**Wireframe**

┌──────────────────────────────────────────────────────────────────────────┐
│ Ask HVDC Ontology │
│ [ AGI M130 닫아도 돼? BL-535 관련 ] [Ask] │
│ chips: AGI | M130 | BL-535 | Site Receiving | MOSB │
├──────────────────────────────────────────────────────────────────────────┤
│ Route: 00 Master → 06 Material Handling → 04 Marine → 08 Communication │
│ Confidence: 0.96 | Freshness: corpus 2026-04-27 | PII: masked │
├──────────────────────────────────────────────────────────────────────────┤
│ Verdict: WARN │
│ Summary: M130 is accepted from AGI/DAS site date; MOSB/LCT evidence needs backfill. │
│ Business impact: blocking delivered receipts may distort KPI and inventory. │
│ Next action: backfill M115/M116/M117 evidence. │
│ [Open Evidence] [Open Graph Path] [Create Backfill Task] │
└──────────────────────────────────────────────────────────────────────────┘

## A2. Evidence Drawer

**Wireframe**

Evidence Drawer
────────────────────────────────────────────────────────────
Source: CONSOLIDATED-06-material-handling.md
Role: material-chain execution continuity
Section: Governance & Scope Boundary / AGI-DAS gate
Snippet: AGI/DAS site arrival is accepted when site date exists; missing MOSB/LCT chain evidence creates backfill...
Truth owner: Material Handling / Marine evidence owner
Validation: V-AGIDAS-001 = WARN/AMBER
Hash: sha256:...
PII: none

## A3. Ontology Path Viewer

**Wireframe**

Identifier(BL-535)
 -> BillOfLadingDocument
 -> ShipmentUnit
 -> RoutingPattern: WH\_MOSB or MOSB\_DIRECT
 -> MilestoneEvent: M115 / M116 / M117 / M130
 -> SiteReceipt
 -> ApprovalAction / AuditRecord

# Appendix B. Sample AGENTS.md for App Repository

**AGENTS.md sample**

# AGENTS.md

Repository-wide instructions for Codex working on the HVDC Ontology ChatGPT App.

1. Always load CONSOLIDATED-00 as the canonical semantic spine before editing tool logic.
2. Do not answer factual business questions without EvidenceSnippet coverage.
3. Keep runtime MCP tools separate from Codex build Skills.
4. Treat documents, OCR, communication, port, and cost records as evidence unless the target domain owns transaction truth.
5. Do not use Flow Code as shipment route, port routing, customs stage, invoice field, or operations KPI bucket.
6. Mask phone/e-mail in UI, logs, reports, and test fixtures.
7. For regulatory/rate/current authority claims, require RAG freshness and human owner review.
8. Run tool schema tests, answer grounding tests, and PII tests before release.

# Appendix C. Reference Sources

| **Source** | **Use in this document** |
| --- | --- |
| OpenAI Apps SDK Quickstart | MCP server required; optional UI component rendered inside ChatGPT |
| OpenAI Apps SDK Build MCP Server | MCP server defines tools/auth/data/UI bundle; structuredContent for model/UI |
| OpenAI Apps SDK Build ChatGPT UI | UI component renders tool results in iframe using MCP Apps bridge |
| OpenAI Apps SDK Reference | outputSchema and `\_meta.ui.resourceUri` tool descriptor guidance |
| OpenAI Apps SDK Security & Privacy | least privilege, consent, validation, audit logs, PII redaction |
| OpenAI App Submission Guidelines | clear tool names/descriptions; input minimization and privacy |
| OpenAI Codex Agent Skills | SKILL.md, progressive disclosure, skill directory, plugin distribution |
| CONSOLIDATED-00~09 + AGENTS.md | HVDC ontology grounding, governance, validation, domain boundaries |
| Palantir 온톨로지 기반 물류 자동화.pdf | Semantic Digital Twin and KG/SPARQL/SHACL architecture framing |

|  |
| --- |
| **Final Definition**  이 앱의 정체성은 ‘ChatGPT 안에서 동작하는 HVDC Ontology Answer Layer’다. 사용자는 자연어로 묻고, 앱은 온톨로지 문서와 KG를 조회한 뒤 근거 있는 업무 답변만 반환한다. 답변할 근거가 없으면 답하지 않고, 필요한 증빙과 다음 액션을 요청한다. |
