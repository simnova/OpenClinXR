import { makeMetric } from "../factories.js";
import type { CapacityMetric, MetricSample } from "../types.js";
import { createGraphicsFixture } from "./graphics.js";
import { boundedImageDecode, readBoundedPng } from "./campaign-asset.js";
import { nextFrame, checkAbort } from "./probes.js";

export interface SceneHandle { worked: boolean; events: { at: number; event: string; detail: string }[]; metrics(): CapacityMetric[]; stop(): Promise<void> }
/** Fixed raw scene and actual HTTPS image transfers. Upload time is CPU submission, not GPU completion. */
export function startCampaignScene(options: { canvas: HTMLCanvasElement; level: number; render: boolean; assets: boolean; imageAssetUrl?: string; signal: AbortSignal }): SceneHandle {
  const controller = new AbortController();
  const abort = () => controller.abort(); options.signal.addEventListener("abort", abort, { once: true }); if (options.signal.aborted) abort();
  const events: SceneHandle["events"] = [];
  const samples = new Map<string, MetricSample[]>();
  let graphics: ReturnType<typeof createGraphicsFixture> = null; let failed: unknown = null; let frames = 0; let assetCount = 0; let prior: number | undefined; let settled = false;
  const add = (id: string, value: number) => { const values = samples.get(id) ?? []; if (values.length < 4096) values.push({ at: performance.now(), value, valid: true }); samples.set(id, values); };
  const event = (eventName: string, detail: string) => { if (events.length < 256) events.push({ at: performance.now(), event: eventName, detail }); };
  const state: SceneHandle = { worked: false, events, metrics() {
    const source = { tool: "capacity-campaign-scene", version: "2", processId: "browser-page" };
    const metrics = [...samples].map(([id, values]) => makeMetric({ id: `campaign.${id}`, semantic: id === "raf-gap" ? "callback-gap" : id === "render-cpu-submission" ? "cpu-duration" : id === "asset-bytes" ? "bytes" : "asset-duration", unit: id === "asset-bytes" ? "bytes" : "ms", samples: values, clockDomain: "browser-monotonic", source, granularity: id === "raf-gap" || id === "render-cpu-submission" ? "per-frame" : "event", kind: id === "asset-gpu-upload-submit" ? "proxy" : "measured" }));
    metrics.push(makeMetric({ id: "campaign.frames", semantic: "counter", unit: "count", samples: [{ at: performance.now(), value: frames, valid: true }], clockDomain: "browser-monotonic", source }));
    metrics.push(makeMetric({ id: "campaign.assets-decoded-uploaded", semantic: "counter", unit: "count", samples: [{ at: performance.now(), value: assetCount, valid: true }], clockDomain: "browser-monotonic", source }));
    if (graphics) metrics.push(...graphics.metrics());
    if (failed) metrics.push(makeMetric({ id: "campaign.scene-failure", semantic: "counter", unit: "count", kind: "unavailable", samples: [], unavailableReason: failed instanceof Error ? failed.message.slice(0, 512) : "Scene failed", source, clockDomain: "browser-monotonic" }));
    return metrics;
  }, async stop() { controller.abort(); await Promise.allSettled([renderJob, assetJob]); options.signal.removeEventListener("abort", abort); if (!settled) { settled = true; graphics?.dispose(); event("scene-stopped", `${frames} callbacks; ${assetCount} decoded/uploads`); } } };
  try { if (options.render) { graphics = createGraphicsFixture(options.canvas, options.level); if (!graphics) throw new Error("WebGL2 unavailable"); } }
  catch (error) { failed = error; event("scene-failed", error instanceof Error ? error.message : "WebGL setup failed"); controller.abort(); }
  const renderJob = (async () => {
    try {
      while (!controller.signal.aborted) {
        const at = await nextFrame(controller.signal); if (prior !== undefined) add("raf-gap", at - prior); prior = at;
        const began = performance.now(); graphics?.draw(at); if (graphics) add("render-cpu-submission", performance.now() - began);
        frames++; if (frames === 1) { state.worked = true; event("first-render-callback", options.render ? "draw submitted" : "idle rAF observed"); }
      }
    } catch (error) { if (!controller.signal.aborted) { failed = error; event("render-failed", error instanceof Error ? error.message : "Render failed"); controller.abort(); } }
    finally { if (graphics && frames > 0) { try { event("post-window-verification", "Untimed matched-fixture redraw/readback after observation; excluded from phase frame, draw and timing counts"); graphics.draw(performance.now(), false); graphics.verify(); } catch (error) { failed = error; event("render-verification-failed", error instanceof Error ? error.message : "Render readback failed"); } } }
  })();
  const assetJob = (async () => {
    if (!options.assets) return;
    try {
      if (!options.imageAssetUrl || !graphics?.uploadBitmap) throw new Error("HTTPS PNG service and GPU upload fixture are required");
      const url = new URL(options.imageAssetUrl); if (url.protocol !== "https:") throw new Error("Asset campaign requires HTTPS"); url.searchParams.set("side", String([128, 256, 512][options.level - 1]));
      while (!controller.signal.aborted && assetCount < 64) {
        const began = performance.now(); const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const blob = await readBoundedPng(response, controller.signal); checkAbort(controller.signal);
        const fetched = performance.now(); add("asset-fetch-buffer", fetched - began); add("asset-bytes", blob.size);
        const image = await boundedImageDecode(blob, controller.signal);
        try { checkAbort(controller.signal); const decoded = performance.now(); add("asset-imagebitmap-decode", decoded - fetched); graphics.uploadBitmap(image); add("asset-gpu-upload-submit", performance.now() - decoded); assetCount++; if (assetCount === 1) event("first-asset-upload", "HTTPS PNG fetched, decoded and texture upload submitted"); }
        finally { image.close(); }
        await new Promise<void>((resolve) => { const timeout = setTimeout(done, 90); function done() { clearTimeout(timeout); controller.signal.removeEventListener("abort", done); resolve(); } controller.signal.addEventListener("abort", done, { once: true }); if (controller.signal.aborted) done(); });
      }
    } catch (error) { if (!controller.signal.aborted) { failed = error; event("asset-failed", error instanceof Error ? error.message : "Asset failed"); controller.abort(); } }
  })();
  return state;
}
