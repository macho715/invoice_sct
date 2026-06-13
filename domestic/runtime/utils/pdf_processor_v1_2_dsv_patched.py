#!/usr/bin/env python3
"""
PDF Processing Utilities for Invoice Verification - DSV Enhanced v1.4.1

v1.4.1 Patch Notes (2026-02-06):
- Enhanced Delivery Note form label filtering
- Improved Terms & Conditions contamination removal
- Added negative validation for destination extraction
- Fixed Customer's Name & Address false positive

v1.4 Patch Notes (2026-02-05):
- Multi-line Loading Point merging in CONSIGNMENT section
- Direct Destination label extraction fallback
- PDF text extraction caching for performance

v1.3 Patch Notes:
- Added CONSIGNMENT INFORMATION -> Loading Point extraction (Method 1b)
- Extended valid location keywords

v1.2 Patch Notes:
- Fixed Origin/Destination extraction from DSV Waybill
- Added section-based parsing for Routing and Destination
- Excluded legal disclaimers and header text from lane extraction
- Enhanced regex patterns with negative lookahead
- Added validation for extracted values

Features:
- PDF text extraction using pdfplumber (with caching)
- Table extraction from PDFs
- Content-based document matching using rapidfuzz
- DSV Waybill-specific field extraction
- DSV Delivery Note form label filtering (v1.4.1)
- Graceful fallback to filename matching if PDF processing fails
"""

import logging
import re
import os
import hashlib
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
import json

# Optional dependencies - graceful fallback if not installed
try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    logging.warning("pdfplumber not available. PDF content extraction will be disabled.")

try:
    from rapidfuzz import fuzz, process
    RAPIDFUZZ_AVAILABLE = True
except ImportError:
    RAPIDFUZZ_AVAILABLE = False
    logging.warning("rapidfuzz not available. Fuzzy matching will be disabled.")

# Optional: camelot for complex table extraction
try:
    import camelot
    CAMELOT_AVAILABLE = True
except ImportError:
    CAMELOT_AVAILABLE = False


# =============================================================================
# PDF Content Cache (v1.4 - Performance Optimization)
# =============================================================================
# Cache key: file path + modification time hash
# Prevents repeated PDF parsing for same file
_PDF_CONTENT_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_MAX_SIZE = 100  # Maximum number of cached PDFs

def _get_cache_key(pdf_path: Path) -> str:
    """Generate cache key from file path and modification time."""
    try:
        stat = pdf_path.stat()
        key_str = f"{str(pdf_path.absolute())}:{stat.st_mtime}:{stat.st_size}"
        return hashlib.md5(key_str.encode()).hexdigest()
    except Exception:
        return ""

def clear_pdf_cache():
    """Clear the PDF content cache. Call when memory needs to be freed."""
    global _PDF_CONTENT_CACHE
    _PDF_CONTENT_CACHE.clear()
    logging.debug("PDF content cache cleared")


# =============================================================================
# Vendor-specific parsing helpers (header-variation resilient)
# =============================================================================

def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9/#:._\-\s]", " ", (s or "").lower())).strip()

def _safe_first(match_list):
    if not match_list:
        return None
    if isinstance(match_list[0], tuple):
        # return first non-empty element in tuple
        for m in match_list:
            for x in m:
                if x:
                    return x
        return None
    return match_list[0]

def _regex_first(pattern: str, text: str, flags=re.IGNORECASE | re.MULTILINE | re.DOTALL):
    m = re.search(pattern, text or "", flags)
    return m.group(1).strip() if m and m.group(1) else None


# =============================================================================
# v1.2 PATCH: Enhanced validation and extraction helpers
# =============================================================================

# Known invalid patterns that should be rejected (Carrier/equipment, not location)
INVALID_ORIGIN_DEST_PATTERNS = [
    r"validity",
    r"customer.*account",
    r"name.*address",
    r"terms.*conditions",
    r"binding.*shipper",
    r"consignment\s*note",
    r"issued\s*by",
    r"routing\s*and\s*destination",  # Header text
    r"loading\s*point.*destination",  # Header row
    r"customer.*name",
    r"cust\.\s*ref\s*#",
    r"^\s*:\s*$",
    r"^\s*[a-z]{2,3}\s*$",
    r"(?:copies|validity|originals)",
    r"^\d+$",
    r"^\d{4}-\d{5,8}[A-Z]{3}$",  # Waybill numbers
    r"^\d{10}[A-Z]{3}$",  # Trip numbers
    r"^y?uae$",
    r"^\s*$",  # Empty
    r"^[\s\W]+$",  # Only whitespace/punctuation
    r"head\s*plate",  # Carrier/equipment not origin
    r"trailer\s*plate",  # Carrier/equipment not origin
    r"head\s*plate\s*\d+",
    r"trailer\s*plate\s*\d+",
    r"destination\s*code:\s*\d+",
    r"ft-sg",
    r"carrier\s*details",
    r"vehicle\s*(?:no|number)",
    r"head\s*plate.*?trailer\s*plate.*?destination\s*code",
]

# Known valid location keywords for DSV UAE routes (priority-aware)
VALID_LOCATION_KEYWORDS = {
    "high": [
        "mosb", "mirfa", "shuweihat", "khalifa", "mina zayed", "jebel ali",
        "mussafah", "kizad", "icad", "m44"
    ],
    "medium": [
        "warehouse", "port", "yard", "site", "industrial", "free zone",
        "abu dhabi", "dubai", "ajman", "sharjah", "rak", "fujairah"
    ],
    "low": [
        "dewa", "adnoc", "samsung", "dsv", "etihad",
        "agility", "masaood", "bergum", "sas", "power",
        "schenker", "schencker", "adopt", "hauler"
    ]
}

def _is_valid_location(text: str) -> bool:
    """Check if extracted text looks like a valid location."""
    if not text:
        return False

    t = _norm_text(text)
    if len(t) < 5 or len(t) > 100:
        return False

    # Reject if matches invalid patterns
    for pattern in INVALID_ORIGIN_DEST_PATTERNS:
        if re.search(pattern, t, re.IGNORECASE):
            return False

    # Accept if contains valid location keywords (any priority)
    has_valid_keyword = False
    for priority in ("high", "medium", "low"):
        for kw in VALID_LOCATION_KEYWORDS.get(priority, []):
            if kw in t:
                has_valid_keyword = True
                break
        if has_valid_keyword:
            break

    # If no keyword, accept if it looks like an address
    if not has_valid_keyword:
        if re.search(r"\d+|road|street|zone|area|plot|building|warehouse|yard|site", t, re.IGNORECASE):
            has_valid_keyword = True

    return has_valid_keyword


