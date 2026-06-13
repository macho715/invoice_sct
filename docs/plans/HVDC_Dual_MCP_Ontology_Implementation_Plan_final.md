**HVDC Ontology Dual-MCP 구현 문서**

Any-key Control Tower · Invoice COST-GUARD · MOSB Route Gate · Document Guardian · Team Action Router

|  |  |
| --- | --- |
| **항목** | **내용** |
| 작성일 | 2026-05-13 (Asia/Dubai) |
| 대상 | Samsung C&T HVDC Project Logistics Ontology / Knowledge Graph |
| 목표 | 두 MCP를 이용해 현장 질의 → 공식 규칙 검증 → 근거 연결 → action dry-run까지 구현 |
| MCP 역할 | SCT\_ONTOLOGY MCP = canonical rule/evidence/validation, Obsidian MCP = memory/decision/playbook evidence-candidate |
| 원칙 | Master spine 우선, evidence-only layer 준수, Human-gate 후 mutation, PII 마스킹 |
| **판정: 실제 구현 가능. 다만 Obsidian Memory MCP는 현재 seed note가 없으면 “현장 기억 보강” 기능만 AMBER로 남고, SCT\_ONTOLOGY MCP 기반 공식 검증은 즉시 PoC 가능하다.** | |

# 1. ExecSummary

**•** 비즈니스 임팩트: BL/BOE/DO/Invoice/HVDC Code 중 하나만 입력해도 ShipmentUnit 기준 현재 위치, 누락 문서, MOSB gate, CostGuard, 담당 action을 한 번에 반환한다.

**•** 기술 해법: MCP Router가 질문을 domain별로 분류한 뒤 SCT\_ONTOLOGY MCP에서 canonical evidence를 가져오고, Obsidian MCP에서 과거 decision/playbook을 보강한다.

**•** 검증 구조: SHACL/SPARQL rule, RAG evidence, Human-gate를 통과한 경우에만 write proposal을 생성한다. ERP/WMS/Foundry 본 write는 별도 승인 후 수행한다.

**•** KPI 목표: Any-key resolution ≥ 95.00%, Evidence coverage ≥ 90.00%, NumericIntegrity = 100.00%, Validation p95 < 5.00s, PII leakage = 0.00건.

**•** ENG-KR one-liner: One key resolves to one operational twin; MCP adds evidence-backed validation and action routing without mutating operational truth.

# 2. 기준 근거와 설계 경계

|  |  |  |
| --- | --- | --- |
| **근거 영역** | **문서/규칙** | **구현 반영** |
| Master Spine | CONSOLIDATED-00: ShipmentUnit 중심, Any-key → Identifier → ShipmentUnit full trace | 모든 모듈의 output은 ShipmentUnit 또는 ActionProposal에 연결 |
| Repository Governance | AGENTS.md: CONSOLIDATED-00 우선, Flow Code는 WHP.confirmedFlowCode만 허용 | route logic은 RoutingPattern/JourneyStage/MilestoneEvent/JourneyLeg만 사용 |
| Document/OCR | CONSOLIDATED-03: Document/OCR output은 EvidenceAssertion/VerificationResult/AuditRecord | Document Guardian은 evidence-only; operational truth 직접 변경 금지 |
| Cost | CONSOLIDATED-05/00: Δ%, PASS/WARN/HIGH/CRITICAL, >100,000.00 AED Human-gate | Invoice COST-GUARD는 dry-run verdict + proof 생성 |
| Material/MOSB | CONSOLIDATED-06/00: AGI/DAS site date는 M130 인정, M115/M116/M117 누락은 backfill 필요 | MOSB Route Gate에서 AMBER/WARN 판단 |
| Communication/Team | CONSOLIDATED-08 + Team Matrix: communication은 evidence layer, milestone별 role mapping | Team Action Router는 담당 role/action만 제안하고 core class를 재정의하지 않음 |
| **충돌 처리 원칙: Obsidian memory와 공식 ontology evidence가 충돌하면 CONSOLIDATED-00 master spine을 우선한다. MemoryHit는 EvidenceCandidate이며 ApprovalAction 없이는 transaction truth를 바꾸지 않는다.** | | |

# 3. Dual-MCP Architecture

