import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const port = Number(process.argv[3] ?? 8765);
const host = "127.0.0.1";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl ?? "/", `http://${host}:${port}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const absolutePath = normalize(join(root, decodedPath));
  if (!absolutePath.startsWith(root)) return null;
  return absolutePath;
}

const server = createServer(async (request, response) => {
  try {
    let filePath = resolveRequestPath(request.url);
    if (!filePath) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isDirectory()) filePath = join(filePath, "index.html");

    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

server.listen(port, host);