def _clean_origin_field(origin: str) -> str:
    """Remove carrier/equipment contamination from origin field."""
    if not origin:
        return ""

    cleaning_patterns = [
        r"head\s*plate\s*\d+",
        r"trailer\s*plate\s*\d+",
        r"destination\s*code:\s*\d+",
        r"ft-sg",
        r"carrier\s*details.*",
        r"vehicle\s*(?:no|number):?\s*\d+",
    ]

    cleaned = origin
    for pattern in cleaning_patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 5:
        return ""

    return cleaned


def _extract_routing_section(raw: str) -> Optional[str]:
    """Extract the Routing and Destination section from DSV Waybill.
    Stops before Carrier details / Head Plate / Trailer Plate so origin is not
    taken from equipment fields. Only returns a section that contains 'Loading'.
    """
    # Stop at Carrier/equipment so we don't capture Head Plate / Trailer Plate as origin
    section_patterns = [
        # Capture until next major section (including Carrier/Plate so we cut before them)
        r"routing\s*(?:and|&)\s*destination\s*[:\n]*([\s\S]*?)(?=(?:consignment\s*information|carrier\s*details|head\s*plate|trailer\s*plate|terms\s*and\s*conditions|offloading|receiver|$))",
        r"routing\s*(?:and|&)\s*destination\s*[:\n]*(.{50,500}?)(?=(?:head\s*plate|trailer\s*plate|carrier\s*details|$))",
    ]
    
    for pattern in section_patterns:
        m = re.search(pattern, raw, re.IGNORECASE)
        if m and m.group(1):
            section = m.group(1).strip()
            # Must contain Loading (address|point) so we don't use a Carrier-only block
            if len(section) > 10 and re.search(r"loading\s*(?:address|point)", section, re.IGNORECASE):
                return section
    
    return None


def _extract_routing_section_clean(raw: str) -> Dict[str, Any]:
    """Extract routing section while excluding carrier/equipment contamination."""
    lane = {
        "origin_raw": None,
        "destination_raw": None,
        "extraction_method": None
    }

    routing_pattern = (
        r"routing\s+and\s+destination\s*[:\n]*(.*?)(?=head\s+plate|trailer\s+plate|carrier\s+details|"
        r"consignment\s+information|$)"
    )
    routing_match = re.search(routing_pattern, raw or "", re.DOTALL | re.IGNORECASE)
    if not routing_match:
        return lane

    routing_section = routing_match.group(1).strip()

    loading_patterns = [
        r"loading\s+address\s*:\s*([^\n]+?)(?=\s*destination|$)",
        r"loading\s+point\s*:\s*([^\n]+?)(?=\s*destination|$)",
        r"from\s*:\s*([^\n]+?)(?=\s*to|$)",
    ]
    for pattern in loading_patterns:
        match = re.search(pattern, routing_section, re.IGNORECASE)
        if match:
            origin_candidate = _clean_origin_field(match.group(1).strip())
            if origin_candidate and _is_valid_location(origin_candidate):
                lane["origin_raw"] = origin_candidate
                break

    dest_patterns = [
        r"destination\s*:\s*([^\n]+?)(?=\s*trip|order|job|$)",
        r"to\s*:\s*([^\n]+?)(?=\s*trip|order|job|$)",
    ]
    for pattern in dest_patterns:
        match = re.search(pattern, routing_section, re.IGNORECASE)
        if match:
            dest_candidate = match.group(1).strip()
            if _is_valid_location(dest_candidate):
                lane["destination_raw"] = dest_candidate
                break

    if lane["origin_raw"] or lane["destination_raw"]:
        lane["extraction_method"] = "routing_section_clean"

    return lane


def _extract_lane_from_section(section: str) -> Tuple[Optional[str], Optional[str]]:
    """Extract origin and destination from routing section."""
    origin = None
    destination = None
    
    if not section:
        return origin, destination
    
    # Pattern 1: "Loading Address: XXX" and "Destination: YYY" in section
    # Use more specific patterns to avoid header capture
    loading_patterns = [
        r"loading\s*(?:address|point)\s*[:#]\s*\n?\s*([^\n]{5,100}?)(?=\s*(?:destination|$|\n\n))",
        r"(?:^|\n)\s*loading\s*(?:address|point)\s*[:#]?\s*\n?\s*([A-Z][^\n]{5,100})",
        r"from\s*[:#]?\s*([A-Z][^\n]{5,100}?)(?=\s*to\s*[:#])",
    ]
    
    dest_patterns = [
        r"destination\s*[:#]\s*\n?\s*([^\n]{5,100}?)(?=\s*(?:trip|order|job|$|\n\n))",
        r"(?:^|\n)\s*destination\s*[:#]?\s*\n?\s*([A-Z][^\n]{5,100})",
        r"to\s*[:#]?\s*([A-Z][^\n]{5,100}?)(?=\s*(?:\n|trip|order|$))",
    ]
    
    for pattern in loading_patterns:
        m = re.search(pattern, section, re.IGNORECASE)
        if m and m.group(1):
            candidate = _clean_origin_field(m.group(1).strip())
            if candidate and _is_valid_location(candidate):
                origin = candidate
                break
    
    for pattern in dest_patterns:
        m = re.search(pattern, section, re.IGNORECASE)
        if m and m.group(1):
            candidate = m.group(1).strip()
            if _is_valid_location(candidate):
                destination = candidate
                break
    
    return origin, destination


