import { afterEach, describe, expect, it, vi } from "vitest";
import { startTransportProbe, type TransportProbeOptions } from "@openclinxr/xr-capacity/browser/probes";

function options(overrides: Partial<TransportProbeOptions> = {}): TransportProbeOptions {
  return { protocol: "wss", endpoints: { wssUrl: "wss://localhost:49999/capacity/ws?token=fixture" }, level: 1, durationMs: 1000, signal: new AbortController().signal, ackDeadlineMs: 100, ...overrides };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
type Handle = Awaited<ReturnType<typeof startTransportProbe>>;
function count(handle: Handle, name: string) { return handle.snapshotMetrics().find((m) => m.id.endsWith(`.${name}`))?.samples.at(-1)?.value; }
async function live(overrides: Partial<TransportProbeOptions> = {}) {
  vi.useFakeTimers(); FixtureSocket.echo = true; FixtureSocket.instances = []; FixtureSocket.onSend = undefined; vi.stubGlobal("WebSocket", FixtureSocket);
  const pending = startTransportProbe(options(overrides)); await vi.advanceTimersByTimeAsync(overrides.maxBytes === 128 ? 1120 : 20); return pending;
}
function socket() { return FixtureSocket.instances[0]!; }
function echo(frame: string) { socket().dispatchEvent(new MessageEvent("message", { data: frame })); }
describe("transport application accounting (synthetic fixtures)", () => {
  it("requires exact nonce, sequence and payload; counts duplicate and foreign echoes separately", async () => {
    const handle = await live(); FixtureSocket.echo = false; await vi.advanceTimersByTimeAsync(21); const sent = socket().sent[1]!;
    echo(sent.replace('"session":', '"foreign":')); echo(sent.replace('"payload":"q', '"payload":"x'));
    expect(count(handle, "invalid")).toBe(2); expect(count(handle, "delivered")).toBe(1);
    echo(sent); expect(count(handle, "duplicate")).toBe(0); echo(sent); expect(count(handle, "duplicate")).toBe(1); expect(handle.state.worked).toBe(true);
    expect(handle.events.filter((event) => event.event === "first-echo")).toHaveLength(1); await handle.stop();
  });
  it("limits accepted messages, in-flight bytes and ACK age without promoting socket acceptance", async () => {
    const handle = await live({ maxInFlight: 1, maxMessages: 3 }); FixtureSocket.echo = false;
    await vi.advanceTimersByTimeAsync(60); const pending = socket().sent[1]!;
    expect(count(handle, "blocked")).toBe(1); expect(count(handle, "accepted")).toBe(2);
    await vi.advanceTimersByTimeAsync(101); echo(pending);
    expect(count(handle, "expired")).toBe(1); expect(count(handle, "late")).toBe(1);
    echo(socket().sent[2]!); expect(count(handle, "accepted")).toBe(3); expect(count(handle, "delivered")).toBe(2);
    expect(count(handle, "pending")).toBe(0); await handle.stop();
  });
  it("enforces byte and sample limits and attributes discarded pending packets", async () => {
    const handle = await live({ level: 2, durationMs: 60000, maxMessages: 4096, maxBytes: 16 * 1024 * 1024 });
    await vi.advanceTimersByTimeAsync(49961);
    const buffered = handle.snapshotMetrics().find((m) => m.id.endsWith(".buffered"))!;
    expect(buffered.samples).toHaveLength(2048); expect(count(handle, "accepted")).toBe(2500); expect(buffered.droppedSamples).toBe(14759);
    FixtureSocket.echo = false; await vi.advanceTimersByTimeAsync(20); await handle.stop();
    expect(count(handle, "dropped")).toBe(1); expect(count(handle, "pending")).toBe(0);
    expect(handle.snapshotMetrics().find((m) => m.id.endsWith(".unacked"))?.samples.at(-1)?.value).toBe(1145);
    const drained = await live(); await drained.stop(); expect(drained.snapshotMetrics().find((m) => m.id.endsWith(".unacked"))?.samples.at(-1)?.value).toBe(0);
    const small = await live({ maxBytes: 128 });
    expect(count(small, "accepted")).toBe(0); expect(count(small, "offered")).toBeGreaterThan(0); expect(count(small, "byteBudgetLimited")).toBeGreaterThan(0); await small.stop();
  });
  it("counts offered attempts censored by message caps separately from admitted work", async () => {
    const handle = await live({ maxMessages: 1 }); await vi.advanceTimersByTimeAsync(61);
    expect(count(handle, "offered")).toBe(3); expect(count(handle, "accepted")).toBe(1);
    expect(count(handle, "delivered")).toBe(1); expect(count(handle, "messageBudgetLimited")).toBe(2);
    expect(handle.events.filter((event) => event.event === "budget-censored")).toHaveLength(1); await handle.stop();
  });
  it("snapshots configuration before awaits and rejects unbounded or public destinations", async () => {
    vi.useFakeTimers(); FixtureSocket.echo = true; FixtureSocket.instances = []; vi.stubGlobal("WebSocket", FixtureSocket);
    const input = options(); const pending = startTransportProbe(input); input.endpoints.wssUrl = "wss://malicious.example/"; input.maxInFlight = 100000;
    await vi.advanceTimersByTimeAsync(20); const handle = await pending;
    expect(handle.axes['endpointHost']).toBe("localhost"); expect(handle.axes['maxInFlight']).toBe(8); await handle.stop();
    await expect(startTransportProbe(options({ maxBytes: Infinity }))).rejects.toThrow();
    await expect(startTransportProbe(options({ durationMs: NaN }))).rejects.toThrow();
    for (const url of ["https://example.com/", "wss://user:pass@localhost/", "ws://localhost/", "wss://172.32.1.1/"]) {
      const invalid = await startTransportProbe(options({ endpoints: { wssUrl: url } })); expect(invalid.state.worked).toBe(false); expect(invalid.state.status).toBe("failed");
    }
    for (const url of ["wss://localhost/", "wss://192.168.1.2/", "wss://172.31.1.2/", "wss://[::1]/"]) {
      const accepted = startTransportProbe(options({ endpoints: { wssUrl: url } })); await vi.advanceTimersByTimeAsync(20); const result = await accepted; expect(result.state.worked).toBe(true); await result.stop();
    }
  });
  it("cancels oversized HTTP response readers and rejects non-OK responses", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    for (const status of [200, 403]) {
      vi.stubGlobal("fetch", async () => status === 403 ? new Response("no", { status }) : new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(65537)); }, cancel })));
      const pending = startTransportProbe(options({ protocol: "https", endpoints: { echoUrl: "https://localhost/echo" } }));
      await vi.advanceTimersByTimeAsync(1120); const handle = await pending;
      expect(handle.events.some((e) => e.event === "send-failed" && e.detail.includes(status === 403 ? "403" : "byte limit"))).toBe(true); expect(handle.state.worked).toBe(false);
    }
    expect(cancel).toHaveBeenCalled();
  });
  it("does not repair expired deliveries with duplicates or wrong-phase frames and freezes throughput after stop", async () => {
    const handle = await live({ phaseId: "baseline", streamId: "primary" }); FixtureSocket.echo = false;
    await vi.advanceTimersByTimeAsync(21); const sent = socket().sent[1]!;
    echo(sent.replace('"phase":"baseline"', '"phase":"concurrent"')); expect(count(handle, "delivered")).toBe(1); expect(count(handle, "invalid")).toBe(1);
    await vi.advanceTimersByTimeAsync(101); echo(sent); echo(sent);
    expect(count(handle, "delivered")).toBe(1); expect(count(handle, "expired")).toBe(1);
    echo(socket().sent.at(-1)!); await handle.stop();
    const counters = ["accepted", "delivered", "expired", "dropped", "pending"].map((id) => count(handle, id));
    echo(sent); expect(["accepted", "delivered", "expired", "dropped", "pending"].map((id) => count(handle, id))).toEqual(counters);
    const rate = handle.snapshotMetrics().find((metric) => metric.id.endsWith("payload-goodput"))!;
    await vi.advanceTimersByTimeAsync(10000); expect(handle.snapshotMetrics().find((metric) => metric.id.endsWith("payload-goodput"))).toEqual(rate);
  });
  it("keeps terminal accounting disjoint and counts late sequences separately from late arrival events", async () => {
    const handle = await live({ phaseId: "measured" }); FixtureSocket.echo = false;
    await vi.advanceTimersByTimeAsync(21); const sent = socket().sent[1]!; await vi.advanceTimersByTimeAsync(101);
    echo(sent); echo(sent); echo(sent); echo(sent.replace('"phase":"measured"', '"phase":"foreign"'));
    expect(count(handle, "expired")).toBe(1); expect(count(handle, "late")).toBe(1);
    expect(count(handle, "lateArrivalEvents")).toBe(3); expect(count(handle, "lateDuplicateEvents")).toBe(2);
    expect(count(handle, "invalid")).toBe(1); expect(count(handle, "delivered")).toBe(1);
    const balanced = () => expect(count(handle, "accepted")).toBe(count(handle, "delivered")! + count(handle, "expired")! + count(handle, "dropped")! + count(handle, "pending")!);
    balanced();
    FixtureSocket.onSend = () => { throw new Error("synthetic send failure"); };
    await vi.advanceTimersByTimeAsync(40); expect(count(handle, "dropped")).toBe(1); balanced();
    expect(handle.events.some((e) => e.event === "send-failed")).toBe(true);
    FixtureSocket.onSend = undefined; await handle.stop(); balanced(); expect(count(handle, "pending")).toBe(0);
  });
});

