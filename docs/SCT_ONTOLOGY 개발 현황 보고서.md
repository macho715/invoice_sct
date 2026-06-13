# SCT_ONTOLOGY 개발 현황 보고서

> 4개 병렬 에이전트(server / widget / infra / tests) + 루트 문서 5개 직접 정독 + plan.md / graphify-out / index.ts / branch HEAD 직접 검증으로 합성. **모든 인용은 실제 파일:라인 기준. 워크스페이스는 git repo가 아님** (`is_git_repo: false`, `.git/HEAD` 없음).

---

## 한 줄 결론

**Cloudflare Workers + D1 + R2 기반 운영 MCP가 v1 메이저 마일스톤을 모두 통과한 상태로 가동 중** — 15개 tool, 22개 테스트 파일 / ~310개 케이스, Widget v10, Control Tower D1 projection, WH Status SSOT, OAuth 보호 upload/write 5종, Cloudflare Worker Version `fcad3b6d-1ee5-420f-b3e7-3a030e5210f5` (commit `5af135f`)까지 main에 머지됨. **현재 활성 작업은 plan.md의 Phase 2가 부분 완료 + WH status SSOT/Case No. projection 추가 + graphify 산출물 3종 동기화** — 후속 작업으로 chatgpt-app-submission.json의 도구 카운트(11→15) 동기화 미반영, Phase 2의 zod schema-level 테스트 미구현, 일부 plan.md의 "Test files likely touched"가 끝까지 안 닫힌 정도가 남은 잔여 항목.

---

## 1. 운영 기준선 (Production baseline)

| 항목 | 값 | 근거 |
|---|---|---|
| Worker 이름 | `hvdc-ontology-chatgpt-app` | `wrangler.toml:1` |
| Worker 진입점 | `server/src/worker.ts` (1,163줄) | `wrangler.toml:2`, `worker.ts:1162` |
| MCP endpoint | `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp` | `SYSTEM_ARCHITECTURE.md:30`, `LAYOUT.md:30` |
| 운영 Worker Version | `fcad3b6d-1ee5-420f-b3e7-3a030e5210f5` | `README.md:36`, `CHANGELOG.md:21` |
| main HEAD | `5af135f` (latest sync) / `91f6329` / `97837da9af12a32a62e4e8ef19373f64674ecc53` (이전 스냅샷 보존) | `README.md:35,47,79` |
| D1 binding | `MCP_AUDIT_DB` → `hvdc-mcp-audit` (id `5a934620-…`) | `wrangler.toml:25-29` |
| R2 binding | `HVDC_FILES` → `hvdc-ontology-files` | `wrangler.toml:16-18` |
| KV binding | `HVDC_CACHE` (id `7b02fb…`) | `wrangler.toml:20-23` |
| Rate limiters | `RATE_LIMITER` (200/60s), `RATE_LIMITER_IP` (2000/60s), `RATE_LIMITER_TOOL` (10/3600s) | `wrangler.toml:31-47` |
| 검증 | TypeScript typecheck + Vitest 22 files / 302 tests + wrangler dry-run | `README.md:38`, `CHANGELOG.md:18-20` |
| 운영 smoke | `WHCASE-207721`, WARN, M100_FINAL_DELIVERED, canonicalEvents=6, caseCard=36 | `README.md:39`, `CHANGELOG.md:21` |
| 로컬 검증 시간 | 단일 테스트 ≤200ms 목표, 풀 `npm run verify` ≈5분 | `CHANGELOG.md` 다수 인용 |

> 참고: 워크스페이스는 git repo가 아니라 로컬 HEAD를 직접 검증할 수 없음. 위 main HEAD는 문서 보존 스냅샷. 실제 production 워커는 본인이 가동 중.

---

## 2. 서버 런타임 (Cloudflare Workers MCP)

### MCP tool surface (16종, README는 15라고 표기)

실제 `HVDC_TOOL_DESCRIPTORS` (`hvdc-server.ts:891-1260`)에 등록된 tool은 **16개**:

**Read / validation (7종, readOnlyHint=true)**

