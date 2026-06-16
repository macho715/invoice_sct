# 인보이스 검증 시스템 병목 및 누락 단계 진단 보고서

**일자:** 2026년 6월 16일  
**대상 시스템:** SCT Invoice Audit Platform  
**작성자:** Jules (Software Engineer)

---

## 1. 개요
본 보고서는 SCT Invoice Audit Platform의 현재 아키텍처 및 소스 코드를 분석하여, 시스템의 성능 저하를 유발하는 병목 지점과 기능적 완성도를 위해 보완이 필요한 누락 단계를 진단한 결과를 담고 있습니다.

## 2. 주요 병목 지점 (Bottlenecks)

### 2.1. 인보이스 라인별 순차적 검증 (Sequential Line Validation)
`apps/web/src/lib/cf-mcp-client.ts`의 `validate` 함수에서 모든 인보이스 라인에 대해 MCP 도구들을 순차적으로 호출하고 있습니다.
- **문제점:** `classify_type_b`, `check_rate_card`, `check_evidence_required` 등의 도구들이 `for...of` 루프 내에서 하나씩 실행되므로, 인보이스 라인 수에 비례하여 전체 처리 시간이 선형적으로 증가합니다.
- **영향:** 수백 개의 라인이 포함된 대형 인보이스의 경우 타임아웃 발생 가능성이 높습니다.

### 2.2. 증빙 서류(PDF)의 순차적 파싱
`apps/web/src/app/api/invoice-audit/run/route.ts`에서 다수의 PDF 증빙 서류(`evidenceFiles`)를 파싱할 때 순차적으로 처리합니다.
- **문제점:** 각 파일마다 파서 워커(`parser-py`)에 네트워크 요청을 보내고 응답을 기다리는 과정을 반복합니다.
- **영향:** 증빙 서류 개수가 많을수록 파싱 단계의 지연시간(latency)이 누적됩니다.

### 2.3. 배치(Batch) 처리 미흡
`packages/tools`에는 `check_rate_card_batch`와 같은 배치 처리용 도구가 이미 구현되어 있으나, 현재 웹 앱의 감사 흐름(`cf-mcp-client.ts`)에서는 이를 충분히 활용하지 않고 라인별 단일 호출을 수행하고 있습니다.
- **문제점:** 데이터베이스 쿼리 오버헤드가 매 라인마다 발생합니다.

## 3. 누락된 단계 및 기능적 공백 (Missing Steps & Gaps)

### 3.1. 서버 측 업로드 검증 부재
현재 파일의 MIME 타입, 크기, 확장자 체크는 클라이언트 측(`upload-form.tsx`)에서 주로 수행됩니다.
- **문제점:** `run` 라우트나 GCS 업로드 라우트에서 동일한 검증 로직이 서버 측에 재구현되어 있지 않아, 직접적인 API 호출을 통한 부적절한 파일 유입을 차단할 수 없습니다.

### 3.2. Vision OCR 결과의 실시간 연동 부족
`VISION_FALLBACK_ENABLED`가 활성화되어 있어도, 이는 현재 "Fire-and-forget" 방식으로 실행됩니다.
- **문제점:** 워커가 Vision OCR을 통해 추출한 JSON 결과물을 다시 웹 앱의 감사 파이프라인(Validation/Gate)에 통합하여 자동으로 인보이스 라인을 생성하거나 검증에 사용하는 단계가 누락되어 있습니다. 현재 스캔된 PDF는 여전히 0개 라인으로 추출되어 수동 리뷰(AMBER)로 분류됩니다.

### 3.3. 파서 워커 보안 강화 필요
`SYSTEM_ARCHITECTURE.md`에 명시된 바와 같이, Python 파서 워커가 Cloud Run에서 `--allow-unauthenticated` 상태로 실행 중입니다.
- **문제점:** 웹 앱이 보내는 `PARSER_WORKER_TOKEN`에 대한 유효성 검증이 워커 측에서 엄격하게 이루어지지 않고 있어 보안 노출 위험이 있습니다.

## 4. 개선 권고 사항

1.  **병렬 처리 도입:** `Promise.all`을 사용하여 독립적인 인보이스 라인 검증 및 증빙 서류 파싱을 병렬로 수행하도록 변경해야 합니다.
2.  **배치 도구 활용:** `check_rate_card` 호출 시 배치 버전을 사용하여 DB 쿼리 횟수를 획기적으로 줄여야 합니다.
3.  **서버 측 검증 강화:** `upload-validation.ts`의 로직을 서버 API 라우트에도 적용하여 데이터 유효성을 보장해야 합니다.
4.  **OCR 워크플로우 통합:** Vision OCR 결과를 수집(Collect)하여 정규화된 라인으로 변환하는 `Normalizer` 로직을 파이프라인에 포함시켜야 합니다.
5.  **워커 인증 고도화:** Cloud Run IAM 인증 또는 Bearer 토큰 검증 로직을 워커에 명시적으로 추가해야 합니다.
