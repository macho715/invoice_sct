/**
 * In-process MCP validation tools for the web app.
 *
 * Ported verbatim (logic-identical) from apps/mcp-server/src/tools/* because the
 * repo has no workspace and Vercel builds only apps/web — so the sibling package
 * cannot be imported. Only the 6 tools the invoice-audit validate() flow calls
 * are included. The standalone apps/mcp-server remains for the ChatGPT app.
 *
 * dispatch(name, args) zod-validates input then runs the tool, mirroring
 * apps/mcp-server/src/main.ts /mcp handling (minus the network + DLP guard,
 * which is unnecessary for internal in-process calls).
 */
import { z } from 'zod';
import { getPool } from './db';

// --- route_question -------------------------------------------------------
const RouteQuestionInputSchema = z.object({
  question: z.string(),
  userRole: z.string()
});
const ROUTE_RULES: Array<{ keywords: string[]; routed_to: string; confidence: number }> = [
  { keywords: ['duplicate'], routed_to: 'check_duplicate_invoice', confidence: 0.9 },
  { keywords: ['rate', 'price', 'cost'], routed_to: 'check_rate_card', confidence: 0.85 },
  { keywords: ['contract', 'valid', 'expir'], routed_to: 'check_contract_validity', confidence: 0.85 },
  { keywords: ['evidence', 'document', 'proof'], routed_to: 'check_evidence_required', confidence: 0.85 },
  { keywords: ['vat', 'tax', 'trn'], routed_to: 'check_tax_vat', confidence: 0.9 },
  { keywords: ['fx', 'exchange', 'currency', 'convert'], routed_to: 'check_fx_policy', confidence: 0.85 },
  { keywords: ['shipment', 'bl', 'delivery', 'job'], routed_to: 'match_shipment_reference', confidence: 0.85 },
  { keywords: ['explain', 'reason', 'finding'], routed_to: 'build_validation_explanation', confidence: 0.8 }
];
async function runRouteQuestion(input: z.infer<typeof RouteQuestionInputSchema>) {
  const q = input.question.toLowerCase();
  const roleLower = input.userRole.toLowerCase();
  const bonus = roleLower.includes('finance') || roleLower.includes('approver') ? 0.05 : 0;
  for (const rule of ROUTE_RULES) {
    if (rule.keywords.some((kw) => q.includes(kw))) {
      return {
        routed_to: rule.routed_to,
        confidence: Math.min(1.0, Math.round((rule.confidence + bonus) * 100) / 100),
        rationale: `Keyword match → ${rule.routed_to}`
      };
    }
  }
  return {
    routed_to: 'check_cost_guard',
    confidence: Math.min(1.0, Math.round((0.5 + bonus) * 100) / 100),
    rationale: 'Default route: cost guard analysis'
  };
}

// --- classify_type_b ------------------------------------------------------
const ClassifyTypeBInputSchema = z.object({
  line_id: z.string(),
  description: z.string()
});
type TypeBCategory = 'INSPECTION' | 'CUSTOMS' | 'DO' | 'INLAND' | 'THC' | 'DETENTION' | 'STROAGE' | 'OTHERS';
const TYPE_B_RULES: Array<{ category: TypeBCategory; keywords: string[] }> = [
  { category: 'INSPECTION', keywords: ['customs inspection', 'inspection by customs', 'customs inspection fee'] },
  { category: 'CUSTOMS', keywords: ['customs clearance', 'bill of entry', 'boe', 'customs duty', 'export customs', 'import customs', 'customs documentation', 'shj customs', 'code opening', 'customs gate pass'] },
  { category: 'DO', keywords: ['master do', 'house do', 'delivery order', 'do fee', 'document delivery order'] },
  { category: 'INLAND', keywords: ['transport', 'truck', 'trucking', 'inland', 'fb from', 'cipca', 'mosb', 'road freight', 'appointment charge'] },
  { category: 'THC', keywords: ['terminal handling', 'port handling', 'thc', 'tsc', 'discharging', 'loading', 'unloading', 'berth', 'stevedoring'] },
  { category: 'DETENTION', keywords: ['container detention', 'line detention', 'detention'] },
  { category: 'STROAGE', keywords: ['warehouse storage', 'yard storage', 'port storage', 'storage', 'stroage'] }
];
async function runClassifyTypeB(input: z.infer<typeof ClassifyTypeBInputSchema>) {
  const normalized = input.description.toLowerCase();
  for (const rule of TYPE_B_RULES) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword)) {
        const isExact = normalized === keyword || normalized.split(/\s+/).some((w) => w === keyword);
        return { line_id: input.line_id, type_b: rule.category, confidence: isExact ? 0.95 : 0.85, matched_keyword: keyword };
      }
    }
  }
  return { line_id: input.line_id, type_b: 'OTHERS' as TypeBCategory, confidence: 0.5, matched_keyword: null };
}

