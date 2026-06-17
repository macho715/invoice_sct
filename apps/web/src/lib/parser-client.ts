export interface ParseRequestPayload {
  blob_ref: string;
  file_id: string;
  job_id: string;
  file_type: 'xlsx' | 'md' | 'txt' | 'pdf';  // P3B pdf support
  parser_version: string;
  blob_url: string;
  workflow_type?: 'SHIPMENT' | 'DOMESTIC';
}

export interface ParseResponse {
  parse_result_id: string;
  job_id: string;
  file_id: string;
  source_sha256?: string;
  normalized: unknown;
  source_data?: any[];
  parser_issues?: string[];
}

export interface NotebookLmRunPayload {
  job_id: string;
  blob_url: string;
  notebook_id?: string;
}

export interface NotebookLmRunResult {
  job_id?: string;
  status: string;
  notebooklm_source_id?: string | null;
  error_code?: string | null;
}

export interface VisionStartPayload {
  job_id: string;
  file_id: string;
  source_gcs_uri: string;
  output_gcs_prefix: string;
}

export interface VisionStartResult {
  job_id: string;
  file_id: string;
  operation_name?: string | null;
  status: 'VISION_DISABLED' | 'STARTED' | 'STUB';
  error_code?: string | null;
}

// 2026-06-17: approval-gated Vision OCR — poll worker `/v1/vision/collect`
// with the operation_name returned by `/v1/vision/start`.
export interface VisionCollectPayload {
  job_id: string;
  file_id: string;
  operation_name: string;
  output_gcs_prefix?: string;
}

export interface VisionCollectResult {
  job_id: string;
  file_id: string;
  operation_name: string;
  status:
    | 'VISION_DISABLED'
    | 'RUNNING'
    | 'COLLECTED'
    | 'VISION_OUTPUT_NOT_FOUND'
    | 'COLLECT_FAILED'
    | 'COLLECT_TIMEOUT';
  ocr_json_gcs_uri?: string | null;
  ocr_json_gcs_uris?: string[];
  page_count?: number;
  confidence?: number;
  evidence_candidate_count?: number;
  issues?: string[];
  error_code?: string | null;
  output_gcs_prefix?: string | null;
}

export interface VisionRunPayload {
  job_id: string;
  file_id: string;
  source_gcs_uri: string;
  output_gcs_prefix: string;
  timeout_seconds?: number;
}

export interface VisionRunResult {
  job_id: string;
  file_id: string;
  status: 'VISION_DISABLED' | 'VISION_RUN_COLLECTED' | 'VISION_RUN_FAILED' | 'VISION_TIMEOUT';
  invoice_lines?: any[];
  evidence_candidates?: any[];
  source_data?: any[];
  source_gcs_uri?: string | null;
  ocr_json_gcs_uris?: string[];
  page_count?: number;
  confidence?: number;
  issues?: string[];
  error_code?: string | null;
}

export interface ParserClient {
  parse(req: ParseRequestPayload): Promise<ParseResponse>;
  parsePdfText(req: ParseRequestPayload): Promise<ParseResponse>;
  runNotebookLm(req: NotebookLmRunPayload): Promise<NotebookLmRunResult>;
  startVisionOcr(req: VisionStartPayload): Promise<VisionStartResult>;
  collectVisionOcr(req: VisionCollectPayload): Promise<VisionCollectResult>;
  runVisionOcr(req: VisionRunPayload): Promise<VisionRunResult>;
}

export class ParseFailedError extends Error {
  readonly code = 'PARSE_FAILED';
  constructor(msg: string) { super(msg); this.name = 'ParseFailedError'; }
}

export function createParserClient(opts: { baseUrl: string; token: string }): ParserClient {
  const { baseUrl, token } = opts;
  const call = async (req: ParseRequestPayload) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(req)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ParseFailedError(`PARSE_FAILED: parser returned ${res.status}: ${txt}`);
    }
    return res.json() as Promise<ParseResponse>;
  };
  const runNotebookLm = async (req: NotebookLmRunPayload): Promise<NotebookLmRunResult> => {
    // Worker schema is extra="forbid"; only send notebook_id when present.
    const payload: Record<string, unknown> = { job_id: req.job_id, blob_url: req.blob_url };
    if (req.notebook_id) payload.notebook_id = req.notebook_id;
    const timeoutMs = Number(process.env.NOTEBOOKLM_TRIGGER_TIMEOUT_MS ?? 4000);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/notebooklm/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) return { status: 'TRIGGER_REJECTED', error_code: String(res.status) };
      return (await res.json()) as NotebookLmRunResult;
    } catch (e) {
      // Abort/timeout is expected: the long-running worker keeps processing and will
      // POST to the callback. Treat as a successful trigger rather than a failure.
      const name = (e as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') return { status: 'TRIGGERED' };
      throw e;
    }
  };
  const startVisionOcr = async (req: VisionStartPayload): Promise<VisionStartResult> => {
    const timeoutMs = Number(process.env.VISION_TRIGGER_TIMEOUT_MS ?? 8000);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/vision/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return { job_id: req.job_id, file_id: req.file_id, status: 'VISION_DISABLED', error_code: `HTTP_${res.status}` };
      }
      return (await res.json()) as VisionStartResult;
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { job_id: req.job_id, file_id: req.file_id, status: 'VISION_DISABLED', error_code: 'TRIGGER_TIMEOUT' };
      }
      return { job_id: req.job_id, file_id: req.file_id, status: 'VISION_DISABLED', error_code: 'TRIGGER_FAILED' };
    }
  };
  const collectVisionOcr = async (req: VisionCollectPayload): Promise<VisionCollectResult> => {
    const timeoutMs = Number(process.env.VISION_COLLECT_TIMEOUT_MS ?? 8000);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/vision/collect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return {
          job_id: req.job_id, file_id: req.file_id, operation_name: req.operation_name,
          status: 'COLLECT_FAILED', error_code: `HTTP_${res.status}`,
        };
      }
      return (await res.json()) as VisionCollectResult;
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return {
          job_id: req.job_id, file_id: req.file_id, operation_name: req.operation_name,
          status: 'COLLECT_TIMEOUT', error_code: 'COLLECT_TIMEOUT',
        };
      }
      return {
        job_id: req.job_id, file_id: req.file_id, operation_name: req.operation_name,
        status: 'COLLECT_FAILED', error_code: 'COLLECT_FAILED',
      };
    }
  };
  const runVisionOcr = async (req: VisionRunPayload): Promise<VisionRunResult> => {
    const timeoutSeconds = (req.timeout_seconds ?? 180) + 30;
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/vision/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout((timeoutSeconds + 30) * 1000),
      });
      if (!res.ok) {
        return { job_id: req.job_id, file_id: req.file_id, status: 'VISION_RUN_FAILED', error_code: `HTTP_${res.status}` };
      }
      return (await res.json()) as VisionRunResult;
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { job_id: req.job_id, file_id: req.file_id, status: 'VISION_TIMEOUT', error_code: 'RUN_TIMEOUT' };
      }
      return { job_id: req.job_id, file_id: req.file_id, status: 'VISION_RUN_FAILED', error_code: 'RUN_FAILED' };
    }
  };
  return {
    parse: call,
    parsePdfText: call,
    runNotebookLm,
    startVisionOcr,
    collectVisionOcr,
    runVisionOcr,
  };
}
