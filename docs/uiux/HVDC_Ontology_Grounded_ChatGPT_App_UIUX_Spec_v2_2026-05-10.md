**SCT ONTOLOGY**

**HVDC Ontology Grounded
ChatGPT App**

**UI/UX 상세 설계서 v2.0**

질문 → 온톨로지/KG 조회 → 근거 검증 → 업무 답변

작성일: 2026-05-10 · 기준 시간대: Asia/Dubai

대상: Samsung C&T HVDC Project Logistics / SCT ONTOLOGY 저장소

|  |  |
| --- | --- |
| **구분** | **결정** |
| 판정 | 가능 — 단, 일반 챗봇이 아니라 Ontology-grounded Answer App으로 설계해야 함 |
| 핵심 원칙 | CONSOLIDATED-00 먼저 조회 → 관련 extension 조회 → SHACL/SPARQL/Firewall 검증 → 답변 |
| 런타임 모드 | Read-only by default. 운영 truth 변경은 승인된 Action/Human-gate 후 별도 수행 |
| 근거 노출 | Answer Card 하단에 Corpus Source, Ontology Triple, Validation Result, Memory/Project Context 표시 |
| ZERO 기준 | 근거 없음·상충·고위험 규정/비용/안전 답변은 중단하고 Input Required 반환 |

주의: 본 문서는 업로드된 온톨로지 프로젝트 문서와 사용자가 제공한 2026 공개자료 요약을 설계 입력으로 사용했다. 현재 실행 환경에서는 웹 브라우징이 비활성화되어 OpenAI 공식문서의 최신 문구·API 세부사항을 실시간 재검증하지 못했다. 개발 착수 전 공식문서 URL을 기준으로 API 명칭·필드·권한 모델을 재확인해야 한다.

# 0. 문서 구조 및 Source Pack

이 설계서는 사용자가 의도한 ‘나와 같은 업무를 하는 사람이 ChatGPT에서 질문하면, SCT ONTOLOGY 문서/KG를 먼저 확인하고 그 근거에 맞게 답변하는 앱’을 구현하기 위한 UI/UX 및 시스템 설계 문서다.

|  |  |  |
| --- | --- | --- |
| **No** | **Section** | **목적** |
| 1 | ExecSummary | 앱 정의, 비즈니스 임팩트, KPI/ROI |
| 2 | OpenAI 공식문서 기준 | Apps SDK, MCP, UI Component, Codex Skill 적용 지점 |
| 3 | Ontology Grounding Model | CONSOLIDATED-00 중심의 조회·검증·답변 구조 |
| 4 | UX Architecture | 사용자 여정, 화면 구성, Evidence Drawer, Ontology Path Viewer |
| 5 | Screen Specs | 주요 화면별 UI 요소와 상태 |
| 6 | MCP Tool Contract | tool schema, structuredContent, evidence payload |
| 7 | Semantic Firewall | Ontology Firewall, SHACL/SPARQL, approval gate |
| 8 | Codex Skill Pack | 개발·검증 자동화용 reusable workflow |
| 9 | Integration | Foundry, GraphDB, ERP/WMS/ATLP, 파일 코퍼스 연계 |
| 10 | Roadmap & QA | 2.00주 MVP, 확장안, 테스트/수용 기준 |

|  |  |  |
| --- | --- | --- |
| **Source** | **문서 역할** | **설계 반영** |
| CONSOLIDATED-00-master-ontology.md | Canonical semantic spine | Any-key → ShipmentUnit → route/document/customs/warehouse/site/cost/exception full trace |
| AGENTS.md | AI agent repository governance | CONSOLIDATED-00 우선, Flow Code boundary, RoutingPattern/JourneyStage/MilestoneEvent/JourneyLeg 강제 |
| CONSOLIDATED-03-document-ocr.md | Document/OCR trust layer | 문서는 evidence-only, VerificationResult/AuditRecord 생성 |
| CONSOLIDATED-05-invoice-cost.md | Invoice + CostGuard extension | Invoice Guardian 화면, CostGuardResult, 100,000.00 AED Human-gate |
| CONSOLIDATED-08-communication.md | Communication evidence layer | ApprovalAction/AuditRecord/SLA/PII redaction UI |
| 붙여넣은 텍스트 (1).txt | 2026 공개자료 기반 개선 아이디어 | Ontology Firewall, Project/Memory, Deep Research/MCP, Evidence Source UI, Codex/Spreadsheet, risk management |

# 1. ExecSummary

