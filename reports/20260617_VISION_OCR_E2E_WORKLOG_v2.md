# Vision OCR 실가동 — 작업 현황 / 잔여 작업 (2026-06-17 update)

**작성일**: 2026-06-17
**이전 워크로그**: `reports/20260617_vision_ocr_e2e_worklog_v1.md`

---

## 1. 한 줄 결론

**Vision OCR prod 연동 완료.** 웹 run 경로에서 Vision 실발화 → OCR sidecar 생성 → 13-sheet export 확인. 단, 현재 설계상 GCS PDF는 evidence(증빙) 역할로만 연결되어 `invoice_lines` 생성 불가 — 1차 인보이스 경로 추가 필요.

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

### Part D — 웹 종단 유료 smoke ✅ [완료 — Vision 연동 입증]
- Vision OCR 웹 run 경로 실발화 확인 (job `job_mqh72djd`):
  - run route → `runVisionOcr` 호출 → 워커 `/v1/vision/run` → Vision OCR → `VISION_RUN_COLLECTED`
  - OCR sidecar `gs://dsv-invoice-ocr/jobs/.../output-1-to-1.json` 생성
  - 13-sheet REVIEW_PACK export 성공 (Rule #0 충족)
- 재검증 (CarrierInvoice, job `job_8325e6f234be`): Vision 발화 → evidence 추출 → `invoice_lines=0` (설계상 GCS PDF는 evidence 역할만, 아래 §구조적 발견 참조)

## 3. 구조적 발견

**GCS PDF는 evidence로만 설계됨**: `confirm` 엔드포인트로 추가된 GCS PDF는 `evidenceFiles`로 분류되어 OCR 결과가 `evidence_candidates`에만 들어간다. `invoice_lines`를 채우려면 GCS PDF를 1차 인보이스 소스(`invoiceFile`)로 올리는 경로가 필요하다. 현재는 1차 인보이스가 Vercel Blob(`https://`)만 가능하다.
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

## 3. 잔여 작업

### P0 — GCS PDF를 1차 인보이스로 업로드하는 경로 [신규]
- 현재: confirm된 GCS PDF는 evidence 전용, invoice_lines 생성 불가
- 필요: GCS PDF를 1차 인보이스 소스(`invoiceFile`)로 등록하는 경로
- 구현 방안: `confirm` 시 `file_role=INVOICE` 주입, 또는 `invoices` 확장

### P1 — Vision 인보이스 라인 구조화 품질 검증
- 스캔 인보이스 PDF 공급되면 `invoice_lines > 0` 종단 입증

### P2~P3 — 기존 로드맵
- 워커 pdf_text.py text_span → invoice_lines 실추출, Rate_Check 컬럼

---

## 4. 재현용 핵심 식별자
- prod: `https://sct-ontology-invoice-audit.vercel.app`
- worker: `hvdc-invoice-parser` (asia-northeast3) / rev `00016-s92`
- GCP project: `dsv-invoice`, SA: `svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com`
- buckets: source=`dsv-invoice-source`, ocr=`dsv-invoice-ocr`
- 검증된 Vision job: `job_mqh72djd` (VISION_RUN_COLLECTED, 13-sheet export)

## 5. 비용 / 안전
- 유료 Vision: Part B 1건 + Part D 1건 = 약 2건 과금 (소액, 승인됨)
- `GCS_PRIVATE_KEY` Claude 미입력(안전규칙 준수)
