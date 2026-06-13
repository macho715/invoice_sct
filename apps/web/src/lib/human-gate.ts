import type { Job } from './job-store';
import type { NormalizedInvoice, SctValidationResult, HumanGateTrigger } from './types';
import type { GateResultLite } from './job-store';

export function evaluateHumanGateTriggers(
  job: Job,
  normalized: NormalizedInvoice | undefined,
  validation: SctValidationResult | undefined,
  result: GateResultLite | undefined
): HumanGateTrigger[] {
  const triggers: HumanGateTrigger[] = [];

  const invoiceTotal = normalized?.invoice_header?.invoice_total ?? 0;
  const currency = normalized?.invoice_header?.currency ?? 'AED';
  const totalInAed = currency === 'USD' ? invoiceTotal * 3.6725 : invoiceTotal;

  // Trigger 1: invoiceTotal >= 100,000.00 AED
  if (totalInAed >= 100000.0) {
    triggers.push({
      trigger_id: 'HGT_01',
      name: 'High-Value Invoice Gate',
      severity: 'ZERO',
      status: 'PENDING',
      required_role: 'FINANCE_APPROVER',
      resolved_by: null,
      resolved_at: null
    });
  }

  // Trigger 2: CostGuard band in {HIGH, CRITICAL}
  const hasHighOrCritical = validation?.costguard_results?.some(
    c => c.band === 'HIGH' || c.band === 'CRITICAL'
  ) || result?.line_results?.some(
    l => l.band === 'HIGH' || l.band === 'CRITICAL'
  );
  if (hasHighOrCritical) {
    triggers.push({
      trigger_id: 'HGT_02',
      name: 'CostGuard High/Critical Band Gate',
      severity: 'ZERO',
      status: 'PENDING',
      required_role: 'COST_CONTROL_LEAD,FINANCE_APPROVER',
      resolved_by: null,
      resolved_at: null
    });
  }

  // Trigger 3: Rate reference missing (rate_status = UNKNOWN)
  const hasUnknownRate = normalized?.invoice_lines?.some(
    l => l.rate_status === 'UNKNOWN'
  ) || validation?.rate_checks?.some(
    c => c.rate_status === 'UNKNOWN'
  );
  if (hasUnknownRate) {
    triggers.push({
      trigger_id: 'HGT_03',
      name: 'Rate Reference Missing Gate',
      severity: 'AMBER',
      status: 'PENDING',
      required_role: 'COST_CONTROL_LEAD',
      resolved_by: null,
      resolved_at: null
    });
  }

  // Trigger 4: FX override requested
  const hasFxOverride = validation?.costguard_results?.some(
    c => (c as any).fx_override === true
  ) || (job as any).fx_override === true;
  if (hasFxOverride) {
    triggers.push({
      trigger_id: 'HGT_04',
      name: 'FX Override Requested Gate',
      severity: 'ZERO',
      status: 'PENDING',
      required_role: 'FINANCE_APPROVER',
      resolved_by: null,
      resolved_at: null
    });
  }

  // Trigger 5: AGI/DAS marine charge w/o M115/M116/M117
  const hasMosbBlock = validation?.reason_codes?.includes('MOSB_EVIDENCE_MISSING') ||
                       validation?.doc_guardian_results?.some(r => r.code === 'MOSB_EVIDENCE_MISSING') ||
                       result?.action_items?.some(a => a.issue_type === 'MOSB_EVIDENCE_MISSING');
  if (hasMosbBlock) {
    triggers.push({
      trigger_id: 'HGT_05',
      name: 'Marine Closing Evidence Gate',
      severity: 'ZERO',
      status: 'PENDING',
      required_role: 'MARINE_LEAD',
      resolved_by: null,
      resolved_at: null
    });
  }

  // Trigger 6: WH charge w/o WHP/WH event
  const hasWarehouseIssue = normalized?.invoice_lines?.some(
    l => l.evidence_status === 'MISSING' && 
         (l.for_charge_component === 'WAREHOUSE_HANDLING' || l.for_charge_component === 'WAREHOUSE_STORAGE')
  );
  if (hasWarehouseIssue) {
    triggers.push({
      trigger_id: 'HGT_06',
      name: 'Warehouse Event Evidence Missing Gate',
      severity: 'AMBER',
      status: 'PENDING',
      required_role: 'WAREHOUSE_MANAGER',
      resolved_by: null,
      resolved_at: null
    });
  }

  // Trigger 7: Compliance evidence missing
  const hasComplianceMissing = validation?.evidence_requirements?.some(
    r => r.required_evidence?.includes('COMPLIANCE') && 
         normalized?.invoice_lines?.find(l => l.line_id === r.line_id)?.evidence_status === 'MISSING'
  );
  if (hasComplianceMissing) {
    triggers.push({
      trigger_id: 'HGT_07',
      name: 'Compliance Evidence Missing Gate',
      severity: 'ZERO',
      status: 'PENDING',
      required_role: 'COMPLIANCE_LEAD',
      resolved_by: null,
      resolved_at: null
    });
  }

  // Trigger 8: OCR/parser confidence < 0.95
  const confidence = normalized?.parser_confidence ?? 1.0;
  if (confidence < 0.95) {
    triggers.push({
      trigger_id: 'HGT_08',
      name: 'Low Parser Confidence Gate',
      severity: 'AMBER',
      status: 'PENDING',
      required_role: 'DOCUMENT_CONTROLLER',
      resolved_by: null,
      resolved_at: null
    });
  }

  return triggers;
}
