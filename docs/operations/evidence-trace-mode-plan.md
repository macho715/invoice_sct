# Evidence Trace Mode Plan

## Overview

HVDC Ontology Grounded ChatGPT App의 Evidence 품질을 높인다.

현재 목표는 답변의 각 주요 문장이 어떤 evidence로 뒷받침되는지 보여주고, Evidence Drawer에서 문서명, 섹션, 원문, 연결된 답변 문장을 함께 확인하게 만드는 것이다.

## Goals

- 답변 문장과 `evidenceId` 연결을 명확히 보여준다.
- Evidence Drawer를 단순 근거 목록이 아니라 검토 가능한 근거 화면으로 개선한다.
- 기존 `NO_EVIDENCE`, `BLOCK`, validation, PII masking 경계를 유지한다.
- ChatGPT와 Claude 출력의 핵심 근거 의미가 어긋나지 않게 한다.

## Scope

### In Scope

- `ask_hvdc_ontology` 결과에 답변-근거 연결 정보를 추가한다.
- summary, details, actions 같은 주요 답변 영역을 evidence와 연결한다.
- `render_hvdc_answer_card` 위젯에서 근거 번호를 표시한다.
- Evidence Drawer에서 근거 원문과 연결된 답변 문장을 함께 보여준다.
- 관련 pipeline, descriptor, widget 테스트를 갱신한다.

### Out of Scope

- 새 MCP tool 추가는 하지 않는다.
- 새 corpus 의미나 업무 규칙은 추가하지 않는다.
- 외부 검색, ERP/WMS/ATLP write-back, 이메일/WhatsApp 발송은 하지 않는다.
- KG/SPARQL 런타임 구현은 하지 않는다.
- evidence 점수화는 이번 범위에서 제외한다.

## Constraints

- 근거 없는 답변은 여전히 `NO_EVIDENCE` 또는 `BLOCK`이어야 한다.
- UI 실패는 `verdict`, `validationStatus`, `evidenceIds`, `actions`를 바꾸면 안 된다.
- PII masking 규칙을 약화하면 안 된다.
- 기존 6개 MCP tool 이름은 유지한다.
- corpus 변경이 생기면 index 재생성과 drift check가 필요하다.
- 가정: 이번 작업은 corpus 내용 변경 없이 서버 구조와 UI 표시 개선 중심으로 진행한다.

## Phases

1. 현재 답변 구조와 evidence 구조를 확인한다.
2. 답변-근거 연결 필드를 최소 구조로 설계한다.
3. 서버 응답에 연결 정보를 추가한다.
4. Evidence Drawer UI에 연결 정보를 표시한다.
5. ChatGPT/Claude 출력 차이를 점검한다.
6. 관련 테스트를 갱신하고 `npm run verify`로 확인한다.

## Tasks

- `server/src/types.ts`에서 답변-근거 연결 타입을 정리한다.
- `server/src/answer.ts`에서 summary/details/actions와 evidence를 매핑한다.
- `server/src/ui.ts` 또는 관련 UI 상태 생성 로직에서 연결 정보를 위젯에 전달한다.
- `public/hvdc-answer-widget.html`에서 근거 번호와 Drawer 연결 표시를 추가한다.
- `server/src/claude-render.ts`에서 Claude 마크다운 출력이 연결 정보를 잃지 않게 한다.
- `tests/pipeline.test.ts`에서 연결 정보가 생성되는지 확인한다.
- `tests/widget.test.ts`에서 Evidence Drawer 표시와 외부 fetch 금지를 함께 확인한다.
- `tests/descriptor.test.ts`와 `tests/claude-descriptor.test.ts`에서 tool 계약이 유지되는지 확인한다.
- `npm run verify`를 실행한다.

## Risks

- 연결 정보가 과하게 복잡하면 답변 구조가 읽기 어려워질 수 있다.
- evidence가 약한 질문에서 억지 연결이 생기면 신뢰도가 떨어질 수 있다.
- UI만 개선되고 검증 로직이 그대로이면 실제 품질 개선으로 보기 어렵다.
- ChatGPT 위젯과 Claude 마크다운 출력이 서로 다른 의미를 보여줄 수 있다.

## Review Criteria

- 답변 주요 문장마다 연결된 evidence가 있거나, 근거 부족 상태가 명확히 표시된다.
- Evidence Drawer에서 문서명, 원문, 연결된 답변 문장을 확인할 수 있다.
- `NO_EVIDENCE` 경로에서 근거 없는 연결이 생성되지 않는다.
- 기존 read/render tool 이름과 descriptor parity가 유지된다. 이후 추가된 protected upload/write tool은 별도 descriptor parity로 관리한다.
- `npm run verify`가 통과한다.
- 사용자 기준으로 "이 문장이 어떤 문서 근거에서 왔는지"를 확인할 수 있다.

## Deliverables

- Evidence Trace Mode 설계 반영 코드
- 갱신된 위젯 UI
- 갱신된 테스트
- 검증 결과 요약
- 필요하면 `docs/PLAN.md` 또는 별도 계획 문서 패치