def _extract_lane_from_full_text(raw: str) -> Tuple[Optional[str], Optional[str]]:
    """Fallback: Extract origin/destination from full text with strict validation.
    
    v1.4.1 Enhancement: Improved filtering for Delivery Note documents
    - Remove Terms & Conditions contamination
    - Exclude Customer's Name & Address form labels
    - Filter out account/form field labels
    """
    origin = None
    destination = None
    
    # Step 1: Remove terms and conditions sections (extended pattern)
    clean_text = re.sub(
        r"(?:terms\s*(?:and|&)\s*conditions|disclaimer|validity|the\s*terms)[\s\S]{0,300}?(?:have\s+the\s+same|are\s+subject|shall\s+be|binding|applicable)",
        "",
        raw,
        flags=re.IGNORECASE
    )
    
    # Step 2: Remove form header labels that contaminate destination extraction
    # "Customer's Name & Address", "Customer's Account Number", etc.
    clean_text = re.sub(
        r"customer'?s?\s+(?:name\s*[&\s]+address|account\s+number)[\s\S]{0,150}?(?=issued\s+by|from|to|routing|loading|$)",
        "",
        clean_text,
        flags=re.IGNORECASE
    )
    
    # Step 3: Remove other form field labels
    clean_text = re.sub(
        r"(?:issued\s+by|consignee|shipper|notify\s+party)\s*[:\n]\s*DSV\s+SOLUTIONS",
        "",
        clean_text,
        flags=re.IGNORECASE
    )
    
    # Pattern: "From: XXX To: YYY" (excluding legal text)
    # Use negative lookahead to exclude problematic patterns
    from_to_pattern = r"\bfrom\s*[:#]?\s*([A-Z][^,\n]{5,80}?)\s+to\s*[:#]?\s*([A-Z][^,\n]{5,80}?)(?=\s{2,}|\n|trip|order|$)"
    m = re.search(from_to_pattern, clean_text, re.IGNORECASE)
    if m:
        origin_candidate = _clean_origin_field(m.group(1).strip())
        dest_candidate = m.group(2).strip()
        
        if origin_candidate and _is_valid_location(origin_candidate) and _is_valid_location(dest_candidate):
            origin = origin_candidate
            destination = dest_candidate
            return origin, destination
    
    # Pattern: Separate "Loading Address" and "Destination" fields
    loading_match = re.search(
        r"loading\s*(?:address|point)\s*[:#]\s*\n?\s*([A-Z][^\n]{5,100}?)(?=\s*\n|destination|trip)",
        clean_text,
        re.IGNORECASE
    )
    if loading_match:
        candidate = _clean_origin_field(loading_match.group(1).strip())
        if candidate and _is_valid_location(candidate):
            origin = candidate
    
    # v1.4.1: Enhanced destination extraction with negative patterns
    # Avoid matching "routing and destination" header AND "Customer's Name & Address"
    dest_match = re.search(
        r"(?<!routing and )(?<!name & )(?<!name and )destination\s*[:#]\s*\n?\s*([A-Z][^\n]{5,100}?)(?=\s*\n|trip|order|job|$)",
        clean_text,
        re.IGNORECASE
    )
    if dest_match:
        candidate = dest_match.group(1).strip()
        # Extra validation: reject if contains form field keywords
        if not re.search(r"customer|account|address|name|number", candidate, re.IGNORECASE):
            if _is_valid_location(candidate):
                destination = candidate
    
    return origin, destination


def _extract_lane_from_table(raw: str) -> Tuple[Optional[str], Optional[str]]:
    """Extract origin/destination from table-formatted data."""
    origin = None
    destination = None
    
    # DSV Waybills often have tabular format:
    # Loading Point | Destination
    # MOSB Yard     | Mirfa Site
    
    # Look for two-column pattern
    table_patterns = [
        # Pattern: Header row followed by data row
        r"loading\s*(?:point|address)\s*[\t|]+\s*destination\s*\n+\s*([^\t|\n]+)\s*[\t|]+\s*([^\t|\n]+)",
        # Pattern: Side-by-side columns with clear separation
        r"([A-Z][^\n]{3,50}?(?:yard|port|site|warehouse)[^\n]*?)\s{3,}([A-Z][^\n]{3,50}?(?:yard|port|site|warehouse))",
    ]
    
    for pattern in table_patterns:
        m = re.search(pattern, raw, re.IGNORECASE)
        if m:
            origin_candidate = _clean_origin_field(m.group(1).strip())
            dest_candidate = m.group(2).strip()
            
            if origin_candidate and _is_valid_location(origin_candidate) and _is_valid_location(dest_candidate):
                origin = origin_candidate
                destination = dest_candidate
                break
    
    return origin, destination


# =============================================================================
# v1.3 PATCH: CONSIGNMENT INFORMATION -> Loading Point extraction
# =============================================================================

def _extract_consignment_section_raw(raw: str) -> Optional[str]:
    """Extract the CONSIGNMENT INFORMATION section from DSV Waybill (preserve lines)."""
    section_patterns = [
        # Capture from "consignment information" until next major section
        r"(?s)consignment\s*information\s*([\s\S]{50,1200}?)(?=consignment\s*loading\s*date|sender\s*section|arrival\s*for\s+loading|receiver\s*section|trip\s*no\.\s*:|\Z)",
        # Shorter capture for truncated extractions
        r"(?s)consignment\s*information\s*([\s\S]{50,600}?)(?=sender|receiver|arrival|trip)",
    ]

    for pattern in section_patterns:
        m = re.search(pattern, raw, re.IGNORECASE)
        if m and m.group(1):
            section = m.group(1).strip()
            if len(section) > 30:
                return section.strip()

    return None


def _extract_consignment_section(raw: str) -> Optional[str]:
    """Extract the CONSIGNMENT INFORMATION section from DSV Waybill.

    v1.4: Merge multi-line text to handle split Loading Point values.
    """
    section = _extract_consignment_section_raw(raw)
    if not section:
        return None
    section = re.sub(r"\n+", " ", section)
    section = re.sub(r"\s{2,}", " ", section)
    return section.strip()


def _extract_loading_point_from_consignment(section: str) -> Optional[str]:
    """Extract Loading Point (origin) from CONSIGNMENT INFORMATION section."""
    if not section:
        return None
    
    # Words that indicate table headers, not location values
    header_words = [
        "order", "number", "job", "po", "loading", "country", "date", "qty",
        "type", "description", "sender", "receiver", "arrival", "offloading",
        "consignment"
    ]
    
    def _is_header_text(text: str) -> bool:
        t = text.lower()
        count = sum(1 for hw in header_words if hw in t)
        return count >= 2
    
    def _clean_candidate(c: str) -> str:
        # Remove trailing dates, numbers
        c = re.sub(r"\s+\d{1,2}/\d{1,2}/\d{4}.*$", "", c).strip()
        c = re.sub(r"\s+\d{6,}$", "", c).strip()
        return c
    
    # Pattern A: Known location prefixes (standalone) followed by words, then UAE
    # Matches: "DSV Mussafah Yard", "Agility M44 Warehouse", "SAS POWER", "MOSB Yard"
    # Use word boundary \b and negative lookbehind to avoid "HVDC-DSV-" partial match
    known_prefixes = r"(?:DSV|Agility|SAS|MOSB|Mirfa|Shuweihat|KIZAD|Masaood|Samsung|Schenker|Schencker)"
    pattern_a = rf"(?<![A-Z\-])({known_prefixes}[\sA-Za-z0-9&.]+?)\s+UAE\b"
    for m in re.finditer(pattern_a, section, re.IGNORECASE):
        candidate = _clean_origin_field(_clean_candidate(m.group(1)))
        # Skip if candidate contains HVDC- or SAMF (shipment refs mixed in)
        if re.search(r"HVDC-|SAMF\d", candidate, re.IGNORECASE):
            continue
        if candidate and _is_valid_location(candidate) and not _is_header_text(candidate):
            return candidate
    
    # Pattern B: Location ending with known suffixes before UAE
    known_suffixes = r"(?:Yard|Warehouse|Site|Port|Power|Industries|FZE|LLC|M44|ICAD|Bergum)"
    pattern_b = rf"\b([A-Z][A-Za-z0-9\s\-&.]*{known_suffixes})\s+UAE\b"
    for m in re.finditer(pattern_b, section, re.IGNORECASE):
        candidate = _clean_origin_field(_clean_candidate(m.group(1)))
        # Skip if starts with HVDC- or SAMF (shipment refs)
        if re.match(r"^(HVDC|SAMF)", candidate, re.IGNORECASE):
            continue
        if candidate and _is_valid_location(candidate) and not _is_header_text(candidate):
            return candidate
    
    # Pattern C: Simple word(s) immediately before UAE (fallback)
    # Look for 1-4 capitalized words before UAE
    pattern_c = r"\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\s+UAE\b"
    for m in re.finditer(pattern_c, section, re.IGNORECASE):
        candidate = _clean_origin_field(_clean_candidate(m.group(1)))
        # Skip known non-location patterns
        if re.match(r"^(HVDC|SAMF|Order|Job|PO|Loading|Country|No)", candidate, re.IGNORECASE):
            continue
        if candidate and _is_valid_location(candidate) and not _is_header_text(candidate):
            return candidate
    
    return None




