#!/usr/bin/env python3
"""Build a lightweight corpus inventory for the HVDC Ontology ChatGPT App."""
from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORPUS_DIR = ROOT / "data" / "corpus"
INDEX_DIR = ROOT / "data" / "index"


def repo_path(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def version_of(text: str) -> str:
    m = re.search(r"version:\s*['\"]?([^'\"\n]+)", text, flags=re.I)
    return m.group(1).strip() if m else "sample-0.1"


def title_of(text: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, flags=re.M)
    return m.group(1).strip() if m else fallback


def main() -> None:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    docs = []
    chunks = []
    for file in sorted(CORPUS_DIR.glob("*.md")):
        text = file.read_text(encoding="utf-8")
        doc_hash = sha256(text)
        doc = {
            "docId": file.stem,
            "file": repo_path(file),
            "title": title_of(text, file.stem),
            "version": version_of(text),
            "docHash": doc_hash,
            "sizeBytes": file.stat().st_size,
        }
        docs.append(doc)
        sections = re.split(r"(?m)^#{1,6}\s+", text)
        headings = re.findall(r"(?m)^#{1,6}\s+(.+)$", text)
        for i, body in enumerate(sections[1:] if len(sections) > 1 else sections):
            heading = headings[i] if i < len(headings) else "Document Root"
            if body.strip():
                chunks.append({
                    "id": f"{file.stem}#{i+1}",
                    "docId": file.stem,
                    "sectionPath": heading.strip(),
                    "docHash": doc_hash,
                    "textPreview": re.sub(r"\s+", " ", body).strip()[:240],
                })

    (INDEX_DIR / "corpus_index.json").write_text(json.dumps({"docs": docs, "chunks": chunks}, indent=2, ensure_ascii=False), encoding="utf-8")
    with (INDEX_DIR / "corpus_inventory.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["docId", "file", "title", "version", "docHash", "sizeBytes"],
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(docs)
    print(f"Indexed {len(docs)} docs and {len(chunks)} chunks into {INDEX_DIR}")


if __name__ == "__main__":
    main()
