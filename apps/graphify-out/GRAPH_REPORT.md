# Graph Report - C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps  (2026-06-10)

## Corpus Check
- 82 files · ~19,144 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 215 nodes · 345 edges · 48 communities detected
- Extraction: 57% EXTRACTED · 43% INFERRED · 0% AMBIGUOUS · INFERRED: 147 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]

## God Nodes (most connected - your core abstractions)
1. `POST()` - 25 edges
2. `GET()` - 16 edges
3. `parse_pdf_text_bytes()` - 15 edges
4. `parse()` - 14 edges
5. `InvoiceLine` - 13 edges
6. `NormalizedInvoice` - 13 edges
7. `parse_xlsx_bytes()` - 13 edges
8. `InvoiceHeader` - 12 edges
9. `EvidenceCandidate` - 12 edges
10. `err()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `POST()` --calls--> `createParserClient()`  [INFERRED]
  C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\app\mcp\route.ts → C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\lib\parser-client.ts
- `POST()` --calls--> `createCfMcpClient()`  [INFERRED]
  C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\app\mcp\route.ts → C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\lib\cf-mcp-client.ts
- `test_dispatch_pdf_low_conf_or_issues_path()` --calls--> `parse_pdf_text_bytes()`  [INFERRED]
  C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\worker-py\tests\test_parse_dispatch.py → C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\worker-py\app\parsers\pdf_text.py
- `err()` --calls--> `httpForError()`  [INFERRED]
  C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\app\api\invoice-audit\run\route.ts → C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\lib\error-codes.ts
- `POST()` --calls--> `isValidRole()`  [INFERRED]
  C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\app\mcp\route.ts → C:\Users\SAMSUNG\Downloads\SCT_ONTOLOGY-main (1)\SCT_ONTOLOGY-main\apps\web\src\lib\roles.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.1
Nodes (13): isDevStubToken(), uploadToBlob(), httpForError(), isDevStub(), buildGateResult(), evaluateHumanGateTriggers(), isValidRole(), roleCanResolveTrigger() (+5 more)

### Community 1 - "Community 1"
Cohesion: 0.2
Nodes (20): BaseModel, export_xlsx(), ActionItemRow, AuditDetailRow, DecisionRow, EvidenceIssuesRow, ExportRequest, ExportResponse (+12 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (18): parse_md_bytes(), Markdown evidence parser. Returns NormalizedInvoice with invoice_lines=[] and ev, _fetch_blob(), parse(), POST /parse endpoint. Phase 1: in-memory blob fetch stub (replace with Vercel Bl, Phase 1 stub. In production, fetch from Vercel Blob signed URL using BLOB_READ_W, InvoiceHeader, NormalizedInvoice (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (19): _bbox_from_chars(), _compute_page_conf(), extract_shpt_shipment_doc_mapping(), parse_pdf_text_bytes(), P3A PDF text parser using pdfplumber (plan §4).  Extracts text spans + table can, Ported SHPT supporting doc mapping for source_data (addresses 누락된 SHPT doc extra, Per plan §4.4: min(1.0, char_count / 500). Falls back to text len., EvidenceCandidate (+11 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (13): create_app(), FastAPI application entry point., test_export_route_invalid_payload(), test_export_route_success(), test_health(), test_parse_unsupported_type_422(), test_parse_xlsx_via_http(), _xlsx_bytes() (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.28
Nodes (11): normalize_line_id(), test_normalize_line_id_deterministic(), _make_xlsx(), test_parses_basic_invoice_lines(), test_raises_when_no_usable_line(), test_skips_empty_rows_and_uses_normalized_line_id(), test_supports_header_aliases_case_insensitive(), _cell_num() (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.28
Nodes (10): FR-020a: |qty * rate - line_amount| <= 0.01 ??PASS; otherwise AMBER with numeric, validate_numeric_integrity(), InvoiceLine, test_amber_when_exceeds_tolerance(), test_does_not_mutate_unrelated_lines(), test_passes_when_qty_rate_eq_amount(), test_passes_within_tolerance_0_01(), test_skips_when_qty_or_rate_missing() (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.4
Nodes (1): Validators for normalized invoice data.

### Community 8 - "Community 8"
Cohesion: 0.5
Nodes (2): createCfMcpClient(), McpUnavailableError

### Community 9 - "Community 9"
Cohesion: 0.5
Nodes (2): createParserClient(), ParseFailedError

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (3): ensure_fpdf2(), main(), Generate 5 text-based invoice PDF fixtures for P3A (plan §4).  Run: python -m te

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (2): fetchStatus(), JobPage()

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (2): createJobStore(), getStore()

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (1): Create a small .xlsx fixture for E2E smoke.

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (1): E2E smoke for the Python worker: load xlsx -> parse -> numeric integrity -> JSON

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **5 isolated node(s):** `Create a small .xlsx fixture for E2E smoke.`, `E2E smoke for the Python worker: load xlsx -> parse -> numeric integrity -> JSON`, `FastAPI application entry point.`, `Generate 5 text-based invoice PDF fixtures for P3A (plan §4).  Run: python -m te`, `P3A: Route dispatch tests for file_type (plan §4: 3 its + coverage of pdf).  - x`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 13`** (2 nodes): `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (2 nodes): `page.tsx`, `Home()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (2 nodes): `page.tsx`, `handleSubmit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (2 nodes): `page.tsx`, `UploadPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `upload-form.tsx`, `onSubmit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `fx-check.ts`, `checkAndConvertCurrency()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `setupJob()`, `api-audit-status.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `makeRequest()`, `api-files-ingest.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `setupJob()`, `api-invoice-audit-run.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `make_fixture.py`, `Create a small .xlsx fixture for E2E smoke.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `smoke_parse.py`, `E2E smoke for the Python worker: load xlsx -> parse -> numeric integrity -> JSON`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (2 nodes): `health.py`, `health()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `next.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `api-audit-approve.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `api-audit-export.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `api-audit-result.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `api-audit-trace.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `api-export-download.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `api-fx-policy.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `blob.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `cf-mcp-client.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `error-codes.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `fx-check.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `gate-bridge.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `human-gate.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `job-store.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `parser-client.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `roles.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `types.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `conftest.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parse()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.227) - this node is a cross-community bridge._
- **Why does `POST()` connect `Community 0` to `Community 8`, `Community 9`, `Community 2`, `Community 4`?**
  _High betweenness centrality (0.217) - this node is a cross-community bridge._
- **Why does `GET()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `POST()` (e.g. with `GET()` and `isValidRole()`) actually correct?**
  _`POST()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `GET()` (e.g. with `POST()` and `isDevStub()`) actually correct?**
  _`GET()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `parse_pdf_text_bytes()` (e.g. with `PdfParseResponse` and `PdfTextSpan`) actually correct?**
  _`parse_pdf_text_bytes()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `parse()` (e.g. with `POST()` and `parse_xlsx_bytes()`) actually correct?**
  _`parse()` has 12 INFERRED edges - model-reasoned connections that need verification._