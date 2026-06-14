# SCT_ONTOLOGY — Load Tests (k6)

## Prerequisites

Install k6: https://k6.io/docs/getting-started/installation/

```bash
# macOS
brew install k6

# Linux
sudo apt install k6

# Windows (via Chocolatey)
choco install k6
```

## Scenarios

| File | Description | VUs | Duration |
|------|-------------|-----|----------|
| `invoice-audit-smoke.js` | Verify API responds correctly | 1 | 30s |
| `invoice-audit-load.js` | Ramp load 1→10→0 VUs | 1–10 | 2.5m |
| `db-pool-pressure.js` | 12 VUs against 10-connection pool | 12 | 60s |
| `mcp-route-smoke.js` | MCP /health + tools/list JSON-RPC | 1 | 20s |

## Running Tests

```bash
# Smoke test against local dev server
BASE_URL=http://localhost:3000 k6 run load-tests/k6/invoice-audit-smoke.js

# Load test against local dev server
BASE_URL=http://localhost:3000 k6 run load-tests/k6/invoice-audit-load.js

# DB pool pressure test
BASE_URL=http://localhost:3000 k6 run load-tests/k6/db-pool-pressure.js

# MCP server smoke test
MCP_URL=http://localhost:8080 MCP_BEARER_TOKEN=<token> k6 run load-tests/k6/mcp-route-smoke.js

# Run all smoke tests sequentially
BASE_URL=http://localhost:3000 MCP_URL=http://localhost:8080 \
  k6 run load-tests/k6/invoice-audit-smoke.js && \
  k6 run load-tests/k6/mcp-route-smoke.js

# Save JSON artifact for CI
BASE_URL=http://localhost:3000 k6 run --out json=load-tests/results/last-run.json \
  load-tests/k6/invoice-audit-load.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Web app base URL |
| `MCP_URL` | `http://localhost:8080` | MCP server base URL |
| `MCP_BEARER_TOKEN` | `test-token` | MCP Bearer auth token |

## Thresholds

Tests fail if:
- `invoice-audit-smoke`: p95 > 2s or error rate > 1%
- `invoice-audit-load`: p95 > 5s, p99 > 10s, or error rate > 5%
- `db-pool-pressure`: p95 > 10s or error rate > 10%
- `mcp-route-smoke`: p95 > 3s or error rate > 1%

## CI Integration

See `.github/workflows/reliability.yml` for the optional CI workflow
that runs smoke tests on pull requests.
