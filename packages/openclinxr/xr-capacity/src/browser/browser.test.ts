import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateRun, makeMetric, makeRun } from "../index.js";
import { collectCapabilities, importRunJson, MAX_IMPORT_BYTES, runBrowserProbe } from "@openclinxr/xr-capacity/browser";

function graphics() {
  const noop = vi.fn(); const dispose = vi.fn(); const draw = vi.fn();
  const gl = { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: () => ({}), getError: () => 0, NO_ERROR: 0, isContextLost: () => false,
    getExtension: (name: string) => name === "WEBGL_lose_context" ? { loseContext: dispose } : null,
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop, useProgram: noop,
    bindBuffer: noop, bufferData: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    deleteShader: noop, deleteProgram: noop, deleteBuffer: noop, viewport: noop, clearColor: noop,
    clear: noop, uniform1f: noop, uniform2f: noop, drawArrays: draw };
  return { canvas: { getContext: () => gl } as unknown as HTMLCanvasElement, dispose, draw };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function record() {
  return makeRun({ id: "importable-browser-smoke", provenance: "desktop-browser", status: "completed", profile: { id: "desktop-smoke", version: "1", status: "provisional", scope: "desktop", minimumSamples: 1, minimumDurationMs: 0, requiredClaims: [], stopRules: [] }, metrics: [makeMetric({ source: { tool: "page-timer", version: "1", processId: "page" }, clockDomain: "browser-monotonic", samples: [{ at: 1, value: 1, valid: true }] })] });
}
describe("capacity browser evidence boundary", () => {
  it("rejects precomputed verdicts and files over the browser byte cap", () => {
    expect(() => importRunJson(JSON.stringify({ ...record(), outcome: "validated-profile" }))).toThrow(/unknown field/);
    expect(() => importRunJson(" ".repeat(MAX_IMPORT_BYTES + 1))).toThrow(/1 MiB/);
    expect(() => importRunJson("not-json")).toThrow(/valid JSON/);
  });
  it("owns imported data and recomputes an inconclusive desktop smoke outcome", () => {
    const original = record(); original.environment.device = '<img src=x onerror="alert(1)">';
    const imported = importRunJson(JSON.stringify(original));
    original.metrics.length = 0;
    expect(imported.metrics).toHaveLength(1);
    expect(imported.environment.device).toContain("<img"); // Display code must use textContent.
    expect(evaluateRun(imported).outcome).toBe("inconclusive");
    expect(imported.nativeSession).toBeNull();
  });
  it("never validates imported native ownership without collector verification", () => {
    const run = record(); run.provenance = "quest-native"; run.evidenceClass = "capacity";
    run.profile.scope = "quest"; run.profile.status = "frozen";
    run.nativeSession = { sessionId: "forged", processId: "page", browser: "Quest", device: "Quest 3", ownershipVerified: true, worn: true };
    expect(evaluateRun(importRunJson(JSON.stringify(run))).outcome).not.toBe("validated-profile");
  });
});
describe("bounded browser lifecycle", () => {
  it("releases the graphics fixture after cancellation and retains desktop provenance", async () => {
    vi.stubGlobal("navigator", { platform: "test-host", userAgent: "test-browser" });
    vi.stubGlobal("document", { visibilityState: "visible" });
    let queued: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { queued = callback; return 1; }));
    const cancel = vi.fn(); vi.stubGlobal("cancelAnimationFrame", cancel);
    const fixture = graphics();
    const controller = new AbortController();
    const runPromise = runBrowserProbe({ suite: "render", level: 1, signal: controller.signal, canvas: fixture.canvas, assetCanvas: {} as HTMLCanvasElement, capabilityHash: "test" });
    expect(queued).toBeDefined(); controller.abort();
    const run = await runPromise;
    expect(cancel).toHaveBeenCalledWith(1);
    expect(fixture.dispose).toHaveBeenCalledOnce();
    expect(run.status).toBe("aborted"); expect(run.provenance).toBe("desktop-browser"); expect(run.nativeSession).toBeNull();
    expect(run.metrics.find((item) => item.id === "headset.motion-to-photon")?.kind).toBe("unavailable");
    expect(evaluateRun(run).outcome).toBe("aborted");
  });
  it("releases graphics resources when an actual draw fails", async () => {
    vi.stubGlobal("navigator", { platform: "test-host", userAgent: "test-browser" });
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { queueMicrotask(() => callback(1)); return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const fixture = graphics();
    fixture.draw.mockImplementationOnce(() => { throw new Error("context lost"); });
    await expect(runBrowserProbe({ suite: "render", level: 1, signal: new AbortController().signal, canvas: fixture.canvas, assetCanvas: {} as HTMLCanvasElement, capabilityHash: "test" })).rejects.toThrow("context lost");
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });
});
describe("explicit microphone lifecycle", () => {
  function audioContext() {
    const close = vi.fn(async () => {});
    vi.stubGlobal("AudioContext", class { state = "running"; resume = async () => {}; close = close; });
    vi.stubGlobal("window", { isSecureContext: true });
    return close;
  }
  function options(signal: AbortSignal) { return { suite: "microphone" as const, level: 1, signal, canvas: {} as HTMLCanvasElement, assetCanvas: {} as HTMLCanvasElement, capabilityHash: "test" }; }
  it("does not request capture while collecting API capabilities", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { userAgent: "test", hardwareConcurrency: 2, mediaDevices: { getUserMedia } });
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    vi.stubGlobal("window", { isSecureContext: true, crossOriginIsolated: false });
    await collectCapabilities();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("reports denial as unavailable and closes its audio context", async () => {
    const close = audioContext();
    vi.stubGlobal("navigator", { userAgent: "test", platform: "test", mediaDevices: { getUserMedia: vi.fn(async () => { throw new DOMException("Denied", "NotAllowedError"); }) } });
    const run = await runBrowserProbe(options(new AbortController().signal));
    expect(run.status).toBe("unsupported"); expect(run.metrics.every((metric) => metric.kind === "unavailable")).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
  it("stops a late permission grant after the probe has already been cancelled", async () => {
    const close = audioContext(); let grant: ((stream: MediaStream) => void) | undefined;
    const pending = new Promise<MediaStream>((resolve) => { grant = resolve; });
    vi.stubGlobal("navigator", { userAgent: "test", platform: "test", mediaDevices: { getUserMedia: vi.fn(() => pending) } });
    const controller = new AbortController(); const runPromise = runBrowserProbe(options(controller.signal)); controller.abort();
    const run = await runPromise;
    expect(run.status).toBe("aborted"); expect(close).toHaveBeenCalledOnce();
    const stop = vi.fn(); grant?.({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve(); await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce(); expect(run.metrics.every((metric) => metric.kind === "unavailable")).toBe(true);
  });
  it("can stop a granted stream while AudioContext resume remains blocked", async () => {
    const close = vi.fn(async () => {}); const stop = vi.fn();
    vi.stubGlobal("AudioContext", class { state = "suspended"; resume = () => new Promise<void>(() => {}); close = close; });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { userAgent: "test", platform: "test", mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    const controller = new AbortController(); const pending = runBrowserProbe(options(controller.signal));
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    expect((await pending).status).toBe("aborted"); expect(close).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  });
});
