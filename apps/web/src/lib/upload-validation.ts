export type UploadFileKind = 'xlsx' | 'md' | 'txt' | 'pdf' | 'unknown';

const INVOICE_FILE_KINDS = new Set<UploadFileKind>(['xlsx', 'md', 'txt']);
// Rule #0 (CLAUDE.md): Excel invoice OR PDF evidence — either alone is a valid upload
// that must yield a final Excel. PDF-only uploads are accepted (the run route uses the
// PDF as the invoice source).
const ACCEPTED_FILE_KINDS = new Set<UploadFileKind>(['xlsx', 'md', 'txt', 'pdf']);

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

export function hasInvoiceFile(files: Array<Pick<File, 'name' | 'type'>>): boolean {
  return files.some(file => INVOICE_FILE_KINDS.has(getUploadFileKind(file)));
}

export function getUploadSelectionError(files: Array<Pick<File, 'name' | 'type'>>): string | null {
  if (files.length === 0) return 'select at least one file';
  // OR semantics: a single Excel invoice OR a single PDF is enough. Only reject when
  // none of the selected files are a recognized type.
  const hasAccepted = files.some(file => ACCEPTED_FILE_KINDS.has(getUploadFileKind(file)));
  if (!hasAccepted) {
    return 'Upload at least one supported file: .xlsx, .md, or .txt invoice, or a .pdf.';
  }
  return null;
}
