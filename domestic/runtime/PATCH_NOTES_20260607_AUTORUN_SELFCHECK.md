# HVDC Domestic GPT Runtime Patch - 2026-06-07

## 목적
사용자가 대화창에 Excel 파일, CSV/TSV, Markdown/Text 표, PDF 대체 MD POD, 또는 직접 다운로드 가능한 공유 URL을 입력/업로드하면 GPT가 별도 질문 없이 자동으로 Domestic invoice audit을 실행하고 최종 Excel workbook을 제공합니다.

## 변경 사항

### 1. 자동 입력 감지 강화
- `.xlsx`, `.xls`, `.csv`, `.tsv` invoice 자동 탐색.
- `.md`, `.markdown`, `.txt` 안의 Markdown 표 또는 탭/CSV형 붙여넣기 표를 invoice CSV로 자동 변환.
- `--input-url` 옵션 추가: 직접 다운로드 가능한 URL을 invoice 파일로 받아 실행.
- 기존 결과물, runtime 기준 데이터, manifest/summary/reconciliation 파일은 invoice 후보에서 제외.

### 2. MD POD를 PDF 대체 증빙으로 처리
- `.md`/`.markdown` POD를 PDF 텍스트 대체본으로 인정.
- `Note/Waybill#`, `Trip No.`, destination, loading hint, rate approval 문구를 추출.
- `HVDC-AGI-ALS-*` 등 DSV가 포함되지 않은 shipment ref도 인식.
- 사용자가 `--docs`를 지정하지 않아도 업로드된 PDF/MD POD를 `supporting_docs_staging`으로 자동 복사해 audit에 반영.

### 3. 최종 Excel 제공 전 자체 검증 루프
- audit 후 `self_verification_report.json` 생성.
- workbook에 `self_check` sheet 추가.
- MD POD가 있으면 `pod_reconciliation` sheet 추가.
- items.csv, workbook, proof JSON 존재/읽기 가능성 확인.
- invoice row count, items.csv row count, workbook items row count 일치 여부 확인.
- `qty × rate_usd = Amount`, `Amount = Total` 산술 검증.
- MD POD 수량 대조: Waybill count를 primary evidence로 사용하고, Trip No.는 보조 기록으로 남김.
- hard check 실패 시 run status를 `failed`로 분류.

## 생성 출력
- `domestic_audit_report_v2_*.xlsx`
- `items.csv`
- `domestic_audit_proof_v2.json`
- `domestic_audit_report_v2.pdf`
- `domestic_audit_run_log.txt`
- `gpts_run_summary.json`
- `gpts_run_summary.md`
- `self_verification_report.json`
- `md_pod_reconciliation.csv`
- `md_pod_reconciliation.md`

## 사용 원칙
최종 사용자에게 Excel workbook을 제공하기 전에 반드시 `gpts_run_summary.json`의 다음 값을 확인합니다.

- `status == "succeeded"`
- `self_check.hard_pass == true`
- `outputs.audit_workbook` 존재
- `outputs.self_check_json` 존재
