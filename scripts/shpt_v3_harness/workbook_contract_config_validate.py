#!/usr/bin/env python3
"""Validate the v3.2 workbook output contract in project rules/instructions.
Standard library only; safe to run in restricted project environments.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REQUIRED_SHEETS = [
    '00_Decision','01_Action_Items','02_Final_Recon','03_Type_B_Summary',
    '04_Line_View','90_Source_Data','91_Audit_Detail','92_Evidence_Issues'
]


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        return {'__error__': str(exc)}


def run(root='.'):
    root = Path(root)
    errors = []
    warnings = []
    rg_paths = [root/'rules/Release_Gate_v3.2_PRO.json', root/'rules/Release_Gate_v3.1_PRO.json']
    release_docs = []
    for p in rg_paths:
        if not p.exists():
            errors.append(f'missing {p.relative_to(root)}')
            continue
        data = _load_json(p)
        if '__error__' in data:
            errors.append(f'{p.relative_to(root)} invalid json: {data["__error__"]}')
            continue
        sheets = data.get('workbook_submission_sheets') or data.get('workbook_required_sheets')
        if sheets != REQUIRED_SHEETS:
            errors.append(f'{p.relative_to(root)} workbook sheets mismatch: {sheets}')
        if data.get('forbidden_default_sheet') in REQUIRED_SHEETS:
            errors.append(f'{p.relative_to(root)} forbids required sheet: {data.get("forbidden_default_sheet")}')
        if data.get('artifact_gates', {}).get('sheet_count_exact') not in (8, None):
            errors.append(f'{p.relative_to(root)} invalid sheet_count_exact')
        release_docs.append(str(p.relative_to(root)))

    combined_path = root/'rules/DSV_RULEPACK_COMBINED_v3.1_PRO.json'
    if not combined_path.exists():
        errors.append('missing rules/DSV_RULEPACK_COMBINED_v3.1_PRO.json')
    else:
        combined = _load_json(combined_path)
        rg = combined.get('release_gate', {}) if isinstance(combined, dict) else {}
        sheets = rg.get('workbook_submission_sheets') or rg.get('workbook_required_sheets')
        if sheets != REQUIRED_SHEETS:
            errors.append('combined rulepack release_gate workbook sheets mismatch')
        if rg.get('forbidden_default_sheet') in REQUIRED_SHEETS:
            errors.append('combined rulepack forbids required workbook sheet')
        woc = combined.get('workbook_output_contract', {}) if isinstance(combined, dict) else {}
        if woc.get('required_sheets') != REQUIRED_SHEETS:
            errors.append('combined rulepack workbook_output_contract missing required sheets')

    instr_path = root/'01_GPT_PROJECT_INSTRUCTIONS.md'
    if not instr_path.exists():
        errors.append('missing 01_GPT_PROJECT_INSTRUCTIONS.md')
    else:
        instr = instr_path.read_text(encoding='utf-8', errors='ignore')
        for s in REQUIRED_SHEETS:
            if s not in instr:
                errors.append(f'instructions missing required sheet term: {s}')
        forbidden_patterns = [
            r'03_Type_B_Summary\s+must\s+not\s+exist',
            r'forbidden_default_sheet[\s:]+03_Type_B_Summary',
            r'03_Type_B_Summary.*forbidden',
        ]
        for pat in forbidden_patterns:
            if re.search(pat, instr, flags=re.I|re.S):
                errors.append(f'instructions contain forbidden Type-B statement: {pat}')

    return {
        'check': 'workbook_contract_config_validate',
        'status': 'PASS' if not errors else 'FAIL',
        'required_sheets': REQUIRED_SHEETS,
        'release_docs_checked': release_docs,
        'errors': errors,
        'warnings': warnings,
    }


if __name__ == '__main__':
    r = run(sys.argv[1] if len(sys.argv) > 1 else '.')
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r['status'] == 'PASS' else 1)
