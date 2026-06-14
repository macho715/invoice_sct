import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { MCP_TOOLS } from './tools/index.js';
import { guardDlp, DlpGuardInputSchema } from './schemas/dlp-guard.js';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', tools: MCP_TOOLS.length }));

app.use('/mcp', cors({
  origin: ['http://localhost:3000', 'https://invoice-audit.vercel.app'],
  allowMethods: ['POST'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  maxAge: 86400,
}));

app.post('/mcp', async (c) => {
  const body = await c.req.json();
  const { method, params, id } = body;

  const expected = process.env.MCP_API_KEY;
  if (!expected) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Server misconfigured — MCP_API_KEY not set' } }, 500);
  }
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${expected}`) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401);
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          version: t.version,
          // ZodObject exposes .shape; the registry types it loosely to support unions.
          inputSchema: 'shape' in t.inputSchema ? t.inputSchema.shape : {}
        }))
      }
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    const tool = MCP_TOOLS.find(t => t.name === name);
    if (!tool) {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } }, 404);
    }

    const dlpCheck = guardDlp({ payload: args });
    if (!dlpCheck.passed) {
      return c.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'DLP_VIOLATION: Sensitive data detected in tool input', data: dlpCheck.violations }
      }, 400);
    }

    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      return c.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Invalid params', data: parsed.error.flatten() }
      }, 400);
    }

    try {
      const result = await tool.module.run(parsed.data);
      return c.json({
        jsonrpc: '2.0',
        id,
        result: { tool: name, status: 'OK', result }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Tool execution failed';
      return c.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message }
      }, 500);
    }
  }

  return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }, 404);
});

export default app;
export { app };

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`mcp-server listening on http://${host}:${info.port}`);
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
