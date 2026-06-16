# PDF 파서 인벤토리 — SCT ONTOLOGY

**생성일**: 2026-06-16
**범위**: 레포지토리 전체 PDF 파싱 관련 스크립트·문서·테스트·증빙

---

## 1. 핵심 파서 모듈 (`apps/worker-py/app/parsers/`)

| 파일 | 규모 | 역할 |
|------|------|------|
| `pdf_text.py` | 440줄 | **주 파서** — pdfplumber로 텍스트 스팬·테이블 후보·증빙 후보 추출. 문자 밀도 기반 신뢰도 계산. SCANNED_PAGE_DETECTED / PDF_ENCRYPTED / PDF_TOO_LARGE 감지. 일반 PDF `invoice_lines` 추출(`extract_generic_invoice_lines`, 테이블 우선 → 텍스트 라인 fallback). DSV waybill 감지(`is_dsv_waybill_text`). SHPT shipment/doc 매핑(`extract_shpt_shipment_doc_mapping`). `PdfParseResponse` 반환. |
| `dsv_pdf_hybrid.py` | 751줄 | **DSV SHPT 하이브리드 라인 추출기** — `pdf_hybrid_parser_pro_v2_1.py`의 worker 포트. 7종 문서 분류(CARRIER_RHS, PORT_ALLIED, AIRPORT_FEES, BOE_CUSTOMS, DELIVERY_ORDER 등). Charge line + TYPE_B + evidence_status 추출. pdf_text.py의 텍스트 스팬·테이블 재사용(2차 pdfplumber 호출 없음). |
| `pdf_json.py` | 191줄 | **JSON 파서** — Vision OCR JSON 등 사전 구조화 PDF 표현 파싱. REF_PATTERNS로 증빙 후보 추출. `/parse/pdf-json` 라우트에서 사용. |

---

## 2. 라우트·오케스트레이션 (Worker)

| 파일 | 역할 |
|------|------|
| `app/routes/parse.py` (235줄) | **`/v1/parse` 엔드포인트** — file_type에 따라 `parse_pdf_text_bytes()`(pdfplumber) 또는 `parse_pdf_json_bytes()`(JSON) 디스패치. PDF의 경우 DSV SHPT 라인 추출(`extract_dsv_from_text`) 후 `_dsv_lines_to_invoice_lines()`로 InvoiceLine 변환. DSV 결과가 빈 경우 일반 PDF generic fallback(`extract_generic_invoice_lines`)으로 InvoiceLine을 만든다. |
| `app/services/vision_client.py` | **Google Cloud Vision 클라이언트** — GCS async OCR 텍스트 검출(start + collect). 스캔/이미지 PDF의 OCR 폴백. |
| `app/services/vision_normalizer.py` (140줄) | **Vision OCR JSON 정규화기** — Vision OCR 출력 → EvidenceCandidate 호환 포맷. pdf_text.py와 동일한 REF_PATTERNS 사용. `VisionNormalizedResult`(full_text, confidence, page_count, evidence) 반환. |
| `app/routes/vision.py` | **`/v1/preflight`, `/v1/vision/start`, `/v1/vision/collect`** — PDF 사전 판별, Google Vision async OCR 시작, GCS OCR JSON 수집. `/v1/vision/preflight`는 실제 라우트가 아님. |

---

## 3. 공유 스키마

| 파일 | 설명 |
|------|------|
| `app/schemas.py` (399줄) | **Pydantic 스키마 SSOT** — `PdfParseResponse`, `PdfTableCandidate`, `PdfTextSpan`, `EvidenceCandidate`, `InvoiceLine`, `InvoiceHeader`, `NormalizedInvoice` 등 PDF 파서 I/O 형상 정의. |

---

## 4. 테스트 파일

### Worker (`apps/worker-py/tests/`)

| 파일 | 테스트 | 설명 |
|------|--------|------|
| `test_pdf_text_parser.py` | 10 | 기본 텍스트+증빙 추출, 테이블 후보, SCANNED 저밀도, 신뢰도 계산, 암호화/대용량 시뮬레이션, fixture 라운드트립(text-pdf-001~005), Track ① 일반 PDF 라인 추출(text-pdf-001/002), low-text no-crash, DSV 회귀 경계 |
| `test_pdf_json_parser.py` | - | 유효 JSON(spans+tables), 잘못된 JSON, 증빙-only 페이로드, 신뢰도, 빈 페이지, 기본값 |
| `test_parse_pdf_json_route.py` | - | `/parse` + `/parse/pdf-json` 라우트 FastAPI TestClient 검증 |
| `test_dsv_pdf_hybrid.py` | - | 문서 유형 분류(5종), 공통 키 추출, 라인 항목 추출, ISO 6346 컨테이너 검증, TYPE_B 매핑 |
| `gen_pdf_fixtures.py` | - | fpdf2로 text-pdf-001~005 생성(인보이스 텍스트, 테이블, HVDC 레퍼런스). 저밀도 샘플 포함. |

