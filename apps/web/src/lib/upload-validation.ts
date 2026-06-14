export type UploadFileKind = 'xlsx' | 'md' | 'txt' | 'pdf' | 'unknown';

const INVOICE_FILE_KINDS = new Set<UploadFileKind>(['xlsx', 'md', 'txt']);

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
  if (!hasInvoiceFile(files)) {
    return 'Invoice file required: add one .xlsx, .md, or .txt invoice file. PDF files are evidence only.';
  }
  return null;
}
