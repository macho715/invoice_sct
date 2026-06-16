# HVDC PDF Parse PRO v2.1 — Patched Procedure & Logic

**Generated**: 2026-06-15  
**Patch Target**: `pdf_hybrid_parser.py` → `pdf_hybrid_parser_pro_v2_1.py`  
**Scope**: Uploaded DSV shipment PDFs + Project Source Package v3.2  
**Status**: Parser patch complete. This is a parse/evidence-index tool, not a final invoice approval tool.

---

## 1. Executive Summary

| Item | Result |
|---|---:|
| Project Source Scan | PASS |
| Contract Source | PRESENT_MASKED |
| Test PDFs | 16 |
| Parse Result | PASS 12 / AMBER 4 / FAIL 0 / ZERO 0 |
| DOC_TYPE UNKNOWN | 1 scanned DN only |
| Extracted Line Items | 30 |
| Evidence_Status Blank | 0 |
| TYPE_B Blank | 0 |
| DLP Mode | Raw full text not exported; BL/AWB/DO/Invoice masked by default |

**Key patch outcome**: 기존 `TAX INVOICE` 단독 매칭으로 Port/CNT invoice가 `CARRIER_RHS`로 오분류되던 문제를 제거했고, `PORT_ALLIED`, `PORT_CSP`, `CARRIER_CMA`, `AIRPORT_FEES`, `AIRPORT_APPOINTMENT`, `DELIVERY_NOTIFICATION` 패턴을 추가했다.

---

## 2. Defects Found in v1 Logic

| No | Defect | Impact | Patch |
|---:|---|---|---|
| 1 | DOC_TYPE rule가 `keys` 중 하나만 맞으면 즉시 return | `TAX INVOICE` 포함 문서가 `CARRIER_RHS`로 오분류 | `all_terms` + `any_terms` + priority scoring으로 변경 |
| 2 | PORT_ALLIED보다 CARRIER_RHS 우선 | Allied/TWCS PortCNTInsp 오분류 | Port/CNT rules를 Carrier rules보다 상위 배치 |
| 3 | DELIVERY_ORDER regex 부족 | `D.O.No`, `D.O. NUMBER`, `DELIVERY NOTIFICATION` 누락 | DO/DN/Air notification 패턴 추가 |
| 4 | Shipment range 미지원 | `HE-0425,0426,0427,0428` 중 첫 건만 잡힘 | filename fallback range parser 추가 |
| 5 | Container regex 과다 매칭 | invoice/reference가 container로 오검출 | ISO-6346 check digit validation 추가 |
| 6 | Amount regex가 bank/account number까지 AED로 인식 | AED account number false amount | line-context filter + invoice/port-specific line item parser 추가 |
| 7 | Scanned PDF text layer 없음 | DN text_length 0 → UNKNOWN | OCR fallback 옵션 추가, 단 batch 기본은 reviewer 통제 |
| 8 | DLP masking 미흡 | TRN/BL/IBAN 등 노출 위험 | JSON/CSV output 기본 masked |
| 9 | render QA가 항상 실행 | batch memory pressure | `--render` 지정 시에만 first-page PNG 생성 |

---

## 3. Patched Pipeline

```text
Project Source scan
  → native text extract (pdfplumber)
  → OCR fallback (auto/force/off, timeout controlled)
  → table extract (pdfplumber)
  → DOC_TYPE classification (priority fingerprint)
  → COMMON_KEYS extraction
  → line item extraction
  → TYPE_B mapping
  → Evidence_Status assignment
  → AMBER/ZERO parse gate
  → JSON / CSV / optional XLSX / summary output
```

### Gate Principle

- `BOE_CUSTOMS`는 Customs/HS/UAE final judgment 대상이므로 **AMBER** 유지.
- `DEM/DET/Storage settlement` final approval 요청 시 핵심 입력 없으면 **ZERO**로 전환해야 한다.
- Grand total이 공란이어도 line-level amount가 있으면 parser에서는 PASS 가능하나, final settlement PASS는 금지한다.
- `ROUNDUP Note`: 결과값은 ROUNDUP(2자리)을 반영하지 않은 값입니다.

---

## 4. DOC_TYPE Fingerprints v2.1

| Priority | DOC_TYPE | Required / Trigger Pattern |
|---:|---|---|
| 1 | PORT_CSP | `CSP Abu Dhabi Terminal` + `Package Invoice` / `INMNR` |
| 2 | PORT_ALLIED | `ALLIED ONDOCK` / `TRANS WORLD CONTAINER SERVICES` / `TWCS Inspection` |
| 3 | AIRPORT_FEES | `Charges Summary` + `Maqta Charges` / `Etihad Terminal Charges` / `DPC Charges` |
| 4 | AIRPORT_APPOINTMENT | `IMPORT APPOINTMENT SUMMARY` |
| 5 | BOE_CUSTOMS | `Customs Declaration` / `Pre-Clear Bill` / `Debit Note` / `Gate Pass` / `Land Import` |
| 6 | DELIVERY_ORDER | `DELIVERY ORDER` / `D.O.No` / `D.O. NUMBER` / `DELIVERY NOTIFICATION` |
| 7 | DELIVERY_NOTE | `NOT NEGOTIABLE DELIVERY NOTE` / `Delivery Note/Waybill` / `Road Freight` |
| 8 | CARRIER_CMA | `CMA CGM SHIPPING AGENCY` + `TAX INVOICE` |
| 9 | CARRIER_RHS | `RAIS HASSAN SAADI` + `TAX INVOICE` |
| 10 | CARRIER_EVG | `EVERGREEN SHIPPING AGENCY` + `TAX INVOICE` |

