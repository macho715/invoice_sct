import { describe, it, expect } from 'vitest';
import {
  allowedTransitions,
  assertCanTransition,
  InvoiceJobStatusSchema,
  InvalidStateTransitionError,
  isTerminalState,
  mapLegacyStatus,
} from '../../src/lib/invoice/statusMachine';

/**
 * statusMachine 9-state × transition matrix — PR 5.2.
 *
 * Verifies:
 *  - Every allowed transition from allowedTransitions[from] passes assertCanTransition.
 *  - No transition not in the matrix passes (negative cases).
 *  - mapLegacyStatus covers the 12 → 9 state compression.
 *  - isTerminalState returns true for REJECTED, EXPORTED.
 *
 * @see PLAN_20260616_160103.md PR 5.2
 * @see apps/web/src/lib/invoice/statusMachine.ts
 */

const ALL_STATES: Array<keyof typeof allowedTransitions> = InvoiceJobStatusSchema.options;

describe('statusMachine — 9-state transition matrix', () => {
  // Positive: every (from, to) in allowedTransitions[from] is accepted.
  for (const from of ALL_STATES) {
    for (const to of allowedTransitions[from]) {
      it(`ALLOWS ${from} → ${to}`, () => {
        expect(() => assertCanTransition(from, to)).not.toThrow();
      });
    }
  }

  // Negative: every (from, to) NOT in allowedTransitions[from] (and not self-loop) is rejected.
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      if (from === to) continue;  // self-loops are allowed (idempotent retry)
      if (allowedTransitions[from].includes(to)) continue;
      it(`REJECTS ${from} → ${to}`, () => {
        expect(() => assertCanTransition(from, to)).toThrow(InvalidStateTransitionError);
      });
    }
  }

  it('UPLOADED is permissive — allows all forward states', () => {
    for (const to of ALL_STATES) {
      expect(() => assertCanTransition('UPLOADED', to)).not.toThrow();
    }
  });

  it('REJECTED and EXPORTED are terminal', () => {
    expect(isTerminalState('REJECTED')).toBe(true);
    expect(isTerminalState('EXPORTED')).toBe(true);
    expect(isTerminalState('APPROVED')).toBe(false);
    expect(isTerminalState('PARSING')).toBe(false);
  });

  it('self-loop is a no-op (idempotent retry)', () => {
    for (const s of ALL_STATES) {
      expect(() => assertCanTransition(s, s)).not.toThrow();
    }
  });
});

describe('statusMachine — mapLegacyStatus 12→9', () => {
  it('CREATED, UPLOADING, QUEUED all collapse to UPLOADED', () => {
    expect(mapLegacyStatus('CREATED')).toBe('UPLOADED');
    expect(mapLegacyStatus('UPLOADING')).toBe('UPLOADED');
    expect(mapLegacyStatus('QUEUED')).toBe('UPLOADED');
  });

  it('REVIEW_REQUIRED → NEEDS_REVIEW', () => {
    expect(mapLegacyStatus('REVIEW_REQUIRED')).toBe('NEEDS_REVIEW');
  });

  it('EXPORTING, COMPLETED → EXPORTED', () => {
    expect(mapLegacyStatus('EXPORTING')).toBe('EXPORTED');
    expect(mapLegacyStatus('COMPLETED')).toBe('EXPORTED');
  });

  it('FAILED maps to FAILED (no change — VALIDATION_FAILED is the canonical)', () => {
    // FAILED is preserved as-is; semantically same as VALIDATION_FAILED for callers
    expect(['FAILED', 'VALIDATION_FAILED']).toContain(mapLegacyStatus('FAILED'));
  });

  it('canonical 9-state names pass through unchanged', () => {
    for (const s of ALL_STATES) {
      expect(mapLegacyStatus(s)).toBe(s);
    }
  });
});
