import { notFound } from 'next/navigation';

async function fetchStatus(jobId: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const r = await fetch(`${base}/api/audit/status?job_id=${jobId}`, { cache: 'no-store' });
  if (!r.ok) return null;
  return r.json() as Promise<{ status: string; verdict: string | null; last_step: string | null }>;
}

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const status = await fetchStatus(jobId);
  if (!status) notFound();
  const verdictClass = status.verdict === 'PASS' ? 'alert-pass' : status.verdict === 'AMBER' ? 'alert-warn' : status.verdict === 'ZERO' ? 'alert-error' : '';
  return (
    <main className="container">
      <h1>Job {jobId}</h1>
      <div className="card">
        <p>Status: <strong>{status.status}</strong></p>
        <p>Verdict: <strong>{status.verdict ?? '(pending)'}</strong></p>
        <p>Last step: <code>{status.last_step ?? '(none)'}</code></p>
        {status.verdict && <div className={`alert ${verdictClass}`}>Verdict: {status.verdict}</div>}
        <form action={`/api/invoice-audit/run`} method="post">
          <input type="hidden" name="job_id" value={jobId} />
          <button className="btn" type="submit" disabled={status.status !== 'UPLOADED'}>Run dry-run</button>
        </form>
        <p><a href={`/invoice-audit/jobs/${jobId}`}>Refresh</a></p>
      </div>
    </main>
  );
}
