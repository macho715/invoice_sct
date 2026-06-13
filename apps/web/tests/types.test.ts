import { describe, it, expect } from 'vitest';
import {
  JobStatusSchema,
  SourceFileSchema,
  InvoiceLineSchema,
  GateResultSchema,
  AuditTraceStepSchema
} from '../src/lib/types';

describe('types', () => {
  it('JobStatusSchema accepts valid statuses', () => {
    for (const s of ['CREATED','UPLOADING','UPLOADED','QUEUED','PARSING','VALIDATING','REVIEW_REQUIRED','APPROVED','EXPORTING','COMPLETED','FAILED','REJECTED']) {
      expect(JobStatusSchema.parse(s)).toBe(s);
    }
  });

  it('JobStatusSchema rejects unknown status', () => {
    expect(() => JobStatusSchema.parse('UNKNOWN')).toThrow();
  });

  it('SourceFileSchema requires sha256, blob_ref, file_type', () => {
    const ok = SourceFileSchema.parse({
      file_id: 'f1', job_id: 'j1', original_filename: 'inv.xlsx',
      file_type: 'xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 1024, sha256: 'a'.repeat(64), blob_ref: 'blob:abc',
      parser_status: 'PENDING', uploaded_by: 'u1', uploaded_at: '2026-06-09T00:00:00Z'
    });
    expect(ok.file_type).toBe('xlsx');
    expect(() => SourceFileSchema.parse({ file_id: 'x' })).toThrow();
  });

  it('InvoiceLineSchema enforces line_amount, currency, description', () => {
    const ok = InvoiceLineSchema.parse({
      line_id: 'l1', description: 'TRUCKING', currency: 'AED', amount: 100.0
    });
    expect(ok.numeric_integrity_status ?? null).toBeNull();
  });

  it('GateResultSchema verdict is one of PASS/AMBER/ZERO/FAILED', () => {
    const ok = GateResultSchema.parse({ gate_id: 'g1', job_id: 'j1', verdict: 'PASS', line_results: [], action_items: [] });
    expect(ok.verdict).toBe('PASS');
    expect(() => GateResultSchema.parse({ gate_id: 'g1', job_id: 'j1', verdict: 'GREEN', line_results: [], action_items: [] })).toThrow();
  });

  it('AuditTraceStepSchema accepts Phase 1 steps', () => {
    for (const step of ['UPLOAD','PARSE','SOURCE_DATA','VALIDATE','COSTGUARD','DOC_GUARDIAN','DECISION']) {
      expect(AuditTraceStepSchema.parse(step)).toBe(step);
    }
  });

  it('AuditTraceStepSchema rejects unknown step', () => {
    expect(() => AuditTraceStepSchema.parse('UNKNOWN_STEP')).toThrow();
  });
});
