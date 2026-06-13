# HVDC Ontology App Improvement Plan

## Phase 1: Business Review

### 1.1 문제 정의

현재 상태(2026-05-13): HVDC Ontology ChatGPT App은 GitHub 검증 workflow와 Cloudflare Workers MCP 운영 배포를 갖고 있다. 남은 개선 범위는 문서 변경, 앱 제출 품질, 보안 감시, 평가 운영을 하나의 반복 가능한 운영 체계로 묶는 것이다.

목표 상태: `ontology` 변경이 자동 검증되고, ChatGPT Apps SDK 계약이 제출 기준에 맞으며, Evidence UI와 평가셋과 보안 감시가 함께 작동하는 운영 가능한 앱 저장소로 만든다.

현재 구현 상태(2026-05-13): Cloudflare production MCP는 11개 tool을 노출한다. `ask_hvdc_ontology`는 데이터 전용이고, `render_hvdc_answer_card`가 `ui://hvdc/answer-card-v7.html` 카드 template를 소유한다. v6, v5, render-name resource alias는 ChatGPT 캐시/호환성 보호용으로 유지한다. upload/write tool은 OAuth Bearer scope와 Human-gate approval이 있어야 Cloudflare R2/D1 관리 저장소에만 쓴다.

영향 범위:

- 공개 GitHub 저장소: `macho715/SCT_ONTOLOGY`
- Cloudflare Workers MCP 배포: `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`
- 핵심 검증 명령: `npm run index`, `npm run verify`
- 핵심 데이터 범위: `ontology/`, `data/corpus/`, `data/index/`
- 핵심 사용자 가치: 문서 변경 누락 감소, 근거 확인 강화, 제출 경고 감소, 토큰/취약점 조기 탐지

### 1.2 제안 옵션

| 옵션 | 설명 | 공수(일) | 리스크 | 비용(AED) |
|------|------|---------|--------|----------|
| A | 최소 운영 안정화: GitHub Actions 검증 보강, SDK schema/metadata 정리, secret/dependency/code scanning 활성화 | 1.0-1.5 | Evidence UI와 eval 자동화는 뒤로 밀림 | 0 |
| B | 균형형 개선: A에 Evidence Drawer 개선과 golden eval dataset을 추가 | 2.5-4.0 | UI와 eval 기준을 동시에 바꾸므로 테스트 범위 증가 | 0-소액 |
| C | 운영 플랫폼화: B에 GitHub Projects, Cloudflare Workers 배포, 릴리스/승인 workflow까지 연결 | 5.0-8.0 | public repo, deployment secret, 운영 권한 관리 리스크 증가 | 0-소액 |

### 1.3 추천 & 근거

추천 옵션: B.

이유:

- 이미 GitHub Actions 기본 검증이 있으므로, A만 하면 실무 체감 개선이 작다.
- Evidence Drawer와 golden eval은 사용자가 실제로 “문서 근거로 답하는가”를 확인하는 핵심 기능이다.
- Cloudflare 자동 배포와 GitHub Projects는 B가 안정된 뒤 붙이는 편이 안전하다.

실패 시 롤백 전략: B 작업은 기능 플래그 또는 별도 PR 단위로 나누고, 실패하면 마지막 통과 commit으로 되돌린다.

### 1.4 승인 요청

- [ ] Phase 1 승인

승인 전에는 Phase 2 Engineering Review, 코드 수정, workflow 변경, GitHub 설정 변경, 추가 push를 진행하지 않는다.
