/**
 * Foot-plant evidence capture for an ORDER-DRIVEN walker (`locomotion-order-mod.ts`), the
 * `--walker=<actorId>` sibling of `foot-plant-video-capture.ts`.
 *
 * WHY A SEPARATE SCRIPT, NOT A FLAG ON THAT ONE. `foot-plant-video-capture.ts` reads
 * `window.__openClinXrBedsideApproachEvidence`, a global the frozen-plan producer
 * (`station-bedside-approach-mod.ts`, turn-owned) publishes only for the physician's own
 * bedside approach -- it carries frozen-plan-specific fields (target headings, executor phase
 * names) that an order-driven walker never produces. `locomotion-order-mod.ts` (this package,
 * mine) publishes its OWN evidence global, `window.__openClinXrLocomotionOrderEvidence`, keyed
 * by actorId, in the SAME sample shape (`atMs`, `phase`, toe world XYZ, `stanceFoot`,
 * `correctionMeters`) so `walk-quality-metrics.ts`'s stance-window/quality math -- already
 * generic over `{frames, stanceWindows}` -- applies unchanged. Reusing that file's 2500-line
 * camera-framing/video-assembly machinery (built for the physician's fixed frozen-plan cameras
 * and its own drive-swap flag) for an arbitrary walk target risked destabilising a heavily-tuned
 * capture pipeline for a narrower proof; this script is deliberately small.
 *
 * claimScope: runtime displayed toe positions of the named order-driven actor while her
 * `LocomotionOrder` runs, plus a still-frame check that she is not inside a fixture at any
 * sampled moment.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance, the physician's own
 * frozen-plan approach (unaffected by this walker; see the sibling capture for his metrics).
 */

import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { newEvidencePage } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
  SCENE_CLOSURE_PHYSICIAN_ACTOR_ID,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";
import { computeWalkQuality, type QualityInput, type WalkQuality } from "./walk-quality-metrics.js";

const OUTPUT_DIR = ".openclinxr/evidence/order-driven-walker-video";
const DEFAULT_WALKER_ACTOR_ID = "ward_nurse_patel_v1";
const MAX_WAIT_SECONDS = 30;
const FFMPEG = "/opt/homebrew/bin/ffmpeg";
/** Frame stills kept on disk beside the video, not every simulated frame -- see main()'s comment. */
const KEEP_STILL_EVERY_N_FRAMES = 5;

type Vec3 = { x: number; y: number; z: number };
type OrderEvidenceSample = {
  atMs: number;
  phase: "walking" | "arrived";
  left: Vec3 | null;
  right: Vec3 | null;
  stanceFoot: "left" | "right" | null;
  correctionMeters: { x: number; z: number };
};

/**
 * Maximal consecutive runs of samples carrying the same non-null `stanceFoot` -- the SAME
 * definition `foot-plant-video-capture.ts`'s own `detectStanceWindows` uses (not exported there;
 * this is the shortest faithful copy rather than a larger cross-file refactor for one caller).
 */
