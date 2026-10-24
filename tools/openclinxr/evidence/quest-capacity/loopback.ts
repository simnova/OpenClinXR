import { createHash, randomUUID } from "node:crypto";
import { createServer, request, Agent, type Server } from "node:http";
import { performance } from "node:perf_hooks";
import { platform, release } from "node:os";
import { makeMetric, makeRun, type CapacityMetric, type CapacityRun } from "@openclinxr/xr-capacity";
import { collectBuildIdentity } from "./identity.js";

export interface LoopbackOptions {
  requests?: number;
  payloadBytes?: number;
  assetBytes?: number;
  intervalMs?: number;
  concurrency?: number;
  queueCapacity?: number;
  serverDelayMs?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface LoopbackCounters {
  offered: number;
  accepted: number;
  delivered: number;
  expired: number;
  dropped: number;
  failed: number;
  cancelled: number;
  maxQueueDepth: number;
  maxInFlight: number;
  echoedBytes: number;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < min || actual > max) throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return actual;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/** Node adapter only. The package evaluates evidence; this function measures a real loopback path. */
export async function runLoopback(options: LoopbackOptions = {}) {
  const identity = await collectBuildIdentity();
  const count = bounded(options.requests, 24, 1, 256, "requests");
  const payloadBytes = bounded(options.payloadBytes, 1024, 1, 1024 * 1024, "payloadBytes");
  const assetBytes = bounded(options.assetBytes, 64 * 1024, 1, 8 * 1024 * 1024, "assetBytes");
  const intervalMs = bounded(options.intervalMs, 2, 0, 100, "intervalMs");
  const concurrency = bounded(options.concurrency, 4, 1, 16, "concurrency");
  const queueCapacity = bounded(options.queueCapacity, 16, 0, 128, "queueCapacity");
  const serverDelayMs = bounded(options.serverDelayMs, 0, 0, 100, "serverDelayMs");
  const deadlineMs = bounded(options.deadlineMs, 2000, 50, 10_000, "deadlineMs");
  if (count * payloadBytes > 64 * 1024 * 1024) throw new Error("Total offered echo payload exceeds 64 MiB");
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const metrics: CapacityMetric[] = [];
  const rtts: { at: number; value: number; valid: boolean }[] = [];
  const acknowledgement: typeof rtts = [];
  const queueAge: typeof rtts = [];
  const serverService: typeof rtts = [];
  const counters: LoopbackCounters = { offered: 0, accepted: 0, delivered: 0, expired: 0, dropped: 0, failed: 0, cancelled: 0, maxQueueDepth: 0, maxInFlight: 0, echoedBytes: 0 };
  const protocols = new Set<string>();
  const payload = Buffer.alloc(payloadBytes, 0x61);
  const asset = Buffer.alloc(assetBytes, 0x62);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((incoming, response) => {
    const serviceStart = performance.now();
    protocols.add(`HTTP/${incoming.httpVersion}`);
    if (incoming.method === "GET" && incoming.url === "/asset") {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-length": asset.length, "cache-control": "no-store" });
      response.end(asset);
      return;
    }
    if (incoming.method !== "POST" || incoming.url !== "/echo") { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    incoming.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > payloadBytes) { response.writeHead(413).end(); incoming.destroy(); return; }
      chunks.push(chunk);
    });
    incoming.on("end", () => {
      const send = () => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes });
        response.end(Buffer.concat(chunks));
        serverService.push({ at: performance.now() - start, value: performance.now() - serviceStart, valid: true });
      };
      if (serverDelayMs > 0) {
        const timer = setTimeout(() => { timers.delete(timer); send(); }, serverDelayMs);
        timers.add(timer);
      } else send();
    });
  });
  server.headersTimeout = 3000;
  server.requestTimeout = 5000;
  const agent = new Agent({ keepAlive: true, maxSockets: concurrency, maxFreeSockets: concurrency });
  let aborted = options.signal?.aborted ?? false;
  let stopReason: string | null = aborted ? "caller-aborted" : null;
  let firstOfferAt: number | null = null;
  let lastOfferAt: number | null = null;
  const pending = new Set<ReturnType<typeof request>>();
  const abort = () => { aborted = true; stopReason ??= "caller-aborted"; for (const req of pending) req.destroy(new Error("Campaign aborted")); };
  options.signal?.addEventListener("abort", abort, { once: true });
  let assetMeasurement: { bytes: number; durationMs: number; sha256: string } | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback server did not acquire a TCP port");
    if (!aborted) {
      const assetStart = performance.now();
      assetMeasurement = await new Promise((resolve, reject) => {
        const req = request({ hostname: "127.0.0.1", port: address.port, path: "/asset", method: "GET", agent }, (res) => {
          const hash = createHash("sha256");
          let bytes = 0;
          res.on("data", (chunk: Buffer) => { bytes += chunk.length; hash.update(chunk); if (bytes > assetBytes) req.destroy(new Error("Oversized asset response")); });
          res.on("end", () => { pending.delete(req); resolve({ bytes, durationMs: performance.now() - assetStart, sha256: hash.digest("hex") }); });
          res.on("error", reject);
        });
        pending.add(req);
        req.setTimeout(deadlineMs, () => req.destroy(new Error("Asset deadline exceeded")));
        req.on("error", (error) => { pending.delete(req); if (aborted) resolve(null); else reject(error); });
        req.end();
      });
    }
    const offeredStart = performance.now();
    await new Promise<void>((resolve) => {
      const queue: { offeredAt: number; sequence: number }[] = [];
      let inFlight = 0;
      let allOffered = false;
      let offerTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => { if (allOffered && inFlight === 0 && queue.length === 0) resolve(); };
      const dispatch = (item: { offeredAt: number; sequence: number }) => {
        if (aborted) { counters.cancelled += 1; return; }
        const dispatchAt = performance.now();
        const age = dispatchAt - item.offeredAt;
        queueAge.push({ at: dispatchAt - start, value: age, valid: true });
        if (age >= deadlineMs) { counters.expired += 1; return; }
        inFlight += 1;
        counters.maxInFlight = Math.max(counters.maxInFlight, inFlight);
        let settled = false;
        const complete = (outcome: "delivered" | "expired" | "failed" | "cancelled") => {
          if (settled) return;
          settled = true;
          pending.delete(req);
          counters[outcome] += 1;
          inFlight -= 1;
          if (outcome === "delivered") {
            rtts.push({ at: performance.now() - start, value: performance.now() - dispatchAt, valid: true });
            acknowledgement.push({ at: performance.now() - start, value: performance.now() - item.offeredAt, valid: true });
          }
          while (queue.length > 0 && inFlight < concurrency) dispatch(queue.shift()!);
          finish();
        };
        const req = request({ hostname: "127.0.0.1", port: address.port, path: "/echo", method: "POST", agent, headers: { "content-length": payload.length, "x-sequence": String(item.sequence) } }, (res) => {
          let bytes = 0;
          let matches = true;
          res.on("data", (chunk: Buffer) => { bytes += chunk.length; matches &&= chunk.every((value) => value === 0x61); if (bytes > payloadBytes) req.destroy(new Error("Oversized echo response")); });
          res.on("end", () => { if (res.statusCode === 200 && bytes === payloadBytes && matches) { counters.echoedBytes += bytes; complete("delivered"); } else complete("failed"); });
          res.on("error", () => complete(aborted ? "cancelled" : "failed"));
        });
        pending.add(req);
        const deadline = setTimeout(() => {
          timers.delete(deadline);
          stopReason = "acknowledgement-deadline-exceeded";
          aborted = true;
          complete("expired");
          for (const active of pending) active.destroy(new Error("Acknowledgement deadline exceeded"));
          req.destroy(new Error("Acknowledgement deadline exceeded"));
        }, Math.max(1, deadlineMs - age));
        timers.add(deadline);
        req.on("close", () => { clearTimeout(deadline); timers.delete(deadline); });
        req.on("error", () => complete(aborted ? "cancelled" : "failed"));
        req.end(payload);
      };
      const offer = () => {
        if (aborted || counters.offered >= count) { allOffered = true; finish(); return; }
        const item = { offeredAt: performance.now(), sequence: counters.offered };
        firstOfferAt ??= item.offeredAt;
        lastOfferAt = item.offeredAt;
        counters.offered += 1;
        if (inFlight < concurrency) { counters.accepted += 1; dispatch(item); }
        else if (queue.length < queueCapacity) { counters.accepted += 1; queue.push(item); counters.maxQueueDepth = Math.max(counters.maxQueueDepth, queue.length); }
        else counters.dropped += 1;
        if (counters.offered >= count) { allOffered = true; finish(); return; }
        // Fixed arrival schedule on one host clock; delayed timers do not silently lower the target rate.
        offerTimer = setTimeout(() => { if (offerTimer) timers.delete(offerTimer); offer(); }, Math.max(0, offeredStart + counters.offered * intervalMs - performance.now()));
        timers.add(offerTimer);
      };
      offer();
    });
  } finally {
    options.signal?.removeEventListener("abort", abort);
    for (const timer of timers) clearTimeout(timer);
    for (const req of pending) req.destroy();
    agent.destroy();
    if (server.listening) await closeServer(server);
  }
  const source = { tool: "node-loopback-http", version: process.version, processId: String(process.pid) };
  const metric = (id: string, semantic: CapacityMetric["semantic"], unit: CapacityMetric["unit"], samples: CapacityMetric["samples"]) => makeMetric({ id, semantic, unit, kind: "measured", granularity: "event", clockDomain: "host-monotonic", source, samples, timingDenominator: null, transportState: "connected" });
  metrics.push(metric("loopback.rtt", "network-rtt", "ms", rtts), metric("loopback.ack-age", "queue-age", "ms", acknowledgement), metric("loopback.queue-age", "queue-age", "ms", queueAge), metric("loopback.server-service", "server-duration", "ms", serverService));
  const lost = counters.expired + counters.dropped + counters.failed;
  metrics.push(metric("loopback.undelivered", "counter", "count", [{ at: performance.now() - start, value: lost, valid: true }]));
  metrics.push(metric("loopback.queue-peak", "counter", "count", [{ at: performance.now() - start, value: counters.maxQueueDepth, valid: true }]));
  if (assetMeasurement) metrics.push(metric("loopback.asset-fetch", "asset-duration", "ms", [{ at: performance.now() - start, value: assetMeasurement.durationMs, valid: true }]));
  const run: CapacityRun = makeRun({ id: `host-loopback-${randomUUID()}`, provenance: "node-host", evidenceClass: "capacity", startedAt, endedAt: new Date().toISOString(), status: aborted ? "aborted" : "completed", nativeSession: null, environment: { runtime: `node-${process.version}`, device: `${process.arch}-host`, os: `${platform()} ${release()}`, browser: "none", revision: identity.revision, buildHash: identity.buildHash }, configuration: { workloadHash: "node-loopback-http.v1", capabilityHash: "loopback-http1-only-v1", seed: 1, axes: { requests: count, payloadBytes, assetBytes, intervalMs, concurrency, queueCapacity, serverDelayMs, deadlineMs } }, profile: { id: "host-loopback-bounded", version: "1", status: "frozen", scope: "host", minimumSamples: 1, minimumDurationMs: 0, requiredClaims: [{ id: "all-offered-delivered", kind: "threshold", metricId: "loopback.undelivered", operator: "lte", threshold: 0, unit: "count", statistic: "max", requiresMeasured: true, minimumSamples: 1 }], stopRules: [{ id: "queue-watermark", version: "1", metricId: "loopback.queue-peak", processId: source.processId, source: source.tool, watermark: queueCapacity + 1, operator: "gte" }] }, metrics, artifacts: [], ringDroppedSamples: 0 });
  return { run, identity, counters, asset: assetMeasurement, protocols: [...protocols], requestedOfferedIntervalMs: intervalMs, observedOfferedDurationMs: firstOfferAt === null || lastOfferAt === null ? 0 : lastOfferAt - firstOfferAt, queueBound: queueCapacity, stopReason, applicationDelayMs: serverDelayMs, applicationDelayMeaning: "Mock server scheduling delay; not routed network impairment", websocket: { status: "unavailable", reason: "No direct ws dependency is installed for this host adapter; no WebSocket measurement was fabricated." }, notEvidenceFor: ["maximum host network capacity", "Quest Wi-Fi or WAN performance", "HTTPS, HTTP/2 or HTTP/3 negotiation", "WSS, WebRTC or WebTransport capacity", "one-way latency or RTT/2", "server capacity independent of same-host client interference"] };
}
