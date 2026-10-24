import { makeMetric } from "../index.js";
import type { CapacityMetric, MetricSample } from "../types.js";
import type { AudioWorkletWindow } from "./audio-worklet.js";

export const AUDIO_RING_LIMIT = 256;
export interface AudioStressEvent { at: number; type: string; detail: string }
const workletSource = { tool: "AudioWorkletProcessor.currentFrame-window", version: "2", processId: "browser-page" };
const mainSource = { tool: "audio-worklet-main-thread-delivery", version: "2", processId: "browser-page" };

export class AudioStressMetrics {
  readonly events: AudioStressEvent[] = [];
  eventDropped = 0;
  previous?: AudioWorkletWindow;
  private receivedAt: number | undefined;
  private samples = new Map<string, MetricSample[]>();
  private dropped = new Map<string, number>();
  private stateChanges = 0;
  private interruptions = 0;
  private rejectedMessages = 0;
  private workletErrors = 0;
  private stampBefore: number | undefined;
  private stampAfter: number | undefined;
  constructor(private readonly context: AudioContext) {}
  event(type: string, detail: string): void {
    if (this.events.length === 128) { this.events.shift(); this.eventDropped++; }
    this.events.push({ at: performance.now(), type, detail });
  }
  sample(id: string, value: number, at = performance.now()): void {
    if (!Number.isFinite(value)) return;
    const ring = this.samples.get(id) ?? [];
    if (ring.length === AUDIO_RING_LIMIT) { ring.shift(); this.dropped.set(id, (this.dropped.get(id) ?? 0) + 1); }
    ring.push({ at, value, valid: true }); this.samples.set(id, ring);
  }
  contextState(worked: boolean): void {
    this.stateChanges++;
    if (worked && String(this.context.state) !== "running" && String(this.context.state) !== "closed") this.interruptions++;
    this.event("context-state", String(this.context.state));
  }
  rejected(): void { this.rejectedMessages++; }
  processorError(): void { this.workletErrors++; this.event("processor-error", "AudioWorklet processor failed"); }
  received(report: AudioWorkletWindow): void {
    const at = performance.now();
    if (this.receivedAt !== undefined) this.sample("audio.main-thread-report-gap", at - this.receivedAt, at);
    this.receivedAt = at; this.previous = report;
    this.sample("audio.worklet.processed-blocks", report.blocks, at);
    this.sample("audio.worklet.processed-frames", report.frames, at);
    this.sample("audio.worklet.render-frame", report.renderFrame, at);
    this.event("processing-window", JSON.stringify({ blocks: report.blocks, frames: report.frames, windowBlocks: report.windowBlocks, windowFrames: report.windowFrames, renderFrame: report.renderFrame, renderTime: report.renderTime, sampleRate: report.sampleRate, receivedAt: at }));
    this.sample("audio.render-clock-gap.max-window", report.maxGapFrames / report.sampleRate * 1000, at);
    this.sample("audio.render-window-duration", report.windowFrames / report.sampleRate * 1000, at);
    this.sample("audio.render-quantum.min-window", report.minQuantum, at);
    this.sample("audio.render-quantum.max-window", report.maxQuantum, at);
    this.sample("audio.worklet-nonzero-windows", report.energy > 0 ? 1 : 0, at);
  }
  outputStamp(position: "before" | "after"): void {
    const stamp = this.context.getOutputTimestamp?.();
    if (!stamp || typeof stamp.contextTime !== "number" || typeof stamp.performanceTime !== "number" || !Number.isFinite(stamp.contextTime) || !Number.isFinite(stamp.performanceTime) || stamp.performanceTime <= 0) return;
    const audioAge = (this.context.currentTime - stamp.contextTime) * 1000;
    if (audioAge < 0 || !Number.isFinite(audioAge)) return;
    if (position === "before") this.stampBefore = audioAge; else this.stampAfter = audioAge;
  }
  snapshot(): CapacityMetric[] {
    const at = performance.now(); const windowMs = this.previous ? this.previous.windowFrames / this.previous.sampleRate * 1000 : null;
    const metrics: CapacityMetric[] = [];
    const make = (id: string, semantic: CapacityMetric["semantic"], unit: CapacityMetric["unit"], samples: MetricSample[], extra: Partial<CapacityMetric> = {}) => makeMetric({ id, semantic, unit, samples, source: workletSource, clockDomain: "browser-monotonic", granularity: "event", droppedSamples: this.dropped.get(id) ?? 0, ...extra });
    for (const [id, samples] of this.samples) {
      const gap = id.includes("main-thread"); const quantum = id.includes("quantum") || id.includes("nonzero-windows") || id.includes("processed-") || id.endsWith("render-frame");
      metrics.push(make(id, gap ? "callback-gap" : quantum ? "counter" : "audio-software", quantum ? "count" : "ms", samples, {
        source: gap ? mainSource : workletSource, granularity: gap ? "event" : "aggregate-window", windowMs: gap ? null : windowMs,
      }));
    }
    const count = (id: string, value: number) => metrics.push(make(id, "counter", "count", [{ at, value, valid: true }]));
    count("audio.render-clock-discontinuities", this.previous?.discontinuities ?? 0);
    count("audio.context-state-changes", this.stateChanges); count("audio.context-interruptions", this.interruptions);
    count("audio.worklet-rejected-messages", this.rejectedMessages); count("audio.worklet-errors", this.workletErrors);
    count("audio.events-dropped", this.eventDropped);
    const latency = (id: string, value: number | undefined) => {
      if (value !== undefined && Number.isFinite(value) && value >= 0) metrics.push(make(id, "audio-software", "ms", [{ at, value, valid: true }], { kind: "proxy", source: { tool: "AudioContext-latency-and-outputTimestamp", version: "2", processId: "browser-page" } }));
    };
    latency("audio.base-latency-estimate", this.context.baseLatency * 1000);
    latency("audio.output-latency-estimate", this.context.outputLatency * 1000);
    latency("audio.output-position-software-age.before", this.stampBefore); latency("audio.output-position-software-age.after", this.stampAfter);
    for (const [id, semantic, reason] of [
      ["audio.hardware-underruns", "counter", "Browser render-frame continuity cannot establish audible or hardware output underruns."],
      ["audio.acoustic-round-trip", "audio-acoustic", "No external acoustic timing rig; generated PCM and software timestamps do not measure physical latency."],
      ["audio.output-device-latency", "audio-acoustic", "Output route and physical playback latency require device and acoustic evidence."],
    ] as const) metrics.push(make(id, semantic, semantic === "counter" ? "count" : "ms", [], { kind: "unavailable", unavailableReason: reason }));
    return metrics;
  }
}
