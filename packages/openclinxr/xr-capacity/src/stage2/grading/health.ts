import { STAGE2_CONFIG } from "./config.js";
import { assertStage2FrameUnits, stage2CoherentMeanSquare, stage2TargetBinFrames } from "./contract.js";
import type { Stage2AudioPosition, Stage2ClockTag, Stage2DecodedConsumer, Stage2Health, Stage2HealthBin, Stage2Source, Stage2Tone } from "./types.js";

export const isCount = (n: number) => Number.isSafeInteger(n) && n >= 0;
export const positive = (n: number) => Number.isFinite(n) && n > 0;
export const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
export const tagSeconds = (t: Stage2ClockTag) => t.value * t.timeBaseNumerator / t.timeBaseDenominator;
const validTag = (t: Stage2ClockTag) => ["worklet-currentFrame", "decoded-pts", "generated-pts"].includes(t.kind) && Number.isSafeInteger(t.value) && positive(t.timeBaseNumerator) && positive(t.timeBaseDenominator);
const sameTagBase = (a: Stage2ClockTag, b: Stage2ClockTag) => a.kind === b.kind && a.timeBaseNumerator === b.timeBaseNumerator && a.timeBaseDenominator === b.timeBaseDenominator;
export function samePosition(a: Stage2AudioPosition, b: Stage2AudioPosition): boolean {
  return a.processedFrames === b.processedFrames && a.sampleRate === b.sampleRate && a.channels === b.channels && sameTagBase(a.tag, b.tag) && a.tag.value === b.tag.value;
}
export function positionValid(p: Stage2AudioPosition): boolean {
  return isCount(p.processedFrames) && positive(p.sampleRate) && isCount(p.channels) && p.channels > 0 && validTag(p.tag) && (p.atSourceMonotonicMs === null || Number.isFinite(p.atSourceMonotonicMs));
}
export function toneMatches(t: Stage2Tone, hz: 400 | 700): boolean {
  if (!isCount(t.N) || t.N < 1 || !positive(t.sumSquares)) return false;
  const a = stage2CoherentMeanSquare(t.real400, t.imag400, t.N);
  const b = stage2CoherentMeanSquare(t.real700, t.imag700, t.N);
  const expected = hz === 400 ? a : b;
  const other = hz === 400 ? b : a;
  return close(t.power400, a) && close(t.power700, b) && expected >= .5 * t.sumSquares / t.N && expected >= 4 * other;
}
const additive = ["frames", "channelSamples", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "sumSquares", "clippedSamples", "missingFrames", "frameDiscontinuities", "sampleRateChanges", "channelChanges"] as const;
function healthValid(h: Stage2Health): boolean {
  const counts = additive.filter(k => k !== "sumSquares");
  return counts.every(k => isCount(h[k])) && isCount(h.channels) && h.channels > 0
    && h.channelSamples === h.frames * h.channels && h.finiteSamples + h.nonfiniteSamples === h.channelSamples
    && h.clippedSamples <= h.nonzeroSamples && h.nonzeroSamples <= h.finiteSamples
    && Number.isFinite(h.sumSquares) && h.sumSquares >= 0 && Number.isFinite(h.peak) && h.peak >= 0
    && (h.nonzeroSamples > 0 ? h.sumSquares > 0 && h.peak > 0 : h.sumSquares === 0 && h.peak === 0)
    && h.sumSquares <= h.finiteSamples * h.peak ** 2 + 1e-8 && h.peak ** 2 <= h.sumSquares + 1e-8
    && h.nonfiniteSamples === 0 && h.clippedSamples === 0 && h.peak < STAGE2_CONFIG.analysis.clippingThreshold
    && h.missingFrames === 0 && h.frameDiscontinuities === 0 && h.sampleRateChanges === 0 && h.channelChanges === 0;
}
type History = Pick<Stage2Source, "clockId" | "initialQuantum" | "targetBinFrames" | "origin" | "final" | "total" | "bins">;
export function gradeHistory(h: History, label: string, decodedHz: 400 | 700 | null): string[] {
  const errors: string[] = [];
  const fail = (condition: boolean, reason: string) => { if (!condition) errors.push(`${label}.${reason}`); };
  fail(Array.isArray(h.bins) && h.bins.length <= 512, "bounded-history");
  fail(healthValid(h.total), "total-health");
  if (!h.origin || !h.final || !h.clockId || h.initialQuantum === null || h.targetBinFrames === null) {
    fail(h.total.frames === 0 && h.bins.length === 0 && h.origin === null && h.final === null, "origin-final-missing");
    return errors;
  }
  const origin = h.origin; const final = h.final;
  fail(positionValid(origin) && positionValid(final), "position");
  fail(origin.processedFrames === 0 && final.processedFrames === h.total.frames, "first-callback-accounting");
  fail(origin.sampleRate === final.sampleRate && origin.channels === final.channels && origin.channels === h.total.channels, "rate-channels");
  fail(sameTagBase(origin.tag, final.tag) && close((tagSeconds(final.tag) - tagSeconds(origin.tag)) * origin.sampleRate, h.total.frames), "raw-tag-span");
  fail(h.targetBinFrames === stage2TargetBinFrames(origin.sampleRate, h.initialQuantum), "first-quantum-rounding");
  fail(h.total.frames / origin.sampleRate <= 150, "lifetime-frame-bound");
  let frontier = 0; let previousTag = origin.tag; let phaseOrdinal = 0;
  const phases = ["setup", "warmup", "qualified", "ended"];
  for (const [i, b] of h.bins.entries()) {
    fail(healthValid(b), `bin-${i}-health`);
    fail(b.sequence === i && b.frameStart === frontier && b.frameEnd === b.frameStart + b.frames && b.frames > 0, `bin-${i}-sequence`);
    fail(b.sampleRate === origin.sampleRate && b.channels === origin.channels, `bin-${i}-format`);
    fail(validTag(b.tagStart) && validTag(b.tagEndExclusive) && sameTagBase(b.tagStart, b.tagEndExclusive) && sameTagBase(previousTag, b.tagStart) && previousTag.value === b.tagStart.value, `bin-${i}-raw-tag`);
    fail(close((tagSeconds(b.tagEndExclusive) - tagSeconds(b.tagStart)) * b.sampleRate, b.frames), `bin-${i}-tag-frames`);
    fail([b.quantumFirst, b.quantumLast, b.quantumMin, b.quantumMax].every(q => isCount(q) && q > 0) && b.quantumMin <= b.quantumFirst && b.quantumFirst <= b.quantumMax && b.quantumMin <= b.quantumLast && b.quantumLast <= b.quantumMax, `bin-${i}-quantum`);
    if (i === 0) fail(b.quantumFirst === h.initialQuantum, "first-quantum");
    fail(b.frames / b.sampleRate <= 1, `bin-${i}-duration`);
    fail(phases.indexOf(b.phase) >= phaseOrdinal, `bin-${i}-phase-order`);
    phaseOrdinal = phases.indexOf(b.phase);
    const complete = b.frames >= h.targetBinFrames;
    fail(complete ? b.partialReason === null && b.frames - h.targetBinFrames < b.quantumLast : b.partialReason === "phase-boundary" || b.partialReason === "final-tail", `bin-${i}-partial-classification`);
    if (b.partialReason === "final-tail") fail(i === h.bins.length - 1, `bin-${i}-tail-position`);
    assertStage2FrameUnits(b.frames, b.channels, b.channelSamples, b.tone);
    fail([b.tone.sumSquares, b.tone.real400, b.tone.imag400, b.tone.real700, b.tone.imag700, b.tone.power400, b.tone.power700].every(Number.isFinite) && b.tone.sumSquares >= 0 && b.tone.power400 >= 0 && b.tone.power700 >= 0 && b.tone.sumSquares <= b.sumSquares + 1e-8, `bin-${i}-tone-accounting`);
    if (b.channels === 1) fail(close(b.tone.sumSquares, b.sumSquares), `bin-${i}-mono-energy`);
    fail(close(b.tone.power400, stage2CoherentMeanSquare(b.tone.real400, b.tone.imag400, b.tone.N)) && close(b.tone.power700, stage2CoherentMeanSquare(b.tone.real700, b.tone.imag700, b.tone.N)), `bin-${i}-tone-power`);
    if (b.phase === "qualified") {
      fail(b.nonzeroSamples > 0, `bin-${i}-qualified-zero`);
      if (complete && decodedHz !== null) fail(toneMatches(b.tone, decodedHz), `bin-${i}-decoded-${decodedHz}Hz`);
    }
    frontier = b.frameEnd; previousTag = b.tagEndExclusive;
  }
  fail(frontier === h.total.frames && previousTag.value === final.tag.value, "no-lost-tail");
  for (const k of additive) fail(close(h.bins.reduce((n, b) => n + b[k], 0), h.total[k]), `sum-${k}`);
  fail(close(Math.max(0, ...h.bins.map(b => b.peak)), h.total.peak), "peak-recount");
  return errors;
}
export function qualifiedRangeMatches(bins: Stage2HealthBin[], start: Stage2AudioPosition, end: Stage2AudioPosition): boolean {
  const selected = bins.filter(b => b.phase === "qualified");
  return selected.length > 0 && selected[0]?.frameStart === start.processedFrames && selected.at(-1)?.frameEnd === end.processedFrames;
}
export function decodedHealthy(d: Stage2DecodedConsumer): boolean {
  return d.total.frames > 0 && d.total.nonzeroSamples > 0 && d.firstDecodedAtLocalMs !== null && d.firstNonzeroAtLocalMs !== null && d.processorErrors === 0 && d.rejected === 0 && d.overflow === 0 && gradeHistory(d, "decoded", null).length === 0;
}
