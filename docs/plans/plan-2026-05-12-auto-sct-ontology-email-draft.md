# Auto SCT_ONTOLOGY for Email Draft Requests — Phase 1 Plan

## Phase 1: Business Review

### 1.1 Problem Definition

현재 상태: `답장 작성하라`처럼 사용자가 명시적으로 `sct_ontology`를 부르지 않는 경우 ChatGPT가 일반 답장 초안을 먼저 생성하고, HVDC ontology card를 자동으로 호출하지 않는다.

목표 상태: HVDC 물류 이메일 답장 작성 요청은 사용자가 `sct_ontology`를 말하지 않아도 `ask_hvdc_ontology`가 먼저 호출되고, 그 다음 `OntologyReview -> EmailActionCard -> Draft` 순서로 출력된다.

영향 범위:

| 항목 | 현재 영향 |
|---|---|
| 자동 app invocation | 이메일 답장 요청에서 누락될 수 있음 |
| 사용자 UI | `HVDC ontology answer ready` 카드가 먼저 나오지 않을 수 있음 |
| 검증 신뢰도 | corpus rule은 존재하지만 tool 미호출 시 적용되지 않음 |
| 회귀 범위 | MCP descriptor, submission test cases, descriptor tests, pipeline route tests |

확인한 원인:

1. `server/src/index.ts`의 `ask_hvdc_ontology` 설명은 일반 HVDC logistics question 중심이며, `답장 작성하라`, email draft, attachment-based reply 요청을 자동 trigger로 강하게 적지 않는다.
2. `chatgpt-app-submission.json` positive test cases에는 email reply/draft 요청이 `ask_hvdc_ontology`를 trigger해야 한다는 케이스가 없다.
3. `tests/descriptor.test.ts`는 AGI/Flow Code 프롬프트만 `ask_hvdc_ontology` trigger 대상으로 확인한다.
4. `server/src/answer.ts`에는 `isEmailDraftRequest()`와 communication routing 로직이 있지만, 이 코드는 `ask_hvdc_ontology`가 이미 호출된 뒤에만 실행된다.
5. `data/corpus/CONSOLIDATED-08-communication.md`의 mandatory rule은 corpus 근거다. tool이 호출되기 전 ChatGPT의 초기 tool 선택을 직접 강제하지 못한다.

### 1.2 Options

| 옵션 | 설명 | 공수(일) | 리스크 | 비용(AED) |
|---|---|---:|---|---:|
| A | MCP tool descriptor와 `chatgpt-app-submission.json` test case를 보강한다. `답장 작성하라`도 `ask_hvdc_ontology` trigger로 명시한다. | 0.50 | 중간 | 0.00 |
| B | 별도 `draft_hvdc_email_reply` MCP tool을 추가한다. 이메일 초안 전용 tool로 자동 호출을 유도한다. | 1.50 | 높음 | 0.00 |
| C | repo 변경 없이 ChatGPT 사용자 지침 또는 운영 프롬프트만 수정한다. | 0.25 | 높음 | 0.00 |

### 1.3 Recommendation

추천: Option A.

이유:

1. 현재 서버는 6개 tool 계약을 유지해야 하므로 새 tool 추가는 descriptor/test/제출 계약을 흔든다.
2. 문제는 runtime 답변 생성보다 ChatGPT 초기 tool 선택 신호가 약한 데 있다.
3. descriptor와 submission test case를 보강하면 앱 제출 기준과 회귀 테스트가 같은 방향으로 고정된다.

Rollback:

`server/src/index.ts`, `chatgpt-app-submission.json`, `tests/descriptor.test.ts` 변경만 되돌리면 기존 6-tool 계약으로 즉시 복귀할 수 있다.

### 1.4 Approval Request

- [ ] Phase 1 승인

승인 후 Phase 2에서 파일별 변경안, 테스트 전략, 배포 순서를 작성하고 구현으로 넘어간다.
