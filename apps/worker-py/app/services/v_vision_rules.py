"""DSV invoice parsing rules for Google Vision OCR text.

This module is intentionally text-first. Google Vision produces OCR text and
confidence; these rules convert that OCR text into document type, join keys,
charge lines, evidence candidates, and an AMBER/PASS parser gate.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Optional

PARSER_VERSION = "vision-rules-0.1.0"

FF = "\ufffe"
NBSP = "\u00a0"


def normalize_text(text: str) -> str:
    """Normalize OCR/PDF extraction artifacts while preserving line breaks."""
    if not text:
        return ""
    text = text.replace(FF, "-").replace(NBSP, " ")
    text = text.replace("\u200b", "").replace("\u200e", "").replace("\u200f", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def norm_for_match(text: str) -> str:
    t = normalize_text(text).upper()
    return re.sub(r"[\s\-_/.:#]+", " ", t)


def sha256_short(data: bytes | str, n: int = 16) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8", errors="ignore")
    return hashlib.sha256(data).hexdigest()[:n]


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    s = str(value).strip().replace(",", "")
    if not s:
        return None
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
    for item in items:
        value = str(item).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


@dataclass(frozen=True)
class DocRule:
    doc_type: str
    all_terms: tuple[str, ...] = ()
    any_terms: tuple[str, ...] = ()
    confidence: int = 80
    note: str = ""


DOC_TYPE_RULES: list[DocRule] = [
    DocRule("PORT_CSP", all_terms=("CSP ABU DHABI TERMINAL",), any_terms=("PACKAGE INVOICE", "INMNR"), confidence=98),
    DocRule("PORT_ALLIED", any_terms=("ALLIED ONDOCK", "TRANS WORLD CONTAINER SERVICES", "TWCS INSPECTION"), confidence=98),
    DocRule("AIRPORT_FEES", all_terms=("CHARGES SUMMARY",), any_terms=("MAQTA CHARGES", "ETIHAD TERMINAL CHARGES", "DPC CHARGES"), confidence=96),
    DocRule("AIRPORT_APPOINTMENT", all_terms=("IMPORT APPOINTMENT SUMMARY",), confidence=96),
    DocRule("BOE_CUSTOMS", any_terms=("CUSTOMS DECLARATION", "PRE CLEAR BILL", "PRE-CLEAR BILL", "DEBIT NOTE", "GATE PASS", "LAND IMPORT"), confidence=95),
    DocRule("DELIVERY_ORDER", any_terms=("DELIVERY ORDER", "DELIVERY NOTIFICATION", "D O NO", "D.O.NO", "D.O. NUMBER"), confidence=92),
    DocRule("DELIVERY_NOTE", any_terms=("NOT NEGOTIABLE DELIVERY NOTE", "DELIVERY NOTE WAYBILL", "CONSIGNMENT NOTE", "ROAD FREIGHT"), confidence=90),
    DocRule("CARRIER_CMA", all_terms=("CMA CGM SHIPPING AGENCY",), any_terms=("TAX INVOICE", "INVOICE"), confidence=95),
    DocRule("CARRIER_RHS", all_terms=("RAIS HASSAN SAADI",), any_terms=("TAX INVOICE",), confidence=95),
    DocRule("CARRIER_EVG", all_terms=("EVERGREEN SHIPPING AGENCY",), any_terms=("TAX INVOICE", "INVOICE"), confidence=95),
]


def classify_doc(text: str, filename: str = "") -> dict[str, Any]:
    hay = norm_for_match(text + "\n" + filename)
    for rule in DOC_TYPE_RULES:
        all_ok = all(norm_for_match(term) in hay for term in rule.all_terms)
        any_ok = not rule.any_terms or any(norm_for_match(term) in hay for term in rule.any_terms)
        if all_ok and any_ok:
            matched = list(rule.all_terms) + [term for term in rule.any_terms if norm_for_match(term) in hay]
            return {
                "doc_type": rule.doc_type,
                "confidence": rule.confidence,
                "matched": matched[:5],
                "rule_note": rule.note,
            }
    return {"doc_type": "UNKNOWN", "confidence": 0, "matched": [], "rule_note": "No header fingerprint matched"}


RX_SHIP_TEXT = re.compile(r"HVDC[\s\-_/]*ADOPT[\s\-_/]*(SCT|HE)[\s\-_/]*(\d{4})", re.I)
RX_SHIP_FILE = re.compile(r"HVDC[\s\-_/]*ADOPT[\s\-_/]*(SCT|HE)[\s\-_/]*([0-9]{4}(?:\s*,\s*[0-9]{4})*)", re.I)
RX_CONTAINER_CANDIDATE = re.compile(r"\b([A-Z]{3}[UJZ])\s?(\d{6})-?(\d)\b")
RX_AWB = re.compile(r"\b(\d{3})-?(\d{8})\b")
RX_HAWB = re.compile(r"\b(ELA\d{7})\b", re.I)
MONTH_PATTERN = r"(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)"
RX_DATE = re.compile(rf"\b(\d{{1,2}}/\d{{1,2}}/\d{{4}}|\d{{1,2}}-(?:{MONTH_PATTERN})-\d{{2,4}}|\d{{4}}-\d{{2}}-\d{{2}}|\d{{1,2}}[ \t]+(?:{MONTH_PATTERN})[ \t]+\d{{2,4}})\b", re.I)
RX_AED_CONTEXT = re.compile(r"\bAED\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?|[0-9]+(?:\.\d{2})?)\b", re.I)

ISO6346_VALUES: dict[str, int] = {}
_iso_value = 10
for _ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    ISO6346_VALUES[_ch] = _iso_value
    _iso_value += 1
    if _iso_value in (11, 22, 33):
        _iso_value += 1


def iso6346_valid(container: str) -> bool:
    c = re.sub(r"[^A-Z0-9]", "", container.upper())
    if not re.match(r"^[A-Z]{3}[UJZ]\d{7}$", c):
        return False
    total = 0
    for idx, ch in enumerate(c[:10]):
        value = ISO6346_VALUES.get(ch) if ch.isalpha() else int(ch)
        if value is None:
            return False
        total += value * (2**idx)
    return (total % 11) % 10 == int(c[-1])


def extract_shipments(text: str, filename: str = "") -> list[str]:
    vals: list[str] = []
    for m in RX_SHIP_TEXT.finditer(normalize_text(text)):
        vals.append(f"HVDC-ADOPT-{m.group(1).upper()}-{m.group(2)}")
    for m in RX_SHIP_FILE.finditer(filename):
        series = m.group(1).upper()
        for number in re.split(r"\s*,\s*", m.group(2)):
            if re.match(r"^\d{4}$", number):
                vals.append(f"HVDC-ADOPT-{series}-{number}")
    return dedupe_preserve(vals)


def extract_containers(text: str) -> list[str]:
    vals: list[str] = []
    fallback: list[str] = []
    for m in RX_CONTAINER_CANDIDATE.finditer(text.upper()):
        container = f"{m.group(1)}{m.group(2)}{m.group(3)}"
        if iso6346_valid(container):
            vals.append(container)
        else:
            fallback.append(container)
    return dedupe_preserve(vals or fallback)


def extract_bl_numbers(text: str) -> list[str]:
    vals: list[str] = []
    patterns = [
        r"(?:B/L\s*NR\.?|B/L\s*NUMBER|B/L-AWB\s*NO\.?|BOL\s*#|BOL\s*NO|BILL\s+OF\s+LADING|MBL\s*NO\.?|MB/L\s*NO)\s*:?[\s\n]*([A-Z0-9]{8,24})",
        r"\b(SELA[A-Z0-9]{8,}|EGLV[A-Z0-9]{8,}|CHN\d{7,}|MEDUUX\d{6,}|MEDU[A-Z0-9]{7,})\b",
    ]
    upper = text.upper()
    for rx in patterns:
        for m in re.finditer(rx, upper, re.I):
            val = m.group(1).strip(" /\\")
            if RX_CONTAINER_CANDIDATE.match(val):
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
    for m in re.finditer(r"(?:MAWB#?|AWB#?|B/L-AWB\s*NO\.?)\s*:?[\s\n]*(\d{3})-?(\d{8})", text, re.I):
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
        for m in re.finditer(rx, upper, re.I):
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
        for m in re.finditer(rx, upper, re.I):
            val = m.group(1).strip(" :./")
            if val not in {"DATE", "DATEOFSUPPLY", "COPY", "PLEASE"}:
                vals.append(val)
    for rx in [r"\b(IN\d{8,})\b", r"\b(INMNR\d{2}-\d{4,})\b", r"\b(INV-TWCS-\d{3,})\b", r"\b(AECI\d{7,})\b"]:
        for m in re.finditer(rx, upper, re.I):
            vals.append(m.group(1))
    return dedupe_preserve(vals)


def extract_dates(text: str) -> list[str]:
    return dedupe_preserve(m.group(1) for m in RX_DATE.finditer(text))


def extract_context_amounts(text: str) -> list[float]:
    amounts: list[float] = []
    bad_context = re.compile(r"IBAN|A/C|ACCOUNT|BANK|SWIFT|TRN|CLIENT\s+NO|TAX\s*(?:REGN|NUMBER)", re.I)
    for line in text.splitlines():
        if bad_context.search(line):
            continue
        for m in RX_AED_CONTEXT.finditer(line):
            val = to_float(m.group(1))
            if val is not None and abs(val) <= 100_000_000:
                amounts.append(val)
        for rx in [r"TOTAL\s+AMOUNT\s*:?[\sA-Z]*(\d[\d,]*\.\d{2})", r"SUBTOTAL\s*:?[\sA-Z]*(\d[\d,]*\.\d{2})"]:
            for m in re.finditer(rx, line, re.I):
                val = to_float(m.group(1))
                if val is not None:
                    amounts.append(val)
    out: list[float] = []
    seen: set[float] = set()
    for amount in amounts:
        if amount in seen:
            continue
        seen.add(amount)
        out.append(amount)
    return out


def extract_common_keys(text: str, filename: str = "") -> dict[str, Any]:
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
    for type_b, keywords in TYPE_B_PRIORITY:
        if any(keyword in low for keyword in keywords):
            return type_b
    return DOC_TYPE_FALLBACK_TYPE_B.get(doc_type, "OTHERS")


@dataclass
class VisionLineItem:
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


def clean_desc(desc: str) -> str:
    desc = normalize_text(desc)
    desc = re.sub(r"\s+", " ", desc)
    return desc.strip(" -:;")[:160]


def line_item_status(item: VisionLineItem) -> str:
    if item.total_aed is not None or item.amount_aed is not None:
        return "MATCHED_AMOUNT"
    return "PARTIAL"


def append_line(items: list[VisionLineItem], item: VisionLineItem, doc_type: str) -> None:
    item.description = clean_desc(item.description)
    item.type_b = map_type_b(item.description, doc_type)
    item.evidence_status = line_item_status(item)
    items.append(item)


def parse_text_line_items(text: str, doc_type: str) -> list[VisionLineItem]:
    items: list[VisionLineItem] = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    rhs_line = re.compile(r"^\s*(\d{1,3})\s+([A-Za-z][A-Za-z0-9 &/().,\-]+?)\s+(AED|USD)\s+(.+)$", re.I)
    for idx, line in enumerate(lines, 1):
        m = rhs_line.match(line)
        if not m:
            continue
        desc = m.group(2)
        if not any(keyword in desc.lower() for keyword in ["inspection", "reposition", "admin", "maintenance", "isps", "container"]):
            continue
        nums = [to_float(x) for x in re.findall(r"\d+(?:\.\d+)?", m.group(4))]
        nums = [n for n in nums if n is not None]
        if not nums:
            continue
        total = nums[-1]
        vat = nums[-2] if len(nums) >= 2 and nums[-2] <= total else None
        amount = total if vat in (None, 0.0) else round(total - vat, 2)
        append_line(
            items,
            VisionLineItem(
                line_id=f"TXT{idx}",
                page=1,
                source="text:carrier_row",
                description=desc,
                currency=m.group(3).upper(),
                amount_aed=amount,
                vat_aed=vat,
                total_aed=total,
                extraction_note="Carrier invoice text row",
            ),
            doc_type,
        )

    for m in re.finditer(
        r"Being\s+Admin\s*&\s*Inspection\s+Charges\s+([A-Z]{3}[UJZ]\d{7})\s+AED\s+([0-9,]+\.\d{2})\s+AED\s+([0-9,]+\.\d{2})\s+AED\s+([0-9,]+\.\d{2})",
        text,
        re.I | re.S,
    ):
        append_line(
            items,
            VisionLineItem(
                line_id=f"TXT_ALLIED_{len(items)+1}",
                page=1,
                source="text:allied",
                description="Being Admin & Inspection Charges",
                container=m.group(1).upper(),
                amount_aed=to_float(m.group(2)),
                vat_aed=to_float(m.group(3)),
                total_aed=to_float(m.group(4)),
                extraction_note="Allied text pattern",
            ),
            doc_type,
        )

    for m in re.finditer(r"Container Return Service Charge\s+AED\s+([0-9,]+(?:\.\d{2})?)", text, re.I):
        amount = to_float(m.group(1))
        append_line(
            items,
            VisionLineItem(
                line_id=f"TXT_CMA_{len(items)+1}",
                page=1,
                source="text:cma",
                description="Container Return Service Charge",
                amount_aed=amount,
                total_aed=amount,
                extraction_note="CMA text pattern",
            ),
            doc_type,
        )

    if "EVERGREEN SHIPPING AGENCY" in text.upper():
        for desc, rx in [
            ("ISPS/D", r"ISPS/D\s+10\.00\s+USD\s+[\s\S]{0,80}?(\d+\.\d{2})\s+0\.00%"),
            ("Container Maintenance Charge", r"CONTAINER MAINTENANCE CHARGE\s+([0-9,]+\.\d{2})\s+AED"),
        ]:
            m = re.search(rx, text, re.I)
            if m:
                amount = to_float(m.group(1))
                append_line(
                    items,
                    VisionLineItem(
                        line_id=f"TXT_EVG_{len(items)+1}",
                        page=1,
                        source="text:evg",
                        description=desc,
                        currency="USD" if desc == "ISPS/D" else "AED",
                        amount_aed=amount,
                        total_aed=amount,
                        extraction_note="Evergreen fixed-width line",
                    ),
                    doc_type,
                )

    debit_sections = re.split(r"(?=\bDEBIT NOTE\b)", text, flags=re.I)
    for section_idx, section in enumerate(debit_sections, 1):
        if "DEBIT NOTE" not in section.upper():
            continue
        amt_m = re.search(r"(?:Import)\s+(\d{3,6})\s+([0-9,]+)(?:\s|\n)", section, re.I)
        amount = to_float(amt_m.group(2)) if amt_m else None
        if amount is None:
            continue
        append_line(
            items,
            VisionLineItem(
                line_id=f"TXT_DEBIT_{section_idx}",
                page=section_idx,
                source="text:customs_debit",
                description="Pre-Clear Debit",
                amount_aed=amount,
                total_aed=amount,
                extraction_note="Customs debit note",
            ),
            doc_type,
        )

    return items


def dedupe_line_items(items: list[VisionLineItem]) -> list[VisionLineItem]:
    out: list[VisionLineItem] = []
    seen: set[tuple[Any, ...]] = set()
    for item in items:
        key = (item.description.lower(), item.container, item.amount_aed, item.vat_aed, item.total_aed)
        if key in seen:
            continue
        seen.add(key)
        item.line_id = f"L{len(out)+1:03d}"
        out.append(item)
    return out


def extract_line_items(text: str, doc_type: str) -> list[dict[str, Any]]:
    return [asdict(item) for item in dedupe_line_items(parse_text_line_items(text, doc_type))]


def type_b_from_lines(line_items: list[dict[str, Any]], doc_type: str, text: str) -> str:
    if not line_items:
        return DOC_TYPE_FALLBACK_TYPE_B.get(doc_type, map_type_b(text, doc_type))
    priority_order = ["Inspection", "Customs", "DO", "INLAND", "THC", "Detention", "STROAGE", "OTHERS"]
    present = {line.get("type_b", "OTHERS") for line in line_items}
    for type_b in priority_order:
        if type_b in present:
            return type_b
    return "OTHERS"


def evidence_status_for_doc(doc_type: str, line_items: list[dict[str, Any]], keys: dict[str, Any]) -> str:
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


def gate_verdict(
    doc_type: str,
    keys: dict[str, Any],
    line_items: list[dict[str, Any]],
    confidence: float,
    text_len: int,
) -> tuple[str, list[dict[str, str]]]:
    issues: list[dict[str, str]] = []
    if doc_type == "UNKNOWN":
        issues.append({"severity": "AMBER", "code": "UNKNOWN_DOCTYPE", "detail": "Header fingerprint not matched"})
    if confidence < 0.6:
        issues.append({"severity": "AMBER", "code": "VISION_LOW_CONFIDENCE", "detail": "Vision OCR confidence below parser threshold"})
    if text_len < 80:
        issues.append({"severity": "AMBER", "code": "LOW_TEXT_LENGTH", "detail": "OCR text layer weak or absent"})
    if doc_type == "BOE_CUSTOMS":
        issues.append({"severity": "AMBER", "code": "CUSTOMS_FINAL_REVIEW_REQUIRED", "detail": "Customs evidence is review-only"})
    invoice_like = doc_type in {"CARRIER_RHS", "CARRIER_EVG", "CARRIER_CMA", "PORT_ALLIED", "PORT_CSP", "AIRPORT_FEES"}
    if invoice_like and not line_items and not keys.get("amounts_aed"):
        issues.append({"severity": "AMBER", "code": "INVOICE_AMOUNT_MISSING", "detail": "No line amount or context AED amount extracted"})
    if not keys.get("shipment_nos"):
        issues.append({"severity": "AMBER", "code": "NO_SHIPMENT_NO", "detail": "Shipment number missing in text/filename"})
    if any(issue["severity"] == "ZERO" for issue in issues):
        return "ZERO", issues
    if issues:
        return "AMBER", issues
    return "PASS", issues


def build_evidence_candidates(file_id: str, keys: dict[str, Any], confidence: float) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    mapping = {
        "shipment_nos": "HVDC",
        "containers": "CONTAINER",
        "bl_nos": "BL",
        "mawb_nos": "MAWB",
        "hawb_nos": "HAWB",
        "do_nos": "DO",
        "invoice_nos": "INVOICE_NO",
    }
    for key, doc_kind in mapping.items():
        for value in keys.get(key, [])[:20]:
            candidates.append(
                {
                    "source_file_id": file_id,
                    "source_engine": "google_vision",
                    "text_span": f"vision:{doc_kind}:sha256:{sha256_short(value)}",
                    "matched_reference": value,
                    "confidence": max(0.0, min(1.0, confidence)),
                    "doc_kind": doc_kind,
                }
            )
    return candidates


@dataclass
class DsvVisionParseResult:
    file_id: str
    file_name: str = ""
    parser_version: str = PARSER_VERSION
    doc_type: str = "UNKNOWN"
    doc_type_confidence: int = 0
    keys: dict[str, Any] = field(default_factory=dict)
    line_items: list[dict[str, Any]] = field(default_factory=list)
    type_b: str = "OTHERS"
    evidence_status: str = "MISSING"
    parser_verdict: str = "AMBER"
    issues: list[dict[str, str]] = field(default_factory=list)
    evidence_candidates: list[dict[str, Any]] = field(default_factory=list)
    parser_confidence: float = 0.0
    page_count: int = 1
    text_length: int = 0


def parse_vision_text(
    text: str,
    file_id: str,
    file_name: str = "",
    confidence: float = 0.0,
    page_count: int = 1,
) -> DsvVisionParseResult:
    """Parse Google Vision OCR text with the DSV PDF parser rule subset."""
    normalized_text = normalize_text(text)
    doc = classify_doc(normalized_text, file_name)
    doc_type = str(doc["doc_type"])
    keys = extract_common_keys(normalized_text, file_name)
    line_items = extract_line_items(normalized_text, doc_type)
    parser_confidence = max(0.0, min(1.0, confidence))
    evidence_status = evidence_status_for_doc(doc_type, line_items, keys)
    verdict, issues = gate_verdict(doc_type, keys, line_items, parser_confidence, len(normalized_text))
    return DsvVisionParseResult(
        file_id=file_id,
        file_name=file_name,
        doc_type=doc_type,
        doc_type_confidence=int(doc["confidence"]),
        keys=keys,
        line_items=line_items,
        type_b=type_b_from_lines(line_items, doc_type, normalized_text),
        evidence_status=evidence_status,
        parser_verdict=verdict,
        issues=issues,
        evidence_candidates=build_evidence_candidates(file_id, keys, parser_confidence),
        parser_confidence=parser_confidence,
        page_count=page_count,
        text_length=len(normalized_text),
    )
