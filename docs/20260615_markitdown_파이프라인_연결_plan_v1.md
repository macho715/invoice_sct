# MarkItDown → NotebookLM 단계를 업로드 파이프라인에 연결 — 설계 Plan

**작성일:** 2026-06-15
**대상:** `SCT_ONTOLOGY-main` (Invoice Audit Platform)
**목적:** 업로드 시 `/v1/notebooklm/run`(MarkItDown→NotebookLM 추출)을 실제로 호출하도록 연결하고, 기존 pdfplumber 경로와 분기/병행 구조를 확정한다.
**상태:** 설계 문서 — 코드 변경 없음. 승인 후 구현.

---

## 0. 한 줄 결론

> **수신·비교 인프라는 이미 100% 완성돼 있고, 빠진 건 "시작 트리거" 하나뿐이다.** `invoice-audit/run` 파이프라인에서 pdfplumber 파싱 직후 `/v1/notebooklm/run`을 **fire-and-forget(비동기 병행)** 으로 호출하면, 기존 콜백 수신부(`ingest-summary`)가 dual-extraction 비교까지 자동 처리한다.

---

## 1. 현재 상태 (검증 완료)

| 구성요소 | 상태 | 위치 |
|---|---|---|
| MarkItDown 변환 + NotebookLM orchestrator | ✅ 구현됨 | `worker-py/app/notebooklm/orchestrator.py` |
| orchestrator 엔드포인트 `POST /v1/notebooklm/run` | ✅ 구현됨 | `worker-py/app/routes/notebooklm.py` |
| 콜백 수신부 `POST /api/notebooklm/ingest-summary` | ✅ 구현됨 (HMAC 검증·source_hash 검증·dual-extraction 비교·AMBER 플래그) | `web/src/app/api/notebooklm/ingest-summary/route.ts` |
| 어댑터 `adaptNotebookLmToParserResult` / `compareParserAndNotebookLm` | ✅ 구현됨 | `web/src/lib/notebooklm.ts` |
| **`/v1/notebooklm/run` 호출 트리거** | ❌ **없음** (테스트만 호출) | — |
| 메인 파이프라인이 쓰는 파서 | pdfplumber `/v1/parse`만 | `web/src/app/api/invoice-audit/run/route.ts:80,123` · `web/src/lib/parser-client.ts:32` |

**결론:** "받을 준비"는 끝났고 "보낼 시작"만 없다.

---

## 2. orchestrator 동작 계약 (연결 시 전제)

`NotebookLmOrchestrator.run(job_id, blob_url, notebook_id)` →
```
blob_url → SSRF 검증 → httpx 다운로드 → SHA-256
  → MarkItDown(convert_to_markdown) → markdown → SHA-256
  → NotebookLM add_source → ask_question(EXTRACTION_PROMPT) → parse_extraction()
  → HMAC-SHA256 서명 → POST {NOTEBOOKLM_CALLBACK_URL}  (→ ingest-summary)
```
- **반환(동기):** `status, notebooklm_source_id, markdown_sha256, source_sha256, callback_status`
- **결과 본문(비동기):** 추출 필드는 **콜백**으로만 전달 → `ingest-summary`가 수신.
- **타임아웃:** MarkItDown 30s, NotebookLM 300s.
- **콜백 source_hash 검증:** `ingest-summary`는 `source_sha256/markdown_sha256`가 **job의 source_files 중 하나와 일치**해야 통과(L66–73). → ⚠️ MarkItDown 변환본 해시는 원본 파일 해시와 다르므로 **검증 키 정합성**을 반드시 맞춰야 함 (§6 위험 R3).

---

## 3. 설계 결정 (3대 분기점)

### D1. 동기 vs 비동기 → **비동기(fire-and-forget) 채택**
- NotebookLM은 최대 300s + 브라우저 자동화 + 외부 의존 → **메인 감사를 블로킹하면 안 됨**.
- pdfplumber(`/v1/parse`)는 빠르고 결정적 → **1차(primary) 유지**.
- 파이프라인은 pdfplumber로 끝까지 완주(REVIEW_REQUIRED). NotebookLM 콜백은 **나중에 도착**해 dual-extraction 결과를 병합.

