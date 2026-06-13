#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""lane_matcher_costguard.py

ApprovedLaneMap_ENHANCED.json 기반 Lane 매칭 모듈 (COST-GUARD)

핵심 목표
- LANE MATCH 100% ("best-effort" 기준): 매칭 후보가 존재하면 항상 lane_id/std_rate를 반환
- 단, 신뢰도(confidence)와 hard_matched(임계치 통과 여부)로 리스크 기반 리뷰(RBR) 가능

매칭 전략
1) EXACT_NORM_KEY: 정규화(origin/destination/vehicle/unit) 키 정확 매칭
2) EXACT_ALIAS_KEY: alias 적용 후 키 정확 매칭
3) FUZZY_RANK: 토큰(Jaccard) + 시퀀스(SequenceMatcher) 기반 랭킹
   - direction(Forward/Reversed) 동시 평가 (INV O/D 뒤바뀜 케이스 대응)
   - vehicle gate 실패 시 1회 완화(relaxed) 재시도

호환성
- 기존 필드(matched, lane_id, std_rate_usd, method, confidence 등) 유지
- 추가 필드(hard_matched, direction, unit_norm) 추가

Usage (example)
  from lane_matcher_costguard import LaneMatcher, load_lane_rows, attach_lane_matches

  lanes = load_lane_rows("ApprovedLaneMap_ENHANCED.json")
  matcher = LaneMatcher(lanes, alias_path="site_alias_autolearn.json")
  df2 = attach_lane_matches(df_invoice, matcher,
                            pol_col="Place of Loading",
                            pod_col="Place of Delivery",
                            veh_col="Vehicle Type",
                            unit="per truck",
                            learn=True,
                            min_confidence=0.70)

