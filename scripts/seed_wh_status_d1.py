import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "wh status" / "hvdc_wh_status.xlsx"
SQL_PATH = ROOT / ".tmp" / "wh_status_d1_seed.sql"
SOURCE_SYSTEM = "hvdc_wh_status.xlsx"
TOOL_VER = "seed_wh_status_d1.py@ssot-v1"
CASE_CARD_COLUMNS = [
    "SCT Ref.No",
    "Site",
    "Case No.",
    "Pkg",
    "Storage",
    "Description",
    "L(CM)",
    "W(CM)",
    "H(CM)",
    "CBM",
    "N.W(kgs)",
    "G.W(kgs)",
    "Stack",
    "HS Code",
    "Currency",
    "Price",
    "Vessel",
    "COE",
    "POL",
    "POD",
    "ETD/ATD",
    "ETA/ATA",
    "DHL WH",
    "DSV Indoor",
    "DSV Al Markaz",
    "AAA Storage",
    "DSV Outdoor",
    "DSV MZP",
    "MOSB",
    "Hauler Indoor",
    "JDN MZD",
    "Shifting",
    "MIR",
    "SHU",
    "DAS",
    "AGI",
]
DATE_CARD_COLUMNS = {
    "ETD/ATD",
    "ETA/ATA",
    "DHL WH",
    "DSV Indoor",
    "DSV Al Markaz",
    "AAA Storage",
    "DSV Outdoor",
    "DSV MZP",
    "MOSB",
    "Hauler Indoor",
    "JDN MZD",
    "Shifting",
    "MIR",
    "SHU",
    "DAS",
    "AGI",
}
WAREHOUSE_EVENT_COLUMNS = {
    "DHL WH": ("DHL", "WAREHOUSE"),
    "DSV Indoor": ("DSV_AUH", "INDOOR"),
    "DSV Al Markaz": ("AMZ", "INDOOR"),
    "AAA Storage": ("AAA", "OPEN_YARD"),
    "DSV Outdoor": ("DSV_AUH", "OUTDOOR"),
    "DSV MZP": ("MOSB", "OPEN_YARD"),
}
SITE_EVENT_COLUMNS = {
    "MOSB": "MOSB_SITE",
    "MIR": "MIR",
    "SHU": "SHU",
    "DAS": "DAS",
    "AGI": "AGI",
}
NS = {
    "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    value = 0
    for ch in letters:
        value = value * 26 + ord(ch.upper()) - 64
    return value - 1


def norm_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def sql(value) -> str:
    if value is None:
        return "NULL"
    text = str(value).replace("'", "''")
    return f"'{text}'"


def normalize_case(value: str) -> str:
    text = value.strip()
    numeric = re.fullmatch(r"(\d+)\.0+", text)
    if numeric:
        text = numeric.group(1)
    token = re.sub(r"[^A-Za-z0-9]+", "-", text.upper()).strip("-")
    return token or "UNKNOWN"


def parse_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strings: list[str] = []
    for si in root.findall("x:si", NS):
        strings.append("".join(t.text or "" for t in si.findall(".//x:t", NS)))
    return strings


def first_sheet_path(zf: zipfile.ZipFile) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    first_sheet = workbook.find("x:sheets/x:sheet", NS)
    if first_sheet is None:
        raise RuntimeError("Workbook has no sheets")
    rel_id = first_sheet.attrib[f"{{{NS['r']}}}id"]
    for rel in rels:
        if rel.attrib.get("Id") == rel_id:
            target = rel.attrib["Target"].lstrip("/")
            return target if target.startswith("xl/") else f"xl/{target}"
    raise RuntimeError(f"Cannot resolve sheet relationship {rel_id}")


def cell_value(cell: ET.Element, shared: list[str]):
    cell_type = cell.attrib.get("t")
    raw = cell.findtext("x:v", namespaces=NS)
    if cell_type == "s" and raw is not None:
        return shared[int(raw)]
    if cell_type == "inlineStr":
        return "".join(t.text or "" for t in cell.findall(".//x:t", NS))
    return raw


def parse_workbook(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with zipfile.ZipFile(path) as zf:
        shared = parse_shared_strings(zf)
        sheet = ET.fromstring(zf.read(first_sheet_path(zf)))
    raw_rows: list[list[str]] = []
    for row in sheet.findall(".//x:sheetData/x:row", NS):
        cells: dict[int, str] = {}
        max_idx = -1
        for cell in row.findall("x:c", NS):
            idx = col_index(cell.attrib["r"])
            max_idx = max(max_idx, idx)
            value = cell_value(cell, shared)
            cells[idx] = "" if value is None else str(value).strip()
        raw_rows.append([cells.get(i, "") for i in range(max_idx + 1)])

    header_idx = next(
        (i for i, row in enumerate(raw_rows[:30]) if any(norm_header(cell) == "caseno" for cell in row)),
        None,
    )
    if header_idx is None:
        raise RuntimeError("Cannot find Case No. header")
    headers = raw_rows[header_idx]
    records = []
    for source_row, row in enumerate(raw_rows[header_idx + 1:], start=header_idx + 2):
        record = {headers[i].strip(): row[i].strip() if i < len(row) else "" for i in range(len(headers)) if headers[i].strip()}
        if any(record.values()):
            record["__source_row"] = str(source_row)
            records.append(record)
    return headers, records


def get(record: dict[str, str], *aliases: str) -> str:
    lookup = {norm_header(k): v for k, v in record.items()}
    for alias in aliases:
        value = lookup.get(norm_header(alias), "")
        if value:
            return value
    return ""


def iso_date(value: str) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        number = float(value)
        if 20000 <= number <= 60000:
            return (datetime(1899, 12, 30) + timedelta(days=int(number))).date().isoformat()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    return value[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", value) else None


def best_date(*values: str | None) -> str | None:
    dates = [v for v in values if v]
    return max(dates) if dates else None


def is_required(record: dict[str, str], destination: str) -> bool:
    site = get(record, "Site", "Final_Location", "Final Location", "Destination").upper()
    if destination in site:
        return True
    return iso_date(get(record, destination)) is not None


def merge_records(records: list[dict[str, str]]) -> list[dict[str, str]]:
    merged: dict[str, dict[str, str]] = {}
    for record in records:
        case_no = get(record, "Case No.", "Case No", "CaseNo")
        if not case_no:
            continue
        base = merged.setdefault(case_no, dict(record))
        for key, value in record.items():
            if value and not base.get(key):
                base[key] = value
            if key.upper() in {"MIR", "SHU", "DAS", "AGI", "MOSB"}:
                current = iso_date(base.get(key, ""))
                incoming = iso_date(value)
                if incoming and (not current or incoming > current):
                    base[key] = value
    return list(merged.values())


def case_card_json(record: dict[str, str]) -> str:
    fields = []
    for column in CASE_CARD_COLUMNS:
        raw_value = get(record, column)
        value = raw_value or None
        fields.append({
            "label": column,
            "value": value,
            "isoDate": iso_date(raw_value) if column in DATE_CARD_COLUMNS and raw_value else None,
        })
    return json.dumps(fields, ensure_ascii=False, separators=(",", ":"))


def event_id(shipment_id: str, event_type: str, source_column: str) -> str:
    suffix = normalize_case(source_column)
    return f"EVT-{shipment_id}-{event_type}-{suffix}"


def append_event(
    lines: list[str],
    *,
    shipment_id: str,
    case_no: str,
    case_norm: str,
    event_type: str,
    event_date: str | None,
    event_rank: int,
    site_code: str | None,
    zone_code: str | None,
    ref_doc_no: str | None,
    remarks: str | None,
    source_sheet: str | None,
    source_row: int,
    source_column: str,
    ingest_id: str,
) -> int:
    if not event_date:
        return 0
    event = event_id(shipment_id, event_type, source_column)
    lines.append(
        "INSERT OR REPLACE INTO canonical_shipment_events "
        "(event_id, su_id, case_no_raw, case_norm, event_type, event_date, event_rank, site_code, zone_code, ref_doc_no, remarks, source_column, source_file, source_sheet, source_row, ingest_id, created_at) "
        f"VALUES ({sql(event)}, {sql(shipment_id)}, {sql(case_no)}, {sql(case_norm)}, {sql(event_type)}, {sql(event_date)}, {event_rank}, {sql(site_code)}, {sql(zone_code)}, {sql(ref_doc_no)}, {sql(remarks)}, {sql(source_column)}, {sql(SOURCE_SYSTEM)}, {sql(source_sheet)}, {source_row}, {sql(ingest_id)}, datetime('now'));"
    )
    lines.append(
        "INSERT OR REPLACE INTO row_index "
        "(ingest_id, source_row, su_id, case_norm, derived_event_id, source_file) "
        f"VALUES ({sql(ingest_id)}, {source_row}, {sql(shipment_id)}, {sql(case_norm)}, {sql(event)}, {sql(SOURCE_SYSTEM)});"
    )
    return 1


def build_sql(records: list[dict[str, str]], ingest_id: str, source_hash: str, total_rows: int) -> tuple[str, dict[str, int]]:
    lines = [
        "DELETE FROM row_index WHERE ingest_id IN (SELECT ingest_id FROM ingest_audit WHERE source_file = 'hvdc_wh_status.xlsx');",
        "DELETE FROM canonical_shipment_events WHERE source_file = 'hvdc_wh_status.xlsx';",
        "DELETE FROM ref_case_map WHERE source_file = 'hvdc_wh_status.xlsx';",
        "DELETE FROM ingest_audit WHERE source_file = 'hvdc_wh_status.xlsx';",
        "DELETE FROM action_queue WHERE shipment_unit_id LIKE 'WHCASE-%';",
        "DELETE FROM validation_log WHERE shipment_unit_id LIKE 'WHCASE-%';",
        "DELETE FROM receipt_event WHERE shipment_unit_id LIKE 'WHCASE-%';",
        "DELETE FROM destination_requirement WHERE shipment_unit_id LIKE 'WHCASE-%';",
        "DELETE FROM milestone_event WHERE shipment_unit_id LIKE 'WHCASE-%';",
        "DELETE FROM wh_status_case_card WHERE shipment_unit_id LIKE 'WHCASE-%';",
        "DELETE FROM identifier_index WHERE source_system = 'hvdc_wh_status.xlsx' OR target_rid LIKE 'WHCASE-%';",
        "DELETE FROM shipment_unit WHERE shipment_unit_id LIKE 'WHCASE-%';",
        "INSERT OR REPLACE INTO ingest_audit "
        "(ingest_id, source_file, source_hash, total_rows, loaded_rows, tool_ver, load_ts) "
        f"VALUES ({sql(ingest_id)}, {sql(SOURCE_SYSTEM)}, {sql(source_hash)}, {total_rows}, {len(records)}, {sql(TOOL_VER)}, datetime('now'));",
    ]
    stats = {"cases": 0, "agi_das": 0, "mosb_backfill": 0, "identifiers": 0, "events": 0}
    for idx, record in enumerate(records, start=1):
        case_no = get(record, "Case No.", "Case No", "CaseNo")
        if not case_no:
            continue
        shipment_id = f"WHCASE-{normalize_case(case_no)}"
        case_norm = normalize_case(case_no)
        source_row = int(float(record.get("__source_row", idx)))
        invoice = get(record, "Shipment Invoice No.", "Shipment Invoice No", "Invoice No", "Invoice")
        sct_ref = get(record, "SCT Ref.No", "SCT Ref No", "SCT Ref")
        vendor = get(record, "Source_Vendor", "Source Vendor", "Vendor")
        category = get(record, "Storage", "Category")
        flow_code = get(record, "FLOW_CODE", "Flow Code")
        flow_desc = get(record, "FLOW_DESCRIPTION", "Flow Description")
        etd = iso_date(get(record, "ETD/ATD", "ETD"))
        atd = iso_date(get(record, "ATD"))
        eta = iso_date(get(record, "ETA/ATA", "ETA"))
        ata = iso_date(get(record, "ATA"))
        wh_in = iso_date(get(record, "first in wh", "First In WH", "WH In", "Warehouse In"))
        wh_out = iso_date(get(record, "last out wh", "Last Out WH", "WH Out", "Warehouse Out"))
        mosb_dt = iso_date(get(record, "MOSB"))
        site_dates = {dest: iso_date(get(record, dest)) for dest in ("MIR", "SHU", "DAS", "AGI")}
        required = [dest for dest in ("MIR", "SHU", "DAS", "AGI") if is_required(record, dest)]
        received = [dest for dest, dt in site_dates.items() if dt]
        required_set = sorted(set(required) | set(received))
        agi_das_site = any(site_dates[d] for d in ("AGI", "DAS"))
        mosb_missing = agi_das_site and not mosb_dt
        if agi_das_site:
            stats["agi_das"] += 1
        if mosb_missing:
            stats["mosb_backfill"] += 1
        latest_receipt = best_date(*site_dates.values())
        final_delivery = latest_receipt
        current_location = received[-1] if received else get(record, "Final_Location", "Final Location", "Site") or None
        current_stage = "M130_SITE_ARRIVED" if final_delivery else "IN_TRANSIT"
        route = "WH_MOSB_SITE" if ("MOSB" in flow_desc.upper() or mosb_dt or agi_das_site) else "WH_SITE"
        completion = 1.0 if required_set and all(site_dates.get(dest) for dest in required_set) else 0.0
        if required_set:
            completion = round(sum(1 for dest in required_set if site_dates.get(dest)) / len(required_set), 4)
        missing = "|".join(dest for dest in required_set if not site_dates.get(dest)) or None
        declared = "|".join(required_set) or None
        source_line = case_no
        lines.append(
            "INSERT OR REPLACE INTO shipment_unit "
            "(shipment_unit_id, source_line_id, vendor, category, po_no, invoice_no, incoterms, declared_destination_set, declared_destination_count, current_stage, current_location, routing_pattern, latest_receipt_dt, final_delivery_dt, site_completion_rate, missing_required_destination, received_without_flag) "
            f"VALUES ({sql(shipment_id)}, {sql(source_line)}, {sql(vendor)}, {sql(category)}, {sql(sct_ref)}, {sql(invoice)}, {sql(flow_code)}, {sql(declared)}, {len(required_set)}, {sql(current_stage)}, {sql(current_location)}, {sql(route)}, {sql(latest_receipt)}, {sql(final_delivery)}, {completion}, {sql(missing)}, NULL);"
        )
        lines.append(
            "INSERT OR REPLACE INTO ref_case_map "
            "(case_norm, case_raw, su_id, source_file, first_seen_at, last_seen_at, rule_ver) "
            f"VALUES ({sql(case_norm)}, {sql(case_no)}, {sql(shipment_id)}, {sql(SOURCE_SYSTEM)}, datetime('now'), datetime('now'), 'case-norm-v1');"
        )
        lines.append(
            "INSERT OR REPLACE INTO wh_status_case_card "
            "(shipment_unit_id, case_no, card_json, source_system, updated_at) "
            f"VALUES ({sql(shipment_id)}, {sql(normalize_case(case_no))}, {sql(case_card_json(record))}, {sql(SOURCE_SYSTEM)}, datetime('now'));"
        )
        stats["cases"] += 1
        source_sheet = get(record, "Source_Sheet", "Source Sheet") or None
        stats["events"] += append_event(
            lines,
            shipment_id=shipment_id,
            case_no=case_no,
            case_norm=case_norm,
            event_type="M040_DEPARTED",
            event_date=etd,
            event_rank=10,
            site_code=get(record, "POL") or None,
            zone_code=None,
            ref_doc_no=invoice or None,
            remarks="ETD/ATD",
            source_sheet=source_sheet,
            source_row=source_row,
            source_column="ETD/ATD",
            ingest_id=ingest_id,
        )
        stats["events"] += append_event(
            lines,
            shipment_id=shipment_id,
            case_no=case_no,
            case_norm=case_norm,
            event_type="M050_ARRIVED",
            event_date=eta,
            event_rank=20,
            site_code=get(record, "POD") or None,
            zone_code=None,
            ref_doc_no=invoice or None,
            remarks="ETA/ATA",
            source_sheet=source_sheet,
            source_row=source_row,
            source_column="ETA/ATA",
            ingest_id=ingest_id,
        )
        for column, (site_code, zone_code) in WAREHOUSE_EVENT_COLUMNS.items():
            stats["events"] += append_event(
                lines,
                shipment_id=shipment_id,
                case_no=case_no,
                case_norm=case_norm,
                event_type="WH_RECEIPT",
                event_date=iso_date(get(record, column)),
                event_rank=40,
                site_code=site_code,
                zone_code=zone_code,
                ref_doc_no=invoice or None,
                remarks=column,
                source_sheet=source_sheet,
                source_row=source_row,
                source_column=column,
                ingest_id=ingest_id,
            )
        stats["events"] += append_event(
            lines,
            shipment_id=shipment_id,
            case_no=case_no,
            case_norm=case_norm,
            event_type="WH_ISSUE",
            event_date=wh_out,
            event_rank=60,
            site_code=current_location,
            zone_code=None,
            ref_doc_no=invoice or None,
            remarks="last out wh",
            source_sheet=source_sheet,
            source_row=source_row,
            source_column="last out wh",
            ingest_id=ingest_id,
        )
        for column, site_code in SITE_EVENT_COLUMNS.items():
            stats["events"] += append_event(
                lines,
                shipment_id=shipment_id,
                case_no=case_no,
                case_norm=case_norm,
                event_type="SITE_RECEIPT",
                event_date=iso_date(get(record, column)),
                event_rank=80,
                site_code=site_code,
                zone_code=None,
                ref_doc_no=invoice or None,
                remarks=column,
                source_sheet=source_sheet,
                source_row=source_row,
                source_column=column,
                ingest_id=ingest_id,
            )
        stats["events"] += append_event(
            lines,
            shipment_id=shipment_id,
            case_no=case_no,
            case_norm=case_norm,
            event_type="M100_FINAL_DELIVERED",
            event_date=final_delivery,
            event_rank=90,
            site_code=current_location,
            zone_code=None,
            ref_doc_no=invoice or None,
            remarks="final delivery from latest site receipt",
            source_sheet=source_sheet,
            source_row=source_row,
            source_column="Final_Location",
            ingest_id=ingest_id,
        )
        identifiers = [
            ("CASE_NO", case_no),
            ("ShipmentUnit", shipment_id),
            ("sourceLineId", source_line),
            ("invoiceNo", invoice),
            ("SCT_REF", sct_ref),
        ]
        for scheme, value in identifiers:
            if not value:
                continue
            norm = normalize_case(value)
            lines.append(
                "INSERT OR REPLACE INTO identifier_index "
                "(identifier_scheme, identifier_value, normalized_value, source_system, target_type, target_rid, confidence) "
                f"VALUES ({sql(scheme)}, {sql(value)}, {sql(norm)}, {sql(SOURCE_SYSTEM)}, 'ShipmentUnit', {sql(shipment_id)}, 0.98);"
            )
            stats["identifiers"] += 1
        for code, dt in [
            ("M50_ETD", etd),
            ("M61_ATD", atd),
            ("M80_ETA", eta),
            ("M80_ATA", ata),
            ("M110_WAREHOUSE_RECEIVED", wh_in),
            ("M121_WAREHOUSE_DISPATCHED", wh_out),
            ("M115_MOSB_STAGED", mosb_dt),
            ("M130_FINAL_DELIVERED", final_delivery),
        ]:
            if not dt:
                continue
            lines.append(
                "INSERT OR REPLACE INTO milestone_event "
                "(shipment_unit_id, milestone_code, actual_dt, evidence_doc_id) "
                f"VALUES ({sql(shipment_id)}, {sql(code)}, {sql(dt)}, {sql(SOURCE_SYSTEM)});"
            )
        for dest in required_set:
            status = "WARN" if mosb_missing and dest in {"AGI", "DAS"} else "PASS"
            reason = "MOSB_EVIDENCE_MISSING" if status == "WARN" else None
            lines.append(
                "INSERT OR REPLACE INTO destination_requirement "
                "(requirement_id, shipment_unit_id, destination_code, required_flag, source_column, source_line_id, validation_status, reason_code) "
                f"VALUES ({sql(f'REQ-{shipment_id}-{dest}')}, {sql(shipment_id)}, {sql(dest)}, 1, {sql(dest)}, {sql(source_line)}, {sql(status)}, {sql(reason)});"
            )
        for dest, dt in site_dates.items():
            if not dt:
                continue
            lines.append(
                "INSERT OR REPLACE INTO receipt_event "
                "(receipt_event_id, shipment_unit_id, location_code, location_type, actual_receipt_dt, source_column, source_line_id, matched_required_destination, validation_status, reason_code) "
                f"VALUES ({sql(f'RE-{shipment_id}-{dest}')}, {sql(shipment_id)}, {sql(dest)}, 'PROJECT_SITE', {sql(dt)}, {sql(dest)}, {sql(source_line)}, 1, 'PASS', NULL);"
            )
        if mosb_missing:
            lines.append(
                "INSERT OR REPLACE INTO validation_log "
                "(validation_id, shipment_unit_id, rule_id, severity, field, value, reason_code) "
                f"VALUES ({sql(f'VAL-{shipment_id}-MOSB')}, {sql(shipment_id)}, 'V-AGIDAS-001', 'WARN', 'M115/M116/M117', 'MISSING', 'MOSB_EVIDENCE_MISSING');"
            )
            lines.append(
                "INSERT OR REPLACE INTO action_queue "
                "(action_id, shipment_unit_id, action_type, owner_role, target_location, due_at, status, reason_code) "
                f"VALUES ({sql(f'ACT-{shipment_id}-MOSB-BACKFILL')}, {sql(shipment_id)}, 'BACKFILL_MOSB_CHAIN_EVIDENCE', 'Marine / Material Chain Owner', 'MOSB', NULL, 'OPEN', 'MOSB_EVIDENCE_MISSING');"
            )
    return "\n".join(lines) + "\n", stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote", action="store_true", help="Execute generated SQL against remote Cloudflare D1")
    parser.add_argument("--dry-run", action="store_true", help="Only generate SQL and print stats")
    args = parser.parse_args()
    headers, rows = parse_workbook(WORKBOOK)
    source_hash = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
    ingest_id = f"wh-status-{source_hash[:16]}"
    merged_rows = merge_records(rows)
    sql_text, stats = build_sql(merged_rows, ingest_id, source_hash, len(rows))
    SQL_PATH.parent.mkdir(exist_ok=True)
    SQL_PATH.write_text(sql_text, encoding="utf-8")
    print(f"WH Status D1 seed SQL: {SQL_PATH}")
    print(f"- workbook: {WORKBOOK}")
    print(f"- parsed headers: {len(headers)}")
    print(f"- cases: {stats['cases']}")
    print(f"- AGI/DAS site cases: {stats['agi_das']}")
    print(f"- MOSB backfill warnings: {stats['mosb_backfill']}")
    print(f"- identifier rows: {stats['identifiers']}")
    print(f"- canonical events: {stats['events']}")
    print(f"- ingest id: {ingest_id}")
    if args.remote:
        npx = "npx.cmd" if os.name == "nt" else "npx"
        return subprocess.call([
            npx, "wrangler", "d1", "execute", "hvdc-mcp-audit", "--remote", "--file", str(SQL_PATH)
        ], cwd=ROOT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
