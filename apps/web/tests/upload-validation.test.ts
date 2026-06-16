import { describe, expect, it } from 'vitest';
import { getUploadFileKind, getUploadSelectionError, getInvoiceStepError, getEvidenceStepError, isStructuredInvoice, isPdfOnly } from '../src/lib/upload-validation';

const file = (name: string, type = '') => ({ name, type }) as File;

describe('upload validation', () => {
  it('accepts a PDF-only upload (Rule #0 OR semantics)', () => {
    expect(getUploadSelectionError([file('pod.pdf', 'application/pdf')])).toBeNull();
    expect(isStructuredInvoice(file('pod.pdf', 'application/pdf'))).toBe(false);
    expect(isPdfOnly(file('pod.pdf', 'application/pdf'))).toBe(true);
  });

  it('rejects a selection with no supported file', () => {
    expect(getUploadSelectionError([file('archive.zip', 'application/zip')])).toContain('supported file');
    expect(getUploadSelectionError([])).toContain('at least one file');
  });

  it('accepts xlsx/md/txt as invoice candidates with pdf evidence', () => {
    expect(getUploadSelectionError([file('invoice.xlsx'), file('pod.pdf')])).toBeNull();
    expect(getUploadSelectionError([file('invoice.md')])).toBeNull();
    expect(getUploadSelectionError([file('invoice.txt')])).toBeNull();
  });

  it('invoice step requires at least one accepted file', () => {
    expect(getInvoiceStepError([])).toContain('Please select at least one');
    expect(getInvoiceStepError([file('invoice.xlsx')])).toBeNull();
    expect(getInvoiceStepError([file('pod.pdf')])).toBeNull();
    expect(getInvoiceStepError([file('archive.zip', 'application/zip')])).toContain('Only');
  });

  it('evidence step accepts PDF only, empty is ok', () => {
    expect(getEvidenceStepError([])).toBeNull();
    expect(getEvidenceStepError([file('pod.pdf')])).toBeNull();
    expect(getEvidenceStepError([file('pod.pdf'), file('dn.pdf')])).toBeNull();
    expect(getEvidenceStepError([file('invoice.xlsx')])).toContain('Only');
  });

  it('isStructuredInvoice detects xlsx/md/txt but not pdf', () => {
    expect(isStructuredInvoice(file('inv.xlsx'))).toBe(true);
    expect(isStructuredInvoice(file('inv.md'))).toBe(true);
    expect(isStructuredInvoice(file('inv.txt'))).toBe(true);
    expect(isStructuredInvoice(file('inv.pdf', 'application/pdf'))).toBe(false);
  });

  it('detects upload file kind from extension or MIME type', () => {
    expect(getUploadFileKind(file('invoice.bin', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe('xlsx');
    expect(getUploadFileKind(file('notes.bin', 'text/markdown'))).toBe('md');
    expect(getUploadFileKind(file('notes.bin', 'text/plain'))).toBe('txt');
    expect(getUploadFileKind(file('evidence.bin', 'application/pdf'))).toBe('pdf');
    expect(getUploadFileKind(file('archive.zip', 'application/zip'))).toBe('unknown');
  });
});
