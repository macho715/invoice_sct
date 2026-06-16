# Google Cloud Vision 기반 DSV PDF Parser 로직 가이드

작성일: 2026-06-15
대상 repo: `SCT_ONTOLOGY-main`
목적: Google Cloud Vision OCR 결과가 실제 invoice/evidence parser에서 잘 쓰이도록 사전 파싱 로직을 고정한다.

## 1. 핵심 판정

Google Cloud Vision은 parser가 아니다.
Vision은 PDF/image에서 OCR text와 page/word confidence를 만드는 OCR layer다.

따라서 실제 parser 품질은 아래 순서로 결정한다.

```text
PDF/Image
  -> Google Vision OCR JSON
  -> Vision text/page/block normalizer
  -> DSV parser rules
  -> EvidenceCandidate / SourceDataRow / InvoiceLine
  -> MCP audit / Gate
```

즉, `pdf_hybrid_parser_pro_v2_1.py`의 DSV 규칙을 Vision OCR text에 적용해야 한다.

## 2. 현재 기준 파일

참조할 로직:

```text
dsv docs/pdf_parse_patch_v2_1_bundle/pdf_hybrid_parser_pro_v2_1.py
dsv docs/pdf_parse_patch_v2_1_bundle/parser_out_v2_1_final/pdf_evidence_index.json
dsv docs/pdf_parse_patch_v2_1_bundle/parser_out_v2_1_final/pdf_line_items.csv
apps/worker-py/app/services/vision_normalizer.py
apps/worker-py/app/services/vision_client.py
apps/worker-py/app/schemas.py
apps/worker-py/app/parsers/pdf_text.py
```

현재 v2.1 parser 결과:

```text
PDFs: 16
Extracted line items: 30
Verdict: PASS 12 / AMBER 4
Issues: 5
text_source: native 16
```

## 3. Vision OCR 결과에서 보존해야 하는 정보

Vision JSON에서 반드시 보존할 것:

| Vision field | Parser 사용처 |
|---|---|
| `fullTextAnnotation.text` | DSV parser rule 입력 text |
| page index | `SourceDataRow.pdf_page`, line item page |
| block/paragraph/word confidence | parser confidence, OCR low-confidence AMBER |
| word order | invoice line/table fallback parsing |
| source GCS URI | artifact trace |
| OCR output JSON GCS URI | `extraction_artifacts.gcs_uri` |

Vision JSON에서 바로 버리지 말아야 할 것:

```text
page number
block text
paragraph text
word confidence
bounding box
```

이유:

DSV invoice/BOE/DO 문서는 문서 상단 header, line table, customs debit note page처럼 위치와 줄 순서가 중요하다.

## 4. Vision Normalizer 목표 구조

현재 `vision_normalizer.py`는 아래 정도만 한다.

```text
full text join
average confidence
HVDC/BL/DO/INV/PO/BOE regex evidence extraction
invoice_no / total 추출
```

실제 DSV parser 품질을 위해 아래 구조로 확장해야 한다.

```text
normalize_vision_output()
  -> normalize_text()
  -> classify_doc()
  -> extract_common_keys()
  -> extract_line_items()
  -> type_b_from_lines()
  -> evidence_status_for_doc()
  -> gate_verdict()
  -> build NormalizedInvoice/EvidenceCandidate/SourceDataRow
```

## 5. v2.1 Parser에서 Vision에 이식할 핵심 함수

우선 이식 대상:

| v2.1 함수 | Vision parser 역할 |
|---|---|
| `normalize_text()` | OCR artifact 정리. line break와 깨진 공백 보정 |
| `norm_for_match()` | DOC_TYPE fingerprint 비교용 normalization |
| `classify_doc()` | BOE/DO/Carrier/Port/Airport 문서 분류 |
| `extract_shipments()` | HVDC shipment 번호 추출 |
| `extract_containers()` | ISO 6346 container 추출 및 검증 |
| `extract_bl_numbers()` | BL/MBL/BOL 추출 |
| `extract_awb()` | MAWB/HAWB 추출 |
| `extract_do_numbers()` | DO/DN 번호 추출 |
| `extract_invoice_numbers()` | invoice number 추출 |
| `extract_dates()` | invoice/evidence date 추출 |
| `extract_context_amounts()` | AED 금액 추출. bank/account/TRN line 제외 |
| `extract_common_keys()` | 위 key들을 하나로 합침 |
| `parse_text_line_items()` | OCR text 기반 carrier/port/customs line item 추출 |
| `type_b_from_lines()` | line item 기반 TYPE_B 결정 |
| `evidence_status_for_doc()` | MATCHED_AMOUNT/PARTIAL/MISSING 결정 |
| `gate_verdict()` | parser 단계 PASS/AMBER/ZERO 결정 |
| `sanitize_keys()` | P2 마스킹 |
| `dlp_scan_text()` | raw OCR text 로그 차단 확인 |

나중에 이식할 대상:

