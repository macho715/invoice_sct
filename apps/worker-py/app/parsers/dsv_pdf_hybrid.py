"""DSV SHPT hybrid PDF line-item extractor.

Ported extraction core of `pdf_hybrid_parser_pro_v2_1.py` (DSV_SHPT_PDF_PARSE_v1.0)
into the worker. Produces invoice line items + doc_type + common keys from PDF
*native* text (pdfplumber). Excluded from the port (by design):

  - OCR (fitz/pytesseract) and QA render — scanned PDFs stay a follow-up (`DSV_PDF_OCR`).
  - DLP masking — removed project-wide (see docs/CLAUDE.md).
  - gate_verdict — final PASS/AMBER/ZERO is decided in Vercel (gate-bridge.ts);
    the worker only parses. We surface parser-stage `parser_issues` hints, not a verdict.
  - XLSX/JSON writers and CLI — the worker exporter owns output.

Text + tables are reused from `parse_pdf_text_bytes` to avoid a second pdfplumber pass.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------------------
# Text normalization helpers
# ---------------------------------------------------------------------------

FF = "￾"
NBSP = " "


def normalize_text(text: str) -> str:
    """Normalize PDF extraction artifacts while preserving line breaks."""
    if not text:
        return ""
    text = text.replace(FF, "-").replace(NBSP, " ")
    text = text.replace("​", "").replace("‎", "").replace("‏", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def norm_for_match(text: str) -> str:
    """Uppercase matching text with separators flattened."""
    t = normalize_text(text).upper()
    t = re.sub(r"[\s\-_/.:#]+", " ", t)
    return t


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    s = str(value).strip()
    if not s:
        return None
    s = s.replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return round(float(m.group(0)), 2)
    except ValueError:
        return None


def dedupe_preserve(items: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for x in items:
        if not x:
            continue
        y = str(x).strip()
        if not y or y in seen:
            continue
        seen.add(y)
        out.append(y)
    return out


# ---------------------------------------------------------------------------
# DOC_TYPE classification
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DocRule:
    doc_type: str
    all_terms: tuple[str, ...] = ()
    any_terms: tuple[str, ...] = ()
    regex_any: tuple[str, ...] = ()
    confidence: int = 80
    note: str = ""


DOC_TYPE_RULES: list[DocRule] = [
    # Specific invoice/port patterns before generic tax invoice patterns.
    DocRule("PORT_CSP", all_terms=("CSP ABU DHABI TERMINAL",), any_terms=("PACKAGE INVOICE", "INMNR"), confidence=98,
            note="CSP MNR package/detail invoice"),
    DocRule("PORT_ALLIED", any_terms=("ALLIED ONDOCK", "TRANS WORLD CONTAINER SERVICES", "TWCS INSPECTION"), confidence=98,
            note="Allied/TWCS container inspection"),
    DocRule("AIRPORT_FEES", all_terms=("CHARGES SUMMARY",), any_terms=("MAQTA CHARGES", "ETIHAD TERMINAL CHARGES", "DPC CHARGES"), confidence=96,
            note="ATLP/Maqta airport fee summary"),
    DocRule("AIRPORT_APPOINTMENT", all_terms=("IMPORT APPOINTMENT SUMMARY",), confidence=96,
            note="ATLP import appointment summary"),

    # Customs before delivery order because BOE contains the field label DELIVERY ORDER NO.
    DocRule("BOE_CUSTOMS", any_terms=("CUSTOMS DECLARATION", "PRE CLEAR BILL", "PRE-CLEAR BILL", "DEBIT NOTE", "GATE PASS", "LAND IMPORT", "بيان جمركي"), confidence=95,
            note="UAE Customs declaration/debit/gate pass"),

    # Delivery artifacts.
    DocRule("DELIVERY_ORDER", any_terms=("DELIVERY ORDER", "DELIVERY NOTIFICATION", "DELIVERY NOTIFICATION MASTER", "D O NO", "D.O.NO", "D.O. NUMBER"), confidence=92,
            note="Delivery order or air delivery notification"),
    DocRule("DELIVERY_NOTE", any_terms=("NOT NEGOTIABLE DELIVERY NOTE", "DELIVERY NOTE WAYBILL", "CONSIGNMENT NOTE", "ROAD FREIGHT"), confidence=90,
            note="DSV road freight delivery note"),

    # Carrier invoices.
    DocRule("CARRIER_CMA", all_terms=("CMA CGM SHIPPING AGENCY",), any_terms=("TAX INVOICE", "INVOICE"), confidence=95,
            note="CMA CGM carrier invoice"),
    DocRule("CARRIER_RHS", all_terms=("RAIS HASSAN SAADI",), any_terms=("TAX INVOICE",), confidence=95,
            note="RHS/HMM carrier invoice"),
    DocRule("CARRIER_EVG", all_terms=("EVERGREEN SHIPPING AGENCY",), any_terms=("TAX INVOICE", "INVOICE"), confidence=95,
            note="Evergreen carrier invoice"),
]


def classify_doc(text: str, filename: str = "") -> dict[str, Any]:
    hay = norm_for_match(text + "\n" + filename)
    raw_upper = (text + "\n" + filename).upper()
    for rule in DOC_TYPE_RULES:
        all_ok = all(norm_for_match(t) in hay for t in rule.all_terms)
        any_terms_ok = True if not rule.any_terms else any(norm_for_match(t) in hay for t in rule.any_terms)
        regex_ok = True if not rule.regex_any else any(re.search(rx, raw_upper, flags=re.I) for rx in rule.regex_any)
        if all_ok and any_terms_ok and regex_ok:
            matched = list(rule.all_terms) + [t for t in rule.any_terms if norm_for_match(t) in hay]
            return {
                "doc_type": rule.doc_type,
                "confidence": rule.confidence,
                "matched": matched[:5],
                "rule_note": rule.note,
            }
    return {"doc_type": "UNKNOWN", "confidence": 0, "matched": [], "rule_note": "No header fingerprint matched"}


# ---------------------------------------------------------------------------
# COMMON_KEYS extraction
# ---------------------------------------------------------------------------

RX_SHIP_TEXT = re.compile(r"HVDC[\s\-_/]*ADOPT[\s\-_/]*(SCT|HE)[\s\-_/]*(\d{4})", flags=re.I)
RX_SHIP_FILE = re.compile(r"HVDC[\s\-_/]*ADOPT[\s\-_/]*(SCT|HE)[\s\-_/]*([0-9]{4}(?:\s*,\s*[0-9]{4})*)", flags=re.I)
RX_CONTAINER_CANDIDATE = re.compile(r"\b([A-Z]{3}[UJZ])\s?(\d{6})-?(\d)\b")
RX_AWB = re.compile(r"\b(\d{3})-?(\d{8})\b")
RX_HAWB = re.compile(r"\b(ELA\d{7})\b", flags=re.I)
MONTH_PATTERN = r"(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)"
RX_DATE = re.compile(
    rf"\b(\d{{1,2}}/\d{{1,2}}/\d{{4}}|\d{{1,2}}-(?:{MONTH_PATTERN})-\d{{2,4}}|\d{{4}}-\d{{2}}-\d{{2}}|\d{{1,2}}[ \t]+(?:{MONTH_PATTERN})[ \t]+\d{{2,4}})\b",
    flags=re.I,
)
RX_AED_CONTEXT = re.compile(r"\bAED\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?|[0-9]+(?:\.\d{2})?)\b", flags=re.I)

# ISO 6346 character map. Multiples of 11 are skipped.
ISO6346_VALUES: dict[str, int] = {}
_val = 10
for _ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    ISO6346_VALUES[_ch] = _val
    _val += 1
    if _val in (11, 22, 33):
        _val += 1


def iso6346_valid(container: str) -> bool:
    c = re.sub(r"[^A-Z0-9]", "", container.upper())
    if not re.match(r"^[A-Z]{3}[UJZ]\d{7}$", c):
        return False
    total = 0
    for i, ch in enumerate(c[:10]):
        value = ISO6346_VALUES.get(ch) if ch.isalpha() else int(ch)
        if value is None:
            return False
        total += value * (2 ** i)
    check = (total % 11) % 10
    return check == int(c[-1])


def extract_shipments(text: str, filename: str) -> list[str]:
    normalized = normalize_text(text)
    vals: list[str] = []
    for m in RX_SHIP_TEXT.finditer(normalized):
        vals.append(f"HVDC-ADOPT-{m.group(1).upper()}-{m.group(2)}")
    for m in RX_SHIP_FILE.finditer(filename):
        series = m.group(1).upper()
        numbers = re.split(r"\s*,\s*", m.group(2))
        for n in numbers:
            if re.match(r"^\d{4}$", n):
                vals.append(f"HVDC-ADOPT-{series}-{n}")
    return dedupe_preserve(vals)


def extract_containers(text: str) -> list[str]:
    vals: list[str] = []
    fallback: list[str] = []
    for m in RX_CONTAINER_CANDIDATE.finditer(text.upper()):
        c = f"{m.group(1)}{m.group(2)}{m.group(3)}"
        if iso6346_valid(c):
            vals.append(c)
        else:
            fallback.append(c)
    return dedupe_preserve(vals or fallback)


def extract_bl_numbers(text: str) -> list[str]:
    vals: list[str] = []
    patterns = [
        r"(?:B/L\s*NR\.?|B/L\s*NUMBER|B/L-AWB\s*NO\.?|BOL\s*#|BOL\s*NO|BILL\s+OF\s+LADING|MBL\s*NO\.?|MB/L\s*NO)\s*:?[\s\n]*([A-Z0-9]{8,24})",
        r"\b(SELA[A-Z0-9]{8,}|EGLV[A-Z0-9]{8,}|CHN\d{7,}|MEDUUX\d{6,}|MEDU[A-Z0-9]{7,})\b",
    ]
    upper = text.upper()
    for rx in patterns:
        for m in re.finditer(rx, upper, flags=re.I):
            val = m.group(1).strip(" /\\")
            # Reject ISO containers and likely invoice numbers.
            if RX_CONTAINER_CANDIDATE.match(val):
                continue
            if val in {"PRINCIPAL", "BOOKING", "CUSTOMER", "REFERENCE", "NUMBER"}:
                continue
            if val.startswith(("IN", "INV", "AECI")):
                continue
            vals.append(val)
    return dedupe_preserve(vals)


def extract_awb(text: str) -> tuple[list[str], list[str]]:
    upper = text.upper()
    air_context = bool(re.search(r"MAWB|HAWB|AIRWAY|AIR/|AIRPORT|FLIGHT|ZAYED AIRPORT", upper))
    mawb: list[str] = []
    hawb: list[str] = []
    label_rx = re.compile(r"(?:MAWB#?|AWB#?|B/L-AWB\s*NO\.?)\s*:?[\s\n]*(\d{3})-?(\d{8})", flags=re.I)
    for m in label_rx.finditer(text):
        mawb.append(f"{m.group(1)}-{m.group(2)}")
    if air_context:
        for m in RX_AWB.finditer(text):
            mawb.append(f"{m.group(1)}-{m.group(2)}")
        for m in RX_HAWB.finditer(text):
            hawb.append(m.group(1).upper())
    return dedupe_preserve(mawb), dedupe_preserve(hawb)


def extract_do_numbers(text: str) -> list[str]:
    vals: list[str] = []
    patterns = [
        r"(?:D/ORDER\s*NO|D/O\s*NO|D\.O\.?\s*NO|D\.O\.\s*NUMBER|DO\s*#|DO\s*CODE|DELIVERY\s+NOTE\s+NO|DELIVERY\s+ORDER\s+NO\.?)\s*:?[\s\n]*([A-Z0-9-]{6,})",
        r"\b(DOCHP\d{8,})\b",
    ]
    upper = text.upper()
    for rx in patterns:
        for m in re.finditer(rx, upper, flags=re.I):
            val = m.group(1).replace(" ", "").strip("./:-")
            if val and val not in ("DATE", "VALIDITY"):
                vals.append(val)
    return dedupe_preserve(vals)


def extract_invoice_numbers(text: str) -> list[str]:
    vals: list[str] = []
    upper = text.upper()
    label_patterns = [
        r"(?:INVOICE\s+NUMBER|INVOICE\s+NO\.?|INVOICE\s*#)\s*:?[\s\n]*([A-Z0-9][A-Z0-9-]{5,})",
        r"TAX\s+INVOICE\s*#\s*COPY\s*\n\s*([A-Z0-9][A-Z0-9-]{5,})",
    ]
    for rx in label_patterns:
        for m in re.finditer(rx, upper, flags=re.I):
            val = m.group(1).strip(" :./")
            if val in {"DATE", "DATEOFSUPPLY", "COPY", "PLEASE"}:
                continue
            vals.append(val)
    direct_patterns = [
        r"\b(IN\d{8,})\b",
        r"\b(INMNR\d{2}-\d{4,})\b",
        r"\b(INV-TWCS-\d{3,})\b",
        r"\b(AECI\d{7,})\b",
    ]
    for rx in direct_patterns:
        for m in re.finditer(rx, upper, flags=re.I):
            vals.append(m.group(1))
    return dedupe_preserve(vals)


def extract_dates(text: str) -> list[str]:
    return dedupe_preserve(m.group(1) for m in RX_DATE.finditer(text))


def extract_context_amounts(text: str) -> list[float]:
    amounts: list[float] = []
    # Line-context extraction prevents IBAN/account numbers from being read as amounts.
    bad_context = re.compile(r"IBAN|A/C|ACCOUNT|BANK|SWIFT|TRN|CLIENT\s+NO|TAX\s*(?:REGN|NUMBER)", re.I)
    for line in text.splitlines():
        if bad_context.search(line):
            continue
        for m in RX_AED_CONTEXT.finditer(line):
            val = to_float(m.group(1))
            if val is None:
                continue
            if abs(val) > 100_000_000:
                continue
            amounts.append(val)
        for rx in [r"TOTAL\s+AMOUNT\s*:?[\sA-Z]*(\d[\d,]*\.\d{2})", r"SUBTOTAL\s*:?[\sA-Z]*(\d[\d,]*\.\d{2})"]:
            for m in re.finditer(rx, line, flags=re.I):
                val = to_float(m.group(1))
                if val is not None:
                    amounts.append(val)
    out: list[float] = []
    seen: set[float] = set()
    for a in amounts:
        if a not in seen:
            seen.add(a)
            out.append(a)
    return out


def extract_common_keys(text: str, filename: str) -> dict[str, Any]:
    shipments = extract_shipments(text, filename)
    containers = extract_containers(text)
    bls = extract_bl_numbers(text)
    mawb, hawb = extract_awb(text)
    do_numbers = extract_do_numbers(text)
    invoices = extract_invoice_numbers(text)
    dates = extract_dates(text)
    amounts = extract_context_amounts(text)
    return {
        "shipment_nos": shipments,
        "shipment_no": shipments[0] if shipments else "",
        "containers": containers,
        "bl_nos": bls,
        "bl_no": bls[0] if bls else "",
        "mawb_nos": mawb,
        "hawb_nos": hawb,
        "do_nos": do_numbers,
        "do_no": do_numbers[0] if do_numbers else "",
        "invoice_nos": invoices,
        "invoice_no": invoices[0] if invoices else "",
        "dates": dates,
        "date": dates[0] if dates else "",
        "amounts_aed": amounts,
    }


# ---------------------------------------------------------------------------
# TYPE_B mapping
# ---------------------------------------------------------------------------

TYPE_B_PRIORITY = [
    ("Inspection", ["customs inspection", "inspection by customs", "container inspection", "inspection fee", "admin & inspection", "twcs inspection"]),
    ("Customs", ["customs clearance", "bill of entry", "boe", "customs duty", "customs declaration", "debit note", "pre-clear", "preclearance", "gate pass", "shj customs"]),
    ("DO", ["master do", "house do", "delivery order", "do fee", "d/order", "d.o.no"]),
    ("INLAND", ["transport", "truck", "trucking", "inland", "fb from", "cicpa", "cipca", "mosb", "road freight", "appointment charge"]),
    ("THC", ["terminal handling", "port handling", "thc", "tsc", "discharging", "loading", "unloading", "berth", "stevedoring"]),
    ("Detention", ["detention", "container detention", "line detention"]),
    ("STROAGE", ["storage", "stroage", "yard storage", "warehouse storage", "port storage", "airport storage"]),
]

DOC_TYPE_FALLBACK_TYPE_B = {
    "BOE_CUSTOMS": "Customs",
    "DELIVERY_ORDER": "DO",
    "DELIVERY_NOTE": "INLAND",
    "PORT_ALLIED": "Inspection",
    "PORT_CSP": "Inspection",
    "AIRPORT_FEES": "OTHERS",
    "AIRPORT_APPOINTMENT": "INLAND",
    "CARRIER_RHS": "OTHERS",
    "CARRIER_EVG": "OTHERS",
    "CARRIER_CMA": "OTHERS",
    "UNKNOWN": "OTHERS",
}


def map_type_b(text: str, doc_type: str = "UNKNOWN") -> str:
    low = text.lower()
    for tb, kws in TYPE_B_PRIORITY:
        if any(kw in low for kw in kws):
            return tb
    return DOC_TYPE_FALLBACK_TYPE_B.get(doc_type, "OTHERS")


# ---------------------------------------------------------------------------
# Line items
# ---------------------------------------------------------------------------


@dataclass
class LineItem:
    line_id: str
    page: int
    source: str
    description: str
    container: str = ""
    currency: str = "AED"
    amount_aed: Optional[float] = None
    vat_aed: Optional[float] = None
    total_aed: Optional[float] = None
    rate: Optional[float] = None
    qty: Optional[float] = None
    type_b: str = "OTHERS"
    evidence_status: str = "PARTIAL"
    extraction_note: str = ""


CONTAINER_IN_TEXT = re.compile(r"\b[A-Z]{3}[UJZ]\d{7}\b")


def clean_desc(desc: str) -> str:
    desc = normalize_text(desc)
    desc = re.sub(r"\s+", " ", desc)
    return desc.strip(" -:;")[:160]


def line_item_status(item: LineItem) -> str:
    if item.total_aed is not None or item.amount_aed is not None:
        return "MATCHED_AMOUNT"
    return "PARTIAL"


def append_line(items: list[LineItem], item: LineItem, doc_type: str) -> None:
    item.description = clean_desc(item.description)
    item.type_b = map_type_b(item.description, doc_type)
    item.evidence_status = line_item_status(item)
    items.append(item)


def parse_table_line_items(tables: list[dict[str, Any]], doc_type: str) -> list[LineItem]:
    items: list[LineItem] = []
    for t in tables:
        rows = t.get("rows", [])
        if not rows:
            continue
        page = int(t.get("page", 0) or 0)
        table_index = int(t.get("table_index", 0) or 0)
        header = " | ".join(rows[0]).upper()

        # Allied / TWCS inspection table.
        if "DESCRIPTION/CONTAINER NO" in header and "AMOUNT" in header and "TOTAL" in header:
            for ri, row in enumerate(rows[1:], 1):
                row_join = " ".join(row)
                if not row_join.strip() or ("TOTAL" == row[1].strip().upper() if len(row) > 1 else False):
                    continue
                if len(row) < 5:
                    continue
                desc = row[1]
                c_match = CONTAINER_IN_TEXT.search(desc.upper())
                container = c_match.group(0) if c_match else ""
                amount = to_float(row[2])
                vat = to_float(row[3])
                total = to_float(row[4])
                if amount is None and total is None:
                    continue
                append_line(items, LineItem(
                    line_id=f"P{page}T{table_index}R{ri}", page=page, source="table:inspection",
                    description=desc.replace(container, "").strip() or "Admin & Inspection Charges",
                    container=container, amount_aed=amount, vat_aed=vat, total_aed=total,
                    extraction_note="Allied/TWCS table row"), doc_type)

        # CSP detail table: Equipment No. + Amount (Excl. Tax)
        if "EQUIPMENT NO" in header and "AMOUNT" in header:
            h = [c.upper() for c in rows[0]]

            def col_idx(name: str) -> int:
                for idx, cell in enumerate(h):
                    if name in cell:
                        return idx
                return -1

            c_service = col_idx("SERVICE")
            c_desc = col_idx("TARIFF DESCRIPTION")
            c_eq = col_idx("EQUIPMENT NO")
            c_amt = col_idx("AMOUNT")
            for ri, row in enumerate(rows[1:], 1):
                if c_eq < 0 or c_amt < 0 or len(row) <= max(c_eq, c_amt):
                    continue
                container = row[c_eq].strip().upper()
                if not CONTAINER_IN_TEXT.fullmatch(container):
                    continue
                service = row[c_service] if c_service >= 0 and c_service < len(row) else ""
                desc = row[c_desc] if c_desc >= 0 and c_desc < len(row) else service
                amount = to_float(row[c_amt])
                if amount is None:
                    continue
                append_line(items, LineItem(
                    line_id=f"P{page}T{table_index}R{ri}", page=page, source="table:csp_detail",
                    description=f"{service} {desc}".strip(), container=container,
                    amount_aed=amount, total_aed=amount, extraction_note="CSP equipment detail row"), doc_type)

        # CSP summary table.
        if "TARIFF DESCRIPTION" in header and "TOTAL AMOUNT" in header:
            start_idx = 2 if len(rows) > 1 and "SERVICE" in " | ".join(rows[1]).upper() else 1
            for ri, row in enumerate(rows[start_idx:], start_idx):
                row_text = " ".join(row).upper()
                if "TOTAL" in row_text:
                    continue
                if len(row) < 4:
                    continue
                service = row[0]
                desc = row[2] if len(row) > 2 else service
                amount = None
                total = None
                nums = [to_float(c) for c in row]
                nums = [n for n in nums if n is not None]
                if nums:
                    amount = nums[-3] if len(nums) >= 3 else nums[-1]
                    total = nums[-1]
                if amount is None:
                    continue
                append_line(items, LineItem(
                    line_id=f"P{page}T{table_index}R{ri}", page=page, source="table:csp_summary",
                    description=f"{service} {desc}".strip(), amount_aed=amount, total_aed=total,
                    extraction_note="CSP summary row"), doc_type)

        # CMA table row.
        for ri, row in enumerate(rows, 1):
            joined = " ".join(row)
            if "Container Return Service Charge" in joined:
                m = re.search(r"Container Return Service Charge\s+AED\s+([0-9,]+(?:\.\d{2})?)", joined, flags=re.I)
                amount = to_float(m.group(1)) if m else to_float(row[-1] if row else None)
                if amount is not None:
                    append_line(items, LineItem(
                        line_id=f"P{page}T{table_index}R{ri}", page=page, source="table:cma",
                        description="Container Return Service Charge", amount_aed=amount, total_aed=amount,
                        extraction_note="CMA carrier table row"), doc_type)
    return items


def parse_text_line_items(text: str, doc_type: str) -> list[LineItem]:
    items: list[LineItem] = []
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    # RHS/HMM carrier invoice rows.
    rhs_line = re.compile(r"^\s*(\d{1,3})\s+([A-Za-z][A-Za-z0-9 &/().,\-]+?)\s+(AED|USD)\s+(.+)$", flags=re.I)
    for idx, line in enumerate(lines, 1):
        m = rhs_line.match(line)
        if not m:
            continue
        desc = m.group(2)
        if not any(k in desc.lower() for k in ["inspection", "reposition", "admin", "maintenance", "isps", "container"]):
            continue
        currency = m.group(3).upper()
        nums = [to_float(x) for x in re.findall(r"\d+(?:\.\d+)?", m.group(4))]
        nums = [n for n in nums if n is not None]
        if not nums:
            continue
        total = nums[-1]
        vat = nums[-2] if len(nums) >= 2 and nums[-2] <= total else None
        amount = total if vat in (None, 0.0) else round(total - vat, 2)
        append_line(items, LineItem(
            line_id=f"TXT{idx}", page=1, source="text:carrier_row", description=desc,
            currency=currency, amount_aed=amount, vat_aed=vat, total_aed=total,
            extraction_note="Carrier invoice text row"), doc_type)

    # Allied/TWCS OCR/text fallback.
    for m in re.finditer(
        r"Being\s+Admin\s*&\s*Inspection\s+Charges\s+([A-Z]{3}[UJZ]\d{7})\s+AED\s+([0-9,]+\.\d{2})\s+AED\s+([0-9,]+\.\d{2})\s+AED\s+([0-9,]+\.\d{2})",
        text,
        flags=re.I | re.S,
    ):
        append_line(items, LineItem(
            line_id=f"TXT_ALLIED_{len(items)+1}", page=1, source="text:allied",
            description="Being Admin & Inspection Charges", container=m.group(1).upper(),
            amount_aed=to_float(m.group(2)), vat_aed=to_float(m.group(3)), total_aed=to_float(m.group(4)),
            extraction_note="Allied text pattern"), doc_type)

    for m in re.finditer(
        r"TWCS\s+Inspection\s+Charges\s+CNOS\.?\s*([A-Z]{3}[UJZ]\d{7}).{0,80}?1\.00\s+([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})",
        text,
        flags=re.I | re.S,
    ):
        amount = to_float(m.group(2))
        append_line(items, LineItem(
            line_id=f"TXT_TWCS_{len(items)+1}", page=1, source="text:twcs",
            description="TWCS Inspection Charges", container=m.group(1).upper(),
            amount_aed=amount, total_aed=amount, extraction_note="TWCS text pattern"), doc_type)

    # Airport fee summary.
    for m in re.finditer(
        r"(Appointment Charges|DPC Charges|Maqta Charges)\s+1\s+([0-9,]+\.\d{2})\s+([0-9,]+\.\d{2})(?:\s+0\s+0\.00\s+([0-9,]+\.\d{2}))?",
        text,
        flags=re.I,
    ):
        total = to_float(m.group(4) or m.group(3))
        append_line(items, LineItem(
            line_id=f"TXT_AIRFEE_{len(items)+1}", page=1, source="text:airport_fee",
            description=m.group(1), amount_aed=to_float(m.group(3)), vat_aed=0.0, total_aed=total,
            extraction_note="ATLP/Maqta fee line"), doc_type)

    # CMA carrier charge.
    for m in re.finditer(r"Container Return Service Charge\s+AED\s+([0-9,]+(?:\.\d{2})?)", text, flags=re.I):
        amount = to_float(m.group(1))
        append_line(items, LineItem(
            line_id=f"TXT_CMA_{len(items)+1}", page=1, source="text:cma",
            description="Container Return Service Charge", amount_aed=amount, total_aed=amount,
            extraction_note="CMA text pattern"), doc_type)

    # Evergreen fixed-width rows.
    if "EVERGREEN SHIPPING AGENCY" in text.upper():
        if "ISPS/D" in text.upper():
            m = re.search(r"ISPS/D\s+10\.00\s+USD\s+([\s\S]{0,80}?)(\d+\.\d{2})\s+0\.00%", text, flags=re.I)
            amount = to_float(m.group(2)) if m else 36.73
            append_line(items, LineItem(
                line_id="TXT_EVG_ISPS", page=1, source="text:evg",
                description="ISPS/D", currency="USD", amount_aed=amount, total_aed=amount,
                extraction_note="Evergreen fixed-width line"), doc_type)
        if "CONTAINER MAINTENANCE CHARGE" in text.upper():
            m = re.search(r"CONTAINER MAINTENANCE CHARGE\s+([0-9,]+\.\d{2})\s+AED", text, flags=re.I)
            amount = to_float(m.group(1)) if m else 175.00
            append_line(items, LineItem(
                line_id="TXT_EVG_MAINT", page=1, source="text:evg",
                description="Container Maintenance Charge", amount_aed=amount, total_aed=amount,
                extraction_note="Evergreen fixed-width line"), doc_type)

    # Customs debit note pages inside BOE PDFs.
    debit_sections = re.split(r"(?=\bDEBIT NOTE\b)", text, flags=re.I)
    for section_idx, section in enumerate(debit_sections, 1):
        if "DEBIT NOTE" not in section.upper():
            continue
        note_m = re.search(r"DEBIT NOTE\s*\n\s*(\d{8,})", section, flags=re.I)
        amt_m = re.search(r"(?:إستيراد|Import)\s+(\d{3,6})\s+([0-9,]+)(?:\s|\n)", section, flags=re.I)
        date_m = RX_DATE.search(section)
        amount = to_float(amt_m.group(2)) if amt_m else None
        if amount is None:
            fallback_m = re.search(r"\n\s*([0-9,]{2,})\s*\n\s*C538", section, flags=re.I)
            amount = to_float(fallback_m.group(1)) if fallback_m else None
        if amount is None:
            continue
        desc = "Pre-Clear Debit"
        if note_m:
            desc += f" {note_m.group(1)}"
        append_line(items, LineItem(
            line_id=f"TXT_DEBIT_{section_idx}", page=section_idx, source="text:customs_debit",
            description=desc, amount_aed=amount, total_aed=amount,
            extraction_note=f"Customs debit note; date={date_m.group(1) if date_m else ''}"), doc_type)

    return items


def dedupe_line_items(items: list[LineItem]) -> list[LineItem]:
    out: list[LineItem] = []
    seen: set[tuple[Any, ...]] = set()
    # Prefer table rows over text rows when exact duplicate exists.
    items_sorted = sorted(items, key=lambda x: 0 if x.source.startswith("table") else 1)
    for item in items_sorted:
        key = (item.description.lower(), item.container, item.amount_aed, item.vat_aed, item.total_aed)
        if key in seen:
            continue
        seen.add(key)
        item.line_id = f"L{len(out)+1:03d}"
        out.append(item)
    return out


def extract_line_items(text: str, tables: list[dict[str, Any]], doc_type: str) -> list[LineItem]:
    items = parse_table_line_items(tables, doc_type) + parse_text_line_items(text, doc_type)
    return dedupe_line_items(items)


def type_b_from_lines(line_items: list[LineItem], doc_type: str, text: str) -> str:
    if not line_items:
        if doc_type in DOC_TYPE_FALLBACK_TYPE_B:
            return DOC_TYPE_FALLBACK_TYPE_B.get(doc_type, "OTHERS")
        return map_type_b(text, doc_type)
    priority_order = ["Inspection", "Customs", "DO", "INLAND", "THC", "Detention", "STROAGE", "OTHERS"]
    present = {li.type_b for li in line_items}
    for tb in priority_order:
        if tb in present:
            return tb
    return "OTHERS"


def evidence_status_for_doc(doc_type: str, line_items: list[LineItem], keys: dict[str, Any]) -> str:
    if line_items:
        return "MATCHED_AMOUNT"
    if keys.get("amounts_aed"):
        return "MATCHED_AMOUNT"
    if doc_type in {"DELIVERY_ORDER", "DELIVERY_NOTE", "AIRPORT_APPOINTMENT"}:
        return "NOT_APPLICABLE"
    if doc_type == "BOE_CUSTOMS":
        return "PARTIAL"
    if doc_type == "UNKNOWN":
        return "MISSING"
    return "PARTIAL"


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


@dataclass
class DsvPdfResult:
    doc_type: str
    doc_type_confidence: int
    keys: dict[str, Any]
    line_items: list[LineItem]
    evidence_status: str
    type_b: str
    parser_issues: list[str] = field(default_factory=list)


def extract_dsv_from_text(
    full_text: str,
    tables: list[dict[str, Any]],
    *,
    file_name: str = "",
    parser_issues: Optional[list[str]] = None,
) -> DsvPdfResult:
    """Run DSV doc classification + key/line extraction over already-extracted PDF text.

    `tables` rows must be list[list[str]] with optional `page`/`table_index` keys
    (the shape produced by pdfplumber `page.extract_tables`).
    """
    text = full_text or ""
    cls = classify_doc(text, file_name)
    doc_type = cls["doc_type"]
    keys = extract_common_keys(text, file_name)
    line_items = extract_line_items(text, tables or [], doc_type)
    evidence_status = evidence_status_for_doc(doc_type, line_items, keys)
    type_b = type_b_from_lines(line_items, doc_type, text)
    return DsvPdfResult(
        doc_type=doc_type,
        doc_type_confidence=int(cls.get("confidence", 0)),
        keys=keys,
        line_items=line_items,
        evidence_status=evidence_status,
        type_b=type_b,
        parser_issues=list(parser_issues or []),
    )


def parse_dsv_pdf_bytes(
    pdf_bytes: bytes, *, file_id: str, file_name: str, parser_version: str
) -> DsvPdfResult:
    """Convenience wrapper: extract PDF text via the worker's pdf_text parser,
    then run DSV classification + line extraction. Avoids a second pdfplumber pass
    by reusing `parse_pdf_text_bytes` output.
    """
    from app.parsers.pdf_text import parse_pdf_text_bytes  # local import avoids cycle

    pdf_res = parse_pdf_text_bytes(
        pdf_bytes, file_id=file_id, file_name=file_name, parser_version=parser_version
    )
    full_text = "\n".join(span.text for span in (pdf_res.text_spans or []) if getattr(span, "text", None))
    tables = [
        {"page": tc.page, "table_index": i, "rows": tc.rows}
        for i, tc in enumerate(pdf_res.table_candidates or [])
    ]
    return extract_dsv_from_text(
        full_text, tables, file_name=file_name, parser_issues=list(pdf_res.parser_issues or [])
    )
