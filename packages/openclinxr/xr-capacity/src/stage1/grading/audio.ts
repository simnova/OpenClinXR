import { DUPLEX_AUDIO_CONFIG } from "../audio/config.js";
import type { AudioCounters, AudioHealthWindow, AudioNodeRecord } from "../audio/types.js";
import type { Stage1Record, Stage1Release } from "./types.js";

const sums = ["blocks", "frames", "channelFrames", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "sumSquares", "clipSamples", "missingInputBlocks", "frameDiscontinuities", "sampleRateChanges", "zeroOutputNonzeroSamples"] as const;
const integers = ["frameStart", "frameEnd", "blocks", "frames", "channelFrames", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "clipSamples", "missingInputBlocks", "frameDiscontinuities", "quantumMin", "quantumMax", "sampleRateChanges", "zeroOutputNonzeroSamples"] as const;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0;
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** IDs remain in raw evidence; only volatile identity tokens are excluded from configuration equality. */
export function normalizeAudioSettings(settings: MediaTrackSettings): MediaTrackSettings {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !["deviceId", "groupId"].includes(key)));
}
function countersValid(c: AudioCounters, rate: number) {
  return integers.every(k => nonnegative(c[k])) && c.frames > 0 && c.blocks > 0 && Number.isFinite(rate) && rate > 0 && c.sampleRate === rate &&
    c.frameEnd - c.frameStart === c.frames && c.channelFrames === c.frames &&
    c.finiteSamples + c.nonfiniteSamples === c.channelFrames && c.nonzeroSamples <= c.finiteSamples &&
    c.clipSamples <= c.nonzeroSamples && c.missingInputBlocks <= c.blocks &&
    c.quantumMin > 0 && c.quantumMax >= c.quantumMin && c.quantumMax <= 16384 &&
    c.blocks * c.quantumMin <= c.frames && c.frames <= c.blocks * c.quantumMax &&
    Number.isFinite(c.peak) && c.peak >= 0 && Number.isFinite(c.sumSquares) && c.sumSquares >= 0 &&
    c.sumSquares <= c.nonzeroSamples * c.peak ** 2 + 1e-8 * Math.max(1, c.sumSquares) &&
    (c.peak >= .98) === (c.clipSamples > 0) &&
    (c.nonzeroSamples === 0 ? c.peak === 0 && c.sumSquares === 0 : c.peak > 0 && c.sumSquares > 0);
}
function totalsAgree(total: AudioCounters, rows: AudioHealthWindow[]) {
  return rows.length > 0 && rows[0]!.frameStart === total.frameStart && rows.at(-1)!.frameEnd === total.frameEnd &&
    sums.every(k => close(rows.reduce((sum, row) => sum + row[k], 0), total[k])) &&
    total.peak === Math.max(...rows.map(r => r.peak)) &&
    total.quantumMin === Math.min(...rows.map(r => r.quantumMin)) && total.quantumMax === Math.max(...rows.map(r => r.quantumMax));
}
function phaseRows(node: AudioNodeRecord, phase: string) { return node.windows.filter(w => w.phase === phase); }
function latchRowsAgree(node: AudioNodeRecord, phase: string, start: AudioCounters, end: AudioCounters) {
  const rows = phaseRows(node, phase);
  return rows.length > 0 && rows[0]!.frameStart === start.frameEnd && rows.at(-1)!.frameEnd === end.frameEnd &&
    sums.every(k => close(rows.reduce((sum, row) => sum + row[k], 0), end[k] - start[k]));
}

