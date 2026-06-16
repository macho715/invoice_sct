# SCT HVDC Invoice Audit Platform — Vision Fallback Orchestration 구현 작업서 v1

**작성일:** 2026-06-15  
**대상 레포:** `SCT_ONTOLOGY-main`  
**기준 계획:** `plan-20260615-vision-fallback-orchestration.md`  
**대상 설계서:** `docs/20260615_MarkItDownMCP_GoogleVision_통합_WORKFLOW_PROCESS_상세설계서_v1.md`  
**구현 옵션:** B — web run route에서 Vision start만 fire-and-forget  
**Feature flag 기본값:** `VISION_FALLBACK_ENABLED=false`

---

## 1. 현재 상태

이미 완료된 선행 작업:

```text
[x] Google Vision/GCS billing 연결
[x] dsv-invoice-source bucket 생성
[x] dsv-invoice-ocr bucket 생성
[x] worker /v1/vision/start live smoke 성공
[x] worker /v1/vision/collect live smoke 성공
[x] worker route-level live smoke 성공
[x] v_vision_rules.py 추가
[x] vision_normalizer.py -> v_vision_rules.py 연결
[x] worker full pytest 175 passed
[x] web GCS signed upload helper 추가
[x] web full vitest 169 passed
```

이번 승인 후 완료된 핵심 작업:

```text
[x] web /api/invoice-audit/run 이 Vision fallback을 자동 trigger
[x] parser-client.ts 에 /v1/vision/start client 추가
[x] run route 테스트에 flag OFF/ON/실패 격리 케이스 추가
```

---

## 2. 구현 목표

`/api/invoice-audit/run`은 기존 판정 흐름을 유지한다.

`VISION_FALLBACK_ENABLED=true`이고 source file 중 GCS PDF가 있으면, web은 worker `/v1/vision/start`를 fire-and-forget으로 호출한다.

이 phase에서는 Vision collect 결과를 verdict에 반영하지 않는다.

목표 원칙:

```text
기존 verdict 불변
기존 export 흐름 불변
Vision trigger 실패 격리
raw PDF/OCR text trace 저장 금지
feature flag 기본 OFF
```

---

## 3. 변경 파일

| 파일 | 변경 유형 | 작업 |
|---|---|---|
| `apps/web/src/lib/parser-client.ts` | modify | `startVisionOcr()` 추가 |
| `apps/web/src/app/api/invoice-audit/run/route.ts` | modify | Vision fallback trigger 블록 추가 |
| `apps/web/tests/parser-client.test.ts` | modify | Vision start client 테스트 추가 |
| `apps/web/tests/api-invoice-audit-run.test.ts` | modify | flag OFF/ON/실패 격리 테스트 추가 |
| `docs/20260615_MarkItDownMCP_GoogleVision_통합_WORKFLOW_PROCESS_상세설계서_v1.md` | modify | 구현 완료 후 orchestration 상태 갱신 |

---

## 4. parser-client.ts 상세

추가 타입:

```typescript
export type VisionStartPayload = {
  job_id: string;
  file_id: string;
  source_gcs_uri: string;
  output_gcs_prefix: string;
};

export type VisionStartResult = {
  job_id: string;
  file_id: string;
  operation_name?: string;
  output_gcs_prefix?: string;
  status: 'VISION_DISABLED' | 'STARTED' | 'STUB';
  error_code?: string;
};
```

추가 메서드:

```typescript
startVisionOcr(req: VisionStartPayload): Promise<VisionStartResult>
```

동작:

```text
POST ${workerBaseUrl}/v1/vision/start
body = VisionStartPayload
timeout = VISION_TRIGGER_TIMEOUT_MS || 8000
non-2xx -> VISION_DISABLED + error_code
AbortError/Timeout -> VISION_DISABLED + TRIGGER_TIMEOUT
기타 fetch 실패 -> VISION_DISABLED + TRIGGER_FAILED
```

주의:

```text
NotebookLM trigger와 달리 예외를 밖으로 던지지 않는다.
run route verdict를 절대 깨지 않기 위함이다.
```

---

## 5. run/route.ts 상세

삽입 위치:

```text
기존 primary parser 결과와 decision 생성 이후
NotebookLM fire-and-forget trigger 근처
response 반환 전
```

후보 선택:

```typescript
const pdfsToScan = [invoiceFile, ...evidenceFiles].filter(f => f.file_type === 'pdf');
```

GCS URI 판단:

```text
우선순위:
1. source file의 gcs_uri 필드가 있으면 사용
2. blob_ref가 gs:// 로 시작하면 사용
3. 둘 다 없으면 skip
```

OCR output prefix:

```text
gs://${GCS_OCR_BUCKET}/jobs/${job_id}/${file_id}/
```

Trace:

```text
step: VISION_FALLBACK
input_ref: source_gcs_uri 또는 file_id
output_ref:
  VISION_FALLBACK_SKIPPED
  VISION_FALLBACK_TRIGGERED
  VISION_DISABLED
  VISION_FALLBACK_FAILED
source_hash: 기존 source file sha256
```

---

## 6. Feature Flags / Env

```text
VISION_FALLBACK_ENABLED=false
GCS_OCR_BUCKET=dsv-invoice-ocr
VISION_TRIGGER_TIMEOUT_MS=8000
PARSER_WORKER_URL=<worker base URL>
API_SECRET_KEY=<worker auth secret if required>
```

기본값:

```text
VISION_FALLBACK_ENABLED=false
```

기본 OFF 이유:

```text
외부 OCR 비용과 GCS output 생성을 운영자 승인 뒤로 미룬다.
기존 production behavior를 변경하지 않는다.
```

---

## 7. 테스트 작업

### 7.1 parser-client.test.ts

추가 케이스:

```text
[x] startVisionOcr sends POST /v1/vision/start with correct body
[x] startVisionOcr returns STARTED response
[x] startVisionOcr converts non-2xx to VISION_DISABLED
[x] startVisionOcr converts timeout/fetch failure to VISION_DISABLED
```

### 7.2 api-invoice-audit-run.test.ts

주의:

기존 run route 테스트는 fetch mock 수에 민감하다.
따라서 Vision trigger는 반드시 `VISION_FALLBACK_ENABLED === 'true'` 뒤에 둔다.

추가 케이스:

```text
[x] flag OFF: Vision start 미호출, 기존 verdict 동일
[x] flag ON + GCS PDF: Vision start 호출, 기존 verdict 동일
[x] flag ON + non-GCS PDF: skip, 기존 verdict 동일
[x] Vision start 실패: route 응답/verdict/export 불변
```

---

## 8. 검증 명령

작업 후 실행:

```powershell
pnpm --dir apps/web typecheck
pnpm --dir apps/web test -- --run tests/parser-client.test.ts tests/api-invoice-audit-run.test.ts
pnpm --dir apps/web test -- --run
```

선택 smoke:

```powershell
$env:VISION_FALLBACK_ENABLED = "true"
$env:GCS_OCR_BUCKET = "dsv-invoice-ocr"
```

GCS PDF가 있는 job으로 `/api/invoice-audit/run` 호출 후 trace 확인:

```text
VISION_FALLBACK_TRIGGERED
operation_name present
output_gcs_prefix present
raw OCR text absent
```

---

## 9. Acceptance Criteria

```text
[x] VISION_FALLBACK_ENABLED 미설정 시 기존 tests/api-invoice-audit-run.test.ts fetch mock 수가 깨지지 않는다.
[x] flag ON + GCS PDF source면 worker /v1/vision/start가 호출된다.
[x] Vision trigger 실패가 /invoice-audit/run verdict를 바꾸지 않는다.
[x] trace에는 raw OCR/PDF text가 남지 않는다.
[x] web typecheck 통과.
[x] web targeted vitest 통과.
[x] web full vitest 통과.
```

검증 결과:

```text
targeted vitest:
tests/parser-client.test.ts + tests/api-invoice-audit-run.test.ts
24 passed

web typecheck:
PASS

web full vitest:
176 passed / 31 files
```

---

## 10. 구현 제외 범위

이번 작업에서 하지 않는다:

```text
Vision collect 결과를 web verdict에 반영
worker callback queue 추가
DB migration 추가
GCS object lifecycle 정책 추가
production env 변경
deployment
```

---

## 11. 롤백

즉시 롤백:

```text
VISION_FALLBACK_ENABLED=false
```

코드 롤백:

```text
run/route.ts Vision fallback block 제거
parser-client.ts startVisionOcr 제거
관련 테스트 제거
```

---

## 12. 현재 판정

```text
DONE
```

구현 완료.

실제 변경:

```text
apps/web/src/lib/parser-client.ts
apps/web/src/app/api/invoice-audit/run/route.ts
apps/web/tests/parser-client.test.ts
apps/web/tests/api-invoice-audit-run.test.ts
```