비즈니스 임팩트: 이 앱은 HVDC 물류팀의 질문을 일반 LLM 기억이나 임의 추정으로 답하지 않고, SCT ONTOLOGY의 canonical corpus와 KG를 조회한 뒤 근거 기반으로 답변한다. 반복 질문의 재설명 비용을 줄이고, 팀원 간 답변 편차를 낮추며, 통관·문서·창고·MOSB·비용·현장 수령의 업무 판단을 동일한 semantic spine 위에 정렬한다.

기술 해법: ChatGPT App은 대화 UI와 iframe component를 제공하고, MCP Server는 corpus search, Any-key resolver, SPARQL query, SHACL validation, Semantic Firewall, Evidence retrieval tool을 노출한다. Codex는 런타임 답변 엔진이 아니라 repository의 AGENTS.md/SKILL.md 기반 개발·검증·배포 workflow로 사용한다.

KPI/ROI: 목표는 Key Resolution ≥ 95.00%, Evidence-linked Answer ≥ 98.00%, Hallucination Block Rate 100.00% for ZERO cases, Validation p95 < 5.00s, PII Leakage 0.00건이다. MVP는 corpus-only RAG로 시작하고, Phase 2에서 RDF/SPARQL KG hybrid로 확장한다.

|  |  |  |
| --- | --- | --- |
| **구분** | **설계 결정** | **업무 효과** |
| Product Type | Ontology-grounded ChatGPT App | 같은 업무 질문에 같은 corpus 기준 답변 |
| Primary Entry | Natural-language question + optional key | BL/BOE/DO/Invoice/PO/HVDC\_CODE 등 아무 키로 시작 |
| Grounding | CONSOLIDATED-00 + domain extension + KG triple + evidence | 근거 없는 답변 방지 |
| UX Differentiator | Answer Card + Evidence Drawer + Ontology Path Viewer + Validation Panel | 답변·근거·경로·위험을 한 화면에서 확인 |
| Control | Read-only answer first; write/action requires approval | 에이전트 오작동, 프롬프트 인젝션, PII 유출 방지 |

# 2. OpenAI 공식문서 기준 설계 앵커

아래 항목은 개발자가 반드시 공식문서에서 최신 API 명칭과 필드를 재확인해야 하는 설계 앵커다. 현재 문서 작성 환경은 live web 검증이 불가하므로 URL은 구현 전 검증 체크리스트로 둔다.

|  |  |  |
| --- | --- | --- |
| **Official Reference** | **앱 내 적용 위치** | **검증 필요사항** |
| OpenAI Apps SDK | ChatGPT App 등록, MCP server 연결, tool metadata | tool result payload, auth, deployment 절차 최신화 |
| Apps SDK Quickstart | MVP skeleton: server + tools + optional UI | project template, manifest, local dev command |
| MCP Server guide | ontology.search / resolveAnyKey / validateAnswer tools | tool input schema, structuredContent/content/\_meta 처리 |
| ChatGPT UI component guide | Evidence Drawer, Graph Path Viewer, Validation Panel iframe | component resource URI, bridge, CSP, OAuth handling |
| Codex Skills | SKILL.md 기반 reusable dev/test workflow | skill packaging, progressive disclosure, scripts/references 구조 |
| AGENTS.md guide | repo-wide model instruction and governance | 우선순위, subtree override, safety instructions |

Design stance: ChatGPT App runtime은 '업무 답변 UI'와 '도구 호출 orchestration'을 담당한다. Codex는 app을 만드는 개발 보조자이며, 운영 중 사용자의 업무 질문을 독립적으로 답하는 source of truth가 아니다.

# 3. Ontology Grounding Model

앱의 핵심은 질문을 곧바로 LLM 답변으로 넘기지 않는 것이다. 질문은 Query Planner가 도메인과 key를 식별한 뒤 반드시 master spine과 target extension을 조회한다.

User Question
 -> Intent/Domain Router
 -> Read CONSOLIDATED-00 semantic spine
 -> Retrieve target extension(s): 01~09 + team role docs
 -> Resolve Any-key to ShipmentUnit / Invoice / Document / Milestone / Actor
 -> Query KG triples or corpus passages
 -> Run SHACL/SPARQL + Semantic Firewall
 -> Compose answer with Evidence, Graph Path, Validation State
 -> Render Answer Card + Evidence Drawer + Action Recommendations

