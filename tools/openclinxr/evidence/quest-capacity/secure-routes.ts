import { request as httpRequest } from "node:http";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { IMAGE_FIXTURES } from "./secure-image.js";
import type { SecureServiceManifest } from "./secure-services.js";

export const SECURE_BOUNDS = Object.freeze({ maxBodyBytes: 65536, maxAssetBytes: 8 * 1024 * 1024, maxConnections: 16, maxPeers: 8, maxMessages: 4096, maxSessionBytes: 16 * 1024 * 1024, maxQueueBytes: 1024 * 1024, maxDatagramBytes: 1024, maxRtcChannels: 4, peerLifetimeMs: 60_000, requestDeadlineMs: 5000, maxServiceBytes: 256 * 1024 * 1024 });
export interface ServiceCounters { requests: number; echoRequests: number; echoBytes: number; bytes: number; wssMessages: number; wssBytes: number; rejected: number; activeRequests: number; peakActiveRequests: number; httpVersions: Record<string, number> }
export function newServiceCounters(): ServiceCounters { return { requests: 0, echoRequests: 0, echoBytes: 0, bytes: 0, wssMessages: 0, wssBytes: 0, rejected: 0, activeRequests: 0, peakActiveRequests: 0, httpVersions: {} }; }
export function localAppOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("appOrigin must be an explicit loopback HTTP origin");
  return url.origin;
}
async function body(request: Http2ServerRequest, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { const value = Buffer.from(chunk); length += value.length; if (length > maxBytes) throw new Error("Request body exceeds bound"); chunks.push(value); }
  return Buffer.concat(chunks);
}
function send(response: Http2ServerResponse, status: number, value: unknown) { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); }
export function makeSecureRoutes(getManifest: () => SecureServiceManifest, counters: ServiceCounters, rtcPort: () => number, appOrigin?: string) {
  return async (request: Http2ServerRequest, response: Http2ServerResponse): Promise<void> => {
    const start = performance.now();
    const manifest = getManifest();
    if (!request.url.startsWith("/") || request.url.startsWith("//")) { send(response, 400, { error: "Origin-form path required" }); return; }
    const url = new URL(request.url, manifest.httpsOrigin);
    if (counters.activeRequests >= 16) { counters.rejected++; send(response, 429, { error: "Concurrent request bound" }); return; }
    counters.activeRequests++; counters.peakActiveRequests = Math.max(counters.peakActiveRequests, counters.activeRequests);
    let active = true; response.once("close", () => { if (active) { active = false; counters.activeRequests--; } });
    const origin = request.headers.origin;
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-capacity-http-version", request.httpVersion);
    response.setHeader("x-capacity-alpn", "alpnProtocol" in request.socket ? String(request.socket.alpnProtocol) : "unknown");
    if (origin && (typeof origin !== "string" || !manifest.origins.includes(origin))) { counters.rejected++; send(response, 403, { error: "Origin not allowed" }); return; }
    if (origin) { response.setHeader("access-control-allow-origin", origin); response.setHeader("vary", "Origin"); response.setHeader("timing-allow-origin", origin); response.setHeader("access-control-expose-headers", "x-capacity-http-version,x-capacity-alpn,x-capacity-server-ms"); }
    if (!url.pathname.startsWith("/capacity/")) {
      if (!appOrigin || !["GET", "HEAD"].includes(request.method ?? "")) { send(response, 404, { error: "Unknown path" }); return; }
      const upstream = httpRequest(new URL(appOrigin), { path: request.url, method: request.method, headers: { accept: request.headers.accept ?? "*/*" }, timeout: 5000 }, (reply) => {
        response.statusCode = reply.statusCode ?? 502;
        for (const name of ["content-type", "content-length"]) if (reply.headers[name]) response.setHeader(name, reply.headers[name]!);
        reply.pipe(response);
      });
      upstream.on("timeout", () => upstream.destroy(new Error("Proxy deadline")));
      upstream.on("error", () => { if (!response.headersSent) send(response, 502, { error: "Known app origin unavailable" }); else response.destroy(); });
      response.on("close", () => upstream.destroy()); upstream.end(); return;
    }
    if (url.pathname === "/capacity/manifest" && request.method === "GET") { send(response, 200, manifest); return; }
    if (url.searchParams.get("token") !== manifest.token) { counters.rejected++; send(response, 403, { error: "Test token required" }); return; }
    if (request.method === "OPTIONS") { response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS"); response.setHeader("access-control-allow-headers", "content-type"); response.statusCode = 204; response.end(); return; }
    if (counters.requests++ >= SECURE_BOUNDS.maxMessages * 4 || counters.bytes > SECURE_BOUNDS.maxServiceBytes) { counters.rejected++; send(response, 429, { error: "Service budget reached" }); return; }
    counters.httpVersions[request.httpVersion] = (counters.httpVersions[request.httpVersion] ?? 0) + 1;
    try {
      if (url.pathname === "/capacity/echo" && request.method === "POST") {
        const value = await body(request, SECURE_BOUNDS.maxBodyBytes); counters.bytes += value.length; counters.echoRequests++; counters.echoBytes += value.length;
        if (manifest.applicationDelayMs) await new Promise<void>((resolve) => setTimeout(resolve, manifest.applicationDelayMs));
        response.setHeader("content-type", "application/octet-stream"); response.setHeader("x-capacity-server-ms", String(performance.now() - start)); response.end(value); return;
      }
      if (url.pathname === "/capacity/image" && request.method === "GET") {
        const fixture = IMAGE_FIXTURES.get(Number(url.searchParams.get("side") ?? 256));
        if (!fixture) { send(response, 400, { error: "PNG side must be 128, 256 or 512" }); return; }
        counters.bytes += fixture.bytes.length; response.setHeader("content-type", "image/png"); response.setHeader("content-length", fixture.bytes.length); response.setHeader("x-capacity-sha256", fixture.sha256); response.end(fixture.bytes); return;
      }
      if (url.pathname === "/capacity/asset" && request.method === "GET") {
        const size = Number(url.searchParams.get("bytes") ?? 65536);
        if (!Number.isSafeInteger(size) || size < 1 || size > SECURE_BOUNDS.maxAssetBytes) { send(response, 400, { error: "Asset size out of bounds" }); return; }
        counters.bytes += size; response.setHeader("content-type", "application/octet-stream"); response.setHeader("content-length", size); response.setHeader("x-capacity-server-ms", String(performance.now() - start)); response.end(Buffer.alloc(size, 0x5a)); return;
      }
      if (["/capacity/rtc/offer", "/capacity/rtc/close", "/capacity/peer-stats"].includes(url.pathname)) {
        if (!["GET", "POST"].includes(request.method)) { send(response, 405, { error: "Method not allowed" }); return; }
        const value = await body(request, SECURE_BOUNDS.maxBodyBytes);
        const upstream = httpRequest({ hostname: "127.0.0.1", port: rtcPort(), path: url.pathname + url.search, method: request.method, headers: { "content-type": "application/json", origin: origin ?? manifest.httpsOrigin, "content-length": value.length }, timeout: 25_000 }, (reply) => {
          response.statusCode = reply.statusCode ?? 502; response.setHeader("content-type", "application/json"); reply.pipe(response);
        });
        upstream.on("timeout", () => upstream.destroy(new Error("Peer negotiation deadline")));
        upstream.on("error", () => { if (!response.headersSent) send(response, 502, { error: "Private peer unavailable" }); else response.destroy(); });
        response.on("close", () => upstream.destroy()); upstream.end(value); return;
      }
      if (url.pathname === "/capacity/stats" && request.method === "GET") { send(response, 200, counters); return; }
      send(response, 404, { error: "Unknown endpoint" });
    } catch { counters.rejected++; if (!response.headersSent) send(response, 413, { error: "Request rejected by bounds" }); else response.destroy(); }
  };
}
export function makeSecureWebSocket(getManifest: () => SecureServiceManifest, counters: ServiceCounters) {
  const server = new WebSocketServer({ noServer: true, maxPayload: SECURE_BOUNDS.maxBodyBytes, perMessageDeflate: false });
  const sockets = new Set<WebSocket>();
  server.on("connection", (socket) => {
    sockets.add(socket); let messages = 0; let bytes = 0; let pendingBytes = 0; const timers = new Set<ReturnType<typeof setTimeout>>();
    const lifetime = setTimeout(() => socket.close(1000, "bounded lifetime"), SECURE_BOUNDS.peerLifetimeMs);
    socket.on("message", (data, binary) => {
      const size = Array.isArray(data) ? data.reduce((n, item) => n + item.length, 0) : data instanceof ArrayBuffer ? data.byteLength : data.length;
      messages++; bytes += size;
      if (messages > SECURE_BOUNDS.maxMessages || bytes > SECURE_BOUNDS.maxSessionBytes || socket.bufferedAmount + pendingBytes + size > SECURE_BOUNDS.maxQueueBytes || timers.size >= 128) { counters.rejected++; socket.close(1008, "bounded queue/session exceeded"); return; }
      counters.wssMessages++; counters.wssBytes += size; pendingBytes += size;
      const timer = setTimeout(() => { timers.delete(timer); pendingBytes -= size; if (socket.readyState === 1) socket.send(data, { binary }); }, getManifest().applicationDelayMs); timers.add(timer);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => { clearTimeout(lifetime); for (const timer of timers) clearTimeout(timer); timers.clear(); sockets.delete(socket); });
  });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const manifest = getManifest(); const url = new URL(request.url ?? "/", manifest.httpsOrigin);
    if (url.pathname !== "/capacity/ws" || url.searchParams.get("token") !== manifest.token || !manifest.origins.includes(request.headers.origin ?? "") || sockets.size >= SECURE_BOUNDS.maxPeers) { counters.rejected++; socket.destroy(); return; }
    server.handleUpgrade(request, socket, head, (ws) => server.emit("connection", ws, request));
  };
  return { upgrade, close: async () => { for (const socket of sockets) socket.terminate(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
