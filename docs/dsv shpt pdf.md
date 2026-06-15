판정: **조건부 PASS — DSV SHPT 케이스의 PDF parse 로직은 “Excel LineItem 기준 → 관련 PDF 선별 → page text 추출 → 금액/키워드/Shipment token 3중 매칭 → Evidence Map 생성” 구조로 고정하는 것이 맞습니다.**
근거: DSV SHPT 인보이스 검증은 계약/요율 기준이 **USD, FX 3.6725, tolerance 3.00%**로 이미 정의되어 있고, PDF text extraction은 `pypdf`의 `PdfReader/page.extract_text()`가 1차 방식입니다.   ([pypdf][1])
다음행동: 아래 로직을 **DSV_SHPT_PDF_PARSE_v1.0**으로 고정하고, 재발행 시 `PDF_PARSED_TEXT`, `LINE_DETAIL Evidence(PDF)`, `MASTER_SUMMARY`에 강제 반영하십시오.

---

# DSV SHPT PDF Parse Logic Report

## 대상: 2026년 1월 DSV SHPT Invoice + SuppDocs/ShippingDocs

## 1. 핵심 목적

DSV SHPT 케이스의 PDF parser는 단순히 PDF 내용을 텍스트로 뽑는 기능이 아닙니다. 목적은 **DSV invoice Excel의 각 청구 라인과 증빙 PDF의 근거 위치를 연결**하는 것입니다.

```text
DSV SHPT Excel LineItem
→ 해당 Shipment / DSV Draft Invoice Ref 식별
→ 관련 SuppDocs/ShippingDocs PDF 검색
→ PDF page text 추출
→ 금액 + 키워드 + Shipment token 매칭
→ Evidence(PDF) = 파일명 + 페이지 + snippet 생성
→ Final Verification Report Template에 삽입
```

---

## 2. DSV SHPT 케이스의 입력 구조

| No | Input                                     | Parser Type            | 역할                                                                  |
| -: | ----------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
|  1 | `DSV SHPT 202601.xlsx`                    | Excel Parser           | 원천 청구 데이터                                                           |
|  2 | `Invoice_Audit_DSV_2026-01.xlsx`          | Excel/DataFrame Parser | 검증 완료/미완료 LineItems                                                 |
|  3 | `Final Verification Report_Template.xlsx` | Template Writer        | 최종 보고서 양식                                                           |
|  4 | `*_SuppDocs.pdf`                          | PDF Parser             | Debit Note, Duty, Gate Pass, Storage, Appointment, DPC 등 at-cost 증빙 |
|  5 | `*_ShippingDocs.pdf`                      | PDF Parser             | AWB/BL, CI/PL, Customs, shipment identity 증빙                        |
|  6 | Rate Reference files                      | Rate Parser            | Contract 요율 기준                                                      |

요율 기준은 Air/Container/Bulk/Inland로 분리합니다. Air/Container/Bulk rate 파일은 모두 USD 기준, fixed FX `USD_AED = 3.6725`, contract tolerance `0.03`, autofail threshold `0.15`를 포함합니다.   

---

# 3. 전체 Parser Architecture

```text
┌─────────────────────────────────────────────┐
│ 1. DSV SHPT Excel Loader                    │
│    - Shipment No                            │
│    - DSV Draft Invoice Ref                  │
│    - Description                            │
│    - Amount USD / AED / Qty                 │
│    - Rate Source                            │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│ 2. PDF Registry Builder                     │
│    - *_SuppDocs.pdf                         │
│    - *_ShippingDocs.pdf                     │
│    - page count / SHA / file type           │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│ 3. Page Text Extractor                      │
│    - pypdf/PyPDF2 extract_text()            │
│    - OCR fallback if text layer empty       │
│    - PII Mask + illegal char cleaning       │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│ 4. Doc Type Classifier                      │
│    - Air Waybill                            │
│    - Customs Declaration                    │
│    - Invoice/Debit                          │
│    - Gate Pass                              │
│    - Delivery/Dispatch                      │
│    - Other                                  │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│ 5. Evidence Matcher                         │
│    - Shipment token                         │
│    - Amount anchor                          │
│    - Keyword anchor                         │
│    - Page snippet                           │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│ 6. Report Writer                            │
│    - MASTER_SUMMARY                         │
│    - LINE_DETAIL                            │
│    - PDF_PARSED_TEXT                        │
│    - Individual Shipment Sheets             │
└─────────────────────────────────────────────┘
```

