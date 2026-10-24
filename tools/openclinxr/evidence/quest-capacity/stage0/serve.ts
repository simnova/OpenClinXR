import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const directory = process.argv[2]; if (!directory) throw new Error('Usage: node serve.ts <built-dist> [port]');
const root = resolve(directory); const files = new Set(['index.html', 'stage0.js', 'source-manifest.json', 'scene-manifest.json', 'protocol.json']);
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost'); const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (request.method !== 'GET' || !files.has(file)) { response.writeHead(404).end(); return; }
  try { const body = await readFile(join(root, file)); response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'text/html', 'cache-control': 'no-store' }); response.end(body); } catch { response.writeHead(500).end(); }
});
server.listen(Number(process.argv[3] ?? 0), '127.0.0.1', () => { const address = server.address(); process.stdout.write(JSON.stringify({ url: `http://localhost:${typeof address === 'object' && address ? address.port : 0}`, root }) + '\n'); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
