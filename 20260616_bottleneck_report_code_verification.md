# 20260616 병목 보고서 실제 코드 검증 보고서

**검증일:** 2026-06-16  
**검증 대상 원문:** `20260616_bottleneck_report.md`  
**검증 기준:** 현재 로컬 저장소 코드 (`C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main`)  
**검증 방식:** 원문 주장 6개를 실제 코드 위치와 대조했다. 런타임 성능 측정은 하지 않았다.

---

## 1. 최종 판정

원문 보고서의 병목 진단 3개 중 3개는 현재 코드와 일치한다.

누락 단계 진단 3개 중 1개는 현재 코드와 일치하고, 2개는 현재 코드 기준으로 수정이 필요하다.

| 원문 항목 | 검증 판정 | 현재 코드 기준 결론 |
|---|---:|---|
| 2.1 라인별 순차 검증 | 확인됨 | `classify_type_b`, `check_rate_card`, `check_evidence_required`가 `for` 루프 안에서 `await`로 순차 실행된다. |
| 2.2 PDF 증빙 순차 파싱 | 확인됨 | `evidenceFiles`를 `for...of`로 돌며 `getSignedDownloadUrl`과 `parsePdfText`를 순차 실행한다. |
| 2.3 배치 처리 미흡 | 확인됨 | `check_rate_card_batch`와 `run_batch`는 구현되어 있으나 웹 감사 흐름은 `check_rate_card` 단건 호출을 사용한다. |
| 3.1 서버 측 업로드 검증 부재 | 현재 코드와 다름 | 서버 라우트에 MIME/확장자/크기/해시 검증이 존재한다. 다만 클라이언트의 `upload-validation.ts` 로직을 그대로 공유하지는 않는다. |
| 3.2 Vision OCR 실시간 연동 부족 | 확인됨 | Vision fallback은 `void async` fire-and-forget이며, OCR JSON 수집과 라인 정규화는 현재 run route의 verdict 입력이 아니다. |
| 3.3 파서 워커 인증 강화 필요 | 부분 확인 | Cloud Run 문서상 public invoker 구조는 맞다. 그러나 워커 코드에는 `PARSER_WORKER_TOKEN` Bearer 검증이 있다. 위험은 "인증 부재"가 아니라 "토큰 설정 의존 및 IAM 비사용"으로 써야 한다. |

---

## 2. 항목별 검증

### 2.1 라인별 순차 검증

**판정: 확인됨**

`apps/web/src/lib/cf-mcp-client.ts`에서 라인별 MCP 도구 호출이 순차 실행된다.

근거:

- `classify_type_b`: `processedLines` 루프 안에서 `await callTool(...)` 실행
- `check_rate_card`: `processedLines` 루프 안에서 `await callTool(...)` 실행
- `check_evidence_required`: `processedLines` 루프 안에서 `await callTool(...)` 실행

코드 위치:

- `apps/web/src/lib/cf-mcp-client.ts:241-253`
- `apps/web/src/lib/cf-mcp-client.ts:257-370`
- `apps/web/src/lib/cf-mcp-client.ts:397-410`

영향:

라인 수가 늘면 최소 3개 단계의 단건 호출 시간이 누적된다. `Promise.all` 또는 배치 API를 적용할 수 있는 후보가 맞다.

주의:

`check_cost_guard`는 이미 `lines: processedLines.map(...)` 형태의 1회 배치 호출이다. 모든 단계가 순차인 것은 아니다.

---

### 2.2 PDF 증빙 순차 파싱

**판정: 확인됨**

`apps/web/src/app/api/invoice-audit/run/route.ts`에서 증빙 PDF를 순차 처리한다.

근거:

- `evidenceFiles`를 `for (const evFile of evidenceFiles)`로 순회한다.
- 각 파일마다 `await getSignedDownloadUrl(...)` 후 `await parser.parsePdfText(...)`를 실행한다.
- 루프 안에서 `appendParseSourceData`, `appendTrace`도 순차 실행된다.

코드 위치:

- `apps/web/src/app/api/invoice-audit/run/route.ts:429-452`

영향:

증빙 PDF가 여러 개면 네트워크 왕복과 파싱 시간이 파일 개수만큼 누적된다.

개선 방향:

증빙 파일별 실패가 서로 독립적이므로, 동시성 제한이 있는 `Promise.allSettled` 또는 제한형 큐를 적용하는 편이 안전하다.

