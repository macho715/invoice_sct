# Vitest OOM Runner Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/web` full Vitest execution exit cleanly without disabling tests or weakening isolation enough to cause cross-file state bleed.

**Architecture:** Keep the existing Node test environment and test isolation. Reduce runner memory pressure by lowering file-level parallelism first, then validate that `job-store-mcp`, `job-store`, `fx-check`, and the full test suite keep passing.

**Tech Stack:** Vitest 2.1.x, TypeScript, Node.js, Next.js app test suite.

---

## File Structure

- Modify: `apps/web/vitest.config.ts`
  - Responsibility: Central Vitest runner configuration for `apps/web`.
- No test files should be edited in the first implementation pass.
  - Existing tests already expose the failure mode.

## Task 1: Add Conservative Vitest Runner Settings

**Files:**
- Modify: `apps/web/vitest.config.ts`

- [ ] **Step 1: Capture current targeted test baseline**

Run:

```powershell
cd C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\apps\web
npm test -- tests/job-store-mcp.test.ts tests/job-store.test.ts tests/fx-check.test.ts
```

Expected:

```text
Test Files 3 passed
Tests 13 passed
```

- [ ] **Step 2: Modify `vitest.config.ts`**

Replace the current file with this content:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    globals: false,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1
      }
    }
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  }
});
```

Rationale:

- `fileParallelism: false` reduces simultaneous test file loading.
- `pool: 'forks'` keeps process isolation.
- `maxForks: 2` keeps some isolation without the state bleed seen in single-fork mode.
- Do not set `isolate: false`.

- [ ] **Step 3: Verify TypeScript accepts the config**

Run:

```powershell
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

The command exits `0`.

- [ ] **Step 4: Verify targeted tests still pass**

Run:

```powershell
npm test -- tests/job-store-mcp.test.ts tests/job-store.test.ts tests/fx-check.test.ts
```

Expected:

```text
Test Files 3 passed
Tests 13 passed
```

- [ ] **Step 5: Verify full test suite**

Run:

```powershell
npm test
```

Expected:

```text
Test Files 24 passed
Tests 90 passed
```

The command exits `0` and does not report `JavaScript heap out of memory`.

- [ ] **Step 6: If Vitest rejects `maxForks` in config, use CLI script fallback**

If Step 3 or Step 5 shows that Vitest 2.1.x does not honor `poolOptions.forks.maxForks`, modify `apps/web/package.json` test script instead:

```json
{
  "scripts": {
    "test": "vitest run --pool=forks --no-file-parallelism"
  }
}
```

Then rerun:

```powershell
npm run typecheck
npm test -- tests/job-store-mcp.test.ts tests/job-store.test.ts tests/fx-check.test.ts
npm test
```

Expected:

```text
typecheck exits 0
targeted tests exit 0
full tests exit 0
```

## Task 2: Record Validation Result

**Files:**
- Modify: `docs/superpowers/specs/2026-06-13-vitest-oom-design.md`

- [ ] **Step 1: Append validation note only after commands finish**

Append this section to the design file:

```md
## Validation Result

- `npm run typecheck`: <PASS or FAIL>
- `npm test -- tests/job-store-mcp.test.ts tests/job-store.test.ts tests/fx-check.test.ts`: <PASS or FAIL>
- `npm test`: <PASS or FAIL>
- OOM status: <not observed or still observed>
```

Replace each placeholder with the actual observed result before saving.

- [ ] **Step 2: Re-scan for placeholders**

Run:

```powershell
Select-String -LiteralPath docs\superpowers\specs\2026-06-13-vitest-oom-design.md -Pattern '<PASS or FAIL>|<not observed or still observed>|TBD|TODO'
```

Expected:

```text
No output
```

## Self-Review

- Spec coverage: This plan implements the approved conservative runner fix from `docs/superpowers/specs/2026-06-13-vitest-oom-design.md`.
- Placeholder scan: The executable steps contain no unresolved placeholders except the explicit validation note template, which must be replaced before saving.
- Type consistency: The plan touches only `vitest.config.ts` first; `package.json` is a documented fallback only.

