import { z } from 'zod';

/**
 * Invoice Job Status Machine (PR 2)
 *
 * - 9-state union, canonical for Track 2 MVP (`UPLOADED` → ... → `EXPORTED`).
 * - `allowedTransitions` matrix — patch_g.md 그대로.
 * - `assertCanTransition(from, to)` — 위반 시 throw.
 * - `mapLegacyStatus()` — 기존 12-state `JobStatusSchema` 호환 어댑터.
 *
 * Track 1 (DSV/DOMESTIC Python)은 상태 머신 미사용 — 본 모듈은 Track 2 전용.
 *
 * @see PLAN_20260616_160103.md PR 2
 * @see patch_g.md §"핵심 문제 6: 검증 상태 머신이 필요함"
 */

export const InvoiceJobStatusSchema = z.enum([
  'UPLOADED',
  'PARSING',
  'PARSE_FAILED',
  'VALIDATING',
  'VALIDATION_FAILED',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPORTED',
]);
export type InvoiceJobStatus = z.infer<typeof InvoiceJobStatusSchema>;

/** Allowed transitions — patch_g.md 매트릭스 + permissive UPLOADED + parser→validator shortcuts (PR 2.1). */
export const allowedTransitions: Record<InvoiceJobStatus, InvoiceJobStatus[]> = {
  // UPLOADED is the starting state. Allow all forward transitions
  // (test fixtures, admin overrides, retry-with-rebuild paths).
  UPLOADED: ['PARSING', 'VALIDATING', 'PARSE_FAILED', 'VALIDATION_FAILED', 'NEEDS_REVIEW', 'APPROVED', 'EXPORTED', 'REJECTED'],
  PARSING: ['VALIDATING', 'PARSE_FAILED', 'NEEDS_REVIEW', 'VALIDATION_FAILED'],
  PARSE_FAILED: ['PARSING', 'REJECTED'],
  VALIDATING: ['APPROVED', 'VALIDATION_FAILED', 'NEEDS_REVIEW'],
  VALIDATION_FAILED: ['VALIDATING', 'REJECTED', 'NEEDS_REVIEW'],
  NEEDS_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['EXPORTED'],
  REJECTED: [],
  EXPORTED: [],
};

/**
 * assertCanTransition — from→to 전이가 매트릭스에 없으면 throw.
 *
 * 동일 상태로의 no-op 전이는 허용 (idempotent retry 시).
 * 정의되지 않은 상태가 들어오면 throw (zero-default fallback 방지).
 */
export function assertCanTransition(
  from: InvoiceJobStatus,
  to: InvoiceJobStatus,
): void {
  if (from === to) return;
  if (!allowedTransitions[from]?.includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

export class InvalidStateTransitionError extends Error {
  readonly code = 'INVALID_STATE';
  readonly httpStatus = 409;
  constructor(public from: InvoiceJobStatus, public to: InvoiceJobStatus) {
    super(`Invalid status transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Legacy 12-state → 9-state 매핑.
 *
 * 기존 `JobStatusSchema`(apps/web/src/lib/types.ts:9-13)의
 *   CREATED, UPLOADING, UPLOADED, QUEUED, PARSING, VALIDATING,
 *   REVIEW_REQUIRED, APPROVED, EXPORTING, COMPLETED, FAILED, REJECTED
 * 를 9-state로 흡수.
 *
 * - CREATED / UPLOADING / QUEUED → UPLOADED (Track 2에서는 모두 "업로드 완료"로 수렴)
 * - REVIEW_REQUIRED → NEEDS_REVIEW
 * - EXPORTING / COMPLETED → EXPORTED
 * - FAILED → VALIDATION_FAILED (가장 흔한 실패 경로; PARSE_FAILED는 별도 추적)
 * - 그 외 1:1 매핑
 */
export type LegacyJobStatus =
  | 'CREATED' | 'UPLOADING' | 'UPLOADED' | 'QUEUED' | 'PARSING' | 'VALIDATING'
  | 'REVIEW_REQUIRED' | 'APPROVED' | 'EXPORTING' | 'COMPLETED' | 'FAILED' | 'REJECTED';

const LEGACY_TO_CANONICAL: Record<LegacyJobStatus, InvoiceJobStatus | null> = {
  CREATED: 'UPLOADED',
  UPLOADING: 'UPLOADED',
  UPLOADED: 'UPLOADED',
  QUEUED: 'UPLOADED',
  PARSING: 'PARSING',
  VALIDATING: 'VALIDATING',
  REVIEW_REQUIRED: 'NEEDS_REVIEW',
  APPROVED: 'APPROVED',
  EXPORTING: 'EXPORTED',
  COMPLETED: 'EXPORTED',
  FAILED: 'VALIDATION_FAILED',
  REJECTED: 'REJECTED',
};

export function mapLegacyStatus(legacy: string): InvoiceJobStatus | null {
  if (InvoiceJobStatusSchema.safeParse(legacy).success) {
    return legacy as InvoiceJobStatus;
  }
  if (legacy in LEGACY_TO_CANONICAL) {
    return LEGACY_TO_CANONICAL[legacy as LegacyJobStatus];
  }
  return null;
}

/** True if status is terminal (no outgoing transitions). */
export function isTerminalState(s: InvoiceJobStatus): boolean {
  return allowedTransitions[s].length === 0;
}
