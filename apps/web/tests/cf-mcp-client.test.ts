import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn();

import { createCfMcpClient } from '../src/lib/cf-mcp-client';

describe('cf-mcp-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validate calls route_question, check_cost_guard, check_doc_guardian and aggregates', async () => {
    fetchMock
      // route_question
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { domain: 'invoice-cost', requiredCorpus: ['tariff_ref'] } }) })
      // dryrun_type_b_classify
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 2, result: { classifications: [{ line_id: 'l1', type_b: 'THC', sct_code: 'SCT.CHARGE.THC', confidence: 0.9 }] } }) })
      // dryrun_rate_lookup (l1)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 3, result: { status: 'VALID' } }) })
      // check_cost_guard
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 4, result: { lineResults: [{ lineId: 'l1', band: 'PASS', deltaPct: 1.5, verdict: 'ACCEPTABLE', proofRef: 'proof_1' }] } }) })
      // check_doc_guardian
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 5, result: { findings: [] } }) })
      // ontology_evidence_map
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 6, result: { evidence_requirements: [] } }) });

    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 1000, retries: 0 });
    const r = await client.validate('job_1', { invoice_lines: [{ line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100 }], evidence_index: [] });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(r.costguard_results).toEqual([{ line_id: 'l1', band: 'PASS', verdict: 'ACCEPTABLE', delta_pct: 1.5, prism_kernel_proof_ref: 'proof_1', fx_policy_id: null }]);
    expect(r.gate_results).toHaveLength(1);
    expect(r.gate_results[0].gate_status).toBe('PASS');
  });

  it('throws FX_POLICY_REQUIRED when rate currency differs and no policy exists', async () => {
    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 1000, retries: 0 });
    
    await expect(client.validate('job_fx_1', {
      invoice_lines: [{
        line_id: 'l1',
        description: 'TRUCKING',
        currency: 'AED',
        amount: 100,
        rate_ref_currency: 'USD'
      }],
      evidence_index: []
    })).rejects.toThrow(/No active FX policy found/);
  });

  it('succeeds and converts amount when valid policy exists', async () => {
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

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { domain: 'invoice-cost', requiredCorpus: [] } }) })
      // dryrun_type_b_classify
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 2, result: { classifications: [{ line_id: 'l1', type_b: 'THC', sct_code: 'SCT.CHARGE.THC', confidence: 0.9 }] } }) })
      // dryrun_rate_lookup (l1)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 3, result: { status: 'VALID' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 4, result: { lineResults: [{ lineId: 'l1', band: 'PASS', deltaPct: 0, verdict: 'ACCEPTABLE', proofRef: 'proof_1' }] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 5, result: { findings: [] } }) })
      // ontology_evidence_map
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 6, result: { evidence_requirements: [] } }) });

    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 1000, retries: 0 });
    const r = await client.validate('job_fx_2', {
      invoice_lines: [{
        line_id: 'l1',
        description: 'TRUCKING',
        currency: 'AED',
        amount: 100,
        rate_ref_currency: 'USD',
        rate_date: '2026-06-09T12:00:00Z'
      }],
      evidence_index: []
    });

    expect(r.costguard_results[0].fx_policy_id).toBe('pol_test');
  });

  it('throws MCP_UNAVAILABLE on persistent failure (retries exhausted)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 100, retries: 2, backoffMs: 1 });
    await expect(client.validate('job_1', { invoice_lines: [], evidence_index: [] })).rejects.toThrow(/MCP_UNAVAILABLE/);
  });

  it('respects timeout (AbortError => retry, then MCP_UNAVAILABLE)', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const client = createCfMcpClient({ baseUrl: 'https://cf.example/mcp', timeoutMs: 10, retries: 1, backoffMs: 1 });
    try {
      await client.validate('job_1', { invoice_lines: [], evidence_index: [] });
      throw new Error('Expected validation to fail');
    } catch (err) {
      console.log('TIMEOUTFOUND:', err);
      expect((err as Error).message).toMatch(/MCP_UNAVAILABLE/);
    }
  });
});
