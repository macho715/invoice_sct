# apps/ — Invoice Audit Platform (Phase 1 MVP)

Hybrid 3-tier: `web/` (Vercel Next.js) + `worker-py/` (Python FastAPI) + `mcp-server/` (TypeScript MCP).

**Status (2026-06-13)**: 14 MCP tools, 6 parsers (xlsx/pdf_text/pdf_json/md/txt/dsv_waybill), 368 total tests. Cross-validated against Track 1 shpiment v3.2 PRO.

See `SCT_ONTOLOGY_Invoice_Audit_Platform_SPEC_v0.2.0.md` for the full spec.

## Run dev

```bash
# terminal 1
cd apps/worker-py
python -m venv .venv && . .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000

# terminal 2
cd apps/web
cp .env.example .env.local
# fill BLOB_READ_WRITE_TOKEN from Vercel dashboard
npm install
npm run dev
```

## MCP server (2026-06-13)

```bash
cd apps/mcp-server
npm install
npm run typecheck
npm test          # 186 tests, 14 tools
```

## Run tests

```bash
cd apps/web && pnpm test -- --run     # 107 tests
cd apps/worker-py && pytest -q        # 95 tests
cd apps/mcp-server && npm test        # 186 tests
```
