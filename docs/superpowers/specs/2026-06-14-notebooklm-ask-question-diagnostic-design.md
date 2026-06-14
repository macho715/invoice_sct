# NotebookLM MCP ask_question Diagnostic Patch — Design

**Date:** 2026-06-14
**Status:** Draft v1 (pending user review)
**Scope:** Diagnostic instrumentation only — no production behavior change

## Problem

`ask_question` calls in the NotebookLM MCP (fork `notebooklm-mcp-pr53-pr55`) hang at the response-wait stage:

- `waitForStableAnswer()` (`src/notebooklm/chat.ts:227-304`) times out after `CONFIG.answerTimeoutMs`
- MCP internal log: `Timeout waiting for response from NotebookLM`
- Worker-side log: `httpx.ReadTimeout` after 181.0 s
- Confirmed working: question submission (Enter press + 1.0–1.5 s pause)
- **Unconfirmed:** whether NotebookLM UI ever produces an answer in the DOM

Existing selectors (verified 2026-05 in `selectors.ts:1-28`):

```ts
chat: {
  answerContainer: ".to-user-container",
  answerText:       ".to-user-container .message-text-content",
  latestAnswerText: ".to-user-container .message-text-content",
}
```

The streaming-stability gate (`stablePolls = 3`, default) and multilingual placeholder filter (`chat.ts:28-104`) only confirm the *current* primary selector. There is no fallback path that records what the page actually looked like, so we cannot tell whether:

1. The answer was generated but in a different DOM subtree
2. The answer was never generated (NotebookLM back-end stall)
3. The selector is correct but the text is genuinely unstable

## Goal

Add **opt-in diagnostic instrumentation** that, when `NOTEBOOKLM_DIAGNOSTIC=true`, captures per-`ask_question` evidence of:

- What the page looked like at 3 timestamps (0 s / 5 s / 15 s after Enter)
- Whether the primary selector matched, and with what text
- Whether 2 additional candidate selectors match (and with what text)
- A 1 Hz trace of selector text evolution for the first 15 s of the wait

No change to `waitForStableAnswer()` semantics, no change to selector precedence, no production behavior.

## Non-Goals

- Fixing the timeout itself (separate task, depends on diagnostics)
- Modifying the production selector registry
- Modifying placeholder/error heuristics
- Telemetry over the wire (writes are local-only)

## Design

### Entry Point

**File:** `src/session/browser-session.ts`
**Location:** between `await page.keyboard.press("Enter")` (line 416) and `await randomDelay(1000, 1500)` (line 419)

Insert a single guarded call:

```ts
await page.keyboard.press("Enter");

if (process.env.NOTEBOOKLM_DIAGNOSTIC === "true") {
  await runAskDiagnostics(page, this.sessionId, question);
}

await randomDelay(1000, 1500);
```

### Diagnostic Module

**New file:** `src/utils/diagnostics.ts`

Single export `runAskDiagnostics(page, sessionId, question)`. Implementation has three phases:

**Phase A — Initial snapshot (T+0)**

Captures the moment after Enter, before any wait/poll:

- Full-page PNG screenshot
- Outer HTML of the last 3 `.to-user-container` elements
- Inner text of the same
- For each of 3 candidate selectors, match count + concatenated text
- `chrome-error://*` URL check (browser-level error page detection)

**Phase B — 1 Hz trace (T+0 → T+15 s)**

Background loop polling every 1 s for 15 iterations:

- For each candidate selector: current text length, placeholder-match boolean, raw text preview (first 120 chars)
- Wait state of primary selector (loading / streaming / final)
- `.to-user-container` element count

Writes one JSON line per tick to `poll-trace.jsonl`.

**Phase C — Final snapshot (T+15 s)**

Identical structure to Phase A but at the 15 s mark. Lets us compare "right after submit" vs. "well after a normal answer should have arrived".

### Candidate Selectors

Primary (verified working in 2026-05 patches):

```
A. .to-user-container .message-text-content
```

Two additional fallbacks for diagnosis only (NOT promoted to production selectors):

```
B. conversation-turn:not([data-author="user"]) .message-content
C. [data-response-id], [data-author="assistant"] .message-text
```