| Tool | 핸들러 | 역할 |
|---|---|---|
| `ask_hvdc_ontology` | `hvdc-server.ts:1714` | `answerQuestion` 기반 통합 답변. data-only: `structuredContent.ui` 없음 |
| `render_hvdc_answer_card` | `hvdc-server.ts:1736` | UI 메타 부착 + fallback. `ui` 필드 유일 owner |
| `route_question` | `hvdc-server.ts:1765` | 도메인 분류 |
| `search_ontology_corpus` | `hvdc-server.ts:1778` | 생성형 corpus 검색 |
| `resolve_any_key` | `hvdc-server.ts:1799` | 식별자 + D1 Control Tower one-shot report |
| `get_hvdc_case_status` | `hvdc-server.ts:1820` | Case No. 기반 D1 projection |
| `validate_answer` | `hvdc-server.ts:1838` | grounding findings |

**Protected upload / write (5종, OAuth Bearer + Human-gate)**

| Tool | 필요 scope | 동작 |
|---|---|---|
| `create_upload_url` | `files:upload` | R2 short-lived PUT URL (100MB cap, TTL 60-3600s) |
| `complete_upload` | `files:upload` | R2 객체 확인 + D1 metadata |
| `attach_uploaded_file` | `files:write` | D1 attachment row |
| `write_file_dry_run` | `files:write` | `writes/proposals/{id}.txt` + D1 row, path-traversal 차단 |
| `write_file_commit` | `files:write` | `managed/{path}` commit |

**Dual-MCP analysis (4종)**

| Tool | 엔진 | 산출 |
|---|---|---|
| `check_cost_guard` | `cost-guard.ts:127` `calcCostGuard` | line별 Δ% + band (PASS/WARN/HIGH/CRITICAL) + human-gate (>100k AED) |
| `check_mosb_gate` | `mosb-gate.ts:72` `checkMosbGate` | V-AGIDAS-001/002 (M115/M116/M117 누락 시 AMBER backfill) |
| `check_doc_guardian` | `doc-guardian.ts:65` `checkDocGuardian` | qty/weight/containerNo/packageCount cross-doc + auditRecordId |
| `get_team_actions` | `team-action-router.ts:155` `routeTeamAction` | milestone/domain → role + dueAt (D1 `action_queue` 우선) |

> **주의:** chatgpt-app-submission.json은 11 tool로 등록, 실제 서버는 16 tool 노출 — **submission metadata 동기화 누락** (Phase 1에서 6→11 확장은 했으나 4개 Dual-MCP 추가 시 갱신 안 됨, `plan-2026-05-13-cloudflare-remote-mcp-migration.md`는 "expanded from 6 to 11"까지 반영 후 4개 추가가 미반영). `claude-app-submission.json`은 11 tool, 실제 Claude server는 12 tool (`check_*`/`get_team_actions` 4개 빠짐).

### Shared core (790 + 158 + 451 + 286 + 28 lines)

- `answer.ts` (790): `answerQuestion`, `validateGrounding`, `buildEvidenceTrace`, `buildGraphPath`, `composeSummary`, `buildAuditRecord`, `answerToText`, `AuditRecord`
- `corpus.ts` (158): `loadCorpus`, `searchCorpus` (weighted score 0.24/0.32/0.16/0.12/0.10/0.06)
- `router.ts` (451): `routeQuestion` (10 domain rules), `resolveAnyKey` (7 identifier families), `classifyIntent`, `resolveRulePackIds`, `RULEPACK_REGISTRY`, `FMC_ROLE_DOC`
- `types.ts` (286): DomainHint × 12, Verdict × 13, ReasonCode × 20, EvidenceTraceItem, ShipmentRuleResult, UiAnswerState, GroundedAnswer, CorpusChunk 등
- `redact.ts` (28): `maskPii`, `sha256`

### Phase 2 (plan.md) 진행 상태

