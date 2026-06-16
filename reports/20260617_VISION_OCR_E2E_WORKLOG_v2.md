# Vision OCR 실가동 — 작업 현황 / 잔여 작업 (2026-06-17 update)

**작성일**: 2026-06-17
**이전 워크로그**: `reports/20260617_vision_ocr_e2e_worklog_v1.md`

---

## 1. 한 줄 결론

Worker 직접 경로 Vision OCR은 성공(STARTED→COLLECTED, confidence 0.967). 웹 run 경로는 Vision이 발화되지 않음(18초대 완료, VISION_RUN 미트레이스) — `VISION_FALLBACK_ENABLED` env가 Vercel runtime에서 미인식 추정. Worker /health/ready 503은 해결(배포 완료).

---

## 2. 금일 완료 작업

### Part A — /health/ready 503 수정 ✅ [완료+배포]
- 파일: `apps/worker-py/app/routes/health.py` — DATABASE_URL 미설정 시 graceful skip (`{ok:True, skipped:True}`)
- 테스트: `tests/test_health.py` — 신규 케이스 1개 추가, worker pytest 210/210
- 배포: Cloud Run `hvdc-invoice-parser-00015-jqd` (새 URL: `asia-northeast3.run.app`)
- 검증: `curl /health/ready` → `{"status":"ok","checks":{"db":{"ok":true,"skipped":true}}}`

### Part B — 유료 Vision OCR 워커 직접 smoke ✅
- 경로: `gcloud storage cp` → `POST {worker}/v1/vision/run`
- 결과: STATUS=COLLECTED, confidence=0.967, doc=DELIVERY_NOTE, 11 evidence, OCR JSON 출력 확인
- 의미: GCS→Vision→normalize 체인 워커 레벨 정상 동작 입증

### Part C — Vercel 프로덕션 env ✅
- Claude 설정 6개(비-시크릿): `GCS_UPLOAD_ENABLED`, `NEXT_PUBLIC_GCS_UPLOAD_ENABLED`, `GCS_SOURCE_BUCKET`, `GCS_CLIENT_EMAIL`, `GCS_OCR_BUCKET`, `VISION_FALLBACK_ENABLED`
- 사용자 설정: `GCS_PRIVATE_KEY` (시크릿, Claude 입력 금지 준수)
- GCS 업로드 경로: create-upload-url→PUT→confirm 성공 (GOOG4-RSA-SHA256 서명 입증)

### Part D — 웹 종단 유료 smoke
- Worker 직후 배포(`00015-jqd`, 새 URL)→Vercel PARSER_WORKER_URL 업데이트→redeploy(4회)
- 결과: run은 18초대 완료, AMBER `NO_INVOICE_LINES_EXTRACTED`. **Vision 미발화** (`VISION_RUN` trace 없음, `SCANNED_PDF_NEEDS_OCR` action 없음)
- 추정 원인: Vercel runtime에서 `VISION_FALLBACK_ENABLED=true` env 미인식

### Worker 배포
- Cloud Run rev `00015-jqd`: 신규 `/v1/vision/run` 엔드포인트 + `parser_issues` 전파 + health fix 포함
- URL 변경: `hvdc-invoice-parser-571352991204.asia-northeast3.run.app`
- 검증: `/health/ready` → 200, `/v1/vision/run` endpoint 존재 확인 (401→존재, 404 아님)

### Web 배포
- git commit 4회 push:
  - `98c1487` — sync Vision OCR for scanned PDFs (#64)
  - `9c0f292` — force redeploy
  - `9085167` — broaden env check (`true || 1`)
- Vercel prod deployment: `5n1x8ty2g`
- Env vars 설정 후 `vercel --prod` 실행

---

## 3. 잔여 작업 (P0)

### Vision 웹 경로 `VISION_FALLBACK_ENABLED` env 미인식 [핵심]
- 증상: run route의 `process.env.VISION_FALLBACK_ENABLED === 'true'`가 false로 평가됨 → 전체 Vision 블록 스킵
- `vercel env ls production`에서는 `VISION_FALLBACK_ENABLED Encrypted` 존재 확인
- `GCS_UPLOAD_ENABLED`는 정상 인식 (create-upload-url 동작) → env 전달 자체는 문제없음
- **Vercel 대시보드에서 `VISION_FALLBACK_ENABLED=true` 값 직접 재확인 필요**

### 해결 시 종단 재검증
- run → trace `VISION_RUN`=`VISION_RUN_COLLECTED` → OCR evidence merge → export 13-sheet

---

## 4. 기존 로드맵 잔여 (P1~P3)
- 워커 `pdf_text.py` text_span → `invoice_lines` 실추출 (PDF 단독 AMBER→실검증 승격)
- `06_Rate_Check`/`04_Line_View` rate_match 컬럼 노출
- 임시파일 정리 (`smoke_inv.txt`, `smoke_jt.txt` 등)

---

## 5. 재현용 핵심 식별자
- prod: `https://sct-ontology-invoice-audit.vercel.app`
- worker: `hvdc-invoice-parser` (asia-northeast3) / rev `00015-jqd` / URL `...571352991204.asia-northeast3.run.app`
- GCP project: `dsv-invoice`
- buckets: source=`dsv-invoice-source`, ocr=`dsv-invoice-ocr`
- SA: `svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com`
- 스캔 테스트본: `dsv docs/dsv docs/HVDC-ADOPT-SCT-0131_DN.pdf` (306,319 bytes, DN, pdfplumber 0추출)
- 최근 test job: `job_690efef003cc` (AMBER, Vision 미발화)

---

## 6. 비용 / 안전
- 유료 Vision: Part B 1건(성공) + Part D 3회 시도 중 Vision 미발화(비용 0) = 총 1건 과금
- `GCS_PRIVATE_KEY` 등 자격증명 Claude 미입력(안전규칙 준수)
