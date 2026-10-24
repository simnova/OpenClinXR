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
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function runScene(fixture: ReturnType<typeof graphics>) {
  let callback: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => { callback = next; return 1; }); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const scene = startCampaignScene({ canvas: fixture.canvas, level: 1, render: true, assets: false, signal: new AbortController().signal });
  callback?.(1); await Promise.resolve(); await scene.stop(); return scene;
}
it("retains actual post-stop pixel verification after graphics cleanup", async () => {
  const fixture = graphics();
  fixture.gl.readPixels.mockImplementation((_x, _y, _w, _h, _format, _type, pixels) => { for (let i = 0; i < 42; i++) pixels[i * 4 + 2] = 255; });
  const scene = await runScene(fixture);
  expect(fixture.draw).toHaveBeenCalledTimes(32); expect(fixture.gl.readPixels).toHaveBeenCalledOnce(); expect(fixture.dispose).toHaveBeenCalledOnce();
  expect(scene.metrics().find((metric) => metric.id === "render.verified-nonbackground-pixels")?.samples[0]?.value).toBe(42);
});
it("exposes late readback failure for phase adjudication instead of losing it before stop", async () => {
  const fixture = graphics(); fixture.gl.readPixels.mockImplementation(() => { throw new Error("injected readback failure"); });
  const scene = await runScene(fixture);
  expect(scene.metrics().find((metric) => metric.id === "campaign.scene-failure")?.unavailableReason).toBe("injected readback failure");
  expect(scene.events.some((event) => event.event === "render-verification-failed")).toBe(true);
  expect(fixture.dispose).toHaveBeenCalledOnce();
});
