# Track ② — GCS Vision OCR 운영 연결 체크리스트

**작성일**: 2026-06-16
**상태**: 코드 완료, 배포 env 설정 대기

---

## 1. 코드 검증 (완료)

| 검증 | 결과 |
|------|------|
| `/v1/vision/start` 라우트 | 동작 확인 (VisionClient.start_async_text_detection) |
| `/v1/vision/collect` 라우트 | 동작 확인 (poll + collect + normalize_vision_output) |
| `/v1/preflight` 라우트 | stub 동작 (text_parser 권장) |
| `/v1/vision/preflight` 사용 | 사용 안 함 (계획서 금지사항 준수) |
| VisionClient (GCS → async OCR) | `VISION_ENABLED` + `GOOGLE_CLOUD_PROJECT` 게이트 |
| VisionNormalizer | OCR JSON → evidence candidates + invoice_no/total/confidence |
| Web run route Vision trigger | `VISION_FALLBACK_ENABLED === 'true'` + `gs://` 조건 게이트 |
| Parser client `startVisionOcr()` | 호출 경로 연결 완료 |
| Raw OCR 텍스트 보호 | trace/workbook에는 GCS URI만 기록, raw text 미노출 |
| Vision tests | 19/19 pass (worker) |
| Web tests | 327/327 pass |

---

## 2. 운영 env 설정 (필요)

### Worker (`apps/worker-py`)

```bash
VISION_ENABLED=true
GOOGLE_CLOUD_PROJECT=dsv-invoice
# 선택
VISION_BATCH_SIZE=1
VISION_MIME_TYPE=application/pdf
```

### Web (`apps/web`)

```bash
VISION_FALLBACK_ENABLED=true
GCS_OCR_BUCKET=dsv-invoice-ocr
```

---

## 3. GCP 인프라 확인 (필요)

| 리소스 | 상태 |
|--------|------|
| `dsv-invoice-source` bucket | GCP worklog에 생성 기록 있음 — 운영 확인 필요 |
| `dsv-invoice-ocr` bucket | GCP worklog에 생성 기록 있음 — 운영 확인 필요 |
| `svc-invoice-parser` 서비스 계정 | 생성 기록 있음 — IAM 확인 필요 |
| `roles/storage.objectViewer` | source bucket 읽기 |
| `roles/storage.objectCreator` | ocr bucket 쓰기 |
| `roles/vision.ai.*` | Vision API 호출 권한 |

---

## 4. gs:// 입력 경로 조건

Vision fallback은 다음 조건이 **모두** 충족될 때만 트리거됨:

1. `VISION_FALLBACK_ENABLED === 'true'` (web env)
2. PDF file의 `blob_ref` 또는 `gcs_uri`가 `gs://`로 시작
3. Worker에 `VISION_ENABLED === 'true'` + `GOOGLE_CLOUD_PROJECT` 설정

**현재**: Vercel Blob 업로드 경로만 사용 중 → `blob_ref`가 `https://*.blob.vercel-storage.com` 이므로 Vision 트리거 조건 불충족.
**필요**: GCS 업로드 경로(`/api/files/create-upload-url`) 활성화 또는 Blob→GCS 브리지 추가.

---

## 5. 종단 흐름 (기대)

```
PDF 업로드 (gs://dsv-invoice-source/...)
  → run route: vision_fallback 진입 조건 충족
  → POST /v1/vision/start  →  STARTED
  → (비동기 Vision OCR, 수 분 소요)
  → POST /v1/vision/collect →  COLLECTED
  → normalize_vision_output →  evidence_candidates
  → workbook trace: VISION_FALLBACK_TRIGGERED → COLLECTED
  → 최종 13-sheet xlsx (Vision 증빙 포함)
```

---

## 6. 게이트 규칙

| 상황 | 최소 판정 |
|------|-----------|
| BOE/customs 문서 Vision fallback | AMBER |
| Low confidence (<0.85) | AMBER |
| Scanned only (pdfplumber 실패 → Vision만) | AMBER |
| Vision 자동 PASS | **금지** |
| Raw OCR text 누출 | **금지** (현재 보호됨) |

---

## 7. 롤백

```bash
# Vision fallback 비활성화 (즉시 적용)
VISION_FALLBACK_ENABLED=false

# Worker Vision 비활성화
VISION_ENABLED=false
```

---

## 8. 배포 전 확인사항

- [ ] `dsv-invoice-source` bucket 존재 + 접근 가능
- [ ] `dsv-invoice-ocr` bucket 존재 + 접근 가능
- [ ] `svc-invoice-parser` SA에 Vision + GCS 권한 부여
- [ ] Worker env `VISION_ENABLED=true`, `GOOGLE_CLOUD_PROJECT=dsv-invoice` 설정
- [ ] Web env `VISION_FALLBACK_ENABLED=true`, `GCS_OCR_BUCKET=dsv-invoice-ocr` 설정
- [ ] GCS 업로드 경로(`/api/files/create-upload-url`) 활성화 → `gs://` blob_ref 생성 확인
- [ ] PDF upload → run → `VISION_FALLBACK_TRIGGERED` trace 확인
- [ ] `STARTED → COLLECTED → evidence_candidates > 0` 확인
- [ ] BOE/customs PDF → AMBER 이상 확인
- [ ] 13-sheet xlsx download → Vision evidence 참조 확인
