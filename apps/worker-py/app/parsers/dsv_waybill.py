"""DSV domestic waybill / delivery note field extraction (v1.4 -> worker port).

Ported from domestic/runtime/utils/pdf_processor_v1_2_dsv_patched.py:
- 5-layer lane extraction (routing clean, consignment table, text, direct label)
- Consignment information table extraction via pdfplumber
- UAE location validation with priority keywords
- Invalid origin/destination pattern filtering
- Confidence scoring weighted by field presence

Usage:
    is_dsv_waybill_text(text) -> bool
    parse_dsv_waybill_from_text(text, consignment=None) -> dict
    extract_consignment_from_pdfplumber(pdf, max_pages=2) -> dict | None
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Tuple, cast

import pdfplumber as pdfplumber_lib


class DsvWaybillResult(dict):
    """Dict subclass with attribute access for backward compat."""
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

# ── text normalisation helpers ──────────────────────────────────────────────

def _norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9/#:._\- ]", " ", (value or "").lower())).strip()


def _regex_first(pattern: str, text: str, flags: int = re.IGNORECASE | re.MULTILINE | re.DOTALL) -> str | None:
    m = re.search(pattern, text or "", flags)
    if not m or not m.group(1):
        return None
    return m.group(1).strip()


def _clean_ws_text(value: str | None) -> str:
    if not value:
        return ""
    s = str(value).replace("\u00a0", " ")
    s = s.replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip()


def _compact_identifier_text(value: str | None) -> str:
    s = _clean_ws_text(value)
    return re.sub(r"\s*-\s*", "-", s)


# ── location validation (UAE HVDC keywords, invalid patterns) ───────────────

INVALID_ORIGIN_DEST_PATTERNS = [
    r"validity",
    r"customer.*account",
    r"name.*address",
    r"terms.*conditions",
    r"binding.*shipper",
    r"consignment\s*note",
    r"issued\s*by",
    r"routing\s*and\s*destination",
    r"loading\s*point.*destination",
    r"customer.*name",
    r"cust\.\s*ref\s*#",
    r"^\s*:\s*$",
    r"^\s*[a-z]{2,3}\s*$",
    r"(?:copies|validity|originals)",
    r"^\d+$",
    r"^\d{4}-\d{5,8}[A-Z]{3}$",
    r"^\d{10}[A-Z]{3}$",
    r"^y?uae$",
    r"^\s*$",
    r"^[\s\W]+$",
    r"head\s*plate",
    r"trailer\s*plate",
    r"head\s*plate\s*\d+",
    r"trailer\s*plate\s*\d+",
    r"destination\s*code:\s*\d+",
    r"ft-sg",
    r"carrier\s*details",
    r"vehicle\s*(?:no|number)",
    r"head\s*plate.*?trailer\s*plate.*?destination\s*code",
]

VALID_LOCATION_KEYWORDS: Dict[str, List[str]] = {
    "high": [
        "mosb", "mirfa", "shuweihat", "khalifa", "mina zayed", "jebel ali",
        "mussafah", "kizad", "icad", "m44",
    ],
    "medium": [
        "warehouse", "port", "yard", "site", "industrial", "free zone",
        "abu dhabi", "dubai", "ajman", "sharjah", "rak", "fujairah",
    ],
    "low": [
        "dewa", "adnoc", "samsung", "dsv", "etihad",
        "agility", "masaood", "bergum", "sas", "power",
        "schenker", "schencker", "adopt", "hauler",
    ],
}


def _is_valid_location(text: str | None) -> bool:
    if not text:
        return False
    t = _norm_text(text)
    if len(t) < 5 or len(t) > 100:
        return False
    for pat in INVALID_ORIGIN_DEST_PATTERNS:
        if re.search(pat, t, re.IGNORECASE):
            return False
    for priority in ("high", "medium", "low"):
        for kw in VALID_LOCATION_KEYWORDS.get(priority, []):
            if kw in t:
                return True
    if re.search(r"\d+|road|street|zone|area|plot|building|warehouse|yard|site", t, re.IGNORECASE):
        return True
    return False


def _clean_origin_field(origin: str | None) -> str | None:
    if not origin:
        return None
    cleaning_patterns = [
        r"head\s*plate\s*\d+",
        r"trailer\s*plate\s*\d+",
        r"destination\s*code:\s*\d+",
        r"ft-sg",
        r"carrier\s*details.*",
        r"vehicle\s*(?:no|number):?\s*\d+",
    ]
    cleaned = origin
    for pat in cleaning_patterns:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 5:
        return None
    return cleaned


def _lane_norm(value: str | None) -> str | None:
    if not value:
        return None
    s = _norm_text(value)
    if "mosb" in s or "mussafah" in s:
        return "MOSB_YARD"
    if "mirfa" in s:
        return "MIRFA_SITE"
    if "shuweihat" in s:
        return "SHUWEIHAT_SITE"
    if "khalifa" in s and "port" in s:
        return "KHALIFA_PORT"
    if "mina" in s and "zayed" in s:
        return "MINA_ZAYED_PORT"
    if "jebel" in s and "ali" in s:
        return "JEBEL_ALI_PORT"
    if "dsv" in s and ("warehouse" in s or "yard" in s):
        return "DSV_WAREHOUSE"
    return value


# ── consignment information table extraction (pdfplumber) ───────────────────

def _looks_like_consignment_header(row: List[str | None]) -> bool:
    text = " ".join(_clean_ws_text(c).lower() for c in (row or []) if c)
    return (
        "order number" in text
        and "job number" in text
        and "po number" in text
        and "loading point" in text
    )


def _map_consignment_header_indices(header: List[str | None]) -> Dict[str, int]:
    idx: Dict[str, int] = {}
    for i, cell in enumerate(header or []):
        h = _clean_ws_text(cell).lower()
        if "order number" in h and "order_no" not in idx:
            idx["order_no"] = i
        elif "job number" in h and "job_no" not in idx:
            idx["job_no"] = i
        elif "po number" in h and "po_no" not in idx:
            idx["po_no"] = i
        elif "loading point" in h and "loading_point" not in idx:
            idx["loading_point"] = i
        elif "loading country" in h and "loading_country" not in idx:
            idx["loading_country"] = i
        elif "description" in h and "description" not in idx:
            idx["description"] = i
    return idx


def extract_consignment_from_pdfplumber(
    pdf: pdfplumber_lib.PDF, max_pages: int = 2
) -> Dict[str, str] | None:
    """Extract DSV consignment information table from pdfplumber PDF handle."""
    try:
        pages = min(max_pages, len(pdf.pages))
        for page in pdf.pages[:pages]:
            tables = page.extract_tables() or []
            for table in tables:
                if not table or len(table) < 2:
                    continue
                header = table[0]
                if not _looks_like_consignment_header(header):
                    continue
                idx = _map_consignment_header_indices(header)
                for row in table[1:]:
                    if not row:
                        continue
                    if _looks_like_consignment_header(row):
                        continue

                    def _cell(key: str) -> str | None:
                        j = idx.get(key)
                        if j is None or j >= len(row):
                            return None
                        return row[j]

                    out: Dict[str, str] = {}
                    order_no = _compact_identifier_text(_cell("order_no"))
                    job_no = _compact_identifier_text(_cell("job_no"))
                    po_no = _compact_identifier_text(_cell("po_no"))
                    loading_point = _clean_ws_text(_cell("loading_point"))
                    loading_country = _clean_ws_text(_cell("loading_country"))
                    description = _clean_ws_text(_cell("description"))

                    if order_no:
                        out["order_no"] = order_no
                    if job_no:
                        out["job_no"] = job_no
                    if po_no:
                        out["po_no"] = po_no
                    if loading_point:
                        out["loading_point"] = loading_point
                    if loading_country:
                        out["loading_country"] = loading_country
                    if description:
                        out["description"] = description
                    if out:
                        return out
    except Exception:
        pass
    return None


# ── lane extraction ─────────────────────────────────────────────────────────

def _extract_routing_section_clean(raw: str) -> Dict[str, Any]:
    """Extract routing section excluding carrier/equipment fields."""
    lane: Dict[str, Any] = {"origin_raw": None, "destination_raw": None, "extraction_method": None}
    routing_pattern = (
        r"routing\s+and\s+destination\s*[:\n]*(.*?)(?=head\s+plate|trailer\s+plate|carrier\s+details|"
        r"consignment\s+information|$)"
    )
    m = re.search(routing_pattern, raw or "", re.DOTALL | re.IGNORECASE)
    if not m:
        return lane
    section = m.group(1).strip()

    loading_patterns = [
        r"loading\s+address\s*:\s*([^\n]+?)(?=\s*destination|$)",
        r"loading\s+point\s*:\s*([^\n]+?)(?=\s*destination|$)",
        r"from\s*:\s*([^\n]+?)(?=\s*to|$)",
    ]
    for pat in loading_patterns:
        match = re.search(pat, section, re.IGNORECASE)
        if match:
            candidate = _clean_origin_field(match.group(1).strip())
            if candidate and _is_valid_location(candidate):
                lane["origin_raw"] = candidate
                break

    dest_patterns = [
        r"destination\s*:\s*([^\n]+?)(?=\s*trip|order|job|$)",
        r"to\s*:\s*([^\n]+?)(?=\s*trip|order|job|$)",
    ]
    for pat in dest_patterns:
        match = re.search(pat, section, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if _is_valid_location(candidate):
                lane["destination_raw"] = candidate
                break

    if lane["origin_raw"] or lane["destination_raw"]:
        lane["extraction_method"] = "routing_section_clean"
    return lane


def _extract_lane_from_table(raw: str) -> Tuple[str | None, str | None]:
    patterns = [
        r"loading\s*(?:point|address)\s*[\t|]+\s*destination\s*\n+\s*([^\t|\n]+)\s*[\t|]+\s*([^\t|\n]+)",
        r"([A-Z][^\n]{3,50}?(?:yard|port|site|warehouse)[^\n]*?)\s{3,}([A-Z][^\n]{3,50}?(?:yard|port|site|warehouse))",
    ]
    for pat in patterns:
        m = re.search(pat, raw, re.IGNORECASE)
        if m:
            origin_candidate = _clean_origin_field(m.group(1).strip())
            dest_candidate = m.group(2).strip()
            if origin_candidate and _is_valid_location(origin_candidate) and _is_valid_location(dest_candidate):
                return origin_candidate, dest_candidate
    return None, None


def _extract_lane_from_full_text(raw: str) -> Tuple[str | None, str | None]:
    clean = re.sub(
        r"(?:terms\s*(?:and|&)\s*conditions|disclaimer|validity|the\s*terms)[\s\S]{0,300}?(?:have\s+the\s+same|are\s+subject|shall\s+be|binding|applicable)",
        "", raw, flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"customer'?s?\s+(?:name\s*[&\s]+address|account\s+number)[\s\S]{0,150}?(?=issued\s+by|from|to|routing|loading|$)",
        "", clean, flags=re.IGNORECASE,
    )
    clean = re.sub(
        r"(?:issued\s+by|consignee|shipper|notify\s+party)\s*[:\n]\s*DSV\s+SOLUTIONS",
        "", clean, flags=re.IGNORECASE,
    )

    # "From: X To: Y"
    m = re.search(
        r"\bfrom\s*[:#]?\s*([A-Z][^,\n]{5,80}?)\s+to\s*[:#]?\s*([A-Z][^,\n]{5,80}?)(?=\s{2,}|\n|trip|order|$)",
        clean, re.IGNORECASE,
    )
    if m:
        o = _clean_origin_field(m.group(1).strip())
        d = m.group(2).strip()
        if o and _is_valid_location(o) and _is_valid_location(d):
            return o, d

    # Loading Address / Point
    loading_m = re.search(
        r"loading\s*(?:address|point)\s*[:#]\s*\n?\s*([A-Z][^\n]{5,100}?)(?=\s*\n|destination|trip)",
        clean, re.IGNORECASE,
    )
    origin = _clean_origin_field(loading_m.group(1).strip()) if loading_m else None

    # Destination (negative lookbehind for routing header / name header)
    dest_m = re.search(
        r"(?<!routing and )(?<!name & )(?<!name and )destination\s*[:#]\s*\n?\s*([A-Z][^\n]{5,100}?)(?=\s*\n|trip|order|job|$)",
        clean, re.IGNORECASE,
    )
    dest: str | None = None
    if dest_m:
        d = dest_m.group(1).strip()
        if not re.search(r"customer|account|address|name|number", d, re.IGNORECASE) and _is_valid_location(d):
            dest = d

    if origin and _is_valid_location(origin):
        return origin, dest or None
    return None, dest


def _extract_loading_point_from_consignment(raw: str) -> str | None:
    """Extract Loading Point from CONSIGNMENT INFORMATION section."""
    section_m = re.search(
        r"consignment\s*information\s*([\s\S]{50,1200}?)(?=consignment\s*loading\s*date|sender\s*section|arrival\s+for\s+loading|receiver\s*section|trip\s*no\.\s*:|\Z)",
        raw, re.IGNORECASE,
    )
    if not section_m:
        return None
    section = section_m.group(1).strip()
    section = re.sub(r"\n+", " ", section)
    section = re.sub(r"\s{2,}", " ", section)

    known_prefixes = r"(?:DSV|Agility|SAS|MOSB|Mirfa|Shuweihat|KIZAD|Masaood|Samsung|Schenker|Schencker)"
    pattern_a = rf"(?<![A-Z\-])({known_prefixes}[\sA-Za-z0-9&.]+?)\s+UAE\b"
    for m in re.finditer(pattern_a, section, re.IGNORECASE):
        candidate = _clean_origin_field(m.group(1))
        if candidate and re.search(r"HVDC-|SAMF\d", candidate, re.IGNORECASE):
            continue
        if candidate and _is_valid_location(candidate):
            return candidate

    known_suffixes = r"(?:Yard|Warehouse|Site|Port|Power|Industries|FZE|LLC|M44|ICAD|Bergum)"
    pattern_b = rf"\b([A-Z][A-Za-z0-9\s\-&.]*{known_suffixes})\s+UAE\b"
    for m in re.finditer(pattern_b, section, re.IGNORECASE):
        candidate = _clean_origin_field(m.group(1))
        if candidate and re.match(r"^(HVDC|SAMF)", candidate, re.IGNORECASE):
            continue
        if candidate and _is_valid_location(candidate):
            return candidate

    pattern_c = r"\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\s+UAE\b"
    for m in re.finditer(pattern_c, section, re.IGNORECASE):
        candidate = _clean_origin_field(m.group(1))
        if candidate and re.match(r"^(HVDC|SAMF|Order|Job|PO|Loading|Country|No)", candidate, re.IGNORECASE):
            continue
        if candidate and _is_valid_location(candidate):
            return candidate
    return None


# ── detection ───────────────────────────────────────────────────────────────

def is_dsv_waybill_text(text: str) -> bool:
    t = _norm_text(text)
    return (
        "dsv" in t
        and ("delivery note" in t or "waybill" in t)
        and ("road freight" in t or "consignment" in t or "routing and destination" in t)
    )


# ── main parser ─────────────────────────────────────────────────────────────

def parse_dsv_waybill_from_text(
    text: str, consignment: Mapping[str, str] | None = None
) -> DsvWaybillResult:
    raw = text or ""
    out: Dict[str, Any] = {
        "doc_kind": "DSV_WAYBILL",
        "fields": {},
        "lane": {},
        "timeline": {},
        "confidence": 0.0,
        "flags": [],
    }

    # ── core identifiers ──
    out["fields"]["waybill_no"] = _regex_first(r"(?:delivery\s*note/waybill\s*#|waybill\s*#)\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["printed_date"] = _regex_first(r"printed\s*date\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})", raw)
    out["fields"]["do_no"] = _regex_first(r"\bdo\s*#\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["do_validity"] = _regex_first(r"do\s*validity\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})", raw)
    out["fields"]["cust_ref"] = _regex_first(r"cust\.?\s*ref\.?\s*#\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["bol_no"] = _regex_first(r"\bbol\s*#\s*[:#]?\s*([A-Z0-9\-]+)", raw)

    def _looks_like_order_no(v: str | None) -> bool:
        return bool(re.fullmatch(r"\d{2,}-[A-Z0-9]{3,}", _compact_identifier_text(v) or "", re.IGNORECASE))

    def _looks_like_job_no(v: str | None) -> bool:
        v2 = _compact_identifier_text(v)
        return bool(v2 and len(v2) >= 6 and re.search(r"\d", v2) and not re.fullmatch(r"(?:job|po|loading|order)", v2, re.IGNORECASE))

    def _looks_like_po_no(v: str | None) -> bool:
        v2 = _compact_identifier_text(v)
        return bool(v2 and len(v2) >= 6 and "-" in v2 and re.search(r"\d", v2) and not re.fullmatch(r"(?:job|po|loading|order)", v2, re.IGNORECASE))

    order_no_txt = _compact_identifier_text(_regex_first(r"order\s*(?:number|no\.?)\s*[:#]?\s*([A-Z0-9\-]+)", raw))
    job_no_txt = _compact_identifier_text(_regex_first(r"job\s*(?:number|no\.?)\s*[:#]?\s*([A-Z0-9\-]+)", raw))
    po_no_txt = _compact_identifier_text(_regex_first(r"po\s*(?:number|no\.?)\s*[:#]?\s*([A-Z0-9\-]+)", raw))

    out["fields"]["order_no"] = order_no_txt if _looks_like_order_no(order_no_txt) else None
    out["fields"]["job_no"] = job_no_txt if _looks_like_job_no(job_no_txt) else None
    out["fields"]["po_no"] = po_no_txt if _looks_like_po_no(po_no_txt) else None

    if consignment:
        c_order = _compact_identifier_text(consignment.get("order_no"))
        c_job = _compact_identifier_text(consignment.get("job_no"))
        c_po = _compact_identifier_text(consignment.get("po_no"))
        if c_order and _looks_like_order_no(c_order):
            out["fields"]["order_no"] = c_order
        if c_job and _looks_like_job_no(c_job):
            out["fields"]["job_no"] = c_job
        if c_po and _looks_like_po_no(c_po):
            out["fields"]["po_no"] = c_po
        if consignment.get("loading_point"):
            out["fields"]["loading_point"] = _clean_ws_text(consignment.get("loading_point"))
        if consignment.get("loading_country"):
            out["fields"]["loading_country"] = _clean_ws_text(consignment.get("loading_country"))
        if consignment.get("description"):
            out["fields"]["description"] = _clean_ws_text(consignment.get("description"))

    out["fields"]["req_truck_type"] = _regex_first(r"req\.?\s*truck\s*type\s*[:#]?\s*([^\n]+)", raw)
    out["fields"]["head_plate"] = _regex_first(r"head\s*plate\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["trailer_plate"] = _regex_first(r"trailer\s*plate\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["trailer_type"] = _regex_first(r"trailer\s*type\s*[:#]?\s*([^\n]+)", raw)
    out["fields"]["driver_name"] = _regex_first(r"driver\s*name\s*[:#]?\s*([^\n]+)", raw)
    out["fields"]["employee_id"] = _regex_first(r"employee\s*#\s*[:#]?\s*([0-9]+)", raw)

    # ── lane extraction (5 methods, fallback cascade) ──
    origin: str | None = None
    destination: str | None = None
    extraction_method: str | None = None

    routing_clean = _extract_routing_section_clean(raw)
    if routing_clean.get("origin_raw") or routing_clean.get("destination_raw"):
        origin = routing_clean.get("origin_raw") or origin
        destination = routing_clean.get("destination_raw") or destination
        extraction_method = routing_clean.get("extraction_method") or extraction_method

    if not origin and consignment and consignment.get("loading_point"):
        candidate = _clean_origin_field(_clean_ws_text(consignment.get("loading_point")))
        if candidate and _is_valid_location(candidate):
            origin = candidate
            extraction_method = extraction_method or "consignment_table"

    if not origin:
        ci_origin = _extract_loading_point_from_consignment(raw)
        if ci_origin:
            origin = ci_origin
            extraction_method = extraction_method or "consignment_pattern"

    if not (origin and destination):
        o_tbl, d_tbl = _extract_lane_from_table(raw)
        if o_tbl and d_tbl:
            origin = o_tbl
            destination = d_tbl
            extraction_method = "table"

    if not (origin and destination):
        o_txt, d_txt = _extract_lane_from_full_text(raw)
        if o_txt:
            origin = origin or o_txt
        if d_txt:
            destination = destination or d_txt
        if origin or destination:
            extraction_method = extraction_method or "text"

    if not destination:
        dest_direct = _regex_first(r"Destination\s*[:#]\s*([A-Z][^\n]{3,80})", raw)
        if dest_direct and _is_valid_location(dest_direct):
            destination = dest_direct
            extraction_method = extraction_method or "direct_label"

    if origin:
        oc = _clean_origin_field(origin)
        origin = oc if (oc and _is_valid_location(oc)) else None

    out["lane"]["origin_raw"] = origin
    out["lane"]["destination_raw"] = destination
    out["lane"]["extraction_method"] = extraction_method
    out["lane"]["origin_norm"] = _lane_norm(origin)
    out["lane"]["destination_norm"] = _lane_norm(destination)
    out["fields"]["loading_address"] = origin
    out["fields"]["destination"] = destination

    # ── timeline ──
    out["fields"]["trip_no"] = _regex_first(r"trip\s*no\.?\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["timeline"]["arrive_loading_dt"] = _regex_first(r"arrival\s+for\s+loading\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["loading_started_dt"] = _regex_first(r"loading\s+started\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["loading_finish_dt"] = _regex_first(r"loading\s+finish\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["arrive_offloading_dt"] = _regex_first(r"arrival\s+for\s+offloading\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["offloading_started_dt"] = _regex_first(r"offloading\s+started\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["offloading_ended_dt"] = _regex_first(r"offloading\s+ended\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)

    # ── confidence & flags ──
    required = ["waybill_no", "trip_no", "order_no", "po_no"]
    found = sum(1 for k in required if out["fields"].get(k))
    if out["lane"].get("destination_norm") and _is_valid_location(out["lane"].get("destination_raw") or ""):
        found += 1
    if out["lane"].get("origin_norm") and _is_valid_location(out["lane"].get("origin_raw") or ""):
        found += 0.5
    if out["fields"].get("req_truck_type"):
        found += 1
    denom = len(required) + 2
    out["confidence"] = min(1.0, round(found / denom, 4))

    if not out["fields"].get("trip_no"):
        out["flags"].append("TRIP_NO_MISSING")
    if not (out["lane"].get("origin_norm") and out["lane"].get("destination_norm")):
        out["flags"].append("LANE_INCOMPLETE")
    if not _is_valid_location(out["lane"].get("origin_raw") or ""):
        out["flags"].append("ORIGIN_INVALID")
    if not _is_valid_location(out["lane"].get("destination_raw") or ""):
        out["flags"].append("DESTINATION_INVALID")
    if out["confidence"] < 0.8:
        out["flags"].append("LOW_CONFIDENCE")

    result = DsvWaybillResult(out)
    # Flatten fields/lane/timeline for top-level attribute access (backward compat)
    result.update(out.get("fields", {}))
    result.update(out.get("lane", {}))
    result.update(out.get("timeline", {}))
    return result


def extract_dsv_from_pdf_bytes(raw: bytes, file_id: str = "", file_name: str = "", max_pages: int = 2) -> Dict[str, Any]:
    """Convenience: extract DSV waybill from raw PDF bytes."""
    from io import BytesIO
    try:
        with pdfplumber_lib.open(BytesIO(raw)) as pdf:
            consignment = extract_consignment_from_pdfplumber(pdf, max_pages=max_pages)
            pages_text: list[str] = []
            for page in pdf.pages[:max_pages]:
                t = page.extract_text() or ""
                pages_text.append(t)
            full_text = "\n".join(pages_text)
        parsed = parse_dsv_waybill_from_text(full_text, consignment=consignment)
        if consignment:
            parsed["consignment_table"] = consignment
        parsed["success"] = True
        return parsed
    except Exception as e:
        return {"doc_kind": "DSV_WAYBILL", "success": False, "error": str(e), "confidence": 0.0, "fields": {}, "lane": {}, "timeline": {}, "flags": ["PDF_TEXT_EXTRACT_FAILED"]}
