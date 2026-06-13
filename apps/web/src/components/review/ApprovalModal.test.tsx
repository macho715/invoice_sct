import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ApprovalModal, { AMBER_FINANCE_THRESHOLD_AED } from './ApprovalModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(props: Partial<React.ComponentProps<typeof ApprovalModal>> = {}) {
  return renderToStaticMarkup(
    React.createElement(ApprovalModal, {
      jobId: props.jobId ?? 'job_test_01',
      verdict: props.verdict ?? 'PASS',
      varianceAed: props.varianceAed,
      approverRole: props.approverRole,
      approverIdentity: props.approverIdentity,
      onClose: props.onClose ?? (() => {}),
      onSubmit: props.onSubmit
    })
  );
}

beforeEach(() => {
  // Ensure fetch exists in node env (Node 18+ has it; keep stub for safety)
  if (typeof (globalThis as any).fetch !== 'function') {
    (globalThis as any).fetch = vi.fn();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApprovalModal', () => {
  it('PASS verdict: shows confirm button and Final Approved Workbook copy', () => {
    const html = render({ verdict: 'PASS' });

    expect(html).toContain('data-testid="approval-modal"');
    expect(html).toContain('data-testid="verdict-badge"');
    expect(html).toContain('>PASS<');
    expect(html).toContain('data-testid="pass-confirm-button"');
    expect(html).toContain('Confirm &amp; Export Final Workbook');
    expect(html).toContain('Final Approved Workbook');
    // AMBER/ZERO-only UI should not be present
    expect(html).not.toContain('data-testid="amber-required-label"');
    expect(html).not.toContain('data-testid="zero-ack-checkbox"');
  });

  it('AMBER verdict with variance < 500 AED: shows Ops Lead required', () => {
    const variance = AMBER_FINANCE_THRESHOLD_AED - 1; // 499.00
    const html = render({ verdict: 'AMBER', varianceAed: variance });

    expect(html).toContain('>AMBER<');
    expect(html).toContain('data-testid="amber-body"');
    expect(html).toContain('data-testid="amber-required-label"');
    expect(html).toContain('Ops Lead approval required');
    expect(html).toContain('data-testid="amber-submit-button"');
    expect(html).toContain('variance-amount');
    // Should NOT show Finance Manager label
    expect(html).not.toContain('Finance Manager approval required');
  });

  it('AMBER verdict with variance >= 500 AED: shows Finance Manager required', () => {
    const variance = AMBER_FINANCE_THRESHOLD_AED; // 500.00
    const html = render({ verdict: 'AMBER', varianceAed: variance });

    expect(html).toContain('>AMBER<');
    expect(html).toContain('data-testid="amber-required-label"');
    expect(html).toContain('Finance Manager approval required');
    expect(html).toContain('data-testid="amber-submit-button"');
    // Should NOT show Ops Lead label
    expect(html).not.toContain('Ops Lead approval required');
  });

  it('AMBER verdict with very high variance: still shows Finance Manager required', () => {
    const html = render({ verdict: 'AMBER', varianceAed: 12500.75 });

    expect(html).toContain('Finance Manager approval required');
    expect(html).toContain('12,500.75'); // formatted with thousand separator
  });

  it('ZERO verdict: shows Review Pack only, blocks Final Workbook, requires acknowledgement', () => {
    const html = render({ verdict: 'ZERO', approverRole: 'FINANCE_APPROVER' });

    expect(html).toContain('>ZERO<');
    expect(html).toContain('data-testid="zero-body"');
    // Final export is blocked — no "Confirm & Export Final Workbook" button
    expect(html).not.toContain('data-testid="pass-confirm-button"');
    expect(html).not.toContain('Confirm &amp; Export Final Workbook');
    // Review Pack button is shown
    expect(html).toContain('data-testid="zero-review-pack-button"');
    expect(html).toContain('Generate Review Pack (no Final Workbook)');
    // Final Approved Workbook copy should not appear in the body
    expect(html).toContain('Final Approved Workbook'); // mentioned in ZERO block copy as "cannot be produced"
    // Contract/Admin acknowledgement checkbox is required
    expect(html).toContain('data-testid="zero-ack-checkbox"');
    expect(html).toContain('data-testid="zero-submit-button"');
    expect(html).toContain('Contract/Admin review acknowledgement');
  });

  it('renders the job ID in the dialog header', () => {
    const html = render({ jobId: 'job_xyz_999' });
    expect(html).toContain('job_xyz_999');
  });

  it('applies correct verdict-specific data attribute', () => {
    const passHtml = render({ verdict: 'PASS' });
    const amberHtml = render({ verdict: 'AMBER', varianceAed: 100 });
    const zeroHtml = render({ verdict: 'ZERO' });

    expect(passHtml).toContain('data-verdict="PASS"');
    expect(amberHtml).toContain('data-verdict="AMBER"');
    expect(zeroHtml).toContain('data-verdict="ZERO"');
  });
});
