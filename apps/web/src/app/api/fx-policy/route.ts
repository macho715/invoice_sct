import { NextResponse } from 'next/server';
import { STORE } from '@/lib/job-store';
import { FxPolicySchema } from '@/lib/types';
import { ErrorCodes, httpForError } from '@/lib/error-codes';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_STATE', message: 'invalid json body' },
      { status: 400 }
    );
  }

  const result = FxPolicySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      {
        code: 'BAD_REQUEST',
        message: 'Validation failed for FxPolicy',
        errors: result.error.errors
      },
      { status: 400 }
    );
  }

  const policy = result.data;
  await STORE.createFxPolicy(policy);

  return NextResponse.json({
    status: 'CREATED',
    fx_policy: policy
  }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  const policies = await STORE.listFxPolicies();
  return NextResponse.json({
    policies
  }, { status: 200 });
}
