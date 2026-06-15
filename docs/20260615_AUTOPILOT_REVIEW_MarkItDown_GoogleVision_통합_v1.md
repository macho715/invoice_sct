# AUTOPILOT REVIEW — MarkItDown MCP + Google Vision 통합 WORKFLOW/PROCESS 상세설계서 v1

**리뷰 대상:** `20260615_MarkItDownMCP_GoogleVision_통합_WORKFLOW_PROCESS_상세설계서_v1.md`  
**리뷰 날짜:** 2026-06-15  
**리뷰 모드:** AUTOPILOT (gstack 4-Stage + Final Gate)  
**리뷰어:** Claude (single-voice — Codex unavailable)  
**문서 범위:** 21개 섹션, 1,651라인

---

## CEO REVIEW — 전략 전제 검토

### 모드 설정: HOLD SCOPE

이 설계서는 이미 확정된 인보이스 감사 플랫폼의 확장이다. 기존 3-app 아키텍처에 OCR + Markdown 레이어를 삽입하는 제한적 범위. 범위 확장보다 설계의 실행 가능성과 전제 검증에 집중.

### 6가지 기준 평가

#### 1. 올바른 문제인가?

**PASS.** 현재 플랫폼은 scanned PDF 및 이미지 기반 인보이스를 처리할 수 없다. 실제 HVDC 현장에서는 DSV, Mammoet, OFCO 등의 일부 인보이스가 스캔된 종이 문서이거나 이미지 PDF로 전달된다. Google Vision OCR을 추가하면 `pdfplumber`만으로는 처리 불가능한 scanned PDF를 정규 파이프라인에 편입할 수 있다. MarkItDown은 감사 추적/설명 문서로 Markdown artifact를 남겨 human reviewer에게 가독성을 제공한다. **실제 운영 문제를 해결하는 올바른 확장이다.**

#### 2. 전제가 명시적인가?

**AMBER — 3개 전제가 불충분히 명시됨:**

| 전제 | 상태 | 위험 |
|------|------|------|
| "GCS로 migration이 필요하다" | P0에 명시됨 (A안: Vercel + GCS 병행) | 기존 Vercel Blob 코드 전체가 blob_ref 기반 — GCS URI 기반으로 전환 시 모든 파서/라우트 변경 필요 |
| "Vision API 비용이 허용 범위다" | §14에 언급 (AUTO policy, batchSize 1) | 월 예상 비용 추산 없음. PDF 페이지당 $1.50~$3.00/1000페이지 — 월 100건×10페이지 기준 $1.5~$3. 전제 검증 완료로 보기 어려움 |
| "MarkItDown MCP가 별도 서비스로 동작한다" | §7.3에 명시 | 현재 MarkItDown은 NotebookLM orchestrator 내부 client로만 존재. 별도 Cloud Run service로 분리하는 구현 비용이 P0에 포함되지 않음 |

#### 3. 6개월 후 후회 시나리오

**주의 — 2가지 시나리오:**

1. **"왜 GCS로 완전히 넘어가지 않았나"** — 설계서는 A안(Vercel+GCS)과 B안(Full Google Cloud)을 제시하지만 실제 구현 우선순위는 A안으로 고정. 6개월 내 Vercel Blob deprecation이나 Google Cloud 이전 압력이 생기면 A안이 기술부채로 전환됨.
2. **"Vision OCR text에서 구조화된 invoice를 제대로 못 뽑는다"** — 설계서 §8.1 Router에서 scanned PDF → Vision OCR → normalizer 경로를 정의하지만, Vision의 `fullTextAnnotation`은 text만 제공하고 invoice schema(header/line items)는 제공하지 않는다. Normalizer가 text→InvoiceLine 변환을 제대로 못하면 scanned PDF가 실질적으로 처리되지 못한다.

#### 4. 성급히 기각된 대안

**WARN — 1개 발견:**

- **Azure Form Recognizer / AWS Textract:** Google Vision만 고려함. UAE/AUH 리전 latency, GCC data residency 요구사항 관점에서 Azure가 더 적합할 수 있음.
- **pdfplumber + Tesseract OCR (offline):** GCP 종속성 없는 대안이 언급되지 않음. P2/NDA 문서의 외부 전송 우려 시 offline OCR이 더 안전.