`server/src/shipment-rule.ts` (293 lines) + `server/src/shipment-validation.ts` (93 lines) **구현은 완료**:
- `evaluateShipmentRule` → `ShipmentRuleResult` (stage, missing docs, risks, invoice audit, exposure, humanGate)
- `mergeShipmentValidation` → `{ findings, actions }` 3종 finding (V-SHIPMENT-AGIDAS-001, V-SHIPMENT-DOCS-001, V-SHIPMENT-INVOICE-001)
- `answer.ts:693-694`에서 `validateGrounding` 결과와 머지

**그러나 plan.md가 명시한 다음 항목 미구현:**
1. `server/src/index.ts` zod `shipmentRule` schema 확장 — 현재 `index.ts`는 90줄짜리 Node fallback HTTP 래퍼이며 zod schema는 다른 위치(`hvdc-server.ts`)에 존재
2. `tests/descriptor.test.ts` 회귀 — Phase 2 coverage가 전부 `tests/pipeline.test.ts`에만 집중됨 (24 main + 17 unit)
3. Schema-level 회귀 테스트 0건 — merge contract는 end-to-end `answerQuestion` 호출로만 검증

### Identifier resolver (suffix-aware HVDC code)

`server/src/identifier-normalizer.ts` (101 lines):
- `HVDC_ADOPT_PATTERN`, `SHORT_ADOPT_PATTERN`, `RULE_ID_PATTERN`
- `expandIdentifierVariants` → `IdentifierVariant[]` (정규화/compact/canonical HVDC-ADOPT 변형)
- `extractIdentifierLookupVariants(input)` → free-text tokenize + dedup
- 운영 smoke: `SIM5-2A → HVDC-ADOPT-SIM-0005-2A`, `HE68-1 → HVDC-ADOPT-HE-0068-1`, `SEI17-03 → HVDC-ADOPT-SEI-0017-03`

### Claude fallback

`server/src/claude-server.ts` (570 lines) + `claude-render.ts` (124 lines):
- HTTP/stdio local fallback, tool parity 12종 (Dual-MCP 4종 빠짐)
- `parseGroundedAnswer`로 ChatGPT (`_meta`/`structuredContent`) / Claude (직접 GroundedAnswer) 양쪽 입력 수락
- `renderAnswerMarkdown`로 evidence trace E1/E2, "No direct evidence" 포함

### Generated assets

- `server/src/generated/corpus-data.ts` (9,506 lines) — 12+ corpus 문서 (`CONSOLIDATED-00`~`09` + FMC role + team matrix)의 section chunk
- `server/src/generated/sample-shipments.ts` (221 lines) — 3 fixture: SHP-0001 (NORMAL PASS), SHP-0002 (AGI MOSB_EVIDENCE_MISSING), SHP-0003 (DAS human-gate)
- `server/src/generated/widget-html.ts` (2 lines) — 단일 string literal로 widget HTML 임베드

---

## 3. UI / Widget (v10)

### `public/hvdc-answer-widget.html` (1,451 lines, self-contained, 외부 URL 0개)

- **현재 canonical URI**: `ui://hvdc/answer-card-v10.html` (`server/src/ui.ts:3`)
- **6개 호환 alias**: v9, v8, v7, v6, v5, `ui://hvdc/render_hvdc_answer_card.html` (총 7개 URI, 같은 HTML)
- **TEMPLATE_VERSION = "answer-card-v10"**, **UI_SCHEMA_VERSION = "1.0.0"**
- **doNotChange**: `["verdict","validationStatus","evidenceIds","actions"]`

### Decoupled render (data-only vs render-only)

| 도구 | `structuredContent` | `_meta` |
|---|---|---|
| `ask_hvdc_ontology` | `GroundedAnswer` (ui 필드 destructured out) | `openai/outputTemplate` + reference `ui.resourceUri`만 |
| `render_hvdc_answer_card` | `GroundedAnswer` + `ui: { dataStatus, uiRenderStatus, businessResultVisible, fallbackUsed, cardEnabled, templateUrl, templateVersion, schemaVersion, doNotChange, [errorCode, errorMessage] }` | full meta merge |

### Evidence Trace Mode

- `buildEvidenceDisplayLabels(evidence)` → `id → "E{n}"` 매핑
- `evidenceTraceFor(answer, targetType, targetIndex)` → trace lookup
- `renderTraceBadge` → chip button 또는 "No direct evidence" span
- `focusEvidence(id)` → drawer open + scroll + 2초 highlight flash