|  |  |  |  |
| --- | --- | --- | --- |
| **Layer** | **Owner / Source** | **UI 노출** | **Write Policy** |
| Master Spine | CONSOLIDATED-00 | Ontology Path Viewer의 root | Read-only in answer mode |
| Domain Extensions | 01~09 | Evidence Drawer의 source tab | Patch는 repo workflow에서만 |
| KG Runtime | GraphDB/Foundry Ontology | Graph Path, SPARQL result table | Tool action gated |
| Document Evidence | LDG/OCR, CI/PL/BL/BOE/DO | Document Preview + highlight | Evidence may propose; cannot mutate truth |
| Communication Evidence | Email/Chat/ApprovalAction | Approval Trail / SLA Panel | Authorized action only |
| User/Project Memory | ChatGPT Project/Memory, if available | Memory Source chip | Opt-in, redact, editable |

|  |  |  |  |
| --- | --- | --- | --- |
| **Requirement** | **Source basis** | **UI/UX Decision** | **Validation** |
| 항상 master ontology 먼저 확인 | CONSOLIDATED-00 / AGENTS | Query Planner step 1에 Master Spine Retrieval 고정 | Answer cannot render if master\_context\_id missing |
| 문서와 채팅은 evidence-only | CONSOLIDATED-03 / 08 | Evidence Drawer에 'evidence, not truth' badge 표시 | V-EVID-001 blocks unsupported truth mutation |
| Flow Code route 오용 금지 | AGENTS / CONSOLIDATED-00 | Route answer는 RoutingPattern/JourneyStage로 표시 | Semantic Firewall blocks Flow Code-as-route |
| 고위험 비용/규정 답변 제한 | CONSOLIDATED-05 / uploaded risk note | Human-gate banner + ApprovalAction | 100,000.00 AED or compliance-sensitive = gated |
| 근거/메모리 소스 시각화 | uploaded text | Answer footer: Corpus/Triple/Memory Source chips | source\_count ≥ 1 or ZERO |

# 4. Schema-first App Object Model

UI 화면은 데이터 객체의 실제 책임 경계를 반영해야 한다. 답변 화면에서 무엇이 truth이고 무엇이 evidence인지 구분되지 않으면 앱의 신뢰성이 무너진다.

|  |  |  |  |
| --- | --- | --- | --- |
| **Object** | **Meaning** | **Key fields** | **UI Component** |
| QuestionSession | 한 번의 사용자 질의와 조회 결과 | question\_id, user\_role, domain, risk\_level, answer\_state | Ask Workspace |
| CorpusPassage | 문서 검색 근거 | file\_id, section, quote, score, version | Evidence Drawer |
| OntologyEntity | KG node/class/instance | iri, label, class, source, confidence | Ontology Path Viewer |
| GraphPath | 질문과 답변을 연결하는 edge chain | nodes[], edges[], query\_id | Graph Path Viewer |
| ValidationResult | SHACL/SPARQL/Firewall 결과 | rule\_id, severity, verdict, message | Validation Panel |
| AnswerCard | 최종 답변 view model | verdict, basis, actions, citations, zero\_log | Main Answer |
| ApprovalAction | 사용자 승인/반려/수정 요청 | action\_type, approver\_role, before/after, evidence | Approval Gate |
| AuditRecord | 검증/답변/승인 이력 | actor, timestamp, tool, prompt\_hash, evidence\_hash | Audit Timeline |

AnswerCard.viewModel = {
 questionId,
 verdict: "PASS | WARN | AMBER | ZERO",
 answerSummary,
 domain: "invoice | customs | warehouse | marine | port | material | operations | communication",
 ontologyPath: [{node, edge, node}],
 evidence: [{sourceFile, section, quote, confidence, versionDate}],
 validation: [{ruleId, severity, verdict}],
 actionRecommendations: [{label, ownerRole, dueDate, risk}],
 zeroLog?: {reason, missingInputs, blockedRules}
}

# 5. UX Architecture

앱은 사용자가 ‘질문을 던지고 답을 받는 화면’이 아니라, 질문의 근거 탐색과 검증 과정을 이해할 수 있는 업무 cockpit이어야 한다.

