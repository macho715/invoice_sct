import hashlib
import hmac
import json
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.notebooklm.orchestrator import NotebookLmOrchestrator
from app.notebooklm.extractor import parse_extraction


@pytest.fixture
def orchestrator():
    os.environ["WEB_CALLBACK_URL"] = "http://test/web/callback"
    os.environ["NOTEBOOKLM_CALLBACK_SECRET"] = "test-secret"
    return NotebookLmOrchestrator()


class TestOrchestratorHappyPath:
    @pytest.mark.asyncio
    async def test_signs_callback_with_hmac(self, orchestrator):
        """Happy path: parse succeeds, callback is HMAC-signed."""
        pdf_bytes = b"%PDF-1.4 fake content"
        markdown = '{"doc_kind": "INVOICE", "fields": {"invoice_no": "INV-1"}, "confidence": 0.9}'

        with patch("httpx.AsyncClient") as mock_client:
            # Mock fetch
            mock_fetch = MagicMock()
            mock_fetch.content = pdf_bytes
            mock_fetch.raise_for_status = MagicMock()

            # Mock callback POST
            mock_post = MagicMock()

            async def get(url):
                return mock_fetch
            async def post(url, content, headers):
                # Verify signature
                expected = "sha256=" + hmac.new(b"test-secret", content.encode(), hashlib.sha256).hexdigest()
                assert headers["X-NotebookLM-Signature"] == expected
                mock_post.called = True
                return MagicMock()

            mock_fetch_instance = MagicMock()
            mock_fetch_instance.get = AsyncMock(side_effect=get)
            mock_fetch_instance.post = AsyncMock(side_effect=post)
            mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_fetch_instance)
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

            # Mock NotebookLM client
            with patch("app.notebooklm.orchestrator.NotebookLmMcpClient") as mock_nlm:
                mock_instance = MagicMock()
                mock_instance.add_source = AsyncMock(return_value="src_123")
                mock_instance.ask_question = AsyncMock(return_value=markdown)
                mock_nlm.return_value = mock_instance

                result = await orchestrator.run(
                    job_id="job_1",
                    blob_url="http://test/blob.pdf",
                )

        assert result["status"] == "CALLBACK_SENT"
        assert result["notebooklm_source_id"] == "src_123"
        assert result["source_sha256"] == hashlib.sha256(pdf_bytes).hexdigest()


class TestOrchestratorFailures:
    @pytest.mark.asyncio
    async def test_markitdown_failure_sends_no_callback(self, orchestrator):
        """If MarkItDown fails, no callback is sent."""
        os.environ.pop("MARKITDOWN_MCP_URL", None)

        with patch("httpx.AsyncClient") as mock_client:
            mock_fetch = MagicMock()
            mock_fetch.content = b""
            mock_fetch.raise_for_status = MagicMock()

            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=mock_fetch)
            mock_instance.post = AsyncMock()  # should NOT be called
            mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

            result = await orchestrator.run("job_1", "http://test/blob")

        assert result["status"] == "NOTEBOOKLM_UNAVAILABLE"
        mock_instance.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_source_failure_sends_no_callback(self, orchestrator):
        """If add_source fails, no callback is sent."""
        from app.notebooklm.mcp_client import McpClientUnavailable

        with patch("httpx.AsyncClient") as mock_client:
            mock_fetch = MagicMock()
            mock_fetch.content = b"PDF content"
            mock_fetch.raise_for_status = MagicMock()

            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=mock_fetch)
            mock_instance.post = AsyncMock()
            mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

            with patch("app.notebooklm.orchestrator.NotebookLmMcpClient") as mock_nlm:
                mock_instance2 = MagicMock()
                mock_instance2.add_source = AsyncMock(side_effect=McpClientUnavailable("not set"))
                mock_nlm.return_value = mock_instance2

                result = await orchestrator.run("job_1", "http://test/blob")

        assert result["status"] == "NOTEBOOKLM_UNAVAILABLE"
        mock_instance.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_ask_question_failure_sends_no_callback(self, orchestrator):
        """If ask_question fails, no callback is sent."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_fetch = MagicMock()
            mock_fetch.content = b"PDF content"
            mock_fetch.raise_for_status = MagicMock()

            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=mock_fetch)
            mock_instance.post = AsyncMock()
            mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

            with patch("app.notebooklm.orchestrator.NotebookLmMcpClient") as mock_nlm:
                mock_instance2 = MagicMock()
                mock_instance2.add_source = AsyncMock(return_value="src_1")
                mock_instance2.ask_question = AsyncMock(side_effect=Exception("ask failed"))
                mock_nlm.return_value = mock_instance2

                result = await orchestrator.run("job_1", "http://test/blob")

        assert result["status"] == "NOTEBOOKLM_UNAVAILABLE"
        mock_instance.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_parse_failure_sends_low_confidence_callback(self, orchestrator):
        """If JSON parsing fails after retry, send low-confidence AMBER callback."""
        with patch("httpx.AsyncClient") as mock_client:
            mock_fetch = MagicMock()
            mock_fetch.content = b"PDF content"
            mock_fetch.raise_for_status = MagicMock()

            mock_post = MagicMock()
            posted_payload = {}

            async def get(url):
                return mock_fetch
            async def post(url, content, headers):
                posted_payload.update(json.loads(content))
                return MagicMock()

            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=get)
            mock_instance.post = AsyncMock(side_effect=post)
            mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

            with patch("app.notebooklm.orchestrator.NotebookLmMcpClient") as mock_nlm:
                mock_instance2 = MagicMock()
                mock_instance2.add_source = AsyncMock(return_value="src_1")
                mock_instance2.ask_question = AsyncMock(return_value="not parseable json at all")
                mock_nlm.return_value = mock_instance2

                result = await orchestrator.run("job_1", "http://test/blob")

        assert result["status"] == "CALLBACK_SENT"
        # Verify low-confidence callback was sent
        assert posted_payload["summary"]["confidence"] == 0.0
        assert "JSON_PARSE_FAILED" in posted_payload["summary"]["flags"]
