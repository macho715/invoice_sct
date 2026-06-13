#!/usr/bin/env python3
"""
SESS-006 Harness Orchestrator (P3) — 3-Lane Parallel Validation + Neon Persist.

Lane A (SECURITY):  dlp_scan.py
Lane B (RATE):      rate_master_validate.py + golden_case_runner.py
Lane C (WORKBOOK):  workbook_contract_config_validate.py + prompt_lint.py
                    + workbook_output_validate.py

Pre-flight: package_self_check.py (must PASS before lanes launch).

Output:
  1. JSON report to stdout
  2. Optional JSON file via --output
  3. Persists run to Neon Postgres when DATABASE_URL is set.

Usage:
  python harness_orchestrator_p3.py <root> --run-id SESS-006 [--workbook <file.xlsx>] [--output report.json]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

LANE_A = ['dlp_scan.py']
LANE_B = ['rate_master_validate.py', 'golden_case_runner.py']
LANE_C = ['prompt_lint.py', 'workbook_contract_config_validate.py', 'workbook_output_validate.py']
LANES = {'SECURITY': LANE_A, 'RATE': LANE_B, 'WORKBOOK': LANE_C}

# ---- helpers ----

def load_func(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.run

def run_lane(name: str, scripts: list[str], root: Path, workbook: str | None) -> dict:
    results = []
    started = datetime.now(timezone.utc)
    for script in scripts:
        path = root / 'scripts' / script
        if not path.exists():
            results.append({'check': script, 'status': 'FAIL', 'error': 'script_missing'})
            continue
        try:
            func = load_func(path)
            if script == 'workbook_output_validate.py':
                if workbook:
                    results.append(func(root, workbook=workbook, contract_only=False))
                else:
                    results.append(func(root, contract_only=True))
            else:
                results.append(func(root))
        except Exception as exc:
            results.append({'check': script, 'status': 'FAIL', 'error': repr(exc), 'traceback': traceback.format_exc()})
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    lane_status = 'PASS' if all(c.get('status') == 'PASS' for c in results) else 'FAIL'
    return {'lane': name, 'status': lane_status, 'elapsed_sec': round(elapsed, 3), 'checks': results}

# ---- Neon persist ----

def _get_db_pool():
    dsn = os.environ.get('DATABASE_URL')
    if not dsn:
        return None
    try:
        from psycopg2.pool import ThreadedConnectionPool
        return ThreadedConnectionPool(minconn=1, maxconn=2, dsn=dsn)
    except Exception:
        return None

def persist_run(payload: dict) -> bool:
    """Insert harness run into Neon. Returns True on success."""
    pool = _get_db_pool()
    if not pool:
        print('[harness-orchestrator] DATABASE_URL unset or pool failed — skipping Neon persist', file=sys.stderr)
        return False
    try:
        conn = pool.getconn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS harness_runs (
                id          BIGSERIAL PRIMARY KEY,
                run_id      TEXT NOT NULL,
                version     TEXT NOT NULL DEFAULT 'P3',
                status      TEXT NOT NULL,
                lane_a      JSONB,
                lane_b      JSONB,
                lane_c      JSONB,
                preflight   JSONB,
                total_elapsed_sec DOUBLE PRECISION,
                generated_utc TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute(
            """INSERT INTO harness_runs (run_id, version, status, lane_a, lane_b, lane_c, preflight, total_elapsed_sec, generated_utc)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                payload['run_id'],
                payload['version'],
                payload['status'],
                json.dumps(payload['lane_a']),
                json.dumps(payload['lane_b']),
                json.dumps(payload['lane_c']),
                json.dumps(payload['preflight']),
                payload['total_elapsed_sec'],
                payload['generated_utc'],
            ),
        )
        conn.commit()
        pool.putconn(conn)
        print('[harness-orchestrator] Neon persist OK', file=sys.stderr)
        return True
    except Exception as exc:
        print(f'[harness-orchestrator] Neon persist FAILED: {exc}', file=sys.stderr)
        return False

# ---- main ----

def run(root: str = '.', run_id: str = 'MANUAL', workbook: str | None = None, persist: bool = True) -> dict:
    root_p = Path(root)
    started = datetime.now(timezone.utc)

    # ---- Pre-flight ----
    pf_path = root_p / 'scripts' / 'package_self_check.py'
    if pf_path.exists():
        pf_result = load_func(pf_path)(root_p)
    else:
        pf_result = {'check': 'package_self_check.py', 'status': 'FAIL', 'error': 'script_missing'}
    preflight_ok = pf_result.get('status') == 'PASS'

    if not preflight_ok:
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        return {
            'run_id': run_id,
            'version': 'P3',
            'generated_utc': started.isoformat(),
            'status': 'ABORT',
            'preflight': pf_result,
            'lane_a': None,
            'lane_b': None,
            'lane_c': None,
            'error': 'Pre-flight FAILED — lanes not launched',
            'total_elapsed_sec': round(elapsed, 3),
        }

    # ---- 3 parallel lanes ----
    lanes = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {
            ex.submit(run_lane, name, scripts, root_p, workbook): name
            for name, scripts in LANES.items()
        }
        for fut in as_completed(futures):
            result = fut.result()
            lanes[result['lane']] = result

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    overall = 'PASS' if all(v.get('status') == 'PASS' for v in lanes.values()) else 'FAIL'

    payload = {
        'run_id': run_id,
        'version': 'P3',
        'generated_utc': started.isoformat(),
        'status': overall,
        'preflight': pf_result,
        'lane_a': lanes.get('SECURITY'),
        'lane_b': lanes.get('RATE'),
        'lane_c': lanes.get('WORKBOOK'),
        'total_elapsed_sec': round(elapsed, 3),
    }

    if persist:
        persist_run(payload)

    return payload


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='SESS-006 Harness Orchestrator P3')
    ap.add_argument('root', nargs='?', default='.')
    ap.add_argument('--run-id', default='MANUAL')
    ap.add_argument('--output')
    ap.add_argument('--workbook')
    ap.add_argument('--no-persist', action='store_true', help='Skip Neon persist')
    args = ap.parse_args()
    r = run(args.root, args.run_id, workbook=args.workbook, persist=not args.no_persist)
    txt = json.dumps(r, ensure_ascii=False, indent=2)
    print(txt)
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(txt, encoding='utf-8')
    sys.exit(0 if r['status'] in ('PASS',) else 1)
