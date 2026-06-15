# markitdown-mcp (Cloud Run)

MarkItDown MCP server packaged for Google Cloud Run. Exposes Microsoft's
`markitdown-mcp` over **Streamable HTTP** so the parser worker
(`apps/worker-py`) can call `convert_to_markdown` (PDF → markdown) via
`MarkItDownMcpClient` in `app/notebooklm/mcp_client.py`.

- **Stateless** — no browser, no auth cookies → Cloud Run scale-to-zero friendly
  (unlike the NotebookLM MCP, which needs a persistent browser host).
- **Transport** — `--http` mode (Starlette + uvicorn), Streamable HTTP, matches
  the worker's `streamable_http_client`.

## Local run

```bash
docker build -t markitdown-mcp .
docker run --rm -p 8080:8080 markitdown-mcp
# MCP endpoint: http://127.0.0.1:8080/mcp   (verify exact path from server logs)
```

## Deploy

```bash
GCP_PROJECT=<proj> GCP_REGION=asia-northeast3 ./deploy.sh
```

Then set the worker's `MARKITDOWN_MCP_URL` to `<service-url>/mcp`.

Full procedure (IAM, worker rewire, smoke, rollback):
[`docs/20260615_cloud-run-migration-runbook.md`](../../docs/20260615_cloud-run-migration-runbook.md).

## Cloud Run requirements (see runbook §3)

| Item | Why |
|---|---|
| bind `0.0.0.0:$PORT` | markitdown-mcp defaults to localhost in HTTP mode |
| `--session-affinity` + `--min-instances 1` | MCP `initialize()`→`call_tool()` share a session id |
| `--no-allow-unauthenticated` | no built-in auth; restrict to the worker via IAM ID token |
| payload ≤ ~24 MB raw PDF | worker inlines PDF as base64 data URI (HTTP/1 ~32 MB cap) |
