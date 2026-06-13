# Phase 1 단위 테스트 fix — 완료 보고서

**Date**: 2026-06-09
**Scope**: apps/web vitest 8 fail → 33/33 pass
**Approach**: B (Direct failure-fix + spec drift)
**Time**: 1.5 hours

## Before / After

| | Before | After |
|---|---|---|
| Test files | 11 | 11 |
| it() blocks | 33 | 33 |
| Passed | 20 | 33 |
| Failed | 8 + 2 file-load | 0 |

## Clusters Fixed

- **C1 (Mock Hoist)**: 2 files ([blob.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/blob.test.ts), [api-files-ingest.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/api-files-ingest.test.ts)) - Fixed ESM temporal dead zone (TDZ) issues by hoisting mocks or using inline mock initializers.
- **C2 (Fetch API)**: 1 file ([parser-client.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/parser-client.test.ts)) - Mocked `text()` response properly and prepended `PARSE_FAILED:` to parser failure messages to align with regex checks.
- **C3 (Spec Drift)**: 2 files ([types.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/types.test.ts), [cf-mcp-client.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/cf-mcp-client.test.ts)) - Added missing required zod properties (`source_ref`) and aligned errors with `MCP_UNAVAILABLE` regex constraints.
- **C4 (Helper Fetch)**: 3 files ([api-audit-status.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/api-audit-status.test.ts), [api-audit-result.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/api-audit-result.test.ts), [api-invoice-audit-run.test.ts](file:///C:/Users/SAMSUNG/Downloads/SCT_ONTOLOGY-main/SCT_ONTOLOGY-main/apps/web/tests/api-invoice-audit-run.test.ts)) - Avoided actual HTTP/fetch calls and mock leaks by importing route handlers directly in memory and cleaning up global stubs with `afterEach`.

## Spec Drift Patched

- **v0.2.1 patch note**: §5.2.3 MCP error format aligned to prepend `MCP_UNAVAILABLE`.
- **v0.2.1 patch note**: §5.4 test isolation introduced (handlers called in memory via mock Request/Response).

## Regression

- vitest: 33/33 (web) + 317/317 (server) = 350/350 ✅
- typecheck: `tsc --noEmit` passed ✅
- worker dry-run: `wrangler deploy --dry-run` passed ✅
- Python pytest: 20/20 ✅
