import { z } from 'zod';

export const ToolName = 'normalize_invoice_lines' as const;
export const TOOL_VERSION = '0.2.0';

export const NormalizeInvoiceLinesInputSchema = z.object({
  lines: z.array(
    z.object({
      line_id: z.string(),
      description: z.string(),
      qty: z.number().nullable(),
      rate: z.number().nullable(),
      amount: z.number(),
      currency: z.enum(['AED', 'USD'])
    })
  )
});

export const NormalizeInvoiceLinesOutputSchema = z.object({
  normalized_lines: z.array(
    z.object({
      line_id: z.string(),
      charge_code: z.string().nullable(),
      unit: z.string().nullable(),
      qty: z.number().nullable(),
      rate: z.number().nullable(),
      amount: z.number(),
      currency: z.enum(['AED', 'USD'])
    })
  ),
  rejected_count: z.number().int().nonnegative()
});

export type NormalizeInvoiceLinesInput = z.infer<typeof NormalizeInvoiceLinesInputSchema>;
export type NormalizeInvoiceLinesOutput = z.infer<typeof NormalizeInvoiceLinesOutputSchema>;

const CHARGE_CODE_MAP: Array<{ keywords: string[]; code: string }> = [
  { keywords: ['transport', 'freight', 'haulage'], code: 'TRANSPORT' },
  { keywords: ['demurrage', 'dem'], code: 'DEMURRAGE' },
  { keywords: ['detention', 'det'], code: 'DETENTION' },
  { keywords: ['storage', 'wharf'], code: 'STORAGE' },
  { keywords: ['handling', 'load', 'unload', 'crane'], code: 'HANDLING' },
  { keywords: ['customs', 'clearance', 'boe'], code: 'CUSTOMS' },
  { keywords: ['insurance'], code: 'INSURANCE' },
];

const UNIT_MAP: Record<string, string> = {
  TRANSPORT: 'TEU',
  HANDLING: 'LIFT',
};

function inferChargeCode(description: string): string {
  const lower = description.toLowerCase();
  for (const rule of CHARGE_CODE_MAP) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.code;
    }
  }
  return 'GENERAL';
}

function inferUnit(chargeCode: string): string {
  return UNIT_MAP[chargeCode] ?? 'LS';
}

export async function run(input: NormalizeInvoiceLinesInput): Promise<NormalizeInvoiceLinesOutput> {
  let rejectedCount = 0;

  const normalizedLines = input.lines.map((line) => {
    if (line.qty === null && line.rate === null) {
      rejectedCount++;
    }

    const chargeCode = inferChargeCode(line.description);
    const unit = inferUnit(chargeCode);

    return {
      line_id: line.line_id,
      charge_code: chargeCode,
      unit,
      qty: line.qty,
      rate: line.rate,
      amount: line.amount,
      currency: line.currency
    };
  });

  return {
    normalized_lines: normalizedLines,
    rejected_count: rejectedCount
  };
}
