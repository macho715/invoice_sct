// Next.js 15 instrumentation hook — runs once per server process start.
// OpenTelemetry bootstrap is gated on OTEL_ENABLED=true.
export async function register() {
  if (process.env.OTEL_ENABLED !== 'true') return;

  // Only instrument in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initTelemetry } = await import('@invoice-audit/telemetry');
    await initTelemetry({
      serviceName: 'sct-web',
      serviceVersion: process.env.npm_package_version ?? '0.0.0',
      otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
  }
}
