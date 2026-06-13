import { describe, expect, it } from 'vitest';
import { app } from '../main.js';
import { MCP_TOOLS } from '../tools/index.js';

describe('MCP Router', () => {
  describe('GET /health', () => {
    it('returns 200 with status ok and tool count', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.tools).toBe(14);
    });
  });

  describe('POST /mcp - tools/list', () => {
    it('returns all 13 tools with correct names', async () => {
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
      });
      const res = await app.request(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(1);
      expect(body.result.tools).toHaveLength(14);

      const toolNames = body.result.tools.map((t: { name: string }) => t.name);
      const expectedNames = MCP_TOOLS.map(t => t.name);
      expect(toolNames).toEqual(expectedNames);
    });

    it('includes name, description, version, and inputSchema for each tool', async () => {
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 })
      });
      const res = await app.request(req);
      const body = await res.json();
      for (const tool of body.result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('version');
        expect(tool).toHaveProperty('inputSchema');
      }
    });
  });

  describe('POST /mcp - tools/call (unknown tool)', () => {
    it('returns JSON-RPC error -32601 for unknown tool name', async () => {
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'nonexistent_tool', arguments: {} },
          id: 3
        })
      });
      const res = await app.request(req);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(3);
      expect(body.error.code).toBe(-32601);
      expect(body.error.message).toMatch(/Unknown tool/);
    });
  });

  describe('POST /mcp - tools/call (invalid params)', () => {
    it('returns JSON-RPC error -32602 for invalid params', async () => {
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'route_question', arguments: { invalidField: 'value' } },
          id: 4
        })
      });
      const res = await app.request(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(4);
      expect(body.error.code).toBe(-32602);
      expect(body.error.message).toBe('Invalid params');
    });
  });

  describe('POST /mcp - unknown method', () => {
    it('returns JSON-RPC error -32601 for unknown method', async () => {
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'unknown/method', id: 5 })
      });
      const res = await app.request(req);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe(-32601);
      expect(body.error.message).toMatch(/Unknown method/);
    });
  });
});

