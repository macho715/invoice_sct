# PDF 파서 고도화 계획 — Track ① 완료 + Vision OCR Track ② 대기

- **작성일**: 2026-06-16
- **연계 문서**: [`20260616_PDF_PARSER_INVENTORY_v1.md`](./20260616_PDF_PARSER_INVENTORY_v1.md) (현황 인벤토리)
- **상태**: Track ① 일반 PDF 라인 추출 구현 완료. Track ② GCS 기반 Vision OCR 운영 연결은 비용/승인 확정 후 별도 실행.

## Objective
DSV 외 **일반 인보이스 PDF에서도 `invoice_lines`를 추출**하도록 Track ①을 완료했다. 다음 목표는 **스캔/이미지 PDF를 Google Vision OCR로 처리**하여, PDF 단독 업로드도 라인 단위 검증 → 최종 13-sheet Excel(Rule #0)이 의미 있게 채워지게 하는 것이다.

## Scope

### In
- **① 일반 PDF 라인 추출 — 완료**: 워커 `pdf_text.py`의 `text_spans`/`table_candidates` → `InvoiceLine` 매핑 함수(`extract_generic_invoice_lines`) 신규(비-DSV generic). `parse.py`에서 DSV SHPT 경로가 비었을 때만 fallback으로 사용.
- **② GCS 기반 Vision OCR 운영 연결**: 워커 env(`VISION_ENABLED`, `GOOGLE_CLOUD_PROJECT`) + 웹 env(`VISION_FALLBACK_ENABLED`, `GCS_OCR_BUCKET`) + `gs://` 입력 경로 연결. `dsv-invoice-source` / `dsv-invoice-ocr` bucket과 route-level smoke PASS 기록을 기준으로 운영 run route에 연결한다.
- 각 항목 단위·통합 테스트 + prod 종단 재검증. Track ①은 로컬 검증 완료, Track ②는 운영 승인 후 재검증 필요.

### Out
- 13-sheet 계약 변경 · verdict 로직 변경(Vision은 verdict 불변 fallback 유지).
- 웹 UI 변경(업로드 플로우 수리 완료).
- DSV 파서 변경(이미 라인 추출 동작 — `_dsv_lines_to_invoice_lines`).
- NotebookLM/MarkItDown을 최종 판정 경로로 승격하지 않음(dual extraction 보조 비교만 허용).

## Steps

### Track ① 일반 PDF 라인 추출 (완료)
1. `pdf_text.py`에 `extract_generic_invoice_lines(text_spans, table_candidates) -> tuple[list[InvoiceLine], float]` 추가 완료 — table row 우선, text line fallback 순서. 금액/수량/통화 정규식 + 테이블 행 매핑. confidence 부여.
2. 최소 필드: `line_id`, `description`, `currency`, `amount`, `source_ref`, `confidence`. `qty`, `rate`, `shipment_ref`, `type_b`, `for_charge_component`는 명확할 때만 채운다.
3. `parse.py` `file_type=='pdf'` 분기에서 `extract_dsv_from_text()` + `_dsv_lines_to_invoice_lines()`가 먼저 실행된다. DSV 결과가 빈 경우에만 generic 매핑 경로를 호출한다.
4. 신뢰도 < 0.85, 금액/통화 불명확, line/table 충돌은 AMBER + human review 근거로 남긴다. Worker는 최종 PASS를 만들지 않는다.
5. 워커 테스트에 generic 인보이스 fixture 라인 추출, low-text no-crash, DSV 회귀 경계 테스트를 추가했다.
6. 검증 결과: Worker tests 190/190 pass(PDF 파서 관련 28개 포함), Web typecheck 0 errors, Web tests 327/327 pass(42 files), DSV 회귀 기존 추출 결과 불변.

### Track ② GCS 기반 Vision OCR 운영 연결 (인프라 + 코드, 중위험·유료)
7. GCP 상태 확인: `dsv-invoice-source`, `dsv-invoice-ocr` bucket, `svc-invoice-parser` 서비스계정, `roles/storage.objectViewer`, `roles/storage.objectCreator`가 유지되는지 확인한다. 비용 발생 전제는 사용자 승인 대상이며, 보고서에는 계정 이메일 전체값을 반복하지 않는다.
8. 워커 env: `VISION_ENABLED=true`, `GOOGLE_CLOUD_PROJECT=dsv-invoice`, 필요 시 `VISION_BATCH_SIZE=1`, `VISION_MIME_TYPE=application/pdf`.
9. 웹 env: `VISION_FALLBACK_ENABLED=true`, `GCS_OCR_BUCKET=dsv-invoice-ocr`.
10. 입력 조건: run route에서 Vision fallback은 PDF `blob_ref` 또는 `gcs_uri`가 `gs://`일 때만 호출한다. Vercel Blob만 있는 PDF는 Vision 대상이 아니라 기존 pdfplumber 대상이다.
11. 실제 라우트명: `/v1/preflight`, `/v1/vision/start`, `/v1/vision/collect`. `/v1/vision/preflight` 사용 금지.
12. 성공 기준: API 호출 성공만으로 완료 판정하지 않는다. `STARTED → COLLECTED → normalized evidence/source_data → workbook trace`까지 확인한다.
13. Vision normalizer는 `fullTextAnnotation.text`, page index, confidence, word order, source GCS URI, OCR JSON GCS URI를 보존하되 raw OCR text는 로그/trace/workbook에 그대로 쓰지 않는다.
14. BOE/customs, low confidence page, scanned fallback 사용, auditable subtotal 부재는 자동 PASS 금지. 최소 AMBER 또는 기존 gate 규칙에 따른 ZERO로 보낸다.

### 공통
15. 회귀: 기존 테스트 그린 유지. prod Rule #0 종단(ingest→run→export→download) 재검증.
16. NotebookLM/MarkItDown dual extraction은 보조 비교 경로로만 유지한다. mismatch는 `NEEDS_REVIEW` 성격의 AMBER 근거로 남기고 최종 verdict authority는 web audit engine에 둔다.

## Risk / Assumptions
- **① 완료 후 잔여 위험**: generic 인보이스 레이아웃 다양 → 정규식/테이블 매핑 정확도 한계. 완화: 낮은 신뢰도는 AMBER 표기(Rule #0 — 산출 보장). DSV 경로 불변은 회귀로 확인됐다.
- **②**: **비용·권한 발생**(Google Vision API 유료, GCP IAM/env/배포 변경) → 관리자 승인·예산 확인 필수. `gs://` 입력 경로 단절 시 Blob→GCS 브리지 추가 작업.
- **② 현재 증거**: GCP worklog에 `dsv-invoice-source` / `dsv-invoice-ocr` bucket 생성, live OCR smoke, FastAPI route-level smoke PASS 기록이 있다. 다만 운영 run route 자동 트리거는 env와 `gs://` 입력 조건까지 맞아야 완료다.
- **원문 보호**: raw PDF 내용과 raw OCR text는 콘솔, audit trace, workbook에 그대로 남기지 않는다.
- **순서**: ①은 완료. ②는 운영 env/배포 승인 후 진행.
- **롤백**: 워커 rev 1줄 traffic 롤백. ① 스키마 영향 없음(invoice_lines 채움만).

## Estimated cost
- ① 완료 (워커 3파일, 런타임 비용 0)
- ② 大 (GCP 설정 + 재배포 + 종단, 1~2일, **Vision API 호출당 과금** — 문서 OCR 단가 확인 필요)
- **권장**: ②는 비용/승인 확정 후 별도 진행.

## Acceptance Criteria
- 일반 비-DSV 텍스트 PDF가 최소 1개 이상의 `invoice_lines`를 만든다. Track ① 기준 충족.
- DSV SHPT PDF의 기존 추출 결과와 gate 흐름은 변하지 않는다. Track ① 회귀 기준 충족.
- 스캔 PDF 또는 low/no text PDF는 Vision fallback 대상으로 trace된다.
- Vision live route는 GCS input/output 기준으로 `STARTED → COLLECTED`를 재현한다.
- raw PDF 내용과 raw OCR text는 콘솔, trace, workbook에 그대로 출력하지 않는다.
- PDF-only upload도 PASS/AMBER/ZERO와 관계없이 13-sheet Excel download path를 유지한다.

## Verification Commands
- `rg -n "vision/preflight|/v1/preflight|VISION_ENABLED|GCS_OCR_BUCKET|NO_INVOICE_LINES_EXTRACTED|invoice_lines|SCANNED_PAGE_DETECTED" docs reports apps`
- `cd apps/worker-py && python -m pytest tests/test_pdf_text_parser.py tests/test_dsv_pdf_hybrid.py tests/test_vision_client.py tests/test_vision_route.py tests/test_vision_normalizer.py tests/test_v_vision_rules.py -q`
- `pnpm --dir apps/web test -- --run tests/api-invoice-audit-run.test.ts tests/api-invoice-audit-run-pdf-dsv.test.ts tests/api-audit-export.test.ts`
- Track ① 완료 검증 기록: Worker tests 190/190 pass, Web typecheck 0 errors, Web tests 327/327 pass.
- Secret/raw-text scan: search updated reports for private key blocks, secret assignments, raw OCR payload snippets, TRN, phone, and email-like values. Secret names alone are allowed when documenting env requirements.
