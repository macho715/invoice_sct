import { describe, it, expect } from 'vitest';
import { InMemoryRateReferenceProvider } from '../src/lib/invoice/inMemoryRateReferenceProvider';
import { RATE_MANIFEST_VERSION } from '../src/lib/invoice/rateReferenceProvider';

/**
 * InMemoryRateReferenceProvider tests — PR 4 verification.
 *
 * Verifies the lookup semantics that the validation layer depends on:
 *   - match on (vendorId, serviceCode, laneCode, currency)
 *   - effective_from <= effectiveDate <= effectiveTo
 *   - manifestVersion stamped on every successful lookup
 *   - null returned when no row matches
 *
 * @see PLAN_20260616_160103.md PR 4.5
 */

const baseRow = {
  rateId: 'rc_1',
  vendorId: 'V001',
  serviceCode: 'FRT_OCEAN_BASIC',
  laneCode: 'AEHAM→AEPRK',
  amountMinor: 150_000,  // USD 1,500.00
  currency: 'USD' as const,
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
};

describe('InMemoryRateReferenceProvider', () => {
  it('returns executed rate on exact match', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow(baseRow);
    const r = await provider.getExecutedRate({
      vendorId: 'V001',
      laneCode: 'AEHAM→AEPRK',
      serviceCode: 'FRT_OCEAN_BASIC',
      effectiveDate: '2026-06-15',
      currency: 'USD',
      workflowType: 'SHIPMENT',
    });
    expect(r).not.toBeNull();
    expect(r!.rateId).toBe('rc_1');
    expect(r!.amountMinor).toBe(150_000);
    expect(r!.currency).toBe('USD');
    expect(r!.manifestVersion).toBe(RATE_MANIFEST_VERSION);
  });

  it('returns null when vendorId differs', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow(baseRow);
    const r = await provider.getExecutedRate({
      vendorId: 'V999',
      laneCode: 'AEHAM→AEPRK',
      serviceCode: 'FRT_OCEAN_BASIC',
      effectiveDate: '2026-06-15',
      currency: 'USD',
      workflowType: 'SHIPMENT',
    });
    expect(r).toBeNull();
  });

  it('returns null when effective_date is before effective_from', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow(baseRow);
    const r = await provider.getExecutedRate({
      vendorId: 'V001',
      laneCode: 'AEHAM→AEPRK',
      serviceCode: 'FRT_OCEAN_BASIC',
      effectiveDate: '2025-12-31',
      currency: 'USD',
      workflowType: 'SHIPMENT',
    });
    expect(r).toBeNull();
  });

  it('returns null when effective_date is after effective_to', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow(baseRow);
    const r = await provider.getExecutedRate({
      vendorId: 'V001',
      laneCode: 'AEHAM→AEPRK',
      serviceCode: 'FRT_OCEAN_BASIC',
      effectiveDate: '2027-01-01',
      currency: 'USD',
      workflowType: 'SHIPMENT',
    });
    expect(r).toBeNull();
  });

  it('accepts open-ended effective_to (null)', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow({
      ...baseRow,
      rateId: 'rc_open',
      effectiveTo: null,
    });
    const r = await provider.getExecutedRate({
      vendorId: 'V001',
      laneCode: 'AEHAM→AEPRK',
      serviceCode: 'FRT_OCEAN_BASIC',
      effectiveDate: '2099-12-31',
      currency: 'USD',
      workflowType: 'SHIPMENT',
    });
    expect(r).not.toBeNull();
    expect(r!.effectiveTo).toBeNull();
  });

  it('filters by currency', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow(baseRow);
    const r = await provider.getExecutedRate({
      vendorId: 'V001',
      laneCode: 'AEHAM→AEPRK',
      serviceCode: 'FRT_OCEAN_BASIC',
      effectiveDate: '2026-06-15',
      currency: 'AED',
      workflowType: 'SHIPMENT',
    });
    expect(r).toBeNull();
  });

  it('stamps RATE_MANIFEST_VERSION on every successful lookup', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow(baseRow);
    const r = await provider.getExecutedRate({
      vendorId: 'V001',
      laneCode: 'AEHAM→AEPRK',
      serviceCode: 'FRT_OCEAN_BASIC',
      effectiveDate: '2026-06-15',
      currency: 'USD',
      workflowType: 'SHIPMENT',
    });
    expect(r!.manifestVersion).toBe(RATE_MANIFEST_VERSION);
    expect(RATE_MANIFEST_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}_v\d+$/);
  });
});
