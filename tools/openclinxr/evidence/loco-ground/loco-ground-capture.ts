/**
 * Locomotion proving-ground capture: one side follow-cam pass of the 6 m
 * `?locoGround=1` walk, reading the per-writer tap ring and runtime evidence.
 *
 * Rows: `--row=lockOff` (adds `noStanceLock=1`), `--row=twoBone` (shipped
 * lock), `--row=ccd` (adds `ccdStanceLock=1`). Usage:
 *   pnpm tsx tools/openclinxr/evidence/loco-ground/loco-ground-capture.ts --row=lockOff
 *
 * Clock/bundle discipline mirrors foot-plant-video-capture.ts (fake 30 fps
 * clock with hold + growth probes, scene-closure bundle/URL builders), and
 * the analysis reuses walk-slide-accounting.ts. Render is side body-only:
 * the room is hidden, a grid floor is added, garment/hair meshes are hidden
 * by name rule (discovery list printed every run), camera follows the slot
 * from the route side. Screenshots assemble to a 0.5x clip (15 fps playback
 * of 30 fps frames).
 *
 * claimScope: this browser's tap ring + toe tracks for one loco-ground row.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "../lib/slotted-playwright.js";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
  SCENE_CLOSURE_SCENARIO_ID,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";

const OUTPUT_ROOT = ".openclinxr/evidence/loco-ground";
const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const STEP_SECONDS = 1 / 30;
const PRE_WALK_STEP_MS = 100;
const STEP_CAP = 1200;
const DIST_FILES = [
  "packages/openclinxr/xr-humanoid-animation/dist/loco-ground-tap-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/stance-lock-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/case-owned-approach-frame-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/station-bedside-approach-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/animation-loop.js",
];
const DIST_MARKER = "__openClinXrLocoGroundTap";

type Row = "lockOff" | "twoBone" | "ccd";

function rowFromArgv(): Row {
  const flag = process.argv.find((a) => a.startsWith("--row="))?.slice("--row=".length);
  if (flag === "lockOff" || flag === "twoBone" || flag === "ccd") return flag;
  throw new Error("usage: loco-ground-capture.ts --row=lockOff|twoBone|ccd");
}

function rowFlag(row: Row): string {
  if (row === "lockOff") return "&noStanceLock=1";
  if (row === "ccd") return "&ccdStanceLock=1";
  return "";
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HIDE_UI_SOURCE = `
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

/** Follow-cam: world-fixed per frame from the slot the runtime published. */
const PLACE_CAMERA_SOURCE = `
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
  return { ok: true };
})
`;

/**
 * Isolate the physician, lay a route-long grid floor, hide garment/hair.
 * Prints the physician's skinned-mesh name census so the hide rule is
 * checkable; returns what was hidden.
 */