---

# 4. Step 1 — DSV SHPT Excel LineItem Parsing

DSV SHPT의 기준 테이블은 PDF가 아니라 Excel입니다. 따라서 첫 단계는 **invoice line을 정확히 분해**하는 것입니다.

## 4.1 필수 컬럼

| Column                  | 의미                                         | 필수 여부 |
| ----------------------- | ------------------------------------------ | ----- |
| `No`                    | Line No                                    | 필수    |
| `SHIPMENT NO.`          | Order Ref. Number                          | 필수    |
| `DSV DRAFT INVOICE REF` | Job No(s)                                  | 필수    |
| `RATE SOURCE`           | CONTRACT / AT COST / DSV HANDLING          | 필수    |
| `DESCRIPTION`           | 청구 항목                                      | 필수    |
| `AMOUNT USD`            | 단가 USD                                     | 필수    |
| `Q'TY`                  | 수량                                         | 필수    |
| `TOTAL AMOUNT USD`      | 총액 USD                                     | 필수    |
| `AMOUNT AED`            | 단가 AED                                     | 필수    |
| `TOTAL AMOUNT AED`      | 총액 AED                                     | 필수    |
| `Expected Rate USD`     | 검증 기준 단가                                   | 권장    |
| `Expected Total USD`    | 검증 기준 총액                                   | 권장    |
| `Validation Status`     | VERIFIED / PENDING_REVIEW / FAIL           | 필수    |
| `Evidence`              | DOC_FOUND / NONE / LANE_EVIDENCE_MISSING 등 | 필수    |
| `Notes`                 | 검증 설명                                      | 권장    |

## 4.2 LineItem 정규화

```python
line_df.columns = [str(c).strip() for c in line_df.columns]

line_df["RATE SOURCE"] = line_df["RATE SOURCE"].str.upper().str.strip()
line_df["SHIPMENT NO."] = line_df["SHIPMENT NO."].str.strip()
line_df["DSV DRAFT INVOICE REF"] = line_df["DSV DRAFT INVOICE REF"].str.strip()
```

## 4.3 Rate Source 분기

| Rate Source             | 의미                      | 검증 방식                      |
| ----------------------- | ----------------------- | -------------------------- |
| `CONTRACT`              | 계약요율/Reference rate로 검증 | Rate table ±3.00%          |
| `AT COST`               | 실제 증빙 금액 기반             | PDF amount anchor 필수       |
| `DSV HANDLING`          | DSV 자체 handling/수수료성 비용 | Reference 또는 증빙 없으면 보류     |
| `LANE_EVIDENCE_MISSING` | 요율은 맞지만 lane 증빙 부족      | Dispatch/Delivery proof 필요 |

---

# 5. Step 2 — PDF Registry Builder

## 5.1 PDF 후보 선정

DSV SHPT 케이스에서는 모든 PDF를 대상으로 하지 않습니다. 아래 패턴만 parse 대상으로 합니다.

```python
pdf_candidates = [
    fn for fn in os.listdir(base_dir)
    if fn.lower().endswith(".pdf")
    and (
        "suppdocs" in fn.lower()
        or "shippingdocs" in fn.lower()
        or "final_invoice_verification_report" in fn.lower()
    )
]
```

## 5.2 PDF Type 구분

| PDF Type         | 파일명 예시                                 | 역할                                                     |
| ---------------- | -------------------------------------- | ------------------------------------------------------ |
| ShippingDocs     | `HVDC-ADOPT-SCT-0175_ShippingDocs.pdf` | AWB/BL, CI/PL, customs, shipment identity              |
| SuppDocs         | `HVDC-ADOPT-SCT-0175_SuppDocs.pdf`     | Appointment, DPC, Gate Pass, Debit Note, Storage, Duty |
| Final Report PDF | 기존 보고서                                 | trace 보조용, 원칙상 증빙 원문보다 후순위                             |

## 5.3 Registry output

```json
{
  "pdf_file": "HVDC-ADOPT-SCT-0175_SuppDocs.pdf",
  "pages": 12,
  "type": "SuppDocs",
  "shipment_tokens": ["SCT-0175", "0175"],
  "sha256": "..."
}
```

---

# 6. Step 3 — PDF Text Layer Extraction

## 6.1 기본 방식