### Test Fixtures

| 파일 | 설명 |
|------|------|
| `tests/fixtures/text-pdf-001.pdf` | 기본 인보이스 + 텍스트 + 테이블 + 레퍼런스 |
| `tests/fixtures/text-pdf-002.pdf` | 변형 인보이스 |
| `tests/fixtures/text-pdf-003.pdf` | 변형 인보이스 |
| `tests/fixtures/text-pdf-004.pdf` | 변형 인보이스 |
| `tests/fixtures/text-pdf-005.pdf` | **저밀도 샘플** — SCANNED/low-conf AMBER 경로 테스트용 |
| `tests/fixtures/dsv-waybill-001.txt` | DSV waybill 텍스트 fixture |

### Web (`apps/web/tests/`)

| 파일 | 설명 |
|------|------|
| `tests/api-invoice-audit-run-pdf-dsv.test.ts` | DSV SHPT PDF 인보이스 → full validation (MCP + gate) E2E. zero-lines 강제 AMBER 가드 우회 확인. |

---

## 5. 독립형 DSV 파서 스크립트

| 파일 | 규모 | 설명 |
|------|------|------|
| `dsv docs/pdf_parse_patch_v2_1_bundle/pdf_hybrid_parser_pro_v2_1.py` | **1,378줄** | **v2.1 PRO** — 풀파이프라인 CLI: Project Source 스캔, 네이티브 텍스트 추출(pdfplumber), OCR 폴백(fitz/pytesseract), 테이블 추출(pdfplumber), 렌더 QA(PyMuPDF), DOC_TYPE 분류(7+), COMMON_KEYS + 라인 추출, TYPE_B 매핑, gate verdict, JSON/CSV/XLSX/summary 출력. BL/MAWB/HAWB/IBAN/TRN 마스킹. **`dsv_pdf_hybrid.py`의 참조 구현.** |
| `dsv docs/pdf parse/pdf_hybrid_parser.py` | 434줄 | **v1 원본** — PRO v2.1 이전 버전. 7종 DOC_TYPE, common_keys, evidence index, TYPE_B 매핑. pdfplumber + fitz + openpyxl. |
| `domestic/runtime/utils/pdf_processor_v1_2_dsv_patched.py` | **1,475줄** | **DSV Enhanced v1.4.1** — pdfplumber 텍스트/테이블 추출, rapidfuzz 콘텐츠 매칭, DSV waybill 감지, consignment 테이블, lane 추출, 타임라인 파싱. `pdf_text.py` DSV waybill 로직의 Track 1 참조. |
| `domestic/runtime/md_as_pdf_utils.py` | | **MD-as-PDF 유틸리티** — 마크다운 파일을 PDF 형식 인보이스로 처리(domestic 워크플로우). |

---

## 6. 파서 출력·레퍼런스 데이터

| 파일 | 설명 |
|------|------|
| `dsv docs/pdf_parse_patch_v2_1_bundle/parser_out_v2_1_final/pdf_line_items.csv` | v2.1 출력 — 30개 추출 라인(charge line + 금액 + TYPE_B + evidence_status) |
| `dsv docs/pdf_parse_patch_v2_1_bundle/parser_out_v2_1_final/pdf_evidence_index.json` | v2.1 출력 — 증빙 인덱스 JSON (shipment token → 페이지/문서유형/스니펫) |
| `dsv docs/pdf_parse_patch_v2_1_bundle/parser_out_v2_1_final/summary.md` | v2.1 요약 — PASS 12 / AMBER 4 / FAIL 0 / ZERO 0 |
| `dsv docs/dsv docs/parser_out/pdf_evidence_index.json` | Legacy v1 출력 |
| `dsv docs/dsv docs/parser_out/pdf_evidence_index.xlsx` | Legacy v1 출력 (Excel) |
| `dsv docs/dsv docs/parser_out_v2/pdf_evidence_index.json` | Legacy v2 출력 |
| `dsv docs/dsv docs/parser_out_v2/pdf_evidence_index.xlsx` | Legacy v2 출력 (Excel) |
| `dsv docs/dsv docs/parser_out_v3/pdf_evidence_index.json` | Legacy v3 출력 |
| `dsv docs/dsv docs/parser_out_v3/pdf_evidence_index.xlsx` | Legacy v3 출력 (Excel) |