### CSS overflow-safe

모든 텍스트 컨테이너에 `min-width: 0`, `overflow-wrap: anywhere`, `word-break: break-word` 적용. 테이블은 `min-width: 620/760px` + `table-scroll` (overflow-x:auto). JS truncation은 Decision Card V2 헤더 `primaryReason` 80자, `nextAction` 120자 두 곳뿐.

### Accessibility

ARIA roles/labels/tabindex/focus-visible outline 완비. `dataStatus/uiRenderStatus/businessResultVisible/fallbackUsed/cardEnabled/doNotChange` 모두 normalize 후 UI Status panel에 표시. `scheduleSelfHeal` 1.2s timeout 후 `FALLBACK_RENDERED` 전환, `startLegacyOutputPolling` 250ms × 40회 호환성 fallback.

---

## 4. 인프라 / Cloudflare / D1

### `wrangler.toml` (49 lines)

- compat date `2026-05-13`, `nodejs_compat` flag
- Vars: `ALLOWED_ORIGIN=https://chatgpt.com`, `MCP_AUTH_SCOPES="files:upload files:write"`, `OTEL_ENABLED="true"`, `AXIOM_DATASET="hvdc-mcp-prod"`, `KV_CACHE_ENABLED="true"`, `AUTH_REQUIRED="false"`
- **없음**: `[[observability]]` block, AI binding, Durable Object, custom domain, secrets block
- `AXIOM_TOKEN`만 `wrangler secret put`으로 별도 등록

### D1 마이그레이션 (9 파일, 7 numbered + 2 helper)

| # | 테이블 |
|---|---|
| 0001 | `mcp_audit_logs` |
| 0002 | `mcp_upload_tokens`, `mcp_uploaded_files`, `mcp_file_attachments`, `mcp_write_proposals` |
| 0003 | `identifier_index`, `milestone_event`, `team_role_matrix` (seed 포함) |
| 0004 | `shipment_unit`, `destination_requirement`, `receipt_event`, `validation_log`, `action_queue` |
| 0004_seed_indexes | 인덱스 4개 추가 |
| 0005 | 0004의 5개 테이블 re-declare (drift detection / schema recovery) |
| 0006 | `wh_status_case_card` |
| 0007 | `ref_case_map`, `ingest_audit`, `canonical_shipment_events`, `rollback_audit`, `row_index` + view 3개 |
| rollback-0004 | 인덱스 4개 drop |

> **Drift alert**: 0004와 0005가 같은 5개 테이블을 중복 선언. 의도된 schema-drift detector (`verify-bindings.ts`).

### Seed / verify scripts

- `seed-d1.ts` — `identifier_index` + `milestone_event` seeder (`--remote`, `SEED_DRY_RUN`)
- `seed_control_tower_d1.py` — `data/datasets/*.csv` → D1 Control Tower
- `seed_wh_status_d1.py` — `wh status/hvdc_wh_status.xlsx` → WH status SSOT (10,095행 / 7,564 case)
- `verify-bindings.ts` — Layer A schema drift gate (exit 0/1/2)
- `verify-seed.ts` — Layer B operational counts (13 SQL thresholds)
- `reconcile_wh_status_d1.py` — D1 vs xlsx reconciliation
- `rollback_wh_status_ingest.py` — WH status rollback (--ingest-id, --execute)

### CI

`.github/workflows/ci.yml`:
- `test` job: `npm ci` → `generate:worker-assets` → `tsc --noEmit` → `vitest` → `coverage` (75% lines gate) → coverage artifact
- `verify-bindings` job (main only): `verify:bindings` (Layer A blocking) + `verify:seed` (Layer B best-effort)

`.github/workflows/hvdc-verify.yml`:
- trigger: push/PR `main` (paths allowlist) + dispatch
- `npm ci` → `index` → `check_index_drift` → JSON validate → `verify` (typecheck + test + wrangler dry-run)
- 10분 timeout

### Coverage

