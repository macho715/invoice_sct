#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, importlib.util, sys
from pathlib import Path
from datetime import datetime, timezone

sys.dont_write_bytecode = True


def load_harness(root: Path):
    path = root/'scripts/harness_validate_package.py'
    spec = importlib.util.spec_from_file_location('harness_validate_package', path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default='.')
    ap.add_argument('--workbook')
    args = ap.parse_args()
    root = Path(args.root).resolve()
    run = load_harness(root)
    outdir = root/'tests/validation_runs'
    outdir.mkdir(parents=True, exist_ok=True)
    run_statuses = []
    for i in range(1,4):
        run_id = f'TEST_RUN_{i:02d}'
        result = run(root, run_id=run_id, workbook=args.workbook)
        run_statuses.append({
            'run_id': run_id,
            'status': result['status'],
            'checks': [{'check': c.get('check'), 'status': c.get('status')} for c in result.get('checks', [])]
        })
        (outdir/f'{run_id}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    overall = 'PASS' if all(r['status'] == 'PASS' for r in run_statuses) else 'FAIL'
    summary = {
        'package_name': root.name,
        'version': 'v3.2_PRO',
        'patch_id': 'HARNESS-ENG-v3.2-WORKBOOK-OUTPUT-GATE-20260609',
        'generated_utc': datetime.now(timezone.utc).isoformat(),
        'self_test_runs_required': 3,
        'self_test_runs_executed': 3,
        'overall_status': overall,
        'run_statuses': run_statuses,
        'gate_summary': {
            'package_structure': 'PASS' if all(any(c['check']=='package_self_check' and c['status']=='PASS' for c in r['checks']) for r in run_statuses) else 'FAIL',
            'rate_master': 'PASS' if all(any(c['check']=='rate_master_validate' and c['status']=='PASS' for c in r['checks']) for r in run_statuses) else 'FAIL',
            'prompt_lint': 'PASS' if all(any(c['check']=='prompt_lint' and c['status']=='PASS' for c in r['checks']) for r in run_statuses) else 'FAIL',
            'dlp_scan': 'PASS' if all(any(c['check']=='dlp_scan' and c['status']=='PASS' for c in r['checks']) for r in run_statuses) else 'FAIL',
            'golden_cases': 'PASS' if all(any(c['check']=='golden_cases' and c['status']=='PASS' for c in r['checks']) for r in run_statuses) else 'FAIL',
            'workbook_contract_config': 'PASS' if all(any(c['check']=='workbook_contract_config_validate' and c['status']=='PASS' for c in r['checks']) for r in run_statuses) else 'FAIL',
            'workbook_output_contract': 'PASS' if all(any(c['check']=='workbook_output_validate' and c['status']=='PASS' for c in r['checks']) for r in run_statuses) else 'FAIL',
        },
        'note': 'Workbook output validation is included in contract-only mode for package tests. Use --workbook to validate a generated audit workbook artifact.'
    }
    (outdir/'FINAL_VALIDATION_SUMMARY.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    (root/'VALIDATION_REPORT.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if overall == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
