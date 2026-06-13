#!/usr/bin/env python3
"""Validate email drafting guard patch for HVDC communication ontology."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
checks = []

def require(path: str, token: str, label: str):
    text = (ROOT / path).read_text(encoding="utf-8")
    ok = token in text
    checks.append((label, ok, path, token))

def forbid(path: str, token: str, label: str):
    text = (ROOT / path).read_text(encoding="utf-8")
    ok = token not in text
    checks.append((label, ok, path, f"forbidden {token}"))

require("AGENTS.md", "Email drafting mode boundary", "AGENTS email drafting boundary")
require("AGENTS.md", "AUTO_SCT_ONTOLOGY_REQUIRED", "AGENTS auto ontology token")
require("AGENTS.md", "[EMAIL_ACTION_CARD]", "AGENTS hard-marked card template")
require("data/corpus/CONSOLIDATED-00-master-ontology.md", "V-COMM-DRAFT-001", "Master validation rule")
require("data/corpus/CONSOLIDATED-08-communication.md", "Email Drafting Guard", "Communication drafting guard")
require("data/corpus/CONSOLIDATED-08-communication.md", "EmailActionCard", "Communication EmailActionCard class/rule")
require("data/corpus/CONSOLIDATED-08-communication.md", "COMM-DRAFT-002", "Communication auto ontology gate")
require("data/corpus/CONSOLIDATED-08-communication.md", "sct_ontology` not invoked or not surfaced", "Communication missing ontology block condition")
require("ontology/HVDC_Logistics_Ontology.combined.md", "Email Drafting Guard", "Combined corpus includes guard")

for path in [
    "AGENTS.md",
    "data/corpus/CONSOLIDATED-00-master-ontology.md",
    "data/corpus/CONSOLIDATED-08-communication.md",
    "ontology/HVDC_Logistics_Ontology.combined.md",
]:
    forbid(path, "NO_AUTO_SCT_ONTOLOGY", f"{path} removes no-auto ontology token")

failed = [c for c in checks if not c[1]]
for label, ok, path, token in checks:
    status = "PASS" if ok else "FAIL"
    print(f"{status}: {label} ({path})")

if failed:
    print("\nBlockers:")
    for label, ok, path, token in failed:
        print(f"- {label}: missing {token!r} in {path}")
    sys.exit(1)

print("\nPASS: email drafting guard patch validated.")