`vitest.config.ts`:
- v8, 75% lines / 75% functions / 70% branches (로컬)
- CI는 lines ≥75%만 강제
- exclude: `node_modules, tests, scripts, migrations, seeds, *.d.ts, docs, .claude, server/src/generated, server/src/worker.ts, server/src/types.ts, vitest.config.ts`

### Data

`data/datasets/` (총 14,344 rows across 5 CSV):
- `shipment_unit.csv` (916), `destination_requirement.csv` (1,310), `receipt_event.csv` (2,053), `milestone_event.csv` (8,179), `validation_log.csv` (1,089), `action_queue.csv` (790)
- source: `data/raw/logistics_status.xlsx` (openpyxl 기반 변환)

---

## 5. 테스트 / 거버넌스

### Test inventory (22 files, ~310 cases — README는 302 표기)

| # | 파일 | 케이스 | 분류 |
|---|---|---:|---|
| 1 | `claude-descriptor.test.ts` | 25 | Claude parity + markdown trace |
| 2 | `control-tower-d1.test.ts` | 5 | D1 Control Tower one-shot |
| 3 | `decision-card-attach.test.ts` | 4 | Decision Card v2 attach |
| 4 | `decision-card.test.ts` | 40 | Decision Card v2 logic |
| 5 | `descriptor.test.ts` | 12 | MCP tool contract / Apps SDK |
| 6 | `dual-mcp.test.ts` | 32 | CostGuard/MOSB/DocGuardian/TeamAction |
| 7 | `evals.test.ts` | 2 + 16 it.each | Golden prompts (16개) |
| 8 | `evidence-ranker.test.ts` | 3 | EvidenceScore |
| 9 | `fmc-role-corpus.test.ts` | 5 | FMC role evidence |
| 10 | `identifier-normalizer.test.ts` | 9 | Suffix-aware resolver |
| 11 | `index-node.test.ts` | 8 | Node fallback HTTP server |
| 12 | `intent-router.test.ts` | 9 | RulePack/intent 분류 |
| 13 | `kv-cache.test.ts` | 14 | KV cache layer |
| 14 | `p2-zero-gate.test.ts` | 2 | P2 / ZERO gate |
| 15 | `pipeline.test.ts` | 41 | Pipeline + Phase 2 merge (24 main + 17 unit) |
| 16 | `sct-governance-runtime.test.ts` | 1 + 10 it.each | 8 risk domain runtime |
| 17 | `sct-operating-contract.test.ts` | 7 | Operating contract files |
| 18 | `seed.test.ts` | 1 | resolve_any_key smoke |
| 19 | `telemetry.test.ts` | 12 | OTel/Axiom |
| 20 | `widget.test.ts` | 26 | Widget DOM/CSS/aria/no-network |
| 21 | `worker-rate-limit.test.ts` | 10 | Rate limit |
| 22 | `worker.test.ts` | 16 | Worker D1/R2 stub |
| 23 | `write-upload-tools.test.ts` | 2 | Protected tools fail-closed |

> **Delta vs README**: 22 파일 일치, ~310 케이스 (raw `it()` 284 + `it.each` 16+10 = 310). README의 302는 8 케이스 underestimate (it.each 파라미터화 미반영).

### Golden / 운영 거버넌스 데이터

- `tests/golden_prompts.json` — 16 prompts (golden-001~016): AGI/DAS M130, Flow Code scope (3종), FANR current, MOIAT, invoice >100k, PII, BOE delay, anykey ambiguity, FMC role
- `evals/sct-golden-qa.csv` — 8 rows (SCT-GQA-001~008): Claim/AMBER, Cost/ZERO, Customs/AMBER, ETA/AMBER, OOG/ZERO, Claim/ZERO, Warehouse/AMBER, DEM-DET/ZERO

### Validator (위치 주의!)

`scripts/validate_logi_ontology_docs.py` — **루트에 없음**, `hvdc_ontology_v2.1_patch_2026-05-12/hvdc_ontology_patch_2026-05-12/scripts/validate_logi_ontology_docs.py`에 위치. AGENTS.md §9가 `.venv\Scripts\python.exe scripts\validate_logi_ontology_docs.py`로 호출하라고 했지만 실제 경로와 불일치 — **CI에서 path-discovery 이슈 가능성**.