def _extract_origin_from_consignment_v2(raw: str) -> Optional[str]:
    """Enhanced consignment table extraction with header mapping."""
    consignment_section = _extract_consignment_section_raw(raw)
    if not consignment_section:
        return None

    lines = consignment_section.splitlines()
    if len(lines) < 2:
        return None

    header_row = None
    loading_point_col_idx = None
    for i, line in enumerate(lines):
        if re.search(r"loading\s+point", line, re.IGNORECASE):
            header_row = i
            header_tokens = re.split(r"\s{2,}", line.strip())
            for idx, token in enumerate(header_tokens):
                if re.search(r"loading\s+point", token, re.IGNORECASE):
                    loading_point_col_idx = idx
                    break
            break

    if header_row is None or loading_point_col_idx is None:
        return None

    for i in range(header_row + 1, len(lines)):
        line = lines[i].strip()
        if not line:
            continue

        tokens = re.split(r"\s{2,}", line)
        if len(tokens) > loading_point_col_idx:
            loading_point_raw = tokens[loading_point_col_idx]

            origin_parts = []
            for part in loading_point_raw.split():
                if part.upper() in ["UAE", "UNITED", "ARAB"]:
                    break
                if re.match(r"\d{1,2}/\d{1,2}/\d{4}", part):
                    break
                origin_parts.append(part)

            if origin_parts:
                origin_candidate = " ".join(origin_parts)
                origin_clean = _clean_origin_field(origin_candidate)
                if origin_clean and _is_valid_location(origin_clean):
                    return origin_clean

    return None

# =============================================================================
# v1.2.1 PATCH: CONSIGNMENT INFORMATION table extraction (fix header-misparse)
# =============================================================================

