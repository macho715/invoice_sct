# Decoupled Template Render Plan

## Overview

This plan changes the ChatGPT App rendering strategy to the OpenAI Apps SDK decoupled pattern.

Historical problem:

- `ask_hvdc_ontology` creates the HVDC answer data.
- `ask_hvdc_ontology` has been tried as a direct-template tool.
- ChatGPT still shows intermittent `Failed to fetch template` in some client sessions.

Implemented state:

- `ask_hvdc_ontology` creates the answer data only.
- `ask_hvdc_ontology` does not return `structuredContent.ui`.
- `render_hvdc_answer_card` is the only tool that links the UI template.
- The card resource remains registered as the reusable HTML component.
- `ui://hvdc/answer-card-v5.html` and `ui://hvdc/render_hvdc_answer_card.html` serve the same widget HTML as compatibility aliases.
- The widget wraps long action names, protected fields, route reasons, and validation text inside the card.

Assumption: The stable runtime behavior we want is official Apps SDK separation: data first, render second.

## Goals

- Keep `ask_hvdc_ontology` as the primary answer data tool.
- Attach `_meta.ui.resourceUri` and `_meta["openai/outputTemplate"]` only to `render_hvdc_answer_card`.
- Keep `structuredContent` aligned with `outputSchema`.
- Keep the answer card hydrated from render-tool `structuredContent` and tool result metadata.
- Keep `render_hvdc_answer_card` in the exposed callable tool list.
- Keep submission metadata, tests, and docs aligned with the runtime tool surface.

## Scope

### In Scope

- Update `server/src/index.ts` tool descriptors.
- Keep `registerAppResource` for `ui://hvdc/answer-card-v6.html`.
- Remove answer-card resource metadata from `ask_hvdc_ontology`.
- Remove render-only `ui` payload from `ask_hvdc_ontology` structured output.
- Keep answer-card resource metadata on `render_hvdc_answer_card`.
- Keep `chatgpt-app-submission.json` aligned with 6 exposed tools.
- Update descriptor and widget tests.
- Update root docs that still describe the previous direct-render experiment.
- Run local and production MCP smoke checks after deployment.

### Out of Scope

- Changing ontology corpus semantics.
- Changing reasonCode definitions.
- Changing Cloudflare project settings.
- Adding new external integrations.
- Changing UI visual design beyond the render path fix.
- Removing existing untracked UIUX draft files.

## Constraints

- Do not delete files.
- Do not commit untracked local draft files unless explicitly requested.
- Do not expose secrets or production credentials.
- Keep `RESOURCE_MIME_TYPE` for the registered HTML resource.
- Keep CSP narrow: no external fetches from the widget.
- Keep `HUMAN_GATE_REQUIRED` and `AMBIGUOUS_ANY_KEY` as renderable states, not render blockers.
- Keep `ask_hvdc_ontology` `readOnlyHint: false` if the private audit hash log remains part of its behavior.

## Phases

### Phase 1: Runtime Contract Patch

Move UI template metadata from `ask_hvdc_ontology` back to `render_hvdc_answer_card` only.

Expected result:

- `ask_hvdc_ontology._meta.ui` is absent.
- `ask_hvdc_ontology._meta["openai/outputTemplate"]` is absent.
- `render_hvdc_answer_card._meta.ui.resourceUri = ui://hvdc/answer-card-v6.html`.
- `render_hvdc_answer_card._meta["openai/outputTemplate"] = ui://hvdc/answer-card-v6.html`.

### Phase 2: Widget Simplification

Keep the iframe focused on host-delivered render output and compatibility fallbacks.

Expected result:

- Widget reads the render-tool output.
- Widget handles `ui/notifications/tool-result`.
- Widget keeps `openai:set_globals` compatibility.
- Widget does not fetch external resources.
- Widget wraps long text and prevents column overflow.

### Phase 3: Submission And Docs Alignment

Keep the app submission and docs on the 6-tool data/render surface.

Expected result:

- Historical note: this 2026-05-10 plan expected `chatgpt-app-submission.json` to list 6 tools. The current active runtime lists 11 tools after protected upload/write was added.
- README, AGENTS, SYSTEM_ARCHITECTURE, and SPEC describe the 6-tool decoupled surface consistently.
- Docs explain that `render_hvdc_answer_card` renders the answer card after `ask_hvdc_ontology`.

### Phase 4: Verification And Deploy

Run automated tests, local MCP smoke, GitHub Actions, Cloudflare Workers deployment, and production MCP smoke.

Expected result:

- `npm run verify` passes.
- Local MCP shows `ask_hvdc_ontology` has no UI template.
- Local MCP shows `render_hvdc_answer_card` has the UI template.
- Production MCP shows the same contract after Cloudflare deploy.

## Tasks

| No | Task | Output |
|---:|---|---|
| 1 | Patch `server/src/index.ts` descriptor and registration | Decoupled data/render template link |
| 2 | Patch `public/hvdc-answer-widget.html` | Host-delivered render output, no external fetch, overflow-safe card |
| 3 | Patch descriptor/widget tests | Tests enforce the active tool list and render-only template link |
| 4 | Check `chatgpt-app-submission.json` | Submission matches runtime tools |
| 5 | Patch docs | User-facing docs match implementation |
| 6 | Run local checks | `npm run verify`, JSON validation, MCP smoke |
| 7 | Commit and push | One focused commit |
| 8 | Deploy to Cloudflare Workers | Production app updated |
| 9 | Run production smoke | Contract verified at live MCP endpoint |

## Risks

- ChatGPT may cache a previous app session; users may need a new conversation or app reconnect.
- If `outputSchema` and returned `structuredContent` drift, component rendering may still fail.
- If `ask_hvdc_ontology` keeps private audit logging, its `readOnlyHint` should remain `false` even though the user-visible behavior is read-like.
- If the widget relies only on `window.openai.toolOutput`, older hosts may need the existing message listener fallback.

## Review Criteria

- `render_hvdc_answer_card` is listed by `tools/list`.
- `ask_hvdc_ontology` has no `_meta.ui.resourceUri`.
- `ask_hvdc_ontology` has no `_meta["openai/outputTemplate"]`.
- `ask_hvdc_ontology` result has no `structuredContent.ui`.
- `render_hvdc_answer_card` has `_meta.ui.resourceUri`.
- `render_hvdc_answer_card` has `_meta["openai/outputTemplate"]`.
- `search_ontology_corpus` has no UI resource.
- The registered resource URI exactly matches the tool descriptor URI.
- The resource MIME type is `text/html;profile=mcp-app`.
- `npm run verify` passes.
- Production MCP returns `verdict`, `validationStatus`, `reasonCode`, and evidence for the sample ambiguity prompt.
- ChatGPT UI loads the Daily KPI answer card without `Failed to fetch template`.
- Long card text wraps inside the card columns.

## Deliverables

- Runtime patch for decoupled answer-card rendering.
- Runtime patch for compatibility resource aliases.
- Runtime patch for overflow-safe card CSS.
- Updated submission JSON.
- Updated tests.
- Updated docs.
- GitHub commit and push.
- Cloudflare Workers production deployment.
- Production smoke evidence.
