// 2026-06-17: shared validation-merge helper. Extracted from
// /api/invoice-audit/run/route.ts so the re-run pipeline can reuse the
// same per-line enrichment (type_b, evidence_status, rate_status,
// gate_status, band, delta_pct) without duplicating the merge logic.
//
// Pure function: takes the latest normalized invoice + the latest
// SctValidationResult, returns the enriched normalized invoice.

export function mergeValidationIntoNormalizedInvoice(normalized: unknown, sct: unknown): unknown {
  const s = (sct ?? {}) as Record<string, unknown>;
  const typeBByLine = new Map(((s.type_b_results ?? []) as Array<Record<string, unknown>>).map((r) => [r.line_id, r]));
  const normalizedByLine = new Map(((s.normalized_lines ?? []) as Array<Record<string, unknown>>).map((r) => [r.line_id, r]));
  const rateByLine = new Map(((s.rate_checks ?? []) as Array<Record<string, unknown>>).map((r) => [r.line_id, r]));
  const gateByLine = new Map(((s.gate_results ?? []) as Array<Record<string, unknown>>).map((r) => [r.line_id, r]));
  const costByLine = new Map(((s.costguard_results ?? []) as Array<Record<string, unknown>>).map((r) => [r.line_id, r]));
  const evidenceByLine = new Map<string, 'MATCHED' | 'PARTIAL' | 'MISSING'>();

  for (const req of (s.evidence_requirements ?? []) as Array<Record<string, unknown>>) {
    if (req?.line_id) evidenceByLine.set(String(req.line_id), 'MATCHED');
  }
  for (const finding of (s.doc_guardian_results ?? []) as Array<Record<string, unknown>>) {
    if (!finding?.line_id) continue;
    evidenceByLine.set(String(finding.line_id), finding.severity === 'ZERO' ? 'MISSING' : 'PARTIAL');
  }

  const n = (normalized ?? {}) as Record<string, unknown>;
  return {
    ...n,
    invoice_lines: (((n.invoice_lines ?? []) as unknown) as Array<Record<string, unknown>>).map((line) => {
      const typeB = typeBByLine.get(line.line_id) as Record<string, unknown> | undefined;
      const norm = normalizedByLine.get(line.line_id) as Record<string, unknown> | undefined;
      const rate = rateByLine.get(line.line_id) as Record<string, unknown> | undefined;
      const gate = gateByLine.get(line.line_id) as Record<string, unknown> | undefined;
      const cost = costByLine.get(line.line_id) as Record<string, unknown> | undefined;
      return {
        ...line,
        type_b: line.type_b ?? typeB?.type_b ?? null,
        for_charge_component: line.for_charge_component ?? norm?.charge_code ?? typeB?.type_b ?? null,
        evidence_status: line.evidence_status ?? evidenceByLine.get(String(line.line_id)) ?? null,
        rate_status: line.rate_status ?? rate?.rate_status ?? null,
        validity_status: line.validity_status ?? rate?.validity_status ?? null,
        gate_status: line.gate_status ?? gate?.gate_status ?? null,
        band: line.band ?? cost?.band ?? null,
        delta_pct: line.delta_pct ?? cost?.delta_pct ?? null
      };
    })
  };
}