---

## 5. COMMON_KEYS v2.1

| Key | Logic |
|---|---|
| Shipment_No | text regex + filename range fallback (`HVDC-ADOPT-HE-0425,0426...`) |
| Container | ISO-6346 valid owner/category/check-digit only |
| BL_No | label/direct pattern, masked by default |
| MAWB/HAWB | air-context only, masked by default |
| DO_No | `D/Order No`, `D.O.No`, `DO #`, `Delivery Note No`, `Do Code` |
| Invoice_No | `Invoice No`, `Invoice Number`, `IN*`, `INMNR*`, `AECI*`, `INV-TWCS-*` |
| Date | numeric + controlled month-name regex only |
| Amount_AED | line-context AED extraction; bank/account/TRN lines excluded |

---

## 6. Line Item Extraction Rules

| Source Pattern | Extracted Lines |
|---|---:|
| RHS/HMM carrier row | Container Inspection Fee, Equipment Repositioning, Admin Charges |
| CMA CGM carrier row | Container Return Service Charge |
| Evergreen fixed-width row | ISPS/D, Container Maintenance Charge |
| Allied/TWCS table | Admin & Inspection Charges per container |
| CSP detail table | Equipment-level Inspection/Wash lines |
| ATLP/Maqta charges | Appointment Charges, DPC Charges |
| BOE debit-note pages | Pre-Clear Debit lines |

---

## 7. TYPE_B Mapping

Priority follows the Project Source Package rule order.

| Priority | TYPE_B | Pattern |
|---:|---|---|
| 1 | Inspection | Customs Inspection, Container Inspection, Admin & Inspection |
| 2 | Customs | BOE, Customs Declaration, Customs Duty, Debit Note, Gate Pass |
| 3 | DO | Delivery Order, DO Fee, D/Order |
| 4 | INLAND | Road Freight, Truck, Transport, Inland, MOSB, Appointment Charge |
| 5 | THC | Terminal Handling, Port Handling, THC |
| 6 | Detention | Detention |
| 7 | STROAGE | Storage/Yard/Warehouse/Port Storage |
| 8 | OTHERS | fallback |

---

## 8. Execution Commands

### 8.1 Standard Batch Parse

```bash
python pdf_hybrid_parser_pro_v2_1.py \
  --input /path/to/pdf_dir \
  --out-dir parser_out_v2_1 \
  --project-source /path/to/DSV_SHIPMENT_FULL_PACKAGE_v3_2_PRO_INTERNAL \
  --ocr off \
  --no-xlsx
```

### 8.2 Scanned PDF Smoke Test

```bash
python pdf_hybrid_parser_pro_v2_1.py \
  --input scanned_delivery_note.pdf \
  --out-dir parser_scanned \
  --ocr auto \
  --ocr-max-pages 1 \
  --ocr-timeout 20 \
  --no-xlsx
```

### 8.3 Render QA

```bash
python pdf_hybrid_parser_pro_v2_1.py \
  --input /path/to/pdf_dir \
  --out-dir parser_out_rendered \
  --render \
  --ocr off \
  --no-xlsx
```

### 8.4 Internal Unmasked Run

```bash
python pdf_hybrid_parser_pro_v2_1.py \
  --input /path/to/pdf_dir \
  --out-dir parser_out_internal \
  --unmask
```

Use `--unmask` only in an approved internal environment. Do not upload unmasked output to public tools.

---

## 9. Output Files

| File | Purpose |
|---|---|
| `pdf_evidence_index.json` | masked evidence records + manifest |
| `pdf_line_items.csv` | line-level extracted charges |
| `summary.md` | run summary by DOC_TYPE / TYPE_B / Verdict / Issues |
| `pdf_evidence_index.xlsx` | optional, if `--no-xlsx` is omitted |
| `renders/*.png` | optional first-page visual QA if `--render` is used |

---

## 10. Validation Snapshot on Uploaded Set

| Metric | Value |
|---|---:|
| PDFs | 16 |
| PASS | 12 |
| AMBER | 4 |
| FAIL | 0 |
| ZERO | 0 |
| Extracted Line Items | 30 |
| MATCHED_AMOUNT | 10 docs |
| NOT_APPLICABLE | 5 docs |
| MISSING | 1 scanned DN |

### AMBER Items

| Cause | Count | Handling |
|---|---:|---|
| BOE_CUSTOMS / Customs final review | 3 | Reviewer gate required |
| Scanned DN low/no text layer | 1 | OCR/manual visual QA required |

---

## 11. Patch Acceptance Criteria

- `python -m py_compile pdf_hybrid_parser_pro_v2_1.py` PASS.
- Project Source Package scan status PASS.
- TYPE_B 공란 없음.
- Evidence_Status 공란 없음.
- Port/CNT invoice no longer classified as `CARRIER_RHS` by `TAX INVOICE` alone.
- `DELIVERY_NOTIFICATION`, `D.O.No`, `D.O. NUMBER` accepted.
- `HE-0425,0426,0427,0428` filename range parsed.
- Full raw text not exported.
- BL/AWB/DO/Invoice identifiers masked by default.

---

## 12. ZERO Log

- Current task is parser/document patch, not final invoice approval.
- Therefore ZERO is not triggered in this patch run.
- ZERO must trigger when final approval is requested without authoritative HS/UAE Customs evidence, DEM/DET/Storage inputs, or auditable final subtotal.
