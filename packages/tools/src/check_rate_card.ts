import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getPool } from '@invoice-audit/database';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'check_rate_card' as const;
export const TOOL_VERSION = '0.3.0';

export const CheckRateCardInputSchema = z.object({
  charge_code: z.string(),
  lane: z.string().nullable(),
  rate_basis: z.string().nullable(),
  effective_date: z.string().nullable(),
  applied_rate: z.number().nullable(),
  // Optional context used to populate the new rate_match_logic.md-aligned fields.
  // All are nullable so existing callers (cf-mcp-client) keep working unchanged.
  charge_description: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  type_b: z.string().nullable().optional(),
  qty: z.number().nullable().optional(),
  rate: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  // DOMESTIC: when set, uses lane-key lookup instead of charge_code
  workflow_type: z.enum(['SHIPMENT', 'DOMESTIC']).nullable().optional(),
});

export type CheckRateCardInput = z.infer<typeof CheckRateCardInputSchema>;

// Rate validation output — extended per rate_match_logic.md §3/§4/§7/§11
// `contract_rate` is the contracted unit rate.
// `applied_rate` is the invoice unit rate. The two are intentionally separate so
// 06_Rate_Check can show variance between them (C1 fix).
export interface CheckRateCardOutput {
  verdict: MCP_Verdict;
  contracted_rate: number | null;
  applied_rate: number | null;
  variance_pct: number | null;
  variance_amount: number | null;
  reason_code: string | null;

  // §3 — Rate_Type taxonomy
  rate_type: 'CONTRACT_NUMERIC' | 'TEXT_EXCEPTION' | 'MISSING_RATE' | null;
  // §11 — AI_Rate_Status (5-state)
  ai_rate_status:
    | 'AUTO_COMPARE_OK'
    | 'AUTO_COMPARE_WITH_DUPLICATE_REVIEW'
    | 'AUTO_COMPARE_REQUIRE_REVIEW_EVIDENCE'
    | 'EXCEPTION_EVIDENCE_REQUIRED'
    | 'MISSING_RATE_NO_AUTO_PASS'
    | null;
  // §2 — Match_Eligible
  match_eligible: 'Y' | 'N' | null;
  // §2 — Contract_Row_ID (deterministic composite key when DB row absent)
  contract_row_id: string | null;
  // §2 — Scope sub-fields
  unit: string | null;
  scope: string | null;
  type_b: string | null;
  // §3.E — Contract validity period (best-effort from DB; null when not stored)
  effective_from: string | null;
  effective_to: string | null;
  // §7 — Evidence_Status (best-effort, 7-value)
  evidence_status:
    | 'MATCHED_EXACT'
    | 'MATCHED_AMOUNT'
    | 'MATCHED_APPROVAL'
    | 'PARTIAL'
    | 'MISSING'
    | 'CONFLICT'
    | 'NOT_APPLICABLE'
    | null;
}

function deriveContractRowId(chargeCode: string, lane: string | null): string {
  // Deterministic composite key (see rate_match_logic.md §2 GPT_Primary_Key).
  // Falls back to a stable hash when DB row not found, so audit citation is always present.
  const composite = `${chargeCode}|${lane ?? ''}`;
  return 'CR-' + createHash('sha256').update(composite, 'utf8').digest('hex').slice(0, 12).toUpperCase();
}

function classifyRateType(opts: {
  contractedRate: number | null;
  appliedRate: number | null;
  basis: string | null;
}): CheckRateCardOutput['rate_type'] {
  // §3.A: CONTRACT_NUMERIC — has numeric contract rate + numeric applied rate
  if (opts.contractedRate !== null && opts.appliedRate !== null) return 'CONTRACT_NUMERIC';
  // §3.D: TEXT_EXCEPTION — basis indicates non-numeric (AT_COST / AS_PER_OFFER / LUMP_SUM)
  if (opts.basis && /AT_COST|AS_PER_OFFER|LUMP_SUM|AT_COST_AFTER_FREE_TIME/i.test(opts.basis)) {
    return 'TEXT_EXCEPTION';
  }
  // §3.E: MISSING_RATE — no contracted rate resolved
  return 'MISSING_RATE';
}

