판정: PASS WITH WARNINGS — rate 검증 로직 설명 가능, 단 개별 invoice line 판정은 아직 아님.
근거: Project Source Package v3.2 `00_README_RUN_FIRST.md` / `rules/contract_rate_manifest_v3.1_PRO.json` / `private/contract_rate.json`; rate master 250건, 3회 구조검증 PASS, Rate=[PRIVATE] 마스킹 적용.  
다음행동: 실제 검증하려면 각 invoice line의 `Charge / Port / Destination / Unit / Qty / Currency / Amount / Evidence`를 넣어 Line_Audit 기준으로 실행.

## 1. 전체 rate 검증 흐름

Rate 검증은 단순히 invoice 금액과 contract 단가를 비교하는 방식이 아닙니다. **먼저 matching scope가 맞는지 확인하고, 그 다음 numeric compare 가능 여부를 판단하고, 마지막에 evidence/reconciliation gate를 통과해야 합니다.**

기본 pipeline은 아래 순서입니다.

| Step | 로직                                                                                 | 실패 시                                 |
| ---: | ---------------------------------------------------------------------------------- | ------------------------------------ |
|    1 | Invoice line에서 charge, route, unit, qty, currency, amount 추출                       | Source ambiguity → AMBER             |
|    2 | TYPE_B 분류: Customs / DO / INLAND / THC / Inspection / Detention / STROAGE / OTHERS | TYPE_B 공란 금지, 실패 시 OTHERS + AMBER    |
|    3 | Contract 후보 lookup: `Normalized_Charge + Route_Key + Unit + Scope`                 | 후보 없음 → AMBER 또는 ZERO                |
|    4 | `Rate_Type / Match_Eligible / GPT_Validation_Rule / AI_Rate_Status` 확인             | 자동비교 불가 시 evidence path              |
|    5 | numeric rate이면 unit rate 또는 total basis로 variance 계산                               | tolerance 초과 → AMBER/FAIL            |
|    6 | AT COST / AS PER OFFER / Case by Case / missing rate이면 supporting evidence 필수      | 증빙 없으면 PASS 금지                       |
|    7 | Evidence_Status 부여                                                                 | blank 금지                             |
|    8 | Line_Audit total = TYPE-B total = Final Subtotal Before VAT tie-out                | Delta 존재 시 FAIL                      |
|    9 | 3회 validation loop 후 final decision                                                | mismatch 시 AMBER/VALIDATION_MISMATCH |

## 2. Contract lookup 기준

`contract_rate.json`의 핵심 lookup key는 아래 필드 조합입니다. Contract master는 `Contract_Row_ID`, `GPT_Primary_Key`, `TYPE_B`, `Normalized_Charge`, `Route_Key`, `Unit`, `Rate_Type`, `Match_Eligible`, `AI_Rate_Status`를 필수 검증 필드로 봅니다. 실제 package script도 이 필드들의 존재 여부와 `TYPE_B` 유효값을 검사합니다.

| 기준                  | 설명                                                                |
| ------------------- | ----------------------------------------------------------------- |
| `Contract_Row_ID`   | audit citation용 stable row ID                                     |
| `GPT_Primary_Key`   | deterministic composite key                                       |
| `Normalized_Charge` | charge description 정규화값                                           |
| `Route_Key`         | Port 또는 Port → Destination                                        |
| `Unit`              | per B/L, per truck, per RT, per KG 등                              |
| `TYPE_B`            | cost bucket                                                       |
| `Scope`             | Cargo category/type, container type, detail cargo, MT/LWH range 등 |
| `Rate_Type`         | numeric / text exception / missing rate                           |
| `AI_Rate_Status`    | auto-compare 가능 여부 및 review 필요 여부                                 |

Package manifest상 `private/contract_rate.json`은 private internal rate master이며 public share 불가이고, 원단가/FX/rate basis 필드는 공개 금지 대상입니다. 따라서 설명에서는 `Rate=[PRIVATE]`로 처리합니다. 

## 3. Rate_Type별 판정 로직

### A. `CONTRACT_NUMERIC` + `AUTO_COMPARE_OK`

이 경우만 기본적으로 자동비교가 가능합니다.

조건은 다음과 같습니다.

```text
charge match = true
route match = true
unit match = true
scope match = true
Rate_Type = CONTRACT_NUMERIC
Match_Eligible = Y
AI_Rate_Status = AUTO_COMPARE_OK
```

비교 방식:

```text
invoice_unit_rate = invoice_amount / billable_qty
expected_amount = contract_rate * billable_qty
variance_amount = invoice_amount - expected_amount
variance_pct = variance_amount / expected_amount
```

판정:

