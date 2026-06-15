'use client';

import { useState } from 'react';

type ExportResponse = {
  signed_url?: string;
  url?: string;
  code?: string;
  message?: string;
};

export default function DownloadAuditButton({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createExportAndDownload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/audit/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, kind: 'FINAL_APPROVED' })
      });
      const data = await res.json().catch(() => ({ message: `HTTP ${res.status}` })) as ExportResponse;
      if (!res.ok) {
        setError(`${data.code ?? 'EXPORT_FAILED'}: ${data.message ?? 'Export failed'}`);
        return;
      }

      // Always download through the server-streaming route. The export step's
      // signed_url points at a PRIVATE Vercel Blob whose downloadUrl 403s for an
      // unauthenticated browser navigation; /api/export/download fetches the blob
      // server-side (with the token) and streams the bytes back (Rule #0).
      window.location.href = `/api/export/download?job_id=${encodeURIComponent(jobId)}`;
    } catch (e) {
      setError(`EXPORT_FAILED: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn" onClick={createExportAndDownload} disabled={loading}>
        {loading ? 'Preparing download...' : 'Download Audit Workbook'}
      </button>
      {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
