# NotebookLM Integration Report v1

Date: 2026-06-14
Repo: `C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main`
Branch: `main`
Latest observed commit: `da14d2e docs: define notelm worker vercel split`

## Verdict

PARTIAL

NotebookLM `add_source` failure is fixed with the patched local NotebookLM MCP server.
`ask_question` is still intermittent and can timeout at the configured 180 second limit.
The full live path through JSON extraction and Vercel callback is not yet proven stable.

## What Is Done

- The worker supports a dedicated NotebookLM MCP timeout through `NOTEBOOKLM_MCP_TIMEOUT_MS`.
- The worker keeps backward compatibility with `NOTEBOOKLM_ASK_TIMEOUT_MS` as a fallback.
- The current Windows user environment sets both timeout variables to `180`.
- The worker can pass `show_browser=true` to `add_source` and `ask_question`.
- The current Windows user environment enables:
  - `NOTEBOOKLM_ADD_SOURCE_SHOW_BROWSER=true`
  - `NOTEBOOKLM_ASK_SHOW_BROWSER=true`
- The worker now extracts `data.answer` from the NotebookLM MCP success envelope.
- The worker raises a tool error when NotebookLM MCP returns `success:false`.
- Focused worker tests for NotebookLM client, orchestrator, and route pass.

## Patched NotebookLM MCP Status

Local patched checkout:

`C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55`

Applied upstream patches:

- PR #53: fixes hidden dialog selector mismatch in `add_source`.
- PR #55: supports the current Add sources picker UI.

Runtime endpoint:

`http://127.0.0.1:3003/mcp`

Observed process:

- Process: `node`
- PID: `4048`
- Started: 2026-06-14 18:20 local session time

## Live Behavior Observed

### add_source

Status: PASS

Observed result from patched NotebookLM MCP:

```json
{
  "success": true,
  "type": "text",
  "sourceCountBefore": 55,
  "sourceCountAfter": 56
}
```

Meaning:

The original `add_source` blocker caused by the hidden emoji dialog / source picker selector issue is resolved in the patched local MCP server.

### ask_question

Status: PARTIAL

Observed success case:

- Timeout config: `180`
- Prompt: short JSON-only style prompt
- `show_browser=true`
- Elapsed time: about 29.5 seconds
- MCP response contained `data.answer`
- Answer body included JSON-like content:

```json
{ "ok": true }
```

Observed failure case:

- Timeout config: `180`
- Same short standalone `ask_question` style test
- Result: `httpx.ReadTimeout`
- Elapsed time: about 180.6 seconds

Meaning:

`ask_question` can succeed, but it is not reliable yet.
The current main blocker is NotebookLM answer generation / browser automation hanging inside the MCP server path.

## Root Cause Source Found

Primary source file:

`C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\src\notebooklm\selectors.ts`

Relevant selector before local patch:

```ts
latestAnswerText: ".to-user-container:last-child .message-text-content"
```

Why this is risky:

`waitForStableAnswer()` reads the latest answer through `Selectors.chat.latestAnswerText`.
The code already calls `.last()` on the locator.
The extra `:last-child` condition makes the selector fail whenever the latest NotebookLM answer container is not literally the last DOM child.
In that state, the answer can exist on screen while `readLatestAnswer()` keeps returning `null`, causing `Timeout waiting for response from NotebookLM`.

Call chain:

```text
src/tools/handlers.ts
-> handleAskQuestion()
-> session.ask()
-> src/session/browser-session.ts
-> waitForStableAnswer()
-> src/notebooklm/chat.ts
-> readLatestAnswer()
-> Selectors.chat.latestAnswerText
```

Local patch applied in external NotebookLM MCP checkout:

```ts
latestAnswerText: ".to-user-container .message-text-content"
```

This keeps the existing `.last()` behavior in `readLatestAnswer()` and removes the fragile DOM-parent assumption.

Patched files:

- `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\src\notebooklm\selectors.ts`
- `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\dist\notebooklm\selectors.js`
- `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\dist\notebooklm\selectors.d.ts`

Validation after patch:

```powershell
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
npx tsc --noEmit
```

Result:

```text
pass
```

Live retest after MCP restart:

```text
MCP endpoint: http://127.0.0.1:3003/mcp
MCP process: PID 26112
Prompt: Return JSON only: {"ok": true}
Worker timeout: NOTEBOOKLM_MCP_TIMEOUT_MS=180
show_browser: true
Result: FAIL
Elapsed: 181.0 seconds
Worker exception: httpx.ReadTimeout
MCP log result: Timeout waiting for response from NotebookLM
```

MCP log checkpoints:

```text
16:05:36 ask_question called
16:05:36 Resolved notebook: Invoice Audit Smoke Notebook
16:05:36 Show browser: true
16:05:43 Captured 3 existing responses
16:05:49 Submitting question
16:05:51 Waiting for response (streaming-stability)
16:08:51 Failed to ask question: Timeout waiting for response from NotebookLM
```

Retest conclusion:

The selector patch is type-safe but did not resolve the live `ask_question` timeout.
The next failure point is after submit, inside response detection or NotebookLM UI response generation.
The worker and MCP server both reached the same 180 second ceiling.

## Current Code Changes Not Yet Committed

Modified files:

- `apps/worker-py/app/notebooklm/mcp_client.py`
- `apps/worker-py/tests/test_notebooklm_mcp_client.py`

Untracked files intentionally not included in this report scope:

- `dsv shpt pdf.md`
- `iran-war-notelm/`

## Validation

Focused worker test command:

```powershell
cd C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py
python -m pytest tests/test_notebooklm_mcp_client.py tests/test_notebooklm_orchestrator.py tests/test_notebooklm_route.py -q
```

Result:

```text
29 passed
```

The test pass confirms the worker-side timeout parsing, show-browser argument handling, response-envelope parsing, and route/orchestrator behavior.
It does not prove the live NotebookLM browser automation is stable.

## API And Runtime Boundary

NotebookLM is not the source of truth.

The intended pipeline remains:

```text
PDF upload
-> MarkItDown MCP converts PDF to Markdown
-> NotebookLM MCP add_source(type=text)
-> NotebookLM ask_question extracts verification fields
-> Worker parses and validates JSON
-> Worker posts signed callback to Vercel
-> Vercel adapts to parser-compatible shape
-> Audit engine compares parser result and NotebookLM result
```

Current proven boundary:

```text
Worker -> patched NotebookLM MCP -> add_source
```

Current unstable boundary:

```text
Worker -> patched NotebookLM MCP -> ask_question
```

Not yet fully proven:

```text
ask_question JSON result -> Vercel callback -> audit engine
```

## Risks

- NotebookLM MCP relies on browser UI automation, so page state changes or stale UI can still cause timeouts.
- A 180 second timeout prevents very long hangs, but it does not fix the underlying NotebookLM UI wait condition.
- The local patched MCP server is outside the main repo and must be pinned operationally.
- The live smoke currently depends on an authenticated browser profile and the existing NotebookLM notebook session.

## Next Action

Restart the patched NotebookLM MCP server and run one visible-browser `ask_question` test only.
If it times out again, run NotebookLM MCP cleanup while preserving the library, then re-authenticate and retry the same short prompt.