function classifyAiRateStatus(opts: {
  rateType: CheckRateCardOutput['rate_type'];
  variancePct: number | null;
  contractedRate: number | null;
}): CheckRateCardOutput['ai_rate_status'] {
  if (opts.rateType === 'MISSING_RATE') return 'MISSING_RATE_NO_AUTO_PASS';
  if (opts.rateType === 'TEXT_EXCEPTION') return 'EXCEPTION_EVIDENCE_REQUIRED';
  // CONTRACT_NUMERIC — heuristic mapping until DB carries the AI_Rate_Status column.
  if (opts.variancePct === null) return 'AUTO_COMPARE_REQUIRE_REVIEW_EVIDENCE';
  const abs = Math.abs(opts.variancePct);
  if (abs <= 2) return 'AUTO_COMPARE_OK';
  if (abs <= 5) return 'AUTO_COMPARE_WITH_DUPLICATE_REVIEW';
  return 'AUTO_COMPARE_REQUIRE_REVIEW_EVIDENCE';
}

export async function check_rate_card(input: CheckRateCardInput): Promise<CheckRateCardOutput> {
  let contractedRate: number | null = null;
  let effectiveFrom: string | null = null;
  let effectiveTo: string | null = null;
  let matchEligible: 'Y' | 'N' | null = null;
  let unit: string | null = input.unit ?? input.rate_basis ?? null;
  let scope: string | null = input.scope ?? null;
  let typeB: string | null = input.type_b ?? null;
  const isDomestic = input.workflow_type === 'DOMESTIC';

  // Best-effort: select extended columns if they exist. The query is wrapped in
  // a try/catch and falls back to the legacy contract_rate-only SELECT so that
  // pre-migration DBs keep working (Rule #0: never block on schema drift).
  const tryExtended = async (): Promise<boolean> => {
    try {
      const pool = getPool();
      if (isDomestic && input.lane) {
        // DOMESTIC: lookup by composite lane key
        const sql = `SELECT contracted_rate, effective_from, effective_to, match_eligible
                     FROM rate_cards WHERE lane = $1 AND workflow_type = 'DOMESTIC' LIMIT 1`;
        const result = await pool.query<{
          contracted_rate: string | number | null;
          effective_from: string | null;
          effective_to: string | null;
          match_eligible: string | null;
        }>(sql, [input.lane]);
        if (result.rows.length > 0) {
          const row = result.rows[0];
          if (row.contracted_rate != null) {
            contractedRate = typeof row.contracted_rate === 'string' ? Number(row.contracted_rate) : row.contracted_rate;
          }
          effectiveFrom = row.effective_from;
          effectiveTo = row.effective_to;
          matchEligible = (row.match_eligible === 'Y' || row.match_eligible === 'N') ? row.match_eligible : null;
          return true;
        }
        return false;
      }

      const params: (string | null)[] = [input.charge_code];
      let sql = `SELECT contracted_rate, effective_from, effective_to, match_eligible
                 FROM rate_cards WHERE charge_code = $1`;
      if (input.lane) { sql += ` AND lane = $2`; params.push(input.lane); }
      sql += ` LIMIT 1`;
      const result = await pool.query<{
        contracted_rate: string | number | null;
        effective_from: string | null;
        effective_to: string | null;
        match_eligible: string | null;
      }>(sql, params);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        if (row.contracted_rate != null) {
          contractedRate = typeof row.contracted_rate === 'string' ? Number(row.contracted_rate) : row.contracted_rate;
        }
        effectiveFrom = row.effective_from;
        effectiveTo = row.effective_to;
        matchEligible = (row.match_eligible === 'Y' || row.match_eligible === 'N') ? row.match_eligible : null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const extendedOk = await tryExtended();
  if (!extendedOk && contractedRate === null) {
    // Legacy fallback — original SELECT shape
    try {
      const pool = getPool();
      const params: (string | null)[] = [input.charge_code];
      let sql = `SELECT contracted_rate FROM rate_cards WHERE charge_code = $1`;
      if (input.lane) { sql += ` AND lane = $2`; params.push(input.lane); }
      sql += ` LIMIT 1`;
      const result = await pool.query<{ contracted_rate: string | number }>(sql, params);
      if (result.rows.length > 0) {
        const v = result.rows[0].contracted_rate;
        contractedRate = typeof v === 'string' ? Number(v) : v;
      }
    } catch {
      // DB unavailable — treat as missing
    }
  }

  const appliedRate = input.applied_rate;
  const rateType = classifyRateType({ contractedRate, appliedRate, basis: input.rate_basis });

  // NOT_FOUND / NOT_APPLIED — short-circuit with the new fields populated as nulls.
  if (contractedRate === null) {
    return {
      verdict: 'AMBER',
      contracted_rate: null,
      applied_rate: appliedRate,
      variance_pct: null,
      variance_amount: null,
      reason_code: 'RATE_NOT_FOUND',
      rate_type: rateType,
      ai_rate_status: classifyAiRateStatus({ rateType, variancePct: null, contractedRate }),
      match_eligible: matchEligible,
      contract_row_id: deriveContractRowId(input.charge_code, input.lane),
      unit,
      scope,
      type_b: typeB,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      evidence_status: null
    };
  }
  if (appliedRate === null) {
    return {
      verdict: 'AMBER',
      contracted_rate: contractedRate,
      applied_rate: null,
      variance_pct: null,
      variance_amount: null,
      reason_code: 'RATE_NOT_APPLIED',
      rate_type: rateType,
      ai_rate_status: classifyAiRateStatus({ rateType, variancePct: null, contractedRate }),
      match_eligible: matchEligible,
      contract_row_id: deriveContractRowId(input.charge_code, input.lane),
      unit,
      scope,
      type_b: typeB,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      evidence_status: null
    };
  }

  const variancePct = contractedRate !== 0 ? ((appliedRate - contractedRate) / contractedRate) * 100 : 0;
  const varianceAmount = appliedRate - contractedRate;
  const absVariance = Math.abs(variancePct);
  const roundedPct = Math.round(variancePct * 100) / 100;
  const roundedAmount = Math.round(varianceAmount * 100) / 100;
  const aiRateStatus = classifyAiRateStatus({ rateType, variancePct: roundedPct, contractedRate });

  let verdict: MCP_Verdict;
  let reason: string | null;
  if (absVariance <= 2) { verdict = 'PASS'; reason = null; }
  else if (absVariance <= 5) { verdict = 'AMBER'; reason = 'RATE_VARIANCE'; }
  else { verdict = 'ZERO'; reason = 'RATE_EXCEEDS_THRESHOLD'; }

  return {
    verdict,
    contracted_rate: contractedRate,
    applied_rate: appliedRate,
    variance_pct: roundedPct,
    variance_amount: roundedAmount,
    reason_code: reason,
    rate_type: rateType,
    ai_rate_status: aiRateStatus,
    match_eligible: matchEligible,
    contract_row_id: deriveContractRowId(input.charge_code, input.lane),
    unit,
    scope,
    type_b: typeB,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    // §7 — heuristic: numeric within tolerance + row found → MATCHED_AMOUNT (refine later)
    evidence_status: verdict === 'PASS' ? 'MATCHED_AMOUNT' : 'PARTIAL'
  };
}

export interface RateCardBatchEntry {
  charge_code: string;
  contracted_rate: number | null;
  applied_rate: number | null;
  effective_from: string | null;
  effective_to: string | null;
  match_eligible: 'Y' | 'N' | null;
  contract_row_id: string;
}

export async function check_rate_card_batch(chargeCodes: string[]): Promise<Map<string, RateCardBatchEntry>> {
  const result = new Map<string, RateCardBatchEntry>();
  if (chargeCodes.length === 0) return result;

  const uniqueCodes = [...new Set(chargeCodes)];

  const makeEntry = (code: string, row: { contracted_rate: string | number | null; applied_rate: string | number | null; effective_from?: string | null; effective_to?: string | null; match_eligible?: string | null } | null): RateCardBatchEntry | null => {
    if (!row) return null;
    const contracted_rate = row.contracted_rate != null
      ? (typeof row.contracted_rate === 'string' ? Number(row.contracted_rate) : row.contracted_rate)
      : null;
    const applied_rate = row.applied_rate != null
      ? (typeof row.applied_rate === 'string' ? Number(row.applied_rate) : row.applied_rate)
      : null;
    const me = (row.match_eligible === 'Y' || row.match_eligible === 'N') ? row.match_eligible : null;
    return {
      charge_code: code,
      contracted_rate,
      applied_rate,
      effective_from: row.effective_from ?? null,
      effective_to: row.effective_to ?? null,
      match_eligible: me,
      contract_row_id: deriveContractRowId(code, null)
    };
  };

  try {
    const pool = getPool();
    const sql = `SELECT charge_code, contracted_rate, applied_rate, effective_from, effective_to, match_eligible
                 FROM rate_cards WHERE charge_code = ANY($1)`;
    const dbResult = await pool.query<{
      charge_code: string;
      contracted_rate: string | number | null;
      applied_rate: string | number | null;
      effective_from: string | null;
      effective_to: string | null;
      match_eligible: string | null;
    }>(sql, [uniqueCodes]);
    for (const row of dbResult.rows) {
      const entry = makeEntry(row.charge_code, row);
      if (entry) result.set(row.charge_code, entry);
    }
  } catch {
    // Extended columns may not exist — fall through to legacy SELECT
  }

  for (const code of uniqueCodes) {
    if (!result.has(code)) {
      try {
        const pool = getPool();
        const sql = `SELECT contracted_rate, applied_rate, effective_from, effective_to, match_eligible FROM rate_cards WHERE charge_code = $1 LIMIT 1`;
        const dbResult = await pool.query<{
          contracted_rate: string | number | null;
          applied_rate: string | number | null;
          effective_from: string | null;
          effective_to: string | null;
          match_eligible: string | null;
        }>(sql, [code]);
        const entry = makeEntry(code, dbResult.rows[0] ?? null);
        if (entry) result.set(code, entry);
      } catch {
        // skip — code unfound
      }
    }
  }

  return result;
}

export const run = check_rate_card;

export async function run_batch(inputs: CheckRateCardInput[]): Promise<CheckRateCardOutput[]> {
  if (inputs.length === 0) return [];

  const chargeCodes = inputs.map(i => i.charge_code);
  const batch = await check_rate_card_batch(chargeCodes);

  return inputs.map(input => {
    const entry = batch.get(input.charge_code);

    if (!entry || entry.contracted_rate === null) {
      return {
        verdict: 'AMBER',
        contracted_rate: null,
        applied_rate: input.applied_rate,
        variance_pct: null,
        variance_amount: null,
        reason_code: 'RATE_NOT_FOUND',
        rate_type: classifyRateType({ contractedRate: null, appliedRate: input.applied_rate, basis: input.rate_basis }),
        ai_rate_status: classifyAiRateStatus({ rateType: 'MISSING_RATE', variancePct: null, contractedRate: null }),
        match_eligible: entry?.match_eligible ?? null,
        contract_row_id: entry?.contract_row_id ?? deriveContractRowId(input.charge_code, input.lane),
        unit: input.unit ?? input.rate_basis ?? null,
        scope: input.scope ?? null,
        type_b: input.type_b ?? null,
        effective_from: entry?.effective_from ?? null,
        effective_to: entry?.effective_to ?? null,
        evidence_status: null
      };
    }

    const contractedRate = entry.contracted_rate;
    const appliedRate = entry.applied_rate ?? input.applied_rate;

    if (appliedRate === null) {
      return {
        verdict: 'AMBER',
        contracted_rate: contractedRate,
        applied_rate: null,
        variance_pct: null,
        variance_amount: null,
        reason_code: 'RATE_NOT_APPLIED',
        rate_type: classifyRateType({ contractedRate, appliedRate: null, basis: input.rate_basis }),
        ai_rate_status: classifyAiRateStatus({ rateType: 'CONTRACT_NUMERIC', variancePct: null, contractedRate }),
        match_eligible: entry.match_eligible,
        contract_row_id: entry.contract_row_id,
        unit: input.unit ?? input.rate_basis ?? null,
        scope: input.scope ?? null,
        type_b: input.type_b ?? null,
        effective_from: entry.effective_from,
        effective_to: entry.effective_to,
        evidence_status: null
      };
    }

    const variancePct = contractedRate !== 0 ? ((appliedRate - contractedRate) / contractedRate) * 100 : 0;
    const varianceAmount = appliedRate - contractedRate;
    const absVariance = Math.abs(variancePct);
    const roundedPct = Math.round(variancePct * 100) / 100;
    const roundedAmount = Math.round(varianceAmount * 100) / 100;
    const rateType = classifyRateType({ contractedRate, appliedRate, basis: input.rate_basis });
    const aiRateStatus = classifyAiRateStatus({ rateType, variancePct: roundedPct, contractedRate });

    let verdict: MCP_Verdict;
    let reason: string | null;
    if (absVariance <= 2) { verdict = 'PASS'; reason = null; }
    else if (absVariance <= 5) { verdict = 'AMBER'; reason = 'RATE_VARIANCE'; }
    else { verdict = 'ZERO'; reason = 'RATE_EXCEEDS_THRESHOLD'; }

    return {
      verdict,
      contracted_rate: contractedRate,
      applied_rate: appliedRate,
      variance_pct: roundedPct,
      variance_amount: roundedAmount,
      reason_code: reason,
      rate_type: rateType,
      ai_rate_status: aiRateStatus,
      match_eligible: entry.match_eligible,
      contract_row_id: entry.contract_row_id,
      unit: input.unit ?? input.rate_basis ?? null,
      scope: input.scope ?? null,
      type_b: input.type_b ?? null,
      effective_from: entry.effective_from,
      effective_to: entry.effective_to,
      evidence_status: verdict === 'PASS' ? 'MATCHED_AMOUNT' : 'PARTIAL'
    };
  });
}
