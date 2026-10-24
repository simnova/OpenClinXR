import { makeMetric } from "../factories.js";
import type { AxisValue, CapacityMetric, MetricSample } from "../types.js";

export type TransportProtocol = "https" | "wss" | "webrtc-reliable" | "webrtc-unordered" | "webtransport-stream" | "webtransport-datagram";
export interface TransportEndpoints {
  httpsOrigin?: string;
  echoUrl?: string;
  assetUrl?: string;
  wssUrl?: string;
  rtcOfferUrl?: string;
  rtcCloseUrl?: string;
  webTransportUrl?: string;
  certificateHashes?: { algorithm: "sha-256"; value: number[] }[];
  serverBuildHash?: string;
  runtimeVersions?: Record<string, string>;
  routeScope?: string;
}
export interface TransportEvent { at: number; event: string; detail: string }
export interface TransportState { status: "connecting" | "connected" | "failed" | "unsupported" | "stopped"; reason: string | null; worked: boolean }
export interface TransportProbeOptions {
  protocol: TransportProtocol;
  endpoints: TransportEndpoints;
  level: number;
  durationMs: number;
  signal: AbortSignal;
  maxMessages?: number;
  maxBytes?: number;
  maxInFlight?: number;
  ackDeadlineMs?: number;
  mediaStream?: MediaStream;
  syntheticRtcAudio?: boolean;
  phaseId?: string;
  streamId?: string;
  onEvent?: (event: TransportEvent) => void;
}
export interface ActiveTransportProbe {
  readonly axes: Readonly<Record<string, AxisValue>>;
  readonly events: readonly TransportEvent[];
  readonly state: Readonly<TransportState>;
  snapshotMetrics(): CapacityMetric[];
  stop(): Promise<void>;
}
export interface TransportConnection {
  send(frame: string): Promise<void>;
  close(): Promise<void>;
  stats?(): Promise<void>;
}
export interface FrozenTransportOptions extends TransportProbeOptions {
  maxMessages: number; maxBytes: number; maxInFlight: number; ackDeadlineMs: number;
  payloadBytes: number; intervalMs: number; assetBytes: number;
}
const protocols: readonly string[] = ["https", "wss", "webrtc-reliable", "webrtc-unordered", "webtransport-stream", "webtransport-datagram"];
function bounded(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be ${min}..${max}`);
  return Math.floor(value);
}
export function freezeTransportOptions(input: TransportProbeOptions): FrozenTransportOptions {
  if (!protocols.includes(input.protocol)) throw new TypeError("Unknown transport protocol");
  for (const value of [input.phaseId, input.streamId]) if (value !== undefined && (typeof value !== "string" || value.length > 128)) throw new TypeError("Phase/stream IDs must be bounded strings");
  const level = bounded(input.level, 1, 3, "level");
  const maxBytes = bounded(input.maxBytes ?? 1024 * 1024, 128, 16 * 1024 * 1024, "maxBytes");
  const endpoints = structuredClone(input.endpoints);
  Object.freeze(endpoints.certificateHashes?.map((entry) => Object.freeze(entry.value)));
  return Object.freeze({ ...input, endpoints: Object.freeze(endpoints), level,
    durationMs: bounded(input.durationMs, 100, 60000, "durationMs"),
    maxMessages: bounded(input.maxMessages ?? 128, 1, 4096, "maxMessages"),
    maxBytes,
    maxInFlight: bounded(input.maxInFlight ?? 8, 1, 64, "maxInFlight"),
    ackDeadlineMs: bounded(input.ackDeadlineMs ?? 2000, 100, 10000, "ackDeadlineMs"),
    payloadBytes: input.protocol === "webtransport-datagram" ? [64, 256, 512][level - 1]! : [128, 1024, 8192][level - 1]!,
    intervalMs: [40, 20, 10][level - 1]!,
    assetBytes: input.protocol === "https" && input.endpoints.assetUrl ? Math.min([8192, 32768, 65536][level - 1]!, Math.floor(maxBytes / 4)) : 0,
  });
}
/** This harness deliberately accepts only local/private destinations. It never discovers public ICE services. */
export function localEndpoint(value: string | undefined, scheme: "https:" | "wss:"): URL {
  if (!value) throw new Error("Local service endpoint is not configured");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const octets = host.split(".").map(Number);
  const privateV4 = octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31));
  const localHost = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "[::1]" || /^\[(fc|fd)[0-9a-f:]+\]$/.test(host);
  if (url.protocol !== scheme || url.username || url.password || !(privateV4 || localHost)) throw new Error("Only HTTPS/WSS local/private service URLs are allowed");
  return url;
}
type Pending = { frame: string; bytes: number; at: number };
const encoder = new TextEncoder();
/** Explicit application ACK accounting. Socket send completion is never treated as delivery. */
export class TransportLedger {
  readonly options: FrozenTransportOptions;
  readonly nonce = globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  readonly pending = new Map<number, Pending>();
  readonly samples = new Map<string, MetricSample[]>();
  readonly events: TransportEvent[] = [];
  readonly facts: Record<string, AxisValue> = {};
  readonly state: TransportState = { status: "connecting", reason: null, worked: false };
  readonly counters = { offered: 0, accepted: 0, delivered: 0, expired: 0, dropped: 0, pending: 0, duplicate: 0, late: 0, lateArrivalEvents: 0, lateDuplicateEvents: 0, invalid: 0, blocked: 0, messageBudgetLimited: 0, byteBudgetLimited: 0, writerBlocked: 0, acceptedBytes: 0, deliveredBytes: 0 };
  private sequence = 0;
  private pendingBytes = 0;
  private readonly delivered = new Set<number>();
  private readonly expired = new Map<number, Pending>();
  private readonly lateSeen = new Set<number>();
  private readonly began = performance.now();
  private loadBegan: number | undefined;
  private ended: number | undefined;
  private previousRtt: number | undefined;
  droppedSamples = 0;
  constructor(options: FrozenTransportOptions) { this.options = options; }
  beginLoad(): void { this.loadBegan = performance.now(); this.event("load-window-start", "First application send window begins"); }
  event(event: string, detail: string): void {
    const value = { at: performance.now(), event, detail: detail.slice(0, 1024) };
    if (this.events.length < 256) this.events.push(value);
    try { this.options.onEvent?.({ ...value }); } catch { /* Observers cannot alter probe lifetime. */ }
  }
  add(id: string, value: number, at = performance.now()): void {
    if (this.ended !== undefined) return;
    if (!Number.isFinite(value) || value < 0) return;
    const samples = this.samples.get(id) ?? [];
    if (samples.length < 2048) samples.push({ at, value, valid: true }); else this.droppedSamples++;
    this.samples.set(id, samples);
  }
  next(): { seq: number; frame: string } | null {
    if (this.ended !== undefined) return null;
    this.expire();
    this.counters.offered++;
    if (this.counters.accepted >= this.options.maxMessages) {
      if (++this.counters.messageBudgetLimited === 1) this.event("budget-censored", "Message admission cap reached; later scheduled attempts are counted as messageBudgetLimited");
      return null;
    }
    const seq = this.sequence;
    const frame = JSON.stringify({ version: 1, session: this.nonce, phase: this.options.phaseId ?? "unassigned", stream: this.options.streamId ?? this.options.protocol, seq, payload: "q".repeat(this.options.payloadBytes) });
    const bytes = encoder.encode(frame).byteLength;
    if (this.counters.acceptedBytes + bytes > this.options.maxBytes - this.options.assetBytes) {
      if (++this.counters.byteBudgetLimited === 1) this.event("budget-censored", "Byte admission cap reached; later scheduled attempts are counted as byteBudgetLimited");
      return null;
    }
    if (this.pending.size >= this.options.maxInFlight || this.pendingBytes + bytes > 1024 * 1024) { this.counters.blocked++; return null; }
    this.sequence++; this.counters.accepted++; this.counters.acceptedBytes += bytes; this.pendingBytes += bytes;
    this.pending.set(seq, { frame, bytes, at: performance.now() });
    this.sampleQueue();
    return { seq, frame };
  }
  ack(frame: string): void {
    if (this.ended !== undefined) return;
    if (frame.length > 65536) { this.counters.invalid++; return; }
    let input: { version?: unknown; session?: unknown; seq?: unknown };
    try { input = JSON.parse(frame) as typeof input; } catch { this.counters.invalid++; return; }
    if (!input || input.version !== 1 || input.session !== this.nonce || !Number.isSafeInteger(input.seq)) { this.counters.invalid++; return; }
    const seq = input.seq as number;
    const pending = this.pending.get(seq);
    if (!pending) {
      if (this.delivered.has(seq)) this.counters.duplicate++;
      else {
        const expired = this.expired.get(seq);
        if (expired && expired.frame === frame) {
          this.counters.lateArrivalEvents++;
          if (this.lateSeen.has(seq)) this.counters.lateDuplicateEvents++;
          else { this.lateSeen.add(seq); this.counters.late++; }
        } else this.counters.invalid++;
      }
      return;
    }
    if (pending.frame !== frame) { this.counters.invalid++; return; }
    if (performance.now() - pending.at > this.options.ackDeadlineMs) { this.expire(); this.ack(frame); return; }
    this.pending.delete(seq); this.pendingBytes -= pending.bytes; this.delivered.add(seq);
    this.counters.delivered++; this.counters.deliveredBytes += pending.bytes;
    if (!this.state.worked) this.event("first-echo", "Exact session, sequence and payload echo verified");
    this.state.worked = true;
    const rtt = performance.now() - pending.at;
    this.add("rtt", rtt);
    if (this.previousRtt !== undefined) this.add("rtt-adjacent-delta", Math.abs(rtt - this.previousRtt));
    this.previousRtt = rtt;
    this.sampleQueue();
  }
  sendFailed(seq: number): void {
    if (this.ended !== undefined) return;
    const pending = this.pending.get(seq);
    if (pending) { this.pendingBytes -= pending.bytes; this.pending.delete(seq); this.counters.dropped++; }
    this.sampleQueue();
  }
  expire(): void {
    if (this.ended !== undefined) return;
    const now = performance.now();
    for (const [seq, pending] of this.pending) if (now - pending.at > this.options.ackDeadlineMs) {
      this.pending.delete(seq); this.pendingBytes -= pending.bytes; this.expired.set(seq, pending); this.counters.expired++;
    }
    this.sampleQueue();
  }
  finish(): void {
    if (this.ended !== undefined) return;
    this.counters.dropped += this.pending.size; this.pending.clear(); this.pendingBytes = 0; this.sampleQueue(); this.ended = performance.now();
    this.expired.clear(); this.lateSeen.clear(); this.delivered.clear();
  }
  sampleQueue(): void {
    this.counters.pending = this.pending.size;
    this.add("unacked", this.pendingBytes);
    let age = 0;
    for (const value of this.pending.values()) age = Math.max(age, performance.now() - value.at);
    this.add("oldest-queue-age", age);
  }
  snapshot(): CapacityMetric[] {
    const source = { tool: "capacity-browser-transport", version: "2", processId: "browser-page" };
    const prefix = `transport.${this.options.protocol}`;
    const values: CapacityMetric[] = [];
    const definitions: [string, CapacityMetric["semantic"], CapacityMetric["unit"]][] = [
      ["rtt", "network-rtt", "ms"], ["rtt-adjacent-delta", "network-jitter", "ms"], ["unacked", "application-unacked", "bytes"],
      ["oldest-queue-age", "queue-age", "ms"], ["buffered", this.options.protocol === "wss" ? "websocket-buffered" : "bytes", "bytes"], ["asset-duration", "asset-duration", "ms"],
      ["asset-bytes", "bytes", "bytes"], ["reliable-write-wait", "queue-age", "ms"], ["rtc-jitter", "network-jitter", "ms"], ["rtc-packets-lost", "counter", "count"],
      ["rtc-candidate-pair-rtt", "network-rtt", "ms"], ["rtc-audio-samples", "counter", "count"], ["rtc-audio-packets", "counter", "count"],
    ];
    for (const [id, semantic, unit] of definitions) if (this.samples.has(id) || id === "rtt" || (id === "rtc-candidate-pair-rtt" && this.options.protocol.startsWith("webrtc"))) {
      const samples = this.samples.get(id) ?? [];
      const metricId = id === "buffered" && this.options.protocol.startsWith("webrtc") ? "rtc-buffered-bytes" : id;
      values.push(makeMetric({ id: `${prefix}.${metricId}`, semantic, unit, source, clockDomain: "browser-monotonic", granularity: "event", samples,
        kind: samples.length ? "measured" : "unavailable", unavailableReason: samples.length ? null : id === "rtc-candidate-pair-rtt" ? "Selected ICE pair unavailable or ambiguous; application echo RTT is separate" : "No verified application echo completed", droppedSamples: this.droppedSamples,
        transportState: this.state.status === "failed" ? "failed" : this.state.status === "connecting" ? "pending" : this.state.worked ? "connected" : "failed" }));
    }
    for (const [name, value] of Object.entries(this.counters)) values.push(makeMetric({ id: `${prefix}.${name}`, semantic: name.endsWith("Bytes") ? "bytes" : "counter", unit: name.endsWith("Bytes") ? "bytes" : "count", source, clockDomain: "browser-monotonic", granularity: "event", samples: [{ at: performance.now(), value, valid: true }] }));
    const end = this.ended ?? performance.now(), windowMs = Math.max(1, end - (this.loadBegan ?? this.began));
    values.push(makeMetric({ id: `${prefix}.whole-handle-payload-goodput`, semantic: "network-throughput", unit: "bytes/s", source, clockDomain: "browser-monotonic", granularity: "aggregate-window", windowMs, samples: [{ at: end, value: this.counters.deliveredBytes * 1000 / windowMs, valid: true }] }));
    return values;
  }
}
export async function transportDeadline<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) throw new DOMException("Transport stopped", "AbortError");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException("Transport stopped", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Transport operation deadline exceeded")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
export async function boundedResponseText(response: Response, signal: AbortSignal, limit = 65536): Promise<string> {
  if (!response.ok) throw new Error(`Local service returned HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Local service returned no readable response");
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "";
  try {
    while (true) {
      const next = await transportDeadline(reader.read(), signal, 10000);
      if (next.done) return result + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error("Local service response exceeded byte limit");
      result += decoder.decode(next.value, { stream: true });
    }
  } finally {
    await transportDeadline(reader.cancel(), new AbortController().signal, 500).catch(() => {});
    try { reader.releaseLock(); } catch { /* A timed-out native read can finish after cancellation. */ }
  }
}
