import { RATE_MANIFEST_VERSION, type RateReferenceProvider } from '../rateReferenceProvider';
import type { InvoiceInput, ValidationIssue } from '../schema';

/**
 * rateReference — 요율 참조 규칙 (PR 4)
 *
 * PR 4에서 `RateReferenceProvider`를 통해 실제 요율 조회를 수행한다.
 * - 조회 실패 (null 반환) → RATE_NOT_FOUND warning
 * - 단가 mismatch (Δ > 2%) → RATE_MISMATCH warning (AMBER 등급)
 * - Δ ≤ 2% → RATE_OK info
 *
 * 호출:
 *   checkRateReference(input, provider, workflowType)
 *
 * `workflowType`:
 *   - 'SHIPMENT' → serviceCode = line.charge_code
 *   - 'DOMESTIC' → serviceCode = line.charge_code (domestic lane은 composite)
 *
 * Manifest version stamp:
 *   검증 결과의 rate_manifest_version에 RATE_MANIFEST_VERSION을
 *   노출하기 위해, 호출자가 `returnedManifestVersion`를 사용할 수 있다.
 *
 * @see PLAN_20260616_160103.md PR 4
 */

export interface RateReferenceResult {
  issues: ValidationIssue[];
  returnedManifestVersion: string | null;
}

const VARIANCE_WARN_PCT = 2.0;

export async function checkRateReference(
  input: InvoiceInput,
  provider: RateReferenceProvider,
  workflowType: 'SHIPMENT' | 'DOMESTIC' = 'SHIPMENT',
): Promise<RateReferenceResult> {
  const issues: ValidationIssue[] = [];
  const issueDate = input.issueDate;
  let seenManifest: string | null = null;

  for (const line of input.lines) {
    if (line.amount == null || line.rate_basis == null) {
      issues.push({
        code: 'RATE_NOT_FOUND',
        severity: 'warning',
        message: `Line ${line.line_id}: missing amount or rate_basis — provider lookup skipped`,
        path: `lines.${line.line_id}.amount`,
        expected: 'defined',
        actual: line.amount ?? null,
      });
      continue;
    }

    const lookup = await provider.getExecutedRate({
      vendorId: input.vendorId,
      laneCode: line.shipment_ref ?? 'UNKNOWN',
      serviceCode: line.for_charge_component ?? 'UNKNOWN',
      effectiveDate: issueDate,
      currency: line.currency,
      workflowType,
    });

    if (lookup === null) {
      issues.push({
        code: 'RATE_NOT_FOUND',
        severity: 'warning',
        message: `Line ${line.line_id}: no rate card for charge=${line.for_charge_component} lane=${line.shipment_ref} on ${issueDate}`,
        path: `lines.${line.line_id}.rate`,
        expected: 'rate card row',
        actual: null,
      });
      continue;
    }

    if (seenManifest === null) seenManifest = lookup.manifestVersion;

    // Compare: line.amount is in major units; lookup.amountMinor is cents/fil.
    const lineAmountMinor = Math.round(line.amount * 100);
    if (lineAmountMinor === lookup.amountMinor) {
      // Exact match — no issue.
      continue;
    }

    const varianceMinor = lineAmountMinor - lookup.amountMinor;
    const variancePct = lookup.amountMinor !== 0
      ? (varianceMinor / lookup.amountMinor) * 100
      : 0;
    if (Math.abs(variancePct) > VARIANCE_WARN_PCT) {
      issues.push({
        code: 'RATE_MISMATCH',
        severity: 'warning',
        message: `Line ${line.line_id}: rate variance ${variancePct.toFixed(2)}% > ${VARIANCE_WARN_PCT}% (contracted=${lookup.amountMinor / 100} ${lookup.currency}, applied=${line.amount})`,
        path: `lines.${line.line_id}.rate`,
        expected: `${lookup.amountMinor / 100} ${lookup.currency}`,
        actual: line.amount,
      });
    }
  }

  return {
    issues,
    returnedManifestVersion: seenManifest ?? RATE_MANIFEST_VERSION,
  };
}
