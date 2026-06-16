import {
  VALIDATOR_VERSION,
  type InvoiceInput,
  type ValidationIssue,
  type ValidationResult,
} from './schema';
import { checkRequiredFields } from './rules/requiredFields';
import { checkTotals } from './rules/totals';
import { checkDuplicate, type DuplicateCheckInput } from './rules/duplicate';
import { checkRateReference } from './rules/rateReference';
import { checkFx } from './rules/fx';
import { getDefaultRateReferenceProvider } from './rateReferenceProviderFactory';
import type { RateReferenceProvider } from './rateReferenceProvider';

/**
 * validateInvoice — 인보이스 검증 코어 entrypoint (PR 1.2 + PR 4)
 *
 * 단일 invoice 입력에 대해 5개 규칙(필수필드, 합계, 중복, 요율참조, FX)을
 * 순차 적용하고 통합된 `ValidationResult`를 반환한다.
 *
 * PR 4 추가:
 *   - 요율 룰이 `RateReferenceProvider`를 통해 실제 rate_card 조회
 *   - 검증 결과에 `rateManifestVersion` stamp
 *
 * 결정성:
 *   - 요율 조회 외에는 모두 순수 함수
 *   - 같은 input + 같은 provider state → 같은 result
 *
 * 실패 무관:
 *   - REQUIRED_FIELD_MISSING 이후에도 나머지 규칙은 적용 (Rule #0)
 *   - rate provider가 null 반환 → RATE_NOT_FOUND warning (검증은 계속)
 *
 * @see PLAN_20260616_160103.md PR 1 + PR 4
 * @see patch_g.md §"핵심 문제 1: 업로드/API 영역과 인보이스 검증 영역이 분리"
 */
export async function validateInvoice(
  input: unknown,
  opts: {
    seenInvoiceKeys?: Set<string>;
    seenFileHashes?: Set<string>;
    rateManifestVersion?: string;
    rateProvider?: RateReferenceProvider;
    workflowType?: 'SHIPMENT' | 'DOMESTIC';
  } = {},
): Promise<ValidationResult> {
  // 1) Required fields / schema parse
  const { parsed, issues: requiredIssues } = checkRequiredFields(input);
  if (!parsed) {
    return {
      valid: false,
      issues: requiredIssues,
      validatorVersion: VALIDATOR_VERSION,
      rateManifestVersion: opts.rateManifestVersion ?? null,
    };
  }

  const dupCtx: DuplicateCheckInput = {
    fileHash: parsed.fileHash ?? null,
    seenInvoiceKeys: opts.seenInvoiceKeys ?? new Set<string>(),
    seenFileHashes: opts.seenFileHashes ?? new Set<string>(),
  };

  // 2) Apply remaining rules. REQUIRED_FIELD pass → continue.
  // Rate 룰은 provider를 통해 비동기로 동작 (PR 4).
  const rateProvider = opts.rateProvider ?? getDefaultRateReferenceProvider();
  const rateResult = await checkRateReference(
    parsed,
    rateProvider,
    opts.workflowType ?? 'SHIPMENT',
  );

  const allIssues: ValidationIssue[] = [
    ...checkTotals(parsed),
    ...checkDuplicate(parsed, dupCtx),
    ...rateResult.issues,
    ...checkFx(parsed),
  ];

  const hasErrors = allIssues.some((i) => i.severity === 'error');
  return {
    valid: !hasErrors,
    issues: allIssues,
    validatorVersion: VALIDATOR_VERSION,
    rateManifestVersion: opts.rateManifestVersion ?? rateResult.returnedManifestVersion,
  };
}

/** Re-exported for callers that want to type their inputs explicitly. */
export type { InvoiceInput, ValidationResult, ValidationIssue };
