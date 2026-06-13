#!/usr/bin/env python3
import json, sys, re
from pathlib import Path

PRIVATE_ALLOWED = {Path('private/contract_rate.json')}
SUSPICIOUS_PATTERNS = [
    re.compile(r'Rate_USD\s*[=:]\s*\d{2,}(?:\.\d+)?', re.I),
    re.compile(r'Rate_AED\s*[=:]\s*\d{2,}(?:\.\d+)?', re.I),
    re.compile(r'"Rate_USD"\s*:\s*\d', re.I),
    re.compile(r'"Rate_AED"\s*:\s*\d', re.I),
]
# Manifest may contain hashes/counts. Masked sample can contain keys but private values must be masked.
ALLOW_PATH_PARTS = {'private', 'tests/validation_runs'}

def run(root):
    root=Path(root)
    hits=[]
    for p in root.rglob('*'):
        if not p.is_file():
            continue
        rel=p.relative_to(root)
        if rel == Path('private/contract_rate.json'):
            continue
        if str(rel).startswith('tests/validation_runs'):
            continue
        if p.suffix.lower() not in {'.md','.json','.csv','.txt'}:
            continue
        txt=p.read_text(encoding='utf-8', errors='ignore')
        # masked sample is allowed if values are [PRIVATE]
        if rel.name == 'contract_rate_PUBLIC_MASKED_SAMPLE.json':
            if re.search(r'"Rate_USD"\s*:\s*(?!\s*"\[PRIVATE\]")', txt): hits.append(str(rel)+':unmasked Rate_USD in masked sample')
            if re.search(r'"Rate_AED"\s*:\s*(?!\s*"\[PRIVATE\]")', txt): hits.append(str(rel)+':unmasked Rate_AED in masked sample')
            continue
        for pat in SUSPICIOUS_PATTERNS:
            if pat.search(txt):
                hits.append(str(rel)+':'+pat.pattern)
                break
    return {'check':'dlp_scan','status':'PASS' if not hits else 'FAIL','hits':hits[:50]}

if __name__ == '__main__':
    r=run(sys.argv[1] if len(sys.argv)>1 else '.')
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r['status']=='PASS' else 1)