| 조건                               | Rate_Check_Result        |
| -------------------------------- | ------------------------ |
| `abs(variance_pct) <= tolerance` | PASS_RATE                |
| tolerance 초과, autofail 미만        | AMBER_RATE_VARIANCE      |
| autofail 이상 또는 root cause 불명     | FAIL_RATE_VARIANCE       |
| currency/qty/unit basis 불명       | AMBER_RATE_BASIS_MISSING |
| contract match는 되지만 evidence가 부족 | AMBER_EVIDENCE_PARTIAL   |

`ROUNDUP(2)`는 display/tie-out용이며, rate 비교에 자동 적용하지 않습니다. Contract master의 compare basis에서도 ROUNDUP은 display only로 취급됩니다. 

### B. `AUTO_COMPARE_WITH_DUPLICATE_REVIEW`

이 경우 numeric 비교는 수행하되, **PASS 확정은 금지**입니다.

사유는 같은 `Contract_Key` 또는 유사 scope가 여러 개 있을 수 있기 때문입니다. 이때는 아래 우선순위로 가장 specific한 row를 선택합니다.

1. Exact `Cargo_Category / Cargo_Type`
2. Exact `Port`
3. Exact `Destination`
4. Exact `Container_Type`
5. Exact `Detail_Cargo_Type`
6. Exact `Unit`
7. Exact `MT / LWH range`
8. Lowest ambiguity / most specific `Contract_Row_ID`

판정:

| 상태                                     | 처리                     |
| -------------------------------------- | ---------------------- |
| amount within tolerance + duplicate 존재 | AMBER_DUPLICATE_REVIEW |
| reviewer가 most-specific row 확인         | PASS WITH WARNINGS 가능  |
| duplicate 중 다른 rate 가능성 존재             | AMBER 또는 FAIL          |
| duplicate 원인 추적 불가 + final approval 요청 | ZERO                   |

Contract master에는 `AUTO_COMPARE_WITH_DUPLICATE_REVIEW`와 `REVIEW_NUMERIC_DUPLICATE` 상태가 별도 존재하며, duplicate row는 reviewer 확인 전 sign-off 금지로 처리됩니다. 

### C. `AUTO_COMPARE_REQUIRE_REVIEW_EVIDENCE`

이 경우도 numeric rate는 있지만, source flag/outlier/data quality issue가 있는 row입니다.

처리:

```text
numeric compare는 수행
BUT reviewer evidence required
PASS 자동 확정 금지
```

판정:

| 조건                                             | 판정                        |
| ---------------------------------------------- | ------------------------- |
| amount within tolerance + reviewer evidence 있음 | PASS WITH WARNINGS        |
| evidence partial                               | AMBER_DATA_QUALITY_REVIEW |
| evidence missing                               | AMBER 또는 ZERO             |
| high-value/final settlement인데 evidence 없음      | ZERO                      |

`REVIEW_FLAG_OUTLIER` 또는 `REVIEW_NUMERIC_DATA_QUALITY`는 “비교 가능하지만 reviewer confirmation 필요”로 봅니다. 

### D. `TEXT_EXCEPTION`

`AT COST`, `AS PER OFFER`, `Case by Case`, `At Cost after free time` 같은 row입니다.

이 경우는 **numeric contract rate가 아니므로 자동 PASS 불가**입니다.

처리:

```text
Rate_Type = TEXT_EXCEPTION
Match_Eligible = N
AI_Rate_Status = EXCEPTION_EVIDENCE_REQUIRED
```

필수 evidence:

| Charge type          | 요구 evidence                                           |
| -------------------- | ----------------------------------------------------- |
| AT COST              | vendor invoice / terminal invoice / official receipt  |
| AS PER OFFER         | approved offer / client approval                      |
| Storage / DEM/DET    | dates, free time, tariff, invoice, settlement support |
| Customs / Inspection | BOE, customs proof, inspection evidence               |
| Case by Case         | approved offer 또는 explicit client approval            |

판정:

| Evidence_Status  | 결과                             |
| ---------------- | ------------------------------ |
| MATCHED_EXACT    | PASS WITH WARNINGS 가능          |
| MATCHED_AMOUNT   | PASS WITH WARNINGS 또는 AMBER    |
| MATCHED_APPROVAL | PASS WITH WARNINGS 가능          |
| PARTIAL          | AMBER                          |
| MISSING          | AMBER; final settlement이면 ZERO |
| CONFLICT         | FAIL 또는 ZERO                   |

Contract master는 text exception에 대해 “no numeric automatic PASS; supporting evidence required”로 처리합니다. 

### E. `MISSING_RATE`

이 경우는 contract row는 있으나 numeric rate도 text exception도 확정되지 않은 상태입니다.

