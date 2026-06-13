## 판정

**조건부 PASS:** `SCT_ONTOLOGY` 결과 데이터는 정상이고, 패치 대상은 **카드 UI template resource 연결/로딩 계층**입니다.

## 근거

OpenAI Apps SDK 공식 문서는 “Structured content only, no component” 상황에서 `_meta.ui.resourceUri`가 **등록된 HTML resource**를 가리키고, resource가 `mimeType: "text/html;profile=mcp-app"`로 로드되어야 한다고 명시합니다. 또한 `openai/outputTemplate`는 ChatGPT 호환용 alias로 지원됩니다. ([developers.openai.com][1])

## 다음 행동

`SCT_ONTOLOGY`의 `templateUrl=ui://hvdc/answer-card-v5.html`를 **registered app resource + tool descriptor + contents[].uri** 3곳에서 동일하게 맞추고, MIME/CSP/bundle/cache를 순서대로 패치하십시오.

---

# 1. 문제 분리

| 구분               |                                                               현재 상태 | 판정                   | 패치 대상                                                                  |
| ---------------- | ------------------------------------------------------------------: | -------------------- | ---------------------------------------------------------------------- |
| Tool result data |            `dataStatus=OK`, `verdict=PASS`, `validationStatus=PASS` | 정상                   | 아님                                                                     |
| Business result  |                                        `businessResultVisible=true` | 정상                   | 아님                                                                     |
| UI card state    | `uiRenderStatus=READY`, `templateUrl=ui://hvdc/answer-card-v5.html` | 서버 선언상 정상            | 검증 필요                                                                  |
| 실제 현상            |                                          `failed to fetch template` | UI resource fetch 실패 | **resource registration / URI mismatch / MIME / CSP / bundle / cache** |

핵심은 **도구 응답 JSON이 실패한 것이 아니라 ChatGPT client가 `ui://hvdc/answer-card-v5.html` template resource를 가져오지 못한 것**입니다.

---

# 2. OpenAI 공식 기준: 카드 UI가 뜨려면 필요한 4요소

| No | 필수 요소              | 공식 기준                                                | SCT_ONTOLOGY 적용                                          |
| -: | ------------------ | ---------------------------------------------------- | -------------------------------------------------------- |
|  1 | Resource 등록        | UI bundle은 MCP resource로 노출되어야 함                     | `ui://hvdc/answer-card-v5.html` 등록                       |
|  2 | MIME type          | `text/html;profile=mcp-app` 사용                       | 기존 legacy `text/html+skybridge` 사용 시 교체 검토               |
|  3 | Tool descriptor 연결 | `_meta.ui.resourceUri`가 template URI를 가리켜야 함         | `_meta.ui.resourceUri = "ui://hvdc/answer-card-v5.html"` |
|  4 | 호환 alias           | ChatGPT는 `_meta["openai/outputTemplate"]`도 alias로 지원 | 동일 URI로 병행 설정                                            |

OpenAI 문서는 tool descriptor에서 `structuredContent`를 반환하는 경우 `outputSchema`를 선언하라고도 합니다. 이는 카드 fetch 자체의 직접 원인은 아니지만, 클라이언트 검증·후속 tool call 안정성에 필요합니다. ([developers.openai.com][2])

---

# 3. 권장 패치안: TypeScript MCP server 기준

## 3.1 Template URI를 단일 상수로 고정

```ts
const TEMPLATE_URI = "ui://hvdc/answer-card-v5.html";
```

URI를 여러 곳에 하드코딩하면 `registerResource`, `_meta.ui.resourceUri`, `contents[].uri` 중 하나가 어긋나면서 `failed to fetch template`가 발생할 수 있습니다.

---

## 3.2 Resource 등록 패치

OpenAI 공식 예시는 `registerAppResource`로 HTML entry point를 등록하고, HTML 안에 compiled JS/CSS를 포함하는 구조를 제시합니다. resource의 `contents[].uri`와 등록 URI가 같아야 하며, MIME은 MCP Apps UI MIME type이어야 합니다. ([developers.openai.com][3])

