from __future__ import annotations

import re
from typing import Any


class DsvWaybillResult(dict):
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def _norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def _regex_first(pattern: str, text: str, flags: int = re.IGNORECASE) -> str | None:
    match = re.search(pattern, text, flags)
    if not match:
        return None
    return (match.group(1) or "").strip()


def _clean_origin_field(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.split(r"\bDestination\b|\bCONSIGNMENT\b", value, flags=re.IGNORECASE)[0]
    return re.sub(r"\s+", " ", cleaned).strip()


def _is_valid_location(value: str | None) -> bool:
    if not value:
        return False
    normalized = _norm_text(value)
    blocked = ("head plate", "customer name", "terms and conditions", "trailer plate")
    if any(term in normalized for term in blocked):
        return False
    return any(term in normalized for term in ("yard", "site", "warehouse", "port", "mosb", "mirfa", "m44"))


def _lane_norm(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = _norm_text(value)
    if "mosb" in normalized or "mussafah" in normalized:
        return "MOSB_YARD"
    if "mirfa" in normalized:
        return "MIRFA_SITE"
    if "shuweihat" in normalized:
        return "SHUWEIHAT_SITE"
    if "khalifa" in normalized and "port" in normalized:
        return "KHALIFA_PORT"
    if "mina" in normalized and "zayed" in normalized:
        return "MINA_ZAYED_PORT"
    if "jebel" in normalized and "ali" in normalized:
        return "JEBEL_ALI_PORT"
    return value


def is_dsv_waybill_text(text: str) -> bool:
    normalized = _norm_text(text)
    required = ("dsv", "waybill")
    return all(term in normalized for term in required) and (
        "consignment information" in normalized or "delivery note" in normalized
    )


def parse_dsv_waybill_from_text(text: str) -> DsvWaybillResult:
    fields = {
        "waybill_no": _regex_first(r"Waybill\s*#\s*([^\n\r]+)", text),
        "printed_date": _regex_first(r"Printed Date:\s*([^\n\r]+)", text),
        "do_no": _regex_first(r"DO\s*#:\s*([^\n\r]+)", text),
        "cust_ref": _regex_first(r"Cust\.\s*Ref\.\s*#:\s*([^\n\r]+)", text),
        "bol_no": _regex_first(r"BOL\s*#:\s*([^\n\r]+)", text),
        "order_no": _regex_first(r"Order Number:\s*([^\n\r]+)", text),
        "job_no": _regex_first(r"Job Number:\s*([^\n\r]+)", text),
        "po_no": _regex_first(r"PO Number:\s*([^\n\r]+)", text),
        "head_plate": _regex_first(r"Head Plate:\s*([^\n\r]+)", text),
        "trailer_plate": _regex_first(r"Trailer Plate:\s*([^\n\r]+)", text),
        "driver_name": _regex_first(r"Driver Name:\s*([^\n\r]+)", text),
        "trip_no": _regex_first(r"Trip No\.:\s*([^\n\r]+)", text),
    }

    origin_raw = _clean_origin_field(
        _regex_first(r"(?:Loading Address|Loading Point):\s*([^\n\r]+)", text)
    )
    destination_raw = _regex_first(r"Destination:\s*([^\n\r]+)", text)
    lane = {
        "origin_raw": origin_raw,
        "destination_raw": destination_raw,
        "origin_norm": _lane_norm(origin_raw),
        "destination_norm": _lane_norm(destination_raw),
    }
    timeline = {
        "arrive_loading_dt": _regex_first(r"Arrival for Loading Date/Time:\s*([^\n\r]+)", text),
        "loading_started_dt": _regex_first(r"Loading Started Date/Time:\s*([^\n\r]+)", text),
        "loading_finish_dt": _regex_first(r"Loading Finish Date/Time:\s*([^\n\r]+)", text),
        "arrive_offloading_dt": _regex_first(r"Arrival for Offloading Date/Time:\s*([^\n\r]+)", text),
        "offloading_started_dt": _regex_first(r"Offloading Started Date/Time:\s*([^\n\r]+)", text),
        "offloading_ended_dt": _regex_first(r"Offloading Ended Date/Time:\s*([^\n\r]+)", text),
    }

    result = DsvWaybillResult(
        doc_kind="DSV_WAYBILL",
        fields=fields,
        lane=lane,
        timeline=timeline,
        confidence=0.85 if is_dsv_waybill_text(text) else 0.0,
    )
    result.update(fields)
    result.update(lane)
    result.update(timeline)
    return result