1차 parser는 `pypdf/PyPDF2`의 text layer extraction입니다.

```python
from pypdf import PdfReader

reader = PdfReader(pdf_path)

for page_no, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ""
```

pypdf 공식 문서는 `PdfReader`로 PDF를 열고 `page.extract_text()`로 page text를 추출하는 방식을 제시합니다. 또한 `extraction_mode="layout"` 옵션도 지원합니다. ([pypdf][1])

## 6.2 Layout mode 옵션

DSV 문서는 표/금액/Arabic-English 혼합이 많으므로 아래 우선순위를 권장합니다.

```python
text = page.extract_text(extraction_mode="layout")
```

Fallback:

```python
text = page.extract_text() or ""
```

## 6.3 Memory guard

대형 PDF는 page content stream이 커질 수 있습니다. pypdf 문서도 page content parsing이 메모리를 많이 사용할 수 있다고 경고합니다. ([pypdf][1])

```python
content_size = len(page.get_contents().get_data())
if content_size > MAX_CONTENT_SIZE:
    mark_as_large_page()
```

---

# 7. Step 4 — OCR Fallback 조건

pypdf는 OCR 소프트웨어가 아니며, 스캔 PDF에서 텍스트가 비어 있으면 직접 이미지 문자를 읽을 수 없습니다. pypdf 문서도 스캔 문서에서 추출 텍스트가 비어 있거나 최소일 수 있고, 이런 경우 OCR 사용을 권장합니다. ([pypdf][1])

## 7.1 OCR_REQUIRED 판정

| 조건                       | 상태           |
| ------------------------ | ------------ |
| `len(text.strip()) < 30` | OCR_REQUIRED |
| 숫자 금액이 전혀 없음             | OCR_REQUIRED |
| Page image-only          | OCR_REQUIRED |
| Arabic/English 깨짐 심함     | OCR_REVIEW   |
| 표 구조가 완전히 붕괴             | TABLE_REVIEW |

## 7.2 OCR Fallback 결과 구조

```json
{
  "parser": "OCR",
  "page": 7,
  "text": "...",
  "confidence": 0.94,
  "bbox": [[x1,y1], [x2,y2]],
  "status": "OCR_EXTRACTED"
}
```

## 7.3 고도화 옵션

Google Document AI는 처리 응답에서 text, pages, entities, confidence 등 구조화된 결과를 제공합니다. Document AI를 적용하면 현재 `Doc/Page/Snippet` 수준 Evidence를 `Doc/Page/Field/Confidence/BoundingBox`까지 확장할 수 있습니다. ([Google Cloud][2])
Amazon Textract는 invoice/receipt 분석용 `AnalyzeExpense` 기능을 제공하므로 영수증/청구서형 증빙에는 OCR+entity extraction 대안으로 적합합니다. ([docs.aws.amazon.com][3])

---

# 8. Step 5 — PII Masking 및 Excel Safe Text

DSV SuppDocs에는 연락처, 이메일, 계정정보, Arabic/English 혼합 텍스트가 포함될 수 있으므로 Excel 적재 전 정제합니다.

## 8.1 PII Mask

```python
def mask_pii(text):
    text = re.sub(email_regex, "[MASKED_EMAIL]", text)
    text = re.sub(phone_regex, "[MASKED_PHONE]", text)
    text = re.sub(iban_regex, "[MASKED_IBAN]", text)
    return text
```

## 8.2 Excel illegal character 제거

이전 실행 중 Excel 저장 단계에서 `IllegalCharacterError`가 발생할 수 있었기 때문에, 아래 로직을 고정합니다.

```python
def sanitize_excel_text(s):
    return "".join(
        ch for ch in s
        if ch in ("\n", "\r", "\t") or ord(ch) >= 32
    )
```

## 8.3 Text 길이 제한

```python
if len(text) > 1200:
    text = text[:1200] + "\n...[TRUNCATED]"
```

| 출력 위치                            |             권장 길이 |
| -------------------------------- | ----------------: |
| `PDF_PARSED_TEXT.Extracted Text` | 1,200~2,500 chars |
| `Evidence(PDF)`                  |         250 chars |
| `Evidence(PDF) – Full`           | 1,000~2,000 chars |

---

# 9. Step 6 — Document Type Classification

Page별 텍스트를 보고 문서 타입을 분류합니다.

