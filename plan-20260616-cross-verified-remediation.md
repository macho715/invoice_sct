# Cross-Verified Remediation Plan

Purpose: 두 교차검증 보고서에서 실제 코드로 확인된 gap만 실행 계획으로 정리하고, 현재 저장소 규칙과 충돌하는 항목은 범위 밖으로 분리한다.

## Overview

이 계획은 다음 두 보고서를 입력으로 한다.

- `20260616_bottleneck_report_code_verification.md`
- `20260616_pasted_dsv_final_validator_code_cross_verification.md`

두 보고서의 공통 결론은 다음이다.

- 병목 진단 중 라인별 순차 검증, PDF 증빙 순차 파싱, rate card 배치 미활용은 실제 코드와 일치한다.
- DSV Final Validator 전용 runtime mode는 현재 기본 run path에 없다.
- `Final_Recon` 부재, workbook validator 부재, MCP tool registry 미연결 주장은 실제 코드와 다르다.
- 현재 기본 workbook 계약은 13-sheet audit pack이다.
- DLP gate 추가와 9-sheet 기본 전환은 현재 저장소 규칙과 충돌하거나 별도 승인 없이는 범위 밖이다.

## Goals

1. 잘못된 진단을 개발 작업 목록에서 제거한다.
2. 실제 코드로 확인된 병목과 runtime gap만 수정 후보로 남긴다.
3. 13-sheet Rule #0 audit pack 계약을 보존한다.
4. DSV Final Validator가 필요하면 기본 경로를 대체하지 않고 별도 track 또는 mode로 분리한다.
5. 수정 전후 검증 기준을 명확히 한다.

## Scope

### In Scope

- 기존 병목 보고서와 DSV Final Validator 진단문의 부정확한 문구 정정.
- `apps/web/src/lib/cf-mcp-client.ts`의 라인별 순차 검증 개선 계획.
- `apps/web/src/app/api/invoice-audit/run/route.ts`의 PDF 증빙 순차 파싱 개선 계획.
- `check_rate_card_batch` 또는 `run_batch` 활용 가능성 검토.
- Vision OCR fallback 결과를 같은 audit flow에 통합할지 여부를 결정하기 위한 사전 설계.
- `apps/worker-py/app/routes/parse.py`의 `_fetch_blob()` hardening 계획.
- workbook contract validator를 export 후 자동 검증으로 연결할지 여부 검토.
- DSV v3.x 전용 track이 필요한 경우 13-sheet 기본 계약과 분리하는 계획.

### Out of Scope

- 현재 계획 문서에서 코드 구현.
- 13-sheet 기본 workbook 계약을 8-sheet 또는 9-sheet로 대체.
- `03_Type_B_Summary` 또는 `93_Audit_Log`를 기본 13-sheet 계약에 바로 추가.
- DLP를 새 gate, verdict source, upload blocker, export blocker, workflow phase로 추가.
- 운영 배포, Cloud Run IAM 변경, Vercel production 변경, production env var 변경.
- private contract rate 원본을 저장소에 추가하거나 커밋.
- graph node degree만 근거로 runtime 미연결을 단정하는 작업.

## Constraints

- Rule #0에 따라 Excel invoice 또는 PDF evidence 업로드는 최종 13-sheet audit pack으로 이어져야 한다.
- 현재 13-sheet 순서와 이름을 rename, remove, reorder, hide 하면 안 된다.
- LP/DLP는 이 저장소의 새 gate로 추가하지 않는다.
- NotebookLM은 extraction evidence only이며 최종 verdict source가 아니다.
- MarkItDown MCP는 conversion/evidence layer이며 최종 verdict source가 아니다.
- Google Vision은 OCR layer이며 invoice semantics를 단독으로 결정하지 않는다.
- Production deploy, IAM 변경, storage bucket 변경, database migration은 수동 승인 전까지 실행하지 않는다.
- 코드 변경 시 최소 diff를 유지한다.
- Assumption: DSV Final Validator 전용 track은 필요할 수 있지만, 아직 기본 13-sheet contract를 대체하도록 승인되지 않았다.

## Phases

### Phase 1: Source Reports Correction

목적은 잘못된 진단을 실행 backlog에서 제거하는 것이다.

- 병목 보고서에서 서버 측 업로드 검증 부재 주장을 정정한다.
- 워커 인증 부재 주장을 `PARSER_WORKER_TOKEN` 설정 의존 위험으로 정정한다.
- DSV 진단문에서 `Final_Recon`, workbook validator, MCP registry 미검출 주장을 정정한다.
- DLP gate와 9-sheet 기본 전환 요구를 범위 밖으로 표시한다.

### Phase 2: Performance Bottleneck Plan

목적은 실제 코드로 확인된 병목만 개선 후보로 좁히는 것이다.

