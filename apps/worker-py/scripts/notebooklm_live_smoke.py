"""Run a live NotebookLM/MarkItDown worker smoke test.

This helper requires real MCP and callback environment variables. It prints
only hashes/status metadata returned by the orchestrator and never prints raw
PDF, Markdown, NotebookLM answer text, or callback body.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.notebooklm.orchestrator import NotebookLmOrchestrator  # noqa: E402


REQUIRED_ENV = (
    "MARKITDOWN_MCP_URL",
    "NOTEBOOKLM_MCP_URL",
    "WEB_CALLBACK_URL",
    "NOTEBOOKLM_CALLBACK_SECRET",
)


def _missing_env() -> list[str]:
    return [name for name in REQUIRED_ENV if not os.environ.get(name)]


async def _run() -> int:
    parser = argparse.ArgumentParser(
        description="Live smoke test for PDF -> MarkItDown MCP -> NotebookLM MCP -> Vercel callback."
    )
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--blob-url", required=True)
    parser.add_argument("--notebook-id")
    args = parser.parse_args()

    missing = _missing_env()
    if missing:
        print(json.dumps({"status": "ENV_MISSING", "missing": missing}, indent=2))
        return 2

    result = await NotebookLmOrchestrator().run(
        job_id=args.job_id,
        blob_url=args.blob_url,
        notebook_id=args.notebook_id,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("status") == "CALLBACK_SENT" else 1


def main() -> None:
    raise SystemExit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
