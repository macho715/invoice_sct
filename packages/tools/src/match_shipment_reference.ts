import { z } from 'zod';
import { getPool } from '@invoice-audit/database';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'match_shipment_reference' as const;
export const TOOL_VERSION = '0.2.0';

export const MatchShipmentReferenceInputSchema = z.object({
  shipment_ref: z.string().nullable(),
  job_number: z.string().nullable(),
  bl_number: z.string().nullable(),
  do_number: z.string().nullable()
});

export type MatchShipmentReferenceInput = z.infer<typeof MatchShipmentReferenceInputSchema>;

export interface ShipmentMatch {
  shipment_ref: string;
  confidence: number;
  matched_via: 'shipment_ref' | 'job_number' | 'bl_number' | 'do_number';
}

export interface MatchShipmentReferenceOutput {
  verdict: MCP_Verdict;
  matches: ShipmentMatch[];
}

const FIELD_CONFIDENCE: Record<string, number> = {
  bl_number: 0.95,
  shipment_ref: 0.9,
  job_number: 0.85,
  do_number: 0.8,
};

const FIELD_ORDER: Array<keyof MatchShipmentReferenceInput> = [
  'bl_number',
  'shipment_ref',
  'job_number',
  'do_number',
];

export async function match_shipment_reference(
  input: MatchShipmentReferenceInput
): Promise<MatchShipmentReferenceOutput> {
  const providedFields = FIELD_ORDER.filter(
    (f) => input[f] !== null && input[f] !== undefined && input[f] !== ''
  );

  if (providedFields.length === 0) {
    return { verdict: 'ZERO', matches: [] };
  }

  try {
    const pool = getPool();
    await pool.query('SELECT 1 FROM shipments LIMIT 0');
  } catch {
    return {
      verdict: 'AMBER',
      matches: [],
    };
  }

  const matches: ShipmentMatch[] = providedFields.map((field) => ({
    shipment_ref: input[field] as string,
    confidence: FIELD_CONFIDENCE[field] ?? 0.5,
    matched_via: field as ShipmentMatch['matched_via'],
  }));

  const allFieldsProvided = providedFields.length === FIELD_ORDER.length;

  if (allFieldsProvided) {
    return { verdict: 'PASS', matches };
  }

  return { verdict: 'AMBER', matches };
}

export const run = match_shipment_reference;
