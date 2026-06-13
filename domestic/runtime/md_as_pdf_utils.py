"""MD-as-PDF evidence utilities for HVDC Domestic GPTS runtime.

Patch 2026-06-07:
- Treat .md/.markdown POD files as text extracted from the original PDF.
- Extract invoice row numbers from filenames like "_12 & 13. HVDC-..._POD.md".
- Build stable evidence inventories for workbook output and self-verification.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable


ROW_KEY_PREFIX = "__ROW_SN__:"


def normalize_ref(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().upper().replace("/", "-")


def row_key(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\.0$", "", text)
    text = text.lstrip("0") or text
    return f"{ROW_KEY_PREFIX}{text}" if text else ""


def read_text(path: Path, max_chars: int | None = None) -> str:
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except Exception:
        text = Path(path).read_text(encoding="latin-1", errors="replace")
    if max_chars is not None:
        return text[:max_chars]
    return text


def extract_hvdc_refs(text: str) -> list[str]:
    refs = re.findall(r"HVDC-[A-Z0-9]+(?:[-/][A-Z0-9]+)+-\d+", text or "", flags=re.IGNORECASE)
    return list(dict.fromkeys(normalize_ref(r) for r in refs if r))


def extract_waybill_numbers(text: str) -> list[str]:
    nums = re.findall(
        r"(?:Note/Waybill#|Waybill#|Note#|DN\s*#)\s*:?\s*([0-9]{4}-[0-9A-Z-]+AUH)",
        text or "",
        flags=re.IGNORECASE,
    )
    return list(dict.fromkeys(n.strip() for n in nums if n.strip()))


def extract_trip_numbers(text: str) -> list[str]:
    trips: list[str] = []
    lines = (text or "").splitlines()
    for idx, line in enumerate(lines):
        if re.search(r"Trip\s*No\.?\s*:", line, flags=re.IGNORECASE):
            after = re.sub(r".*Trip\s*No\.?\s*:\s*", "", line, flags=re.IGNORECASE).strip()
            candidates = [after] if after else []
            candidates.extend(lines[idx + 1: idx + 4])
            for candidate in candidates:
                cleaned = re.sub(r"[^A-Za-z0-9-]", "", str(candidate).strip())
                if re.search(r"\d", cleaned) and len(cleaned) >= 6:
                    trips.append(cleaned)
                    break
    return list(dict.fromkeys(trips))


def extract_rate_approval(text: str) -> str:
    hits: list[str] = []
    patterns = [
        r"AED\s*[\d,]+(?:\.\d+)?\s*(?:per|/)\s*(?:Trailer|Truck|Trip)",
        r"USD\s*[\d,]+(?:\.\d+)?\s*(?:per|/)\s*(?:Trailer|Truck|Trip)",
        r"Confirmed\.",
        r"kindly approve below charges",
        r"\bApproved\.\s*Pls proceed\b",
        r"\bapproval\b",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text or "", flags=re.IGNORECASE):
            snippet = match.group(0).strip()
            if snippet and snippet not in hits:
                hits.append(snippet)
    return "; ".join(hits[:8])


def extract_row_numbers_from_filename(name: str) -> list[str]:
    """Extract invoice row serials from POD filenames.

    Strong patterns intentionally prefer row markers after an underscore, e.g.:
    - "02. Domestic (DSV Trucks)_12 & 13. HVDC-..._POD.md" -> ["12", "13"]
    - "02. Domestic (DSV Trucks)_01 & 02. HVDC-..._POD.md" -> ["1", "2"]

    This avoids treating the leading section number ("02. Domestic") as an
    invoice row number.
    """
    text = str(name or "")

    strong_patterns = [
        r"[_\-]\s*((?:\d{1,4}\s*(?:&|and|,)\s*)*\d{1,4})\s*[.)]\s*HVDC",
        r"[_\-]\s*((?:\d{1,4}\s*(?:&|and|,)\s*)*\d{1,4})\s*[.)]\s*[^_/\\]*HVDC",
    ]
    for pattern in strong_patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            nums = re.findall(r"\d{1,4}", match.group(1))
            return [str(int(n)) for n in nums if n.strip()]

    # Fallback: only use leading number when it is not the generic
    # "02. Domestic..." section prefix.
    match = re.match(r"^\s*(\d{1,4})\s*[.)_-]\s*(?!Domestic\b)", text, flags=re.IGNORECASE)
    if match:
        return [str(int(match.group(1)))]

    return []


def extract_issue_date(text: str) -> str:
    for pattern in [
        r"Printed\s+Date:\s*(\d{2}/\d{2}/\d{4})",
        r"Issue\s+Date:\s*(\d{2}/\d{2}/\d{4})",
        r"\bDate:\s*(\d{2}/\d{2}/\d{4})",
    ]:
        match = re.search(pattern, text or "", flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def extract_destination_hint(text: str) -> str:
    match = re.search(r"Destination:\s*([^\n\r|]+)", text or "", flags=re.IGNORECASE)
    return match.group(1).strip() if match else ""


def extract_origin_hint(text: str) -> str:
    match = re.search(
        r"(?:Agility M44|DSV Mussafah|Samsung Mosb|Shuweihat|MIRFA|CICPA|Al Masaood)[^\n\r|]{0,80}",
        text or "",
        flags=re.IGNORECASE,
    )
    return match.group(0).strip() if match else ""


def md_document_to_doc_info(path: Path) -> dict[str, Any]:
    path = Path(path)
    text = read_text(path)
    refs = extract_hvdc_refs(path.name + "\n" + text)
    row_numbers = extract_row_numbers_from_filename(path.name)
    waybills = extract_waybill_numbers(text)
    trips = extract_trip_numbers(text)
    approval = extract_rate_approval(text)
    origin = extract_origin_hint(text)
    destination = extract_destination_hint(text)
    issue_date = extract_issue_date(text)

    is_dn = bool(waybills or trips or re.search(r"POD|Waybill|Delivery\s+Note|Consignment", path.name + "\n" + text, re.IGNORECASE))
    doc_type = "DN" if is_dn else ("RateApproval" if approval else "Other")

    summary = text[:200].strip() + ("..." if len(text) > 200 else "")
    fields = {
        "md_as_pdf_equivalent": True,
        "source_format": "MD_AS_PDF_TEXT",
        "row_numbers": row_numbers,
        "shipment_refs": refs,
        "waybill_numbers": waybills,
        "trip_numbers": trips,
        "issue_date": issue_date,
        "origin_from_pdf": origin,
        "destination_from_pdf": destination,
        "rate_approval": approval,
    }

    return {
        "file_name": path.name,
        "file_path": str(path),
        "file_size": path.stat().st_size if path.exists() else 0,
        "doc_type": doc_type,
        "source_format": "MD_AS_PDF_TEXT",
        "md_as_pdf_equivalent": True,
        "content_match": True,
        "processing_success": True,
        "extracted_content": text,
        "content_summary": summary,
        "waybill_no": waybills[0] if waybills else "",
        "origin_from_pdf": origin,
        "destination_from_pdf": destination,
        "trip_numbers": trips,
        "waybill_numbers": waybills,
        "shipment_refs": refs,
        "row_numbers": row_numbers,
        "approval_evidence": approval,
        "dsv_waybill": {
            "success": True,
            "confidence": 0.98,
            "source_format": "MD_AS_PDF_TEXT",
            "md_as_pdf_equivalent": True,
            "fields": {
                "waybill_no": waybills[0] if waybills else "",
                "printed_date": issue_date,
                "destination": destination,
                "loading_address": origin,
                "trip_numbers": trips,
                "waybill_numbers": waybills,
                "approval_evidence": approval,
            },
            "lane": {
                "origin_raw": origin,
                "destination_raw": destination,
                "origin_norm": origin,
                "destination_norm": destination,
                "extraction_method": "md_as_pdf_text",
            },
        },
        "extracted_fields_json": json.dumps(fields, ensure_ascii=False),
    }


def build_md_as_pdf_inventory(docs_dir: Path | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not docs_dir:
        return rows
    docs_dir = Path(docs_dir)
    if not docs_dir.exists():
        return rows
    for path in sorted(list(docs_dir.rglob("*.md")) + list(docs_dir.rglob("*.markdown"))):
        try:
            info = md_document_to_doc_info(path)
            rows.append({
                "file_name": info.get("file_name", ""),
                "file_path": info.get("file_path", ""),
                "source_format": "MD_AS_PDF_TEXT",
                "doc_type": info.get("doc_type", ""),
                "row_numbers": ",".join(info.get("row_numbers", [])),
                "shipment_refs": ",".join(info.get("shipment_refs", [])),
                "waybill_count": len(info.get("waybill_numbers", [])),
                "trip_no_count": len(info.get("trip_numbers", [])),
                "first_waybill_no": info.get("waybill_no", ""),
                "issue_date": info.get("dsv_waybill", {}).get("fields", {}).get("printed_date", ""),
                "origin": info.get("origin_from_pdf", ""),
                "destination": info.get("destination_from_pdf", ""),
                "rate_approval_evidence": info.get("approval_evidence", ""),
                "content_summary": info.get("content_summary", ""),
                "md_as_pdf_equivalent": True,
            })
        except Exception as exc:
            rows.append({
                "file_name": Path(path).name,
                "file_path": str(path),
                "source_format": "MD_AS_PDF_TEXT",
                "doc_type": "ERROR",
                "row_numbers": "",
                "shipment_refs": "",
                "waybill_count": 0,
                "trip_no_count": 0,
                "first_waybill_no": "",
                "issue_date": "",
                "origin": "",
                "destination": "",
                "rate_approval_evidence": "",
                "content_summary": f"ERROR: {exc}",
                "md_as_pdf_equivalent": True,
            })
    return rows


def unique_doc_infos(docs: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for doc in docs:
        key = str(doc.get("file_path") or doc.get("file_name") or "")
        if key in seen:
            continue
        seen.add(key)
        out.append(doc)
    return out
