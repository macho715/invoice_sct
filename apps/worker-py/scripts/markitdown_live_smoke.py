"""Live smoke for the deployed markitdown-mcp Cloud Run service.

Uses the worker's own MarkItDownMcpClient transport, but injects an
externally-minted Cloud Run ID token (passed via MARKITDOWN_SMOKE_TOKEN) so it
can be run from a developer machine without ADC ID-token minting. This exercises
the exact convert_to_markdown call path the worker uses in production.

Usage (token minted by caller):
    MARKITDOWN_MCP_URL=https://.../mcp \
    MARKITDOWN_SMOKE_TOKEN="$(gcloud auth print-identity-token \
        --impersonate-service-account=<sa> --audiences=https://...)" \
    python scripts/markitdown_live_smoke.py tests/fixtures/text-pdf-001.pdf
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.notebooklm.mcp_client import StreamableMcpClient  # noqa: E402


class TokenInjectedClient(StreamableMcpClient):
    """MarkItDown transport with a pre-minted Bearer token (no ADC needed)."""

    def __init__(self, base_url: str, token: str, timeout: float = 60.0):
        super().__init__(base_url, timeout=timeout, use_id_token=True)
        self._token = token

    def _auth_headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}


async def main() -> int:
    url = os.environ["MARKITDOWN_MCP_URL"]
    token = os.environ["MARKITDOWN_SMOKE_TOKEN"]
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/text-pdf-001.pdf"

    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()

    import base64

    data_uri = "data:application/pdf;base64," + base64.b64encode(pdf_bytes).decode("ascii")
    client = TokenInjectedClient(url, token)
    markdown = await client.call_tool_text("convert_to_markdown", {"uri": data_uri})

    print(f"[smoke] pdf={pdf_path} bytes={len(pdf_bytes)}")
    print(f"[smoke] markdown_len={len(markdown)}")
    print("----- markdown (first 400 chars) -----")
    print(markdown[:400])
    ok = len(markdown.strip()) > 0
    print(f"[smoke] RESULT={'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