class FixtureRtcPeer extends EventTarget {
  connectionState = "new"; iceGatheringState = "complete";
  localDescription: { type: string; sdp: string } | null = null;
  createDataChannel() { const channel = new EventTarget() as EventTarget & { readyState: string; close(): void }; channel.readyState = "connecting"; channel.close = () => { channel.readyState = "closed"; }; return channel; }
  async createOffer() { return { type: "offer", sdp: "synthetic-rtc-offer" }; }
  async setLocalDescription(value: { type: string; sdp: string }) { this.localDescription = value; }
  close() { this.connectionState = "closed"; this.dispatchEvent(new Event("connectionstatechange")); }
}
describe("RTC signaling cancellation (synthetic fixtures)", () => {
  for (const matchingTicket of [true, false]) it(`closes the client-owned ticket before an answer exists; drain ${matchingTicket ? "confirmed" : "unconfirmed"}`, async () => {
    vi.stubGlobal("RTCPeerConnection", FixtureRtcPeer);
    let offerTicket = "", closeTicket = "";
    let offered: (() => void) | undefined;
    const offerReached = new Promise<void>((resolve) => { offered = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { peerId: string };
      if (url.pathname.endsWith("/offer")) {
        offerTicket = body.peerId; offered?.();
        return new Promise<Response>((_, reject) => {
          const rejectAbort = () => reject(new DOMException("Aborted pending signaling response", "AbortError"));
          if (init.signal?.aborted) rejectAbort(); else init.signal?.addEventListener("abort", rejectAbort, { once: true });
        });
      }
      closeTicket = body.peerId;
      return Promise.resolve(Response.json({ closed: true, peerId: matchingTicket ? body.peerId : "foreign-ticket" }));
    }));
    const controller = new AbortController();
    const pending = startTransportProbe(options({ protocol: "webrtc-reliable", signal: controller.signal, endpoints: { rtcOfferUrl: "https://localhost/capacity/rtc/offer", rtcCloseUrl: "https://localhost/capacity/rtc/close" } }));
    await offerReached; controller.abort(); const handle = await pending;
    expect(offerTicket.length).toBeGreaterThan(16); expect(closeTicket).toBe(offerTicket);
    expect(handle.state.status).toBe("stopped"); expect(handle.state.worked).toBe(false);
    expect(handle.axes['rtcLocalCloseConfirmed']).toBe(true);
    expect(handle.axes['rtcServerDrainState']).toBe(matchingTicket ? "confirmed" : "unconfirmed");
    if (!matchingTicket) expect(handle.events.some((event) => event.detail.includes("recovery must remain blocked"))).toBe(true);
  });
});