|  |  |  |  |
| --- | --- | --- | --- |
| **Layer** | **Component** | **Function** | **Mutation 권한** |
| User Interface | ChatGPT / Teams / Telegram / Sheet button | 질문·파일·identifier 입력 | 없음 |
| Router | MCP Router | domain 분류, risk 판단, MCP 호출 순서 결정 | 없음 |
| Canonical MCP | SCT\_ONTOLOGY MCP | route\_question, search\_ontology\_corpus, resolve\_any\_key, validate\_answer, answer card | dry-run write proposal만 |
| Memory MCP | Obsidian MCP | search, fetch, recent memory, wiki playbook lookup | 없음 |
| Validation | SHACL/SPARQL/RAG/Human-gate | rule verdict, blocking reason, evidence completeness | ApprovalAction 생성 후만 |
| App Output | COP / COST-GUARD / Document Guardian / Action Queue | 운영 카드, action, proof artifact | 승인 전 external mutation 금지 |

User Question
 -> classify\_domain(question)
 -> resolve\_any\_key(identifier)
 -> search\_ontology\_corpus(domain, requiredDocs)
 -> search\_obsidian\_memory(entity + domain + milestone)
 -> merge\_evidence(master\_first=True)
 -> validate\_answer(SHACL/SPARQL/RAG/Human-gate)
 -> return AnswerCard + ActionProposal + ZERO log if blocked

# 4. Schema Patch: MCP Layer 추가

|  |  |  |
| --- | --- | --- |
| **Class** | **Purpose** | **Key Properties** |
| MCPQuerySession | 사용자 질문 단위 세션 | sessionId, userRole, question, createdAt, riskClass |
| MCPToolCall | 각 MCP 호출 기록 | toolName, argsHash, calledAt, latencyMs, resultStatus |
| MCPMemoryHit | Obsidian 검색 결과 | memoryId, title, snippet, confidence, sourcePath |
| MCPAnswerArtifact | 최종 답변/카드 | answerId, verdict, summary, evidenceIds, piiMasked |
| MCPValidationResult | rule 검증 결과 | ruleId, severity, status, reasonCode, targetObject |
| MCPDryRunProposal | 승인 전 변경 제안 | targetType, targetRef, proposedChange, approvalRequired |
| ActionProposal | 담당자/역할 action | ownerRole, dueAt, requiredDocs, humanGateRequired |

Relations:
MCPQuerySession --usedMCPTool--> MCPToolCall
MCPToolCall --retrievedEvidence--> EvidenceAssertion / MCPMemoryHit
MCPAnswerArtifact --validatedBy--> MCPValidationResult
MCPDryRunProposal --requiresApproval--> ApprovalAction
ActionProposal --assignedToRole--> RoleAssignment

Boundary:
MemoryHit cannot mutate ShipmentUnit / CustomsEntry / WarehouseTask / SiteReceipt / Invoice.
Only approved Action can mutate operational truth.

# 5. 최소 구현 데이터셋

|  |  |  |
| --- | --- | --- |
| **Table/Object** | **Minimum Fields** | **Used By** |
| identifier\_index | identifierScheme, identifierValue, normalizedValue, targetType, targetRid, confidence, sourceSystem | Any-key Control Tower |
| shipment\_unit | shipmentUnitId, routingPattern, currentStage, currentLocation, declaredDestination | All modules |
| milestone\_event | shipmentUnitId, milestoneCode, plannedDt, estimatedDt, actualDt, evidenceDocId | MOSB Route Gate, Team Action Router |
| document\_registry | docId, docType, docNo, docHash, ocrConfidence, verificationStatus | Document Guardian |
| invoice\_line | invoiceNo, lineNo, chargeType, qty, rate, amount, currency, shipmentUnitId | Invoice COST-GUARD |
| rate\_ref | rateRefId, lane, chargeType, unit, standardRate, currency, validFrom, validTo | Invoice COST-GUARD |
| team\_role\_matrix | milestoneCode, domain, ownerRole, backupRole, requiredEvidence | Team Action Router |
| action\_queue | actionId, ownerRole, targetObject, actionType, dueAt, status, evidenceIds | Team Action Router |
| mcp\_session\_log | sessionId, question, toolsUsed, verdict, validationStatus, piiMasked | Audit |

# 6. Use Case 1 — Any-key Control Tower

