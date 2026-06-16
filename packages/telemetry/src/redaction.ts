/**
 * Redact sensitive audit attributes before they reach logs or trace backends.
 * Keys that look like rates, amounts, identifiers, or PII are masked.
 */
const P2_KEYS = /rate|amount|price|cost|trn|boe|bl_|bol|container|vessel|email|phone|pii|password|secret|token|key/i;

export function redactAttributes(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (P2_KEYS.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}
