# Invoice Audit Platform

The Invoice Audit Platform is a sub-system for auditing invoices using SCT rules, CostGuard, and Document Guardian validations.

## apps/web (Next.js frontend & Orchestrator)
- **Framework**: Next.js 15 (App Router), React 19.
- **Key Routes**:
  - `/api/files/ingest`: Ingestion endpoint for XLSX spreadsheets and PDF/TXT/MD files.
  - `/api/invoice-audit/run`: Main orchestrator endpoint that calls python-worker and CF remote MCP tools.
  - `/api/audit/result`: Retrieve results (verdict, costguard bands, etc.).
  - `/api/audit/trace`: Trace audit lifecycle steps.
  - `/api/export/download`: Download generated xlsx workbooks.
- **State Store**: In-memory job store (`lib/job-store.ts`).
- **Tests**: Vitest (19 test files, 70 tests).

## apps/worker-py (Python FastAPI parsing & exporting)
- **Framework**: FastAPI (Uvicorn).
- **Core modules**:
  - `app/parsers/`: Extraction engines for XLSX and PDF files (`pdf_text.py` using pdfplumber).
  - `app/exporters/`: Excel workbook exporter (`xlsx.py` generating 8-sheet output including `03_Type_B_Summary`).
- **Tests**: Pytest (36 test cases).