|  |  |
| --- | --- |
| **Item** | **Implementation** |
| 입력 | BL No., BOE No., DO No., Invoice No., HVDC\_CODE, Container No., PO, Package, Vendor, Site, ETA/ATA 중 1개 |
| 핵심 로직 | identifier normalize → target object resolve → nearest ShipmentUnit traverse → 현재 stage/routing/location/doc/customs/release/WH/site/cost/exception 반환 |
| MCP 호출 | SCT.resolve\_any\_key → SCT.search\_ontology\_corpus → SCT.validate\_answer → OBS.search(entity + milestone) |
| Output | Shipment Twin Card: currentStage, routingPattern, currentLocation, nextMilestone, missingDocs, openExceptions, costExposureAed, ownerRole |
| Gate | confidence < 0.95 또는 candidate 2개 이상이면 Human review. 고위험 통관/HS/비용은 ZERO 또는 Human-gate. |

Pseudo:
key = parse\_identifier(user\_text)
entity = SCT.resolve\_any\_key(key)
if entity.confidence < 0.95 or len(entity.candidates) > 1:
 return ZERO("Identifier conflict", input\_required=["BL/BOE/DO/Invoice", "source doc", "site"])
ctx = traverse\_to\_shipment\_unit(entity.targetRid)
evidence = SCT.search\_ontology\_corpus(ctx.domain)
memory = OBS.search(f"{ctx.shipmentUnitId} {ctx.routingPattern} {ctx.currentStage}")
verdict = SCT.validate\_answer(question, evidenceIds=evidence.ids)
return ShipmentTwinCard(ctx, evidence, memory, verdict)

# 7. Use Case 2 — Invoice COST-GUARD

|  |  |
| --- | --- |
| **Item** | **Implementation** |
| 입력 | Draft invoice, OFCO/DSV/port/marine/WH/trucking charge line, RateRef/TariffRef |
| 핵심 로직 | line normalize → rate join → Δ% 계산 → band 부여 → proof artifact 생성 → approval action 생성 |
| Formula | Δ% = (DraftAmount - StandardAmount) / StandardAmount × 100.00 |
| Band | ≤2.00 PASS, 2.01–5.00 WARN, 5.01–10.00 HIGH, >10.00 CRITICAL |
| Gate | invoiceTotal > 100,000.00 AED 또는 HIGH/CRITICAL이면 Finance/Cost Control Human-gate. 원통화 보존, FX override 없으면 변환 금지. |

CostGuardResult example:
{
 "invoiceNo": "INV-XXXX",
 "lineNo": "12",
 "draftAmount": 12500.00,
 "standardAmount": 11800.00,
 "currency": "AED",
 "deltaPct": 5.93,
 "band": "HIGH",
 "verdict": "BLOCK\_FOR\_REVIEW",
 "humanGateRequired": true,
 "evidenceIds": ["RateRef:OFCO-2026", "PortServiceEvent:Rotation-XXXX"]
}

# 8. Use Case 3 — MOSB Route Gate

|  |  |
| --- | --- |
| **Item** | **Implementation** |
| 입력 | ShipmentUnit, declaredDestination, routingPattern, milestones M115/M116/M117/M130, site receipt request |
| 대상 route | AGI/DAS + MOSB\_DIRECT / WH\_MOSB / MIXED |
| 핵심 로직 | M130 Site Arrived/site date는 배송 완료로 인정하고, M115 MOSB Staged, M116 LCT/Barge Loaded, M117 Sail-away Approved 누락은 backfill 대상으로 확인. |
| Block 조건 | AGI/DAS offshore route인데 M130 actualDt/site date가 있으면 DELIVERED로 인정. M115/M116/M117 누락은 MOSB_EVIDENCE_MISSING AMBER/WARN backfill. |
| Output | RouteGateCard: PASS/BLOCK, missingMilestones, requiredEvidence, ownerRole, nextAction, humanGate |

Rule V-AGIDAS-001:
IF declaredDestination IN ["AGI", "DAS"]
AND routingPattern IN ["MOSB\_DIRECT", "WH\_MOSB", "MIXED"]
AND M130.actualDt IS NOT NULL
AND M115.actualDt IS NULL
THEN WARN: "M130 accepted from site date. Backfill M115/M116/M117 MOSB evidence."

# 9. Use Case 4 — Document Guardian

