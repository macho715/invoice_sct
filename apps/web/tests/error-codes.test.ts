import { describe, it, expect } from 'vitest';
import { ErrorCodes, httpForError, ErrorCode } from '../src/lib/error-codes';

describe('error-codes', () => {
  it('exposes Phase 1 error codes', () => {
    const expected: ErrorCode[] = [
      'NO_FILE','UNSUPPORTED_FILE_TYPE','UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD',
      'STORAGE_AUTH_FAILED','JOB_NOT_FOUND','INVALID_STATE','PARSE_FAILED',
      'MCP_UNAVAILABLE','VALIDATION_FAILED','FORBIDDEN'
    ];
    for (const c of expected) {
      expect(ErrorCodes).toContain(c);
    }
  });

  it('httpForError returns spec-defined HTTP codes', () => {
    expect(httpForError('NO_FILE')).toBe(400);
    expect(httpForError('UNSUPPORTED_FILE_TYPE')).toBe(400);
    expect(httpForError('UPLOAD_TOO_LARGE_REQUIRES_CLIENT_UPLOAD')).toBe(413);
    expect(httpForError('STORAGE_AUTH_FAILED')).toBe(500);
    expect(httpForError('JOB_NOT_FOUND')).toBe(404);
    expect(httpForError('INVALID_STATE')).toBe(409);
    expect(httpForError('PARSE_FAILED')).toBe(422);
    expect(httpForError('MCP_UNAVAILABLE')).toBe(503);
    expect(httpForError('VALIDATION_FAILED')).toBe(422);
    expect(httpForError('FORBIDDEN')).toBe(403);
  });
});
