# OpenAI Apps SDK 기준 UI Template Loader 패치안

판정: **조건부 OK — 기존 방향은 맞지만 OpenAI Apps SDK/MCP Apps 표준 기준으로 template 등록·MIME·CSP·tool result 계약을 보강해야 함**

근거: OpenAI Apps SDK는 MCP server가 tool, auth, data 반환, UI bundle 연결을 담당하고, widget은 ChatGPT iframe 내부에서 MCP Apps UI bridge(JSON-RPC over `postMessage`)로 통신한다고 설명한다. UI template은 tool descriptor의 `_meta.ui.resourceUri`가 등록된 HTML resource를 가리켜야 하며, MIME은 `text/html;profile=mcp-app`이어야 한다.

다음행동: **기존 “custom template registry” 패치를 OpenAI Apps SDK 호환 `resourceUri`/`registerResource`/`structuredContent`/`_meta`/CSP 계약으로 재정렬한다.**

---

## 0. OpenAI 공식 문서 기준 정합성 패치

기존 문서의 핵심 원칙인 `Template fetch 실패 ≠ Business result 실패`는 유지한다. 다만 OpenAI Apps SDK 기준에서는 아래 5개를 명시해야 한다.

| No | Patch Item | Required Contract | Risk if Missing | Evidence |
|---:|---|---|---|---|
| 1 | UI resource 등록 | tool descriptor에 `_meta.ui.resourceUri` 설정 | structured data만 보이고 component 미표시 | OpenAI Apps SDK Troubleshooting |
| 2 | MIME type | HTML resource는 `text/html;profile=mcp-app` | component load 실패 또는 structured-only | OpenAI Apps SDK Troubleshooting |
| 3 | Tool result 분리 | `structuredContent`/`content`는 transcript 노출, `_meta`는 component 전용 | 민감정보 노출 또는 model/UI 불일치 | OpenAI Apps SDK Reference |
| 4 | CSP metadata | `_meta.ui.csp.connectDomains/resourceDomains/frameDomains` | fetch/CORS/CSP 차단 | OpenAI Apps SDK Reference/Security |
| 5 | Bridge 통신 | iframe은 `ui/notifications/tool-result` 수신 후 `structuredContent`로 re-render | widget이 data update를 못 받음 | OpenAI ChatGPT UI Guide |

---

## 1. 핵심 원인 — OpenAI Apps SDK 기준 재정의

`failed to fetch template`는 API business JSON 실패가 아니라, **ChatGPT host가 tool descriptor에 연결된 UI resource를 로드하지 못했거나, resource 등록/MIME/CSP/bundle 조건을 충족하지 못한 상태**로 보아야 한다.

기존 예시:

```json
{
  "templateUrl": "ui://hvdc/answer-card-v5.html",
  "templateVersion": "answer-card-v5",
  "schemaVersion": "1.0.0",
  "dataStatus": "OK",
  "uiRenderStatus": "READY",
  "businessResultVisible": true
}
```

OpenAI Apps SDK 호환 예시:

```json
{
  "toolDescriptor": {
    "name": "render_hvdc_answer_card",
    "_meta": {
      "ui": {
        "resourceUri": "ui://hvdc/answer-card-v5.html"
      },
      "openai/outputTemplate": "ui://hvdc/answer-card-v5.html"
    }
  },
  "resource": {
    "uri": "ui://hvdc/answer-card-v5.html",
    "mimeType": "text/html;profile=mcp-app",
    "_meta": {
      "ui": {
        "csp": {
          "connectDomains": ["https://api.example.com"],
          "resourceDomains": ["https://cdn.example.com"],
          "frameDomains": []
        },
        "domain": "https://hvdc-ui.example.com"
      },
      "openai/widgetDescription": "HVDC answer card renderer"
    }
  },
  "toolResult": {
    "structuredContent": {
      "verdict": "WARN",
      "validationStatus": "WARN",
      "evidenceIds": [],
      "actions": []
    },
    "content": [
      {
        "type": "text",
        "text": "HVDC validation result is available."
      }
    ],
    "_meta": {
      "uiRenderHint": {
        "templateVersion": "answer-card-v5",
        "schemaVersion": "1.0.0"
      }
    }
  }
}
```