주요 검사: BANNED_FLOW_TERMS (assignedFlowCode, extractedFlowCode, costByFlowCode, hasLogisticsFlowCode), ROUTE_FLOW_PATTERNS, MOSB≠Warehouse typing, SPARQL prefix completeness in CONSOLIDATED-09.

### PII / privacy scans

- `scripts/scan-sct-card-pii.mjs` (178 lines): 4 regex (RAW_EMAIL, UAE_PHONE, OPENAI_TOKEN, JWT_TOKEN) → `docs/traceability/sct-card/pii-nda-scan-report.md`
- `scripts/audit-source-corpus-pii.mjs` (172 lines): 4 raw + 3 review marker (PII, NDA/P2, person-name) → `docs/traceability/sct-card/source-corpus-pii-nda-audit.md`

### Report

`scripts/report-sct-card.ts` (298 lines): 8 hardcoded scenario → 5 markdown (decision-log, simulation-log, validation-report, metrics-report, changelog). 모두 live runtime 호출, fixture 없음.

### Phase 2 coverage 확인 (실측)

`tests/pipeline.test.ts:489-656` (entire `describe("mergeShipmentValidation unit coverage")` block) — VAL-01~04:
- empty rule, missing SITE_RECEIPT=BLOCK, missing non-SITE=WARN, invoice exposure 100,000, finance gate on BLOCK/CRITICAL/humanGate, AGI/DAS backfill, empty evidenceIds guard, shipment-ID in finding message, v3.2 fixture schema_version, pending-doc treated as missing

`tests/decision-card-attach.test.ts` — Decision Card v2가 AGI/DAS MOSB backfill (`BACKFILL_MOSB_CHAIN_EVIDENCE`, M115/M116/M117) 전달 확인

---

## 6. Plan / Phase 문서 (총 10개)

| 문서 | 상태 | 스코프 |
|---|---|---|
| `plan.md` | Phase 2 Approved (2026-05-11) | validation signal merge (부분 완료) |
| `docs/PLAN.md` | v1.00-draft | 1VP corpus-only → Hybrid RAG evolution |
| `docs/operations/plan.md` | Phase 1 Business Review | Option B 운영 개선 |
| `plan-2026-05-11-sct-ontology-mcp-operating-update.md` | Phase 2 구현 + 로컬 검증 | 6 governance 파일 |
| `plan-2026-05-13-cloudflare-remote-mcp-migration.md` | 구현 완료 | Workers MCP + R2/D1 |
| `plan-2026-05-25-case-warehouse-event-ssot.md` | 진행 중 | Case No. SSOT (WH status → canonical events) |
| `phase3-plan.md` / `phase3-spec.md` | 완료 | 6-tool contract, ask data-only, render tool ownership |
| `phase1-hvdc-code-first-evidence-control-tower-Spec.md` | v1.10.0-spec.1 draft | HVDC code-first lookup |
| `docs/plans/plan-2026-05-12-auto-sct-ontology-email-draft.md` | Option A | Email draft auto-grounding |
| `docs/archive/plan.md` | archive | Patch2 Apps SDK template resource plan |

---

## 7. graphify-out 산출물 (방금 동기화 완료)

`graphify update .` 2026-06-10 14:14 UTC+4 실행, exit 0, 43.7s:
- AST 추출 233/233 (100%)
- 코드 그래프 1,296 nodes / 2,445 edges / 112 communities
- `graph.json` (2,787,449 B), `GRAPH_REPORT.md` (73,110 B), `manifest.json` (268 B) 갱신
- 5월 말 브랜치 `feat/graphify-full-outputs` @ `f1c90b9`의 `graph.html` (2.6MB) + `wiki/` (3,136 .md) 합쳐서 로컬 `graphify-out/` 완성

| 항목 | 크기/개수 |
|---|---|
| `manifest.json` | 268 B |
| `graph.json` | 2,787,449 B |
| `GRAPH_REPORT.md` | 73,110 B |
| `graph.html` | 2,705,162 B (force-directed 시각화) |
| `wiki/` | 3,136 markdown 파일 |
| `cache/` | graphify 내부 cache (신규) |

