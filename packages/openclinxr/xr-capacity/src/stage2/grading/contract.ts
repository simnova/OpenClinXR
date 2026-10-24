import { STAGE2_CONFIG } from "./config.js";
import type { Stage2Tone } from "./types.js";

const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
/** Fixed first-quantum rounding; later bins do not silently reset the chosen target. */
export function stage2TargetBinFrames(observedRate: number, initialActualQuantum: number): number {
  if (!Number.isFinite(observedRate) || observedRate <= 0 || !count(initialActualQuantum) || initialActualQuantum < 1) throw new Error("Invalid observed audio rate/quantum");
  const frames = Math.ceil(observedRate * STAGE2_CONFIG.bins.targetMs / 1000 / initialActualQuantum) * initialActualQuantum;
  if (!count(frames) || frames < 1 || frames / observedRate * 1000 > STAGE2_CONFIG.bins.maximumMs) throw new Error("Unsupported actual quantum: cannot meet maximum health-bin duration");
  return frames;
}
/** Structural unit contract only; GROUP A exports no run verdict or functional grader. */
export function assertStage2FrameUnits(frames: number, channels: number, channelSamples: number, tone: Pick<Stage2Tone, "analysisChannel" | "N">): void {
  if (!count(frames) || !count(channels) || channels < 1 || !count(channelSamples) || channelSamples !== frames * channels || tone.analysisChannel !== 0 || tone.N !== frames) throw new Error("Audio frame/channel-sample/tone-N mismatch");
}
/** Recipe formula, not an observed DSP result or a classifier decision. */
export function stage2CoherentMeanSquare(realSum: number, imagSum: number, N: number): number {
  if (!Number.isFinite(realSum) || !Number.isFinite(imagSum) || !count(N) || N < 1) throw new Error("Invalid coherent-energy aggregate");
  const power = 2 * (realSum ** 2 + imagSum ** 2) / (N * N);
  if (!Number.isFinite(power)) throw new Error("Nonfinite coherent-energy result");
  return power;
}