| v2.1 함수 | 이유 |
|---|---|
| `parse_table_line_items()` | Vision OCR만으로는 table 구조가 약하다. OCR bounding box table reconstruction 뒤 이식 |
| `render_qa()` | local PyMuPDF QA 렌더링용. Cloud Vision parser core에는 필수 아님 |
| `write_excel()` | worker exporter와 별도 책임 |

## 6. DOC_TYPE 분류 규칙

Vision OCR text에 가장 먼저 적용할 규칙은 `classify_doc()`이다.

우선순위:

```text
1. PORT_CSP
2. PORT_ALLIED
3. AIRPORT_FEES
4. AIRPORT_APPOINTMENT
5. BOE_CUSTOMS
6. DELIVERY_ORDER
7. DELIVERY_NOTE
8. CARRIER_CMA
9. CARRIER_RHS
10. CARRIER_EVG
11. UNKNOWN
```

중요한 이유:

`TAX INVOICE`만 보고 carrier invoice로 분류하면 Port/CNT invoice가 오분류된다.
따라서 CSP/Allied/Airport 같은 특수 port 패턴을 generic carrier invoice보다 먼저 판정해야 한다.

## 7. COMMON_KEYS 추출 규칙

Vision OCR text에서 추출할 key:

```text
shipment_nos
containers
bl_nos
mawb_nos
hawb_nos
do_nos
invoice_nos
dates
amounts_aed
```

주의 규칙:

| 항목 | 주의 |
|---|---|
| container | ISO 6346 check digit 검증을 먼저 적용 |
| BL | container나 invoice number로 보이는 값은 제외 |
| AWB | air context가 있을 때만 MAWB/HAWB 추출 |
| amount | IBAN, account, bank, SWIFT, TRN line은 제외 |
| invoice_no | `DATE`, `COPY`, `PLEASE` 같은 label 오검출 제외 |

## 8. Line Item 추출 규칙

Vision OCR parser의 실제 품질은 line item 추출에서 결정된다.

OCR text 우선 적용 대상:

| 문서 유형 | 추출 규칙 |
|---|---|
| `CARRIER_RHS` | carrier row: description + currency + amount/vat/total |
| `PORT_ALLIED` | `Being Admin & Inspection Charges`, `TWCS Inspection Charges` |
| `AIRPORT_FEES` | Appointment/DPC/Maqta Charges |
| `CARRIER_CMA` | Container Return Service Charge |
| `CARRIER_EVG` | ISPS/D, Container Maintenance Charge |
| `BOE_CUSTOMS` | DEBIT NOTE section의 Pre-Clear Debit |

각 line item은 최소 아래 필드를 만든다.

```text
line_id
page
source = vision:text:<rule>
description
container
currency
amount_aed
vat_aed
total_aed
type_b
evidence_status
extraction_note
```

Worker `InvoiceLine` 매핑:

| LineItem | InvoiceLine |
|---|---|
| `line_id` | `line_id` |
| `shipment_no` | `shipment_ref` |
| `description` | `description` |
| `amount_aed` 또는 `total_aed` | `amount` |
| `currency` | `currency` |
| `type_b` | `type_b` |
| `source/page/hash` | `source_ref` |

## 9. EvidenceCandidate 매핑

Vision parser는 원문 전체를 DB에 저장하지 않는다.

`EvidenceCandidate` 생성 규칙:

| 값 | 생성 방식 |
|---|---|
| `source_file_id` | file_id |
| `text_span` | `vision:p{page}:sha256:<hash>` |
| `matched_reference` | shipment/container/BL/DO/BOE/invoice 후보 |
| `confidence` | Vision word confidence 평균 또는 fallback |
| `doc_kind` | DOC_TYPE 또는 key type |
| `waybill_fields` | shipment/container/BL/DO/MAWB/HAWB 요약 |

예:

```json
{
  "source_file_id": "file_x",
  "text_span": "vision:p1:sha256:abcd1234",
  "matched_reference": "HVDC-ADOPT-SCT-0123",
  "confidence": 0.86,
  "doc_kind": "CARRIER_RHS",
  "waybill_fields": {
    "shipment_no": "HVDC-ADOPT-SCT-0123",
    "container": "HMMU6089377"
  }
}
```

## 10. SourceDataRow 매핑

Vision OCR trace용 row:

| SourceDataRow | 생성 방식 |
|---|---|
| `file_id` | file_id |
| `source_ref` | `vision_page_<n>` |
| `original_text` | synthetic/test만 full. 운영은 최대 500자 또는 저장 금지 |
| `normalized_value` | shipment_no, amount, container 등 |
| `confidence` | page/word confidence |
| `routing_pattern` | `VISION_OCR_TEXT`, `VISION_LINE_ITEM`, `VISION_DOC_TYPE` |
| `pdf_page` | Vision page index |
| `text_span_hash` | page/line text sha256 |
| `doc_type` | classified DOC_TYPE |
| `shipment_id` | HVDC shipment no |
| `gate_status` | parser gate verdict |

