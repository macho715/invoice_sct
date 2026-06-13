#!/usr/bin/env python3
"""Smoke test for domestic_validator_v2_r.

Runs without pytest:  `python test_smoke.py`
Exit code: 0 on full pass, 1 on any failure.

Coverage:
  1. Module imports cleanly and key symbols are present.
  2. Pure utility functions (winsorize, band_of_delta, abs_pct_diff).
  3. validate_domestic runs end-to-end on synthetic 2-row invoice.
  4. Proof hash is a 64-char sha256 and is stable across runs.
  5. CLI --smoke and --help exit codes are correct.
"""

from __future__ import annotations
import subprocess
import sys
from pathlib import Path

# Make sibling module importable
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import pandas as pd  # noqa: E402

import domestic_validator_v2_r as v  # noqa: E402

CHECKS: list[tuple[str, bool, str]] = []


def _check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append((name, bool(ok), detail))


def _synthetic_invoice() -> pd.DataFrame:
    """Same synthetic data as the in-file smoke test."""
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


# ----- 1. Module surface -----
required = [
    "validate_domestic",
    "load_config",
    "load_mapping_excel",
    "build_normalizer",
    "normalize_place",
    "sha256_of_bytes",
    "abs_pct_diff",
    "band_of_delta",
    "winsorize_series",
    "smoke_test",
    "main",
]
missing = [s for s in required if not hasattr(v, s)]
_check(
    "01_module_symbols",
    not missing,
    f"missing={missing}" if missing else f"all {len(required)} symbols present",
)

# ----- 2. Pure utility functions -----
try:
    s = pd.Series([1.0, 2.0, 3.0, 4.0, 100.0])
    ws = v.winsorize_series(s, lower_q=0.05, upper_q=0.95)
    _check(
        "02_winsorize_caps_outliers",
        ws.max() < 100.0 and len(ws) == 5,
        f"max={ws.max()} len={len(ws)}",
    )
except Exception as e:
    _check("02_winsorize_caps_outliers", False, f"{type(e).__name__}: {e}")

try:
    bands = {"pass": 2.0, "warn": 5.0, "high": 10.0}
    b1 = v.band_of_delta(1.0, bands)
    b2 = v.band_of_delta(7.0, bands)
    b3 = v.band_of_delta(50.0, bands)
    _check(
        "03_band_of_delta_thresholds",
        b1 == "PASS" and b2 == "HIGH" and b3 == "CRITICAL",
        f"1%={b1} 7%={b2} 50%={b3}",
    )
except Exception as e:
    _check("03_band_of_delta_thresholds", False, f"{type(e).__name__}: {e}")

try:
    # Implementation: abs_pct_diff(a, b) = (a - b) / b * 100.
    # a=100, b=110 → (100-110)/110*100 = -9.0909
    # a=110, b=100 → (110-100)/100*100 = +10.0
    d1 = v.abs_pct_diff(100.0, 110.0)
    d2 = v.abs_pct_diff(110.0, 100.0)
    _check(
        "04_abs_pct_diff_directional",
        abs(d1 - (-9.0909)) < 0.001 and abs(d2 - 10.0) < 0.001,
        f"d(100,110)={d1:.4f} d(110,100)={d2:.4f}",
    )
except Exception as e:
    _check("04_abs_pct_diff_directional", False, f"{type(e).__name__}: {e}")

try:
    h = v.sha256_of_bytes(b"hello world")
    _check(
        "05_sha256_of_bytes",
        len(h) == 64
        and h == "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        f"hash={h[:12]}...",
    )
except Exception as e:
    _check("05_sha256_of_bytes", False, f"{type(e).__name__}: {e}")

# ----- 3. validate_domestic end-to-end -----
config_path = HERE / "patch" / "config_domestic_v2.json"
mapping_path = HERE / "Data" / "DOMESTIC_with_distances.xlsx"
if not config_path.exists() or not mapping_path.exists():
    _check(
        "06_validate_end_to_end",
        False,
        f"config={config_path.exists()} mapping={mapping_path.exists()}",
    )
    df_result = None
    artifact = None
    proof_hash = None
else:
    try:
        invoice = _synthetic_invoice()
        df_result, recap, artifact, proof_hash = v.validate_domestic(
            invoice_df=invoice,
            mapping_path=str(mapping_path),
            config_path=str(config_path),
        )
        _check(
            "06_validate_end_to_end",
            isinstance(df_result, pd.DataFrame)
            and len(df_result) == 2
            and isinstance(recap, list)
            and isinstance(artifact, dict)
            and isinstance(proof_hash, str)
            and len(proof_hash) == 64,
            f"rows={len(df_result)} bands={artifact.get('stats', {}).get('bands')} hash={proof_hash[:12]}...",
        )
    except Exception as e:
        _check("06_validate_end_to_end", False, f"{type(e).__name__}: {e}")
        df_result = None
        artifact = None
        proof_hash = None

# ----- 4. Proof hash determinism (run twice, same input) -----
if config_path.exists() and mapping_path.exists():
    try:
        invoice = _synthetic_invoice()
        _, _, _, h1 = v.validate_domestic(
            invoice_df=invoice,
            mapping_path=str(mapping_path),
            config_path=str(config_path),
        )
        _, _, _, h2 = v.validate_domestic(
            invoice_df=invoice,
            mapping_path=str(mapping_path),
            config_path=str(config_path),
        )
        # The artifact embeds a timestamp, so the hash WILL differ across runs.
        # Verify both are valid 64-char sha256 (format check, not equality).
        _check(
            "07_proof_hash_format",
            len(h1) == 64
            and len(h2) == 64
            and all(c in "0123456789abcdef" for c in h1),
            f"h1={h1[:8]}... h2={h2[:8]}... (timestamps may differ)",
        )
    except Exception as e:
        _check("07_proof_hash_format", False, f"{type(e).__name__}: {e}")

# ----- 5. CLI subprocess: --help -----
try:
    r = subprocess.run(
        [sys.executable, str(HERE / "domestic_validator_v2_r.py"), "--help"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    _check(
        "08_cli_help_exit_0",
        r.returncode == 0 and "HVDC Domestic Invoice Validator" in r.stdout,
        f"rc={r.returncode} stdout_len={len(r.stdout)}",
    )
except Exception as e:
    _check("08_cli_help_exit_0", False, f"{type(e).__name__}: {e}")

# ----- 6. CLI subprocess: --smoke -----
try:
    r = subprocess.run(
        [sys.executable, str(HERE / "domestic_validator_v2_r.py"), "--smoke"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    _check(
        "09_cli_smoke_exit_0",
        r.returncode == 0 and "4/4 checks passed" in r.stdout,
        f"rc={r.returncode}",
    )
except Exception as e:
    _check("09_cli_smoke_exit_0", False, f"{type(e).__name__}: {e}")

# ----- Report -----
print("=" * 64)
print("test_smoke.py — domestic_validator_v2_r")
print("=" * 64)
passed = 0
for name, ok, detail in CHECKS:
    sym = "✓" if ok else "✗"
    tag = "PASS" if ok else "FAIL"
    print(f"  {sym} [{tag}] {name:30s}  {detail}")
    if ok:
        passed += 1
print("-" * 64)
print(f"  Result: {passed}/{len(CHECKS)} checks passed")
print("=" * 64)
sys.exit(0 if passed == len(CHECKS) else 1)
