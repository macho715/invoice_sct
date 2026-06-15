# NotebookLM Worker Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Date:** 2026-06-14
**Project:** Invoice SCT ontology audit
**Decision:** Option B - Worker plus Vercel gate
**Source plans:** `C:/Users/jichu/.claude/plans/cuddly-bouncing-rocket.md`, `pdf.md`

## Summary

Finish the NotebookLM first-pass extraction path as a trusted helper, not a final adjudicator.

The target path is:

```text
PDF upload -> Blob/job -> worker-py trigger -> MarkItDown MCP -> invoice markdown
-> NotebookLM MCP add_source(type=text) -> ask_question(JSON-only extraction prompt)
-> worker parses and validates JSON -> HMAC-signed Vercel callback
-> parser-compatible adapter -> mismatch/manual-review gate -> audit engine
```

This scope closes the worker orchestrator and Vercel callback trust gate. It does not deploy the real MarkItDown MCP, NotebookLM MCP, Chrome profile host, or auto-wire the upload flow.

NotebookLM is not the source of truth. If the existing parser result exists, it remains authoritative. If the parser fails but NotebookLM succeeds, the result is `AMBER` and requires manual review.

## Key Changes

### Web Schema And Adapter

- Maintain these TypeScript schemas in `apps/web/src/lib/notebooklm.ts`:
  - `NotebookLmSummarySchema`
  - `ParserCompatibleResultSchema`
  - `NotebookLmCallbackPayloadSchema`
- Support both current and `pdf.md` callback aliases:
  - `notebooklm_source_id` or `source_id`
  - `summary` or `summary_json`
  - `source_sha256` or `source_hash`
  - `markdown_sha256`
- Keep `adaptNotebookLmToParserResult(summary)` parser-compatible, but do not put fabricated business values into the original extracted `fields`.
- If normalized output needs schema-required placeholders, mark the result with review flags and keep NotebookLM confidence below automatic pass behavior.
- Compare exactly these high-impact fields:
  - `invoice_no`
  - `waybill_no`
  - `order_no`
  - `job_no`
  - `po_no`
  - `do_no`
  - `bol_no`
  - `trip_no`
  - `origin_norm`
  - `destination_norm`
  - `amount`
  - `currency`
- Treat one-sided missing values as review-worthy mismatches.

### Web Callback Route

- Harden `POST /api/notebooklm/ingest-summary` in `apps/web/src/app/api/notebooklm/ingest-summary/route.ts`.
- Read the request with `request.text()` before parsing JSON.
- If `NOTEBOOKLM_CALLBACK_SECRET` is set, require `X-NotebookLM-Signature: sha256=<hex>`.
- Compute `createHmac('sha256', secret).update(rawBody).digest('hex')`.
- Compare signatures with `timingSafeEqual`.
- Return `401` for missing or invalid signatures.
- Require `source_sha256` or `source_hash` to match a stored job source file hash.
- Return `409 SOURCE_HASH_MISMATCH` if the source hash does not match.
- Apply `AMBER` or `NEEDS_REVIEW` when:
  - `summary.confidence < 0.85`
  - amount is missing
  - identifier is missing
  - currency is missing
  - any high-impact field mismatches
  - any high-impact field is present on only one side
- Store these audit trace fields:
  - `notebooklm_source_id`
  - `notebooklm_summary_received_at`
  - `notebooklm_confidence`
  - `notebooklm_flags`
  - `dual_extraction_mismatches`
- Do not store raw PDF bytes, raw markdown body, or raw NotebookLM answer in traces or logs. Store hashes and status only.

### Worker API And Pipeline

- Add `apps/worker-py/app/notebooklm/`.
- Add `POST /v1/notebooklm/run`.
- Request shape:

```json
{
  "job_id": "job_123",
  "blob_url": "https://...",
  "notebook_id": "optional"
}
```

- Success response shape:

```json
{
  "job_id": "job_123",
  "status": "CALLBACK_SENT",
  "notebooklm_source_id": "source_123",
  "markdown_sha256": "<64 hex>",
  "source_sha256": "<64 hex>",
  "callback_status": 202
}
```

- Required environment variables:
  - `MARKITDOWN_MCP_URL`
  - `NOTEBOOKLM_MCP_URL`
  - `WEB_CALLBACK_URL`
  - `NOTEBOOKLM_CALLBACK_SECRET`
- Optional environment variable:
  - `NOTEBOOKLM_DEFAULT_NOTEBOOK_ID`
- Worker sequence:
  - fetch PDF bytes from `blob_url`
  - compute `source_sha256` from original PDF bytes
  - build `data:application/pdf;base64,...` URI
  - call MarkItDown MCP `convert_to_markdown`
  - compute `markdown_sha256`
  - call NotebookLM MCP `add_source` with `type="text"`
  - call NotebookLM MCP `ask_question` with the JSON-only extraction prompt
  - strip NotebookLM markers, code fences, and surrounding prose
  - parse and validate JSON
  - retry once with a strict JSON-only suffix if parsing fails
  - HMAC-sign the exact callback body
  - POST to `WEB_CALLBACK_URL`
- If MarkItDown, add_source, or ask_question fails, return `NOTEBOOKLM_UNAVAILABLE` and send no callback.
- If JSON parsing fails after retry, send a low-confidence summary callback so Vercel marks the job `AMBER`.

### NotebookLM Prompt Contract

The extraction prompt must require:

- JSON only.
- No prose.
- No markdown fences.
- Missing values as `null`.
- No guessing or fabrication.
- Evidence quote for every non-null extracted field.
- Extraction only of DSV invoice verification fields.

