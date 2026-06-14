# Session Wrap — 2026-06-14

> **Scope:** NotebookLM MCP `ask_question` timeout debugging → BUGFIX verified
> **Outcome:** Bug identified, fixed, verified live (1s vs 2m 10s)
> **Total commits this session:** 2 (in `notebooklm-mcp-pr53-pr55`) + 2 docs (in SCT)

---

## 1. What we built / fixed

### Diagnostic patch (Tasks 1-3 of plan `0413a7c`)

Added opt-in observability to the MCP `ask_question`:
- `src/utils/diagnostics.ts` (NEW, 218 lines) — 3-phase capture: initial snapshot, 1Hz trace for 15s, final snapshot
- `src/session/browser-session.ts` (+5 lines) — guarded call after `Enter` press
- 11 artifacts per call: 3 screenshots + 6 text/html files + `candidates.json` + `poll-trace.jsonl`
- Toggle: `NOTEBOOKLM_DIAGNOSTIC=true` (default off, zero overhead)

**Value:** Without the diagnostic, the "is it a selector issue, a transport issue, or a NotebookLM issue" question was unanswerable. With it, we pinpointed the actual root cause in one run.

### BUGFIX: `waitForStableAnswer` ignoreSet

`src/notebooklm/chat.ts` was filtering new answers by text against prior answers:
```ts
if (!isEcho && !isPrior) { /* stability check */ }
```
…where `isPrior = ignoreSet.has(candidate)`. When a new answer happened to match a prior's text (e.g. repeated test prompts `{"ok": true}`), it was misclassified and the loop timed out at 2m 10s.

**Fix:** Drop the `ignoreSet` filter. `readLatestAnswer` already uses `.last()` on the selector, so DOM position is the correct identity. The `isEcho` check (filtering the question echoed back) is preserved.

**Live verification:** 1s vs 2m 10s. Commit `2f6ccdcb`.

### Cleanup (follow-up from code review)

Three trivial edits to remove dead data plumbing now that `ignoreSet` is gone:
- `browser-session.ts` — drop `existingResponses` snapshot block + `ignoreTexts` arg
- `types.ts` — remove orphaned `WaitForAnswerOptions` interface
- `page-utils.ts` — fix stale comment, mark `snapshotAllResponses` as LEGACY

Commit `fc8cfca`. Net -22 lines of dead code.

---

## 2. Commits this session

### `notebooklm-mcp-pr53-pr55` repo
| SHA | Type | Subject |
|---|---|---|
| `2f6ccdcb` | fix(mcp) | drop text-based ignoreSet in waitForStableAnswer |
| `fc8cfca` | chore(mcp) | cleanup dead snapshot plumbing after ignoreSet fix |

### `SCT_ONTOLOGY-main` repo
| SHA | Type | Subject |
|---|---|---|
| `73cbc7e` | docs(spec) | notebooklm ask_question diagnostic patch design v1 |
| `0413a7c` | docs(plan) | notebooklm ask_question diagnostic patch implementation plan v1 |
| `f67aae9` | docs(spec) | waitForStableAnswer ignoreSet bug BUGFIX design v1 |
| `9e5f916` | docs(plan) | waitForStableAnswer ignoreSet BUGFIX implementation plan v1 |

---

## 3. Key learnings

### L1: Position is the right identity for "the new answer" in polling loops

When waiting for a new element to appear in the DOM, **DOM position is more reliable than text matching**. The new element is *by construction* the last (or first, depending on layout) child after a submit. Text-matching breaks the moment the user repeats themselves or runs deterministic test prompts.

**Pattern:** When implementing "wait for new X to appear", use position, not text. If you must use text (e.g., multi-element cases), include some other discriminator (timestamp, UUID, parent ID).

### L2: Diagnostic instrumentation should be opt-in from day one

A 3-phase capture (initial + 1Hz trace + final) with screenshots, DOM dumps, and 3-selector matrix is gold when debugging a flaky timeout. The 200+ lines of `diagnostics.ts` paid for itself in one run.

