import { AudioWindowRecorder } from "../../entrypoints/stage1.js";
import type { AudioCounters } from "./types.js";
import { WitnessRecorder, type WitnessCounters } from "../../entrypoints/stage1-witnessed.js";
/** Independent wire-schema fixtures: tests consume the same bounded public collectors as tooling. */
export const AUDIO_FIELDS = ["frameStart", "frameEnd", "sampleRate", "blocks", "frames", "channelFrames", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "sumSquares", "peak", "clipSamples", "missingInputBlocks", "frameDiscontinuities", "quantumMin", "quantumMax", "sampleRateChanges", "zeroOutputNonzeroSamples"] as const;
export const WITNESS_FIELDS = ["frameStart", "frameEnd", "sampleRate", "blocks", "frames", "quantumMin", "quantumMax", "frameDiscontinuities", "sampleRateChanges", "nonfiniteOutputSamples", "nonzeroOutputSamples"] as const;
export function collectedAudioCounters(value: unknown): AudioCounters | null {
  const counters = value as Record<string, unknown> | null;
  const store = new AudioWindowRecorder();
  if (!store.acceptBatch(new Float64Array([0, 0, 0, ...AUDIO_FIELDS.map(key => Number(counters?.[key]))]))) return null;
  const first = store.snapshot().windows[0];
  return first ? Object.fromEntries(AUDIO_FIELDS.map(key => [key, first[key]])) as unknown as AudioCounters : null;
}
export function collectedWitnessCounters(value: unknown): WitnessCounters | null {
  const counters = value as Record<string, unknown> | null;
  const store = new WitnessRecorder();
  if (!store.acceptBatch(new Float64Array([0, ...WITNESS_FIELDS.map(key => Number(counters?.[key]))]))) return null;
  const first = store.snapshot().windows[0];
  return first ? Object.fromEntries(WITNESS_FIELDS.map(key => [key, first[key]])) as unknown as WitnessCounters : null;
}
