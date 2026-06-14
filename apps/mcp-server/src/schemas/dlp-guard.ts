import { z } from 'zod';

export const DlpGuardInputSchema = z.object({
  payload: z.record(z.unknown()),
  context: z.string().optional()
});

export const DlpViolationSchema = z.object({
  field_path: z.string(),
  violation_type: z.string(),
  snippet_preview: z.string()
});

export const DlpGuardResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(DlpViolationSchema),
  masked_payload: z.record(z.unknown()).nullable()
});

export type DlpGuardInput = z.infer<typeof DlpGuardInputSchema>;
export type DlpViolation = z.infer<typeof DlpViolationSchema>;
export type DlpGuardResult = z.infer<typeof DlpGuardResultSchema>;

export const DLP_PATTERNS: ReadonlyArray<{ type: string; regex: RegExp }> = [
  { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'PHONE', regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g },
  { type: 'TRN', regex: /\b\d{15}\b/g },
  { type: 'API_KEY', regex: /(?:api[_-]?key|token|password|secret)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{8,}/gi }
];

export function guardDlp(input: DlpGuardInput): DlpGuardResult {
  const violations: DlpViolation[] = [];
  const raw = JSON.stringify(input.payload);

  for (const { type, regex } of DLP_PATTERNS) {
    const matches = raw.match(regex);
    if (matches) {
      for (const m of matches.slice(0, 5)) {
        violations.push({
          field_path: 'payload',
          violation_type: type,
          snippet_preview: m.length > 6 ? `${m.slice(0, 3)}***${m.slice(-3)}` : '***'
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    masked_payload: violations.length > 0 ? null : input.payload
  };
}

export function guardDlpOutput(payload: unknown): DlpGuardResult {
  const serialized = JSON.stringify(payload);
  const violations: DlpViolation[] = [];

  for (const pattern of DLP_PATTERNS) {
    const matches = serialized.match(pattern.regex);
    if (matches) {
      for (const m of matches.slice(0, 5)) {
        violations.push({
          field_path: 'output',
          violation_type: pattern.type,
          snippet_preview: m.length > 6 ? `${m.slice(0, 3)}***${m.slice(-3)}` : '***'
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    masked_payload: null
  };
}