### D2. 병행 vs 대체 → **병행 검증(parallel verification) 1순위**
- pdfplumber = source of truth, NotebookLM = "second opinion".
- 기존 `compareParserAndNotebookLm`가 정확히 이 용도로 만들어져 있음.
- PDF 인보이스(현재 미지원)에 대해서는 **대체(fallback) 경로**를 Phase 2에서 추가.

### D3. 트리거 위치 → **`invoice-audit/run/route.ts`, pdfplumber 파싱 직후**
- `files/ingest`(업로드 시점)는 job/audit 컨텍스트가 없어 부적합.
- run 라우트는 이미 signed `blob_url`을 계산함(L73,118) → 그대로 재사용.

---

## 4. 두 단계 구현안 (Phase 1 = 저위험, Phase 2 = 신기능)

### Phase 1 — 병행 검증 연결 (권장 / 즉시 가치)

**무엇:** pdfplumber로 정상 파싱되는 인보이스(xlsx/md/txt 및 추후 PDF 증빙)에 대해, NotebookLM을 **병행 호출**해 dual-extraction 교차검증을 활성화. 검증/게이트 로직은 **기존 그대로** pdfplumber 결과로 수행.

**변경 지점:**

1. **`web/src/lib/parser-client.ts`** — `runNotebookLm()` 메서드 추가
   - `POST {workerUrl}/v1/notebooklm/run` 호출, body `{ job_id, blob_url, notebook_id? }`, Bearer 토큰.
   - 짧은 connect 타임아웃으로 **트리거만** 하고 결과는 기다리지 않음(또는 `void`).

2. **`web/src/app/api/invoice-audit/run/route.ts`** — 파싱 직후(약 L95 이후, validation 시작 전) 삽입
   - feature flag `NOTEBOOKLM_ENABLED === 'true'` 가드.
   - `void parser.runNotebookLm({ job_id, blob_url: <invoiceFile signed url>, notebook_id })` — **await 하지 않음**.
   - 실패해도 메인 파이프라인에 영향 없도록 `.catch()`로 삼킴 + `appendTrace('NOTEBOOKLM_TRIGGERED')`.
   - 동시에 PDF 증빙(`evidenceFiles`)도 선택적으로 트리거 가능(플래그 `NOTEBOOKLM_EVIDENCE_ENABLED`).

3. **콜백 수신부** — **변경 없음**. 기존 `ingest-summary`가:
   - `existingParserResult` 존재(=pdfplumber 정상) → dual-extraction 비교 → 불일치 시 AMBER 플래그 추가(L127–152).
   - `existingParserResult` 없음(=pdfplumber 0라인/실패) → NotebookLM-only fallback로 AMBER 리뷰(L99–125).

4. **환경변수 (worker + web)**
   - worker: `MARKITDOWN_MCP_URL`, `NOTEBOOKLM_MCP_URL`, `NOTEBOOKLM_CALLBACK_URL`, `NOTEBOOKLM_CALLBACK_SECRET`, `NOTEBOOKLM_NOTEBOOK_ID`.
   - web: `NOTEBOOKLM_ENABLED`, `NOTEBOOKLM_CALLBACK_SECRET`(동일 시크릿), `PARSER_WORKER_URL/TOKEN`(기존).

**Phase 1 데이터 흐름:**
```
업로드 → /invoice-audit/run
   ├─[primary] /v1/parse (pdfplumber) → normalized → 검증 → 게이트 → REVIEW_REQUIRED  (동기 완주)
   └─[parallel, fire-and-forget] /v1/notebooklm/run
            → MarkItDown → NotebookLM → 콜백 → /api/notebooklm/ingest-summary
                 → dual-extraction 비교 → (불일치 시) 기존 결과에 AMBER 플래그 병합
```

### Phase 2 — PDF 인보이스 대체(fallback) 경로 (신기능)

**무엇:** pdfplumber가 라인을 못 뽑는 **PDF 인보이스**에서 NotebookLM 추출 결과를 1차 소스로 승격.

**변경 지점:**
1. **run 라우트 invoice 판별(L43–48)** — PDF를 invoice 후보로 허용(현재는 evidence 전용).
2. **빈 라인 단락 처리(L100–113)** — pdfplumber 0라인 + PDF면 즉시 AMBER 종료하지 말고 `status: 'EXTRACTING'`(신규 상태) 유지 + NotebookLM 트리거 후 콜백 대기.
   - ⚠️ 현재 run 라우트가 L95에서 빈 결과라도 `setNormalizedInvoice`를 호출 → `ingest-summary`의 "no existing" 분기가 안 탐. → **빈 라인일 땐 normalized 저장을 보류**하도록 수정 필요.
