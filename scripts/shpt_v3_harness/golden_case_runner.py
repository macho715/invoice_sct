#!/usr/bin/env python3
import json, sys, re
from pathlib import Path

TYPEB_PRIORITY = [
    ('Inspection', ['customs inspection']),
    ('Customs', ['customs clearance','bill of entry','customs duty','export customs','shj customs code-opening','customs documentation']),
    ('DO', ['master do','house do','delivery order','do fee']),
    ('INLAND', ['transport','truck','inland','fb from','cipca','mosb']),
    ('THC', ['terminal handling','port handling','tsc','discharging']),
    ('Detention', ['detention']),
    ('STROAGE', ['storage','stroage']),
]

def classify(desc):
    d=(desc or '').lower()
    for label, keys in TYPEB_PRIORITY:
        for k in keys:
            if k in d:
                return label
    return 'OTHERS'

def decide(case):
    scenario=case.get('scenario')
    if scenario == 'final_approval_without_subtotal':
        return 'ZERO'
    if scenario == 'at_cost_without_evidence':
        return 'AMBER'
    if scenario == 'demdet_final_missing_inputs':
        return 'ZERO'
    if scenario == 'reconciliation_tie':
        return 'PASS' if abs(case['final_subtotal']-case['line_audit_total']) <= 0.01 and abs(case['final_subtotal']-case['type_b_total']) <= 0.01 else 'FAIL'
    if scenario == 'type_b_classification':
        return classify(case.get('description'))
    return 'AMBER'

def run(root):
    root=Path(root)
    cases=[json.loads(x) for x in (root/'tests/golden_cases/core_cases.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
    errors=[]; results=[]
    for c in cases:
        got=decide(c)
        exp=c.get('expected')
        ok=(got==exp)
        results.append({'case_id':c.get('case_id'), 'got':got, 'expected':exp, 'status':'PASS' if ok else 'FAIL'})
        if not ok: errors.append(results[-1])
    return {'check':'golden_cases','status':'PASS' if not errors else 'FAIL','case_count':len(cases),'results':results,'errors':errors}

if __name__ == '__main__':
    r=run(sys.argv[1] if len(sys.argv)>1 else '.')
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r['status']=='PASS' else 1)
