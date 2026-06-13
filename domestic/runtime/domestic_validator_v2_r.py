# CRITICAL: Import sys and Path FIRST, before any other imports
import sys
import argparse
from pathlib import Path
import os
from typing import Tuple, Dict, Any, List, Optional, Callable, cast, Set

try:
    from md_as_pdf_utils import (
        ROW_KEY_PREFIX,
        build_md_as_pdf_inventory,
        extract_hvdc_refs as _md_extract_hvdc_refs,
        extract_row_numbers_from_filename as _md_extract_row_numbers_from_filename,
        md_document_to_doc_info as _md_document_to_doc_info,
        normalize_ref as _md_normalize_ref,
        row_key as _md_row_key,
        unique_doc_infos as _md_unique_doc_infos,
    )
except Exception:
    ROW_KEY_PREFIX = "__ROW_SN__:"
    build_md_as_pdf_inventory: Optional[Callable[[Optional[Path]], List[Dict[str, Any]]]] = None  # type: ignore[no-redef]
    _md_extract_hvdc_refs: Optional[Callable[[str], List[str]]] = None  # type: ignore[no-redef]
    _md_extract_row_numbers_from_filename: Optional[Callable[[str], List[str]]] = None  # type: ignore[no-redef]
    _md_document_to_doc_info: Optional[Callable[[Path], Dict[str, Any]]] = None  # type: ignore[no-redef]
    def _md_normalize_ref(value: Any) -> str:
        return str(value or "").strip().upper().replace("/", "-")
    def _md_row_key(value: Any) -> str:
        return ROW_KEY_PREFIX + str(value or "").strip().lstrip("0")

    def _md_unique_doc_infos(docs: Any) -> List[Any]:  # type: ignore[misc]
        return list(docs)


# Add utils directories early. Prefer explicit env var, then local/parent layouts,
# and keep the legacy absolute path as a last candidate for existing Windows runs.
_SCRIPT_DIR = Path(__file__).resolve().parent
for _utils_path in [
    Path(os.environ["HVDC_UTILS_PATH"]) if os.environ.get("HVDC_UTILS_PATH") else None,
    _SCRIPT_DIR / "utils",
    _SCRIPT_DIR.parent / "utils",
    Path("C:/cursor mcp/HVDC_Invoice_Audit/utils"),
]:
    if _utils_path and _utils_path.exists() and str(_utils_path) not in sys.path:
        sys.path.insert(0, str(_utils_path))

# NOW import everything else (intentionally after sys.path setup → E402 expected)
import json  # noqa: E402
import hashlib  # noqa: E402
import re  # noqa: E402
import pandas as pd  # noqa: E402
import numpy as np  # noqa: E402
import logging  # noqa: E402

# Common domestic place normalization (optional - graceful fallback if unavailable)
try:
    from place_normalizer import (
        clean_place_text as common_clean_place_text,
        normalize_place as common_normalize_place,
        normalize_place_with_source as common_normalize_place_with_source,
    )

    PLACE_NORMALIZER_AVAILABLE = True
except ImportError:
    PLACE_NORMALIZER_AVAILABLE = False
    common_clean_place_text: Optional[Callable[[Any], str]] = None  # type: ignore[no-redef]
    common_normalize_place: Optional[Callable[[Any, Optional[Dict[str, Dict[str, str]]]], str]] = None  # type: ignore[no-redef]
    common_normalize_place_with_source: Optional[Callable[[Any, Optional[Dict[str, Dict[str, str]]]], Tuple[str, str]]] = None  # type: ignore[no-redef]

# Lane Matcher integration (optional - graceful fallback if not available)
try:
    from lane_matcher_costguard_r import LaneMatcher, load_lane_rows

    LANE_MATCHER_AVAILABLE = True
except ImportError:
    LANE_MATCHER_AVAILABLE = False
    logging.info("Lane Matcher not available. Using legacy matching.")

# PDF processing utilities (optional - graceful fallback if not available)
PDF_PROCESSING_AVAILABLE = False
extract_dsv_waybill_fields = None
enhance_document_mapping = None
match_pdf_to_shipment = None
pdf_import_error = None

DEBUG_SHIPMENT_ID = os.getenv("HVDC_DEBUG_SHIPMENT_ID", "HVDC-DSV-HAU-MOSB-333")


def _debug_target(shipment_id: str) -> bool:
    return bool(DEBUG_SHIPMENT_ID) and shipment_id == DEBUG_SHIPMENT_ID


try:
    import pdf_processor_v1_2_dsv_patched as pdf_proc

    PDF_PROCESSING_AVAILABLE = True
    logging.info("PDF Parser v1.4.1 loaded successfully (Audit mode)")

    enhance_document_mapping = getattr(pdf_proc, "enhance_document_mapping", None)
    match_pdf_to_shipment = getattr(pdf_proc, "match_pdf_to_shipment", None)
    extract_dsv_waybill_fields = getattr(pdf_proc, "extract_dsv_waybill_fields", None)

except ImportError as e:
    pdf_import_error = f"v1.4.1: {e}"
    try:
        import pdf_processor_v1_1_dsv as pdf_proc

        PDF_PROCESSING_AVAILABLE = True
        logging.warning("PDF Parser v1.1 loaded (upgrade to v1.4.1 recommended)")

        enhance_document_mapping = getattr(pdf_proc, "enhance_document_mapping", None)
        match_pdf_to_shipment = getattr(pdf_proc, "match_pdf_to_shipment", None)
        extract_dsv_waybill_fields = getattr(
            pdf_proc, "extract_dsv_waybill_fields", None
        )

    except ImportError as e2:
        pdf_import_error += f", v1.1: {e2}"
        try:
            import pdf_processor as pdf_proc

            PDF_PROCESSING_AVAILABLE = True
            logging.warning("PDF Parser fallback version loaded")

            enhance_document_mapping = getattr(
                pdf_proc, "enhance_document_mapping", None
            )
            match_pdf_to_shipment = getattr(pdf_proc, "match_pdf_to_shipment", None)
            extract_dsv_waybill_fields = getattr(
                pdf_proc, "extract_dsv_waybill_fields", None
            )

        except ImportError as e3:
            pdf_import_error += f", fallback: {e3}"
            PDF_PROCESSING_AVAILABLE = False
            logging.error(f"PDF processor import failed: {pdf_import_error}")

try:
    from sklearn.ensemble import IsolationForest

    SKLEARN_OK = True
except Exception:
    SKLEARN_OK = False


# ---------- Utilities ----------
def sha256_of_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def pii_mask(text: str, mask_char: str = "•") -> str:
    if not isinstance(text, str):
        return text
    # lightweight token masking: emails, phone-like digits
    t = text
    t_obj = (
        pd.Series([t])
        .str.replace(
            r"[\w\.-]+@[\w\.-]+", lambda m: mask_char * len(m.group(0)), regex=True
        )
        .iloc[0]
    )
    t = cast(str, t_obj)
    t_obj2 = (
        pd.Series([t])
        .str.replace(
            r"\b(\+?\d[\d\-\s]{6,}\d)\b",
            lambda m: mask_char * len(m.group(0)),
            regex=True,
        )
        .iloc[0]
    )
    t = cast(str, t_obj2)
    return t


def abs_pct_diff(a: float, b: float) -> float:
    if b is None or b == 0 or pd.isna(b):
        return np.nan
    return (a - b) / b * 100.0


def band_of_delta(delta_pct: float, bands: Dict[str, float]) -> str:
    if pd.isna(delta_pct):
        return "UNKNOWN"
    ap = abs(delta_pct)
    if ap <= bands["pass"]:
        return "PASS"
    if ap <= bands["warn"]:
        return "WARN"
    if ap <= bands["high"]:
        return "HIGH"
    return "CRITICAL"


def winsorize_series(
    s: pd.Series, lower_q: float = 0.05, upper_q: float = 0.95
) -> pd.Series:
    lo, hi = s.quantile(lower_q), s.quantile(upper_q)
    return s.clip(lower=lo, upper=hi)


# ---------- Loaders ----------
def load_config(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        result: Any = json.load(f)
        return cast(Dict[str, Any], result)


def load_mapping_excel(mapping_path: str) -> Dict[str, pd.DataFrame]:
    xls = pd.ExcelFile(mapping_path)
    sheets = {}
    for name in [
        "NormalizationMap",
        "ApprovedLaneMap",
        "COST_GUARD_Standardized",
        "Unified_OD_Mapping_CG",
        "RefDestinationMap",
    ]:
        if name in xls.sheet_names:
            sheets[name] = pd.read_excel(mapping_path, sheet_name=name)
    return sheets


def build_normalizer(norm_df: pd.DataFrame) -> Dict[str, str]:
    m: Dict[str, str] = {}
    if norm_df is None or norm_df.empty:
        return m
    for _, row in norm_df.iterrows():
        raw = str(row.get("raw_place", "")).strip()
        norm = str(row.get("normalized", "")).strip()
        if raw:
            m[raw.lower()] = norm
    return m


def normalize_place(v: str, norm_map: Dict[str, str]) -> str:
    normalized, _source = normalize_place_with_source(v, norm_map)
    return normalized


def normalize_place_with_source(v: str, norm_map: Dict[str, str]) -> Tuple[str, str]:
    if not isinstance(v, str):
        return v, "non_string"
    key = v.strip().lower()
    if key in norm_map:
        return norm_map[key], "normalization_map"
    if PLACE_NORMALIZER_AVAILABLE and common_normalize_place_with_source is not None:
        return common_normalize_place_with_source(v)
    return v.strip(), "fallback"


def canonicalize_od(df: pd.DataFrame, norm_map: Dict[str, str]) -> pd.DataFrame:
    df = df.copy()
    for col in ["origin", "destination", "origin_norm", "destination_norm"]:
        if col in df.columns:
            df[col] = df[col].astype(str)
    origin_values = df.get(
        "origin", df.get("origin_norm", pd.Series("", index=df.index))
    )
    destination_values = df.get(
        "destination", df.get("destination_norm", pd.Series("", index=df.index))
    )
    origin_pairs = origin_values.apply(
        lambda x: normalize_place_with_source(x, norm_map)
    )
    destination_pairs = destination_values.apply(
        lambda x: normalize_place_with_source(x, norm_map)
    )
    df["origin_norm"] = origin_pairs.apply(lambda x: x[0])
    df["origin_norm_source"] = origin_pairs.apply(lambda x: x[1])
    df["destination_norm"] = destination_pairs.apply(lambda x: x[0])
    df["destination_norm_source"] = destination_pairs.apply(lambda x: x[1])
    return df


# ---------- Executed domestic rate ledger ----------
EXECUTED_REF_COLUMNS = [
    "executed_ref_rate_usd",
    "executed_ref_method",
    "executed_ref_delta_pct",
    "executed_ref_sample_count",
    "executed_ref_source",
    "executed_ref_verdict",
    "executed_ref_lane_key",
    "executed_ref_lane_id",
    "executed_ref_source_rows",
]


def _executed_norm_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value).strip().upper()
    text = text.replace("&", " AND ")
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


_EXECUTED_SITE_TOKEN_PATTERNS = {
    "MOSB": (r"\bMOSB\b",),
    "SHUWEIHAT": (r"\bSHUWEIHAT\b", r"\bSHU\b"),
    "MIRFA": (r"\bMIRFA\b",),
    "M44": (r"\bM44\b",),
    "MARKAZ": (r"\bMARKAZ\b",),
    "MINA_ZAYED": (r"\bMINA\b.*\bZAYED\b",),
    "JEBEL_ALI": (r"\bJEBEL\b.*\bALI\b",),
}


def _executed_raw_site_tokens(value: Any) -> set[str]:
    text = _executed_norm_text(value)
    tokens: set[str] = set()
    for token, patterns in _EXECUTED_SITE_TOKEN_PATTERNS.items():
        if any(re.search(pattern, text) for pattern in patterns):
            tokens.add(token)
    return tokens