---

### 2.3 배치 처리 미흡

**판정: 확인됨**

배치 도구는 존재하지만 웹 감사 흐름은 단건 호출을 사용한다.

근거:

- `packages/tools/src/check_rate_card.ts`에 `check_rate_card_batch(chargeCodes)`가 있다.
- 같은 파일에 `run_batch(inputs)`가 있다.
- `apps/web/src/lib/cf-mcp-client.ts`는 `check_rate_card`를 라인별 단건 호출한다.
- 검색 결과 웹 감사 흐름에서 `check_rate_card_batch`를 직접 사용한 흔적은 없다.

코드 위치:

- `packages/tools/src/check_rate_card.ts:286-353`
- `packages/tools/src/check_rate_card.ts:357-370`
- `apps/web/src/lib/cf-mcp-client.ts:257-370`

영향:

중복 charge code가 많은 인보이스에서 DB 조회와 도구 호출 오버헤드가 커질 수 있다.

주의:

현재 `run_batch`는 charge code 중심 배치다. domestic lane key, unit, scope, type_b 같은 현재 웹 호출 인자를 모두 같은 의미로 보존하는지 추가 확인이 필요하다.

---

### 3.1 서버 측 업로드 검증 부재

**판정: 현재 코드와 다름**

원문은 서버 측 업로드 검증이 없다고 썼지만, 현재 코드에는 서버 검증이 존재한다.

근거:

- `/api/invoices/upload-url`는 업로드 토큰 발급 시 허용 content type과 최대 50MB를 지정한다.
- `/api/invoices`는 등록 단계에서 blob URL, filename, size, sha256, MIME/확장자를 검증한다.
- `/api/invoice-audit/run`은 실행 요청 body 크기, job token, source hash를 검증한다.

코드 위치:

- `apps/web/src/app/api/invoices/upload-url/route.ts:27-35`
- `apps/web/src/app/api/invoices/upload-url/route.ts:45-53`
- `apps/web/src/app/api/invoices/route.ts:81-100`
- `apps/web/src/app/api/invoices/route.ts:118-119`
- `apps/web/src/app/api/invoice-audit/run/route.ts:150-168`

정정 문장:

서버 측 검증은 부재가 아니다. 다만 클라이언트의 `apps/web/src/lib/upload-validation.ts`와 서버 라우트의 허용 파일 규칙이 별도 구현이라, 정책 drift가 생길 수 있다.

---

### 3.2 Vision OCR 실시간 연동 부족

**판정: 확인됨**

Vision fallback은 현재 감사 verdict를 만드는 입력으로 즉시 통합되지 않는다.

근거:

- `VISION_FALLBACK_ENABLED`가 true일 때만 실행된다.
- PDF 목록을 돌며 `void (async () => { ... parser.startVisionOcr(...) })()`로 비동기 트리거한다.
- 주석에 OCR JSON은 GCS에 기록되고 collection은 later phase 또는 polling으로 미뤄진다고 적혀 있다.
- 바로 뒤의 zero-line guard는 `parseRes.normalized.invoice_lines`만 본다.

코드 위치:

- `apps/web/src/app/api/invoice-audit/run/route.ts:361-408`
- `apps/web/src/app/api/invoice-audit/run/route.ts:410-427`

영향:

스캔 PDF가 최초 parser 결과에서 0라인이면 Vision OCR이 나중에 성공하더라도 현재 run route는 곧바로 `NO_INVOICE_LINES_EXTRACTED` AMBER 경로로 갈 수 있다.

정정 필요:

원문에서 "스캔된 PDF는 여전히 전부 0개 라인"처럼 단정하면 과하다. 현재 문서와 코드상 native-text PDF는 worker parser가 라인을 만들 수 있다. 문제는 Vision OCR 비동기 결과가 같은 run에서 라인 정규화와 verdict 입력으로 회수되지 않는다는 점이다.

---

### 3.3 파서 워커 인증 강화 필요

**판정: 부분 확인**

Cloud Run이 `--allow-unauthenticated`로 배포된다는 문서 근거는 있다. 그러나 워커 코드에는 app-layer Bearer 토큰 검증이 존재한다.

근거:

