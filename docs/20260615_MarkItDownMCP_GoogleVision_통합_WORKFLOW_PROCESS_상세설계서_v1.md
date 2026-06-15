# SCT HVDC Invoice Audit Platform — MarkItDown MCP + Google Vision 통합 WORKFLOW/PROCESS 상세 설계서 v1

**작성일:** 2026-06-15  
**대상:** `macho715/invoice_sct` / SCT_ONTOLOGY-main  
**범위:** PDF 업로드 → GCS 저장 → Google Vision OCR → MarkItDown MCP Markdown 변환 → Parser normalization → MCP 감사 검증 → Gate → Human Approval → 13-Sheet Export  
**문서 상태:** 설계 확정 전 REVIEW 문서  
**용어 정정:** 사용자 입력의 `MARKOTDOWN`은 `MarkItDown`으로 정규화한다.

---

## 0. Executive Summary

### 0.1 판정

**조건부 PASS.** 기존 인보이스 감사 플랫폼에 **Google Vision OCR**과 **MarkItDown MCP**를 삽입하는 설계는 타당하다. 단, 두 도구의 역할을 혼동하면 안 된다.

| 구성 | 역할 | 최종 판정 |
|---|---|---|
| Google Vision | PDF/TIFF/image OCR text 추출 | **Primary OCR** |
| MarkItDown MCP | 원본 파일 또는 OCR 결과를 Markdown화하여 구조 보존·LLM/비교용 text 생성 | **Markdown Conversion / Second Extraction Support** |
| pdfplumber | text-based PDF의 결정적 1차 parser | **Primary text-PDF parser 유지** |
| NotebookLM | MarkItDown 결과 기반 second opinion / dual-extraction | **Optional / P2 승인 필요** |
| MCP Audit Tools | rate/evidence/HS/cost/duplicate/contract/shipment 검증 | **Audit SSOT** |

### 0.2 핵심 설계 결정

```text
D1. PDF 업로드 UI는 Vercel 앱 또는 Cloud Run Web에서 제공한다.
D2. PDF 원본은 Vercel 서버에 오래 보관하지 않고 GCS에 직접 저장한다.
D3. Google Vision은 scanned/image PDF 또는 low-confidence PDF에 우선 적용한다.
D4. text PDF는 pdfplumber를 1차 source of truth로 유지한다.
D5. MarkItDown MCP는 모든 PDF를 Markdown artifact로 변환하되, 감사 verdict는 Parser+MCP 결과를 기준으로 한다.
D6. NotebookLM은 기본 OFF. P2/NDA 승인 후 조건부 ON.
D7. 모든 추출 결과는 Extraction Evidence Graph로 합쳐서 NormalizedInvoice/EvidenceCandidate로 변환한다.
```

### 0.3 최종 To-Be 흐름

```text
[사용자 업로드]
  → [Vercel/Cloud Run Web: job 생성 + GCS signed upload URL]
  → [GCS: source/evidence 저장]
  → [Cloud Run Parser: preflight]
      ├─ xlsx/md/txt → deterministic parser
      ├─ text PDF → pdfplumber + MarkItDown MCP 병행
      └─ scanned/low-confidence PDF → Google Vision OCR → OCR JSON → Markdown adapter
  → [Extraction Merge]
      ├─ pdfplumber spans
      ├─ Vision fullTextAnnotation
      ├─ MarkItDown markdown
      └─ optional NotebookLM summary
  → [NormalizedInvoice + EvidenceCandidate]
  → [MCP Audit Tools 14개]
  → [Gate Bridge PASS/AMBER/ZERO/FAILED]
  → [Human Gate]
  → [13-Sheet Export + GCS signed URL]
```

---

## 1. 기존 문서 확인 결과

### 1.1 기존 전체 프로세스 보고서 요약

기존 플랫폼은 Web, Worker, MCP Server의 3-app 구조다.

| 계층 | 기존 기술 | 기존 배포 | 역할 |
|---|---|---|---|
| Web | Next.js 15 | Vercel | 업로드, 감사 오케스트레이션, 승인 게이트, workbook build |
| Worker | FastAPI Python | Fly.io | 파일 파싱, NotebookLM 추출, xlsx export |
| MCP Server | Hono TypeScript | Fly.io | 14개 검증 도구 |

기존 E2E는 다음 6단계다.

```text
UPLOAD → PARSE → VALIDATE → GATE → APPROVE → EXPORT
```

기존 parser는 xlsx/md/txt/pdf를 지원하나, 실제 감사 run 경로에서 PDF는 주로 evidence로 취급되고 PDF-only invoice 경로는 불명확하다.

### 1.2 MarkItDown 연결 Plan 확인 결과

MarkItDown → NotebookLM 연결 문서는 다음을 명시한다.

| 구성요소 | 상태 |
|---|---|
| MarkItDown 변환 + NotebookLM orchestrator | 구현됨 |
| `POST /v1/notebooklm/run` | 구현됨 |
| `POST /api/notebooklm/ingest-summary` 콜백 수신 | 구현됨 |
| dual-extraction 비교 adapter | 구현됨 |
| 메인 run pipeline trigger | 누락 |

즉, **인프라는 있으나 시작 트리거가 빠져 있다.**

### 1.3 이번 문서의 변경점

이번 설계서는 기존 NotebookLM 중심 병행 추출 구조에 **Google Vision OCR**을 추가하고, MarkItDown MCP를 단순 NotebookLM 선행 단계가 아니라 **전사 Markdown conversion layer**로 승격한다.

---

## 2. Target Architecture

## 2.1 권장 배치

### A안 — 즉시 적용형: Vercel UI + Google Cloud Backend

```text
[Vercel Next.js Web]
  - upload UI
  - job 생성
  - GCS signed upload URL 발급
  - audit orchestration
      │
      ▼
[Google Cloud Storage]
  - source PDF/xlsx/md/txt
  - evidence PDF
  - Vision OCR JSON
  - MarkItDown Markdown
  - export xlsx
      │
      ▼
[Cloud Run Parser: FastAPI]
  - preflight
  - pdfplumber
  - Vision OCR orchestration
  - NormalizedInvoice 생성
  - xlsx export
      │
      ▼
[Cloud Run MarkItDown MCP]
  - convert_to_markdown
  - convert_gcs_to_markdown
  - vision_json_to_markdown
  - extract_markdown_refs
      │
      ▼
[Cloud Run MCP Audit Server]
  - 14개 검증 도구
      │
      ▼
[Cloud SQL PostgreSQL]
  - jobs/source_files/audit_traces/results
```

### B안 — 최종 통합형: 전체 Google Cloud

```text
[Cloud Run Web]
  → [Cloud Storage]
  → [Cloud Run Parser]
  → [Cloud Run MarkItDown MCP]
  → [Cloud Vision API]
  → [Cloud Run MCP Audit Server]
  → [Cloud SQL PostgreSQL]
  → [Cloud Storage Export]
```

### 권장

```text
단기: A안
중기: B안
```

단기에는 Vercel UI를 유지하고, PDF 저장·OCR·파싱·export만 Google Cloud로 이동한다. 이후 Web까지 Cloud Run으로 이전한다.

---

## 3. 서비스별 책임 분리

