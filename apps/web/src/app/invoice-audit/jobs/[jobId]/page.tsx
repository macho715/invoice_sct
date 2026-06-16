import RunAuditButton from './RunAuditButton';
import DownloadAuditButton from './DownloadAuditButton';
import AppendEvidenceUpload from './AppendEvidenceUpload';

async function fetchStatus(jobId: string, jobToken: string | null) {
  const base = process.env.NEXT_PUBLIC_BASE_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  try {
    const qs = new URLSearchParams({ job_id: jobId });
    if (jobToken) qs.set('job_token', jobToken);
    const r = await fetch(`${base}/api/audit/status?${qs.toString()}`, { cache: 'no-store' });
    if (!r.ok) return { error: true, code: r.status };
    return await r.json() as { status: string; verdict: string | null; last_step: string | null; source_files?: Array<{ original_filename: string; file_type: string; size_bytes: number }> };
  } catch {
    return { error: true, code: 0 };
  }
}

export default async function JobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ job_token?: string }> }) {
  const { jobId } = await params;
  const { job_token: jobToken } = await searchParams;
  const status = await fetchStatus(jobId, jobToken ?? null);
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
  const canAppendEvidence = status.status === 'UPLOADED' || status.status === 'QUEUED';
  const isComplete = status.status === 'REVIEW_REQUIRED' || status.status === 'COMPLETED' || status.status === 'FAILED';
  const stepLabels: Record<string, number> = { UPLOADED: 1, QUEUED: 1, PARSING: 2, VALIDATING: 3, REVIEW_REQUIRED: 4, COMPLETED: 4 };
  const currentStep = stepLabels[status.status] ?? 0;
  const sourceFiles = status.source_files ?? [];
  const fileIcon: Record<string, string> = { xlsx: '📊', md: '📝', txt: '📄', pdf: '📎' };

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return (
    <main className="container">
      <h1>Job {jobId}</h1>
      <div className="card">
        <div className="stack">
          <div>
            <ol className="step-list" aria-label="Job progress">
              {['Uploaded', 'Parsing', 'Validating', 'Complete'].map((label, i) => (
                <li key={label} className={i + 1 < currentStep ? 'is-done' : i + 1 === currentStep ? 'is-current' : ''}>{label}</li>
              ))}
            </ol>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            <span>Status: <strong>{status.status}</strong></span>
            <span>Last step: <code>{status.last_step ?? '(none)'}</code></span>
          </div>
          {status.verdict && <div className={`alert ${verdictClass}`}>Verdict: {status.verdict}</div>}
          {sourceFiles.length > 0 && (
            <div>
              <p style={{ fontWeight: 600, marginBottom: 'var(--sp-1)' }}>Attached files ({sourceFiles.length})</p>
              <ul className="embedded-file-list">
                {sourceFiles.map((f, i) => (
                  <li key={i}>
                    <span className="embedded-file-icon">{fileIcon[f.file_type] ?? '📎'}</span>
                    <span>{f.original_filename}</span>
                    <span className="muted">{f.file_type.toUpperCase()} · {formatSize(f.size_bytes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canAppendEvidence && (
            <div>
              <RunAuditButton jobId={jobId} jobToken={jobToken ?? null} disabled={status.status !== 'UPLOADED'} />
            </div>
          )}
        {!isComplete && <p><a href={`/invoice-audit/jobs/${jobId}${jobToken ? `?job_token=${encodeURIComponent(jobToken)}` : ''}`}>Refresh</a></p>}
        {isComplete && (
          <div style={{ marginTop: 12 }}>
            <DownloadAuditButton jobId={jobId} jobToken={jobToken ?? null} />
          </div>
        )}
        <p style={{ marginTop: 12 }}><a href="/invoice-audit/upload">Upload another invoice</a></p>
        </div>
      </div>
      <AppendEvidenceUpload jobId={jobId} jobToken={jobToken ?? null} disabled={!canAppendEvidence} />
    </main>
  );
}
