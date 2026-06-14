// DB pool pressure test: 12 concurrent VUs against a 10-connection pool
// Expected: requests queue rather than fail when pool limit is hit.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Gauge } from 'k6/metrics';

export const options = {
  // 12 VUs > pool max (10) — verifies queuing behavior
  vus: 12,
  duration: '60s',
  thresholds: {
    // Under pool pressure, p99 may spike but p95 should stay under 10s
    http_req_duration: ['p(95)<10000'],
    // Errors must remain low — pool should queue, not reject
    http_req_failed: ['rate<0.10'],
    pool_pressure_errors: ['rate<0.10'],
  },
};

const reqDuration = new Trend('pool_req_duration');
const pressureErrors = new Rate('pool_pressure_errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Hit DB-backed endpoint: job status or health endpoint that queries DB
  const res = http.get(`${BASE_URL}/api/jobs`, {
    headers: { Accept: 'application/json' },
    timeout: '30s',
  });

  const ok = check(res, {
    'not 503': (r) => r.status !== 503,
    'not 500': (r) => r.status !== 500,
  });

  reqDuration.add(res.timings.duration);
  pressureErrors.add(!ok);
  // No sleep — maximize concurrent DB connections
}

export function handleSummary(data) {
  const p95 = data.metrics['pool_req_duration']?.values?.['p(95)'] ?? 0;
  const p99 = data.metrics['pool_req_duration']?.values?.['p(99)'] ?? 0;
  const errRate = data.metrics['pool_pressure_errors']?.values?.rate ?? 0;

  return {
    stdout: `
=== DB Pool Pressure Summary ===
VUs: 12  (pool max: 10)
p95 latency : ${p95.toFixed(0)} ms
p99 latency : ${p99.toFixed(0)} ms
Error rate  : ${(errRate * 100).toFixed(2)}%
Verdict     : ${errRate < 0.10 ? 'PASS — pool queuing works' : 'FAIL — check pool config'}
================================
`,
  };
}
