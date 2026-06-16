export type UploadFileKind = 'xlsx' | 'md' | 'txt' | 'pdf' | 'unknown';

const STRUCTURED_INVOICE_KINDS = new Set<UploadFileKind>(['xlsx', 'md', 'txt']);
const ACCEPTED_INVOICE_KINDS = new Set<UploadFileKind>(['xlsx', 'md', 'txt', 'pdf']);
const ACCEPTED_EVIDENCE_KINDS = new Set<UploadFileKind>(['pdf']);

export function getUploadFileKind(file: Pick<File, 'name' | 'type'>): UploadFileKind {
  const name = file.name.toLowerCase();
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || name.endsWith('.xlsx')
  ) return 'xlsx';
  if (file.type === 'text/markdown' || name.endsWith('.md')) return 'md';
  if (file.type === 'text/plain' || name.endsWith('.txt')) return 'txt';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'unknown';
}

export function isStructuredInvoice(file: Pick<File, 'name' | 'type'>): boolean {
  return STRUCTURED_INVOICE_KINDS.has(getUploadFileKind(file));
}

export function isPdfOnly(file: Pick<File, 'name' | 'type'>): boolean {
  return getUploadFileKind(file) === 'pdf';
}

export function getInvoiceStepError(files: Array<Pick<File, 'name' | 'type'>>): string | null {
  if (files.length === 0) return 'Please select at least one invoice file (.xlsx, .md, .txt) or a PDF.';
  const hasAccepted = files.some(f => ACCEPTED_INVOICE_KINDS.has(getUploadFileKind(f)));
  if (!hasAccepted) return 'Only .xlsx, .md, .txt, or .pdf files are accepted as invoice source.';
  return null;
}

export function getEvidenceStepError(files: Array<Pick<File, 'name' | 'type'>>): string | null {
  if (files.length === 0) return null;
  const hasNonPdf = files.some(f => !ACCEPTED_EVIDENCE_KINDS.has(getUploadFileKind(f)));
  if (hasNonPdf) return 'Only .pdf files are accepted as evidence.';
  return null;
}

export function getUploadSelectionError(files: Array<Pick<File, 'name' | 'type'>>): string | null {
  if (files.length === 0) return 'select at least one file';
  const hasAccepted = files.some(f => ACCEPTED_INVOICE_KINDS.has(getUploadFileKind(f)));
  if (!hasAccepted) {
    return 'Upload at least one supported file: .xlsx, .md, or .txt invoice, or a .pdf.';
  }
  return null;
}
