from __future__ import annotations

import csv
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


DEFAULT_ALIAS_PATH = Path(__file__).resolve().parent / "Data" / "site_alias_map.csv"


AliasMap = Dict[str, Dict[str, str]]
_CACHE: Dict[str, AliasMap] = {}


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    try:
        if value != value:
            return True
    except Exception:
        pass
    return str(value).strip() == ""


def clean_place_text(value: Any) -> str:
    """Return deterministic uppercase text without applying aliases."""
    if _is_blank(value):
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace("\u00a0", " ").replace("&", " AND ")
    text = text.upper()
    text = re.sub(r"[^A-Z0-9\s\-\(\)]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _clean_group(value: Any) -> str:
    if _is_blank(value):
        return ""
    text = unicodedata.normalize("NFKC", str(value)).strip().lower()
    text = re.sub(r"[^a-z0-9_]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def load_site_alias_map(path: Optional[Any] = None) -> AliasMap:
    alias_path = Path(path) if path else DEFAULT_ALIAS_PATH
    cache_key = str(alias_path.resolve()) if alias_path.exists() else str(alias_path)
    if cache_key in _CACHE:
        return _CACHE[cache_key]

    aliases: AliasMap = {}
    if not alias_path.exists():
        _CACHE[cache_key] = aliases
        return aliases

    with alias_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = clean_place_text(row.get("raw_place"))
            if not raw:
                continue
            aliases[raw] = {
                "normalized": clean_place_text(row.get("normalized_place")) or raw,
                "place_group": _clean_group(row.get("place_group")),
                "status": clean_place_text(row.get("status")).lower() or "active",
                "notes": str(row.get("notes") or "").strip(),
            }

    _CACHE[cache_key] = aliases
    return aliases


def normalize_place_with_source(value: Any, alias_map: Optional[AliasMap] = None) -> Tuple[str, str]:
    cleaned = clean_place_text(value)
    if not cleaned:
        return "", "blank"

    aliases = load_site_alias_map() if alias_map is None else alias_map
    record = aliases.get(cleaned)
    if not record:
        return cleaned, "fallback"

    group = record.get("place_group") or "site"
    status = record.get("status") or "active"
    if status == "active":
        return record.get("normalized") or cleaned, f"alias:{group}"
    if status == "review":
        return cleaned, f"review:{group}"
    return cleaned, f"blocked:{group}"


def normalize_place(value: Any, alias_map: Optional[AliasMap] = None) -> str:
    normalized, _source = normalize_place_with_source(value, alias_map)
    return normalized
