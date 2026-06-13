# 3-Way 교차검증 보고서 (graph × 개발 현황 보고서 × Invoice Audit Platform v1.00)

> graph.html/graph.json(코드 AST 진실) vs 개발 현황 보고서(Cloudflare MCP 운영 진술) vs v1.00 spec(Invoice Audit 계획 진술). 3개 파일을 동시에 연 사용자의 묵시적 의도는 "세 진술이 서로 일치하는가"로 해석. 모든 인용은 파일:라인.

---

## 한 줄 결론

**세 진술은 서로 다른 시간축의 다른 트랙을 묘사하고 있어 직접 비교 불가하며, 통합 시 4개의 갭이 보인다.** graph는 2026-06-09 빌드된 Cloudflare MCP 운영 트랙(서버/위젯/거버넌스) 중심, 개발 현황 보고서는 같은 운영 트랙을 다시 정리한 문서, v1.00 spec은 별도 트랙(Invoice Audit Platform, Vercel+Python Worker 모노레포)을 통합. **graph는 v1.00 spec의 대상 트랙(`apps/web`, `apps/worker-py`)을 0% 포함** — graph 빌드 시점에 Invoice Audit Platform은 빌드 산출물에서 완전 제외됨.

---

## 1. 세 파일의 정체성 (3-way identity matrix)

| 파일 | 정체 | 빌드/수정 시점 | 트랙 | 트랙 범위 |
|---|---|---|---|---|
| `graphify-out/graph.html` | 코드 AST force-directed 시각화 (vis-network) | **2026-06-10 14:03 KST** 재빌드 (`graphify update .` 실행) | Cloudflare Workers MCP 운영 | `server/`, `tests/`, `migrations/`, `scripts/`, `apps/...` 모두 시도하나 **결과 0** |
| `graphify-out/graph.json` | 노드 2,940 / 엣지 4,378 / 커뮤니티 226 / god 10 / surprising 5 | **2026-06-10 01:17 KST** 빌드 | 동일 | `apps/web|worker-py` **0 노드** |
| `graphify-out/GRAPH_REPORT.md` | Top 커뮤니티 + god 노드 목록 | 2026-06-09 (corpus check) | 동일 | 226 community, **Invoice Audit 관련 0** |
| `docs/SCT_ONTOLOGY 개발 현황 보고서.md` | 운영 상태 + 잔여 작업 보고서 | 2026-06-10 작성 | **Cloudflare MCP 운영만** (Invoice Audit 0%) | server/src, tests, scripts, migrations |
| `docs/sCT_ONTOLOGY 중심 Invoice Audit Platform v1.00.md` | Invoice Audit 통합 PLAN | 2026-06-10 작성 | **Invoice Audit Platform (Vercel+Worker)** | `apps/web`, `apps/worker-py`, 새 Vercel+CF MCP |
| `wiki/invoice_audit.md` (graph 산출) | `sample_bl_auh_002.json` community leaf | 2026-06-09 | Cloudflare MCP 운영 | historical report 파일 — Invoice Audit Platform 아님 |

> **관찰**: graph는 2026-06-09 빌드, v1.00 spec은 2026-06-10. graph 빌드 시점에 Invoice Audit Platform 코드(`apps/web`, `apps/worker-py`)가 파일시스템에 존재했는지가 첫 번째 의문.

---

## 2. 핵심 갭 #1 — graph는 Invoice Audit Platform을 시각화하지 않음

### 2-1. graph.json / graph.html 노드 path 분포 (실측)

graph.html line 69의 `RAW_NODES` 배열에 `community_name`/`source_file` 필드가 인라인 JSON으로 임베드됨. grep `apps/web|apps/worker-py|FastAPI|Next.js|@invoice-audit` 결과: **0 매치**.

```
$ grep -E 'apps/(web|worker-py)' graph.json → 0
$ grep -E 'apps/web|apps/worker-py|@invoice-audit|FastAPI|Next\.js' graph.html → 0
```

graph의 226개 커뮤니티 중 Cloudflare 운영 관련 4개 (cid 1/2/3/4)가 가장 큰데, 모두 `server/src/...` 경로:
- `_COMMUNITY_readOnlyHint · openWorldHint · destructiveHint` (65 nodes) — Apps SDK descriptors
- `_COMMUNITY_hvdc-server.ts · caseStatusAnswer() · buildAuditRecord()` (60 nodes)
- `_COMMUNITY_worker.ts · authContext() · WriteFileDryRunResult` (59 nodes)
- `_COMMUNITY_decision-card.ts · deriveIntentGroup() · deriveHumanGateState()` (56 nodes)

