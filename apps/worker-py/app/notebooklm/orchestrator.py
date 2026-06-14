import hashlib
import hmac
import json
import os
from typing import Any, Optional
import httpx

from .extractor import parse_extraction
from .mcp_client import NotebookLmMcpClient, McpClientUnavailable
from .prompts import EXTRACTION_PROMPT


class NotebookLmOrchestrator:
    def __init__(self):
        self.markitdown_url = os.environ.get("MARKITDOWN_MCP_URL")
        self.web_callback = os.environ.get("WEB_CALLBACK_URL")
        self.callback_secret = os.environ.get("NOTEBOOKLM_CALLBACK_SECRET")
        self.notebook_id = os.environ.get("NOTEBOOKLM_DEFAULT_NOTEBOOK_ID")

    async def run(self, job_id: str, blob_url: str, notebook_id: Optional[str] = None) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            pdf_resp = await client.get(blob_url)
            pdf_resp.raise_for_status()
            pdf_bytes = pdf_resp.content

        source_sha256 = hashlib.sha256(pdf_bytes).hexdigest()

        if self.markitdown_url:
            markdown = await self._call_markitdown(pdf_bytes)
        else:
            markdown = pdf_bytes.decode("utf-8", errors="ignore")

        if not markdown:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "MARKITDOWN_FAILED"}

        markdown_sha256 = hashlib.sha256(markdown.encode("utf-8")).hexdigest()

        try:
            client = NotebookLmMcpClient()
            source_id = await client.add_source(markdown)
            answer = await client.ask_question(EXTRACTION_PROMPT)
        except McpClientUnavailable as e:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": str(e)}
        except Exception as e:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": type(e).__name__}

        extracted = parse_extraction(answer)

        payload = {
            "job_id": job_id,
            "notebooklm_source_id": source_id,
            "summary": extracted,
            "markdown_sha256": markdown_sha256,
            "source_sha256": source_sha256,
        }

        if self.web_callback and self.callback_secret:
            await self._send_callback(payload)

        return {
            "status": "CALLBACK_SENT",
            "notebooklm_source_id": source_id,
            "markdown_sha256": markdown_sha256,
            "source_sha256": source_sha256,
        }

    async def _call_markitdown(self, pdf_bytes: bytes) -> Optional[str]:
        return pdf_bytes.decode("utf-8", errors="ignore")

    async def _send_callback(self, payload: dict) -> None:
        raw = json.dumps(payload, separators=(",", ":"))
        sig = hmac.new(self.callback_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                self.web_callback,
                content=raw,
                headers={
                    "Content-Type": "application/json",
                    "X-NotebookLM-Signature": f"sha256={sig}",
                },
            )
