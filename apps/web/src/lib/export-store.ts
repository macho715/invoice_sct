export interface ExportRecord {
  result: unknown;
  url: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __invoice_audit_exports: Map<string, ExportRecord> | undefined;
}

export const EXPORTS_MAP: Map<string, ExportRecord> =
  globalThis.__invoice_audit_exports ??
  (globalThis.__invoice_audit_exports = new Map<string, ExportRecord>());

export function isDevStub(): boolean {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token && !token.startsWith('dev-stub')) return false;
  if (process.env.VERCEL === '1') {
    throw new Error(
      'STORAGE_AUTH_FAILED: BLOB_READ_WRITE_TOKEN is required in Vercel deployment. ' +
      'Set it in Vercel Dashboard -> Project -> Settings -> Environment Variables.'
    );
  }
  return true;
}
