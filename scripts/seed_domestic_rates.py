#!/usr/bin/env python3
"""
Seed domestic rate cards from ApprovedLaneMap_ENHANCED.json into the rate_cards table.

Usage:
    python scripts/seed_domestic_rates.py [--lanemap PATH] [--db DATABASE_URL]

Requires: psycopg2 (or pg8000 as fallback)
"""
import json
import math
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_LANEMAP = REPO_ROOT / "domestic" / "runtime" / "ApprovedLaneMap_ENHANCED.json"
DEFAULT_DB = os.environ.get("DATABASE_URL", "")

def load_lanes(path: Path) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("Sheet1", [])


def safe_float(v, default=0.0):
    try:
        fv = float(v)
        return fv if math.isfinite(fv) else default
    except (TypeError, ValueError):
        return default


def safe_int(v, default=0):
    return int(safe_float(v, default))


def generate_inserts(lanes: list[dict]) -> list[dict]:
    """Convert lane entries to rate_cards row dicts."""
    rows = []
    for lane in lanes:
        origin = (lane.get("origin") or "").strip()
        destination = (lane.get("destination") or "").strip()
        vehicle = (lane.get("vehicle") or "").strip()
        unit = (lane.get("unit") or "per truck").strip()
        lane_key = f"{origin}||{destination}||{vehicle}||{unit}".upper()

        rows.append({
            "lane": lane_key,
            "contracted_rate": round(safe_float(lane.get("median_rate_usd", 0)), 4),
            "rate_basis": "PER_TRUCK",
            "currency": "USD",
            "match_eligible": "Y",
            "lane_id": str(lane.get("lane_id", "")),
            "median_distance_km": round(safe_float(lane.get("median_distance_km", 0)), 2),
            "samples": safe_int(lane.get("samples", 0)),
            "workflow_type": "DOMESTIC",
            "notes": f"origin={origin} dest={destination} veh={vehicle}",
        })
    return rows


def print_sql(rows: list[dict]):
    """Emit SQL for manual execution."""
    print("-- Domestic rate cards seed (generated from ApprovedLaneMap_ENHANCED.json)")
    print("-- Run against the database to populate rate_cards for domestic lane matching.")
    print()
    print("DELETE FROM rate_cards WHERE workflow_type = 'DOMESTIC';")
    print()
    for idx, row in enumerate(rows):
        cols = ", ".join(row.keys())
        vals = ", ".join(f"'{v}'" if isinstance(v, str) else str(v) for v in row.values())
        print(f"INSERT INTO rate_cards ({cols}) VALUES ({vals});")
        if idx > 0 and idx % 30 == 0:
            print()
    print()
    print(f"-- {len(rows)} rows inserted.")


def insert_db(rows: list[dict], db_url: str):
    """Insert rate cards directly into the database."""
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
    except ImportError:
        try:
            import pg8000
            conn = pg8000.connect(db_url)
        except ImportError:
            print("ERROR: Neither psycopg2 nor pg8000 installed. Install one or use --sql mode.", file=sys.stderr)
            sys.exit(1)

    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM rate_cards WHERE workflow_type = 'DOMESTIC'")
        for row in rows:
            cur.execute(
                """INSERT INTO rate_cards
                   (lane, contracted_rate, rate_basis, currency, match_eligible,
                    lane_id, median_distance_km, samples, workflow_type, notes)
                   VALUES (%(lane)s, %(contracted_rate)s, %(rate_basis)s, %(currency)s,
                           %(match_eligible)s, %(lane_id)s, %(median_distance_km)s,
                           %(samples)s, %(workflow_type)s, %(notes)s)""",
                row,
            )
        conn.commit()
        print(f"Inserted {len(rows)} domestic rate cards.")
    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


def main():
    lanemap_path = DEFAULT_LANEMAP
    sql_only = True
    db_url = DEFAULT_DB

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--lanemap" and i + 1 < len(args):
            lanemap_path = Path(args[i + 1])
            i += 2
        elif args[i] == "--db" and i + 1 < len(args):
            db_url = args[i + 1]
            sql_only = False
            i += 2
        elif args[i] == "--sql":
            sql_only = True
            i += 1
        else:
            i += 1

    if not lanemap_path.exists():
        print(f"ERROR: ApprovedLaneMap not found at {lanemap_path}", file=sys.stderr)
        sys.exit(1)

    lanes = load_lanes(lanemap_path)
    rows = generate_inserts(lanes)

    if sql_only:
        print_sql(rows)
    else:
        if not db_url:
            print("ERROR: --db DATABASE_URL required for direct insert", file=sys.stderr)
            sys.exit(1)
        insert_db(rows, db_url)

    print(f"\nDone. {len(rows)} domestic lanes processed from {lanemap_path.name}.")


if __name__ == "__main__":
    main()
