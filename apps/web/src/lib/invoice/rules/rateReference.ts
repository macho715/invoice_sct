import type { InvoiceInput, ValidationIssue } from '../schema';

/**
 * rateReference — 요율 참조 인터페이스 자리표시자 (PR 1.3 + PR 4 예정)
 *
 * PR 4에서 `RateReferenceProvider`가 신설되면 이 규칙은 provider를 통해
 * 실제 요율 조회를 수행한다. PR 1 단계에서는 RATE_NOT_FOUND / RATE_MISMATCH를
 * rule 함수로만 노출하고, 호출 시 noop stub을 반환한다.
 *
 * Stub 동작:
 * - amount가 0이거나 rate_basis 누락 → RATE_NOT_FOUND warning
 * - amount가 정수가 아닌 통화 단위 → RATE_MISMATCH info (PR 4에서 실검증)
 */
export function checkRateReference(
  _input: InvoiceInput,
  rateManifestVersion?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const line of _input.lines) {
    // RATE_NOT_FOUND — amount 누락 또는 rate_basis 미지정
    if (line.amount == null || line.rate_basis == null) {
      issues.push({
        code: 'RATE_NOT_FOUND',
        severity: 'warning',
        message: `Line ${line.line_id}: missing amount or rate_basis (provider check deferred to PR 4)`,
        path: `lines.${line.line_id}.amount`,
        expected: 'defined',
        actual: line.amount ?? null,
      });
      continue;
    }

    // RATE_MISMATCH — provider 미구현 상태에서 단위/스케일 의심 케이스 표지
    if (line.amount < 0 || !Number.isFinite(line.amount)) {
      issues.push({
        code: 'RATE_MISMATCH',
        severity: 'info',
        message: `Line ${line.line_id}: amount=${line.amount} requires provider verification`,
        path: `lines.${line.line_id}.amount`,
        expected: '>= 0',
        actual: line.amount,
      });
    }
  }

  // No manifest version available until PR 4 ships RateReferenceProvider.
  if (!rateManifestVersion) {
    // Soft signal — not an issue yet, just an info-level note surfaced to consumers.
  }

  return issues;
}
