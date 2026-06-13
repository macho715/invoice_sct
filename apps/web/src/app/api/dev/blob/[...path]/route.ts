import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';

const DEV_BLOB_DIR = join(process.cwd(), '.dev-blob');

function isDevStub(): boolean {
  const t = process.env.BLOB_READ_WRITE_TOKEN ?? '';
  if (t !== '' && !t.startsWith('dev-stub')) return false;
  if (process.env.VERCEL === '1') {
    return false;
  }
  return true;
}

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { params } = ctx;
  if (!isDevStub()) {
    return NextResponse.json({ code: 'FORBIDDEN', message: 'dev blob endpoint disabled' }, { status: 403 });
  }
  const filename = (await params).path.join('/');
  const target = join(DEV_BLOB_DIR, filename);
  if (!target.startsWith(DEV_BLOB_DIR) || !existsSync(target)) {
    return NextResponse.json({ code: 'JOB_NOT_FOUND', message: 'blob not found' }, { status: 404 });
  }
  const buf = readFileSync(target);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { 'content-type': 'application/octet-stream' }
  });
}