핵심 변경:

```text
기존: templateUrl → custom registry → fetch HTML
패치: _meta.ui.resourceUri → registered HTML resource → ChatGPT iframe → MCP Apps bridge → structuredContent render
```

---

## 2. 원인 분류표 — OpenAI Apps SDK 반영

| No | 원인 | 증상 | 패치 |
|---:|---|---|---|
| 1 | `_meta.ui.resourceUri` 누락 | structured content만 표시, component 없음 | render tool descriptor에 `_meta.ui.resourceUri` 추가 |
| 2 | HTML resource 미등록 | `ui://...` resolve 실패 | MCP server에서 해당 URI를 `registerResource`/resource registry에 등록 |
| 3 | MIME type 불일치 | component load 실패 | `mimeType: "text/html;profile=mcp-app"` 강제 |
| 4 | legacy key만 사용 | host 호환성 저하 | `_meta.ui.resourceUri`를 표준으로 두고 `_meta["openai/outputTemplate"]`은 compatibility alias로만 사용 |
| 5 | CSP 누락/오류 | widget fetch/XHR/asset load 차단 | `_meta.ui.csp.connectDomains/resourceDomains/frameDomains` 명시 |
| 6 | bundle 외부 의존성 누락 | widget blank/console error | HTML에 compiled JS inline 또는 모든 dependency bundle 포함 |
| 7 | outputSchema mismatch | schema mismatch error | `structuredContent`가 `outputSchema`와 일치하도록 TypeScript/Pydantic 모델 재생성 |
| 8 | `_meta`에 업무 필수값만 보관 | model narration/fallback 불가 | 업무 필수값은 `structuredContent`에 저장, 민감/대용량 hydration만 `_meta`에 저장 |
| 9 | widget state만 업데이트 | model이 UI 선택 상태를 모름 | 필요한 상태는 `ui/update-model-context` 또는 후속 tool result로 반영 |
| 10 | fallback 없음 | UI failure 시 업무 결과 미표시 | transcript-visible `structuredContent` 기반 JSON fallback 렌더링 |

---

## 3. 권장 시스템 패치 구조

### A. Business Result와 UI Render 상태 분리

OpenAI 기준에서는 **업무 결과는 `structuredContent`에 우선 보관**해야 한다. `_meta`는 component hydration용이며 model transcript에는 노출되지 않는다.

```json
{
  "structuredContent": {
    "verdict": "WARN",
    "validationStatus": "WARN",
    "evidenceIds": [],
    "actions": [
      {
        "actionType": "REQUEST_HUMAN_GATE_REVIEW",
        "ownerRole": "Responsible Approver",
        "humanGateRequired": true
      }
    ],
    "dataStatus": "OK"
  },
  "content": [
    {
      "type": "text",
      "text": "Business result is available. UI card may be rendered separately."
    }
  ],
  "_meta": {
    "ui": {
      "uiRenderStatus": "TEMPLATE_FETCH_FAILED",
      "fallbackUsed": true,
      "cardEnabled": false,
      "templateUri": "ui://hvdc/answer-card-v5.html",
      "templateVersion": "answer-card-v5",
      "schemaVersion": "1.0.0",
      "errorCode": "TEMPLATE_ASSET_404"
    }
  }
}
```

원칙:

```text
1. Business result는 structuredContent에 둔다.
2. Component 전용 hydration/debug 값만 _meta에 둔다.
3. Template fetch/render 실패는 business result 실패로 승격하지 않는다.
4. UI fallback은 structuredContent만으로 렌더 가능해야 한다.
```

---

### B. OpenAI 호환 Template Resource Registry

기존 custom manifest는 유지할 수 있으나, OpenAI 호환 layer에서는 아래 계약으로 변환해야 한다.