```ts
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFileSync } from "node:fs";

const TEMPLATE_URI = "ui://hvdc/answer-card-v5.html";

const JS = readFileSync("web/dist/answer-card-v5.js", "utf8");
const CSS = readFileSync("web/dist/answer-card-v5.css", "utf8");

registerAppResource(
  server,
  "hvdc-answer-card-v5",
  TEMPLATE_URI,
  {},
  async () => ({
    contents: [
      {
        uri: TEMPLATE_URI,
        mimeType: RESOURCE_MIME_TYPE, // 공식 권장: text/html;profile=mcp-app
        text: `
<div id="root"></div>
<style>${CSS}</style>
<script type="module">${JS}</script>
        `.trim(),
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [
                "https://api.your-hvdc-domain.example"
              ],
              resourceDomains: [
                "https://*.oaistatic.com"
              ]
            }
          }
        }
      }
    ]
  })
);
```

### 체크포인트

| 항목                        | 정상값                                                      |
| ------------------------- | -------------------------------------------------------- |
| `registerAppResource` URI | `ui://hvdc/answer-card-v5.html`                          |
| `contents[0].uri`         | `ui://hvdc/answer-card-v5.html`                          |
| `mimeType`                | `text/html;profile=mcp-app` 또는 SDK의 `RESOURCE_MIME_TYPE` |
| HTML                      | JS/CSS bundle이 실제 포함됨                                    |
| CSP                       | 외부 API/CDN 사용 시 allowlist 포함                             |

---

## 3.3 Tool descriptor 패치

공식 문서는 tool descriptor에 `_meta.ui.resourceUri`를 사용하고, ChatGPT 호환 목적으로 `_meta["openai/outputTemplate"]`를 alias로 둘 수 있다고 설명합니다. ([developers.openai.com][3])

```ts
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const TEMPLATE_URI = "ui://hvdc/answer-card-v5.html";

registerAppTool(
  server,
  "ask_hvdc_ontology",
  {
    title: "Ask HVDC Ontology",
    description:
      "Use this when the user asks an HVDC logistics question that must be answered from the approved ontology corpus with evidence, validation, and next action.",
    inputSchema: {
      question: z.string(),
      userRole: z.string().default("ops_user"),
      language: z.string().default("ko")
    },
    outputSchema: {
      answerId: z.string(),
      verdict: z.string(),
      dataStatus: z.string(),
      businessResultVisible: z.boolean(),
      summary: z.string(),
      evidenceIds: z.array(z.string()),
      actions: z.array(z.any())
    },
    _meta: {
      ui: {
        resourceUri: TEMPLATE_URI,
        visibility: ["model", "app"]
      },

      // ChatGPT compatibility alias
      "openai/outputTemplate": TEMPLATE_URI,

      "openai/toolInvocation/invoking": "Querying HVDC ontology…",
      "openai/toolInvocation/invoked": "HVDC ontology answer ready"
    }
  },
  async ({ question, userRole, language }) => {
    const result = await askOntology({ question, userRole, language });

    return {
      structuredContent: {
        answerId: result.answerId,
        verdict: result.verdict,
        dataStatus: result.dataStatus,
        businessResultVisible: result.businessResultVisible,
        summary: result.summary,
        evidenceIds: result.evidenceIds,
        actions: result.actions
      },
      content: [
        {
          type: "text",
          text: result.summary
        }
      ],
      _meta: {
        evidence: result.evidence,
        validation: result.validation,
        route: result.route,
        ui: result.ui
      }
    };
  }
);
```

---

# 4. 카드 컴포넌트 쪽 패치

OpenAI 공식 reference는 widget이 `window.openai.toolOutput`에서 `structuredContent`를 읽고, `_meta`는 `window.openai.toolResponseMetadata`로 접근한다고 설명합니다. `structuredContent`는 모델도 읽는 값이고, `_meta`는 widget 전용입니다. ([developers.openai.com][2])

```tsx
import React from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    openai?: {
      toolOutput?: any;
      toolResponseMetadata?: any;
      toolInput?: any;
    };
  }
}

function AnswerCard() {
  const data = window.openai?.toolOutput;
  const meta = window.openai?.toolResponseMetadata;

  if (!data) {
    return (
      <div style={{ padding: 12, fontFamily: "system-ui" }}>
        <b>HVDC Ontology</b>
        <p>No tool output received.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, fontFamily: "system-ui" }}>
      <h3>HVDC Ontology Result</h3>

      <table>
        <tbody>
          <tr>
            <td>Verdict</td>
            <td>{data.verdict}</td>
          </tr>
          <tr>
            <td>Data Status</td>
            <td>{data.dataStatus}</td>
          </tr>
          <tr>
            <td>Visible</td>
            <td>{String(data.businessResultVisible)}</td>
          </tr>
        </tbody>
      </table>

      <p>{data.summary}</p>

      <details>
        <summary>Evidence</summary>
        <pre>{JSON.stringify(meta?.evidence ?? data.evidenceIds, null, 2)}</pre>
      </details>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<AnswerCard />);
```

