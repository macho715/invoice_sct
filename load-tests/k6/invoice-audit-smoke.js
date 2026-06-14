// Smoke test: 1 VU, 30s — verify invoice-audit API responds correctly
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const auditDuration = new Trend('audit_duration');
const auditErrors = new Rate('audit_errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const payload = JSON.stringify({
    invoiceId: `smoke-${Date.now()}`,
    lines: [
      { line_id: 'L01', charge_code: 'FREIGHT', qty: 1, rate: 1000, amount: 1000, currency: 'AED' },
    ],
    totalAmount: 1000,
    currency: 'AED',
  });

  const res = http.post(`${BASE_URL}/api/invoice-audit/run`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
  });

  const ok = check(res, {
    'status 200 or 202': (r) => r.status === 200 || r.status === 202,
    'has verdict': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.verdict === 'string' || typeof body.jobId === 'string';
      } catch {
        return false;
      }
    },
  });

  auditDuration.add(res.timings.duration);
  auditErrors.add(!ok);
  sleep(1);
}
