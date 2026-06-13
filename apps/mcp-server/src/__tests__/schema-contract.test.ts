import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '../tools/index.js';

describe('MCP tool schema contract', () => {
  it('has exactly 13 tools registered', () => {
    expect(MCP_TOOLS).toHaveLength(13);
  });

  describe.each(MCP_TOOLS.map(t => [t.name, t]))('%s', (_name, tool) => {
    it('has a non-empty name string', () => {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
    });

    it('has a non-empty description string', () => {
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    });

    it('has a Zod inputSchema with .shape', () => {
      expect(tool.inputSchema).toBeDefined();
      expect('shape' in tool.inputSchema).toBe(true);
    });

    it('has a run function on module', () => {
      expect(typeof tool.module.run).toBe('function');
    });

    it('has a version string', () => {
      expect(typeof tool.version).toBe('string');
      expect(tool.version.length).toBeGreaterThan(0);
    });
  });
});
