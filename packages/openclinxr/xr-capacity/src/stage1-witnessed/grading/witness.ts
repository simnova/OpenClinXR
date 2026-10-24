import { AUDIO_ROW_WIDTH } from "../../stage1/audio/recorder.js";
import { WITNESSED_AUDIO_MEMORY } from "../audio/config.js";
import type { WitnessCounters, WitnessedAudioRecord } from "../audio/types.js";
import type { WitnessedStage1Release } from "./types.js";
import { safeCount, stable } from "./shared.js";

const counts = ["frameStart", "frameEnd", "blocks", "frames", "quantumMin", "quantumMax", "frameDiscontinuities", "sampleRateChanges", "nonfiniteOutputSamples", "nonzeroOutputSamples"] as const;
const additive = ["blocks", "frames", "frameDiscontinuities", "sampleRateChanges", "nonfiniteOutputSamples", "nonzeroOutputSamples"] as const;
function accounting(c: WitnessCounters, rate: number) {
  return counts.every(k => safeCount(c[k])) && c.sampleRate === rate && Number.isFinite(rate) && rate > 0 &&
    c.blocks > 0 && c.frames > 0 && c.frameEnd - c.frameStart === c.frames &&
    c.quantumMin > 0 && c.quantumMax >= c.quantumMin && c.quantumMax <= 16384 &&
    c.blocks * c.quantumMin <= c.frames && c.frames <= c.blocks * c.quantumMax &&
    c.nonfiniteOutputSamples <= c.frames && c.nonzeroOutputSamples <= c.frames;
}

/** Recount known scalar/typed ownership for all three processors; this is not total memory. */
export function gradeWitnessedMemory(a: WitnessedAudioRecord) {
  const ledger = a.memory.ledger, invalid: string[] = [];
  const require = (ok: boolean, why: string) => { if (!ok) invalid.push(why); };
  require(Object.values(ledger).every(safeCount) && stable(ledger) === stable(WITNESSED_AUDIO_MEMORY), "witness-memory-ledger-not-declared-shape");
  require(ledger["targetRows"] === 512 && ledger["targetWidth"] === AUDIO_ROW_WIDTH && ledger["targetMainAndWorkletStores"] === 4 && ledger["sourceByteBudget"] === 65536 && ledger["witnessRows"] === 512 && ledger["witnessWidth"] === 12 && ledger["witnessMainAndWorkletStores"] === 2, "witness-memory-dimensions-invalid");
  const targetBytes = 4 * 512 * AUDIO_ROW_WIDTH * 8 + 65536;
  const witnessBytes = 2 * 512 * 12 * 8 + 8 * 4 * 8 + 8 * 4 * 8;
  const payloadBytes = 2 * 16 * AUDIO_ROW_WIDTH * 8 + 16 * 12 * 8 + 8 * 4 * 8 + 8 * 4 * 8;
  const ownedBytes = targetBytes + witnessBytes, knownBytes = ownedBytes + payloadBytes;
  require(ledger["targetTypedBytes"] === targetBytes && ledger["witnessTypedBytes"] === witnessBytes && ledger["witnessFirstEightBytes"] === 256 && ledger["witnessGapStorageBytes"] === 256 && ledger["targetPendingPayloadBytes"] === 2 * 16 * AUDIO_ROW_WIDTH * 8 && ledger["witnessPendingPayloadBytes"] === 16 * 12 * 8 && ledger["witnessPrimingPayloadBytes"] === 256 && ledger["witnessFinalGapPayloadBytes"] === 256, "witness-memory-component-recount");
  require(ledger["ownedTypedBytes"] === ownedBytes && ledger["maximumKnownPayloadBytes"] === payloadBytes && ledger["countedKnownBytes"] === knownBytes && ledger["capBytes"] === 524288 && a.memory.ownedTypedBytes === ownedBytes && a.memory.maximumKnownPayloadBytes === payloadBytes && a.memory.capBytes === 524288 && knownBytes <= 524288, "witness-memory-total-recount-or-cap");
  return { valid: invalid.length === 0, invalid, targetBytes, witnessBytes, ownedBytes, payloadBytes, knownBytes, capBytes: 524288, interpretation: "Declared owned typed/scalar storage and simultaneous known payloads only; JavaScript/native/browser/GPU memory is unknown." };
}

