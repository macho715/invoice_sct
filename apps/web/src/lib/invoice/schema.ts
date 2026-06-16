import { z } from 'zod';
import {
  InvoiceLineSchema as ContractInvoiceLineSchema,
  CurrencySchema,
  VerdictSchema,
  type Currency,
  type InvoiceLine,
} from '@invoice-audit/contracts/invoice';

/**
 * lib/invoice — 인보이스 검증 코어 스키마 (PR 1)
 *
 * 기존 `packages/contracts/invoice.schema.ts`의 `InvoiceLineSchema`는
 * Track 2 파서/Export 시트 계약(04_Line_View / 06_Rate_Check)에 강하게 결합되어 있어
 * 검증 레이어 전용으로 그대로 재사용한다. 중복 정의 금지.
 *
 * Track 1(Python)·Track 2(MVP) 공통 entrypoint — `validateInvoice()`.
 *
 * @see PLAN_20260616_160103.md PR 1
 * @see patch_g.md §"핵심 문제 3: 스키마 모듈들이 검증기에 직접 연결되지 않음"
 */

// Re-export canonical line schema so downstream rules don't need to
// depend on the contracts package directly.
export const InvoiceLineSchema = ContractInvoiceLineSchema;
export type { InvoiceLine, Currency };

export const MoneyMinorSchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: CurrencySchema,
});
export type MoneyMinor = z.infer<typeof MoneyMinorSchema>;

export const InvoiceInputSchema = z.object({
  invoiceNumber: z.string().min(1),
  vendorId: z.string().min(1),
  vendorName: z.string().min(1),
  issueDate: z.string().min(1),     // YYYY-MM-DD
  dueDate: z.string().min(1).optional(),
  currency: CurrencySchema,
  subtotalMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  lines: z.array(InvoiceLineSchema).min(1),
});
export type InvoiceInput = z.infer<typeof InvoiceInputSchema>;

export const ValidationIssueCodeSchema = z.enum([
  'REQUIRED_FIELD_MISSING',
  'TOTAL_MISMATCH',
  'TAX_MISMATCH',
  'DUPLICATE_INVOICE',
  'DUPLICATE_FILE',
  'RATE_NOT_FOUND',
  'RATE_MISMATCH',
  'LANE_NOT_FOUND',
  'FX_RATE_MISSING',
  'UNSUPPORTED_CURRENCY',
  'DUE_DATE_BEFORE_ISSUE_DATE',
]);
export type ValidationIssueCode = z.infer<typeof ValidationIssueCodeSchema>;

export const ValidationSeveritySchema = z.enum(['error', 'warning', 'info']);
export type ValidationSeverity = z.infer<typeof ValidationSeveritySchema>;

export const ValidationIssueSchema = z.object({
  code: ValidationIssueCodeSchema,
  severity: ValidationSeveritySchema,
  message: z.string(),
  path: z.string().optional(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  issues: z.array(ValidationIssueSchema),
  /** Versioned validator identifier — persisted in invoice_audit_logs. */
  validatorVersion: z.string(),
  /** Optional rate manifest version (PR 4) — nullish for backward compat. */
  rateManifestVersion: z.string().nullish(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/** Default validator version. Bump on breaking rule changes. */
export const VALIDATOR_VERSION = '1.0.0';

export { CurrencySchema, VerdictSchema };
