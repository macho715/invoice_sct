import { describe, it, expect } from 'vitest';
import { validateInvoice } from '../src/lib/invoice/validateInvoice';
import { InMemoryRateReferenceProvider } from '../src/lib/invoice/inMemoryRateReferenceProvider';
import type { InvoiceInput } from '../src/lib/invoice/schema';

/**
 * validateInvoice rate provider integration — PR 4 verification.
 *
 * Verifies that validateInvoice() now uses the rate provider for the
 * rate_reference rule and stamps the returned rate_manifest_version
 * on the result.
 *
 * @see PLAN_20260616_160103.md PR 4.5
 */

const linePass = (overrides: Partial<InvoiceInput['lines'][number]> = {}): InvoiceInput['lines'][number] => ({
  line_id: 'L1',
  description: 'freight',
  amount: 1500.00,
  rate_basis: 'PER_TEU',
  currency: 'USD',
  ...overrides,
});

const baseInvoice: InvoiceInput = {
  invoiceNumber: 'INV-001',
  vendorId: 'V001',
  vendorName: 'DSV',
  issueDate: '2026-06-15',
  currency: 'USD',
  subtotalMinor: 150_000,
  taxMinor: 0,
  totalMinor: 150_000,
  lines: [linePass({ shipment_ref: 'AEHAM→AEPRK', for_charge_component: 'FRT_OCEAN_BASIC' })],
};

describe('validateInvoice + RateReferenceProvider', () => {
  it('returns PASS when rate matches contracted amount', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow({
      rateId: 'rc_1',
      vendorId: 'V001',
      serviceCode: 'FRT_OCEAN_BASIC',
      laneCode: 'AEHAM→AEPRK',
      amountMinor: 150_000,
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    });
    const r = await validateInvoice(baseInvoice, { rateProvider: provider });
    expect(r.valid).toBe(true);
    expect(r.issues.filter((i) => i.code === 'RATE_MISMATCH')).toHaveLength(0);
    expect(r.rateManifestVersion).toBeTruthy();
  });

  it('flags RATE_MISMATCH when variance > 2%', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow({
      rateId: 'rc_1',
      vendorId: 'V001',
      serviceCode: 'FRT_OCEAN_BASIC',
      laneCode: 'AEHAM→AEPRK',
      amountMinor: 150_000,  // contracted: 1,500.00
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    });
    const invoice: InvoiceInput = {
      ...baseInvoice,
      lines: [linePass({
        shipment_ref: 'AEHAM→AEPRK',
        for_charge_component: 'FRT_OCEAN_BASIC',
        amount: 1700.00,  // 13.3% over contracted
      })],
    };
    const r = await validateInvoice(invoice, { rateProvider: provider });
    const mismatches = r.issues.filter((i) => i.code === 'RATE_MISMATCH');
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0].severity).toBe('warning');
  });

  it('flags RATE_NOT_FOUND when no row matches', async () => {
    const provider = InMemoryRateReferenceProvider.empty();  // empty
    const r = await validateInvoice(baseInvoice, { rateProvider: provider });
    const notFound = r.issues.filter((i) => i.code === 'RATE_NOT_FOUND');
    expect(notFound.length).toBeGreaterThan(0);
  });

  it('stamps rate_manifest_version on result', async () => {
    const provider = InMemoryRateReferenceProvider.empty().withRow({
      rateId: 'rc_1',
      vendorId: 'V001',
      serviceCode: 'FRT_OCEAN_BASIC',
      laneCode: 'AEHAM→AEPRK',
      amountMinor: 150_000,
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    });
    const r = await validateInvoice(baseInvoice, { rateProvider: provider });
    expect(r.rateManifestVersion).toBe('2026-06-16_v1');
  });
});
