# invoice-audit-parser (worker-py)

FastAPI worker for invoice/evidence parsing (xlsx, md, txt, **pdf** from P3A).

## Endpoints
- `POST /parse` — accepts ParseRequest (file_type: xlsx|md|txt|**pdf**|**pdf_json**)
- `POST /v1/export` — 13-sheet Final Audit Workbook (see exporters)
- `GET /health/ready` — readiness check (db, blob_storage, parsers, memory)

## P3A (2026-06-09)
- New `pdf_text` parser using `pdfplumber>=0.11` (text spans, table candidates, custom confidence, evidence extraction).
- `file_type='pdf'` now supported (no longer 422).
- Returns standard ParseResponse (normalized with evidence_candidates + parser_confidence); detailed `PdfParseResponse` (spans, tables, issues, is_text_based, page_count) available for orchestrator (P3B+).
- Low-confidence / scanned pages surface `SCANNED_PAGE_DETECTED` + force AMBER in later stages (P3C).
- Fixtures: `tests/fixtures/text-pdf-00[1-5].pdf` (generated text-based invoice samples; one low-text for AMBER path).

## DSV Waybill Parser (2026-06-13)
- New `dsv_waybill` parser ported from Track 1 `pdf_processor_v1_2_dsv_patched.py` (v1.4.1).
- Extracts: waybill_no, trip_no, order_no, job_no, po_no, do_no, bol_no, lane (origin/destination with UAE HVDC normalization), timeline, driver/truck details.
- `pdf_text.py` auto-detects DSV Waybill text and enriches `EvidenceCandidate` with DSV fields.
- Fixtures: `tests/fixtures/dsv-waybill-001.txt` (28 tests).

## pdf_json Parser (2026-06-13)
- New `pdf_json` parser for OpenDataLoader JSON output.
- `file_type='pdf_json'` now supported in `POST /parse`.
- Returns standard ParseResponse with normalized lines, evidence candidates, and parser confidence.

## Health Endpoint (2026-06-13)
- `GET /health/ready` — parallel checks: db, blob_storage, parsers, memory.
- `GET /health/live` — liveness probe.
- `GET /health` — combined status.

## Run (dev)
```bash
python -m pip install -e ".[dev]" pdfplumber
python -m uvicorn app.main:app --port 8000
pytest -q
```

## Versioning
parser_version e.g. `parser-0.2.0-pdf-0.1.0`

See plan `2026-06-09-invoice-audit-phase3-plan.md` (P3A) and SPEC §14.