3. **`ingest-summary` 확장** — NotebookLM이 라인을 공급하면 **검증/게이트 재실행**(MCP tools → gate-bridge)으로 파이프라인 이어가기. (현재는 비교·플래그만 하고 검증을 안 돌림.)
   - 공용 함수로 `runValidationAndGate(job_id, normalized)`를 추출해 run 라우트와 ingest-summary가 공유.
4. **신규 Job 상태 `EXTRACTING`** — `types.ts JobStatusSchema`에 추가(현재 12개 → 13개), 상태 머신/문서 업데이트.

---

## 5. 작업 분해 (체크리스트)

**Phase 1**
- [ ] `parser-client.ts`: `runNotebookLm()` 추가 + 인터페이스 확장
- [ ] `run/route.ts`: 파싱 직후 비동기 트리거 + flag 가드 + trace
- [ ] env 문서화(`.env.example`, worker/web 양쪽)
- [ ] worker `NotebookLmRunRequest` 스키마에 `notebook_id` 선택값 확인
- [ ] 테스트: run 라우트가 flag ON일 때 `/v1/notebooklm/run`을 호출(mock), OFF일 때 미호출 / 트리거 실패가 메인 verdict에 영향 없음
- [ ] E2E: pdfplumber 정상 + NotebookLM 콜백 도착 → dual-extraction AMBER 플래그 확인

**Phase 2**
- [ ] `JobStatusSchema`에 `EXTRACTING` 추가 + 상태 머신 갱신
- [ ] PDF invoice 허용 + 빈 라인 시 normalized 저장 보류
- [ ] `runValidationAndGate()` 공용 추출 → ingest-summary에서 재실행
- [ ] 테스트: PDF 인보이스(pdfplumber 0라인) → NotebookLM 라인 공급 → 검증/게이트 완주

---

## 6. 위험 & 완화

| ID | 위험 | 완화 |
|----|------|------|
| R1 | NotebookLM 300s 지연이 사용자 응답을 막음 | **비동기 fire-and-forget** (D1). 메인은 pdfplumber로 완주 |
| R2 | 트리거 실패가 감사 자체를 깨뜨림 | `void` + `.catch()` 격리, flag로 OFF 가능 |
| R3 | **콜백 source_hash 불일치** — `ingest-summary`는 해시가 source_files와 일치해야 통과. MarkItDown 변환본 해시는 원본과 다름 | orchestrator가 **원본 PDF의 sha256**(source_files에 저장된 값)을 콜백 `source_sha256`로 보내도록 정합성 보장. 불일치 시 409 |
| R4 | dual-extraction 불일치 남발로 과도한 AMBER | `compareParserAndNotebookLm`의 high-impact 필드만 플래그(기존 로직 유지), confidence 임계 적용 |
| R5 | DLP/P2 — PDF 내용이 NotebookLM(외부 브라우저 자동화)로 전송 | 증빙·인보이스 원문이 외부로 나가는 경로임을 명시. P2 정책 재확인 필요(운영 결정), flag로 통제 |
| R6 | 비용/속도 — 모든 업로드마다 NotebookLM 호출 | flag + 조건부 트리거(예: PDF만, 또는 pdfplumber confidence<0.85일 때만) |

---

## 7. 권고

1. **Phase 1만 먼저 구현·배포** — 기존 인프라 100% 재사용, 위험 최소, 즉시 dual-extraction 교차검증 가치 확보.
2. **조건부 트리거 권장** — 전건이 아니라 `PDF 증빙` 또는 `pdfplumber confidence < 0.85`일 때만 호출(R6·R5 동시 완화).
3. **R3(해시 정합성)·R5(P2 외부전송)** 은 구현 전 반드시 확정해야 하는 선결 이슈.
4. Phase 2(PDF 인보이스 대체)는 별도 스프린트 — `EXTRACTING` 상태 추가 + 검증 재실행 공용화가 핵심.

---

**다음 단계:** 이 plan 승인 시 Phase 1 구현 착수 (`parser-client.ts` + `run/route.ts` + 테스트). R3/R5는 착수 전 확인 요청.