---

# 5. `failed to fetch template` 원인별 패치 매트릭스

| No | 원인               | 증상                                   | 확인 방법                                 | 조치                                                       |
| -: | ---------------- | ------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
|  1 | Resource 미등록     | template fetch 실패                    | MCP Inspector에서 resource list 확인      | `registerAppResource(server, ..., TEMPLATE_URI, ...)` 추가 |
|  2 | URI 불일치          | tool은 v5 호출, resource는 v4 등록         | descriptor/resource URI 비교            | `TEMPLATE_URI` 상수화                                       |
|  3 | MIME type 오류     | structured content만 보이고 component 없음 | resource response MIME 확인             | `RESOURCE_MIME_TYPE` 사용                                  |
|  4 | JS/CSS bundle 누락 | template는 로드되나 blank/fail            | browser console 또는 MCP Inspector logs | HTML에 compiled JS/CSS inline 포함                          |
|  5 | CSP 차단           | 외부 API/CDN fetch 실패                  | console CSP violation                 | `_meta.ui.csp.connectDomains/resourceDomains` 추가         |
|  6 | Cache stale      | 배포했는데 구버전 계속 로드                      | 동일 URI 재사용 여부 확인                      | `answer-card-v6.html`처럼 URI version bump                 |
|  7 | Schema mismatch  | component는 뜨지만 데이터 비정상               | outputSchema 검증                       | `structuredContent`와 `outputSchema` 일치                   |
|  8 | Client 호환성       | 특정 환경에서만 실패                          | ChatGPT client/MCP Inspector 비교       | 공식 troubleshooting log 수집 후 escalate                     |

OpenAI troubleshooting 문서는 component가 안 뜨고 structured content만 보이는 경우 `_meta.ui.resourceUri`, 등록된 HTML resource, MIME type, CSP를 우선 확인하라고 제시합니다. Widget 자체가 로드 실패하면 browser console 또는 MCP Inspector logs에서 CSP violation과 missing bundle을 확인하라고도 합니다. ([developers.openai.com][1])

---

# 6. SCT_ONTOLOGY용 최소 수정 JSON 목표

현재 응답의 `ui` 블록은 아래처럼 나오고 있습니다.

```json
{
  "dataStatus": "OK",
  "uiRenderStatus": "READY",
  "businessResultVisible": true,
  "fallbackUsed": false,
  "cardEnabled": true,
  "templateUrl": "ui://hvdc/answer-card-v5.html",
  "templateVersion": "answer-card-v5",
  "schemaVersion": "1.0.0"
}
```

이 값 자체는 나쁘지 않습니다. 다만 OpenAI 공식 구조 기준으로는 **tool descriptor 레벨의 `_meta.ui.resourceUri`와 resource registry의 URI가 실제 존재해야** 합니다.

권장 target:

```json
{
  "toolDescriptor": {
    "_meta": {
      "ui": {
        "resourceUri": "ui://hvdc/answer-card-v5.html",
        "visibility": ["model", "app"]
      },
      "openai/outputTemplate": "ui://hvdc/answer-card-v5.html"
    }
  },
  "registeredResource": {
    "uri": "ui://hvdc/answer-card-v5.html",
    "mimeType": "text/html;profile=mcp-app"
  },
  "toolResult": {
    "structuredContent": {
      "answerId": "ans_edb91c596e14",
      "verdict": "PASS",
      "dataStatus": "OK",
      "businessResultVisible": true,
      "summary": "..."
    },
    "_meta": {
      "evidence": [],
      "validation": [],
      "route": {},
      "ui": {
        "templateVersion": "answer-card-v5",
        "schemaVersion": "1.0.0"
      }
    }
  }
}
```

---

# 7. 배포 패치 순서

## Step 1 — URI 고정

```ts
const TEMPLATE_URI = "ui://hvdc/answer-card-v5.html";
```

