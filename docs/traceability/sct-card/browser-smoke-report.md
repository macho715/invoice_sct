# SCT Card Browser Smoke Report

- run date: 2026-05-18 01:39:26 +04:00
- session basis: current Windows Codex session
- harness: `tests/fixtures/widget-browser-smoke.html`
- local server: `node scripts/serve-widget-smoke.mjs`
- URL: `http://127.0.0.1:8765/tests/fixtures/widget-browser-smoke.html`
- screenshot: `docs/traceability/sct-card/widget-browser-smoke.png`
- Playwright snapshot: `.playwright-mcp/page-2026-05-17T21-39-26-293Z.yml`

## Result

PASS_SMOKE

The widget rendered the Decision Card v2 browser harness in a real Chromium page through the Playwright MCP browser.

## Observed UI evidence

- Decision Card v2 region rendered.
- Verdict text rendered as `PENDING_APPROVAL`.
- `Decision`, `Evidence`, `Validation`, `Entities`, `Actions`, `Security`, and `Trace` tabs rendered as ARIA tabs.
- `HumanGateBanner` rendered with `APPROVAL_REQUESTED`.
- Action text rendered as `REQUEST_EMAIL_SEND_APPROVAL - Logistics Lead (Human-gate required)`.
- Validation warning rendered as `APPROVAL_REQUIRED - A-ACTION-001`.
- Card UI status rendered as `READY`.
- Screenshot was captured as a full-page PNG.

## Console status

The first browser load produced a `favicon.ico` 404 from the harness page.
The harness was patched with `<link rel="icon" href="data:,">`, then reloaded.
The final browser navigation produced no console error entry in the Playwright MCP response.

## Verification commands

```powershell
node scripts/serve-widget-smoke.mjs
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/tests/fixtures/widget-browser-smoke.html'
```

```text
HTTP status: 200
```

```text
Playwright MCP:
- browser_navigate http://127.0.0.1:8765/tests/fixtures/widget-browser-smoke.html
- browser_snapshot depth=8 boxes=true
- browser_take_screenshot fullPage=true
```

```powershell
node --check scripts/serve-widget-smoke.mjs
npx vitest run tests/widget.test.ts
```

```text
node --check: PASS
Vitest: 5 files passed, 92 tests passed
```

## Limitations

This is a real browser smoke and accessibility-tree snapshot, not a committed CI Playwright test.
It does not replace axe-core automated accessibility scanning.
It does not measure the approved-size SC-007 operator clarity rubric.