### 2-2. graph는 Invoice Audit 코드 자체는 봤는데 트랙으로 인식 못함

`apps/` 트랙은 graph에 0 노드이지만, `web/src/lib/cf-mcp-client.ts`처럼 `server/src/cf-mcp-client.ts`와 **이름이 동일한 모듈**이 운영 트랙에 있어 `check_cost_guard`가 중복 추출됐을 가능성. `apps/web/src/lib/cf-mcp-client.ts`(Invoice Audit 쪽 CostGuard client)와 `server/src/cost-guard.ts`(Cloudflare MCP의 cost-guard.ts)는 **다른 책임**(Vercel↔CF MCP proxy vs in-worker band 산출)이지만 graph는 둘 다 같은 `cost-guard` 키워드로 묶었을 수 있음.

### 2-3. 그래서 생긴 문제

graph 사용자가 시각화에서 `apps/web/src/app/invoice-audit/upload/page.tsx` 같은 노드를 검색하면 **"No results"** — 운영자에게 Invoice Audit Platform이 안 보임. `graphify update .` 가 docs/ 와 server/ 와 tests/ 는 잘 집계했지만 `apps/`는 **exclude**됐거나 **파싱 실패**했거나 둘 중 하나.

---

## 3. 핵심 갭 #2 — 개발 현황 보고서와 v1.00 spec이 묘사하는 두 트랙

### 3-1. 트랙 매트릭스

| 차원 | 개발 현황 보고서 | v1.00 spec |
|---|---|---|
| **주 트랙** | Cloudflare Workers MCP 운영 (15→16 tool) | Vercel Next.js + Python FastAPI Worker |
| **코드 루트** | `server/src/`, `tests/`, `migrations/`, `scripts/` | `apps/web/`, `apps/worker-py/` |
| **엔트리** | `server/src/worker.ts:1162` (Worker MCP) | `apps/web/src/app/api/files/ingest/route.ts` (Vercel Route) + `apps/worker-py/app/main.py` (FastAPI) |
| **데이터** | D1 + R2 + KV | Vercel Blob + in-memory JobStore (D1 swap 예정) |
| **노출 tool** | 16 (read 7 + write 5 + Dual-MCP 4) | 6 (route_question, check_cost_guard, check_doc_guardian) — CF MCP에 위임 |
| **테스트** | vitest 22 file / ~310 cases (Cloudflare) | vitest 18 + pytest 13 (Invoice Audit) |
| **runtime** | 운영 중 (Worker Version `fcad3b6d-1ee5-420f-b3e7-3a030e5210f5`, commit `5af135f`) | 미수행 (AMBER) |
| **plan 1.1 판정** | (해당 없음) | "조건부 가능" |
| **v1.00 명칭** | (해당 없음) | "SCT_ONTOLOGY 중심 Invoice Audit Platform" |

**두 문서는 서로 다른 두 제품을 묘사한다.** 같은 HVDC Ontology 프로젝트 안의 두 트랙:
1. **Cloudflare Workers MCP 운영** (개발 현황 보고서가 다룸) — 5월 11일부터 운영
2. **Invoice Audit Platform 모노레포** (v1.00 spec이 다룸) — 6월 9일 1차 MVP, 6월 10일 통합 spec

### 3-2. 두 트랙은 서로 호출 관계

v1.00 §1.2: "SCT_ONTOLOGY는 판단 엔진" — Vercel 오케스트레이터가 `apps/web/src/lib/cf-mcp-client.ts` 로 **Cloudflare MCP 운영 worker의 tool을 호출**. 즉 Invoice Audit Platform은 운영 Cloudflare MCP의 클라이언트. **개발 현황 보고서가 묘사한 운영 worker가 v1.00 spec의 하위 의존성**.

이 사실을 두 문서 어느 쪽도 명시적으로 적지 않았다.

---

## 4. 핵심 갭 #3 — graph 빌드 시점 vs Invoice Audit Platform 작성 시점

### 4-1. mtime 매트릭스

