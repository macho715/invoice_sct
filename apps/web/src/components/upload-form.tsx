'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getUploadSelectionError } from '@/lib/upload-validation';

const LARGE_FILE_THRESHOLD = 4.5 * 1024 * 1024;

export default function UploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const selectionError = getUploadSelectionError(files);
    if (selectionError) { setErr(selectionError); return; }

    // P0-5 interim: large client-direct upload is not wired yet. Block >4.5MB
    // up front (per file) so a confusing 400 is replaced with a clear message.
    const tooLarge = files.find(f => f.size > LARGE_FILE_THRESHOLD);
    if (tooLarge) {
      setErr(`"${tooLarge.name}" 가 4.5MB를 초과합니다. 대용량 업로드는 아직 연결되지 않았습니다 — 4.5MB 이하 파일을 사용하세요.`);
      return;
    }

    setBusy(true); setErr(null);
    try {
      // First file creates the job; subsequent files append to the same job_id.
      let jobId: string | null = null;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(`업로드 중 ${i + 1}/${files.length}: ${file.name}`);
        const fd = new FormData();
        fd.set('file', file);
        if (jobId) fd.set('job_id', jobId);
        const r = await fetch('/api/files/ingest', {
          method: 'POST',
          body: fd,
          headers: { 'x-user-id': 'dev-user' }
        });
        const body = await r.json();
        if (!r.ok) { setErr(`${file.name}: ${body.code} — ${body.message}`); setBusy(false); setProgress(null); return; }
        jobId = jobId ?? body.job_id;
      }
      if (jobId) {
        setProgress('검증 실행 중…');
        const runRes = await fetch('/api/invoice-audit/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job_id: jobId })
        });
        if (!runRes.ok) {
          const runBody = await runRes.json().catch(() => ({ message: `HTTP ${runRes.status}` }));
          setErr(`검증 실행 실패: ${runBody.code ?? 'ERROR'} — ${runBody.message ?? 'unknown'}`);
          return;
        }
        router.push(`/invoice-audit/jobs/${jobId}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Upload invoice or evidence</h2>
      <p>Upload an Excel invoice (<code>.xlsx</code>, <code>.md</code>, <code>.txt</code>) <strong>or</strong> a <code>.pdf</code> — either one alone produces a final Excel audit pack. You can also upload both together.</p>
      <input
        className="input"
        type="file"
        multiple
        accept=".xlsx,.md,.txt,.pdf,application/pdf"
        onChange={e => {
          setFiles(Array.from(e.target.files ?? []));
          setErr(null);
        }}
      />
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => <li key={i}>{f.name} <span className="muted">({(f.size / 1024).toFixed(0)} KB)</span></li>)}
        </ul>
      )}
      <button className="btn" type="submit" disabled={busy || files.length === 0}>
        {busy ? (progress ?? 'Uploading…') : `Upload${files.length > 1 ? ` (${files.length})` : ''}`}
      </button>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
    </form>
  );
}