`templateUrl`, `_meta.ui.resourceUri`, `_meta["openai/outputTemplate"]`, `contents[].uri`를 모두 같은 상수로 연결하십시오.

## Step 2 — Resource 등록

`answer-card-v5.html` resource를 MCP server에 등록하십시오. MIME은 `RESOURCE_MIME_TYPE` 또는 `text/html;profile=mcp-app`로 둡니다.

## Step 3 — Tool descriptor 수정

`ask_hvdc_ontology` tool descriptor에 아래를 추가하십시오.

```ts
_meta: {
  ui: {
    resourceUri: TEMPLATE_URI,
    visibility: ["model", "app"]
  },
  "openai/outputTemplate": TEMPLATE_URI
}
```

## Step 4 — `outputSchema` 추가

`structuredContent`와 동일한 shape로 `outputSchema`를 정의하십시오. 최소 필드는 아래입니다.

```ts
outputSchema: {
  answerId: z.string(),
  verdict: z.string(),
  dataStatus: z.string(),
  businessResultVisible: z.boolean(),
  summary: z.string(),
  evidenceIds: z.array(z.string()),
  actions: z.array(z.any())
}
```

## Step 5 — Widget data access 수정

카드는 `window.openai.toolOutput`에서 `structuredContent`를 읽고, 상세 evidence/validation/route는 `window.openai.toolResponseMetadata`에서 읽도록 분리하십시오.

## Step 6 — CSP / bundle 검증

외부 API나 CDN을 호출하면 `_meta.ui.csp`에 allowlist가 필요합니다. JS/CSS는 HTML 안에 inline bundle로 포함하는 방식이 가장 안전합니다.

## Step 7 — Cache bust

OpenAI 공식 문서는 breaking change 시 template URI를 새로 주고, URI를 cache key처럼 취급하라고 설명합니다. 즉 v5를 이미 실패 상태로 배포했다면 `ui://hvdc/answer-card-v6.html`로 올리고 descriptor/resource/contents URI를 모두 같이 변경하십시오. ([developers.openai.com][3])

---

# 8. Smoke test 체크리스트

| No | 테스트                         | PASS 기준                                 |
| -: | --------------------------- | --------------------------------------- |
|  1 | MCP Inspector resource list | `ui://hvdc/answer-card-v5.html` 존재      |
|  2 | Resource fetch              | MIME `text/html;profile=mcp-app`        |
|  3 | Tool descriptor inspect     | `_meta.ui.resourceUri` 존재               |
|  4 | Compatibility alias         | `_meta["openai/outputTemplate"]` 동일 URI |
|  5 | Tool call                   | `structuredContent` 정상 반환               |
|  6 | Widget mount                | `window.openai.toolOutput` 값 표시         |
|  7 | Evidence drawer             | `_meta.evidence` 표시                     |
|  8 | Console                     | CSP violation / missing bundle 없음       |
|  9 | Cache                       | 새 URI 배포 후 구버전 미사용                      |
| 10 | Fallback                    | 카드 실패 시 텍스트/JSON 결과 표시                  |

---

# 9. 최종 권장 패치 결론

`failed to fetch template`의 1차 패치는 아래 3줄입니다.

```ts
const TEMPLATE_URI = "ui://hvdc/answer-card-v5.html";

registerAppResource(server, "hvdc-answer-card-v5", TEMPLATE_URI, {}, async () => ({
  contents: [{ uri: TEMPLATE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }]
}));

_meta: {
  ui: { resourceUri: TEMPLATE_URI, visibility: ["model", "app"] },
  "openai/outputTemplate": TEMPLATE_URI
}
```

`SCT_ONTOLOGY`의 ontology result는 그대로 살리고, 카드 UI만 위 구조로 재배선하십시오.
운영 안정화 기준으로는 **v5 재사용보다 `answer-card-v6.html`로 version bump 배포**를 권장합니다.

[1]: https://developers.openai.com/apps-sdk/deploy/troubleshooting "Troubleshooting – Apps SDK | OpenAI Developers"
[2]: https://developers.openai.com/apps-sdk/reference "Reference – Apps SDK | OpenAI Developers"
[3]: https://developers.openai.com/apps-sdk/build/mcp-server "Build your MCP server – Apps SDK | OpenAI Developers"
