/**
 * check_duplicate_invoice: Detects duplicate invoices by vendor + invoice_no + amount.
 *
 * Verdict policy
 *   - PASS  : no prior row matches (vendor_hash, invoice_no_hash)
 *   - ZERO  : at least one prior row matches AND the amount is within ±0.01
 *   - AMBER : at least one prior row matches BUT the amount differs by more than
 *             ±0.01 (likely re-issued invoice with a different total — needs
 *             reviewer attention but is not a hard duplicate).
 *
 * P2 / DLP: callers MUST mask vendor_id, vendor_name and invoice_no to hashes
 * before invoking this tool. The tool itself never sees raw PII; the DB stores
 * only hashes (see migrations/0010_invoices.sql).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getPool } from '../db.js';

export const ToolName = 'check_duplicate_invoice' as const;
export const TOOL_VERSION = '0.2.0';

// Tolerance for "same amount" comparison. Anything beyond this triggers AMBER.
const AMOUNT_EPSILON = 0.01;

export const CheckDuplicateInvoiceInputSchema = z.object({
  // Pre-computed hashes (preferred for production callers).
  vendor_hash: z.string().optional(),
  invoice_no_hash: z.string().optional(),

  // Raw identifiers — the tool will hash them on the way in. Both must be
  // provided together when using this path.
  vendor_id: z.string().optional(),
  vendor_name: z.string().optional(),
  invoice_no: z.string().optional(),

  // Amount / date of the current invoice under audit.
  amount: z.number(),
  issue_date: z.string().nullable().optional()
});

export const CheckDuplicateInvoiceOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  duplicates: z.array(
    z.object({
      invoice_id: z.string(),
      job_id: z.string(),
      vendor_hash: z.string(),
      invoice_no_hash: z.string(),
      amount: z.number(),
      currency: z.string().nullable(),
      issue_date: z.string().nullable(),
      created_at: z.string()
    })
  ),
  reason_code: z.enum(['DUPLICATE_INVOICE', 'AMOUNT_MISMATCH']).nullable()
});

export type CheckDuplicateInvoiceInput = z.infer<typeof CheckDuplicateInvoiceInputSchema>;
export type CheckDuplicateInvoiceOutput = z.infer<typeof CheckDuplicateInvoiceOutputSchema>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function resolveHashes(
  input: CheckDuplicateInvoiceInput
): { vendorHash: string; invoiceNoHash: string } {
  const vendorHash =
    input.vendor_hash ??
    (input.vendor_id !== undefined && input.vendor_name !== undefined
      ? sha256(`${input.vendor_id}|${input.vendor_name}`)
      : undefined);
  const invoiceNoHash = input.invoice_no_hash ?? (input.invoice_no !== undefined ? sha256(input.invoice_no) : undefined);

  if (!vendorHash || !invoiceNoHash) {
    throw new Error(
      'check_duplicate_invoice requires either (vendor_hash, invoice_no_hash) or (vendor_id, vendor_name, invoice_no).'
    );
  }
  return { vendorHash, invoiceNoHash };
}

export async function run(input: CheckDuplicateInvoiceInput): Promise<CheckDuplicateInvoiceOutput> {
  const { vendorHash, invoiceNoHash } = resolveHashes(input);

  const pool = getPool();

  const result = await pool.query<{
    invoice_id: string;
    job_id: string;
    vendor_hash: string;
    invoice_no_hash: string;
    amount: string | number;
    currency: string | null;
    issue_date: Date | string | null;
    created_at: Date | string;
  }>(
    `SELECT invoice_id, job_id, vendor_hash, invoice_no_hash, amount, currency, issue_date, created_at
       FROM invoices
      WHERE vendor_hash = $1 AND invoice_no_hash = $2`,
    [vendorHash, invoiceNoHash]
  );

  if (result.rows.length === 0) {
    return {
      verdict: 'PASS',
      duplicates: [],
      reason_code: null
    };
  }

  const duplicates = result.rows.map((row) => ({
    invoice_id: row.invoice_id,
    job_id: row.job_id,
    vendor_hash: row.vendor_hash,
    invoice_no_hash: row.invoice_no_hash,
    amount: typeof row.amount === 'string' ? Number(row.amount) : row.amount,
    currency: row.currency,
    issue_date:
      row.issue_date instanceof Date ? row.issue_date.toISOString().slice(0, 10) : row.issue_date,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  }));

  const allAmountsMatch = duplicates.every((d) => Math.abs(d.amount - input.amount) <= AMOUNT_EPSILON);

  if (allAmountsMatch) {
    return {
      verdict: 'ZERO',
      duplicates,
      reason_code: 'DUPLICATE_INVOICE'
    };
  }

  return {
    verdict: 'AMBER',
    duplicates,
    reason_code: 'AMOUNT_MISMATCH'
  };
}
