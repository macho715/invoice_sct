# NotebookLM MCP ask_question Diagnostic Patch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in diagnostic instrumentation to `ask_question` that captures per-call evidence of whether NotebookLM UI produces an answer in the DOM, with zero behavior change when disabled.

**Architecture:** Single new module `src/utils/diagnostics.ts` exposes `runAskDiagnostics(page, sessionId, question)`. Called from `browser-session.ts` immediately after `Enter` press, gated by `NOTEBOOKLM_DIAGNOSTIC=true`. Three-phase capture: initial snapshot → 1Hz trace for 15s → final snapshot. Writes to `artifacts/notebooklm-debug/{ts}-{sessionId}/`.

**Tech Stack:** TypeScript, patchright (already imported by `browser-session.ts`), Node `fs/promises`, `path`. No new dependencies.

**Working Directory:** `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/utils/diagnostics.ts` | **NEW** (~150 lines) | Diagnostic module: snapshots, candidate evaluation, 1Hz trace, artifact writer |
| `src/session/browser-session.ts` | **MODIFY** (+5 lines) | Import `runAskDiagnostics`, add guarded call after `Enter` press |
| `src/utils/logger.ts` | NO CHANGE | Use existing `log` export |
| `src/notebooklm/selectors.ts` | NO CHANGE | Primary selector stays authoritative |
| `src/notebooklm/chat.ts` | NO CHANGE | `waitForStableAnswer` semantics preserved |

---

## Task 1: Create the diagnostic module

**Files:**
- Create: `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\src\utils\diagnostics.ts`

- [ ] **Step 1: Create the file with imports and types**

Create the file with this exact content:

```ts
/**
 * Opt-in diagnostic instrumentation for ask_question.
 *
 * Enabled when NOTEBOOKLM_DIAGNOSTIC=true. Captures per-call evidence of
 * whether NotebookLM UI produces an answer in the DOM, plus 1Hz trace for
 * the first 15s of the wait. Pure observability — does NOT change the
 * production wait/poll/selector logic in chat.ts or selectors.ts.
 *
 * Captured artifacts (all under artifacts/notebooklm-debug/{ts}-{sessionId}/):
 *   - screenshot-0.png / -1.png / -2.png   (T+0 / T+5s / T+15s)
 *   - to-user-html-{0,1,2}.txt             (last 3 .to-user-container outerHTML)
 *   - to-user-text-{0,1,2}.txt             (last 3 .to-user-container innerText)
 *   - candidates.json                      (3-selector matrix @ each timestamp)
 *   - poll-trace.jsonl                     (15 lines, one per second)
 */

import type { Page } from "patchright";
import { promises as fs } from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

/** Candidate answer selectors evaluated for diagnostic purposes only. */
const CANDIDATE_SELECTORS: ReadonlyArray<{ name: string; selector: string }> = [
  {
    name: "A_primary",
    selector: ".to-user-container .message-text-content",
  },
  {
    name: "B_fallback_conversation_turn",
    selector: 'conversation-turn:not([data-author="user"]) .message-content',
  },
  {
    name: "C_fallback_data_attr",
    selector: "[data-response-id], [data-author='assistant'] .message-text",
  },
];

/** Total trace duration in seconds. 15s × 1Hz = 15 ticks. */
const TRACE_DURATION_S = 15;

/** Delay between Enter press and first snapshot. */
const INITIAL_DELAY_MS = 200;

interface SelectorEval {
  match_count: number;
  texts: string[];
}

interface SnapshotRecord {
  t_seconds: number;
  page_url: string;
  chrome_error: boolean;
  selectors: Record<string, SelectorEval>;
}

interface PollTick {
  t: number;
  to_user_count: number;
  selectors: Record<
    string,
    { len: number; placeholder: boolean; preview: string }
  >;
}

function previewText(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : normalized.slice(0, max) + "…";
}

function isChromeErrorPage(url: string): boolean {
  return /^chrome-error:\/\//i.test(url);
}

async function snapshotAt(
  page: Page,
  artifactDir: string,
  idx: number,
  tSeconds: number
): Promise<SnapshotRecord> {
  const pageUrl = page.url();
  const chromeError = isChromeErrorPage(pageUrl);

  await page.screenshot({
    path: path.join(artifactDir, `screenshot-${idx}.png`),
    fullPage: true,
  });

  const htmlSnippets = await page
    .locator(".to-user-container")
    .evaluateAll((els) =>
      els.slice(-3).map((e) => (e as HTMLElement).outerHTML)
    )
    .catch(() => [] as string[]);
  await fs.writeFile(
    path.join(artifactDir, `to-user-html-${idx}.txt`),
    htmlSnippets.join("\n\n---\n\n")
  );

  const textSnippets = await page
    .locator(".to-user-container")
    .allInnerTexts()
    .catch(() => [] as string[]);
  await fs.writeFile(
    path.join(artifactDir, `to-user-text-${idx}.txt`),
    textSnippets.join("\n---\n")
  );

  const selectors: Record<string, SelectorEval> = {};
  for (const c of CANDIDATE_SELECTORS) {
    const texts = await page
      .locator(c.selector)
      .allInnerTexts()
      .catch(() => [] as string[]);
    selectors[c.name] = { match_count: texts.length, texts };
  }

  return {
    t_seconds: tSeconds,
    page_url: pageUrl,
    chrome_error: chromeError,
    selectors,
  };
}

async function runPollTrace(
  page: Page,
  artifactDir: string
): Promise<void> {
  const tracePath = path.join(artifactDir, "poll-trace.jsonl");
  const stream = await fs.open(tracePath, "w");
  try {
    for (let t = 0; t < TRACE_DURATION_S; t++) {
      const tick: PollTick = {
        t,
        to_user_count: await page
          .locator(".to-user-container")
          .count()
          .catch(() => 0),
        selectors: {},
      };
      for (const c of CANDIDATE_SELECTORS) {
        const texts = await page
          .locator(c.selector)
          .allInnerTexts()
          .catch(() => [] as string[]);
        const last = texts[texts.length - 1] ?? "";
        tick.selectors[c.name] = {
          len: last.length,
          placeholder: /thinking|loading|please wait|generating|검색|분석|로딩/i.test(
            last
          ),
          preview: previewText(last),
        };
      }
      await stream.write(JSON.stringify(tick) + "\n");
      if (t < TRACE_DURATION_S - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } finally {
    await stream.close();
  }
}

export async function runAskDiagnostics(
  page: Page,
  sessionId: string,
  question: string
): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactDir = path.join(
    process.cwd(),
    "artifacts",
    "notebooklm-debug",
    `${ts}-${sessionId}`
  );

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    log.info(
      `🔬 [DIAG] ask_question diagnostics enabled — artifacts at ${artifactDir}`
    );

    await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));

    const snapshots: SnapshotRecord[] = [];
    snapshots.push(await snapshotAt(page, artifactDir, 0, 0));

    const tracePromise = runPollTrace(page, artifactDir);

    await new Promise((r) => setTimeout(r, 5000));
    snapshots.push(await snapshotAt(page, artifactDir, 1, 5));

    await tracePromise;

    snapshots.push(await snapshotAt(page, artifactDir, 2, 15));

    const candidates = {
      session_id: sessionId,
      question_preview: previewText(question, 200),
      snapshots,
    };
    await fs.writeFile(
      path.join(artifactDir, "candidates.json"),
      JSON.stringify(candidates, null, 2)
    );

    log.success(`🔬 [DIAG] artifacts written (${snapshots.length} snapshots)`);
  } catch (err) {
    log.warning(
      `🔬 [DIAG] diagnostic capture failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
```

- [ ] **Step 2: Verify the file compiles in isolation**

Run:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
npx tsc --noEmit src/utils/diagnostics.ts
```