def _executed_is_mixed_site(value: Any) -> bool:
    return len(_executed_raw_site_tokens(value)) > 1


def _executed_has_direct_mosb(value: Any) -> bool:
    return "MOSB" in _executed_raw_site_tokens(value)


def _executed_norm_place(value: Any) -> str:
    key_source = value
    raw_key = _executed_norm_text(value)
    if PLACE_NORMALIZER_AVAILABLE and common_normalize_place is not None:
        try:
            key_source = common_normalize_place(value)
        except Exception:
            key_source = value
    key = _executed_norm_text(key_source)
    raw_tokens = _executed_raw_site_tokens(raw_key)
    if "MOSB" in raw_tokens and len(raw_tokens) > 1:
        return raw_key
    if "MOSB" not in raw_tokens and "MASAOOD" in raw_key and "MUSSAFAH" in raw_key:
        return raw_key
    aliases = {
        "AL MASAOOD MOSB": "AL MASAOOD (MOSB)",
        "AL MASAOOD BERGUM ICAD": "AL MASAOOD (MOSB)",
        "SAMSUNG MOSB YARD": "AL MASAOOD (MOSB)",
        "MOSB YARD": "AL MASAOOD (MOSB)",
        "MOSB": "AL MASAOOD (MOSB)",
        "M44 WAREHOUSE": "M44 WAREHOUSE",
        "M44 WH": "M44 WAREHOUSE",
        "DSV M44 WH": "M44 WAREHOUSE",
        "DSV M44 WAREHOUSE": "M44 WAREHOUSE",
        "DSV MARKAZ": "AL MARKAZ WAREHOUSE",
        "AL MARKAZ": "AL MARKAZ WAREHOUSE",
        "AL MARKAZ WAREHOUSE": "AL MARKAZ WAREHOUSE",
        "SHUWEIHAT": "SHUWEIHAT SITE",
        "SHUWEIHAT POWER STATION": "SHUWEIHAT SITE",
        "MIRFA PMO SAMSUNG": "MIRFA SITE",
        "MIRFA": "MIRFA SITE",
        "MIRFA SITE": "MIRFA SITE",
        "MIRFA SITE SITE": "MIRFA SITE",
        "MINA ZAYED": "MINA ZAYED PORT",
        "MINA ZAYED FREE PORT": "MINA ZAYED PORT",
        "JDN MINA ZAYED": "MINA ZAYED PORT",
        "JEBEL ALI": "JEBEL ALI PORT",
    }
    if key in aliases:
        return aliases[key]
    if "MOSB" in key or "MASAOOD" in key:
        return "AL MASAOOD (MOSB)"
    if "MARKAZ" in key:
        return "AL MARKAZ WAREHOUSE"
    if "SHUWEIHAT" in key:
        return "SHUWEIHAT SITE"
    if "MIRFA" in key:
        return "MIRFA SITE"
    if "MINA" in key and "ZAYED" in key:
        return "MINA ZAYED PORT"
    if "JEBEL" in key and "ALI" in key:
        return "JEBEL ALI PORT"
    return key


def _executed_norm_vehicle(value: Any) -> str:
    key = _executed_norm_text(value)
    aliases = {
        "": "UNKNOWN",
        "3 TON PICKUP": "3 TON PU",
        "3 TON PICK UP": "3 TON PU",
        "3TON PU": "3 TON PU",
        "3 TON P U": "3 TON PU",
        "7 TON PICKUP": "7 TON PU",
        "7 TON PICK UP": "7 TON PU",
        "LOW BED": "LOWBED",
        "LOWBED": "LOWBED",
        "FLAT BED": "FLATBED",
        "FLATBED": "FLATBED",
        "FLATBED HAZMAT": "FLATBED (HAZMAT)",
        "FLATBED CICPA": "FLATBED (CICPA)",
        "3 TON PU HAZMAT": "3 TON PU (HAZMAT)",
    }
    return aliases.get(key, key or "UNKNOWN")


def _executed_float(value: Any) -> float:
    if value is None or pd.isna(value):
        return np.nan
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return np.nan


def _executed_round(value: Any, digits: int = 4) -> float:
    value = _executed_float(value)
    if pd.isna(value):
        return np.nan
    return round(float(value), digits)


def _executed_ref_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().upper())


def _unique_preserve_order(values: List[str]) -> List[str]:
    seen = set()
    output = []
    for value in values:
        if value and value not in seen:
            output.append(value)
            seen.add(value)
    return output


def _infer_shipment_prefix(parts: List[str]) -> Tuple[str, int]:
    """Infer a shipment prefix for abbreviated ledger references.

    Example: "HVDC-ADOPT-HE-0005, 0200" -> ("HVDC-ADOPT-HE-", 4).
    """
    for part in parts:
        match = re.search(r"^(.*?-)(\d+)(?:\D.*)?$", part.strip())
        if match and "HVDC" in match.group(1):
            return match.group(1), len(match.group(2))
    return "", 0


def _executed_shipment_ref_candidates(value: Any) -> List[str]:
    """Return exact and safely expanded shipment-reference candidates."""
    original = _executed_ref_key(value)
    if not original:
        return []

    normalized = re.sub(r"\s+(?:&|AND)\s+", ",", original)
    normalized = re.sub(r"[\r\n;/]+", ",", normalized)
    parts = [_executed_ref_key(part) for part in normalized.split(",")]
    parts = [part for part in parts if part]
    prefix, width = _infer_shipment_prefix(parts)

    candidates = [original]
    for part in parts:
        candidates.append(part)
        if not prefix or "HVDC" in part or "CNT" in part or "TRUCK" in part:
            continue
        match = re.match(r"^(\d+)(.*)$", part)
        if match:
            number = match.group(1).zfill(width) if width else match.group(1)
            suffix = match.group(2).strip()
            candidates.append(prefix + number + suffix)
    return _unique_preserve_order(candidates)


def _executed_canonical_lane_key(value: Any) -> str:
    lane_key = str(value or "").strip()
    parts = [part.strip() for part in lane_key.split("||")]
    if len(parts) == 3:
        return (
            f"{_executed_norm_place(parts[0])}||"
            f"{_executed_norm_place(parts[1])}||"
            f"{_executed_norm_vehicle(parts[2])}"
        )
    return lane_key


def _executed_lane_id_from_key(lane_key: Any) -> str:
    canonical = _executed_canonical_lane_key(lane_key)
    if not canonical:
        return ""
    digest = hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:10].upper()
    return f"EXEC-LANE-{digest}"


def _executed_ref_is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except Exception:
        pass
    if isinstance(value, str) and not value.strip():
        return True
    return False


def _executed_lane_key_from_row(row: pd.Series) -> str:
    origin = row.get("origin_norm", row.get("origin", row.get("place_loading", "")))
    destination = row.get(
        "destination_norm", row.get("destination", row.get("place_delivery", ""))
    )
    vehicle = row.get("vehicle", row.get("vehicle_type", ""))
    return f"{_executed_norm_place(origin)}||{_executed_norm_place(destination)}||{_executed_norm_vehicle(vehicle)}"


