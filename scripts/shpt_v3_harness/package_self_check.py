#!/usr/bin/env python3
from __future__ import annotations
import json, sys
from pathlib import Path

REQUIRED = [
    '00_README_RUN_FIRST.md',
    '01_GPT_PROJECT_INSTRUCTIONS.md',
    '02_COMBINED_SYSTEM_KNOWLEDGE.md',
    'PRIVATE_INTERNAL_NOTICE.md',
    'PACKAGE_MANIFEST.json',
    'VALIDATION_REPORT.json',
    'rules/DSV_RULEPACK_COMBINED_v3.1_PRO.json',
    'rules/Release_Gate_v3.2_PRO.json',
    'rules/Gate_Rules_v3.1_PRO.json',
    'rules/Risk_Taxonomy_v3.1_PRO.json',
    'rules/RTM_v3.1_PRO.csv',
    'rules/Test_Case_Repository_v3.1_PRO.csv',
    'rules/TYPE_B_Rules_v3.1_PRO.csv',
    'rules/Evidence_Checklist_v3.1_PRO.csv',
    'rules/rate_master_field_dictionary_v3.1_PRO.csv',
    'private/contract_rate.json',
    'scripts/harness_validate_package.py',
    'scripts/workbook_contract_config_validate.py',
    'scripts/workbook_output_validate.py',
    'scripts/run_self_test_3x.py',
    'tests/golden_cases/core_cases.jsonl',
]
FORBIDDEN_DIRS = ['legacy_v2_source', 'upload_flat', 'spreadsheets', '__pycache__']


def run(root='.'):
    root = Path(root)
    missing = [p for p in REQUIRED if not (root/p).exists()]
    forbidden = [d for d in FORBIDDEN_DIRS if (root/d).exists()]
    pycache = [str(p.relative_to(root)) for p in root.rglob('__pycache__')]
    if pycache:
        forbidden.extend(pycache)
    return {
        'check':'package_self_check',
        'status':'PASS' if not missing and not forbidden else 'FAIL',
        'missing':missing,
        'forbidden_dirs_present':forbidden,
        'required_count':len(REQUIRED),
    }

if __name__ == '__main__':
    r = run(sys.argv[1] if len(sys.argv)>1 else '.')
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r['status']=='PASS' else 1)
