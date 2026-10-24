import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { AudioWindowRecorder } from "../../entrypoints/stage1.js";
import { AUDIO_FIELDS, collectedAudioCounters } from "./worklet-wire.test-support.js";
const AUDIO_ROW_WIDTH = 3 + AUDIO_FIELDS.length;
import { DUPLEX_WORKLET_SOURCE } from "../../entrypoints/stage1.js";
interface Message { type: string; sequence?: number; counters?: unknown; rows?: Float64Array; frame?: number; [key: string]: unknown }
function fixture(mode = "input", autoAck = true) {
  const messages: Message[] = []; let ctor: (new (options: unknown) => { port: { onmessage: (event: { data: unknown }) => void }; process(input: Float32Array[][], output: Float32Array[][]): boolean }) | undefined;
  class Processor { port = { onmessage: (_event: { data: unknown }) => {}, postMessage: (data: Message) => { messages.push(structuredClone(data)); } }; }
  const realm = createContext({ AudioWorkletProcessor: Processor, Float32Array, Float64Array, sampleRate: 48000, currentFrame: 0, registerProcessor: (_name: string, c: typeof ctor) => { ctor = c; } });
  runInContext(DUPLEX_WORKLET_SOURCE, realm);
  const processor = new ctor!({ processorOptions: { mode } }); let frame = 0, acked = 0;
  const send = (data: unknown) => processor.port.onmessage({ data });
  const ack = () => { for (; acked < messages.length; acked++) { const m = messages[acked]!; if (m.type === "report") send({ type: "ack", sequence: m.sequence }); } };
  function step(n = 128, value = 0.001, offset = 0) {
    realm['currentFrame'] = frame + offset; const out = new Float32Array(n).fill(99); const source = new Float32Array(n).fill(value);
    const alive = processor.process([[source]], [[out]]); frame += n + offset; if (autoAck) ack(); return { out, alive };
  }
  const finish = () => { send({ type: "stop" }); step(); ack(); return messages; };
  return { messages, send, step, finish, ack, setRate: (rate: number) => { realm['sampleRate'] = rate; } };
}
describe("actual exported Worklet source", () => {
  it("retains sample-rate changes instead of assuming the requested rate", () => {
    const f = fixture(); f.step(); f.setRate(44100); f.step(); f.finish();
    const c = collectedAudioCounters(f.messages.find((m) => m.type === "final")!.counters)!;
    expect(c.sampleRate).toBe(48000); expect(c.sampleRateChanges).toBe(1);
  });

  it("never monitors microphone samples and supports actual variable quanta", () => {
    const f = fixture(); let frames = 0;
    for (let i = 0; i < 400; i++) { const n = [64, 192, 256, 128][i % 4]!; frames += n; expect(f.step(n).out.every((x) => x === 0)).toBe(true); }
    const messages = f.finish(); const final = messages.find((m) => m.type === "final")!; const counters = collectedAudioCounters(final.counters)!;
    expect(counters.frames).toBe(frames); expect(counters.quantumMin).toBe(64); expect(counters.quantumMax).toBe(256); expect(counters.zeroOutputNonzeroSamples).toBe(0);
    const recorder = new AudioWindowRecorder(); for (const m of messages) if (m.type === "report") expect(recorder.acceptBatch(m.rows)).toBe(true);
    expect(recorder.snapshot().windows.reduce((n, w) => n + w.frames, 0)).toBe(frames);
  });
  it("retains a full zero first sample bin as COMPLETE", () => {
    const f = fixture(); for (let i = 0; i < 20; i++) f.step(); f.send({ type: "mark", id: 1, phase: 2 });
    for (let i = 0; i < 188; i++) f.step(128, 0);
    f.finish(); const recorder = new AudioWindowRecorder(); for (const m of f.messages) if (m.type === "report") recorder.acceptBatch(m.rows);
    const window = recorder.snapshot().windows.find((w) => w.phase === "sample")!;
    expect(window.partial).toBe(false); expect(window.frames).toBeGreaterThanOrEqual(24000); expect(window.nonzeroSamples).toBe(0);
    const mark = f.messages.find((m) => m.type === "mark")!; expect(mark.frame).toBe(2560); expect(collectedAudioCounters(mark.counters)?.frameEnd).toBe(2560);
  });
  it("measures postgain output and retains nonfinite/clipping/gap evidence", () => {
    const f = fixture("output"); expect(f.step(128, 0.002).out[0]).toBeCloseTo(0.002);
    f.step(64, 1); f.step(192, Number.NaN, 128); f.finish();
    const c = collectedAudioCounters(f.messages.find((m) => m.type === "final")!.counters)!;
    expect(c.nonfiniteSamples).toBe(192); expect(c.clipSamples).toBe(64); expect(c.frameDiscontinuities).toBe(1); expect(c.finiteSamples + c.nonfiniteSamples).toBe(c.channelFrames);
  });
  it("bounds outstanding report count and drains all coalesced bins", () => {
    const f = fixture("input", false); for (let i = 0; i < 1500; i++) f.step();
    expect(f.messages.filter((m) => m.type === "report")).toHaveLength(1);
    f.send({ type: "stop" }); f.step(); f.ack();
    const recorder = new AudioWindowRecorder(); for (const m of f.messages) if (m.type === "report") expect(recorder.acceptBatch(m.rows)).toBe(true);
    expect(recorder.snapshot().windows.reduce((n, w) => n + w.frames, 0)).toBe(1500 * 128);
    const final = f.messages.find((m) => m.type === "final")!; expect(final['coalesced']).toBeGreaterThan(0); expect(final['highWater']).toBe(1);
  });
  it("fails visibly rather than overwriting bounded rows", () => {
    const f = fixture(); f.step();
    for (let i = 0; i < 515; i++) { f.send({ type: "mark", id: i, phase: 2 }); f.step(); }
    expect(f.messages.some((m) => m.type === "fault" && m['reason'] === "row-budget")).toBe(true);
  });
  it("rejects fractional counters, impossible sample accounting and nonfinite payloads", () => {
    const f = fixture(); f.step(); f.finish(); const c = collectedAudioCounters(f.messages.find((m) => m.type === "final")!.counters)!;
    expect(collectedAudioCounters({ ...c, blocks: 1.5 })).toBeNull(); expect(collectedAudioCounters({ ...c, channelFrames: c.channelFrames + 1 })).toBeNull();
    expect(collectedAudioCounters({ ...c, sumSquares: Number.NaN })).toBeNull(); expect(collectedAudioCounters({ ...c, nonzeroSamples: 0 })).toBeNull();
    const recorder = new AudioWindowRecorder(); expect(recorder.acceptBatch(new Float64Array(AUDIO_ROW_WIDTH + 1))).toBe(false);
  });
});
