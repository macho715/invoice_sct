'use client';

import { useState } from 'react';

export default function RunAuditButton({ jobId, disabled }: { jobId: string; disabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/invoice-audit/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: jobId })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        const code = typeof data?.code === 'string' ? data.code : 'ERROR';
        const message = typeof data?.message === 'string'
          ? data.message
          : typeof data?.error === 'string'
            ? data.error
            : 'unknown';
        setError(`${code}: ${message}`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(`Network error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn" onClick={runAudit} disabled={disabled || loading}>
        {loading ? 'Running...' : 'Run dry-run'}
      </button>
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
