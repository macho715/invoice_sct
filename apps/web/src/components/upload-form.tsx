'use client';
import { useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getUploadSelectionError } from '@/lib/upload-validation';

const LARGE_FILE_THRESHOLD = 4.5 * 1024 * 1024;

function formatKb(bytes: number) {
  return `${Math.ceil(bytes / 1024).toLocaleString()} KB`;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  // Bare 64-char hex — matches SourceFileSchema (z.string().length(64)).
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Large files (>4.5MB) can't pass through the Vercel serverless function body
// limit, so they stream straight to Vercel Blob from the browser, then register.
async function uploadLargeFile(
  file: File,
  jobId: string | null,
  onProgress: (pct: number) => void,
): Promise<string> {
  const { upload } = await import('@vercel/blob/client');
  const blob = await upload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/files/blob-upload',
    onUploadProgress: e => onProgress(e.percentage),
  });
  const sha256 = await sha256Hex(file);
  const res = await fetch('/api/files/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'dev-user' },
    body: JSON.stringify({
      blob_url: blob.url,
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
      sha256,
      ...(jobId ? { job_id: jobId } : {}),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${file.name}: ${body.code} — ${body.message}`);
  return body.job_id as string;
}

export default function UploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  function clearFiles() {
    setFiles([]);
    setErr(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setFiles(current => current.filter((_, i) => i !== index));
    setErr(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const selectionError = getUploadSelectionError(files);
    if (selectionError) { setErr(selectionError); return; }

    setBusy(true); setErr(null);
    try {
      // First file creates the job; subsequent files append to the same job_id.
      // Files >4.5MB stream client-direct to Blob (uploadLargeFile); smaller files
      // go through /api/files/ingest. Either way the same job_id threads through.
      let jobId: string | null = null;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > LARGE_FILE_THRESHOLD) {
          jobId = await uploadLargeFile(file, jobId, pct =>
            setProgress(`업로드 중 ${i + 1}/${files.length}: ${file.name} (${Math.round(pct)}%)`));
          continue;
        }
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
      <div className="stack">
        <div>
          <p className="eyebrow">Invoice validation</p>
          <h2>Upload invoice or evidence</h2>
          <p className="muted">Excel, text, markdown, or PDF files are accepted. You can upload one invoice, one PDF, or invoice plus evidence together.</p>
        </div>
        <ol className="step-list" aria-label="Validation flow">
          <li className={files.length > 0 ? 'is-done' : 'is-current'}>Select files</li>
          <li className={busy ? 'is-current' : ''}>Upload</li>
          <li>Run validation</li>
          <li>Download workbook</li>
        </ol>
      </div>
      <label className="file-drop">
        <span className="file-drop-title">Choose files</span>
        <span className="file-drop-copy">Up to 50MB per file (large files upload directly). Supported: .xlsx, .md, .txt, .pdf.</span>
      <input
          ref={fileInputRef}
        className="input"
        type="file"
        multiple
        accept=".xlsx,.md,.txt,.pdf,application/pdf"
        onChange={e => {
          setFiles(Array.from(e.target.files ?? []));
          setErr(null);
        }}
      />
      </label>
      {files.length > 0 && (
        <div className="file-panel" aria-live="polite">
          <div className="file-panel-header">
            <strong>{files.length} file{files.length > 1 ? 's' : ''} selected</strong>
            <span className="muted">Total {formatKb(totalBytes)}</span>
          </div>
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={`${f.name}-${f.size}-${i}`}>
                <div>
                  <strong>{f.name}</strong>
                  <span className="muted">{formatKb(f.size)}</span>
                </div>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeFile(i)} disabled={busy}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {progress && <div className="alert alert-info" role="status">{progress}</div>}
      <div className="button-row">
        <button className="btn" type="submit" disabled={busy || files.length === 0}>
          {busy ? 'Working...' : `Upload and validate${files.length > 1 ? ` (${files.length})` : ''}`}
        </button>
        <button className="btn btn-secondary" type="button" onClick={clearFiles} disabled={busy || files.length === 0}>
          Clear
        </button>
      </div>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
    </form>
  );
}