#### 5. 경쟁 위험

**PASS.** 내부 오퍼레이션 도구로, 외부 경쟁 압력 없음.

#### 6. 범위 보정

**PASS — 적절.** §16 Implementation Work Items의 P0 10개 + P1 6개 분류가 합리적. 단 P0-6("MarkItDown MCP service/tool 추가")는 별도 서비스에 가까워 P0보다 P1이 적절할 수 있음.

### Consensus Table (Claude 단독)

| 차원 | 평가 | 근거 |
|------|------|------|
| 문제 적합성 | ✅ PASS | 실제 scanned PDF 처리 필요 |
| 전제 명시성 | ⚠️ AMBER | GCS migration 전제, Vision 비용, MarkItDown 서비스 분리 3건 미명시 |
| 후회 시나리오 | ⚠️ WARN | GCS 전환 지연 / Vision→Normalizer 변환 품질 |
| 대안 검토 | ⚠️ WARN | Azure/offline OCR 미고려 |
| 경쟁 위험 | ✅ PASS | 내부 도구 |
| 범위 적절성 | ✅ PASS | P0/P1 분류 타당 |

### CEO 권고: **APPROVE WITH CONCERNS**

---

## DESIGN REVIEW — UI 관점

### 조건 충족 여부: YES

설계서는 upload UI(§9.1), web app workflow(§9.1), 13-sheet workbook manifest(§9.11) 등 UI/UX 관련 컴포넌트를 포함한다.

### 6차원 점수

| 차원 | 점수 | 10점이 되려면 |
|------|------|---------------|
| **Clarity** | 7/10 | Job 상태 12→20개로 증가. OCR_QUEUED/RUNNING/DONE/MARKDOWN_CONVERTING 등이 사용자에게 어떻게 표시되는지 UI wireframe 또는 상태별 화면 설계 추가 필요 |
| **Hierarchy** | 8/10 | Extraction routing table(§8.1)은 잘 정리됨. feature flag toggle UI 설계 보강 필요 |
| **Consistency** | 8/10 | 기존 6-step pipeline에 OCR/Markdown 단계가 자연스럽게 삽입됨. 기존 workbook contract 유지 |
| **Feedback** | 6/10 | Vision async operation(§9.4)의 polling/callback이 사용자에게 어떻게 보이는지 불명확. "OCR 진행 중입니다 (예상 30초)" 등의 진행률 표시 설계 필요 |
| **Error handling** | 8/10 | §11 Failure Handling 표가 체계적. 단 Vision API 실패 시 사용자에게 어떤 메시지가 표시되는지 미정의 |
| **Accessibility** | 5/10 | 언급 없음 |

### Design 권고: **CONDITIONAL PASS (6.9/10)**

---

## ENGINEERING REVIEW

### 아키텍처 평가

**강점:**
- 서비스 책임 분리(§3)가 명확: Web→GCS→Parser→Vision→MarkItDown→Audit MCP
- Extraction routing decision table(§8.1)이 결정적(deterministic)
- Hash 정책(§4.3)이 source/vision/markdown/normalized/workbook 5단계로 분리

**이슈:**

