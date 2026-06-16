import { trace, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { redactAttributes } from './redaction.js';

export { SpanStatusCode };
export { redactAttributes };
export type { Span, Tracer };

export type ServiceConfig = {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
};

type TelemetrySdk = {
  start(): void;
  shutdown(): Promise<void>;
};

let _sdk: TelemetrySdk | null = null;

async function runtimeImport<T>(specifier: string): Promise<T> {
  const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<T>;
  return importer(specifier);
}

/**
 * Bootstrap OTel SDK. Must be called only when OTEL_ENABLED=true.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initTelemetry(config: ServiceConfig): Promise<void> {
  if (_sdk) return;

  const [
    { NodeSDK },
    { getNodeAutoInstrumentations },
    { OTLPTraceExporter },
    { Resource },
    { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION },
  ] = await Promise.all([
    runtimeImport<typeof import('@opentelemetry/sdk-node')>('@opentelemetry/sdk-node'),
    runtimeImport<typeof import('@opentelemetry/auto-instrumentations-node')>('@opentelemetry/auto-instrumentations-node'),
    runtimeImport<typeof import('@opentelemetry/exporter-trace-otlp-http')>('@opentelemetry/exporter-trace-otlp-http'),
    runtimeImport<typeof import('@opentelemetry/resources')>('@opentelemetry/resources'),
    runtimeImport<typeof import('@opentelemetry/semantic-conventions')>('@opentelemetry/semantic-conventions'),
  ]);

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
