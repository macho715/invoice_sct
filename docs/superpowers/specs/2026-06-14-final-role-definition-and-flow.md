# Final Role Definition & Flow — SCT Invoice Audit Platform

**Date:** 2026-06-14
**Status:** Final (supersedes earlier architecture sketches)
**Scope:** 3-layer separation of concerns for HVDC invoice audit pipeline

---

## 1. Final Role Definition

| Layer | Role | Must NOT do |
|---|---|---|
| **NoteLM** | Verification field extraction agent. Reads Markdown source and extracts JSON candidate values for invoice validation. | Must NOT make the final audit verdict. |
| **Worker** | MarkItDown → NotebookLM → JSON normalization → Vercel callback orchestrator. | Must NOT perform final amount or contract validation. |
| **Vercel** | Receive gate, existing parser adapter, final audit engine, Excel/JSON result generation. | Must NOT directly automate Chrome or NotebookLM. |

### Mapping to project code

| Spec name | Code location | Responsibility |
|---|---|---|
| **NoteLM** | `notebooklm-mcp-pr53-pr55` (patched) + `apps/mcp-server` (Hono) | Field extraction via NotebookLM Studio chat + MCP protocol |
| **Worker** | `apps/worker-py` (FastAPI) | Job orchestrator: MarkItDown MCP → NoteLM → normalize → Vercel callback |
| **Vercel** | `apps/web` (Next.js) | Audit job lifecycle, parser adapter, final audit engine, 13-sheet workbook output |

### Role boundary invariants

- **NoteLM boundary:** Returns only verification field candidates (JSON schema = `VerificationField[]`). The actual "is this invoice valid?" decision is NOT made here.
- **Worker boundary:** Treats NoteLM output as untrusted input — normalizes, type-checks, and forwards. Does NOT do business rule validation.
- **Vercel boundary:** Owns the canonical "is this audit PASS/AMBER/FAIL?" decision. Treats worker callback as untrusted — re-validates against existing parser adapter before final verdict.

---

## 2. Final Flow

```
User PDF upload
  ↓
Vercel creates audit_job
  ↓
Worker pulls job
  ↓
MarkItDown MCP converts PDF to Markdown
  ↓
Worker sends Markdown to NoteLM / NotebookLM
  ↓
NoteLM extracts verification fields only
  ↓
Worker normalizes NoteLM output
  ↓
Vercel callback
  ↓
Existing parser adapter compares extracted fields
  ↓
Final audit engine produces PASS / WARN / FAIL
  ↓
Excel / JSON / audit trace output
```

### Stage details

1. **User PDF upload** — User drops PDF on the web app (Vercel/Next.js)
2. **Vercel creates audit_job** — `audit_job` row in Postgres, status=pending, blob stored in Vercel Blob
3. **Worker pulls job** — Worker queries DB for pending jobs (poll or webhook)
4. **MarkItDown MCP** — converts PDF to Markdown via `markitdown` MCP server (`apps/mcp-server` or external)
5. **Worker → NoteLM** — sends Markdown text to `ask_question` tool on the patched NotebookLM MCP
6. **NoteLM extracts fields** — NotebookLM Studio chat extracts structured JSON (invoice_no, waybill_no, amount, currency, etc.)
7. **Worker normalizes** — type coercion, schema validation, deduplication
8. **Vercel callback** — Worker POSTs normalized JSON to Vercel's audit callback endpoint
9. **Parser adapter** — Vercel uses existing `packages/tools` parser adapter to compare extracted fields vs. PO/contract
10. **Final audit engine** — produces PASS/AMBER/FAIL based on parser adapter output
11. **Output** — Excel (13-sheet workbook) / JSON / audit trace

### Security & trust model

- PDF content is PII (B2B invoices with amounts, supplier info). Treat all data as confidential.
- NoteLM output is UNTRUSTED — NotebookLM is a black-box LLM, may hallucinate or mis-parse.
- The 3-way reconciliation (Final Subtotal = Line_Audit = TYPE-B ±0.01) lives in Vercel's parser adapter, NOT in Worker or NoteLM.

---

## 3. Implications for in-flight work

This spec supersedes any earlier architecture sketches. In particular:

- **The `notebooklm-mcp-pr53-pr55` fork** is the **NoteLM** layer. It must NOT add validation logic beyond field extraction.
- **`apps/worker-py`** is the **Worker** layer. It must NOT add final audit logic.
- **`apps/web` (Vercel)** is the **Vercel** layer. The final audit engine lives here.

The recent `waitForStableAnswer` BUGFIX (commits `2f6ccdcb`, `fc8cfca`, `b942557`) is consistent with this spec — it fixes field-extraction reliability, not validation logic.