- `SYSTEM_ARCHITECTURE.md`는 Cloud Run worker가 public invoker이고 `PARSER_WORKER_TOKEN` app bearer로 보호된다고 설명한다.
- `apps/worker-py/app/main.py`는 `/v1/*`, `/parse`, `/parse/*`에 대해 `Authorization: Bearer <PARSER_WORKER_TOKEN>`을 검사한다.
- 단, 검증은 `PARSER_WORKER_TOKEN` 환경변수가 설정된 경우에만 활성화된다.

코드 위치:

- `SYSTEM_ARCHITECTURE.md:134-139`
- `SYSTEM_ARCHITECTURE.md:247-254`
- `apps/worker-py/app/main.py:20-29`

정정 문장:

워커 인증이 "없다"가 아니라, Cloud Run IAM은 열려 있고 앱 레벨 Bearer 토큰에 의존한다. 운영 환경에서 `PARSER_WORKER_TOKEN`이 비어 있으면 보호가 꺼지는 구조이므로, startup fail-fast 또는 IAM 전환 검토가 보안 강화 포인트다.

---

## 3. 우선순위 제안

### P0: 보고서 문구 정정

먼저 원문 보고서의 부정확한 부분을 정정해야 한다.

- 서버 측 업로드 검증 부재 -> 서버 검증은 존재하지만 정책 중복과 drift 위험이 있음
- 워커 토큰 검증 부재 -> 토큰 검증은 존재하지만 환경변수 설정 의존과 public invoker 구조 위험이 있음
- 스캔 PDF 전부 0라인 -> Vision fallback 결과가 같은 run의 verdict 입력으로 회수되지 않음

### P1: 실제 병목 개선 후보

1. `cf-mcp-client.ts`의 `classify_type_b`를 제한형 병렬 처리로 전환한다.
2. `check_rate_card`는 배치 호출로 바꾸기 전에 domestic lane, unit, scope, type_b 의미 보존을 테스트한다.
3. `check_evidence_required`는 도구가 순수 함수인지 확인한 뒤 제한형 병렬 처리를 적용한다.
4. `evidenceFiles` 파싱은 `Promise.allSettled`와 동시성 제한을 적용한다.

### P2: OCR 통합 후보

Vision OCR을 같은 run에서 verdict 입력으로 쓰려면 다음 단계가 필요하다.

1. Vision operation 완료 polling 또는 callback 수집 경로를 정한다.
2. OCR JSON에서 text span을 line 후보로 바꾸는 normalizer를 만든다.
3. OCR normalizer 결과와 pdfplumber 결과를 비교해 source hash와 manifest에 남긴다.
4. zero-line guard 전에 OCR-derived line 후보를 사용할지 정책을 정한다.

---

## 4. 검증 한계

이번 검증은 정적 코드 대조다.

실제 처리 시간, DB 쿼리 횟수, Cloud Run 배포 환경변수, 운영 IAM 상태는 측정하지 않았다.

따라서 병목 "가능성"은 코드 구조로 확인했지만, 운영 성능 영향의 크기는 별도 계측이 필요하다.

---

## 5. 검증 명령 요약

```powershell
rg -n "classify_type_b|check_rate_card|check_evidence_required|check_rate_card_batch|Promise\.all|batch" apps/web/src/lib/cf-mcp-client.ts packages/tools apps/mcp-server -S
rg -n "evidenceFiles|VISION|vision|Promise\.all|PARSER_WORKER_TOKEN|Authorization|Bearer" apps/web/src/app/api/invoice-audit/run/route.ts apps/web/src/lib apps/worker-py/app -S
rg -n "upload-validation|mime|MIME|size|extension|upload" apps/web/src/app/api apps/web/src/lib/upload-validation.ts apps/web/src/components/upload-form.tsx -S
rg -n "Authorization|Bearer|PARSER_WORKER_TOKEN|HTTPException|401|/v1/parse|/v1/export" apps/worker-py SYSTEM_ARCHITECTURE.md -S
```

---

## 6. 결론

원문 보고서는 병목 방향은 대체로 맞다.

하지만 업로드 검증과 워커 인증 부분은 현재 코드와 어긋난다.

이 보고서를 기준으로 원문을 업데이트한 뒤, 실제 수정은 `cf-mcp-client.ts`의 라인 검증 병렬화와 `run/route.ts`의 증빙 PDF 파싱 병렬화부터 진행하는 것이 가장 직접적이다.
