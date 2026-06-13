import { z } from 'zod';
import { getPool } from '../db.js';

export const ToolName = 'match_shipment_reference' as const;
export const TOOL_VERSION = '0.2.0';

export const MatchShipmentReferenceInputSchema = z.object({
  shipment_ref: z.string().nullable(),
  job_number: z.string().nullable(),
  bl_number: z.string().nullable(),
  do_number: z.string().nullable()
});

export const MatchShipmentReferenceOutputSchema = z.object({
  verdict: z.enum(['PASS', 'AMBER', 'ZERO']),
  matches: z.array(
    z.object({
      shipment_ref: z.string(),
      confidence: z.number().min(0).max(1),
      matched_via: z.enum(['shipment_ref', 'job_number', 'bl_number', 'do_number'])
    })
  )
});

export type MatchShipmentReferenceInput = z.infer<typeof MatchShipmentReferenceInputSchema>;
export type MatchShipmentReferenceOutput = z.infer<typeof MatchShipmentReferenceOutputSchema>;

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

export async function run(input: MatchShipmentReferenceInput): Promise<MatchShipmentReferenceOutput> {
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

  const matches = providedFields.map((field) => ({
    shipment_ref: input[field] as string,
    confidence: FIELD_CONFIDENCE[field] ?? 0.5,
    matched_via: field as 'shipment_ref' | 'job_number' | 'bl_number' | 'do_number',
  }));

  const allFieldsProvided = providedFields.length === FIELD_ORDER.length;

  if (allFieldsProvided) {
    return { verdict: 'PASS', matches };
  }

  return { verdict: 'AMBER', matches };
}
