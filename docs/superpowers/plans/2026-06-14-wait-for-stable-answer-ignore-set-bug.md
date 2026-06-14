# waitForStableAnswer ignoreSet BUGFIX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `waitForStableAnswer` so it returns the new answer regardless of textual duplication with prior answers.

**Architecture:** Remove text-based `ignoreSet` filter from `waitForStableAnswer`. The DOM position (`.last()`) is the correct identity for "the new answer" — no text comparison needed. Keep the `AskOptions.ignoreTexts` parameter for backward compatibility (silently accepted, no longer used for filtering).

**Tech Stack:** TypeScript, patchright (already used), Node `tsc` for build. No new dependencies.

**Working Directory:** `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/notebooklm/chat.ts` | **MODIFY** (~10 lines net) | Remove `ignoreSet` setup, remove `isPrior` check, update JSDoc |
| (no test infra) | — | Live smoke test via `apps/worker-py` (already in scope) |

The project has no test infrastructure (no `tests/` dir, no vitest, no test script in `package.json`). Adding unit tests would require vitest + Page mocking — out of scope per user's "chat.ts만" constraint. Live smoke test serves as the regression check.

---

## Task 1: Apply the chat.ts fix

**Files:**
- Modify: `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\src\notebooklm\chat.ts`

- [ ] **Step 1.1: Remove `ignoreSet` setup**

Find this line (line 241):
```ts
  const ignoreSet = new Set(ignoreTexts.map((t) => t.trim()).filter(Boolean));
```

Delete it. The line below it (the comment about `maxPolls`) should remain.

- [ ] **Step 1.2: Remove `isPrior` check**

Find this block (lines 268-271):
```ts
    if (candidate) {
      const isEcho = candidate.toLowerCase() === echoLower;
      const isPrior = ignoreSet.has(candidate);

      if (!isEcho && !isPrior) {
```

Replace with:
```ts
    if (candidate) {
      const isEcho = candidate.toLowerCase() === echoLower;

      if (!isEcho) {
```

- [ ] **Step 1.3: Update JSDoc on `AskOptions.ignoreTexts`**

Find this (line 201):
```ts
    /** Texts known *before* the question was submitted. Used to skip prior answers. */
    ignoreTexts?: string[];
```

Replace with:
```ts
    /**
     * @deprecated Filtering by prior-text no longer used. The new answer is
     * always the LAST `.to-user-container` element; position is the identity.
     * Kept for caller API compatibility. `snapshotPriorAnswers` still returns
     * the texts for logging/inspection.
     */
    ignoreTexts?: string[];
```

- [ ] **Step 1.4: Update function docstring (line ~220-225)**

Find this block:
```ts
/**
 * Wait for the *latest* answer text to appear and stabilise.
 *
 * Returns the sanitised final text, or `null` on timeout. The function never
 * throws on UI hiccups — failure surfaces as `null` so the caller can decide
 * how to recover (retry vs. report error to the user).
 */
```

Replace with:
```ts
/**
 * Wait for the *latest* answer text to appear and stabilise.
 *
 * Returns the sanitised final text, or `null` on timeout. The function never
 * throws on UI hiccups — failure surfaces as `null` so the caller can decide
 * how to recover (retry vs. report error to the user).
 *
 * The new answer is identified by DOM position (the last `.to-user-container`
 * element), not by text matching — so a new answer that textually duplicates
 * a prior response is still correctly detected.
 */
```

- [ ] **Step 1.5: Verify the diff**

Run:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
grep -n "ignoreSet\|isPrior" src/notebooklm/chat.ts
```

Expected: **0 matches** (both removed). If matches remain, the edit wasn't applied — re-do steps 1.1 and 1.2.

- [ ] **Step 1.6: Type-check**

Run:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
npx tsc --noEmit
```

Expected: 0 errors. If errors are reported, fix them inline (most likely an unused-variable error in callers — `existingResponses` is still used by `browser-session.ts` so no change there).

- [ ] **Step 1.7: Commit**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
git add src/notebooklm/chat.ts
git -c user.name=opencode -c user.email=opencode@local commit -m "fix(mcp): drop text-based ignoreSet in waitForStableAnswer