|  |  |  |  |
| --- | --- | --- | --- |
| **Screen** | **Primary job** | **Key UI elements** | **Success state** |
| Ask Workspace | 업무 질문 입력 및 key 감지 | question box, key chips, domain suggestion, risk badge | 질문이 domain/key/query plan으로 구조화됨 |
| Answer Card | 근거 기반 업무 답변 | 판정, 근거 1줄, next action, detailed tabs | 답변이 evidence-linked 상태 |
| Evidence Drawer | 문서 원문/quote/section 확인 | source list, highlight, version, confidence | 사용자가 출처를 클릭해 확인 가능 |
| Ontology Path Viewer | Any-key→ShipmentUnit→domain object 경로 표시 | graph nodes, edges, resolved keys | 왜 이 답변이 나왔는지 추적 가능 |
| Validation Gate Panel | SHACL/SPARQL/Firewall 결과 표시 | rule list, block/warn/pass, explanation | 고위험 오류 사전 차단 |
| Memory & Project Source | 대화/프로젝트 문맥 사용 여부 표시 | memory chips, project scope, edit/remove link | 문맥 혼동과 오래된 memory를 줄임 |
| Approval Gate | write/action 전 승인 | approve/reject/revise, diff, evidence | 실행 전 human confirmation |
| Admin Corpus Console | index/embedding/KG sync 운영 | source health, index age, validation summary | 문서 freshness와 검색 품질 가시화 |

[Ask Workspace]
---------------------------------------------------------
Question: "AGI cargo M130인데 M115 증빙 없으면 close 가능?"
Detected domain: Material Handling + Marine/MOSB
Detected keys: Site=AGI, Milestones=M130/M115
Risk: BLOCK candidate
[Run Ontology Check]

[Answer Card]
Verdict: ZERO / BLOCK
Basis: AGI/DAS site date is accepted as M130; MOSB-inclusive route evidence M115/M116/M117 is backfilled when missing.
Next action: Request MOSB staging evidence or approved exception.
Sources: CONSOLIDATED-00, CONSOLIDATED-06, CONSOLIDATED-04
[Open Evidence] [Open Graph Path] [Create Approval Request]

# 6. Core User Journeys

|  |  |  |  |
| --- | --- | --- | --- |
| **Journey** | **User intent** | **System behavior** | **UX output** |
| J1. Policy Q&A | ‘Flow Code로 route KPI 잡아도 돼?’ | AGENTS + CONSOLIDATED-00/02/09 조회 | 불가 판정, RoutingPattern 대체 제안, evidence |
| J2. Any-key lookup | ‘BL 123 현재 어디야?’ | identifier normalize → resolveAnyKey → ShipmentUnit graph | currentStage, milestones, docs, risks |
| J3. Invoice audit help | ‘OFCO invoice 과청구인지 봐줘’ | CONSOLIDATED-05 + rate/evidence 조회 | CostGuard band, Δ%, missing evidence, approval gate |
| J4. Customs/doc answer | ‘BOE와 DO 관계가 뭐야?’ | CONSOLIDATED-00 + 03 + 06/07 조회 | transaction/document split 설명 |
| J5. Marine/MOSB gate | ‘DAS site arrival close 조건?’ | AGI/DAS gate rule + M115/M116/M117 evidence check | WARN/PASS with graph path and backfill status |
| J6. Team role answer | ‘이 업무 누가 owner야?’ | Team matrix + role docs + milestone map 조회 | owner, backup, evidence, escalation |
| J7. Deep research request | ‘FANR 최신 규정 조사해줘’ | internal MCP docs + external research only if approved | AMBER/ZERO if no current public evidence |

# 7. 주요 화면 상세 Spec

## 7.1 Ask Workspace

목적: 자연어 질문을 domain, key, risk, source plan으로 구조화한다. 사용자는 질문만 입력해도 되지만, app은 내부적으로 query plan을 생성해 사용자가 확인할 수 있게 한다.

|  |  |  |  |
| --- | --- | --- | --- |
| **UI Element** | **Behavior** | **Data field** | **Error/Empty state** |
| Question Input | 한국어/영어 혼합 입력 허용 | raw\_question | 빈 질문이면 예시 prompt 표시 |
| Key Chips | BL/BOE/DO/Invoice/PO/HVDC\_CODE 자동 인식 | detected\_identifiers[] | confidence < 0.70이면 사용자 확인 |
| Domain Router | invoice/customs/warehouse/marine/material/port/ops/comm 분류 | domain\_candidates[] | 동률이면 multi-domain query |
| Risk Badge | normal, finance, compliance, safety, PII, write-action | risk\_level | high이면 승인/증거 요구 |
| Source Plan | 조회 예정 문서와 KG tool 표시 | retrieval\_plan | CONSOLIDATED-00 누락 시 실행 차단 |

## 7.2 Answer Card