|  |  |  |
| --- | --- | --- |
| **Stage** | **Implementation** | **Validation** |
| 1. Intake | CI/PL/BL/BOE/DO/Permit/MRR/MRI/POD/GRN/OSDR file registry + hash | docHash, docType, sourceSystem required |
| 2. OCR/Parse | tokens, tables, amounts, qty, weight, dates, parties, HS, route evidence 추출 | MeanConf ≥ 0.92, TableAcc ≥ 0.98 |
| 3. Normalize | unit, currency, date, site, port, container, package key 정규화 | NumericIntegrity = 100.00% |
| 4. Entity Link | DocumentEntity → Identifier → ShipmentUnit/CargoUnit/InvoiceLine 연결 | Any-key confidence ≥ 0.95 |
| 5. Cross-doc Check | CI/PL/BL/BOE/DO qty/weight/key consistency 확인 | WARN/BLOCK |
| 6. Evidence Write | VerificationResult, AuditRecord, EvidenceAssertion만 작성 | approved Action 전 operational truth mutation 금지 |

Document Guardian output:
Document/OCR = EvidenceAssertion + VerificationResult + AuditRecord
Operational truth = ShipmentUnit / CustomsEntry / ReleaseOrder / WarehouseTask / SiteReceipt / Invoice
Write guard = Evidence can propose; approved Action can mutate.

# 10. Use Case 5 — Team Action Router

|  |  |  |  |
| --- | --- | --- | --- |
| **Trigger Domain** | **Owner Role** | **자동 Action 예시** | **Required Evidence** |
| M80~M92 Customs/DO | Inbound Customs Documentation | BOE/DO/FANR/MOIAT follow-up 요청 | BOE, DO, BL, MSDS, permit |
| M100 Gate-out | Port/Field Gate Coordinator | gate pass / vehicle / terminal release 확인 | DO, gate pass, EIR |
| M110~M121 Warehouse | Warehouse Execution Coordinator | WH receipt, put-away, pick/stage/dispatch action | WH receipt, PL/DN/MTC |
| M115~M117 MOSB/Marine | Marine Supervisor | MOSB staging, LCT load, sail-away approval 확인 | SR, load manifest, lashing/stability/weather approval |
| M130~M140 Site | Site Receiving Coordinator | site arrival, inspection, POD/GRN closure | delivery note, MRR/MRI/POD/GRN/OSDR |
| M160 Cost Close | Material/Cost Review + Finance Approver | invoice discrepancy review, payment hold/release | invoice, CostGuardResult, proof artifact |

ActionProposal example:
{
 "actionType": "REQUEST\_MOSB\_M115\_EVIDENCE",
 "targetObject": "ShipmentUnit:SU-XXXX",
 "ownerRole": "Marine Supervisor",
 "backupRole": "Site Logistics",
 "humanGateRequired": true,
 "dueAt": "2026-05-13T18:00:00+04:00",
 "requiredDocs": ["MOSB staging record", "LCT load manifest", "sail-away approval"],
 "piiMasked": true
}

|  |
| --- |
| **PII 원칙: Team Action Router는 개인 전화/이메일을 노출하지 않고 role-first로 배정한다. 필요 시 내부 HR/contact vault에서만 raw contact를 조회한다.** |

# 11. 실제 구현 절차

|  |  |  |  |
| --- | --- | --- | --- |
| **Step** | **작업** | **산출물** | **완료 기준** |
| 1 | MCP Router skeleton 작성: domain route, risk gate, tool call log | router.py / mcp\_session\_log | 질문 20건 domain 분류 ≥ 90.00% |
| 2 | identifier\_index 구축: BL/BOE/DO/Invoice/HVDC\_CODE/Container/PO/Site key 정규화 | identifier\_index table | Any-key resolution ≥ 95.00% |
| 3 | ShipmentUnit card 생성: currentStage/routing/location/milestone/document/cost 연결 | ShipmentTwinCard JSON | 카드 p95 < 5.00s |
| 4 | MOSB Route Gate rule 구현 | V-AGIDAS-001 validator | AGI/DAS M130 + MOSB 누락 케이스 100.00% AMBER/WARN backfill |
| 5 | Document Guardian validator 구현 | VerificationResult/AuditRecord | NumericIntegrity = 100.00% |
| 6 | CostGuard calculator 구현 | CostGuardResult + proof JSON | 모든 line에 Δ%, band, verdict 부여 |
| 7 | Team Action Router 구현 | ActionQueue + ownerRole mapping | open exception별 next action ≥ 95.00% |
| 8 | Dry-run write proposal + approval gate | MCPDryRunProposal | approvalRef 없으면 commit 불가 |