| Service | 책임 | 금지 |
|---|---|---|
| Web App | UI, job, upload URL, orchestration, gate, approval | PDF heavy parsing 금지 |
| GCS | 원본/증빙/OCR/Markdown/export object 저장 | public bucket 금지 |
| Parser | preflight, pdfplumber, Vision orchestration, normalization, export | 외부 LLM 직접 의존 금지 |
| Google Vision | OCR text extraction | invoice 구조화 기대 금지 |
| MarkItDown MCP | Markdown conversion, markdown evidence extraction | 감사 verdict 직접 결정 금지 |
| NotebookLM | optional second opinion | P2 승인 없이 자동 실행 금지 |
| Audit MCP | rate/evidence/cost/HS/duplicate/contract 검증 | 파일 원본 보관 금지 |
| Cloud SQL | job/audit/result SSOT | P2 raw document body 저장 금지 |

---

## 4. Storage 설계

## 4.1 Bucket

| Bucket | 용도 | 접근 |
|---|---|---|
| `hvdc-invoice-source-prod` | invoice 원본 | signed URL only |
| `hvdc-invoice-evidence-prod` | evidence 원본 | signed URL only |
| `hvdc-invoice-ocr-prod` | Vision OCR JSON | service account only |
| `hvdc-invoice-markdown-prod` | MarkItDown output | service account only |
| `hvdc-invoice-normalized-prod` | normalized JSON sidecar | service account only |
| `hvdc-invoice-export-prod` | 13-sheet xlsx | signed URL only |
| `hvdc-invoice-temp-prod` | 임시 변환물 | lifecycle 7~30일 |

## 4.2 Object path

```text
source/{job_id}/{file_id}/{sha256}.{ext}
evidence/{job_id}/{file_id}/{sha256}.{ext}

ocr/{job_id}/{file_id}/vision/request.json
ocr/{job_id}/{file_id}/vision/operation.json
ocr/{job_id}/{file_id}/vision/output-{page_from}-to-{page_to}.json

markdown/{job_id}/{file_id}/markitdown.md
markdown/{job_id}/{file_id}/vision_ocr.md
markdown/{job_id}/{file_id}/merged.md

normalized/{job_id}/normalized_invoice.json
normalized/{job_id}/extraction_graph.json
normalized/{job_id}/comparison_report.json

export/{job_id}/audit-pack-{sha256}.xlsx
```

## 4.3 Hash 정책

| Artifact | Hash |
|---|---|
| source PDF/xlsx | `source_sha256` |
| Vision OCR JSON | `vision_json_sha256` |
| MarkItDown markdown | `markdown_sha256` |
| NormalizedInvoice | `normalized_sha256` |
| Workbook | `workbook_sha256` |

중요: MarkItDown 변환본의 hash는 원본 source hash와 다르다. 콜백 검증에는 **원본 source_sha256**과 **변환 artifact hash**를 분리해서 써야 한다.

---

## 5. 데이터 모델

## 5.1 `source_files`

| column | type | 설명 |
|---|---|---|
| `file_id` | text PK | 파일 ID |
| `job_id` | text FK | job |
| `file_role` | enum | `INVOICE`, `EVIDENCE`, `UNKNOWN` |
| `file_type` | enum | `xlsx`, `md`, `txt`, `pdf`, `image` |
| `mime_type` | text | MIME |
| `size_bytes` | bigint | 크기 |
| `sha256` | text | 원본 hash |
| `gcs_uri` | text | `gs://...` |
| `parser_status` | enum | `PENDING/PARSED/FAILED/SKIPPED` |
| `uploaded_by` | text | actor |
| `uploaded_at` | timestamptz | 업로드 시간 |

## 5.2 신규 `extraction_artifacts`

| column | type | 설명 |
|---|---|---|
| `artifact_id` | text PK | artifact ID |
| `job_id` | text FK | job |
| `file_id` | text FK | source file |
| `artifact_type` | enum | `PDFPLUMBER_JSON`, `VISION_JSON`, `MARKDOWN`, `VISION_MARKDOWN`, `NOTEBOOKLM_SUMMARY`, `NORMALIZED_JSON` |
| `engine` | text | `pdfplumber`, `google_vision`, `markitdown_mcp`, `notebooklm`, `parser` |
| `gcs_uri` | text | artifact 위치 |
| `sha256` | text | artifact hash |
| `confidence` | numeric | 0~1 |
| `created_at` | timestamptz | 생성 시각 |

## 5.3 신규 `extraction_comparisons`

| column | type | 설명 |
|---|---|---|
| `comparison_id` | text PK | 비교 ID |
| `job_id` | text FK | job |
| `field_name` | text | invoice_no/vendor/total/line_count 등 |
| `primary_engine` | text | 기준 engine |
| `secondary_engine` | text | 비교 engine |
| `primary_value_hash` | text | 기준 값 hash |
| `secondary_value_hash` | text | 비교 값 hash |
| `match_status` | enum | `MATCH/MISMATCH/MISSING/LOW_CONFIDENCE` |
| `severity` | enum | `PASS/AMBER/ZERO` |
| `reason_code` | text | mismatch reason |

---

## 6. Job 상태 머신

## 6.1 확장 상태

기존 12개 상태에 OCR/Markdown 상태를 추가한다.

```text
CREATED
  → UPLOAD_URL_ISSUED
  → UPLOADED
  → PREFLIGHTING
  → EXTRACTING
      ├─ OCR_QUEUED
      ├─ OCR_RUNNING
      ├─ OCR_DONE
      ├─ MARKDOWN_CONVERTING
      └─ NORMALIZING
  → VALIDATING
  → REVIEW_REQUIRED
      ├─ APPROVED
      │    └─ EXPORTING
      │         └─ COMPLETED
      └─ REJECTED

실패:
PREFLIGHTING / EXTRACTING / OCR_RUNNING / MARKDOWN_CONVERTING / VALIDATING / EXPORTING
  → FAILED
```

## 6.2 상태 전환 기준

| From | To | 조건 |
|---|---|---|
| CREATED | UPLOAD_URL_ISSUED | signed upload URL 발급 |
| UPLOAD_URL_ISSUED | UPLOADED | file confirm |
| UPLOADED | PREFLIGHTING | audit run 시작 |
| PREFLIGHTING | EXTRACTING | MIME/size/hash 검증 통과 |
| EXTRACTING | OCR_QUEUED | scanned/low text density PDF |
| OCR_QUEUED | OCR_RUNNING | Vision operation 생성 |
| OCR_RUNNING | OCR_DONE | Vision operation DONE |
| EXTRACTING | MARKDOWN_CONVERTING | MarkItDown MCP 호출 |
| MARKDOWN_CONVERTING | NORMALIZING | Markdown artifact 생성 |
| NORMALIZING | VALIDATING | NormalizedInvoice 생성 |
| VALIDATING | REVIEW_REQUIRED | gate 결과 생성 |
| REVIEW_REQUIRED | APPROVED | Human Gate 승인 |
| APPROVED | EXPORTING | export 요청 |
| EXPORTING | COMPLETED | workbook 저장 |

---

## 7. API 설계

## 7.1 Web API

### `POST /api/files/create-upload-url`

**목적:** GCS signed upload URL 발급

```json
{
  "filename": "invoice.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 3000000,
  "file_role": "INVOICE"
}
```