- `classify_type_b` 라인별 순차 호출을 제한형 병렬 처리 후보로 검토한다.
- `check_rate_card` 단건 호출을 batch path로 바꿀 수 있는지 검토한다.
- `check_evidence_required`가 병렬 처리 가능한지 확인한다.
- `evidenceFiles` PDF parsing을 제한형 병렬 또는 `Promise.allSettled` 형태로 바꿀 수 있는지 검토한다.

### Phase 3: OCR And PDF Runtime Plan

목적은 Vision OCR fallback과 PDF parser 결과가 감사 verdict에 어떻게 들어갈지 결정하는 것이다.

- Vision operation 완료 확인 방식이 polling인지 callback인지 정한다.
- OCR JSON에서 invoice line 후보를 만들 normalizer 책임 범위를 정한다.
- zero-line guard 전에 OCR-derived line 후보를 사용할지 정책을 정한다.
- `_fetch_blob()`의 production fetch 정책을 Vercel Blob/GCS signed URL 기준으로 정한다.

### Phase 4: DSV Track Separation Plan

목적은 DSV v3.x Final Validator 요구를 기존 13-sheet Rule #0과 충돌하지 않게 분리하는 것이다.

- DSV Final Validator가 필요한 workflow 조건을 정한다.
- 기본 13-sheet export와 DSV 전용 sheet contract를 분리한다.
- `03_Type_B_Summary`와 `93_Audit_Log`는 DSV track 후보로만 검토한다.
- DSV self-test와 app e2e 연결 여부를 정한다.

### Phase 5: Verification Plan

목적은 수정 여부를 DONE으로 판정할 수 있는 검증 기준을 정하는 것이다.

- web/API 변경은 web typecheck와 targeted Vitest로 검증한다.
- worker 변경은 targeted pytest로 검증한다.
- workbook 변경은 13-sheet order와 manifest를 검증한다.
- DSV track을 추가하는 경우 기존 13-sheet export와 DSV track을 별도로 검증한다.

## Tasks

1. 원문 보고서 정정 패치 작성.
2. `cf-mcp-client.ts`에서 라인별 tool call dependency를 표로 정리.
3. 병렬 처리 가능 도구와 순차 유지 도구를 분리.
4. `check_rate_card_batch`가 domestic lane, unit, scope, type_b 의미를 보존하는지 확인.
5. PDF evidence parsing 실패 처리 정책을 `allSettled` 기준으로 정리.
6. Vision OCR 결과 수집 시점과 zero-line guard 관계를 문서화.
7. `_fetch_blob()`의 허용 URL, timeout, size, auth, hash 검증 요구를 정리.
8. workbook contract validator 자동 실행 위치 후보를 정리.
9. DSV track 필요 여부를 13-sheet 기본 계약과 분리해 결정.
10. 각 변경 후보별 최소 검증 명령을 확정.

## Risks

- 병렬 처리 변경이 tool call 순서에 의존하는 로직을 깨뜨릴 수 있다.
- `check_rate_card_batch`가 현재 단건 호출의 domestic lane semantics를 완전히 보존하지 못할 수 있다.
- PDF evidence parsing을 병렬화하면 worker 부하 또는 rate limit 문제가 생길 수 있다.
- Vision OCR 결과를 같은 run에 통합하면 run 시간이 길어질 수 있다.
- DSV 8/9-sheet 요구를 기본 13-sheet 계약에 섞으면 Rule #0 workbook contract가 깨질 수 있다.
- DLP gate 표현을 다시 도입하면 현재 저장소 규칙과 충돌한다.
- Production fetch hardening은 운영 env와 storage 정책을 확인하지 않으면 로컬에서만 맞는 구현이 될 수 있다.

## Review Criteria

- 정정된 문서가 실제 코드와 다른 주장을 backlog로 남기지 않는다.
- 기본 export는 계속 13-sheet 순서를 유지한다.
- DLP는 새 gate로 추가되지 않는다.
- MCP registry 미연결 같은 오판이 반복되지 않는다.
- 병렬 처리 계획은 dependency와 실패 처리 정책을 포함한다.
- DSV 전용 track은 기본 audit flow를 대체하지 않고 분리된다.
- 검증 명령이 각 변경 후보와 직접 연결된다.

## Deliverables

- 정정된 병목 보고서 또는 정정 패치.
- 정정된 DSV Final Validator 진단문 또는 정정 패치.
- 병목 개선 대상 목록.
- DSV track 분리 여부 결정 메모.
- `_fetch_blob()` hardening 요구사항 메모.
- 변경 후보별 검증 명령 목록.

## Approval Readiness Note

이 계획은 구현 승인이 아니라 실행 범위 승인용 초안이다.

승인 전에 결정해야 할 항목은 하나다.

- DSV Final Validator를 별도 track으로 유지할지, 아니면 현재 13-sheet audit pack 안의 일부 검증 로직으로만 흡수할지 결정해야 한다.
