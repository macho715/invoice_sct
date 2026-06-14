"""MCP client wrappers for MarkItDown and NotebookLM streamable HTTP servers."""
import base64
import contextlib
import json
import os
from typing import Any, Optional

import httpx

try:
    from mcp.client.streamable_http import streamable_http_client
    from mcp import ClientSession
except ImportError:
    streamable_http_client = None
    ClientSession = None


class McpClientUnavailable(Exception):
    pass


class McpToolError(Exception):
    pass


def _result_to_text(result: Any) -> str:
    """Extract text from common MCP CallToolResult shapes."""
    content = getattr(result, "content", None)
    if content is None and isinstance(result, dict):
        content = result.get("content")

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            text = getattr(item, "text", None)
            if text is None and isinstance(item, dict):
                text = item.get("text")
            if text is not None:
                parts.append(str(text))
        if parts:
            return "\n".join(parts)

    if isinstance(result, str):
        return result
    return str(result)


class StreamableMcpClient:
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        self.base_url = base_url
        if not self.base_url:
            raise McpClientUnavailable("MCP base URL not set")
        self.timeout = timeout

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if streamable_http_client is None or ClientSession is None:
            raise McpClientUnavailable("MCP Python SDK not installed")
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as http_client:
            async with streamable_http_client(self.base_url, http_client=http_client) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    return await session.call_tool(name, arguments=arguments)

    async def call_tool_text(self, name: str, arguments: dict[str, Any]) -> str:
        return _result_to_text(await self.call_tool(name, arguments))


class MarkItDownMcpClient(StreamableMcpClient):
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        super().__init__(base_url or os.environ.get("MARKITDOWN_MCP_URL"), timeout=timeout)

    async def convert_pdf_bytes(self, pdf_bytes: bytes) -> str:
        data_uri = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode("ascii")
        return await self.call_tool_text("convert_to_markdown", {"uri": data_uri})


class NotebookLmMcpClient(StreamableMcpClient):
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        super().__init__(base_url or os.environ.get("NOTEBOOKLM_MCP_URL"), timeout=timeout)

    async def add_source(self, text: str, notebook_id: Optional[str] = None) -> str:
        arguments: dict[str, Any] = {"type": "text", "content": text}
        if notebook_id:
            arguments["notebook_id"] = notebook_id
        raw = await self.call_tool_text("add_source", arguments)
        parsed = None
        with contextlib.suppress(json.JSONDecodeError, ValueError):
            parsed = json.loads(raw)
        if isinstance(parsed, dict):
            if parsed.get("success") is False:
                data = parsed.get("data") if isinstance(parsed.get("data"), dict) else {}
                result = data.get("result") if isinstance(data.get("result"), dict) else {}
                error = (
                    parsed.get("error")
                    or parsed.get("message")
                    or data.get("error")
                    or data.get("message")
                    or result.get("error")
                    or result.get("message")
                    or "NotebookLM add_source failed"
                )
                raise McpToolError(str(error))
            data = parsed.get("data") if isinstance(parsed.get("data"), dict) else {}
            source_id = (
                parsed.get("source_id")
                or parsed.get("notebooklm_source_id")
                or parsed.get("id")
                or data.get("source_id")
                or data.get("notebooklm_source_id")
                or data.get("id")
            )
            if source_id:
                return str(source_id)
        return raw

    async def ask_question(self, question: str, notebook_id: Optional[str] = None) -> str:
        arguments: dict[str, Any] = {"question": question}
        if notebook_id:
            arguments["notebook_id"] = notebook_id
        return await self.call_tool_text("ask_question", arguments)
