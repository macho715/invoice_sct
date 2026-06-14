import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getPool } from '@invoice-audit/database';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_duplicate_invoice' as const;
export const TOOL_VERSION = '0.2.0';

const AMOUNT_EPSILON = 0.01;

export const CheckDuplicateInvoiceInputSchema = z.object({
  vendor_hash: z.string().optional(),
  invoice_no_hash: z.string().optional(),
  vendor_id: z.string().optional(),
  vendor_name: z.string().optional(),
  invoice_no: z.string().optional(),
  amount: z.number(),
  issue_date: z.string().nullable().optional()
});

export type CheckDuplicateInvoiceInput = z.infer<typeof CheckDuplicateInvoiceInputSchema>;

export interface DuplicateRecord {
  invoice_id: string;
  job_id: string;
  vendor_hash: string;
  invoice_no_hash: string;
  amount: number;
  currency: string | null;
  issue_date: string | null;
  created_at: string;
}

export interface CheckDuplicateInvoiceOutput {
  verdict: MCP_Verdict;
  duplicates: DuplicateRecord[];
  reason_code: 'DUPLICATE_INVOICE' | 'AMOUNT_MISMATCH' | null;
}

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
  const invoiceNoHash =
    input.invoice_no_hash ??
    (input.invoice_no !== undefined ? sha256(input.invoice_no) : undefined);

  if (!vendorHash || !invoiceNoHash) {
    throw new Error(
      'check_duplicate_invoice requires either (vendor_hash, invoice_no_hash) or (vendor_id, vendor_name, invoice_no).'
    );
  }
  return { vendorHash, invoiceNoHash };
}

export async function check_duplicate_invoice(
  input: CheckDuplicateInvoiceInput
): Promise<CheckDuplicateInvoiceOutput> {
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

  const duplicates: DuplicateRecord[] = result.rows.map((row) => ({
    invoice_id: row.invoice_id,
    job_id: row.job_id,
    vendor_hash: row.vendor_hash,
    invoice_no_hash: row.invoice_no_hash,
    amount: typeof row.amount === 'string' ? Number(row.amount) : row.amount,
    currency: row.currency,
    issue_date:
      row.issue_date instanceof Date ? row.issue_date.toISOString().slice(0, 10) : row.issue_date,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  }));

  const allAmountsMatch = duplicates.every(
    (d) => Math.abs(d.amount - input.amount) <= AMOUNT_EPSILON
  );

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

export const run = check_duplicate_invoice;
