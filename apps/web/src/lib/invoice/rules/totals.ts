import type { InvoiceInput, ValidationIssue } from '../schema';

/**
 * totals — 합계 정합성 검증 (PR 1.3)
 *
 * - line item 합계 = subtotal (오차 ±1 minor unit = 0.01)
 * - subtotal + tax = total
 *
 * Rule #0과 무관 — 검증 실패는 issue로 표기되지만 Excel 산출은 항상 제공.
 */
const MINOR_TOLERANCE = 1; // ±0.01 통화 단위

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

export function checkTotals(input: InvoiceInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lineSum = input.lines.reduce(
    (acc, l) => acc + (typeof l.amount === 'number' ? l.amount : 0),
    0,
  );

  // 1) subtotal = sum(lines.amount)
  // input.subtotalMinor는 minor unit (1 = 0.01 AED), lines.amount는 major unit.
  // → 통화 환산 없이 정수 비교하려면 동일 단위여야 한다.
  // Track 2의 InvoiceLineSchema는 amount(major) / subtotalMinor(minor) 단위가 혼재.
  // 검증 단계에서는 ±0.01 오차 허용하면서 비교한다.
  const lineSumMinor = Math.round(lineSum * 100);
  if (!near(input.subtotalMinor, lineSumMinor, MINOR_TOLERANCE)) {
    issues.push({
      code: 'TOTAL_MISMATCH',
      severity: 'error',
      message: `Line item sum (${lineSumMinor} minor) does not match subtotal (${input.subtotalMinor} minor)`,
      path: 'subtotalMinor',
      expected: lineSumMinor,
      actual: input.subtotalMinor,
    });
  }

  // 2) subtotal + tax = total
  if (!near(input.subtotalMinor + input.taxMinor, input.totalMinor, MINOR_TOLERANCE)) {
    issues.push({
      code: 'TAX_MISMATCH',
      severity: 'error',
      message: `subtotal (${input.subtotalMinor}) + tax (${input.taxMinor}) ≠ total (${input.totalMinor})`,
      path: 'totalMinor',
      expected: input.subtotalMinor + input.taxMinor,
      actual: input.totalMinor,
    });
  }

  return issues;
}