```python
def infer_doc_type(text):
    t = text.lower()

    if "air waybill" in t or "hawb" in t or "mawb" in t:
        return "Air Waybill"

    if "commercial invoice" in t:
        return "Commercial Invoice"

    if "packing list" in t:
        return "Packing List"

    if "gate pass" in t:
        return "Gate Pass"

    if "debit note" in t or "tax invoice" in t or "duty & tax invoice" in t:
        return "Invoice/Debit"

    if "customs declaration" in t or "pre-clear" in t or "bill of entry" in t:
        return "Customs Declaration"

    if "delivery note" in t or "delivery notification" in t or "dispatch" in t:
        return "Delivery/Dispatch"

    return "Other"
```

## DSV SHPT 주요 Doc Type

| Doc Type            | 주 용도                 | 검증 대상                         |
| ------------------- | -------------------- | ----------------------------- |
| Air Waybill         | 항공 shipment identity | AWB, HAWB, MAWB, weight       |
| Commercial Invoice  | CIPL 금액/품목           | Invoice no, HS, value         |
| Packing List        | PKG/WT/CBM           | Qty, weight                   |
| Customs Declaration | BOE/Customs          | duty, customs ref             |
| Invoice/Debit       | At-cost charge       | DPC, Gate Pass, storage, duty |
| Gate Pass           | Gate pass fee/entry  | Gate pass handling            |
| Delivery/Dispatch   | Lane/transport proof | origin/destination/vehicle    |
| Other               | 기타                   | Human review                  |

---

# 10. Step 7 — Shipment Token 생성

DSV SHPT는 **Shipment No와 PDF 파일명이 유사하나 완전히 같지는 않을 수 있으므로** token을 생성합니다.

## 10.1 단일 Shipment

```text
HVDC-ADOPT-SCT-0175
→ SCT-0175
→ 0175
```

## 10.2 복수 Shipment

```text
HVDC-ADOPT-HE-0523,HVDC-ADOPT-HE-0524,HVDC-ADOPT-HE-0525
→ HE-0523, 0523
→ HE-0524, 0524
→ HE-0525, 0525
```

## 10.3 구현

```python
def shipment_tokens(sh):
    parts = [p.strip() for p in sh.split(",")]
    tokens = []

    for p in parts:
        p = p.replace("HVDC-ADOPT-", "")
        tokens.append(p)

        m = re.search(r"([A-Z]{2,3}-\d{4})", p)
        if m:
            tokens.append(m.group(1))

        m2 = re.search(r"(\d{4})", p)
        if m2:
            tokens.append(m2.group(1))

    return sorted(set(tokens))
```

---

# 11. Step 8 — PDF 우선순위 Ranking

동일 금액이 여러 PDF에 반복될 수 있으므로, **관련 Shipment PDF를 먼저 검색**합니다.

```python
def rank_pdfs_for_shipment(sh):
    tokens = shipment_tokens(sh)
    scored = []

    for fn in pdf_candidates:
        score = 0
        low = fn.lower()

        for t in tokens:
            if t.lower() in low:
                score += 3

        if "shippingdocs" in low:
            score += 1

        if "suppdocs" in low:
            score += 1

        scored.append((score, fn))

    return sorted(scored, key=lambda x: (-x[0], x[1]))
```

## Ranking 결과 예시

| Shipment          | 1순위                                                        | 2순위                                    |
| ----------------- | ---------------------------------------------------------- | -------------------------------------- |
| SCT-0175          | `HVDC-ADOPT-SCT-0175_SuppDocs.pdf`                         | `HVDC-ADOPT-SCT-0175_ShippingDocs.pdf` |
| SIM-0109          | `HVDC-ADOPT-SIM-0109_SuppDocs.pdf`                         | 관련 없는 PDF 후순위                          |
| HE-0523/0524/0525 | `HVDC-ADOPT-HE-0523,0524,0525_SuppDocs.pdf`                | 관련 없는 PDF 후순위                          |
| SEI-0002/0004-1   | `HVDC-ADOPT-SEI-0002 & HVDC-ADOPT-SEI-0004-1_SuppDocs.pdf` | 관련 없는 PDF 후순위                          |

---

# 12. Step 9 — Amount Anchor 생성

DSV SHPT line item에서 **검증 가능한 금액 anchor**를 만듭니다.

