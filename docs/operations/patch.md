판정: 가능하나, “별도 render tool 호출” 방식이 아니라 ask_hvdc_ontology 자체를 UI template에 연결해야 합니다.근거: OpenAI Apps SDK 공식 문서는 tool descriptor에 _meta.ui.resourceUri 또는 호환 alias _meta["openai/outputTemplate"]를 지정해 tool 결과를 UI template와 연결하라고 설명합니다. tool 결과의 structuredContent는 모델과 component 모두에 전달되고, _meta는 component 전용 hydration 데이터로 전달됩니다. ()다음행동: ask_hvdc_ontology tool에 카드 resource URI를 직접 연결하고, render_hvdc_answer_card를 별도 tool로 만들지 않는 구조로 바꾸는 것이 가장 안정적입니다.

핵심 결론

현재 문제는 ChatGPT가 카드 렌더링을 못 하는 것이 아니라, 렌더링 전용 tool인 render_hvdc_answer_card가 SCT_ONTOLOGY 앱 registry에 노출되지 않은 것입니다.

OpenAI 공식 방식상 “항상 카드 렌더링”을 원하면 다음 구조가 맞습니다.

User question
  ↓
ask_hvdc_ontology 호출
  ↓
structuredContent 반환
  ↓
tool descriptor의 _meta.ui.resourceUri / openai/outputTemplate에 연결된 카드 UI 자동 렌더

즉, ask_hvdc_ontology → render_hvdc_answer_card를 두 번 호출하게 만들기보다, ask_hvdc_ontology가 바로 카드 template을 produce하게 해야 합니다.

권장 구현 패턴

1. render_hvdc_answer_card를 별도 tool로 두지 말고 resource로 등록

render_hvdc_answer_card는 callable tool이 아니라 UI resource / component template 역할이어야 합니다.

server.registerResource(
  "hvdc-answer-card",
  "ui://widget/hvdc-answer-card.html",
  {},
  async () => ({
    contents: [
      {
        uri: "ui://widget/hvdc-answer-card.html",
        mimeType: "text/html+skybridge",
        text: hvdcAnswerCardHtml,
        _meta: {
          "openai/widgetDescription":
            "HVDC ontology answer card showing verdict, validation, evidence, route documents, and next action.",
          "openai/widgetPrefersBorder": true,
          "openai/widgetCSP": {
            connect_domains: [],
            resource_domains: []
          }
        }
      }
    ]
  })
);

공식 문서 기준으로 component resource에는 registerResource에서 _meta.ui.prefersBorder, _meta.ui.csp, _meta.ui.domain 또는 OpenAI 호환 key인 openai/widgetDescription, openai/widgetPrefersBorder, openai/widgetCSP 등을 설정합니다. ()

2. ask_hvdc_ontology tool descriptor에 UI template 연결

가장 중요한 부분입니다.

server.registerTool(
  "ask_hvdc_ontology",
  {
    title: "Ask HVDC Ontology",
    description:
      "Answer HVDC logistics questions from the approved ontology corpus with evidence, validation, and next action.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        userRole: { type: "string", default: "ops_user" },
        language: { type: "string", enum: ["ko", "en", "auto"], default: "auto" }
      },
      required: ["question"]
    },
    outputSchema: {
      type: "object",
      properties: {
        answerId: { type: "string" },
        verdict: { type: "string" },
        validationStatus: { type: "string" },
        validation: { type: "array" },
        route: { type: "object" },
        evidence: { type: "array" },
        actions: { type: "array" }
      },
      required: ["answerId", "verdict", "validationStatus"]
    },
    _meta: {
      ui: {
        resourceUri: "ui://widget/hvdc-answer-card.html"
      },
      "openai/outputTemplate": "ui://widget/hvdc-answer-card.html",
      "openai/toolInvocation/invoking": "Checking HVDC ontology…",
      "openai/toolInvocation/invoked": "HVDC answer ready"
    },
    annotations: {
      readOnlyHint: true
    }
  },
  async ({ question, userRole = "ops_user", language = "auto" }) => {
    const answer = await askHvdcOntology(question, userRole, language);

    return {
      structuredContent: answer,
      content: [
        {
          type: "text",
          text: `${answer.verdict}: ${answer.summary}`
        }
      ],
      _meta: {
        answerCardPayload: answer
      }
    };
  }
);

