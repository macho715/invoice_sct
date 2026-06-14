"""NotebookLM answer extraction utilities.

Tolerates common NotebookLM artifacts (AI-GENERATED prefixes, markdown
fences, surrounding prose) and recovers a JSON object describing the
extracted document. When parsing fails after one retry, a clearly-flagged
low-confidence stub is returned so downstream code can keep the pipeline
running.
"""
from __future__ import annotations

import json
import re
from typing import Optional

_MARKER_PATTERN = re.compile(r"\[AI[-_]GENERATED\]", re.IGNORECASE)
_FENCE_PATTERN = re.compile(
    r"```"
    r"(?:json|JSON|[a-zA-Z]+)?"
    r"\s*\n?"
    r"(.*?)"
    r"\n?\s*"
    r"```",
    re.DOTALL,
)

_RETRY_SUFFIX = "\n\nReturn JSON only. No prose."

_STUB_FIELDS: dict[str, None] = {
    "invoice_no": None,
    "waybill_no": None,
    "do_no": None,
    "order_no": None,
    "job_no": None,
    "po_no": None,
    "bol_no": None,
    "trip_no": None,
    "loading_address": None,
    "destination": None,
    "origin_norm": None,
    "destination_norm": None,
    "amount": None,
    "currency": None,
}


def strip_notebooklm_markers(raw: str) -> str:
    """Remove NotebookLM-specific artifacts from raw answer text.

    Strips ``[AI-GENERATED]`` prefixes, markdown code fences
    (```` ```...``` ````) and any surrounding whitespace or stray prose
    markers, returning a clean string ready for JSON parsing.
    """
    if not raw:
        return ""
    text = _MARKER_PATTERN.sub("", raw)
    text = _FENCE_PATTERN.sub(r"\1", text)
    return text.strip()


def _safe_load(text: str) -> Optional[dict]:
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _first_balanced_json_object(text: str) -> Optional[str]:
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False

    for idx in range(start, len(text)):
        char = text[idx]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]

    return None


def extract_json(raw: str) -> Optional[dict]:
    """Try to extract a JSON object from a raw answer string.

    Strips NotebookLM markers first, then attempts ``json.loads`` on the
    whole string. If that fails, falls back to parsing the first balanced
    JSON object embedded in surrounding prose. Returns ``None`` if no valid
    JSON object is found.
    """
    text = strip_notebooklm_markers(raw)
    if not text:
        return None

    parsed = _safe_load(text)
    if parsed is not None:
        return parsed

    candidate = _first_balanced_json_object(text)
    if candidate is None:
        return None
    return _safe_load(candidate)


def _build_stub() -> dict:
    return {
        "doc_kind": "UNKNOWN",
        "fields": dict(_STUB_FIELDS),
        "lane": {"origin_raw": None, "destination_raw": None},
        "amounts": [],
        "shipment_ids": [],
        "document_numbers": [],
        "confidence": 0.0,
        "flags": ["JSON_PARSE_FAILED"],
        "evidence": [],
    }


def parse_extraction(answer: str) -> dict:
    """Parse a NotebookLM answer into the canonical extraction shape.

    Strips markers, attempts to extract JSON, and retries with a strict
    suffix hint if the first attempt fails. When both attempts fail, a
    low-confidence stub (``confidence=0.0``, ``flags=[JSON_PARSE_FAILED]``)
    is returned so the call site can distinguish a successful parse from
    a recoverable failure.
    """
    cleaned = strip_notebooklm_markers(answer)
    parsed = extract_json(cleaned)
    if parsed is not None:
        return parsed

    retry_text = strip_notebooklm_markers(answer + _RETRY_SUFFIX)
    parsed = extract_json(retry_text)
    if parsed is not None:
        return parsed

    return _build_stub()
