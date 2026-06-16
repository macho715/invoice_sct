# 붙여넣은 DSV Final Validator 진단문 코드 교차검증 보고서

**검증일:** 2026-06-16  
**첨부 원문:** `C:\Users\jichu\.codex\attachments\587b4925-333f-4aa7-96b8-221841fab4cc\pasted-text.txt`  
**검증 대상 저장소:** `C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main`  
**검증 방식:** 첨부 텍스트의 주요 주장과 현재 로컬 코드를 `rg` 및 직접 파일 확인으로 교차검증했다.  
**검증 한계:** 운영 배포 상태, 실제 `graph.html` 화면, 런타임 E2E 실행은 확인하지 않았다.

---

## 1. 최종 판정

**PARTIAL / 첨부 진단문은 일부 맞지만, 현재 코드 기준으로 틀린 주장도 많다.**

첨부 텍스트의 큰 방향 중 “DSV v3.2/v3.3 전용 Final Validator 모드가 앱 런타임의 기본 경로로 완전히 승격된 상태는 아니다”는 맞다.

하지만 다음 주장은 현재 코드와 다르다.

- `Final_Recon` 미검출: 현재 13-sheet 계약과 exporter에 `02_Final_Recon`이 있다.
- `workbook_output_validate` 미검출: 현재 `apps/worker-py/scripts/workbook_contract_validate.py`가 있고, 별도 `scripts/shpt_v3_harness/workbook_output_validate.py`도 있다.
- MCP tool registry 미연결: `packages/tools/src/index.ts`, `apps/mcp-server/src/tools/index.ts`에 registry 연결이 있다.
- 9-sheet를 최종 계약으로 고정해야 한다는 주장: 현재 저장소 규칙과 코드의 기본 계약은 13-sheet이다.
- DLP/Formula gate 추가 주장: 현재 `AGENTS.md`와 `CLAUDE.md`는 LP/DLP를 새 gate로 추가하지 말라고 한다.

---

## 2. 항목별 교차검증

| No | 첨부 주장 | 코드 기준 판정 | 근거 요약 |
|---:|---|---|---|
| 1 | `DSV_V32/DSV_V33 Audit Adapter` runtime binding 필요 | 부분 확인 | `run/route.ts`는 일반 `createCfMcpClient().validate()` 경로를 호출한다. `DSV_FINAL_VALIDATOR` 전용 모드는 검색되지 않았다. |
| 2 | `Release_Gate_v3.3_PRO.json` 미검출 | 확인됨 | v3.3 파일은 미검출이다. 단, `shpiment/rules/Release_Gate_v3.2_PRO.json`와 `scripts/shpt_v3_harness/rules/Release_Gate_v3.2_PRO.json`는 존재한다. |
| 3 | `workbook_output_validate.py/ts` 미검출 | 현재 코드와 다름 | `apps/worker-py/scripts/workbook_contract_validate.py`가 있고, `scripts/shpt_v3_harness/workbook_output_validate.py`도 있다. |
| 4 | `03_Type_B_Summary` 미검출 | 부분 확인 | 기본 13-sheet exporter에는 없다. 그러나 Track 1 validator와 shpt harness에는 있다. 현재 기본 계약에서는 의도적으로 제외된 상태다. |
| 5 | `02_Final_Recon` / `Final_Recon Engine` 미검출 | 현재 코드와 다름 | `02_Final_Recon`은 schema와 xlsx exporter에 존재한다. `gate-bridge.ts`에는 reconciliation 함수도 있다. |
| 6 | `93_Audit_Log` 미검출 | 확인됨 | 기본 13-sheet 계약에 `93_Audit_Log`는 없다. 현재 감사 상세는 `91_Audit_Detail`과 trace/store 계열로 분리된다. |
| 7 | `private/contract_rate.json` 또는 secure rate connector 미검출 | 부분 확인 | 앱 기본 rate check는 DB `rate_cards`를 사용한다. DSV package/harness 쪽에는 `private/contract_rate.json` 참조가 있다. |
| 8 | MCP tool wiring 미연결 | 현재 코드와 다름 | `check_rate_card`, `check_contract_validity`, `classify_type_b`, `normalize_invoice_lines`는 registry에 연결되어 있다. |
| 9 | parser production fetch가 stub | 확인됨 | `_fetch_blob()` 주석이 “Phase 1 stub”이라고 명시하고, `httpx.Client().get(blob_url)`로 단순 fetch한다. |
| 10 | `mode=DSV_FINAL_VALIDATOR` 필요 | 부분 확인 | 해당 모드는 미검출이다. 다만 현재 프로젝트 기본 정책은 13-sheet Track 2라서 별도 모드 필요 여부는 제품 결정 사항이다. |
| 11 | `run_self_test_3x` runtime/e2e 연동 필요 | 부분 확인 | `run_self_test_3x.py`는 shpt harness/package 쪽에 있으나 앱 e2e 기본 경로와 직접 연결된 증거는 없다. |
| 12 | DLP/Formula gate 필요 | 충돌 | formula text는 literal 처리된다. 그러나 DLP를 새 gate로 추가하라는 요구는 현재 저장소 규칙과 충돌한다. |

