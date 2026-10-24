import { connectHttps, connectWss, transferHttpsAsset } from "./transport-probes-browser.js";
import { connectRtc } from "./transport-peer.js";
import { connectWebTransport } from "./transport-peer-webtransport.js";
import { freezeTransportOptions, TransportLedger, transportDeadline, type ActiveTransportProbe, type TransportConnection, type TransportProbeOptions } from "./transport-probes-state.js";
export type { ActiveTransportProbe, TransportProbeOptions, TransportEndpoints, TransportProtocol, TransportEvent, TransportState } from "./transport-probes-state.js";

/** A real local-server transport workload. Creation waits for an exact application echo, not just API presence. */
export async function startTransportProbe(input: TransportProbeOptions): Promise<ActiveTransportProbe> {
  const options = freezeTransportOptions(input);
  const ledger = new TransportLedger(options);
  const controller = new AbortController();
  const signal = controller.signal;
  let connection: TransportConnection | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  let statsTimer: ReturnType<typeof setInterval> | undefined;
  let statsPending = false;
  let stopPromise: Promise<void> | undefined;
  const tasks = new Set<Promise<unknown>>();
  const externalAbort = () => { controller.abort(); void stop(); };
  options.signal.addEventListener("abort", externalAbort, { once: true });
  if (options.signal.aborted) controller.abort();
  function track(task: Promise<unknown>): void {
    tasks.add(task); void task.finally(() => tasks.delete(task)).catch(() => {});
  }
  async function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      clearInterval(timer); clearTimeout(endTimer); clearInterval(statsTimer);
      options.signal.removeEventListener("abort", externalAbort);
      if (connection?.stats && !signal.aborted) await transportDeadline(connection.stats(), signal, 500).catch(() => {});
      if (ledger.state.status === "connected" || ledger.state.status === "connecting") ledger.state.status = "stopped";
      controller.abort();
      await connection?.close().catch(() => {});
      await transportDeadline(Promise.allSettled([...tasks]), new AbortController().signal, 1500).catch(() => {});
      ledger.finish(); ledger.event("stopped", `Application delivered ${ledger.counters.delivered}/${ledger.counters.accepted}; expired ${ledger.counters.expired}; pending discarded ${ledger.counters.dropped}`);
    })();
    return stopPromise;
  }
  function pump(): void {
    if (signal.aborted || ledger.state.status !== "connected") return;
    const next = ledger.next();
    if (!next || !connection) return;
    track(connection.send(next.frame).catch((error: unknown) => {
      ledger.sendFailed(next.seq);
      if (!signal.aborted) ledger.event("send-failed", error instanceof Error ? error.message : "Transport send failed");
    }));
  }
  function axes(): Readonly<Record<string, string | number | boolean | null>> {
    const endpoints = options.endpoints;
    const endpoint = options.protocol === "https" ? endpoints.echoUrl : options.protocol === "wss" ? endpoints.wssUrl : options.protocol.startsWith("webrtc") ? endpoints.rtcOfferUrl : endpoints.webTransportUrl;
    let host = "not-configured", path = "not-configured";
    try { if (endpoint) { const url = new URL(endpoint); host = url.hostname; path = url.pathname; } } catch { /* Invalid endpoints are reported as failed, never connected. */ }
    return Object.freeze({ protocol: options.protocol, level: options.level, durationMs: options.durationMs, maxMessages: options.maxMessages,
      maxBytes: options.maxBytes, maxInFlight: options.maxInFlight, ackDeadlineMs: options.ackDeadlineMs, payloadBytes: options.payloadBytes,
      assetDownloadBoundBytes: options.assetBytes, byteBudgetMeaning: "echo-frame-requests-plus-reserved-asset-download; excludes-wire-headers-and-echo-replies",
      acceptedMeaning: "admitted-application-work-before-send; delivered-requires-exact-echo", offeredMeaning: "scheduled-send-attempts-before-admission-caps",
      budgetCensored: ledger.counters.messageBudgetLimited > 0 || ledger.counters.byteBudgetLimited > 0,
      intervalMs: options.intervalMs, endpointHost: host, endpointPath: path, configuredTransportPath: endpoints.routeScope ?? "local-service-path-unverified",
      serverBuildHash: endpoints.serverBuildHash ?? "unavailable", serverRuntimeVersions: JSON.stringify(endpoints.runtimeVersions ?? {}),
      phaseId: options.phaseId ?? "unassigned", streamId: options.streamId ?? options.protocol,
      expiryMeaning: options.protocol === "webtransport-datagram" || options.protocol === "webrtc-unordered" ? "unreliable-app-echo-deadline-misses-not-proven-path-loss" : "reliable-app-echo-deadline-misses",
      rttMeaning: "browser-send-to-exact-application-echo", throughputMeaning: "whole-handle-send-window-including-verification-warmup-and-cleanup-drain; not-post-barrier-phase",
      terminalBalanceMeaning: "accepted=delivered+expired+dropped+pending; late-is-subset-of-expired-and-must-not-be-added",
      lateMeaning: "unique-expired-sequences-with-exact-late-echo; lateArrivalEvents-and-lateDuplicateEvents-are-nonterminal-event-counts",
      bufferedMeaning: options.protocol.startsWith("webrtc") ? "RTCDataChannel.bufferedAmount-bytes; not-delivery-or-WebSocket" : options.protocol === "wss" ? "WebSocket.bufferedAmount-bytes; not-delivery" : "no-WebSocket-buffer-observation",
      jitterMeaning: "absolute-delta-between-adjacent-application-RTTs", publicIceServers: false,
      acousticLatencyMeasured: false, oneWayLatencyMeasured: false, ...ledger.facts });
  }
  const active: ActiveTransportProbe = {
    get axes() { return axes(); },
    get state() { return Object.freeze({ ...ledger.state }); },
    get events() { return ledger.events.map((event) => ({ ...event })); },
    snapshotMetrics: () => ledger.snapshot(), stop,
  };
  try {
    if (signal.aborted) throw new DOMException("Transport stopped", "AbortError");
    const connect = options.protocol === "https" ? connectHttps : options.protocol === "wss" ? connectWss : options.protocol.startsWith("webrtc") ? connectRtc : connectWebTransport;
    connection = await connect(ledger, signal);
    if (signal.aborted) { await connection.close(); throw new DOMException("Transport stopped", "AbortError"); }
    ledger.state.status = "connected"; ledger.event("connected", "Local transport handshake complete; application echo still required"); ledger.beginLoad();
    pump(); timer = setInterval(pump, options.intervalMs);
    if (options.protocol === "https") track(transferHttpsAsset(ledger, signal).catch((error: unknown) => {
      if (!signal.aborted) ledger.event("asset-transfer-failed", error instanceof Error ? error.message : "HTTPS asset failed");
    }));
    if (connection.stats) statsTimer = setInterval(() => {
      if (statsPending || signal.aborted || !connection?.stats) return;
      statsPending = true;
      track(connection.stats().catch((error: unknown) => {
        if (!signal.aborted) ledger.event("stats-unavailable", error instanceof Error ? error.message : "RTC stats unavailable");
      }).finally(() => { statsPending = false; }));
    }, 500);
    const firstEchoBegan = performance.now();
    while (!ledger.state.worked) {
      if (signal.aborted) throw new DOMException("Transport stopped", "AbortError");
      if (active.state.status === "failed") throw new Error(ledger.state.reason ?? "Transport failed");
      if (performance.now() - firstEchoBegan > options.ackDeadlineMs + 1000) throw new Error("No valid application echo before startup deadline");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    // The caller gets a live load window after operational proof, for overlap with rendering/assets/audio.
    ledger.event("active-window-start", "Verified transport load is active alongside caller workloads");
    endTimer = setTimeout(() => { ledger.event("sending-finished", "Configured active duration reached"); void stop(); }, options.durationMs);
    return active;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Transport startup failed";
    ledger.state.status = signal.aborted ? "stopped" : /Unsupported:|not configured/.test(reason) ? "unsupported" : "failed";
    ledger.state.reason = reason;
    ledger.event(ledger.state.status, reason);
    await stop();
    return active;
  }
}