const LOCO_ISOLATE_SOURCE = `
((p) => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false, reason: "no-debug-scene" };
  let physRoot = null;
  scene.traverse((o) => {
    if (physRoot) return;
    const ud = o.userData || {};
    if (ud.openClinXrActorId === p.actorId) {
      let a = o;
      while (a.parent && a.parent !== scene) a = a.parent;
      physRoot = a;
    }
  });
  if (!physRoot) return { ok: false, reason: "no-physician-actor" };
  const keep = new Set();
  physRoot.traverse((o) => keep.add(o));
  let anc = physRoot;
  while (anc) { keep.add(anc); anc = anc.parent; }
  let hiddenCount = 0;
  scene.traverse((o) => {
    if (keep.has(o)) return;
    if (o.userData && o.userData.openClinXrLocoGroundFloor) { keep.add(o); return; }
    if (o.visible === false) return;
    if (o.isCamera || o.isLight) return;
    o.visible = false;
    hiddenCount += 1;
  });
  // Census first: every skinned mesh under the physician, then the hide rule.
  const skinned = [];
  physRoot.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o.name || "(unnamed)");
  });
  const hideRe = /hair|wig|garment|shirt|trouser|pant|shoe|boot|gown|scrub|cloth|dress|beard|brow|lash|sock|glove|cardigan|casual_top/i;
  const hiddenMeshes = [];
  physRoot.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (hideRe.test(o.name || "")) {
      o.visible = false;
      hiddenMeshes.push(o.name);
    }
  });
  // Floor: widest flat hidden shell, stretched to cover the route, with
  // 0.25 m grid strips over +/-4 m around the route midpoint.
  let donor = null;
  let donorW = -1;
  scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry || keep.has(o)) return;
    if (o.visible !== false) return;
    try {
      if (typeof o.geometry.computeBoundingBox === "function") o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if (!bb) return;
      const sx = (bb.max.x - bb.min.x) * (o.scale ? o.scale.x : 1);
      const sz = (bb.max.z - bb.min.z) * (o.scale ? o.scale.z : 1);
      const sy = (bb.max.y - bb.min.y) * (o.scale ? o.scale.y : 1);
      if (sy > Math.min(sx, sz) * 0.1) return;
      const w = Math.min(sx, sz);
      if (w > donorW) { donorW = w; donor = o; }
    } catch (err) { /* ignore */ }
  });
  let floorAdded = false;
  let gridLines = 0;
  if (donor) {
    const f = donor.clone();
    f.material = donor.material.clone();
    if (f.material && f.material.color) f.material.color.set(0x808080);
    if (f.material && f.material.emissive) f.material.emissive.set(0x202020);
    f.position.set(p.cx, p.floorY + 0.001, p.cz);
    f.rotation.set(0, 0, 0);
    const s = Math.max(10 / Math.max(donorW, 0.001), 1);
    f.scale.set(f.scale.x * s, 1, f.scale.z * s);
    f.visible = true;
    f.frustumCulled = false;
    f.userData.openClinXrLocoGroundFloor = true;
    scene.add(f);
    try {
      if (typeof donor.geometry.computeBoundingBox === "function") donor.geometry.computeBoundingBox();
      const dbb = donor.geometry.boundingBox;
      if (dbb) {
        const dwx = Math.max((dbb.max.x - dbb.min.x) * donor.scale.x, 1e-6);
        const dwz = Math.max((dbb.max.z - dbb.min.z) * donor.scale.z, 1e-6);
        for (let k = -16; k <= 16; k += 1) {
          const off = k * 0.25;
          const gx = donor.clone();
          gx.material = donor.material.clone();
          if (gx.material && gx.material.color) gx.material.color.set(0x3a3a3a);
          if (gx.material && gx.material.emissive) gx.material.emissive.set(0x000000);
          gx.rotation.set(0, 0, 0);
          gx.scale.set(donor.scale.x * (8 / dwx), 1, donor.scale.z * (0.012 / dwz));
          gx.position.set(p.cx, p.floorY + 0.002, p.cz + off);
          gx.visible = true;
          gx.frustumCulled = false;
          gx.userData.openClinXrLocoGroundFloor = true;
          scene.add(gx);
          gridLines += 1;
          const gz = donor.clone();
          gz.material = donor.material.clone();
          if (gz.material && gz.material.color) gz.material.color.set(0x3a3a3a);
          if (gz.material && gz.material.emissive) gz.material.emissive.set(0x000000);
          gz.rotation.set(0, 0, 0);
          gz.scale.set(donor.scale.x * (0.012 / dwx), 1, donor.scale.z * (8 / dwz));
          gz.position.set(p.cx + off, p.floorY + 0.002, p.cz);
          gz.visible = true;
          gz.frustumCulled = false;
          gz.userData.openClinXrLocoGroundFloor = true;
          scene.add(gz);
          gridLines += 1;
        }
      }
    } catch (err) { /* floor without grid still isolates */ }
    if (typeof scene.updateMatrixWorld === "function") scene.updateMatrixWorld(true);
    floorAdded = true;
  }
  let visibleSkinned = 0;
  physRoot.traverse((o) => { if (o.isSkinnedMesh && o.visible !== false) visibleSkinned += 1; });
  return { ok: true, hiddenCount, floorAdded, gridLines, skinned, hiddenMeshes, visibleSkinned };
})
`;

type EvidenceTail = {
  phase: string;
  stanceFoot: string | null;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: { x: number; y: number; z: number } | null;
  rightToe: { x: number; y: number; z: number } | null;
};

