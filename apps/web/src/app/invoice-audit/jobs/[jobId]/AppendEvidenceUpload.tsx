'use client';

import { useRef, useState, FormEvent } from 'react';

const LARGE_FILE_THRESHOLD = 4.5 * 1024 * 1024;

function formatKb(bytes: number) {
  return `${Math.ceil(bytes / 1024).toLocaleString()} KB`;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function appendLargeFile(
  file: File,
  jobId: string,
  jobToken: string | null,
  onProgress: (pct: number) => void,
): Promise<void> {
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
      job_id: jobId,
      job_token: jobToken,
    }),
  });
  const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(`${file.name}: ${body.code ?? 'REGISTER_FAILED'} — ${body.message ?? 'unknown'}`);
}

export default function AppendEvidenceUpload({ jobId, jobToken, disabled }: { jobId: string; jobToken: string | null; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  function clearFiles() {
    setFiles([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function appendFiles(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError('Select at least one evidence file.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > LARGE_FILE_THRESHOLD) {
          await appendLargeFile(file, jobId, jobToken, pct => {
            setProgress(`증빙 업로드 중 ${i + 1}/${files.length}: ${file.name} (${Math.round(pct)}%)`);
          });
          continue;
        }
        setProgress(`증빙 업로드 중 ${i + 1}/${files.length}: ${file.name}`);
        const fd = new FormData();
        fd.set('file', file);
        fd.set('job_id', jobId);
        if (jobToken) fd.set('job_token', jobToken);
        const res = await fetch('/api/files/ingest', {
          method: 'POST',
          body: fd,
          headers: { 'x-user-id': 'dev-user' },
        });
        const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        if (!res.ok) throw new Error(`${file.name}: ${body.code ?? 'INGEST_FAILED'} — ${body.message ?? 'unknown'}`);
      }
      clearFiles();
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form className="card" onSubmit={appendFiles} style={{ marginTop: 12 }}>
      <div className="stack">
        <div>
          <p className="eyebrow">Evidence upload</p>
          <h2>Add PDF evidence before validation</h2>
          <p className="muted">Use this when the invoice Excel was uploaded first. Files are appended to the same job_id and will be included when you run validation.</p>
        </div>
        <label className="file-drop">
          <span className="file-drop-title">Choose evidence files</span>
          <span className="file-drop-copy">Supported: .pdf, .xlsx, .md, .txt. Use PDF for BL, DO, BOE, quotation, receipt, or other evidence.</span>
          <input
            ref={inputRef}
            className="input"
            type="file"
            multiple
            accept=".pdf,.xlsx,.md,.txt,application/pdf"
            disabled={disabled || busy}
            onChange={e => {
              setFiles(Array.from(e.target.files ?? []));
              setError(null);
            }}
          />
        </label>
        {files.length > 0 && <p className="muted">{files.length} file{files.length > 1 ? 's' : ''} selected · Total {formatKb(totalBytes)}</p>}
        {progress && <div className="alert alert-info" role="status">{progress}</div>}
        <div className="button-row">
          <button className="btn btn-secondary" type="submit" disabled={disabled || busy || files.length === 0}>
            {busy ? 'Uploading...' : 'Add evidence to this job'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={clearFiles} disabled={busy || files.length === 0}>Clear</button>
        </div>
        {disabled && <div className="alert alert-warn">Evidence can only be added before validation starts. Create a new job if validation has already run.</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
      </div>
    </form>
  );
}