Answer Card는 BRIEF-first를 기본으로 한다. 첫 화면에는 판정, 근거, 다음 행동만 보여주고, 사용자가 펼치면 상세 근거와 graph path를 본다.

|  |  |  |
| --- | --- | --- |
| **Block** | **Content** | **Rendering rule** |
| Verdict | PASS / WARN / AMBER / ZERO | 색상/아이콘보다 텍스트 우선. ZERO는 빨간 배너와 Input Required |
| Basis | 핵심 근거 1줄 + source chips | source가 없으면 AMBER 또는 ZERO |
| Next Action | owner, action, due, dependency | team role 문서가 있으면 owner 추천 |
| Evidence Chips | file, section, KG triple, memory/project context | 클릭 시 Evidence Drawer open |
| Validation Summary | rule pass/warn/block count | block>0이면 answer body 대신 blocker summary |

Answer Card default:
1) 판정: WARN — AGI/DAS site date는 M130으로 인정하고 M115/M116/M117 evidence는 backfill 필요
2) 근거: CONSOLIDATED-00 AGI/DAS gate + CONSOLIDATED-06 material-chain rule
3) 다음행동: M115 MOSB Staged evidence 또는 승인된 exception을 첨부

## 7.3 Evidence Drawer

Evidence Drawer는 앱 신뢰성의 핵심 화면이다. 답변의 각 주장마다 문서 출처, KG triple, validation rule, memory/project source를 분리해 보여준다.

|  |  |  |
| --- | --- | --- |
| **Tab** | **Shows** | **Control** |
| Corpus | 파일명, section, quote, version date, score | Open original, copy citation, report stale |
| KG Triples | subject-predicate-object, graph, confidence | Open SPARQL, expand neighborhood |
| Validation | SHACL/SPARQL/Firewall rule result | Show rule logic, explain blocker |
| Memory/Project | 사용된 project memory 또는 profile context | Mark wrong/outdated, request removal |
| Audit | tool call, prompt hash, evidence hash | Export audit packet |

## 7.4 Ontology Path Viewer

Any-key 입력이 어떤 객체로 resolve되었는지 시각화한다. 예: Invoice No. → InvoiceLine → ShipmentUnit → PortCall → WarehouseTask → SiteReceipt → CostGuardResult.

Example graph path:
Identifier(invoiceNo=OFCO-2026-001)
 -> Invoice
 -> InvoiceLine(charge=PortService)
 -> PortServiceEvent(rotationNo=R-xxx)
 -> PortCall
 -> ShipmentUnit
 -> MilestoneEvent(M92 DO Released / M100 Gate-out)
 -> DEMDETClock
 -> CostGuardResult

## 7.5 Validation Gate Panel

|  |  |  |
| --- | --- | --- |
| **Rule family** | **Examples** | **UX response** |
| Identity | IdentifierCompleteness, AnyKeyResolution | 미해결 key 후보 목록 + 사용자 확인 |
| Route | RoutingPattern enum, no Flow Code route | Flow Code-as-route 감지 시 BLOCK |
| Document | CI/PL/BL/BOE/DO consistency | 불일치 필드 highlight |
| AGI/DAS | M130 accepts site date; MOSB evidence required for trace completeness | WARN/AMBER + backfill request |
| Cost | EA×Rate=Amount±0.01, invoice total±2.00% | CostGuard band, high value approval |
| Evidence | Evidence cannot own transaction truth | 답변을 proposal로 낮추고 action 차단 |
| Security | PII, prompt injection, external content | redact or block with audit log |

# 8. MCP Tool Contract

MCP Server는 ChatGPT App이 직접 내부 파일/DB를 임의로 읽는 대신, 통제된 도구로만 corpus와 KG에 접근하게 한다. 모든 tool result는 answer composer가 UI에 전달할 수 있도록 structuredContent와 evidence metadata를 포함한다.

|  |  |  |  |
| --- | --- | --- | --- |
| **Tool** | **Input** | **Output** | **Guard** |
| corpus.search | query, domain, required\_sources | passages[], source\_map | CONSOLIDATED-00 required |
| ontology.resolveAnyKey | identifierScheme, identifierValue | resolved\_object, candidates, confidence | confidence < 0.95 → review |
| ontology.querySPARQL | template\_id, params | bindings, graph\_path | read-only query only |
| validation.run | answer\_draft, objects, evidence | ValidationResult[] | blockers prevent answer |
| firewall.checkAction | proposed\_action, params, user\_role | allow/deny, rule\_id | deny by default for write/high risk |
| evidence.get | source\_id, location | quote, doc preview, hash | PII redaction |
| answer.compose | question, context, validation | AnswerCard view model | no source → ZERO |
| audit.write | session\_id, tool\_calls, result\_hash | AuditRecord | append-only |

