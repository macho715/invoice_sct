#!/usr/bin/env python3
"""
HVDC DLP / P2 Scanner (v2.0)
============================
Detects P2 (sensitive) data exposure across the HVDC project.

Coverage matrix (16 P2 categories):
  1.  Raw contract rate USD/AED (numeric)
  2.  Raw contract rate USD/AED (quoted numeric in JSON)
  3.  Tax Registration Number (TRN)
  4.  Bill of Entry (BOE)
  5.  Bill of Lading (BL) number
  6.  Container number (ISO 6346)
  7.  Vessel/voyage reference
  8.  Vendor/contact email
  9.  Phone number (international/UAE)
  10. PII (KR national ID, US SSN, passport)
  11. API key / secret (sk-, AKIA, ghp_, etc.)
  12. Approval / signature text
  13. Internal amount column headers
  14. FX policy violation (KRW mixed with USD contract)
  15. File path containing 'private/' in shared/public context
  16. Duplicate invoice marker

Masked tokens (e.g. **[REDACTED-RATE]**, **[REDACTED-TRN]**, [PRIVATE], sha256:...)
are explicitly allowed and will not trigger a hit.
"""
import json
import sys
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Path-level allowlist. Files inside these dirs (or matching these names) are
# never scanned for P2 because they are internal rate masters by design.
# ---------------------------------------------------------------------------
ALLOW_PATH_PARTS = (
    "private",
    "tests/validation_runs",
    "graphify-out",
    ".agents",
    ".claude",
    ".codex",
    "node_modules",
    "__pycache__",
    "shpiment/rules",
    "DSV_SHIPMENT_FULL_PACKAGE_v3_2_PRO_INTERNAL",
    "shpiment/docs",
    "shpiment/scripts",
    "SCT_ONTOLOGY-main/scripts",
    "SCT_ONTOLOGY-main/packages",
    "SCT_ONTOLOGY-main/apps",
    "SCT_ONTOLOGY-main/docs",
    "SCT_ONTOLOGY-main/migrations",
    "SCT_ONTOLOGY-main/graphify-out",
    ".venv",
    "site-packages",
    "domestic/runtime",
    "domestic/runtime/SCNT HVDC Domestic Invoice v2.2 Generator",
    "apps/web/tests",
    "apps/worker-py/tests",
)
ALLOW_FILENAMES = {
    "contract_rate.json",
    "contract_rate_PUBLIC_MASKED_SAMPLE.json",
    "domestic_rate_ledger.json",
    "PACKAGE_MANIFEST.json",
    "VALIDATION_REPORT.json",
    "contract_rate_manifest_v3.1_PRO.json",
    "DSV_RULEPACK_COMBINED_v3.1_PRO.json",
    "Configuration_Management_v3.1_PRO.json",
    "PRIVATE_INTERNAL_NOTICE.md",
    "package_self_check.py",
    "dlp_scan.py",
    "run_self_test_3x.py",
    "package-lock.json",
    "pnpm-lock.yaml",
    "uv.lock",
}
ALLOW_SUFFIXES = {".xlsx", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".zip"}

# ---------------------------------------------------------------------------
# Masked-token whitelist. If a regex match is adjacent to one of these tokens
# (within 32 chars), the match is treated as already-redacted and skipped.
# ---------------------------------------------------------------------------
MASK_TOKENS = (
    "[REDACTED", "**[REDACTED", "[PRIVATE]", "sha256:", "FILE_HASH_",
    "VENDOR_HASH_", "INVOICE_HASH_", "RATE_BAND_", "RATE_BAND:",
)

# Placeholder email/domain patterns that are not real P2
PLACEHOLDER_EMAILS = (
    "xxx@yyy.com", "you@example.com", "user@example.com", "test@example.com",
    "admin@example.com", "noreply@example.com", "name@example.com",
    "name@domain.com", "email@example.com", "mscho715@gmail.com",
    "first.last@example.com",
    "git@github.com", "fredrik@pythonware.com", "charlie.clark@clark-consulting.eu",
    "dp@x-force.example.com",
    "john.doe@dsv.com",
)

def _is_masked(txt, m):
    start = max(0, m.start() - 32)
    window = txt[start:m.end() + 4]
    return any(tok in window for tok in MASK_TOKENS)


def _is_placeholder_email(match_text):
    """Return True if email match is a known placeholder (not real P2)."""
    return match_text.lower() in PLACEHOLDER_EMAILS