async function readEvidence(page: Page): Promise<{
  phase: string | null;
  startWorld: { x: number; y: number; z: number } | null;
  targetWorld: { x: number; y: number; z: number } | null;
  floorOriginY: number | null;
  stoppedSeconds: number;
  samples: Array<EvidenceTail & { atMs: number }>;
  physicianActorId: string | null;
  clipAdvance: number | null;
} | null> {
  return (await page.evaluate(`(() => {
    const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
    if (!ev) return null;
    return {
      phase: ev.phase ?? null,
      startWorld: ev.startWorld ?? null,
      targetWorld: ev.targetWorld ?? null,
      floorOriginY: ev.floorOriginY ?? null,
      stoppedSeconds: ev.stoppedSeconds ?? 0,
      samples: ev.samples ?? [],
      physicianActorId: ev.physicianActorId ?? null,
      clipAdvance: ev.clipStanceAdvanceMetersPerSecond ?? null,
    };
  })()`)) as never;
}

async function readTapRing(page: Page): Promise<unknown[]> {
  const ring = await page.evaluate(`(() => globalThis.__openClinXrLocoGroundTap ?? null)()`);
  return Array.isArray(ring) ? ring as unknown[] : [];
}

async function main(): Promise<void> {
  const row = rowFromArgv();
  const outDir = path.join(OUTPUT_ROOT, row);
  await mkdir(outDir, { recursive: true });

  // DIST MARKER PROOF: the browser serves package dist — record exactly what
  // dist the capture ran against (sha per touched module + marker grep),
  // rebuilt before invoking.
  const distProof = [];
  for (const file of DIST_FILES) {
    const bytes = await readFile(file, "utf8");
    distProof.push({
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      markerHits: bytes.split(DIST_MARKER).length - 1,
    });
  }
  const tapDist = distProof[0];
  if (!tapDist || tapDist.markerHits < 1) throw new Error("dist marker absent from the tap dist; rebuild before capturing");
  for (const entry of distProof) {
    process.stdout.write(`[dist] ${entry.file} sha256=${entry.sha256.slice(0, 16)} markerHits=${entry.markerHits}\n`);
  }

  const bundleJson = buildSceneClosureBundleJson();
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } });
    const page = await context.newPage();
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    const url = `${buildSceneClosureUrl(server.url)}&locoGround=1${rowFlag(row)}`;
    await page.goto(url, { waitUntil: "load", timeout: 180_000 });
    await page.evaluate(HIDE_UI_SOURCE);
    await page.clock.install();
    const pinMs = (await page.evaluate(`(() => Date.now())()`)) as number;
    await page.clock.pauseAt(pinMs + 2000);
    const t0 = (await page.evaluate(`(() => Date.now())()`)) as number;
    await realSleep(1500);
    const t1 = (await page.evaluate(`(() => Date.now())()`)) as number;
    const clockHonoured = Math.abs(t1 - t0) < 300;
    process.stdout.write(`[${row}] clock-hold: Date advanced ${(t1 - t0).toFixed(0)} ms over 1500 ms wall\n`);
    if (!clockHonoured) throw new Error("fake clock not honoured; refusing capture");

    // Wait for resolve: evidence with start+target worlds.
    let ev = await readEvidence(page);
    let preSteps = 0;
    while ((ev === null || ev.startWorld === null || ev.targetWorld === null) && preSteps < 900) {
      await page.clock.fastForward(PRE_WALK_STEP_MS);
      await realSleep(150);
      ev = await readEvidence(page);
      preSteps += 1;
    }
    if (ev === null || ev.startWorld === null || ev.targetWorld === null) {
      throw new Error(`approach never resolved after ${(preSteps * PRE_WALK_STEP_MS) / 1000}s simulated`);
    }
    const routeLength = Math.hypot(ev.targetWorld.x - ev.startWorld.x, ev.targetWorld.z - ev.startWorld.z);
    process.stdout.write(
      `[${row}] route start=(${ev.startWorld.x.toFixed(2)},${ev.startWorld.z.toFixed(2)}) `
      + `target=(${ev.targetWorld.x.toFixed(2)},${ev.targetWorld.z.toFixed(2)}) length=${routeLength.toFixed(2)}m\n`,
    );
    if (Math.abs(routeLength - 6) > 0.05) throw new Error(`vehicle route is ${routeLength.toFixed(2)}m, not 6m`);

    // Wait for walking, then isolate + hide garments.
    let walking = ev.phase === "walking";
    let guard = 0;
    while (!walking && guard < 900) {
      await page.clock.fastForward(PRE_WALK_STEP_MS);
      await realSleep(150);
      ev = await readEvidence(page);
      walking = ev?.phase === "walking";
      guard += 1;
    }
    if (!walking) throw new Error("approach never reached walking");
    // Narrow once: later steps reassign `ev`, so hold the resolved route here.
    const walkEv = ev;
    if (walkEv === null) throw new Error("lost evidence before walking");
    if (walkEv.startWorld === null || walkEv.targetWorld === null) {
      throw new Error("lost the resolved approach before walking");
    }
    const startWorld = walkEv.startWorld;
    const targetWorld = walkEv.targetWorld;
    const physicianActorId = walkEv.physicianActorId;
    const floorOriginY = walkEv.floorOriginY ?? 0;
    const g0 = (ev?.samples.length ?? 0);
    await page.clock.fastForward(500);
    await realSleep(300);
    const g1 = ((await readEvidence(page))?.samples.length ?? 0);
    process.stdout.write(`[${row}] sample-growth: ${g0} -> ${g1} per 500 ms simulated\n`);
    if (g1 <= g0) throw new Error("no samples under fake clock");

    const mid = {
      x: (startWorld.x + targetWorld.x) / 2,
      z: (startWorld.z + targetWorld.z) / 2,
    };
    const iso = (await page.evaluate(
      `${LOCO_ISOLATE_SOURCE}(${JSON.stringify({ actorId: physicianActorId, cx: mid.x, cz: mid.z, floorY: floorOriginY })})`,
    )) as { ok: boolean; reason?: string; skinned?: string[]; hiddenMeshes?: string[]; visibleSkinned?: number; floorAdded?: boolean; gridLines?: number; hiddenCount?: number };
    if (!iso.ok) throw new Error(`isolation failed: ${iso.reason ?? "unknown"}`);
    process.stdout.write(`[${row}] skinned census: ${(iso.skinned ?? []).join(",")}\n`);
    process.stdout.write(`[${row}] hidden garments/hair: ${(iso.hiddenMeshes ?? []).join(",") || "(none)"} visibleSkinned=${iso.visibleSkinned} floor=${iso.floorAdded} grid=${iso.gridLines}\n`);
    if (!iso.floorAdded) throw new Error("no floor plane; refusing a floating subject");

    // Route side axis for the follow camera.
    const dx = targetWorld.x - startWorld.x;
    const dz = targetWorld.z - startWorld.z;
    const len = Math.hypot(dx, dz);
    const side = { x: -dz / len, z: dx / len };

    // Walking capture: follow-cam side view, one screenshot per 1/30 s.
    // Evidence accumulates incrementally: the runtime ring caps at 1200 and
    // would drop early walking frames on a 6 m walk.
    const shotsDir = path.join(outDir, "shots");
    await mkdir(shotsDir, { recursive: true });
    const allSamples: Array<EvidenceTail & { atMs: number }> = [];
    const seenAtMs = new Set<number>();
    let step = 0;
    let settlingSteps = 0;
    for (;;) {
      ev = await readEvidence(page);
      if (ev !== null) {
        for (const s of ev.samples) {
          if (!seenAtMs.has(s.atMs)) {
            seenAtMs.add(s.atMs);
            allSamples.push(s);
          }
        }
        if (allSamples.length > 4000) {
          // Bounded: drop nothing — refuse instead. 6 m + settling fits.
          throw new Error(`sample accumulation exceeded 4000 at step ${step}`);
        }
      }
      const samples = ev?.samples ?? [];
      const tail = samples.length > 0 ? samples[samples.length - 1] ?? null : null;
      const anchor = tail?.slot ?? { x: mid.x, y: 0, z: mid.z };
      const eye = { x: anchor.x + side.x * 2.2, y: 1.0, z: anchor.z + side.z * 2.2 };
      const look = { x: anchor.x, y: 0.85, z: anchor.z };
      await page.evaluate(`${PLACE_CAMERA_SOURCE}(${JSON.stringify({ eye, look, fov: 50 })})`);
      await page.clock.fastForward(STEP_SECONDS * 1000);
      await realSleep(120);
      const buf = await page.screenshot({ animations: "disabled" });
      await writeFile(path.join(shotsDir, `shot-${String(step).padStart(4, "0")}.png`), buf);
      step += 1;
      if (step % 60 === 0) {
        process.stdout.write(`[${row}] step ${step}: phase=${ev?.phase} samples=${ev?.samples.length} kept=${allSamples.length} stopped=${ev?.stoppedSeconds.toFixed(2)}s\n`);
      }
      if (ev?.phase === "arrived" && (ev?.stoppedSeconds ?? 0) >= 1) break;
      if (ev?.phase === "settling") {
        settlingSteps += 1;
      } else if (ev?.phase !== "settling") {
        settlingSteps = 0;
      }
      if (settlingSteps >= 400) {
        // Diagnostic exit: yaw trace over settling so a stuck turn names itself.
        const yawTrace = allSamples
          .filter((s) => (s as { phase?: string }).phase === "settling" && s.slot !== null)
          .map((s) => (s.slot === null ? 0 : s.slot.yaw));
        const head = yawTrace.slice(0, 5).map((y) => y.toFixed(3)).join(",");
        const tailYaw = yawTrace.slice(-5).map((y) => y.toFixed(3)).join(",");
        process.stdout.write(
          `[${row}] STUCK-SETTLING: ${yawTrace.length} settling samples yawFirst=[${head}] yawLast=[${tailYaw}]\n`,
        );
        break;
      }
      if (step >= STEP_CAP) throw new Error(`still walking after ${step} steps (phase=${ev?.phase})`);
    }

    const finalEvidence = await readEvidence(page);
    if (!finalEvidence) throw new Error("lost evidence before end of pass");
    (finalEvidence as { samples?: unknown }).samples = allSamples;
    const tapRing = await readTapRing(page);
    process.stdout.write(`[${row}] frames=${step} evidenceSamples=${finalEvidence.samples.length} tapFrames=${tapRing.length}\n`);

    // 0.5x clip: 30 fps frames played at 15 fps.
    const videoPath = path.join(outDir, `loco-ground-${row}-0.5x.mp4`);
    try {
      execFileSync("/opt/homebrew/bin/ffmpeg", [
        "-y", "-framerate", "15", "-i", path.join(shotsDir, "shot-%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
      ], { stdio: "ignore" });
    } catch {
      execFileSync("ffmpeg", [
        "-y", "-framerate", "15", "-i", path.join(shotsDir, "shot-%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
      ], { stdio: "ignore" });
    }

    const capture = {
      schemaVersion: "openclinxr.loco-ground-capture.v1",
      measuredAt: new Date().toISOString(),
      row,
      urlQuery: `locoGround=1${rowFlag(row)}`,
      scenario: SCENE_CLOSURE_SCENARIO_ID,
      actorId: finalEvidence.physicianActorId,
      distMarker: { files: distProof, marker: DIST_MARKER },
      routeLengthMeters: routeLength,
      clockHonoured,
      frameCount: step,
      video: path.relative(process.cwd(), videoPath),
      evidence: finalEvidence,
      tap: tapRing,
      claimScope: "this browser's tap ring and toe tracks for one loco-ground row",
      notEvidenceFor: ["gait_realism", "clinical_plausibility", "quest_performance"],
    };
    await writeFile(path.join(outDir, `loco-ground-${row}.json`), `${JSON.stringify(capture, null, 2)}\n`);
    process.stdout.write(`[${row}] wrote ${outDir}/loco-ground-${row}.json\n`);
    await context.close().catch(() => undefined);
  } finally {
    await browser.close();
    await stopPortlessDevServer(server.proc);
  }
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("loco-ground-capture.ts");

if (invokedAsScript) {
  void main().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