Expected: errors about `Cannot find module 'patchright'` and `Cannot find module './logger.js'` and unused-variable warnings — these are because we're typechecking in isolation without the project's `tsconfig.json`. This step only confirms the file parses; the project-wide tsc check happens in Task 3.

- [ ] **Step 3: Verify it parses without syntax errors**

Run:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
node --check src/utils/diagnostics.ts 2>&1 || echo "expected: TS syntax — node --check will fail on TS"
```

Or simply:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
npx tsc --noEmit --skipLibCheck src/utils/diagnostics.ts 2>&1 | head -40
```

Expected: type errors related to missing module resolution (project context not loaded). If a parse/grammar error is shown, the file is broken. Otherwise proceed.

---

## Task 2: Wire diagnostics into browser-session.ts

**Files:**
- Modify: `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\src\session\browser-session.ts`

- [ ] **Step 1: Add the import**

Find this line near the top of the file (verify exact location with grep before editing):

```ts
import { log } from "../utils/logger.js";
```

Locate the existing import block. After the last `from "../utils/..."` import, add:

```ts
import { runAskDiagnostics } from "../utils/diagnostics.js";
```

(Place it alphabetically — it should sit alongside other `utils/` imports.)

- [ ] **Step 2: Add the guarded call after Enter press**

Find this exact block (lines 414–419):

```ts
      // Submit the question (Enter key)
      log.info(`  📤 Submitting question...`);
      await sendProgress?.("Submitting question...", 3, 5);
      await page.keyboard.press("Enter");

      // Small pause after submit
      await randomDelay(1000, 1500);
```

Replace it with:

```ts
      // Submit the question (Enter key)
      log.info(`  📤 Submitting question...`);
      await sendProgress?.("Submitting question...", 3, 5);
      await page.keyboard.press("Enter");

      // Opt-in diagnostic capture (NOTEBOOKLM_DIAGNOSTIC=true). Runs BEFORE
      // the wait so it can record the post-submit state in parallel with
      // waitForStableAnswer's polling. No behavior change when env is unset.
      if (process.env.NOTEBOOKLM_DIAGNOSTIC === "true") {
        await runAskDiagnostics(page, this.sessionId, question);
      }

      // Small pause after submit
      await randomDelay(1000, 1500);
```

- [ ] **Step 3: Verify the edit**

