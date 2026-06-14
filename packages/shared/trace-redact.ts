// Scrub P2-category fields from OpenTelemetry span attributes before export.
// Must be kept in sync with DLP P2 categories in CLAUDE.md.

const P2_KEY_PATTERN =
  /rate|amount|price|cost|trn|boe|bl_|bol|container|vessel|email|phone|pii|password|secret|token|key|invoice/i;

/**
 * Redact P2 fields from a flat attributes object.
 * Safe to call on any span attributes dict before setAttributes().
 */
export function redactTraceAttributes(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    out[k] = P2_KEY_PATTERN.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

/**
 * Check whether a given attribute key should be redacted.
 */
export function isP2AttributeKey(key: string): boolean {
  return P2_KEY_PATTERN.test(key);
}
