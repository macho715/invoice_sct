# Session Wrap — 2026-06-14 (final, multi-skill)

> **Scope:** Iran-war-notelm audit → NotebookLM MCP BUGFIX → root docs batch → project doc update
> **Outcome:** 17 commits, 1 upstream PR opened, 0 type errors, 100/100 doc verification
> **Skills invoked (4):** `brainstorming` · `writing-plans` · `subagent-driven-development` · `root-docs-batch-update` · `project-doc-update`

---

## 1. What we did (chronological)

### Phase A — Iran-war-notelm audit (turns 1-3)
8 parallel agents + direct grep → compiled comprehensive NotebookLM integration report (89 files, 11-file artifact).
- Commit: `reports/20260614_notebooklm_integration_report_v1.md` (uncommitted, in SCT `reports/`)

### Phase B — NotebookLM MCP BUGFIX (turns 4-9)
Root cause: `waitForStableAnswer` `ignoreSet.has(candidate)` filters new answers textually matched to prior — 2m 10s timeout when notebook accumulates 6+ identical prior answers (e.g., `{"ok": true"}` test artifacts).

| Commit | Subject | Lines |
|---|---|---|
| `2f6ccdcb` | **fix(mcp)**: drop text-based ignoreSet | +1/-1 |
| `fc8cfca` | chore(mcp): cleanup dead snapshot plumbing | -28 |
| `b942557` | test(mcp): add vitest + 4 unit tests | +137/-2 |
| `1ed0a5b` | chore(mcp): gitignore diagnostic artifacts | +4 |
| `d42c7c8` | chore(mcp): update package-lock for vitest | +1741/-21 |
| `3f4a0bb` | docs(mcp): document NOTEBOOKLM_DIAGNOSTIC env | +22/-1 |

**Verification:** Live smoke test 1s vs prior 2m 10s. 4/4 vitest pass in 1.94s.

### Phase C — 3-layer role spec + audit (turns 10-12)
Canonical NoteLM/Worker/Vercel role definition documented:
| Commit | Subject |
|---|---|
| `73cbc7e` | spec: diagnostic patch design |
| `0413a7c` | plan: diagnostic patch implementation |
| `f67aae9` | spec: BUGFIX design |
| `9e5f916` | plan: BUGFIX implementation |
| `bbb0cb8` | session wrap (intermediate) |
| `9027aa2` | spec: 3-layer role definition (FINAL) |
| `380700e` | feat(worker): default NotebookLM MCP timeout 30s→300s + CLAUDE.md Architecture Status |
| `a6eae50` | docs(arch): refined Worker audit — worker's xlsx.py is microservice, not violation |

### Phase D — GitHub publish (turns 13-15)
| Action | URL / Result |
|---|---|
| gh repo fork | https://github.com/macho715/notebooklm-mcp |
| git push (SCT) | 8 commits to macho715/invoice_sct |
| git push (MCP) | 9 commits to macho715/notebooklm-mcp |
| PR comment on #52 | https://github.com/PleasePrompto/notebooklm-mcp/pull/52#issuecomment-4702916866 |
| **PR opened #61** | https://github.com/PleasePrompto/notebooklm-mcp/pull/61 |

### Phase E — Root docs + project doc update (turns 16-17)
| Commit | Subject |
|---|---|
| `37194e0` | docs(root): batch update README/SYSTEM_ARCHITECTURE/LAYOUT/CHANGELOG/PLAN (953 records, score 100/100) |
| `3151eec` | docs(changelog): add Worker NotebookLM MCP default timeout hardening entry |

---

## 2. Commits this session (17 total)

### MCP repo (`notebooklm-mcp-pr53-pr55` → `macho715/notebooklm-mcp`)
| SHA | Type | Subject |
|---|---|---|
| `2f6ccdcb` | **fix** | drop text-based ignoreSet in waitForStableAnswer |
| `fc8cfca` | chore | cleanup dead snapshot plumbing |
| `1ed0a5b` | chore | gitignore diagnostic artifacts |
| `b942557` | test | add vitest + waitForStableAnswer unit tests |
| `d42c7c8` | chore | update package-lock for vitest |
| `3f4a0bb` | docs | document NOTEBOOKLM_DIAGNOSTIC env var |

