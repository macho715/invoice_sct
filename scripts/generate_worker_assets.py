#!/usr/bin/env python3
"""Generate TypeScript modules that let the MCP server run on Cloudflare Workers."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "server" / "src" / "generated"
CORPUS_DIR = ROOT / "data" / "corpus"
SAMPLE_SHIPMENTS = ROOT / "data" / "sample_shipments.json"
WIDGET_HTML = ROOT / "public" / "hvdc-answer-widget.html"

DOMAIN_BY_DOC: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"00|master", re.I), ["master"]),
    (re.compile(r"01|framework|infra", re.I), ["compliance"]),
    (re.compile(r"02|warehouse|whp", re.I), ["warehouse"]),
    (re.compile(r"03|document|ocr", re.I), ["document"]),
    (re.compile(r"04|marine|barge|bulk|oog", re.I), ["marine"]),
    (re.compile(r"05|invoice|cost", re.I), ["cost"]),
    (re.compile(r"06|material|chain", re.I), ["material"]),
    (re.compile(r"07|port|ofco", re.I), ["port"]),
    (re.compile(r"08|communication", re.I), ["communication"]),
    (re.compile(r"09|operations|analytics", re.I), ["operations"]),
    (re.compile(r"fmc|role|actorrole|역할", re.I), ["communication", "operations", "team"]),
]


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def version_of(text: str) -> str:
    version = re.search(r"version:\s*['\"]?([^'\"\n]+)", text, flags=re.I)
    date = re.search(r"date:\s*['\"]?([^'\"\n]+)", text, flags=re.I)
    return (version.group(1) if version else date.group(1) if date else "sample-2026-05-10").strip()


def title_of(text: str, fallback: str) -> str:
    title = re.search(r"^#\s+(.+)$", text, flags=re.M)
    return title.group(1).strip() if title else fallback


def domains_for_file(file_name: str) -> list[str]:
    domains: set[str] = set()
    for pattern, values in DOMAIN_BY_DOC:
        if pattern.search(file_name):
            domains.update(values)
    return sorted(domains or {"master"})


def sectionize(text: str) -> list[dict[str, str]]:
    lines = text.splitlines()
    sections: list[dict[str, str]] = []
    current_title = "Document Root"
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        body = "\n".join(buffer).strip()
        if body:
            sections.append({"sectionPath": current_title, "text": body})
        buffer = []

    for line in lines:
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush()
            current_title = heading.group(2).strip()
        else:
            buffer.append(line)
    flush()
    return sections or [{"sectionPath": "Document Root", "text": text}]


def write_ts(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8", newline="\n")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    chunks: list[dict[str, object]] = []
    for file in sorted(CORPUS_DIR.glob("*.md")):
        raw = file.read_text(encoding="utf-8")
        doc_hash = sha256(raw)
        doc_id = file.stem
        title = title_of(raw, doc_id)
        version = version_of(raw)
        domains = domains_for_file(file.name)
        for index, section in enumerate(sectionize(raw), start=1):
            chunks.append(
                {
                    "id": f"{doc_id}#{index}",
                    "docId": doc_id,
                    "title": title,
                    "version": version,
                    "sectionPath": section["sectionPath"],
                    "text": section["text"],
                    "docHash": doc_hash,
                    "domains": domains,
                }
            )

    write_ts(
        OUT_DIR / "corpus-data.ts",
        "import type { CorpusChunk } from \"../types.js\";\n\n"
        f"export const CORPUS_CHUNKS = {json.dumps(chunks, ensure_ascii=False, indent=2)} satisfies CorpusChunk[];\n",
    )

    sample_shipments = json.loads(SAMPLE_SHIPMENTS.read_text(encoding="utf-8"))
    write_ts(
        OUT_DIR / "sample-shipments.ts",
        f"export const SAMPLE_SHIPMENTS = {json.dumps(sample_shipments, ensure_ascii=False, indent=2)} as const;\n",
    )

    widget_html = WIDGET_HTML.read_text(encoding="utf-8")
    write_ts(
        OUT_DIR / "widget-html.ts",
        f"export const DEFAULT_WIDGET_HTML = {json.dumps(widget_html, ensure_ascii=False)};\n",
    )

    print(f"Generated {len(chunks)} corpus chunks and worker assets in {OUT_DIR}")


if __name__ == "__main__":
    main()
