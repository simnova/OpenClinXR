import { makeMetric, makeRun } from "../index.js";
import type { CapacityMetric, CapacityRun, MetricSample } from "../types.js";
import { createGraphicsFixture } from "./graphics.js";
import { createMovementFixture, createThreeFixture, runGlbFixture } from "./scene-fixtures.js";
import { browserIdentity } from "./identity.js";
import { probeMicrophone } from "./microphone.js";
import { readBrowserBuildIdentity } from "./build-identity.js";

export type BrowserSuite = "cadence" | "cpu" | "memory" | "asset" | "render" | "three" | "movement" | "glb" | "microphone" | "mixed";
export interface CapabilityManifest {
  schema: "quest-capacity-browser-capabilities.v1";
  observedAt: string;
  evidence: "desktop-browser" | "browser-unverified";
  userAgent: string;
  secureContext: boolean;
  crossOriginIsolated: boolean;
  hardwareConcurrencyHint: number | null;
  deviceMemoryGiBHint: number | null;
  xr: { apiPresent: boolean; immersiveVrSupportQuery: boolean | string };
  webgl: { available: boolean; limits: Record<string, number | string>; extensions: string[]; gpuTimer: boolean };
  audio: { context: boolean; worklet: boolean; captureApiPresent: boolean };
  unknown: string[];
}
const source = { tool: "capacity-browser-probe", version: "1", processId: "browser-page" };
export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Probe stopped", "AbortError");
}
/** The queued callback and abort listener are removed on either completion path. */
export function nextFrame(signal: AbortSignal): Promise<number> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { cancelAnimationFrame(id); signal.removeEventListener("abort", abort); reject(new DOMException("Probe stopped", "AbortError")); };
    const id = requestAnimationFrame((at) => { signal.removeEventListener("abort", abort); resolve(at); });
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function collectCapabilities(): Promise<CapabilityManifest> {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  const limits: Record<string, number | string> = {};
  let extensions: string[] = [];
  try {
    if (gl) {
      for (const name of ["MAX_TEXTURE_SIZE", "MAX_CUBE_MAP_TEXTURE_SIZE", "MAX_RENDERBUFFER_SIZE", "MAX_TEXTURE_IMAGE_UNITS", "MAX_VERTEX_TEXTURE_IMAGE_UNITS", "MAX_VERTEX_UNIFORM_VECTORS", "MAX_FRAGMENT_UNIFORM_VECTORS", "MAX_SAMPLES"]) {
        const key = (gl as unknown as Record<string, number>)[name];
        if (key !== undefined) limits[name] = Number(gl.getParameter(key));
      }
      limits['VERSION'] = String(gl.getParameter(gl.VERSION));
      limits['SHADING_LANGUAGE_VERSION'] = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
      extensions = gl.getSupportedExtensions() ?? [];
    }
  } finally { gl?.getExtension("WEBGL_lose_context")?.loseContext(); }
  const navigatorXr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
  let support: boolean | string = "WebXR API unavailable";
  if (navigatorXr) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      support = await Promise.race([
        navigatorXr.isSessionSupported("immersive-vr"),
        new Promise<string>((resolve) => { timeout = setTimeout(() => resolve("Support query timed out; no session requested"), 2000); }),
      ]);
    } catch (error) { support = error instanceof Error ? error.name : "Query failed"; }
    finally { if (timeout !== undefined) clearTimeout(timeout); }
  }
  return {
    schema: "quest-capacity-browser-capabilities.v1", observedAt: new Date().toISOString(), evidence: browserIdentity().provenance,
    userAgent: navigator.userAgent, secureContext: window.isSecureContext, crossOriginIsolated: window.crossOriginIsolated,
    hardwareConcurrencyHint: navigator.hardwareConcurrency || null,
    deviceMemoryGiBHint: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    xr: { apiPresent: Boolean(navigatorXr), immersiveVrSupportQuery: support },
    webgl: { available: Boolean(gl), limits, extensions, gpuTimer: extensions.includes("EXT_disjoint_timer_query_webgl2") },
    audio: { context: "AudioContext" in window, worklet: "AudioWorkletNode" in window, captureApiPresent: Boolean(navigator.mediaDevices?.getUserMedia) },
    unknown: ["Quest CPU/GPU capacity", "Browser-process RAM and GPU memory", "Compositor presentation and motion-to-photon", "Microphone and acoustic round-trip", "Network capacity and headset/server latency", "Immersive session features and thermal behavior"],
  };
}
function metric(id: string, semantic: CapacityMetric["semantic"], unit: CapacityMetric["unit"], values: MetricSample[], extra: Partial<CapacityMetric> = {}): CapacityMetric {
  return makeMetric({ id, semantic, unit, samples: values, clockDomain: "browser-monotonic", granularity: "event", source, ...extra });
}
function unavailable(id: string, semantic: CapacityMetric["semantic"], reason: string): CapacityMetric {
  return metric(id, semantic, "ms", [], { kind: "unavailable", unavailableReason: reason });
}
export function createDesktopRun(suite: string, level: number, startedAt: string, metrics: CapacityMetric[], status: CapacityRun["status"], capabilityHash: string): CapacityRun {
  const metadata = readBrowserBuildIdentity();
  return makeRun({
    id: `browser-${suite}-${level}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, evidenceClass: "smoke", provenance: browserIdentity().provenance,
    startedAt, endedAt: new Date().toISOString(), status, nativeSession: null,
    environment: { runtime: "browser", device: browserIdentity().device, os: navigator.platform || "unavailable", browser: navigator.userAgent, revision: metadata?.gitCommit || "unavailable", buildHash: metadata?.capacitySourceHash || "unavailable" },
    configuration: { workloadHash: suite === "render" || suite === "three" ? "matched-triangle-v1" : `raw-browser-${suite}-v1`, capabilityHash, seed: 1729, axes: { deviceIdentityTrust: "user-agent-hint", suite: suite === "three" ? "render" : suite, backend: suite === "three" ? "three" : suite === "render" || suite === "mixed" ? "raw-webgl2" : "none", level, renderWidth: 384, renderHeight: 384, durationMs: 650 } },
    profile: { id: "desktop-bounded-smoke", version: "1", status: "provisional", scope: browserIdentity().provenance === "browser-unverified" ? "quest" : "desktop", minimumSamples: 1, minimumDurationMs: 0, requiredClaims: [], stopRules: [] },
    metrics,
  });
}
export function hashManifest(value: CapabilityManifest): string {
  let hash = 2166136261;
  // Timestamp excluded so equivalent capability snapshots can be compared.
  const text = JSON.stringify({ ...value, observedAt: "" });
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `manifest-fnv1a-${(hash >>> 0).toString(16)}`;
}
async function assetProbe(level: number, signal: AbortSignal, canvas: HTMLCanvasElement): Promise<CapacityMetric[]> {
  const side = [128, 256, 512][level - 1] ?? 128;
  const fixtureCanvas = document.createElement("canvas"); fixtureCanvas.width = side; fixtureCanvas.height = side;
  const fixtureContext = fixtureCanvas.getContext("2d");
  if (!fixtureContext) return [unavailable("asset.fixture", "asset-duration", "Canvas2D unavailable")];
  fixtureContext.fillStyle = "#2e9acc"; fixtureContext.fillRect(0, 0, side, side);
  fixtureContext.fillStyle = "#f0bc55"; fixtureContext.beginPath(); fixtureContext.arc(side / 2, side / 2, side / 4, 0, Math.PI * 2); fixtureContext.fill();
  const blob = await new Promise<Blob>((resolve, reject) => fixtureCanvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG fixture encoding failed")), "image/png"));
  const url = URL.createObjectURL(blob);
  const metrics: CapacityMetric[] = [];
  let image: ImageBitmap | undefined;
  try {
    checkAbort(signal);
    const started = performance.now();
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("Local fixture fetch failed");
    const fetched = performance.now();
    const payload = await response.blob();
    const buffered = performance.now();
    if (!globalThis.createImageBitmap) return [unavailable("asset.decode", "asset-duration", "createImageBitmap unavailable")];
    image = await createImageBitmap(payload);
    checkAbort(signal);
    const decoded = performance.now();
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) return [unavailable("asset.first-usable", "asset-duration", "Canvas2D unavailable")];
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(side / 2, side / 2, 1, 1).data;
    if (pixel[3] !== 255) throw new Error("Fixture decode/readback verification failed");
    const usable = performance.now();
    for (const [id, value] of [["asset.local-fetch", fetched - started], ["asset.buffer", buffered - fetched], ["asset.png-imagebitmap-decode", decoded - buffered], ["asset.canvas-draw-and-readback", usable - decoded], ["asset.local-first-usable", usable - started]] as const) {
      metrics.push(metric(id, "asset-duration", "ms", [{ at: usable, value, valid: true }]));
    }
    metrics.push(metric("asset.local-encoded-bytes", "bytes", "bytes", [{ at: usable, value: payload.size, valid: true }]));
    return metrics;
  } finally { image?.close(); URL.revokeObjectURL(url); }
}
export interface BrowserProbeOptions { suite: BrowserSuite; level: number; signal: AbortSignal; canvas: HTMLCanvasElement; assetCanvas: HTMLCanvasElement; capabilityHash: string; onPreview?: (dataUrl: string) => void }
export async function runBrowserProbe(options: BrowserProbeOptions): Promise<CapacityRun> {
  const { suite, signal, canvas, assetCanvas, capabilityHash } = options;
  const level = Math.min(3, Math.max(1, Math.floor(options.level)));
  const startedAt = new Date().toISOString();
  if (suite === "microphone") {
    const result = await probeMicrophone(signal);
    const run = createDesktopRun(suite, 1, startedAt, result.metrics, result.status, capabilityHash);
    Object.assign(run.configuration.axes, result.axes);
    if (result.axes['captureInputClass'] === "synthetic-device") run.provenance = "synthetic";
    return run;
  }
  const metrics: CapacityMetric[] = [];
  const gaps: MetricSample[] = [];
  const cpu: MetricSample[] = [];
  const transforms: MetricSample[] = [];
  const memory: MetricSample[] = [];
  const submission: MetricSample[] = [];
  const rendering = suite === "render" || suite === "three" || suite === "mixed";
  let fixture: ReturnType<typeof createGraphicsFixture> = null;
  let movement: ReturnType<typeof createMovementFixture> | null = null;
  let pendingAsset: Promise<void> | undefined;
  let memoryBytes: Uint8Array | null = null;
  let checksum = 0;
  let frame = 0;
  let previous: number | undefined;
  let status: CapacityRun["status"] = "completed";
  const began = performance.now();
  try {
    fixture = suite === "three" ? createThreeFixture(canvas, level) : rendering ? createGraphicsFixture(canvas, level) : null;
    movement = suite === "movement" || suite === "mixed" ? createMovementFixture(level) : null;
    memoryBytes = suite === "memory" || suite === "mixed" ? new Uint8Array(([1, 4, 12][level - 1] ?? 1) * 1024 * 1024) : null;
    if (rendering && !fixture) metrics.push(unavailable("render.gpu-duration", "gpu-duration", "WebGL2 unavailable"));
    if (suite === "asset") metrics.push(...await assetProbe(level, signal, assetCanvas));
    if (suite === "glb") {
      const result = await runGlbFixture(canvas, level, signal, options.onPreview); metrics.push(...result);
      if (result.some((value) => value.kind === "unavailable")) status = "unsupported";
    }
    let assetError: unknown;
    pendingAsset = suite === "mixed" ? assetProbe(level, signal, assetCanvas).then((values) => { metrics.push(...values); }).catch((error: unknown) => { assetError = error; }) : Promise.resolve();
    while (performance.now() - began < 650 && frame < 120) {
      const at = await nextFrame(signal);
      const observedAt = performance.now();
      checkAbort(signal);
      if (document.visibilityState !== "visible") throw new DOMException("Page hidden; probe stopped", "AbortError");
      if (previous !== undefined) gaps.push({ at: observedAt, value: Math.max(0, at - previous), valid: at > previous });
      previous = at;
      if (suite === "cpu" || suite === "mixed") {
        const start = performance.now();
        const iterations = [8000, 32000, 96000][level - 1] ?? 8000;
        for (let i = 0; i < iterations; i++) checksum += Math.sin((i + frame) * .01) * Math.cos(i * .02);
        cpu.push({ at: observedAt, value: performance.now() - start, valid: true });
      }
      if (movement) { const start = performance.now(); checksum += movement.update(frame); transforms.push({ at: observedAt, value: performance.now() - start, valid: true }); }
      if (memoryBytes) {
        const start = performance.now();
        for (let i = 0; i < memoryBytes.length; i += 64) { memoryBytes[i] = ((memoryBytes[i] ?? 0) + frame + 1) & 255; checksum += memoryBytes[i] ?? 0; }
        memory.push({ at: observedAt, value: performance.now() - start, valid: true });
      }
      if (fixture) { const start = performance.now(); fixture.draw(observedAt); submission.push({ at: observedAt, value: performance.now() - start, valid: true }); }
      frame++;
    }
    await pendingAsset;
    if (assetError) throw assetError;
    // Asynchronous availability polling. No gl.finish or synchronous GPU timing.
    if (fixture) {
      // Verify pixels immediately after a final draw; preserveDrawingBuffer is false.
      fixture.draw(performance.now(), false);
      fixture.verify();
      options.onPreview?.(canvas.toDataURL("image/png"));
      for (let i = 0; i < 4; i++) { await nextFrame(signal); fixture.collect(); }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") status = "aborted";
    else throw error;
  } finally {
    await pendingAsset;
    metrics.push(metric("browser.raf-callback-gap", "callback-gap", "ms", gaps, { granularity: "per-frame" }));
    if (cpu.length) metrics.push(metric("cpu.animation-update", "cpu-duration", "ms", cpu, { granularity: "per-frame" }));
    if (transforms.length) metrics.push(metric("movement.object3d-update", "cpu-duration", "ms", transforms, { granularity: "per-frame" }));
    if (memoryBytes) {
      metrics.push(metric("memory.stride-touch-duration", "cpu-duration", "ms", memory, { granularity: "per-frame" }));
      metrics.push(metric("memory.allocated-fixture-bytes", "bytes", "bytes", [{ at: performance.now(), value: memoryBytes.length, valid: true }]));
    }
    if (submission.length) metrics.push(metric("render.cpu-submit-and-poll", "cpu-duration", "ms", submission, { granularity: "per-frame" }));
    if (fixture) metrics.push(...fixture.metrics());
    fixture?.dispose();
    if (movement) metrics.push(metric("movement.object3d-count", "counter", "count", [{ at: performance.now(), value: movement.objectCount, valid: true }]));
    movement?.dispose();
    memoryBytes = null;
  }
  metrics.push(metric("workload.checksum", "counter", "count", [{ at: performance.now(), value: Math.abs(checksum), valid: Number.isFinite(checksum) }]));
  metrics.push(unavailable("headset.motion-to-photon", "motion-to-photon", "External photon sensor and native worn-headset session required."));
  metrics.push(unavailable("audio.acoustic-round-trip", "audio-acoustic", "External acoustic loopback measurement required."));
  if (rendering && !fixture && (suite === "render" || suite === "three")) status = "unsupported";
  return createDesktopRun(suite, level, startedAt, metrics, status, capabilityHash);
}
/** User-gesture only. Low-gain software graph smoke, never headset or acoustic latency. */
export async function runAudioProbe(signal: AbortSignal, capabilityHash: string): Promise<CapacityRun> {
  const started = new Date().toISOString();
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const analyser = context.createAnalyser();
  const metrics: CapacityMetric[] = [];
  let status: CapacityRun["status"] = "completed";
  try {
    gain.gain.value = .012;
    oscillator.frequency.value = 440;
    oscillator.connect(gain).connect(analyser).connect(context.destination);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Audio probe stopped", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
      void context.resume().then(() => { signal.removeEventListener("abort", abort); resolve(); }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
      if (signal.aborted) abort();
    });
    checkAbort(signal);
    if (context.state !== "running") throw new Error("Audio context did not enter the running state");
    oscillator.start();
    const samples = new Float32Array(analyser.fftSize);
    let nonzeroSamples = 0;
    const began = performance.now();
    while (performance.now() - began < 400) {
      await nextFrame(signal);
      analyser.getFloatTimeDomainData(samples);
      for (const value of samples) if (Math.abs(value) > .0001) nonzeroSamples++;
    }
    metrics.push(metric("audio.software-nonzero-samples", "counter", "count", [{ at: performance.now(), value: nonzeroSamples, valid: nonzeroSamples > 0 }]));

    metrics.push(metric("audio.base-latency-estimate", "audio-software", "ms", [{ at: performance.now(), value: context.baseLatency * 1000, valid: Number.isFinite(context.baseLatency) }], { kind: "proxy" }));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") status = "aborted";
    else throw error;
  } finally {
    try { oscillator.stop(); } catch { /* May be stopped before oscillator start. */ }
    oscillator.disconnect(); gain.disconnect(); analyser.disconnect();
    await context.close();
  }
  metrics.push(unavailable("audio.acoustic-round-trip", "audio-acoustic", "Software graph is not physical capture/playback timing; microphone not requested."));
  const run = createDesktopRun("audio", 1, started, metrics, status, capabilityHash);
  run.configuration.axes['sampleRateHz'] = context.sampleRate;
  return run;
}
