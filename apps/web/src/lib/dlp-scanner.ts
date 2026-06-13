export type DlpViolationType =
  | 'RAW_RATE'
  | 'TRN'
  | 'BOE'
  | 'BL_NUMBER'
  | 'CONTAINER_NUMBER'
  | 'SHIPMENT_NUMBER'
  | 'EMAIL'
  | 'PHONE'
  | 'API_KEY'
  | 'CREDENTIAL'
  | 'PII';

export interface DlpViolation {
  type: DlpViolationType;
  location: string;
  snippet_preview: string;
  line_number?: number;
}

export interface DlpScanResult {
  passed: boolean;
  violations: DlpViolation[];
  scanned_length: number;
}

type PatternEntry = {
  type: DlpViolationType;
  pattern: RegExp;
};

const PATTERNS: PatternEntry[] = [
  {
    type: 'RAW_RATE',
    pattern: /(?:rate|unit\s*price|charge\s*rate|contract\s*rate)\s*[:=]?\s*\d{1,10}(?:\.\d{1,4})?/gi,
  },
  {
    type: 'RAW_RATE',
    pattern: /\d{1,10}(?:\.\d{1,4})?\s*(?:AED|USD)\s*(?:\/|per)\s*(?:TEU|BL|kg|cbm|ton)/gi,
  },
  {
    type: 'TRN',
    pattern: /\b\d{15}\b/,
  },
  {
    type: 'BOE',
    pattern: /\bBOE[-\s]?\d{4,}[-\s]?\d{2,}\b/i,
  },
  {
    type: 'BL_NUMBER',
    pattern: /\bBL[-\s]?[A-Z0-9]{2,}(?:[-\s][A-Z0-9]{2,}){0,5}\b/i,
  },
  {
    type: 'CONTAINER_NUMBER',
    pattern: /\b[A-Z]{4}\d{7}\b/,
  },
  {
    type: 'SHIPMENT_NUMBER',
    pattern: /\bHVDC[-\s]?[A-Z0-9]{4,20}\b/i,
  },
  {
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/,
  },
  {
    type: 'PHONE',
    pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,
  },
  {
    type: 'API_KEY',
    pattern: /(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/gi,
  },
  {
    type: 'CREDENTIAL',
    pattern: /(?:password|passwd|pwd|token|auth[_-]?token|bearer)\s*[:=]\s*\S+/gi,
  },
  {
    type: 'PII',
    pattern: /\b\d{2}[0-3]\d[0-1]\d\d{6,8}\b/,
  },
  {
    type: 'PII',
    pattern: /\b[A-Z]\d{8,9}\b/,
  },
];

function maskSnippet(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 9) {
    return trimmed.slice(0, 3) + '***';
  }
  const head = trimmed.slice(0, 3);
  const tail = trimmed.slice(-3);
  const masked = head + '***' + tail;
  return masked.length > 20 ? masked.slice(0, 20) : masked;
}

function getLineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
    }
  }
  return line;
}

export function scanForDlpViolations(
  content: string,
  location?: string,
): DlpScanResult {
  const violations: DlpViolation[] = [];
  const loc = location ?? 'unknown';

  for (const entry of PATTERNS) {
    const flags = entry.pattern.flags.includes('g')
      ? entry.pattern.flags
      : `${entry.pattern.flags}g`;
    const regex = new RegExp(entry.pattern.source, flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const matchedText = match[0];

      if (matchedText.length === 0) {
        regex.lastIndex++;
        continue;
      }

      if (entry.type === 'PHONE' && matchedText.replace(/\D/g, '').length < 7) {
        continue;
      }

      violations.push({
        type: entry.type,
        location: loc,
        snippet_preview: maskSnippet(matchedText),
        line_number: getLineNumber(content, match.index),
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    scanned_length: content.length,
  };
}

export function assertDlpClean(content: string, location?: string): void {
  const result = scanForDlpViolations(content, location);

  if (!result.passed) {
    const summary = result.violations
      .map((v) => `  [${v.type}] line ${v.line_number ?? '?'}: ${v.snippet_preview}`)
      .join('\n');

    const error = new Error(
      `DLP_VIOLATION: ${result.violations.length} violation(s) detected${
        location ? ` in ${location}` : ''
      }\n${summary}`,
    );

    (error as Error & { code: string }).code = 'DLP_VIOLATION';
    throw error;
  }
}
