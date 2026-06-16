판정: **AMBER — PDF parse logic/pattern 확인 완료, 단 final invoice approval 자동 PASS에는 부적합합니다.**
근거: Project Source Package v3.2 로컬 scan PASS, 업로드 PDF 7건 실파싱/렌더 확인 — BOE/Carrier/DO-DN/Port evidence 패턴 확인. 
다음행동: **Hybrid parser**로 구현하십시오: `text extract → table extract → render QA → evidence index → TYPE_B mapping → AMBER/ZERO gate`.

## Exec

현재 업로드 PDF는 **text layer가 대부분 살아 있어 OCR-first 대상은 아님**입니다. 다만 3개 위험이 있습니다.

| No | Item                         | Value                                                                      | Risk   | Evidence                                                 |
| -: | ---------------------------- | -------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
|  1 | Project Source Scan          | Rule/contract/validator는 존재, dedicated PDF parser script는 package 내 확인 안 됨 | AMBER  | Local scan: package_self_check/dlp/rate/golden_case PASS |
|  2 | BOE / Customs Declaration    | Customs Declaration + HS table + Debit Note + Gate Pass가 한 PDF에 혼재         | HIGH   | Customs/HS/UAE 판단은 공식 증빙 기반만 허용                          |
|  3 | Carrier Invoice - RHS        | line item은 추출 가능, 단 `Total Amount / Gross amount payable` label 뒤 숫자 공란    | AMBER  | line-level evidence만 사용, grand total 자동 PASS 금지          |
|  4 | Carrier Invoice - Evergreen  | fixed-width invoice. line item은 추출 가능, `SUB TOTAL / TOTAL` 숫자 공란           | AMBER  | line sum은 계산 가능하나 원문 total 아님                            |
|  5 | DO / DN                      | DO는 구조 양호, DN은 label/value가 행 분리되어 field proximity 필요                      | MEDIUM | DO/DN cross-key로 BL/DO/container/date 매칭                 |
|  6 | Port CNT Inspection - Allied | 단일 container inspection invoice, line amount 추출 양호                         | LOW    | line-level MATCHED_AMOUNT 가능                             |
|  7 | Port CNT Inspection - CSP    | package invoice + multi-container detail. summary total 사용 금지              | HIGH   | target equipment row만 filter해야 함                         |

## 확인된 PDF parse 패턴

```python
DOC_TYPE
- BOE_CUSTOMS: "Customs Declaration" or "DEBIT NOTE" or "Gate Pass"
- DELIVERY_ORDER: "DELIVERY ORDER" + "D/Order No"
- DELIVERY_NOTE: "NOT NEGOTIABLE DELIVERY NOTE" or "Delivery Note/Waybill"
- CARRIER_RHS: "RAIS HASSAN SAADI" + "TAX INVOICE"
- CARRIER_EVG: "EVERGREEN SHIPPING AGENCY" + "TAX INVOICE"
- PORT_ALLIED: "ALLIED ONDOCK" + "TAX INVOICE"
- PORT_CSP: "CSP Abu Dhabi Terminal" + "Package Invoice"
```

```python
COMMON_KEYS
shipment_no = r"HVDC[\s\-\uFFFE]+ADOPT[\s\-]+SCT[\s\-]*(\d{4})"
container   = r"\b[A-Z]{4}\s?\d{6}-?\d\b"       # normalize: remove space/hyphen
bl_no       = r"\b(?:SELA|EGLV)[A-Z0-9]{8,}\b"
do_no       = r"(?:D/Order No|DO #|Delivery Order No)[:\s]+(\d{6,})"
invoice_no  = r"(?:Invoice No|INVOICE NO\.|Invoice Number)\s*:?\s*([A-Z0-9-]+)"
date        = r"\d{2}/\d{2}/\d{4}|\d{2}-[A-Z]{3}-\d{4}|\d{4}-\d{2}-\d{2}"
amount_aed  = r"AED\s*([0-9,]+(?:\.\d{2})?)"
```

## 적용 로직

1. **Extract**

   * `pdfplumber` text extract를 기본값으로 사용.
   * `tables` extract는 보조로 사용.
   * BOE / CSP처럼 table 구조가 복잡한 PDF는 render image로 page QA 수행.

2. **Normalize**

   * `\uFFFE`, line break, Arabic/English mixed order 정리.
   * container는 `HMMU 608937-7 → HMMU6089377` 형태로 정규화.
   * BL과 container regex 충돌 방지: container는 **4 letters + 7 digits**만 인정.

3. **Evidence Index**

   * key: `Shipment_No + BL + Container + DO_No + Invoice_No + Date`.
   * 값은 원문 금액이 아니라 `Evidence_Status`, `TYPE_B`, `source_file`, `page`, `line/table row`.

4. **TYPE_B Mapping**

   * `Inspection`: Container Inspection Fee, Admin & Inspection, Customs Inspection 우선.
   * `Customs`: BOE, Customs Duty, Customs Declaration, Debit Note.
   * `DO`: Delivery Order / DO Fee.
   * `INLAND`: DN Road Freight / Truck / FB movement.
   * `THC`: Terminal/port handling 명시 시.
   * `OTHERS`: ISPS/D, Equipment Repositioning, Container Maintenance 등 rule 미확정 항목.

## Options

| Option | Scope                                                            |     Cost | Risk   | Time           |
| ------ | ---------------------------------------------------------------- | -------: | ------ | -------------- |
| A      | text-only regex parser                                           | AED 0.00 | MEDIUM | 0.50-1.00 day  |
| B      | text + table + render QA hybrid parser                           | AED 0.00 | LOW    | 1.00-2.00 days |
| C      | hybrid parser + Excel audit workbook export + validation loop 3회 | AED 0.00 | LOW    | 3.00-5.00 days |

가정: Cost는 내부 개발 기준이며 외부 vendor/API 비용은 제외했습니다.

## cmd3

```bash
python /home/oai/skills/pdfs/scripts/pdf_inspect.py file.pdf
python /home/oai/skills/pdfs/scripts/pdf_extract.py text file.pdf --method pdfplumber --out out.txt
python /home/oai/skills/pdfs/scripts/pdf_extract.py tables file.pdf --out_dir tables --format csv
```

## ZERO Log

* **ZERO 아님:** 현재 요청은 parse pattern 보고이며 final approval 요청이 아님.
* **ZERO 조건:** BOE/HS/UAE Customs 최종 판단, DEM/DET/Storage settlement, 또는 Grand Total 공란 invoice를 근거로 final PASS 요청 시 중단.
* **ROUNDUP Note:** 결과값은 ROUNDUP(2자리)을 반영하지 않은 값입니다.
