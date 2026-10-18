import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import type { Browser, BrowserContext, Page } from "../lib/slotted-playwright.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";

const outDir = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".openclinxr/evidence/arms/camdebug";
const STEP = 1 / 30;
const PLACE = `((pose) => {
  const scene = globalThis.__openClinXrDebugScene;
  let cam = null;
  scene.traverse((o) => { if (!cam && (o.isPerspectiveCamera || o.type === "PerspectiveCamera")) cam = o; });
  if (!cam) throw new Error("no-camera");
  cam.fov = pose.fov; if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
  const v = cam.position.clone(); v.set(pose.eye.x, pose.eye.y, pose.eye.z);
  if (cam.parent) { cam.parent.updateWorldMatrix(true, false); v.applyMatrix4(cam.parent.matrixWorld.clone().invert()); }
  cam.position.copy(v);
  if (cam.parent) cam.parent.updateWorldMatrix(true);
  cam.lookAt(pose.look.x, pose.look.y, pose.look.z);
  cam.updateMatrixWorld(true);
  return { ok: true };
})`;

const POSES: Record<string, { eye: { x: number; y: number; z: number }; look: { x: number; y: number; z: number }; fov: number }> = {
  wide: { eye: { x: -1.9, y: 1.75, z: 0.75 }, look: { x: -1.0, y: 0.9, z: 1.3 }, fov: 52 },
  front: { eye: { x: -1.5, y: 1.6, z: -0.9 }, look: { x: -0.8, y: 1.0, z: 1.17 }, fov: 50 },
  threequarter: { eye: { x: -2.2, y: 1.6, z: 0.6 }, look: { x: -0.8, y: 0.9, z: 1.17 }, fov: 50 },
};
const SHOTS: Array<{ name: string; at: number; pose: keyof typeof POSES }> = [
  { name: "wide-walk", at: 20, pose: "wide" },
  { name: "wide-turn", at: 60, pose: "wide" },
  { name: "wide-arrived", at: 110, pose: "wide" },
  { name: "front-arrived", at: 112, pose: "front" },
  { name: "tq-arrived", at: 114, pose: "threequarter" },
];

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const bundleJson = buildSceneClosureBundleJson();
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const services = createLocalComputeServices();
  try {
    await services.sceneCapture.withBrowser("arms-camprobe", async (browser) => {
      const b = browser as Browser;
      let context: BrowserContext | null = null;
      try {
        context = await b.newContext({ viewport: { width: 1280, height: 720 } });
        const page: Page = await context.newPage();
        await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
        await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
          await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
        });
        await page.goto(`${buildSceneClosureUrl(server.url)}&steppingTurn=1`, { waitUntil: "load", timeout: 180_000 });
        await page.clock.install();
        const pinMs = (await page.evaluate(`(() => Date.now())()`)) as number;
        await page.clock.pauseAt(pinMs + 2000);
        await new Promise((r) => setTimeout(r, 1500));
        for (let i = 0; i < 1500; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await page.clock.fastForward(STEP * 1000);
          // eslint-disable-next-line no-await-in-loop
          const ph = (await page.evaluate(`(() => globalThis.__openClinXrBedsideApproachEvidence?.phase ?? null)()`)) as string | null;
          if (ph === "walking") break;
        }
        let frame = 0;
        for (const shot of SHOTS) {
          while (frame < shot.at) {
            // eslint-disable-next-line no-await-in-loop
            await page.clock.fastForward(STEP * 1000);
            frame += 1;
          }
          const pose = POSES[shot.pose];
          // eslint-disable-next-line no-await-in-loop
          await page.evaluate(`${PLACE}(${JSON.stringify(pose)})`);
          // eslint-disable-next-line no-await-in-loop
          await page.clock.fastForward(STEP * 1000);
          frame += 1;
          // eslint-disable-next-line no-await-in-loop
          await page.screenshot({ path: path.join(outDir, `probe-${shot.name}.png`), type: "png" });
          process.stdout.write(`[camprobe] shot ${shot.name} at frame ${frame}\n`);
        }
      } finally {
        await context?.close();
      }
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