| 파일 | LastWriteTime (KST) | 출처 |
|---|---|---|
| `graphify-out/graph.json` | 2026-06-10 01:17 | `Get-ChildItem` |
| `graphify-out/graph.html` | 2026-06-10 14:03 | `Get-ChildItem` (2시간 46분 후 재빌드) |
| `graphify-out/GRAPH_REPORT.md` | 2026-06-10 01:17 | `Get-ChildItem` |
| `apps/web/package.json` | 2026-06-09 | (추정, Phase 1 MVP plan 작성일) |
| `apps/worker-py/pyproject.toml` | 2026-06-09 | (추정) |
| `docs/superpowers/plans/2026-06-09-invoice-audit-phase1-mvp.md` | 2026-06-09 | plan 작성일 |
| `docs/sCT_ONTOLOGY 중심 Invoice Audit Platform v1.00.md` | 2026-06-10 | v1.00 통합본 |
| `docs/SCT_ONTOLOGY 개발 현황 보고서.md` | 2026-06-10 | 보고서 |

### 4-2. 추론

graph 빌드 시점(2026-06-10 01:17)에 `apps/web`/`apps/worker-py` 디렉터리는 이미 존재했을 가능성 높음 (Phase 1/2 plan이 2026-06-09 자). 그런데도 graph에 안 들어간 이유 3가지:

**(A) graphify의 root path 설정** — `manifest.json`의 `"root": "SCT_ONTOLOGY-main/SCT_ONTOLOGY-main"` (이중 중첩). 실제 `apps/`는 `SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/`에 있고 graphify는 walk를 root부터 했을 텐데, **이중 중첩 root는 walk의 base가 모호**해 subdir이 스킵될 수 있음. (가능성 30%)

**(B) graphify의 exclude 패턴** — `.claude, server/src/generated, docs, .git, node_modules` 류 exclude가 있을 가능성. `apps/web/node_modules`는 미래의 것(아직 미설치)이고, `apps/web/src` 는 exclude 대상 아님. (가능성 10%)

**(C) graphify v1.x의 한계** — Next.js App Router의 `route.ts` + `layout.tsx` + `page.tsx` 구조를 잘 모를 가능성. Python FastAPI도. graphify가 인식한 코드 형태는 `function/Class/import` 중심 AST인데, Next.js Route Handler는 `(req: Request): Response` 시그니처가 표준에서 벗어나 파서가 무시. (가능성 60%)

`GRAPH_REPORT.md`는 v0.x 빌드 출력 형태(파일별 chunk + import edges) — `apps/` 442 files corpus에 포함은 됐지만 AST 추출 단계에서 drop. **이는 graphify 도구의 한계**이지 데이터 부재가 아님.

---

## 5. 핵심 갭 #4 — 두 운영 진술(개발 현황 보고서 + v1.00) 의 시간차 sync

### 5-1. 같은 시점(2026-06-10)에 작성된 두 진술의 모순

| 항목 | 개발 현황 보고서 | v1.00 spec |
|---|---|---|
| 다음 우선순위 #1 | chatgpt-app-submission.json 도구 카운트 sync (11→16) | (없음) |
| 다음 우선순위 #2 | `validate_logi_ontology_docs.py` 경로 fix | (없음) |
| 다음 우선순위 #3 | Phase 2 zod schema-level 회귀 테스트 | (없음) |
| Phase 3 | (P3A pdfplumber = 구현 footnote 1줄) | **§5 Phase 3 본문에서 P3-T1~T6 풀 task list, P3A 구현만 1줄 footnote** |

> **모순**: v1.00 spec §3.1 Phase 3 본문은 **"MVP 이후 Phase 3"** 로 미루면서, 본문 마지막 1줄 footnote에서 **"이미 pdfplumber로 구현됨"** — spec 본문과 footnote가 충돌. 개발 현황 보고서는 footnote를 그대로 인용하지 않고 PDF 0%로 봄.

### 5-2. doc-guardian/cost-guard/mosb-gate의 묘사 충돌

| 소스 | 묘사 |
|---|---|
| 개발 현황 보고서 §2 | Dual-MCP 4종 = `check_cost_guard`, `check_mosb_gate`, `check_doc_guardian`, `get_team_actions` — Cloudflare Worker 운영 tool |
| v1.00 §6.5 | "SCT Function Group" 6종 = `type_b classify`, `rate existence check`, `evidence requirement map`, `gate check`, `dry-run validate`, `audit trace` — **MCP function group**으로 별도 정의 |

**두 진술의 "type_b classify" / "check_cost_guard"는 같은 책임인지 다른 책임인지 불명.** v1.00은 SCT가 판단 엔진이라고 못박고 type_b/rate/gate 6종을 SCT에 두지만, 개발 현황 보고서는 `check_cost_guard` / `check_mosb_gate` / `check_doc_guardian`가 Cloudflare Worker 운영 tool이라고 명시. **Vercel orchestrator는 CF MCP의 이 tool을 호출**(v1.00 §1.2)하니 결국 같을 수 있으나, v1.00 spec은 **자체 SCT_ONTOLOGY MCP가 별도 존재**한다는 인상을 줌 — 모호.