```json
{
  "resources": {
    "ui://hvdc/answer-card-v5.html": {
      "uri": "ui://hvdc/answer-card-v5.html",
      "mimeType": "text/html;profile=mcp-app",
      "templateVersion": "answer-card-v5",
      "supportedSchemaVersions": ["1.0.0"],
      "fallbackTemplate": "generic-answer-card-v1",
      "enabled": true,
      "_meta": {
        "ui": {
          "prefersBorder": true,
          "domain": "https://hvdc-ui.example.com",
          "csp": {
            "connectDomains": ["https://api.example.com"],
            "resourceDomains": ["https://cdn.example.com"],
            "frameDomains": []
          }
        },
        "openai/widgetDescription": "HVDC answer-card-v5"
      }
    }
  }
}
```

필수 검증:

| Check | Expected |
|---|---|
| render tool has `_meta.ui.resourceUri` | PASS |
| resource URI is registered | PASS |
| resource `mimeType` is `text/html;profile=mcp-app` | PASS |
| `structuredContent` matches `outputSchema` | PASS |
| `_meta.ui.csp` allows required domains only | PASS |
| fallback renderer works without widget | PASS |

---

### C. Client/Widget Fail-safe 로직

권장 TypeScript 형태:

```ts
type UiRenderStatus =
  | "READY"
  | "RESOURCE_NOT_REGISTERED"
  | "RESOURCE_MIME_INVALID"
  | "RESOURCE_CSP_BLOCKED"
  | "SCHEMA_MISMATCH"
  | "WIDGET_RENDER_ERROR"
  | "FALLBACK_RENDERED";

type HvdcStructuredContent = {
  verdict: "OK" | "WARN" | "FAIL";
  validationStatus: "OK" | "WARN" | "FAIL";
  evidenceIds: string[];
  actions: Array<{
    actionType: string;
    ownerRole: string;
    humanGateRequired: boolean;
  }>;
  dataStatus: "OK" | "WARN" | "ERROR";
};

function renderHvdcFallback(data: HvdcStructuredContent, ui: Record<string, unknown>) {
  return renderJsonFallback({
    ...data,
    uiRenderStatus: "FALLBACK_RENDERED",
    fallbackUsed: true,
    cardEnabled: false,
    ...ui
  });
}

window.addEventListener(
  "message",
  (event) => {
    if (event.source !== window.parent) return;

    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method !== "ui/notifications/tool-result") return;

    const toolResult = message.params;
    const data = toolResult?.structuredContent as HvdcStructuredContent | undefined;
    const ui = toolResult?._meta?.ui ?? {};

    if (!data) {
      return renderJsonFallback({
        dataStatus: "ERROR",
        uiRenderStatus: "SCHEMA_MISMATCH",
        fallbackUsed: true
      });
    }

    try {
      return renderAnswerCard(data, ui);
    } catch (err) {
      return renderHvdcFallback(data, {
        ...ui,
        uiRenderStatus: "WIDGET_RENDER_ERROR",
        errorMessage: String(err)
      });
    }
  },
  { passive: true }
);
```

중요: OpenAI Apps SDK 환경에서는 widget이 임의로 `ui://`를 직접 fetch하는 구조보다, **host가 등록된 resource를 iframe으로 로드하고 widget은 tool-result notification을 받아 `structuredContent`로 렌더링**하는 구조가 표준에 가깝다.

---

## 4. 상태값 표준화 패치

기존 상태값을 OpenAI Apps SDK 계층에 맞춰 재정의한다.

| 상태 | 의미 |
|---|---|
| `READY` | backend가 render metadata와 structuredContent를 제공 |
| `RESOURCE_REGISTERED` | `ui://...` resource가 MCP server에 등록됨 |
| `RESOURCE_LOADED` | ChatGPT host가 HTML resource를 iframe으로 로드 |
| `TOOL_RESULT_RECEIVED` | widget이 `ui/notifications/tool-result` 수신 |
| `RENDERED` | widget/card 렌더 성공 |
| `RESOURCE_NOT_REGISTERED` | `_meta.ui.resourceUri`가 미등록 resource를 가리킴 |
| `RESOURCE_MIME_INVALID` | `mimeType`이 `text/html;profile=mcp-app`가 아님 |
| `RESOURCE_CSP_BLOCKED` | `_meta.ui.csp` 또는 host CSP 차단 |
| `SCHEMA_MISMATCH` | `structuredContent`가 `outputSchema`와 불일치 |
| `WIDGET_RENDER_ERROR` | widget JS 실행 또는 render 오류 |
| `FALLBACK_RENDERED` | `structuredContent` 기반 JSON fallback 표시 완료 |

