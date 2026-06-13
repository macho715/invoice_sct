#!/usr/bin/env python3
import json, sys, hashlib
from pathlib import Path

REQUIRED_FIELDS = ['Contract_Row_ID','GPT_Primary_Key','TYPE_B','Normalized_Charge','Route_Key','Unit','Rate_Type','Match_Eligible','AI_Rate_Status']
VALID_TYPE_B = {'Customs','DO','INLAND','THC','Inspection','Detention','STROAGE','OTHERS'}

def run(root):
    root = Path(root)
    path = root/'private/contract_rate.json'
    if not path.exists():
        return {'check':'rate_master_validate','status':'FAIL','error':'missing private/contract_rate.json'}
    data = json.loads(path.read_text(encoding='utf-8'))
    errors=[]
    if not isinstance(data, list):
        errors.append('rate master is not a list')
        data=[]
    if len(data) != 250:
        errors.append(f'expected 250 records, got {len(data)}')
    keys=[]
    for i,row in enumerate(data, start=1):
        for f in REQUIRED_FIELDS:
            if f not in row:
                errors.append(f'row {i} missing {f}')
        if row.get('TYPE_B') not in VALID_TYPE_B:
            errors.append(f'row {i} invalid TYPE_B={row.get("TYPE_B")}')
        k=row.get('GPT_Primary_Key')
        if k: keys.append(k)
    if len(keys) != len(set(keys)):
        errors.append('duplicate GPT_Primary_Key detected')
    h=hashlib.sha256(path.read_bytes()).hexdigest()
    return {'check':'rate_master_validate','status':'PASS' if not errors else 'FAIL','record_count':len(data),'sha256':h,'errors':errors[:20]}

if __name__ == '__main__':
    r=run(sys.argv[1] if len(sys.argv)>1 else '.')
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r['status']=='PASS' else 1)
