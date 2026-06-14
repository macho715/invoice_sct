import { z } from 'zod';
import type { MCP_Verdict } from './types.js';

export const CheckHsUaeComplianceInputSchema = z.object({
  line_id: z.string(),
  charge_code: z.string(),
  hs_code: z.string().nullable(),
  evidence_docs: z.array(z.string()).default([])
});

export type CheckHsUaeComplianceInput = z.infer<typeof CheckHsUaeComplianceInputSchema>;

export interface CheckHsUaeComplianceOutput {
  verdict: MCP_Verdict;
  boe_found: boolean;
  hs_code_valid: boolean | null;
  reason_code: string | null;
}

const BOE_PATTERNS = [/BOE/i, /Bill of Entry/i, /customs declaration/i, /CUSTOMS_DECL/i];

export async function check_hs_uae_compliance(input: CheckHsUaeComplianceInput): Promise<CheckHsUaeComplianceOutput> {
  if (input.charge_code !== 'CUSTOMS') {
    return { verdict: 'PASS', boe_found: false, hs_code_valid: null, reason_code: null };
  }
  const boe_found = input.evidence_docs.some((doc) => BOE_PATTERNS.some((p) => p.test(doc)));
  if (!boe_found) return { verdict: 'ZERO', boe_found: false, hs_code_valid: null, reason_code: 'CUSTOMS_BOE_MISSING' };
  if (input.hs_code === null) return { verdict: 'AMBER', boe_found: true, hs_code_valid: null, reason_code: 'CUSTOMS_HS_CODE_MISSING' };
  const normalized = input.hs_code.replace(/\./g, '');
  const hs_code_valid = /^\d+$/.test(normalized) && normalized.length >= 4 && normalized.length <= 10;
  if (!hs_code_valid) return { verdict: 'AMBER', boe_found: true, hs_code_valid: false, reason_code: 'CUSTOMS_HS_CODE_INVALID' };
  return { verdict: 'PASS', boe_found: true, hs_code_valid: true, reason_code: null };
}
