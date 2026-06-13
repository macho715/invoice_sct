# Connect HVDC Ontology App to Claude

## Overview

Claude Code, Claude Desktop, and claude.ai should use the same Cloudflare Workers remote MCP endpoint:

```text
https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp
```

`start-hvdc-mcp.cmd` is kept only as a stdio bridge for clients that still start a local command. It proxies to the Cloudflare endpoint and does not run the old legacy fallback process.

---

## Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hvdc-ontology": {
      "type": "http",
      "url": "https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp"
    }
  }
}
```

Config file location:
- **macOS/Linux**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

---

## Claude Code (CLI)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "hvdc-ontology": {
      "type": "http",
      "url": "https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp"
    }
  }
}
```

Or via the CLI flag:

```bash
claude --mcp-server "hvdc-ontology=https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/mcp"
```

---

## Environment Variables

No local Claude port is required for the Cloudflare remote MCP path.

Optional local debugging only:
- `npm run claude:local`

---

## Available Tools (11)

| Tool | Description |
|---|---|
| `ask_hvdc_ontology` | Corpus-grounded answer with evidence and validation |
| `render_hvdc_answer_card` | Markdown card from any GroundedAnswer (ChatGPT or Claude format) |
| `route_question` | Classify question into domains + required docs |
| `search_ontology_corpus` | Evidence snippets from approved HVDC documents |
| `resolve_any_key` | Resolve BL, BOE, DO, Invoice, HVDC code identifiers |
| `validate_answer` | Check evidence coverage, human-gate, currentness |
| `create_upload_url` | Create a Human-gate approved R2 upload URL; requires `files:upload` Bearer scope |
| `complete_upload` | Confirm uploaded file metadata; requires `files:upload` Bearer scope |
| `attach_uploaded_file` | Attach uploaded evidence to a target; requires `files:write` Bearer scope |
| `write_file_dry_run` | Create a managed-file write proposal; requires `files:write` Bearer scope |
| `write_file_commit` | Commit an approved write proposal into R2 `managed/`; requires `files:write` Bearer scope |

Protected upload/write tools are Cloudflare-managed storage tools only.
They do not write to ERP, WMS, ATLP, Foundry, email, or messaging systems.
If Claude connects without a Bearer token, these protected tools return `AUTH_REQUIRED`.

---

## Test Prompts

1. **Basic answer**: `AGI M130 닫아도 돼? BL-535 관련`
   - Expected: `BLOCK` verdict with human-gate action

2. **Flow Code boundary**: `Flow Code 어디에 써?`
   - Expected: WHP-only explanation with evidence

3. **Evidence search**: `BOE 123 지연 원인 근거를 찾아줘`
   - Expected: Evidence snippets from corpus

4. **Identifier resolution**: `BL-535 관련 자재 상태 확인해줘`
   - Expected: Resolved entity candidates

5. **Format parsing test**: Run `ask_hvdc_ontology`, then pass the result to `render_hvdc_answer_card`
   - Expected: Markdown card with verdict, route, evidence, actions

---

## Format Compatibility

`render_hvdc_answer_card` accepts **both** response formats:

**ChatGPT format** (from ChatGPT app responses):
```json
{
  "structuredContent": { "...GroundedAnswer...", "ui": { "templateUrl": "ui://hvdc/..." } },
  "_meta": { "openai/outputTemplate": "ui://hvdc/..." }
}
```

**Claude format** (from remote MCP tool responses):
```json
{
  "answerId": "...",
  "verdict": "PASS",
  "summary": "...",
  "..."
}
```

Both are normalized to the same markdown card output.
