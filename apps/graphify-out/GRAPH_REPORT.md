# Graph Report - apps  (2026-06-16)

## Corpus Check
- 236 files · ~97,626 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1506 nodes · 2558 edges · 140 communities (111 shown, 29 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 230 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5fe8190d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Worker App Entry & Audit Log|Worker App Entry & Audit Log]]
- [[_COMMUNITY_Worker Pydantic Row Schemas|Worker Pydantic Row Schemas]]
- [[_COMMUNITY_DSV Waybill Parser|DSV Waybill Parser]]
- [[_COMMUNITY_DSV PDF Hybrid Parser|DSV PDF Hybrid Parser]]
- [[_COMMUNITY_Vision OCR Rules|Vision OCR Rules]]
- [[_COMMUNITY_Web Zod Type Schemas|Web Zod Type Schemas]]
- [[_COMMUNITY_Worker DB Pool|Worker DB Pool]]
- [[_COMMUNITY_NotebookLM Callback & Adapter|NotebookLM Callback & Adapter]]
- [[_COMMUNITY_Web Package Dependencies|Web Package Dependencies]]
- [[_COMMUNITY_DLP Guard (mcp-server)|DLP Guard (mcp-server)]]
- [[_COMMUNITY_NotebookLM Answer Extraction|NotebookLM Answer Extraction]]
- [[_COMMUNITY_Platform Architecture Concepts|Platform Architecture Concepts]]
- [[_COMMUNITY_MCP Server Dependencies|MCP Server Dependencies]]
- [[_COMMUNITY_XLSX Workbook Export|XLSX Workbook Export]]
- [[_COMMUNITY_Approval Gate (web)|Approval Gate (web)]]
- [[_COMMUNITY_Worker Telemetry|Worker Telemetry]]
- [[_COMMUNITY_Audit Log Middleware|Audit Log Middleware]]
- [[_COMMUNITY_NotebookLM Orchestrator (SSRF guard)|NotebookLM Orchestrator (SSRF guard)]]
- [[_COMMUNITY_File Confirm Route|File Confirm Route]]
- [[_COMMUNITY_GCS Signed Upload|GCS Signed Upload]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_XLSX Header Detection|XLSX Header Detection]]
- [[_COMMUNITY_Upload Form UI|Upload Form UI]]
- [[_COMMUNITY_Vision Client Tests|Vision Client Tests]]
- [[_COMMUNITY_Human Gate & Roles|Human Gate & Roles]]
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
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 107|Community 107]]

