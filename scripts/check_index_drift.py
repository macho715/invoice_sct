#!/usr/bin/env python3
"""Validate generated index artifacts after `npm run index`."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATED_INDEX_FILES = [
    "data/index/corpus_index.json",
    "data/index/corpus_inventory.csv",
]
MANUAL_JSON_FILES = [
    "data/index/source_role_map.json",
]


def validate_json(relative_path: str) -> None:
    path = ROOT / relative_path
    with path.open("r", encoding="utf-8") as f:
        json.load(f)


def main() -> int:
    for relative_path in ["data/index/corpus_index.json", *MANUAL_JSON_FILES]:
        try:
            validate_json(relative_path)
        except Exception as exc:
            print(f"JSON validation failed for {relative_path}: {exc}", file=sys.stderr)
            return 1

    result = subprocess.run(
        ["git", "diff", "--exit-code", "--", *GENERATED_INDEX_FILES],
        cwd=ROOT,
        text=True,
    )
    if result.returncode != 0:
        changed = subprocess.run(
            ["git", "diff", "--name-only", "--", *GENERATED_INDEX_FILES],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        ).stdout.strip()
        print(
            "Generated corpus index files differ from committed files. "
            "Run `npm run index` and commit the regenerated artifacts.",
            file=sys.stderr,
        )
        if changed:
            print(changed, file=sys.stderr)
        return result.returncode

    print("Index artifacts are current; source_role_map.json is valid JSON.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