```python
total_aed = TOTAL AMOUNT AED
unit_aed  = AMOUNT AED

tokens = [
    f"{total_aed:,.2f}",
    f"{total_aed:.2f}",
    f"{int(total_aed)}",
    f"{unit_aed:,.2f}",
    f"{unit_aed:.2f}",
    f"{int(unit_aed)}"
]
```

## 예시

| Charge      |      AED | Anchor 후보                     |
| ----------- | -------: | ----------------------------- |
| Appointment |    27.00 | `27.00`, `27`                 |
| DPC         |    35.00 | `35.00`, `35`                 |
| Storage     | 1,575.00 | `1,575.00`, `1575.00`, `1575` |
| Duty        |   194.75 | `194.75`                      |
| Gate Pass   |    73.50 | `73.50`                       |

---

# 13. Step 10 — Keyword Anchor 생성

금액만으로는 오탐이 발생합니다. 따라서 Description을 기준으로 keyword도 같이 써야 합니다.

```python
keyword_map = {
    "APPOINTMENT": ["appointment", "appointment charges"],
    "DPC": ["dpc", "document processing"],
    "STORAGE": ["storage", "airport storage", "port storage"],
    "DUTY": ["duty", "tax invoice", "total payable"],
    "GATE PASS": ["gate pass"],
    "INSPECTION": ["inspection"],
    "WASHING": ["washing", "container washing"],
    "TRANSPORTATION": ["delivery", "dispatch", "truck", "flatbed", "pickup"],
    "CUSTOMS": ["customs", "declaration", "boe", "bill of entry"],
    "DO": ["delivery order", "do fee", "d/o"]
}
```

## Match Rule

```text
PASS Evidence Match =
Shipment token matched
+ Amount anchor found
+ Keyword anchor found within same page or ±1 page
```

금액만 찾은 경우:

```text
AMBER_MATCH = amount found but keyword not found
```

---

# 14. Step 11 — Evidence Match 판정

## 14.1 판정 단계

```text
Level 1: Shipment PDF filename token match
Level 2: Amount anchor match
Level 3: Keyword anchor match
Level 4: Doc Type 적합성 match
Level 5: Page snippet 생성
```

## 14.2 상태값

| Evidence Status        | 조건                                          | 처리                 |
| ---------------------- | ------------------------------------------- | ------------------ |
| `EVIDENCE_STRONG`      | Shipment + Amount + Keyword + DocType match | Verified 가능        |
| `EVIDENCE_AMOUNT_ONLY` | Amount만 발견                                  | Pending Review     |
| `EVIDENCE_WEAK`        | Shipment match 없음                           | Human check        |
| `EVIDENCE_NOT_FOUND`   | 금액 없음                                       | Pending Evidence   |
| `OCR_REQUIRED`         | text layer 없음                               | OCR 후 재검증          |
| `TABLE_REVIEW`         | 표 구조 깨짐                                     | Human table review |

---

# 15. Step 12 — 실제 Evidence 출력 형식

`LINE_DETAIL`에는 아래 형식으로 들어갑니다.

```text
HVDC-ADOPT-SCT-0175_SuppDocs.pdf p7 [Text: Appointment Charges 1 27.00 ... DPC Charges 1 35.00 ...]
```

## 컬럼별 출력

| Column                  | 값                                    |
| ----------------------- | ------------------------------------ |
| `Evidence Found`        | Y / N                                |
| `Evidence (PDF)`        | 짧은 snippet                           |
| `Evidence (PDF) – Full` | 긴 snippet                            |
| `AUDIT_Flags`           | AT_COST / REF_MISSING / OCR_REQUIRED |
| `AUDIT_Explain`         | 왜 Verified/Pending인지 설명              |

---

# 16. Step 13 — CONTRACT Rate 검증

DSV SHPT에서 `RATE SOURCE = CONTRACT`이면 PDF 증빙보다 **Reference rate**가 우선입니다.

## 16.1 기준

```text
Delta % = (Invoice Rate - Expected Rate) / Expected Rate
```

| 조건                                 | 판정                |
| ---------------------------------- | ----------------- |
| `abs(delta_pct) <= 3.00%`          | ✅ Verified        |
| `3.00% < abs(delta_pct) <= 15.00%` | ⚠️ Pending Review |
| `abs(delta_pct) > 15.00%`          | ❌ Fail / AutoFail |

Air/Container/Bulk rate 파일에 `layer1_contract_tolerance = 0.03`, `autofail_threshold = 0.15`가 설정되어 있습니다.   