---

## 3. 실제 코드 근거

### 3.1 현재 기본 workbook 계약은 13-sheet이다

`packages/contracts/export.schema.ts`는 13개 sheet를 고정한다.

근거:

- `packages/contracts/export.schema.ts:4-18`
- `packages/contracts/export.schema.ts:36-51`

현재 고정 sheet:

1. `00_Decision`
2. `01_Action_Items`
3. `02_Final_Recon`
4. `03_Header_Check`
5. `04_Line_View`
6. `05_Duplicate_Check`
7. `06_Rate_Check`
8. `07_Tax_FX_Check`
9. `08_Shipment_Match`
10. `90_Source_Data`
11. `91_Audit_Detail`
12. `92_Evidence_Issues`
13. `99_Manifest`

`apps/worker-py/app/exporters/xlsx.py`도 같은 13개 sheet를 생성하고 `99_Manifest`에 `sheet_count = 13`을 기록한다.

근거:

- `apps/worker-py/app/exporters/xlsx.py:28-251`
- `apps/worker-py/app/exporters/xlsx.py:253-256`

따라서 첨부 텍스트의 “최종은 9 sheets로 고정” 주장은 현재 저장소 기본 계약과 다르다.

---

### 3.2 `02_Final_Recon`은 존재한다

첨부 텍스트는 `Final_Recon` 미검출을 핵심 누락으로 봤다.

현재 코드는 `02_Final_Recon` sheet를 생성한다.

근거:

- `packages/contracts/export.schema.ts:7`
- `apps/worker-py/app/exporters/xlsx.py:66-80`

또한 reconciliation 로직도 있다.

근거:

- `apps/web/src/lib/gate-bridge.ts:37-44`

정정:

`Final_Recon`이 전혀 없는 것이 아니다. 다만 첨부가 말하는 DSV v3.x 전용 `Final_Recon Engine` 이름의 별도 모듈은 확인되지 않았다.

---

### 3.3 workbook validator는 존재한다

첨부 텍스트는 `workbook_output_validate` 미검출을 주장한다.

현재 저장소에는 다음 검증기가 있다.

- `apps/worker-py/scripts/workbook_contract_validate.py`: Track 1 8-sheet, Track 2 13-sheet 계약 검증
- `scripts/shpt_v3_harness/workbook_output_validate.py`: SHPT/DSV harness용 workbook output validator
- `shpiment/scripts/workbook_output_validate.py`: package 내부 validator

근거:

- `apps/worker-py/scripts/workbook_contract_validate.py:1-23`
- `apps/worker-py/scripts/workbook_contract_validate.py:51-80`
- `scripts/shpt_v3_harness/workbook_output_validate.py`
- `shpiment/scripts/workbook_output_validate.py`

정정:

“validator가 없다”가 아니라 “현재 기본 exporter/run route의 post-export hard gate로 항상 자동 실행되는지는 별도 확인이 필요하다”가 맞다.

---

### 3.4 `03_Type_B_Summary`는 기본 13-sheet에는 없다

첨부 텍스트는 `03_Type_B_Summary` 누락을 문제로 본다.

현재 기본 Track 2 13-sheet 계약에는 `03_Type_B_Summary`가 없다. 대신 `03_Header_Check`, `06_Rate_Check`, `91_Audit_Detail` 등이 있다.

근거:

- `packages/contracts/export.schema.ts:4-18`
- `apps/worker-py/app/exporters/xlsx.py:82-93`
- `apps/worker-py/app/exporters/xlsx.py:135-161`
- `apps/worker-py/app/exporters/xlsx.py:211-227`

반면 Track 1 validator에는 `03_Type_B_Summary`가 있다.

근거:

- `apps/worker-py/scripts/workbook_contract_validate.py:51-60`

정정:

`03_Type_B_Summary`는 저장소 전체에서 미검출이 아니다. 기본 13-sheet 산출물에서 빠진 것이며, 이는 현재 Rule #0 / Track 2 계약과 연결된 설계 차이다.

---

### 3.5 MCP tool wiring은 존재한다

첨부 텍스트는 핵심 MCP tool이 degree 0 독립 노드로 보이며 registry/call 연결이 부족하다고 주장한다.

현재 실제 코드는 registry를 가진다.

근거:

- `packages/tools/src/index.ts:1-15`: 핵심 tool import
- `packages/tools/src/index.ts:65-85`: `TOOLS` registry와 `dispatch`
- `apps/mcp-server/src/tools/index.ts:14-28`: MCP server tool import
- `apps/mcp-server/src/tools/index.ts:51-70`: `ALL_TOOLS` 및 14개 cardinality check
- `apps/mcp-server/src/tools/index.ts:103-120`: `ToolInputSchemas`, `MCP_TOOL_LIST`
- `apps/web/src/lib/mcp/tools.ts:1-17`: web side re-export

정정:

graph degree만으로 runtime 미연결이라고 단정하면 안 된다. 현재 코드 기준으로 tool registry 연결은 존재한다.

---

### 3.6 run route는 DSV 전용 adapter가 아니라 일반 audit flow를 호출한다

첨부 텍스트의 “DSV Final Validator runtime binding 필요”는 일부 맞다.

현재 run route는 parser 결과를 받은 뒤 일반 MCP validation client를 호출한다.

근거:

- `apps/web/src/app/api/invoice-audit/run/route.ts:454-464`

코드상 `mode=DSV_FINAL_VALIDATOR`, `DSV_V32`, `DSV_V33`, `dsv_final_validator.py` 같은 전용 runtime binding은 확인되지 않았다.

정정:

“runtime binding이 전혀 없다”가 아니라 “현재 runtime binding은 일반 SCT invoice audit flow이고, 첨부가 말하는 DSV v3.x Final Validator 전용 모드는 없다”가 정확하다.

---

### 3.7 parser production fetch stub 주장은 맞다

`apps/worker-py/app/routes/parse.py`는 파일 첫 줄과 `_fetch_blob()` 주석에서 Phase 1 stub임을 명시한다.

근거:

- `apps/worker-py/app/routes/parse.py:1`
- `apps/worker-py/app/routes/parse.py:17-22`
- `apps/worker-py/app/routes/parse.py:64-70`

현재 구현은 `httpx.Client(timeout=10.0).get(blob_url)`로 blob URL을 직접 가져온다.

이 항목은 첨부 텍스트와 실제 코드가 일치한다.

---

### 3.8 DLP gate 추가 요구는 저장소 규칙과 충돌한다

첨부 텍스트는 DLP/Formula gate를 추가 요구한다.

현재 저장소 지침은 LP/DLP를 새 gate, service, module, verdict source, upload blocker, export blocker, workflow phase로 추가하지 말라고 한다.

근거:

- `AGENTS.md:99-106`
- `CLAUDE.md:40-42`

단, formula text 자체는 workbook exporter에서 literal text로 처리한다.

근거:

- `apps/worker-py/app/exporters/xlsx.py:95`
- `apps/worker-py/app/exporters/xlsx.py:118`

정정:

Formula literal 처리나 redaction/secret scan은 유지할 수 있다. 그러나 이를 DLP gate로 새로 정의하면 현재 저장소 규칙과 충돌한다.

---

## 4. 첨부 텍스트의 주요 오판

### 오판 1: graph 미검출을 코드 미구현으로 단정

첨부 텍스트는 graph node 미검출을 근거로 누락을 판정한다.

하지만 실제 코드 검색 결과, graph에서 미검출이라고 한 일부 항목은 코드에 존재한다.

예:

- `02_Final_Recon`
- workbook contract validator
- MCP tool registry
- `check_rate_card`, `check_contract_validity`, `classify_type_b`, `normalize_invoice_lines`

### 오판 2: DSV package contract와 SCT app contract를 섞음

첨부 텍스트는 DSV Final Validator 기준의 8/9-sheet 계약을 현재 앱 기본 산출물에 적용하려 한다.

그러나 현재 저장소의 최우선 산출물은 Rule #0의 13-sheet audit pack이다.

DSV v3.x contract를 유지하려면 별도 mode 또는 별도 export track으로 분리해야 한다.

### 오판 3: DLP gate를 필수로 제안

현재 저장소 규칙은 DLP gate 재도입을 금지한다.