**응답**

```json
{
  "job_id": "job_xxx",
  "file_id": "file_xxx",
  "gcs_uri": "gs://hvdc-invoice-source-prod/source/job_xxx/file_xxx/hash.pdf",
  "signed_upload_url": "https://storage.googleapis.com/...",
  "expires_at": "2026-06-15T10:15:00Z"
}
```

### `POST /api/files/confirm`

```json
{
  "job_id": "job_xxx",
  "file_id": "file_xxx",
  "sha256": "abc...",
  "size_bytes": 3000000,
  "gcs_uri": "gs://..."
}
```

### `POST /api/invoice-audit/run`

```json
{
  "job_id": "job_xxx",
  "options": {
    "vision_enabled": true,
    "markitdown_enabled": true,
    "notebooklm_enabled": false,
    "vision_policy": "AUTO",
    "markdown_policy": "ALWAYS_FOR_PDF"
  }
}
```

---

## 7.2 Parser API

### `POST /v1/preflight`

**목적:** 파일 유형/암호화/텍스트 밀도/스캔 여부/페이지 수 판정

```json
{
  "job_id": "job_xxx",
  "file_id": "file_xxx",
  "gcs_uri": "gs://...",
  "file_type": "pdf",
  "file_role": "INVOICE"
}
```

**응답**

```json
{
  "job_id": "job_xxx",
  "file_id": "file_xxx",
  "preflight": {
    "is_pdf": true,
    "is_encrypted": false,
    "is_text_based": false,
    "page_count": 6,
    "text_density": 0.12,
    "requires_vision": true,
    "requires_markitdown": true,
    "parser_confidence": 0.25
  }
}
```

### `POST /v1/parse`

**목적:** deterministic parse

```json
{
  "job_id": "job_xxx",
  "file_id": "file_xxx",
  "gcs_uri": "gs://...",
  "file_type": "pdf",
  "file_role": "INVOICE",
  "artifacts": {
    "vision_json_uri": "gs://...",
    "markitdown_md_uri": "gs://..."
  }
}
```

### `POST /v1/vision/start`

**목적:** Google Vision asyncBatchAnnotateFiles operation 시작

```json
{
  "job_id": "job_xxx",
  "file_id": "file_xxx",
  "source_gcs_uri": "gs://hvdc-invoice-source-prod/source/job/file/hash.pdf",
  "output_gcs_prefix": "gs://hvdc-invoice-ocr-prod/ocr/job/file/vision/",
  "feature_type": "DOCUMENT_TEXT_DETECTION"
}
```

**응답**

```json
{
  "operation_name": "projects/PROJECT/operations/xxx",
  "state": "RUNNING"
}
```

### `POST /v1/vision/collect`

**목적:** Vision operation 완료 확인 및 OCR JSON 수집

```json
{
  "job_id": "job_xxx",
  "file_id": "file_xxx",
  "operation_name": "projects/PROJECT/operations/xxx"
}
```

### `POST /v1/export`

기존 export contract 유지. 단 source_data/audit_detail에 OCR/Markdown artifact ref를 추가한다.

---

## 7.3 MarkItDown MCP Tools

MarkItDown MCP는 Cloud Run service로 분리하거나 Parser 내부 MCP client로 호출한다.

### Tool 1 — `convert_gcs_to_markdown`

```json
{
  "tool": "convert_gcs_to_markdown",
  "input": {
    "job_id": "job_xxx",
    "file_id": "file_xxx",
    "source_gcs_uri": "gs://...",
    "output_gcs_uri": "gs://hvdc-invoice-markdown-prod/markdown/job/file/markitdown.md",
    "file_type": "pdf",
    "mode": "convert_stream"
  }
}
```

### Tool 2 — `vision_json_to_markdown`

Vision OCR JSON은 MarkItDown의 표준 원본 파일 변환 대상이 아니므로, 같은 MCP server에 adapter tool을 추가한다.

```json
{
  "tool": "vision_json_to_markdown",
  "input": {
    "job_id": "job_xxx",
    "file_id": "file_xxx",
    "vision_json_prefix": "gs://hvdc-invoice-ocr-prod/ocr/job/file/vision/",
    "output_gcs_uri": "gs://hvdc-invoice-markdown-prod/markdown/job/file/vision_ocr.md"
  }
}
```

### Tool 3 — `extract_markdown_refs`

```json
{
  "tool": "extract_markdown_refs",
  "input": {
    "job_id": "job_xxx",
    "file_id": "file_xxx",
    "markdown_gcs_uri": "gs://..."
  }
}
```

**출력**

```json
{
  "evidence_candidates": [
    {
      "source_file_id": "file_xxx",
      "source_engine": "markitdown_mcp",
      "matched_reference": "BL-XXXX",
      "doc_kind": "BL",
      "confidence": 0.80,
      "text_span_hash": "sha256:..."
    }
  ]
}
```

---

## 8. Extraction Routing

## 8.1 Router Decision Table

| 입력 | preflight 결과 | Primary | Secondary | Vision | MarkItDown |
|---|---|---|---|---|---|
| xlsx | structured | openpyxl | MarkItDown optional | No | Optional |
| md/txt | text | regex parser | - | No | No |
| text PDF invoice | text_density high | pdfplumber | MarkItDown | No unless low confidence | Yes |
| scanned PDF invoice | text_density low | Vision OCR → normalizer | MarkItDown adapter | Yes | Vision markdown |
| PDF evidence | evidence-only | pdfplumber evidence refs | MarkItDown refs | Auto if scanned | Yes |
| DSV waybill | DSV pattern | dsv_waybill parser | MarkItDown | Auto if scanned | Yes |
| encrypted PDF | encrypted | none | none | No | No |
| image | image | Vision OCR | markdown adapter | Yes | Vision markdown |

## 8.2 Policy

```text
vision_policy:
  OFF        = Vision 사용 금지
  AUTO       = scanned/low confidence에만 사용
  ALWAYS_PDF = 모든 PDF에 Vision OCR 수행
  FORCE      = parser 실패 여부와 관계없이 Vision 수행

markitdown_policy:
  OFF             = MarkItDown 사용 금지
  PDF_ONLY         = PDF만 markdown 생성
  ALWAYS_FOR_PDF   = 모든 PDF에서 markdown 생성
  ALL_SUPPORTED    = xlsx/docx/pptx/pdf/html 등 지원 파일 모두 markdown 생성

notebooklm_policy:
  OFF
  LOW_CONFIDENCE_ONLY
  MANUAL_APPROVAL_ONLY
```

**운영 기본값**

```json
{
  "vision_policy": "AUTO",
  "markitdown_policy": "ALWAYS_FOR_PDF",
  "notebooklm_policy": "OFF"
}
```

---

## 9. 상세 Workflow

## 9.1 Step 1 — Upload

### 목적

PDF/xlsx/md/txt/evidence 파일을 사용자가 Web App에서 업로드한다.

### 처리

1. 사용자가 Vercel 또는 Cloud Run Web UI에서 파일 선택.
2. Web App이 `job_id`, `file_id` 생성.
3. Web App이 GCS signed upload URL 발급.
4. 브라우저가 PDF를 GCS로 직접 PUT.
5. 업로드 완료 후 Web App이 `sha256`, `size_bytes`, `gcs_uri`를 confirm.
6. Cloud SQL `jobs`, `source_files`, `audit_traces` 저장.

