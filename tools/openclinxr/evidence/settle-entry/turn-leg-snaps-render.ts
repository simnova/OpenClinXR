/**
 * Turn-leg-snaps render (2026-10-12 slice): quarter-speed side clip of the
 * SC-05 stepping turn. Steps the scene under the fake clock exactly like
 * settle-entry-capture.ts, screenshots every settling/arrived frame, and
 * assembles them with ffmpeg at 7.5 fps (0.25x slow motion) so thigh
 * distortion is visible. Garments stay on (default scene).
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/settle-entry/turn-leg-snaps-render.ts \
 *     --out=.openclinxr/evidence/turn-leg-snaps/clip-fix --tag=fix
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "../lib/slotted-playwright.js";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";

const STEP_SECONDS = 1 / 30;
const STEP_CAP = 1500;
const FFMPEG = "/opt/homebrew/bin/ffmpeg";

function argValue(name: string): string {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!flag) throw new Error(`usage: turn-leg-snaps-render.ts --out=dir --tag=name`);
  return flag;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PHASE_SOURCE = `(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  return ev ? { phase: ev.phase, stoppedSeconds: ev.stoppedSeconds } : null;
})()`;

/** Cheapest norm signal: hip/knee local-quat norms off the debug scene. */
const LEGNORM_SOURCE = `(() => {
  const scene = globalThis.__openClinXrDebugScene;
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  if (!scene) return null;
  const actorId = ev ? ev.physicianActorId : null;
  let physRoot = null;
  scene.traverse((o) => {
    if (physRoot) return;
    const ud = o.userData || {};
    if (actorId && ud.openClinXrActorId === actorId) {
      let a = o;
      while (a.parent && a.parent !== scene) a = a.parent;
      physRoot = a;
    }
  });
  if (!physRoot) return null;
  const normOf = (n) => {
    const bone = physRoot.getObjectByName(n);
    if (!bone) return null;
    const q = bone.quaternion;
    return Math.hypot(q.x, q.y, q.z, q.w);
  };
  return { hipL: normOf("upperleg01L"), kneeL: normOf("lowerleg01L") };
})()`;

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
    await services.sceneCapture.withBrowser(`turn-leg-render-${tag}`, async (browser) => {
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
        // Pre-walk fast-forward to settling (no screenshots).
        let step = 0;
        for (;;) {
          await page.clock.fastForward(STEP_SECONDS * 1000);
          const s = (await page.evaluate(PHASE_SOURCE)) as { phase: string; stoppedSeconds: number } | null;
          step += 1;
          if (s?.phase === "settling" || s?.phase === "arrived") break;
          if (step >= STEP_CAP) throw new Error("never reached settling");
          if (step % 30 === 0) await realSleep(50);
        }
        // Screenshot every frame through settling + 1 s arrived.
        let kept = 0;
        let minHip = 1;
        let minKnee = 1;
        for (;;) {
          await page.clock.fastForward(STEP_SECONDS * 1000);
          const s = (await page.evaluate(PHASE_SOURCE)) as { phase: string; stoppedSeconds: number } | null;
          if (s?.phase !== "settling" && s?.phase !== "arrived") break;
          kept += 1;
          await page.screenshot({ path: path.join(outDir, `frame-${String(kept).padStart(4, "0")}.png`), type: "png" });
          const norms = (await page.evaluate(LEGNORM_SOURCE)) as { hipL: number | null; kneeL: number | null } | null;
          if (norms?.hipL !== null && norms?.hipL !== undefined) minHip = Math.min(minHip, norms.hipL);
          if (norms?.kneeL !== null && norms?.kneeL !== undefined) minKnee = Math.min(minKnee, norms.kneeL);
          if (kept % 20 === 0) process.stdout.write(`[${tag}] kept ${kept}\n`);
          if (s.phase === "arrived" && (s.stoppedSeconds ?? 0) >= 1) break;
          if (kept >= 300) throw new Error("clip overrun");
        }
        process.stdout.write(`[${tag}] frames=${kept} minHip=${minHip.toFixed(4)} minKnee=${minKnee.toFixed(4)}\n`);
        await ffmpeg([
          "-y",
          "-framerate",
          "7.5",
          "-i",
          path.join(outDir, "frame-%04d.png"),
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          path.join(outDir, `${tag}-0.25x.mp4`),
        ]);
        process.stdout.write(`[${tag}] wrote ${tag}-0.25x.mp4\n`);
        await writeFile(path.join(outDir, `${tag}-frames.txt`), String(kept));
      } finally {
        await context?.close();
      }
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
