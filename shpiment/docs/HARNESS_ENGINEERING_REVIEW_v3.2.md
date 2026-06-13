# Harness Engineering Review v3.2_PRO

## Verdict
v3.2 closes the v3.1 release-gate mismatch by making `03_Type_B_Summary` mandatory and by adding workbook-level output validation.

## Main Fixes
1. Release gate 8-sheet contract restored.
2. `03_Type_B_Summary` is mandatory, not forbidden.
3. Workbook structural/reconciliation/style/DLP validator added.
4. Harness runner now includes workbook contract validation.
5. 3-run self-test output is stored under `tests/validation_runs/`.

## Harness Flow
Input -> MasterData -> Line_Audit -> TYPE-B -> Evidence Mapping -> Final_Recon -> Decision -> Workbook Builder -> Workbook Output Validate -> Manifest -> Release Verdict.

## Evidence Standard
PASS cannot be assigned if final subtotal is required but missing, if evidence is conflicting/missing for critical charges, or if workbook output contract cannot be verified.
