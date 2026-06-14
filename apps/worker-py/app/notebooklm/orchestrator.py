import hashlib
import hmac
import json
import os
from typing import Any, Optional
import httpx

from .extractor import parse_extraction
from .mcp_client import MarkItDownMcpClient, NotebookLmMcpClient, McpClientUnavailable, McpToolError
from .prompts import EXTRACTION_PROMPT

STRICT_JSON_RETRY_SUFFIX = "\n\nReturn JSON only. No prose, no markdown fences, no comments."


class NotebookLmOrchestrator:
    def __init__(self):
        self.markitdown_url = os.environ.get("MARKITDOWN_MCP_URL")
        self.web_callback = os.environ.get("WEB_CALLBACK_URL")
        self.callback_secret = os.environ.get("NOTEBOOKLM_CALLBACK_SECRET")
        self.notebook_id = os.environ.get("NOTEBOOKLM_DEFAULT_NOTEBOOK_ID")
        self.notebooklm_url = os.environ.get("NOTEBOOKLM_MCP_URL")

    async def run(self, job_id: str, blob_url: str, notebook_id: Optional[str] = None) -> dict:
        if not self.markitdown_url:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "MARKITDOWN_MCP_URL_NOT_SET"}
        if not self.notebooklm_url:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "NOTEBOOKLM_MCP_URL_NOT_SET"}
        if not self.web_callback:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "WEB_CALLBACK_URL_NOT_SET"}
        if not self.callback_secret:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "NOTEBOOKLM_CALLBACK_SECRET_NOT_SET"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            pdf_resp = await client.get(blob_url)
            pdf_resp.raise_for_status()
            pdf_bytes = pdf_resp.content

        source_sha256 = hashlib.sha256(pdf_bytes).hexdigest()

        markdown = await self._call_markitdown(pdf_bytes)
        if not markdown:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "MARKITDOWN_FAILED"}

        markdown_sha256 = hashlib.sha256(markdown.encode("utf-8")).hexdigest()

        try:
            client = NotebookLmMcpClient()
            selected_notebook_id = notebook_id or self.notebook_id
            source_id = await client.add_source(markdown, notebook_id=selected_notebook_id)
            answer = await client.ask_question(EXTRACTION_PROMPT, notebook_id=selected_notebook_id)
            extracted = parse_extraction(answer)
            if "JSON_PARSE_FAILED" in extracted.get("flags", []):
                answer = await client.ask_question(
                    EXTRACTION_PROMPT + STRICT_JSON_RETRY_SUFFIX,
                    notebook_id=selected_notebook_id,
                )
                extracted = parse_extraction(answer)
        except McpToolError as e:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "NOTEBOOKLM_TOOL_FAILED", "detail": str(e)}
        except McpClientUnavailable as e:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": str(e)}
        except Exception as e:
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": type(e).__name__}

        payload = {
            "job_id": job_id,
            "notebooklm_source_id": source_id,
            "summary": extracted,
            "markdown_sha256": markdown_sha256,
            "source_sha256": source_sha256,
        }

        callback_status = await self._send_callback(payload)
        if callback_status >= 400:
            return {
                "status": "CALLBACK_REJECTED",
                "notebooklm_source_id": source_id,
                "markdown_sha256": markdown_sha256,
                "source_sha256": source_sha256,
                "callback_status": callback_status,
            }

        return {
            "status": "CALLBACK_SENT",
            "notebooklm_source_id": source_id,
            "markdown_sha256": markdown_sha256,
            "source_sha256": source_sha256,
            "callback_status": callback_status,
        }

    async def _call_markitdown(self, pdf_bytes: bytes) -> Optional[str]:
        try:
            return await MarkItDownMcpClient(self.markitdown_url).convert_pdf_bytes(pdf_bytes)
        except Exception:
            return None

    async def _send_callback(self, payload: dict) -> int:
        raw = json.dumps(payload, separators=(",", ":"))
        sig = hmac.new(self.callback_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                self.web_callback,
                content=raw,
                headers={
                    "Content-Type": "application/json",
                    "X-NotebookLM-Signature": f"sha256={sig}",
                },
            )
            return response.status_code
