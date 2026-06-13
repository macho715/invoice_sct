# Decoupled Template Render Spec

## Summary

The HVDC ChatGPT App follows the OpenAI Apps SDK decoupled pattern.

`ask_hvdc_ontology` is the data tool. It returns grounded answer JSON and text fallback without `_meta.ui.resourceUri`, `_meta["openai/outputTemplate"]`, or `structuredContent.ui`.

`render_hvdc_answer_card` is the render tool. It accepts the complete `GroundedAnswer` and attaches `_meta.ui.resourceUri` plus `_meta["openai/outputTemplate"]` for `ui://hvdc/answer-card-v6.html`.

Primary objective:

- A user asks an HVDC ontology question.
- ChatGPT calls `ask_hvdc_ontology`.
- ChatGPT may then call `render_hvdc_answer_card` with the answer object when a visual card is useful.
- The card resource renders the same business result while text fallback remains available.
- Compatibility aliases `ui://hvdc/answer-card-v5.html` and `ui://hvdc/render_hvdc_answer_card.html` return the same HTML as v6 for stale client/session fetches.
- The card CSS wraps long actions, protected-field lists, route reasons, and validation text inside the available iframe width.

## User Scenarios & Testing

### US-001: Main HVDC Answer Returns Data Only

Given a user asks an HVDC logistics question that needs ontology evidence  
When ChatGPT calls `ask_hvdc_ontology`  
Then the tool result must include grounded `structuredContent` and no answer-card template metadata.

Independent test:

- Run `tools/list` against the MCP server.
- Confirm `ask_hvdc_ontology._meta.ui` is absent.
- Confirm `ask_hvdc_ontology._meta["openai/outputTemplate"]` is absent.
- Confirm `ask_hvdc_ontology` result has no `structuredContent.ui`.

### US-002: Render Tool Owns The Answer Card Template

Given a complete `GroundedAnswer` from `ask_hvdc_ontology`  
When ChatGPT calls `render_hvdc_answer_card`  
Then the render tool result must attach the answer-card template metadata.

Independent test:

- Confirm `render_hvdc_answer_card._meta.ui.resourceUri` equals `ui://hvdc/answer-card-v6.html`.
- Confirm `render_hvdc_answer_card._meta["openai/outputTemplate"]` equals `ui://hvdc/answer-card-v6.html`.
- Confirm the render result `_meta.ui.resourceUri` also equals `ui://hvdc/answer-card-v6.html`.

### US-003: Ambiguous Any-key Result Still Renders

Given a user asks whether `BL-535` and `INVOICE-535` are the same  
When `ask_hvdc_ontology` returns `AMBIGUOUS_ANY_KEY` or `HUMAN_GATE_REQUIRED`  
Then `render_hvdc_answer_card` must still render the validation result and block automatic selection.

Independent test:

- Call `ask_hvdc_ontology` with the ambiguity prompt.
- Call `render_hvdc_answer_card` with the returned structured answer.
- Confirm `verdict`, `validationStatus`, evidence, and next-action fields remain unchanged.

### US-004: Search Tool Does Not Attach UI

Given ChatGPT only needs evidence snippets  
When it calls `search_ontology_corpus`  
Then the tool must return evidence data only and must not attach the answer-card component.

Independent test:

- Run `tools/list`.
- Confirm `search_ontology_corpus._meta.ui` is absent.
- Confirm `search_ontology_corpus._meta["openai/outputTemplate"]` is absent.

### US-005: Widget Reads Render Tool Output

Given ChatGPT renders the answer-card iframe  
When the iframe starts  
Then it must read the answer from render-tool output or host-provided tool-result notifications.

Independent test:

- Inspect `public/hvdc-answer-widget.html`.
- Confirm it handles `ui/notifications/tool-result` and `openai:set_globals`.
- Confirm it does not fetch external resources.

### US-006: Daily KPI Card Text Does Not Overflow

Given a Daily KPI Dashboard lock answer with long action ids and protected-field lists
When ChatGPT renders the answer card
Then the values must wrap inside their panels instead of clipping or overflowing.

Independent test:

- Inspect `public/hvdc-answer-widget.html`.
- Confirm responsive grid, `overflow-wrap:anywhere`, `word-break:break-word`, and mobile one-column metadata CSS exist.
- Confirm the production MCP v6 resource returns those CSS rules.

## Requirements

### Functional Requirements