처리:

```text
Rate_Type = MISSING_RATE
Match_Eligible = N
AI_Rate_Status = MISSING_RATE_NO_AUTO_PASS
```

판정:

| 상황                               | 결과                                              |
| -------------------------------- | ----------------------------------------------- |
| draft audit                      | AMBER_CONTRACT_RATE_MISSING                     |
| contract owner가 approved rate 제공 | 재검증                                             |
| final approval 요청                | ZERO                                            |
| evidence만 있고 contract rate 없음    | AMBER, 단 pass-through 성격이면 approval basis 별도 필요 |

`MISSING_RATE` row는 “do not compare; contract owner must add approved rate or exception”으로 처리됩니다. 

## 4. Variance 계산 로직

Rate 비교는 unit basis가 일치해야 합니다.

```text
1. contract_unit = contract_rate.Unit
2. invoice_unit = invoice line unit 또는 계산된 unit
3. billable_qty = invoice Qty / Weight / RT / KG / truck count / B/L count
4. invoice_unit_rate = invoice_amount / billable_qty
5. contract_unit_rate = Rate=[PRIVATE]
6. variance_amount = invoice_unit_rate - contract_unit_rate
7. variance_pct = variance_amount / contract_unit_rate
```

단, 사용자에게 출력할 때는 contract_unit_rate 자체를 노출하지 않습니다.

출력 예시는 아래처럼 합니다.

```text
Contract_Row_ID = CR-XXXX
Rate_Source = contract_rate.json
Rate = [PRIVATE]
Invoice_Unit_Rate = [MASKED if required]
Variance = +X.XX%
Rate_Check_Result = AMBER_RATE_VARIANCE
Reason = Unit matched, route matched, but variance exceeds tolerance.
```

## 5. Currency / FX 처리

Currency가 다르면 FX basis가 필요합니다.

우선순위:

1. Invoice에 명시된 FX
2. Evidence에 명시된 FX
3. Approved offer의 FX
4. Contract reference FX
5. No FX basis → AMBER

주의점:

```text
FX가 없는데 AED/USD를 임의 환산해서 PASS 금지
FX difference가 variance 원인인지 별도 표시
ROUNDUP(2)은 rate compare에 자동 적용 금지
```

`Evidence_Checklist`에서도 currency conversion이 variance에 영향을 주는 경우 FX Basis evidence가 필요하다고 정의되어 있습니다.

## 6. TYPE_B와 rate 검증의 연결

TYPE_B는 단순 reporting용이 아니라 rate lookup 후보를 좁히는 핵심 key입니다.

분류 우선순위:

| Priority | Keyword                                   | TYPE_B     |
| -------: | ----------------------------------------- | ---------- |
|        1 | customs inspection                        | Inspection |
|        2 | customs clearance / BOE / customs duty    | Customs    |
|        3 | DO / delivery order                       | DO         |
|        4 | truck / inland / transport / MOSB / CICPA | INLAND     |
|        5 | THC / terminal handling / port handling   | THC        |
|        6 | detention                                 | Detention  |
|        7 | storage / warehouse / yard storage        | STROAGE    |
|        8 | 기타                                        | OTHERS     |

중요한 점은 **TYPE_B 공란 금지**입니다. 분류가 애매하면 `OTHERS`로 보내고 `AMBER/TYPE_B_UNCERTAIN`을 붙입니다. TYPE-B total과 Line_Audit total이 다르면 `FAIL/TYPE_B_RECON_MISMATCH`입니다.

## 7. Evidence_Status 판정

모든 line은 Evidence_Status가 있어야 합니다.

허용값:

```text
MATCHED_EXACT
MATCHED_AMOUNT
MATCHED_APPROVAL
PARTIAL
MISSING
CONFLICT
NOT_APPLICABLE
```

판정 로직:

| Evidence_Status  | 의미                   | Rate audit 처리                 |
| ---------------- | -------------------- | ----------------------------- |
| MATCHED_EXACT    | 금액/문서/charge/ref 일치  | PASS 가능                       |
| MATCHED_AMOUNT   | 금액 일치, context 일부 약함 | warning 가능                    |
| MATCHED_APPROVAL | client approval로 보강  | pass-through 가능               |
| PARTIAL          | 일부만 확인               | AMBER                         |
| MISSING          | 증빙 없음                | AMBER 또는 ZERO                 |
| CONFLICT         | invoice/evidence 불일치 | FAIL 또는 ZERO                  |
| NOT_APPLICABLE   | 증빙 불필요               | numeric contract match일 때만 사용 |

