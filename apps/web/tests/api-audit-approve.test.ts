import { describe, it, expect } from 'vitest';
import { POST as APPROVE_POST } from '../src/app/api/audit/approve/route';
import { STORE } from '../src/lib/job-store';

describe('POST /api/audit/approve', () => {
  it('JOB_NOT_FOUND', async () => {
    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: 'job_nope', approval_scope: 'ZERO_APPROVED' }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD' }
      })
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('JOB_NOT_FOUND');
  });

  it('INVALID_STATE if job status is not REVIEW_REQUIRED', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'CREATED' });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'ZERO_APPROVED' }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD' }
      })
    );
    expect(res.status).toBe(409);
  });

  it('400 BAD_REQUEST if scope is AMBER_ACK but acknowledgement_reason is missing', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED' });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'AMBER_ACK' }),
        headers: { 'x-user-role': 'COST_CONTROL_LEAD' }
      })
    );
    expect(res.status).toBe(400);
  });

  it('403 HUMAN_GATE_REQUIRED if ZERO trigger is active but role lacks authority', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'ZERO' });
    
    // Set up normalized invoice total >= 100k AED (triggers HGT_01)
    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 150000.0 },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 0.99,
      parser_version: 'p1'
    });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'ZERO_APPROVED' }),
        headers: {
          'x-user-role': 'COST_CONTROL_LEAD', // Needs FINANCE_APPROVER
          'x-user-id': 'u1'
        }
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('HUMAN_GATE_REQUIRED');
  });

  it('200 APPROVED if authorized user approves', async () => {
    const job = await STORE.createJob({ created_by: 'user_1' });
    await STORE.updateJob(job.job_id, { status: 'REVIEW_REQUIRED', verdict: 'ZERO' });
    
    await STORE.setNormalizedInvoice(job.job_id, {
      invoice_id: 'i1',
      invoice_header: { currency: 'AED', invoice_total: 150000.0 },
      invoice_lines: [],
      evidence_candidates: [],
      parser_confidence: 0.99,
      parser_version: 'p1'
    });

    const res = await APPROVE_POST(
      new Request('http://test/api/audit/approve', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.job_id, approval_scope: 'ZERO_APPROVED' }),
        headers: {
          'x-user-role': 'FINANCE_APPROVER',
          'x-user-id': 'u1'
        }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('APPROVED');
    expect(body.prism_kernel_proof_ref).toBeDefined();

    const updatedJob = await STORE.getJob(job.job_id);
    expect(updatedJob?.status).toBe('APPROVED');
  });
});