## God Nodes (most connected - your core abstractions)
1. `NotebookLmOrchestrator` - 34 edges
2. `httpForError()` - 30 edges
3. `VisionClient` - 30 edges
4. `STORE` - 29 edges
5. `TestClient` - 27 edges
6. `NotebookLmMcpClient` - 23 edges
7. `parse_pdf_text_bytes()` - 19 edges
8. `build_xlsx()` - 17 edges
9. `create_app()` - 17 edges
10. `parse_xlsx_bytes()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `orchestrator()` --calls--> `NotebookLmOrchestrator`  [INFERRED]
  worker-py/tests/test_notebooklm_orchestrator.py → worker-py/app/notebooklm/orchestrator.py
- `PreflightRequest` --uses--> `VisionClient`  [INFERRED]
  worker-py/app/routes/vision.py → worker-py/app/services/vision_client.py
- `PreflightResponse` --uses--> `VisionClient`  [INFERRED]
  worker-py/app/routes/vision.py → worker-py/app/services/vision_client.py
- `VisionStartRequest` --uses--> `VisionClient`  [INFERRED]
  worker-py/app/routes/vision.py → worker-py/app/services/vision_client.py
- `VisionStartResponse` --uses--> `VisionClient`  [INFERRED]
  worker-py/app/routes/vision.py → worker-py/app/services/vision_client.py

## Import Cycles
- 1-file cycle: `worker-py/app/main.py -> worker-py/app/main.py`
- 1-file cycle: `worker-py/tests/test_audit_log.py -> worker-py/tests/test_audit_log.py`

## Communities (140 total, 29 thin omitted)

### Community 0 - "Worker App Entry & Audit Log"
Cohesion: 0.05
Nodes (47): InMemoryRateReferenceProvider, InMemoryRateRow, PostgresRateReferenceProvider, RateCardRow, ExecutedRate, ExecutedRateSchema, RateLookupInput, RateLookupInputSchema (+39 more)

### Community 1 - "Worker Pydantic Row Schemas"
Cohesion: 0.12
Nodes (30): ActionItemRow, AuditDetailRow, DecisionRow, DuplicateCheckRow, EvidenceCandidate, EvidenceIssuesRow, ExportRequest, ExportResponse (+22 more)

### Community 2 - "DSV Waybill Parser"
Cohesion: 0.05
Nodes (51): create_app(), FastAPI application entry point., TestClient, _build_app(), Tests for app.middleware.audit_log (FR-025 compliance).  Coverage: 1. Parse even, Even if the pool itself throws on getconn(), the request must pass., Build a minimal FastAPI app wired with the audit middleware and a few     fake r, Reset module-level DB pool state between tests and inject a     thread-safe fake (+43 more)

### Community 3 - "DSV PDF Hybrid Parser"
Cohesion: 0.06
Nodes (32): dict, _clean_origin_field(), _clean_ws_text(), _compact_identifier_text(), DsvWaybillResult, extract_consignment_from_pdfplumber(), extract_dsv_from_pdf_bytes(), _extract_lane_from_full_text() (+24 more)

### Community 4 - "Vision OCR Rules"
Cohesion: 0.07
Nodes (38): append_line(), classify_doc(), clean_desc(), dedupe_line_items(), dedupe_preserve(), DocRule, evidence_status_for_doc(), extract_awb() (+30 more)

### Community 5 - "Web Zod Type Schemas"
Cohesion: 0.05
Nodes (50): BLOB_ACCESS_VALUES, BlobAccess, BlobUploadResult, DEV_LOCAL_BLOB_DIR, encodeBlobPath(), getSignedDownloadUrl(), isDevStubToken(), resolveBlobAccess() (+42 more)

### Community 6 - "Worker DB Pool"
Cohesion: 0.10
Nodes (44): append_line(), build_evidence_candidates(), classify_doc(), clean_desc(), dedupe_line_items(), dedupe_preserve(), DocRule, DsvVisionParseResult (+36 more)

### Community 7 - "NotebookLM Callback & Adapter"
Cohesion: 0.05
Nodes (40): ActionItemRow, ActionItemRowSchema, ApprovalRecordSchema, AuditDetailRowSchema, AuditTraceEntrySchema, AuditTraceStepSchema, DecisionRow, DecisionRowSchema (+32 more)

### Community 8 - "Web Package Dependencies"
Cohesion: 0.07
Nodes (30): _build_pool(), get_pool(), is_available(), _NullConn, _NullPool, Database connection pool helper for the worker-py service.  FR-025 audit middlew, Build a ThreadedConnectionPool. Returns None on any failure (fail-soft)., Return the process-wide connection pool, creating it on first use.      Returns (+22 more)

### Community 9 - "DLP Guard (mcp-server)"
Cohesion: 0.09
Nodes (28): badRequest(), POST(), verifyCallbackSignature(), adaptNotebookLmToParserResult(), compareParserAndNotebookLm(), extractComparableValues(), ExtractionMismatch, findNotebookLmGateIssues() (+20 more)

### Community 10 - "NotebookLM Answer Extraction"
Cohesion: 0.06
Nodes (35): dependencies, @invoice-audit/contracts, @invoice-audit/database, @invoice-audit/telemetry, @invoice-audit/tools, next, @opentelemetry/api, pg (+27 more)

### Community 11 - "Platform Architecture Concepts"
Cohesion: 0.09
Nodes (26): DLP_PATTERNS, DlpGuardInput, DlpGuardInputSchema, DlpGuardResult, DlpGuardResultSchema, DlpViolation, DlpViolationSchema, guardDlp() (+18 more)

### Community 12 - "MCP Server Dependencies"
Cohesion: 0.12
Nodes (13): _build_stub(), extract_json(), _first_balanced_json_object(), parse_extraction(), NotebookLM answer extraction utilities.  Tolerates common NotebookLM artifacts (, Try to extract a JSON object from a raw answer string.      Strips NotebookLM ma, Parse a NotebookLM answer into the canonical extraction shape.      Strips marke, Remove NotebookLM-specific artifacts from raw answer text.      Strips ``[AI-GEN (+5 more)

### Community 13 - "XLSX Workbook Export"
Cohesion: 0.08
Nodes (25): dependencies, hono, @hono/node-server, @invoice-audit/database, @invoice-audit/tools, @opentelemetry/api, pg, zod (+17 more)

### Community 14 - "Approval Gate (web)"
Cohesion: 0.14
Nodes (22): build_xlsx(), _literal_text(), ExportResponse, export_xlsx(), _make_minimal_export(), Tests for 13-Sheet Track 2 Workbook Contract., test_internal_manifest_hash_is_distinct_from_api_final_bytes_hash(), test_manifest_sheet_contains_pre_manifest_sha256() (+14 more)

### Community 15 - "Worker Telemetry"
Cohesion: 0.13
Nodes (17): async_span(), current_trace_id(), get_tracer(), init_telemetry(), _NoOpSpan, _NoOpTracer, OpenTelemetry helpers for worker-py FastAPI service.  All public functions are n, Return current trace ID for log correlation. Never contains P2 data. (+9 more)

### Community 16 - "Audit Log Middleware"
Cohesion: 0.14
Nodes (17): BaseHTTPMiddleware, AuditLogMiddleware, _classify_event(), _insert_approval(), _insert_audit_trace(), _parse_json(), Audit log middleware (FR-025 compliance).  The system MUST treat approval state,, Persist an ``audit_traces`` row for every non-noise request.      Special paths (+9 more)

### Community 17 - "NotebookLM Orchestrator (SSRF guard)"
Cohesion: 0.18
Nodes (16): err(), GET(), err(), POST(), ApprovalGateResult, evaluateApprovalGate(), ExportType, getRequiredApproverRole() (+8 more)

### Community 19 - "GCS Signed Upload"
Cohesion: 0.21
Nodes (12): callJobStoreTool(), createJobStore(), getJobStoreMcpUrl(), getStore(), isMockFetch(), isVercelRuntime(), McpResponse, createPgJobStore() (+4 more)

### Community 20 - "TypeScript Config"
Cohesion: 0.18
Nodes (15): err(), handleCreateUploadUrl(), POST(), createGcsSignedUploadUrl(), encodePathPart(), GcsSignedUpload, GcsUploadTarget, isGcsUploadEnabled() (+7 more)

### Community 21 - "XLSX Header Detection"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 22 - "Upload Form UI"
Cohesion: 0.22
Nodes (18): normalize_line_id(), _amount_column_for_row(), _cell_num(), _cell_str(), _clean_header(), _currency_from_amount_header(), _detect_header_fields(), _detect_headers() (+10 more)

### Community 23 - "Vision Client Tests"
Cohesion: 0.18
Nodes (17): PdfTableCandidate, PdfTextSpan, _bbox_from_chars(), _compute_page_conf(), parse_pdf_text_bytes(), P3A PDF text parser using pdfplumber (plan §4).  Extracts text spans + table c, Per plan §4.4: min(1.0, char_count / 500). Falls back to text len., _load() (+9 more)

### Community 24 - "Human Gate & Roles"
Cohesion: 0.15
Nodes (10): formatKb(), sha256Hex(), uploadFile(), UploadForm(), ACCEPTED_FILE_KINDS, getUploadFileKind(), getUploadSelectionError(), hasInvoiceFile() (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (13): ALLOWED_EXT, ALLOWED_MIME, err(), ingestFile(), logIngestFailure(), POST(), err(), GET() (+5 more)

### Community 26 - "Community 26"
Cohesion: 0.21
Nodes (14): err(), handleConfirm(), POST(), err(), GET(), ErrorCode, ErrorCodes, HTTP_BY_CODE (+6 more)

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (13): AsyncAnnotateFileRequest, _connected_client(), _FakeStorageClient, _FakeVisionModule, GcsSource, InputConfig, OutputConfig, test_collect_result_downloads_output_json_and_averages_confidence() (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.20
Nodes (16): DsvPdfResult, ParseRequest, ParseResponse, DsvPdfResult, extract_shpt_shipment_doc_mapping(), Ported SHPT supporting doc mapping for source_data (addresses 누락된 SHPT doc extra, _dsv_lines_to_invoice_lines(), _fetch_blob() (+8 more)

### Community 29 - "Community 29"
Cohesion: 0.25
Nodes (14): EvidenceCandidate, _compute_page_confidence(), _extract_evidence(), parse_pdf_json_bytes(), _make_json_bytes(), test_confidence_from_span_averages(), test_empty_pages_array(), test_evidence_extraction_bl_do_patterns() (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (8): Exception, If MarkItDown fails, no callback is sent., If add_source fails, no callback is sent., If NotebookLM returns success:false, do not treat the response as a source id., If ask_question fails, no callback is sent., If JSON parsing fails after retry, send low-confidence AMBER callback., If Vercel rejects the callback, surface that status instead of false success., TestOrchestratorFailures

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (7): JobStore, getPool(), mapTraceRow(), parseJsonField(), PgPool, verifyPgConnection(), SourceDataRow

### Community 32 - "Community 32"
Cohesion: 0.13
Nodes (14): compilerOptions, declaration, esModuleInterop, isolatedModules, module, moduleResolution, outDir, resolveJsonModule (+6 more)

### Community 33 - "Community 33"
Cohesion: 0.19
Nodes (7): _parse_gcs_uri(), Poll async operation status., Collect OCR results from GCS output., Google Vision async document text detection client., Start async PDF text detection. Returns operation metadata., VisionClient, Any

### Community 34 - "Community 34"
Cohesion: 0.21
Nodes (12): assertDlpClean(), DlpScanResult, DlpViolation, DlpViolationType, getLineNumber(), maskSnippet(), PatternEntry, PATTERNS (+4 more)

### Community 36 - "Community 36"
Cohesion: 0.33
Nodes (12): parse_xlsx_bytes(), _make_xlsx(), test_extracts_header_fields(), test_extracts_header_fields_alt_labels(), test_header_fields_none_when_missing(), test_parses_basic_invoice_lines(), test_parses_line_view_when_decision_sheet_is_first(), test_parses_shpiment_v32_line_view_total_usd_contract() (+4 more)

### Community 37 - "Community 37"
Cohesion: 0.23
Nodes (11): normalize_vision_output(), Vision OCR JSON → EvidenceCandidate normalizer., Normalized output from Vision OCR text., Convert Vision OCR JSON output to structured evidence and invoice fields., VisionNormalizedResult, test_averages_word_confidence(), test_empty_ocr_output_reports_low_confidence_and_scanned_issue(), test_extracts_invoice_number_and_total() (+3 more)

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (10): applyRateLimit(), config, constantTimeEqualEdge(), isPublicUiApiRoute(), middleware(), PUBLIC_UI_API_PREFIXES, PUBLIC_UI_API_ROUTES, RATE_LIMIT (+2 more)

### Community 39 - "Community 39"
Cohesion: 0.21
Nodes (12): makeSampleCostguardResults(), makeSampleJob(), makeSampleLines(), makeSampleResult(), mockGetApprovalRecord, mockGetJob, mockGetNormalizedInvoice, mockGetParseSourceData (+4 more)

### Community 40 - "Community 40"
Cohesion: 0.50
Nodes (3): checkAndConvertCurrency(), FxCheckResult, FxPolicy

### Community 41 - "Community 41"
Cohesion: 0.26
Nodes (9): allowedTransitions, assertCanTransition(), InvalidStateTransitionError, InvoiceJobStatus, InvoiceJobStatusSchema, isTerminalState(), LEGACY_TO_CANONICAL, LegacyJobStatus (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.26
Nodes (10): Path, _detect_hidden_sheet_names(), _diff_sets(), _format_summary(), main(), Return names of sheets whose state is not 'visible'., validate(), ensure_fpdf2() (+2 more)

### Community 43 - "Community 43"
Cohesion: 0.17
Nodes (14): ALLOWED_CONTENT_TYPES, POST(), REPLACEMENTS, withDeprecation(), ALLOWED_EXT, ALLOWED_MIME, err(), handleRegister() (+6 more)

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (7): err(), POST(), ALL_ROLES, isValidRole(), roleCanResolveTrigger(), UserRole, HumanGateTrigger

### Community 45 - "Community 45"
Cohesion: 0.18
Nodes (5): AUTH_HEADER, _E2EPageRef, TERMINAL_STATUSES, Verdict, VERDICTS

### Community 46 - "Community 46"
Cohesion: 0.24
Nodes (7): ALLOWED_MIME_TYPES, badRequest(), isLargeUploadRequest(), LargeUploadRequest, PENDING_SHA256_PLACEHOLDER, POST(), { handleUploadMock }

### Community 47 - "Community 47"
Cohesion: 0.27
Nodes (4): _bool_env(), _float_env(), McpToolError, MCP client wrappers for MarkItDown and NotebookLM streamable HTTP servers.

### Community 48 - "Community 48"
Cohesion: 0.27
Nodes (6): _fetch_id_token(), McpClientUnavailable, Mint a Google-signed ID token for `audience` (a Cloud Run service URL).      U, Authorization header for IAM-protected Cloud Run MCP services.          Empty, StreamableMcpClient, Any

### Community 49 - "Community 49"
Cohesion: 0.18
Nodes (9): PreflightRequest, PreflightResponse, preflight(), Vision preflight + async OCR routes.  Endpoints:   POST /v1/preflight       —, Poll and collect Vision OCR results from GCS output prefix.      Returns ``VIS, Decide whether a PDF needs Vision OCR, MarkItDown, or text-parser routing., vision_collect(), VisionCollectRequest (+1 more)

### Community 50 - "Community 50"
Cohesion: 0.20
Nodes (7): ApprovalFormSchema, ApprovalFormValues, ApprovalModalProps, ApprovalVerdict, ApproverRole, formatAed(), requiredRoleForAmber()

### Community 51 - "Community 51"
Cohesion: 0.29
Nodes (9): _extract_enum_values(), _extract_top_level_properties(), _extract_zod_object_body(), _json_schema_enum(), Worker output must remain parseable by the TS web/contracts schema., test_worker_invoice_line_enums_match_ts_contract(), test_worker_invoice_line_fields_are_accepted_by_ts_contract(), test_worker_invoice_line_required_fields_stay_required_in_ts_contract() (+1 more)

### Community 52 - "Community 52"
Cohesion: 0.29
Nodes (8): test_amber_when_exceeds_tolerance(), test_does_not_mutate_unrelated_lines(), test_passes_when_qty_rate_eq_amount(), test_passes_within_tolerance_0_01(), test_skips_when_qty_or_rate_missing(), FR-020a: |qty * rate - line_amount| <= 0.01 → PASS; otherwise AMBER with numeric, validate_numeric_integrity(), InvoiceLine

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (7): evaluateHumanGateTriggers(), GateResultLite, Job, JobStatus, SctValidationResult, Verdict, WorkflowType

### Community 54 - "Community 54"
Cohesion: 0.31
Nodes (7): NotebookLmCallbackPayload, NotebookLmRunRequest, NotebookLmRunResponse, NotebookLmRunRequest, NotebookLmRunResponse, POST /v1/notebooklm/run — orchestrate MarkItDown + NotebookLM extraction., run_notebooklm()

### Community 55 - "Community 55"
Cohesion: 0.22
Nodes (8): DSV Waybill Parser (2026-06-13), Endpoints, Health Endpoint (2026-06-13), invoice-audit-parser (worker-py), P3A (2026-06-09), pdf_json Parser (2026-06-13), Run (dev), Versioning

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (6): InvoiceHeader, parse_md_bytes(), Markdown evidence parser. Returns NormalizedInvoice with invoice_lines=[] and ev, test_extracts_evidence_candidate_with_reference(), test_low_confidence_when_no_reference_found(), NormalizedInvoice

### Community 57 - "Community 57"
Cohesion: 0.24
Nodes (9): ALLOWED_EXT, ALLOWED_MIME, err(), findDuplicateByHash(), normalizeAndValidateBlobUrl(), POST(), verifyBlobBytes(), BYTES (+1 more)

### Community 58 - "Community 58"
Cohesion: 0.29
Nodes (3): ExportResponse, fetchStatus(), JobPage()

### Community 62 - "Community 62"
Cohesion: 0.38
Nodes (3): Extract text from common MCP CallToolResult shapes., _result_to_text(), TestResultToText

### Community 63 - "Community 63"
Cohesion: 0.33
Nodes (5): parse_txt_bytes(), Plain-text evidence parser., test_empty_txt_returns_empty_evidence(), test_extracts_evidence_candidate_with_bl_ref(), NormalizedInvoice

### Community 64 - "Community 64"
Cohesion: 0.33
Nodes (4): main(), Live smoke for the deployed markitdown-mcp Cloud Run service.  Uses the worker, MarkItDown transport with a pre-minted Bearer token (no ADC needed)., TokenInjectedClient

### Community 66 - "Community 66"
Cohesion: 0.60
Nodes (3): GET(), POST(), FxPolicySchema

### Community 67 - "Community 67"
Cohesion: 0.40
Nodes (4): Cloud Run requirements (see runbook §3), Deploy, Local run, markitdown-mcp (Cloud Run)

### Community 68 - "Community 68"
Cohesion: 0.40
Nodes (4): apps/ — Invoice Audit Platform (Phase 1 MVP), MCP server (2026-06-13), Run dev, Run tests

### Community 69 - "Community 69"
Cohesion: 0.60
Nodes (4): main(), _missing_env(), Run a live NotebookLM/MarkItDown worker smoke test.  This helper requires real M, _run()

### Community 70 - "Community 70"
Cohesion: 0.50
Nodes (3): _bool_env(), _int_env(), Google Vision API client for async PDF/TIFF OCR on Google Cloud Storage.

### Community 71 - "Community 71"
Cohesion: 0.40
Nodes (3): orchestrator(), Happy path: parse succeeds, callback is HMAC-signed., TestOrchestratorHappyPath

### Community 73 - "Community 73"
Cohesion: 0.70
Nodes (4): _make_matrix_xlsx(), test_decomposes_dsv_matrix_into_charge_lines(), test_matrix_captures_invoice_total_usd(), test_matrix_skips_zero_and_empty_charge_cells()

### Community 74 - "Community 74"
Cohesion: 0.40
Nodes (4): buildCommand, framework, installCommand, $schema

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (3): isDevStub(), POST(), SAMPLE_COSTGUARD_LINES

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (3): DEV_BLOB_DIR, GET(), isDevStub()

### Community 78 - "Community 78"
Cohesion: 0.50
Nodes (4): Start async Google Vision document text detection.      When google-cloud-visi, vision_start(), VisionStartRequest, VisionStartResponse

### Community 79 - "Community 79"
Cohesion: 0.50
Nodes (3): INVOICE_NO_HASH, queryMock, VENDOR_HASH

### Community 83 - "Community 83"
Cohesion: 0.50
Nodes (3): { handleUploadMock }, ALLOWED_CONTENT_TYPES, POST()

## Knowledge Gaps
- **313 isolated node(s):** `deploy.sh script`, `deploy-cloudrun.sh script`, `name`, `version`, `private` (+308 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parse_pdf_text_bytes()` connect `Vision Client Tests` to `DSV Waybill Parser`, `DSV PDF Hybrid Parser`, `Vision OCR Rules`, `Community 28`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `NotebookLmOrchestrator` connect `File Confirm Route` to `Community 35`, `Community 69`, `Community 71`, `Community 47`, `Community 48`, `Community 54`, `Community 59`, `Community 30`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `test_dispatch_pdf_low_conf_or_issues_path()` connect `DSV Waybill Parser` to `Community 42`, `Vision Client Tests`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Are the 25 inferred relationships involving `NotebookLmOrchestrator` (e.g. with `MarkItDownMcpClient` and `McpClientUnavailable`) actually correct?**
  _`NotebookLmOrchestrator` has 25 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `VisionClient` (e.g. with `PreflightRequest` and `PreflightResponse`) actually correct?**
  _`VisionClient` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `deploy.sh script`, `deploy-cloudrun.sh script`, `name` to the rest of the system?**
  _426 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Worker App Entry & Audit Log` be split into smaller, more focused modules?**
  _Cohesion score 0.05365686944634313 - nodes in this community are weakly interconnected._