// --- check_cost_guard -----------------------------------------------------
const CheckCostGuardInputSchema = z.object({
  invoiceNo: z.string(),
  currency: z.enum(['AED', 'USD']),
  lines: z.array(
    z.object({
      lineNo: z.string(),
      item: z.string(),
      qty: z.number(),
      rate: z.number(),
      draftAmount: z.number(),
      standardAmount: z.number().nullable(),
      currency: z.enum(['AED', 'USD']),
      evidenceIds: z.array(z.string())
    })
  )
});
const AMOUNT_EPSILON = 0.01;
const VARIANCE_THRESHOLD = 2;
async function runCheckCostGuard(input: z.infer<typeof CheckCostGuardInputSchema>) {
  const line_findings = input.lines.map((line) => {
    const qty_x_rate = line.qty * line.rate;
    if (Math.abs(qty_x_rate - line.draftAmount) > AMOUNT_EPSILON) {
      return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: null, reason_code: 'QTY_X_RATE_MISMATCH' };
    }
    if (line.standardAmount !== null && line.standardAmount > 0) {
      const std_variance_pct = ((line.draftAmount - line.standardAmount) / line.standardAmount) * 100;
      if (Math.abs(std_variance_pct) > VARIANCE_THRESHOLD) {
        return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: Math.round(std_variance_pct * 100) / 100, reason_code: 'COST_VARIANCE_EXCEEDS_2PCT' };
      }
      return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: Math.round(std_variance_pct * 100) / 100, reason_code: null };
    }
    if (line.standardAmount === null) {
      return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: null, reason_code: 'STANDARD_RATE_NOT_AVAILABLE' };
    }
    return { lineNo: line.lineNo, qty_x_rate, draftAmount: line.draftAmount, standardAmount: line.standardAmount, variance_pct: null, reason_code: null };
  });
  let verdict: 'PASS' | 'AMBER' | 'ZERO' = 'PASS';
  for (const finding of line_findings) {
    if (finding.reason_code === 'QTY_X_RATE_MISMATCH') { verdict = 'ZERO'; break; }
    if (finding.reason_code === 'COST_VARIANCE_EXCEEDS_2PCT' || finding.reason_code === 'STANDARD_RATE_NOT_AVAILABLE') { verdict = 'AMBER'; }
  }
  return { verdict, line_findings };
}

// --- check_evidence_required ----------------------------------------------
const CheckEvidenceRequiredInputSchema = z.object({
  line_id: z.string(),
  charge_code: z.string(),
  sct_code: z.string().nullable(),
  present_evidence: z.array(z.string()).default([])
});
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
async function runCheckEvidenceRequired(input: z.infer<typeof CheckEvidenceRequiredInputSchema>) {
  const required = EVIDENCE_MAP[input.charge_code] ?? EVIDENCE_MAP['GENERAL'];
  const present = input.present_evidence ?? [];
  const missing = required.filter((r) => !present.includes(r));
  let verdict: 'PASS' | 'AMBER' | 'ZERO';
  if (missing.length === 0) verdict = 'PASS';
  else if (missing.length <= 1) verdict = 'AMBER';
  else verdict = 'ZERO';
  return { verdict, required_evidence: required, present_evidence: present, missing_evidence: missing };
}