Minimum JSON shape:

```json
{
  "doc_kind": "DSV_WAYBILL|INVOICE|UNKNOWN",
  "fields": {
    "invoice_no": null,
    "waybill_no": null,
    "do_no": null,
    "order_no": null,
    "job_no": null,
    "po_no": null,
    "bol_no": null,
    "trip_no": null,
    "loading_address": null,
    "destination": null,
    "origin_norm": null,
    "destination_norm": null,
    "amount": null,
    "currency": null
  },
  "lane": {
    "origin_raw": null,
    "destination_raw": null
  },
  "amounts": [],
  "shipment_ids": [],
  "document_numbers": [],
  "confidence": 0.0,
  "flags": [],
  "evidence": [
    {
      "field": null,
      "value": null,
      "quote": null
    }
  ]
}
```

## Implementation Tasks

### Task 1: Web Callback Test Harness

- Modify `apps/web/tests/api-notebooklm-ingest-summary.test.ts`.
- Update the callback helper to:
  - create a source file hash for every test job
  - serialize the raw JSON body once
  - sign the exact raw body with `NOTEBOOKLM_CALLBACK_SECRET`
  - send `X-NotebookLM-Signature`
- Add tests before broad route changes:
  - valid signed callback returns `202`
  - missing signature returns `401`
  - invalid signature returns `401`
  - source hash mismatch returns `409`
  - alias payload accepts `source_id`, `source_hash`, and `summary_json`

### Task 2: Web Callback Gate

- Modify `apps/web/src/lib/notebooklm.ts`.
- Ensure the three schemas listed above exist and support the alias contract.
- Keep the high-impact field list exact.
- Add or verify gate issue detection for low confidence, missing amount, missing identifier, and missing currency.
- Modify `apps/web/src/app/api/notebooklm/ingest-summary/route.ts`.
- Enforce HMAC when the callback secret is set.
- Enforce source hash matching.
- Write audit trace fields without raw markdown or raw NotebookLM answer.
- Keep parser result as source of truth.

### Task 3: Worker NotebookLM Module

- Create `apps/worker-py/app/notebooklm/__init__.py`.
- Create `apps/worker-py/app/notebooklm/schemas.py`.
- Create `apps/worker-py/app/notebooklm/prompts.py`.
- Create `apps/worker-py/app/notebooklm/extractor.py`.
- Create `apps/worker-py/app/notebooklm/mcp_client.py`.
- Create `apps/worker-py/app/notebooklm/orchestrator.py`.
- Add the official MCP Python SDK dependency if not present.
- Use `mcp.client.streamable_http.streamable_http_client` and `ClientSession.call_tool()`.
- Keep server-specific tool argument differences isolated inside `mcp_client.py`.

### Task 4: Worker Route

- Create `apps/worker-py/app/routes/notebooklm.py`.
- Register the route in `apps/worker-py/app/main.py` with prefix `/v1`.
- Implement `POST /v1/notebooklm/run`.
- Return stable status payloads.
- Do not log raw PDF, markdown, or NotebookLM answer.

### Task 5: Worker Tests

- Add extractor tests:
  - fenced JSON
  - `[AI-GENERATED]` prefix
  - prose-wrapped JSON
  - invalid text returns failure
- Add orchestrator tests:
  - happy path signs callback
  - MarkItDown failure sends no callback
  - add_source failure sends no callback
  - ask_question failure sends no callback
  - parse failure retries once and then sends AMBER callback
- Add route tests for request validation and stable response shape.

## Test Plan

Run targeted web tests:

```powershell
pnpm --filter @invoice-audit/web test -- --run tests/api-notebooklm-ingest-summary.test.ts
```

Run web typecheck:

```powershell
pnpm --filter @invoice-audit/web typecheck
```

Run worker tests:

```powershell
cd apps/worker-py
pytest -q
```

After targeted tests pass, run the existing baseline for web, worker, and mcp-server.

## Acceptance Criteria

- `POST /api/notebooklm/ingest-summary` accepts valid signed callbacks.
- Missing or invalid HMAC signature is rejected when a secret is configured.
- Source hash mismatch is rejected.
- Existing and `pdf.md` payload aliases work.
- NotebookLM low confidence forces manual review.
- Missing amount, missing identifier, and missing currency force manual review.
- Parser missing plus NotebookLM success becomes `AMBER`.
- NotebookLM failure does not block the existing parser path.
- Audit trace stores hashes and status only.
- No raw markdown body is stored.
- Worker route exists and returns stable status payloads.
- Worker callback uses HMAC over the exact raw JSON body.
- Targeted web tests pass.
- Worker tests pass.
- Web typecheck passes.

## Assumptions

- The MCP Python SDK supports Streamable HTTP for the required client path.
- `source_sha256` and `source_hash` refer to the original PDF/source file hash.
- `markdown_sha256` is metadata for traceability, not the source trust anchor.
- `NOTEBOOKLM_CALLBACK_SECRET` may be unset in local dev, but must be set for production.
- Deployment of MarkItDown MCP, NotebookLM MCP, and authenticated Chrome is operational scope and not part of this implementation.
- Do not stage unrelated files such as `dsv shpt pdf.md`, `docs/codex/AGENTS.patched.md`, or scratch artifacts unless explicitly requested.

## References

- Vercel App Router raw body HMAC pattern: https://vercel.com/docs/drains/security
- MCP Python SDK Streamable HTTP client: https://py.sdk.modelcontextprotocol.io/client/
