import { afterEach, describe, expect, it, vi } from "vitest";
import { startAudioStress } from "@openclinxr/xr-capacity/browser/probes";
import { runBrowserProbe } from "@openclinxr/xr-capacity/browser";
function report(overrides: Record<string, unknown> = {}) {
  return { type: "window", blocks: 32, frames: 4096, windowBlocks: 32, windowFrames: 4096, sampleRate: 48000, renderFrame: 3968, renderTime: 3968 / 48000, discontinuities: 0, maxGapFrames: 0, minQuantum: 128, maxQuantum: 128, energy: 1, ...overrides };
}
let workletBlob: Blob | undefined;
function probeMicrophone(signal: AbortSignal) {
  return runBrowserProbe({ suite: "microphone", level: 1, signal, canvas: {} as HTMLCanvasElement, assetCanvas: {} as HTMLCanvasElement, capabilityHash: "test" });
}
function globals(settings: { resumeHangs?: boolean; moduleHangs?: boolean; closeHangs?: boolean; firstReport?: boolean } = {}) {
  const disconnect = vi.fn(); const oscillatorStop = vi.fn(); const close = vi.fn(settings.closeHangs ? () => new Promise<void>(() => {}) : async () => {});
  const portClose = vi.fn(); const streamStop = vi.fn(); let processor: { port: { onmessage: ((event: MessageEvent) => void) | null; close: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }; onprocessorerror: (() => void) | null };
  const document = new EventTarget() as EventTarget & { visibilityState: string }; document.visibilityState = "visible";
  vi.stubGlobal("document", document); vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { userAgent: "test-browser", platform: "test-host", userActivation: { isActive: true } });
  vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: Blob) => { workletBlob = blob; return "blob:audio-stress"; }), revokeObjectURL: vi.fn() });
  const node = () => ({ connect: vi.fn(), disconnect, gain: { value: 0 }, frequency: { value: 0 }, Q: { value: 0 }, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, start: vi.fn(), stop: oscillatorStop });
  class FakeContext {
    state = "running"; sampleRate = 48000; currentTime = 1; baseLatency = 0.01; outputLatency = 0.02;
    destination = node(); onstatechange: (() => void) | null = null;
    audioWorklet = { addModule: vi.fn(settings.moduleHangs ? () => new Promise<void>(() => {}) : async () => {}) };
    resume = vi.fn(settings.resumeHangs ? () => new Promise<void>(() => {}) : async () => {}); close = close;
    createGain = node; createOscillator = node; createBiquadFilter = node; createPanner = node; createMediaStreamSource = node;
    createMediaStreamDestination = () => ({ ...node(), stream: { getTracks: () => [{ stop: streamStop }] } });
    getOutputTimestamp = () => ({ contextTime: 0.98, performanceTime: 2 });
  }
  let context: FakeContext | undefined;
  vi.stubGlobal("AudioContext", class extends FakeContext { constructor() { super(); context = this; } });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null as ((event: MessageEvent) => void) | null, close: portClose, postMessage: vi.fn() };
    onprocessorerror: (() => void) | null = null; connect = vi.fn(); disconnect = disconnect;
    constructor() { processor = this; if (settings.firstReport !== false) queueMicrotask(() => this.port.onmessage?.({ data: report() } as MessageEvent)); }
  });
  return { close, disconnect, oscillatorStop, portClose, streamStop, document, context: () => context!, emit: (value: unknown) => processor.port.onmessage?.({ data: value } as MessageEvent) };
}
function options(signal = new AbortController().signal) { return { level: 1, durationMs: 500, setupTimeoutMs: 100, signal }; }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("bounded actual AudioWorklet graph lifecycle", () => {
  it("permits explicitly authorized scheduled phases after activation expires while keeping capture strict", async () => {
    const fake = globals();
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { userActivation: { isActive: false, hasBeenActive: true }, mediaDevices: { getUserMedia } });
    const denied = await startAudioStress(options());
    expect(denied.state.status).toBe("unsupported"); expect(denied.state.worked).toBe(false);
    expect(denied.events.some((event) => event.detail.includes("explicit user gesture"))).toBe(true);
    const permitted = await startAudioStress({ ...options(), allowPreviouslyActivated: true });
    expect(permitted.state.status).toBe("running"); expect(permitted.state.worked).toBe(true);
    expect(permitted.axes['audioGestureMode']).toBe("previously-activated-campaign");
    await permitted.stop(); expect(fake.close).toHaveBeenCalledOnce();
    const capture = await startAudioStress({ ...options(), allowPreviouslyActivated: true, capture: "explicit" });
    expect(capture.state.status).toBe("unsupported"); expect(getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { userActivation: { isActive: false, hasBeenActive: false } });
    expect((await startAudioStress({ ...options(), allowPreviouslyActivated: true })).state.status).toBe("unsupported");
  });
  it("requires actual running and processor progress even with prior campaign authorization", async () => {
    vi.useFakeTimers(); const fake = globals({ resumeHangs: true });
    vi.stubGlobal("navigator", { userActivation: { isActive: false, hasBeenActive: true } });
    const pending = startAudioStress({ ...options(), allowPreviouslyActivated: true }); await vi.advanceTimersByTimeAsync(101);
    const handle = await pending; expect(handle.state.status).toBe("unsupported"); expect(handle.state.worked).toBe(false); expect(fake.close).toHaveBeenCalledOnce();
  });

  it("starts only after processed blocks, labels synthetic media separately, and releases every resource", async () => {
    const fake = globals();
    const handle = await startAudioStress({ ...options(), syntheticOutputStream: true });
    expect(handle.state).toEqual({ status: "running", worked: true, reason: null });
    expect(handle.axes['audioMediaSource']).toBe("synthetic-oscillators"); expect(handle.axes['audioRuntimeEvidence']).toBe("actual-browser-WebAudio");
    expect(handle.outputStream).toBeDefined(); expect(handle.events.some((event) => event.type === "first-work")).toBe(true);
    const metrics = handle.snapshotMetrics();
    expect(metrics.find((metric) => metric.id === "audio.worklet.processed-frames")?.samples[0]?.value).toBe(4096);
    expect(metrics.find((metric) => metric.id === "audio.render-clock-gap.max-window")?.granularity).toBe("aggregate-window");
    expect(metrics.find((metric) => metric.id === "audio.acoustic-round-trip")?.kind).toBe("unavailable");
    expect(metrics.find((metric) => metric.id === "audio.output-latency-estimate")?.kind).toBe("proxy");
    await handle.stop(); await handle.stop();
    expect(fake.close).toHaveBeenCalledOnce(); expect(fake.portClose).toHaveBeenCalledOnce(); expect(fake.streamStop).toHaveBeenCalledOnce(); expect(fake.oscillatorStop).toHaveBeenCalledTimes(4); expect(fake.disconnect).toHaveBeenCalled();
  });
  it("bounds a suspended resume, stalled module loading, and missing first-work report independently", async () => {
    vi.useFakeTimers();
    for (const setting of [{ resumeHangs: true }, { moduleHangs: true }, { firstReport: false }]) {
      const fake = globals(setting); const pending = startAudioStress(options());
      await vi.advanceTimersByTimeAsync(101);
      const handle = await pending;
      expect(handle.state.status).toBe("unsupported"); expect(handle.state.worked).toBe(false); expect(fake.close).toHaveBeenCalledOnce();
    }
  });
  it("stops when hidden and records context interruptions separately from delivery gaps", async () => {
    const fake = globals(); const handle = await startAudioStress(options());
    fake.context().state = "suspended"; fake.context().onstatechange?.();
    expect(handle.snapshotMetrics().find((metric) => metric.id === "audio.context-interruptions")?.samples[0]?.value).toBe(1);
    fake.document.visibilityState = "hidden"; fake.document.dispatchEvent(new Event("visibilitychange"));
    await handle.stop(); expect(handle.state.status).toBe("aborted"); expect(fake.close).toHaveBeenCalledOnce();
  });
  it("cancels capture while permission is pending and releases a late grant", async () => {
    const fake = globals(); let grant: ((stream: MediaStream) => void) | undefined;
    const capture = new Promise<MediaStream>((resolve) => { grant = resolve; });
    vi.stubGlobal("navigator", { userAgent: "test-browser", platform: "test-host", userActivation: { isActive: true }, mediaDevices: { getUserMedia: vi.fn(() => capture) } });
    const controller = new AbortController(); const pending = startAudioStress({ ...options(controller.signal), capture: "explicit" });
    controller.abort(); const handle = await pending; const stop = vi.fn();
    grant?.({ getTracks: () => [{ stop }] } as unknown as MediaStream); await Promise.resolve();
    expect(handle.state.status).toBe("aborted"); expect(stop).toHaveBeenCalledOnce(); expect(fake.close).toHaveBeenCalledOnce();
  });
  it("releases capture after setup deadline even if permission later succeeds without external abort", async () => {
    vi.useFakeTimers(); const fake = globals(); let grant: ((stream: MediaStream) => void) | undefined;
    vi.stubGlobal("navigator", { userAgent: "test-browser", platform: "test-host", userActivation: { isActive: true }, mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; })) } });
    const pending = startAudioStress({ ...options(), capture: "explicit" }); await vi.advanceTimersByTimeAsync(101);
    expect((await pending).state.status).toBe("unsupported");
    const stop = vi.fn(); grant?.({ getTracks: () => [{ stop }] } as unknown as MediaStream); await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce(); expect(fake.close).toHaveBeenCalledOnce();
  });
  it("bounds a stalled close and rejects amplification, excessive complexity, or microphone-to-RTC leakage", async () => {
    vi.useFakeTimers(); globals({ closeHangs: true }); const pending = startAudioStress(options()); await vi.advanceTimersByTimeAsync(0); const handle = await pending;
    const stopping = handle.stop(); await vi.advanceTimersByTimeAsync(251); await stopping;
    await expect(startAudioStress({ ...options(), voices: 33 })).rejects.toThrow("voices");
    await expect(startAudioStress({ ...options(), workletLoad: 257 })).rejects.toThrow("workletLoad");
    await expect(startAudioStress({ ...options(), speakerGain: 0.5 })).rejects.toThrow("speakerGain");
    await expect(startAudioStress({ ...options(), capture: "explicit", syntheticOutputStream: true })).rejects.toThrow("cannot include microphone");
  });
  it("does not confuse processor ready or invalid messages with actual work", async () => {
    vi.useFakeTimers(); const fake = globals({ firstReport: false }); const pending = startAudioStress(options()); await vi.advanceTimersByTimeAsync(0);
    fake.emit({ type: "ready" }); fake.emit(report({ frames: 1 })); await vi.advanceTimersByTimeAsync(101);
    const handle = await pending; expect(handle.state.worked).toBe(false);
    expect(handle.snapshotMetrics().find((metric) => metric.id === "audio.worklet-rejected-messages")?.samples[0]?.value).toBe(1);
  });
});

