/**
 * Arms-slice video + still capture (DENSE_v1, 2026-10-19): dressed SC-05
 * plain-URL run, world-fixed three-quarter camera from first walking frame
 * through arrival, assembled at 30 fps; then a front-view still at arrival
 * (actor standing, settled). Garments stay on (default scene).
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/arms/arms-video-capture.ts \
 *     --out=.openclinxr/evidence/arms/after --tag=physician
 *
 * Writes <out>/<tag>-three-quarter.mp4, <tag>-arrival-front.png,
 * <tag>-arrival-three-quarter.png. NOT for commit (evidence).
 */
import { execFile } from "node:child_process";
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

const STEP_SECONDS = 1 / 30;
const STEP_CAP = 1500;
const FFMPEG = "/opt/homebrew/bin/ffmpeg";

type Vec3 = { x: number; y: number; z: number };

function argValue(name: string): string {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!flag) throw new Error(`usage: arms-video-capture.ts --out=dir --tag=name`);
  return flag;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STATE_SOURCE = `(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  if (!ev) return null;
  const samples = ev.samples || [];
  const tail = samples.length ? samples[samples.length - 1] : null;
  return {
    phase: ev.phase,
    stoppedSeconds: ev.stoppedSeconds,
    slot: tail && tail.slot ? tail.slot : null,
    startWorld: ev.startWorld || null,
    targetWorld: ev.targetWorld || null,
  };
})()`;

const PLACE_CAMERA_SOURCE = `((pose) => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false, reason: "no-debug-scene" };
  let cam = null;
  scene.traverse((o) => {
    if (!cam && (o.isPerspectiveCamera || o.type === "PerspectiveCamera")) cam = o;
  });
  if (!cam) return { ok: false, reason: "no-camera" };
  cam.fov = pose.fov;
  if (typeof cam.updateProjectionMatrix === "function") cam.updateProjectionMatrix();
  const v = cam.position.clone();
  v.set(pose.eye.x, pose.eye.y, pose.eye.z);
  if (cam.parent) {
    cam.parent.updateWorldMatrix(true, false);
    const inv = cam.parent.matrixWorld.clone().invert();
    v.applyMatrix4(inv);
  }
  cam.position.copy(v);
  if (cam.parent) cam.parent.updateWorldMatrix(true, false);
  if (typeof cam.lookAt === "function") cam.lookAt(pose.look.x, pose.look.y, pose.look.z);
  if (typeof cam.updateMatrixWorld === "function") cam.updateMatrixWorld(true);
  return { ok: true };
})`;

async function placeCamera(
  page: Page,
  eye: Vec3,
  look: Vec3,
  fov: number,
): Promise<void> {
  const res = (await page.evaluate(
    `${PLACE_CAMERA_SOURCE}(${JSON.stringify({ eye, look, fov })})`,
  )) as { ok: boolean; reason?: string };
  if (!res.ok) throw new Error(`place-camera failed: ${res.reason ?? "unknown"}`);
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  const outDir = argValue("out");
  const tag = argValue("tag");
  await mkdir(outDir, { recursive: true });
  const bundleJson = buildSceneClosureBundleJson();
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const services = createLocalComputeServices();
  try {
    await services.sceneCapture.withBrowser(`arms-video-${tag}`, async (browser) => {
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
        await realSleep(1500);
        // Advance to the first walking frame (no screenshots before the walk).
        let step = 0;
        for (;;) {
          await page.clock.fastForward(STEP_SECONDS * 1000);
          const s = (await page.evaluate(STATE_SOURCE)) as {
            phase: string | null;
            slot: { x: number; y: number; z: number; yaw: number } | null;
            startWorld: Vec3 | null;
            targetWorld: Vec3 | null;
          } | null;
          step += 1;
          if (s?.phase === "walking") break;
          if (step >= STEP_CAP) throw new Error("never reached walking");
          if (step % 30 === 0) await realSleep(50);
        }
        const first = (await page.evaluate(STATE_SOURCE)) as {
          slot: { x: number; y: number; z: number; yaw: number };
          startWorld: Vec3;
          targetWorld: Vec3;
        };
        void first;
        // Tracking three-quarter camera: recomputed every frame from the
        // actor slot (small room: a world-fixed pose risks a wall). Offset
        // in the actor frame: front 1.3 m, right 1.6 m, height 1.55 m,
        // looking at the chest. Deterministic under the fake clock.
        const trackCam = async (): Promise<void> => {
          const s = (await page.evaluate(STATE_SOURCE)) as {
            slot: { x: number; y: number; z: number; yaw: number } | null;
          } | null;
          const slot = s?.slot;
          if (!slot) return;
          const sy = Math.sin(slot.yaw);
          const cy = Math.cos(slot.yaw);
          // Actor-frame offset (fz, fx) -> world: x' = fz*sy + fx*cy? Use
          // yaw rotation: world = R(yaw) * local, R(yaw) x' = x*cos+z*sin.
          const lx = 1.6;
          const lz = 1.3;
          const eye = {
            x: slot.x + lx * cy + lz * sy,
            y: 1.55,
            z: slot.z - lx * sy + lz * cy,
          };
          await placeCamera(page, eye, { x: slot.x, y: 1.0, z: slot.z }, 50);
        };
        await trackCam();
        // Screenshot every frame: walking + settling + 45 arrived frames.
        let kept = 0;
        let arrived = 0;
        for (;;) {
          await page.clock.fastForward(STEP_SECONDS * 1000);
          const s = (await page.evaluate(STATE_SOURCE)) as { phase: string | null } | null;
          if (s?.phase !== "walking" && s?.phase !== "settling" && s?.phase !== "arrived") break;
          kept += 1;
          await trackCam();
          await page.screenshot({ path: path.join(outDir, `${tag}-frame-${String(kept).padStart(4, "0")}.png`), type: "png" });
          if (s?.phase === "arrived") arrived += 1;
          if (arrived >= 45) break;
          if (kept >= 400) throw new Error("clip overrun");
          if (kept % 40 === 0) process.stdout.write(`[${tag}] kept ${kept}\n`);
        }
        process.stdout.write(`[${tag}] video frames=${kept}\n`);
        await ffmpeg([
          "-y",
          "-framerate",
          "30",
          "-i",
          path.join(outDir, `${tag}-frame-%04d.png`),
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          path.join(outDir, `${tag}-three-quarter.mp4`),
        ]);
        // Arrival three-quarter still = final tracking frame; then front
        // still: camera on the facing side looking back at the actor.
        await page.screenshot({ path: path.join(outDir, `${tag}-arrival-three-quarter.png`), type: "png" });
        const now = (await page.evaluate(STATE_SOURCE)) as {
          slot: { x: number; y: number; z: number; yaw: number } | null;
        };
        const slotNow = now.slot;
        if (!slotNow) throw new Error("no slot at arrival");
        const fx = Math.sin(slotNow.yaw);
        const fz = Math.cos(slotNow.yaw);
        await placeCamera(
          page,
          { x: slotNow.x + fx * 2.2, y: 1.5, z: slotNow.z + fz * 2.2 },
          { x: slotNow.x, y: 1.0, z: slotNow.z },
          45,
        );
        await realSleep(150);
        await page.screenshot({ path: path.join(outDir, `${tag}-arrival-front.png`), type: "png" });
        process.stdout.write(`[${tag}] wrote video + stills\n`);
      } finally {
        await context?.close();
      }
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