export function gradeStage1Audio(record: Stage1Record, release: Stage1Release) {
  const invalid: string[] = [], failures: string[] = [];
  const require = (ok: boolean, why: string) => { if (!ok) invalid.push(why); };
  const functional = (ok: boolean, why: string) => { if (!ok) failures.push(why); };
  const ownership = record.audioOwnership;
  require(Object.values(ownership.remaining).every(n => n === 0), "audio-owned-resources-remain");
  require(Object.values(ownership.created).every(nonnegative), "audio-created-accounting-invalid");
  if (record.mode === "off") {
    require(record.audio === null && ownership.factoryInvoked === false && Object.values(ownership.created).every(n => n === 0), "off-created-or-reused-audio");
    return { valid: invalid.length === 0, functionalPass: true, reasons: invalid, invalid, failures, inputMarkedDurationMs: null, outputMarkedDurationMs: null, scope: "not-applicable" as const };
  }
  const a = record.audio;
  if (!a) return { valid: false, functionalPass: false, reasons: ["duplex-audio-missing"], invalid: ["duplex-audio-missing"], failures, inputMarkedDurationMs: null, outputMarkedDurationMs: null, scope: "missing" as const };
  require(ownership.factoryInvoked === true && stable(ownership) === stable(a.ownership), "audio-ownership-mismatch");
  require(stable(ownership.created) === stable({ tracks: 1, contexts: 1, nodes: 5, ports: 2, oscillators: 1 }), "audio-created-graph-not-released-shape");
  require(a.schema === "quest-stage1-duplex-audio.v1" && a.source.runtime === "actual-browser-webaudio" && a.source.input === "actual-microphone" && a.source.output === "generated-sine", "audio-source-not-actual-microphone");
  require(a.source.runNonce === record.xr.identity.nonce && a.source.timeOriginMs === record.pageTimeOriginMs, "audio-run-or-clock-origin-mismatch");
  require(a.source.workletSha256 === release.workletSha256 && a.source.expectedWorkletSha256 === release.workletSha256 && a.source.configSha256 === release.audioConfigSha256 && stable(a.config) === stable(DUPLEX_AUDIO_CONFIG), "audio-source-or-request-config-mismatch");
  require(a.actual.sampleRate === release.effectiveAudio.sampleRate && a.actual.trackSettings !== null && stable(normalizeAudioSettings(a.actual.trackSettings)) === stable(normalizeAudioSettings(release.effectiveAudio.trackSettings)), "audio-effective-config-mismatch");
  require(a.source.physicalOutputVerified === false && a.latency.physicalRttMs === null && a.memory.totalHeapMeasured === false && a.memory.rawPcmRetainedBytes === 0, "audio-physical-or-memory-claim-invalid");
  require(a.windowScope === "prepared-audio-through-post-XR-stop; broader-than-XR-window", "audio-clock-scope-mislabeled");
  const p = a.preparation;
  require(p.captureGrantedMs !== null && p.contextRunningMs !== null && p.captureGrantedMs >= p.startedMs && p.contextRunningMs >= p.captureGrantedMs && p.captureGrantedMs - p.startedMs <= 30000 && p.contextRunningMs - p.startedMs <= 30000 && p.graphActivatedMs !== null && p.graphActivatedMs >= p.contextRunningMs, "audio-permission-or-resume-clock-deadline");
  require(p.bootstrapStartedMs !== null && p.bootstrapDisconnectedMs !== null && p.bootstrapStartedMs >= p.startedMs && p.bootstrapStartedMs <= (p.captureGrantedMs ?? -Infinity) && p.bootstrapDisconnectedMs >= (p.contextRunningMs ?? Infinity) && p.bootstrapDisconnectedMs <= (p.graphActivatedMs ?? -Infinity), "audio-bootstrap-source-sequence-invalid");
  require(p.graphActivatedMs !== null && p.readyMs !== null && p.startedMs <= p.graphActivatedMs && p.readyMs >= p.graphActivatedMs && p.readyMs - p.graphActivatedMs <= 10000 && record.xr.requestedAt !== null && p.readyMs <= record.xr.requestedAt && record.xr.admittedAt !== null && record.xr.admittedAt - p.readyMs <= 30000, "audio-preparation-not-before-XR-or-deadline");
  const timing = a.timing;
  require(timing.contextCreatedMs === p.startedMs && timing.stopRequestedMs !== null && timing.stoppedMs !== null && record.xr.endedAt !== null && timing.stopRequestedMs >= record.xr.endedAt && timing.stoppedMs >= timing.stopRequestedMs && timing.stoppedMs - timing.stopRequestedMs <= 5000 && timing.stoppedMs - timing.contextCreatedMs <= 180000 && p.graphActivatedMs !== null && timing.stoppedMs - p.graphActivatedMs <= 150000, "audio-continuity-envelope-or-lifetime-invalid");
  functional(a.actual.trackLive === true && a.actual.trackEnabled === true && a.actual.trackMuted === false && a.actual.contextState === "running", "audio-pre-stop-state-not-live");
  require(a.actual.observationMeaning === "latest-pre-stop-state" && a.actual.observedAtMs !== null && a.actual.observedAtMs >= (timing.stopRequestedMs ?? Infinity) && a.actual.observedAtMs <= (timing.stoppedMs ?? -Infinity), "audio-pre-stop-state-observation-stale");
  require(!/fake|synthetic/i.test(a.actual.trackLabel ?? ""), "audio-track-label-known-synthetic");
  functional(a.processorErrors === 0, "audio-processor-errors-observed");
  require(a.outcome === "stopped" && a.cleanup.stopAckReceived && a.cleanup.tracksStopped && a.cleanup.portsClosed && a.cleanup.nodesDisconnected && a.cleanup.contextClosed && a.cleanup.urlsRevoked && Object.values(a.cleanup.remaining).every(n => n === 0), "audio-final-drain-or-cleanup-failed");
  require(nonnegative(a.queue.highWater) && a.queue.highWater <= 1 && nonnegative(a.queue.coalesced) && a.queue.dropped === 0 && a.queue.rejected === 0 && a.queue.storageOverflow === 0 && nonnegative(a.queue.maximumPayloadBytes) && a.queue.maximumPayloadBytes <= 524288, "audio-queue-bound-or-lost-evidence");
  require(nonnegative(a.memory.ownedTypedBytes) && a.memory.ownedTypedBytes <= a.memory.capBytes && a.memory.capBytes <= 524288 && nonnegative(a.memory.maximumKnownPayloadBytes) && a.queue.maximumPayloadBytes <= a.memory.maximumKnownPayloadBytes && a.memory.ownedTypedBytes + a.memory.maximumKnownPayloadBytes <= a.memory.capBytes, "audio-storage-bound-invalid");
  require([a.latency.baseLatencySeconds, a.latency.outputLatencySeconds].every(v => v === null || Number.isFinite(v) && v >= 0), "audio-API-latency-estimate-invalid");
  require(a.latency.outputTimestamps.every(t => t.atMs >= p.startedMs && t.afterMs >= t.atMs && t.afterMs <= timing.stoppedMs! && t.currentTime >= 0 && (t.afterMs < (record.xr.sampleStart ?? Infinity) || t.atMs > (record.xr.sampleEnd ?? -Infinity))), "audio-supporting-timestamp-inside-sample-or-clock-invalid");
  const labels = ["warmup-start", "sample-start", "sample-end"];
  require(a.marks.length === 3 && a.marks.every((m, i) => m.label === labels[i]), "audio-required-latches-missing-or-reordered");
  for (const [i, m] of a.marks.entries()) {
    const expected = [record.xr.warmupStart, record.xr.sampleStart, record.xr.sampleEnd][i];
    require(m.xrReceiptMs === expected && m.sentMs >= m.xrReceiptMs && m.sentMs >= (p.readyMs ?? Infinity) && m.receivedMs >= m.sentMs && m.receivedMs <= (timing.stopRequestedMs ?? -Infinity) && m.receivedMs - m.sentMs <= 1000 && (i === 0 || m.sentMs >= a.marks[i - 1]!.sentMs), "audio-mark-causal-or-ACK-deadline");
  }
  const durations: Array<number | null> = [];
  for (const side of ["input", "output"] as const) {
    const node = a[side], rate = a.actual.sampleRate ?? NaN, ready = p[side === "input" ? "inputReadyAck" : "outputReadyAck"];
    require(node.finalReceived && node.firstWorkReceivedMs !== null && p.readyMs !== null && node.firstWorkReceivedMs >= p.graphActivatedMs! && node.firstWorkReceivedMs <= p.readyMs && !!ready && ready.frame === ready.counters.frameEnd && countersValid(ready.counters, rate) && ready.counters.nonzeroSamples > 0 && ready.counters.nonfiniteSamples === 0 && ready.frame >= node.frameStart, `${side}-first-work-or-ready-evidence`);
    require(node.frames <= rate * 150, `${side}-frame-lifetime-bound`);
    require(countersValid(node, rate) && totalsAgree(node, node.windows), `${side}-total-frame-or-channel-accounting`);
    const phaseOrder = ["prepared", "warmup", "sample", "ended"];
    for (const [i, w] of node.windows.entries()) {
      const rows = phaseRows(node, w.phase);
      require(w.sequence === i && countersValid(w, rate) && phaseOrder.includes(w.phase) && (i === 0 || w.frameStart === node.windows[i - 1]!.frameEnd && phaseOrder.indexOf(w.phase) >= phaseOrder.indexOf(node.windows[i - 1]!.phase)) && w.frames <= rate * .5 + w.quantumMax && (w.partial ? w.frames < rate * .5 && (w === rows[0] || w === rows.at(-1)) : w.frames >= rate * .5), `${side}-bin-accounting-or-partial-bound`);
      functional(w.nonfiniteSamples === 0 && w.clipSamples === 0 && w.frameDiscontinuities === 0 && w.sampleRateChanges === 0 && w.missingInputBlocks === 0 && (side === "output" || w.zeroOutputNonzeroSamples === 0), `${side}-bin-numeric-clipping-or-software-continuity`);
      if (!w.partial && ready && w.frameStart >= ready.frame && ["warmup", "sample"].includes(w.phase)) functional(w.nonzeroSamples > 0, `${side}-complete-bin-no-observed-activity`);
      if (side === "output") functional(w.peak <= a.config.speakerPeak + 1e-7, "output-exceeds-released-digital-stimulus");
    }
    functional(node.nonfiniteSamples === 0 && node.clipSamples === 0 && node.frameDiscontinuities === 0 && node.sampleRateChanges === 0 && node.missingInputBlocks === 0 && node.nonzeroSamples > 0 && (side === "output" || node.zeroOutputNonzeroSamples === 0), `${side}-total-numeric-or-software-continuity`);
    const latches = a.marks.map(m => m[side]);
    require(latches.every((l, i) => countersValid(l.counters, rate) && l.frame === l.counters.frameEnd && l.counters.frameStart === node.frameStart && l.frame >= (i ? latches[i - 1]!.frame : ready?.frame ?? Infinity) && l.frame <= node.frameEnd), `${side}-latch-frame-or-cumulative-accounting`);
    const start = latches[1], end = latches[2], warm = latches[0];
    require(!!warm && !!start && !!end && latchRowsAgree(node, "warmup", warm.counters, start.counters) && latchRowsAgree(node, "sample", start.counters, end.counters), `${side}-phase-latch-bin-recount`);
    require(phaseRows(node, "sample").some(w => !w.partial), `${side}-no-complete-sample-health-bin`);
    const duration = start && end && rate > 0 ? (end.frame - start.frame) / rate * 1000 : null;
    require(duration !== null && record.xr.sampleEnd !== null && record.xr.sampleStart !== null && Math.abs(duration - (record.xr.sampleEnd - record.xr.sampleStart)) <= 1000, `${side}-marked-phase-duration-mismatch`);
    durations.push(duration);
  }
  require(a.events.every((e, i) => e.atMs >= p.startedMs && e.atMs <= timing.stoppedMs! && (i === 0 || e.atMs >= a.events[i - 1]!.atMs)), "audio-event-clock-order-invalid");
  functional(!a.events.some(e => e.atMs >= (p.readyMs ?? Infinity) && e.atMs < (timing.stopRequestedMs ?? -Infinity) && (/fault|error|track-mute|track-ended|overflow|rate-change/.test(e.type) || e.type === "context-state" && e.detail !== "running")), "audio-state-or-processor-event-failure");
  return { valid: invalid.length === 0, functionalPass: failures.length === 0, reasons: [...invalid, ...failures], invalid, failures, inputMarkedDurationMs: durations[0] ?? null, outputMarkedDurationMs: durations[1] ?? null, scope: a.windowScope };
}