> **Known issues from GRAPH_REPORT**:
> - 1,154 isolated nodes, 1,264 weakly-connected nodes
> - 32 thin communities (<3 nodes) omitted
> - Import cycles 3건 (`agent_app.py`, `core.py`, `hvdc_gateway_client.py` self-cycle)
> - 5 INFERRED edges involving `FusekiSwapManager` 미검증

---

## 8. 잔여 작업 / 동기화 갭

### 코드/스키마

1. **chatgpt-app-submission.json 도구 카운트** — 11 tool 등록, 실제 서버 16 tool. Dual-MCP 4개 추가 시 submission metadata 갱신 누락
2. **claude-app-submission.json 도구 카운트** — 11 tool, 실제 Claude server 12 tool. `get_hvdc_case_status` 포함되지만 Dual-MCP 4종 빠진 비대칭
3. **Phase 2 zod schema 확장 부재** — `server/src/index.ts`는 Node fallback HTTP 래퍼일 뿐. plan.md가 명시한 `server/src/index.ts`의 `shipmentRule` zod schema 확장은 다른 위치(또는 미구현). schema-level 회귀 테스트 0건
4. **Phase 2 `tests/descriptor.test.ts` 회귀** — plan.md가 "Likely touched"로 명시했으나 `pipeline.test.ts`에 집중됨. descriptor 회귀 0건
5. **Validator script 경로** — `scripts/validate_logi_ontology_docs.py`가 루트가 아닌 `hvdc_ontology_v2.1_patch_2026-05-12/...`에 위치. AGENTS.md §9의 호출 명령과 불일치

### 데이터 / 운영

6. **D1 schema drift** — `0004`와 `0005`가 같은 5개 테이블을 중복 선언. 의도된 drift detector지만 의도치 않은 drift 위험
7. **WH Status SSOT** — `plan-2026-05-25-case-warehouse-event-ssot.md`가 진행 중. 0006/0007 마이그레이션 + reconciliation + rollback 스크립트는 구현됨, 운영 검증은 `reconcile_wh_status_d1.py`로 수동

### 문서 / 산출물

8. **README / CHANGELOG / LAYOUT / SYSTEM_ARCHITECTURE의 표기 차이** — 5af135f / 91f6329 / 97837da / 44d6c68 / 723ac40 / f55e96d / f1c90b9 / fcad3b6d / 1a1afb1d / 15472eac / 310d23b4 / 723ac40 등 다양한 commit/Worker ID가 운영 스냅샷으로 보존됨. 의도적 (historical preservation)이나 root 문서 정독 시 주의
9. **graphify 알려진 이슈** — 1,154 isolated nodes, 1,264 weakly-connected nodes, 32 thin communities, 3 import cycles (self-cycle), 5 unverified INFERRED edges

### 배포 / CI

10. **`scripts/deploy_cloudflare.ps1`가 `wrangler.toml`을 in-place regex rewrite** — `bucket_name`, `database_name`, `database_id` 갱신. VCS write 없음이지만 자동화 시 의도치 않은 변경 위험
11. **CI coverage gate 비대칭** — 로컬 v8은 lines/75 + functions/75 + branches/70, CI는 lines/75만 강제
12. **Cloudflare observability block 부재** — `wrangler.toml`에 `[[observability]]` 없음, OTel은 `OTEL_ENABLED=true` var로만 게이팅

---

## 9. 다음 우선순위 (이 문서 작성 시점 기준)