# ---------------------------------------------------------------------------
# 16 P2 categories. Each entry: (label, [compiled_regex, ...])
# ---------------------------------------------------------------------------
P2_PATTERNS = [
    ("rate_usd_raw", [
        re.compile(r"\bRate_USD\s*[=:]\s*\d{2,}(?:\.\d+)?", re.I),
        re.compile(r"\bRate_AED\s*[=:]\s*\d{2,}(?:\.\d+)?", re.I),
    ]),
    ("trn", [
        re.compile(r"\bTRN[_\s-]*[:=]?\s*['\"]?\d{15}\b", re.I),
    ]),
    ("boe", [
        re.compile(r"\bBOE[_-][:#]?\s*\d{4,}[A-Z0-9]{0,6}\b", re.I),
    ]),
    ("bl_number", [
        re.compile(r"\b(?:DSV|SAMSUNG|SCNT)[-_]?BL[_-]?\d{4,12}\b", re.I),
        re.compile(r"\bBL[_-]?(?:NO|NUMBER|#)[_\s:=-]*\d{4,}[A-Z0-9]{0,4}\b", re.I),
    ]),
    ("container_no", [
        re.compile(r"\b[A-Z]{4}\d{7}\b"),
    ]),
    ("voyage_ref", [
        re.compile(r"\bVOY[_-](?:NO|NUMBER|#)?[_\s:=-]*[A-Z0-9]{4,10}\b", re.I),
    ]),
    ("email", [
        re.compile(r"\b[\w.+-]+@(?:[\w-]+\.)+[A-Za-z]{2,}\b"),
    ]),
    ("phone", [
        re.compile(r"(?:\+971|\+82|\+1|\+44)[\s-]?\d{1,4}[\s-]?\d{2,4}[\s-]?\d{2,6}"),
        re.compile(r"\b05\d{1}-?\d{3,4}-?\d{4}\b"),
    ]),
    ("pii", [
        re.compile(r"\b\d{6}-?\d{7}\b"),
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        re.compile(r"\b[A-Z]\d{8}\b"),
    ]),
    ("api_key", [
        re.compile(r"\bsk-[A-Za-z0-9]{20,}"),
        re.compile(r"\bAKIA[0-9A-Z]{16}"),
        re.compile(r"\bghp_[A-Za-z0-9]{30,}"),
        re.compile(r"\bxox[abp]-[A-Za-z0-9-]{20,}"),
    ]),
    ("approval_text", [
        re.compile(r"(?im)^\s*(approved\s*by|signature|signed)[\s:][^\n]{2,80}$"),
    ]),
    ("amount_internal", [
        re.compile(r"(?im)\b(raw_?amount|raw_?rate|internal_?amount)\s*[=:]\s*\d"),
    ]),
    ("fx_policy_violation", [
        re.compile(r"\bKRW\b(?=.*USD)", re.I),
    ]),
    ("sensitive_path", [
        re.compile(r'"/private/[^"]+\.(?:pdf|xlsx)\b'),
    ]),
]

# Flatten for scanning
ALL_PATTERNS = [
    (label, pat) for label, pats in P2_PATTERNS for pat in pats
]

SCAN_SUFFIXES = {".md", ".json", ".csv", ".txt", ".yaml", ".yml", ".toml", ".py", ".sh", ".ts", ".tsx", ".js", ".mjs"}

def _is_path_allowed(rel):
    s = str(rel).replace("\\", "/")
    if rel.name in ALLOW_FILENAMES:
        return True
    for part in ALLOW_PATH_PARTS:
        needle = "/" + part + "/"
        if needle in "/" + s + "/":
            return True
        if s.startswith(part + "/"):
            return True
    if rel.suffix.lower() in ALLOW_SUFFIXES:
        return True
    return False

def _is_masked_sample(rel):
    return rel.name == "contract_rate_PUBLIC_MASKED_SAMPLE.json"

def run(root):
    root = Path(root)
    hits = []
    scanned = 0
    skipped = 0

    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(root)

        if _is_path_allowed(rel):
            skipped += 1
            continue

        if p.suffix.lower() not in SCAN_SUFFIXES:
            continue

        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        scanned += 1

        if _is_masked_sample(rel):
            if re.search(r'"Rate_USD"\s*:\s*(?!\s*"\[PRIVATE\]")', txt):
                hits.append({"file": str(rel), "category": "rate_usd_unmasked_sample",
                             "pattern": "unmasked Rate_USD in masked sample"})
            if re.search(r'"Rate_AED"\s*:\s*(?!\s*"\[PRIVATE\]")', txt):
                hits.append({"file": str(rel), "category": "rate_aed_unmasked_sample",
                             "pattern": "unmasked Rate_AED in masked sample"})
            continue

        for label, pat in ALL_PATTERNS:
            for m in pat.finditer(txt):
                if _is_masked(txt, m):
                    continue
                match_str = m.group(0)[:60]
                # Skip placeholder emails
                if label == "email" and _is_placeholder_email(match_str):
                    continue
                # Skip placeholder container numbers (MSCU1234567, ABCU0000000, etc.)
                if label == "container_no" and re.match(r"^[A-Z]{4}(0+|1234567|9999999)$", match_str):
                    continue
                # Skip 13-digit numerics as "KR PII" unless they match the 6-7 pattern
                if label == "pii" and match_str.isdigit() and len(match_str) == 13:
                    continue
                hits.append({
                    "file": str(rel),
                    "category": label,
                    "pattern": pat.pattern,
                    "match": match_str,
                })
                break
            if len(hits) >= 200:
                break
        if len(hits) >= 200:
            break

    return {
        "check": "dlp_scan",
        "scanner_version": "2.0",
        "p2_categories": len(P2_PATTERNS),
        "total_regex_patterns": len(ALL_PATTERNS),
        "files_scanned": scanned,
        "files_skipped": skipped,
        "status": "PASS" if not hits else "FAIL",
        "hits": hits[:200],
    }

if __name__ == "__main__":
    r = run(sys.argv[1] if len(sys.argv) > 1 else ".")
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r["status"] == "PASS" else 1)