// --- check_hs_uae_compliance ----------------------------------------------
const CheckHsUaeComplianceInputSchema = z.object({
  line_id: z.string(),
  charge_code: z.string(),
  hs_code: z.string().nullable(),
  evidence_docs: z.array(z.string()).default([])
});
const BOE_PATTERNS = [/BOE/i, /Bill of Entry/i, /customs declaration/i, /CUSTOMS_DECL/i];
async function runCheckHsUaeCompliance(input: z.infer<typeof CheckHsUaeComplianceInputSchema>) {
  if (input.charge_code !== 'CUSTOMS') {
    return { verdict: 'PASS' as const, boe_found: false, hs_code_valid: null, reason_code: null };
  }
  const boe_found = input.evidence_docs.some((doc) => BOE_PATTERNS.some((p) => p.test(doc)));
  if (!boe_found) return { verdict: 'ZERO' as const, boe_found: false, hs_code_valid: null, reason_code: 'CUSTOMS_BOE_MISSING' };
  if (input.hs_code === null) return { verdict: 'AMBER' as const, boe_found: true, hs_code_valid: null, reason_code: 'CUSTOMS_HS_CODE_MISSING' };
  const normalized = input.hs_code.replace(/\./g, '');
  const hs_code_valid = /^\d+$/.test(normalized) && normalized.length >= 4 && normalized.length <= 10;
  if (!hs_code_valid) return { verdict: 'AMBER' as const, boe_found: true, hs_code_valid: false, reason_code: 'CUSTOMS_HS_CODE_INVALID' };
  return { verdict: 'PASS' as const, boe_found: true, hs_code_valid: true, reason_code: null };
}

// --- check_rate_card (DB-backed) ------------------------------------------
const CheckRateCardInputSchema = z.object({
  charge_code: z.string(),
  lane: z.string().nullable(),
  rate_basis: z.string().nullable(),
  effective_date: z.string().nullable(),
  applied_rate: z.number().nullable()
});
async function runCheckRateCard(input: z.infer<typeof CheckRateCardInputSchema>) {
  let contractedRate: number | null = null;
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
    return { verdict: 'AMBER' as const, contracted_rate: null, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_FOUND' };
  }
  if (contractedRate === null) return { verdict: 'AMBER' as const, contracted_rate: null, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_FOUND' };
  const appliedRate = input.applied_rate;
  if (appliedRate === null) return { verdict: 'AMBER' as const, contracted_rate: contractedRate, applied_rate: null, variance_pct: null, reason_code: 'RATE_NOT_APPLIED' };
  const variancePct = contractedRate !== 0 ? ((appliedRate - contractedRate) / contractedRate) * 100 : 0;
  const absVariance = Math.abs(variancePct);
  const rounded = Math.round(variancePct * 100) / 100;
  if (absVariance <= 2) return { verdict: 'PASS' as const, contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: null };
  if (absVariance <= 5) return { verdict: 'AMBER' as const, contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: 'RATE_VARIANCE' };
  return { verdict: 'ZERO' as const, contracted_rate: contractedRate, applied_rate: appliedRate, variance_pct: rounded, reason_code: 'RATE_EXCEEDS_THRESHOLD' };
}

// --- registry + dispatch --------------------------------------------------
type ToolEntry = { input: z.ZodTypeAny; run: (args: unknown) => Promise<unknown> };

const TOOLS: Record<string, ToolEntry> = {
  route_question: { input: RouteQuestionInputSchema, run: (a) => runRouteQuestion(a as never) },
  classify_type_b: { input: ClassifyTypeBInputSchema, run: (a) => runClassifyTypeB(a as never) },
  check_cost_guard: { input: CheckCostGuardInputSchema, run: (a) => runCheckCostGuard(a as never) },
  check_evidence_required: { input: CheckEvidenceRequiredInputSchema, run: (a) => runCheckEvidenceRequired(a as never) },
  check_hs_uae_compliance: { input: CheckHsUaeComplianceInputSchema, run: (a) => runCheckHsUaeCompliance(a as never) },
  check_rate_card: { input: CheckRateCardInputSchema, run: (a) => runCheckRateCard(a as never) }
};

/**
 * Validate args against the tool's zod schema, then run it. Throws on unknown
 * tool or invalid input — callers in cf-mcp-client wrap non-critical tools in
 * try/catch so a single tool failure degrades gracefully.
 */
export async function dispatch<T = unknown>(name: string, args: unknown): Promise<T> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid params for ${name}: ${parsed.error.message}`);
  }
  return (await tool.run(parsed.data)) as T;
}

export const MCP_TOOL_NAMES = Object.keys(TOOLS);
