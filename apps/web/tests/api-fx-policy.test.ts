import { describe, it, expect } from 'vitest';
import { POST as FX_POST, GET as FX_GET } from '../src/app/api/fx-policy/route';

describe('POST/GET /api/fx-policy', () => {
  it('400 BAD_REQUEST if fields are missing or invalid', async () => {
    const res = await FX_POST(
      new Request('http://test/api/fx-policy', {
        method: 'POST',
        body: JSON.stringify({
          fx_policy_id: 'pol_bad'
          // missing required fields
        })
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('200 CREATED for a valid payload', async () => {
    const payload = {
      fx_policy_id: 'pol_api_1',
      from_currency: 'AED',
      to_currency: 'USD',
      fx_rate: 0.2723,
      rate_date: '2026-06-09T12:00:00Z',
      valid_from: '2026-06-01T00:00:00Z',
      valid_to: '2026-06-30T23:59:59Z',
      approved_by: 'FINANCE_APPROVER',
      proof_hash: 'abc123hash'
    };

    const res = await FX_POST(
      new Request('http://test/api/fx-policy', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('CREATED');
    expect(body.fx_policy.fx_policy_id).toBe('pol_api_1');
  });

  it('GET /api/fx-policy returns listed policies', async () => {
    const res = await FX_GET(new Request('http://test/api/fx-policy'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies).toBeDefined();
    expect(Array.isArray(body.policies)).toBe(true);
  });
});
