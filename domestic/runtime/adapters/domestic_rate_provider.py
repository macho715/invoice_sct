"""domestic_rate_provider — PR 4.3 domestic adapter for RateReferenceProvider contract.

Wraps `domestic_rate_ledger.json` so the SCNT HVDC domestic validator can
expose the same getExecutedRate() surface that `apps/web/.../rateReferenceProvider.ts`
defines for SHIPMENT. The existing `domestic_validator_v2_r.py` keeps reading
the JSON directly — this adapter is a *parallel* entrypoint, not a replacement,
and is exercised by the test suite in `tests/test_rate_provider.py`.

Why a parallel adapter (and not a refactor of the validator)?
- The validator is shipped and frozen for the June 2026 release.
- A new code path (rate provider) lets us add integration tests + future
  SHIPMENT↔DOMESTIC parity without disturbing the audited production code.
- The interface is JSON-stable, so when the validator does migrate the
  call sites, only the import changes — not the call signatures.

@see PLAN_20260616_160103.md PR 4.3
@see apps/web/src/lib/invoice/rateReferenceProvider.ts
@see domestic/runtime/Data/domestic_rate_ledger.json
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable, Optional

LEDGER_PATH_DEFAULT = (
    Path(__file__).resolve().parent.parent / "Data" / "domestic_rate_ledger.json"
)

MANIFEST_VERSION_DEFAULT = "2026-06-16_v1"


@dataclass(frozen=True)
class ExecutedRate:
    """Mirror of TypeScript `ExecutedRate` in rateReferenceProvider.ts."""

    rate_id: str
    amount_minor: int
    currency: str
    manifest_version: str
    effective_from: str
    effective_to: Optional[str]


@dataclass(frozen=True)
class RateLookupInput:
    vendor_id: str
    lane_code: str
    service_code: str
    effective_date: str  # YYYY-MM-DD
    currency: str
    workflow_type: str = "DOMESTIC"


class DomesticRateProvider:
    """Read-only rate lookup backed by `domestic_rate_ledger.json`.

    The ledger is a 691-row historical dataset — we treat it as an
    *immutable* snapshot, so the effective_to on every row is None
    (open-ended). When the ledger is regenerated, bump
    `MANIFEST_VERSION_DEFAULT` to the new snapshot's id.
    """

    def __init__(
        self,
        ledger_path: Path | str = LEDGER_PATH_DEFAULT,
        manifest_version: str = MANIFEST_VERSION_DEFAULT,
    ) -> None:
        self._manifest_version = manifest_version
        self._rows = self._load(ledger_path)

    @staticmethod
    def _load(ledger_path: Path | str) -> list[dict]:
        path = Path(ledger_path)
        if not path.exists():
            return []
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return list(data.get("rows", []))

    @property
    def manifest_version(self) -> str:
        return self._manifest_version

    def _to_minor(self, rate_usd: float) -> int:
        # ledger stores USD major units → convert to cents (minor)
        return int(round(rate_usd * 100))

    def _row_matches(self, row: dict, lookup: RateLookupInput) -> bool:
        if row.get("lane_key") != lookup.lane_code:
            return False
        # Domestic currency is implicitly USD for now; future: ledger carries currency.
        if lookup.currency and lookup.currency != "USD":
            return False
        return True

    def _row_in_effect(self, row: dict, effective_date: str) -> bool:
        # ledger has no effective_to → use the row's own `date` field
        # as the effective_from anchor and skip rows dated after the lookup.
        row_date = row.get("date", "")
        return bool(row_date) and row_date <= effective_date

    def get_executed_rate(
        self,
        lookup: RateLookupInput,
        *,
        ledger_rows: Optional[Iterable[dict]] = None,
    ) -> Optional[ExecutedRate]:
        rows = list(ledger_rows) if ledger_rows is not None else self._rows
        # Most-recent match wins.
        candidates = [
            r
            for r in rows
            if self._row_matches(r, lookup) and self._row_in_effect(r, lookup.effective_date)
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda r: r.get("date", ""), reverse=True)
        row = candidates[0]
        rate_usd = row.get("rate_usd")
        if rate_usd is None:
            return None
        return ExecutedRate(
            rate_id=f"domestic_{row.get('no', 'unknown')}",
            amount_minor=self._to_minor(float(rate_usd)),
            currency="USD",
            manifest_version=self._manifest_version,
            effective_from=str(row.get("date", lookup.effective_date)),
            effective_to=None,
        )

    # Convenience: TS parity.
    async def aget_executed_rate(self, lookup: RateLookupInput) -> Optional[ExecutedRate]:
        return self.get_executed_rate(lookup)


def _parse_iso(d: str) -> date:
    return date.fromisoformat(d)
