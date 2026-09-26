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
 * generic over `{frames, stanceWindows}` -- applies unchanged.
 *
 * CAMERA: a DRY PASS (no screenshots) runs the walk once to measure her actual route bounds
 * (every sampled toe position, start through arrival), then TWO fresh RECORD passes -- feet-side
 * and three-quarter, the same two framings `foot-plant-video-capture.ts` produces for the
 * physician -- each with the UI panel hidden and the camera placed ONCE from those bounds (plus
 * margin) and held fixed for the whole clip, exactly as asked: aimed at the route, not a generic
 * wide shot that loses her once she leaves a fixed default view.
 *
 * ORDER SOURCE: no shipped case authors a `locomotionOrders` entry (an authored order walked the
 * nurse straight through the scene_closure shelving unit with no obstacle check -- removed from
 * `createEdChestPainRuntimeSceneManifest` until the routed executor lands). This capture injects
 * ONE synthetic order into the served bundle JSON, capture-only, via `withCaptureOnlyLocomotionOrder`
 * -- it mutates the JSON this script serves over `page.route`, never the case data the production
 * runtime ships. `--no-inject-order` disables it, to prove the shipped bundle carries none.
 *
 * claimScope: runtime displayed toe positions of the named order-driven actor while her
 * `LocomotionOrder` runs, framed on her own measured route, from walk start through arrival.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance, the physician's own
 * frozen-plan approach (unaffected by this walker; see the sibling capture for his metrics), and
 * (until Part B lands) obstacle avoidance -- the injected order has no path validation.
 */

import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
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
const STEP_MS = 1000 / 30;
/** Metres of clearance added around the measured toe-position bounding box before framing it. */
const ROUTE_MARGIN_METERS = 0.9;

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

/**
 * No shipped case authors a `locomotionOrders` entry (removed from
 * `createEdChestPainRuntimeSceneManifest` -- an authored order walked the nurse through the
 * scene_closure shelving unit with no obstacle check yet). This capture's whole purpose is
 * exercising the order-driven walker, so it injects one synthetic order into the SERVED bundle
 * JSON, capture-only -- it never touches the case data the production runtime ships. Disable with
 * `--no-inject-order` to prove the shipped bundle really carries none (Part A's own claim).
 */
function injectCaptureOnlyOrderFlag(): boolean {
  return !process.argv.includes("--no-inject-order");
}

/** `actorId -> actorRole` for the one case this capture drives; see `cast-actor-ids.ts`. */
const CAPTURE_ONLY_ACTOR_ROLE: Record<string, string> = {
  ward_nurse_patel_v1: "nurse",
  senior_resident_ward_v1: "physician",
};

