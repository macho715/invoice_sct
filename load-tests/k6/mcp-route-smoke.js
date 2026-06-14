// MCP server smoke test: verify /health and /mcp JSON-RPC endpoint
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const options = {
  vus: 1,
  duration: '20s',
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    mcp_errors: ['rate<0.01'],
  },
};

const mcpErrors = new Rate('mcp_errors');

const MCP_URL = __ENV.MCP_URL || 'http://localhost:8080';
const MCP_TOKEN = __ENV.MCP_BEARER_TOKEN || 'test-token';

export default function () {
  // Health check
  const health = http.get(`${MCP_URL}/health`);
  check(health, { 'health 200': (r) => r.status === 200 });

  // MCP JSON-RPC: list tools
  const rpc = http.post(
    `${MCP_URL}/mcp`,
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MCP_TOKEN}`,
      },
      timeout: '10s',
    },
  );

  const ok = check(rpc, {
    'mcp 200': (r) => r.status === 200,
    'has tools': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.result?.tools) && body.result.tools.length > 0;
      } catch {
        return false;
      }
    },
  });

  mcpErrors.add(!ok);
  sleep(1);
}