def load_executed_rate_ledger(path: str) -> Any:
    """Load supplemental executed-rate evidence from JSON or legacy Excel."""
    if not path:
        return None
    ledger_path = Path(path)
    if not ledger_path.exists():
        return None
    if ledger_path.suffix.lower() == ".json":
        with open(ledger_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("_ledger_path", str(ledger_path))
        return data
    return pd.read_excel(ledger_path)


def _executed_register_lane_candidate(
    refs: Dict[str, Any], lane_key: str, record: Dict[str, Any]
) -> None:
    refs.setdefault("lane_candidates", {}).setdefault(lane_key, []).append(record)
    existing = refs["lanes"].get(lane_key)
    if existing is None or int(record.get("sample_count") or 0) > int(
        existing.get("sample_count") or 0
    ):
        refs["lanes"][lane_key] = record


def _build_executed_reference(executed_ledger: Any) -> Dict[str, Any]:
    refs: Dict[str, Any] = {
        "shipments": cast(Dict[str, Any], {}),
        "lanes": cast(Dict[str, Any], {}),
        "lane_candidates": cast(Dict[str, Any], {}),
        "source": "",
    }
    if executed_ledger is None:
        return refs

    if isinstance(executed_ledger, dict):
        metadata = (
            executed_ledger.get("metadata", {})
            if isinstance(executed_ledger.get("metadata"), dict)
            else {}
        )
        refs["source"] = executed_ledger.get("_ledger_path") or metadata.get(
            "source_file", ""
        )

        for item in executed_ledger.get("shipment_summary", []) or []:
            rate = _executed_round(item.get("rate_usd_median"))
            if pd.isna(rate):
                continue
            lane_keys = [
                _executed_canonical_lane_key(key)
                for key in (item.get("lane_keys") or [])
                if str(key or "").strip()
            ]
            primary_lane_key = lane_keys[0] if lane_keys else ""
            record = {
                "rate": rate,
                "sample_count": int(item.get("sample_count") or 0),
                "lane_key": ";".join(lane_keys),
                "lane_id": _executed_lane_id_from_key(primary_lane_key),
                "source_rows": item.get("source_row_numbers") or [],
            }
            for shipment_ref in _executed_shipment_ref_candidates(
                item.get("shipment_reference")
            ):
                refs["shipments"][shipment_ref] = record

        for item in executed_ledger.get("lane_summary", []) or []:
            lane_key = _executed_canonical_lane_key(item.get("lane_key"))
            if not lane_key:
                lane_key = (
                    f"{_executed_norm_place(item.get('origin_key'))}||"
                    f"{_executed_norm_place(item.get('destination_key'))}||"
                    f"{_executed_norm_vehicle(item.get('vehicle_key'))}"
                )
            rate = _executed_round(item.get("rate_usd_median"))
            if not lane_key or pd.isna(rate):
                continue
            raw_lane_key = str(item.get("lane_key") or "").strip()
            raw_origin = str(item.get("origin_key") or "").strip()
            raw_destination = str(item.get("destination_key") or "").strip()
            raw_vehicle = str(item.get("vehicle_key") or "").strip()
            record = {
                "rate": rate,
                "sample_count": int(item.get("sample_count") or 0),
                "lane_key": lane_key,
                "lane_id": _executed_lane_id_from_key(lane_key),
                "source_rows": item.get("source_row_numbers") or [],
                "raw_lane_key": raw_lane_key,
                "raw_origin": raw_origin,
                "raw_destination": raw_destination,
                "raw_vehicle": raw_vehicle,
            }
            _executed_register_lane_candidate(refs, lane_key, record)
        return refs

    if isinstance(executed_ledger, pd.DataFrame) and not executed_ledger.empty:
        refs["source"] = "executed_ledger_dataframe"
        df = executed_ledger.copy()
        shipment_col = next(
            (
                c
                for c in [
                    "shipment_reference",
                    "shipment_ref",
                    "Shipment Reference",
                    "Ref",
                ]
                if c in df.columns
            ),
            None,
        )
        rate_col = next(
            (
                c
                for c in ["rate_usd", "Rate (USD)", "Rate", "median_rate_usd"]
                if c in df.columns
            ),
            None,
        )
        origin_col = next(
            (
                c
                for c in ["origin", "origin_norm", "place_loading", "Place of Loading"]
                if c in df.columns
            ),
            None,
        )
        dest_col = next(
            (
                c
                for c in [
                    "destination",
                    "destination_norm",
                    "place_delivery",
                    "Place of Delivery",
                ]
                if c in df.columns
            ),
            None,
        )
        vehicle_col = next(
            (c for c in ["vehicle", "vehicle_type", "Vehicle Type"] if c in df.columns),
            None,
        )

        if shipment_col and rate_col:
            for shipment_ref, group in df.groupby(
                df[shipment_col].astype(str).str.strip().str.upper(), dropna=False
            ):
                rates = pd.to_numeric(group[rate_col], errors="coerce").dropna()
                if shipment_ref and not rates.empty:
                    lane_key = ""
                    if origin_col and dest_col and vehicle_col:
                        first = group.iloc[0]
                        lane_key = (
                            f"{_executed_norm_place(first.get(origin_col))}||"
                            f"{_executed_norm_place(first.get(dest_col))}||"
                            f"{_executed_norm_vehicle(first.get(vehicle_col))}"
                        )
                    record = {
                        "rate": round(float(rates.median()), 4),
                        "sample_count": int(len(group)),
                        "lane_key": lane_key,
                        "lane_id": _executed_lane_id_from_key(lane_key),
                        "source_rows": [int(i) + 2 for i in group.index.tolist()],
                    }
                    for candidate in _executed_shipment_ref_candidates(shipment_ref):
                        refs["shipments"][candidate] = record

        if origin_col and dest_col and vehicle_col and rate_col:
            work = df[[origin_col, dest_col, vehicle_col, rate_col]].copy()
            work["_lane_key"] = work.apply(
                lambda r: (
                    f"{_executed_norm_place(r[origin_col])}||{_executed_norm_place(r[dest_col])}||{_executed_norm_vehicle(r[vehicle_col])}"
                ),
                axis=1,
            )
            for lane_key, group in work.groupby("_lane_key", dropna=False):
                rates = pd.to_numeric(group[rate_col], errors="coerce").dropna()
                if lane_key and not rates.empty:
                    refs["lanes"][lane_key] = {
                        "rate": round(float(rates.median()), 4),
                        "sample_count": int(len(group)),
                        "lane_key": lane_key,
                        "lane_id": _executed_lane_id_from_key(lane_key),
                        "source_rows": [int(i) + 2 for i in group.index.tolist()],
                    }
    return refs


def _executed_verdict(delta_pct: float, sample_count: int, method: str) -> str:
    if pd.isna(delta_pct):
        return "REVIEW"
    if method == "lane_median" and sample_count < 3:
        return "REVIEW"
    abs_delta = abs(float(delta_pct))
    if abs_delta <= 2.0:
        return "PASS"
    if abs_delta <= 5.0:
        return "WATCH"
    if abs_delta <= 10.0:
        return "REVIEW"
    return "FAIL"


def _executed_abs_delta(actual_rate: Any, ref_rate: Any) -> float:
    actual = _executed_round(actual_rate)
    ref = _executed_round(ref_rate)
    if pd.isna(actual) or pd.isna(ref):
        return np.nan
    return abs(abs_pct_diff(actual, ref))


def _should_promote_executed_ref(
    row: pd.Series, method: str, executed_rate: Any
) -> bool:
    existing_rate = row.get("ref_rate_usd", np.nan)
    existing_lane_id = str(row.get("ref_lane_id", "") or "").strip()

    if method.startswith("shipment_reference"):
        return True
    if _executed_ref_is_missing(existing_rate):
        return True
    if not existing_lane_id:
        return True

    current_delta = _executed_abs_delta(row.get("rate_usd"), existing_rate)
    executed_delta = _executed_abs_delta(row.get("rate_usd"), executed_rate)
    if pd.isna(executed_delta):
        return False
    if pd.isna(current_delta):
        return True
    return float(executed_delta) + 1e-6 < float(current_delta)


def _executed_invoice_raw_places(row: pd.Series) -> tuple[str, str]:
    origin = str(row.get("origin", row.get("place_loading", "")) or "")
    destination = str(row.get("destination", row.get("place_delivery", "")) or "")
    return origin, destination


def _executed_place_compatibility(invoice_place: Any, candidate_place: Any) -> int:
    invoice_tokens = _executed_raw_site_tokens(invoice_place)
    candidate_tokens = _executed_raw_site_tokens(candidate_place)
    if not invoice_tokens:
        return 0
    if invoice_tokens & candidate_tokens:
        return 4
    if "MOSB" in invoice_tokens and "MOSB" not in candidate_tokens:
        return -4
    return -1


def _executed_candidate_score(
    row: pd.Series, candidate: Dict[str, Any]
) -> Tuple[int, int, float]:
    invoice_origin, invoice_destination = _executed_invoice_raw_places(row)
    origin_score = _executed_place_compatibility(
        invoice_origin, candidate.get("raw_origin", "")
    )
    destination_score = _executed_place_compatibility(
        invoice_destination, candidate.get("raw_destination", "")
    )
    mixed_penalty = (
        2 if _executed_is_mixed_site(candidate.get("raw_destination", "")) else 0
    )
    actual_rate = _executed_round(row.get("rate_usd"))
    ref_rate = _executed_round(candidate.get("rate"))
    if pd.isna(actual_rate) or pd.isna(ref_rate):
        delta_score = -999999.0
    else:
        delta_score = -abs(float(actual_rate) - float(ref_rate))
    return (
        origin_score + destination_score - mixed_penalty,
        int(candidate.get("sample_count") or 0),
        delta_score,
    )


def _select_executed_lane_candidate(
    row: pd.Series, candidates: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    if not candidates:
        return None
    return max(
        candidates, key=lambda candidate: _executed_candidate_score(row, candidate)
    )


def apply_executed_rate_reference(
    df: pd.DataFrame,
    executed_ledger: Any,
    promote_to_ref: bool = False,
) -> pd.DataFrame:
    """Append executed-rate comparison columns and optionally promote them to ref_*."""
    out = df.copy()
    for col in EXECUTED_REF_COLUMNS:
        if col in ["executed_ref_rate_usd", "executed_ref_delta_pct"]:
            out[col] = np.nan
        elif col == "executed_ref_sample_count":
            out[col] = 0
        else:
            out[col] = ""
    out["executed_ref_method"] = "none"
    out["executed_ref_verdict"] = "NO_MATCH"

    if promote_to_ref:
        if "ref_rate_usd" not in out.columns:
            out["ref_rate_usd"] = np.nan
        if "ref_method" not in out.columns:
            out["ref_method"] = ""
        if "ref_lane_id" not in out.columns:
            out["ref_lane_id"] = ""
        if "ref_lane_key" not in out.columns:
            out["ref_lane_key"] = ""

    refs = _build_executed_reference(executed_ledger)
    if not refs["shipments"] and not refs["lanes"]:
        return out

    for idx, row in out.iterrows():
        shipment_ref_raw = row.get("shipment_ref", row.get("shipment_reference", ""))
        matched = None
        method = "none"
        for candidate_ref in _executed_shipment_ref_candidates(shipment_ref_raw):
            if candidate_ref in refs["shipments"]:
                matched = refs["shipments"][candidate_ref]
                exact_key = _executed_ref_key(shipment_ref_raw)
                method = (
                    "shipment_reference"
                    if candidate_ref == exact_key
                    else "shipment_reference_expanded"
                )
                break

        if matched is None:
            lane_key = _executed_lane_key_from_row(row)
            lane_candidates = refs.get("lane_candidates", {}).get(lane_key, [])
            matched = _select_executed_lane_candidate(row, lane_candidates)
            if matched is None and lane_key in refs["lanes"]:
                matched = refs["lanes"][lane_key]
            if matched is not None:
                method = "lane_median"

        if not matched:
            continue

        ref_rate = _executed_round(matched.get("rate"))
        actual_rate = _executed_round(row.get("rate_usd"))
        delta = (
            abs_pct_diff(actual_rate, ref_rate) if not pd.isna(actual_rate) else np.nan
        )
        sample_count = int(matched.get("sample_count") or 0)
        lane_key = str(matched.get("lane_key") or "")
        lane_id = str(
            matched.get("lane_id") or _executed_lane_id_from_key(lane_key) or ""
        )

        out.at[idx, "executed_ref_rate_usd"] = ref_rate
        out.at[idx, "executed_ref_method"] = method
        out.at[idx, "executed_ref_delta_pct"] = (
            round(float(delta), 4) if not pd.isna(delta) else np.nan
        )
        out.at[idx, "executed_ref_sample_count"] = sample_count
        out.at[idx, "executed_ref_source"] = refs.get("source", "")
        out.at[idx, "executed_ref_verdict"] = _executed_verdict(
            delta, sample_count, method
        )
        out.at[idx, "executed_ref_lane_key"] = lane_key
        out.at[idx, "executed_ref_lane_id"] = lane_id
        out.at[idx, "executed_ref_source_rows"] = ",".join(
            str(x) for x in matched.get("source_rows", [])
        )

        if promote_to_ref and _should_promote_executed_ref(row, method, ref_rate):
            out.at[idx, "ref_rate_usd"] = ref_rate
            out.at[idx, "ref_method"] = f"executed_{method}"
            out.at[idx, "ref_lane_id"] = lane_id
            out.at[idx, "ref_lane_key"] = lane_key

    return out


def _executed_is_blank(value: Any) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except Exception:
        pass
    text = str(value).strip()
    return text == "" or text.lower() in {"nan", "none", "null"}


def _split_executed_lane_key(lane_key: Any) -> Tuple[str, str, str]:
    text = str(lane_key or "").strip()
    if ";" in text:
        text = text.split(";", 1)[0].strip()
    parts = [part.strip() for part in text.split("||")]
    if len(parts) != 3:
        return "", "", ""
    return parts[0], parts[1], parts[2]


def backfill_primary_reference_from_executed(df: pd.DataFrame) -> pd.DataFrame:
    """Use executed-rate evidence as primary reference only when needed."""
    out = df.copy()
    if "executed_ref_rate_usd" not in out.columns:
        return out

    for col in [
        "ref_rate_usd",
        "ref_method",
        "ref_lane_alias",
        "ref_lane_id",
        "ref_origin_norm",
        "ref_dest_norm",
        "ref_vehicle_norm",
        "delta_pct",
    ]:
        if col not in out.columns:
            out[col] = np.nan if col in {"ref_rate_usd", "delta_pct"} else ""

    for idx, row in out.iterrows():
        executed_rate = _executed_round(row.get("executed_ref_rate_usd"))
        if pd.isna(executed_rate):
            continue

        executed_method = str(row.get("executed_ref_method", "")).strip()
        if executed_method not in {
            "shipment_reference",
            "shipment_reference_expanded",
            "lane_median",
        }:
            continue

        lane_key = str(row.get("executed_ref_lane_key", "") or "").strip()
        lane_id = str(row.get("executed_ref_lane_id", "") or "").strip()
        if lane_id and _executed_is_blank(row.get("ref_lane_id")):
            out.at[idx, "ref_lane_id"] = lane_id
        if lane_key and _executed_is_blank(row.get("ref_lane_alias")):
            out.at[idx, "ref_lane_alias"] = lane_key

        current_ref_rate = _executed_round(row.get("ref_rate_usd"))
        current_method = str(row.get("ref_method", "") or "").strip().lower()
        primary_missing = pd.isna(current_ref_rate) or current_method in {"", "none"}
        if not primary_missing:
            continue

        actual_rate = _executed_round(row.get("rate_usd"))
        delta = (
            abs_pct_diff(actual_rate, executed_rate)
            if not pd.isna(actual_rate)
            else np.nan
        )
        out.at[idx, "ref_rate_usd"] = executed_rate
        out.at[idx, "ref_method"] = f"executed_{executed_method}"
        out.at[idx, "delta_pct"] = (
            round(float(delta), 4) if not pd.isna(delta) else np.nan
        )

        origin, destination, vehicle = _split_executed_lane_key(lane_key)
        if origin and _executed_is_blank(row.get("ref_origin_norm")):
            out.at[idx, "ref_origin_norm"] = origin
        if destination and _executed_is_blank(row.get("ref_dest_norm")):
            out.at[idx, "ref_dest_norm"] = destination
        if vehicle and _executed_is_blank(row.get("ref_vehicle_norm")):
            out.at[idx, "ref_vehicle_norm"] = vehicle

    return out


# ---------- Baseline builder ----------
def build_baseline_from_approved(approved_df: pd.DataFrame) -> pd.DataFrame:
    # Robustify: drop empties, winsorize rate & distance buckets
    df = approved_df.copy()
    for c in [
        "origin",
        "destination",
        "vehicle",
        "unit",
        "median_rate_usd",
        "median_distance_km",
    ]:
        if c not in df.columns:
            df[c] = np.nan
    df = df.dropna(
        subset=["origin", "destination", "vehicle", "unit", "median_rate_usd"]
    )
    # ensure types
    df["median_rate_usd"] = pd.to_numeric(df["median_rate_usd"], errors="coerce")
    df["median_distance_km"] = pd.to_numeric(df["median_distance_km"], errors="coerce")

    # winsorize medians per (vehicle, unit)
    def _win_grp(g: pd.DataFrame) -> pd.DataFrame:
        g = g.copy()
        g["median_rate_usd"] = winsorize_series(
            g["median_rate_usd"].astype(float)
        ).round(2)
        return g

    df = df.groupby(["vehicle", "unit"], group_keys=False).apply(_win_grp)
    # index for fast join
    df["key"] = (
        df["origin"].str.strip()
        + "||"
        + df["destination"].str.strip()
        + "||"
        + df["vehicle"].str.strip()
        + "||"
        + df["unit"].str.strip()
    )
    return df


# ---------- Similarity model ----------
def similarity_score(
    row: pd.Series,
    cand: pd.Series,
    weights: Dict[str, float],
    dist_decay_km: float,
    rate_decay_pct: float,
) -> float:
    s = 0.0
    # exact matches for O/D/V
    s += (
        weights["origin"]
        if str(row["origin_norm"]).strip() == str(cand["origin"]).strip()
        else 0.0
    )
    s += (
        weights["destination"]
        if str(row["destination_norm"]).strip() == str(cand["destination"]).strip()
        else 0.0
    )
    s += (
        weights["vehicle"]
        if str(row["vehicle"]).strip() == str(cand["vehicle"]).strip()
        else 0.0
    )
    # distance closeness
    d_inv = row.get("distance_km", np.nan)
    d_c = cand.get("median_distance_km", np.nan)
    if not pd.isna(d_inv) and not pd.isna(d_c):
        diff = abs(float(d_inv) - float(d_c))
        closeness = max(0.0, 1.0 - (diff / float(dist_decay_km)))
        s += weights["distance"] * closeness
    # rate closeness (use invoice rate vs candidate baseline)
    r_inv = row.get("rate_usd", np.nan)
    r_c = cand.get("median_rate_usd", np.nan)
    if not pd.isna(r_inv) and not pd.isna(r_c) and r_c != 0:
        diff_pct = abs((float(r_inv) - float(r_c)) / float(r_c)) * 100.0
        closeness = max(0.0, 1.0 - (diff_pct / float(rate_decay_pct)))
        s += weights["rate"] * closeness
    return s


def find_best_ref(
    row: pd.Series,
    baseline_df: pd.DataFrame,
    cfg: Dict[str, Any],
    lane_matcher: Optional[Any] = None,
) -> Tuple[float, Dict[str, Any]]:
    """
    Find best reference rate using either LaneMatcher (if available) or legacy similarity matching.

    Args:
        row: Invoice row
        baseline_df: Baseline DataFrame (legacy fallback)
        cfg: Config dictionary
        lane_matcher: Optional LaneMatcher instance

    Returns:
        Tuple of (ref_rate, metadata_dict)
    """
    # Try LaneMatcher first if available and enabled
    if lane_matcher is not None and cfg.get("lane_matcher", {}).get("enabled", False):
        try:
            # Get raw values from row (before normalization)
            raw_origin = str(row.get("origin", row.get("origin_norm", "")))
            raw_dest = str(row.get("destination", row.get("destination_norm", "")))
            raw_vehicle = str(row.get("vehicle", ""))
            unit = str(row.get("unit", "per truck"))

            # Use LaneMatcher
            match_result = lane_matcher.match(
                raw_origin=raw_origin,
                raw_dest=raw_dest,
                raw_vehicle=raw_vehicle,
                unit=unit,
                learn=cfg.get("lane_matcher", {}).get("learn_aliases", False),
                topk=5,
                invoice_rate_usd=row.get("rate_usd"),
            )
            if match_result.get("matched", False):
                conf = float(match_result.get("confidence", 0.0) or 0.0)
                min_conf = float(
                    cfg.get("lane_matcher", {}).get("min_confidence", 0.70)
                )
                ref_rate = float(match_result.get("std_rate_usd", np.nan))

                # Best-effort: ref_rate가 유효하면 신뢰도와 무관하게 반환하되,
                # low-confidence는 메타데이터로 표시하여 RBR/PENDING_REVIEW로 처리 가능.
                if pd.notna(ref_rate) and ref_rate > 0:
                    method = str(match_result.get("method", "LANE_MATCHER"))
                    low_conf = conf < min_conf
                    if low_conf and "LOWCONF" not in method:
                        method = method + "_LOWCONF_ACCEPTED"

                    return (
                        ref_rate,
                        {
                            "method": method,
                            "lane_id": match_result.get("lane_id", ""),
                            "lane_key": match_result.get("lane_key", ""),
                            "confidence": conf,
                            "min_confidence": min_conf,
                            "low_confidence": low_conf,
                            "origin_norm": match_result.get("origin_norm", ""),
                            "dest_norm": match_result.get("dest_norm", ""),
                            "vehicle_norm": match_result.get("vehicle_norm", ""),
                            "direction": match_result.get("direction", ""),
                            "candidates": match_result.get("candidates", []),
                        },
                    )
        except Exception:
            # Fallback to legacy if LaneMatcher fails
            pass

    # Legacy similarity matching (fallback)
    weights = cfg["similarity"]["weights"]
    dist_decay_km = cfg["similarity"]["distance_decay_km"]
    rate_decay_pct = cfg["similarity"]["rate_decay_pct"]
    thr = cfg["similarity"]["edge_threshold"]

    # First try direct key
    key = f"{row['origin_norm']}||{row['destination_norm']}||{row['vehicle']}||{row['unit']}"
    direct = baseline_df[baseline_df["key"] == key]
    if not direct.empty:
        cand = direct.iloc[0].to_dict()
        return float(cand["median_rate_usd"]), {
            "method": "direct",
            "alias": cand.get("alias"),
            "lane_id": cand.get("lane_id"),
            "lane_key": cand.get("key"),
        }

    # Else similarity search within same vehicle+unit bucket to keep apples-to-apples
    pool = baseline_df[
        (baseline_df["vehicle"] == row["vehicle"])
        & (baseline_df["unit"] == row["unit"])
    ]
    if pool.empty:
        pool = baseline_df.copy()

    best = None
    best_score = -1.0
    for _, cand in pool.iterrows():
        score = similarity_score(row, cand, weights, dist_decay_km, rate_decay_pct)
        if score >= thr and score > best_score:
            best = cand
            best_score = score
    if best is not None:
        return float(best["median_rate_usd"]), {
            "method": "similarity",
            "score": round(best_score, 3),
            "alias": best.get("alias"),
            "lane_id": best.get("lane_id"),
            "lane_key": best.get("key"),
        }
    return (np.nan, {"method": "none"})


# ---------- Special zone router ----------
def build_special_key(
    origin_norm: str, destination_norm: str, vehicle: str, unit: str
) -> str:
    return f"{origin_norm}||{destination_norm}||{vehicle}||{unit}"


def build_special_set(ledger_df: pd.DataFrame) -> Set[str]:
    if ledger_df is None or not isinstance(ledger_df, pd.DataFrame) or ledger_df.empty:
        return set()
    cols = {c.lower(): c for c in ledger_df.columns}
    # Try to map likely columns
    on = cols.get("origin_norm", cols.get("origin", None))
    dn = cols.get("destination_norm", cols.get("destination", None))
    v = cols.get("vehicle", None)
    u = cols.get("unit", None)
    special = set()
    if on and dn and v:
        if u is None and "unit" not in cols:
            u = "per truck"
        for _, r in ledger_df.iterrows():
            key = build_special_key(
                str(r[on]).strip(),
                str(r[dn]).strip(),
                str(r[v]).strip(),
                str(r.get(u, "per truck")).strip(),
            )
            special.add(key)
    return special


# ---------- Supporting Documents Mapping ----------
def extract_domestic_shipment_id(filename: str) -> Optional[str]:
    """DOMESTIC 형식 파일명 또는 텍스트에서 Shipment ID 추출.

    Autopatch 2026-06-07:
    - 기존 DSV/ADOPT 전용 패턴 외에 AGI/ALS 등 모든 HVDC domestic ref를 허용합니다.
    - 예: HVDC-AGI-ALS-390, HVDC-Kizad-DSV-MOSB-345, HVDC-DSV-SCT/SIM-MOSB-346
    """
    if not filename:
        return None

    text = str(filename).strip()
    if text and text[0].isdigit():
        parts = text.split(".", 1)
        if len(parts) > 1 and parts[0].strip().isdigit():
            text = parts[1].strip()

    text = text.replace("_", " ").replace(".pdf", " ").replace(".md", " ")
    text = text.replace("/", "-")

    # General HVDC ref: at least two alpha/numeric tokens after HVDC and a numeric tail.
    # Stop before common document suffixes or whitespace punctuation.
    match = re.search(
        r"(HVDC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+)",
        text,
        flags=re.IGNORECASE,
    )
    if match:
        return match.group(1).upper().strip()

    return None


def extract_doc_type_domestic(filename: str) -> str:
    """DOMESTIC 파일명에서 문서 타입 추출."""
    fn_upper = str(filename or "").upper()
    if (
        "_DN" in fn_upper
        or "DELIVERY NOTE" in fn_upper
        or "WAYBILL" in fn_upper
        or "POD" in fn_upper
    ):
        return "DN"
    elif "BOE" in fn_upper:
        return "BOE"
    elif "DO" in fn_upper and "DN" not in fn_upper:
        return "DO"
    elif "INVOICE" in fn_upper:
        return "Invoice"
    else:
        return "Other"


INVALID_ORIGIN_DEST_PATTERNS = [
    r"customer.*name.*address",
    r"customer\s*(?:name|account|address)",
    r"account\s*(?:no|number)",
    r"terms.*conditions",
    r"validity",
    r"same validity",
    r"job\s*no",
    r"^location\b",
    r"shipper|consignee|invoice",
    r"n\s*-\s*cd",
]


def _is_invalid_location(value: str) -> bool:
    if not value:
        return True
    value = str(value).strip()
    if not value:
        return True
    if len(value) > 160:
        return True
    for pattern in INVALID_ORIGIN_DEST_PATTERNS:
        if re.search(pattern, value, re.IGNORECASE):
            return True
    return False


def extract_pdf_fields(extracted_content: str) -> Dict[str, Any]:
    """PDF에서 추출한 텍스트에서 구조화된 필드 추출

    Args:
        extracted_content: PDF에서 추출한 전체 텍스트

    Returns:
        구조화된 필드 딕셔너리
    """
    if not extracted_content or not isinstance(extracted_content, str):
        return {}

    fields = {}
    extracted_content.upper()

    # Delivery Note 번호 추출
    # 패턴: "Note/Waybill#: 1025-34584AUH" 또는 "Waybill#: 1125-00256AUH"
    dn_patterns = [
        r"Note/Waybill#:\s*(\d+-\d+[A-Z]+)",
        r"Waybill#:\s*(\d+-\d+[A-Z]+)",
        r"Note#:\s*(\d+-\d+[A-Z]+)",
        r"DN\s*#:\s*(\d+-\d+[A-Z]+)",
    ]
    for pattern in dn_patterns:
        match = re.search(pattern, extracted_content, re.IGNORECASE)
        if match:
            fields["dn_number"] = match.group(1).strip()
            break

    # 발행일자 추출
    # 패턴: "Printed Date:12/12/2025" 또는 "Date: 12/12/2025"
    date_patterns = [
        r"Printed\s+Date:\s*(\d{2}/\d{2}/\d{4})",
        r"Date:\s*(\d{2}/\d{2}/\d{4})",
        r"Issue\s+Date:\s*(\d{2}/\d{2}/\d{4})",
    ]
    for pattern in date_patterns:
        match = re.search(pattern, extracted_content, re.IGNORECASE)
        if match:
            fields["issue_date"] = match.group(1).strip()
            break

    # 출발지/도착지 추출 (간단한 패턴 매칭)
    # "Place of Loading" 또는 "From" 키워드 찾기
    origin_keywords = ["Place of Loading", "From", "Origin", "POL"]
    destination_keywords = ["Place of Delivery", "To", "Destination", "POD"]

    for keyword in origin_keywords:
        pattern = rf"(?im)^\s*{re.escape(keyword)}\s*:\s*([^\n\r]+)\s*$"
        match = re.search(pattern, extracted_content, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if _is_invalid_location(candidate):
                continue
            fields["origin_from_pdf"] = candidate
            break

    for keyword in destination_keywords:
        pattern = rf"(?im)^\s*{re.escape(keyword)}\s*:\s*([^\n\r]+)\s*$"
        match = re.search(pattern, extracted_content, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if _is_invalid_location(candidate):
                continue
            fields["destination_from_pdf"] = candidate
            break

    # 내용 요약 (첫 200자)
    if len(extracted_content) > 200:
        fields["content_summary"] = extracted_content[:200].strip() + "..."
    else:
        fields["content_summary"] = extracted_content.strip()

    return fields


def _extract_md_waybill_fields(md_file: Path) -> Dict[str, Any]:
    """Parse Markdown/text POD converted from a DSV waybill/PDF.

    This is deliberately lightweight: the original PDF parser is still used for
    PDF files, while MD files are treated as trusted text extracted from those
    PDFs.  The output shape mirrors the PDF mapping fields consumed downstream.
    """
    try:
        text = md_file.read_text(encoding="utf-8", errors="replace")
    except Exception:
        text = md_file.read_text(encoding="latin-1", errors="replace")

    fields = extract_pdf_fields(text) or {}

    waybill_numbers = re.findall(
        r"(?:Note/Waybill#|Waybill#|Note#)\s*:?\s*([0-9]{4}-[0-9A-Z-]+AUH)",
        text,
        flags=re.IGNORECASE,
    )
    if waybill_numbers and not fields.get("dn_number"):
        fields["dn_number"] = waybill_numbers[0].strip()

    # DSV waybill layout uses "Destination:" very reliably.
    dest_match = re.search(r"Destination:\s*([^\n\r|]+)", text, flags=re.IGNORECASE)
    if dest_match and not fields.get("destination_from_pdf"):
        candidate = dest_match.group(1).strip()
        if not _is_invalid_location(candidate):
            fields["destination_from_pdf"] = candidate

    # Loading point appears in the consignment table; capture useful one-line hints.
    loading_match = re.search(
        r"(?:Agility M44|DSV Mussafah|Samsung Mosb|Shuweihat|MIRFA|CICPA)[^\n\r|]{0,80}",
        text,
        flags=re.IGNORECASE,
    )
    if loading_match and not fields.get("origin_from_pdf"):
        candidate = loading_match.group(0).strip()
        if not _is_invalid_location(candidate):
            fields["origin_from_pdf"] = candidate

    trip_numbers = []
    lines = text.splitlines()
    for idx, line in enumerate(lines):
        if re.search(r"Trip\s*No\.?\s*:", line, flags=re.IGNORECASE):
            after = re.sub(
                r".*Trip\s*No\.?\s*:\s*", "", line, flags=re.IGNORECASE
            ).strip()
            candidates = [after] if after else []
            candidates.extend(lines[idx + 1 : idx + 4])
            for candidate in candidates:
                cleaned = re.sub(r"[^A-Za-z0-9-]", "", candidate.strip())
                if re.search(r"\d", cleaned) and len(cleaned) >= 6:
                    trip_numbers.append(cleaned)
                    break
    trip_numbers = list(dict.fromkeys(trip_numbers))

    approval_hits: List[str] = []
    for pattern in [
        r"AED\s*[\d,]+(?:\.\d+)?\s*(?:per|/)\s*(?:Trailer|Truck|Trip)",
        r"USD\s*[\d,]+(?:\.\d+)?\s*(?:per|/)\s*(?:Trailer|Truck|Trip)",
        r"Confirmed\.",
        r"kindly approve below charges",
    ]:
        approval_hits.extend(
            m.group(0).strip() for m in re.finditer(pattern, text, flags=re.IGNORECASE)
        )

    return {
        "extracted_content": text,
        "fields": fields,
        "waybill_numbers": list(dict.fromkeys(waybill_numbers)),
        "trip_numbers": trip_numbers,
        "approval_evidence": "; ".join(list(dict.fromkeys(approval_hits))[:8]),
        "origin_from_pdf": fields.get("origin_from_pdf", ""),
        "destination_from_pdf": fields.get("destination_from_pdf", ""),
        "waybill_no": fields.get("dn_number", ""),
    }


def map_supporting_documents(
    docs_path: Path,
    shipment_refs: Optional[List[str]] = None,
    use_pdf_content: bool = True,
) -> Dict[str, List[Dict[str, Any]]]:
    """증빙문서 매핑 생성 (PDF + MD/PDF-equivalent text).

    Patch 2026-06-07-MD-AS-PDF:
    - .md/.markdown files are treated as PDF text substitutes, not as a weaker
      auxiliary evidence class.
    - Filename row markers such as "_12 & 13. HVDC-..._POD.md" map to invoice
      S/N 12 and 13 using internal keys ``__ROW_SN__:12``.
    - Exact/partial shipment-ref matching remains first-class and is recorded
      separately from row-number fallback matching.
    """
    supporting_docs: Dict[str, List[Dict[str, Any]]] = {}
    pdf_content_enabled = PDF_PROCESSING_AVAILABLE and use_pdf_content

    if not docs_path or not Path(docs_path).exists():
        return supporting_docs

    docs_path = Path(docs_path)
    if pdf_content_enabled:
        print("[INFO] PDF content extraction enabled")
    else:
        print("[INFO] Filename/text-based matching enabled")
    print(
        "[INFO] MD files are treated as PDF-equivalent text evidence (MD_AS_PDF_TEXT)"
    )

    def _normalize_ref(ref: Any) -> str:
        try:
            return _md_normalize_ref(ref)
        except Exception:
            if not isinstance(ref, str):
                return ""
            return ref.strip().upper().replace("/", "-")

    normalized_invoice_refs = (
        [_normalize_ref(ref) for ref in shipment_refs]
        if shipment_refs is not None
        else None
    )

    def _match_to_invoice_ref(shipment_id: str) -> Optional[str]:
        normalized_id = _normalize_ref(shipment_id)
        if not normalized_id:
            return None
        if normalized_invoice_refs is None:
            return shipment_id
        for original, normalized_ref in zip(
            cast(List[str], shipment_refs), normalized_invoice_refs
        ):
            if not normalized_ref:
                continue
            if (
                normalized_id == normalized_ref
                or normalized_id in normalized_ref
                or normalized_ref in normalized_id
            ):
                return original
        return None

    def _append_doc(key: str, doc_info: Dict[str, Any]) -> None:
        if not key:
            return
        supporting_docs.setdefault(key, [])
        existing = {
            str(d.get("file_path") or d.get("file_name") or "")
            for d in supporting_docs[key]
        }
        doc_key = str(doc_info.get("file_path") or doc_info.get("file_name") or "")
        if doc_key not in existing:
            supporting_docs[key].append(dict(doc_info))

    try:
        doc_files = (
            list(docs_path.rglob("*.pdf"))
            + list(docs_path.rglob("*.md"))
            + list(docs_path.rglob("*.markdown"))
        )
        pdf_count = sum(1 for p in doc_files if p.suffix.lower() == ".pdf")
        md_count = sum(1 for p in doc_files if p.suffix.lower() in {".md", ".markdown"})
        print(
            f"[INFO] {docs_path.name}: {len(doc_files)} supporting document file(s) found (PDF={pdf_count}, MD_AS_PDF_TEXT={md_count})"
        )

        for doc_file in doc_files:
            suffix = doc_file.suffix.lower()
            text_for_ref = doc_file.name

            # Row markers are useful for MD/POD files converted from PDF bundles.
            row_numbers = []
            if callable(_md_extract_row_numbers_from_filename):
                try:
                    row_numbers = _md_extract_row_numbers_from_filename(doc_file.name)
                except Exception:
                    row_numbers = []

            if suffix in {".md", ".markdown"}:
                try:
                    if callable(_md_document_to_doc_info):
                        doc_info = _md_document_to_doc_info(doc_file)
                    else:
                        md_fields = _extract_md_waybill_fields(doc_file)
                        doc_info = {
                            "file_name": doc_file.name,
                            "file_path": str(doc_file),
                            "doc_type": extract_doc_type_domestic(doc_file.name),
                            "file_size": doc_file.stat().st_size,
                            "source_format": "MD_AS_PDF_TEXT",
                            "md_as_pdf_equivalent": True,
                            "extracted_content": md_fields.get("extracted_content", ""),
                            "content_match": True,
                            "processing_success": True,
                            "waybill_no": md_fields.get("waybill_no", ""),
                            "origin_from_pdf": md_fields.get("origin_from_pdf", ""),
                            "destination_from_pdf": md_fields.get(
                                "destination_from_pdf", ""
                            ),
                            "trip_numbers": md_fields.get("trip_numbers", []),
                            "waybill_numbers": md_fields.get("waybill_numbers", []),
                            "approval_evidence": md_fields.get("approval_evidence", ""),
                            "row_numbers": row_numbers,
                        }
                    doc_info["row_numbers"] = doc_info.get("row_numbers") or row_numbers
                    doc_info["source_format"] = "MD_AS_PDF_TEXT"
                    doc_info["md_as_pdf_equivalent"] = True
                    refs = doc_info.get("shipment_refs") or []
                    if not refs and callable(_md_extract_hvdc_refs):
                        refs = _md_extract_hvdc_refs(
                            doc_file.name
                            + "\n"
                            + str(doc_info.get("extracted_content", ""))[:100000]
                        )
                    if not refs:
                        shipment_id = extract_domestic_shipment_id(
                            doc_file.name
                            + "\n"
                            + str(doc_info.get("extracted_content", ""))[:100000]
                        )
                        refs = [shipment_id] if shipment_id else []
                except Exception as e:
                    doc_info = {
                        "file_name": doc_file.name,
                        "file_path": str(doc_file),
                        "doc_type": extract_doc_type_domestic(doc_file.name),
                        "file_size": doc_file.stat().st_size,
                        "source_format": "MD_AS_PDF_TEXT",
                        "md_as_pdf_equivalent": True,
                        "processing_success": False,
                        "processing_error": str(e),
                        "row_numbers": row_numbers,
                    }
                    refs = []
            else:
                shipment_id = extract_domestic_shipment_id(text_for_ref)
                refs = [shipment_id] if shipment_id else []
                doc_type = extract_doc_type_domestic(doc_file.name)
                doc_info = {
                    "file_name": doc_file.name,
                    "file_path": str(doc_file),
                    "doc_type": doc_type,
                    "file_size": doc_file.stat().st_size,
                    "extracted_content": "",
                    "source_format": suffix.lstrip("."),
                    "md_as_pdf_equivalent": False,
                    "row_numbers": row_numbers,
                }

                if pdf_content_enabled:
                    try:
                        enhanced_doc: Dict[str, Any] = {}
                        if callable(enhance_document_mapping):
                            enhanced_doc = (
                                enhance_document_mapping(
                                    doc_file,
                                    refs[0] if refs else "",
                                    doc_type,
                                )
                                or {}
                            )
                        dsv_fields = None
                        doc_info.update(
                            {
                                "extracted_content": enhanced_doc.get(
                                    "extracted_content"
                                )
                                or "",
                                "content_match": enhanced_doc.get(
                                    "content_match", False
                                ),
                                "processing_success": enhanced_doc.get(
                                    "processing_success", False
                                ),
                            }
                        )

                        if enhanced_doc.get("extracted_info"):
                            doc_info["extracted_info"] = enhanced_doc["extracted_info"]
                        if enhanced_doc.get("dsv_waybill"):
                            doc_info["dsv_waybill"] = enhanced_doc["dsv_waybill"]

                        if (
                            callable(extract_dsv_waybill_fields)
                            and doc_type in ["DN", "WAYBILL", "DO", "Other"]
                            and not doc_info.get("dsv_waybill")
                        ):
                            try:
                                dsv_fields = extract_dsv_waybill_fields(
                                    doc_file, max_pages=3
                                )
                                lane = dsv_fields.get("lane") or {}
                                if dsv_fields.get("success"):
                                    doc_info["dsv_waybill"] = dsv_fields
                                    if dsv_fields.get("fields", {}).get("waybill_no"):
                                        doc_info["waybill_no"] = dsv_fields["fields"][
                                            "waybill_no"
                                        ]
                                    doc_info["origin_from_pdf"] = (
                                        lane.get("origin_norm")
                                        or lane.get("origin_raw")
                                        or ""
                                    )
                                    doc_info["destination_from_pdf"] = (
                                        lane.get("destination_norm")
                                        or lane.get("destination_raw")
                                        or ""
                                    )
                            except Exception:
                                pass
                    except Exception as exc:
                        doc_info["processing_success"] = False
                        doc_info["processing_error"] = str(exc)

            keys: list[str] = []
            match_reasons: list[str] = []

            for ref in refs:
                matched_ref = _match_to_invoice_ref(ref)
                if matched_ref:
                    keys.append(str(matched_ref))
                    match_reasons.append("shipment_ref")
                elif normalized_invoice_refs is None and ref:
                    keys.append(str(ref))
                    match_reasons.append("shipment_ref")

            for sn in doc_info.get("row_numbers", []) or row_numbers:
                key = _md_row_key(sn)
                if key:
                    keys.append(key)
                    match_reasons.append("row_number")

            # Dedupe while preserving order.
            keys = list(dict.fromkeys(keys))
            match_reasons = list(dict.fromkeys(match_reasons))

            if not keys:
                continue

            doc_info["matched_by"] = ",".join(match_reasons)
            doc_info["mapped_keys"] = keys
            for key in keys:
                _append_doc(key, doc_info)

        total_docs = sum(len(docs) for docs in supporting_docs.values())
        content_matched = sum(
            1
            for docs in supporting_docs.values()
            for doc in docs
            if doc.get("content_match", False) or doc.get("md_as_pdf_equivalent", False)
        )
        row_key_count = len(
            [k for k in supporting_docs if str(k).startswith(ROW_KEY_PREFIX)]
        )
        ref_key_count = len(supporting_docs) - row_key_count
        print(
            f"Mapped {ref_key_count} shipment references and {row_key_count} row-number keys to supporting documents"
        )
        print(f"Total supporting files mapped: {total_docs}")
        if content_matched > 0:
            print(f"[INFO] content-based/MD-as-PDF matches: {content_matched} doc(s)")

    except Exception as e:
        print(f"Error mapping supporting documents: {e}")

    return supporting_docs


# ---------- Main validation ----------
def validate_domestic(
    invoice_df: pd.DataFrame,
    mapping_path: str,
    config_path: str,
    executed_ledger_df: Optional[pd.DataFrame] = None,
    supporting_docs: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> Tuple[pd.DataFrame, List[str], Dict[str, Any], str]:
    cfg = load_config(config_path)

    # Try to load mapping, but if not available, use invoice data itself
    try:
        sheets = load_mapping_excel(mapping_path)
        norm_map = build_normalizer(sheets.get("NormalizationMap", pd.DataFrame()))
        approved = sheets.get("ApprovedLaneMap", pd.DataFrame())
    except Exception:
        sheets = {}
        norm_map = {}
        approved = pd.DataFrame()

    # Normalize invoice rows
    df = invoice_df.copy()
    for col in ["rate_usd", "distance_km"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = canonicalize_od(df, norm_map)

    # Build baseline index. When executed-rate history is available and the
    # approved map is absent, do not validate invoice rows against themselves.
    executed_refs_probe = _build_executed_reference(executed_ledger_df)
    executed_refs_available = bool(
        executed_refs_probe["shipments"] or executed_refs_probe["lanes"]
    )
    if not approved.empty:
        baseline = build_baseline_from_approved(approved)
    elif executed_refs_available:
        baseline = pd.DataFrame(
            columns=[
                "origin",
                "destination",
                "vehicle",
                "unit",
                "median_rate_usd",
                "median_distance_km",
                "key",
                "alias",
                "lane_id",
            ]
        )
    else:
        # If no ApprovedLaneMap, build from invoice data itself (median per lane)
        grp = ["origin", "destination", "vehicle", "unit"]
        baseline = (
            df.groupby(grp, dropna=False)
            .agg(
                median_rate_usd=("rate_usd", "median"),
                median_distance_km=("distance_km", "median"),
            )
            .reset_index()
        )
        baseline["key"] = (
            baseline["origin"].astype(str).str.strip()
            + "||"
            + baseline["destination"].astype(str).str.strip()
            + "||"
            + baseline["vehicle"].astype(str).str.strip()
            + "||"
            + baseline["unit"].astype(str).str.strip()
        )
        baseline["alias"] = ""
        baseline["lane_id"] = ""

    # Special zones from executed ledger
    special_set = (
        build_special_set(executed_ledger_df)
        if cfg["special_zone"]["enabled"]
        else set()
    )

    # Initialize LaneMatcher if available and enabled
    lane_matcher = None
    if LANE_MATCHER_AVAILABLE and cfg.get("lane_matcher", {}).get("enabled", False):
        try:
            # Try to load ApprovedLaneMap_ENHANCED.json with robust path resolution
            script_dir = Path(__file__).parent
            root_dir = script_dir  # 02_DSV_DOMESTIC (domestic_validator_v2_r.py is in 02_DSV_DOMESTIC folder)
            generator_dir = root_dir / "SCNT HVDC Domestic Invoice v2.2 Generator"
            data_dir = root_dir / "Data"

            # Try multiple candidate paths (same as unified_pipeline.ps1)
            candidate_paths = [
                root_dir / "ApprovedLaneMap_ENHANCED.json",
                generator_dir / "ApprovedLaneMap_ENHANCED.json",
                data_dir / "ApprovedLaneMap_ENHANCED.json",
            ]

            # Also try the path from config if specified
            enhanced_lanemap_path = cfg.get("lane_matcher", {}).get(
                "enhanced_lanemap_path", None
            )
            if enhanced_lanemap_path:
                if not Path(enhanced_lanemap_path).is_absolute():
                    # Resolve relative path
                    rel_path = enhanced_lanemap_path.lstrip("./").lstrip("../")
                    config_path = Path(root_dir) / rel_path
                    candidate_paths.insert(0, config_path.resolve())  # type: ignore[attr-defined]
                else:
                    candidate_paths.insert(0, Path(enhanced_lanemap_path))

            # Find first existing path
            found_path = None
            for candidate in candidate_paths:
                if candidate.exists():
                    found_path = candidate
                    break

            if found_path:
                lanes = load_lane_rows(str(found_path))
                alias_path = cfg.get("lane_matcher", {}).get("alias_path")
                if alias_path and not Path(alias_path).is_absolute():
                    alias_path = str(script_dir / alias_path)
                lane_matcher = LaneMatcher(lanes, alias_path=alias_path)
                print(
                    f"[OK] LaneMatcher initialized: {len(lanes)} lane(s) loaded ({found_path})"
                )
            else:
                print("[WARN] ApprovedLaneMap_ENHANCED.json not found. Checked paths:")
                for candidate in candidate_paths:
                    print(f"   - {candidate}")
        except Exception as e:
            print(f"[WARN] LaneMatcher init failed (using existing matching): {e}")
            lane_matcher = None

    # Find ref & compute delta
    ref_rates = []
    ref_meta = []
    for _, row in df.iterrows():
        ref, meta = find_best_ref(row, baseline, cfg, lane_matcher=lane_matcher)
        ref_rates.append(ref)
        ref_meta.append(meta)
    df["ref_rate_usd"] = ref_rates
    df["ref_method"] = [m.get("method", "") for m in ref_meta]
    df["ref_lane_alias"] = [m.get("alias", "") for m in ref_meta]
    df["ref_lane_id"] = [m.get("lane_id", "") for m in ref_meta]
    df["ref_lane_key"] = [m.get("lane_key", "") for m in ref_meta]
    # LaneMatcher 추가 정보
    df["ref_confidence"] = [
        m.get("confidence", 0.0)
        if isinstance(m.get("confidence"), (int, float))
        else 0.0
        for m in ref_meta
    ]
    df["ref_origin_norm"] = [m.get("origin_norm", "") for m in ref_meta]
    df["ref_dest_norm"] = [m.get("dest_norm", "") for m in ref_meta]
    df["ref_vehicle_norm"] = [m.get("vehicle_norm", "") for m in ref_meta]
    # Supplemental executed-rate reference. Existing strong ApprovedLaneMap /
    # LaneMatcher refs are preserved, while exact shipment refs and weak/missing
    # primary refs can be promoted from executed-rate evidence.
    df = apply_executed_rate_reference(df, executed_ledger_df, promote_to_ref=True)
    df["delta_pct"] = df.apply(
        lambda r: abs_pct_diff(r["rate_usd"], r["ref_rate_usd"]), axis=1
    )

    # Bands
    bands = cfg["cost_guard_bands"]
    df["cg_band"] = df["delta_pct"].apply(lambda d: band_of_delta(d, bands))

    # Special pass override
    def _special_status(r: Any) -> Optional[str]:
        k = build_special_key(
            r["origin_norm"],
            r["destination_norm"],
            r["vehicle"],
            r["unit"] if "unit" in r else "per truck",
        )
        if k in special_set:
            return cast(str, cfg["special_zone"]["label"])
        return None

    df["special_status"] = df.apply(_special_status, axis=1)

    # Final verdict
    def final_verdict(row: Any) -> str:
        if row["special_status"]:
            return cast(str, row["special_status"])
        band = row["cg_band"]
        if pd.isna(band) or band == "UNKNOWN":
            return "PENDING_REVIEW"
        if band == "CRITICAL" and row["delta_pct"] > cfg["autofail_threshold_pct"]:
            return "FAIL"
        if band in ["HIGH", "WARN"]:
            return "PENDING_REVIEW"
        return "VERIFIED"

    df["verdict"] = df.apply(final_verdict, axis=1)

    # IsolationForest anomaly
    if cfg["isoforest"]["enabled"] and SKLEARN_OK:
        feats = df[["rate_usd", "distance_km"]].copy()
        feats = feats.fillna(feats.median(numeric_only=True))
        try:
            iso = IsolationForest(
                contamination=cfg["isoforest"]["contamination"],
                n_estimators=cfg["isoforest"]["n_estimators"],
                random_state=cfg["isoforest"]["random_state"],
            )
            iso.fit(feats)
            df["anomaly"] = (iso.predict(feats) == -1).astype(int)
        except Exception:
            df["anomaly"] = 0
    else:
        df["anomaly"] = 0

    # Short-run flags
    sr = cfg["short_run_rules"]
    df["short_run_flag"] = np.where(
        df["distance_km"] <= sr["short_run_thresh_km"], 1, 0
    )
    df["fixed_cost_suspect"] = np.where(
        df["distance_km"] <= sr["fixed_cost_suspect_km"], 1, 0
    )

    # Risk score (Δ normalized to autofail threshold; cert/signature placeholders = 0)
    af_thr = cfg["autofail_threshold_pct"]

    def _risk(row: Any) -> float:
        delta_norm = min(
            1.0,
            (abs(row["delta_pct"]) if not pd.isna(row["delta_pct"]) else 0.0) / af_thr,
        )
        anomaly = 1.0 if row.get("anomaly", 0) == 1 else 0.0
        cert_missing = 0.0
        sign_risk = 0.0
        w = cfg["risk_based_review"]["score_formula"]
        return cast(
            float,
            round(
                delta_norm * w["delta_weight"]
                + anomaly * w["anomaly_weight"]
                + cert_missing * w["cert_weight"]
                + sign_risk * w["signature_weight"],
                3,
            ),
        )

    df["risk_score"] = df.apply(_risk, axis=1)
    df["rbr_trigger"] = (
        df["risk_score"] >= cfg["risk_based_review"]["trigger_threshold"]
    )

    # Supporting documents mapping
    if supporting_docs is None:
        supporting_docs = {}

    # Add supporting document information to each row.
    # MD files are PDF-equivalent evidence.  They can match by shipment_ref or,
    # when converted POD bundles use invoice line numbers in filenames, by S/N.
    if supporting_docs is None:
        supporting_docs = {}

    def get_supporting_docs(row: Any) -> List[Dict[str, Any]]:
        shipment_ref = (
            str(row.get("shipment_ref", "")).strip() if "shipment_ref" in row else ""
        )
        sn_raw = str(row.get("S/N", row.get("sn", ""))).strip()
        sn_raw = re.sub(r"\.0$", "", sn_raw)
        docs = []

        if shipment_ref:
            # Try exact shipment_ref match first.
            if shipment_ref in supporting_docs:
                docs.extend(supporting_docs[shipment_ref])

            # Try normalized exact/partial match.
            norm_shipment_ref = _md_normalize_ref(shipment_ref)
            for ref_key, ref_docs in supporting_docs.items():
                if str(ref_key).startswith(ROW_KEY_PREFIX):
                    continue
                norm_ref_key = _md_normalize_ref(ref_key)
                if not norm_ref_key or not norm_shipment_ref:
                    continue
                if (
                    norm_shipment_ref == norm_ref_key
                    or norm_shipment_ref in norm_ref_key
                    or norm_ref_key in norm_shipment_ref
                ):
                    docs.extend(ref_docs)

        # Row-number fallback for MD-as-PDF PODs with filenames like
        # "_12 & 13. HVDC-..._POD.md".
        sn_key = _md_row_key(sn_raw)
        if sn_key and sn_key in supporting_docs:
            docs.extend(supporting_docs[sn_key])

        docs = _md_unique_doc_infos(docs)
        # Record row-level match quality without discarding row-number evidence.
        norm_ref_for_check = _md_normalize_ref(shipment_ref)
        for doc in docs:
            refs = doc.get("shipment_refs") or []
            if isinstance(refs, str):
                refs = [r for r in refs.split(",") if r]
            norm_refs = [_md_normalize_ref(r) for r in refs]
            doc["exact_shipment_ref_match"] = bool(
                norm_ref_for_check and norm_ref_for_check in norm_refs
            )
            if not doc.get("row_numbers") and doc.get("matched_by") == "row_number":
                doc["row_numbers"] = [sn_raw] if sn_raw else []
            if doc.get("md_as_pdf_equivalent"):
                doc["source_format"] = "MD_AS_PDF_TEXT"
        return docs

    df["supporting_docs_list"] = df.apply(
        lambda row: (
            json.dumps(get_supporting_docs(row), ensure_ascii=False)
            if get_supporting_docs(row)
            else ""
        ),
        axis=1,
    )
    df["evidence_count"] = df.apply(lambda row: len(get_supporting_docs(row)), axis=1)

    def _evidence_type_label(doc: Dict[str, Any]) -> str:
        doc_type = doc.get("doc_type", "Other")
        source_format = doc.get("source_format", "")
        if doc.get("md_as_pdf_equivalent") or source_format == "MD_AS_PDF_TEXT":
            return f"{doc_type}(MD_AS_PDF_TEXT)"
        return str(doc_type)

    df["evidence_types"] = df.apply(
        lambda row: (
            ",".join(
                sorted(
                    set(_evidence_type_label(doc) for doc in get_supporting_docs(row))
                )
            )
            if get_supporting_docs(row)
            else ""
        ),
        axis=1,
    )
    df["has_dn"] = df.apply(
        lambda row: any(
            doc.get("doc_type", "") == "DN"
            or bool(doc.get("waybill_no"))
            or bool(doc.get("waybill_numbers"))
            for doc in get_supporting_docs(row)
        ),
        axis=1,
    )

    # PDF 파서 결과 구조화 및 Excel 컬럼 추가
    def extract_pdf_data_for_row(row: Any) -> Dict[str, str]:
        """각 행에 대한 PDF 파서 결과 구조화"""
        docs = get_supporting_docs(row)
        shipment_ref_dbg = (
            str(row.get("shipment_ref", "")).strip() if "shipment_ref" in row else ""
        )
        if not docs:
            return {
                "pdf_dn_number": "",
                "pdf_issue_date": "",
                "pdf_origin": "",
                "pdf_destination": "",
                "pdf_content_summary": "",
                "pdf_extracted_fields": "",
            }

        # Prefer docs with v1.4.1 signals, then DN, then first doc
        def _doc_rank(doc: Dict[str, Any]) -> int:
            if doc.get("dsv_waybill"):
                return 0
            if any(
                doc.get(k)
                for k in ["origin_from_pdf", "destination_from_pdf", "waybill_no"]
            ):
                return 1
            if doc.get("doc_type") == "DN":
                return 2
            return 3

        sorted_docs = sorted(docs, key=_doc_rank)
        target_doc = sorted_docs[0]
        if _debug_target(shipment_ref_dbg):
            summary = [
                f"{d.get('file_name', '')}|{d.get('doc_type', '')}|dsv={bool(d.get('dsv_waybill'))}|"
                f"origin={d.get('origin_from_pdf', '')}|dest={d.get('destination_from_pdf', '')}|"
                f"len={len(d.get('extracted_content') or '')}"
                for d in sorted_docs
            ]
            print(f"[DEBUG][{shipment_ref_dbg}] docs_sorted=" + "; ".join(summary))
            print(
                f"[DEBUG][{shipment_ref_dbg}] target_doc={target_doc.get('file_name', '')} doc_type={target_doc.get('doc_type', '')}"
            )

        # Priority 1: use v1.4.1 extraction already attached by map_supporting_documents()
        dsv_result = target_doc.get("dsv_waybill")
        if isinstance(dsv_result, dict) and dsv_result:
            lane = cast(
                Dict[str, Any],
                dsv_result.get("lane")
                if isinstance(dsv_result.get("lane"), dict)
                else {},
            )
            fields = cast(
                Dict[str, Any],
                dsv_result.get("fields")
                if isinstance(dsv_result.get("fields"), dict)
                else {},
            )

            origin = (
                target_doc.get("origin_from_pdf")
                or lane.get("origin_norm")
                or lane.get("origin_raw")
                or fields.get("loading_address")
                or ""
            )
            destination = (
                target_doc.get("destination_from_pdf")
                or lane.get("destination_norm")
                or lane.get("destination_raw")
                or fields.get("destination")
                or ""
            )
            waybill_no = target_doc.get("waybill_no") or fields.get("waybill_no") or ""
            issue_date = (
                fields.get("printed_date")
                or fields.get("do_validity")
                or fields.get("issue_date")
                or ""
            )

            content_summary = target_doc.get("extracted_content") or ""
            if content_summary:
                content_summary = (
                    (content_summary[:200].strip() + "...")
                    if len(content_summary) > 200
                    else content_summary.strip()
                )

            md_evidence_payload = {}
            if (
                target_doc.get("md_as_pdf_equivalent")
                or target_doc.get("source_format") == "MD_AS_PDF_TEXT"
            ):
                md_evidence_payload = {
                    "source_sheet": "md_as_pdf_evidence",
                    "md_as_pdf_evidence": {
                        "file_name": target_doc.get("file_name", ""),
                        "file_path": target_doc.get("file_path", ""),
                        "source_format": target_doc.get(
                            "source_format", "MD_AS_PDF_TEXT"
                        ),
                        "doc_type": target_doc.get("doc_type", ""),
                        "row_numbers": target_doc.get("row_numbers", []),
                        "shipment_refs": target_doc.get("shipment_refs", []),
                        "waybill_numbers": target_doc.get("waybill_numbers", []),
                        "trip_numbers": target_doc.get("trip_numbers", []),
                        "first_waybill_no": waybill_no,
                        "issue_date": issue_date,
                        "origin": origin,
                        "destination": destination,
                        "content_summary": content_summary,
                        "md_as_pdf_equivalent": True,
                    },
                    "semantic_mapping": {
                        "pdf_dn_number": "first_waybill_no|waybill_no|dn_number",
                        "pdf_issue_date": "issue_date|printed_date",
                        "pdf_origin": "origin|origin_from_pdf|loading_address",
                        "pdf_destination": "destination|destination_from_pdf",
                        "pdf_content_summary": "content_summary|extracted_content",
                    },
                }

            extracted_fields_json = json.dumps(
                {
                    **dsv_result,
                    "v1_4_1_used": True,
                    "extraction_method": lane.get("extraction_method", "v1.4.1"),
                    **md_evidence_payload,
                },
                ensure_ascii=False,
            )

            return {
                "pdf_dn_number": waybill_no,
                "pdf_issue_date": issue_date,
                "pdf_origin": origin,
                "pdf_destination": destination,
                "pdf_content_summary": content_summary,
                "pdf_extracted_fields": extracted_fields_json,
            }

        # Priority 2: honor pre-extracted fields if they exist on the doc
        if any(
            target_doc.get(k)
            for k in ["origin_from_pdf", "destination_from_pdf", "waybill_no"]
        ):
            content_summary = target_doc.get("extracted_content") or ""
            if content_summary:
                content_summary = (
                    (content_summary[:200].strip() + "...")
                    if len(content_summary) > 200
                    else content_summary.strip()
                )

            md_evidence_payload = {}
            if (
                target_doc.get("md_as_pdf_equivalent")
                or target_doc.get("source_format") == "MD_AS_PDF_TEXT"
            ):
                md_evidence_payload = {
                    "source_sheet": "md_as_pdf_evidence",
                    "md_as_pdf_evidence": {
                        "file_name": target_doc.get("file_name", ""),
                        "file_path": target_doc.get("file_path", ""),
                        "source_format": target_doc.get(
                            "source_format", "MD_AS_PDF_TEXT"
                        ),
                        "doc_type": target_doc.get("doc_type", ""),
                        "row_numbers": target_doc.get("row_numbers", []),
                        "shipment_refs": target_doc.get("shipment_refs", []),
                        "waybill_numbers": target_doc.get("waybill_numbers", []),
                        "trip_numbers": target_doc.get("trip_numbers", []),
                        "first_waybill_no": target_doc.get("waybill_no", ""),
                        "issue_date": "",
                        "origin": target_doc.get("origin_from_pdf", ""),
                        "destination": target_doc.get("destination_from_pdf", ""),
                        "content_summary": content_summary,
                        "md_as_pdf_equivalent": True,
                    },
                }

            extracted_fields_json = json.dumps(
                {
                    "origin_from_pdf": target_doc.get("origin_from_pdf", ""),
                    "destination_from_pdf": target_doc.get("destination_from_pdf", ""),
                    "dn_number": target_doc.get("waybill_no", ""),
                    "v1_4_1_used": True,
                    **md_evidence_payload,
                },
                ensure_ascii=False,
            )

            return {
                "pdf_dn_number": target_doc.get("waybill_no", ""),
                "pdf_issue_date": "",
                "pdf_origin": target_doc.get("origin_from_pdf", ""),
                "pdf_destination": target_doc.get("destination_from_pdf", ""),
                "pdf_content_summary": content_summary,
                "pdf_extracted_fields": extracted_fields_json,
            }

        extracted_content = target_doc.get("extracted_content") or ""
        if not extracted_content:
            return {
                "pdf_dn_number": "",
                "pdf_issue_date": "",
                "pdf_origin": "",
                "pdf_destination": "",
                "pdf_content_summary": "",
                "pdf_extracted_fields": "",
            }

        # PDF 필드 추출
        pdf_fields = extract_pdf_fields(extracted_content)

        # 구조화된 필드 JSON
        extracted_fields_json = (
            json.dumps(pdf_fields, ensure_ascii=False) if pdf_fields else ""
        )

        return {
            "pdf_dn_number": pdf_fields.get("dn_number", ""),
            "pdf_issue_date": pdf_fields.get("issue_date", ""),
            "pdf_origin": pdf_fields.get("origin_from_pdf", ""),
            "pdf_destination": pdf_fields.get("destination_from_pdf", ""),
            "pdf_content_summary": pdf_fields.get("content_summary", ""),
            "pdf_extracted_fields": extracted_fields_json,
        }

    # PDF 파서 결과를 DataFrame에 추가
    pdf_data = df.apply(extract_pdf_data_for_row, axis=1)
    for col in [
        "pdf_dn_number",
        "pdf_issue_date",
        "pdf_origin",
        "pdf_destination",
        "pdf_content_summary",
        "pdf_extracted_fields",
    ]:
        df[col] = pdf_data.apply(lambda x: x.get(col, ""))

    # PRISM artifact
    recap = [
        "P:: invoice-verify · lane-join · Δ% compute",
        "R:: COST-GUARD Δ≤2/5/10 · AutoFail>15 · HallucinationBan",
        "I:: {sources:['Domestic_invoice_distance.xlsx','ExecutedRateLedger(domestic_rate_ledger.json)','mapping_update_20250819.xlsx']}",
        "S:: plan→normalize→join→score→export",
        "M:: {report.xlsx, proof.artifact(json, sha256)}",
    ]

    artifact = {
        "artifact_id": f"DomesticAudit-{pd.Timestamp.utcnow().strftime('%Y%m%d-%H%M%S')}",
        "config_version": cfg.get("version"),
        "cost_guard": cfg["cost_guard_bands"],
        "autofail_pct": cfg["autofail_threshold_pct"],
        "similarity": cfg["similarity"],
        "special_zone_policy": cfg["special_zone"],
        "stats": {
            "total": int(df.shape[0]),
            "bands": df["cg_band"].value_counts(dropna=False).to_dict(),
            "verdicts": df["verdict"].value_counts(dropna=False).to_dict(),
            "executed_ref_methods": df["executed_ref_method"]
            .value_counts(dropna=False)
            .to_dict()
            if "executed_ref_method" in df.columns
            else {},
            "executed_ref_verdicts": df["executed_ref_verdict"]
            .value_counts(dropna=False)
            .to_dict()
            if "executed_ref_verdict" in df.columns
            else {},
        },
    }
    artifact_bytes = json.dumps(artifact, ensure_ascii=False, sort_keys=True).encode(
        "utf-8"
    )
    proof_hash = sha256_of_bytes(artifact_bytes)

    return df, recap, artifact, proof_hash


# ---------------------------------------------------------------------------
# CLI entry point: --help | --smoke | --validate
# ---------------------------------------------------------------------------
def _build_synthetic_invoice() -> pd.DataFrame:
    """Build a minimal 2-row invoice DataFrame for smoke tests.

    Required columns are derived from Data/HVDC_Domestic_Audit_Excel_Format_Template.
    Values are within cost-guard bands so the result is deterministic.
    """
    return pd.DataFrame(
        [
            {
                "S/N": "1",
                "shipment_ref": "HVDC-DSV-SMOKE-001",
                "Job #": "J-SMOKE-001",
                "Operation Type": "Transportation",
                "origin": "SHJ",
                "destination": "MOSB",
                "qty": 1.0,
                "vehicle": "FLATBED 20T",
                "Applied rate": 1500.0,
                "Rate (AED)": 1500.0,
                "rate_usd": 408.45,
                "Amount (US$)": 408.45,
                "Total (US$)": 408.45,
                "rate_usd_input": 408.45,
                "rate_aed_input": 1500.0,
                "distance_km": 130.0,
                "unit": "per truck",
            },
            {
                "S/N": "2",
                "shipment_ref": "HVDC-DSV-SMOKE-002",
                "Job #": "J-SMOKE-002",
                "Operation Type": "Transportation",
                "origin": "AUH",
                "destination": "MIRFA",
                "qty": 1.0,
                "vehicle": "FLATBED 20T",
                "Applied rate": 1800.0,
                "Rate (AED)": 1800.0,
                "rate_usd": 490.14,
                "Amount (US$)": 490.14,
                "Total (US$)": 490.14,
                "rate_usd_input": 490.14,
                "rate_aed_input": 1800.0,
                "distance_km": 160.0,
                "unit": "per truck",
            },
        ]
    )


def smoke_test() -> int:
    """Run a 4-check smoke test against synthetic data.

    Returns 0 on full pass, 1 on any failure.
    """
    logger = logging.getLogger("domestic_validator.smoke")  # noqa: F841 — reserved for future per-check logging
    logging.basicConfig(
        level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s"
    )
    checks: list[tuple[str, bool, str]] = []

    # Check 1: module is importable + key symbols exist
    required_symbols = [
        "validate_domestic",
        "load_config",
        "load_mapping_excel",
        "build_normalizer",
        "normalize_place",
        "sha256_of_bytes",
        "abs_pct_diff",
        "band_of_delta",
        "winsorize_series",
    ]
    missing = [s for s in required_symbols if s not in globals()]
    checks.append(
        (
            "module_symbols",
            not missing,
            f"missing={missing}"
            if missing
            else f"all {len(required_symbols)} public symbols present",
        )
    )

    # Check 2: pure-function utility works on synthetic numeric input
    try:
        s = pd.Series([1.0, 2.0, 3.0, 4.0, 100.0])
        ws = winsorize_series(s, lower_q=0.05, upper_q=0.95)
        ok = len(ws) == 5 and ws.max() < 100.0
        checks.append(("winsorize", ok, f"max={ws.max()} (expected <100.0)"))
    except Exception as e:
        checks.append(("winsorize", False, f"raised: {type(e).__name__}: {e}"))

    # Check 3: band_of_delta respects config
    try:
        bands = {"pass": 2.0, "warn": 5.0, "high": 10.0}
        b1 = band_of_delta(1.0, bands)
        b2 = band_of_delta(7.0, bands)
        b3 = band_of_delta(50.0, bands)
        ok = b1 == "PASS" and b2 in ("WARN", "HIGH") and b3 == "CRITICAL"
        checks.append(("band_of_delta", ok, f"1%={b1} 7%={b2} 50%={b3}"))
    except Exception as e:
        checks.append(("band_of_delta", False, f"raised: {type(e).__name__}: {e}"))

    # Check 4: validate_domestic runs end-to-end on synthetic 2-row invoice
    try:
        invoice_df = _build_synthetic_invoice()
        config_path = str(Path(__file__).parent / "patch" / "config_domestic_v2.json")
        if not Path(config_path).exists():
            checks.append(
                ("validate_domestic", False, f"config not found: {config_path}")
            )
        else:
            df, recap, artifact, proof_hash = validate_domestic(
                invoice_df=invoice_df,
                mapping_path=str(
                    Path(__file__).parent / "Data" / "DOMESTIC_with_distances.xlsx"
                ),
                config_path=config_path,
            )
            ok = (
                isinstance(df, pd.DataFrame)
                and isinstance(recap, list)
                and isinstance(artifact, dict)
                and isinstance(proof_hash, str)
                and len(proof_hash) == 64
                and artifact.get("stats", {}).get("total") == 2
            )
            checks.append(
                (
                    "validate_domestic",
                    ok,
                    f"rows={len(df)} bands={artifact.get('stats', {}).get('bands')} hash={proof_hash[:12]}...",
                )
            )
    except Exception as e:
        checks.append(("validate_domestic", False, f"raised: {type(e).__name__}: {e}"))

    # Report
    print("=" * 60)
    print("DOMESTIC VALIDATOR SMOKE TEST (v2.2)")
    print("=" * 60)
    passed = 0
    for name, ok, detail in checks:
        status = "PASS" if ok else "FAIL"
        symbol = "✓" if ok else "✗"
        print(f"  {symbol} [{status}] {name:25s}  {detail}")
        if ok:
            passed += 1
    print("-" * 60)
    print(f"  Result: {passed}/{len(checks)} checks passed")
    print("=" * 60)
    return 0 if passed == len(checks) else 1


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="domestic_validator_v2_r",
        description="HVDC Domestic Invoice Validator v2.2 — single-file CLI",
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--smoke",
        action="store_true",
        help="Run synthetic 2-row smoke test against bundled config and exit with code 0/1.",
    )
    mode.add_argument(
        "--validate",
        metavar="INVOICE_XLSX",
        help="Validate a real invoice .xlsx (uses bundled mapping + config).",
    )
    p.add_argument(
        "--mapping",
        metavar="MAPPING_XLSX",
        help="Override mapping xlsx (default: bundled DOMESTIC_with_distances.xlsx).",
    )
    p.add_argument(
        "--config",
        metavar="CONFIG_JSON",
        help="Override config json (default: patch/config_domestic_v2.json).",
    )
    p.add_argument(
        "--output",
        metavar="OUT_XLSX",
        help="[--validate only] Write validated DataFrame to .xlsx.",
    )
    p.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable INFO-level logging.",
    )
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )

    if args.smoke:
        return smoke_test()

    if args.validate:
        invoice_path = Path(args.validate)
        if not invoice_path.exists():
            print(f"ERROR: invoice not found: {invoice_path}", file=sys.stderr)
            return 2
        config_path = args.config or str(
            Path(__file__).parent / "patch" / "config_domestic_v2.json"
        )
        mapping_path = args.mapping or str(
            Path(__file__).parent / "Data" / "DOMESTIC_with_distances.xlsx"
        )
        invoice_df = pd.read_excel(invoice_path, sheet_name="items")
        if invoice_df.empty:
            print(f"WARN: 'items' sheet is empty in {invoice_path}", file=sys.stderr)
        df, recap, artifact, proof_hash = validate_domestic(
            invoice_df=invoice_df,
            mapping_path=mapping_path,
            config_path=config_path,
        )
        print(f"Rows: {len(df)}")
        print(f"Bands: {artifact['stats'].get('bands')}")
        print(f"Verdicts: {artifact['stats'].get('verdicts')}")
        print(f"Proof hash: {proof_hash}")
        print("Recap:")
        for line in recap:
            print(f"  {line}")
        if args.output:
            out_path = Path(args.output)
            with pd.ExcelWriter(out_path, engine="openpyxl") as xw:
                df.to_excel(xw, sheet_name="validated", index=False)
            print(f"Wrote: {out_path}")
        return 0

    # No mode flag → --help
    _build_arg_parser().print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
