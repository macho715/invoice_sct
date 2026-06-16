# 스캔 PDF 실판독 → 인보이스 검증에 사용 (Vision OCR 동기 환류) — 구현 완료

- **작성일**: 2026-06-16
- **상태**: 구현 완료 (코드 반영 + 로컬 검증 완료 보고 반영)
- **연계**: [`20260616_PDF_PARSER_UPGRADE_PLAN_v1.md`](./20260616_PDF_PARSER_UPGRADE_PLAN_v1.md) Track ②, [`20260616_GCS_UPLOAD_PATH_SETUP_v1.md`](./20260616_GCS_UPLOAD_PATH_SETUP_v1.md) (GCS 경로, PR #63 머지됨)
- **GitHub 기준**: `origin/main` = `02826a5` (`feat(web): wire GCS upload path for PDF evidence (Track ② prerequisite) (#63)`)
- **공식 문서 기준**: Google Cloud Vision PDF/TIFF OCR, Vision quota/limit, Vision authentication, Cloud Storage IAM roles, Vercel function duration/limits/env redeploy rule 확인 반영.

## Context

사용자 요청: "실제로 PDF 파서하여 인보이스 검증에 사용되도록 하라." 실제 자료(`dsv docs/`)로 워커 파서를 in-process 실증한 결과:

| PDF | pdfplumber | 결과 | 검증 사용 |
|-----|-----------|------|-----------|
| HVDC-ADOPT-SCT-0122_DO.pdf | ✅ 4 spans / 8 tbl | shipment/container/BL + generic 4 lines + evidence 4 | **이미 사용됨** |
| HVDC-ADOPT-SCT-0126_BOE.pdf | ✅ 5 spans / 41 tbl | BOE_CUSTOMS 2 lines + evidence | **이미 사용됨** |
| **HVDC-ADOPT-SCT-0131_DN.pdf** | ❌ 0, `SCANNED_PAGE_DETECTED` | 0 추출 | **안 쓰임 (조용히 SKIP)** |

**텍스트 PDF(DO/BOE)는 이미 검증에 들어간다.** 기존 갭은 **스캔본(DN 등)** — pdfplumber가 0 추출 → run route 증빙 루프에서 조용히 SKIP되거나 일반 `NO_INVOICE_LINES_EXTRACTED`로만 처리되던 점이었다.

구현 후 보정: 최종 `/v1/parse` `ParseResponse`가 `parser_issues`를 전달하고, web run route가 `SCANNED_PAGE_DETECTED`를 감지해 `/v1/vision/run` 동기 OCR 환류를 실행한다. OCR 결과가 `invoice_lines`와 evidence로 반환되면 `cf.validate` 전에 병합된다.

사용자 결정: **Vision까지 켜서 스캔본 실판독 (유료 승인)**. GCS 업로드 경로는 PR #63으로 구축되었고, 본 구현에서 OCR 결과를 같은 검증 run에 환류하는 코드가 추가되었다.

## GitHub 최신 코드 기준 스냅샷 (2026-06-16)

| 항목 | 구현 후 코드 상태 | 의미 |
|------|----------------------|------|
| 최신 main | `02826a5` / PR #63 | GCS 업로드 경로 선결 작업 완료. |
| Track ① 일반 PDF 라인 추출 | `6296cb0` / PR #62 | `extract_generic_invoice_lines()`와 DSV-empty fallback이 main에 반영됨. |
| GCS 업로드 경로 | `create-upload-url`, `files/confirm`, `AppendEvidenceUpload`, `GCS_UPLOAD_ENABLED` | 증빙 PDF를 `gs://`로 올릴 수 있는 선결 경로가 있음. |
| Vision run route | `POST /v1/vision/run` | worker가 start → poll → collect → normalize를 bounded 동기 환류로 수행. |
| Vision 호출 방식 | `run/route.ts`가 `parser_issues`와 `gs://` 조건을 보고 `runVisionOcr()` 호출 | OCR 결과가 같은 검증 run의 `invoice_lines`/evidence에 병합됨. |
| parser issues 전달 | `ParseResponse.parser_issues` 추가 | `SCANNED_PAGE_DETECTED`가 web run route까지 전달됨. |
| setup 문서 | `20260616_GCS_UPLOAD_PATH_SETUP_v1.md` | 기존 fire-and-forget 설명은 후속 문서 정리 대상. 현재 코드 기준은 `/v1/vision/run` 동기 환류. |

> ⚠️ **비용/자격증명 경계**: 본 작업은 GCP 서비스계정 키 입력·빌링 활성화·IAM 변경을 대신 수행하지 않음(자격증명 입력 금지). 범위는 **Vision 체인 코드 완성 + flag-gated 배선 + mock 단위테스트**. 실제 키/빌링/IAM 설정은 사용자가 콘솔에서 수행(절차 문서 제공). 실 종단(유료) 검증은 사용자 활성화 후.

## 공식 문서 기준 제약

| 영역 | 공식 문서 기준 | 구현 반영 |
|------|----------------|-----------|
| Vision PDF/TIFF 입력 | Google Cloud Vision PDF/TIFF OCR은 Cloud Storage에 저장된 PDF/TIFF를 대상으로 한다. `files:asyncBatchAnnotate`는 operation으로 진행되고 결과 JSON을 지정한 GCS bucket/prefix에 쓴다. | `/v1/vision/run` 입력은 `gs://`만 허용한다. Vercel Blob/local path/external URL을 Vision 입력으로 직접 넘기지 않는다. |
| OCR output | Vision output은 `outputConfig.gcsDestination.uri` 아래 JSON으로 저장된다. `batchSize`에 따라 여러 `output-*.json`이 생길 수 있다. | `vision_client.collect_result()`는 output prefix 아래 여러 OCR JSON을 수집·병합할 수 있어야 한다. 단일 JSON만 가정하지 않는다. |
| Feature type | PDF/TIFF offline large batch annotation은 `DOCUMENT_TEXT_DETECTION` 또는 `TEXT_DETECTION`만 사용한다. | 인보이스 OCR 기본 feature는 `DOCUMENT_TEXT_DETECTION`으로 고정한다. |
| Vision 한계 | Vision은 OCR text를 제공한다. 스캔 문서의 구조화 form/entity extraction에는 Google이 Document AI를 권장한다. | invoice header/line item 구조화는 Google Vision이 아니라 `normalize_vision_output()`과 우리 line mapper 책임이다. low confidence 또는 line 구조화 실패는 자동 PASS 금지. |
| Vision limits | 공식 limit 기준 PDF file size는 1GB, `files:asyncBatchAnnotate`는 최대 2000 pages, `files:annotate`는 5 pages 제한이다. | 본 구현은 small sync `files:annotate`가 아니라 기존 async operation 기반을 유지한다. page/file limit 초과는 AMBER/REVIEW 또는 reject 사유로 표기한다. |
| IAM | source object 읽기에는 Storage Object Viewer 성격의 권한이 필요하다. output JSON 생성에는 object create 권한이 필요하다. collect에서 output JSON을 읽거나 list하면 OCR bucket에도 read/list 권한이 필요하다. | source bucket read, OCR bucket write, OCR bucket read/list 권한을 운영 체크리스트에 분리해 적는다. 서비스계정 값 자체는 문서에 반복하지 않는다. |
| Vercel limits | Vercel Functions는 max duration 제한이 있고, request/response body size 제한이 있다. env 변경은 기존 deployment에 자동 적용되지 않고 redeploy가 필요하다. | web route가 Vision API를 직접 오래 polling하지 않는다. web은 worker `/v1/vision/run`에 bounded timeout으로 위임한다. raw OCR JSON/text를 web response/workbook/trace에 싣지 않는다. env 변경 후 redeploy를 운영 절차에 포함한다. |

공식 근거:
- Google Cloud Vision PDF/TIFF OCR: https://docs.cloud.google.com/vision/docs/pdf
- Google Cloud Vision quotas/limits: https://cloud.google.com/vision/quotas
- Google Cloud Vision authentication: https://docs.cloud.google.com/vision/docs/authentication
- Google Cloud Storage IAM roles: https://docs.cloud.google.com/storage/docs/access-control/iam-roles
- Vercel max duration: https://vercel.com/docs/functions/configuring-functions/duration
- Vercel function limits: https://vercel.com/docs/functions/limitations
- Vercel environment variable redeploy rule: https://vercel.com/docs/environment-variables/managing-environment-variables

## 설계 — 동기·바운드 OCR 환류 (비동기 콜백 대신)

Vision OCR을 **한 run 패스 안에서 동기 처리**: 워커가 start→poll→collect→normalize를 한 요청에 처리(바운드 ~180s 보유), 정규화된 OCR 라인/evidence를 반환 → 웹이 **cf.validate 호출 전에 병합** → OCR 내용이 같은 검증에 직접 사용됨. 비동기 콜백+재검증(verdict 사후 변경) 회피로 단순·저위험. 기존 async `/v1/vision/start|collect`는 외부용으로 유지(삭제 X, 추가만).

여기서 “동기 환류”는 web이 Vision API를 직접 오래 polling한다는 뜻이 아니다. web은 worker `/v1/vision/run`을 호출하고, worker가 Vision async operation을 bounded poll한 뒤 normalized result만 반환한다. Vercel function duration/body limit 때문에 raw OCR JSON은 web으로 넘기지 않는다.

**트리거 조건**: PDF가 `SCANNED_PAGE_DETECTED` AND `VISION_FALLBACK_ENABLED` AND 입력이 `gs://` (PR #63 경로). 그 외엔 기존 동작 불변. 바운드 초과/실패 시 AMBER `SCANNED_PDF_OCR_PENDING`(Rule #0 — Excel은 항상 산출).

## 변경 파일

| 파일 | 유형 | 설명 |
|------|------|------|
| `apps/worker-py/app/schemas.py` | modified | `ParseResponse.parser_issues`, `VisionRunRequest`, `VisionRunResponse`, `VISION_RUN_*` status 추가. |
| `apps/worker-py/app/routes/parse.py` | modified | `ParseResponse(... parser_issues=parser_issues)`로 스캔 플래그를 웹에 전달. |
| `apps/worker-py/app/routes/vision.py` | modified | 신규 `POST /v1/vision/run` — 동기 오케스트레이터: `start_async_text_detection`→`get_operation_status` 폴링→`collect_result`→`normalize_vision_output`→정규화 라인/evidence 반환. |
| `apps/worker-py/app/services/vision_client.py` | modified | async request feature type을 `DOCUMENT_TEXT_DETECTION`으로 고정. |
| `apps/worker-py/app/services/vision_normalizer.py` | modified | `vision_result_to_invoice_lines()` 헬퍼 추가. |
| `apps/web/src/lib/parser-client.ts` | modified | `ParseResponse.parser_issues` 타입과 `runVisionOcr()` 메서드 추가. |
| `apps/web/src/app/api/invoice-audit/run/route.ts` | modified | fire-and-forget → 동기 환류. `SCANNED_PAGE_DETECTED` 감지 → `runVisionOcr` → OCR lines/evidence를 `cf.validate` 전에 병합. 실패 시 AMBER `SCANNED_PDF_NEEDS_OCR`. |
| `apps/web/src/lib/types.ts` | modified | `VISION_RUN` trace step 추가. |
| `apps/web/tests/api-invoice-audit-run.test.ts` | modified | Vision run mock OCR COLLECTED, OCR 병합, Vision 실패/AMBER 테스트 추가. |
| `reports/20260616_GCS_UPLOAD_PATH_SETUP_v1.md` | modify | 현재 fire-and-forget 설명을 보정. Vision 활성화 env(`VISION_ENABLED`,`GOOGLE_CLOUD_PROJECT`,`GCS_OCR_BUCKET`,`VISION_FALLBACK_ENABLED`) + 서비스계정/빌링/IAM 절차 + `/v1/vision/run` 동기 환류 smoke를 추가. |
| `reports/20260616_VISION_OCR_OPERATIONAL_CHECKLIST_v1.md` | modify | 기존 `/v1/vision/start`/`collect` fire-and-forget 운영 체크리스트를 `/v1/vision/run` 동기 환류 기준으로 보정. source bucket read, OCR bucket write/read/list, env redeploy, manual paid smoke를 분리. |

> 13-sheet 계약·verdict 등급 규칙 불변. Vision은 verdict authority가 아니라 입력(라인/evidence) 제공. raw OCR 원문 비노출.

`VisionRunResponse`는 raw OCR JSON이나 raw full text를 반환하지 않는다. 반환 대상은 normalized `invoice_lines`, `evidence_candidates`, `source_data`, `source_gcs_uri`, `ocr_json_gcs_uris`, `page_count`, `confidence`, `issues`, `status`로 제한한다.

## 검증 결과 (코드 한정 — 비용 0)

| 검증 | 결과 |
|------|------|
| Worker tests | 209/209 pass |
| Web typecheck | 0 errors |
| Web tests | 331/331 pass, 43 files |
| Web build | 성공 |

1. `cd apps/worker-py && pytest -q` → green (신규 vision_run + parser_issues 테스트 포함)
2. `pnpm --dir apps/web typecheck` → 0 errors
3. `pnpm --dir apps/web test` → green (스캔 invoice Vision 병합 + OFF 표기 테스트)
4. `pnpm --dir apps/web build` → 성공
5. Worker 공식 제약 테스트:
   - multi-output `output-*.json` collect 테스트.
   - non-`gs://` input reject/skip 테스트.
   - `DOCUMENT_TEXT_DETECTION` feature 사용 assert.
   - OCR response가 raw full text/raw JSON을 직접 반환하지 않는 테스트.
6. Web 공식 제약 테스트:
   - worker `/v1/vision/run` bounded timeout 위임 확인.
   - raw OCR JSON/text가 web response, trace, workbook에 직접 포함되지 않음 확인.
   - Vision pending/fail이어도 Rule #0 export path 유지.
7. 문서 검증:
   - `rg -n "/v1/vision/run|runVisionOcr|parser_issues|SCANNED_PDF_NEEDS_OCR|VISION_RUN_COLLECTED|DOCUMENT_TEXT_DETECTION|batchSize|output-\\*\\.json|redeploy|maxDuration|4.5MB" apps reports docs`
8. **무회귀**: Vision OFF(기본)에서 기존 텍스트 PDF/Excel 경로 동일 — DO/BOE 추출·검증 불변, 스캔본은 silent SKIP 대신 AMBER 표기.
9. **실 종단(유료, 사용자 활성화 후)**: 스캔 DN을 gs://로 업로드 → run → trace `VISION_RUN_COLLECTED` → OCR 라인/evidence가 검증·workbook에 반영 → 최종 13-sheet Excel. env 변경 후 새 deployment/redeploy 필요. 절차는 setup 문서.

## 구현 후 동작 흐름

```text
스캔 PDF 업로드 (gs://)
  → pdfplumber: SCANNED_PAGE_DETECTED
  → ParseResponse.parser_issues 전달
  → web run route가 scanned PDF 감지
  → VISION_FALLBACK_ENABLED=true + gs:// 확인
  → POST /v1/vision/run
  → worker: start → poll → collect → normalize
  → OCR invoice_lines + evidence 획득
  → cf.validate 전에 병합
  → 13-sheet xlsx에 OCR 라인 포함
  → 실패/타임아웃이면 AMBER SCANNED_PDF_NEEDS_OCR
```

## 리스크 & 완화

- **비용/자격증명**: Vision API 유료 + GCP 키/IAM = 사용자 콘솔 작업. 코드는 flag-off 기본 → 키 없으면 호출 0, 비용 0.
- **바운드 초과**: OCR이 시간 예산 초과 → AMBER OCR_PENDING(차단 아님, Rule #0). Cloud Run req timeout 내 폴링.
- **검증 불가(로컬)**: 유료 실 API는 로컬 테스트 불가 → mock 단위테스트로 로직 커버 + 사용자 활성화 후 수동 smoke 문서화.
- **무회귀**: 모든 신규 동작 `VISION_FALLBACK_ENABLED` + gs:// 조건 뒤. 기본 OFF.
- **원문 보호**: raw OCR text는 trace/workbook/로그에 원문 비노출(정규화 값·해시만).
- **Vercel 제한**: long polling은 web route가 직접 하지 않는다. response body limit 때문에 OCR JSON 원문은 web으로 넘기지 않는다. env 변경 후 redeploy하지 않으면 production에 반영되지 않는다.
- **Vision 구조화 한계**: Vision은 OCR text provider다. line item 구조화 실패 또는 low confidence는 최소 AMBER이며 자동 PASS 금지.
- **롤백**: 워커 rev 1줄 + 웹 1커밋 revert.

## 범위 밖
- 비동기 콜백 재검증(동기 방식 채택). 기존 `/v1/vision/start|collect` 삭제(유지).
- GCP 키/빌링/IAM 실설정(사용자). 13-sheet 계약·verdict 규칙 변경.
- 텍스트 PDF 추출 로직 변경(이미 동작).

## 최신 코드 기준 결론

이 문서는 **구현 완료 보고서**다. 최신 로컬 코드 기준으로 Track ②의 핵심 목표인 **스캔 PDF OCR 결과를 같은 invoice-audit run에 동기 병합**하는 경로가 구현되어 있다. 운영 실사용에는 GCP 키/빌링/IAM/env/redeploy와 유료 manual smoke가 별도로 필요하다.
