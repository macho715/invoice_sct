"""test_rate_provider — PR 4.5 verification for DomesticRateProvider adapter.

The adapter wraps `domestic_rate_ledger.json` (691 historical rows) and
exposes the same `get_executed_rate()` surface as the TypeScript
`RateReferenceProvider` in apps/web/src/lib/invoice/rateReferenceProvider.ts.

Why a stub ledger (not the real one)?
- The real ledger is 691 rows; running tests against it makes the suite
  slow and adds noise to failure messages.
- A 4-row stub captures the lookup contract:
    * match on lane_key
    * most-recent row wins
    * null when no match
    * manifest_version stamp is preserved

Run: pytest domestic/tests/test_rate_provider.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the runtime package importable without packaging.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "domestic"))

from runtime.adapters.domestic_rate_provider import (  # noqa: E402
    DomesticRateProvider,
    RateLookupInput,
)


STUB_LEDGER = {
    "rows": [
        {
            "no": 1,
            "date": "2026-01-15",
            "shipment_reference": "SHP-A",
            "place_loading": "Mina Zayed",
            "place_delivery": "Al Salam",
            "vehicle_type": "3 TON PU",
            "distance_km": 42.0,
            "rate_usd": 250.0,
            "origin_key": "MINA ZAYED",
            "destination_key": "AL SALAM",
            "vehicle_key": "3 TON PU",
            "lane_key": "MINA ZAYED|AL SALAM|3 TON PU|PER_TRUCK",
        },
        {
            "no": 2,
            "date": "2026-03-20",
            "shipment_reference": "SHP-A",
            "place_loading": "Mina Zayed",
            "place_delivery": "Al Salam",
            "vehicle_type": "3 TON PU",
            "distance_km": 42.0,
            "rate_usd": 275.0,  # later rate
            "origin_key": "MINA ZAYED",
            "destination_key": "AL SALAM",
            "vehicle_key": "3 TON PU",
            "lane_key": "MINA ZAYED|AL SALAM|3 TON PU|PER_TRUCK",
        },
        {
            "no": 3,
            "date": "2026-04-10",
            "shipment_reference": "SHP-B",
            "place_loading": "Mina Zayed",
            "place_delivery": "Al Salam",
            "vehicle_type": "LOWBED",
            "distance_km": 50.0,
            "rate_usd": 950.0,
            "origin_key": "MINA ZAYED",
            "destination_key": "AL SALAM",
            "vehicle_key": "LOWBED",
            "lane_key": "MINA ZAYED|AL SALAM|LOWBED|PER_TRUCK",
        },
    ]
}


def _provider() -> DomesticRateProvider:
    """Build a provider without touching the real 691-row ledger."""
    p = DomesticRateProvider.__new__(DomesticRateProvider)
    p._manifest_version = "2026-06-16_v1"
    p._rows = STUB_LEDGER["rows"]
    return p


def test_returns_most_recent_match():
    p = _provider()
    rate = p.get_executed_rate(
        RateLookupInput(
            vendor_id="V001",
            lane_code="MINA ZAYED|AL SALAM|3 TON PU|PER_TRUCK",
            service_code="FREIGHT",
            effective_date="2026-05-01",
            currency="USD",
        )
    )
    assert rate is not None
    # row #2 (2026-03-20) is later than row #1 (2026-01-15) → wins
    assert rate.rate_id == "domestic_2"
    assert rate.amount_minor == 27_500  # 275.00 USD → cents
    assert rate.currency == "USD"
    assert rate.manifest_version == "2026-06-16_v1"
    assert rate.effective_from == "2026-03-20"
    assert rate.effective_to is None


def test_returns_null_when_lane_key_mismatches():
    p = _provider()
    rate = p.get_executed_rate(
        RateLookupInput(
            vendor_id="V001",
            lane_code="UNKNOWN|UNKNOWN|UNKNOWN|PER_TRUCK",
            service_code="FREIGHT",
            effective_date="2026-05-01",
            currency="USD",
        )
    )
    assert rate is None


def test_returns_null_when_effective_date_precedes_row():
    p = _provider()
    rate = p.get_executed_rate(
        RateLookupInput(
            vendor_id="V001",
            lane_code="MINA ZAYED|AL SALAM|3 TON PU|PER_TRUCK",
            service_code="FREIGHT",
            effective_date="2025-12-31",  # before any row
            currency="USD",
        )
    )
    assert rate is None


def test_rejects_non_usd_currency():
    p = _provider()
    rate = p.get_executed_rate(
        RateLookupInput(
            vendor_id="V001",
            lane_code="MINA ZAYED|AL SALAM|3 TON PU|PER_TRUCK",
            service_code="FREIGHT",
            effective_date="2026-05-01",
            currency="AED",  # domestic is USD-only for now
        )
    )
    assert rate is None


def test_picks_lane_by_vehicle_key():
    p = _provider()
    rate = p.get_executed_rate(
        RateLookupInput(
            vendor_id="V001",
            lane_code="MINA ZAYED|AL SALAM|LOWBED|PER_TRUCK",
            service_code="FREIGHT",
            effective_date="2026-05-01",
            currency="USD",
        )
    )
    assert rate is not None
    assert rate.rate_id == "domestic_3"
    assert rate.amount_minor == 95_000  # 950.00 USD → cents


def test_empty_provider_returns_null():
    p = DomesticRateProvider.__new__(DomesticRateProvider)
    p._manifest_version = "2026-06-16_v1"
    p._rows = []
    rate = p.get_executed_rate(
        RateLookupInput(
            vendor_id="V001",
            lane_code="X|Y|Z|PER_TRUCK",
            service_code="FREIGHT",
            effective_date="2026-05-01",
            currency="USD",
        )
    )
    assert rate is None