---

## 7. 문서

### 기술 문서 (`docs/`)

| 파일 | 규모 | 내용 |
|------|------|------|
| `docs/pdf.md` | 361줄 | NoteLM PDF 파이프라인 설계 — MD → NoteLM → parser_schema.json → Vercel 콜백. 출력 스키마, 콜백 API, 파서 호환 어댑터, 이중 추출 비교. |
| `docs/dsv shpt pdf.md` | 942줄 | **DSV SHPT PDF 분석 보고서** — 6단계 파이프라인(Excel Loader → PDF Registry → Text Extractor → Doc Classifier → Evidence Matcher → Report Writer). Rate source 분기, amount anchor 생성, keyword anchor, shipment token, PDF ranking, evidence match verdicts, 운영 규칙 YAML. |
| `docs/20260615_google_vision_pdf_parser_logic_guide.md` | 429줄 | Vision OCR → normalizer → DSV 파서 규칙 파이프라인. TYPE_B 매핑 테이블, evidence 매칭 규칙, gate(PASS/AMBER/ZERO), 품질 스코어카드. |
| `docs/plan-20260614-notebooklm-pdf.md` | 187줄 | NoteLM Phase 1-3 구현 계획. Option B(콜백+스키마+어댑터+이중추출) 권장. |
| `docs/20260613_dsv_waybill_port_plan.md` | - | `pdf_processor_v1_2_dsv_patched.py` → worker-py 포팅 계획. DSV 전용 함수만 `pdf_text.py`로 추출(Option B). |
| `docs/20260615_google_vision_gcp_auth_worklog.md` | - | GCP 인증 워크로그 — `dsv-invoice-source` / `dsv-invoice-ocr` 버킷, 서비스 계정, Vision async OCR live smoke 및 FastAPI route-level smoke PASS 기록. |

### DSV 문서 (`dsv docs/`)

| 파일 | 내용 |
|------|------|
| `pdf parse/pdfparse.md` | **v1.0 플레이북** — 7단계 하이브리드 PDF 분석 방법(text → table → Render QA → DOC_TYPE → COMMON_KEYS → evidence index → gate) |
| `pdf_parse_patch_v2_1_bundle/20260615_pdf_parse_procedure_v2_1_PATCHED.md` | **v2.1 패치 보고서** — v1 로직 결함(TAX INVOICE 오분류 등), 패치 내용, 결과(PASS 12/AMBER 4/FAIL 0/ZERO 0) |
| `pdf_parse_patch_v2_1_bundle/PDF_PARSE_PATCH_REPORT_v2_1.md` | 패치 요약 보고서 |
| `pdf parse/20260615_pdf_parse_procedure_v1.md` | v1 절차 문서 (.md) |
| `pdf parse/20260615_pdf_parse_procedure_v1.docx` | v1 절차 문서 (.docx) |
| `pdf parse/20260615_pdf_parse_procedure_v2.docx` | v2 절차 문서 (.docx) |
| `pdf parse/build_report.py` | 리포트 빌더 — pdfplumber 텍스트+테이블 + PyMuPDF 렌더 QA → parse report 생성 |

---

## 8. 실증빙 PDF 파일 (32개)

**경로**: `dsv docs/dsv docs/`

| Shipment | 파일 유형 | 수량 |
|----------|-----------|------|
| SCT-0122 | DO, DN, BOE, CarrierInvoice, PortCNTInsp | 5 |
| SCT-0123,0124 | DO, DN, BOE, CarrierInvoice, PortCNTInsp, PortCNTWashing | 6 |
| SCT-0126 | DO, DN(×2), BOE, CarrierInvoice, PortCNTInsp | 6 |
| SCT-0127 | DO, DN, BOE, CarrierInvoice, PortCNTInsp | 5 |
| SCT-0131 | DO, DN, BOE, AirportFees, Appointment | 5 |
| SCT-0134 | DO, DN(×2), BOE, AirportFees, Appointment | 6 |
| SCT-0038 | CNTRepair | 1 |
| HE-0425~0502 | BOE(×18), SupportingDocs(×3) | 21 |

