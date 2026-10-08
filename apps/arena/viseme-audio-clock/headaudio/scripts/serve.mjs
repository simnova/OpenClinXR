/** Static file serving for the bake-off harness (imported by capture.mjs and server.mjs). */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CACHE = path.join(ROOT, "cache");

const MIME = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".bin": "application/octet-stream",
};

function resolve(urlPath) {
  if (urlPath === "/" || urlPath === "/harness.html") return path.join(ROOT, "harness.html");
  if (urlPath.startsWith("/ha-modules/")) return path.join(CACHE, "headaudio-src/modules", urlPath.slice("/ha-modules/".length));
  if (urlPath.startsWith("/ha-dist/")) return path.join(CACHE, "headaudio-src/dist", urlPath.slice("/ha-dist/".length));
  if (urlPath.startsWith("/clips/")) return path.join(CACHE, "clips", urlPath.slice("/clips/".length));
  if (urlPath === "/wawa-bundle.js") return path.join(CACHE, "wawa-bundle.js");
  return null;
}

export function startServer(port) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      const file = resolve(urlPath);
      if (!file) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch (err) {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
