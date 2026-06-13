import { describe, it, expect } from 'vitest';
import { scanForDlpViolations, assertDlpClean } from '../src/lib/dlp-scanner';

describe('scanForDlpViolations', () => {
  it('passes clean content', () => {
    const result = scanForDlpViolations('This is a clean invoice for logistics services.');
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('detects email addresses', () => {
    const result = scanForDlpViolations('Contact: john.doe@dsv.com for details.');
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.type === 'EMAIL')).toBe(true);
  });

  it('detects TRN numbers (15 digits)', () => {
    const result = scanForDlpViolations('TRN: 123456789012345');
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.type === 'TRN')).toBe(true);
  });

  it('detects BL numbers', () => {
    const result = scanForDlpViolations('BL-MSCU-2026-001');
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.type === 'BL_NUMBER')).toBe(true);
  });

  it('detects container numbers', () => {
    const result = scanForDlpViolations('Container MSCU1234567 loaded');
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.type === 'CONTAINER_NUMBER')).toBe(true);
  });

  it('detects API keys', () => {
    const result = scanForDlpViolations('api_key=sk_test_1234567890abcdef');
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.type === 'API_KEY' || v.type === 'CREDENTIAL')).toBe(true);
  });

  it('detects HVDC shipment numbers', () => {
    const result = scanForDlpViolations('Shipment HVDC-ADOPT-001 reference');
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.type === 'SHIPMENT_NUMBER')).toBe(true);
  });
});

describe('assertDlpClean', () => {
  it('does not throw for clean content', () => {
    expect(() => assertDlpClean('Clean content here.')).not.toThrow();
  });

  it('throws DLP_VIOLATION for sensitive content', () => {
    expect(() => assertDlpClean('Email: test@example.com')).toThrow('DLP_VIOLATION');
  });
});
