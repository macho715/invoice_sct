# MarkItDown MCP server — Cloud Run image
#
# Serves the Microsoft markitdown-mcp server over Streamable HTTP so the
# Python worker (apps/worker-py) can call its `convert_to_markdown` tool via
# `MarkItDownMcpClient` (streamable_http_client). Stateless → scale-to-zero OK.
#
# Cloud Run gotcha: markitdown-mcp binds to localhost by default in HTTP mode.
# We MUST bind 0.0.0.0 and the Cloud-Run-injected $PORT (default 8080).
FROM python:3.12-slim

# markitdown-mcp wraps markitdown; markitdown[all] pulls the PDF/Office
# converters (pdfminer.six etc.) that `convert_to_markdown` needs.
# TODO: pin exact versions for prod reproducibility (`pip index versions markitdown-mcp`).
RUN pip install --no-cache-dir "markitdown-mcp" "markitdown[all]"

ENV PORT=8080
EXPOSE 8080

# Shell form via sh -c so ${PORT} expands; exec replaces the shell for clean signals.
CMD ["sh", "-c", "exec markitdown-mcp --http --host 0.0.0.0 --port ${PORT:-8080}"]
