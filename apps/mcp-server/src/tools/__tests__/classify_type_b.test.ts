import { describe, expect, it } from 'vitest';
import { run, TOOL_VERSION, ToolName } from '../classify_type_b.js';

describe('classify_type_b', () => {
  it('exposes the expected tool identity', () => {
    expect(ToolName).toBe('classify_type_b');
    expect(TOOL_VERSION).toBe('0.1.0');
  });

  it('classifies "customs inspection fee at port" as INSPECTION', async () => {
    const result = await run({ line_id: 'L1', description: 'customs inspection fee at port' });
    expect(result.type_b).toBe('INSPECTION');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.matched_keyword).toBe('customs inspection');
  });

  it('classifies "BOE processing charge" as CUSTOMS', async () => {
    const result = await run({ line_id: 'L2', description: 'BOE processing charge' });
    expect(result.type_b).toBe('CUSTOMS');
    expect(result.matched_keyword).toBe('boe');
  });

  it('classifies "delivery order fee" as DO', async () => {
    const result = await run({ line_id: 'L3', description: 'delivery order fee' });
    expect(result.type_b).toBe('DO');
    expect(result.matched_keyword).toBe('delivery order');
  });

  it('classifies "transport from MOSB to Mirfa" as INLAND', async () => {
    const result = await run({ line_id: 'L4', description: 'transport from MOSB to Mirfa' });
    expect(result.type_b).toBe('INLAND');
    expect(result.matched_keyword).toBe('transport');
  });

  it('classifies "terminal handling charge THC" as THC', async () => {
    const result = await run({ line_id: 'L5', description: 'terminal handling charge THC' });
    expect(result.type_b).toBe('THC');
    expect(result.matched_keyword).toBe('terminal handling');
  });

  it('classifies "container detention 5 days" as DETENTION', async () => {
    const result = await run({ line_id: 'L6', description: 'container detention 5 days' });
    expect(result.type_b).toBe('DETENTION');
    expect(result.matched_keyword).toBe('container detention');
  });

  it('classifies "storage charge warehouse" as STROAGE', async () => {
    const result = await run({ line_id: 'L7', description: 'storage charge warehouse' });
    expect(result.type_b).toBe('STROAGE');
    expect(result.matched_keyword).toBe('storage');
  });

  it('classifies "miscellaneous handling fee" as OTHERS', async () => {
    const result = await run({ line_id: 'L8', description: 'miscellaneous handling fee' });
    expect(result.type_b).toBe('OTHERS');
    expect(result.confidence).toBe(0.5);
    expect(result.matched_keyword).toBeNull();
  });

  it('priority: "customs inspection and transport" → INSPECTION (not CUSTOMS, not INLAND)', async () => {
    const result = await run({ line_id: 'L9', description: 'customs inspection and transport' });
    expect(result.type_b).toBe('INSPECTION');
    expect(result.matched_keyword).toBe('customs inspection');
  });

  it('classifies "SHJ customs gate pass" as CUSTOMS', async () => {
    const result = await run({ line_id: 'L10', description: 'SHJ customs gate pass' });
    expect(result.type_b).toBe('CUSTOMS');
    expect(result.matched_keyword).toBe('shj customs');
  });
});
