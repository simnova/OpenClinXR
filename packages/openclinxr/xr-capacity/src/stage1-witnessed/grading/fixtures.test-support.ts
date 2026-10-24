import { recordFixture as priorScalarRecord, releaseFixture as priorScalarRelease } from "../../stage1/grading/fixtures.test-support.js";
import { WITNESSED_AUDIO_CONFIG, WITNESSED_AUDIO_MEMORY } from "../audio/config.js";
import type { WitnessCounters, WitnessRecord, WitnessedAudioRecord } from "../audio/types.js";
import { IMMUTABLE_TARGET_WORKLET_SHA256, WITNESSED_PROTOCOL_SHA256 } from "./run.js";
import type { WitnessedStage1Record, WitnessedStage1Release } from "./types.js";

/** Scalar-only test construction; no old record is relabeled or admitted by a runtime adapter. */
export function witnessedReleaseFixture(): WitnessedStage1Release {
  const prior = priorScalarRelease();
  return { schema: "quest-stage1-witnessed-release.v1", releaseId: "witnessed-new-scalar-release", identity: { ...prior.identity, bundleSha256: "d".repeat(64), protocolSha256: WITNESSED_PROTOCOL_SHA256 }, profile: prior.profile, emptyBaseline: prior.emptyBaseline, audioConfigSha256: "b".repeat(64), workletSha256: IMMUTABLE_TARGET_WORKLET_SHA256, witnessWorkletSha256: "f".repeat(64), effectiveAudio: prior.effectiveAudio, slots: prior.slots.map((s, i) => ({ ...s, nonce: `witnessed-scalar-slot-${i}-unique` })) };
}
function witnessCounter(start: number, end: number): WitnessCounters {
  return { frameStart: start, frameEnd: end, sampleRate: 48000, blocks: (end - start) / 128, frames: end - start, quantumMin: 128, quantumMax: 128, frameDiscontinuities: 0, sampleRateChanges: 0, nonfiniteOutputSamples: 0, nonzeroOutputSamples: 0 };
}
function witnessFixture(): WitnessRecord {
  const end = 3506048, windows: WitnessRecord["windows"] = [];
  for (let start = 0; start < end;) { const finish = Math.min(end, start + 24064), counter = witnessCounter(start, finish); windows.push({ ...counter, sequence: windows.length, partial: counter.frames < 24000 }); start = finish; }
  return { ...witnessCounter(0, end), windows, createdMs: 190, connectedMs: 200, targetConnectedMs: 240, finalReceivedMs: 74850,
    targetCreation: { input: { beforeMs: 230, afterMs: 231 }, output: { beforeMs: 232, afterMs: 233 } },
    firstEight: Array.from({ length: 8 }, (_, ordinal) => [ordinal, ordinal * 128, ordinal * 128 / 48000, 128]),
    primingReceivedMs: 225, receivedFrontierFrameStart: 896, creationBeforeMs: 229, creationAfterMs: 234, attachedSentMs: 241,
    attachSeen: { ordinal: 12, frame: 1536 }, gaps: [], finalReceived: true, firstWorkReceivedMs: 225, rejected: 0, overflow: 0, coalesced: 0, highWater: 1 };
}
export function witnessedRecordFixture(index = 1, release = witnessedReleaseFixture()): WitnessedStage1Record {
  const slot = release.slots[index]; if (!slot) throw new Error("Invalid scalar slot");
  const prior = priorScalarRecord(index), xr = prior.xr;
  xr.identity = { ...release.identity, nonce: slot.nonce }; xr.releaseId = release.releaseId;
  let audio: WitnessedAudioRecord | null = null;
  if (prior.audio) {
    const { schema: _oldSchema, config: _oldConfiguration, source, ...raw } = prior.audio;
    for (const side of ["input", "output"] as const) {
      const node = raw[side]; node.frameStart += 1024; node.frameEnd += 1024; node.firstWorkReceivedMs = 250;
      for (const row of node.windows) { row.frameStart += 1024; row.frameEnd += 1024; }
      for (const mark of raw.marks) { mark[side].frame += 1024; mark[side].counters.frameStart += 1024; mark[side].counters.frameEnd += 1024; }
      const ready = raw.preparation[side === "input" ? "inputReadyAck" : "outputReadyAck"];
      if (ready) { ready.frame += 1024; ready.counters.frameStart += 1024; ready.counters.frameEnd += 1024; }
    }
    raw.preparation.bootstrapDisconnectedMs = 238;
    raw.ownership.created.nodes = 6; raw.ownership.created.ports = 3;
    audio = { ...raw, schema: "quest-stage1-witnessed-audio.v1", config: structuredClone(WITNESSED_AUDIO_CONFIG),
      source: { ...source, runNonce: slot.nonce, workletSha256: release.workletSha256, expectedWorkletSha256: release.workletSha256, configSha256: release.audioConfigSha256, witnessWorkletUrl: "https://test.invalid/witness.js", witnessWorkletSha256: release.witnessWorkletSha256, expectedWitnessWorkletSha256: release.witnessWorkletSha256 },
      preparation: { ...raw.preparation, setupStartedMs: 150, setupDeadlineMs: 10150 }, witness: witnessFixture(),
      memory: { ...raw.memory, ownedTypedBytes: WITNESSED_AUDIO_MEMORY.ownedTypedBytes, maximumKnownPayloadBytes: WITNESSED_AUDIO_MEMORY.maximumKnownPayloadBytes, ledger: { ...WITNESSED_AUDIO_MEMORY } } };
  }
  return { schema: "quest-stage1-witnessed-record.v1", mode: slot.mode, slot: { pair: slot.pair, position: slot.position, nonce: slot.nonce }, pageTimeOriginMs: prior.pageTimeOriginMs, xr, audio, audioOwnership: structuredClone(audio?.ownership ?? prior.audioOwnership) };
}