OpenAI 공식 문서는 tool이 structuredContent를 반환할 경우 outputSchema를 선언해야 하며, tool descriptor의 _meta.ui.resourceUri가 UI template 연결용 표준 key이고, _meta["openai/outputTemplate"]는 ChatGPT 호환 alias라고 설명합니다. ()

카드 내부 React/JS에서 읽어야 하는 데이터

카드 component는 별도 API 호출 없이 아래 값을 읽으면 됩니다.

const answer = window.openai?.toolOutput;
const privateMeta = window.openai?.toolResponseMetadata;

공식 문서상 window.openai.toolOutput은 tool의 structuredContent이고, window.openai.toolResponseMetadata는 tool result의 _meta payload입니다. structuredContent는 모델과 component가 모두 볼 수 있고, _meta는 component에만 전달됩니다. ()

“항상 카드 렌더링”을 위한 체크리스트

No

항목

권장값

실패 시 증상

1

ask_hvdc_ontology에 _meta.ui.resourceUri

ui://widget/hvdc-answer-card.html

tool은 호출되지만 카드 미표시

2

호환 alias

"openai/outputTemplate"도 병행

일부 ChatGPT client에서 template 연결 약함

3

registerResource URI

tool descriptor URI와 100% 동일

resource not found

4

MIME type

text/html+skybridge

bridge API 미작동 가능

5

outputSchema

structuredContent와 일치

validation/렌더링 불안정

6

반환 payload

structuredContent 필수

카드가 읽을 데이터 없음

7

_meta

민감/대용량 hydration 전용

모델 transcript에 노출 방지

8

asset hosting

HTML/JS/CSS 접근 가능

iframe blank / asset load fail

9

CSP

connectDomains, resourceDomains allowlist

script/image/API 차단

10

tool visibility

["model", "app"] 또는 기본값

모델 또는 widget에서 tool 접근 불가

GitHub 공식 예제에서 확인되는 운영 포인트

OpenAI의 openai-apps-sdk-examples 저장소는 widget을 structured payload와 _meta.ui.resourceUri metadata 조합으로 inline 렌더링한다고 설명합니다. 또한 build 후 HTML/JS/CSS bundle을 assets/에 생성하고 MCP server가 이를 reusable UI resource로 serve한다고 안내합니다. ()

로컬/운영 배포에서는 static asset server가 반드시 살아 있어야 합니다. 예제 저장소는 build 후 pnpm run serve로 static assets를 serve하고, Python server는 widget HTML cache 때문에 asset 수정 후 MCP server 재시작이 필요하다고 설명합니다. ()

SCT_ONTOLOGY에 적용할 최종 구조

현재:

ask_hvdc_ontology
route_question
search_ontology_corpus
resolve_any_key
validate_answer

권장:

ask_hvdc_ontology  ← 카드 UI template 직접 연결
route_question
search_ontology_corpus
resolve_any_key
validate_answer

불필요하거나 선택사항:

render_hvdc_answer_card  ← 별도 callable tool로 만들 필요 낮음

단, 반드시 render_hvdc_answer_card라는 이름을 유지해야 한다면, tool이 아니라 resource id/title로 쓰는 것이 맞습니다.

resource name: render_hvdc_answer_card
resource uri : ui://widget/hvdc-answer-card.html
tool meta    : _meta.ui.resourceUri = ui://widget/hvdc-answer-card.html

Fail-safe 규칙

AMBIGUOUS_ANY_KEY 또는 HUMAN_GATE_REQUIRED가 있어도 카드는 렌더링되어야 합니다.다만 카드의 verdict/action만 바뀌어야 합니다.

const hasHold =
  answer.validation?.some(v =>
    ["AMBIGUOUS_ANY_KEY", "HUMAN_GATE_REQUIRED"].includes(v.reasonCode)
  );

const displayVerdict = hasHold ? "HOLD" : answer.verdict;
const nextAction = hasHold
  ? "자동 선택 금지. Data Steward / CostGuard 수동 검토 필요."
  : answer.actions?.[0]?.actionType ?? "REVIEW_EVIDENCE_DRAWER";

