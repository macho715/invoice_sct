// Load test: ramp 1→10→1 VUs over 3 minutes
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '90s', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],
    http_req_failed: ['rate<0.05'],
    audit_errors: ['rate<0.05'],
  },
};

const auditDuration = new Trend('audit_duration');
const auditErrors = new Rate('audit_errors');
const auditRequests = new Counter('audit_requests');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

let lineCounter = 0;

export default function () {
  lineCounter++;
  const lineCount = 1 + (lineCounter % 5);
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    line_id: `L${String(i + 1).padStart(2, '0')}`,
    charge_code: ['FREIGHT', 'HANDLING', 'STORAGE', 'DEM', 'DET'][i % 5],
    qty: 1 + i,
    rate: 500 + i * 100,
    amount: (1 + i) * (500 + i * 100),
    currency: 'AED',
  }));
  const total = lines.reduce((s, l) => s + l.amount, 0);

  const payload = JSON.stringify({
    invoiceId: `load-${__VU}-${__ITER}`,
    lines,
    totalAmount: total,
    currency: 'AED',
  });

  const res = http.post(`${BASE_URL}/api/invoice-audit/run`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '60s',
  });

  const ok = check(res, {
    'status 2xx': (r) => r.status >= 200 && r.status < 300,
    'no server error': (r) => r.status !== 500,
  });

  auditDuration.add(res.timings.duration);
  auditErrors.add(!ok);
  auditRequests.add(1);
  sleep(0.5 + Math.random());
}