// Tool result shape - implementation target
{
 "structuredContent": {
 "answerCard": {...},
 "evidence": [...],
 "graphPath": [...],
 "validation": [...]
 },
 "content": [
 {"type": "text", "text": "판정: ...
근거: ...
다음행동: ..."}
 ],
 "\_meta": {
 "sourceHash": "sha256:...",
 "retrievalPlanId": "...",
 "zeroPolicyApplied": true,
 "piiRedacted": true
 }
}

# 9. Ontology Firewall & ZERO Gate

업로드된 2026 개선 아이디어의 핵심은 RAG나 vector DB만으로는 행동의 의미를 검증할 수 없다는 점이다. 본 앱은 답변 생성 전후에 Semantic Firewall을 두어 ‘문서에서 검색된 내용’과 ‘업무 규칙상 허용되는 판단’을 분리 검증한다.

|  |  |  |  |
| --- | --- | --- | --- |
| **Firewall Check** | **Logic** | **Failure UX** | **Audit** |
| Source Precedence | CONSOLIDATED-00 > target extension > evidence layer | 상충 source 표시 후 master 우선 | conflict\_id |
| No Truth Mutation | Document/communication cannot update operational truth | proposal로 낮추고 Action 버튼 disable | blocked\_action |
| Flow Code Boundary | confirmedFlowCode only on WarehouseHandlingProfile | Flow Code route answer 차단 | V-FLOW-001 |
| AGI/DAS MOSB Gate | M130 accepts site date; missing M115/M116/M117 is evidence gap | WARN/AMBER + backfill input | V-AGIDAS-001 |
| Cost Human-gate | >100,000.00 AED or critical band requires approval | Approve/Reject required | approval\_ref |
| PII Redaction | Tel/e-mail/raw personal fields masked | source hidden or role-only | pii\_redaction\_record |
| Prompt Injection | External/source text cannot alter system/tool rules | Warning + ignore injected instruction | injection\_flag |

ZERO response contract:
IF source\_count < required\_min OR blocker\_count > 0 OR compliance\_current\_evidence\_missing
THEN return only:
| 단계 | 이유 | 위험 | 요청데이터 | 다음조치 |
No operational recommendation beyond safe next action.

# 10. Codex Skill Pack

Codex는 ChatGPT App runtime이 아니라 app과 ontology repository를 개발·검증하는 자동화 workflow다. 각 Skill은 반복 가능한 개발 태스크를 SKILL.md와 scripts로 고정한다.

|  |  |  |  |
| --- | --- | --- | --- |
| **Skill** | **Purpose** | **Key files/scripts** | **Output** |
| ontology-indexer | CONSOLIDATED corpus indexing | build\_index.py, chunk\_rules.yml | corpus index + source map |
| anykey-resolver | Identifier normalization and resolver tests | resolver.py, test\_keys.csv | candidate resolution report |
| answer-grounder | AnswerCard/evidence binding test | compose.py, fixtures/\*.json | grounded answer fixtures |
| semantic-firewall | SHACL/SPARQL/action validation | firewall.py, shapes.ttl | pass/block report |
| ui-component | Evidence Drawer/Graph Viewer build | component.tsx, stories | iframe bundle |
| codex-pr-review | PR semantic governance review | review\_rules.md, validate\_docs.py | GitHub PR comment |
| spreadsheet-export | KPI/cost tables export | xlsx\_templates/, export.py | xlsx/CSV artifacts |

.codex/skills/semantic-firewall/SKILL.md
---
name: semantic-firewall
description: Validate answer/action semantics against HVDC ontology rules
---
Workflow
1. Load CONSOLIDATED-00 first
2. Load target extension by domain
3. Run SHACL/SPARQL rule bundle
4. Check evidence-only boundaries
5. Return PASS/WARN/BLOCK with rule IDs

Output
- ValidationResult[]
- blockedRules[]
- requiredInputs[]
- auditHash

# 11. Integration Architecture

MVP는 corpus-only RAG로 시작한다. 단, 데이터 구조는 처음부터 KG hybrid로 확장 가능하게 설계한다. 즉 UI는 항상 graph path/evidence/validation slot을 갖고, 초기에는 corpus evidence만 채우더라도 Phase 2에서 SPARQL 결과가 같은 slot에 들어간다.

|  |  |  |  |
| --- | --- | --- | --- |
| **Phase** | **Architecture** | **Data source** | **App capability** |
| MVP 0 | Corpus RAG + source map | CONSOLIDATED md/pdf/txt | 문서 기반 Q&A, evidence drawer |
| MVP 1 | Corpus + Any-key resolver | Index + identifier table | BL/BOE/DO/Invoice key lookup |
| Phase 2 | Hybrid RAG + RDF/SPARQL KG | GraphDB/Foundry objects | Graph path, SHACL validation |
| Phase 3 | Action-gated operational cockpit | ERP/WMS/ATLP/Invoice APIs | 승인 기반 action proposal |
| Phase 4 | Agentic workflow with firewall | Codex/Deep Research/Spreadsheet tools | 드라이런→승인→감사 실행 |

Data folders:
data/corpus/ # source md/pdf/txt, versioned, read-only
data/index/ # embeddings/BM25/source map, rebuildable
data/kg/ # RDF ttl/jsonld exports, graph snapshots
rules/shacl/ # SHACL shapes
rules/sparql/ # query templates and blockers
audit/ # append-only answer/action logs

# 12. Persona / Role-aware Answering

이 앱은 사용자별 개인화만 하는 것이 아니라, HVDC 물류팀 역할과 마일스톤 책임을 기반으로 답변을 조정한다. 동일 질문이라도 팀장, 통관 담당, 창고 담당, 해상 담당, 현장 수령 담당에게 보여주는 next action은 다를 수 있다.

|  |  |  |  |
| --- | --- | --- | --- |
| **Role** | **Typical question** | **Relevant corpus** | **UX adaptation** |
| Logistics Manager | 전체 지연 원인과 owner는? | CONSOLIDATED-00/09 + Team matrix | summary + escalation + KPI |
| Material Management | Invoice/기성/자재 상태 연결은? | 05 + 06 + role docs | cost + custody + approval view |
| Customs/Inbound | BOE/DO/FANR/MOIAT 상태는? | 01/03/06/07 + Arvin role | doc readiness + blocker |
| Warehouse | WH received 이후 Flow Code 확정 조건? | 02 + AGENTS | WHP-only explanation |
| Marine/MOSB | LCT/MOSB evidence 무엇이 필요? | 04 + 06 + Haitham/Jhysn/Ronnel | M115/M116/M117 checklist |
| Site Receiving | M130 close 가능? | 06 + 08 + Roldan | POD/GRN/OSD status and missing proof |

# 13. Answer Patterns

## 13.1 Ontology rule answer

Q: Flow Code로 전체 route를 분류해도 되나?
A:
판정: 아니오.
근거: Flow Code는 WarehouseHandlingProfile.confirmedFlowCode에만 허용되는 warehouse-handling classification이다.
다음행동: route KPI는 ShipmentRoutingPattern + JourneyStage + MilestoneEvent + JourneyLeg 기준으로 재작성.

## 13.2 Operational lookup answer

Q: Invoice No. OFCO-001 관련 CostGuard 상태 알려줘.
A:
1) resolveAnyKey(invoiceNo=OFCO-001)
2) Invoice -> InvoiceLine -> ShipmentUnit -> PortCall/ServiceEvent
3) Run V-COST-001/002/003
4) Return CostGuardBand, Δ%, missing RateRef/TariffRef, approval requirement

