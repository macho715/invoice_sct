import { z } from 'zod';

export const ToolName = 'check_evidence_required' as const;
export const TOOL_VERSION = '0.2.0';

export const CheckEvidenceRequiredInputSchema = z.object({
  line_id: z.string(),
  charge_code: z.string(),
  sct_code: z.string().nullable(),
  present_evidence: z.array(z.string()).default([])
});

export const CheckEvidenceRequiredOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  required_evidence: z.array(z.string()),
  present_evidence: z.array(z.string()),
  missing_evidence: z.array(z.string())
});

export type CheckEvidenceRequiredInput = z.infer<typeof CheckEvidenceRequiredInputSchema>;
export type CheckEvidenceRequiredOutput = z.infer<typeof CheckEvidenceRequiredOutputSchema>;

const EVIDENCE_MAP: Record<string, string[]> = {
  TRANSPORT: ['BL', 'DN', 'PO'],
  DEMURRAGE: ['BL', 'DN', 'DEM_DET_CALC'],
  DETENTION: ['BL', 'DN', 'DEM_DET_CALC'],
  STORAGE: ['DN', 'WAREHOUSE_RECEIPT'],
  HANDLING: ['DN', 'LIFT_LOG'],
  CUSTOMS: ['BOE', 'CUSTOMS_DECL'],
  INSURANCE: ['INSURANCE_CERT'],
  GENERAL: ['DN', 'PO']
};

export async function run(input: CheckEvidenceRequiredInput): Promise<CheckEvidenceRequiredOutput> {
  const required = EVIDENCE_MAP[input.charge_code] ?? EVIDENCE_MAP['GENERAL'];
  const present = input.present_evidence ?? [];
  const missing = required.filter(r => !present.includes(r));

  if (missing.length === 0) {
    return { verdict: 'PASS', required_evidence: required, present_evidence: present, missing_evidence: missing };
  }

  if (missing.length <= 1) {
    return { verdict: 'AMBER', required_evidence: required, present_evidence: present, missing_evidence: missing };
  }

  return { verdict: 'ZERO', required_evidence: required, present_evidence: present, missing_evidence: missing };
}