권장 최종 UI block:

```json
{
  "dataStatus": "OK",
  "uiRenderStatus": "FALLBACK_RENDERED",
  "businessResultVisible": true,
  "fallbackUsed": true,
  "cardEnabled": false,
  "templateUri": "ui://hvdc/answer-card-v5.html",
  "templateVersion": "answer-card-v5",
  "schemaVersion": "1.0.0",
  "errorCode": "RESOURCE_NOT_REGISTERED_OR_CSP_BLOCKED"
}
```

---

## 5. 배포 패치 순서

### P0 — 즉시 Hotfix

| Step | Action | 목적 |
|---:|---|---|
| 1 | business result를 `structuredContent`에 포함 | widget 실패 시에도 model/fallback이 업무 결과 표시 |
| 2 | JSON fallback renderer 추가 | 카드 실패 시 `verdict/actions` 노출 |
| 3 | `businessResultVisible=true` 강제 | UI 실패가 업무결과 숨김으로 전파되지 않도록 차단 |
| 4 | `widgetSessionId`, `resourceUri`, `uiRenderStatus` 로그 추가 | OpenAI widget instance 단위 추적 |

### P1 — Resource/Descriptor 패치

| Step | Action | 목적 |
|---:|---|---|
| 1 | render tool descriptor에 `_meta.ui.resourceUri` 추가 | ChatGPT host가 widget resource 식별 |
| 2 | compatibility alias `_meta["openai/outputTemplate"]` 유지 | 기존 ChatGPT 호환 경로 보존 |
| 3 | resource를 `mimeType: "text/html;profile=mcp-app"`로 등록 | Apps SDK template loading 계약 충족 |
| 4 | HTML에 compiled JS dependency bundle 포함 | missing bundle/widget blank 방지 |

### P2 — CSP/Security 패치

| Step | Action | 목적 |
|---:|---|---|
| 1 | `_meta.ui.csp.connectDomains` 최소화 | widget fetch/XHR 허용 도메인 제한 |
| 2 | `_meta.ui.csp.resourceDomains` 최소화 | asset/font/script/style 허용 도메인 제한 |
| 3 | secrets/token을 `_meta`/props에 넣지 않음 | component props 민감정보 노출 방지 |
| 4 | irreversible action은 human confirmation 필수 | OpenAI 보안 원칙 부합 |

### P3 — Contract Test

CI/CD에 아래 테스트를 추가한다.

```bash
# 1. MCP resource 등록 확인
node scripts/check-app-resource.mjs ui://hvdc/answer-card-v5.html

# 2. MIME type 확인
node scripts/check-resource-mime.mjs ui://hvdc/answer-card-v5.html text/html\;profile=mcp-app

# 3. outputSchema / structuredContent 계약 확인
pnpm test:contract -- hvdc-answer-card
```

추가 contract test fixture:

```json
{
  "tool": "render_hvdc_answer_card",
  "resourceUri": "ui://hvdc/answer-card-v5.html",
  "mimeType": "text/html;profile=mcp-app",
  "structuredContent": {
    "verdict": "WARN",
    "validationStatus": "WARN",
    "evidenceIds": [],
    "actions": [],
    "dataStatus": "OK"
  },
  "expected": {
    "resourceRegistered": true,
    "schemaValid": true,
    "cspValid": true,
    "fallbackAvailable": true
  }
}
```

### P4 — Observability

아래 필드를 telemetry로 남긴다.

