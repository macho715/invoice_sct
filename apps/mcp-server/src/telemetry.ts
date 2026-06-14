// OpenTelemetry helpers for MCP server.
// All exports are no-ops when OTEL_ENABLED != 'true'.
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

const ENABLED = process.env.OTEL_ENABLED === 'true';
const TRACER_NAME = 'sct-mcp-server';

const P2_KEYS = /rate|amount|price|cost|trn|boe|bl_|bol|container|vessel|email|phone|pii|password|secret|token|key/i;

function redact(attrs: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    out[k] = P2_KEYS.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export async function withToolSpan<T>(
  toolName: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  if (!ENABLED) return fn({ end: () => {}, setStatus: () => {}, recordException: () => {}, setAttribute: () => {}, spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }) } as unknown as Span);

  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    `mcp.tool/${toolName}`,
    { attributes: redact({ 'mcp.tool.name': toolName, ...attributes }) },
    async (span: Span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function currentTraceId(): string | null {
  if (!ENABLED) return null;
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId ?? null;
}

export function initMcpTelemetry(): void {
  if (!ENABLED) return;
  // SDK init is done externally via packages/telemetry initTelemetry().
  // This file provides span helpers only.
}
