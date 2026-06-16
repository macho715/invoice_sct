import { createHash } from 'node:crypto';
import type { InvoiceInput, ValidationIssue } from '../schema';

/**
 * duplicate — 중복 인보이스 + 중복 파일 검증 (PR 1.3)
 *
 * - invoiceNumber+vendorId 정규화 → sha256 → DUPLICATE_INVOICE
 * - file sha256 → DUPLICATE_FILE (인보이스가 한 번 등록된 해시)
 *
 * 결정적 set이 외부에서 주입되어야 in-memory / Neon 양쪽에서 동작.
 * 캐시는 Job store가 아닌 호출자가 관리한다.
 */
export interface DuplicateCheckInput {
  fileHash?: string | null;
  seenInvoiceKeys: Set<string>;
  seenFileHashes: Set<string>;
}

function normalizeInvoiceKey(input: InvoiceInput): string {
  return `${input.invoiceNumber.trim().toLowerCase()}|${input.vendorId.trim().toLowerCase()}`;
}

export function checkDuplicate(
  input: InvoiceInput,
  ctx: DuplicateCheckInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const invoiceKey = normalizeInvoiceKey(input);
  const invoiceKeyHash = createHash('sha256').update(invoiceKey).digest('hex');

  if (ctx.seenInvoiceKeys.has(invoiceKeyHash)) {
    issues.push({
      code: 'DUPLICATE_INVOICE',
      severity: 'error',
      message: `Invoice ${input.invoiceNumber} from vendor ${input.vendorId} already seen`,
      path: 'invoiceNumber',
      expected: 'unique',
      actual: invoiceKeyHash.slice(0, 12),
    });
  } else {
    ctx.seenInvoiceKeys.add(invoiceKeyHash);
  }

  if (input.fileHash) {
    if (ctx.seenFileHashes.has(input.fileHash)) {
      issues.push({
        code: 'DUPLICATE_FILE',
        severity: 'error',
        message: `File hash ${input.fileHash.slice(0, 12)}… already processed`,
        path: 'fileHash',
        expected: 'unique',
        actual: input.fileHash.slice(0, 12),
      });
    } else {
      ctx.seenFileHashes.add(input.fileHash);
    }
  }

  return issues;
}