| Field | Example |
|---|---|
| `answerId` | `ans_a976d0231caa` |
| `routeId` | `route_b563d1f033` |
| `widgetSessionId` | `_meta["openai/widgetSessionId"]` |
| `resourceUri` | `ui://hvdc/answer-card-v5.html` |
| `templateVersion` | `answer-card-v5` |
| `schemaVersion` | `1.0.0` |
| `mimeType` | `text/html;profile=mcp-app` |
| `uiRenderStatus` | `RESOURCE_CSP_BLOCKED` |
| `fallbackUsed` | `true` |
| `clientUserAgent` | `_meta["openai/userAgent"]` |
| `locale` | `_meta["openai/locale"]` |

---

## 6. Acceptance Criteria

| No | Test | Pass Criteria |
|---:|---|---|
| 1 | 정상 resource load | ChatGPT iframe에 카드 UI 정상 표시 |
| 2 | `_meta.ui.resourceUri` 누락 | structuredContent fallback 표시, `RESOURCE_NOT_REGISTERED` 기록 |
| 3 | MIME mismatch | fallback + `RESOURCE_MIME_INVALID` 기록 |
| 4 | schema mismatch | fallback + `SCHEMA_MISMATCH` 기록 |
| 5 | CSP block | fallback + `RESOURCE_CSP_BLOCKED` telemetry 기록 |
| 6 | widget JS render error | fallback + `WIDGET_RENDER_ERROR` 기록 |
| 7 | business JSON 정상 | `verdict`, `validationStatus`, `evidenceIds`, `actions` 항상 표시 |
| 8 | report/export | Human approval gate 전 publish 차단 |
| 9 | PII/security | secret/token/raw prompt가 component props/log에 남지 않음 |

---

## 7. 권장 패치 결론

가장 안전한 패치는 아래 5개다.

```text
1. Resource Contract: _meta.ui.resourceUri + registered HTML resource
2. MIME Contract: text/html;profile=mcp-app
3. Result Split: structuredContent/content vs _meta 분리
4. Loader Guard: widget/render 실패 시 structuredContent fallback
5. Security/CSP Gate: _meta.ui.csp + PII redaction + human confirmation
```

운영 적용 시 verdict는 이렇게 정리한다.

```json
{
  "structuredContent": {
    "verdict": "WARN",
    "validationStatus": "WARN",
    "dataStatus": "OK",
    "businessResultVisible": true,
    "actions": [
      {
        "actionType": "REQUEST_HUMAN_GATE_REVIEW",
        "ownerRole": "Responsible Approver",
        "humanGateRequired": true
      }
    ]
  },
  "_meta": {
    "ui": {
      "uiRenderStatus": "FALLBACK_RENDERED",
      "fallbackUsed": true,
      "resourceUri": "ui://hvdc/answer-card-v5.html",
      "templateVersion": "answer-card-v5",
      "schemaVersion": "1.0.0"
    }
  }
}
```

**최종 판단:** SCT_ONTOLOGY API 자체는 정상으로 판단 가능하나, OpenAI Apps SDK 호환성을 위해 시스템 패치는 API가 아니라 **MCP tool descriptor, registered UI resource, MIME type, widget CSP, structuredContent fallback, contract test** 쪽에 적용해야 한다.

---

## 8. Patch Diff 요약

```diff
- templateUrl: "ui://hvdc/answer-card-v5.html"
+ _meta.ui.resourceUri: "ui://hvdc/answer-card-v5.html"
+ _meta["openai/outputTemplate"]: "ui://hvdc/answer-card-v5.html"  # compatibility alias

- contentType: "text/html"
+ mimeType: "text/html;profile=mcp-app"

- business fields may live anywhere
+ business fields MUST live in structuredContent for fallback/model visibility

- widget directly fetches template asset
+ ChatGPT host loads registered resource; widget receives tool result via postMessage JSON-RPC

- CSP handled by app/global headers only
+ resource metadata MUST define _meta.ui.csp connect/resource/frame domains
```

---

## 9. 참고한 OpenAI 공식 문서

1. OpenAI Developers — Apps SDK: Build your MCP server
2. OpenAI Developers — Apps SDK: Build your ChatGPT UI
3. OpenAI Developers — Apps SDK: Reference
4. OpenAI Developers — Apps SDK: Troubleshooting
5. OpenAI Developers — Apps SDK: Security & Privacy