운영 정책:

```text
raw OCR text는 로그에 남기지 않는다.
DB에는 hash/ref/요약값 중심으로 저장한다.
```

## 11. Gate 규칙

Vision OCR 결과는 자동 최종 승인 근거가 아니다.
Parser 단계에서만 PASS/AMBER/ZERO를 제안한다.

AMBER 조건:

```text
UNKNOWN_DOCTYPE
OCR_FALLBACK_USED
LOW_TEXT_LENGTH
CUSTOMS_FINAL_REVIEW_REQUIRED
INVOICE_AMOUNT_MISSING
NO_SHIPMENT_NO
VISION_LOW_CONFIDENCE
```

BOE/Customs:

```text
BOE_CUSTOMS는 Customs/HS/UAE 최종 판단 대상이므로 자동 PASS 금지.
최소 AMBER로 Human Gate에 보낸다.
```

ZERO 조건:

```text
최종 승인 요청인데 공식 증빙이 없거나,
DEM/DET/Storage settlement 근거가 없거나,
auditable subtotal이 없으면 ZERO.
```

## 12. Google Vision OCR 품질을 높이는 입력 가이드

Cloud Vision에 넣을 PDF는 아래 조건을 지키는 것이 좋다.

```text
원본 PDF 사용
압축/캡처 이미지 재저장 금지
페이지 회전 보정
암호화 PDF 제외
10MB 이상은 사전 split 검토
GCS input/output 같은 project 또는 권한 확인
batch_size=1 유지
```

OCR output parsing 시:

```text
page별로 OCR JSON 분리
page order 유지
line break 보존
Arabic/English mixed order normalize
confidence 낮은 page는 AMBER
```

## 13. 구현 순서

1. `vision_normalizer.py`에 v2.1 parser 규칙을 직접 복사하지 말고 모듈화해서 이식한다.
2. `dsv_vision_rules.py` 같은 새 파일에 DSV DOC_TYPE/COMMON_KEYS/LINE_ITEM 규칙을 둔다.
3. `normalize_vision_output()`은 Vision JSON을 text/page/confidence로 풀고 DSV rules를 호출한다.
4. 반환값에 아래를 포함한다.

```text
doc_type
doc_type_confidence
keys
line_items
evidence_candidates
source_data_rows
parser_issues
parser_verdict
```

5. `routes/vision.py`의 collect 이후 normalizer를 호출한다.
6. Web run route에서는 Vision 결과가 와도 기존 parser/MCP verdict를 깨지 않게 한다.

## 14. 테스트 가이드

필수 테스트:

```text
test_vision_dsv_doc_type.py
test_vision_dsv_common_keys.py
test_vision_dsv_line_items.py
test_vision_normalizer.py
test_vision_routes.py
```

fixture는 실제 고객 원문이 아니라 synthetic text를 사용한다.

테스트 케이스:

| 케이스 | 기대 |
|---|---|
| RHS carrier invoice OCR text | `CARRIER_RHS`, carrier line items |
| Allied/TWCS inspection OCR text | `PORT_ALLIED`, Inspection line |
| BOE + Debit Note OCR text | `BOE_CUSTOMS`, Customs AMBER |
| Delivery Order OCR text | `DELIVERY_ORDER`, DO key |
| Airport fee OCR text | `AIRPORT_FEES`, fee line |
| Low text/confidence | AMBER |
| Bank/TRN lines with AED numbers | amount에서 제외 |

## 15. 현재 차단과 무관한 준비 작업

Billing 미연결로 live OCR은 아직 못 하지만, parser 로직 준비는 지금 가능하다.

지금 할 수 있는 것:

```text
DSV parser rules 모듈화
Vision JSON synthetic fixture 작성
Vision normalizer 반환 schema 확장
line item mapping test 작성
DLP/raw text 저장 금지 테스트 작성
```

Billing 연결 후 할 것:

```text
sample PDF GCS 업로드
/v1/vision/start live smoke
/v1/vision/collect live smoke
OCR JSON을 dsv_vision_rules에 통과
pdf_line_items.csv와 유사한 결과 비교
```

## 16. 최종 가이드

Google Cloud Vision 연결의 성공 기준은 OCR API 호출 성공이 아니다.

성공 기준은 아래다.

```text
Vision OCR JSON에서
DSV 문서유형을 맞히고,
shipment/container/BL/DO/invoice/date/amount를 추출하고,
line item을 만들고,
EvidenceCandidate와 SourceDataRow로 연결하고,
BOE/Customs와 low-confidence는 AMBER로 안전하게 보내는 것.
```

따라서 다음 구현은 `vision_normalizer.py` 확장보다 먼저,
`pdf_hybrid_parser_pro_v2_1.py`의 DSV rule을 작은 독립 모듈로 분리하는 방식이 가장 안전하다.

