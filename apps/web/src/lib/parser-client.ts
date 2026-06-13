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

export interface ParserClient {
  parse(req: ParseRequestPayload): Promise<ParseResponse>;
  parsePdfText(req: ParseRequestPayload): Promise<ParseResponse>;  // P3B dedicated (same endpoint, typed for pdf)
}

export class ParseFailedError extends Error {
  readonly code = 'PARSE_FAILED';
  constructor(msg: string) { super(msg); this.name = 'ParseFailedError'; }
}

export function createParserClient(opts: { baseUrl: string; token: string }): ParserClient {
  const { baseUrl, token } = opts;
  const call = async (req: ParseRequestPayload) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/parse`, {
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
  return {
    parse: call,
    parsePdfText: call,  // for now same wire; P3B+ can evolve response shape
  };
}
