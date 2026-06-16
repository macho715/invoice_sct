# GCS 업로드 경로 활성화 가이드 — 증빙 PDF → gs:// (Vision OCR 선결)

- **작성일**: 2026-06-16
- **목적**: Track ② Vision OCR의 선결 조건인 "증빙 PDF를 gs:// 버킷으로 업로드"하는 경로를 활성화하는 절차.
- **상태**: 코드 배선 완료(flag-off 기본, 무회귀). 실제 활성화는 아래 env/인프라 설정 후.
- **연계**: [`20260616_PDF_PARSER_UPGRADE_PLAN_v1.md`](./20260616_PDF_PARSER_UPGRADE_PLAN_v1.md) Track ②.

## 무엇이 코드로 구현됐나

| 요소 | 위치 | 동작 |
|------|------|------|
| 서명 PUT URL 발급 | `apps/web/src/app/api/files/create-upload-url` + `lib/gcs-upload.ts` | `GCS_UPLOAD_ENABLED=true`면 GOOG4-RSA-SHA256 서명 PUT URL 반환. optional `job_id` 수용(multi-file 한 job). |
| 업로드 확정 | `apps/web/src/app/api/files/confirm` | PUT 완료 후 `blob_ref = gs://...`로 SourceFile 등록, job `UPLOADED`. |
| 대시보드 증빙 업로드 | `AppendEvidenceUpload.tsx` | `NEXT_PUBLIC_GCS_UPLOAD_ENABLED=true` + PDF면 create-upload-url → 서명 PUT → confirm. dev fallback(비-GCS URL) 시 기존 ingest로 자동 폴백. |
| Vision 트리거 | `run/route.ts` L367-408 | `VISION_FALLBACK_ENABLED=true`면 gs:// PDF에 `/v1/vision/start` 호출(fire-and-forget). 비-gs:// PDF는 `VISION_FALLBACK_SKIPPED`. |
| 미들웨어/CSP | `middleware.ts`, `next.config.js` | create-upload-url·confirm public 허용, CSP `connect-src`에 `storage.googleapis.com` 추가(브라우저 PUT). |

## 활성화 절차 (사용자/관리자 작업 — 코드 아님)

> ⚠️ 자격증명 입력·IAM 변경은 보안상 본 어시스턴트가 대신 수행하지 않음. 아래는 운영자가 직접 수행.

### 1. GCS 버킷 (스토리지 비용만, Vision 미포함)
- 소스 버킷(예: `dsv-invoice-source`) 생성 — 없으면.
- **CORS**: 웹 origin(`https://<prod-domain>`, 로컬은 `http://localhost:3000`)에서 `PUT` 허용. method=`PUT`, responseHeader=`content-type`, origin=웹 도메인.

### 2. Vercel 웹 env (GCS 업로드 ON)
다음 env 키를 Vercel 프로젝트에 설정(값은 콘솔에서 직접 입력):
- `GCS_UPLOAD_ENABLED` = `true`
- `NEXT_PUBLIC_GCS_UPLOAD_ENABLED` = `true`  (클라이언트 분기 플래그)
- `GCS_SOURCE_BUCKET` (또는 `GCS_EVIDENCE_BUCKET`)
- `GCS_CLIENT_EMAIL`  (서비스계정 이메일)
- `GCS_PRIVATE_KEY`   (서비스계정 키 — `\n` 이스케이프 형식 허용)

### 3. (별도·유료) Vision OCR 실발화 — 비용 승인 후
- 워커: `VISION_ENABLED=true`, `GOOGLE_CLOUD_PROJECT=<proj>` (+필요 시 `VISION_BATCH_SIZE`, `VISION_MIME_TYPE`)
- 웹: `VISION_FALLBACK_ENABLED=true`, `GCS_OCR_BUCKET=<ocr-bucket>`
- 출력 버킷(예: `dsv-invoice-ocr`) + 서비스계정에 Vision API + Storage objectViewer/objectCreator 권한.

## 검증 (활성화 후)

1. 대시보드에서 증빙 PDF 업로드 → 네트워크 탭에서 `PUT https://storage.googleapis.com/...` 200 확인.
2. `confirm` 200 → job source_files에 `blob_ref = gs://...` 등록 확인.
3. run 실행 → trace에 `VISION_FALLBACK_TRIGGERED`(Vision ON 시) 또는 `VISION_FALLBACK_SKIPPED`(Vision OFF 시) 확인.
4. 최종 13-sheet Excel 다운로드 — verdict 불변(Vision은 fire-and-forget, verdict에 영향 없음).

## 동작 경계 / 주의

- **gs:// 파일은 Vercel 런타임에서 byte-fetch 불가** → pdfplumber 파싱 안 됨. 그래서 gs:// 경로는 **증빙 PDF(Vision 대상)에만** 적용. 구조화 인보이스(xlsx)·PDF-인보이스 소스는 Vercel Blob 유지(Track ① pdfplumber 보존).
- gs:// 증빙은 run route 증빙 루프에서 `EVIDENCE_PARSE SKIPPED`(격리됨) → Vision이 담당. **OCR 결과 collect→evidence 환류는 후속 Phase**(이번 범위 밖).
- **무회귀**: `NEXT_PUBLIC_GCS_UPLOAD_ENABLED` 미설정 시 기존 Vercel Blob/ingest 경로 그대로. prod 영향 0.
- raw PDF/OCR 원문은 콘솔·trace·workbook에 그대로 남기지 않음.