export function gradeWitness(a: WitnessedAudioRecord, release: WitnessedStage1Release) {
  const invalid: string[] = [], failures: string[] = [];
  const require = (ok: boolean, why: string) => { if (!ok) invalid.push(why); };
  const functional = (ok: boolean, why: string) => { if (!ok) failures.push(why); };
  const w = a.witness, rate = a.actual.sampleRate ?? NaN, p = a.preparation, timing = a.timing;
  const memory = gradeWitnessedMemory(a); invalid.push(...memory.invalid);
  require(a.source.witnessWorkletSha256 === release.witnessWorkletSha256 && a.source.expectedWitnessWorkletSha256 === release.witnessWorkletSha256, "witness-source-identity-mismatch");
  require(accounting(w, rate) && w.frames <= rate * 150, "witness-total-accounting-or-lifetime");
  require(w.finalReceived && w.finalReceivedMs !== null && w.finalReceivedMs >= (timing.stopRequestedMs ?? Infinity) && w.finalReceivedMs <= (timing.stoppedMs ?? -Infinity), "witness-final-drain-receipt-missing-or-stale");
  require(w.createdMs !== null && w.connectedMs !== null && w.createdMs >= (p.contextRunningMs ?? Infinity) && w.connectedMs >= w.createdMs && p.graphActivatedMs === w.connectedMs && w.firstWorkReceivedMs !== null && w.firstWorkReceivedMs >= w.connectedMs, "witness-activation-clock-invalid-or-reset");
  require(w.primingReceivedMs !== null && w.createdMs !== null && w.firstWorkReceivedMs !== null && w.primingReceivedMs >= w.firstWorkReceivedMs && w.primingReceivedMs - w.createdMs <= 1000 && w.primingReceivedMs >= w.createdMs && w.primingReceivedMs <= (w.creationBeforeMs ?? -Infinity), "witness-eight-callback-prime-deadline-or-order");
  require(w.creationBeforeMs !== null && w.creationAfterMs !== null && w.creationAfterMs >= w.creationBeforeMs && w.targetConnectedMs !== null && w.targetConnectedMs >= w.creationAfterMs && w.attachedSentMs !== null && w.attachedSentMs >= w.targetConnectedMs && w.attachedSentMs <= (p.readyMs ?? -Infinity), "witness-target-construction-brackets-invalid");
  for (const side of ["input", "output"] as const) {
    const creation = w.targetCreation[side];
    require(!!creation && creation.beforeMs >= (w.primingReceivedMs ?? Infinity) && creation.beforeMs >= (w.creationBeforeMs ?? Infinity) && creation.afterMs >= creation.beforeMs && creation.afterMs <= (w.creationAfterMs ?? -Infinity), `${side}-constructor-not-after-witness-prime`);
  }
  require(!!w.targetCreation.input && !!w.targetCreation.output && w.targetCreation.output.beforeMs >= w.targetCreation.input.afterMs, "witness-both-target-constructor-order");
  require(w.firstEight.length === 8, "witness-first-eight-missing");
  for (const [i, row] of w.firstEight.entries()) {
    const ordinal = row[0] ?? NaN, frame = row[1] ?? NaN, currentTime = row[2] ?? NaN, quantum = row[3] ?? NaN;
    const previous = w.firstEight[i - 1];
    require(row.length === 4 && ordinal === i && safeCount(frame) && safeCount(quantum) && quantum > 0 && quantum >= w.quantumMin && quantum <= w.quantumMax && Number.isFinite(currentTime) && Math.abs(currentTime - frame / rate) <= 1e-8 && (i === 0 ? frame === w.frameStart : frame === (previous?.[1] ?? NaN) + (previous?.[3] ?? NaN)), "witness-first-eight-frame-or-clock-accounting");
  }
  const last = w.firstEight.at(-1), frontier = last?.[1] ?? NaN, frontierEnd = frontier + (last?.[3] ?? NaN);
  require(w.receivedFrontierFrameStart === frontier && w.firstEight.length === 8 && frontierEnd <= w.frameEnd && a.input.frameStart >= frontier && a.output.frameStart >= frontier, "witness-frontier-not-before-both-targets");
  const attach = w.attachSeen;
  require(!!attach && safeCount(attach.ordinal) && attach.ordinal >= 8 && attach.ordinal < w.blocks && safeCount(attach.frame) && attach.frame >= frontier && attach.frame < w.frameEnd && attach.frame - w.frameStart >= attach.ordinal * w.quantumMin && attach.frame - w.frameStart <= attach.ordinal * w.quantumMax, "witness-postattach-latch-missing-or-outside-span");
  require(w.frameEnd >= Math.max(a.input.frameEnd, a.output.frameEnd) && w.frameStart < Math.min(a.input.frameStart, a.output.frameStart), "witness-does-not-cover-both-target-lifetimes");
  require(w.windows.length > 0 && w.windows[0]?.frameStart === w.frameStart && w.windows.at(-1)?.frameEnd === w.frameEnd && additive.every(k => w.windows.reduce((sum, row) => sum + row[k], 0) === w[k]) && Math.min(...w.windows.map(row => row.quantumMin)) === w.quantumMin && Math.max(...w.windows.map(row => row.quantumMax)) === w.quantumMax, "witness-bin-total-or-tail-recount");
  for (const [i, row] of w.windows.entries()) {
    require(accounting(row, rate) && row.sequence === i && row.frames <= rate * .5 + row.quantumMax && (row.partial ? i === w.windows.length - 1 && row.frames < rate * .5 : row.frames >= rate * .5) && (i === 0 || row.frameStart === w.windows[i - 1]?.frameEnd), "witness-bin-accounting-or-partial-waiver");
    functional(row.frameDiscontinuities === 0 && row.sampleRateChanges === 0 && row.nonfiniteOutputSamples === 0 && row.nonzeroOutputSamples === 0, "witness-bin-software-continuity-or-zero-output");
  }
  require(w.gaps.length === Math.min(w.frameDiscontinuities, 8) && w.gaps.every((gap, i) => safeCount(gap.expected) && safeCount(gap.actual) && gap.actual !== gap.expected && safeCount(gap.quantum) && gap.quantum > 0 && safeCount(gap.ordinal) && gap.ordinal <= w.blocks && (i === 0 || gap.ordinal > (w.gaps[i - 1]?.ordinal ?? Infinity))), "witness-gap-event-accounting");
  require(w.rejected === 0 && w.overflow === 0 && safeCount(w.coalesced) && safeCount(w.highWater) && w.highWater <= 1, "witness-queue-or-storage-loss");
  functional(w.frameDiscontinuities === 0 && w.sampleRateChanges === 0 && w.nonfiniteOutputSamples === 0 && w.nonzeroOutputSamples === 0 && w.gaps.length === 0, "witness-whole-lifetime-software-continuity-or-zero-output");
  return { valid: invalid.length === 0, functionalPass: failures.length === 0, invalid, failures, memory, frontierFrameStart: Number.isFinite(frontier) ? frontier : null, frontierEndFrame: Number.isFinite(frontierEnd) ? frontierEnd : null, interpretation: "First eight observed witness callbacks precede both target constructors. Postattach latch is retained with final drain; exact target attachment ordinal and physical output timing remain unknown." };
}
