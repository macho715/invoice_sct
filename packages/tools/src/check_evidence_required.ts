import { z } from 'zod';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_evidence_required' as const;
export const TOOL_VERSION = '0.2.0';

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

const EVIDENCE_ALIASES: Record<string, RegExp[]> = {
  BL: [/\bBL\b/i, /bill of lading/i],
  DN: [/\bDN\b/i, /delivery note/i, /dispatch note/i],
  PO: [/\bPO\b/i, /purchase order/i],
  BOE: [/\bBOE\b/i, /bill of entry/i],
  CUSTOMS_DECL: [/customs declaration/i, /customs proof/i],
  DEM_DET_CALC: [/demurrage/i, /detention/i, /free\s*time/i, /tariff/i],
  WAREHOUSE_RECEIPT: [/warehouse receipt/i, /storage invoice/i],
  LIFT_LOG: [/lift log/i, /terminal invoice/i, /port invoice/i],
  INSURANCE_CERT: [/insurance cert/i, /insurance certificate/i]
};

function hasEvidence(required: string, present: string[]): boolean {
  const aliases = EVIDENCE_ALIASES[required] ?? [new RegExp(`\\b${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')];
  return present.some((doc) => aliases.some((pattern) => pattern.test(doc)));
}

export async function check_evidence_required(input: CheckEvidenceRequiredInput): Promise<CheckEvidenceRequiredOutput> {
  const required = EVIDENCE_MAP[input.charge_code] ?? EVIDENCE_MAP['GENERAL'];
  const present = input.present_evidence ?? [];
  const missing = required.filter((r) => !hasEvidence(r, present));
  let verdict: MCP_Verdict;
  if (missing.length === 0) verdict = 'PASS';
  else if (missing.length <= 1) verdict = 'AMBER';
  else verdict = 'ZERO';
  return { verdict, required_evidence: required, present_evidence: present, missing_evidence: missing };
}

export const run = check_evidence_required;
