# Changelog

## Documented Current State - 2026-05-25

### Added

- Added synchronized project-doc-pipeline documents under `docs/` for architecture, layout, changelog, and guide coverage.
- Documented `get_hvdc_case_status` case-card behavior and warehouse status D1 projection commands.
- Documented Widget v10 operational behavior and focused widget troubleshooting.

### Changed

- Current documentation baseline now reflects Cloudflare Worker runtime, `ui://hvdc/answer-card-v10.html`, Case Status Card rendering, and WH status D1/SSOT workflow.
- The root historical docs remain in place for continuity, while `docs/SYSTEM_ARCHITECTURE.md`, `docs/LAYOUT.md`, and `docs/GUIDE.md` provide concise current-state docs.

### Fixed

- Documented the latest widget containment fix for Case Status Card tables and `canonicalEvents` horizontal scrolling inside the card.

### Verified

- `npm run worker:deploy` executed `npm run verify` before deployment.
- Verification baseline: 22 test files and 302 tests passed.
- Cloudflare Worker deployed at `https://hvdc-ontology-chatgpt-app.mscho715.workers.dev`.
- `/healthz` returned HTTP 200.
- `/mcp get_hvdc_case_status caseNo=207721` returned `WHCASE-207721`, `WARN`, `M100_FINAL_DELIVERED`, `canonicalEvents=6`, `caseCard=36`, and output template `ui://hvdc/answer-card-v10.html`.