class FixtureSocket extends EventTarget {
  static OPEN = 1;
  static echo = true;
  static onSend: ((frame: string, socket: FixtureSocket) => void) | undefined;
  sent: string[] = [];
  static instances: FixtureSocket[] = [];
  readyState = 0; bufferedAmount = 0; binaryType = "arraybuffer";
  closed = false;
  constructor(_url: URL) { super(); FixtureSocket.instances.push(this); setTimeout(() => { if (!this.closed) { this.readyState = 1; this.dispatchEvent(new Event("open")); } }, 0); }
  send(frame: string) { this.sent.push(frame); FixtureSocket.onSend?.(frame, this); if (FixtureSocket.echo) setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: frame })), 1); }
  close() { this.closed = true; this.readyState = 3; this.dispatchEvent(new Event("close")); }
}
describe("transport lifecycle (synthetic browser fixtures, no real protocol evidence)", () => {
  it("reports missing endpoints and missing APIs as unsupported, with no RTT evidence", async () => {
    const endpoint = await startTransportProbe(options({ endpoints: {} }));
    expect(endpoint.state.status).toBe("unsupported"); expect(endpoint.state.worked).toBe(false);
    vi.stubGlobal("WebSocket", undefined);
    const api = await startTransportProbe(options());
    expect(api.state.status).toBe("unsupported"); expect(api.snapshotMetrics().find((metric) => metric.id.endsWith(".rtt"))?.kind).toBe("unavailable");
  });
  it("requires actual echo after open and returns a live bounded handle with immutable state", async () => {
    vi.useFakeTimers(); FixtureSocket.echo = true; FixtureSocket.instances = []; vi.stubGlobal("WebSocket", FixtureSocket);
    const pending = startTransportProbe(options()); await vi.advanceTimersByTimeAsync(20); const handle = await pending;
    expect(handle.state.worked).toBe(true); expect(handle.state.status).toBe("connected");
    expect(handle.events.some((event) => event.event === "active-window-start")).toBe(true);
    expect(Object.isFrozen(handle.axes)).toBe(true); expect(Object.isFrozen(handle.state)).toBe(true);
    await handle.stop(); await handle.stop();
    expect(FixtureSocket.instances[0]?.closed).toBe(true); expect(handle.state.status).toBe("stopped");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never treats WSS open or bufferedAmount zero as delivery; startup timeout cleans up", async () => {
    vi.useFakeTimers(); FixtureSocket.echo = false; FixtureSocket.instances = []; vi.stubGlobal("WebSocket", FixtureSocket);
    const pending = startTransportProbe(options()); await vi.advanceTimersByTimeAsync(1200); const handle = await pending;
    expect(handle.state.status).toBe("failed"); expect(handle.state.worked).toBe(false);
    expect(handle.snapshotMetrics().find((metric) => metric.id.endsWith(".rtt"))?.kind).toBe("unavailable");
    expect(FixtureSocket.instances[0]?.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a connection in progress and releases its socket", async () => {
    vi.useFakeTimers(); FixtureSocket.instances = []; vi.stubGlobal("WebSocket", FixtureSocket);
    const controller = new AbortController(); const pending = startTransportProbe(options({ signal: controller.signal })); controller.abort();
    await vi.advanceTimersByTimeAsync(1); const handle = await pending;
    expect(handle.state.status).toBe("stopped"); expect(handle.state.worked).toBe(false);
    expect(FixtureSocket.instances[0]?.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("closes a WebTransport stream created after cancellation", async () => {
    vi.stubGlobal("isSecureContext", true);
    let resolveStream: (stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }) => void = () => {};
    const cancel = vi.fn(), abort = vi.fn(), close = vi.fn();
    const stream = { readable: new ReadableStream<Uint8Array>({ cancel }), writable: new WritableStream<Uint8Array>({ abort }) };
    class FixtureTransport {
      ready = Promise.resolve(); closed = new Promise(() => {}); datagrams = stream;
      createBidirectionalStream() { return new Promise<typeof stream>((resolve) => { resolveStream = resolve; }); }
      close = close;
    }
    vi.stubGlobal("WebTransport", FixtureTransport);
    const controller = new AbortController();
    const pending = startTransportProbe(options({ protocol: "webtransport-stream", signal: controller.signal, endpoints: { webTransportUrl: "https://localhost:49998/capacity/wt", certificateHashes: [{ algorithm: "sha-256", value: new Array(32).fill(1) }] } }));
    await new Promise((resolve) => setTimeout(resolve, 0)); controller.abort(); const handle = await pending;
    resolveStream(stream); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handle.state.status).toBe("stopped"); expect(cancel).toHaveBeenCalled(); expect(abort).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
  });
});

async function rtc(entries: Record<string, unknown>[]) {
  vi.useFakeTimers();
  class Peer extends FixtureRtcPeer {
    channel = Object.assign(new EventTarget(), { readyState: "open", ordered: true, bufferedAmount: 48,
      close() { this.readyState = "closed"; }, send: (frame: string) => { this.channel.dispatchEvent(new MessageEvent("message", { data: frame })); } });
    override createDataChannel() { return this.channel; }
    async setRemoteDescription() {}
    async getStats() { return new Map(entries.map((entry) => [String(entry['id']), entry])); }
  }
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    const { peerId } = JSON.parse(String(init.body)) as { peerId: string };
    return Response.json(url.pathname.endsWith("offer") ? { type: "answer", sdp: "synthetic-answer", peerId } : { closed: true, peerId });
  });
  const pending = startTransportProbe(options({ protocol: "webrtc-reliable", endpoints: { rtcOfferUrl: "https://localhost/offer", rtcCloseUrl: "https://localhost/close" } }));
  await vi.advanceTimersByTimeAsync(20); return pending;
}
describe("RTC selected ICE pair evidence", () => {
  const a = { id: "pair-a", type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: .100 };
  const b = { id: "pair-b", type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: .002 };
  it("uses the authoritative transport pointer regardless of nominated pair iteration order", async () => {
    const transport = { id: "dtls", type: "transport", selectedCandidatePairId: "pair-b" };
    for (const entries of [[a, b, transport], [b, transport, a]]) {
      const handle = await rtc(entries);
      expect(handle.axes['rtcSelectedPairStatus']).toBe("selected"); expect(handle.axes['rtcSelectedPairEvidence']).toBe("transport.selectedCandidatePairId");
      expect(handle.snapshotMetrics().find((m) => m.id.endsWith(".rtc-candidate-pair-rtt"))?.samples[0]?.value).toBe(2); await handle.stop();
    }
  });
  it("does not select nominated-only, conflicting pointers, or multiple explicitly selected pairs", async () => {
    for (const [entries, status] of [
      [[a, b], "unknown"],
      [[a, b, { id: "t1", type: "transport", selectedCandidatePairId: "pair-a" }, { id: "t2", type: "transport", selectedCandidatePairId: "pair-b" }], "ambiguous"],
      [[{ ...a, selected: true }, { ...b, selected: true }], "ambiguous"],
      [[a, { id: "t1", type: "transport", selectedCandidatePairId: "missing" }], "unknown"],
    ] as [Record<string, unknown>[], string][]) {
      const handle = await rtc(entries); expect(handle.axes['rtcSelectedPairStatus']).toBe(status);
      expect(handle.snapshotMetrics().find((m) => m.id.endsWith(".rtc-candidate-pair-rtt"))?.kind).toBe("unavailable"); await handle.stop();
    }
    const selected = await rtc([a, { ...b, selected: true }]);
    expect(selected.axes['rtcSelectedPairStatus']).toBe("selected"); expect(selected.snapshotMetrics().find((m) => m.id.endsWith(".rtc-candidate-pair-rtt"))?.samples[0]?.value).toBe(2); await selected.stop();
  });
  it("labels RTCDataChannel buffered bytes separately from WebSocket buffering", async () => {
    const wss = await live(); expect(wss.snapshotMetrics().find((m) => m.id.endsWith(".buffered"))?.semantic).toBe("websocket-buffered"); await wss.stop();
    const handle = await rtc([]); const metric = handle.snapshotMetrics().find((m) => m.id.endsWith(".rtc-buffered-bytes"));
    expect(metric?.semantic).toBe("bytes"); expect(metric?.unit).toBe("bytes"); expect(metric?.samples[0]?.value).toBe(48);
    expect(handle.snapshotMetrics().find((m) => m.id.endsWith("whole-handle-payload-goodput"))?.granularity).toBe("aggregate-window"); await handle.stop();
  });
});
it("accepts split/coalesced stream frames and rejects oversized or malformed UTF-8", async () => {
  vi.useFakeTimers(); vi.stubGlobal("isSecureContext", true);
  for (const mode of ["split", "coalesced", "batch-with-tail", "oversized", "utf8"] as const) {
    let input: ReadableStreamDefaultController<Uint8Array> | undefined; let closed: (() => void) | undefined;
    const cancel = vi.fn(), abort = vi.fn(), encode = new TextEncoder();
    const sent: Uint8Array[] = [];
    const stream = { readable: new ReadableStream<Uint8Array>({ start(c) { input = c; }, cancel }), writable: new WritableStream<Uint8Array>({ write(bytes) {
      if (mode === "batch-with-tail") { sent.push(bytes); if (sent.length === 1) input!.enqueue(bytes); }
      if (mode === "split") { input!.enqueue(bytes.slice(0, 7)); input!.enqueue(bytes.slice(7)); }
      if (mode === "coalesced") input!.enqueue(encode.encode(`${new TextDecoder().decode(bytes)}${"a".repeat(40000)}\n${"b".repeat(40000)}\n`));
      if (mode === "oversized") input!.enqueue(encode.encode("a".repeat(65537)));
      if (mode === "utf8") input!.enqueue(new Uint8Array([0xff]));
    }, abort }) };
    class Transport {
      ready = Promise.resolve(); closed = new Promise<void>((resolve) => { closed = resolve; }); datagrams = stream;
      async createBidirectionalStream() { return stream; }
      close() { closed?.(); }
    }
    vi.stubGlobal("WebTransport", Transport);
    const pending = startTransportProbe(options({ protocol: "webtransport-stream", endpoints: { webTransportUrl: "https://localhost/wt", certificateHashes: [{ algorithm: "sha-256", value: new Array(32).fill(1) }] } }));
    await vi.advanceTimersByTimeAsync(mode === "batch-with-tail" ? 120 : 1120); const handle = await pending;
    if (mode === "batch-with-tail") {
      expect(sent).toHaveLength(4); expect(count(handle, "delivered")).toBe(1); expect(count(handle, "pending")).toBe(3);
      const first = sent[1]!, second = sent[2]!, tail = sent[3]!;
      const prefix = tail.slice(0, 7);
      const batch = new Uint8Array(first.length + second.length + prefix.length);
      batch.set(first); batch.set(second, first.length); batch.set(prefix, first.length + second.length);
      input!.enqueue(batch); await vi.advanceTimersByTimeAsync(0);
      // Both complete records from the same chunk are delivered exactly once; the tail is incomplete.
      expect(count(handle, "delivered")).toBe(3); expect(count(handle, "pending")).toBe(1); expect(count(handle, "duplicate")).toBe(0); expect(count(handle, "invalid")).toBe(0);
      input!.enqueue(tail.slice(7)); await vi.advanceTimersByTimeAsync(0);
      expect(count(handle, "delivered")).toBe(4); expect(count(handle, "pending")).toBe(0); expect(count(handle, "duplicate")).toBe(0); expect(count(handle, "invalid")).toBe(0);
    }
    else if (mode === "split" || mode === "coalesced") { expect(handle.state.worked).toBe(true); if (mode === "coalesced") expect(count(handle, "invalid")).toBeGreaterThan(0); }
    else { expect(handle.state.worked).toBe(false); expect(handle.state.status).toBe("failed"); expect(handle.events.some((e) => e.event === "reader-failed")).toBe(true); }
    await handle.stop(); expect(cancel).toHaveBeenCalled(); expect(abort).toHaveBeenCalled();
  }
});