첨부 텍스트의 DLP/Formula gate 요구는 그대로 반영하면 안 된다.

---

## 5. 실제로 남은 유효 gap

첨부 텍스트에서 현재 코드 기준으로 유효한 gap은 아래다.

1. `DSV_FINAL_VALIDATOR` 전용 runtime mode는 없다.
2. `Release_Gate_v3.3_PRO.json`은 없다.
3. 기본 13-sheet export에는 `03_Type_B_Summary`와 `93_Audit_Log`가 없다.
4. parser `_fetch_blob()`는 여전히 Phase 1 stub 주석과 단순 URL fetch 구현이다.
5. DSV v3.x harness의 `run_self_test_3x.py`는 앱 기본 e2e 경로와 직접 연결된 증거가 없다.
6. private `contract_rate.json` 기반 DSV package 검증과 앱의 DB `rate_cards` 기반 rate check가 분리되어 있다.

---

## 6. 권장 조치

### P0: 문서 판정 정정

첨부 텍스트를 그대로 개발 작업 목록으로 쓰면 안 된다.

먼저 다음 문장을 정정해야 한다.

- `Final_Recon 미검출` -> `02_Final_Recon sheet와 reconciliation 함수는 존재한다. DSV v3.x 전용 engine은 별도 확인 필요.`
- `workbook_output_validate 미검출` -> `validator는 존재한다. 자동 release gate 연동 여부가 미확인이다.`
- `MCP registry 미연결` -> `registry는 존재한다. graph degree만으로 미연결 판정 불가.`
- `9 sheets 최종 고정` -> `현재 기본 산출물은 13-sheet이다. DSV 전용 track은 별도 mode로 분리해야 한다.`
- `DLP gate 필수` -> `현재 저장소 규칙상 DLP gate 추가 금지. redaction/secret scan/formula literal 처리로 표현해야 한다.`

### P1: DSV 전용 track이 필요하면 분리 구현

DSV Final Validator를 유지하려면 기존 13-sheet Rule #0을 깨지 않는 방식으로 분리해야 한다.

권장 형태:

- `workflow_type` 또는 별도 export option에 `DSV_FINAL_VALIDATOR` 추가
- 기본 산출물은 계속 13-sheet
- DSV 전용 산출물은 별도 track 또는 sidecar workbook으로 생성
- `03_Type_B_Summary`, `93_Audit_Log`는 DSV track에만 추가

### P2: 실제 runtime hardening

실제 코드 기준 우선순위는 다음이다.

1. `_fetch_blob()`를 signed URL/GCS/Vercel Blob 정책에 맞게 harden한다.
2. workbook contract validator를 export 후 자동 검증으로 연결할지 결정한다.
3. DSV v3.x self-test를 앱 e2e에 포함할지 결정한다.
4. rate source를 DB `rate_cards`로 유지할지, private package source를 secure connector로 이관할지 결정한다.

---

## 7. 검증 명령 요약

```powershell
rg -n "DSV|v3\\.2|v3\\.3|Final Validator|Release_Gate|workbook_output_validate|03_Type_B_Summary|Final_Recon|93_Audit_Log|DSV_FINAL_VALIDATOR" . -S
rg -n "createCfMcpClient|validate\\(|00_Decision|02_Final_Recon|99_Manifest|93_Audit_Log|Type_B" apps/web/src apps/worker-py/app packages -S
rg -n "check_rate_card|check_contract_validity|classify_type_b|normalize_invoice_lines|registry|run_batch" apps/mcp-server packages/tools apps/web/src/lib -S
rg -n "_fetch_blob|Phase 1 stub|signed URL|include_router|APIRouter|blob_url" apps/worker-py/app apps/worker-py/tests apps/worker-py/scripts -S
rg -n "13-sheet|LP/DLP|Do not add LP|00_Decision|99_Manifest|Rule #0|Workbook Contract" AGENTS.md CLAUDE.md README.md SYSTEM_ARCHITECTURE.md apps/web/src/lib apps/worker-py/app -S
```

---

## 8. 결론

첨부 텍스트는 “DSV 전용 validator가 기본 앱 runtime에 완전히 통합되지 않았다”는 문제 제기는 유효하다.

하지만 현재 코드와 교차검증하면 여러 핵심 주장이 과장되었거나 틀렸다.

현재 저장소의 기준은 13-sheet Rule #0 audit pack이다. DSV v3.x 8/9-sheet validator는 기본 계약을 대체할 것이 아니라 별도 track으로 분리해야 한다.
