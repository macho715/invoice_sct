# User Guide

## User Guide

This guide explains the current operational workflow for the HVDC ontology-grounded ChatGPT App.

## Quick Start

1. Install dependencies with `npm ci`.
2. Rebuild generated Worker assets with `npm run generate:worker-assets`.
3. Run local Worker development with `npm run dev`.
4. Run the release gate with `npm run verify`.
5. Deploy with `npm run worker:deploy`.

## Developer Workflow

Use this default loop for code or widget changes:

```text
edit source -> npm run generate:worker-assets -> npm run typecheck -> npm test -> npm run worker:dry-run
```

For deployment, use:

```text
npm run worker:deploy
```

That command runs `npm run verify` before `wrangler deploy`.

## Widget Workflow

1. Edit `public/hvdc-answer-widget.html`.
2. Run `npm run generate:worker-assets`.
3. Run `npx vitest run tests/widget.test.ts --exclude ".claude/**"` for focused widget regression.
4. Run `npm run verify` before deployment.
5. Confirm the output template remains `ui://hvdc/answer-card-v10.html` unless intentionally bumping the resource URI.

## Case Status Workflow

Use `get_hvdc_case_status` for case-based warehouse and site status lookup.

For Case No. `207721`, the current deployed smoke returns:

- shipment unit: `WHCASE-207721`
- report status: `WARN`
- latest event: `M100_FINAL_DELIVERED`
- latest date: `2025-05-13`
- warehouse in: `2024-01-19`
- warehouse out: `2025-05-13`
- canonical events: `6`
- case card fields: `36`

## Warehouse Status D1 Workflow

| Command | Use |
| --- | --- |
| `npm run d1:seed-wh-status:dry` | Preview WH status seed from Excel/D1 projection. |
| `npm run d1:seed-wh-status` | Seed WH status projection to remote D1. |
| `npm run d1:reconcile-wh-status` | Reconcile D1 projection and produce traceability report. |
| `npm run d1:rollback-wh-status:dry` | Preview rollback by ingest ID. |

## Governance and Security Workflow

Run `npm run verify:governance` when changing Decision Card governance, rulepack execution fields, SCT card reports, PII/NDA scans, or source-corpus audit logic.

Run `npm run audit:source-pii` when source corpus PII/NDA pattern evidence needs to be refreshed.

Run `npm run scan:sct-pii` when SCT card output surface PII/NDA patterns need to be checked.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Widget change not visible in ChatGPT | Confirm `server/src/generated/widget-html.ts` was regenerated and deployed. If ChatGPT caches the old iframe, start a new chat or bump the widget resource URI intentionally. |
| `/mcp` returns 406 | Send `Accept: application/json, text/event-stream`. |
| Case lookup returns text only | Confirm the tool result includes `structuredContent.report` and output template `ui://hvdc/answer-card-v10.html`. |
| D1 case status is stale | Re-run WH status seed/reconcile commands and verify migration `0006`/`0007` exists. |
| Generated files drift | Run `npm run generate:worker-assets` and check git diff before commit. |

## Operational Smoke Test

Use PowerShell with the MCP Accept header:

```powershell
$base = "https://hvdc-ontology-chatgpt-app.mscho715.workers.dev"
Invoke-WebRequest -Uri "$base/healthz"
$body = @{ jsonrpc = "2.0"; id = 1; method = "tools/call"; params = @{ name = "get_hvdc_case_status"; arguments = @{ caseNo = "207721" } } } | ConvertTo-Json -Depth 8
Invoke-WebRequest -Uri "$base/mcp" -Method Post -ContentType "application/json" -Headers @{ Accept = "application/json, text/event-stream" } -Body $body
```
