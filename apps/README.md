# apps/ — Invoice Audit Platform (Phase 1 MVP)

Hybrid 3-tier: `web/` (Vercel Next.js) + `worker-py/` (Python FastAPI).

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

## Run tests

```bash
cd apps/web && npm test
cd apps/worker-py && pytest
```
