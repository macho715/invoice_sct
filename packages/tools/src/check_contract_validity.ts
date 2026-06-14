import { z } from 'zod';
import { getPool } from '@invoice-audit/database';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_contract_validity' as const;
export const TOOL_VERSION = '0.2.0';

export const CheckContractValidityInputSchema = z.object({
  vendor_hash: z.string(),
  contract_id: z.string().nullable(),
  check_date: z.string()
});

export type CheckContractValidityInput = z.infer<typeof CheckContractValidityInputSchema>;

export interface CheckContractValidityOutput {
  verdict: MCP_Verdict;
  contract_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  reason_code: string | null;
}

function toDateStr(d: Date | string): string {
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
}

export async function check_contract_validity(
  input: CheckContractValidityInput
): Promise<CheckContractValidityOutput> {
  let contractRow: {
    contract_id: string;
    valid_from: Date | string;
    valid_to: Date | string;
  } | null = null;

  try {
    const pool = getPool();
    const params: string[] = [input.vendor_hash];
    let sql = `SELECT contract_id, valid_from, valid_to FROM contracts WHERE vendor_hash = $1`;

    if (input.contract_id) {
      sql += ` AND contract_id = $2`;
      params.push(input.contract_id);
    }

    sql += ` LIMIT 1`;

    const result = await pool.query<{
      contract_id: string;
      valid_from: Date | string;
      valid_to: Date | string;
    }>(sql, params);

    if (result.rows.length > 0) {
      contractRow = result.rows[0];
    }
  } catch {
    return {
      verdict: 'ZERO',
      contract_id: input.contract_id,
      valid_from: null,
      valid_to: null,
      reason_code: 'CONTRACT_NOT_FOUND',
    };
  }

  if (!contractRow) {
    return {
      verdict: 'ZERO',
      contract_id: input.contract_id,
      valid_from: null,
      valid_to: null,
      reason_code: 'CONTRACT_NOT_FOUND',
    };
  }

  const validFrom = toDateStr(contractRow.valid_from);
  const validTo = toDateStr(contractRow.valid_to);
  const checkDate = input.check_date.slice(0, 10);

  if (checkDate < validFrom) {
    return {
      verdict: 'ZERO',
      contract_id: contractRow.contract_id,
      valid_from: validFrom,
      valid_to: validTo,
      reason_code: 'CONTRACT_NOT_YET_ACTIVE',
    };
  }

  if (checkDate > validTo) {
    return {
      verdict: 'ZERO',
      contract_id: contractRow.contract_id,
      valid_from: validFrom,
      valid_to: validTo,
      reason_code: 'CONTRACT_EXPIRED',
    };
  }

  return {
    verdict: 'PASS',
    contract_id: contractRow.contract_id,
    valid_from: validFrom,
    valid_to: validTo,
    reason_code: null,
  };
}

export const run = check_contract_validity;
