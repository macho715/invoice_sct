import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.notebooklm.mcp_client import (
    MarkItDownMcpClient,
    McpToolError,
    NotebookLmMcpClient,
    _result_to_text,
)


class TestResultToText:
    def test_extracts_text_from_mcp_content_objects(self):
        result = SimpleNamespace(
            content=[
                SimpleNamespace(text="first"),
                SimpleNamespace(text="second"),
            ]
        )

        assert _result_to_text(result) == "first\nsecond"

    def test_extracts_text_from_dict_content(self):
        result = {"content": [{"text": "alpha"}, {"text": "beta"}]}

        assert _result_to_text(result) == "alpha\nbeta"

    def test_preserves_plain_string_result(self):
        assert _result_to_text("plain answer") == "plain answer"


class TestMarkItDownMcpClient:
    def test_uses_markitdown_timeout_env(self, monkeypatch):
        monkeypatch.setenv("MARKITDOWN_MCP_TIMEOUT_MS", "45")

        client = MarkItDownMcpClient("http://markitdown.test/mcp")

        assert client.timeout == 45.0

    @pytest.mark.asyncio
    async def test_convert_pdf_bytes_uses_data_uri(self):
        pdf_bytes = b"%PDF-1.4 sample"
        client = MarkItDownMcpClient("http://markitdown.test/mcp")

        with patch.object(client, "call_tool_text", AsyncMock(return_value="# invoice")) as call_tool:
            result = await client.convert_pdf_bytes(pdf_bytes)

        expected_uri = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode("ascii")
        assert result == "# invoice"
        call_tool.assert_awaited_once_with("convert_to_markdown", {"uri": expected_uri})


