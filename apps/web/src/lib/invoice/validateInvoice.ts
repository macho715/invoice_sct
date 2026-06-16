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

/**
 * validateInvoice — 인보이스 검증 코어 entrypoint (PR 1.2)
 *
 * 단일 invoice 입력에 대해 5개 규칙(필수필드, 합계, 중복, 요율참조, FX)을
 * 순차 적용하고 통합된 `ValidationResult`를 반환한다.
 *
 * - 결정적: 동일 입력 → 동일 결과 (rate manifest version만 다를 수 있음)
 * - 실패 무관: REQUIRED_FIELD_MISSING 이후에도 나머지 규칙은 적용 (Rule #0)
 * - 외부 의존 없음: rateReference stub + 결정적 set으로 in-memory 동작
 *
 * @see PLAN_20260616_160103.md PR 1
 * @see patch_g.md §"핵심 문제 1: 업로드/API 영역과 인보이스 검증 영역이 분리"
 *
 * @param input  검증할 인보이스 (any JSON, schema.parse 적용)
 * @param opts   외부 컨텍스트: 파일 해시, 결정적 set, rate manifest version
 * @returns      ValidationResult (valid + issues[] + validatorVersion)
 */
export function validateInvoice(
  input: unknown,
  opts: {
    seenInvoiceKeys?: Set<string>;
    seenFileHashes?: Set<string>;
    rateManifestVersion?: string;
  } = {},
): ValidationResult {
  // 1) Required fields / schema parse
  const { parsed, issues: requiredIssues } = checkRequiredFields(input);
  if (!parsed) {
    return {
      valid: false,
      issues: requiredIssues,
      validatorVersion: VALIDATOR_VERSION,
      rateManifestVersion: opts.rateManifestVersion,
    };
  }

  const dupCtx: DuplicateCheckInput = {
    fileHash: parsed.fileHash ?? null,
    seenInvoiceKeys: opts.seenInvoiceKeys ?? new Set<string>(),
    seenFileHashes: opts.seenFileHashes ?? new Set<string>(),
  };

  // 2) Apply remaining rules. REQUIRED_FIELD pass → continue.
  const allIssues: ValidationIssue[] = [
    ...checkTotals(parsed),
    ...checkDuplicate(parsed, dupCtx),
    ...checkRateReference(parsed, opts.rateManifestVersion),
    ...checkFx(parsed),
  ];

  const hasErrors = allIssues.some((i) => i.severity === 'error');
  return {
    valid: !hasErrors,
    issues: allIssues,
    validatorVersion: VALIDATOR_VERSION,
    rateManifestVersion: opts.rateManifestVersion,
  };
}

/** Re-exported for callers that want to type their inputs explicitly. */
export type { InvoiceInput, ValidationResult, ValidationIssue };