**Pattern:** Any production system that waits on an external process (browser, API, queue) should ship opt-in diagnostics from the start. The cost is one feature flag; the value is hours of debugging time saved.

### L3: Worker timeouts must accommodate the full MCP cycle, not just the response

The earlier "60s timeout" failure was a misdiagnosis. The real issue was the MCP's internal `ignoreSet` filter. But the worker's `NOTEBOOKLM_MCP_TIMEOUT_MS=60` would have been insufficient regardless because the MCP cycle (browser init + question submit + answer generation + stability wait) routinely takes 30s+.

**Pattern:** When chaining async systems, set timeouts to **5x the worst-case observed latency** for the upstream. Or, better, make them configurable with sensible defaults that survive the longest realistic scenario.

### L4: Use the diagnostic harness to disambiguate, not just to debug

The `candidates.json` matrix (3 selectors × 3 snapshots) directly answered "is the selector stale?" → "no, primary works". This is a pattern worth repeating: when uncertain which layer is broken, instrument the boundary with a small matrix of independent probes.

---

## 4. Patterns worth extracting (skill candidates)

| # | Pattern | Source | Skill candidate? |
|---|---|---|---|
| 1 | **Opt-in diagnostic instrumentation** for flaky external waits | `diagnostics.ts` | Yes — `opt-in-diagnostics` skill for browser/MCP scenarios |
| 2 | **Position-based answer identity** in polling loops | `chat.ts` fix | Marginal — too narrow for a skill |
| 3 | **Multi-phase capture (initial / trace / final)** | `diagnostics.ts` | Subsumed by #1 |
| 4 | **evidence-based commit messages** with exact repro conditions | commit `2f6ccdcb` | Yes — `evidence-commit` skill for BUGFIX commits |

---

## 5. Follow-up tasks (next session)

### Critical (do soon)

1. **PR the fix upstream** — open PR against `notebooklm-mcp-pr53-pr55` with commits `2f6ccdcb` + `fc8cfca`. Title: "fix(chat): drop text-based ignoreSet in waitForStableAnswer". Description should reference the live smoke test artifacts.
2. **Add `artifacts/notebooklm-debug/` to MCP repo `.gitignore`** — never committed (Task 6 from plan `0413a7c` was not executed). Without it, the next developer's first `git status` will show ~5MB of debug PNGs.

### Nice to have (backlog)

3. **Worker default timeout** — `apps/worker-py` should set `NOTEBOOKLM_MCP_TIMEOUT_MS=300` by default to accommodate the full MCP cycle. Currently relies on the caller setting it.
4. **MCP `extractCitations` post-processing** — observed slow, may be a secondary timeout source. Profile + optimize if needed.
5. **Add a real unit test for `waitForStableAnswer`** — install vitest in the MCP project, mock `Page`, assert that 6 prior + 1 new (same text) returns the new text within `stablePolls` polls. This is a real gap.
6. **Document the diagnostic toggle in the MCP README** — `NOTEBOOKLM_DIAGNOSTIC=true` is undocumented outside the runbook.

### Don't do (out of scope)

- Refactoring `snapshotPriorAnswers` further — the function is now LEGACY, can be removed in a future major version
- Touching `selectors.ts` (the unstaged modification is a pre-existing failed experiment; leave for separate evaluation)
- Rewriting the worker `mcp_client.py` — works correctly, the issue was upstream

---

## 6. Environment snapshot for resume

- **MCP server:** PID 21728, HTTP 200 on port 3003 (DIAG on). Started with `Start-Process -Environment @{ NOTEBOOKLM_TRANSPORT="http"; NOTEBOOKLM_PORT="3003"; NOTEBOOKLM_DIAGNOSTIC="true" }`
- **Diagnostic artifacts location:** `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\artifacts\notebooklm-debug\`
- **Branch:** `local/pr53-pr55` (in the MCP repo)
- **Stuck in working tree:** `src/notebooklm/selectors.ts` has 1 unstaged line — pre-existing failed local-selector-patch experiment. NOT from this session.

---

**Generated:** 2026-06-14 | opencode | session wrap