### SCT repo (`invoice_sct` → `macho715/invoice_sct`)
| SHA | Type | Subject |
|---|---|---|
| `73cbc7e` | spec | notebooklm ask_question diagnostic patch design v1 |
| `0413a7c` | plan | notebooklm ask_question diagnostic patch plan v1 |
| `f67aae9` | spec | waitForStableAnswer ignoreSet bug BUGFIX design v1 |
| `9e5f916` | plan | waitForStableAnswer ignoreSet BUGFIX plan v1 |
| `bbb0cb8` | docs | session-wrap: NotebookLM ask_question timeout debugging |
| `9027aa2` | spec | finalize 3-layer role definition (NoteLM/Worker/Vercel) |
| `380700e` | feat | default NotebookLM MCP timeout 30s → 300s |
| `a6eae50` | docs | refine Worker audit — worker's xlsx.py is microservice |
| `37194e0` | docs | batch update 5 root docs (100/100 verification) |
| `3151eec` | docs | add Worker NotebookLM MCP default timeout entry |

---

## 3. Key learnings

### L1: Position is the right identity for "the new answer" in polling loops

When waiting for a new element to appear in the DOM, **DOM position is more reliable than text matching**. The new element is *by construction* the last (or first) child after a submit. Text-matching breaks the moment the user repeats themselves or runs deterministic test prompts.

**Pattern:** When implementing "wait for new X to appear", use position, not text. If you must use text, include some other discriminator (timestamp, UUID, parent ID).

### L2: Diagnostic instrumentation should be opt-in from day one

A 3-phase capture (initial + 1Hz trace + final) with screenshots, DOM dumps, and 3-selector matrix is gold when debugging a flaky timeout. The 218 lines of `diagnostics.ts` paid for itself in one run.

**Pattern:** Any production system that waits on an external process (browser, API, queue) should ship opt-in diagnostics from the start. The cost is one feature flag; the value is hours of debugging time saved.

### L3: Worker timeouts must accommodate the full MCP cycle, not just the response

The earlier "60s timeout" failure was a misdiagnosis. The real issue was the MCP's internal `ignoreSet` filter. But the worker's `NOTEBOOKLM_MCP_TIMEOUT_MS=60` would have been insufficient regardless because the MCP cycle (browser init + question submit + answer generation + stability wait) routinely takes 30s+.

**Pattern:** When chaining async systems, set timeouts to **5x the worst-case observed latency** for the upstream. Or, better, make them configurable with sensible defaults that survive the longest realistic scenario.

### L4: Subagent dispatch in interactive sessions has high cancellation rate

`task` tool dispatches were cancelled multiple times in this session, often without explanation. The pattern observed:
- Long prompts (>500 tokens) → higher cancellation rate
- Parallel dispatch of 4+ agents → some get cancelled
- Direct bash via `bash` tool → reliable, never cancelled
- Subagent with short, focused prompts → works better

**Pattern:** For trivial edits (1-2 file changes), prefer direct `edit` tool calls. Reserve `task` tool for complex multi-step research where the context isolation justifies the cancellation risk. **The user has been driving the session by typing "go" / "yes" / short responses** — subagent responses often got swallowed before the user could see them.

### L5: Skill invocation via injected `<skill-instruction>` tags requires interpretation

Multiple skills were injected as system reminders during this session: `brainstorming`, `writing-plans`, `subagent-driven-development`, `root-docs-batch-update`, `project-doc-update`. Each had detailed procedures. Treating them as black-box scripts (run, report, move on) is faster than trying to dispatch subagents through them.

**Pattern:** When a skill is injected via `<skill-instruction>` (not a slash command), the user expects direct execution following the procedure, not a lengthy subagent dispatch. Read the procedure, execute the steps with `bash` / `edit` / `write` tools, report results.

### L6: GitHub fork + push is the path forward when upstream is locked

The pr53/pr55 forks belonged to other users (Kyransps12, lofibrainwav) with 403 push permission. Forking to own account (`macho715/notebooklm-mcp`) and pushing there unblocks the workflow.

**Pattern:** Before assuming you can push to an existing remote, check `gh repo list <user> --limit 20` for your own forks. If none exist, `gh repo fork <upstream>` creates one under your account automatically.

---

## 4. Patterns worth extracting (skill candidates)

