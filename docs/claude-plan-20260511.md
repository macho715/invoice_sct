# Claude HVDC Ontology App — historical implementation plan

| 항목 | 값 |
|---|---|
| 문서명 | Claude 전용 HVDC Ontology App Implementation Plan |
| 작성일 | 2026-05-11 |
| 기준 문서 | `chatgpt-app-submission.json`, `server/src/index.ts`, `SYSTEM_ARCHITECTURE.md` |
| 파이프라인 위치 | **[plan]** → review → ship → qa |

---

## Current status update - 2026-05-13

This document is the original 2026-05-11 Claude layer plan and is kept as history.
The current primary connection model is no longer a separate local Claude runtime.
Claude Code, Claude Desktop, and claude.ai now use the Cloudflare remote MCP endpoint:

```text
https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp
```

`claude:dev`, `claude:start`, and `claude:stdio` now run an `mcp-remote` bridge to Cloudflare.
`claude:local` is the only local debugging fallback.

## Phase 1 — CEO Review

### 1.1 문제 정의

**2026-05-11 당시 상태**: HVDC Ontology 답변 앱은 ChatGPT 전용으로만 동작했다. `@modelcontextprotocol/ext-apps`, `ui://hvdc/` 리소스 URI, `openai/outputTemplate` 메타 등 ChatGPT SDK 의존 요소가 하드코딩되어 있어 Claude Desktop / Claude Code에서는 tool이 노출되지 않고 위젯 렌더링이 불가능했다.

**현재 목표 상태**: 동일한 corpus·answer 코어를 유지하면서 Claude 계열 클라이언트가 Cloudflare remote MCP의 11개 tool을 사용한다. `server/src/claude-server.ts`는 운영 주경로가 아니라 legacy/local fallback과 포맷 테스트용으로만 남긴다. upload/write tool은 Cloudflare remote MCP에서만 실제 R2/D1 storage adapter를 사용하고, local fallback은 `AUTH_REQUIRED`를 반환한다.

**영향 범위**: HVDC Project Logistics 사용자 全員 — ChatGPT 미사용자·Claude Code 사용자(개발팀 포함) 포함.

---

### 1.2 제안 옵션

| 옵션 | 설명 | 공수(일) | 리스크 | 비용 |
|---|---|---|---|---|
| **A — Cloudflare remote MCP bridge (현재 기준)** | Claude Code, Claude Desktop, claude.ai가 Cloudflare MCP URL을 직접 사용한다. stdio-only client는 `mcp-remote` bridge를 사용한다. `claude-render.ts`는 포맷 테스트와 fallback 렌더링에 남긴다. | **완료** | 낮음 — 공유 코어 무변경 | 0 AED (내부) |
| **B — 단일 서버 분기** | `server/src/index.ts`에 `CLIENT_TYPE` 환경변수 분기 추가. ChatGPT/Claude를 같은 파일에서 처리 | 1 | 중간 — 기존 ChatGPT 동작 회귀 위험, descriptor.test.ts 파괴 가능 | 0 AED |
| **C — Proxy 서버** | 기존 ChatGPT 서버 앞에 Claude 전용 proxy를 두어 메타 변환 | 3 | 높음 — 운영 복잡도 증가, 추가 배포 환경 필요 | 0 AED |

---

### 1.3 추천 & 근거

**현재 추천**: Cloudflare remote MCP를 단일 운영 경로로 사용한다. 공유 코어(`answer.ts`, `corpus.ts`, `router.ts`, `redact.ts`, `types.ts`)를 Worker에서 재사용하므로 ChatGPT, Claude, Cursor 연결 기준이 하나로 통일된다.

**롤백 전략**: Cloudflare remote MCP에 문제가 생기면 Node fallback과 legacy/local Claude fallback을 디버깅 경로로 사용한다. 운영 문서는 production URL 기준을 유지한다.

---

### 1.4 승인 요청

- [ ] Phase 1 승인 — 옵션 A로 진행

---

## Phase 2 — Engineering Review

### 2.1 아키텍처 다이어그램