function detectStanceWindows(samples: readonly OrderEvidenceSample[]): QualityInput["stanceWindows"] {
  const windows: QualityInput["stanceWindows"] = [];
  let run: OrderEvidenceSample[] = [];
  let runFoot: "left" | "right" | null = null;
  const xzSpan = (points: readonly Vec3[]): number => {
    let maxX = -Infinity, minX = Infinity, maxZ = -Infinity, minZ = Infinity;
    for (const p of points) {
      maxX = Math.max(maxX, p.x); minX = Math.min(minX, p.x);
      maxZ = Math.max(maxZ, p.z); minZ = Math.min(minZ, p.z);
    }
    return Math.hypot(maxX - minX, maxZ - minZ);
  };
  const flush = (): void => {
    if (run.length >= 1 && runFoot !== null) {
      const pts = run.map((s) => (runFoot === "left" ? s.left : s.right));
      if (pts.every((p): p is Vec3 => p !== null)) {
        const steps: number[] = [];
        for (let i = 1; i < run.length; i += 1) {
          steps.push(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
        }
        const pinnedIdx = new Set<number>();
        steps.forEach((step, i) => {
          if (step < 0.01) { pinnedIdx.add(i); pinnedIdx.add(i + 1); }
        });
        const pinnedPts = [...pinnedIdx].map((i) => pts[i]!);
        windows.push({
          foot: runFoot,
          pinnedFrames: pinnedIdx.size,
          holdSlideMeters: pinnedPts.length >= 2 ? xzSpan(pinnedPts) : 0,
        });
      }
    }
    run = [];
    runFoot = null;
  };
  for (const sample of samples) {
    const foot = sample.stanceFoot;
    if ((foot === "left" || foot === "right") && sample.left !== null && sample.right !== null) {
      if (runFoot === null) runFoot = foot;
      if (foot !== runFoot) flush();
      if (runFoot === null) runFoot = foot;
      run.push(sample);
    } else {
      flush();
    }
  }
  flush();
  return windows;
}

function walkerActorId(): string {
  const flag = process.argv.find((arg) => arg.startsWith("--walker="));
  if (flag) return flag.slice("--walker=".length);
  return process.env.FOOT_PLANT_WALKER_ACTOR_ID ?? DEFAULT_WALKER_ACTOR_ID;
}

async function main(): Promise<void> {
  const actorId = walkerActorId();
  await mkdir(OUTPUT_DIR, { recursive: true });
  const bundleJson = buildSceneClosureBundleJson();
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newEvidencePage(browser, { viewport: { width: 1280, height: 720 } });
    // Flip the opt-in evidence flag BEFORE main.ts's first frame so no sample is missed.
    await page.addInitScript(() => {
      (globalThis as Record<string, unknown>)["__openClinXrLocomotionOrderEvidenceEnabled"] = true;
    });
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    // FIXED-STEP FAKE CLOCK, same discipline as `foot-plant-video-capture.ts`'s own walking loop
    // (this file's header explains why: real-time headless rAF pacing is irregular -- measured on
    // this actor's own first, real-time-polled run: 73 frames over 30 wall seconds, most of them
    // large uneven jumps, which manufactured a 22x lurch and a 273 steps/min cadence that were
    // capture-rig artifacts, not the walk). `page.clock.pauseAt` freezes Date so `deltaSeconds`
    // reads a clean 1/30 s every tick instead of whatever real wall time happened to elapse.
    await page.clock.install();
    await page.goto(buildSceneClosureUrl(server.url), { waitUntil: "load", timeout: 180_000 });
    const pinMs = (await page.evaluate(() => Date.now())) as number;
    await page.clock.pauseAt(pinMs + 2000);

    // FRAME-BY-FRAME CAPTURE, walk start through arrival, for the coordinator's own grading (not
    // just a metrics report): one screenshot every simulated frame, assembled into an mp4 with
    // ffmpeg at the SAME 30 fps the fake clock steps at -- so real time in the video matches
    // simulated time in the evidence JSON. A representative subset of the raw PNGs (every
    // `KEEP_STILL_EVERY_N_FRAMES`th, plus the very first and last) is kept on disk beside the
    // video rather than all of them, so a reviewer can open one still without decoding the mp4.
    const stagingDir = path.join(OUTPUT_DIR, `${actorId}-frames-staging`);
    await mkdir(stagingDir, { recursive: true });
    const stillsDir = path.join(OUTPUT_DIR, `${actorId}-stills`);
    await mkdir(stillsDir, { recursive: true });
    let samples: OrderEvidenceSample[] = [];
    let arrivedAt: number | null = null;
    const STEP_MS = 1000 / 30;
    let frameIndex = 0;
    for (let step = 0; step < (MAX_WAIT_SECONDS * 1000) / STEP_MS; step += 1) {
      await page.clock.fastForward(STEP_MS);
      await page.waitForTimeout(30); // real settle: the compositor/rAF fires in wall time.
      samples = await page.evaluate((id: string) => {
        const byActor = (globalThis as Record<string, unknown>)["__openClinXrLocomotionOrderEvidence"] as
          | Record<string, OrderEvidenceSample[]>
          | undefined;
        return byActor?.[id] ?? [];
      }, actorId);
      const frameFile = path.join(stagingDir, `frame-${String(frameIndex).padStart(4, "0")}.png`);
      const buf = await page.screenshot();
      await writeFile(frameFile, buf);
      const arrived = samples.length > 0 && samples[samples.length - 1]!.phase === "arrived";
      if (frameIndex % KEEP_STILL_EVERY_N_FRAMES === 0 || arrived) {
        await writeFile(path.join(stillsDir, `still-${String(frameIndex).padStart(4, "0")}.png`), buf);
      }
      frameIndex += 1;
      if (arrived) {
        arrivedAt = samples[samples.length - 1]!.atMs;
        break;
      }
    }
    const totalFrames = frameIndex;

    // Native-frame still: both actors visible, for a clipping check by eye (arrival, or last
    // captured frame if she never arrived).
    const stillPath = path.join(OUTPUT_DIR, `${actorId}-arrival.png`);
    await page.screenshot({ path: stillPath });

    const videoPath = path.join(OUTPUT_DIR, `${actorId}-walk.mp4`);
    execFileSync(FFMPEG, [
      "-y", "-framerate", "30",
      "-i", path.join(stagingDir, "frame-%04d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      videoPath,
    ]);
    await rm(stagingDir, { recursive: true, force: true });

    const frames: QualityInput["frames"] = samples.map((s) => ({
      tMs: s.atMs,
      phase: s.phase === "walking" ? "walking" : "arrived",
      left: s.left,
      right: s.right,
    }));
    const stanceWindows = detectStanceWindows(samples);
    const quality: WalkQuality | null = frames.some((f) => f.phase === "walking")
      ? computeWalkQuality({ frames, stanceWindows })
      : null;

    const report = {
      schemaVersion: "openclinxr.order-driven-walker-video.v1" as const,
      measuredAt: new Date().toISOString(),
      actorId,
      physicianActorId: SCENE_CLOSURE_PHYSICIAN_ACTOR_ID,
      sampleCount: samples.length,
      arrivedWithinTimeoutMs: arrivedAt,
      timedOutWithoutArrival: arrivedAt === null,
      lastSample: samples[samples.length - 1] ?? null,
      quality,
      videoPath,
      totalVideoFrames: totalFrames,
      videoFps: 30,
      stillPath,
      stillsDir,
      claimScope:
        "runtime displayed toe positions of the named order-driven actor while her LocomotionOrder runs",
      notEvidenceFor: ["gait_realism", "clinical_plausibility", "quest_performance", "physician_metrics"],
    };
    const reportPath = path.join(OUTPUT_DIR, `${actorId}-report.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\n[order-driven-walker-video-capture] wrote ${reportPath}, ${videoPath}, ${stillsDir}, ${stillPath}\n`);
  } finally {
    await browser.close();
    await stopPortlessDevServer(server.proc);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