**합계**: 약 55개 PDF (32개 고유 shipment ref 기준, DN/DO/BOE 중복 포함)

---

## 9. 설정·의존성

| 파일 | 내용 |
|------|------|
| `apps/worker-py/pyproject.toml` | `pdfplumber>=0.11` 런타임 의존성 |
| `apps/worker-py/uv.lock` | pdfplumber v0.11.9 고정 |
| `apps/worker-py/Dockerfile` | 시스템 deps(libpoppler-cpp 등) pdfplumber 전이 의존성 |
| `migrations/0012_extraction_artifacts.sql` | `extraction_artifacts` 테이블 — pdfplumber / google_vision / markitdown / notebooklm 엔진 출력 추적 |

---

## 10. Web 측 연동

| 파일 | 역할 |
|------|------|
| `apps/web/src/lib/parser-client.ts` | TypeScript 파서 클라이언트 — `parsePdfText()` 메서드로 Worker `/v1/parse` 호출 |
| `apps/web/src/app/api/invoice-audit/run/route.ts` | Run 라우트 — 증빙 PDF 파싱(`parsePdfText()`), 저신뢰 PDF AMBER 게이트(임계값 0.85), Vision 폴백 트리거 |

---

## 요약

| 카테고리 | 파일 수 |
|----------|---------|
| 핵심 파서 모듈 | 3 |
| 라우트·서비스 | 4 |
| 스키마 | 1 |
| 테스트 (Worker) | 5 |
| 테스트 (Web) | 1 |
| Test fixtures | 6 |
| 독립형 DSV 스크립트 | 4 |
| 파서 출력·레퍼런스 | 9 |
| 기술 문서 | 6 |
| DSV 문서 | 8 |
| 실증빙 PDF | 32 |
| 설정·의존성 | 4 |
| Web 연동 | 2 |
| **합계** | **~85개** |

---

## 11. 검증 메모 (2026-06-16, 코드·prod 대조)

> 위 인벤토리를 실제 코드 + prod 워커 env와 대조해 확인·보정.

**확인됨 ✅**
- **DSV SHPT PDF → 실제 `invoice_lines` 추출**: `app/routes/parse.py:25` `_dsv_lines_to_invoice_lines()` 존재, `:84/:99`에서 DSV 하이브리드 파서가 페이지 텍스트/테이블을 진짜 invoice_lines로 변환 → `validate_numeric_integrity` 적용. 즉 **DSV waybill/SHPT PDF는 라인 단위 검증 가능**.
- **일반(비-DSV) 텍스트 PDF → generic `invoice_lines` 추출 구현 완료**: `pdf_text.py`의 `extract_generic_invoice_lines()`가 테이블 행을 우선 매핑하고, 실패 시 텍스트 라인 금액 정규식 fallback으로 라인을 만든다. `parse.py`는 DSV 결과가 0건일 때만 이 generic fallback을 호출한다.
- 핵심 파서(`pdf_text.py`/`dsv_pdf_hybrid.py`/`pdf_json.py`), pdfplumber 의존, 암호화/대용량/저밀도 가드 모두 코드 일치.

**보정 ⚠️**
1. **vision 라우트명**: 본문 §2의 `/v1/vision/preflight`는 오기였고 본문 표를 수정했다. 실제 = `/v1/preflight`(판별) + `/v1/vision/start`(비동기 시작) + `/v1/vision/collect`(수집). (`app/routes/vision.py:4-6,39,68,109`)
2. **일반(비-DSV) PDF 한계 보정**: 기존에는 `text_spans`/`table_candidates`까지만 만들고 generic `invoice_lines` 매핑이 없어 PDF 단독(비-DSV)이 AMBER `NO_INVOICE_LINES_EXTRACTED`로 떨어졌다. Track ① 구현 후 일반 텍스트 PDF는 `extract_generic_invoice_lines()`를 통해 라인 단위 검증 파이프라인으로 진입한다. 단, 스캔/이미지 PDF나 low-text PDF는 여전히 Vision 또는 AMBER review 경계가 필요하다.
3. **Vision OCR 조건부 동작**: 코드와 live route smoke는 존재하지만 운영 run route에서 자동 동작하려면 PDF `blob_ref` 또는 `gcs_uri`가 `gs://`이어야 하고, web `VISION_FALLBACK_ENABLED=true` 및 worker `VISION_ENABLED=true`, `GOOGLE_CLOUD_PROJECT` 설정이 맞아야 한다.

