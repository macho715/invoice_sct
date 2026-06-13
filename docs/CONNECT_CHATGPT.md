# Connect to ChatGPT

## Production connector

Use this Cloudflare MCP endpoint:

```text
https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp
```

Read-only question and validation tools work through the normal connector path.
Protected upload/write tools require `Authorization: Bearer` with `files:upload` or `files:write` scope plus Human-gate approval.
If that token is missing, the protected tool returns `AUTH_REQUIRED` instead of writing anything.

## ChatGPT settings

1. Settings -> Apps & Connectors -> Advanced settings -> Developer mode ON.
2. Settings -> Apps & Connectors -> Create.
3. Connector URL: `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`.
4. Add the connector to a new chat from the `+` -> More menu.

## Optional local debugging only

```bash
npm install
npm run dev
```

Use local Wrangler only when testing an undeployed local Worker build.
Do not register a local or tunnel URL as the production connector.

If the action list or template list looks stale, use **Refresh** in the connector management screen or disconnect/reconnect the app, then start a new chat.

## Test prompt

```text
AGI M130 닫아도 돼? BL-535 관련
```

Expected: Answer Card shows `BLOCK`, evidence, validation, ontology path, and Human-gate action.

## Decoupled card rendering check

Run this prompt in a new chat:

```text
Daily KPI Dashboard 원장에서 Owner / Risk / Next Action 컬럼만 현장 확인 후 확정값으로 잠금 처리한다. 원본 근거는 26-30 Apr 2026 daily report PDF이며 Date / Site / Activity / Shipment No는 원장 기준으로 유지한다. Owner, Risk, Next Action은 draft에서 locked confirmed 상태로 전환한다.
```

Expected:

- `ask_hvdc_ontology` runs first and returns a data-only answer.
- `ask_hvdc_ontology` result has no `openai/outputTemplate` and no `ui` object.
- `render_hvdc_answer_card` runs next and uses `ui://hvdc/answer-card-v7.html`.
- `ui://hvdc/answer-card-v6.html` remains available as a compatibility alias for stale ChatGPT sessions.
- The card displays without `Failed to fetch template`.
- The summary starts with `Daily logistics KPI`.
- The Daily KPI answer does not use invoice/cost evidence-pack wording.
- Long values such as `REQUEST_HUMAN_GATE_REVIEW` and protected-field lists wrap inside the card.
