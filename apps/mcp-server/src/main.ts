import { Hono } from 'hono';
import { MCP_TOOLS } from './tools/index.js';
import { guardDlp, DlpGuardInputSchema } from './schemas/dlp-guard.js';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', tools: MCP_TOOLS.length }));

app.post('/mcp', async (c) => {
  const body = await c.req.json();
  const { method, params, id } = body;

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
