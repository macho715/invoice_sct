import { z } from 'zod';
import type { MCP_Verdict } from './types.js';

export const CheckEvidenceRequiredInputSchema = z.object({
  line_id: z.string(),
  charge_code: z.string(),
  sct_code: z.string().nullable(),
  present_evidence: z.array(z.string()).default([])
});

export type CheckEvidenceRequiredInput = z.infer<typeof CheckEvidenceRequiredInputSchema>;

export interface CheckEvidenceRequiredOutput {
  verdict: MCP_Verdict;
  required_evidence: string[];
  present_evidence: string[];
  missing_evidence: string[];
}

const EVIDENCE_MAP: Record<string, string[]> = {
  TRANSPORT: ['BL', 'DN', 'PO'],
  INLAND: ['BL', 'DN', 'PO'],
  DEMURRAGE: ['BL', 'DN', 'DEM_DET_CALC'],
  DETENTION: ['BL', 'DN', 'DEM_DET_CALC'],
  STORAGE: ['DN', 'WAREHOUSE_RECEIPT'],
  STROAGE: ['DN', 'WAREHOUSE_RECEIPT'],
  HANDLING: ['DN', 'LIFT_LOG'],
  THC: ['DN', 'LIFT_LOG'],
  CUSTOMS: ['BOE', 'CUSTOMS_DECL'],
  INSPECTION: ['BOE', 'CUSTOMS_DECL'],
  INSURANCE: ['INSURANCE_CERT'],
  GENERAL: ['DN', 'PO']
};

export async function check_evidence_required(input: CheckEvidenceRequiredInput): Promise<CheckEvidenceRequiredOutput> {
  const required = EVIDENCE_MAP[input.charge_code] ?? EVIDENCE_MAP['GENERAL'];
  const present = input.present_evidence ?? [];
  const missing = required.filter((r) => !present.includes(r));
  let verdict: MCP_Verdict;
  if (missing.length === 0) verdict = 'PASS';
  else if (missing.length <= 1) verdict = 'AMBER';
  else verdict = 'ZERO';
  return { verdict, required_evidence: required, present_evidence: present, missing_evidence: missing };
}
