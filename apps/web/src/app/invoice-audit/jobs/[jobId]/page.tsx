import RunAuditButton from './RunAuditButton';

async function fetchStatus(jobId: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  try {
    const r = await fetch(`${base}/api/audit/status?job_id=${jobId}`, { cache: 'no-store' });
    if (!r.ok) return { error: true, code: r.status };
    return await r.json() as { status: string; verdict: string | null; last_step: string | null };
  } catch {
    return { error: true, code: 0 };
  }
}

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const status = await fetchStatus(jobId);
  if ('error' in status) {
    return (
      <main className="container">
        <h1>Job {jobId}</h1>
        <div className="card">
          <div className="alert alert-warn">Job not found or status unavailable.</div>
          <p>The job may have expired or been removed. Try uploading again.</p>
          <p><a href="/invoice-audit/upload">Upload new invoice</a></p>
        </div>
      </main>
    );
  }
  const verdictClass = status.verdict === 'PASS' ? 'alert-pass' : status.verdict === 'AMBER' ? 'alert-warn' : status.verdict === 'ZERO' ? 'alert-error' : '';
  const isComplete = status.status === 'REVIEW_REQUIRED' || status.status === 'COMPLETED' || status.status === 'FAILED';
  return (
    <main className="container">
      <h1>Job {jobId}</h1>
      <div className="card">
        <p>Status: <strong>{status.status}</strong></p>
        <p>Verdict: <strong>{status.verdict ?? '(pending)'}</strong></p>
        <p>Last step: <code>{status.last_step ?? '(none)'}</code></p>
        {status.verdict && <div className={`alert ${verdictClass}`}>Verdict: {status.verdict}</div>}
        <RunAuditButton jobId={jobId} disabled={status.status !== 'UPLOADED'} />
        {!isComplete && <p><a href={`/invoice-audit/jobs/${jobId}`}>Refresh</a></p>}
        {isComplete && (
          <div style={{ marginTop: 12 }}>
            <a href={`/api/export/download?job_id=${jobId}`} className="btn">Download Audit Workbook</a>
          </div>
        )}
        <p style={{ marginTop: 12 }}><a href="/invoice-audit/upload">Upload another invoice</a></p>
      </div>
    </main>
  );
}