class TestNotebookLmMcpClient:
    def test_uses_notebooklm_mcp_timeout_env(self, monkeypatch):
        monkeypatch.setenv("NOTEBOOKLM_MCP_TIMEOUT_MS", "600000")
        monkeypatch.setenv("NOTEBOOKLM_ASK_TIMEOUT_MS", "120")

        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        assert client.timeout == 600000.0

    def test_uses_notebooklm_ask_timeout_env_as_fallback(self, monkeypatch):
        monkeypatch.delenv("NOTEBOOKLM_MCP_TIMEOUT_MS", raising=False)
        monkeypatch.setenv("NOTEBOOKLM_ASK_TIMEOUT_MS", "600000")

        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        assert client.timeout == 600000.0

    def test_ignores_invalid_timeout_env(self, monkeypatch):
        monkeypatch.setenv("NOTEBOOKLM_MCP_TIMEOUT_MS", "not-a-number")
        monkeypatch.setenv("NOTEBOOKLM_ASK_TIMEOUT_MS", "-1")

        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        # Default is 300s (see comment in mcp_client.py: full MCP ask_question
        # cycle observed at ~30s; 300s gives 10x headroom).
        assert client.timeout == 300.0

    @pytest.mark.asyncio
    async def test_add_source_extracts_source_id_from_json_result(self):
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(
            client,
            "call_tool_text",
            AsyncMock(return_value='{"source_id":"src_123"}'),
        ) as call_tool:
            source_id = await client.add_source("markdown body", notebook_id="nb_1")

        assert source_id == "src_123"
        call_tool.assert_awaited_once_with(
            "add_source",
            {"type": "text", "content": "markdown body", "notebook_id": "nb_1"},
        )

    @pytest.mark.asyncio
    async def test_add_source_passes_show_browser_when_enabled(self, monkeypatch):
        monkeypatch.setenv("NOTEBOOKLM_ADD_SOURCE_SHOW_BROWSER", "true")
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(client, "call_tool_text", AsyncMock(return_value='{"source_id":"src_123"}')) as call_tool:
            await client.add_source("markdown body", notebook_id="nb_1")

        call_tool.assert_awaited_once_with(
            "add_source",
            {"type": "text", "content": "markdown body", "notebook_id": "nb_1", "show_browser": True},
        )

    @pytest.mark.asyncio
    async def test_add_source_extracts_source_id_from_nested_data(self):
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(
            client,
            "call_tool_text",
            AsyncMock(return_value='{"success":true,"data":{"source_id":"src_nested"}}'),
        ):
            source_id = await client.add_source("markdown body")

        assert source_id == "src_nested"

    @pytest.mark.asyncio
    async def test_add_source_raises_on_tool_failure(self):
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(
            client,
            "call_tool_text",
            AsyncMock(return_value='{"success":false,"error":"Failed to authenticate session"}'),
        ):
            with pytest.raises(McpToolError, match="Failed to authenticate session"):
                await client.add_source("markdown body")

    @pytest.mark.asyncio
    async def test_add_source_raises_nested_tool_failure_message(self):
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(
            client,
            "call_tool_text",
            AsyncMock(
                return_value=(
                    '{"success":false,"data":{"result":{"success":false,'
                    '"message":"locator.waitFor: Timeout 10000ms exceeded"}}}'
                )
            ),
        ):
            with pytest.raises(McpToolError, match="locator.waitFor"):
                await client.add_source("markdown body")

    @pytest.mark.asyncio
    async def test_call_tool_uses_http_client_timeout_without_sdk_timeout_arg(self):
        client = MarkItDownMcpClient("http://markitdown.test/mcp", timeout=12.0)

        class FakeHttpClient:
            def __init__(self, timeout, follow_redirects):
                self.timeout = timeout
                self.follow_redirects = follow_redirects

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

        class FakeStreamContext:
            async def __aenter__(self):
                return "read", "write", lambda: None

            async def __aexit__(self, exc_type, exc, tb):
                return None

        class FakeSession:
            def __init__(self, read, write):
                self.read = read
                self.write = write

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def initialize(self):
                return None

            async def call_tool(self, name, arguments):
                return {"content": [{"text": "ok"}]}

        calls = {}

        def fake_streamable_http_client(url, **kwargs):
            calls["url"] = url
            calls["kwargs"] = kwargs
            return FakeStreamContext()

        with (
            patch("app.notebooklm.mcp_client.httpx.AsyncClient", FakeHttpClient),
            patch("app.notebooklm.mcp_client.streamable_http_client", fake_streamable_http_client),
            patch("app.notebooklm.mcp_client.ClientSession", FakeSession),
        ):
            result = await client.call_tool_text("convert_to_markdown", {"uri": "data:text/plain,hello"})

        assert result == "ok"
        assert calls["url"] == "http://markitdown.test/mcp"
        assert "timeout" not in calls["kwargs"]
        assert calls["kwargs"]["http_client"].timeout == 12.0
        assert calls["kwargs"]["http_client"].follow_redirects is True
        assert set(calls["kwargs"]) == {"http_client"}

    @pytest.mark.asyncio
    async def test_ask_question_calls_expected_tool(self):
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(client, "call_tool_text", AsyncMock(return_value='{"confidence":1}')) as call_tool:
            answer = await client.ask_question("Return JSON only", notebook_id="nb_1")

        assert answer == '{"confidence":1}'
        call_tool.assert_awaited_once_with(
            "ask_question",
            {"question": "Return JSON only", "notebook_id": "nb_1"},
        )

    @pytest.mark.asyncio
    async def test_ask_question_extracts_answer_from_success_envelope(self):
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(
            client,
            "call_tool_text",
            AsyncMock(return_value='{"success":true,"data":{"answer":"{\\"ok\\":true}"}}'),
        ):
            answer = await client.ask_question("Return JSON only")

        assert answer == '{"ok":true}'

    @pytest.mark.asyncio
    async def test_ask_question_raises_on_tool_failure(self):
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(
            client,
            "call_tool_text",
            AsyncMock(return_value='{"success":false,"error":"Timeout waiting for response from NotebookLM"}'),
        ):
            with pytest.raises(McpToolError, match="Timeout waiting"):
                await client.ask_question("Return JSON only")

    @pytest.mark.asyncio
    async def test_ask_question_passes_show_browser_when_enabled(self, monkeypatch):
        monkeypatch.setenv("NOTEBOOKLM_ASK_SHOW_BROWSER", "true")
        client = NotebookLmMcpClient("http://notebooklm.test/mcp")

        with patch.object(client, "call_tool_text", AsyncMock(return_value='{"confidence":1}')) as call_tool:
            await client.ask_question("Return JSON only", notebook_id="nb_1")

        call_tool.assert_awaited_once_with(
            "ask_question",
            {"question": "Return JSON only", "notebook_id": "nb_1", "show_browser": True},
        )