즉, 렌더링 조건과 업무 승인 조건을 분리해야 합니다.

렌더링 조건: ask_hvdc_ontology tool call 성공 + structuredContent 존재
업무 승인 조건: validation.reasonCode 확인

최종 권장안

ask_hvdc_ontology 하나만 호출해도 항상 카드가 렌더링되도록 outputTemplate/resourceUri를 tool descriptor에 박아 넣으십시오.render_hvdc_answer_card를 별도 tool로 노출시키는 방식은 모델이 두 번째 tool을 반드시 호출해야 하므로 안정성이 떨어집니다. OpenAI 공식 패턴은 tool result + registered UI resource + structuredContent hydration입니다.

판정: **조건부 승인 → 최종 패치 필요.**
근거: 업로드 초안의 핵심 방향인 `ask_hvdc_ontology` 직접 UI template 연결은 맞습니다. 다만 현재 공식 문서는 `_meta.ui.resourceUri` 선호, `"openai/outputTemplate"` 호환 alias, `structuredContent`↔`outputSchema` 일치, `_meta` component-only 전달을 명시합니다.  ([OpenAI Developers][1])
다음행동: `render_hvdc_answer_card`는 **tool 삭제/미등록**, `registerAppResource + registerAppTool + RESOURCE_MIME_TYPE` 구조로 교체하십시오.

## 최종 패치

```ts
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const HVDC_ANSWER_CARD_URI = "ui://widget/hvdc-answer-card-v1.html";

const validationItemSchema = z.object({
  severity: z.string().optional(),
  reasonCode: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

const hvdcAnswerOutputSchema = {
  answerId: z.string(),
  verdict: z.string(),
  summary: z.string().optional(),
  validationStatus: z.string(),
  validation: z.array(validationItemSchema).default([]),
  route: z.record(z.unknown()).optional(),
  evidence: z.array(z.record(z.unknown())).default([]),
  actions: z.array(z.record(z.unknown())).default([]),
};

type HvdcAnswer = z.infer<z.ZodObject<typeof hvdcAnswerOutputSchema>>;

function normalizeHvdcAnswer(answer: Partial<HvdcAnswer>): HvdcAnswer {
  return {
    answerId: answer.answerId ?? crypto.randomUUID(),
    verdict: answer.verdict ?? "AMBER",
    summary: answer.summary ?? "",
    validationStatus: answer.validationStatus ?? "UNVALIDATED",
    validation: answer.validation ?? [],
    route: answer.route,
    evidence: answer.evidence ?? [],
    actions: answer.actions ?? [],
  };
}

export function registerHvdcOntologyApp({
  server,
  hvdcAnswerCardHtml,
  askHvdcOntology,
  connectDomains = [],
  resourceDomains = [],
}: {
  server: any;
  hvdcAnswerCardHtml: string;
  askHvdcOntology: (
    question: string,
    userRole: string,
    language: "ko" | "en" | "auto"
  ) => Promise<Partial<HvdcAnswer>>;
  connectDomains?: string[];
  resourceDomains?: string[];
}) {
  registerAppResource(
    server,
    "hvdc-answer-card",
    HVDC_ANSWER_CARD_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: HVDC_ANSWER_CARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: hvdcAnswerCardHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains,
                resourceDomains,
              },
            },

            // ChatGPT compatibility aliases
            "openai/widgetDescription":
              "HVDC ontology answer card showing verdict, validation, evidence, route documents, and next action.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": {
              connect_domains: connectDomains,
              resource_domains: resourceDomains,
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "ask_hvdc_ontology",
    {
      title: "Ask HVDC Ontology",
      description:
        "Answer HVDC logistics questions from the approved ontology corpus with evidence, validation, and next action.",
      inputSchema: {
        question: z.string().min(1),
        userRole: z.string().optional(),
        language: z.enum(["ko", "en", "auto"]).optional(),
      },
      outputSchema: hvdcAnswerOutputSchema,
      _meta: {
        ui: {
          resourceUri: HVDC_ANSWER_CARD_URI,
          visibility: ["model", "app"],
        },

        // ChatGPT compatibility alias
        "openai/outputTemplate": HVDC_ANSWER_CARD_URI,
        "openai/toolInvocation/invoking": "Checking HVDC ontology…",
        "openai/toolInvocation/invoked": "HVDC answer ready",
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({
      question,
      userRole = "ops_user",
      language = "auto",
    }: {
      question: string;
      userRole?: string;
      language?: "ko" | "en" | "auto";
    }) => {
      const answer = normalizeHvdcAnswer(
        await askHvdcOntology(question, userRole, language)
      );

      const hasHold = answer.validation.some((v) =>
        ["AMBIGUOUS_ANY_KEY", "HUMAN_GATE_REQUIRED"].includes(
          String(v.reasonCode ?? "")
        )
      );

      const displayVerdict = hasHold ? "HOLD" : answer.verdict;

      return {
        structuredContent: {
          ...answer,
          verdict: displayVerdict,
        },
        content: [
          {
            type: "text",
            text: `${displayVerdict}: ${answer.summary ?? "HVDC ontology result ready."}`,
          },
        ],
        _meta: {
          // component-only hydration; 모델 transcript에는 노출되지 않음
          answerCardPayload: answer,
          generatedAt: new Date().toISOString(),
        },
      };
    }
  );
}
```