## 16.2 Inland Trucking Match Key

Inland Trucking 기준은 다음 4개 키로 match합니다.

```text
Category + Port + Destination + Unit
```

Inland Trucking rate table도 `Category + Port + Destination + Unit` 기준으로 매칭하도록 정의되어 있고, 모든 rate는 USD 2-dec 기준입니다. 

---

# 17. Step 14 — AT COST 검증

`RATE SOURCE = AT COST`인 경우 PDF evidence가 핵심입니다.

## 17.1 처리 로직

```text
1. LineItem의 TOTAL AMOUNT AED 추출
2. Unit Amount AED도 후보로 추가
3. Shipment 관련 SuppDocs 우선 검색
4. 금액 anchor 탐색
5. keyword anchor 확인
6. snippet 생성
7. Evidence Found = Y/N
```

## 17.2 판정

| 조건              | Verification Status  |
| --------------- | -------------------- |
| Evidence Strong | ✅ Verified (At cost) |
| Amount only     | ⚠️ Pending Review    |
| No amount       | ⚠️ Pending Evidence  |
| OCR needed      | ⚠️ OCR_REQUIRED      |
| Amount mismatch | ⚠️ Discrepancy       |

---

# 18. Step 15 — DSV HANDLING 검증

DSV HANDLING은 가장 엄격하게 봐야 합니다.

## 18.1 기본 원칙

```text
DSV HANDLING은 계약 rate 또는 at-cost supporting document가 없으면 자동 승인 금지.
```

## 18.2 판정

| 조건                            | Status                        |
| ----------------------------- | ----------------------------- |
| Contract reference 있음         | Verified 가능                   |
| Supporting invoice/receipt 있음 | Verified 가능                   |
| 금액 anchor만 있음                 | Pending Review                |
| 증빙 없음                         | Ref Missing / Action Required |
| 내부 승인 메일만 있음                  | Pending, 원본 증빙 필요             |

---

# 19. Step 16 — Lane Evidence 검증

운송비는 단순 요율뿐 아니라 **O/D 증빙**이 있어야 합니다.

## 19.1 Lane 필수값

| Field       | 예                                            |
| ----------- | -------------------------------------------- |
| Origin      | MOSB / Khalifa Port / AUH Airport / DSV Yard |
| Destination | Shuweihat / MIRFA / Storage Yard             |
| Vehicle     | 3 Ton PU / Flatbed / Lowbed                  |
| Unit        | per truck / per RT                           |
| Amount      | USD/AED                                      |
| Proof       | Delivery note / Dispatch note / Gate pass    |

O/D lane mapping 시스템은 Origin/Destination/Vehicle/Distance/Rate 기반 scoring을 사용하며, threshold 0.60 이상을 유효 edge로 봅니다. 

## 19.2 운송비 판정

| 조건                                   | Status                |
| ------------------------------------ | --------------------- |
| Rate match + Delivery/Dispatch proof | Verified              |
| Rate match + lane proof 없음           | Lane Evidence Missing |
| Rate 미매칭                             | Pending Review / Fail |
| O/D 불명확                              | ZERO                  |

---

# 20. Step 17 — Output Sheet별 반영

## 20.1 `MASTER_SUMMARY`

Shipment별 집계.

| Column                      | 산출 기준                               |
| --------------------------- | ----------------------------------- |
| Verified (Contract)         | CONTRACT & VERIFIED                 |
| Verified (At cost)          | AT COST & Evidence Strong           |
| Pending Evidence (At cost)  | AT COST & Evidence Not Found        |
| Under Review                | PENDING_REVIEW                      |
| Ref Missing                 | DSV HANDLING 미증빙                    |
| Fail                        | FAIL                                |
| Grand Total                 | 전체 USD                              |
| At-cost Evidence Coverage % | Evidence Found / At-cost line count |
| Overall Status              | OK / ACTION REQUIRED / FAIL         |

## 20.2 `LINE_DETAIL`

LineItem별 상세.

| Column               | 내용                                       |
| -------------------- | ---------------------------------------- |
| Calculation Logic    | Flat rate / Unit × Qty / At cost         |
| Detailed Calculation | AED ÷ 3.6725 × Qty                       |
| Verification Status  | ✅ / ⚠️ / ❌                               |
| Evidence Found       | Y/N                                      |
| Evidence(PDF)        | 파일명 p페이지 snippet                         |
| AUDIT_Flags          | OCR_REQUIRED / REF_MISSING / AMOUNT_ONLY |
| AUDIT_Explain        | 검증 설명                                    |

