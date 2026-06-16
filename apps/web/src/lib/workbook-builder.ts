import { STORE } from './job-store';
import type { AuditDetailRow, ExportRequest } from './types';

export async function buildExportRequest(jobId: string, generatedAt?: string): Promise<ExportRequest> {
  const job = await STORE.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const result = await STORE.getResult(jobId);
  if (!result) {
    throw new Error(`Result not ready for job: ${jobId}`);
  }

  const normalized = await STORE.getNormalizedInvoice(jobId);
  const validation = await STORE.getValidationResult(jobId);
  const approval = await STORE.getApprovalRecord(jobId);
  const parseSourceData = await STORE.getParseSourceData(jobId);

  // Source-hash verification trace recorded by the run route
  // (attributedTo 'run-route:source-hash-check'). Its output_ref carries the
  // SOURCE_HASH_MATCH / HASH_UNVERIFIED / SOURCE_HASH_MISMATCH status that the
  // manifest and audit-detail rows below surface. Absent on legacy jobs where
  // the check never ran → HASH_UNVERIFIED (honest "could not verify").
  const auditTraces = await STORE.listTrace(jobId);
  const sourceHashTrace = auditTraces.find(t => t.attributedTo === 'run-route:source-hash-check');
  const sourceHashStatus = sourceHashTrace?.output_ref ?? 'HASH_UNVERIFIED';

  const lines = normalized?.invoice_lines ?? [];
  const actionItems = result.action_items ?? [];

  // Count band severity
  let zeroCount = 0;
  let amberCount = 0;
  const bandCounts: Record<string, number> = { PASS: 0, WARN: 0, HIGH: 0, CRITICAL: 0 };
  
  if (result.line_results) {
    for (const lr of result.line_results) {
      if (lr.verdict === 'ZERO') zeroCount++;
      if (lr.verdict === 'AMBER') amberCount++;
      if (lr.band) {
        bandCounts[lr.band] = (bandCounts[lr.band] || 0) + 1;
      }
    }
  }

  const costguardBandSummary = `PASS: ${bandCounts.PASS || 0}, WARN: ${bandCounts.WARN || 0}, HIGH: ${bandCounts.HIGH || 0}, CRITICAL: ${bandCounts.CRITICAL || 0}`;

  // 1. Decision Row
  const decision_rows = [
    {
      job_id: job.job_id,
      verdict: job.verdict ?? 'FAILED',
      approved_by: approval?.approved_by ?? null,
      approved_at: approval?.approved_at ?? null,
      rule_version: job.rule_version,
      parser_version: job.parser_version,
      final_recon_status: 'PENDING', // Will be calculated after final recon rows
      zero_count: zeroCount,
      amber_count: amberCount,
      prism_kernel_proof_ref: approval?.prism_kernel_proof_ref ?? null,
      costguard_band_summary: costguardBandSummary,
      watermark: approval ? 'SCT_AUDIT_APPROVED' : 'SCT_AUDIT_DRAFT',
      generated_at: generatedAt ?? null
    }
  ];

  // 2. Action Items
  const action_items_rows = actionItems.map(a => {
    const matchedLine = lines.find(l => l.line_id === a.line_id);
    const matchedCostGuard = validation?.costguard_results?.find(c => c.line_id === a.line_id);
    return {
      action_id: a.action_id,
      severity: a.severity,
      shipment_ref: matchedLine?.shipment_ref ?? null,
      line_id: a.line_id,
      issue_type: a.issue_type,
      required_action: a.required_action,
      owner_role: a.severity === 'ZERO' ? 'FINANCE_APPROVER' : 'COST_CONTROL_LEAD',
      status: 'PENDING',
      prism_kernel_proof_ref: matchedCostGuard?.prism_kernel_proof_ref ?? null
    };
  });

  // Helper function to safely parse numeric values
  const safeNum = (val: unknown): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const p = parseFloat(val);
      return isNaN(p) ? 0 : p;
    }
    return 0;
  };

  // 3. Final Recon Rows (grouped by currency and shipment_ref)
  const finalReconMap = new Map<string, {
    currency: string;
    shipment_ref: string | null;
    invoice_total: number;
    reviewed_total: number;
    variance: number;
    variance_pct: number;
    recon_status: string;
    evidence_ref: string | null;
  }>();

  for (const line of lines) {
    const key = `${line.currency}|${line.shipment_ref ?? ''}`;
    
    // Calculate difference (overcharge amount)
    const matchedCostGuard = validation?.costguard_results?.find(c => c.line_id === line.line_id);
    const deltaPct = matchedCostGuard?.delta_pct != null ? safeNum(matchedCostGuard.delta_pct) : 0;
    const diff = deltaPct > 0 ? line.amount * (deltaPct / 100) : 0;
    const reviewedAmt = line.amount - diff;

    if (!finalReconMap.has(key)) {
      finalReconMap.set(key, {
        currency: line.currency,
        shipment_ref: line.shipment_ref ?? null,
        invoice_total: 0,
        reviewed_total: 0,
        variance: 0,
        variance_pct: 0,
        recon_status: 'PENDING',
        evidence_ref: matchedCostGuard?.prism_kernel_proof_ref ?? null
      });
    }

    const entry = finalReconMap.get(key)!;
    entry.invoice_total += line.amount;
    entry.reviewed_total += reviewedAmt;
  }

  const final_recon_rows = Array.from(finalReconMap.values()).map(r => {
    const variance = r.invoice_total - r.reviewed_total;
    const variance_pct = r.invoice_total > 0 ? (variance / r.invoice_total) * 100 : 0;
    const recon_status = variance === 0 ? 'MATCHED' : 'MISMATCH';
    return {
      ...r,
      variance,
      variance_pct,
      recon_status
    };
  });

  // Update final_recon_status in Decision Row
  const anyMismatch = final_recon_rows.some(r => r.recon_status === 'MISMATCH');
  decision_rows[0].final_recon_status = final_recon_rows.length === 0 ? 'PENDING' : (anyMismatch ? 'MISMATCH' : 'MATCHED');

  // 4. Line View Rows
  const line_view_rows = lines.map(line => {
    const matchedCostGuard = validation?.costguard_results?.find(c => c.line_id === line.line_id);
    const deltaPct = matchedCostGuard?.delta_pct != null ? safeNum(matchedCostGuard.delta_pct) : null;
    const diff = deltaPct && deltaPct > 0 ? line.amount * (deltaPct / 100) : 0;

    const matchedRate = validation?.rate_checks?.find(r => r.line_id === line.line_id);
    const matchedGate = validation?.gate_results?.find(g => g.line_id === line.line_id);
    const matchedTypeB = validation?.type_b_results?.find(t => t.line_id === line.line_id);
    const matchedNormalized = validation?.normalized_lines?.find(n => n.line_id === line.line_id);
    const matchedEvidenceFinding = validation?.doc_guardian_results?.find(d => d.line_id === line.line_id);
    const matchedEvidenceRequirement = validation?.evidence_requirements?.find(e => e.line_id === line.line_id);
    const evidenceStatus = line.evidence_status
      ?? (matchedEvidenceFinding?.severity === 'ZERO' ? 'MISSING'
        : matchedEvidenceFinding?.severity === 'AMBER' ? 'PARTIAL'
        : matchedEvidenceRequirement ? 'MATCHED'
        : null);

    return {
      line_id: line.line_id,
      shipment_ref: line.shipment_ref ?? null,
      description: line.description,
      for_charge_component: line.for_charge_component ?? matchedNormalized?.charge_code ?? matchedTypeB?.type_b ?? null,
      type_b: line.type_b ?? matchedTypeB?.type_b ?? null,
      amount: line.amount,
      currency: line.currency,
      rate_source: line.rate_source_candidate ?? null,
      rate_status: matchedRate?.rate_status ?? null,
      validity_status: matchedRate?.validity_status ?? null,
      evidence_status: evidenceStatus,
      gate_status: matchedGate?.gate_status ?? null,
      band: matchedCostGuard?.band ?? null,
      delta_pct: deltaPct,
      numeric_integrity_status: line.numeric_integrity_status ?? null,
      difference: diff,
      formula_text: line.source_ref?.formula_text ?? null
    };
  });

  // 5. Source Data Rows
  const evidenceSourceRows = (normalized?.evidence_candidates ?? []).map(candidate => {
    return {
      file_id: candidate.source_file_id,
      source_ref: candidate.matched_reference ?? null,
      original_text: candidate.text_span ?? null,
      normalized_value: candidate.matched_reference ?? null,
      confidence: candidate.confidence,
      routing_pattern: 'ONTOLOGY_SEARCH',
      pdf_page: null,
      text_span_hash: null,
      doc_type: null,
      shipment_id: null,
      gate_score: null,
      gate_status: null,
      is_portal_fee: null
    };
  });
  const source_data_rows = [...evidenceSourceRows, ...parseSourceData];

  // 6. Audit Detail Rows
  const audit_detail_rows: AuditDetailRow[] = lines.map(line => {
    const matchedCostGuard = validation?.costguard_results?.find(c => c.line_id === line.line_id);
    const tc = validation?.cf_mcp_tool_calls?.find(t => t.tool === 'check_cost_guard');
    const matchedGate = result.line_results?.find(lr => lr.line_id === line.line_id);
    
    return {
      line_id: line.line_id,
      rule_id: matchedCostGuard ? `CG_RULE_${matchedCostGuard.band}` : 'CG_RULE_UNKNOWN',
      reason_code: matchedGate?.reason_codes?.[0] ?? 'OK',
      sct_trace_id: validation?.sct_trace_id ?? 'trace_unknown',
      cf_mcp_tool: tc?.tool ?? 'check_cost_guard',
      cf_mcp_latency_ms: tc?.latency_ms ?? null,
      confidence: validation?.confidence ?? 1.0,
      decision_input: `line_description: ${line.description}, amount: ${line.amount}, currency: ${line.currency}`,
      fx_override: null,
      fx_policy_id: null
    };
  });

  for (const item of actionItems) {
    if (item.issue_type === 'SOURCE_HASH_MISMATCH' || item.issue_type === 'HASH_UNVERIFIED') {
      audit_detail_rows.push({
        line_id: item.line_id ?? '',
        rule_id: 'SOURCE_HASH_CHECK',
        reason_code: item.issue_type,
        sct_trace_id: sourceHashTrace?.trace_id ?? 'trace_source_hash_missing',
        cf_mcp_tool: null,
        cf_mcp_latency_ms: null,
        confidence: item.issue_type === 'SOURCE_HASH_MISMATCH' ? 1.0 : 0.0,
        decision_input: `expected_sha256:${sourceHashTrace?.source_hash ?? 'unknown'}; actual_sha256:${sourceHashTrace?.calculation_hash ?? 'unknown'}`,
        fx_override: null,
        fx_policy_id: null
      });
    }
  }

  // 7. Evidence Issues Rows
  const evidence_issues_rows = (validation?.evidence_requirements ?? []).map(req => {
    const matchedLine = lines.find(l => l.line_id === req.line_id);
    const matchedAction = actionItems.find(a => a.line_id === req.line_id);
    
    return {
      line_id: req.line_id,
      required_evidence: req.required_evidence?.join(', ') ?? null,
      matched_evidence: matchedLine?.evidence_status === 'MATCHED' ? (req.required_evidence?.join(', ') ?? null) : null,
      gap_type: matchedLine?.evidence_status === 'MISSING' ? 'MISSING_EVIDENCE' : (matchedLine?.evidence_status === 'PARTIAL' ? 'PARTIAL_EVIDENCE' : null),
      severity: matchedLine?.evidence_status === 'MISSING' ? 'ZERO' : 'AMBER',
      action_item_id: matchedAction?.action_id ?? null,
      human_gate_trigger_id: null
    };
  });

  const header_check_rows: Array<{
    field_name: string;
    expected_value: string | null;
    actual_value: string | null;
    match_status: string;
    severity: string | null;
  }> = [];
  if (normalized) {
    const h = normalized.invoice_header;
    const headerFields = [
      { field_name: 'invoice_no', expected_value: null, actual_value: h.invoice_no ?? null, match_status: h.invoice_no ? 'PRESENT' : 'MISSING', severity: h.invoice_no ? null : 'AMBER' },
      { field_name: 'vendor', expected_value: null, actual_value: h.vendor ?? null, match_status: h.vendor ? 'PRESENT' : 'MISSING', severity: h.vendor ? null : 'AMBER' },
      { field_name: 'issue_date', expected_value: null, actual_value: h.issue_date ?? null, match_status: h.issue_date ? 'PRESENT' : 'MISSING', severity: h.issue_date ? null : 'AMBER' },
      { field_name: 'currency', expected_value: null, actual_value: h.currency, match_status: 'PRESENT', severity: null },
      { field_name: 'invoice_total', expected_value: null, actual_value: h.invoice_total?.toString() ?? null, match_status: h.invoice_total != null ? 'PRESENT' : 'MISSING', severity: h.invoice_total != null ? null : 'AMBER' }
    ];
    header_check_rows.push(...headerFields);
  }

  type DuplicateValidationResult = {
    invoice_no_hash: string;
    vendor_hash: string;
    verdict: string;
    reason_code: string | null;
    duplicate_count: number;
    amount_hash?: string | null;
    issue_date_hash?: string | null;
    matched_job_id?: string | null;
  };
  const duplicateResults = ((validation as { duplicate_checks?: DuplicateValidationResult[] } | undefined)?.duplicate_checks ?? [])
    .filter(d => d.reason_code && d.duplicate_count > 0);
  const duplicate_check_rows: Array<{
    invoice_no_hash: string;
    vendor_hash: string;
    amount_hash: string | null;
    issue_date_hash: string | null;
    match_type: string;
    severity: string;
    matched_job_id: string | null;
  }> = duplicateResults.map(d => ({
    invoice_no_hash: d.invoice_no_hash,
    vendor_hash: d.vendor_hash,
    amount_hash: d.amount_hash ?? null,
    issue_date_hash: d.issue_date_hash ?? null,
    match_type: d.reason_code ?? 'DUPLICATE_INVOICE',
    severity: d.verdict === 'ZERO' ? 'ZERO' : 'AMBER',
    matched_job_id: d.matched_job_id ?? null
  }));

  const rate_check_rows = lines.map(line => {
    const matchedRate = validation?.rate_checks?.find(r => r.line_id === line.line_id);
    return {
      line_id: line.line_id,
      charge_code: line.for_charge_component ?? null,
      lane: line.shipment_ref ?? null,
      contract_rate: line.rate ?? null,
      invoiced_rate: line.rate ?? null,
      rate_basis: line.rate_basis ?? null,
      effective_from: null,
      effective_to: null,
      rate_status: matchedRate?.rate_status ?? 'UNKNOWN',
      delta_pct: null,
      severity: matchedRate?.rate_status === 'MISMATCH' ? 'ZERO' : matchedRate?.rate_status === 'UNKNOWN' ? 'AMBER' : 'PASS'
    };
  });

  const tax_fx_check_rows = lines.map(line => {
    const matchedCostGuard = validation?.costguard_results?.find(c => c.line_id === line.line_id);
    return {
      line_id: line.line_id,
      currency: line.currency,
      vat_rate: null,
      vat_amount: null,
      fx_rate_applied: null,
      fx_policy_id: (matchedCostGuard as any)?.fx_policy_id ?? null,
      tax_status: 'NOT_ASSESSED',
      fx_status: (matchedCostGuard as any)?.fx_policy_id ? 'POLICY_MATCH' : 'NOT_ASSESSED',
      severity: 'PASS'
    };
  });

  const shipment_match_rows = lines.map(line => {
    return {
      line_id: line.line_id,
      shipment_ref: line.shipment_ref ?? null,
      job_number: line.job_number ?? null,
      bl_number: null,
      do_number: null,
      po_number: null,
      match_status: line.shipment_ref ? 'PARTIAL' : 'NO_REF',
      matched_fields: line.shipment_ref ? 'shipment_ref' : null,
      severity: line.shipment_ref ? 'AMBER' : 'ZERO'
    };
  });

  const manifest_entries = [
    { key: 'source_hash_status', value: sourceHashStatus },
    { key: 'source_sha256_expected', value: sourceHashTrace?.source_hash ?? '' },
    { key: 'source_sha256_actual', value: sourceHashTrace?.calculation_hash ?? '' },
    { key: 'roundup_disclosure', value: '결과값은 ROUNDUP(2자리)을 반영하지 않은 값입니다.' },
    { key: 'formula_text_policy', value: 'Formula_Text is exported as literal text, never as a live workbook formula.' }
  ];

  return {
    job_id: jobId,
    decision_rows,
    action_items_rows,
    final_recon_rows,
    header_check_rows,
    duplicate_check_rows,
    rate_check_rows,
    tax_fx_check_rows,
    shipment_match_rows,
    line_view_rows,
    source_data_rows,
    audit_detail_rows,
    evidence_issues_rows,
    manifest_entries,
    generated_at: generatedAt
  };
}