function withCaptureOnlyLocomotionOrder(bundleJson: string, actorId: string): string {
  const role = CAPTURE_ONLY_ACTOR_ROLE[actorId];
  if (!role) {
    throw new Error(
      `no capture-only actorRole mapping for "${actorId}" -- add one to CAPTURE_ONLY_ACTOR_ROLE`,
    );
  }
  const bundle = JSON.parse(bundleJson) as { sceneManifest: { locomotionOrders?: unknown } };
  bundle.sceneManifest.locomotionOrders = [
    { actorRole: role, targetOffsetMeters: { x: 1.2, z: 0 }, ageYears: 46, buildKey: "average" },
  ];
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

const HIDE_UI_SOURCE = String.raw`
(() => {
  const canvas = document.querySelector("#station-canvas");
  if (!canvas) return "no-canvas";
  const keeps = new Set();
  let el = canvas;
  while (el) { keeps.add(el); el = el.parentElement; }
  document.querySelectorAll("body *").forEach((node) => {
    if (!keeps.has(node)) node.style.setProperty("display", "none", "important");
  });
  canvas.style.setProperty("position", "fixed", "important");
  canvas.style.setProperty("left", "0", "important");
  canvas.style.setProperty("top", "0", "important");
  canvas.style.setProperty("width", "1280px", "important");
  canvas.style.setProperty("height", "720px", "important");
  canvas.style.setProperty("margin", "0", "important");
  document.body.style.setProperty("margin", "0", "important");
  document.body.style.setProperty("overflow", "hidden", "important");
  return "hidden";
})()
`;

async function hideDomUi(page: Page): Promise<void> {
  await page.addStyleTag({
    content: [
      "html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important}",
      "#station-canvas{position:fixed!important;left:0!important;top:0!important;width:1280px!important;height:720px!important}",
    ].join("\n"),
  });
  await page.evaluate(HIDE_UI_SOURCE);
}

/** Same mechanism `foot-plant-video-capture.ts`'s own `PLACE_CAMERA_SOURCE` uses (not exported
 * there; the shortest faithful copy for this second caller). */
const PLACE_CAMERA_SOURCE = String.raw`
((pose) => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false, reason: "no-debug-scene" };
  let cam = null;
  scene.traverse((o) => {
    if (!cam && (o.isPerspectiveCamera || o.type === "PerspectiveCamera")) cam = o;
  });
  if (!cam) return { ok: false, reason: "no-camera" };
  if (typeof cam.fov === "number" && cam.fov !== pose.fov) {
    cam.fov = pose.fov;
    if (typeof cam.updateProjectionMatrix === "function") cam.updateProjectionMatrix();
  }
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
  const e = cam.matrixWorld.elements;
  return { ok: true, world: [e[12], e[13], e[14]] };
})
`;

type CameraPose = { eye: Vec3; look: Vec3; fov: number };

async function placeCamera(page: Page, pose: CameraPose): Promise<void> {
  await page.evaluate(`${PLACE_CAMERA_SOURCE}(${JSON.stringify(pose)})`);
}

type RouteBounds = { minX: number; maxX: number; minZ: number; maxZ: number; startX: number; startZ: number; endX: number; endZ: number };

/** Run the walk once with the fake clock, evidence only, no screenshots, to measure her route. */
async function measureRouteBounds(page: Page, actorId: string): Promise<RouteBounds> {
  let samples: OrderEvidenceSample[] = [];
  for (let step = 0; step < (MAX_WAIT_SECONDS * 1000) / STEP_MS; step += 1) {
    await page.clock.fastForward(STEP_MS);
    await page.waitForTimeout(20);
    samples = await page.evaluate((id: string) => {
      const byActor = (globalThis as Record<string, unknown>)["__openClinXrLocomotionOrderEvidence"] as
        | Record<string, OrderEvidenceSample[]>
        | undefined;
      return byActor?.[id] ?? [];
    }, actorId);
    if (samples.length > 0 && samples[samples.length - 1]!.phase === "arrived") break;
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of samples) {
    for (const toe of [s.left, s.right]) {
      if (toe === null) continue;
      minX = Math.min(minX, toe.x); maxX = Math.max(maxX, toe.x);
      minZ = Math.min(minZ, toe.z); maxZ = Math.max(maxZ, toe.z);
    }
  }
  const first = samples.find((s) => s.left !== null || s.right !== null);
  const last = [...samples].reverse().find((s) => s.left !== null || s.right !== null);
  const midXz = (s: OrderEvidenceSample | undefined): { x: number; z: number } => {
    if (!s) return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    const pts = [s.left, s.right].filter((p): p is Vec3 => p !== null);
    return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length };
  };
  const start = midXz(first);
  const end = midXz(last);
  if (!Number.isFinite(minX)) { minX = start.x; maxX = start.x; minZ = start.z; maxZ = start.z; }
  return { minX, maxX, minZ, maxZ, startX: start.x, startZ: start.z, endX: end.x, endZ: end.z };
}