Both chosen because they match common Angular / Material chat patterns but are unverified on the current NotebookLM build. If they match and the primary doesn't, that's diagnostic evidence the DOM has shifted. If none match, that's diagnostic evidence NotebookLM is not generating.

### Artifacts Layout

```
artifacts/notebooklm-debug/{ISO-timestamp}-{sessionId}/
├── screenshot-0.png
├── screenshot-1.png         # T+5s
├── screenshot-2.png         # T+15s
├── to-user-html-0.txt
├── to-user-html-1.txt
├── to-user-html-2.txt
├── to-user-text-0.txt
├── to-user-text-1.txt
├── to-user-text-2.txt
├── candidates.json          # 3-selector matrix @ each timestamp
└── poll-trace.jsonl         # 15 lines, one per second
```

**`candidates.json` shape:**

```json
{
  "session_id": "sess-...",
  "question_preview": "Return JSON only: ...",
  "snapshots": [
    {
      "t_seconds": 0,
      "selectors": {
        "A_to-user-container_message-text-content": {
          "match_count": 3,
          "texts": ["...", "..."]
        },
        "B_conversation-turn_message-content": {...},
        "C_data-attr_message-text": {...}
      },
      "page_url": "https://notebooklm.google.com/...",
      "chrome_error": false
    }
  ]
}
```

**`poll-trace.jsonl` shape (one line per tick):**

```json
{"t":0,"selector_A_len":42,"selector_A_placeholder":true,"selector_A_preview":"Thinking...","selector_B_len":0,"selector_C_len":0,"to_user_count":3}
```

### Environment Toggle

```bash
NOTEBOOKLM_DIAGNOSTIC=true   # off by default
```

Default OFF keeps the patch inert in production. When OFF, the `if` branch is skipped — zero overhead, zero behavior change.

When ON:
- Filesystem writes to `artifacts/notebooklm-debug/` (relative to MCP server CWD)
- ~16 screenshots (full-page) per `ask_question` call at default 1920×1080 → expect 1–3 MB per call
- 15-second extra wall time per call

### Logging

All diagnostic activity logs at `debug` level via `log.debug(...)` so production logs stay clean. Final summary at `info` level:

```
🔬 [DIAG] ask_question diagnostics enabled — artifacts at artifacts/notebooklm-debug/{ts}/
```

If the artifacts directory write fails (e.g. read-only filesystem), log a warning but do not fail the `ask_question` call. Diagnostics are best-effort.

## File Changes

| File | Change |
|---|---|
| `src/utils/diagnostics.ts` | **NEW** — 1 file, ~150 lines |
| `src/session/browser-session.ts` | **MODIFY** — insert 1 guarded call (3 lines added) |
| `src/utils/logger.ts` | **NO CHANGE** (uses existing `log` export) |

No selector registry changes. No `chat.ts` changes. No `selectors.ts` changes. No tests added (the diagnostic is itself an observability tool, not unit-testable).

## Risk Analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| Filesystem full | Low | Catch and warn, do not fail call |
| Screenshot timing breaks under load | Low | Use patchright's built-in `page.screenshot` (already used elsewhere) |
| Race with `waitForStableAnswer` | None | Diagnostic runs **before** the wait begins, in parallel writes only |
| Discloses notebook content in artifacts | **Medium** | Document clearly; artifacts live in MCP server CWD, not in user-visible paths. Recommend `.gitignore` addition if not already covered |

## Out-of-Scope Follow-ups (do not include in this design)

1. Fixing the actual hang — depends on diagnostic output
2. Production selector fallback chain (B/C → A) — only after evidence
3. Telemetry/aggregation across calls
4. UI surface for diagnostics

## Acceptance Criteria

- `NOTEBOOKLM_DIAGNOSTIC=false` (default): zero behavior change, zero overhead
- `NOTEBOOKLM_DIAGNOSTIC=true`: artifacts dir created with all 11 files
- Diagnostic call never throws into the parent `ask_question` flow
- Existing TypeScript build passes (`tsc --noEmit`)
- One short `ask_question` call with diagnostics ON produces readable evidence in <20 s
