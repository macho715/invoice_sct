# Vision OCR 실가동 + /health/ready 503 — 작업 현황 / 잔여 작업

- 작성일: 2026-06-17
- 범위: 스캔 PDF Google Vision OCR을 인보이스 검증에 실제 연결 + 워커 readiness 503 수정 + Vercel 프로덕션 종단 검증
- 프로젝트: SCT Invoice Audit Platform (apps/web=Vercel, apps/worker-py=Cloud Run `hvdc-invoice-parser`, apps/mcp-server)

> 검증 등급 표기: **[직접검증]** = 본 세션에서 명령 실행으로 확인 / **[보고기반]** = 이전 턴·사용자 상태보고 기반(본 세션 미재검증).

---

## 1. 한 줄 결론

GCS 업로드·서명·Vercel env·웹 종단 파이프라인(ingest→create-upload-url→PUT→confirm→run→export)은 **프로덕션에서 동작 확인**. 단 **웹 run 경로의 Vision OCR 호출이 `VISION_RUN_FAILED`로 즉시 실패**(워커 직접 경로 Part B는 성공) — 근본원인 미확정이 유일한 잔여 핵심. Rule #0(어떤 verdict에서도 13-sheet Excel 제공)은 AMBER에서도 충족 확인.

---

## 2. 완료한 작업