- FR-001: `ask_hvdc_ontology` MUST NOT attach `_meta.ui.resourceUri`.
- FR-002: `ask_hvdc_ontology` MUST NOT attach `_meta["openai/outputTemplate"]`.
- FR-003: `ask_hvdc_ontology` MUST return `structuredContent` that conforms to its declared `outputSchema` and MUST NOT include `ui`.
- FR-004: `ask_hvdc_ontology` MUST keep `_meta["openai/toolInvocation/invoking"]` and `_meta["openai/toolInvocation/invoked"]` user-facing status strings.
- FR-005: `render_hvdc_answer_card` MUST be registered as a callable MCP tool.
- FR-006: `render_hvdc_answer_card` MUST set `_meta.ui.resourceUri` to `ui://hvdc/answer-card-v6.html`.
- FR-007: `render_hvdc_answer_card` MUST set `_meta["openai/outputTemplate"]` to `ui://hvdc/answer-card-v6.html`.
- FR-008: `search_ontology_corpus` MUST NOT attach `_meta.ui.resourceUri` or `_meta["openai/outputTemplate"]`.
- FR-009: The answer-card resource MUST use `RESOURCE_MIME_TYPE`.
- FR-010: The widget MUST render `WARN`, `BLOCK`, `NO_EVIDENCE`, `HUMAN_GATE_REQUIRED`, and `AMBIGUOUS_ANY_KEY` states instead of treating them as render failures.
- FR-011: `chatgpt-app-submission.json` MUST list the same exposed tool names as the server descriptor.
- FR-012: Documentation that describes tool count or render flow MUST match the 6-tool decoupled design.
- FR-013: The widget MUST wrap long action ids, protected-field lists, route reasons, and validation text.
- FR-014: The server SHOULD keep v5 and render-tool-name resource aliases while stale ChatGPT sessions exist.

### Non-Functional Requirements

- NFR-001: The widget MUST NOT fetch external resources.
- NFR-002: Widget CSP metadata MUST remain narrow with empty connect/resource domains unless a real asset dependency is added.
- NFR-003: The change MUST preserve existing answer grounding, evidence, validation, PII masking, and audit behavior.
- NFR-004: The implementation MUST not delete files except replacing stale planning/spec content when explicitly updating those docs.
- NFR-005: The implementation MUST not commit untracked local draft files unless explicitly requested.
- NFR-006: The production deployment MUST be verified through the live Cloudflare Workers MCP URL.

## Assumptions & Dependencies

- Assumption: OpenAI Apps SDK decoupled behavior is the target behavior because direct-template `ask_hvdc_ontology` still produced intermittent ChatGPT `Failed to fetch template` errors.
- Assumption: `ui://hvdc/answer-card-v6.html` remains the canonical resource URI.
- Assumption: `ui://hvdc/answer-card-v5.html` remains a legacy fetch alias, and `ui://hvdc/render_hvdc_answer_card.html` remains a render-name compatibility alias.
- Assumption: Existing `ask_hvdc_ontology` private audit hash logging remains in scope, so `readOnlyHint` may remain `false`.
- Dependency: `@modelcontextprotocol/ext-apps` provides `registerAppResource`, `registerAppTool`, and `RESOURCE_MIME_TYPE`.
- Dependency: Cloudflare Workers production MCP URL remains `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp`.
- Dependency: `npm run verify` remains the repository verification gate.

## Success Criteria

- SC-001: `npm run verify` passes.
- SC-002: `python -m json.tool chatgpt-app-submission.json` passes.
- SC-003: Local MCP `tools/list` returns the active implemented tool list and keeps render-template ownership unchanged.
- SC-004: Local MCP confirms `ask_hvdc_ontology` has no `_meta.ui.resourceUri`.
- SC-005: Local MCP confirms `ask_hvdc_ontology` has no `_meta["openai/outputTemplate"]`.
- SC-005a: Local MCP confirms `ask_hvdc_ontology` result has no `structuredContent.ui`.
- SC-006: Local MCP confirms `render_hvdc_answer_card` has `_meta.ui.resourceUri`.
- SC-007: Local MCP confirms `render_hvdc_answer_card` has `_meta["openai/outputTemplate"]`.
- SC-008: Local MCP confirms `search_ontology_corpus` has no UI resource.
- SC-009: Production MCP confirms the same decoupled contract after Cloudflare deploy.
- SC-010: Production `ask_hvdc_ontology` daily KPI prompt returns operations KPI routing, not CostGuard summary.
- SC-011: Production MCP v6 widget resource contains overflow-safe CSS.
- SC-012: ChatGPT UI confirms the Daily KPI card loads without `Failed to fetch template`.
- SC-013: ChatGPT UI confirms the Daily KPI card text is not clipped in the action/status panels.

## Open Questions

- Whether every target prompt will automatically choose `render_hvdc_answer_card` after `ask_hvdc_ontology` remains an operational monitoring item. The Daily KPI Dashboard lock prompt has been verified in ChatGPT UI.

## Clarifications Log

| Date | Clarification |
|---|---|
| 2026-05-10 | Direct-template rendering was tried with `ask_hvdc_ontology`. |
| 2026-05-10 | Because ChatGPT still showed `Failed to fetch template`, the runtime contract returns to the official decoupled pattern. |
| 2026-05-11 | `ask_hvdc_ontology` result no longer includes `ui`; `render_hvdc_answer_card` adds render-only UI state. |
| 2026-05-11 | The widget CSS was hardened for long action ids, protected fields, route reasons, and validation text. |

## Reviewer Checklist

- [x] Tool list remains 6 exposed tools.
- [x] `ask_hvdc_ontology` is data-only.
- [x] `ask_hvdc_ontology` result has no `ui`.
- [x] `render_hvdc_answer_card` owns the answer-card resource.
- [x] Submission JSON matches server tool descriptors.
- [x] Widget fallback still handles host delivery paths.
- [x] Production smoke evidence is recorded after deployment.
- [x] ChatGPT UI screenshot confirms no template fetch error for the Daily KPI card.
- [ ] ChatGPT UI screenshot confirms no clipped long text after the latest overflow CSS deploy.
