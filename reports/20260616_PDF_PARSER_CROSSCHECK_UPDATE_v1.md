# PDF Parser Crosscheck Update v1

- Date: 2026-06-16
- Scope: PDF parser docs, worker/web code, tests, and Google Vision operational notes
- Purpose: record the evidence used to update `20260616_PDF_PARSER_INVENTORY_v1.md` and `20260616_PDF_PARSER_UPGRADE_PLAN_v1.md`, including the post-implementation Track ① status.

## Verdict

DONE for Track ① documentation crosscheck.

The document and code crosscheck is complete for local repository evidence and Track ① generic PDF line extraction. Production deployment state and Track ② Vision OCR operations were not changed in this update.

## Crosschecked Sources

| Area | Source | Finding | Update |
|---|---|---|---|
| Worker parse route | `apps/worker-py/app/routes/parse.py` | `/v1/parse` dispatches PDF to `parse_pdf_text_bytes()`, then DSV SHPT extraction via `extract_dsv_from_text()`. If DSV lines are empty, it calls `extract_generic_invoice_lines()`. | Inventory confirms DSV-first behavior and Track ① generic fallback completion. |
| Worker Vision routes | `apps/worker-py/app/routes/vision.py` | Actual routes are `/v1/preflight`, `/v1/vision/start`, `/v1/vision/collect`. | Inventory route table corrected. |
| PDF text parser | `apps/worker-py/app/parsers/pdf_text.py` | Produces text spans, table candidates, evidence candidates, confidence, scanned/encrypted/large issues, and generic non-DSV `InvoiceLine` candidates via `extract_generic_invoice_lines()`. | Upgrade plan marks Track ① complete. |
| DSV hybrid parser | `apps/worker-py/app/parsers/dsv_pdf_hybrid.py` | DSV SHPT can already produce charge lines and TYPE_B-like classification from text/tables. | Upgrade plan preserves DSV-first behavior. |
| Web run route | `apps/web/src/app/api/invoice-audit/run/route.ts` | `NO_INVOICE_LINES_EXTRACTED` AMBER guard remains the correct fallback for zero-line PDF parses. Vision is gated by `VISION_FALLBACK_ENABLED` and `gs://` input. | Upgrade plan keeps AMBER guard and adds Vision conditions. |
| Parser client | `apps/web/src/lib/parser-client.ts` | Vision trigger calls `/v1/vision/start` and returns `STARTED` / `VISION_DISABLED` style status. | Upgrade plan uses route-level success criteria. |
| GCP Vision worklog | `docs/20260615_google_vision_gcp_auth_worklog.md` | Buckets `dsv-invoice-source`, `dsv-invoice-ocr` and route-level Vision smoke have PASS records. | Inventory adds GCP/Vision verification status. |
| Vision logic guide | `docs/20260615_google_vision_pdf_parser_logic_guide.md` | Preserve page, confidence, word order, GCS URI, OCR JSON URI; do not log raw OCR text. | Upgrade plan adds trace and privacy requirements. |
| NotebookLM design | `docs/pdf.md` | NoteLM/NotebookLM is first-pass extraction only; final verdict remains audit engine. | Upgrade plan keeps NotebookLM/MarkItDown as dual extraction support only. |
| v2.1 PDF procedure | `dsv docs/pdf_parse_patch_v2_1_bundle/20260615_pdf_parse_procedure_v2_1_PATCHED.md` | Pipeline uses native text, OCR fallback, table extraction, doc classification, line extraction, TYPE_B, evidence, AMBER/ZERO gate. | Upgrade plan reuses this as behavior guidance without changing final verdict authority. |

## Corrected Facts

| Previous / ambiguous statement | Corrected statement |
|---|---|
| `/v1/vision/preflight` | Actual preflight route is `/v1/preflight`. |
| Google Vision is simply enabled by code presence | Vision requires worker `VISION_ENABLED=true`, `GOOGLE_CLOUD_PROJECT`, web `VISION_FALLBACK_ENABLED=true`, `GCS_OCR_BUCKET`, and `gs://` PDF input. |
| General PDF parser extracts invoice lines | Track ① is implemented: table candidates are mapped first, then text-line amount fallback creates generic non-DSV `InvoiceLine` rows when DSV extraction returns 0 lines. |
| Vision API start means OCR flow is done | Completion requires `STARTED -> COLLECTED -> normalized evidence/source_data -> workbook trace`. |
| NotebookLM/MarkItDown can decide final audit result | They are auxiliary extraction / comparison tools only; web audit engine owns final PASS/AMBER/ZERO. |

## Implementation Boundaries

- Do not change the 13-sheet workbook contract.
- Do not change PASS/AMBER/ZERO verdict authority.
- Do not dump raw Vision OCR JSON or raw OCR text into workbook sheets.
- Do not suppress parser errors to force PASS.
- Do not change DSV SHPT behavior while adding generic PDF fallback. Track ① verification recorded DSV regression as unchanged.
- Do not make Vision fallback run for non-`gs://` PDFs.

## Validation Evidence Recorded After Track ① Implementation

| Command | Expected result |
|---|---|
| `rg -n "vision/preflight\|/v1/preflight\|VISION_ENABLED\|GCS_OCR_BUCKET\|NO_INVOICE_LINES_EXTRACTED\|invoice_lines\|SCANNED_PAGE_DETECTED" docs reports apps` | Route names and env conditions are visible; no stale `/v1/vision/preflight` claim remains in active reports except as a corrected former error. |
| `cd apps/worker-py && python -m pytest tests/test_pdf_text_parser.py tests/test_dsv_pdf_hybrid.py tests/test_vision_client.py tests/test_vision_route.py tests/test_vision_normalizer.py tests/test_v_vision_rules.py -q` | Focused worker PDF/Vision tests pass. |
| `pnpm --dir apps/web test -- --run tests/api-invoice-audit-run.test.ts tests/api-invoice-audit-run-pdf-dsv.test.ts tests/api-audit-export.test.ts` | Focused web run/export tests pass. |
| Secret/raw-text scan over updated reports | No private key block, secret assignment, raw OCR payload, TRN, phone, or email-like value is introduced. Secret names alone are acceptable documentation. |

## Track ① Completion Evidence

| Check | Result |
|---|---|
| Worker tests | 209/209 pass, including 28 PDF parser related tests. |
| Web typecheck | 0 errors. |
| Web tests | 327/327 pass across 42 files. |
| DSV regression | Existing extraction result unchanged. |
| Changed worker files | `apps/worker-py/app/parsers/pdf_text.py`, `apps/worker-py/app/routes/parse.py`, `apps/worker-py/tests/test_pdf_text_parser.py`. |
| Behavior | Non-DSV text PDF can now produce `invoice_lines` through table-first extraction, then text-line amount fallback. Zero-line AMBER remains as the final safety guard. |

## Updated Documents

- `reports/20260616_PDF_PARSER_INVENTORY_v1.md`
- `reports/20260616_PDF_PARSER_UPGRADE_PLAN_v1.md`
- `reports/20260616_PDF_PARSER_CROSSCHECK_UPDATE_v1.md`
