# HVDC PDF Parse — Logic & Procedure Report (요약)

**Generated**: 2026-06-15
**Scope**: `C:\Users\jichu\Downloads\dsv docs` 루트의 57개 PDF
**Playbook**: `pdfparse.md` v1.0
**Parser version**: v3 (LAND_IMPORT · D.O. NUMBER · PORT 우선순위 · image_only 플래그 반영)
**Full report**: `20260615_pdf_parse_procedure_v2.docx`

---

## 1. Executive Summary

- 57 PDF 처리 (58개 파일 중 1개는 .msg)
- Verdict: **PASS 7 / AMBER 50 / ZERO 0 / FAILED 0**
- 파이프라인 정상 동작, 텍스트 레이어 추출 안정적
- v1→v3 fix cycle: **UNKNOWN 9 → 2 (78% 해결)**, Port/CNT 오분류 6건 → 0건, DO 누락 3건 → 0건
- 잔여 2건: image-only PDF (Tesseract OCR fallback 필요)

## 2. Procedure (5-Stage Pipeline)

| # | Stage | Engine | Output |
|---|---|---|---|
| 1 | Text extract | pdfplumber | 전체 텍스트 + 페이지 수 |
| 2 | Table extract | pdfplumber.extract_tables() | 페이지별 표 |
| 3 | Render QA | PyMuPDF (fitz) | 첫 페이지 PNG (옵션) |
| 4 | Evidence Index | COMMON_KEYS regex 7종 | JSON: shipment/container/bl/do/invoice/date/amounts |
| 5 | TYPE_B + Gate | TYPE_B_RULES + gate_verdict() | PASS/AMBER/ZERO/FAILED |

**실행 명령**:
```bash
python pdf_hybrid_parser.py --input . --out-dir parser_out --render
```

## 3. Logic

### 3.1 DOC_TYPE 분류 (Header Fingerprint)
- BOE_CUSTOMS · DELIVERY_ORDER · DELIVERY_NOTE · CARRIER_RHS · CARRIER_EVG · PORT_ALLIED · PORT_CSP
- 매칭 안 되면 UNKNOWN (text 첫 3,000자 대상)

### 3.2 COMMON_KEYS (7종)
- `shipment_no` (HVDC-ADOPT-SCT/HE-XXXX)
- `container` (4 letters + 7 digits, normalize 공백·하이픈)
- `bl_no` (SELA/EGLV prefix)
- `do_no`, `invoice_no`, `date`, `amount_aed`

### 3.3 TYPE_B 매핑
- Inspection · Customs · DO · INLAND · THC · OTHERS
- 키워드 우선 매칭 → DOC_TYPE fallback

### 3.4 Gate Verdict
- **ZERO 차단**: BOE/HS/UAE Customs 최종 / DEM-DET-Storage / Grand Total 공란
- **AMBER**: 위 조건 또는 shipment_no 미발견
- **PASS**: 모든 검증 통과

## 4. Results (v3)

### By DOC_TYPE
| DOC_TYPE | v1 | v3 | Δ |
|---|---:|---:|---:|
| BOE_CUSTOMS | 26 | 28 | +2 (LAND_IMPORT) |
| PORT_ALLIED | 0 | 4 | +4 (우선순위 조정) |
| PORT_CSP | 0 | 1 | +1 |
| PORT_TWCS | 0 | 1 | +1 (신규) |
| AIRPORT_FEES | 0 | 2 | +2 (신규) |
| APPOINTMENT | 0 | 2 | +2 (신규) |
| DELIVERY_ORDER | 3 | 6 | +3 (D.O. NUMBER/DELIVERY NOTIFICATION) |
| DELIVERY_NOTE | 9 | 7 | -2 |
| CARRIER_RHS | 9 | 4 | -5 (Port로 재배정) |
| CARRIER_EVG | 1 | 0 | -1 |
| **UNKNOWN** | **9** | **2** | **-7 (78% 해결)** |

### By Verdict
| Verdict | 건수 |
|---|---:|
| AMBER | 50 |
| PASS | 7 |

## 5. Fix Cycle (v1 → v3)

### 적용 룰
1. `BOE_CUSTOMS`에 `LAND IMPORT` / `Import to Local from FZ` 추가
2. `DELIVERY_ORDER`에 `D.O. NUMBER` / `DELIVERY NOTIFICATION` / `DELIVERY NOTIFICATION MASTER` 추가
3. `PORT_ALLIED` / `PORT_CSP` / `PORT_TWCS` 우선순위를 `CARRIER_RHS` 위로 이동 (TAX INVOICE 동시 매칭 해결)
4. 신규 `PORT_TWCS` (TransWorldContainer), `AIRPORT_FEES` (Etihad Terminal), `APPOINTMENT` 카테고리 추가
5. `RX_DO`에 `D.O. NUMBER` 패턴 추가, 결과에서 공백 제거 정규화
6. `image_only` 플래그 (text_length < 50) 추가 → OCR fallback 대상 식별

### 잔여 UNKNOWN 2건 (image-only)
- `HVDC-ADOPT-HE-0499(Lot2)_SupportingDocuments.pdf` (text_len=0, 7 pages)
- `HVDC-ADOPT-SCT-0131_DN.pdf` (text_len=0, 스캔 DN)

## 6. ZERO Conditions (현 라운드)

| # | 조건 | 적중 |
|---|---|---|
| 1 | BOE/HS/UAE Customs 최종 판정 | 28건 → AMBER 처리 |
| 2 | DEM/DET/Storage settlement | 0건 |
| 3 | Grand Total 공란 invoice | 0건 |

**ZERO 판정 0건**, AMBER 50건 모두 reviewer 승인 필요.

## 7. Recommendations

### 즉시 (1일)
1. 분류 룰 보강: BOE_CUSTOMS에 'LAND IMPORT' 추가, DELIVERY_ORDER에 'D.O. NUMBER' / 'DELIVERY NOTIFICATION' 추가, PORT_ALLIED 우선순위를 CARRIER_RHS보다 높임
2. HE-0499 lot2 OCR fallback (Tesseract)
3. container 정규화 결과 — amount 누락 0건 확인

### 단기 (1~2일)
1. line-level amount 추출 (tables[0] description × qty × unit_price)
2. Evidence Index → 13-sheet Excel 워크북 (workbook-builder.ts) 자동 조립
3. Rule #0 적용: PASS/AMBER/ZERO 무관 Excel 산출

### 중기 (3~5일)
1. Hybrid parser + 13-sheet Excel + validation loop 3회 (Option C)
2. webhook: worker-py → web(/run) → workbook-builder → Vercel Blob
3. 신규 DLP 모듈 금지 준수

## 8. 산출 파일

| 파일 | 용도 |
|---|---|
| `parser_out/pdf_evidence_index.json` | 57 PDF × 7 KEY + DOC_TYPE + TYPE_B + verdict (full) |
| `parser_out/pdf_evidence_index.xlsx` | Evidence_Index + Summary + Issues (3-sheet) |
| `parser_out/summary.md` | 집계 요약 |
| `parser_out/renders/*.png` | 57개 PDF 첫 페이지 PNG (render QA) |
| `pdf_hybrid_parser.py` | 파서 스크립트 (playbook 구현) |
| `20260615_pdf_parse_procedure_v1.docx` | 본 보고서 (편집용) |
| `20260615_pdf_parse_procedure_v1.md` | 본 요약 (마크다운) |

---

**다음 추천 작업**: `pdf_hybrid_parser.py`에 보완 룰(§5.1, §5.2) 반영 → `Evidence_Index.xlsx` 재생성 → 13-sheet workbook-builder 연동