## 카드 측 수신 패치

```ts
type HvdcToolResult = {
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
};

function readInitialAnswer() {
  return window.openai?.toolOutput ?? null;
}

function onToolResult(callback: (answer: unknown, meta?: unknown) => void) {
  const initial = readInitialAnswer();
  if (initial) callback(initial, window.openai?.toolResponseMetadata);

  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window.parent) return;

      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      if (message.method !== "ui/notifications/tool-result") return;

      const result = message.params as HvdcToolResult;
      callback(result.structuredContent, result._meta);
    },
    { passive: true }
  );
}
```

## 삭제/금지 항목

```ts
// 금지: 별도 callable render tool로 노출하지 말 것
server.registerTool("render_hvdc_answer_card", ...);
```

`render_hvdc_answer_card`라는 이름을 유지해야 한다면 **tool name이 아니라 resource id/title**로만 쓰십시오.

## 공식 문서 기준 변경점

| No | 항목               | 최종값                                                | 이유                                   |
| -: | ---------------- | -------------------------------------------------- | ------------------------------------ |
|  1 | Tool→UI 연결       | `_meta.ui.resourceUri` + `"openai/outputTemplate"` | 표준 key + ChatGPT 호환 alias            |
|  2 | Resource 등록      | `registerAppResource`                              | UI metadata normalization 지원         |
|  3 | MIME             | `RESOURCE_MIME_TYPE`                               | 공식 MIME: `text/html;profile=mcp-app` |
|  4 | Data 전달          | `structuredContent`                                | 모델+component 공용                      |
|  5 | 대용량/민감 hydration | `_meta`                                            | component-only, 모델 비노출               |
|  6 | 카드 수신            | MCP bridge 우선, `window.openai` 호환                  | 신규 표준 + ChatGPT compatibility        |

공식 예제도 tool이 structured payload와 `_meta.ui.resourceUri` metadata를 결합해 widget을 inline 렌더링하는 패턴을 사용하며, bundle asset serve/cache-bust 운영 포인트를 제시합니다. ([GitHub][2])

## 2× GitHub Cross-Check

| Repo                              | 확인 결과                                                                                 | 반영                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `openai/openai-apps-sdk-examples` | structured payload + `_meta.ui.resourceUri`로 widget 렌더링, `assets/` bundle serve 구조 확인 | `ask_hvdc_ontology`에 template 직접 연결                   |
| `modelcontextprotocol/ext-apps`   | `registerAppResource`, `registerAppTool`, `RESOURCE_MIME_TYPE` helper 사용 확인           | base `registerResource/registerTool` 대신 app helper 적용 |

최종 결론: **초안의 아키텍처 판단은 유지하되, 구현 표면은 최신 MCP Apps/OpenAI Apps SDK 방식으로 패치해야 합니다.**

[1]: https://developers.openai.com/apps-sdk/reference "Reference – Apps SDK | OpenAI Developers"
[2]: https://github.com/openai/openai-apps-sdk-examples "GitHub - openai/openai-apps-sdk-examples: Example apps for the Apps SDK · GitHub"
