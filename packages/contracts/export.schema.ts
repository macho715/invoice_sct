import { z } from 'zod';
import { VerdictSchema } from './invoice.schema';

export const SHEET_CONTRACT_V2 = [
  '00_Decision',
  '01_Action_Items',
  '02_Final_Recon',
  '03_Header_Check',
  '04_Line_View',
  '05_Duplicate_Check',
  '06_Rate_Check',
  '07_Tax_FX_Check',
  '08_Shipment_Match',
  '90_Source_Data',
  '91_Audit_Detail',
  '92_Evidence_Issues',
  '99_Manifest'
] as const;

export type SheetNameV2 = typeof SHEET_CONTRACT_V2[number];

export const SheetManifestSchema = z.object({
  sheet_name: z.string(),
  row_count: z.number()
});
export type SheetManifest = z.infer<typeof SheetManifestSchema>;

export const WorkbookManifestSchema = z.object({
  sha256: z.string(),
  size_bytes: z.number(),
  sheets: z.array(SheetManifestSchema),
  generated_at: z.string()
});
export type WorkbookManifest = z.infer<typeof WorkbookManifestSchema>;

export function validateSheetContract(sheetNames: string[]): {
  valid: boolean;
  missing: string[];
  extra: string[];
  reordered: boolean;
} {
  const expected = [...SHEET_CONTRACT_V2];
  const missing = expected.filter(s => !sheetNames.includes(s));
  const extra = sheetNames.filter(s => !expected.includes(s));
  const reordered = sheetNames.filter(s => expected.includes(s)).join('|') !== expected.join('|');
  return {
    valid: missing.length === 0 && extra.length === 0 && !reordered,
    missing,
    extra,
    reordered
  };
}
