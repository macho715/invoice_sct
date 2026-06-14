# waitForStableAnswer ignoreSet Bug — Design

**Date:** 2026-06-14
**Status:** Draft v1 (pending user review)
**Scope:** BUGFIX — single file change in `src/notebooklm/chat.ts`

## Problem

`waitForStableAnswer` in `src/notebooklm/chat.ts:227-304` filters candidates via `ignoreSet.has(candidate)` (line 269). When a new answer's text happens to match a prior answer's text (e.g., repeated test prompts, deterministic short answers), the new answer is incorrectly classified as "prior" and skipped. The streaming-stability loop then waits for a non-existent new stable text, eventually timing out.

**Repro evidence (2026-06-14 live test):**
- Notebook: `2b70c1f5-6e08-47bb-801b-a3618004c3b5` (Invoice Audit Smoke Notebook)
- Prior responses: 6 × `{"ok": true}` (accumulated from previous test runs)
- New question: `Return JSON only: {"ok": true}`
- Expected new answer: `{"ok": true}` (matches prior!)
- Observed: MCP log shows `Waiting for response (streaming-stability)...` at 18:43:38, then `Timeout waiting for response` at 18:45:48 (2m 10s)
- Diagnostic poll-trace (T+8 to T+14): stable `{"ok": true"}` — but MCP filtered it as prior and never returned it

## Goal

Make `waitForStableAnswer` correctly detect the new answer's stability regardless of textual duplication with prior answers.

## Non-Goals

- Refactoring `snapshotPriorAnswers` (stays as-is — still useful for caller logging)
- Changing the public `AskOptions` interface (keep `ignoreTexts: string[]` for backward compat)
- Touching `selectors.ts`, `browser-session.ts`, or any test fixture
- Performance optimization

## Approach: Position-based, drop text-match filter

The `Selectors.chat.latestAnswerText` locator (`.to-user-container .message-text-content`) + `.last()` already returns the **newest** element. Each new question adds exactly one new `.to-user-container` element. So `.last()` is the correct identity for "the new answer" — no text matching needed.

**Why text-based filtering was wrong:**
- The original `ignoreSet` was added (issue #43) to filter out the question echo and any prior answers that hadn't been removed from the DOM yet.
- But a *new* answer that happens to match a prior's text is still a NEW DOM element. Position already disambiguates.
- Text matching is the wrong axis: position is.

## Design

### File: `src/notebooklm/chat.ts`

**Change 1 — Remove `ignoreSet` setup (line ~241):**
```diff
-  const ignoreSet = new Set(ignoreTexts.map((t) => t.trim()).filter(Boolean));
   // Hard ceiling on poll iterations defends against pathological
   // pollIntervalMs values combined with zombie-page sleep returns (issue #16).
   const maxPolls = Math.max(8, Math.ceil(timeoutMs / Math.max(50, pollIntervalMs)) + 4);
```

**Change 2 — Remove `isPrior` check (line ~269):**
```diff
     if (candidate) {
       const isEcho = candidate.toLowerCase() === echoLower;
-      const isPrior = ignoreSet.has(candidate);

-      if (!isEcho && !isPrior) {
+      if (!isEcho) {
         // Loading placeholders ("Parsing the data…", "Thinking…", …) are
         // stable while Gemini is still working — the old code locked on to
         // them and returned them as the final answer. Filter them out.
         if (isPlaceholder(candidate)) {
           stableStreak = 0;
           lastSeen = null;
           await safeSleep(page, Math.min(pollIntervalMs, 400));
           continue;
         }
         ...
       }
     }
```

**Change 3 — Update JSDoc on `AskOptions.ignoreTexts` (~line 202):**
```diff
-    /** Texts known *before* the question was submitted. Used to skip prior answers. */
-    ignoreTexts?: string[];
+    /**
+     * DEPRECATED semantics: pass prior response count to log/inspect; the
+     * streaming-stability loop no longer filters by text. Position is the
+     * identity for the new answer. Kept for caller API compatibility.
+     */
+    ignoreTexts?: string[];
```

**Change 4 — Update function docstring (line ~221):**
- Replace mention of `ignoreTexts` as a filter with: "Ignores the echoed question text; all other candidates are evaluated for stability."

### File: `tests/chat.waitForStableAnswer.test.ts` (NEW — TDD)

Single test that mocks the page locator and asserts:
- Setup: 6 prior `.to-user-container .message-text-content` elements all with text `{"ok": true}`
- Plus 1 new element with same text `{"ok": true}` (appended after submit)
- Expected: `waitForStableAnswer` returns the new answer's text within stability window, not `null`

```ts
// Pseudocode
test("returns new answer even when text matches prior")
```

## Risk Analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| Legitimate "echo" detection regresses | None | `isEcho` check on question text is independent and preserved |
| Loading placeholder lock | None | `isPlaceholder` check unchanged |
| Caller behavior change | None | `ignoreTexts` parameter accepted but ignored (silently) |
| Tests break (any test relying on `ignoreTexts` semantics) | Low | Grep test suite for `ignoreTexts`; update if found |

## Acceptance Criteria

- `npx tsc --noEmit` → 0 errors
- New test passes: 6 prior + 1 new (same text) → returns new text, not `null`
- Existing tests still pass (the change is strictly more permissive)
- Live smoke test: ask_question returns the `{"ok": true"}` answer within ~30s (instead of timing out at 2m+)
- 1 commit, 1 file changed + 1 test file added
