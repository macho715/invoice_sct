"""NotebookLM MCP client wrapper using MCP Python SDK streamable HTTP."""
import os
from typing import Any, Optional

try:
    from mcp.client.streamable_http import streamable_http_client
    from mcp import ClientSession
except ImportError:
    streamable_http_client = None
    ClientSession = None


class McpClientUnavailable(Exception):
    pass


class NotebookLmMcpClient:
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        self.base_url = base_url or os.environ.get("NOTEBOOKLM_MCP_URL")
        if not self.base_url:
            raise McpClientUnavailable("NOTEBOOKLM_MCP_URL not set")
        self.timeout = timeout

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if streamable_http_client is None or ClientSession is None:
            raise McpClientUnavailable("MCP Python SDK not installed")
        async with streamable_http_client(self.base_url, timeout=self.timeout) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(name, arguments=arguments)

    async def add_source(self, text: str) -> str:
        result = await self.call_tool("add_source", {"type": "text", "text": text})
        return str(result)

    async def ask_question(self, question: str) -> str:
        result = await self.call_tool("ask_question", {"question": question})
        return str(result)
