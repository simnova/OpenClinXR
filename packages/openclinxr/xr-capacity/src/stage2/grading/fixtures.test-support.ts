import { STAGE2_PROTOCOL_SHA256 } from "./config.js";
import { stage2TargetBinFrames } from "./contract.js";
import type { Stage2AudioPosition, Stage2ClockTag, Stage2DecodedConsumer, Stage2Health, Stage2HealthBin, Stage2Latch, Stage2MarkExchange, Stage2Mode, Stage2Phase, Stage2RunRecord, Stage2RunRelease, Stage2Source } from "./types.js";

export function emptyHealth(channels = 1): Stage2Health {
  return { frames: 0, channels, channelSamples: 0, finiteSamples: 0, nonfiniteSamples: 0, nonzeroSamples: 0, sumSquares: 0, peak: 0, clippedSamples: 0, missingFrames: 0, frameDiscontinuities: 0, sampleRateChanges: 0, channelChanges: 0 };
}
type History = Pick<Stage2Source, "clockId" | "initialQuantum" | "targetBinFrames" | "origin" | "final" | "total" | "bins">;
export function recount(h: History): void {
  const n = emptyHealth(h.total.channels);
  for (const b of h.bins) {
    for (const key of ["frames", "channelSamples", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "sumSquares", "clippedSamples", "missingFrames", "frameDiscontinuities", "sampleRateChanges", "channelChanges"] as const) n[key] += b[key];
    n.peak = Math.max(n.peak, b.peak);
  }
  h.total = n;
}
const tag = (kind: Stage2ClockTag["kind"], frame: number): Stage2ClockTag => ({ kind, value: 12800 + frame, timeBaseNumerator: 1, timeBaseDenominator: 48000 });
export const at = (h: History, frame: number): Stage2AudioPosition => ({ processedFrames: frame, sampleRate: 48000, channels: h.total.channels, tag: tag(h.origin?.tag.kind ?? "worklet-currentFrame", frame), atSourceMonotonicMs: null });
export function history(hz: 400 | 700, channels: number, quantum: number, kind: Stage2ClockTag["kind"], segments: ReadonlyArray<readonly [Stage2Phase, number]> = [["setup", 48000], ["warmup", 480000], ["qualified", 3360000], ["ended", quantum * 2]]): History & { clockId: string } {
  const bins: Stage2HealthBin[] = []; let frame = 0; const target = stage2TargetBinFrames(48000, quantum);
  for (const [phase, length] of segments) {
    let remaining = length;
    while (remaining > 0) {
      const frames = Math.min(target, remaining); const N = frames; const energy = frames * .0002;
      const tone = { analysisChannel: 0 as const, N, sumSquares: energy, real400: hz === 400 ? N * .01 : 0, imag400: 0, real700: hz === 700 ? N * .01 : 0, imag700: 0, power400: hz === 400 ? .0002 : 0, power700: hz === 700 ? .0002 : 0 };
      const b: Stage2HealthBin = { ...emptyHealth(channels), sequence: bins.length, phase, frameStart: frame, frameEnd: frame + frames, frames, channelSamples: frames * channels, finiteSamples: frames * channels, nonzeroSamples: frames * channels, sumSquares: energy * channels, peak: .02, sampleRate: 48000, quantumFirst: quantum, quantumLast: quantum, quantumMin: quantum, quantumMax: quantum, tagStart: tag(kind, frame), tagEndExclusive: tag(kind, frame + frames), partialReason: frames >= target ? null : phase === segments.at(-1)?.[0] ? "final-tail" : "phase-boundary", tone };
      bins.push(b); frame += frames; remaining -= frames;
    }
  }
  const h: History & { clockId: string } = { clockId: `${kind}-clock`, initialQuantum: quantum, targetBinFrames: target, origin: { processedFrames: 0, sampleRate: 48000, channels, tag: tag(kind, 0), atSourceMonotonicMs: null }, final: { processedFrames: frame, sampleRate: 48000, channels, tag: tag(kind, frame), atSourceMonotonicMs: null }, total: emptyHealth(channels), bins };
  recount(h); return h;
}
function source(id: string, browser: boolean): Stage2Source {
  return { id, kind: browser ? "browser-generated-worklet" : "server-independent-generator", trackId: `${id}-track`, senderTrackId: `${id}-track`, senderDrivenCalls: browser ? null : 4050, unboundCalls: browser ? null : 0, generatorErrors: 0, stopped: true, ...history(browser ? 400 : 700, 1, browser ? 128 : 960, browser ? "worklet-currentFrame" : "generated-pts") };
}
function decoded(id: Stage2DecodedConsumer["id"], sourceId: string): Stage2DecodedConsumer {
  const browser = id === "browser-downlink-monitor";
  return { id, sourceId, sampleRate: 48000, channels: 2, processorErrors: 0, rejected: 0, overflow: 0, firstDecodedAtLocalMs: browser ? 20 : 100020, firstNonzeroAtLocalMs: browser ? 30 : 100030, format: { name: "f32", layout: "stereo", planar: true, projection: "channel-0", allChannelsChecked: true }, rtp: { packets: 4000, bytes: 100000, packetsLost: 0, jitterSeconds: .001, concealedSamples: 0 }, ...history(browser ? 700 : 400, 2, browser ? 128 : 960, browser ? "worklet-currentFrame" : "decoded-pts") };
}
export function fixture(mode: Stage2Mode = "positive"): { record: Stage2RunRecord; release: Stage2RunRelease } {
  const identity = { browserBundleSha256: "a".repeat(64), serverSourceSha256: "b".repeat(64), protocolSha256: STAGE2_PROTOCOL_SHA256, fixtureConfigSha256: "c".repeat(64), graderSourceSha256: "d".repeat(64) };
  const binding = { runNonce: "fresh-nonce", peerTicket: "fresh-ticket", uplinkSourceId: "up", downlinkSourceId: "down" };
  const endpoint = (port: number) => ({ address: "192.168.1.249", port, protocol: "udp", candidateId: `candidate-${port}`, inventoryAddress: "192.168.1.249" });
  const record: Stage2RunRecord = {
    schema: "quest-stage2-host-run.v1", mode, identity, binding,
    environment: { browser: { executablePath: "/owned/chromium", version: "test-fixture", launchFlags: ["--mute-audio"], timeOriginMs: 100000000 }, driver: { processId: 1234, clockId: "node-clock", timeOriginMs: 99999000 }, runtime: { nodeVersion: "24", pythonVersion: "3.13", aiortcVersion: "1.15", avVersion: "17.1", aiohttpVersion: "3.14", serverProcessId: 1235, serverClockId: "python-clock" }, signalingOrigins: ["http://127.0.0.1:12345"], iceServers: [], localInterfaces: [{ name: "en0", address: "192.168.1.249", family: "IPv4" }] },
    lifecycle: { contextCreatedMs: 0, peerAllocatedServerMs: 100000, readyMs: 1000, warmupStartedMs: 1001, warmupEndedMs: 11001, contextClosedMs: 81100, peerClosedServerMs: 181050, driverStartedMs: 10000, driverEndedMs: 91150 },
    connection: { iceState: "connected", dtlsState: "connected", browserPair: { observer: "browser-getStats", id: "browser-pair", state: "succeeded", nominated: true, local: endpoint(20000), remote: endpoint(20001), observationSource: "actual-getStats" }, serverPair: { observer: "server-ice-transport", id: "server-pair", state: "succeeded", nominated: true, local: endpoint(20001), remote: endpoint(20000), observationSource: "actual-ice-transport" } },
    mappings: { uplink: null, downlink: null }, sources: { uplink: source("up", true), downlink: source("down", false) }, decoded: { uplink: decoded("server-uplink-decoded", "up"), downlink: decoded("browser-downlink-monitor", "down") }, marks: [], clientWindow: { startMs: 11005, terminalMs: 81005 },
    resources: { ownerReservations: { browser: { limitBytes: 655360, peakBytes: 600000, heldBytesAtClose: 100000, rejectedReservations: 0, closed: true, categoryPeaks: { typedHealth: 270336, payload: 300000, control: 100000 } }, python: { limitBytes: 327680, peakBytes: 300000, heldBytesAtClose: 90000, rejectedReservations: 0, closed: true, categoryPeaks: { numericHistory: 200000, temporaryResponse: 100000 } }, gateway: { limitBytes: 65536, peakBytes: 65536, heldBytesAtClose: 1000, rejectedReservations: 0, closed: true, categoryPeaks: { control: 40000, serialization: 30000 } } }, typedHealthBytes: 270336, knownPendingPayloadBytes: 500000, ownedControlBytes: 65536, capBytes: 1048576, healthRows: { uplink: 0, downlink: 0, uplinkSource: 0, downlinkSource: 0 }, maximumConcurrentControls: 1, maximumQueuedControlBytes: 1024, dropped: 0, rejected: 0, overflow: 0, rawPcmRetainedBytes: 0, totalHeapMeasured: false, ledger: [{ owner: "browser", description: "owned typed health", count: 33792, itemBytes: 8, kind: "typed-health" }, { owner: "browser", description: "known retained numeric JSON", count: 200000, itemBytes: 1, kind: "known-payload" }, { owner: "python", description: "known retained numeric JSON", count: 300000, itemBytes: 1, kind: "known-payload" }, { owner: "control", description: "bounded control reserve", count: 65536, itemBytes: 1, kind: "control" }] },
    events: [], negative: null, cleanup: { browserRemaining: { peers: 0, tracks: 0, generators: 0, nodes: 0, ports: 0, contexts: 0, listeners: 0, timers: 0, pendingCommands: 0 }, serverClose: { identity, binding, closed: true, serverClockId: "python-clock", atServerMs: 181050, activePeers: 0, closingPeers: 0, ownedTasks: 0, queuedControlBytes: 0, pendingControls: 0 }, closeSentMs: 81010, closeReceivedMs: 81060, browserDrained: true, driver: { ownedProcesses: 0, ownedListeners: 0, confirmed: true } }, outcome: "completed", reason: null, notEvidenceFor: ["Quest, LAN, physical audio, maximum capacity, microphone or clinical behavior"],
  };
  for (const side of ["uplink", "downlink"] as const) {
    const s = record.sources[side]; const down = side === "downlink";
    record.mappings[side] = { sourceId: s.id, sourceTrackId: s.trackId ?? "", senderTrackId: s.senderTrackId ?? "", senderMid: down ? "1" : "0", senderSsrc: down ? 700 : 400, receiverTrackId: `${side}-receiver`, receiverSdpTrackId: `${s.id}-track`, receiverMid: down ? "1" : "0", receiverSsrc: down ? 700 : 400, monitoredTrackId: down ? `${side}-receiver` : null, codec: { mimeType: "audio/opus", clockRate: 48000, channels: 2, payloadType: 111, sdpFmtpLine: "minptime=10" }, senderBindingObserved: true, receiverBindingObserved: true };
  }
  const histories = { uplinkDecoded: record.decoded.uplink, downlinkMonitor: record.decoded.downlink, uplinkSource: record.sources.uplink, downlinkSource: record.sources.downlink };
  for (const [command, frame, sent, received, phase] of [["ready", 48000, 990, 999, "setup"], ["warmup", 48000, 1000, 1001, "warmup"], ["start", 528000, 11001, 11004, "qualified"], ["end", 3888000, 81006, 81009, "ended"]] as const) {
    const markerId = `marker-${command}`;
    const l = (key: keyof typeof histories): Stage2Latch => ({ markerId, command, phase, position: at(histories[key], frame) });
    const m: Stage2MarkExchange = { markerId, command, server: { sentMs: sent, receivedMs: received, ack: { identity, binding, markerId, command, serverClockId: "python-clock", serverAtMs: 100000 + received, uplinkDecoded: l("uplinkDecoded"), downlinkSource: l("downlinkSource") } }, browser: { sentMs: sent, receivedMs: received, ack: { markerId, command, downlinkMonitor: l("downlinkMonitor"), uplinkSource: l("uplinkSource") } } };
    record.marks.push(m);
  }
  syncRows(record);
  return { record, release: { schema: "quest-stage2-host-release.v1", identity: structuredClone(identity), binding: structuredClone(binding), mode, expectedEnvironment: structuredClone(record.environment) } };
}
export function syncRows(r: Stage2RunRecord): void {
  r.resources.healthRows = { uplink: r.decoded.uplink.bins.length, downlink: r.decoded.downlink.bins.length, uplinkSource: r.sources.uplink.bins.length, downlinkSource: r.sources.downlink.bins.length };
}
export function silenceBin(b: Stage2HealthBin): void {
  b.nonzeroSamples = 0; b.sumSquares = 0; b.peak = 0;
  b.tone = { ...b.tone, sumSquares: 0, real400: 0, imag400: 0, real700: 0, imag700: 0, power400: 0, power700: 0 };
}