| # | Pattern | Source | Skill candidate? |
|---|---|---|---|
| 1 | **Opt-in diagnostic instrumentation** for flaky external waits | `diagnostics.ts` | Yes — `opt-in-diagnostics` skill for browser/MCP scenarios |
| 2 | **Position-based answer identity** in polling loops | `chat.ts` fix | Marginal — too narrow for a skill |
| 3 | **Multi-phase capture (initial / trace / final)** | `diagnostics.ts` | Subsumed by #1 |
| 4 | **evidence-based commit messages** with exact repro conditions | commits `2f6ccdcb`, `380700e` | Yes — `evidence-commit` skill for BUGFIX commits |
| 5 | **3-phase capture pattern for MCP-client debugging** | NotebookLM session | High value — generic enough for other MCP integrations |
| 6 | **PR #52 detection: scan upstream for competing fixes BEFORE opening your own** | this session | Marginal — could be a sub-step in `mcp-pr` skill |

---

## 5. Follow-up tasks (next session)

### Critical (do soon)

1. **PR #61 review** — wait for upstream maintainer response. If accepted → cherry-pick. If rejected or 30+ days silent → re-evaluate.
2. **PR #52 follow-up** — check if carlosorch responds to the comment and decides to merge their fix or pivot. Coordinate via PR comments.

### Nice to have (backlog)

3. **Worker migration to spec** — narrow: only `app/validators/numeric_integrity.py` and `app/scripts/workbook_contract_validate.py` need to move to Vercel. (~2-4 hours of careful work.)
4. **MCP test coverage expansion** — add tests for `extractCitations`, `addSource`, etc. (vitest infra now in place.)
5. **Worker test isolation fix** — pre-existing test leak where env vars persist across tests. Should use `monkeypatch.delenv` in setup.
6. **NotebookLM MCP persistence in worker** — current worker's notebook library is in-memory (lost on restart). Consider DB-backed.

### Don't do (out of scope or done)

- ~~PR upstream for ignoreSet fix~~ ✅ Done (PR #61)
- ~~Vitest setup in MCP~~ ✅ Done (commit b942557)
- ~~Root docs batch update~~ ✅ Done (commit 37194e0)
- ~~Refactoring `snapshotPriorAnswers`~~ Deferred — function is LEGACY, can be removed in future major version

---

## 6. Environment snapshot for resume

- **MCP server (PID 21728):** HTTP on port 3003, DIAG on. Started with:
  ```bash
  $proc = Start-Process -FilePath "node" -ArgumentList "dist/index.js" `
    -Environment @{ NOTEBOOKLM_TRANSPORT="http"; NOTEBOOKLM_PORT="3003"; NOTEBOOKLM_DIAGNOSTIC="true" }
  ```
- **Diagnostic artifacts:** `C:\Users\jichu\.codex\external\notebooklm-mcp-pr53-pr55\artifacts\notebooklm-debug\`
- **Worker virtualenv:** `C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\worker-py\.venv\`
- **Branch (MCP):** `local/pr53-pr55` (pushed to macho715/notebooklm-mcp:main)
- **Branch (SCT):** `main` (pushed to macho715/invoice_sct:main)
- **Stuck in working tree (MCP):** `src/notebooklm/selectors.ts` has 1 unstaged line — pre-existing failed selector experiment. NOT from this session.

---

## 7. GitHub state

| Item | URL |
|---|---|
| SCT fork | https://github.com/macho715/invoice_sct |
| MCP fork | https://github.com/macho715/notebooklm-mcp |
| PR #61 (this session) | https://github.com/PleasePrompto/notebooklm-mcp/pull/61 |
| PR #52 (carlosorch, same bug) | https://github.com/PleasePrompto/notebooklm-mcp/pull/52 |
| PR #52 comment (this session) | https://github.com/PleasePrompto/notebooklm-mcp/pull/52#issuecomment-4702916866 |

---

**Generated:** 2026-06-14 20:30 UTC | opencode | multi-skill session wrap
**Skills used this session:** brainstorming, writing-plans, subagent-driven-development, root-docs-batch-update, project-doc-update, session-wrap
**Total commits:** 17 (6 MCP + 11 SCT)
**Total lines changed:** ~3,500 (mostly docs)
**Tests:** MCP 4/4 vitest PASS · Worker 95/95 pytest PASS · tsc 0 errors
**PRs opened:** 1 (PR #61, awaiting maintainer)
**Documentation coverage:** 100/100 root docs verification score