describe("AudioWorklet counters and evidence grain", () => {
  it("validates actual processor DSP output and render-frame discontinuity windows", async () => {
    const fake = globals(); const handle = await startAudioStress(options());
    const messages: unknown[] = [];
    const scope = { currentFrame: 0, currentTime: 0, sampleRate: 48000 };
    let Processor: (new (options: unknown) => { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }) | undefined;
    class Base { port = { postMessage: (message: unknown) => messages.push(message), onmessage: null }; }
    const source = `with(scope){${await workletBlob!.text()}}`;
    new Function("scope", "AudioWorkletProcessor", "registerProcessor", source)(scope, Base, (_name: string, value: typeof Processor) => { Processor = value; });
    const processor = new Processor!({ processorOptions: { load: 8 } });
    const input = new Float32Array(128).fill(0.2); const output = new Float32Array(128);
    for (let block = 0; block < 64; block++) {
      if (block === 40) scope.currentFrame += 128;
      scope.currentTime = scope.currentFrame / scope.sampleRate; processor.process([[input]], [[output, output.slice()]]); scope.currentFrame += 128;
    }
    const windows = messages.filter((message) => (message as { type: string }).type === "window");
    const first = windows[0] as ReturnType<typeof report>; const second = windows[1] as ReturnType<typeof report>;
    fake.emit(second);
    expect(first?.blocks).toBe(32); expect(first?.frames).toBe(4096); expect(first?.energy).toBeGreaterThan(0);
    expect(second?.discontinuities).toBe(1); expect(second?.maxGapFrames).toBe(128); expect(output[0]).toBeGreaterThan(0);
    fake.emit(report({ renderTime: 0 }));
    fake.emit(first);
    fake.emit(report({ windowFrames: Number.POSITIVE_INFINITY }));
    expect(handle.snapshotMetrics().find((metric) => metric.id === "audio.worklet-rejected-messages")?.samples[0]?.value).toBe(3);
    expect(handle.snapshotMetrics().find((metric) => metric.id === "audio.render-clock-discontinuities")?.samples[0]?.value).toBe(1);
    const capped = new Processor!({ processorOptions: { load: 8, maxFrames: 256 } });
    expect(capped.process([[input]], [[output]])).toBe(true);
    expect(capped.process([[input]], [[output]])).toBe(true);
    expect(capped.process([[input]], [[output]])).toBe(false);
    expect(messages.at(-1)).toEqual({ type: "budget-exhausted" });
    await handle.stop();
  });
  it("bounds sample and event rings with exact dropped counts and keeps aggregate windows distinct", async () => {
    const fake = globals(); const handle = await startAudioStress(options());
    for (let index = 1; index <= 265; index++) {
      const blocks = (index + 1) * 32; const renderFrame = blocks * 128 - 128;
      fake.emit(report({ blocks, frames: blocks * 128, renderFrame, renderTime: renderFrame / 48000 }));
    }
    const metric = handle.snapshotMetrics().find((item) => item.id === "audio.worklet.processed-blocks")!;
    expect(metric.samples).toHaveLength(256); expect(metric.droppedSamples).toBe(10); expect(metric.granularity).toBe("aggregate-window");
    const delivery = handle.snapshotMetrics().find((item) => item.id === "audio.main-thread-report-gap")!;
    expect(delivery.samples).toHaveLength(256); expect(delivery.granularity).toBe("event"); expect(delivery.windowMs).toBeNull();
    // 266 processing windows plus two startup events; the retained event ring is independent.
    expect(handle.events).toHaveLength(128);
    expect(handle.snapshotMetrics().find((item) => item.id === "audio.events-dropped")?.samples[0]?.value).toBe(140);
    await handle.stop();
  });
});