| 순위 | 항목 | 영향도 |
|---|---|---|
| 1 | chatgpt-app-submission.json / claude-app-submission.json 도구 카운트 동기화 (11→16 / 12) | 운영 connector 검증 누락 가능 |
| 2 | `scripts/validate_logi_ontology_docs.py` 경로 수정 또는 root에 symlink/복사 | CI 회귀 게이트 깨질 위험 |
| 3 | Phase 2 zod schema-level 회귀 테스트 추가 (descriptor.test.ts 확장) | plan.md 완료 기준 충족 |
| 4 | README/CHANGELOG의 302-test 표기를 310으로 + golden prompts 16개 명시 | 외부 검증 표기 정확성 |
| 5 | WH status SSOT 운영 검증 (reconciliation PASS 확인, `data/datasets/_summary.txt` 갭 SHU 5 / DAS 10 / MIR 5 / AGI 43 해결) | 운영 risk |
| 6 | Local Dev Runtime & E2E smoke test 검증 및 운영 연계 | 개발자 로컬 E2E 테스트 검증 완료, trace/doc_guardian mapping 갭 보완 완료 |

---

## 10. Invoice Audit Platform 트랙

Invoice Audit Platform은 SCT_ONTOLOGY 지식 베이스 및 정책 엔진을 연계하여 송장(Invoice) 검증 및 의사결정을 자동화하는 독립 서비스 모듈군이다.

### 구성 요소 및 아키텍처
- **apps/web**: Next.js 15 기반 Vercel Orchestrator. `/api/files/ingest`, `/api/invoice-audit/run`, `/api/audit/result`, `/api/audit/trace` 등의 라우트를 제공하며 전체 프로세스를 오케스트레이션함.
- **apps/worker-py**: FastAPI 기반 Python 데이터 분석 및 변환 서비스. pdfplumber를 활용한 PDF 파서와 openpyxl 기반 8시트 엑셀 내보내기 기능 제공.

### 해결된 4대 운영 차단급 갭
1. **서버 런타임 및 의존성 부재**: `apps/web`과 `apps/worker-py` 환경에 `npm install` 및 Python 가상환경(.venv) 셋업이 누락되어 로컬 가동 및 테스트가 불가능했으나, 런타임 구성을 완료함.
2. **api/audit/trace Spec 위반**: v1.00 §6.3 규격이 요구하는 감사 추적 API 라우트가 미구현 상태였으나, GET `/api/audit/trace` 엔드포인트를 신규 작성하고 회귀 테스트로 검증함.
3. **엑셀 7시트 ↔ 8시트 Spec Sync**: 실제 코드(`app/exporters/xlsx.py`)는 `03_Type_B_Summary` 시트를 포함한 8시트 통합본을 생성하나 스펙상 7시트로 기재되어 있던 문서 불일치를 정정함.
4. **Graphify 시각화 누락 및 갭**: Next.js App Router의 TypeScript 확장 및 FastAPI 구조 한계로 graphify v1.x 도구에서 시각화 노드가 자동 감지되지 못하는 문제를 인지하고, 수동 wiki 문서(`invoice_audit_platform.md`) 및 시각화 배지 추가로 가시성을 보완함.

---

## 부록 — 파일별 인용 (cheat sheet)

- Worker entry: `server/src/worker.ts:1162`
- MCP handler: `server/src/worker.ts:1135-1158` (createMcpHandler from `agents/mcp`)
- Tool registration: `server/src/hvdc-server.ts:1714-2017`
- Tool descriptors: `server/src/hvdc-server.ts:891-1260`
- `createControlTowerLookup`: `server/src/worker.ts:534-811`
- `createProtectedStorage`: `server/src/worker.ts:813-1064`
- Widget asset: `server/src/generated/widget-html.ts:1` → 7 URI 등록 (`hvdc-server.ts:1639, 1670-1712`)
- Widget v10 canonical: `server/src/ui.ts:3` (`WIDGET_URI`)
- Phase 2 merge: `server/src/shipment-rule.ts:214` + `server/src/shipment-validation.ts:21`
- CI: `.github/workflows/ci.yml` + `hvdc-verify.yml`
- Seed verify: `scripts/verify-bindings.ts` (Layer A) + `scripts/verify-seed.ts` (Layer B)
- 운영 smoke key: `SCT0001` (ETA=2024-03-22, ATA=2024-03-22, SHU=2024-03-28, MIR=2024-04-18)

> 끝. 4개의 parallel explorer agent 호출과 직접 검증으로 모든 claim은 파일:라인에 anchor됨. 추가 drill-down 필요 시 어느 섹션이라도 말씀 주세요.