```mermaid
graph TD
  subgraph 공유 코어 (변경 없음)
    ANSWER["server/src/answer.ts"]
    CORPUS["server/src/corpus.ts"]
    ROUTER["server/src/router.ts"]
    REDACT["server/src/redact.ts"]
    TYPES["server/src/types.ts"]
  end

  subgraph ChatGPT 레이어 (Cloudflare Workers)
    CGT_IDX["server/src/worker.ts<br/>(createMcpHandler / /mcp)"]
    CGT_UI["server/src/ui.ts"]
    CGT_WIDGET["public/hvdc-answer-widget.html<br/>ui://hvdc/answer-card-v6.html"]
    CGT_SUB["chatgpt-app-submission.json"]
  end

  subgraph Claude 레이어 (Cloudflare remote MCP)
    CL_SERVER["Cloudflare MCP URL<br/>same /mcp endpoint"]
    CL_RENDER["server/src/claude-render.ts<br/>(legacy/local fallback parser)"]
    CL_SUB["claude-app-submission.json"]
    CL_DOC["docs/CONNECT_CLAUDE.md"]
  end

  subgraph 테스트 (신규)
    CL_TEST["tests/claude-descriptor.test.ts"]
  end

  CL_SERVER --> ANSWER
  CL_SERVER --> CORPUS
  CL_SERVER --> ROUTER
  CL_SERVER --> REDACT
  CL_SERVER --> TYPES
  CL_SERVER --> CL_RENDER

  CGT_IDX --> ANSWER
  CGT_IDX --> CORPUS
  CGT_IDX --> ROUTER
  CGT_IDX --> REDACT
  CGT_IDX --> TYPES
  CGT_IDX --> CGT_UI

  CL_RENDER -->|"파싱 A: ChatGPT format\n(_meta openai/outputTemplate 포함)"| TYPES
  CL_RENDER -->|"파싱 B: Claude format\n(GroundedAnswer 직접)"| TYPES

  CL_TEST --> CL_SERVER
  CL_TEST --> CL_SUB
```

---

### 2.2 파일 변경 목록

| 파일 | 변경 유형 | 설명 |
|---|---|---|
| `server/src/claude-server.ts` | **legacy/local fallback** | 기존 fallback 파일이다. 현재 운영 연결 기준은 Cloudflare remote MCP다. |
| `server/src/claude-render.ts` | **create** | `GroundedAnswer` → 마크다운 카드 렌더러. ChatGPT format(openai 메타 포함) + Claude format 양쪽 파싱. |
| `claude-app-submission.json` | **create** | Claude 앱 설정. `chatgpt-app-submission.json`과 병렬 구조. `claude_desktop_config.json` 스니펫 포함. |
| `docs/CONNECT_CLAUDE.md` | **create** | Claude Desktop / Claude Code 연결 가이드. 테스트 프롬프트 5개. |
| `tests/claude-descriptor.test.ts` | **create** | `claude-app-submission.json` ↔ Claude 서버 tool 목록 parity 검증. 포맷 파싱 round-trip 테스트. |
| `package.json` | **modify** | `"claude:dev"`, `"claude:start"` 스크립트 추가. |
| `AGENTS.md` | **modify** | Claude 전용 섹션 추가 (tool 목록, 포트, 파싱 계약). |

> **⚠️ 파일명 충돌 체크**:
> - `claude-server.ts`: 현재는 legacy/local fallback 파일로 존재한다.
> - `claude-render.ts`: `server/src/` 내 없음 — 안전 (기존 `ui.ts`는 ChatGPT 전용 유지)
> - `claude-app-submission.json`: 루트 내 없음 — 안전
> - `docs/CONNECT_CLAUDE.md`: `docs/` 내 없음 — 안전
> - `tests/claude-descriptor.test.ts`: `tests/` 내 없음 — 안전

---

### 2.3 의존성 & 순서

```
1. server/src/claude-render.ts    ← TYPES 의존만 있음. 독립 작성 가능.
2. claude-app-submission.json     ← Cloudflare MCP URL과 11개 tool 목록 기준.
3. start-hvdc-mcp.cmd             ← stdio-only client용 `mcp-remote` bridge.
4. tests/claude-descriptor.test.ts ← 2, 3 완료 후 작성.
5. docs/CONNECT_CLAUDE.md         ← 2 완료 후 작성 (포트·URL 확정).
6. package.json 수정              ← 2 완료 후 스크립트 추가.
7. AGENTS.md 수정                 ← 전체 완료 후 문서 갱신.
```

---

### 2.4 Claude 전용 파싱 계약 (`claude-render.ts`)

```
입력 A — ChatGPT format (render_hvdc_answer_card 응답):
  {
    structuredContent: { ...GroundedAnswer, ui: { templateUrl: "ui://hvdc/..." } },
    _meta: { "openai/outputTemplate": "ui://hvdc/...", ui: { resourceUri: "..." } }
  }
  → _meta 제거, structuredContent.ui 제거
  → GroundedAnswer 추출 → 마크다운 렌더링

입력 B — Claude format (Cloudflare remote MCP 또는 legacy/local fallback 응답):
  {
    structuredContent: { ...GroundedAnswer }   // ui 없음
  }
  → 직접 마크다운 렌더링

공통 출력 (마크다운 카드):
  ## HVDC Ontology Answer — {verdict}
  **Route:** {requiredDocs join ", "}
  **Summary:** {summary}
  **Business Impact:** {businessImpact}
  ### Evidence ({evidence.length}건)
  - [{docId}] {sectionPath} — confidence {confidence}
  ...
  ### Validation
  - [{severity}] {ruleId}: {message}
  ### Next Actions
  - {actionType} (ownerRole: {ownerRole}, humanGate: {humanGateRequired})
```

