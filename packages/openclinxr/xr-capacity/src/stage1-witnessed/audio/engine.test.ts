import { createHash } from "node:crypto";
import { WITNESS_WORKLET_SOURCE } from "../../entrypoints/stage1-witnessed.js";
import { DUPLEX_WORKLET_SOURCE } from "../../entrypoints/stage1.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WitnessedAudioPreparationError } from "../../entrypoints/stage1-witnessed.js";
import { prepareWitnessedDuplexAudio } from "../../entrypoints/stage1-witnessed.js";
class FakeNode { connect = vi.fn(); disconnect = vi.fn(); }
const fakeParam = () => ({ value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
class Context extends EventTarget {
  destination = new FakeNode();
  createGain = () => Object.assign(new FakeNode(), { gain: fakeParam() });
  createOscillator = () => Object.assign(new FakeNode(), { frequency: { value: 440 }, type: "sine", start: vi.fn(), stop: vi.fn() });
  state = "running"; sampleRate = 48000; currentTime = 0; baseLatency = 0.004; outputLatency = 0.024;
  resume = vi.fn(async () => {}); close = vi.fn(async () => { this.state = "closed"; });
}
function setup(resumeHangs = false, constructed?: () => void) {
  let grant: ((stream: MediaStream) => void) | undefined; const contexts: Context[] = [];
  class FakeContext extends Context { constructor() { super(); contexts.push(this); constructed?.(); if (resumeHangs) this.resume = vi.fn(() => new Promise<void>(() => {})); } }
  const media = new Promise<MediaStream>((resolve) => { grant = resolve; });
  vi.stubGlobal("isSecureContext", true); vi.stubGlobal("AudioContext", FakeContext); vi.stubGlobal("AudioWorkletNode", class {});
  vi.stubGlobal("navigator", { userActivation: { isActive: true }, mediaDevices: { getUserMedia: vi.fn(() => media) } });
  const doc = new EventTarget(); Object.assign(doc, { visibilityState: "visible" }); vi.stubGlobal("document", doc);
  const controller = new AbortController(); const onFault = vi.fn(); const pending = prepareWitnessedDuplexAudio({ signal: controller.signal, onFault, runNonce: "test-late-grant", workletUrl: "https://local.test/worklet.js", witnessWorkletUrl:"https://local.test/witness-worklet.js",expectedWitnessWorkletSha256:createHash("sha256").update(WITNESS_WORKLET_SOURCE).digest("hex"), expectedWorkletSha256: createHash("sha256").update(DUPLEX_WORKLET_SOURCE).digest("hex") });
  const result = pending.catch((error: unknown) => error as WitnessedAudioPreparationError);
  const track = Object.assign(new EventTarget(), { getSettings: () => ({ sampleRate: 48000, channelCount: 1 }), getConstraints: () => ({}), readyState: "live", enabled: true, muted: false, label: "microphone", stop: vi.fn(function (this: { readyState: string }) { this.readyState = "ended"; }) });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  return { controller, result, grant: () => grant!(stream), contexts, track, onFault };
}

function graphSetup(moduleHangs = false) {
  const s = setup(); let completeModule: (() => void) | undefined;
  class Node { port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() }; connect = vi.fn(); disconnect = vi.fn(); onprocessorerror = null; }
  const param = () => ({ value: 0.002, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  Object.assign(s.contexts[0]!, {
    destination: new Node(), audioWorklet: { addModule: vi.fn(() => moduleHangs ? new Promise<void>((resolve) => { completeModule = resolve; }) : Promise.resolve()) },
    suspend: async () => { s.contexts[0]!.state = "suspended"; }, resume: async () => { s.contexts[0]!.state = "running"; },
    createMediaStreamSource: () => new Node(), createGain: () => Object.assign(new Node(), { gain: param() }),
    createOscillator: () => Object.assign(new Node(), { frequency: { value: 440 }, start: vi.fn(), stop: vi.fn() }),
  });
  vi.stubGlobal("AudioWorkletNode", Node); vi.stubGlobal("location", new URL("https://local.test/"));
  vi.stubGlobal("fetch", vi.fn(async (url:URL) => new Response(url.pathname.includes("witness")?WITNESS_WORKLET_SOURCE:DUPLEX_WORKLET_SOURCE)));
  vi.stubGlobal("crypto", { subtle: { digest: async (_algorithm: string, bytes: ArrayBuffer) => Uint8Array.from(createHash("sha256").update(new Uint8Array(bytes)).digest()).buffer } });
  s.grant(); return { ...s, resolveModule: () => completeModule?.() };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("duplex preparation cancellation", () => {
  it("includes context construction time in the permission deadline", async () => {
    vi.useFakeTimers(); let clock = 0; vi.spyOn(performance, "now").mockImplementation(() => clock);
    const s = setup(false, () => { clock = 250; }); await vi.advanceTimersByTimeAsync(29751);
    const error = await s.result as WitnessedAudioPreparationError; expect(error.record.reason).toContain("permission deadline");
    expect(error.record.ownership.remaining.contexts).toBe(0); s.grant(); await Promise.resolve(); expect(s.track.readyState).toBe("ended");
  });
  it("rejects a late grant that wins timer dispatch ordering and stops its tracks", async () => {
    vi.useFakeTimers(); let clock = 0; vi.spyOn(performance, "now").mockImplementation(() => clock);
    const s = setup(); clock = 30001; s.grant(); const error = await s.result as WitnessedAudioPreparationError;
    expect(error.record.reason).toContain("resolved after preparation deadline"); expect(s.track.readyState).toBe("ended");
    expect(error.record.ownership.created.tracks).toBe(1); expect(error.record.ownership.remaining.tracks).toBe(0);
  });

  it("late addModule completion after cancellation cannot construct or restart a graph", async () => {
    vi.useFakeTimers(); const s = graphSetup(true); await vi.advanceTimersByTimeAsync(1000); s.controller.abort();
    const error = await s.result as WitnessedAudioPreparationError; s.resolveModule(); await Promise.resolve(); await Promise.resolve();
    expect(error.record.ownership.created.ports).toBe(0); expect(error.record.ownership.remaining.contexts).toBe(0);
    expect(s.contexts[0]!.state).toBe("closed"); expect(s.track.readyState).toBe("ended");
  });

  it("rejects an unexpected suspension after graph construction and cleans owned nodes", async () => {
    vi.useFakeTimers(); const s = graphSetup(); await vi.advanceTimersByTimeAsync(100);
    s.contexts[0]!.state = "suspended"; s.contexts[0]!.dispatchEvent(new Event("statechange")); await vi.advanceTimersByTimeAsync(5000);
    const error = await s.result as WitnessedAudioPreparationError;
    expect(error.record.reason).toContain("Unexpected AudioContext suspension"); expect(error.record.ownership.created.nodes).toBe(3);
    expect(Object.values(error.record.ownership.remaining).every(n => n === 0)).toBe(true);
  });

  it("bounds hanging addModule and cleans the already acquired microphone", async () => {
    vi.useFakeTimers(); const s = graphSetup(true); await vi.advanceTimersByTimeAsync(11000); const error = await s.result as WitnessedAudioPreparationError;
    expect(error.record.outcome).toBe("failed"); expect(error.record.reason).toContain("deadline"); expect(s.track.readyState).toBe("ended");
    expect(error.record.cleanup.remaining.contexts).toBe(0); expect(error.record.ownership.created.ports).toBe(0);
  });
  it("bounds missing actual process readiness and a missing final drain without leaking", async () => {
    vi.useFakeTimers(); const s = graphSetup(); await vi.advanceTimersByTimeAsync(16000); const error = await s.result as WitnessedAudioPreparationError;
    expect(error.record.reason).toContain("deadline"); expect(error.record.preparation.readyMs).toBeNull(); expect(error.record.cleanup.stopAckReceived).toBe(false);
    expect(error.record.ownership.created.ports).toBe(1); expect(Object.values(error.record.ownership.remaining).every(n => n === 0)).toBe(true);
    expect(error.record.cleanup.remaining.timers).toBe(0);
  });

  it("event budget exhaustion fails once and closes owned context without recursion", async () => {
    const s = setup(); for (let i = 0; i < 130; i++) s.contexts[0]!.dispatchEvent(new Event("statechange"));
    const error = await s.result as WitnessedAudioPreparationError;
    expect(error.record.events).toHaveLength(128); expect(error.record.reason).toContain("event budget"); expect(s.onFault).toHaveBeenCalledOnce();
    expect(error.record.cleanup.remaining.contexts).toBe(0); expect(error.record.cleanup.remaining.listeners).toBe(0); s.grant(); await Promise.resolve(); expect(s.track.readyState).toBe("ended");
  });

  it("closes context and immediately stops tracks granted AFTER cancellation", async () => {
    const s = setup(); s.controller.abort(); const error = await s.result as WitnessedAudioPreparationError;
    expect(error).toBeInstanceOf(WitnessedAudioPreparationError); expect(error.record.cleanup.remaining.contexts).toBe(0);
    expect(error.record.ownership.created.contexts).toBe(1); s.grant(); await Promise.resolve(); await Promise.resolve();
    expect(s.track.stop).toHaveBeenCalledOnce(); expect(s.contexts[0]?.state).toBe("closed");
  });
  it("bounds permission wait and guards an even later grant", async () => {
    vi.useFakeTimers(); const s = setup(); await vi.advanceTimersByTimeAsync(30001); const error = await s.result as WitnessedAudioPreparationError;
    expect(error.record.reason).toContain("permission deadline"); expect(error.record.outcome).toBe("failed"); s.grant(); await Promise.resolve();
    expect(s.track.readyState).toBe("ended"); expect(error.record.cleanup.remaining.timers).toBe(0);
  });
  it("bounds a hanging resume and stops the already granted stream", async () => {
    vi.useFakeTimers(); const s = setup(true); s.grant(); await vi.advanceTimersByTimeAsync(30001); const error = await s.result as WitnessedAudioPreparationError;
    expect(error.record.reason).toContain("setup/readiness total deadline"); expect(s.track.stop).toHaveBeenCalledOnce(); expect(error.record.cleanup.remaining.tracks).toBe(0);
  });
});
