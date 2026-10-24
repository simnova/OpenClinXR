import type { AudioCounters, AudioHealthWindow, AudioNodeRecord, AudioPhase } from "./types.js";
export const COUNTER_KEYS = ["frameStart", "frameEnd", "sampleRate", "blocks", "frames", "channelFrames", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "sumSquares", "peak", "clipSamples", "missingInputBlocks", "frameDiscontinuities", "quantumMin", "quantumMax", "sampleRateChanges", "zeroOutputNonzeroSamples"] as const;
export const AUDIO_ROW_WIDTH = COUNTER_KEYS.length + 3;
export const AUDIO_PHASES: AudioPhase[] = ["prepared", "warmup", "sample", "ended"];
export function emptyAudioCounters(): AudioCounters {
  return { frameStart: 0, frameEnd: 0, sampleRate: 0, blocks: 0, frames: 0, channelFrames: 0, finiteSamples: 0, nonfiniteSamples: 0,
    nonzeroSamples: 0, sumSquares: 0, peak: 0, clipSamples: 0, missingInputBlocks: 0, frameDiscontinuities: 0, quantumMin: 0, quantumMax: 0, sampleRateChanges: 0, zeroOutputNonzeroSamples: 0 };
}
export function readAudioCounters(value: unknown): AudioCounters | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of COUNTER_KEYS) if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || Number(row[key]) < 0) return null;
  const c = row as unknown as AudioCounters;
  for (const key of COUNTER_KEYS) if (!["sampleRate", "sumSquares", "peak"].includes(key) && !Number.isSafeInteger(c[key])) return null;
  if (c.finiteSamples + c.nonfiniteSamples !== c.channelFrames || c.nonzeroSamples > c.finiteSamples || c.frameEnd < c.frameStart) return null;
  if (!c.frameDiscontinuities && c.frameEnd - c.frameStart !== c.frames) return null;
  if (!c.missingInputBlocks && c.channelFrames !== c.frames) return null;
  if ((c.nonzeroSamples === 0 && (c.peak !== 0 || c.sumSquares !== 0)) || (c.nonzeroSamples > 0 && (c.peak <= 0 || c.sumSquares <= 0))) return null;
  if (c.clipSamples > c.finiteSamples || c.sumSquares > c.peak * c.peak * c.finiteSamples * (1 + 1e-10)) return null;
  if (c.sampleRate < 8000 || c.sampleRate > 384000 || c.quantumMin < 1 || c.quantumMax < c.quantumMin || c.quantumMax > 16384) return null;
  return { ...c };
}
/** Scalar-only typed storage: no microphone sample buffer is allocated or accepted. */
export class AudioWindowRecorder {
  readonly storage = new Float64Array(512 * AUDIO_ROW_WIDTH);
  rows = 0; overflow = 0; rejected = 0;
  counters = emptyAudioCounters(); finalReceived = false; firstWorkReceivedMs: number | null = null;
  acceptBatch(value: unknown): boolean {
    if (!(value instanceof Float64Array) || value.length % AUDIO_ROW_WIDTH || value.length > AUDIO_ROW_WIDTH * 16) { this.rejected++; return false; }
    const count = value.length / AUDIO_ROW_WIDTH;
    if (this.rows + count > 512) { this.overflow++; return false; }
    for (let i = 0; i < count; i++) {
      const at = i * AUDIO_ROW_WIDTH; const sequence = Number(value[at]);
      if (sequence !== this.rows + i || !Number.isInteger(value[at + 1]) || !AUDIO_PHASES[Number(value[at + 1])] || ![0, 1].includes(Number(value[at + 2]))) { this.rejected++; return false; }
      const obj = Object.fromEntries(COUNTER_KEYS.map((key, j) => [key, value[at + 3 + j]]));
      const parsed = readAudioCounters(obj);
      if (!parsed) { this.rejected++; return false; }
      const previousEnd = this.rows + i ? (i ? value[at - AUDIO_ROW_WIDTH + 4] : this.storage[(this.rows - 1) * AUDIO_ROW_WIDTH + 4]) : undefined;
      if (previousEnd !== undefined && Number(value[at + 3]) !== previousEnd && parsed.frameDiscontinuities === 0) { this.rejected++; return false; }
    }
    this.storage.set(value, this.rows * AUDIO_ROW_WIDTH); this.rows += count; return true;
  }
  snapshot(): AudioNodeRecord {
    const windows: AudioHealthWindow[] = [];
    for (let i = 0; i < this.rows; i++) {
      const at = i * AUDIO_ROW_WIDTH;
      const counters = Object.fromEntries(COUNTER_KEYS.map((key, j) => [key, this.storage[at + 3 + j]])) as unknown as AudioCounters;
      const phase = AUDIO_PHASES[Number(this.storage[at + 1])];
      if (!phase) throw new Error("Corrupt internal audio phase");
      windows.push({ ...counters, sequence: Number(this.storage[at]), phase, partial: this.storage[at + 2] === 1 });
    }
    return { ...this.counters, windows, finalReceived: this.finalReceived, firstWorkReceivedMs: this.firstWorkReceivedMs };
  }
}