| # | 심각도 | 항목 | 설명 |
|---|--------|------|------|
| E1 | HIGH | Vision→Normalizer 변환 불완전 | §21.6에서 Vision JSON→EvidenceCandidate 매핑은 정의되었으나 **Vision text→NormalizedInvoice 변환 규칙이 없다.** scanned PDF에서 invoice_no, vendor, line items, total을 추출하는 정규식/LLM 기반 rule이 누락됨 |
| E2 | HIGH | GCS→Blob 이중화 관리 | §21.1에서 "Vercel Blob을 기본값으로 유지" + GCS 병행으로 결정했으나, source_files의 blob_ref/gcs_uri 이중 컬럼 유지, parser client가 양쪽 경로 모두 지원하는 fallback 로직 누락 |
| E3 | MED | Vision async polling 누락 | §9.4에서 "Parser가 operation DONE을 poll 또는 callback 처리"라고만 기술. polling interval, max wait, timeout, 재시도 정책이 없음. Cloud Run의 60분 max timeout 내에서 Vision async (수 분 소요)를 어떻게 처리할지 미정의 |
| E4 | MED | rate_cards/shipments/contracts 테이블 CREATE 없음 | §9.8에서 14개 MCP tool full orchestration을 목표로 하나, tools 6/9/10이 의존하는 rate_cards/shipments/contracts 테이블은 migration 파일이 없다 (기존 보고서 §11의 이슈 #3). 14-tool 전환 전 이 테이블이 필요 |
| E5 | LOW | Numeric integrity schema 불일치 | §16 P0-1에 명시됨 |

### 엣지 케이스

| 케이스 | 처리 | 상태 |
|--------|------|------|
| Multi-page PDF에서 page마다 다른 quality | §9.4 Vision output 분할 저장 | ✅ 정의됨 |
| Vision + pdfplumber 결과 충돌 | §21.6 conflict rule | ✅ 정의됨 |
| Upload 중 GCS 서명 URL 만료 | 미정의 | ⚠️ UPLOAD_URL_ISSUED→UPLOADED 전환 실패 시 retry 필요 |
| Preflight 시 GCS object missing | 미정의 | ⚠️ race condition (upload confirm 전 preflight 호출) |
| Partial file upload (GCS multipart 중단) | 미정의 | ⚠️ sha256 mismatch로 잡을 수 있으나 early detection 없음 |
| Vision 비동기 operation timeout (10분+) | 미정의 | ⚠️ Cloud Run 60분 제한은 OK이나 사용자 UX 정의 필요 |
| Multiple Vision operations 동시 실행 | batchSize=1 | ✅ 명시됨, 단 동시성 제어는 미정의 |

### 성능

| 지표 | 설계서 값 | 평가 |
|------|-----------|------|
| Parser concurrency | 1 | OOM 방지 타당, 단 throughput 제한. 다중 job 시 queuing 전략 필요 |
| Vision batch size | 1 | 타당하나 $14 성능/비용 정책에 batchSize=1~5로 range |
| Parser Memory | 4Gi | 10MB PDF 기준 적절. 40-page scanned PDF(각 page별 fullTextAnnotation) 시 memory 프로파일링 필요 |
| Parallelism | 없음 | pdfplumber + MarkItDown 병행(§9.3)만 제안. Vision async 중 다른 job 처리 가능한지 미정의 |

### 보안

| 항목 | 평가 | 코멘트 |
|------|------|--------|
| SSRF (blob URL) | ✅ | 기존 orchestrator에 _is_safe_blob_url 이미 구현 (PR #16) |
| GCS access | ✅ | §12.2 service account 권한 최소화 설계 |
| MarkItDown isolation | ✅ | §12.3: GCS-only, no local paths, timeout/max-size 제한 |
| P2/NDA logs | ✅ | §12.4: 금지 항목 명시 |
| Vision API data | ⚠️ | Google Vision으로 전송되는 PDF content가 P2에 해당하는지 검토 필요 (UAE data residency). §12.2에서 내용은 있고 policy 판정은 없음 |
| MCP auth | ⚠️ | §13.1에 MCP_SHARED_SECRET env 정의되었으나 §7.3 MarkItDown MCP tools 호출 시 auth header 미명시 |
| HMAC callback | ✅ | §9.6 callback HMAC 유지 |

### Engineering 권고: **REVISE NEEDED** (E1/E2가 HIGH)

---

## DX REVIEW — API/CLI 관점

### 조건 충족 여부: YES

설계서는 §7에서 Web API 3종, Parser API 5종, MarkItDown MCP 3종 총 **11개 신규 API**를 정의. §15.2에 curl smoke 명령 포함.

### 평가

| 차원 | 평가 | 근거 |
|------|------|------|
| **개발자 페르소나** | PASS | BE engineer가 Cloud Run에 Parser를 배포하고 Vision API를 연동하는 흐름이 명확 |
| **경쟁 벤치마크** | PASS | 내부 도구로 경쟁 도구 불필요 |
| **매직 모먼트** | AMBER | "scanned PDF를 업로드했는데 OCR이 자동으로 돌고 결과가 나온다"는 순간이 설계되어 있으나, `VISION_ENABLED=false` 기본값(§21.3)으로 인해 첫 경험에서 이 순간을 보려면 flag를 켜야 함 |
| **온보딩 시간** | AMBER | GCS bucket 7개 생성 + Service Account IAM + Cloud Run 배포 + Vision API 활성화 + MarkItDown MCP 분리 서비스 구축 — 최소 반나절. `gcloud` one-liner 또는 Terraform 모듈이 설계서에 없음 |
| **에러 메시지** | PASS | VISION_DISABLED~VISION_LOW_CONFIDENCE 6개 오류 코드(§21.4) 정의 |
| **문서 완성도** | PASS | curl smoke 4개(§15.2), validation plan 12 cases(§15.1), P0/P1 work items(§16) |

### 주요 Gap:

1. **No OpenAPI spec:** 11개 신규 endpoint에 대한 OpenAPI/Swagger 정의가 없음. FastAPI 자동 생성으로 보완 가능하나, request/response 예시는 smoke curl뿐
2. **Local dev experience:** §13.1 env var 20여 개, GCS bucket, Vision API, MarkItDown MCP — local에서 docker-compose나 emulator 없이 어떻게 개발하는지 미정의
3. **MarkItDown MCP tool contract:** 3개 tool의 request/response JSON schema만 있고, 실제 MarkItDown MCP server codebase 구조(새 repo? monorepo 내 신규 package?) 미정의

### DX 권고: **PASS WITH NOTES**

---

## FINAL APPROVAL GATE

### 종합

| Review | 평가 | 상태 |
|--------|------|------|
| CEO | APPROVE WITH CONCERNS | GCS migration 전제, Vision 비용, MarkItDown 분리 비용 미추정 |
| Design | CONDITIONAL PASS | 6.9/10 — 진행률 UX와 접근성 보강 필요 |
| Engineering | REVISE NEEDED | E1(Vision→Normalizer 변환 규칙 없음), E2(GCS/Blob 이중화 fallback 누락) |
| DX | PASS WITH NOTES | Local dev setup, OpenAPI spec 미비 |

### 결정: **D — REVISE**

### 수정 필요 항목 (Revision Mandate)

설계서 자체 수정이 필요하다. 아래 5개 항목을 §21(현재 repo 기준 누락 보강)에 추가하라:

1. **§21.8 Vision→NormalizedInvoice 변환 규칙** (E1)  
   - scanned PDF에서 invoice_no/vendor/issue_date/total/line_items를 추출하는 정규식 + heuristic rule 정의  
   - Vision fullTextAnnotation → InvoiceHeaderSchema 매핑 표  
   - 정규화 실패 시 fallback: AMBER + HGT_08 action item

2. **§21.9 GCS/Blob 이중화 fallback 로직** (E2)  
   - source_files.gcs_uri nullable 허용  
   - Parser client: gcs_uri 우선, 없으면 blob_url fallback  
   - Vision start: gcs_uri 필수 → 없으면 422 VISION_GCS_URI_REQUIRED

3. **§21.10 Vision async polling 정책**  
   - polling interval: 5초 / max wait: 10분 / timeout: 12분  
   - Cloud Run job이 polling 도중 종료되지 않도록 keep-alive heartbeat  
   - operation 완료 콜백을 webhook으로 받는 대안 검토

4. **§21.11 비용 추산**  
   - Vision API: 월 예상 호출 건수 × 페이지당 비용 × batchSize  
   - GCS: bucket 7개 storage + egress 비용  
   - Cloud Run: Parser/MarkItDown MCP CPU+Memory 비용

5. **§21.12 MarkItDown MCP 서비스화 결정**  
   - 현재 monorepo 내 `packages/` 또는 신규 repo?  
   - 기존 `apps/worker-py/app/notebooklm/mcp_client.py` 재사용 vs 신규 FastAPI/Hono service  
   - P0 vs P1 재분류

### 수정 후 Gate

수정 완료 시 다음 검증:
- `curl` smoke 4개 재실행하여 API contract 확인
- `pnpm --dir apps/web test` 및 `python -m pytest apps/worker-py/tests` 통과
- P2 로그 검증: raw OCR text 미노출
- feature flag OFF 시 기존 E2E 전체 통과

---

**AUTOPILOT 리뷰 종료.**
