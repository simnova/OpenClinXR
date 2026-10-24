import { localEndpoint, transportDeadline, type TransportConnection, type TransportLedger } from "./transport-probes-state.js";

interface ByteStreams { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }
interface LocalWebTransport {
  ready: Promise<void>;
  closed: Promise<unknown>;
  reliability?: string;
  datagrams: ByteStreams & { maxDatagramSize?: number };
  createBidirectionalStream(): Promise<ByteStreams>;
  close(info?: { closeCode?: number; reason?: string }): void;
}
type WebTransportConstructor = new (url: string, options: { serverCertificateHashes: { algorithm: string; value: ArrayBuffer }[] }) => LocalWebTransport;

/** Newline framed UTF-8 records may arrive split or coalesced; all allocation bounds are explicit. */
export class StreamEchoFramer {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffered = "";
  push(bytes: Uint8Array): string[] {
    if (bytes.byteLength > 1024 * 1024) throw new Error("WebTransport echo chunk exceeded limit");
    this.buffered += this.decoder.decode(bytes, { stream: true });
    const frames: string[] = [];
    let boundary = this.buffered.indexOf("\n");
    while (boundary !== -1) {
      if (boundary > 65536 || frames.length >= 256) throw new Error("WebTransport stream frame/count exceeded limit");
      frames.push(this.buffered.slice(0, boundary)); this.buffered = this.buffered.slice(boundary + 1); boundary = this.buffered.indexOf("\n");
    }
    if (this.buffered.length > 65536) throw new Error("WebTransport stream frame exceeded limit");
    return frames;
  }
}

export async function connectWebTransport(ledger: TransportLedger, signal: AbortSignal): Promise<TransportConnection> {
  const Constructor = (globalThis as unknown as { WebTransport?: WebTransportConstructor }).WebTransport;
  if (!Constructor) throw new Error("Unsupported: WebTransport API unavailable");
  if (!globalThis.isSecureContext) throw new Error("Unsupported: WebTransport needs a secure browser context");
  const url = localEndpoint(ledger.options.endpoints.webTransportUrl, "https:");
  const hashes = ledger.options.endpoints.certificateHashes;
  if (!hashes?.length || hashes.length > 4 || hashes.some((entry) => entry.algorithm !== "sha-256" || entry.value.length !== 32 || entry.value.some((n) => !Number.isInteger(n) || n < 0 || n > 255))) throw new Error("WebTransport requires bounded full DER SHA-256 certificate hashes");
  const transport = new Constructor(url.href, { serverCertificateHashes: hashes.map((entry) => ({ algorithm: entry.algorithm, value: new Uint8Array(entry.value).buffer })) });
  const datagram = ledger.options.protocol === "webtransport-datagram";
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let closed = false;
  let readTask: Promise<void> | undefined;
  const closeTransport = () => transport.close({ closeCode: 0, reason: "capacity probe stopped" });
  signal.addEventListener("abort", closeTransport, { once: true });
  void transport.closed.then(() => {
    if (!closed && !signal.aborted) { ledger.state.status = "failed"; ledger.state.reason = "WebTransport peer closed"; ledger.event("connection-closed", "WebTransport peer closed before stop"); }
  }, () => {
    if (!closed && !signal.aborted) { ledger.state.status = "failed"; ledger.state.reason = "WebTransport session failed"; ledger.event("connection-closed", "WebTransport session failed"); }
  });
  async function cleanup(): Promise<void> {
    if (closed) return;
    closed = true; signal.removeEventListener("abort", closeTransport); closeTransport();
    const operations: Promise<unknown>[] = [];
    if (reader) operations.push(reader.cancel().catch(() => {}));
    if (writer) operations.push(writer.abort().catch(() => {}));
    if (readTask) operations.push(readTask.catch(() => {}));
    ledger.facts['webTransportCloseConfirmed'] = false;
    operations.push(transport.closed.then(() => { ledger.facts['webTransportCloseConfirmed'] = true; }, () => { ledger.facts['webTransportCloseConfirmed'] = true; }));
    // Session close normally settles all pending I/O; never let a browser implementation stall the harness cleanup.
    const cleanupSignal = new AbortController();
    await transportDeadline(Promise.allSettled(operations), cleanupSignal.signal, 500).catch(() => {});
    if (!ledger.facts['webTransportCloseConfirmed']) ledger.event("cleanup-unconfirmed", "WebTransport closed promise did not settle before cleanup deadline");
    try { reader?.releaseLock(); } catch { /* A late native read may still be settling after close. */ }
    try { writer?.releaseLock(); } catch { /* A late native write may still be settling after close. */ }
  }
  try {
    await transportDeadline(transport.ready, signal, 8000);
    if (signal.aborted) throw new DOMException("Transport stopped", "AbortError");
    if (ledger.state.status === "failed") throw new Error(ledger.state.reason ?? "WebTransport closed during readiness");
    ledger.facts['webTransportReady'] = true;
    ledger.facts['webTransportReliability'] = transport.reliability ?? "not-exposed";
    ledger.facts['webTransportCertificatePin'] = "full-DER-sha256";
    ledger.facts['webTransportHttpProtocol'] = "not-exposed-by-browser; correlate-server-H3-session-evidence";
    const streamPromise = datagram ? Promise.resolve(transport.datagrams) : transport.createBidirectionalStream();
    void streamPromise.then(async (lateStreams) => {
      if (signal.aborted || closed) { await lateStreams.readable.cancel().catch(() => {}); await lateStreams.writable.abort().catch(() => {}); }
    }).catch(() => {});
    const streams = await transportDeadline(streamPromise, signal, 3000);
    // Handle late stream creation after cancellation as well as the common immediate-ready path.
    if (signal.aborted || closed) { await streams.readable.cancel().catch(() => {}); await streams.writable.abort().catch(() => {}); throw new DOMException("Transport stopped", "AbortError"); }
    if (datagram) ledger.facts['webTransportMaxDatagramSize'] = transport.datagrams.maxDatagramSize ?? 0;
    reader = streams.readable.getReader(); writer = streams.writable.getWriter();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const framer = new StreamEchoFramer();
    readTask = (async () => {
      try {
        while (!closed && !signal.aborted) {
          const next = await reader!.read();
          if (next.done) break;
          if (datagram) { if (next.value.byteLength > 1024) throw new Error("WebTransport datagram exceeded limit"); ledger.ack(decoder.decode(next.value)); }
          else for (const frame of framer.push(next.value)) ledger.ack(frame);
        }
        if (!closed && !signal.aborted) throw new Error("WebTransport echo reader ended during load");
      } catch (error) {
        if (!closed && !signal.aborted) { ledger.state.status = "failed"; ledger.state.reason = error instanceof Error ? error.message : "WebTransport read failed"; ledger.event("reader-failed", ledger.state.reason); }
      }
    })();
    return {
      async send(frame) {
        if (closed || signal.aborted || !writer) throw new DOMException("Transport stopped", "AbortError");
        const bytes = new TextEncoder().encode(datagram ? frame : `${frame}\n`);
        if (datagram && bytes.byteLength > Math.min(1024, transport.datagrams.maxDatagramSize || 1024)) throw new Error("WebTransport datagram exceeds negotiated size");
        if (!datagram && (writer.desiredSize ?? 1) <= 0) ledger.counters.writerBlocked++;
        const readyBegan = performance.now();
        await transportDeadline(writer.ready, signal, ledger.options.ackDeadlineMs);
        if (!datagram) ledger.add("reliable-write-wait", performance.now() - readyBegan);
        await transportDeadline(writer.write(bytes), signal, ledger.options.ackDeadlineMs);
      },
      close: cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}
