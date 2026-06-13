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
      const endpoint = file.size > LARGE_FILE_THRESHOLD ? '/api/files/ingest/large' : '/api/files/ingest';
      const r = await fetch(endpoint, { method: 'POST', body: fd, headers: { 'x-user-id': 'dev-user' } });
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
