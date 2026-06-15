"""MCP client wrappers for MarkItDown and NotebookLM streamable HTTP servers."""
import base64
import contextlib
import json
import os
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

try:
    from mcp.client.streamable_http import streamable_http_client
    from mcp import ClientSession
except ImportError:
    streamable_http_client = None
    ClientSession = None


def _fetch_id_token(audience: str) -> str:
    """Mint a Google-signed ID token for `audience` (a Cloud Run service URL).

    Uses Application Default Credentials / the Cloud Run metadata server so a
    worker on Cloud Run can call an IAM-protected (`--no-allow-unauthenticated`)
    MCP service. Raises McpClientUnavailable if google-auth is missing or the
    mint fails (the orchestrator treats that as MARKITDOWN_FAILED).
    """
    try:
        import google.auth.transport.requests
        import google.oauth2.id_token
    except ImportError as e:  # pragma: no cover - exercised via patched tests
        raise McpClientUnavailable("google-auth not installed for ID token") from e
    try:
        request = google.auth.transport.requests.Request()
        return google.oauth2.id_token.fetch_id_token(request, audience)
    except Exception as e:
        raise McpClientUnavailable(f"failed to mint ID token: {e!r}") from e


class McpClientUnavailable(Exception):
    pass


class McpToolError(Exception):
    pass


def _float_env(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


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
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0, use_id_token: bool = False):
        self.base_url = base_url
        if not self.base_url:
            raise McpClientUnavailable("MCP base URL not set")
        self.timeout = timeout
        self.use_id_token = use_id_token

    def _auth_headers(self) -> dict[str, str]:
        """Authorization header for IAM-protected Cloud Run MCP services.

        Empty when `use_id_token` is off (the default), so the httpx client is
        constructed exactly as before for non-Cloud-Run / public endpoints.
        """
        if not self.use_id_token:
            return {}
        parsed = urlparse(self.base_url)
        audience = f"{parsed.scheme}://{parsed.netloc}"
        return {"Authorization": f"Bearer {_fetch_id_token(audience)}"}

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if streamable_http_client is None or ClientSession is None:
            raise McpClientUnavailable("MCP Python SDK not installed")
        http_kwargs: dict[str, Any] = {"timeout": self.timeout, "follow_redirects": True}
        headers = self._auth_headers()
        if headers:
            http_kwargs["headers"] = headers
        async with httpx.AsyncClient(**http_kwargs) as http_client:
            async with streamable_http_client(self.base_url, http_client=http_client) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    return await session.call_tool(name, arguments=arguments)

    async def call_tool_text(self, name: str, arguments: dict[str, Any]) -> str:
        return _result_to_text(await self.call_tool(name, arguments))


class MarkItDownMcpClient(StreamableMcpClient):
    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        resolved_timeout = timeout if timeout is not None else _float_env("MARKITDOWN_MCP_TIMEOUT_MS", 30.0)
        super().__init__(
            base_url or os.environ.get("MARKITDOWN_MCP_URL"),
            timeout=resolved_timeout,
            use_id_token=_bool_env("MARKITDOWN_MCP_USE_ID_TOKEN"),
        )

    async def convert_pdf_bytes(self, pdf_bytes: bytes) -> str:
        data_uri = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode("ascii")
        return await self.call_tool_text("convert_to_markdown", {"uri": data_uri})


class NotebookLmMcpClient(StreamableMcpClient):
    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        resolved_timeout = timeout
        if resolved_timeout is None:
            resolved_timeout = _float_env(
                "NOTEBOOKLM_MCP_TIMEOUT_MS",
                # Default 300s accommodates the full MCP ask_question cycle
                # (browser init ~5s + type+submit ~4s + DIAG capture ~16s +
                # answer generation ~10s + headroom). Live smoke verified on
                # 2026-06-14: full happy path takes ~30s, so 300s gives 10x.
                _float_env("NOTEBOOKLM_ASK_TIMEOUT_MS", 300.0),
            )
        super().__init__(base_url or os.environ.get("NOTEBOOKLM_MCP_URL"), timeout=resolved_timeout)

    async def add_source(self, text: str, notebook_id: Optional[str] = None) -> str:
        arguments: dict[str, Any] = {"type": "text", "content": text}
        if notebook_id:
            arguments["notebook_id"] = notebook_id
        if _bool_env("NOTEBOOKLM_SHOW_BROWSER") or _bool_env("NOTEBOOKLM_ADD_SOURCE_SHOW_BROWSER"):
            arguments["show_browser"] = True
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
        if _bool_env("NOTEBOOKLM_SHOW_BROWSER") or _bool_env("NOTEBOOKLM_ASK_SHOW_BROWSER"):
            arguments["show_browser"] = True
        raw = await self.call_tool_text("ask_question", arguments)
        with contextlib.suppress(json.JSONDecodeError, ValueError):
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                if parsed.get("success") is False:
                    raise McpToolError(str(parsed.get("error") or parsed.get("message") or "NotebookLM ask_question failed"))
                data = parsed.get("data") if isinstance(parsed.get("data"), dict) else {}
                answer = data.get("answer")
                if isinstance(answer, str):
                    return answer
        return raw
