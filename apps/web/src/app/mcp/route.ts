import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function isDevStub(): boolean {
  return (process.env.CF_MCP_BASE_URL ?? '').startsWith('http://127.0.0.1:3000') ||
         (process.env.CF_MCP_BASE_URL ?? '').startsWith('http://localhost:3000');
}

const SAMPLE_COSTGUARD_LINES = [
  { lineId: 'l1', band: 'PASS', deltaPct: 0.5, verdict: 'ACCEPTABLE', proofRef: 'proof_e2e_1' },
  { lineId: 'l2', band: 'WARN', deltaPct: 4.2, verdict: 'REVIEW_REQUIRED', proofRef: 'proof_e2e_2' },
  { lineId: 'l3', band: 'PASS', deltaPct: 1.0, verdict: 'ACCEPTABLE', proofRef: 'proof_e2e_3' },
  { lineId: 'l4', band: 'HIGH', deltaPct: 8.0, verdict: 'HOLD_REQUIRED', proofRef: 'proof_e2e_4' }
];

export async function POST(req: Request): Promise<Response> {
  if (!isDevStub()) return NextResponse.json({ code: 'FORBIDDEN', message: 'dev mcp disabled' }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const tool = (body as { params?: { name?: string } }).params?.name;
  if (tool === 'route_question') {
    return NextResponse.json({ jsonrpc: '2.0', id: (body as { id?: number }).id ?? 1, result: { domain: 'invoice-cost', requiredCorpus: ['tariff_ref'] } });
  }
  if (tool === 'check_cost_guard') {
    return NextResponse.json({ jsonrpc: '2.0', id: (body as { id?: number }).id ?? 2, result: { lineResults: SAMPLE_COSTGUARD_LINES } });
  }
  if (tool === 'check_doc_guardian') {
    return NextResponse.json({ jsonrpc: '2.0', id: (body as { id?: number }).id ?? 3, result: { findings: [] } });
  }
  return NextResponse.json({ jsonrpc: '2.0', id: (body as { id?: number }).id ?? 0, error: { message: `unknown tool: ${tool}` } }, { status: 400 });
}
