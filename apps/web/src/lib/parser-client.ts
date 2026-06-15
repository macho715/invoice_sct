export interface ParseRequestPayload {
  blob_ref: string;
  file_id: string;
  job_id: string;
  file_type: 'xlsx' | 'md' | 'txt' | 'pdf';  // P3B pdf support
  parser_version: string;
  blob_url: string;
}

export interface ParseResponse {
  parse_result_id: string;
  job_id: string;
  file_id: string;
  normalized: unknown;
  // Phase 3 reviewer feedback + domestic fullset port: complete pdf_source_data from spans
  source_data?: any[];
}

export interface NotebookLmRunPayload {
  job_id: string;
  blob_url: string;
  notebook_id?: string;
}

export interface NotebookLmRunResult {
  job_id?: string;
  // CALLBACK_SENT | CALLBACK_REJECTED | NOTEBOOKLM_UNAVAILABLE (from worker) |
  // TRIGGERED (web aborted the long worker call; worker keeps running) | TRIGGER_REJECTED
  status: string;
  notebooklm_source_id?: string | null;
  error_code?: string | null;
}

export interface ParserClient {
  parse(req: ParseRequestPayload): Promise<ParseResponse>;
  parsePdfText(req: ParseRequestPayload): Promise<ParseResponse>;  // P3B dedicated (same endpoint, typed for pdf)
  // Fire the MarkItDown -> NotebookLM extraction on the worker. The worker runs the
  // (up to ~300s) orchestrator and POSTs results to /api/notebooklm/ingest-summary,
  // so this call only triggers it with a short timeout — it does NOT wait for the result.
  runNotebookLm(req: NotebookLmRunPayload): Promise<NotebookLmRunResult>;
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
  return {
    parse: call,
    parsePdfText: call,  // for now same wire; P3B+ can evolve response shape
    runNotebookLm,
  };
}
