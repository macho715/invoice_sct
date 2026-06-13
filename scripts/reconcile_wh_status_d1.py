import json
import os
import subprocess
from pathlib import Path

from seed_wh_status_d1 import WORKBOOK, parse_workbook, merge_records


ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = ROOT / "docs" / "traceability" / "wh-status" / "reconciliation-report.md"
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


def scalar(sql: str) -> int:
    rows = wrangler_json(sql)
    return int(rows[0].get("cnt", 0)) if rows else 0


def main() -> int:
    _, raw_rows = parse_workbook(WORKBOOK)
    cases = len(merge_records(raw_rows))
    d1_cases = scalar("SELECT COUNT(*) AS cnt FROM ref_case_map WHERE source_file = 'hvdc_wh_status.xlsx'")
    d1_cards = scalar("SELECT COUNT(*) AS cnt FROM wh_status_case_card")
    d1_events = scalar("SELECT COUNT(*) AS cnt FROM canonical_shipment_events WHERE source_file = 'hvdc_wh_status.xlsx'")
    latest = scalar("SELECT COUNT(*) AS cnt FROM status_latest_per_su")
    dwell = scalar("SELECT COUNT(*) AS cnt FROM status_wh_dwell WHERE warehouse_in IS NOT NULL OR warehouse_out IS NOT NULL")
    site = scalar("SELECT COUNT(*) AS cnt FROM status_site_intake")
    status = "PASS" if d1_cases == cases and d1_cards == cases and d1_events >= cases and latest >= cases else "WARN"
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(
        "\n".join([
            "# WH Status D1 Reconciliation Report",
            "",
            f"- status: {status}",
            f"- source workbook: `{WORKBOOK}`",
            f"- source rows: {len(raw_rows)}",
            f"- source unique cases: {cases}",
            f"- D1 ref_case_map rows: {d1_cases}",
            f"- D1 wh_status_case_card rows: {d1_cards}",
            f"- D1 canonical_shipment_events rows: {d1_events}",
            f"- D1 status_latest_per_su rows: {latest}",
            f"- D1 status_wh_dwell rows with WH dates: {dwell}",
            f"- D1 status_site_intake rows: {site}",
            "",
            "## Result",
            "",
            "Counts align with the source workbook." if status == "PASS" else "Review count mismatches before publishing.",
            "",
        ]),
        encoding="utf-8",
    )
    print(f"WH Status reconciliation: {status}")
    print(f"- report: {REPORT_PATH}")
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
