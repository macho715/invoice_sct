export type RedactionType = 
  | 'RATE' | 'TRN' | 'BOE' | 'BL' | 'CONTAINER' 
  | 'SHIPMENT' | 'EMAIL' | 'PHONE' | 'PII' | 'API_KEY' | 'CREDENTIAL';

export function redact(value: string, type: RedactionType): string {
  return `**[REDACTED-${type}]**`;
}

export function maskPartial(value: string): string {
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  fieldsToRedact: Array<{ field: keyof T; type: RedactionType }>
): T {
  const result = { ...obj };
  for (const { field, type } of fieldsToRedact) {
    if (field in result && typeof result[field] === 'string') {
      (result as Record<string, unknown>)[field as string] = redact(result[field] as string, type);
    }
  }
  return result;
}

export function isRedacted(value: string): boolean {
  return /^\*\*\[REDACTED-[A-Z_]+\]\*\*$/.test(value);
}
