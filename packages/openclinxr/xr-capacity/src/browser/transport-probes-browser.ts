import { boundedResponseText, localEndpoint, transportDeadline, type TransportConnection, type TransportLedger } from "./transport-probes-state.js";

export async function connectHttps(ledger: TransportLedger, signal: AbortSignal): Promise<TransportConnection> {
  const echo = localEndpoint(ledger.options.endpoints.echoUrl, "https:");
  const controllers = new Set<AbortController>();
  const stop = () => { for (const controller of controllers) controller.abort(); };
  signal.addEventListener("abort", stop, { once: true });
  let closed = false;
  return {
    async send(frame) {
      if (closed || signal.aborted) throw new DOMException("Transport stopped", "AbortError");
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), ledger.options.ackDeadlineMs);
      try {
        const response = await fetch(echo, { method: "POST", body: frame, signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error", headers: { "Content-Type": "application/octet-stream" } });
        ledger.facts['serverReportedHttpVersion'] = response.headers.get("x-capacity-http-version") ?? "not-exposed";
        ledger.ack(await boundedResponseText(response, controller.signal));
        const entries = performance.getEntriesByName(echo.href, "resource") as PerformanceResourceTiming[];
        const timing = entries[entries.length - 1];
        ledger.facts['observedNextHopProtocol'] = timing?.nextHopProtocol || "not-exposed";
      } finally { clearTimeout(timer); controllers.delete(controller); }
    },
    async close() { closed = true; stop(); signal.removeEventListener("abort", stop); },
  };
}

export async function connectWss(ledger: TransportLedger, signal: AbortSignal): Promise<TransportConnection> {
  const url = localEndpoint(ledger.options.endpoints.wssUrl, "wss:");
  if (typeof WebSocket === "undefined") throw new Error("Unsupported: WebSocket API unavailable");
  const socket = new WebSocket(url); socket.binaryType = "arraybuffer";
  const close = () => socket.close(1000, "capacity probe stopped");
  signal.addEventListener("abort", close, { once: true });
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (signal.aborted) return;
    if (typeof event.data === "string") ledger.ack(event.data);
    else if (event.data instanceof ArrayBuffer && event.data.byteLength <= 65536) {
      try { ledger.ack(new TextDecoder("utf-8", { fatal: true }).decode(event.data)); } catch { ledger.counters.invalid++; }
    } else ledger.counters.invalid++;
  });
  socket.addEventListener("close", () => {
    if (ledger.state.status === "connected") { ledger.state.status = "failed"; ledger.state.reason = "WSS closed before probe stop"; ledger.event("connection-closed", "WSS peer closed"); }
  });
  try {
    await transportDeadline(new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WSS handshake failed; verify certificate trust and endpoint")), { once: true });
      socket.addEventListener("close", () => reject(new Error("WSS closed before opening")), { once: true });
    }), signal, 8000);
    ledger.facts['wssHandshake'] = "open";
    return {
      async send(frame) {
        ledger.add("buffered", socket.bufferedAmount);
        if (socket.readyState !== WebSocket.OPEN) throw new Error("WSS is not open");
        if (socket.bufferedAmount + new TextEncoder().encode(frame).byteLength > 1024 * 1024) throw new Error("WSS buffered bytes watermark reached");
        socket.send(frame); ledger.add("buffered", socket.bufferedAmount);
      },
      async close() {
        signal.removeEventListener("abort", close);
        if (socket.readyState === 3) { ledger.facts['wssCloseConfirmed'] = true; return; }
        const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
        close();
        try { await transportDeadline(closed, new AbortController().signal, 1000); ledger.facts['wssCloseConfirmed'] = true; }
        catch { ledger.facts['wssCloseConfirmed'] = false; ledger.event("cleanup-unconfirmed", "WSS close event was not observed before cleanup deadline"); }
      },
    };
  } catch (error) { signal.removeEventListener("abort", close); close(); throw error; }
}

/** A separate bounded HTTPS asset download, timed in the same browser clock as the echo workload. */
export async function transferHttpsAsset(ledger: TransportLedger, signal: AbortSignal): Promise<void> {
  if (!ledger.options.endpoints.assetUrl || ledger.options.assetBytes === 0) return;
  const url = localEndpoint(ledger.options.endpoints.assetUrl, "https:");
  const requestedBytes = ledger.options.assetBytes;
  url.searchParams.set("bytes", String(requestedBytes));
  const began = performance.now();
  const response = await transportDeadline(fetch(url, { signal, cache: "no-store", credentials: "omit", redirect: "error" }), signal, ledger.options.ackDeadlineMs);
  if (!response.ok || !response.body) throw new Error(`HTTPS asset request failed (${response.status})`);
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const next = await transportDeadline(reader.read(), signal, ledger.options.ackDeadlineMs);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > requestedBytes) throw new Error("HTTPS asset response exceeded requested bound");
      if (next.value.some((byte) => byte !== 0x5a)) throw new Error("HTTPS asset payload differs from deterministic fixture bytes");
    }
    if (total !== requestedBytes) throw new Error("HTTPS asset byte count differs from request");
    ledger.add("asset-duration", performance.now() - began);
    ledger.add("asset-bytes", total);
    ledger.event("asset-transfer", `Verified ${total} bytes; fetch transfer only, no decode/upload claim`);
  } finally {
    await transportDeadline(reader.cancel(), new AbortController().signal, 500).catch(() => {});
    try { reader.releaseLock(); } catch { /* A timed-out native read can finish after cancellation. */ }
  }
}