### 산출물

| 산출물 | 위치 |
|---|---|
| source PDF | GCS source/evidence bucket |
| source file metadata | Cloud SQL `source_files` |
| upload trace | Cloud SQL `audit_traces` |

---

## 9.2 Step 2 — Preflight

### 목적

파일이 text PDF인지 scanned PDF인지, invoice인지 evidence인지, Vision/MarkItDown 필요 여부를 판정한다.

### 처리

1. Parser가 GCS source file을 읽는다.
2. MIME/extension 확인.
3. PDF면 다음 검사:
   - encrypted 여부
   - page_count
   - first N pages text density
   - DSV waybill pattern
   - invoice pattern
   - evidence pattern
4. `requires_vision`, `requires_markitdown` 결정.
5. `PREFLIGHT` trace 저장.

### Verdict 영향

| 조건 | 처리 |
|---|---|
| encrypted PDF | REVIEW_REQUIRED / HGT_08 |
| PDF_TOO_LARGE | FAILED 또는 AMBER manual review |
| text_density low | OCR_REQUIRED |
| file_role unknown | AMBER |

---

## 9.3 Step 3A — Text PDF Primary Parse

### 조건

```text
file_type = pdf
is_text_based = true
text_density >= threshold
```

### 처리

1. `pdfplumber`로 text spans, tables, evidence candidates 추출.
2. DSV waybill pattern이면 waybill fields/lane/timeline 추출.
3. SHPT shipment doc mapping으로 BOE/DO/DN/CarrierInvoice/DAS 후보 추출.
4. `PDFPLUMBER_JSON` artifact 저장.
5. MarkItDown MCP를 병행 호출하여 Markdown artifact 생성.
6. Vision은 기본 생략. 단 confidence가 낮으면 Vision fallback.

### 산출물

| 산출물 | 설명 |
|---|---|
| text_spans | page별 text |
| table_candidates | table 후보 |
| evidence_candidates | BL/DO/INV/PO/HVDC refs |
| markitdown.md | Markdown representation |
| extraction_graph.json | engine별 evidence graph |

---

## 9.4 Step 3B — Scanned PDF / Image PDF OCR

### 조건

```text
is_text_based = false
text_density < threshold
또는 pdfplumber confidence < 0.50
```

### 처리

1. Parser가 `/v1/vision/start` 실행.
2. Vision API `files:asyncBatchAnnotate` 호출.
3. Vision output JSON은 GCS OCR bucket에 저장.
4. Parser가 operation DONE을 poll 또는 callback 처리.
5. Vision JSON을 읽어 `fullTextAnnotation` 기반 text/page/block/paragraph/word를 추출.
6. `vision_json_to_markdown` tool로 OCR Markdown 생성.
7. OCR text에서 invoice/evidence refs 추출.
8. NormalizedInvoice 후보 생성.

### Google Vision 출력 사용 방식

| Vision field | 사용 |
|---|---|
| `fullTextAnnotation.text` | 전체 OCR text |
| `pages[].blocks[]` | layout block |
| `paragraphs[]` | section segmentation |
| `words[]` | confidence 및 위치 |
| `context.pageNumber` | page reference |
| `normalizedVertices` | bbox evidence |

### 산출물

| 산출물 | 위치 |
|---|---|
| Vision request | `ocr/{job_id}/{file_id}/vision/request.json` |
| Vision operation | `ocr/{job_id}/{file_id}/vision/operation.json` |
| Vision output JSON | `ocr/{job_id}/{file_id}/vision/output-x-to-y.json` |
| OCR markdown | `markdown/{job_id}/{file_id}/vision_ocr.md` |
| OCR evidence | `extraction_graph.json` |

---

## 9.5 Step 3C — MarkItDown MCP Markdown Conversion

### 목적

원본 PDF/Office 문서를 Markdown으로 변환해 LLM/비교/감사 설명용 중간 representation을 만든다.

### 처리

1. Parser 또는 Web이 MarkItDown MCP에 `convert_gcs_to_markdown` 호출.
2. MarkItDown MCP는 GCS object를 stream으로 읽는다.
3. `convert_stream()` 또는 format-specific converter 사용.
4. 결과 markdown을 GCS markdown bucket에 저장.
5. `extract_markdown_refs`로 BL/DO/BOE/PO/INV/amount 후보 추출.
6. Markdown hash와 source hash를 audit trace에 기록.

### 보안

MarkItDown은 현재 process 권한으로 파일/네트워크 I/O를 수행할 수 있으므로, 다음 제한이 필요하다.

```text
- source는 GCS signed/internal URI만 허용
- file path 직접 입력 금지
- http/https 외부 URL 변환 금지
- metadata server, private IP, loopback 접근 차단
- convert_* 함수는 목적별 최소 함수 사용
- max file size / max pages / timeout 적용
```

---

## 9.6 Step 3D — Optional NotebookLM Second Opinion

### 기본값

```text
OFF
```

### 켜는 조건

| 조건 | 허용 여부 |
|---|---|
| P2/NDA 문서 | 기본 금지 |
| redacted/synthetic sample | 가능 |
| 사용자가 승인 | 조건부 가능 |
| low confidence invoice | AMBER+승인 후 가능 |

### 처리

1. MarkItDown output markdown 생성.
2. NotebookLM add_source.
3. EXTRACTION_PROMPT 질의.
4. callback `/api/notebooklm/ingest-summary`.
5. Parser result와 NotebookLM result 비교.
6. high-impact mismatch 발생 시 AMBER flag.

### 중요

NotebookLM 결과는 **결정 엔진이 아니다.**  
NotebookLM은 dual-extraction 비교와 human review 보조 자료로만 사용한다.

---

## 9.7 Step 4 — Extraction Merge & Normalization

### 입력

| Source | Engine |
|---|---|
| XLSX parser output | openpyxl |
| PDF text spans | pdfplumber |
| OCR JSON | Google Vision |
| Markdown | MarkItDown MCP |
| Optional summary | NotebookLM |
| DSV waybill fields | dsv_waybill parser |

### Merge 순서

```text
1. Source hash 검증
2. Engine별 artifact load
3. 필드 후보 추출
4. confidence score 계산
5. engine priority 적용
6. field-level conflict detection
7. NormalizedInvoice 생성
8. EvidenceCandidate 생성
9. extraction_comparisons 저장
```

### Engine priority

| Field | 1순위 | 2순위 | 3순위 |
|---|---|---|---|
| invoice_no | xlsx/parser | pdfplumber | Vision/MarkItDown |
| vendor | xlsx/parser | MarkItDown | Vision |
| issue_date | xlsx/parser | pdfplumber | Vision |
| line_items | xlsx/parser | pdfplumber table | Vision OCR text |
| BL/DO/PO/BOE | pdfplumber/Vision | MarkItDown | NotebookLM |
| total | xlsx/parser | pdfplumber regex | Vision/MarkItDown |
| DSV waybill | dsv_waybill parser | Vision | MarkItDown |

### Conflict rule

