#!/usr/bin/env python3
from __future__ import annotations
import json, sys, argparse, importlib.util
from pathlib import Path
from datetime import datetime, timezone

sys.dont_write_bytecode = True

CHECK_SCRIPTS = [
    'package_self_check.py',
    'rate_master_validate.py',
    'prompt_lint.py',
    'dlp_scan.py',
    'golden_case_runner.py',
    'workbook_contract_config_validate.py',
    'workbook_output_validate.py',
]


def load_func(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.run


def run(root='.', run_id='MANUAL', workbook=None):
    root = Path(root)
    checks = []
    for script in CHECK_SCRIPTS:
        path = root / script
        if not path.exists():
            path = root / 'scripts' / script
        if not path.exists():
            checks.append({'check': script, 'status': 'FAIL', 'error': 'script_missing'})
            continue
        func = load_func(path)
        try:
            if script == 'workbook_output_validate.py':
                if workbook:
                    checks.append(func(root, workbook=workbook, contract_only=False))
                else:
                    checks.append(func(root, contract_only=True))
            else:
                checks.append(func(root))
        except Exception as exc:
            checks.append({'check': script, 'status': 'FAIL', 'error': repr(exc)})
    status = 'PASS' if all(c.get('status') == 'PASS' for c in checks) else 'FAIL'
    return {
        'run_id': run_id,
        'check': 'harness_validate_package',
        'version': 'v3.2_PRO',
        'generated_utc': datetime.now(timezone.utc).isoformat(),
        'status': status,
        'workbook': workbook,
        'checks': checks,
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default='.')
    ap.add_argument('--run-id', default='MANUAL')
    ap.add_argument('--output')
    ap.add_argument('--workbook')
    args = ap.parse_args()
    r = run(args.root, args.run_id, workbook=args.workbook)
    txt = json.dumps(r, ensure_ascii=False, indent=2)
    print(txt)
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(txt, encoding='utf-8')
    sys.exit(0 if r['status'] == 'PASS' else 1)