# 12. Options A/B/C

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **Option** | **Scope** | **Cost (가정)** | **Risk** | **Time** | **추천** |
| A. MCP-only PoC | ChatGPT + 2 MCP + local CSV/JSON index. 외부 system write 없음. | 0.00 AED external; 내부 80.00 hrs | 낮음. 데이터 최신성 수작업 보정 필요. | 10.00 days | 즉시 시작 |
| B. SQLite/Sheets Control Tower | identifier\_index/action\_queue를 SQLite 또는 Google Sheet로 운영. MCP가 dry-run card 생성. | 0.00~5,000.00 AED; 내부 180.00 hrs | 중간. source sync와 access control 필요. | 30.00 days | 운영 PoC |
| C. Foundry/Ontology Production | Foundry Object/Link/Action/Function + MCP + SHACL/SPARQL + dashboards. | 가정 산정 필요; 내부/외부 견적 별도 | 중간~높음. governance와 system integration 필요. | 90.00 days | 정식 운영 |

# 13. Validation Gate & ZERO Log

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| **Gate** | **Rule** | | | **Status Action** | |
| Identity | identifierScheme/value/normalized/sourceSystem required | | | 누락 시 ZERO: source key 요청 | |
| Route | RoutingPattern enum only; Flow Code를 route로 사용 금지 | | | 위반 시 BLOCK + migration note | |
| MOSB | AGI/DAS site date/M130 인정, M115 backfill 필요 | | | M115 누락 시 AMBER/WARN backfill | |
| Document | CI/PL/BL/BOE/DO key/qty/weight consistency | | | 불일치 WARN/BLOCK | |
| Cost | EA×Rate=Amount±0.01, Σ line=total±2.00%, Δ% band required | | | 불일치 BLOCK | |
| Human-gate | >100,000.00 AED, HIGH/CRITICAL, HS/customs/safety/route mutation | | | approvalRef 없으면 dry-run only | |
| PII | Tel/e-mail raw 노출 금지 | | | role-first assignment | |
| **단계** | **이유** | **위험** | **요청데이터** | | **다음조치** |
| Obsidian Memory | seed note 없음 | 현장 decision/playbook 보강 불가 | SOP, meeting memo, exception note | | HVDC\_Ops\_Playbook.md부터 등록 |
| System Mutation | approvalRef 없음 | 운영 truth 오염 | approvedByRole, approvalRef, reason | | dry-run write proposal만 생성 |
| Customs/HS/Permit | 최신 authority SOP 미확인 | 통관/규정 리스크 | BOE/permit/authority SOP date | | web/RAG 최신 검증 후 진행 |

# 14. Automation Notes

**•** Telegram/Teams bot: “/anykey BL123”, “/mosb-gate SU-123”, “/doc-guardian INV.pdf”, “/costguard INV-123”, “/team-action M130 blocker” 형태로 호출한다.

**•** Sheets RPA: identifier\_index, milestone\_event, action\_queue를 임시 SSOT로 두고 MCP 결과를 CSV/JSON으로 export한다.

**•** LLM/RAG: LLM은 summary와 action drafting만 수행하고, verdict는 SHACL/SPARQL/CostGuard rule에서 나온 값을 사용한다.

**•** Audit: 모든 MCPToolCall, evidenceId, memoryId, validation rule, answerId, actionId를 MCPQuerySession에 저장한다.

**•** Fail-safe: evidenceIds가 없고 high-risk이면 답변을 중단하고 Input Required 3개 이하만 요청한다.

# Appendix A — Router Function Skeleton

def hvdc\_mcp\_router(question: str, attachments: list = None) -> dict:
 session = create\_mcp\_session(question)
 route = sct.route\_question(question)
 key = parse\_any\_key(question, attachments)

 resolved = None
 if key:
 resolved = sct.resolve\_any\_key(key)
 if resolved.confidence < 0.95:
 return zero\_log("LOW\_KEY\_CONFIDENCE", ["identifier", "source document", "site/package"])

 corpus\_hits = sct.search\_ontology\_corpus(
 query=question,
 domainHints=route.domains,
 requiredDocs=route.requiredDocs
 )
 memory\_hits = obsidian.search(build\_memory\_query(question, resolved, route))

 merged = merge\_evidence(corpus\_hits, memory\_hits, precedence="master\_spine")
 validation = sct.validate\_answer(question, evidenceIds=merged.official\_ids)

 if validation.status == "BLOCK":
 action = build\_action\_proposal(route, resolved, validation, human\_gate=True)
 return render\_block\_card(session, validation, action)

 return render\_answer\_card(session, route, resolved, merged, validation)