| Conflict | Verdict |
|---|---|
| invoice_total mismatch > 0.01 | AMBER |
| line total vs invoice total mismatch | AMBER |
| type_b total mismatch | ZERO |
| BOE missing on CUSTOMS | ZERO |
| duplicate invoice | ZERO |
| OCR confidence low | AMBER + HGT_08 |
| source hash mismatch | FAILED 또는 ZERO 보안 이슈 |

---

## 9.8 Step 5 — MCP Validation

### 운영 목표

기존 7개 호출을 14개 운영 필수 도구로 확장한다.

### 순서

| 순서 | Tool | 입력 | 출력 |
|---:|---|---|---|
| 0 | `normalize_invoice_lines` | raw lines | standard charge code/unit |
| 1 | `route_question` | audit context | tool route |
| 2 | `classify_type_b` | line description | TYPE-B |
| 3 | `check_rate_card` / batch | charge_code/lane/rate | rate verdict |
| 4 | `check_cost_guard` | qty/rate/amount | PASS/AMBER/ZERO |
| 5 | `check_evidence_required` | charge_code/evidence | evidence gaps |
| 6 | `check_hs_uae_compliance` | customs/HS/BOE | customs verdict |
| 7 | `check_duplicate_invoice` | vendor/invoice/amount | duplicate verdict |
| 8 | `match_shipment_reference` | BL/DO/PO/job | shipment match |
| 9 | `check_contract_validity` | vendor/contract/date | contract validity |
| 10 | `check_tax_vat` | VAT fields | UAE VAT |
| 11 | `check_fx_policy` | currency/rate/date | FX verdict |
| 12 | `check_dem_det` | DEM/DET/storage | completeness |
| 13 | `build_validation_explanation` | findings | human-readable explanation |

### 산출물

| Artifact | 위치 |
|---|---|
| `validation_results` | Cloud SQL |
| `mcp_tool_calls` | Cloud SQL JSONB |
| `audit_traces` | Cloud SQL |
| `validation_explanation` | GCS sidecar 또는 DB |

---

## 9.9 Step 6 — Gate Bridge

### Verdict rank

```text
PASS < AMBER < ZERO < FAILED
```

### Gate source

| Source | Gate 영향 |
|---|---|
| CostGuard | band→verdict |
| Evidence Required | missing evidence |
| HS UAE | BOE/HS |
| Duplicate | duplicate invoice |
| Contract | expired/missing |
| Shipment | mismatch/no ref |
| Reconciliation | invoice_total vs lines vs TYPE-B |
| OCR/Markdown comparison | confidence/mismatch AMBER |

### 3-way recon

```text
invoice_total
  vs line_audit_total
  vs type_b_total
```

| 조건 | Verdict |
|---|---|
| all matched | PASS |
| invoice_total missing | AMBER |
| invoice_total vs line total mismatch | AMBER |
| line total vs TYPE-B total mismatch | ZERO |

---

## 9.10 Step 7 — Human Gate

기존 8개 trigger 유지하고 OCR/Markdown trigger를 추가한다.

| ID | 조건 | Severity | Role |
|---|---|---|---|
| HGT_01 | Invoice total ≥ 100,000 AED | ZERO | FINANCE_APPROVER |
| HGT_02 | CostGuard HIGH/CRITICAL | ZERO | COST_CONTROL_LEAD, FINANCE_APPROVER |
| HGT_03 | rate_status UNKNOWN | AMBER | COST_CONTROL_LEAD |
| HGT_04 | FX override | ZERO | FINANCE_APPROVER |
| HGT_05 | MOSB evidence missing | ZERO | MARINE_LEAD |
| HGT_06 | WH evidence missing | AMBER | WAREHOUSE_MANAGER |
| HGT_07 | Compliance evidence missing | ZERO | COMPLIANCE_LEAD |
| HGT_08 | Parser/OCR confidence < 0.95 | AMBER | DOCUMENT_CONTROLLER |
| HGT_09 | Vision OCR required but failed | AMBER/ZERO | DOCUMENT_CONTROLLER |
| HGT_10 | MarkItDown/parser high-impact mismatch | AMBER | DOCUMENT_CONTROLLER |
| HGT_11 | NotebookLM used on P2 without approval | ZERO | COMPLIANCE_LEAD |

---

## 9.11 Step 8 — Export

### 원칙

기존 13-sheet workbook contract를 유지한다. Vision/MarkItDown raw artifact는 workbook에 모두 넣지 않고, **GCS sidecar + manifest reference**로 관리한다.

### Workbook 유지

| Sheet | 변경 |
|---|---|
| `00_Decision` | `ocr_used`, `markdown_used`, `extraction_confidence` 추가 가능 |
| `01_Action_Items` | OCR/Markdown 이슈 action item 포함 |
| `04_Line_View` | source_engine/confidence 추가 가능 |
| `90_Source_Data` | Vision/MarkItDown evidence ref 포함 |
| `91_Audit_Detail` | OCR/Markdown tool latency 포함 |
| `92_Evidence_Issues` | OCR-derived evidence gap 포함 |
| `99_Manifest` | sidecar artifact hash 포함 |

### Sidecar artifacts

```text
export/{job_id}/audit-pack-{sha}.xlsx
export/{job_id}/manifest.json
export/{job_id}/extraction_graph.json
export/{job_id}/vision_ocr_refs.json
export/{job_id}/markitdown_refs.json
export/{job_id}/comparison_report.json
```

---

## 10. Detailed Sequence Diagram

```text
User
 │
 │ 1. PDF select
 ▼
Web App
 │
 │ 2. create job + signed upload URL
 ▼
GCS Source Bucket
 │
 │ 3. browser PUT PDF
 ▼
Web App
 │
 │ 4. confirm upload + sha256
 ▼
Cloud SQL
 │
 │ 5. source_files + audit_trace
 ▼
Web App
 │
 │ 6. POST /v1/preflight
 ▼
Parser
 │
 │ 7. download/read GCS file
 │ 8. text_density/page_count/encryption check
 │
 ├──────── text PDF ────────┐
 │                          │
 ▼                          ▼
pdfplumber              MarkItDown MCP
 │                          │
 │ text/table/evidence      │ markdown
 │                          │
 └──────────────┬───────────┘
                │
        scanned/low confidence?
                │
                ├─ No → merge
                │
                └─ Yes
                    ▼
              Google Vision API
                    │
                    ▼
              GCS OCR JSON
                    │
                    ▼
              vision_json_to_markdown
                    │
                    ▼
              Extraction Merge
                    │
                    ▼
              NormalizedInvoice
                    │
                    ▼
              MCP Audit Server
                    │
                    ▼
              Gate Bridge
                    │
                    ▼
              REVIEW_REQUIRED
                    │
                    ▼
              Human Approval
                    │
                    ▼
              Export / GCS signed URL
```

---

## 11. Failure Handling

| Failure | 감지 | 처리 | Verdict |
|---|---|---|---|
| Upload interrupted | confirm 없음 | retry upload | - |
| SHA mismatch | confirm hash 비교 | reject file | FAILED |
| PDF encrypted | preflight | manual document request | AMBER |
| PDF too large | preflight | client direct/chunk or manual | AMBER/FAILED |
| Vision API failed | operation error | retry 1~2회 | AMBER |
| Vision low confidence | OCR confidence | HGT_08 | AMBER |
| MarkItDown timeout | tool timeout | continue with parser/Vision | AMBER only if needed |
| MarkItDown source access violation | URI validation | block | FAILED/ZERO |
| NotebookLM callback hash mismatch | callback validation | reject callback | FAILED/SECURITY |
| MCP tool failure | tool status ERROR | fallback finding | AMBER |
| Export failed | worker error | retry export | FAILED |