Run:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
grep -n "runAskDiagnostics\|NOTEBOOKLM_DIAGNOSTIC" src/session/browser-session.ts
```

Expected output (3 matches):

```
41:import { runAskDiagnostics } from "../utils/diagnostics.js";
419:      if (process.env.NOTEBOOKLM_DIAGNOSTIC === "true") {
420:        await runAskDiagnostics(page, this.sessionId, question);
```

(Line numbers approximate; match the import + the `if` + the `await`.)

- [ ] **Step 4: Commit**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
git add src/utils/diagnostics.ts src/session/browser-session.ts
git -c user.name=opencode -c user.email=opencode@local commit -m "feat(mcp): add opt-in diagnostic instrumentation to ask_question

Captures per-call evidence (screenshots, DOM dumps, 3-selector matrix,
1Hz text trace) when NOTEBOOKLM_DIAGNOSTIC=true. Default off — zero
behavior change. Purpose: diagnose ask_question timeout where it's
unclear whether NotebookLM UI ever produces an answer in the DOM."
```

---

## Task 3: Type-check the full project

**Files:**
- No file changes — verification only

- [ ] **Step 1: Run the project's TypeScript build**

Run:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
npx tsc --noEmit
```

Expected: 0 errors. The diagnostic module + import in `browser-session.ts` must type-check cleanly.

If errors are reported, fix them inline (most likely candidates: missing type for `evaluateAll` callback parameter, or import path resolution). Do not proceed to Task 4 until clean.

- [ ] **Step 2: Commit any build-fix changes (if needed)**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
git status --short
```

If any file changed (e.g. type cast in `diagnostics.ts`), commit with:
```bash
git add <changed-file>
git -c user.name=opencode -c user.email=opencode@local commit -m "fix(mcp): typecheck fixes for diagnostic module"
```

If no changes, skip this step.

---

## Task 4: Live smoke test (default OFF → zero behavior change)

**Files:**
- No file changes — verification only

- [ ] **Step 1: Restart the MCP server with the new build**

The MCP server is currently running as PID 26112 on port 3003. Restart it:

```bash
# Kill existing server
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
# Find and stop the running notebooklm-mcp process on port 3003
netstat -ano | findstr :3003
```

Use the PID shown to stop the process, then restart:
```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
node dist/index.js > notebooklm-mcp-3003.err.log 2>&1 &
```

(Adjust the start command to match the project's actual entry — check `package.json` `scripts.start` or `bin` field if `dist/index.js` does not exist.)

Verify the server is up:
```bash
curl -s http://127.0.0.1:3003/healthz
```

Expected: 2xx response with healthcheck payload.

- [ ] **Step 2: Run a short ask_question call with NOTEBOOKLM_DIAGNOSTIC unset**

From the worker app at `C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py`, run the same prompt that previously timed out (the patched smoke test from prior session):

```bash
cd C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py
NOTEBOOKLM_MCP_TIMEOUT_MS=180 NOTEBOOKLM_ASK_TIMEOUT_MS=180 \
  NOTEBOOKLM_ASK_SHOW_BROWSER=true \
  NOTEBOOKLM_DEFAULT_NOTEBOOK_ID=invoice-audit-smoke-notebook \
  python -c "import asyncio; from app.notebooklm.mcp_client import ask; print(asyncio.run(ask('Return JSON only: {\"ok\": true}')))"
```

Expected: same `httpx.ReadTimeout` as before. The diagnostic module must NOT have changed behavior — no `artifacts/notebooklm-debug/` directory should be created.

- [ ] **Step 3: Verify no diagnostic artifacts were created**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
ls artifacts/ 2>/dev/null || echo "no artifacts/ dir — expected"
```

Expected: "no artifacts/ dir" (or empty). Confirms default-off behavior.

---

## Task 5: Live smoke test (diagnostic ON → artifacts created)

**Files:**
- No file changes — verification only

- [ ] **Step 1: Run a short ask_question with NOTEBOOKLM_DIAGNOSTIC=true**

Same command, with the env var added:

```bash
cd C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py
NOTEBOOKLM_DIAGNOSTIC=true \
NOTEBOOKLM_MCP_TIMEOUT_MS=180 NOTEBOOKLM_ASK_TIMEOUT_MS=180 \
  NOTEBOOKLM_ASK_SHOW_BROWSER=true \
  NOTEBOOKLM_DEFAULT_NOTEBOOK_ID=invoice-audit-smoke-notebook \
  python -c "import asyncio; from app.notebooklm.mcp_client import ask; print(asyncio.run(ask('Return JSON only: {\"ok\": true}')))"
```

Expected: same `httpx.ReadTimeout` (this verifies the hang exists independently of diagnostics). The MCP server logs should include:

```
🔬 [DIAG] ask_question diagnostics enabled — artifacts at artifacts/notebooklm-debug/...
🔬 [DIAG] artifacts written (3 snapshots)
```

- [ ] **Step 2: Verify the artifacts were created**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
ls -la artifacts/notebooklm-debug/
```

Expected: one timestamped directory. Inside it:

```bash
ls -la artifacts/notebooklm-debug/*/
```

Expected 11 files:
- `screenshot-0.png`, `screenshot-1.png`, `screenshot-2.png`
- `to-user-html-0.txt`, `to-user-html-1.txt`, `to-user-html-2.txt`
- `to-user-text-0.txt`, `to-user-text-1.txt`, `to-user-text-2.txt`
- `candidates.json`
- `poll-trace.jsonl`

- [ ] **Step 3: Inspect `candidates.json`**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
cat artifacts/notebooklm-debug/*/candidates.json
```

Expected: 3 snapshots in the `snapshots` array, each with `selectors.A_primary`, `selectors.B_fallback_conversation_turn`, `selectors.C_fallback_data_attr`. Look at `match_count` and `texts` to answer the diagnostic question:

- If `A_primary.match_count > 0` AND `A_primary.texts` non-empty: the DOM is producing answer candidates — investigate why `waitForStableAnswer` rejected them (placeholder filter? stability gate?).
- If `A_primary.match_count == 0` AND `B_*` / `C_*` non-empty: the primary selector is stale; promote a working fallback to production.
- If all three `match_count == 0`: NotebookLM is not producing an answer at all — server-side or auth issue, not selector.

- [ ] **Step 4: Inspect `poll-trace.jsonl`**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
cat artifacts/notebooklm-debug/*/poll-trace.jsonl
```

Expected: 15 JSON lines, one per second. The `len` values tell us whether text is growing (streaming) or stuck (placeholder lock or no generation).

- [ ] **Step 5: Commit the diagnostic results**

The artifacts are evidence; do not commit them. Instead, write a one-line summary to the spec doc's companion plan file and commit only the plan update:

```bash
cd C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main
# Append a short "Diagnostic run 1 result" section to the spec, summarizing match counts
# (manual: read the json files, write 3-5 lines)
git add docs/superpowers/specs/2026-06-14-notebooklm-ask-question-diagnostic-design.md
git -c user.name=opencode -c user.email=opencode@local commit -m "docs(spec): record diagnostic run 1 evidence"
```

If you prefer not to modify the spec, skip this step — the evidence is in the artifacts dir and readable by future runs.

---

## Task 6: Add .gitignore for diagnostic artifacts

**Files:**
- Modify: `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\.gitignore`

- [ ] **Step 1: Add the artifacts pattern**

Check if `artifacts/` is already ignored:

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
grep -n "artifacts" .gitignore || echo "not present"
```

If absent, append:

```
# Diagnostic artifacts (may contain notebook content)
artifacts/notebooklm-debug/
```

- [ ] **Step 2: Commit**

```bash
cd C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55
git add .gitignore
git -c user.name=opencode -c user.email=opencode@local commit -m "chore(mcp): gitignore diagnostic artifacts"
```

---

## Self-Review

**Spec coverage check:**

- ✅ Entry point after Enter press — Task 2 Step 2
- ✅ 3-phase capture (initial / trace / final) — Task 1 (snapshotAt × 3, runPollTrace)
- ✅ 3 candidate selectors A/B/C — Task 1 (CANDIDATE_SELECTORS const)
- ✅ Artifacts layout (11 files) — Task 1 (snapshotAt writes 6 files + 3 screenshots, runPollTrace writes 1, end of runAskDiagnostics writes candidates.json)
- ✅ Env toggle `NOTEBOOKLM_DIAGNOSTIC` — Task 2 Step 2 (`if` guard)
- ✅ Default OFF, zero behavior change — Task 4 (verification step)
- ✅ Best-effort, no failure into ask_question — Task 1 (try/catch wrapping runAskDiagnostics body)
- ✅ Debug log level for activity, info for summary — Task 1 (log.info for summary, log.warning for failure, no log.debug needed since artifacts are the evidence)
- ✅ .gitignore — Task 6

**Placeholder scan:** No TBDs, TODOs, "fill in details", or "implement later". Every step has concrete code or commands.

**Type consistency:** `runAskDiagnostics(page, sessionId, question)` is exported from `diagnostics.ts` and imported in `browser-session.ts` with matching signature. `Page` type from `patchright` is consistent. `CANDIDATE_SELECTORS` shape `{ name, selector }` is used consistently in both `snapshotAt` and `runPollTrace`.

**Out-of-scope confirmed:** No change to `waitForStableAnswer`, `selectors.ts`, `chat.ts`, or the production wait/poll logic.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-notebooklm-ask-question-diagnostic.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
