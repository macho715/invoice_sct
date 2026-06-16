import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contractPath = path.join(root, 'architecture-contracts.json');

function readText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing file: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function assertIncludes(relativePath, needle, label) {
  const text = readText(relativePath);
  if (!text.includes(needle)) {
    throw new Error(`${label}: expected ${relativePath} to contain ${JSON.stringify(needle)}`);
  }
}

function assertEdgeShape(edge) {
  const required = ['id', 'from', 'to', 'protocol', 'auth', 'contract', 'caller', 'failure_verdict', 'artifact'];
  for (const key of required) {
    if (typeof edge[key] !== 'string' || edge[key].trim() === '') {
      throw new Error(`${edge.id ?? '<missing-id>'}: missing non-empty ${key}`);
    }
  }
}

function assertCaller(edge) {
  assertIncludes(edge.caller, '', `${edge.id} caller`);
}

function assertContractReference(edge) {
  const pathPattern = /[A-Za-z0-9_./-]+\.(?:ts|tsx|py|json|md)/g;
  const paths = edge.contract.match(pathPattern) ?? [];

  if (paths.length === 0) {
    throw new Error(`${edge.id}: contract must reference at least one source file path`);
  }

  for (const filePath of paths) {
    assertIncludes(filePath, '', `${edge.id} contract file`);
  }

  if (edge.contract.includes('::')) {
    const [filePath, symbol] = edge.contract.split('::');
    if (symbol) assertIncludes(filePath, symbol, `${edge.id} contract symbol`);
  }
}

const endpointChecks = {
  'web-run-to-worker-parse': () => {
    assertIncludes('apps/web/src/app/api/invoice-audit/run/route.ts', 'createParserClient', 'run route parser client use');
    assertIncludes('apps/web/src/lib/parser-client.ts', '/v1/parse', 'parser client parse endpoint');
    assertIncludes('apps/worker-py/app/routes/parse.py', "@router.post('/v1/parse'", 'worker parse route');
    assertIncludes('apps/worker-py/app/schemas.py', 'class ParseRequest', 'worker parse contract');
  },
  'web-export-to-worker-export': () => {
    assertIncludes('apps/web/src/app/api/audit/export/route.ts', '/v1/export', 'audit export route worker endpoint');
    assertIncludes('apps/worker-py/app/routes/export.py', "@router.post('/export'", 'worker export route');
    assertIncludes('apps/worker-py/app/main.py', 'app.include_router(export_router, prefix="/v1")', 'worker export route prefix');
    assertIncludes('apps/worker-py/app/schemas.py', 'class ExportRequest', 'worker export contract');
  },
  'web-download-to-worker-export-fallback': () => {
    assertIncludes('apps/web/src/app/api/export/download/route.ts', '/v1/export', 'download fallback worker endpoint');
    assertIncludes('apps/worker-py/app/routes/export.py', "@router.post('/export'", 'worker export route');
    assertIncludes('apps/worker-py/app/main.py', 'app.include_router(export_router, prefix="/v1")', 'worker export route prefix');
  },
  'web-to-vercel-blob': () => {
    assertIncludes('apps/web/src/lib/blob.ts', 'blob_ref', 'blob ref scheme');
    assertIncludes('apps/web/src/lib/blob.ts', 'blob_url', 'blob url field');
    assertIncludes('apps/web/src/lib/blob.ts', '@vercel/blob', 'Vercel Blob import');
  },
  'web-to-neon-job-store': () => {
    assertIncludes('apps/web/src/lib/job-store.ts', 'DATABASE_URL', 'web job store database switch');
    assertIncludes('apps/web/src/lib/job-store-pg.ts', 'DATABASE_URL', 'Postgres job store DSN');
    assertIncludes('packages/database/src/index.ts', 'DATABASE_URL', 'shared database pool DSN');
  },
  'web-to-mcp-validation': () => {
    assertIncludes('apps/web/src/lib/cf-mcp-client.ts', 'createCfMcpClient', 'web validation client');
    assertIncludes('apps/mcp-server/src/tools/index.ts', 'MCP_TOOLS', 'MCP server tool registry');
    assertIncludes('packages/tools/src/index.ts', 'MCP_TOOL_NAMES', 'packages/tools registry');
  }
};

const payload = JSON.parse(readText('architecture-contracts.json'));
if (!Array.isArray(payload.edges)) {
  throw new Error('architecture-contracts.json: edges must be an array');
}
if (payload.edges.length !== 6) {
  throw new Error(`architecture-contracts.json: expected 6 edges, found ${payload.edges.length}`);
}

const ids = new Set();
for (const edge of payload.edges) {
  assertEdgeShape(edge);
  if (ids.has(edge.id)) throw new Error(`Duplicate edge id: ${edge.id}`);
  ids.add(edge.id);
  assertCaller(edge);
  assertContractReference(edge);
  const check = endpointChecks[edge.id];
  if (!check) throw new Error(`No endpoint check registered for edge: ${edge.id}`);
  check();
}

console.log(`architecture-contracts OK: ${payload.edges.length} runtime edges verified`);
