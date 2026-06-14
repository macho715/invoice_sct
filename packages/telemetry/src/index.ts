import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

export { SpanStatusCode };
export type { Span, Tracer };

export type ServiceConfig = {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
};

let _sdk: NodeSDK | null = null;

/**
 * Bootstrap OTel SDK. Must be called only when OTEL_ENABLED=true.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initTelemetry(config: ServiceConfig): void {
  if (_sdk) return;

  const exporter = new OTLPTraceExporter({
    url: config.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  });

  _sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion ?? '0.0.0',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  _sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (!_sdk) return;
  await _sdk.shutdown().catch(() => {});
  _sdk = null;
}

export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

/**
 * Wrap an async fn in a span. Automatically records exceptions and sets
 * span status. Redacts any attributes matching P2 patterns.
 */
export async function withSpan<T>(
  tracer: Tracer,
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(spanName, { attributes: redactAttributes(attributes) }, async (span) => {
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
  });
}

/**
 * Redact P2 attributes before they reach the trace backend.
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
