import { z } from 'zod';
import type { MCP_Verdict } from './types.js';

export const ToolName = 'domestic_lane_check' as const;
export const TOOL_VERSION = '0.1.0';

export const DomesticLaneCheckInputSchema = z.object({
  lines: z.array(z.object({
    line_id: z.string(),
    origin: z.string().nullable().optional(),
    destination: z.string().nullable().optional(),
    vehicle: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    distance_km: z.number().nullable().optional(),
    invoiced_rate: z.number().nullable().optional(),
    ref_rate: z.number().nullable().optional(),
    shipment_ref: z.string().nullable().optional(),
  }))
});

export type DomesticLaneCheckInput = z.infer<typeof DomesticLaneCheckInputSchema>;

export interface DomesticLaneLineResult {
  line_id: string;
  lane_key: string | null;
  distance_km: number | null;
  rate_band: 'SHORT_RUN' | 'STANDARD' | 'LONG_HAUL' | 'UNKNOWN';
  short_run_flag: boolean;
  fixed_cost_suspect: boolean;
  delta_pct: number | null;
  cg_band: 'PASS' | 'WARN' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  verdict: MCP_Verdict;
  reason_code: string | null;
  risk_score: number | null;
  rbr_trigger: boolean;
}

export interface DomesticLaneCheckOutput {
  line_results: DomesticLaneLineResult[];
  summary: {
    total: number;
    short_run_count: number;
    fixed_cost_suspect_count: number;
    lanes_missing: number;
    band_pass: number;
    band_warn: number;
    band_high: number;
    band_critical: number;
    band_unknown: number;
  };
}

const SHORT_RUN_THRESH_KM = 10;
const FIXED_COST_SUSPECT_KM = 2;
const SHORT_RUN_BAND_KM = 50;
const LONG_HAUL_BAND_KM = 300;
const BAND_PASS_PCT = 2;
const BAND_WARN_PCT = 5;
const BAND_HIGH_PCT = 10;
const AUTFAIL_PCT = 15;
const RBR_DELTA_WEIGHT = 0.4;
const RBR_TRIGGER_THRESH = 0.8;

function buildLaneKey(origin: string | null | undefined, destination: string | null | undefined, vehicle: string | null | undefined, unit: string | null | undefined): string | null {
  const parts = [origin || '', destination || '', vehicle || '', unit || ''];
  if (parts.every(p => !p)) return null;
  return parts.map(p => p.trim().toUpperCase()).join('||');
}

function absPctDiff(a: number, b: number): number | null {
  if (b === 0 || b == null || a == null) return null;
  return Math.abs((a - b) / b) * 100;
}

function bandOfDelta(delta: number | null): DomesticLaneLineResult['cg_band'] {
  if (delta === null) return 'UNKNOWN';
  const abs = Math.abs(delta);
  if (abs <= BAND_PASS_PCT) return 'PASS';
  if (abs <= BAND_WARN_PCT) return 'WARN';
  if (abs <= BAND_HIGH_PCT) return 'HIGH';
  return 'CRITICAL';
}

function cgBandToVerdict(band: DomesticLaneLineResult['cg_band'], delta: number | null): MCP_Verdict {
  if (band === 'UNKNOWN') return 'AMBER';
  if (band === 'CRITICAL' && delta !== null && Math.abs(delta) > AUTFAIL_PCT) return 'ZERO';
  if (band === 'HIGH' || band === 'CRITICAL') return 'AMBER';
  return 'PASS';
}

function computeRiskScore(delta: number | null): number {
  if (delta === null) return 0;
  return Math.min(1.0, Math.abs(delta) / AUTFAIL_PCT) * RBR_DELTA_WEIGHT;
}

export async function domestic_lane_check(input: DomesticLaneCheckInput): Promise<DomesticLaneCheckOutput> {
  const line_results: DomesticLaneLineResult[] = [];
  let shortRunCount = 0;
  let fixedCostSuspectCount = 0;
  let lanesMissing = 0;
  const bandCounts = { PASS: 0, WARN: 0, HIGH: 0, CRITICAL: 0, UNKNOWN: 0 };

  for (const line of input.lines) {
    const laneKey = buildLaneKey(line.origin, line.destination, line.vehicle, line.unit);
    const distance = typeof line.distance_km === 'number' ? line.distance_km : null;

    const isShortRun = distance !== null && distance <= SHORT_RUN_THRESH_KM;
    const isFixedCostSuspect = distance !== null && distance <= FIXED_COST_SUSPECT_KM;

    let rateBand: DomesticLaneLineResult['rate_band'];
    if (distance === null) {
      rateBand = 'UNKNOWN';
    } else if (distance <= SHORT_RUN_BAND_KM) {
      rateBand = 'SHORT_RUN';
    } else if (distance > LONG_HAUL_BAND_KM) {
      rateBand = 'LONG_HAUL';
    } else {
      rateBand = 'STANDARD';
    }

    if (isShortRun) shortRunCount++;
    if (isFixedCostSuspect) fixedCostSuspectCount++;
    if (!laneKey) lanesMissing++;

    const delta = (line.invoiced_rate != null && line.ref_rate != null)
      ? absPctDiff(line.invoiced_rate, line.ref_rate)
      : null;
    const roundedDelta = delta !== null ? Math.round(delta * 100) / 100 : null;
    const band = bandOfDelta(delta);
    const verdict = laneKey ? cgBandToVerdict(band, delta) : 'AMBER';
    const riskScore = delta !== null ? Math.round(computeRiskScore(delta) * 100) / 100 : null;
    const rbrTrigger = riskScore !== null && riskScore >= RBR_TRIGGER_THRESH;

    bandCounts[band]++;

    let reasonCode: string | null = null;
    if (!laneKey) reasonCode = 'DOMESTIC_LANE_MISSING';
    else if (band === 'HIGH') reasonCode = 'DOMESTIC_RATE_HIGH';
    else if (band === 'CRITICAL') reasonCode = 'DOMESTIC_RATE_CRITICAL';
    if (isShortRun) reasonCode = reasonCode ? `${reasonCode}_SHORT_RUN` : 'DOMESTIC_SHORT_RUN';
    if (isFixedCostSuspect) reasonCode = reasonCode ? `${reasonCode}_FIXED_SUSPECT` : 'DOMESTIC_FIXED_COST_SUSPECT';

    line_results.push({
      line_id: line.line_id,
      lane_key: laneKey,
      distance_km: distance,
      rate_band: rateBand,
      short_run_flag: isShortRun,
      fixed_cost_suspect: isFixedCostSuspect,
      delta_pct: roundedDelta,
      cg_band: band,
      verdict,
      reason_code: reasonCode,
      risk_score: riskScore,
      rbr_trigger: rbrTrigger,
    });
  }

  return {
    line_results,
    summary: {
      total: input.lines.length,
      short_run_count: shortRunCount,
      fixed_cost_suspect_count: fixedCostSuspectCount,
      lanes_missing: lanesMissing,
      band_pass: bandCounts.PASS,
      band_warn: bandCounts.WARN,
      band_high: bandCounts.HIGH,
      band_critical: bandCounts.CRITICAL,
      band_unknown: bandCounts.UNKNOWN,
    }
  };
}

export const run = domestic_lane_check;
