'use client';
import { useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getUploadSelectionError } from '@/lib/upload-validation';
import type { WorkflowType } from '@/lib/types';

const LARGE_FILE_THRESHOLD = 4.5 * 1024 * 1024;

function formatKb(bytes: number) {
  return `${Math.ceil(bytes / 1024).toLocaleString()} KB`;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadLargeFile(
  file: File,
  jobId: string | null,
  jobToken: string | null,
  workflowType: WorkflowType,
  onProgress: (pct: number) => void,
): Promise<{ jobId: string; jobToken: string }> {
  const { upload } = await import('@vercel/blob/client');
  const blob = await upload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/invoices/upload-url',
    onUploadProgress: e => onProgress(e.percentage),
  });
  const sha256 = await sha256Hex(file);
  const res = await fetch('/api/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'dev-user' },
    body: JSON.stringify({
      blob_url: blob.url,
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
      sha256,
      workflow_type: workflowType,
      ...(jobId ? { job_id: jobId, job_token: jobToken } : {}),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${file.name}: ${body.code} — ${body.message}`);
  return { jobId: body.job_id as string, jobToken: body.job_token as string };
}

async function ingestSmallFile(
  file: File,
  jobId: string | null,
  jobToken: string | null,
  workflowType: WorkflowType,
  onProgress: (pct: number) => void,
): Promise<{ jobId: string; jobToken: string }> {
  onProgress(50);
  const fd = new FormData();
  fd.set('file', file);
  if (jobId) fd.set('job_id', jobId);
  if (jobToken) fd.set('job_token', jobToken);
  fd.set('workflow_type', workflowType);
  const r = await fetch('/api/files/ingest', {
    method: 'POST',
    body: fd,
    headers: { 'x-user-id': 'dev-user' }
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${file.name}: ${body.code} — ${body.message}`);
  onProgress(100);
  return { jobId: body.job_id as string, jobToken: body.job_token as string };
}

export default function UploadForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [workflowType, setWorkflowType] = useState<WorkflowType>('SHIPMENT');
  const [autoRun, setAutoRun] = useState(false);
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

  async function runValidation(jobId: string, jobToken: string) {
    setProgress('Running validation…');
    const runRes = await fetch('/api/invoice-audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, job_token: jobToken })
    });
    if (!runRes.ok) {
      const runBody = await runRes.json().catch(() => ({ message: `HTTP ${runRes.status}` }));
      throw new Error(`Validation failed: ${runBody.code ?? 'ERROR'} — ${runBody.message ?? 'unknown'}`);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const selectionError = getUploadSelectionError(files);
    if (selectionError) { setErr(selectionError); return; }

    setBusy(true); setErr(null);
    try {
      let jobId: string | null = null;
      let jobToken: string | null = null;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > LARGE_FILE_THRESHOLD) {
          const uploaded = await uploadLargeFile(file, jobId, jobToken, workflowType, pct =>
            setProgress(`Uploading ${i + 1}/${files.length}: ${file.name} (${Math.round(pct)}%)`));
          jobId = uploaded.jobId;
          jobToken = uploaded.jobToken;
        } else {
          setProgress(`Uploading ${i + 1}/${files.length}: ${file.name}`);
          const uploaded = await ingestSmallFile(file, jobId, jobToken, workflowType, () => {});
          jobId = jobId ?? uploaded.jobId;
          jobToken = jobToken ?? uploaded.jobToken;
        }
      }
      if (jobId && jobToken) {
        if (autoRun) await runValidation(jobId, jobToken);
        router.push(`/invoice-audit/jobs/${jobId}?job_token=${encodeURIComponent(jobToken)}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const workflowLabel = workflowType === 'SHIPMENT' ? 'Import Shipment' : 'Domestic Delivery';
  const workflowDesc = workflowType === 'SHIPMENT'
    ? 'International import invoice audit — AED/USD, customs/BOE, BL/DO/PO, DEM/DET'
    : 'Korean domestic delivery audit — KRW, lane/distance rates, short-run detection';

  return (
    <form className="card" onSubmit={onSubmit}>
      <div className="stack">
        <div>
          <p className="eyebrow">Invoice validation</p>
          <h2>Upload invoice or evidence</h2>
          <p className="muted">Excel, text, markdown, or PDF files are accepted. Upload invoice and evidence together, or upload the invoice first and add evidence on the job dashboard before running validation.</p>
        </div>

        <fieldset className="workflow-selector">
          <legend className="fieldset-legend">Workflow Type</legend>
          <div className="radio-group">
            <label className={`radio-card${workflowType === 'SHIPMENT' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="workflow_type"
                value="SHIPMENT"
                checked={workflowType === 'SHIPMENT'}
                onChange={() => setWorkflowType('SHIPMENT')}
                disabled={busy}
              />
              <span className="radio-label">SHIPMENT</span>
              <span className="radio-desc">Import shipment invoice audit</span>
            </label>
            <label className={`radio-card${workflowType === 'DOMESTIC' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="workflow_type"
                value="DOMESTIC"
                checked={workflowType === 'DOMESTIC'}
                onChange={() => setWorkflowType('DOMESTIC')}
                disabled={busy}
              />
              <span className="radio-label">DOMESTIC</span>
              <span className="radio-desc">Domestic delivery invoice audit</span>
            </label>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem' }}>{workflowDesc}</p>
        </fieldset>

        <fieldset className="workflow-selector">
          <legend className="fieldset-legend">Run Control</legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoRun}
              onChange={e => setAutoRun(e.target.checked)}
              disabled={busy}
            />
            <span>Run validation immediately after upload</span>
          </label>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Leave unchecked when the invoice Excel will be uploaded first and evidence PDFs will be added later from the job dashboard.
          </p>
        </fieldset>

        <ol className="step-list" aria-label="Validation flow">
          <li className={files.length > 0 ? 'is-done' : 'is-current'}>Select files</li>
          <li className={busy ? 'is-current' : ''}>Upload</li>
          <li>{autoRun ? `Run ${workflowLabel} validation` : 'Add evidence or run manually'}</li>
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
          const picked = Array.from(e.target.files ?? []);
          setFiles(current => {
            const seen = new Set(current.map(f => `${f.name}:${f.size}`));
            return [...current, ...picked.filter(f => !seen.has(`${f.name}:${f.size}`))];
          });
          setErr(null);
          // Reset the native input so picking again (incl. the same file) re-fires onChange,
          // letting the user accumulate files across multiple selections instead of replacing.
          if (fileInputRef.current) fileInputRef.current.value = '';
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
          {busy ? 'Working...' : `${autoRun ? 'Upload and validate' : 'Upload files'}${files.length > 1 ? ` (${files.length})` : ''}`}
        </button>
        <button className="btn btn-secondary" type="button" onClick={clearFiles} disabled={busy || files.length === 0}>
          Clear
        </button>
      </div>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
    </form>
  );
}