# Appendix B — SPARQL / Rule Snippets

# Any-key -> ShipmentUnit Twin
SELECT ?unit ?scheme ?value ?stage ?routing ?doc ?milestone ?cost ?exception
WHERE {
 ?id hvdc:identifierScheme ?scheme ;
 hvdc:normalizedValue ?value ;
 hvdc:resolvesTo ?resolved .
 ?resolved (hvdc:belongsToShipmentUnit|^hvdc:hasDocument|^hvdc:packedIn|^hvdc:hasCustomsEntry|^hvdc:hasReleaseOrder)\* ?unit .
 ?unit a hvdc:ShipmentUnit ;
 hvdc:hasCurrentStage ?stage ;
 hvdc:hasRoutingPattern ?routing .
 OPTIONAL { ?unit hvdc:hasDocument ?doc . }
 OPTIONAL { ?unit hvdc:hasMilestone ?milestone . }
 OPTIONAL { ?unit hvdc:hasCostItem ?cost . }
 OPTIONAL { ?unit hvdc:hasException ?exception . }
}

# MOSB Route Gate ASK
ASK {
 ?unit a hvdc:ShipmentUnit ;
 hvdc:declaredDestination ?dest ;
 hvdc:hasRoutingPattern ?routing ;
 hvdc:hasMilestone ?m130 .
 FILTER(?dest IN ("AGI", "DAS"))
 FILTER(?routing IN ("MOSB\_DIRECT", "WH\_MOSB", "MIXED"))
 ?m130 hvdc:milestoneCode "M130" ; hvdc:actualDt ?arrived .
 FILTER NOT EXISTS {
 ?unit hvdc:hasMilestone ?m115 .
 ?m115 hvdc:milestoneCode "M115" ; hvdc:actualDt ?staged .
 }
}

# CostGuard line arithmetic
IF abs((qty \* rate) - amount) > 0.01:
 BLOCK("V-COST-001")
IF abs(sum(lineAmount) - invoiceTotal) / invoiceTotal \* 100.00 > 2.00:
 BLOCK("V-COST-002")
IF invoiceTotal > 100000.00 or band in ["HIGH", "CRITICAL"]:
 require\_human\_gate("Finance Approver")

# 15. CmdRec

/logi-master data-spine --deep --KRsummary
/logi-master invoice-audit --AEDonly
/logi-master report --deep --KRsummary

# 16. 구현 상태 점검 (2026-05-14)

> 운영 endpoint: `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`
> 점검 결과: 15개 tool 노출 확인 / 테스트 150/150 통과 / D1 schema 운영 반영 완료

## 16-1. MCP Tool 구현 상태

| Tool | 상태 | 비고 |
|------|------|------|
| `ask_hvdc_ontology` | ✅ DONE | 운영 중 |
| `route_question` | ✅ DONE | 운영 중 |
| `search_ontology_corpus` | ✅ DONE | 운영 중 |
| `resolve_any_key` | ✅ DONE | 운영 중 (live KG 조회는 PARTIAL) |
| `validate_answer` | ✅ DONE | 운영 중 |
| `render_hvdc_answer_card` | ✅ DONE | 운영 중 |
| `check_cost_guard` | ✅ DONE | 이번 작업 완료 |
| `check_mosb_gate` | ✅ DONE | 이번 작업 완료 |
| `check_doc_guardian` | ✅ DONE | 이번 작업 완료 |
| `get_team_actions` | ✅ DONE | 이번 작업 완료 |
| `create_upload_url` | ✅ DONE | OAuth/Human-gate 포함 |
| `complete_upload` | ✅ DONE | OAuth/Human-gate 포함 |
| `attach_uploaded_file` | ✅ DONE | OAuth/Human-gate 포함 |
| `write_file_dry_run` | ✅ DONE | OAuth/Human-gate 포함 |
| `write_file_commit` | ✅ DONE | OAuth/Human-gate 포함 |
| `search_obsidian_memory` | ❌ NOT DONE | Obsidian MCP 미통합 |

## 16-2. 엔진 기능 구현 상태