def _clean_ws_text(s: Optional[str]) -> str:
    """Collapse PDF-extracted whitespace/newlines into a single-space string."""
    if not s:
        return ""
    s = str(s).replace("\u00a0", " ")
    s = s.replace("\n", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _compact_identifier_text(s: Optional[str]) -> str:
    """Normalize IDs that are frequently broken by newlines in PDF tables.

    Example: "0126-\n04466AUH" -> "0126-04466AUH"
             "HVDC-DSV-\nHE-MOSB-\n335" -> "HVDC-DSV-HE-MOSB-335"
    """
    s = _clean_ws_text(s)
    # Remove whitespace around hyphens to re-join broken identifiers.
    s = re.sub(r"\s*-\s*", "-", s)
    return s


def _extract_consignment_info_from_pdf(pdf_path: Path, max_pages: int = 2) -> Dict[str, str]:
    """Extract key values from the DSV 'CONSIGNMENT INFORMATION' table.

    Why: The plain text stream often contains the header sequence
         'Order Number Job Number PO Number ...' which causes naive
         regex extraction to return 'Job', 'PO', 'Loading', etc.

    Returns:
        Dict with possible keys:
        - order_no, job_no, po_no, loading_point, loading_country, description
    """
    if not (PDFPLUMBER_AVAILABLE and pdf_path and pdf_path.exists()):
        return {}

    def _looks_like_consignment_header_row(row: List[Optional[str]]) -> bool:
        row_text = " ".join(_clean_ws_text(c).lower() for c in (row or []) if c)
        return (
            "order number" in row_text
            and "job number" in row_text
            and "po number" in row_text
            and "loading point" in row_text
        )

    def _map_header_indices(header: List[Optional[str]]) -> Dict[str, int]:
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

    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages_to_process = min(max_pages, len(pdf.pages))
            for page in pdf.pages[:pages_to_process]:
                tables = page.extract_tables() or []
                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    header = table[0]
                    if not _looks_like_consignment_header_row(header):
                        continue

                    idx = _map_header_indices(header)

                    # Pick first data-like row (skip repeated headers)
                    for row in table[1:]:
                        if not row:
                            continue
                        if _looks_like_consignment_header_row(row):
                            continue

                        out: Dict[str, str] = {}

                        def _cell(key: str) -> Optional[str]:
                            j = idx.get(key)
                            if j is None or j >= len(row):
                                return None
                            return row[j]

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
    except Exception as e:
        logging.debug(f"Consignment table extraction failed for {pdf_path}: {e}")

    return {}

# =============================================================================
# DSV Waybill Detection and Parsing
# =============================================================================

def is_dsv_waybill_text(text: str) -> bool:
    t = _norm_text(text)
    # Robust against minor wording changes
    return (
        ("dsv" in t)
        and (("delivery note" in t) or ("waybill" in t))
        and (("road freight" in t) or ("consignment" in t) or ("routing and destination" in t))
    )


def parse_dsv_waybill_from_text(text: str, consignment: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Parse DSV Delivery Note/Waybill fields from extracted text (digital PDF preferred).
    
    v1.2: Enhanced Origin/Destination extraction with section-based parsing.
    """
    raw = text or ""
    out: Dict[str, Any] = {
        "doc_kind": "DSV_WAYBILL",
        "fields": {},
        "lane": {},
        "timeline": {},
        "confidence": 0.0,
        "flags": []
    }

    # Core identifiers
    out["fields"]["waybill_no"] = _regex_first(r"(?:delivery\s*note/waybill\s*#|waybill\s*#)\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["printed_date"] = _regex_first(r"printed\s*date\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})", raw)
    out["fields"]["do_no"] = _regex_first(r"\bdo\s*#\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["do_validity"] = _regex_first(r"do\s*validity\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})", raw)
    out["fields"]["cust_ref"] = _regex_first(r"cust\.?\s*ref\.?\s*#\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["bol_no"] = _regex_first(r"\bbol\s*#\s*[:#]?\s*([A-Z0-9\-]+)", raw)

    # Consignment information (prefer table-derived values, avoid header-misparse)
    def _looks_like_order_no(v: Optional[str]) -> bool:
        v2 = _compact_identifier_text(v)
        return bool(re.fullmatch(r"\d{2,}-[A-Z0-9]{3,}", v2 or "", flags=re.IGNORECASE))

    def _looks_like_job_no(v: Optional[str]) -> bool:
        v2 = _compact_identifier_text(v)
        if not v2 or len(v2) < 6:
            return False
        if not re.search(r"\d", v2):
            return False
        return not re.fullmatch(r"(?:job|po|loading|order)", v2, flags=re.IGNORECASE)

    def _looks_like_po_no(v: Optional[str]) -> bool:
        v2 = _compact_identifier_text(v)
        if not v2 or len(v2) < 6:
            return False
        if "-" not in v2:
            return False
        if not re.search(r"\d", v2):
            return False
        return not re.fullmatch(r"(?:job|po|loading|order)", v2, flags=re.IGNORECASE)

    # 1) Naive text extraction (may incorrectly capture header tokens like 'Job', 'PO', 'Loading')
    order_no_txt = _compact_identifier_text(_regex_first(r"order\s*(?:number|no\.?)\s*[:#]?\s*([A-Z0-9\-]+)", raw))
    job_no_txt = _compact_identifier_text(_regex_first(r"job\s*(?:number|no\.?)\s*[:#]?\s*([A-Z0-9\-]+)", raw))
    po_no_txt = _compact_identifier_text(_regex_first(r"po\s*(?:number|no\.?)\s*[:#]?\s*([A-Z0-9\-]+)", raw))

    out["fields"]["order_no"] = order_no_txt if _looks_like_order_no(order_no_txt) else None
    out["fields"]["job_no"] = job_no_txt if _looks_like_job_no(job_no_txt) else None
    out["fields"]["po_no"] = po_no_txt if _looks_like_po_no(po_no_txt) else None

    # 2) Override with CONSIGNMENT INFORMATION table extraction (highest precision)
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

        # Additional optional fields from the same table
        if consignment.get("loading_point"):
            out["fields"]["loading_point"] = _clean_ws_text(consignment.get("loading_point"))
        if consignment.get("loading_country"):
            out["fields"]["loading_country"] = _clean_ws_text(consignment.get("loading_country"))
        if consignment.get("description"):
            out["fields"]["description"] = _clean_ws_text(consignment.get("description"))
    # Carrier / equipment
    out["fields"]["req_truck_type"] = _regex_first(r"req\.?\s*truck\s*type\s*[:#]?\s*([^\n]+)", raw)
    out["fields"]["head_plate"] = _regex_first(r"head\s*plate\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["trailer_plate"] = _regex_first(r"trailer\s*plate\s*[:#]?\s*([A-Z0-9\-]+)", raw)
    out["fields"]["trailer_type"] = _regex_first(r"trailer\s*type\s*[:#]?\s*([^\n]+)", raw)
    out["fields"]["driver_name"] = _regex_first(r"driver\s*name\s*[:#]?\s*([^\n]+)", raw)
    out["fields"]["employee_id"] = _regex_first(r"employee\s*#\s*[:#]?\s*([0-9]+)", raw)

    # ==========================================================================
    # v3.1 PATCH: Enhanced Lane/Routing Extraction
    # ==========================================================================
    
    origin = None
    destination = None
    extraction_method = None
    
    # Method 1: Extract from dedicated Routing section (clean, carrier-excluded)
    routing_clean = _extract_routing_section_clean(raw)
    if routing_clean.get("origin_raw") or routing_clean.get("destination_raw"):
        origin = routing_clean.get("origin_raw") or origin
        destination = routing_clean.get("destination_raw") or destination
        extraction_method = routing_clean.get("extraction_method") or extraction_method

    # Method 1a: Fallback to legacy routing section extraction
    if not (origin and destination):
        routing_section = _extract_routing_section(raw)
        if routing_section:
            origin_sec, destination_sec = _extract_lane_from_section(routing_section)
            if origin_sec and not origin:
                origin = origin_sec
            if destination_sec and not destination:
                destination = destination_sec
            if (origin_sec or destination_sec) and not extraction_method:
                extraction_method = "section"
    
    # Method 1b (v1.2.1): Prefer CONSIGNMENT INFORMATION table "Loading Point" as origin
    if not origin and consignment and consignment.get("loading_point"):
        candidate = _clean_origin_field(_clean_ws_text(consignment.get("loading_point")))
        if candidate and _is_valid_location(candidate):
            origin = candidate
            extraction_method = extraction_method or "consignment_table"

    # Method 1c (v3.1): Header-mapped consignment extraction
    if not origin:
        origin_ci_v2 = _extract_origin_from_consignment_v2(raw)
        if origin_ci_v2:
            origin = origin_ci_v2
            extraction_method = extraction_method or "consignment_loading_point_v2"

    # Method 1d (v1.3): Pattern-based CONSIGNMENT INFORMATION extraction
    if not origin:
        consignment_section = _extract_consignment_section(raw)
        if consignment_section:
            origin_ci = _extract_loading_point_from_consignment(consignment_section)
            if origin_ci:
                origin = origin_ci
                extraction_method = extraction_method or "consignment_loading_point"
    
    # Method 2: Try table-based extraction
    if not (origin and destination):
        origin_tbl, dest_tbl = _extract_lane_from_table(raw)
        if origin_tbl and dest_tbl:
            origin = origin_tbl
            destination = dest_tbl
            extraction_method = "table"
    
    # Method 3: Fallback to full text with strict validation
    if not (origin and destination):
        origin_txt, dest_txt = _extract_lane_from_full_text(raw)
        if origin_txt:
            origin = origin or origin_txt
        if dest_txt:
            destination = destination or dest_txt
        if origin or destination:
            extraction_method = extraction_method or "text"
    
    # Method 4 (v1.4): Direct "Destination:" label extraction (fallback)
    if not destination:
        dest_direct = _regex_first(r"Destination\s*[:#]\s*([A-Z][^\n]{3,80})", raw)
        if dest_direct and _is_valid_location(dest_direct):
            destination = dest_direct
            extraction_method = extraction_method or "direct_label"

    if origin:
        origin_clean = _clean_origin_field(origin)
        if origin_clean and _is_valid_location(origin_clean):
            origin = origin_clean
        else:
            origin = None

    # Store raw extracted values
    out["lane"]["origin_raw"] = origin
    out["lane"]["destination_raw"] = destination
    out["lane"]["extraction_method"] = extraction_method

    # Also store in fields for backward compatibility
    out["fields"]["loading_address"] = origin
    out["fields"]["destination"] = destination

    # Trip / timeline
    out["fields"]["trip_no"] = _regex_first(r"trip\s*no\.?\s*[:#]?\s*([A-Z0-9\-]+)", raw)

    out["timeline"]["arrive_loading_dt"] = _regex_first(r"arrival\s+for\s+loading\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["loading_started_dt"] = _regex_first(r"loading\s+started\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["loading_finish_dt"] = _regex_first(r"loading\s+finish\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["asset_release_loading_dt"] = _regex_first(r"asset\s+release\s+date\s*&\s*time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)

    out["timeline"]["arrive_offloading_dt"] = _regex_first(r"arrival\s+for\s+offloading\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["offloading_started_dt"] = _regex_first(r"offloading\s+started\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["offloading_ended_dt"] = _regex_first(r"offloading\s+ended\s+date/time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})", raw)
    out["timeline"]["asset_release_offloading_dt"] = _regex_first(
        r"receiver\s+section[\s\S]*?asset\s+release\s+date\s*&\s*time\s*[:#]?\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\s+[0-9]{2}:[0-9]{2})",
        raw
    )

    # ==========================================================================
    # Lane Normalization (extend with ApprovedLaneMap later)
    # ==========================================================================
    
    def _lane_norm(x: Optional[str]) -> Optional[str]:
        if not x:
            return None
        s = _norm_text(x)
        
        # UAE HVDC project specific locations
        if "mosb" in s:
            return "MOSB_YARD"
        if "mirfa" in s:
            return "MIRFA_SITE"
        if "shuweihat" in s:
            return "SHUWEIHAT_SITE"
        if "khalifa" in s and "port" in s:
            return "KHALIFA_PORT"
        if ("mina" in s and "zayed" in s) or "mina zayed" in s:
            return "MINA_ZAYED_PORT"
        if "jebel" in s and "ali" in s:
            return "JEBEL_ALI_PORT"
        if "dsv" in s and ("warehouse" in s or "yard" in s):
            return "DSV_WAREHOUSE"
        
        # Return cleaned-up original if no normalization matched
        return x.strip()

    out["lane"]["origin_norm"] = _lane_norm(out["lane"].get("origin_raw"))
    out["lane"]["destination_norm"] = _lane_norm(out["lane"].get("destination_raw"))

    # ==========================================================================
    # Confidence & Flags
    # ==========================================================================
    
    required = ["waybill_no", "trip_no", "order_no", "po_no"]
    found = sum(1 for k in required if out["fields"].get(k))
    
    # destination can be satisfied by lane normalization
    if out["lane"].get("destination_norm") and _is_valid_location(out["lane"].get("destination_raw", "")):
        found += 1
    if out["lane"].get("origin_norm") and _is_valid_location(out["lane"].get("origin_raw", "")):
        found += 0.5  # Bonus for origin
    if out["fields"].get("req_truck_type"):
        found += 1
    
    denom = len(required) + 2  # + destination + truck_type
    out["confidence"] = min(1.0, round(found / denom, 4))

    if not out["fields"].get("trip_no"):
        out["flags"].append("TRIP_NO_MISSING")
    if not out["lane"].get("origin_norm") or not out["lane"].get("destination_norm"):
        out["flags"].append("LANE_INCOMPLETE")
    if not _is_valid_location(out["lane"].get("origin_raw", "")):
        out["flags"].append("ORIGIN_INVALID")
    if not _is_valid_location(out["lane"].get("destination_raw", "")):
        out["flags"].append("DESTINATION_INVALID")
    if out["confidence"] < 0.8:
        out["flags"].append("LOW_CONFIDENCE")

    return out


def extract_dsv_waybill_fields(pdf_path: Path, max_pages: int = 2) -> Dict[str, Any]:
    """Extract DSV Waybill fields from PDF (digital preferred, OCR not included)."""
    content = extract_pdf_content(pdf_path, max_pages=max_pages)
    if not content.get("success"):
        return {
            "doc_kind": "DSV_WAYBILL",
            "success": False,
            "error": content.get("error"),
            "confidence": 0.0,
            "fields": {},
            "lane": {},
            "timeline": {},
            "flags": ["PDF_TEXT_EXTRACT_FAILED"]
        }
    consignment = _extract_consignment_info_from_pdf(pdf_path, max_pages=max_pages)
    parsed = parse_dsv_waybill_from_text(content.get("text", ""), consignment=consignment)
    # Attach for transparency/debugging (downstream can ignore)
    if consignment:
        parsed["consignment_table"] = consignment
    parsed["success"] = True
    parsed["error"] = None
    return parsed


# =============================================================================
# Generic PDF Extraction Functions
# =============================================================================

def extract_pdf_content(pdf_path: Path, max_pages: int = 10, use_cache: bool = True) -> Dict[str, Any]:
    """
    Extract text content from PDF file with optional caching.
    
    v1.4: Added caching support for performance optimization.
    
    Args:
        pdf_path: Path to PDF file
        max_pages: Maximum number of pages to process (default: 10)
        use_cache: Whether to use caching (default: True)
    
    Returns:
        Dictionary with:
        - 'text': Full text content
        - 'pages': List of page texts
        - 'page_count': Total number of pages
        - 'success': Boolean indicating success
        - 'error': Error message if failed
        - 'cached': Boolean indicating if result was from cache (v1.4)
    """
    global _PDF_CONTENT_CACHE
    
    result = {
        'text': '',
        'pages': [],
        'page_count': 0,
        'success': False,
        'error': None,
        'cached': False
    }
    
    if not PDFPLUMBER_AVAILABLE:
        result['error'] = 'pdfplumber not installed'
        return result
    
    if not pdf_path.exists():
        result['error'] = f'PDF file not found: {pdf_path}'
        return result
    
    # v1.4: Check cache first
    cache_key = ""
    if use_cache:
        cache_key = _get_cache_key(pdf_path)
        if cache_key and cache_key in _PDF_CONTENT_CACHE:
            cached_result = _PDF_CONTENT_CACHE[cache_key].copy()
            cached_result['cached'] = True
            logging.debug(f"Cache hit for PDF: {pdf_path.name}")
            return cached_result
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            result['page_count'] = len(pdf.pages)
            pages_to_process = min(max_pages, result['page_count'])
            
            for i in range(pages_to_process):
                page = pdf.pages[i]
                page_text = page.extract_text()
                if page_text:
                    result['pages'].append(page_text)
                    result['text'] += page_text + '\n\n'
            
            result['success'] = True
            result['text'] = result['text'].strip()
            
    except Exception as e:
        result['error'] = str(e)
        logging.warning(f"Failed to extract PDF content from {pdf_path}: {e}")
    
    # v1.4: Store in cache if successful
    if use_cache and cache_key and result['success']:
        # Limit cache size
        if len(_PDF_CONTENT_CACHE) >= _CACHE_MAX_SIZE:
            # Remove oldest entry (first key)
            oldest_key = next(iter(_PDF_CONTENT_CACHE))
            del _PDF_CONTENT_CACHE[oldest_key]
            logging.debug(f"Cache full, removed oldest entry")
        
        _PDF_CONTENT_CACHE[cache_key] = result.copy()
        logging.debug(f"Cached PDF content: {pdf_path.name} (cache size: {len(_PDF_CONTENT_CACHE)})")
    
    return result


def extract_pdf_tables(pdf_path: Path, max_pages: int = 10) -> Dict[str, Any]:
    """
    Extract tables from PDF file.
    
    Args:
        pdf_path: Path to PDF file
        max_pages: Maximum number of pages to process (default: 10)
    
    Returns:
        Dictionary with:
        - 'tables': List of extracted tables (as DataFrames or dicts)
        - 'table_count': Number of tables found
        - 'success': Boolean indicating success
        - 'error': Error message if failed
    """
    result = {
        'tables': [],
        'table_count': 0,
        'success': False,
        'error': None
    }
    
    if not PDFPLUMBER_AVAILABLE:
        result['error'] = 'pdfplumber not installed'
        return result
    
    if not pdf_path.exists():
        result['error'] = f'PDF file not found: {pdf_path}'
        return result
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages_to_process = min(max_pages, len(pdf.pages))
            
            for i in range(pages_to_process):
                page = pdf.pages[i]
                tables = page.extract_tables()
                
                for table in tables:
                    if table and len(table) > 0:
                        # Convert table to list of dicts (first row as headers)
                        if len(table) > 1:
                            headers = table[0]
                            rows = table[1:]
                            table_dict = {
                                'headers': headers,
                                'rows': rows,
                                'page': i + 1
                            }
                            result['tables'].append(table_dict)
            
            result['table_count'] = len(result['tables'])
            result['success'] = True
            
    except Exception as e:
        result['error'] = str(e)
        logging.warning(f"Failed to extract tables from {pdf_path}: {e}")
    
    return result


def extract_shipment_info_from_pdf(pdf_path: Path) -> Dict[str, Any]:
    """
    Extract shipment-related information from PDF content.
    
    This function looks for common patterns in invoice/shipping documents:
    - Shipment IDs (HVDC-ADOPT-*, HVDC-DSV-*, etc.)
    - Document numbers
    - Dates
    - Amounts
    
    Args:
        pdf_path: Path to PDF file
    
    Returns:
        Dictionary with extracted information:
        - 'shipment_ids': List of found shipment IDs
        - 'document_numbers': List of document numbers
        - 'dates': List of dates found
        - 'amounts': List of amounts found
        - 'text_snippet': Relevant text snippet
    """
    result = {
        'shipment_ids': [],
        'document_numbers': [],
        'dates': [],
        'amounts': [],
        'text_snippet': '',
        'success': False
    }
    
    content = extract_pdf_content(pdf_path, max_pages=5)
    
    if not content['success']:
        return result
    
    text = content['text']
    result['text_snippet'] = text[:500] if len(text) > 500 else text
    
    # Extract shipment IDs (HVDC-ADOPT-*, HVDC-DSV-*, etc.)
    shipment_patterns = [
        r'HVDC-ADOPT-[A-Z0-9-]+',
        r'HVDC-DSV-[A-Z0-9-]+',
        r'HVDC-[A-Z0-9-]+',
        r'SCT-\d+',
        r'HE-\d+',
        r'SIM-\d+',
        r'MOSB-\d+',
        r'MIR-\d+',
        r'SHU-\d+'
    ]
    
    for pattern in shipment_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        result['shipment_ids'].extend(matches)
    
    # Remove duplicates while preserving order
    result['shipment_ids'] = list(dict.fromkeys(result['shipment_ids']))
    
    # Extract document numbers (BOE, DO, DN numbers)
    doc_patterns = [
        r'BOE\s*[#:]?\s*([A-Z0-9-]+)',
        r'DO\s*[#:]?\s*([A-Z0-9-]+)',
        r'DN\s*[#:]?\s*([A-Z0-9-]+)',
        r'Bill\s+of\s+Entry\s*[#:]?\s*([A-Z0-9-]+)',
        r'Delivery\s+Order\s*[#:]?\s*([A-Z0-9-]+)'
    ]
    
    for pattern in doc_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        result['document_numbers'].extend(matches)
    
    # Extract dates (common formats)
    date_patterns = [
        r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}',
        r'\d{4}[/-]\d{1,2}[/-]\d{1,2}',
        r'\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}'
    ]
    
    for pattern in date_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        result['dates'].extend(matches)
    
    # Extract amounts (USD, AED)
    amount_patterns = [
        r'USD\s*\$?\s*([\d,]+\.?\d*)',
        r'AED\s*\$?\s*([\d,]+\.?\d*)',
        r'\$\s*([\d,]+\.?\d*)',
        r'([\d,]+\.?\d*)\s*(USD|AED)'
    ]
    
    for pattern in amount_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        result['amounts'].extend([m[0] if isinstance(m, tuple) else m for m in matches])
    
    # Vendor-specific: DSV Delivery Note/Waybill evidence extraction
    try:
        if is_dsv_waybill_text(text):
            result['doc_kind'] = 'DSV_WAYBILL'
            consignment = _extract_consignment_info_from_pdf(pdf_path, max_pages=2)
            result['dsv_waybill'] = parse_dsv_waybill_from_text(text, consignment=consignment)
            if consignment:
                result['dsv_waybill']['consignment_table'] = consignment
            # Promote key identifiers to document_numbers for easier downstream joins
            for k in ('waybill_no', 'trip_no', 'order_no', 'job_no', 'po_no', 'do_no', 'bol_no'):
                v = result['dsv_waybill'].get('fields', {}).get(k)
                if v:
                    result['document_numbers'].append(v)
    except Exception as e:
        logging.debug(f"DSV waybill parse failed for {pdf_path}: {e}")

    result['success'] = True
    return result


def fuzzy_match_shipment_id(
    target_id: str,
    candidate_ids: List[str],
    threshold: int = 80
) -> Optional[Tuple[str, int]]:
    """
    Use fuzzy matching to find the best matching shipment ID.
    
    Args:
        target_id: The shipment ID to match
        candidate_ids: List of candidate shipment IDs
        threshold: Minimum similarity score (0-100, default: 80)
    
    Returns:
        Tuple of (matched_id, score) if match found above threshold, else None
    """
    if not RAPIDFUZZ_AVAILABLE:
        return None
    
    if not candidate_ids:
        return None
    
    try:
        # Use rapidfuzz to find best match
        result = process.extractOne(
            target_id,
            candidate_ids,
            scorer=fuzz.ratio
        )
        
        if result and result[1] >= threshold:
            return (result[0], result[1])
    except Exception as e:
        logging.warning(f"Fuzzy matching failed: {e}")
    
    return None


def match_pdf_to_shipment(
    pdf_path: Path,
    shipment_id: str,
    use_content: bool = True
) -> Dict[str, Any]:
    """
    Match PDF document to a shipment ID using both filename and content.
    
    Args:
        pdf_path: Path to PDF file
        shipment_id: Shipment ID to match against
        use_content: Whether to use PDF content for matching (default: True)
    
    Returns:
        Dictionary with matching results:
        - 'filename_match': Boolean - filename contains shipment_id
        - 'content_match': Boolean - content contains shipment_id
        - 'fuzzy_match': Tuple (matched_id, score) if fuzzy match found
        - 'extracted_info': Extracted shipment info from PDF
        - 'confidence': Overall confidence score (0-100)
    """
    result = {
        'filename_match': False,
        'content_match': False,
        'fuzzy_match': None,
        'extracted_info': None,
        'confidence': 0
    }
    
    # Filename matching (always performed)
    filename = pdf_path.name.upper()
    shipment_id_upper = shipment_id.upper()
    result['filename_match'] = shipment_id_upper in filename or filename in shipment_id_upper
    
    if result['filename_match']:
        result['confidence'] = 90
    
    # Content matching (if enabled and pdfplumber available)
    if use_content and PDFPLUMBER_AVAILABLE:
        try:
            extracted_info = extract_shipment_info_from_pdf(pdf_path)
            result['extracted_info'] = extracted_info
            
            if extracted_info['success']:
                # Check if shipment_id appears in extracted IDs
                extracted_ids = [id.upper() for id in extracted_info['shipment_ids']]
                
                if shipment_id_upper in extracted_ids:
                    result['content_match'] = True
                    result['confidence'] = 95
                elif RAPIDFUZZ_AVAILABLE:
                    # Try fuzzy matching
                    fuzzy_result = fuzzy_match_shipment_id(
                        shipment_id,
                        extracted_info['shipment_ids'],
                        threshold=75
                    )
                    if fuzzy_result:
                        result['fuzzy_match'] = fuzzy_result
                        result['confidence'] = max(result['confidence'], fuzzy_result[1] - 10)
        except Exception as e:
            logging.warning(f"Content matching failed for {pdf_path}: {e}")
    
    return result


def enhance_document_mapping(
    pdf_path: Path,
    shipment_id: str,
    doc_type: str = None
) -> Dict[str, Any]:
    """
    Enhance document mapping with PDF content extraction.
    
    This function extends the basic filename-based mapping with content extraction.
    Falls back gracefully if PDF processing fails.
    
    Args:
        pdf_path: Path to PDF file
        shipment_id: Shipment ID from filename
        doc_type: Document type from filename (optional)
    
    Returns:
        Enhanced document dictionary with:
        - All original fields (file_name, file_path, doc_type, file_size)
        - 'extracted_content': PDF text content (if available)
        - 'extracted_tables': Extracted tables (if available)
        - 'extracted_info': Shipment info from content
        - 'content_match': Whether content matches shipment_id
        - 'processing_success': Whether PDF processing succeeded
    """
    doc_info = {
        'file_name': pdf_path.name,
        'file_path': str(pdf_path),
        'doc_type': doc_type or 'Other',
        'file_size': pdf_path.stat().st_size if pdf_path.exists() else 0,
        'extracted_content': "",
        'extracted_tables': None,
        'extracted_info': None,
        'content_match': False,
        'processing_success': False
    }
    
    # Try to extract PDF content
    if PDFPLUMBER_AVAILABLE and pdf_path.exists():
        try:
            # Extract text content (first 3 pages for performance)
            content = extract_pdf_content(pdf_path, max_pages=3)
            if content['success']:
                doc_info['extracted_content'] = content['text'][:2000]  # Limit to 2000 chars
                doc_info['processing_success'] = True
            
            # Extract shipment info
            extracted_info = extract_shipment_info_from_pdf(pdf_path)
            if extracted_info['success']:
                doc_info['extracted_info'] = extracted_info
                if extracted_info.get('doc_kind') == 'DSV_WAYBILL' and extracted_info.get('dsv_waybill'):
                    doc_info['dsv_waybill'] = extracted_info['dsv_waybill']
                    # If doc_type not provided, mark it as evidence
                    if not doc_info.get('doc_type'):
                        doc_info['doc_type'] = 'DSV_WAYBILL'
                # Check if shipment_id matches extracted IDs
                extracted_ids = [id.upper() for id in extracted_info['shipment_ids']]
                if shipment_id.upper() in extracted_ids:
                    doc_info['content_match'] = True
            
            # Extract tables (optional, can be slow)
            # tables = extract_pdf_tables(pdf_path, max_pages=2)
            # if tables['success']:
            #     doc_info['extracted_tables'] = tables['tables']
        except Exception as e:
            logging.debug(f"PDF processing failed for {pdf_path}: {e}")
    
    return doc_info


# =============================================================================
# Version Info
# =============================================================================

__version__ = "1.4.1"
__changelog__ = """
v1.4.1 (2026-02-06):
  - Expanded invalid location patterns to block carrier/equipment contamination
  - Added origin cleaning helper and routing-section clean extraction
  - Added header-mapped consignment origin extraction with validation
  - Strengthened location validation (length bounds, priority keywords, address cues)

v1.2.1 (2026-02-06):
  - Fixed CONSIGNMENT INFORMATION parsing by extracting the table via pdfplumber
    (prevents header tokens like 'Job'/'PO'/'Loading' from being captured as values)
  - Prefer table-derived Loading Point as origin when present (e.g. 'DSV Mussafah Yard')
  - Table-aware DSV parsing is now used from extract_shipment_info_from_pdf

v1.2.0 (2026-02-05):
  - Fixed Origin/Destination extraction from DSV Waybill
  - Added _is_valid_location() validation function
  - Added section-based parsing: _extract_routing_section()
  - Added table-based extraction: _extract_lane_from_table()
  - Added exclusion list for invalid patterns (legal text, headers)
  - Added known valid location keywords for DSV UAE routes
  - Enhanced confidence scoring with lane validation
  - Added new flags: ORIGIN_INVALID, DESTINATION_INVALID
  - Added extraction_method tracking in lane dict
"""