The new answer is the LAST .to-user-container DOM element by construction.
Filtering by prior text incorrectly skipped new answers that happened to
match prior response text (e.g. repeated test prompts, deterministic
short answers). Repro: 6 prior {\"ok\": true} + new {\"ok\": true} →
filter classified new as prior → 2m10s timeout.

Fix: drop the ignoreSet filter. Position is the correct identity.
ignoreTexts parameter kept for API compat but no longer consulted.

Evidence: artifacts/notebooklm-debug/2026-06-14T18-43-21-* poll-trace
shows new answer stable at t=8..14, MCP log shows it was filtered out
and timeout at 2m10s."
```

---

## Task 2: Rebuild MCP server

**Files:**
- No source changes; build artifact refresh

- [ ] **Step 2.1: Rebuild**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
npm run build
```

Expected: 0 errors. `dist/notebooklm/chat.js` updated with new mtime.

- [ ] **Step 2.2: Stop the running MCP server**

```bash
netstat -ano | findstr :3003
```

If anything is listening on :3003, find the PID and kill:

```bash
Stop-Process -Id <pid> -Force
```

Confirm port is free:
```bash
netstat -ano | findstr :3003 2>$null || echo "port 3003 free"
```

Expected: "port 3003 free".

- [ ] **Step 2.3: Start MCP in HTTP mode with diagnostic on**

```bash
$env:NOTEBOOKLM_TRANSPORT = "http"
$env:NOTEBOOKLM_PORT = "3003"
$env:NOTEBOOKLM_DIAGNOSTIC = "true"
Set-Location "C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55"
Start-Process -FilePath "node" -ArgumentList "dist/index.js" -RedirectStandardOutput "notebooklm-mcp-3003.out.log" -RedirectStandardError "notebooklm-mcp-3003.err.log" -NoNewWindow -PassThru
Start-Sleep -Seconds 3
netstat -ano | findstr :3003
```

Expected: 127.0.0.1:3003 LISTENING with a new PID. Note the new PID.

Verify health:
```bash
curl -s -o - -w "\nHTTP %{http_code}\n" http://127.0.0.1:3003/healthz
```

Expected: 2xx with health payload.

---

## Task 3: Live smoke test (regression check)

**Files:**
- No source changes; verification only

**Goal:** Same scenario as the original failure — 6 prior `{"ok": true"}` responses already in the notebook + a new question with the same expected answer. The fix should make this return successfully within ~30s instead of timing out at 2m+.

- [ ] **Step 3.1: Confirm notebook has 6 prior responses**

The notebook `2b70c1f5-6e08-47bb-801b-a3618004c3b5` is named `Invoice Audit Smoke Notebook` and was added earlier this session with id `invoice-audit-smoke-notebook`. It already has 6 prior `{"ok": true}` responses from previous test runs (confirmed by the previous MCP log: `Captured 6 existing responses`).

- [ ] **Step 3.2: Run the ask_question call**

Write/run a script (or reuse the existing test script):

```bash
Set-Location "C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py"
$env:NOTEBOOKLM_MCP_URL = "http://127.0.0.1:3003/mcp"
$env:NOTEBOOKLM_MCP_TIMEOUT_MS = "120"
$env:NOTEBOOKLM_ASK_SHOW_BROWSER = "true"
$env:PYTHONPATH = "C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py"
& "C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py\.venv\Scripts\python.exe" "C:\Users\jichu\AppData\Local\Temp\opencode\option_a.py"
```

The `option_a.py` script does: list_notebooks → find target → ask_question.

Expected: 
- `add_notebook` may fail with "already in library" (that's fine — list_notebooks will still find it)
- `ask_question` returns the answer (or prints the answer text from `data.answer`) **within ~30-60s**, NOT a TaskGroup error

- [ ] **Step 3.3: Verify MCP server log shows success**

```bash
Get-Content "C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\notebooklm-mcp-3003.err.log" -Tail 30
```

Expected: a `✅ [TOOL] ask_question completed successfully` line within the last 30 lines. **NOT** a `Timeout waiting for response from NotebookLM` line.

- [ ] **Step 3.4: Verify new diagnostic artifacts**

```bash
Get-ChildItem "C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\artifacts\notebooklm-debug" -ErrorAction SilentlyContinue | Select-Object -First 3
```

Expected: a new timestamped directory with the 11 expected files (candidates.json, poll-trace.jsonl, 3 screenshots, 6 text/html files).

- [ ] **Step 3.5: Commit evidence (optional)**

The artifacts themselves are gitignored (handled by the diagnostic patch's `.gitignore` addition, if committed). If you want a permanent record in the SCT repo, append a short "Run 2 result" note to the spec:

```bash
# In the SCT repo, not the MCP repo
git -C "C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main" status
# If the spec has been changed/updated, commit it
```

Skip this step if you don't want to amend the spec.

---

## Self-Review

**1. Spec coverage:**
- ✅ Remove `ignoreSet` setup → Task 1 Step 1.1
- ✅ Remove `isPrior` check → Task 1 Step 1.2
- ✅ Update JSDoc → Task 1 Step 1.3
- ✅ Update function docstring → Task 1 Step 1.4
- ✅ Type-check → Task 1 Step 1.6
- ✅ Live smoke regression → Task 3
- ⚠️ Original spec asked for a unit test → replaced with live smoke (test infra doesn't exist; user chose "chat.ts만" scope)

**2. Placeholder scan:** No TBD/TODO. Every step has exact code or commands.

**3. Type consistency:**
- `ignoreTexts?: string[]` interface unchanged (kept for API compat)
- `ignoreSet` variable removed → no remaining references (grep verified)
- `existingResponses` still passed by `browser-session.ts` → no caller change needed

**4. Risk check:** The fix is strictly more permissive. The `isEcho` check (which filters the question itself echoed back) is preserved. The `isPlaceholder` check is preserved. Only the `isPrior` text-match is removed — which was the bug.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-wait-for-stable-answer-ignore-set-bug.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
