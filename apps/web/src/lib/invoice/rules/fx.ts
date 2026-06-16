import type { InvoiceInput, ValidationIssue } from '../schema';
import { CurrencySchema } from '@invoice-audit/contracts/invoice';

/**
 * fx — 통화 + FX 정책 (PR 1.3)
 *
 * - CurrencySchema 위반 → UNSUPPORTED_CURRENCY
 * - dueDate < issueDate → DUE_DATE_BEFORE_ISSUE_DATE
 * - 라인별 currency가 invoice 통화와 다른 경우 (현재 CurrencySchema는 AED/USD만)
 *   → FX_RATE_MISSING (Track 1 KRW, Track 2 AED/USD 정책)
 */
const SUPPORTED_CURRENCIES = CurrencySchema.options; // ['AED', 'USD']

function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function checkFx(input: InvoiceInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1) invoice currency must be in allowlist
  if (!SUPPORTED_CURRENCIES.includes(input.currency)) {
    issues.push({
      code: 'UNSUPPORTED_CURRENCY',
      severity: 'error',
      message: `Currency ${input.currency} not in allowlist ${SUPPORTED_CURRENCIES.join(', ')}`,
      path: 'currency',
      expected: SUPPORTED_CURRENCIES.join('|'),
      actual: input.currency,
    });
  }

  // 2) dueDate >= issueDate
  if (input.dueDate && isISODate(input.issueDate) && isISODate(input.dueDate)) {
    if (input.dueDate < input.issueDate) {
      issues.push({
        code: 'DUE_DATE_BEFORE_ISSUE_DATE',
        severity: 'error',
        message: `dueDate ${input.dueDate} is before issueDate ${input.issueDate}`,
        path: 'dueDate',
        expected: '>= issueDate',
        actual: input.dueDate,
      });
    }
  }

  // 3) per-line currency check (line.currency는 optional)
  for (const line of input.lines) {
    const lineCurrency = line.currency;
    if (lineCurrency && !SUPPORTED_CURRENCIES.includes(lineCurrency)) {
      issues.push({
        code: 'UNSUPPORTED_CURRENCY',
        severity: 'error',
        message: `Line ${line.line_id} currency ${lineCurrency} not in allowlist`,
        path: `lines.${line.line_id}.currency`,
        expected: SUPPORTED_CURRENCIES.join('|'),
        actual: lineCurrency,
      });
      continue;
    }
    // FX required if line currency != invoice currency
    if (lineCurrency && lineCurrency !== input.currency) {
      issues.push({
        code: 'FX_RATE_MISSING',
        severity: 'warning',
        message: `Line ${line.line_id} currency ${lineCurrency} differs from invoice ${input.currency}; FX rate required`,
        path: `lines.${line.line_id}.currency`,
        expected: input.currency,
        actual: lineCurrency,
      });
    }
  }

  return issues;
}