### Part A — `/health/ready` 503 수정 [보고기반]
- 증상: 워커 readiness가 `DATABASE_URL` 미설정 시 하드 실패(503). 워커는 DB-optional 설계.
- 수정: `apps/worker-py/app/routes/health.py` `_check_db` — `DATABASE_URL` 미설정/빈값이면 graceful skip `{ok:True, skipped:True}` 반환(`_check_blob`의 `BLOB_HEALTHCHECK_URL` skip 패턴과 동일). 설정됐는데 pool None/SELECT 실패면 기존대로 `ok:False`.
- 테스트: 미설정→200 케이스 추가, worker pytest 210/210.
- 상태: PR 머지·워커 재배포 보고됨. **본 세션 미재검증 → `/health/ready` 200 재확인 필요(잔여 #3).**

### Part B — 유료 Vision OCR 워커 직접 smoke [보고기반]
- 경로: `gcloud storage cp` 스캔 PDF → `POST {worker}/v1/vision/run`.
- 결과: STARTED → `VISION_RUN_COLLECTED`, confidence **0.967**, doc=`DELIVERY_NOTE`, evidence 11건, OCR JSON `gs://dsv-invoice-ocr/...output-1-to-1.json` 생성 확인.
- 의미: **워커 레벨에서 유료 Vision 체인(GCS→Vision→normalize→lines)은 동작**.

### Part C — Vercel 프로덕션 env [직접검증]
- Claude 설정(비-시크릿, 6개, `vercel env ls`로 확인 / 5분 전):
  `GCS_UPLOAD_ENABLED`, `NEXT_PUBLIC_GCS_UPLOAD_ENABLED`, `GCS_SOURCE_BUCKET=dsv-invoice-source`, `GCS_CLIENT_EMAIL`, `GCS_OCR_BUCKET=dsv-invoice-ocr`, `VISION_FALLBACK_ENABLED=true`.
- 사용자 설정(시크릿): `GCS_PRIVATE_KEY` — Production에 존재 확인(1분 전). **(자격증명이라 Claude가 입력 불가 → 사용자가 직접 수행, 안전규칙 준수.)**
- 재배포: prod deploy `g347lmy0b` Ready 확인.
- 코드 동작 확인: `apps/web/src/lib/gcs-upload.ts` `normalizePrivateKey`가 literal `\n`→실제 줄바꿈 복원, `requiredEnv` 빈값→`GCS_CONFIG_MISSING`.

### Part D — 웹 종단 유료 smoke (프로덕션) [직접검증]
job=`job_197c27da50de` (txt 인보이스 ingest로 토큰 발급 + 스캔 PDF `HVDC-ADOPT-SCT-0131_DN.pdf`를 gs:// evidence로 confirm).

| 단계 | 결과 |
|---|---|
| create-upload-url (서명) | ✅ GOOG4-RSA-SHA256 서명 URL 발급 → **`GCS_PRIVATE_KEY` 실동작 입증** |
| PUT 업로드 | ✅ HTTP 200 (실제 바이트 GCS 적재) |
| confirm (gs:// 등록) | ✅ status UPLOADED |
| run | ⚠️ HTTP 202, verdict **AMBER**, 6.5s |
| Vision 호출 | ✅ 호출됨(웹→워커) / ❌ **`VISION_RUN_FAILED`** 반환 |
| export(REVIEW_PACK) | ✅ **HTTP 200, 13-sheet 정확(00_Decision…99_Manifest)** — Rule #0 충족 |

run의 action_items: `SCANNED_PDF_NEEDS_OCR`(vision_run_failed), `NO_INVOICE_LINES_EXTRACTED`.

---

## 3. 구조적 발견 (설계 이해)

- **`/api/files/confirm`(GCS 경로)는 `job_token`을 발급하지 않음.** 토큰은 `ingest`/`register`/`invoices`(전부 Vercel Blob, `https://`)만 발급.
- run/register는 `job_token` 또는 `API_SECRET_KEY` Bearer를 요구(`apps/web/src/lib/job-token.ts`, HMAC).
- 따라서 **Vision(gs:// 입력 필요)은 "gs:// evidence fallback"으로 설계** — 1차 인보이스는 Vercel Blob로 올려 토큰을 받고, 스캔 PDF는 같은 job에 gs:// evidence로 붙여 Vision 발화. 순수 GCS-only job은 공개 API로 run 불가.
- 본 smoke도 이 설계대로(txt 인보이스+gs:// evidence) 정당하게 구성.

---

## 4. 잔여 작업 (우선순위)

### P0 — Vision 웹 경로 `VISION_RUN_FAILED` 근본원인 [핵심 잔여]
- 사실관계: 워커 직접(Part B)=COLLECTED 성공 vs 웹 run(Part D)=즉시 FAILED(6.5s). run/route.ts `runVisionForPdf`는 `output_gcs_prefix=gs://dsv-invoice-ocr/jobs/{job}/{file}/`, `timeout_seconds:180`로 `parser.runVisionOcr` 호출.
- 6.5s 즉시 실패 → 워커가 async op 시작 전/직후 예외 던진 정황. 후보:
  1. 웹→워커 호출 파라미터/스키마 불일치(`/v1/vision/run` 바디).
  2. output prefix 경로(`jobs/...`) 권한/형식 — Part B는 `smoke/<id>/` 사용(성공).
  3. 워커 리비전이 Part B 검증 시점과 다름(VISION_ENABLED/코드).
  4. source 오브젝트 경로 접근.
- **다음 행동: Cloud Run 로그 확인** (`gcloud logging read ... service_name=hvdc-invoice-parser ... severity>=ERROR / "vision"`). ※ 직전 세션에서 이 명령이 사용자 거부로 중단됨 → 재승인 또는 사용자 직접 로그 확인 필요.

### P1 — Vision 성공 후 종단 재검증
- 위 원인 해소 후: run → trace `VISION_RUN`=`VISION_RUN_COLLECTED`, OCR 라인/evidence 병합 → 13-sheet export에 OCR 라인 반영 확인.

### P2 — `/health/ready` 200 재확인 [보고기반 미재검증]
- 워커 재배포본에서 `curl {worker}/health/ready` → 200 직접 확인.

### P3 — 기존 로드맵 잔여 (CLAUDE.md 기재)
- 워커 `pdf_text.py` text_span → `invoice_lines` 실추출(Phase 2.5): PDF 단독을 AMBER가 아닌 실검증으로 승격.
- `06_Rate_Check`/`04_Line_View`에 rate_match 컬럼 노출: 워커 `xlsx.py`에 컬럼 추가(현재 필드 수용만, 셀 미기재).

### P4 — 정리
- 본 검증으로 생성된 임시파일 제거: `smoke_inv.txt`, `smoke_jt.txt`(토큰 포함), `smoke_run.json`, `smoke_export.xlsx`.

---

## 5. 비용 / 안전 메모
- 유료 Vision 호출: Part B 1건(성공) + Part D 1건(실패) — 실비용 발생(승인됨, 소액).
- `GCS_PRIVATE_KEY` 등 자격증명은 Claude가 입력/취득하지 않음(안전규칙). Vercel 시크릿·gcloud 로그 토큰은 사용자 경유.
- 본 문서/로그에 원시 OCR 원문·키 값 미기재.

---

## 6. 재현용 핵심 식별자
- prod: `https://sct-ontology-invoice-audit.vercel.app`
- worker: `hvdc-invoice-parser` (asia-northeast3), GCP project `dsv-invoice`
- buckets: source=`dsv-invoice-source`, ocr=`dsv-invoice-ocr`
- 테스트 스캔본: `dsv docs/dsv docs/HVDC-ADOPT-SCT-0131_DN.pdf` (sha256 `81f7dd90…a7f81`, 306,319 bytes, pdfplumber 0추출 실증 스캔본)
- 최근 smoke job: `job_197c27da50de` (AMBER, 13-sheet export 성공)
