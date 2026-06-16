'use client';
import { useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getInvoiceStepError, getEvidenceStepError, isStructuredInvoice, isPdfOnly, getUploadFileKind } from '@/lib/upload-validation';
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
      workflow_type: workflowType,
      ...(jobId ? { job_id: jobId, job_token: jobToken } : {}),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${file.name}: ${body.code} — ${body.message}`);
  return { jobId: body.job_id as string, jobToken: body.job_token as string };
}

type Step = 1 | 2;

function fileLabel(file: File, kind: 'invoice' | 'evidence'): string {
  const typeLabel = ({ xlsx: 'XLSX', md: 'MD', txt: 'TXT', pdf: 'PDF', unknown: '?' })[getUploadFileKind(file)];
  return `${kind === 'invoice' ? 'Invoice' : 'Evidence'} (${typeLabel})`;
}

export default function UploadForm() {
  const router = useRouter();
  const invoiceInputRef = useRef<HTMLInputElement | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [workflowType, setWorkflowType] = useState<WorkflowType>('SHIPMENT');

  const allFiles = [...invoiceFiles, ...evidenceFiles];
  const invoiceTotalBytes = invoiceFiles.reduce((sum, f) => sum + f.size, 0);
  const evidenceTotalBytes = evidenceFiles.reduce((sum, f) => sum + f.size, 0);
  const isPdfInvoice = invoiceFiles.length === 1 && isPdfOnly(invoiceFiles[0]);
  const hasStructuredInvoice = invoiceFiles.some(f => isStructuredInvoice(f));

  function clearAll() {
    setInvoiceFiles([]);
    setEvidenceFiles([]);
    setStep(1);
    setErr(null);
    if (invoiceInputRef.current) invoiceInputRef.current.value = '';
    if (evidenceInputRef.current) evidenceInputRef.current.value = '';
  }

  function goToEvidenceStep() {
    const error = getInvoiceStepError(invoiceFiles);
    if (error) { setErr(error); return; }
    setErr(null);
    setStep(2);
  }

  function goBackToInvoiceStep() {
    setErr(null);
    setStep(1);
  }

  async function runUpload() {
    const invoiceError = getInvoiceStepError(invoiceFiles);
    if (invoiceError) { setErr(invoiceError); setStep(1); return; }
    const evidenceError = getEvidenceStepError(evidenceFiles);
    if (evidenceError) { setErr(evidenceError); return; }

    setBusy(true); setErr(null);
    try {
      let jobId: string | null = null;
      let jobToken: string | null = null;
      for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        if (file.size > LARGE_FILE_THRESHOLD) {
          const uploaded = await uploadLargeFile(file, jobId, jobToken, workflowType, pct =>
            setProgress(`Uploading ${i + 1}/${allFiles.length}: ${file.name} (${Math.round(pct)}%)`));
          jobId = uploaded.jobId;
          jobToken = uploaded.jobToken;
          continue;
        }
        setProgress(`Uploading ${i + 1}/${allFiles.length}: ${file.name}`);
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
        if (!r.ok) { setErr(`${file.name}: ${body.code} — ${body.message}`); setBusy(false); setProgress(null); return; }
        jobId = jobId ?? body.job_id;
        jobToken = jobToken ?? body.job_token;
      }
      if (jobId && jobToken) {
        setProgress('Running validation…');
        const runRes = await fetch('/api/invoice-audit/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, job_token: jobToken })
        });
        if (!runRes.ok) {
          const runBody = await runRes.json().catch(() => ({ message: `HTTP ${runRes.status}` }));
          setErr(`Validation failed: ${runBody.code ?? 'ERROR'} — ${runBody.message ?? 'unknown'}`);
          return;
        }
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
    <form className="card" onSubmit={e => { e.preventDefault(); if (step === 1) goToEvidenceStep(); else runUpload(); }}>
      <div className="stack">
        <div>
          <p className="eyebrow">Invoice validation</p>
          <h2>Step {step}/2: {step === 1 ? 'Upload Invoice' : 'Upload Evidence'}</h2>
          <p className="muted">
            {step === 1
              ? 'Select your invoice file (.xlsx, .md, .txt) or a PDF. Then add supporting evidence PDFs in the next step.'
              : 'Add supporting evidence PDFs (delivery notes, BL, BOE, inspection reports). This step is optional — you can run validation without evidence.'}
          </p>
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

        <ol className="step-list" aria-label="Validation flow">
          <li className={step >= 1 ? 'is-done' : 'is-current'}>Upload invoice</li>
          <li className={step === 2 ? 'is-current' : step > 2 ? 'is-done' : ''}>Add evidence</li>
          <li className={busy ? 'is-current' : ''}>Run {workflowLabel} validation</li>
          <li>Download workbook</li>
        </ol>

        <hr />

        {step === 1 && (
          <>
            <div>
              <h3>Invoice file (required)</h3>
              <p className="muted">Upload your invoice. Use .xlsx for best results; .md and .txt are also supported. A .pdf can be used as invoice source (limited parsing).</p>
            </div>
            <label className="file-drop">
              <span className="file-drop-title">Choose invoice file</span>
              <span className="file-drop-copy">Accepted: .xlsx, .md, .txt, .pdf. Max 50MB per file.</span>
              <input
                ref={invoiceInputRef}
                className="input"
                type="file"
                multiple
                accept=".xlsx,.md,.txt,.pdf,application/pdf"
                onChange={e => {
                  setInvoiceFiles(Array.from(e.target.files ?? []));
                  setErr(null);
                }}
              />
            </label>
            {invoiceFiles.length > 0 && (
              <div className="file-panel" aria-live="polite">
                <div className="file-panel-header">
                  <strong>{invoiceFiles.length} invoice file{invoiceFiles.length > 1 ? 's' : ''}</strong>
                  <span className="muted">{formatKb(invoiceTotalBytes)}</span>
                </div>
                <ul className="file-list">
                  {invoiceFiles.map((f, i) => (
                    <li key={`inv-${f.name}-${f.size}-${i}`}>
                      <div>
                        <span className="file-badge file-badge-invoice">{fileLabel(f, 'invoice')}</span>
                        <strong>{f.name}</strong>
                        <span className="muted">{formatKb(f.size)}</span>
                      </div>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setInvoiceFiles(prev => prev.filter((_, j) => j !== i)); if (invoiceInputRef.current) invoiceInputRef.current.value = ''; }} disabled={busy}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                {isPdfInvoice && !hasStructuredInvoice && (
                  <div className="alert alert-warn" style={{ marginTop: 8 }}>
                    PDF used as invoice source — text extraction may be incomplete. For best results, upload a .xlsx invoice.
                  </div>
                )}
              </div>
            )}
            <div className="button-row">
              <button className="btn" type="submit" disabled={busy || invoiceFiles.length === 0}>
                Next: Add Evidence →
              </button>
              <button className="btn btn-secondary" type="button" onClick={clearAll} disabled={busy || (invoiceFiles.length === 0 && evidenceFiles.length === 0)}>
                Clear
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h3>Evidence PDFs (optional)</h3>
              <p className="muted">Attach supporting documents: Delivery Notes, BL, BOE, inspection reports, etc. PDF only.</p>
            </div>
            <div className="file-summary" style={{ marginBottom: 12 }}>
              <span className="file-badge file-badge-invoice">Invoice ({invoiceFiles.length})</span>
              {invoiceFiles.map(f => <code key={f.name} style={{ marginLeft: 8, fontSize: '0.85rem' }}>{f.name}</code>)}
            </div>
            <label className="file-drop">
              <span className="file-drop-title">Choose evidence PDFs</span>
              <span className="file-drop-copy">Accepted: .pdf only. Max 50MB per file. You can skip this step.</span>
              <input
                ref={evidenceInputRef}
                className="input"
                type="file"
                multiple
                accept=".pdf,application/pdf"
                onChange={e => {
                  setEvidenceFiles(Array.from(e.target.files ?? []));
                  setErr(null);
                }}
              />
            </label>
            {evidenceFiles.length > 0 && (
              <div className="file-panel" aria-live="polite">
                <div className="file-panel-header">
                  <strong>{evidenceFiles.length} evidence file{evidenceFiles.length > 1 ? 's' : ''}</strong>
                  <span className="muted">{formatKb(evidenceTotalBytes)}</span>
                </div>
                <ul className="file-list">
                  {evidenceFiles.map((f, i) => (
                    <li key={`ev-${f.name}-${f.size}-${i}`}>
                      <div>
                        <span className="file-badge file-badge-evidence">{fileLabel(f, 'evidence')}</span>
                        <strong>{f.name}</strong>
                        <span className="muted">{formatKb(f.size)}</span>
                      </div>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setEvidenceFiles(prev => prev.filter((_, j) => j !== i)); if (evidenceInputRef.current) evidenceInputRef.current.value = ''; }} disabled={busy}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {progress && <div className="alert alert-info" role="status">{progress}</div>}
            <div className="button-row">
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Working...' : 'Upload and Run Validation'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={goBackToInvoiceStep} disabled={busy}>
                ← Back
              </button>
              <button className="btn btn-ghost" type="button" onClick={clearAll} disabled={busy}>
                Clear All
              </button>
            </div>
          </>
        )}

        {err && <div className="alert alert-error" role="alert">{err}</div>}
      </div>
    </form>
  );
}