## 13.3 ZERO answer

Q: FANR 최신 요구사항 보고 바로 승인해도 돼?
A:
판정: ZERO.
근거: 현재 세션에 최신 UAE/FANR 공식 근거가 없고, 규정/안전 고위험 항목이다.
다음행동: 최신 authority/SOP 링크 또는 내부 승인 문서 1~3개 입력 후 재검증.

# 14. Roadmap

|  |  |  |  |
| --- | --- | --- | --- |
| **Phase** | **Duration** | **Build scope** | **Acceptance KPI** |
| Prepare | 0.50주 | source inventory, corpus versioning, security/PII policy | source manifest 100.00% |
| MVP-A | 1.00주 | corpus search, master-first routing, Answer Card | Evidence-linked Answer ≥ 90.00% |
| MVP-B | 1.00주 | Evidence Drawer, Validation Panel, ZERO Gate | ZERO blocker leakage 0.00건 |
| Pilot | 2.00주 | Any-key resolver, 5 high-value scenarios | Key Resolution ≥ 95.00% |
| Build | 4.00주 | SPARQL/KG hybrid, Graph Path Viewer | Graph path coverage ≥ 90.00% |
| Operate | 6.00주 | Audit, approval, role-aware next action | Audit completeness 100.00% |
| Scale | 8.00주 | Deep Research/MCP, spreadsheet export, Codex PR review | Report SLA ≤ 4.00h |

