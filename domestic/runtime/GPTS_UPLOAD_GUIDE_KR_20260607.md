# HVDC Domestic Audit GPTs Upload Guide

## Package Version
`20260607_full_final`

## GPT Builder 설정 순서

1. GPT Builder에서 **Code Interpreter / Data Analysis**를 켠다.
2. Code Interpreter 파일 영역에 아래 파일을 업로드한다.

```text
hvdc_domestic_gpts_ci_runtime_20260607_full_final.zip
```

3. GPT Instructions 칸에는 아래 파일 내용을 붙여넣는다.

```text
HVDC_Domestic_Audit_GPTS_Instructions_COMPACT_20260607.md
```

4. Knowledge에는 runtime ZIP을 넣지 않는다.
5. 테스트 시 Domestic invoice Excel/CSV 또는 붙여넣기 표와 PDF/MD POD를 업로드한다.

## 포함된 핵심 기능

- Excel/CSV/TSV/Markdown/Text invoice 자동 처리
- PDF 및 MD POD supporting evidence staging
- MD POD를 PDF 동등 증빙(`MD_AS_PDF_TEXT`)으로 반영
- `self_check`, `pod_reconciliation`, `md_as_pdf_evidence` sheet 생성
- 고정 Excel 포맷 적용
- `gpts_run_summary.json` 기반 결과 판정

## 운영 주의

- 매 실행마다 invoice 파일은 사용자가 업로드해야 한다.
- API key, password, token은 업로드하지 않는다.
- GPT Actions 또는 로컬 Windows 폴더 접근을 사용하지 않는다.
- 실패 시 `gpts_run_summary.json`, `self_verification_report.json`, `domestic_audit_run_log.txt`를 먼저 확인한다.