"""

import json
import re
import unicodedata
import difflib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple, Optional

import pandas as pd

try:
    from place_normalizer import normalize_place as _common_normalize_place
    COMMON_PLACE_NORMALIZER_AVAILABLE = True
except ImportError:
    _common_normalize_place: Optional[Any] = None  # type: ignore[no-redef]
    COMMON_PLACE_NORMALIZER_AVAILABLE = False


# -----------------------------
# Data model
# -----------------------------
@dataclass(frozen=True)
class LaneRow:
    origin: str
    destination: str
    vehicle: str
    unit: str
    median_rate_usd: float
    lane_id: str
    notes: str
    key: str


def _lane_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        text = str(value).replace(",", "").strip()
        if not text or text.upper() in {"N/A", "NA", "NONE", "NULL", "NAN"}:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def load_lane_rows(lanemap_json_path: str) -> List[LaneRow]:
    """ApprovedLaneMap_ENHANCED.json 로더

    지원 구조
    - {"Sheet1": [...]}  (legacy)
    - {"metadata":..., "data": {"Sheet1": [...]}} (current)
    """
    p = Path(lanemap_json_path)
    obj = json.loads(p.read_text(encoding="utf-8"))

    rows = None
    if isinstance(obj, dict) and "Sheet1" in obj and isinstance(obj.get("Sheet1"), list):
        rows = obj.get("Sheet1")
    elif isinstance(obj, dict) and isinstance(obj.get("data"), dict) and isinstance(obj["data"].get("Sheet1"), list):
        rows = obj["data"].get("Sheet1")

    if rows is None:
        raise ValueError(
            "Unsupported LaneMap JSON structure. Expected top-level 'Sheet1' or 'data.Sheet1'. "
            f"Got keys={list(obj.keys()) if isinstance(obj, dict) else type(obj)}"
        )

    out: List[LaneRow] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        out.append(
            LaneRow(
                origin=str(r.get("origin", "") or ""),
                destination=str(r.get("destination", "") or ""),
                vehicle=str(r.get("vehicle", "") or ""),
                unit=str(r.get("unit", "") or ""),
                median_rate_usd=_lane_float(r.get("median_rate_usd", 0.0)),
                lane_id=str(r.get("lane_id", "") or ""),
                notes=str(r.get("notes", "") or ""),
                key=str(r.get("key", "") or ""),
            )
        )
    return out


# -----------------------------
# Normalization utilities
# -----------------------------
_STOPWORDS = {
    "THE", "OF", "AND", "&",
    "YARD", "WH", "WAREHOUSE", "STATION", "POWER", "PLANT", "PROJECT",
    "SAMSUNG", "DSV", "LLC", "FZE", "PJSC",
    "ROAD", "RD", "ST", "STREET", "AREA", "ZONE",
    "ABU", "DHABI",
}

# Canonical site synonyms (minimal set aligned with LaneMap)
_SITE_SYNONYMS: List[Tuple[str, str]] = [
    (r"\bMUSS?AFAH\b", "MUSSAFAH"),
    (r"\bMUSAFFAH\b", "MUSSAFAH"),
    (r"\bI\.?\s*C\.?\s*A\.?\s*D\.?\b", "ICAD"),
    (r"\bMINA\s+ZAYED\s+FREE\s*PORT\b", "MINA ZAYED PORT"),
    (r"\bJDN\s+MINA\s+ZAYED\b", "MINA ZAYED PORT"),
    (r"\bMINA\s+ZAYED\b", "MINA ZAYED PORT"),
    (r"\bJEBEL\s+ALI\b", "JEBEL ALI PORT"),
    (r"\bSHUWEIHAT\s+POWER\s+STATION\b", "SHUWEIHAT SITE"),
    (r"\bSHUWEIHAT\b", "SHUWEIHAT SITE"),
    (r"\bMIRFA\s+PMO\s+SAMSUNG\b", "MIRFA SITE"),
    (r"\bMIRFA\b", "MIRFA SITE"),
    (r"\bMIR\b", "MIRFA SITE"),
    (r"\bSHU\b", "SHUWEIHAT SITE"),
    (r"\bMOSB\b", "AL MASAOOD (MOSB)"),
]


def _u(s: str) -> str:
    return str(s or "").strip()


def _ascii_upper(s: str) -> str:
    s = unicodedata.normalize("NFKC", _u(s))
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s.upper()


def _clean_punct(s: str) -> str:
    s = _ascii_upper(s)
    # keep numbers/letters/spaces and ()- (lane map uses parentheses)
    s = re.sub(r"[^A-Z0-9\s\-\(\)]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_unit(raw: str) -> str:
    """Unit 표준화 (키 매칭 안정화)

    LaneMap은 대부분 'per truck' 기반이므로 기본값은 PER TRUCK.
    """
    u = _ascii_upper(raw)
    if not u:
        return "PER TRUCK"
    # normalize common patterns
    u = u.replace("PERTRUCK", "PER TRUCK").replace("PERTRIP", "PER TRUCK")
    if "TRUCK" in u or "TRIP" in u:
        return "PER TRUCK"
    if re.search(r"\bRT\b", u):
        return "PER RT"
    return u


def normalize_vehicle(raw: str) -> str:
    v = _ascii_upper(raw)

    haz = "HAZ" in v or "DG" in v
    cicpa = "CICPA" in v

    # dimensional lowbed patterns
    if ("23" in v and ("METER" in v or "MTR" in v or re.search(r"\b23M\b", v)) and ("LB" in v or "LOWBED" in v)):
        base = "23 METER LB"
    elif ("14" in v and ("METER" in v or "MTR" in v or re.search(r"\b14M\b", v)) and ("LB" in v or "LOWBED" in v)):
        base = "14 METER LB (BR)"
    elif "LOWBED" in v or re.search(r"\bLB\b", v):
        base = "LOWBED"
    elif "3 TON" in v or re.search(r"\b3T\b", v):
        base = "3 TON PU"
    elif "7 TON" in v or re.search(r"\b7T\b", v):
        base = "7 TON PU"
    elif "FLATBED" in v or re.search(r"\bFB\b", v):
        base = "FLATBED"
    else:
        base = _clean_punct(v) if v else "OTHER"

    if haz:
        if base.startswith("LOWBED"):
            return "LOWBED HAZMAT"
        if base.startswith("FLATBED"):
            return "FLATBED HAZMAT"
    if cicpa:
        if base.startswith("LOWBED"):
            return "LOWBED CICPA"
        if base.startswith("FLATBED"):
            return "FLATBED CICPA"
    return base


def _apply_site_synonyms(s: str) -> str:
    out = _clean_punct(s)
    for pat, repl in _SITE_SYNONYMS:
        out = re.sub(pat, repl, out, flags=re.IGNORECASE)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def normalize_place(raw: str) -> str:
    """Place 표준화

    - punctuation/spacing 정리
    - 최소한의 synonym 정규화 (LaneMap과의 정합 우선)
    - 대표 포맷(예: MINA ZAYED PORT, JEBEL ALI PORT, AL MASAOOD (MOSB))으로 치환
    """
    base = raw
    if COMMON_PLACE_NORMALIZER_AVAILABLE and _common_normalize_place is not None:
        try:
            base = _common_normalize_place(raw)
        except Exception:
            base = raw

    s = _apply_site_synonyms(base)

    # MOSB/Al Masaood 강제 정규화
    if "MOSB" in s or "MASAOOD" in s:
        s = "AL MASAOOD (MOSB)"

    # Al Markaz
    if "MARKAZ" in s:
        s = "AL MARKAZ WAREHOUSE"

    # M44
    if re.search(r"\bM44\b", s):
        s = "M44 WAREHOUSE"

    # Mina Zayed
    if "MINA" in s and "ZAYED" in s:
        s = "MINA ZAYED PORT"

    # Jebel Ali
    if "JEBEL" in s and "ALI" in s:
        s = "JEBEL ALI PORT"

    # Mirfa/Shuweihat are handled by synonyms

    return re.sub(r"\s+", " ", s).strip()


def token_signature(place_norm: str) -> Tuple[str, ...]:
    """Token signature for fuzzy compare

    - stopwords 제거
    - 괄호 제거
    - 중복 제거 (stable order)
    """
    s = _ascii_upper(place_norm)
    toks = re.split(r"\s+", s)
    keep: List[str] = []
    for t in toks:
        t = t.strip()
        if not t:
            continue
        if t in _STOPWORDS:
            continue
        t = t.replace("(", "").replace(")", "")
        keep.append(t)

    seen = set()
    uniq: List[str] = []
    for t in keep:
        if t not in seen:
            seen.add(t)
            uniq.append(t)
    return tuple(uniq)


def sim_tokens(a: Tuple[str, ...], b: Tuple[str, ...]) -> float:
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(1, len(sa | sb))


def sim_seq(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _ascii_upper(a), _ascii_upper(b)).ratio()


def _safe_rate(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        rate = float(str(value).replace(",", "").strip())
    except Exception:
        return None
    if rate <= 0:
        return None
    return rate


def rate_closeness(invoice_rate: Any, lane_rate: Any, decay_pct: float = 50.0) -> float:
    invoice = _safe_rate(invoice_rate)
    lane = _safe_rate(lane_rate)
    if invoice is None or lane is None:
        return 0.0
    diff_pct = abs(invoice - lane) / lane * 100.0
    return max(0.0, 1.0 - (diff_pct / float(decay_pct)))


def build_key(origin: str, dest: str, vehicle: str, unit: str) -> str:
    return f"{_ascii_upper(origin)}||{_ascii_upper(dest)}||{_ascii_upper(vehicle)}||{normalize_unit(unit)}"


# -----------------------------
# LaneMatcher
# -----------------------------
class LaneMatcher:
    """Robust lane matching.

    Note:
    - matched=True는 "candidate를 하나라도 찾았다" 의미(best-effort)
    - hard_matched=True는 conf>=min_confidence(기본 0.70) 의미
    """

    def __init__(self, lanes: List[LaneRow], alias_path: Optional[str] = None):
        self.lanes = lanes
        self.alias_path = Path(alias_path) if alias_path else None
        self.alias: Dict[str, str] = {}
        if self.alias_path and self.alias_path.exists():
            try:
                self.alias = json.loads(self.alias_path.read_text(encoding="utf-8"))
            except Exception:
                self.alias = {}

        # precompute indexes
        self.by_key: Dict[str, LaneRow] = {}
        self._lane_cache: List[Dict[str, Any]] = []

        for lane in self.lanes:
            o = normalize_place(lane.origin)
            d = normalize_place(lane.destination)
            v = normalize_vehicle(lane.vehicle)
            u = normalize_unit(lane.unit)
            k = build_key(o, d, v, u)
            self.by_key[k] = lane
            self._lane_cache.append(
                dict(
                    lane=lane,
                    o_norm=o,
                    d_norm=d,
                    v_norm=v,
                    u_norm=u,
                    o_sig=token_signature(o),
                    d_sig=token_signature(d),
                )
            )

        # inverted token index for candidate pruning
        self.inv_origin: Dict[str, List[int]] = {}
        self.inv_dest: Dict[str, List[int]] = {}
        for i, it in enumerate(self._lane_cache):
            for t in it["o_sig"]:
                self.inv_origin.setdefault(t, []).append(i)
            for t in it["d_sig"]:
                self.inv_dest.setdefault(t, []).append(i)

    def _apply_alias(self, raw_place: str) -> str:
        r = _ascii_upper(raw_place)
        if r in self.alias:
            return normalize_place(self.alias[r])
        return normalize_place(raw_place)

    def _maybe_learn_alias(self, raw_place: str, canonical: str, conf: float, learn: bool) -> None:
        if not learn or not self.alias_path:
            return
        if conf < 0.92:
            return
        r = _ascii_upper(raw_place)
        c = _ascii_upper(canonical)
        if r and c and r not in self.alias:
            self.alias[r] = canonical
            try:
                self.alias_path.write_text(json.dumps(self.alias, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass

    @staticmethod
    def _veh_base(v: str) -> str:
        v = _ascii_upper(v)
        if not v:
            return "OTHER"
        # base token (e.g., FLATBED, LOWBED, 3, 7...)
        return v.split()[0]

    def match(
        self,
        raw_origin: str,
        raw_dest: str,
        raw_vehicle: str,
        unit: str = "per truck",
        learn: bool = False,
        topk: int = 5,
        min_confidence: float = 0.70,
        invoice_rate_usd: Any = None,
    ) -> Dict[str, Any]:
        """Match invoice row to LaneMap.

        Returns dict keys (main):
          matched(bool): candidate existence (best-effort)
          hard_matched(bool): conf >= min_confidence
          lane_id, std_rate_usd, lane_key, method, confidence,
          origin_norm, dest_norm, vehicle_norm, unit_norm, direction,
          candidates(topk)
        """
        unit_norm = normalize_unit(unit)
        invoice_rate = _safe_rate(invoice_rate_usd)

        def _rate_close(lane_rate: Any) -> float:
            return rate_closeness(invoice_rate, lane_rate) if invoice_rate is not None else 0.0

        # L1 exact with normalization
        o1 = normalize_place(raw_origin)
        d1 = normalize_place(raw_dest)
        v1 = normalize_vehicle(raw_vehicle)
        key1 = build_key(o1, d1, v1, unit_norm)

        if key1 in self.by_key:
            lane = self.by_key[key1]
            return dict(
                matched=True,
                hard_matched=True,
                lane_id=lane.lane_id,
                std_rate_usd=float(lane.median_rate_usd),
                lane_key=lane.key,
                method="EXACT_NORM_KEY",
                confidence=1.00,
                origin_norm=o1,
                dest_norm=d1,
                vehicle_norm=v1,
                unit_norm=unit_norm,
                direction="FORWARD",
                rate_closeness=_rate_close(lane.median_rate_usd),
                candidates=[],
            )

        # L1 reversed exact (INV O/D swap)
        key1_rev = build_key(d1, o1, v1, unit_norm)
        if key1_rev in self.by_key:
            lane = self.by_key[key1_rev]
            return dict(
                matched=True,
                hard_matched=True,
                lane_id=lane.lane_id,
                std_rate_usd=float(lane.median_rate_usd),
                lane_key=lane.key,
                method="EXACT_NORM_KEY_REVERSED",
                confidence=0.97,
                origin_norm=o1,
                dest_norm=d1,
                vehicle_norm=v1,
                unit_norm=unit_norm,
                direction="REVERSED",
                rate_closeness=_rate_close(lane.median_rate_usd),
                candidates=[],
            )

        # L2 alias exact
        o2 = self._apply_alias(raw_origin)
        d2 = self._apply_alias(raw_dest)
        v2 = v1
        key2 = build_key(o2, d2, v2, unit_norm)

        if key2 in self.by_key:
            lane = self.by_key[key2]
            self._maybe_learn_alias(raw_origin, o2, 0.98, learn)
            self._maybe_learn_alias(raw_dest, d2, 0.98, learn)
            return dict(
                matched=True,
                hard_matched=True,
                lane_id=lane.lane_id,
                std_rate_usd=float(lane.median_rate_usd),
                lane_key=lane.key,
                method="EXACT_ALIAS_KEY",
                confidence=0.98,
                origin_norm=o2,
                dest_norm=d2,
                vehicle_norm=v2,
                unit_norm=unit_norm,
                direction="FORWARD",
                rate_closeness=_rate_close(lane.median_rate_usd),
                candidates=[],
            )

        # L2 reversed alias exact
        key2_rev = build_key(d2, o2, v2, unit_norm)
        if key2_rev in self.by_key:
            lane = self.by_key[key2_rev]
            self._maybe_learn_alias(raw_origin, o2, 0.96, learn)
            self._maybe_learn_alias(raw_dest, d2, 0.96, learn)
            return dict(
                matched=True,
                hard_matched=True,
                lane_id=lane.lane_id,
                std_rate_usd=float(lane.median_rate_usd),
                lane_key=lane.key,
                method="EXACT_ALIAS_KEY_REVERSED",
                confidence=0.96,
                origin_norm=o2,
                dest_norm=d2,
                vehicle_norm=v2,
                unit_norm=unit_norm,
                direction="REVERSED",
                rate_closeness=_rate_close(lane.median_rate_usd),
                candidates=[],
            )

        # L3 fuzzy
        if not self._lane_cache:
            return dict(
                matched=False,
                hard_matched=False,
                lane_id="",
                std_rate_usd="",
                lane_key="",
                method="NO_LANES_LOADED",
                confidence=0.00,
                origin_norm=o2,
                dest_norm=d2,
                vehicle_norm=v2,
                unit_norm=unit_norm,
                direction="",
                candidates=[],
            )

        o_sig = token_signature(o2)
        d_sig = token_signature(d2)

        # candidate pruning: token hit union -> then origin/dest intersection
        cand_idx = None
        for t in o_sig:
            ids = set(self.inv_origin.get(t, []))
            cand_idx = ids if cand_idx is None else cand_idx | ids
        if cand_idx is None:
            cand_idx = set(range(len(self._lane_cache)))

        cand_idx2 = None
        for t in d_sig:
            ids = set(self.inv_dest.get(t, []))
            cand_idx2 = ids if cand_idx2 is None else cand_idx2 | ids
        if cand_idx2 is not None:
            cand_idx = cand_idx & cand_idx2 if cand_idx else cand_idx2

        if not cand_idx:
            cand_idx = set(range(len(self._lane_cache)))

        base_invoice = self._veh_base(v2)

        def _score(allow_vehicle_mismatch: bool) -> List[Tuple[float, int, float, float, str, str, float]]:
            """Return list of (score, idx, o_sim, d_sim, v_lane, direction, rate_close)."""
            scored_local: List[Tuple[float, int, float, float, str, str, float]] = []
            for i in cand_idx:
                it = self._lane_cache[i]
                lane: LaneRow = it["lane"]
                v_lane = it["v_norm"]
                u_lane = it["u_norm"]

                base_lane = self._veh_base(v_lane)
                veh_ok = (v2 == v_lane) or (base_invoice == base_lane)
                if (not veh_ok) and (not allow_vehicle_mismatch):
                    continue

                # unit bonus (do not hard-filter for flexibility)
                unit_bonus = 0.03 if unit_norm == u_lane else 0.00
                veh_bonus = 0.08 if v2 == v_lane else (0.04 if veh_ok else 0.00)
                rate_close = _rate_close(lane.median_rate_usd)
                rate_bonus = 0.12 * rate_close if invoice_rate is not None else 0.0

                # forward
                o_sim_f = 0.65 * sim_tokens(o_sig, it["o_sig"]) + 0.35 * sim_seq(o2, it["o_norm"])
                d_sim_f = 0.65 * sim_tokens(d_sig, it["d_sig"]) + 0.35 * sim_seq(d2, it["d_norm"])
                score_f = 0.50 * o_sim_f + 0.50 * d_sim_f + veh_bonus + unit_bonus + rate_bonus

                # reversed
                o_sim_r = 0.65 * sim_tokens(o_sig, it["d_sig"]) + 0.35 * sim_seq(o2, it["d_norm"])
                d_sim_r = 0.65 * sim_tokens(d_sig, it["o_sig"]) + 0.35 * sim_seq(d2, it["o_norm"])
                # slight penalty for reversed to prefer forward if tie
                score_r = 0.50 * o_sim_r + 0.50 * d_sim_r + veh_bonus + unit_bonus + rate_bonus - 0.02

                if score_r > score_f:
                    scored_local.append((score_r, i, o_sim_r, d_sim_r, v_lane, "REVERSED", rate_close))
                else:
                    scored_local.append((score_f, i, o_sim_f, d_sim_f, v_lane, "FORWARD", rate_close))
            return scored_local

        scored = _score(allow_vehicle_mismatch=False)
        relaxed = False
        if not scored:
            scored = _score(allow_vehicle_mismatch=True)
            relaxed = True

        scored.sort(reverse=True, key=lambda x: x[0])
        top = scored[:max(1, topk)]

        if not top:
            return dict(
                matched=False,
                hard_matched=False,
                lane_id="",
                std_rate_usd="",
                lane_key="",
                method="NO_MATCH",
                confidence=0.00,
                origin_norm=o2,
                dest_norm=d2,
                vehicle_norm=v2,
                unit_norm=unit_norm,
                direction="",
                candidates=[],
            )

        best_score, best_i, best_o, best_d, best_vlane, best_dir, best_rate_close = top[0]
        best_lane: LaneRow = self._lane_cache[best_i]["lane"]

        # confidence shaping (cap)
        conf = float(max(0.0, min(0.99, best_score)))
        hard = conf >= float(min_confidence)

        method = "FUZZY_RANK_RELAXED" if relaxed else "FUZZY_RANK"
        if not hard:
            method = method + "_LOWCONF"

        # learn alias if strong
        self._maybe_learn_alias(raw_origin, self._lane_cache[best_i]["o_norm"], conf, learn)
        self._maybe_learn_alias(raw_dest, self._lane_cache[best_i]["d_norm"], conf, learn)

        candidates = []
        for s, idx, os_, ds_, vl_, dir_, rate_close_ in top:
            ln = self._lane_cache[idx]["lane"]
            candidates.append(
                dict(
                    lane_id=str(ln.lane_id),
                    key=str(ln.key),
                    std_rate_usd=float(ln.median_rate_usd),
                    score=float(round(s, 4)),
                    origin_sim=float(round(os_, 4)),
                    dest_sim=float(round(ds_, 4)),
                    rate_closeness=float(round(rate_close_, 4)),
                    vehicle_lane=str(vl_),
                    direction=str(dir_),
                )
            )

        return dict(
            matched=True,
            hard_matched=hard,
            lane_id=best_lane.lane_id,
            std_rate_usd=float(best_lane.median_rate_usd),
            lane_key=best_lane.key,
            method=method,
            confidence=float(round(conf, 4)),
            origin_norm=o2,
            dest_norm=d2,
            vehicle_norm=v2,
            unit_norm=unit_norm,
            direction=best_dir,
            rate_closeness=float(round(best_rate_close, 4)),
            candidates=candidates,
        )


def attach_lane_matches(
    df: pd.DataFrame,
    matcher: LaneMatcher,
    pol_col: str,
    pod_col: str,
    veh_col: str,
    unit: str = "per truck",
    learn: bool = False,
    min_confidence: float = 0.70,
) -> pd.DataFrame:
    """DataFrame에 Lane 매칭 결과 컬럼을 추가합니다."""
    out = df.copy()
    records = []
    for _, r in out.iterrows():
        m = matcher.match(
            raw_origin=str(r.get(pol_col, "")),
            raw_dest=str(r.get(pod_col, "")),
            raw_vehicle=str(r.get(veh_col, "")),
            unit=unit,
            learn=learn,
            topk=5,
            min_confidence=min_confidence,
        )
        records.append(m)

    mdf = pd.DataFrame.from_records(records)
    mdf.index = out.index

    def _series(name: str, default: Any = "") -> pd.Series:
        if name in mdf.columns:
            return mdf[name]
        return pd.Series(default, index=out.index)

    out["POL_CANON"] = _series("origin_norm")
    out["POD_CANON"] = _series("dest_norm")
    out["VEH_CANON"] = _series("vehicle_norm")
    out["UNIT_CANON"] = _series("unit_norm")

    # best-effort match flag
    out["LANE_MATCHED"] = _series("matched", False).astype(bool)
    out["LANE_HARD_MATCHED"] = _series("hard_matched", False).astype(bool)

    out["LANE_ID"] = _series("lane_id")
    out["LANE_KEY"] = _series("lane_key")
    out["STD_RATE_USD"] = _series("std_rate_usd")
    out["MATCH_METHOD"] = _series("method")
    out["MATCH_CONF"] = _series("confidence")
    out["MATCH_DIRECTION"] = _series("direction")
    out["MATCH_CANDIDATES_JSON"] = _series("candidates", []).apply(
        lambda x: json.dumps(x if isinstance(x, list) else [], ensure_ascii=False)
    )

    return out