describe("microphone setup deadline", () => {
  it("bounds an ignored permission request and releases its eventual grant", async () => {
    vi.useFakeTimers(); const fake = globals(); vi.stubGlobal("window", { isSecureContext: true });
    let grant: ((stream: MediaStream) => void) | undefined;
    vi.stubGlobal("navigator", { userAgent: "test-browser", platform: "test-host", mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; })) } });
    const pending = probeMicrophone(new AbortController().signal); await vi.advanceTimersByTimeAsync(3001);
    expect((await pending).status).toBe("unsupported"); const stop = vi.fn();
    grant?.({ getTracks: () => [{ stop }] } as unknown as MediaStream); await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce(); expect(fake.close).toHaveBeenCalledOnce();
  });
  it("bounds resume after capture and stops a live stream", async () => {
    vi.useFakeTimers(); const fake = globals({ resumeHangs: true }); vi.stubGlobal("window", { isSecureContext: true }); const stop = vi.fn();
    vi.stubGlobal("navigator", { userAgent: "test-browser", platform: "test-host", mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    const pending = probeMicrophone(new AbortController().signal); await vi.advanceTimersByTimeAsync(3001);
    expect((await pending).status).toBe("unsupported"); expect(stop).toHaveBeenCalledOnce(); expect(fake.close).toHaveBeenCalledOnce();
  });
});
