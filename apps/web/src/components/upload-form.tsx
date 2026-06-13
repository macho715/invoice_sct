'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) { setErr('select a file'); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const LARGE_FILE_THRESHOLD = 4.5 * 1024 * 1024;
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      // P0-5 interim: the large-upload path (/api/files/ingest/large) is not fully
      // wired (route requires jobId and its token response has no job_id, so the
      // redirect lands on /jobs/undefined). Block >4.5MB with a clear message until
      // it is reimplemented with @vercel/blob/client upload().
      if (isLarge) {
        setErr('대용량 업로드(>4.5MB)는 아직 연결되지 않았습니다. 현재는 4.5MB 이하 파일을 사용하세요.');
        setBusy(false);
        return;
      }
      const endpoint = isLarge ? '/api/files/ingest/large' : '/api/files/ingest';
      const fetchOpts: RequestInit = isLarge
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-user-id': 'dev-user' },
            body: JSON.stringify({ filename: file.name, mimeType: file.type, fileSize: file.size })
          }
        : {
            method: 'POST',
            body: fd,
            headers: { 'x-user-id': 'dev-user' }
          };
      const r = await fetch(endpoint, fetchOpts);
      const body = await r.json();
      if (!r.ok) { setErr(`${body.code}: ${body.message}`); return; }
      router.push(`/invoice-audit/jobs/${body.job_id}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Upload invoice or evidence</h2>
      <p>Supported: <code>.xlsx</code>, <code>.md</code>, <code>.txt</code>, <code>.pdf</code></p>
      <input className="input" type="file" accept=".xlsx,.md,.txt,.pdf,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn" type="submit" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload'}</button>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
    </form>
  );
}