Evidence confidence model 기준으로 critical evidence는 pass-ready threshold를 만족해야 하며, critical gate evidence가 부족하면 PASS 금지입니다.

## 8. Final_Recon gate

Rate line이 개별적으로 맞아도 최종 PASS는 별도입니다.

필수 tie-out:

```text
Source Total
= Line_Audit Total
= TYPE-B Total
= Final Subtotal Before VAT
```

허용 delta:

```text
abs(delta) <= 0.01
```

실패 시:

| 상황                                    | 판정                                   |
| ------------------------------------- | ------------------------------------ |
| Line_Audit total ≠ TYPE-B total       | FAIL                                 |
| Final Subtotal Before VAT 없음          | AMBER                                |
| Final approval 요청 + Final Subtotal 없음 | ZERO                                 |
| Delta 원인 추적 불가                        | ZERO                                 |
| ROUNDUP 때문에 display 차이만 존재            | PASS WITH WARNINGS 가능, disclosure 필수 |

Release gate는 final subtotal, line-vs-type-B delta, evidence_status blank, required sheet missing, DLP hit 등을 hard blocker로 정의합니다.

## 9. 실제 Line_Audit output 예시

원단가는 노출하지 않고 아래처럼 기록합니다.

| Column          | 예시                                                    |
| --------------- | ----------------------------------------------------- |
| Shipment_No     | Shipment=[MASKED]                                     |
| Row_ID          | INV-001                                               |
| Rate_Source     | contract_rate.json / Contract_Row_ID=CR-XXXX          |
| Description     | DO Fee                                                |
| Formula_Text    | `Amount / Qty` 텍스트 보존                                 |
| Amount          | Invoice amount                                        |
| TYPE_B          | DO                                                    |
| Evidence_Status | MATCHED_EXACT                                         |
| Contract_Status | AUTO_COMPARE_OK                                       |
| Variance        | Within tolerance / Above tolerance                    |
| Risk            | LOW / MEDIUM / HIGH                                   |
| Action          | No action / Evidence required / Contract owner review |

## 10. Decision tree 요약

```text
START
 ├─ Project Source scanned?
 │   └─ No → AMBER/PROJECT_SOURCE_NOT_SCANNED
 ├─ Contract source exists?
 │   └─ No → AMBER or ZERO
 ├─ Invoice line normalized?
 │   └─ No → AMBER/SOURCE_PARSE
 ├─ TYPE_B classified?
 │   └─ No → OTHERS + AMBER/TYPE_B_UNCERTAIN
 ├─ Contract candidate found by charge/route/unit/scope?
 │   └─ No → AMBER/CONTRACT_SCOPE_UNMATCHED
 ├─ Rate_Type?
 │   ├─ CONTRACT_NUMERIC + AUTO_COMPARE_OK
 │   │   └─ Compare variance vs tolerance
 │   ├─ CONTRACT_NUMERIC + DUPLICATE/DATA_QUALITY
 │   │   └─ Compare but reviewer evidence required
 │   ├─ TEXT_EXCEPTION
 │   │   └─ Evidence required; no auto PASS
 │   └─ MISSING_RATE
 │       └─ Do not compare; contract owner required
 ├─ Evidence_Status valid?
 │   └─ blank/MISSING critical → AMBER or ZERO
 ├─ Final_Recon ties out?
 │   └─ Delta ≠ 0 → FAIL
 ├─ DLP clean?
 │   └─ leak → ZERO
 └─ Validation Run #1/#2/#3 consistent?
     └─ Yes → final verdict
```

## 11. 현재 확인된 contract master 상태

검증 스크립트 기준 `private/contract_rate.json`은 250 records로 구조 검증 PASS입니다. 단, 이건 **rate master 파일 구조가 유효하다는 의미**이고, 특정 invoice line의 rate PASS를 의미하지 않습니다.

내부 점검 결과 로직 status는 다음처럼 나뉩니다.

| 구분                          |                                              의미 |
| --------------------------- | ----------------------------------------------: |
| AUTO_COMPARE_OK             |                                 numeric 자동비교 가능 |
| REVIEW_NUMERIC_DUPLICATE    |             numeric 비교 가능하나 duplicate review 필요 |
| REVIEW_NUMERIC_DATA_QUALITY | numeric 비교 가능하나 data-quality/evidence review 필요 |
| EXCEPTION_EVIDENCE_REQUIRED |          text exception, supporting evidence 필요 |
| MISSING_RATE_NO_AUTO_PASS   |                                 rate 미확정, 비교 금지 |

따라서 실제 invoice audit에서 PASS가 나오려면 `AUTO_COMPARE_OK` 또는 review cleared 상태, evidence matched, final reconciliation tie-out이 모두 충족되어야 합니다.
