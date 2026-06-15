import hashlib
import hmac
import ipaddress
import json
import logging
import os
import socket
from urllib.parse import urlparse
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

from .extractor import parse_extraction
from .mcp_client import MarkItDownMcpClient, NotebookLmMcpClient, McpClientUnavailable, McpToolError
from .prompts import EXTRACTION_PROMPT

STRICT_JSON_RETRY_SUFFIX = "\n\nReturn JSON only. No prose, no markdown fences, no comments."
DEFAULT_BLOB_ALLOWED_HOSTS = (".blob.vercel-storage.com",)


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
        if not self._is_safe_blob_url(blob_url):
            return {"status": "NOTEBOOKLM_UNAVAILABLE", "error_code": "INVALID_BLOB_URL"}

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

    def _is_public_ip(self, ip_str: str) -> bool:
        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        return ip_obj.is_global

    def _blob_allowed_hosts(self) -> tuple[str, ...]:
        raw = os.environ.get("NOTEBOOKLM_BLOB_ALLOWED_HOSTS", "")
        configured = tuple(host.strip().lower() for host in raw.split(",") if host.strip())
        return configured or DEFAULT_BLOB_ALLOWED_HOSTS

    def _is_allowed_blob_hostname(self, hostname: str) -> bool:
        normalized = hostname.rstrip(".").lower()
        for allowed in self._blob_allowed_hosts():
            allowed = allowed.rstrip(".").lower()
            if allowed.startswith("."):
                if normalized.endswith(allowed):
                    return True
            elif normalized == allowed:
                return True
        return False

    def _is_safe_blob_url(self, blob_url: str) -> bool:
        try:
            parsed = urlparse(blob_url)
        except Exception:
            return False

        if parsed.scheme not in {"http", "https"}:
            return False
        if not parsed.hostname:
            return False
        if not self._is_allowed_blob_hostname(parsed.hostname):
            return False

        try:
            addrinfos = socket.getaddrinfo(parsed.hostname, None)
        except socket.gaierror:
            return False

        for info in addrinfos:
            ip_str = info[4][0]
            if not self._is_public_ip(ip_str):
                return False

        return True

    async def _call_markitdown(self, pdf_bytes: bytes) -> Optional[str]:
        try:
            return await MarkItDownMcpClient(self.markitdown_url).convert_pdf_bytes(pdf_bytes)
        except Exception as e:
            logger.error("MarkItDown MCP call failed: %r", e)
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