/** feet-side: low, close, perpendicular to the route direction. three-quarter: elevated, angled. */
function cameraPosesFor(bounds: RouteBounds): { feetSide: CameraPose; threeQuarter: CameraPose } {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midZ = (bounds.minZ + bounds.maxZ) / 2;
  const dx = bounds.endX - bounds.startX;
  const dz = bounds.endZ - bounds.startZ;
  const routeLength = Math.max(0.3, Math.hypot(dx, dz));
  const ux = routeLength > 0 ? dx / routeLength : 1;
  const uz = routeLength > 0 ? dz / routeLength : 0;
  const perpX = -uz;
  const perpZ = ux;
  const halfSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + ROUTE_MARGIN_METERS;
  const sideDistance = Math.max(1.6, halfSpan * 1.6);
  return {
    feetSide: {
      eye: { x: midX + perpX * sideDistance, y: 0.55, z: midZ + perpZ * sideDistance },
      look: { x: midX, y: 0.15, z: midZ },
      fov: 50,
    },
    threeQuarter: {
      eye: {
        x: midX + perpX * sideDistance * 0.75 - ux * sideDistance * 0.6,
        y: 1.9,
        z: midZ + perpZ * sideDistance * 0.75 - uz * sideDistance * 0.6,
      },
      look: { x: midX, y: 0.9, z: midZ },
      fov: 55,
    },
  };
}

/** One fixed-camera recording pass: hide UI, place the camera once, capture every frame. */
async function recordPass(
  browser: Browser,
  server: { url: string },
  bundleJson: string,
  actorId: string,
  pose: CameraPose,
  mode: "feet-side" | "three-quarter",
): Promise<{ frames: number; arrivedAt: number | null; samples: OrderEvidenceSample[]; videoPath: string; stillPath: string }> {
  const page = await newEvidencePage(browser, { viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    (globalThis as Record<string, unknown>)["__openClinXrLocomotionOrderEvidenceEnabled"] = true;
  });
  await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
  });
  await page.clock.install();
  await page.goto(buildSceneClosureUrl(server.url), { waitUntil: "load", timeout: 180_000 });
  const pinMs = (await page.evaluate(() => Date.now())) as number;
  await page.clock.pauseAt(pinMs + 2000);
  await hideDomUi(page);
  await placeCamera(page, pose);

  const stagingDir = path.join(OUTPUT_DIR, `${actorId}-${mode}-staging`);
  await mkdir(stagingDir, { recursive: true });

  let samples: OrderEvidenceSample[] = [];
  let arrivedAt: number | null = null;
  let frameIndex = 0;
  for (let step = 0; step < (MAX_WAIT_SECONDS * 1000) / STEP_MS; step += 1) {
    await placeCamera(page, pose); // held fixed every frame -- some render paths reset camera transform on load.
    await page.clock.fastForward(STEP_MS);
    await page.waitForTimeout(30);
    samples = await page.evaluate((id: string) => {
      const byActor = (globalThis as Record<string, unknown>)["__openClinXrLocomotionOrderEvidence"] as
        | Record<string, OrderEvidenceSample[]>
        | undefined;
      return byActor?.[id] ?? [];
    }, actorId);
    const buf = await page.screenshot();
    await writeFile(path.join(stagingDir, `frame-${String(frameIndex).padStart(4, "0")}.png`), buf);
    frameIndex += 1;
    const arrived = samples.length > 0 && samples[samples.length - 1]!.phase === "arrived";
    if (arrived) {
      arrivedAt = samples[samples.length - 1]!.atMs;
      // A few extra held frames at rest so the video does not cut the instant she stops.
      for (let hold = 0; hold < 15; hold += 1) {
        await placeCamera(page, pose);
        const heldBuf = await page.screenshot();
        await writeFile(path.join(stagingDir, `frame-${String(frameIndex).padStart(4, "0")}.png`), heldBuf);
        frameIndex += 1;
      }
      break;
    }
  }
  const stillPath = path.join(OUTPUT_DIR, `${actorId}-${mode}-arrival.png`);
  await page.screenshot({ path: stillPath });
  await page.close();

  const videoPath = path.join(OUTPUT_DIR, `${actorId}-${mode}.mp4`);
  execFileSync(FFMPEG, [
    "-y", "-framerate", "30",
    "-i", path.join(stagingDir, "frame-%04d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    videoPath,
  ]);
  await rm(stagingDir, { recursive: true, force: true });

  return { frames: frameIndex, arrivedAt, samples, videoPath, stillPath };
}

