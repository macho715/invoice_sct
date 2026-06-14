import { describe, it, expect } from 'vitest';
import { createCfMcpClient } from '../src/lib/cf-mcp-client';

// MCP validation tools now run in-process (apps/web/src/lib/mcp/tools). No fetch
// mocking — these exercise the real ported tools deterministically. check_rate_card
// degrades to AMBER when DATABASE_URL is unset (no DB needed for these tests).

describe('cf-mcp-client (in-process)', () => {
  it('validate aggregates cost-guard, type_b and gate results', async () => {
    const client = createCfMcpClient();
    const r = await client.validate('job_1', {
      invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100, qty: 1, rate: 100, standard_amount: 100 }],
      evidence_index: []
    });

    expect(r.costguard_results).toEqual([
      { line_id: 'l1', band: 'PASS', verdict: 'PASS', delta_pct: 0, prism_kernel_proof_ref: null, fx_policy_id: null }
    ]);
    expect(r.gate_results).toHaveLength(1);
    expect(r.gate_results[0].gate_status).toBe('PASS');
    expect(r.type_b_results[0]).toMatchObject({ line_id: 'l1', type_b: 'INLAND' });
    expect(r.cf_mcp_tool_calls.some(c => c.tool === 'check_cost_guard')).toBe(true);
  });

  it('flags QTY_X_RATE_MISMATCH as a ZERO/CRITICAL band', async () => {
    const client = createCfMcpClient();
    const r = await client.validate('job_mismatch', {
      invoice_lines: [{ line_id: 'l1', description: 'STORAGE', currency: 'AED', amount: 999, qty: 1, rate: 100, standard_amount: 100 }],
      evidence_index: []
    });
    expect(r.costguard_results[0].band).toBe('CRITICAL');
    expect(r.gate_results[0].gate_status).toBe('ZERO');
  });

  it('throws when rate currency differs and no FX policy exists', async () => {
    const client = createCfMcpClient();
    await expect(client.validate('job_fx_1', {
      invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100, rate_ref_currency: 'USD' }],
      evidence_index: []
    })).rejects.toThrow(/No active FX policy found/);
  });

  it('converts amount and tags fx_policy_id when a valid policy exists', async () => {
    const { STORE } = await import('../src/lib/job-store');
    await STORE.createFxPolicy({
      fx_policy_id: 'pol_test',
      from_currency: 'AED',
      to_currency: 'USD',
      fx_rate: 0.2723,
      rate_date: '2026-06-09T12:00:00Z',
      valid_from: '2026-06-01T00:00:00Z',
      valid_to: '2026-06-30T23:59:59Z',
      approved_by: 'FINANCE_APPROVER',
      proof_hash: 'abc123hash'
    });

    const client = createCfMcpClient();
    const r = await client.validate('job_fx_2', {
      invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100, rate_ref_currency: 'USD', rate_date: '2026-06-09T12:00:00Z' }],
      evidence_index: []
    });

    expect(r.costguard_results[0].fx_policy_id).toBe('pol_test');
  });
});