---

## 12. Security / Compliance

## 12.1 P2/NDA 정책

| 데이터 | 저장 | 외부 전송 |
|---|---|---|
| 원본 invoice PDF | GCS private | Google Vision 가능 |
| evidence PDF | GCS private | Google Vision 가능 |
| Markdown | GCS private | NotebookLM 전송 기본 금지 |
| OCR JSON | GCS private | 외부 공유 금지 |
| Workbook | GCS private signed URL | 승인자 한정 |

## 12.2 Google Vision 보안

Google Vision async PDF OCR은 GCS 입력과 GCS 출력 bucket을 사용한다. 따라서 service account는 source object read와 OCR output write 권한이 필요하다.

권장 service account:

```text
svc-invoice-parser@PROJECT.iam.gserviceaccount.com
```

권한:

```text
roles/storage.objectViewer on source/evidence bucket
roles/storage.objectCreator on ocr/markdown/normalized/export bucket
roles/cloudvision.user 또는 Vision API 호출 가능 권한
roles/cloudsql.client
```

## 12.3 MarkItDown MCP 보안

MarkItDown은 현재 process 권한으로 I/O를 수행할 수 있으므로 다음을 강제한다.

```text
- GCS object만 입력 허용
- 외부 URL 입력 금지
- local absolute path 입력 금지
- private/loopback/link-local/metadata IP 접근 금지
- max file size 10MB 기본
- timeout 30s 기본
- conversion result max size 제한
- 원문 content 로그 금지
```

## 12.4 Logs

로그에는 원문을 남기지 않는다.

허용:

```text
job_id
file_id
sha256
artifact_id
engine
latency_ms
verdict
reason_code
confidence
```

금지:

```text
invoice raw text
BL/DO/BOE 원문 전체
vendor 실명
계약 단가 원문
내부 링크
```

---

## 13. Configuration

## 13.1 Environment Variables

```text
# Web
GCP_PROJECT_ID
GCS_SOURCE_BUCKET
GCS_EVIDENCE_BUCKET
GCS_EXPORT_BUCKET
PARSER_SERVICE_URL
MCP_SERVICE_URL
MARKITDOWN_MCP_URL
API_SECRET_KEY
CALLBACK_HMAC_SECRET

# Parser
DATABASE_URL
GCS_SOURCE_BUCKET
GCS_EVIDENCE_BUCKET
GCS_OCR_BUCKET
GCS_MARKDOWN_BUCKET
GCS_NORMALIZED_BUCKET
GOOGLE_CLOUD_PROJECT
VISION_FEATURE_TYPE=DOCUMENT_TEXT_DETECTION
VISION_BATCH_SIZE=1
MARKITDOWN_MCP_URL
VISION_POLICY=AUTO
MARKITDOWN_POLICY=ALWAYS_FOR_PDF
NOTEBOOKLM_POLICY=OFF

# MarkItDown MCP
MARKITDOWN_MAX_FILE_BYTES=10485760
MARKITDOWN_TIMEOUT_MS=30000
ALLOW_GCS_ONLY=true

# MCP Audit
DATABASE_URL
MCP_SHARED_SECRET
```

## 13.2 Feature Flags

| Flag | Default | 설명 |
|---|---|---|
| `VISION_ENABLED` | true | Vision OCR 사용 |
| `VISION_POLICY` | AUTO | OCR routing |
| `MARKITDOWN_ENABLED` | true | Markdown conversion |
| `MARKITDOWN_POLICY` | ALWAYS_FOR_PDF | Markdown routing |
| `NOTEBOOKLM_ENABLED` | false | NotebookLM second opinion |
| `EXPORT_SIDECAR_ENABLED` | true | sidecar artifacts 저장 |
| `STRICT_PDF_INVOICE` | true | PDF invoice 명시 처리 |

---

## 14. Performance / Cost Policy

| 항목 | 기본값 | 이유 |
|---|---:|---|
| Parser CPU | 2 vCPU | pdfplumber + Vision collect + xlsx export |
| Parser Memory | 4Gi | 10MB PDF/table/JSON 처리 |
| Parser concurrency | 1 | OOM 방지 |
| Vision policy | AUTO | scanned/low-confidence만 OCR |
| MarkItDown policy | PDF only | 비용/latency 제한 |
| NotebookLM | OFF | P2/latency/외부전송 리스크 |
| Vision output batchSize | 1~5 | page별 trace 관리 |
| Max PDF | 10MB 기본 | 현 parser 기준 유지 |
| OCR retry | 2 | 일시 오류 대응 |

---

## 15. Validation Plan

## 15.1 Test Set

| Case | Input | Expected |
|---|---|---|
| T1 | XLSX invoice | openpyxl parse PASS |
| T2 | Text PDF invoice | pdfplumber + MarkItDown PASS |
| T3 | Scanned PDF invoice | Vision OCR path PASS |
| T4 | PDF evidence BOE | BOE EvidenceCandidate 생성 |
| T5 | DSV waybill | waybill fields/lane/timeline |
| T6 | Encrypted PDF | AMBER/HGT_08 |
| T7 | Total mismatch | AMBER |
| T8 | CUSTOMS without BOE | ZERO |
| T9 | Duplicate invoice | ZERO |
| T10 | MarkItDown timeout | main pipeline continues |
| T11 | Vision low confidence | AMBER/HGT_08 |
| T12 | Export | 13-sheet xlsx + sidecar manifest |

## 15.2 Smoke Commands

```bash
# 1. upload URL
curl -X POST "$WEB/api/files/create-upload-url" \
  -H "Authorization: Bearer $API_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename":"sample.pdf","mime_type":"application/pdf","size_bytes":123456,"file_role":"INVOICE"}'

# 2. preflight
curl -X POST "$PARSER/v1/preflight" \
  -H "Authorization: Bearer $PARSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"job_id":"job_x","file_id":"file_x","gcs_uri":"gs://...","file_type":"pdf","file_role":"INVOICE"}'

# 3. vision start
curl -X POST "$PARSER/v1/vision/start" \
  -H "Authorization: Bearer $PARSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"job_id":"job_x","file_id":"file_x","source_gcs_uri":"gs://...","output_gcs_prefix":"gs://.../ocr/job_x/file_x/vision/"}'

# 4. MarkItDown MCP
curl -X POST "$MARKITDOWN_MCP/mcp" \
  -H "Authorization: Bearer $MCP_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"tool":"convert_gcs_to_markdown","input":{"job_id":"job_x","file_id":"file_x","source_gcs_uri":"gs://...","output_gcs_uri":"gs://.../markitdown.md"}}'
```

---

## 16. Implementation Work Items

## P0 — 필수