## 20.3 `PDF_PARSED_TEXT`

모든 PDF page text 저장.

| Column         | 내용                         |
| -------------- | -------------------------- |
| PDF File       | 파일명                        |
| Page           | 1-based page               |
| Doc Type       | 문서 타입                      |
| Extracted Text | masking + cleaning 완료 text |

## 20.4 개별 Shipment Sheet

Template의 `SCT-0140` sheet를 복사하여 shipment별 sheet 생성.

```text
SCT-0167
SCT-0175
HE-0540
SIM-0109
HE-0537
SCT-0164
HE-0523,0524,0525
SEI-0002,0004-1
HE-0499-8
```

---

# 21. Step 18 — 최종 Status 계산

```python
if fail > 0:
    overall = "FAIL"
elif under_review > 0 or ref_missing > 0 or pending_evidence > 0:
    overall = "ACTION REQUIRED"
else:
    overall = "OK"
```

## 기준표

| Overall Status  | 조건                 | 지급 처리       |
| --------------- | ------------------ | ----------- |
| OK              | 모든 line verified   | 지급 가능       |
| ACTION REQUIRED | 일부 증빙/Reference 부족 | 부분 승인 또는 보류 |
| FAIL            | 중대 불일치             | 수정 인보이스 요청  |

---

# 22. DSV SHPT 전용 예외 처리

| Case               | 문제                        | 처리                          |
| ------------------ | ------------------------- | --------------------------- |
| 동일 AED 금액 반복       | 금액 anchor 오탐              | Shipment token + keyword 필수 |
| Arabic/English 혼합  | 텍스트 깨짐                    | OCR/Document AI fallback    |
| `DSV HANDLING`     | Reference 불명확             | 자동 승인 금지                    |
| 복수 Shipment PDF    | `HE-0523,0524,0525` 등     | token split 후 검색            |
| DHL duty rebilling | DHL 원문 금액과 rebill 차이 가능   | 원문 duty invoice amount 우선   |
| Storage            | VAT/base 분리 가능            | base/VAT/total 각각 anchor    |
| Gate Pass          | DP World net/VAT/total 구조 | total + VAT 동시 확인           |
| Transportation     | 요율은 맞아도 lane proof 부족 가능  | Delivery/Dispatch 증빙 필수     |

---

# 23. 품질 Gate

## 23.1 Evidence Coverage KPI

```text
Evidence Coverage % =
Evidence Found lines / Evidence Required lines × 100
```

목표:

| KPI                       |       기준 |
| ------------------------- | -------: |
| At-cost Evidence Coverage | ≥ 98.00% |
| Numeric Integrity         |  100.00% |
| Contract Rate Match       | ≥ 97.00% |
| Pending Evidence          | ≤ 15.00% |
| DSV Handling Ref Missing  | 0.00% 목표 |

## 23.2 Fail-safe

| Trigger                 | 처리                    |
| ----------------------- | --------------------- |
| OCR_REQUIRED            | Verified 금지           |
| Evidence amount only    | Pending Review        |
| DSV HANDLING no support | Ref Missing           |
| O/D proof 없음            | Lane Evidence Missing |
| FX mismatch             | Currency Mismatch     |
| Δ > 15.00%              | AutoFail              |

---

# 24. DSV SHPT Parser Pseudocode

```python
def parse_dsv_shpt(invoice_xlsx, template_xlsx, pdf_dir):
    # 1. Load invoice line items
    line_df = load_invoice_audit(invoice_xlsx)

    # 2. Load PDF registry
    pdfs = find_pdfs(pdf_dir, patterns=["SuppDocs", "ShippingDocs"])

    # 3. Parse PDF pages
    pdf_pages = []
    for pdf in pdfs:
        for page_no, page in enumerate(pdf.pages, start=1):
            text = extract_text_layer(page)

            if is_text_empty(text):
                text = run_ocr(page)
                parser = "OCR"
            else:
                parser = "TEXT"

            text = mask_pii(text)
            text = sanitize_excel_text(text)

            pdf_pages.append({
                "pdf": pdf.name,
                "page": page_no,
                "doc_type": infer_doc_type(text),
                "parser": parser,
                "text": text
            })

    # 4. Evidence match
    for line in line_df:
        if line.rate_source in ["AT COST", "DSV HANDLING"]:
            candidate_pdfs = rank_pdfs_for_shipment(line.shipment_no, pdfs)
            amount_tokens = build_amount_anchors(line)
            keyword_tokens = build_keyword_anchors(line.description)

            evidence = match_evidence(
                candidate_pdfs,
                amount_tokens,
                keyword_tokens
            )

            line.evidence_found = evidence.status
            line.evidence_pdf = evidence.snippet
            line.verification_status = decide_status(line, evidence)

        elif line.rate_source == "CONTRACT":
            line.verification_status = validate_contract_rate(line)

    # 5. Write report
    write_master_summary(line_df)
    write_line_detail(line_df)
    write_pdf_parsed_text(pdf_pages)
    write_individual_shipment_sheets(line_df)

    return final_report_xlsx
```

