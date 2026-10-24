/** A real AudioWorklet processor. Reports are windows of blocks, never per-frame latency samples. */
export const AUDIO_STRESS_PROCESSOR = "capacity-audio-stress-v2";
export const AUDIO_STRESS_WORKLET_SOURCE = `
class CapacityAudioStress extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options.processorOptions?.load;
    this.load = Number.isSafeInteger(requested) ? Math.max(0, Math.min(256, requested)) : 0;
    const frames = options.processorOptions?.maxFrames;
    this.maxFrames = Number.isSafeInteger(frames) ? Math.max(128, Math.min(sampleRate * 35, frames)) : sampleRate * 5;
    this.blocks = 0; this.frames = 0; this.windowBlocks = 0; this.windowFrames = 0;
    this.expectedFrame = null; this.discontinuities = 0; this.maxGapFrames = 0;
    this.minQuantum = 16384; this.maxQuantum = 0; this.energy = 0; this.alive = true;
    this.port.onmessage = (event) => { if (event.data?.type === "stop") this.alive = false; };
    this.port.postMessage({ type: "ready" });
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    if (this.frames >= this.maxFrames) { this.port.postMessage({ type: "budget-exhausted" }); return false; }
    const output = outputs[0]; const input = inputs[0];
    const quantum = output?.[0]?.length || 0;
    if (!quantum) return true;
    if (this.expectedFrame !== null && currentFrame !== this.expectedFrame) {
      this.discontinuities++; this.maxGapFrames = Math.max(this.maxGapFrames, Math.abs(currentFrame - this.expectedFrame));
    }
    this.expectedFrame = currentFrame + quantum;
    this.minQuantum = Math.min(this.minQuantum, quantum); this.maxQuantum = Math.max(this.maxQuantum, quantum);
    let energy = 0;
    for (let channel = 0; channel < output.length; channel++) {
      const out = output[channel]; const source = input?.[channel] || input?.[0];
      for (let frame = 0; frame < quantum; frame++) {
        const value = source?.[frame] || 0;
        let work = value + 0.125;
        for (let iteration = 0; iteration < this.load; iteration++) work = Math.sin(work * 1.00001 + iteration * 0.000001);
        // Retain a bounded observable term so the load cannot be optimized away.
        out[frame] = value * 0.999999 + work * 0.000001;
        energy += out[frame] * out[frame];
      }
    }
    this.blocks++; this.frames += quantum; this.windowBlocks++; this.windowFrames += quantum; this.energy += energy;
    if (this.windowBlocks === 32) {
      this.port.postMessage({ type: "window", blocks: this.blocks, frames: this.frames,
        windowBlocks: this.windowBlocks, windowFrames: this.windowFrames, sampleRate,
        renderFrame: currentFrame, renderTime: currentTime, discontinuities: this.discontinuities,
        maxGapFrames: this.maxGapFrames, minQuantum: this.minQuantum, maxQuantum: this.maxQuantum,
        energy: this.energy });
      this.windowBlocks = 0; this.windowFrames = 0; this.maxGapFrames = 0;
      this.minQuantum = 16384; this.maxQuantum = 0; this.energy = 0;
    }
    return true;
  }
}
registerProcessor("${AUDIO_STRESS_PROCESSOR}", CapacityAudioStress);
`;

export interface AudioWorkletWindow {
  type: "window";
  blocks: number;
  frames: number;
  windowBlocks: number;
  windowFrames: number;
  sampleRate: number;
  renderFrame: number;
  renderTime: number;
  discontinuities: number;
  maxGapFrames: number;
  minQuantum: number;
  maxQuantum: number;
  energy: number;
}

/** Messages cross a realm boundary; malformed, regressing, or incoherent counters are rejected. */
export function parseAudioWorkletWindow(value: unknown, previous?: AudioWorkletWindow): AudioWorkletWindow | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate['type'] !== "window") return null;
  const integerKeys = ["blocks", "frames", "windowBlocks", "windowFrames", "renderFrame", "discontinuities", "maxGapFrames", "minQuantum", "maxQuantum"];
  for (const key of integerKeys) if (!Number.isSafeInteger(candidate[key]) || Number(candidate[key]) < 0) return null;
  for (const key of ["sampleRate", "renderTime", "energy"]) if (typeof candidate[key] !== "number" || !Number.isFinite(candidate[key]) || Number(candidate[key]) < 0) return null;
  const report = candidate as unknown as AudioWorkletWindow;
  if (report.windowBlocks !== 32 || report.blocks < 32 || report.blocks > 12_000_000 || report.frames > 400_000_000) return null;
  if (report.sampleRate < 8000 || report.sampleRate > 384000 || report.minQuantum < 1 || report.maxQuantum > 16384 || report.minQuantum > report.maxQuantum) return null;
  if (report.windowFrames < report.windowBlocks * report.minQuantum || report.windowFrames > report.windowBlocks * report.maxQuantum || report.frames < report.windowFrames) return null;
  if (Math.abs(report.renderFrame / report.sampleRate - report.renderTime) > 1 / report.sampleRate) return null;
  if (report.discontinuities > report.blocks || report.energy > report.windowFrames * 2 * 4 || report.maxGapFrames > 400_000_000) return null;
  if (previous && (report.blocks - previous.blocks !== report.windowBlocks || report.frames - previous.frames !== report.windowFrames || report.discontinuities < previous.discontinuities || report.renderFrame <= previous.renderFrame || report.sampleRate !== previous.sampleRate)) return null;
  return { ...report };
}
