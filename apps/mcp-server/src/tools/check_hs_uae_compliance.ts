import { z } from 'zod';

export const ToolName = 'check_hs_uae_compliance' as const;
export const TOOL_VERSION = '0.1.0';

export const CheckHsUaeComplianceInputSchema = z.object({
  line_id: z.string(),
  charge_code: z.string(),
  hs_code: z.string().nullable(),
  evidence_docs: z.array(z.string()).default([])
});

export const CheckHsUaeComplianceOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  boe_found: z.boolean(),
  hs_code_valid: z.boolean().nullable(),
  reason_code: z.string().nullable()
});

export type CheckHsUaeComplianceInput = z.infer<typeof CheckHsUaeComplianceInputSchema>;
export type CheckHsUaeComplianceOutput = z.infer<typeof CheckHsUaeComplianceOutputSchema>;

const BOE_PATTERNS = [/BOE/i, /Bill of Entry/i, /customs declaration/i, /CUSTOMS_DECL/i];
const HS_CODE_REGEX = /^\d{4}(\.\d{2,6})?$/;

export async function run(input: CheckHsUaeComplianceInput): Promise<CheckHsUaeComplianceOutput> {
  if (input.charge_code !== 'CUSTOMS') {
    return {
      verdict: 'PASS',
      boe_found: false,
      hs_code_valid: null,
      reason_code: null
    };
  }

  const boe_found = input.evidence_docs.some(doc =>
    BOE_PATTERNS.some(pattern => pattern.test(doc))
  );

  if (!boe_found) {
    return {
      verdict: 'ZERO',
      boe_found: false,
      hs_code_valid: null,
      reason_code: 'CUSTOMS_BOE_MISSING'
    };
  }

  if (input.hs_code === null) {
    return {
      verdict: 'AMBER',
      boe_found: true,
      hs_code_valid: null,
      reason_code: 'CUSTOMS_HS_CODE_MISSING'
    };
  }

  const normalized = input.hs_code.replace(/\./g, '');
  const numericOnly = /^\d+$/.test(normalized);
  const validLength = normalized.length >= 4 && normalized.length <= 10;
  const hs_code_valid = numericOnly && validLength;

  if (!hs_code_valid) {
    return {
      verdict: 'AMBER',
      boe_found: true,
      hs_code_valid: false,
      reason_code: 'CUSTOMS_HS_CODE_INVALID'
    };
  }

  return {
    verdict: 'PASS',
    boe_found: true,
    hs_code_valid: true,
    reason_code: null
  };
}