---

### 2.5 legacy/local fallback tool 등록 방식

```typescript
// ChatGPT: registerAppTool(server, name, descriptor, handler)
// Claude: server.tool(name, description, inputSchema, handler)

server.tool(
  "ask_hvdc_ontology",
  "HVDC logistics question answered from ontology corpus with evidence, validation, and next action.",
  { question: z.string(), userRole: z.string().optional(), language: z.enum(["ko","en","auto"]).optional() },
  async ({ question, userRole, language }) => {
    const answer = answerQuestion({ question, userRole, language });
    return {
      content: [{ type: "text", text: renderAnswerMarkdown(answer) }]
    };
  }
);

// render_hvdc_answer_card: 양쪽 포맷 파싱 후 마크다운 반환
server.tool(
  "render_hvdc_answer_card",
  "Render HVDC answer card. Accepts both ChatGPT-format (with openai/_meta) and Claude-format GroundedAnswer.",
  { /* answerOutputSchema identical to ChatGPT version */ },
  async (input) => {
    const answer = parseGroundedAnswer(input); // ChatGPT or Claude format
    return {
      content: [{ type: "text", text: renderAnswerMarkdown(answer) }]
    };
  }
);
```

---

### 2.6 테스트 전략

| 테스트 | 파일 | 커버 범위 |
|---|---|---|
| Claude tool descriptor parity | `tests/claude-descriptor.test.ts` | `claude-app-submission.json` tool 이름과 fallback tool 목록 일치 |
| ChatGPT format 파싱 | `tests/claude-descriptor.test.ts` | `_meta["openai/outputTemplate"]` 포함 입력 → GroundedAnswer 추출 성공 |
| Claude format 파싱 | `tests/claude-descriptor.test.ts` | `ui` 없는 순수 GroundedAnswer → 마크다운 렌더 성공 |
| 마크다운 카드 필수 필드 | `tests/claude-descriptor.test.ts` | verdict, route, evidence count, actions 포함 여부 |
| **전체 회귀 테스트** | `npm run verify` | TypeScript typecheck, Vitest 8 files / 113 tests, Worker dry-run 통과 |

---

### 2.7 `claude-app-submission.json` 구조

```json
{
  "$schema": "claude-app-submission.v1.json",
  "schema_version": 1,
  "app_info": {
    "display_name": "HVDC Ontology Answer",
    "subtitle": "HVDC evidence answers for Claude",
    "description": "...",
    "category": "BUSINESS"
  },
  "mcp_server": {
    "production_url": "https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp"
  },
  "claude_desktop_config": {
    "mcpServers": {
      "hvdc-ontology": {
        "type": "http",
        "url": "https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp"
      }
    }
  },
  "tools": { /* 6개 동일 */ },
  "test_cases": [ /* Claude 전용 시나리오 */ ],
  "negative_test_cases": [ /* 동일 */ ]
}
```

---

### 2.8 리스크 & 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| Cloudflare remote MCP URL이 문서와 설정에서 달라짐 | Claude/Cursor/ChatGPT 연결 혼선 | 모든 연결 문서는 `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`를 기준으로 유지 |
| `claude-render.ts`가 ChatGPT format 입력을 잘못 파싱 | 답변 데이터 누락 | `parseGroundedAnswer` 함수에 format discriminator (`_meta["openai/outputTemplate"]` 존재 여부)로 분기 |
| stdio bridge와 HTTP 설정이 서로 달라짐 | 일부 Claude client만 연결 실패 | `start-hvdc-mcp.cmd`와 Claude HTTP 설정을 같은 Cloudflare URL로 맞춘다 |
| 기존 descriptor.test.ts가 Claude 서버 파일을 인식해 ChatGPT 파일 목록 오판 | false fail | `descriptor.test.ts`는 `chatgpt-app-submission.json`만 검사하므로 영향 없음 — 단, import 범위 확인 필요 |
| `package.json` 스크립트 추가 후 `npm run verify`에 `claude:dev` 포함 여부 오해 | CI 혼선 | `verify` 스크립트 변경 없이 `claude:dev` / `claude:start`만 추가 |

---

## 파이프라인 연결

계획이 승인되면:

> 계획이 확정되었습니다. **`/review`**로 코드 리뷰 체크리스트를 준비하거나, 바로 구현을 시작하시겠습니까?

구현 순서 요약:
1. `claude-app-submission.json` → 2. `.mcp.json` / Claude settings → 3. `start-hvdc-mcp.cmd` → 4. `docs/CONNECT_CLAUDE.md` → 5. `package.json` → 6. tests/docs verification

검증:
```bash
npm run verify   # 8개 test file / 113개 테스트와 Worker dry-run 확인
```