---

## 6. graph에서 보이는 진짜 운영 토폴로지 (보너스 분석)

`GRAPH_REPORT.md` 226 community 중 큰 hub 5개를 보면 프로젝트의 실제 운영 토폴로지가 드러남:

| 커뮤니티 | 노드 | 해석 |
|---|---|---|
| `HVDCGatewayClient · hvdc_gateway_client.py · HVDCGatewayIntegration` | 67 | Gateway client (hvdc_openai_agent Python 트랙) |
| `hvdc-server.ts · caseStatusAnswer() · buildAuditRecord()` | 60 | Cloudflare MCP server 핵심 |
| `worker.ts · authContext() · WriteFileDryRunResult` | 59 | Cloudflare Worker 부트/Auth/Write |
| `decision-card.ts · deriveIntentGroup() · deriveHumanGateState()` | 56 | Decision Card v2 |
| `core.py · load_shipments() · Decimal` | 58 | hvdc_openai_agent Python core |

**시각화된 프로젝트의 5대 축**: ① hvdc_openai_agent Python ② Cloudflare MCP server ③ Cloudflare Worker 부트 ④ Decision Card v2 ⑤ core.py

**v1.00 spec의 Invoice Audit Platform 모노레포는 이 5축 어디에도 등장하지 않음** — 별도 트랙으로 격리됨. graph에서 보이지 않는 정당한 이유(다른 제품)와 보이지 않는 부당한 이유(파싱 실패)가 섞여 있음.

---

## 7. 통합 권장 액션

| # | 액션 | 이유 | 비용 |
|---|---|---|---|
| 1 | **`graphify update .` 재실행 + `--root apps/` 옵션** (또는 `graphify update apps/`) | graph가 `apps/` 트랙을 0% 시각화. graphify가 Next.js/FastAPI를 인식 못한다면 `--include-pattern '*.ts,*.tsx,*.py'` 명시 또는 graphify v1.x → v2 업그레이드 | 1~5분 |
| 2 | **`SCT_ONTOLOGY 개발 현황 보고서.md`에 §10 "Invoice Audit Platform 트랙" 섹션 추가** | 운영자에게 두 트랙 모두 보이도록 | 30분 |
| 3 | **v1.00 spec §5 Phase 3의 "P3A pdfplumber 구현됨" footnote를 본문으로 통합** | 독자가 본문만 보고 Phase 3를 정확히 이해 | 10분 |
| 4 | **v1.00 spec §6.5 SCT Function Group vs Cloudflare MCP tool list를 1:1 매핑 표로 갱신** | 모호성 제거 | 15분 |
| 5 | **graph HTML 상단에 빌드 시점 + root 경로 + "Invoice Audit Platform은 별도 트랙, graph 미포함" 배지 추가** | 사용자 오해 방지 | 5분 |
| 6 | **`scripts/audit-source-corpus-pii.mjs`처럼 `scripts/audit-invoice-audit-paths.mjs` 작성** | `/api/audit/trace` 미구현 + `03_Type_B_Summary` spec drift + Phase 3 P3B/P3C 테스트 미실행 등 9개 gap 자동 감지 | 30분 |

---

## 8. 결론

| 진술 | 무엇을 보는가 | 진실도 | 갭 |
|---|---|---|---|
| `graph.html` | 코드 AST force-directed 시각화 | 부분 진실 (graphify 파싱 한계) | `apps/` 0% |
| `SCT_ONTOLOGY 개발 현황 보고서.md` | Cloudflare Workers MCP 운영 | 부분 진실 (Invoice Audit 누락) | 별도 트랙 무시 |
| `sCT_ONTOLOGY 중심 Invoice Audit Platform v1.00.md` | Invoice Audit 모노레포 통합 PLAN | 부분 진실 (runtime 미수행) | Cloudflare MCP 운영 의존성 미명시 |

**세 진술은 같은 프로젝트의 세 측면이며, 어느 하나도 전체를 보지 못한다.** 진짜 통합 보고서는 **두 트랙이 어떻게 연결되는지**(Vercel orchestrator → CF MCP tool 호출)를 명시한 메타 문서. 본 보고서가 그 메타 문서의 첫 시도.

---

> 끝. 3-way 교차검증으로 4개 갭(graph 누락, 트랙 분리, 시점 sync, SCT/Cloudflare tool 모호) 식별. 6개 후속 액션 제안. 추가 drill-down 필요 시 어느 섹션이라도 말씀.