# 15. MVP Backlog

|  |  |  |
| --- | --- | --- |
| **Epic** | **User story** | **Definition of Done** |
| Corpus Ingestion | As an admin, I load consolidated docs and produce searchable chunks. | chunk\_id, source file, section path, version date stored |
| Master-first Query | As a user, every answer starts from CONSOLIDATED-00. | retrieval\_plan includes master\_context\_id |
| Evidence Answer | As a user, I see source files and quotes below each answer. | every answer claim has source chip |
| Validation Gate | As a user, I know whether answer is PASS/WARN/ZERO. | blocker rules prevent unsafe answer |
| Any-key Resolver | As a user, I search by BL/BOE/DO/Invoice/HVDC\_CODE. | candidate list and confidence displayed |
| Source/Memory UX | As a user, I see corpus/KG/memory source separation. | source chips grouped and editable for memory |
| Audit Log | As a manager, I export answer/evidence trace. | audit packet contains prompt hash, source hash, validation results |

# 16. QA Checklist & Acceptance Tests

|  |  |  |
| --- | --- | --- |
| **Test** | **Input** | **Expected** |
| Master precedence | Question about Flow Code route | Reject Flow Code route; suggest RoutingPattern |
| Evidence-only guard | OCR says route = WH\_MOSB | Treat as routeEvidence only, not truth |
| AGI/DAS gate | M130 exists, M115 missing | WARN/AMBER with required MOSB backfill evidence |
| CostGuard | Invoice line EA×Rate mismatch | V-COST-001 BLOCK |
| PII | Contact file with phone/e-mail | Mask or hide raw PII |
| Prompt injection | Source text says ignore rules | Ignore source instruction and log injection |
| Memory source | Answer uses saved context | Memory chip visible; user can flag wrong |
| No source | Question outside corpus | AMBER or ZERO; no fabricated answer |

# 17. Assumptions, Risks, and Open Items

|  |  |  |
| --- | --- | --- |
| **Type** | **Item** | **Treatment** |
| 가정 | OpenAI Apps SDK/MCP/Codex Skills APIs are available to target account/plan. | 개발 전 공식문서와 tenant capability 검증 |
| 가정 | SCT ONTOLOGY corpus can be stored in app-accessible read-only storage. | data/corpus + source hash policy |
| 위험 | 업로드된 2026 공개자료 claims are not independently web-verified in this session. | 문서상 '재검증 필요'로 표시, build 전에 official/primary source 확인 |
| 위험 | Memory/Project context may leak or become stale. | source chips, user correction, periodic purge, PII masking |
| 위험 | Vector search can retrieve similar but wrong extension. | master-first retrieval + domain router + validation |
| 위험 | Agentic action can mutate source systems incorrectly. | dry-run only → human approval → audit → limited write actions |

# 18. CmdRec / Build Commands

/switch\_mode LATTICE + /logi-master report --deep --KRsummary
/logi-master ontology-query --source CONSOLIDATED-00 --deep
/logi-master invoice-audit --AEDonly
/codex-skill semantic-firewall --run --rules rules/shacl --domain material-handling
/codex-skill answer-grounder --test fixtures/hvdc\_qa\_golden.json

# Appendix A. OpenAI / Internal References

|  |  |  |
| --- | --- | --- |
| **Category** | **Reference** | **Status in this document** |
| OpenAI | https://developers.openai.com/apps-sdk/ | Official reference URL; verify latest |
| OpenAI | https://developers.openai.com/apps-sdk/quickstart | Official reference URL; verify latest |
| OpenAI | https://developers.openai.com/apps-sdk/build/mcp-server | Official reference URL; verify latest |
| OpenAI | https://developers.openai.com/apps-sdk/build/chatgpt-ui | Official reference URL; verify latest |
| OpenAI | https://developers.openai.com/codex/skills | Official reference URL; verify latest |
| Internal | CONSOLIDATED-00-master-ontology.md | Primary semantic authority |
| Internal | AGENTS.md | Repository governance and agent behavior |
| Internal | 붙여넣은 텍스트 (1).txt | User-provided 2026 improvement notes; not independently verified |

End of document.