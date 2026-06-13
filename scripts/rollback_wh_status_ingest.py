import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = ROOT / "docs" / "traceability" / "wh-status" / "rollback-dry-run.md"
DB = "hvdc-mcp-audit"


def wrangler_json(sql: str) -> list[dict]:
    npx = "npx.cmd" if os.name == "nt" else "npx"
    out = subprocess.check_output(
        [npx, "wrangler", "d1", "execute", DB, "--remote", "--command", sql, "--json"],
        cwd=ROOT,
        text=True,
    )
    parsed = json.loads(out)
    return parsed[0].get("results", [])


def wrangler_exec(sql: str) -> None:
    npx = "npx.cmd" if os.name == "nt" else "npx"
    subprocess.check_call([npx, "wrangler", "d1", "execute", DB, "--remote", "--command", sql], cwd=ROOT)


def scalar(sql: str) -> int:
    rows = wrangler_json(sql)
    return int(rows[0].get("cnt", 0)) if rows else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ingest-id", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    ingest = args.ingest_id.replace("'", "''")
    case_count = scalar(f"SELECT COUNT(DISTINCT case_norm) AS cnt FROM canonical_shipment_events WHERE ingest_id = '{ingest}'")
    event_count = scalar(f"SELECT COUNT(*) AS cnt FROM canonical_shipment_events WHERE ingest_id = '{ingest}'")
    row_count = scalar(f"SELECT COUNT(*) AS cnt FROM row_index WHERE ingest_id = '{ingest}'")
    rollback_id = f"rollback-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(
        "\n".join([
            "# WH Status Ingest Rollback Dry Run",
            "",
            f"- mode: {'EXECUTE' if args.execute else 'DRY_RUN'}",
            f"- rollback_id: {rollback_id}",
            f"- ingest_id: {args.ingest_id}",
            f"- affected_case_count: {case_count}",
            f"- affected_event_count: {event_count}",
            f"- affected_row_index_count: {row_count}",
            "",
            "No data was deleted." if not args.execute else "Rollback delete commands were executed.",
            "",
        ]),
        encoding="utf-8",
    )
    print(f"rollback dry-run report: {REPORT_PATH}")
    print(f"- cases: {case_count}")
    print(f"- events: {event_count}")
    if not args.execute:
        return 0
    wrangler_exec(f"DELETE FROM row_index WHERE ingest_id = '{ingest}'")
    wrangler_exec(f"DELETE FROM canonical_shipment_events WHERE ingest_id = '{ingest}'")
    wrangler_exec(
        "INSERT OR REPLACE INTO rollback_audit "
        "(rollback_id, ingest_id, mode, affected_case_count, affected_event_count, generated_at, executed_at, status) "
        f"VALUES ('{rollback_id}', '{ingest}', 'EXECUTE', {case_count}, {event_count}, datetime('now'), datetime('now'), 'DONE')"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
