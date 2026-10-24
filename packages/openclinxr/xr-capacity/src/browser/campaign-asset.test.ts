import { afterEach, expect, it, vi } from "vitest";
import { startCampaignScene } from "@openclinxr/xr-capacity/browser/probes";
function graphics() {
  const noop = vi.fn(); const dispose = vi.fn(); const draw = vi.fn();
  const gl = { createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: () => ({}), getError: () => 0, NO_ERROR: 0, isContextLost: () => false,
    getExtension: (name: string) => name === "WEBGL_lose_context" ? { loseContext: dispose } : null,
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop, useProgram: noop,
    bindBuffer: noop, bufferData: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    readPixels: vi.fn((_x: number, _y: number, _w: number, _h: number, _format: number, _type: number, pixels: Uint8Array) => { pixels[2] = 255; }),
    createTexture: () => ({}), bindTexture: noop, texImage2D: noop, texParameteri: noop, deleteTexture: noop,
    deleteShader: noop, deleteProgram: noop, deleteBuffer: noop, viewport: noop, clearColor: noop,
    clear: noop, uniform1f: noop, uniform2f: noop, drawArrays: draw };
  return { gl, canvas: { getContext: () => gl } as unknown as HTMLCanvasElement, dispose, draw };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function scene(signal: AbortSignal) {
  const fixture = graphics();
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return startCampaignScene({ canvas: fixture.canvas, level: 1, render: true, assets: true, imageAssetUrl: "https://localhost/fixture.png", signal });
}
function png() { return new Response(new Uint8Array(10), { headers: { "content-type": "image/png", "content-length": "10" } }); }
it("settles cancellation of a pending decoder and closes its late bitmap", async () => {
  let complete: ((value: ImageBitmap) => void) | undefined; let decoding: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => { decoding = resolve; });
  vi.stubGlobal("fetch", async () => png());
  vi.stubGlobal("createImageBitmap", () => { decoding?.(); return new Promise<ImageBitmap>((resolve) => { complete = resolve; }); });
  const controller = new AbortController(); const handle = scene(controller.signal);
  await reached; controller.abort(); await handle.stop();
  const close = vi.fn(); complete?.({ close } as unknown as ImageBitmap); await Promise.resolve(); expect(close).toHaveBeenCalledOnce();
  expect(handle.metrics().find((m) => m.id === "campaign.assets-decoded-uploaded")?.samples[0]?.value).toBe(0);
});
it("bounds a stalled decoder even without cancellation", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", async () => png()); vi.stubGlobal("createImageBitmap", () => new Promise(() => {}));
  const handle = scene(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1500); await handle.stop();
  expect(handle.metrics().find((m) => m.id === "campaign.scene-failure")?.unavailableReason).toMatch(/deadline/);
});
it("rejects actual bytes beyond the declared PNG cap while streaming", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(20)); }, cancel });
  vi.stubGlobal("fetch", async () => new Response(body, { headers: { "content-type": "image/png", "content-length": "10" } }));
  const handle = scene(new AbortController().signal); await new Promise((resolve) => setTimeout(resolve, 0)); await handle.stop();
  expect(handle.metrics().find((m) => m.id === "campaign.scene-failure")?.unavailableReason).toMatch(/byte cap/); expect(cancel).toHaveBeenCalledOnce();
});
