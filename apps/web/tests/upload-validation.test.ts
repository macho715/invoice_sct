import { describe, expect, it } from 'vitest';
import { getUploadFileKind, getUploadSelectionError, hasInvoiceFile } from '../src/lib/upload-validation';

const file = (name: string, type = '') => ({ name, type }) as File;

describe('upload validation', () => {
  it('requires an invoice file for audit execution', () => {
    expect(getUploadSelectionError([file('pod.pdf', 'application/pdf')])).toContain('Invoice file required');
    expect(hasInvoiceFile([file('pod.pdf', 'application/pdf')])).toBe(false);
  });

  it('accepts xlsx/md/txt as invoice candidates with pdf evidence', () => {
    expect(getUploadSelectionError([file('invoice.xlsx'), file('pod.pdf')])).toBeNull();
    expect(getUploadSelectionError([file('invoice.md')])).toBeNull();
    expect(getUploadSelectionError([file('invoice.txt')])).toBeNull();
  });

  it('detects upload file kind from extension or MIME type', () => {
    expect(getUploadFileKind(file('invoice.bin', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe('xlsx');
    expect(getUploadFileKind(file('notes.bin', 'text/markdown'))).toBe('md');
    expect(getUploadFileKind(file('notes.bin', 'text/plain'))).toBe('txt');
    expect(getUploadFileKind(file('evidence.bin', 'application/pdf'))).toBe('pdf');
    expect(getUploadFileKind(file('archive.zip', 'application/zip'))).toBe('unknown');
  });
});