| ID | 작업 | 파일/서비스 |
|---|---|---|
| P0-1 | `numeric_integrity_status` PASS/AMBER/ZERO 정렬 | worker schema/contracts |
| P0-2 | PDF invoice vs evidence 정책 추가 | web run route |
| P0-3 | GCS signed upload flow 추가 | web |
| P0-4 | Vision OCR start/collect 추가 | parser |
| P0-5 | Vision JSON normalizer 추가 | parser |
| P0-6 | MarkItDown MCP service/tool 추가 | new service |
| P0-7 | EvidenceCandidate token mapping 보정 | cf-mcp-client/parser |
| P0-8 | 14개 MCP tool orchestration 확장 | cf-mcp-client |
| P0-9 | extraction_artifacts/extraction_comparisons schema 추가 | DB |
| P0-10 | 13-sheet export sidecar manifest 추가 | exporter |

## P1 — 안정화

| ID | 작업 |
|---|---|
| P1-1 | NotebookLM trigger를 feature flag로 연결 |
| P1-2 | OCR/Markdown comparison report |
| P1-3 | Cloud Logging structured logs |
| P1-4 | Cloud Run IAM private invocation |
| P1-5 | retry/backoff policy |
| P1-6 | cost dashboard |

---

## 17. Go / No-Go Gate

| Gate | Go 기준 |
|---|---|
| Upload | PDF가 GCS에 직접 저장되고 source_files 기록 |
| Preflight | text/scanned/encrypted PDF 판정 |
| Vision | scanned PDF OCR JSON 생성 |
| MarkItDown | text PDF markdown artifact 생성 |
| Merge | NormalizedInvoice + EvidenceCandidate 생성 |
| Validation | 14 tools smoke |
| Gate | PASS/AMBER/ZERO 재현 |
| Approval | role-based approval |
| Export | 13-sheet xlsx + sidecar manifest |
| Security | raw P2 로그 없음 |
| Cost | Vision AUTO 정책 적용 |
| Rollback | Vision/MarkItDown OFF flag 존재 |

---

## 18. 최종 Workflow 요약

```text
1. 사용자가 Web App에서 PDF/xlsx/md/txt 업로드
2. Web App은 GCS signed upload URL 발급
3. 파일은 GCS에 직접 저장
4. Web App은 job/source_file metadata 저장
5. Parser preflight가 파일 성격 판정
6. text PDF는 pdfplumber + MarkItDown MCP
7. scanned PDF는 Google Vision OCR + vision_json_to_markdown
8. 모든 추출 결과는 extraction graph로 병합
9. NormalizedInvoice와 EvidenceCandidate 생성
10. MCP Audit Server가 14개 검증 수행
11. Gate Bridge가 PASS/AMBER/ZERO/FAILED 결정
12. Human Gate가 승인/보류 처리
13. Exporter가 13-sheet workbook 생성
14. Workbook과 sidecar artifacts를 GCS 저장
15. Web App이 signed download URL 제공
```

---

## 19. Codex / 구현 프롬프트

```text
Task: Integrate Google Vision OCR and MarkItDown MCP into SCT HVDC Invoice Audit Platform.

Goal:
Extend the existing upload→parse→validate→gate→approve→export pipeline with:
1. GCS direct upload
2. Google Vision OCR for scanned/low-confidence PDFs
3. MarkItDown MCP markdown conversion for PDFs and supported documents
4. Extraction artifact tracking
5. Extraction comparison
6. 14-tool MCP validation orchestration
7. 13-sheet workbook export with sidecar manifest

Required changes:
- Add GCS signed upload flow.
- Add parser /v1/preflight.
- Add parser /v1/vision/start and /v1/vision/collect.
- Add MarkItDown MCP service with:
  - convert_gcs_to_markdown
  - vision_json_to_markdown
  - extract_markdown_refs
- Add DB tables:
  - extraction_artifacts
  - extraction_comparisons
- Fix numeric_integrity PASS/AMBER/ZERO schema.
- Fix EvidenceCandidate token mapping:
  include text_span, matched_reference, doc_kind, doc_type.
- Expand audit orchestration to 14 MCP tools.
- Keep NotebookLM optional and disabled by default.
- Do not block main pipeline on NotebookLM.
- Store Vision OCR JSON and MarkItDown Markdown in GCS.
- Keep raw document text out of logs.
- Preserve 13-sheet workbook contract; add sidecar manifest.

Validation:
- xlsx invoice E2E
- text PDF invoice E2E
- scanned PDF Vision OCR E2E
- evidence PDF BOE/DO/DN extraction
- MarkItDown markdown artifact creation
- mismatch comparison AMBER
- export workbook + sidecar manifest
- Cloud Logging trace_id lookup

Output:
- changed files
- migration SQL
- API contracts
- deployment commands
- smoke test results
- remaining risks
```

---

## 20. Reference Notes

- Existing platform report: original upload/parse/validate/gate/approve/export baseline.
- MarkItDown connection plan: existing orchestrator and missing trigger.
- Microsoft MarkItDown: Markdown conversion utility with file-format support and security warning.
- Google Vision: PDF/TIFF OCR through Cloud Storage async batch annotation.
- Google Cloud Storage: signed URL upload/download.
- Cloud Run: parser runtime for long-running PDF/OCR/export tasks.

---

## 21. 현재 repo 기준 누락 보강

이 섹션은 위 설계를 현재 `SCT_ONTOLOGY-main` 코드베이스에 이식하기 전에 반드시 보강해야 하는 항목이다.
기존 본문은 목표 아키텍처를 정의하고, 아래 항목은 실제 구현자가 결정을 임의로 만들지 않도록 현재 repo와의 차이를 고정한다.

### 21.1 업로드 경로 전환 정책

현재 repo의 업로드 경로는 Vercel Blob 기반이다.

```text
small upload: /api/files/ingest
large upload: /api/files/ingest/large
storage ref: blob_ref / blob_url
```

본문의 목표 설계는 GCS signed upload 기반이다.

```text
target upload: /api/files/create-upload-url
target confirm: /api/files/confirm
storage ref: gcs_uri / object path / sha256
```

구현 전 결정:

| 항목 | 결정 |
|---|---|
| 전환 방식 | Phase 1에서는 Vercel Blob 경로를 유지하고, GCS signed upload는 신규 경로로 병행 추가한다. |
| 기본 경로 | 기존 운영 안정성을 위해 Vercel Blob을 기본값으로 둔다. |
| Google Vision 입력 | Vision OCR은 GCS URI만 허용하므로, Vision 대상 파일은 GCS 업로드 또는 Blob→GCS 복사 후 실행한다. |
| 해시 정책 | `source_files.sha256`은 원본 바이트 기준으로 유지한다. Blob→GCS 복사 시 sha256 불일치가 있으면 Vision 실행을 중단한다. |
| 롤백 | GCS 경로 실패 시 기존 `/api/files/ingest` 경로를 유지한다. |

### 21.2 Worker 의존성 추가

현재 `apps/worker-py/pyproject.toml`에는 Google Vision/GCS client dependency가 없다.

구현 시 추가할 의존성:

```text
google-cloud-vision
google-cloud-storage
google-auth
```

인증 방식:

| 환경 | 방식 |
|---|---|
| Local | `GOOGLE_APPLICATION_CREDENTIALS` 또는 gcloud ADC |
| Cloud Run | service account 기본 credential |
| Test | Vision/GCS client mock 사용 |

필수 env:

```text
GOOGLE_CLOUD_PROJECT
GCS_SOURCE_BUCKET
GCS_OCR_BUCKET
GCS_MARKDOWN_BUCKET
GCS_NORMALIZED_BUCKET
VISION_FEATURE_TYPE=DOCUMENT_TEXT_DETECTION
VISION_BATCH_SIZE=1
```

### 21.3 Feature flag 기본값 재정의

운영 안전 기준상 외부 OCR/변환 경로는 기본 OFF 또는 AUTO 게이트 뒤에 둔다.

| Flag | 기존 본문 값 | 현재 repo 이식 기본값 | 이유 |
|---|---|---|---|
| `VISION_ENABLED` | true | false | Google Vision 외부 처리 및 비용 발생을 운영자 승인 뒤로 미룬다. |
| `VISION_POLICY` | AUTO | AUTO | flag가 켜진 뒤에도 scanned/low-confidence PDF에만 적용한다. |
| `MARKITDOWN_ENABLED` | true | false | 외부 MCP/변환 경로를 기본 비활성화한다. |
| `MARKITDOWN_POLICY` | ALWAYS_FOR_PDF | PDF_ONLY | 모든 파일 변환이 아니라 PDF 중심으로 제한한다. |
| `NOTEBOOKLM_ENABLED` | false | false | P2/NDA 승인 전 외부 전송 금지 정책을 유지한다. |
| `EXPORT_SIDECAR_ENABLED` | true | false | sidecar 저장소 schema와 보안 검토 완료 후 켠다. |

구현자는 flag 미설정 상태에서 기존 xlsx/md/txt/pdfplumber 경로가 그대로 동작하도록 해야 한다.

### 21.4 Parser API schema 보강

현재 worker에는 `/v1/parse`, `/v1/notebooklm/run`, `/v1/export`가 있다.
본문에서 제안한 `/v1/preflight`, `/v1/vision/start`, `/v1/vision/collect`는 신규 Pydantic schema가 필요하다.

필수 request/response 모델:

```text
PreflightRequest
PreflightResponse
VisionStartRequest
VisionStartResponse
VisionCollectRequest
VisionCollectResponse
VisionArtifactRef
```

필수 응답 필드:

| API | 필수 필드 |
|---|---|
| `/v1/preflight` | `job_id`, `file_id`, `file_type`, `is_text_based`, `is_scanned`, `is_encrypted`, `page_count`, `parser_issues`, `recommended_route` |
| `/v1/vision/start` | `job_id`, `file_id`, `operation_name`, `output_gcs_prefix`, `status` |
| `/v1/vision/collect` | `job_id`, `file_id`, `operation_name`, `ocr_json_gcs_uri`, `page_count`, `confidence`, `status`, `issues` |

에러 코드:

```text
VISION_DISABLED
VISION_GCS_URI_REQUIRED
VISION_AUTH_FAILED
VISION_OPERATION_FAILED
VISION_OUTPUT_NOT_FOUND
VISION_LOW_CONFIDENCE
```

### 21.5 DB migration 상세

본문의 `extraction_artifacts`, `extraction_comparisons`는 실제 migration에 아직 없다.
구현 전 migration을 별도 파일로 추가한다.

권장 migration:

```text
migrations/0012_extraction_artifacts.sql
```

`extraction_artifacts` 최소 컬럼:

| 컬럼 | 의미 |
|---|---|
| `artifact_id` | artifact primary key |
| `job_id` | jobs 참조 |
| `file_id` | source_files의 file_id |
| `engine` | pdfplumber / google_vision / markitdown / notebooklm |
| `artifact_type` | text_spans / vision_json / markdown / normalized |
| `gcs_uri` | GCS 저장 위치 |
| `sha256` | artifact hash |
| `confidence` | 0~1 |
| `created_at` | 생성 시각 |

`extraction_comparisons` 최소 컬럼:

| 컬럼 | 의미 |
|---|---|
| `comparison_id` | comparison primary key |
| `job_id` | jobs 참조 |
| `left_artifact_id` | 기준 artifact |
| `right_artifact_id` | 비교 artifact |
| `field_name` | 비교 필드 |
| `left_value_hash` | 원문 값 대신 hash |
| `right_value_hash` | 원문 값 대신 hash |
| `severity` | PASS / AMBER / ZERO / FAILED |
| `created_at` | 생성 시각 |

삭제 정책:

```text
job 삭제 시 artifact/comparison은 ON DELETE CASCADE
원문 텍스트는 DB에 저장하지 않음
```

### 21.6 Vision JSON 정규화 규칙

Vision JSON은 직접 verdict source가 아니다.
Vision 결과는 `EvidenceCandidate`, `SourceDataRow`, 필요 시 `NormalizedInvoice` 초안으로만 들어간다.

필드 매핑:

| Vision source | Target |
|---|---|
| page number | `SourceDataRow.pdf_page` |
| text block 또는 paragraph | `SourceDataRow.original_text`는 최대 500자만 저장 |
| text hash | `SourceDataRow.text_span_hash` |
| OCR confidence | `EvidenceCandidate.confidence` |
| BL/DO/BOE/Invoice 후보 | `EvidenceCandidate.matched_reference` |
| 문서 종류 추정 | `EvidenceCandidate.doc_kind` |

우선순위:

```text
1. xlsx/openpyxl deterministic parser
2. text PDF/pdfplumber parser
3. Google Vision OCR evidence extraction
4. MarkItDown markdown support extraction
5. NotebookLM optional second opinion
```

충돌 규칙:

```text
금액, 통화, invoice_no가 parser와 OCR 사이에서 다르면 parser 값을 우선하고 comparison AMBER를 남긴다.
OCR만 값을 찾고 parser가 값을 찾지 못한 경우에는 HGT_08 review action을 생성한다.
OCR confidence가 threshold 미만이면 verdict를 PASS로 올리지 않는다.
```

### 21.7 현재 repo 기준 검증 명령

문서 구현 검증은 curl smoke만으로 완료로 판정하지 않는다.
현재 repo의 테스트 체계에 맞춰 아래를 사용한다.

Web:

```powershell
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
```

Worker:

```powershell
cd apps/worker-py
python -m pytest
```

Focused tests:

```powershell
python -m pytest apps/worker-py/tests/test_parse_dispatch.py
python -m pytest apps/worker-py/tests/test_pdf_text_parser.py
pnpm --dir apps/web test -- api-invoice-audit-run.test.ts
pnpm --dir apps/web test -- parser-client.test.ts
```

추가되어야 할 신규 테스트:

| 테스트 | 목적 |
|---|---|
| `test_vision_preflight.py` | text/scanned/encrypted PDF route 판정 |
| `test_vision_routes.py` | start/collect request schema와 stable error 검증 |
| `test_vision_normalizer.py` | Vision JSON→EvidenceCandidate 변환 |
| `api-files-gcs-upload.test.ts` | GCS signed upload/confirm contract 검증 |
| `api-invoice-audit-run-vision.test.ts` | flag OFF 미호출, flag ON scanned PDF 호출 검증 |

최종 완료 판정:

```text
feature flag OFF: 기존 테스트 전부 통과, 외부 Vision 호출 0회
feature flag ON + mock: scanned PDF route가 Vision start/collect를 호출
P2 로그 검증: raw OCR text / invoice raw text 미노출
```

---

**보고서 종료.**