---

# 25. 최종 운영 규칙 YAML

```yaml
DSV_SHPT_PDF_PARSE_v1_0:
  parser_priority:
    - pypdf_text_layer
    - pypdf_layout_mode
    - OCR_fallback
    - DocumentAI_or_Textract_optional

  pdf_scope:
    include:
      - "*_SuppDocs.pdf"
      - "*_ShippingDocs.pdf"
    exclude:
      - unrelated_pdf
      - image_only_without_ocr

  match_keys:
    primary:
      - shipment_token
      - amount_anchor
      - keyword_anchor
    secondary:
      - doc_type
      - page_neighborhood
      - invoice_ref

  evidence_required_for:
    - AT_COST
    - DSV_HANDLING
    - DUTY_REBILLING
    - STORAGE
    - GATE_PASS
    - APPOINTMENT
    - DPC
    - INSPECTION
    - WASHING
    - TRANSPORTATION_LANE_PROOF

  contract_validation:
    currency: USD
    fx_usd_aed: 3.6725
    tolerance: 0.03
    autofail: 0.15

  output_sheets:
    - MASTER_SUMMARY
    - LINE_DETAIL
    - PDF_PARSED_TEXT
    - SHIPMENT_DETAIL_SHEETS

  fail_safe:
    scan_pdf_no_text: OCR_REQUIRED
    no_evidence_for_at_cost: PENDING_EVIDENCE
    no_reference_for_dsv_handling: REF_MISSING
    lane_without_delivery_proof: LANE_EVIDENCE_MISSING
    amount_only_match: PENDING_REVIEW
    fx_mismatch: CURRENCY_MISMATCH
```

---

# 26. 결론

DSV SHPT PDF parse의 핵심은 다음입니다.

```text
Invoice Excel을 기준 source로 삼고,
PDF는 각 line item의 증빙 source로만 사용한다.
PDF parser는 text 추출이 아니라 Evidence 생성 엔진으로 동작해야 한다.
```

최종적으로 `LINE_DETAIL`의 각 line은 아래 형태를 가져야 합니다.

```text
No 5 / SCT-0175 / Appointment Fee / AED 27.00 / USD 7.35
→ Evidence Found = Y
→ Evidence(PDF) = HVDC-ADOPT-SCT-0175_SuppDocs.pdf p7 [Text: Appointment Charges 1 27.00 ...]
→ Status = ✅ Verified (At cost)
```

## ZERO log

| No | ZERO 조건                                     | 처리                    |
| -: | ------------------------------------------- | --------------------- |
|  1 | `DSV HANDLING`인데 reference/증빙 없음            | 자동 승인 금지              |
|  2 | PDF text layer 없음                           | OCR 전환 전 Verified 금지  |
|  3 | 금액만 match되고 keyword 없음                      | Pending Review        |
|  4 | Transportation인데 Delivery/Dispatch proof 없음 | Lane Evidence Missing |
|  5 | HS/Customs/Duty 관련 금액 불일치                   | 증빙 원문 우선, 재검증 필요      |

[1]: https://pypdf.readthedocs.io/en/stable/user/extract-text.html "Extract Text from a PDF — pypdf 6.13.2 documentation"
[2]: https://cloud.google.com/document-ai/docs/handle-response "Handle processing response  |  Document AI  |  Google Cloud Documentation"
[3]: https://docs.aws.amazon.com/textract/latest/dg/analyzing-document-expense.html "Analyzing Invoices and Receipts with Amazon Textract - Amazon Textract"