**GCP / Vision 검증 현황**
- `docs/20260615_google_vision_gcp_auth_worklog.md` 기준 `dsv-invoice-source`, `dsv-invoice-ocr` 버킷은 `ASIA-NORTHEAST3`, uniform bucket-level access로 생성된 기록이 있다.
- 같은 문서 기준 `svc-invoice-parser` 서비스계정에 bucket-level `roles/storage.objectViewer`, `roles/storage.objectCreator` 권한을 부여한 기록이 있다. 보고서에는 계정 이메일 전체값을 반복하지 않는다.
- live Vision OCR smoke는 `gs://dsv-invoice-source/smoke/HVDC-ADOPT-SCT-0122_DO.pdf` 입력과 `gs://dsv-invoice-ocr/smoke/.../output-*.json` 출력으로 `STARTED → DONE → COLLECTED`를 확인했다.
- FastAPI route-level smoke도 `/v1/vision/start` 및 `/v1/vision/collect` 기준 `route_smoke_result: PASS`, `final_status: COLLECTED`, `page_count: 4`, `confidence: 0.9609` 기록이 있다.

**보안 / 원문 노출 정책**
- raw PDF 내용과 raw OCR text는 콘솔, trace, workbook에 그대로 출력하지 않는다.
- 운영 trace에는 GCS URI, hash, page count, confidence, parser summary, `text_span_hash` 같은 감사 참조만 남긴다.
- NotebookLM/MarkItDown은 dual extraction 보조 경로이며 최종 PASS/AMBER/ZERO 판정 권한이 없다.

**파싱 시점**: PDF는 업로드가 아니라 **검증 실행(`/api/invoice-audit/run`)** 시 Cloud Run 워커 `/v1/parse`에서 파싱.

## 12. 교차검증 업데이트 (2026-06-16)

| 항목 | 코드/문서 기준 | 현재 판정 |
|---|---|---|
| Worker PDF 기본 파서 | `app/routes/parse.py` → `parse_pdf_text_bytes()` → `pdfplumber` | 확인됨 |
| DSV SHPT PDF 라인 추출 | `extract_dsv_from_text()` + `_dsv_lines_to_invoice_lines()` | 확인됨 |
| 일반 비-DSV PDF 라인 추출 | `extract_generic_invoice_lines()` + `parse.py` DSV-empty fallback | 구현 완료 |
| zero-line guard | web run route `NO_INVOICE_LINES_EXTRACTED` AMBER | 라인 0건 최후 안전망으로 유지 |
| Vision route 이름 | `/v1/preflight`, `/v1/vision/start`, `/v1/vision/collect` | 본문 보정 완료 |
| Vision GCS smoke | GCP worklog live + route-level smoke PASS | 확인됨 |
| Vision 운영 자동화 조건 | `gs://` 입력 + web/worker env 필요 | 조건부 |
| Rule #0 | PDF-only도 13-sheet export path 유지, 라인 0이면 AMBER | 유지 필요 |

## 13. Track ① 구현 반영 (2026-06-16)

| 항목 | 반영 내용 | 검증 |
|---|---|---|
| Generic mapper | `apps/worker-py/app/parsers/pdf_text.py`에 `extract_generic_invoice_lines()` 추가. 테이블 후보 우선, 텍스트 라인 fallback, 통화/금액 정규식, line confidence 계산. | Worker PDF parser tests 포함 |
| Parse route fallback | `apps/worker-py/app/routes/parse.py`에서 DSV 라인 추출 결과가 빈 경우에만 generic mapper 호출. | DSV 회귀 결과 불변 확인 |
| Tests | `apps/worker-py/tests/test_pdf_text_parser.py`에 text-pdf-001/002 라인 추출, low-text no-crash, DSV 경계 테스트 추가. | Worker 전체 190/190 pass, PDF 관련 28개 pass |
| Web regression | generic PDF가 라인을 만들면 기존 MCP/gate 검증 파이프라인에 진입한다. | Web typecheck 0 errors, Web tests 327/327 pass |

**남은 경계**: Vision OCR Track ②는 아직 별도다. 스캔/이미지 PDF, BOE/customs, low confidence, subtotal 불명확 케이스는 자동 PASS가 아니라 AMBER/ZERO 경계와 13-sheet trace로 처리한다.
