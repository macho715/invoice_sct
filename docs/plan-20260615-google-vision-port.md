# Google Vision 시스템 이식 Phase 1 계획

작성일: 2026-06-15
대상 경로: `C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main`
기준 문서: `20260615_MarkItDownMCP_GoogleVision_통합_WORKFLOW_PROCESS_상세설계서_v1.md`
사용 스킬: `mstack-plan`
상태: Phase 1 승인 대기

## Phase 1: Business Review

### 1.1 문제 정의

현재 인보이스 감사 시스템은 text PDF에 대해 `pdfplumber` 중심으로 동작하고, scanned PDF 또는 image PDF의 안정적인 OCR 이식 경로가 아직 운영 경로로 고정되지 않았다.

목표 상태는 Google Vision OCR을 parser 계층에 추가하고, OCR 결과를 기존 `NormalizedInvoice` 및 `EvidenceCandidate` 흐름으로 병합해 기존 감사 verdict 체계를 유지하는 것이다.

영향 범위:

| 범위 | 영향 |
|---|---|
| Web | 업로드/감사 실행 시 PDF 원본 위치와 parser 호출 정책이 영향받는다. |
| Worker Parser | `preflight`, `vision/start`, `vision/collect`, Vision JSON normalizer가 추가된다. |
| Database | `extraction_artifacts`, `extraction_comparisons` 같은 추출 산출물 저장소가 필요하다. |
| MCP Audit | 감사 verdict는 계속 MCP 검증 결과를 기준으로 유지한다. |
| Security | PDF 원문과 OCR 결과가 P2 데이터일 수 있으므로 로그/외부 전송 제어가 필요하다. |

### 1.2 제안 옵션

| 옵션 | 설명 | 공수(일) | 리스크 | 비용(AED) |
|---|---|---:|---|---:|
| A | 최소 이식. Worker에 Google Vision OCR 어댑터만 추가하고 기존 `/v1/parse` 내부에서 scanned PDF일 때만 사용한다. | 2-3 | 빠르지만 GCS signed upload, artifact 추적, comparison 저장이 약하다. | 낮음 |
| B | 권장 이식. `preflight -> Vision OCR -> MarkItDown markdown -> merge -> 기존 MCP audit` 순서로 이식하고 feature flag로 단계별 ON/OFF를 둔다. | 5-7 | 변경 파일이 많지만 설계서의 To-Be 흐름과 맞고 롤백이 쉽다. | 중간 |
| C | 전체 클라우드 재배치. Web까지 Cloud Run/GCS 중심으로 재구성한다. | 10-15 | 범위가 커서 현재 Vercel 운영 경로와 충돌 가능성이 크다. | 높음 |

### 1.3 추천 & 근거

추천은 옵션 B다.

이유:

1. 기존 Phase 1 NotebookLM 트리거처럼 feature flag 기본 OFF 정책을 유지할 수 있다.
2. Google Vision은 OCR 전용으로 고정하고, 감사 verdict는 기존 Parser+MCP 결과를 유지할 수 있다.
3. scanned PDF 지원, 산출물 추적, 롤백 기준을 동시에 확보한다.

롤백 전략:

`GOOGLE_VISION_ENABLED=false` 또는 미설정 상태로 되돌리면 기존 `pdfplumber`/xlsx/md/txt 경로만 사용한다.

### 1.4 승인 요청

- [ ] Phase 1 승인: 옵션 B 방식으로 Google Vision 이식 계획을 확정한다.
- [ ] 보안 승인: OCR 대상 PDF와 Vision JSON을 P2 데이터로 취급하고 원문 로그를 금지한다.
- [ ] 비용 승인: scanned/low-confidence PDF에만 Vision을 AUTO 적용한다.

## 승인 후 작성할 Phase 2 범위

Phase 1 승인 전에는 구현 상세 설계와 파일별 변경안을 확정하지 않는다.

승인 후 Phase 2에서 작성할 항목:

| 항목 | 내용 |
|---|---|
| Mermaid 다이어그램 | Web, Worker, GCS, Google Vision, MCP Audit 간 호출 흐름 |
| 파일 변경 목록 | `apps/worker-py`, `apps/web`, `packages/contracts`, `migrations`, 테스트 파일 |
| 의존성 순서 | schema -> worker route -> parser client -> run route -> tests |
| 테스트 전략 | Vision client mock, scanned PDF fixture, parse route regression, web run-route flag tests |
| 리스크 완화 | P2 로그 차단, timeout/retry, feature flag, cost guard |

## Coordinator Input Packet

objective:

Google Vision OCR을 기존 SCT invoice audit pipeline에 이식하되, 기존 verdict의 단일 진실은 Parser normalization + MCP audit 결과로 유지한다.

non-negotiables:

- feature flag 기본값은 OFF다.
- NotebookLM 외부 전송과 Google Vision OCR은 별도 플래그로 분리한다.
- PDF 원문과 OCR JSON은 P2 데이터로 취급한다.
- raw OCR text는 로그에 남기지 않는다.
- 기존 165개 테스트가 깨지면 안 된다.

acceptance criteria:

- scanned PDF가 Vision OCR 경로로 라우팅된다.
- text PDF는 기존 `pdfplumber` 경로를 유지한다.
- Vision 결과가 `EvidenceCandidate`로 변환된다.
- OCR 실패가 기존 xlsx/md/txt 감사 경로를 깨지 않는다.
- flag OFF 상태에서 외부 Vision 호출이 발생하지 않는다.

option set:

- A: Worker 내부 최소 OCR 어댑터
- B: feature flag 기반 권장 이식
- C: 전체 Google Cloud 재배치

required evidence:

- 변경 파일 목록
- 실행한 테스트 이름
- Vision 호출 mock 검증
- flag OFF 미호출 검증
- raw P2 로그 미노출 확인

test expectations:

- `apps/worker-py` pytest
- `apps/web` vitest
- parser-client 단위 테스트
- invoice-audit run route regression
- scanned PDF fixture 기반 route test

