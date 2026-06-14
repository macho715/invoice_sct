// Span helpers for web API routes.
// All functions are no-ops when OTEL_ENABLED != 'true'.
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { redactAttributes } from '@invoice-audit/telemetry';

const ENABLED = process.env.OTEL_ENABLED === 'true';

const TRACER_NAME = 'sct-web';

/**
 * Wrap an API handler function in a trace span.
 * Returns the result unchanged; span is ended even on error.
 */
export async function withApiSpan<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!ENABLED) return fn();

  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(spanName, { attributes: redactAttributes(attributes) }, async (span: Span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Get current trace ID for inclusion in error responses (safe — no P2 data). */
export function currentTraceId(): string | null {
  if (!ENABLED) return null;
  const span = trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  return ctx.traceId ?? null;
}

/** Add safe, non-P2 attributes to the currently active span. */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  if (!ENABLED) return;
  const span = trace.getActiveSpan();
  if (!span) return;
  const safe = redactAttributes(attributes);
  for (const [k, v] of Object.entries(safe)) {
    span.setAttribute(k, v);
  }
}