| 기능 | 상태 | 비고 |
|------|------|------|
| CostGuard Δ% band 분류 (PASS/WARN/HIGH/CRITICAL) | ✅ DONE | |
| CostGuard V-COST-001/002/003 규칙 | ✅ DONE | |
| CostGuard Human-gate > 100,000 AED | ✅ DONE | |
| CostGuard rate_ref DB lookup | ⚠️ PARTIAL | 현재 인라인 계산만, RateRef 테이블 join 미구현 |
| MOSB Gate V-AGIDAS-001 (M130 인정 + MOSB evidence backfill) | ✅ DONE | |
| MOSB Gate V-AGIDAS-002 (M116/M117 WARN) | ✅ DONE | |
| MOSB Gate approvedExceptionRef bypass | ✅ DONE | |
| Document Guardian qty/weight/containerNo/packageCount | ✅ DONE | |
| Document Guardian OCR intake / TableAcc 측정 | ❌ NOT DONE | 별도 OCR 엔진 미구현 |
| Team Action Router ROLE_MATRIX 라우팅 | ✅ DONE | |
| Team Action Router PII 마스킹 | ✅ DONE | piiMasked: true 강제 |
| Any-key Control Tower (resolve_any_key 기본) | ⚠️ PARTIAL | ShipmentTwinCard live KG 조회 미구현 |
| Any-key → currentStage/currentLocation/nextMilestone | ❌ NOT DONE | identifier_index row 0 상태 |

## 16-3. 데이터 계층 구현 상태

| 테이블 / 계층 | 상태 | 비고 |
|---------------|------|------|
| `identifier_index` (D1 schema) | ⚠️ PARTIAL | 테이블 존재, row count = 0 |
| `milestone_event` (D1 schema) | ⚠️ PARTIAL | 테이블 존재, row count = 0 |
| `team_role_matrix` (D1 schema) | ✅ DONE | migration 0003 반영 |
| `mcp_audit_logs` | ✅ DONE | 운영 중 |
| `mcp_write_proposals` | ✅ DONE | 운영 중 |
| `shipment_unit` | ❌ NOT DONE | 직접 테이블 미구현 |
| `document_registry` | ❌ NOT DONE | 직접 테이블 미구현 |
| `invoice_line` | ❌ NOT DONE | 직접 테이블 미구현 |
| `rate_ref` | ❌ NOT DONE | 직접 테이블 미구현 |
| `action_queue` | ❌ NOT DONE | 직접 테이블 미구현 |
| `MCPQuerySession / MCPToolCall / MCPMemoryHit / MCPAnswerArtifact` | ❌ NOT DONE | audit_logs로 일부 대체 |

## 16-4. Dual-MCP 통합 상태

| 항목 | 상태 | 비고 |
|------|------|------|
| SCT_ONTOLOGY MCP (Cloudflare Worker) 운영 | ✅ DONE | 15개 tool 운영 중 |
| Obsidian Memory MCP 통합 | ❌ NOT DONE | search_obsidian_memory, MCPMemoryHit, memory/canonical merge 미구현 |
| memory ↔ canonical evidence 충돌 해소 로직 | ❌ NOT DONE | Obsidian 통합 선행 필요 |

## 16-5. Automation / 외부 연동 상태

| 항목 | 상태 |
|------|------|
| Telegram / Teams bot | ❌ NOT DONE |
| Google Sheets RPA | ❌ NOT DONE |
| Obsidian playbook seed | ❌ NOT DONE |
| Foundry / ERP / WMS live mutation | ❌ NOT DONE (설계 원칙상 Human-gate 후 별도) |

## 16-6. 종합 판정

| 구분 | 판정 |
|------|------|
| Cloudflare SCT_ONTOLOGY MCP 운영 구현 | **DONE** |
| 4개 전용 엔진 tool (CostGuard, MOSB, DocGuardian, TeamRouter) | **DONE** |
| R2/D1 upload·write dry-run·commit | **DONE** |
| Any-key Control Tower (기본 resolve) | **PARTIAL** |
| live KG 데이터셋 (shipment_unit, invoice_line 등) | **NOT DONE** |
| Obsidian Memory MCP 통합 (Dual-MCP 완성) | **NOT DONE** |

> **정확한 표현**: "Cloudflare SCT_ONTOLOGY MCP 운영 구현 완료, Obsidian Memory 통합 및 live Control Tower 데이터셋은 후속 범위"
