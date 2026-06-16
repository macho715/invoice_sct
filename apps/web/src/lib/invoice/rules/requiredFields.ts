import { InvoiceInputSchema, type InvoiceInput, type ValidationIssue } from '../schema';

/**
 * requiredFields — 스키마 파싱 + 필수 필드 누락 검증 (PR 1.3)
 *
 * Zod의 safeParse로 입력 스키마 검증 → 누락 필드는 REQUIRED_FIELD_MISSING.
 * InvoiceInput.lines는 min(1) — 0개 라인은 별도 경로.
 */
export function checkRequiredFields(input: unknown): {
  parsed: InvoiceInput | null;
  issues: ValidationIssue[];
} {
  const result = InvoiceInputSchema.safeParse(input);
  if (result.success) {
    return { parsed: result.data, issues: [] };
  }
  const issues: ValidationIssue[] = result.error.issues.map((z) => ({
    code: 'REQUIRED_FIELD_MISSING',
    severity: 'error',
    message: z.message,
    path: z.path.join('.'),
    expected: 'defined',
    actual: z.code === 'invalid_type' ? 'undefined' : z.code,
  }));
  return { parsed: null, issues };
}