async function main(): Promise<void> {
  const actorId = walkerActorId();
  await mkdir(OUTPUT_DIR, { recursive: true });
  const shippedBundleJson = buildSceneClosureBundleJson();
  const bundleJson = injectCaptureOnlyOrderFlag()
    ? withCaptureOnlyLocomotionOrder(shippedBundleJson, actorId)
    : shippedBundleJson;
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const browser = await chromium.launch({ headless: true });
  try {
    // DRY PASS: measure the route, no screenshots, so the two record passes can frame a camera on
    // it instead of guessing a generic wide shot.
    const dryPage = await newEvidencePage(browser, { viewport: { width: 1280, height: 720 } });
    await dryPage.addInitScript(() => {
      (globalThis as Record<string, unknown>)["__openClinXrLocomotionOrderEvidenceEnabled"] = true;
    });
    await dryPage.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    await dryPage.clock.install();
    await dryPage.goto(buildSceneClosureUrl(server.url), { waitUntil: "load", timeout: 180_000 });
    const pinMs = (await dryPage.evaluate(() => Date.now())) as number;
    await dryPage.clock.pauseAt(pinMs + 2000);
    const bounds = await measureRouteBounds(dryPage, actorId);
    await dryPage.close();
    process.stdout.write(`[dry] route bounds: ${JSON.stringify(bounds)}\n`);
    if (Number.isNaN(bounds.startX)) {
      // No locomotion order ran (`--no-inject-order`, or a shipped bundle that authors none):
      // zero toe samples were published, so there is no route to frame a camera on. This IS the
      // proof `--no-inject-order` exists to produce -- report it plainly instead of crashing on
      // a NaN camera pose.
      process.stdout.write(
        `[dry] no walk observed for "${actorId}" -- shipped bundle authors no locomotionOrders `
          + "entry for this actor (or --no-inject-order was passed). Nothing to record.\n",
      );
      return;
    }

    const poses = cameraPosesFor(bounds);
    const feetSide = await recordPass(browser, server, bundleJson, actorId, poses.feetSide, "feet-side");
    process.stdout.write(`[feet-side] ${feetSide.frames} frames, arrivedAt=${feetSide.arrivedAt}\n`);
    const threeQuarter = await recordPass(browser, server, bundleJson, actorId, poses.threeQuarter, "three-quarter");
    process.stdout.write(`[three-quarter] ${threeQuarter.frames} frames, arrivedAt=${threeQuarter.arrivedAt}\n`);

    const samples = feetSide.samples;
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
      schemaVersion: "openclinxr.order-driven-walker-video.v2" as const,
      measuredAt: new Date().toISOString(),
      actorId,
      physicianActorId: SCENE_CLOSURE_PHYSICIAN_ACTOR_ID,
      routeBounds: bounds,
      cameraPoses: poses,
      sampleCount: samples.length,
      arrivedWithinTimeoutMs: feetSide.arrivedAt,
      timedOutWithoutArrival: feetSide.arrivedAt === null,
      lastSample: samples[samples.length - 1] ?? null,
      quality,
      videos: { feetSide: feetSide.videoPath, threeQuarter: threeQuarter.videoPath },
      stills: { feetSide: feetSide.stillPath, threeQuarter: threeQuarter.stillPath },
      videoFps: 30,
      claimScope:
        "runtime displayed toe positions of the named order-driven actor while her LocomotionOrder runs, "
        + "framed on her own measured route from walk start through arrival",
      notEvidenceFor: ["gait_realism", "clinical_plausibility", "quest_performance", "physician_metrics"],
    };
    const reportPath = path.join(OUTPUT_DIR, `${actorId}-report.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `\n[order-driven-walker-video-capture] wrote ${reportPath}, ${feetSide.videoPath}, ${threeQuarter.videoPath}\n`,
    );
  } finally {
    await browser.close();
    await stopPortlessDevServer(server.proc);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
