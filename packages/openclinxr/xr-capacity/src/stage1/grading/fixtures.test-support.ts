import { DUPLEX_AUDIO_CONFIG } from "../audio/config.js";
import type { AudioCounters, AudioHealthWindow, AudioNodeRecord, DuplexAudioRecord } from "../audio/types.js";
import { createRecord } from "../../stage0/record.js";
import type { Stage0Frame, Stage0Profile, Stage0Record } from "../../stage0/types.js";
import type { Stage1Record, Stage1Release } from "./types.js";

const hash = "a".repeat(64);
const profile: Stage0Profile = { selectedTargetHz: 90, targetSelection: "target-update-accepted", rawSessionFrameRate: 0, actualSessionFrameRate: null, supportedFrameRates: [72, 90], layerKind: "XRProjectionLayer", layerWidth: 3360, layerHeight: 1760, viewports: [[0, 0, 1680, 1760], [1680, 0, 1680, 1760]], foveationRequested: 1, foveationReadback: 1, framebufferScaleRequested: 1, contextAttributes: { antialias: true }, configuredSamples: 4, boundFramebufferSamples: 4, enabledFeatures: ["local-floor", "viewer"], availabilityMask: ["actualSessionFrameRate"] };
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function releaseFixture(): Stage1Release {
  return { schema: "quest-stage1-release.v1", releaseId: "prospective-test-release", identity: { bundleSha256: hash, protocolSha256: hash, sceneManifestSha256: hash }, profile: structuredClone(profile), emptyBaseline: { geometries: 0, textures: 0, programs: 0 }, audioConfigSha256: "b".repeat(64), workletSha256: "c".repeat(64), effectiveAudio: { sampleRate: 48000, trackSettings: { sampleRate: 48000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }, slots: ["off", "duplex", "duplex", "off", "off", "duplex"].map((mode, i) => ({ pair: Math.floor(i / 2) + 1, position: i % 2 + 1, mode, nonce: `test-only-slot-${i}-unique-nonce` })) as Stage1Release["slots"] };
}
function xrFixture(nonce: string, release: Stage1Release): Stage0Record {
  const r = createRecord({ ...release.identity, nonce, protocol: {}, foveationRequested: 1, rendererVersion: "0.184.0", sourceFiles: {} }, "cohort").record;
  Object.assign(r, { releaseId: release.releaseId, status: "completed", phase: "completed", profile: structuredClone(profile), requestedAt: 1990, admittedAt: 2000, watchdogDeadline: 92000, warmupStart: 3000, sampleStart: 13000, sampleEnd: 73000, endedAt: 74700 });
  const row = (receipt: number, phase: number): Stage0Frame => ({ receipt, xrTimestamp: receipt + 5, phase, updateMs: .1, submissionMs: .2, collectorMs: .1, observedBodyMs: .5, poseValid: true, viewCount: 2, presenting: true, visible: true, contextLost: false, renderCalls: phase === 0 || phase === 3 ? 0 : 16, triangles: phase === 0 || phase === 3 ? 0 : 92, programs: phase === 0 || phase === 3 ? 0 : 1, geometries: phase === 0 || phase === 3 ? 0 : 3, textures: 0, stateFrame: 0, head: [0, 1.6, 0, 0, 0, 0, 1], viewMatrices: [...matrix, ...matrix, ...matrix, ...matrix] });
  r.frames = [...Array.from({ length: 60 }, (_, i) => row(2010 + i * 1000 / 90, 0)), row(3000, 1), ...Array.from({ length: 5401 }, (_, i) => row(13000 + i * 1000 / 90, 2)), ...Array.from({ length: 60 }, (_, i) => row(74000 + i * 1000 / 90, 3))]; r.frames.forEach((f, i) => { f.stateFrame = i + 1; }); r.storage.retainedFrames = r.frames.length;
  r.resources = { emptyBefore: { ...release.emptyBaseline }, roomWarm: { geometries: 3, textures: 0, programs: 1 }, emptyAfter: { ...release.emptyBaseline }, ownerBefore: 8, ownerAfter: 0 };
  const proof = { at: 73500, source: "active-XR-resolved-render-target-untimed", xrTimestamp: 73500, viewport: [0, 0, 1680, 1760], nonBackgroundPixels: 5000, testedPixels: 57600, image: "data:image/png;base64,fixture", reason: null };
  r.proofs = { preview: { ...proof, at: 2999 }, afterSample: proof }; r.cleanup = { sessionEnded: true, rendererDisposed: true, workloadListeners: 0, workloadTimers: 0, controlListeners: 0, controlTimers: 0, animationCallbacks: 0, queries: 0, layerStable: true, roomResourcesDisposed: true }; return r;
}
function counter(start: number, end: number, peak: number): AudioCounters {
  const frames = end - start;
  return { frameStart: start, frameEnd: end, sampleRate: 48000, blocks: frames / 128, frames, channelFrames: frames, finiteSamples: frames, nonfiniteSamples: 0, nonzeroSamples: frames, sumSquares: frames * peak ** 2, peak, clipSamples: 0, missingInputBlocks: 0, frameDiscontinuities: 0, quantumMin: 128, quantumMax: 128, sampleRateChanges: 0, zeroOutputNonzeroSamples: 0 };
}
function audioNode(peak: number): AudioNodeRecord {
  const windows: AudioHealthWindow[] = [];
  const phases = [{ phase: "prepared", end: 48000 }, { phase: "warmup", end: 528000 }, { phase: "sample", end: 3408000 }, { phase: "ended", end: 3504000 }] as const;
  let start = 0;
  for (const { phase, end } of phases) while (start < end) {
    const finish = Math.min(end, start + 24064), row = counter(start, finish, peak);
    windows.push({ ...row, sequence: windows.length, phase, partial: row.frames < 24000 }); start = finish;
  }
  return { ...counter(0, 3504000, peak), windows, finalReceived: true, firstWorkReceivedMs: 210 };
}
export function audioFixture(nonce: string, release: Stage1Release): DuplexAudioRecord {
  const zero = { tracks: 0, contexts: 0, nodes: 0, ports: 0, oscillators: 0 }, created = { tracks: 1, contexts: 1, nodes: 5, ports: 2, oscillators: 1 };
  const latch = (frame: number, peak: number) => ({ frame, counters: counter(0, frame, peak) });
  return { schema: "quest-stage1-duplex-audio.v1", source: { runtime: "actual-browser-webaudio", input: "actual-microphone", output: "generated-sine", physicalOutputVerified: false, runNonce: nonce, timeOriginMs: 1234567890000, workletUrl: "https://test.invalid/duplex-worklet.js", workletSha256: release.workletSha256, expectedWorkletSha256: release.workletSha256, configSha256: release.audioConfigSha256 }, config: { ...DUPLEX_AUDIO_CONFIG }, ownership: { factoryInvoked: true, created, remaining: { ...zero } }, actual: { sampleRate: 48000, observedAtMs: 74801, observationMeaning: "latest-pre-stop-state", trackSettings: { ...release.effectiveAudio.trackSettings }, trackConstraints: { sampleRate: 48000 }, trackLabel: "Fixture scalar evidence only", trackLive: true, trackEnabled: true, trackMuted: false, contextState: "running" }, preparation: { startedMs: 100, captureGrantedMs: 150, contextRunningMs: 160, bootstrapStartedMs: 120, bootstrapDisconnectedMs: 180, graphActivatedMs: 200, readyMs: 900, inputReadyAck: latch(128, .01), outputReadyAck: latch(128, .002) }, timing: { contextCreatedMs: 100, stopRequestedMs: 74800, stoppedMs: 74900 }, processorErrors: 0, marks: [3000, 13000, 73000].map((xrReceiptMs, i) => ({ label: ["warmup-start", "sample-start", "sample-end"][i]!, xrReceiptMs, sentMs: xrReceiptMs + 1, receivedMs: xrReceiptMs + 10, input: latch([48000, 528000, 3408000][i]!, .01), output: latch([48000, 528000, 3408000][i]!, .002) })) as DuplexAudioRecord["marks"], input: audioNode(.01), output: audioNode(.002), queue: { highWater: 1, coalesced: 0, dropped: 0, rejected: 0, storageOverflow: 0, maximumPayloadBytes: 5632 }, events: [{ atMs: 900, type: "media-ready", detail: "scalar fixture; no hardware evidence" }, { atMs: 74800, type: "stop-requested", detail: "XR closed" }, { atMs: 74900, type: "stopped", detail: "stopped" }], latency: { baseLatencySeconds: null, outputLatencySeconds: null, physicalRttMs: null, outputTimestamps: [] }, memory: { ownedTypedBytes: 360448, capBytes: 524288, maximumKnownPayloadBytes: 5632, rawPcmRetainedBytes: 0, totalHeapMeasured: false }, cleanup: { stopAckReceived: true, tracksStopped: true, portsClosed: true, nodesDisconnected: true, contextClosed: true, urlsRevoked: true, remaining: { tracks: 0, ports: 0, nodes: 0, contexts: 0, listeners: 0, timers: 0, pendingMarks: 0 } }, outcome: "stopped", reason: "XR closed", windowScope: "prepared-audio-through-post-XR-stop; broader-than-XR-window" };
}
export function recordFixture(index = 1, release = releaseFixture()): Stage1Record {
  const slot = release.slots[index]!, xr = xrFixture(slot.nonce, release), audio = slot.mode === "duplex" ? audioFixture(slot.nonce, release) : null;
  return { schema: "quest-stage1-record.v1", mode: slot.mode, slot: { pair: slot.pair, position: slot.position, nonce: slot.nonce }, pageTimeOriginMs: 1234567890000, xr, audio, audioOwnership: audio ? structuredClone(audio.ownership) : { factoryInvoked: false, created: { tracks: 0, contexts: 0, nodes: 0, ports: 0, oscillators: 0 }, remaining: { tracks: 0, contexts: 0, nodes: 0, ports: 0, oscillators: 0 } } };
}
