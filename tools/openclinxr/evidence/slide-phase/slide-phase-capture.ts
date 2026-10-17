/**
 * Footstep-plan S1 capture: per-frame settle-entry v1 records for the
 * slide-meter control table, with a `--query` passthrough for flagged runs
 * (e.g. `--query=closedLoopWalk=1`).
 *
 * Pacing, probe, labels, dist proof and record schema are line-identical to
 * tools/openclinxr/evidence/settle-entry/settle-entry-capture.ts (read-only
 * reference; that directory is owned by another worker until the fixed clock
 * lands, so this file carries its own copy of the PROBE/LABELS evaluate
 * sources — do not diverge them: the meter's missing[] column check guards
 * the schema). The ONLY behavioural difference is the appended URL query.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/slide-phase-capture.ts \
 *     --vehicle=sc05 --runs=3 --out=.openclinxr/evidence/footstep-plan/control [--query=closedLoopWalk=1] [--start=N]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import type { Browser, BrowserContext, Page } from "../lib/slotted-playwright.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
  SCENE_CLOSURE_SCENARIO_ID,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";
import {
  LIVE_POSE_PROBE_SOURCE,
  type LiveActorPose,
} from "./live-pose-probe.js";

const STEP_SECONDS = 1 / 30;
const PRE_WALK_STEP_MS = 100;
const PRE_WALK_STEP_CAP = 900;
const STEP_CAP = 1500;
const DIST_FILES = [
  "packages/openclinxr/xr-humanoid-animation/dist/case-owned-approach-frame-mod.js",
  "packages/openclinxr/xr-runtime-state/dist/bedside-approach-execution-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/clip-driven-settling-turn-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/stepping-turn-plan-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/stepping-turn-execution-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/station-bedside-approach-mod.js",
];
const DIST_MARKER = "__openClinXrBedsideApproachEvidence";

type Vehicle = "sc05" | "loco";

function vehicleFromArgv(): Vehicle {
  const flag = process.argv.find((a) => a.startsWith("--vehicle="))?.slice("--vehicle=".length);
  if (flag === "sc05" || flag === "loco") return flag;
  throw new Error("usage: slide-phase-capture.ts --vehicle=sc05|loco --runs=N --out=dir [--query=k=v&k2=v2] [--start=N]");
}

function runsFromArgv(): number {
  const flag = process.argv.find((a) => a.startsWith("--runs="))?.slice("--runs=".length);
  const n = Number(flag);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("usage: --runs=N (1..20)");
  return n;
}

function outFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);
  if (!flag) throw new Error("usage: slide-phase-capture.ts --out=dir");
  return flag;
}

function startFromArgv(): number {
  const flag = process.argv.find((a) => a.startsWith("--start="))?.slice("--start=".length);
  if (flag === undefined) return 0;
  const n = Number(flag);
  if (!Number.isInteger(n) || n < 0) throw new Error("usage: --start=N (non-negative)");
  return n;
}

/** Extra URL query appended verbatim; empty for control runs. */
function queryFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--query="))?.slice("--query=".length);
  return flag ?? "";
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

type FrameProbe = {
  phase: string | null;
  sampleCount: number;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  stanceFoot: string | null;
  travelledMeters: number | null;
  clipTime: number | null;
  upperL: Quat | null;
  upperR: Quat | null;
  /** All four leg joints per side (turn-leg-snaps stage 1); null on old builds. */
  legBones: Record<string, Quat | null> | null;
  /** Hip/knee world positions per side (turn-leg-snaps fix runs); null on old builds. */
  legWorlds: Record<string, Vec3 | null> | null;
  footYawL: number | null;
  footYawR: number | null;
  /** Head bone world yaw (atan2(e[8],e[10])); null when no head bone / old builds. */
  headYaw: number | null;
  stoppedSeconds: number;
  targetHeading: number | null;
  travelHeading: number | null;
  startWorld: Vec3 | null;
  targetWorld: Vec3 | null;
  /**
   * Standing-pitch slice (2026-10-17): heel-sole contact world per foot, read
   * by a SEPARATE evaluate (STANDING_PITCH_PROBE_SOURCE below) so the
   * verbatim PROBE_SOURCE copy above never diverges. Null on old captures.
   */
  heelContactL: Vec3 | null;
  heelContactR: Vec3 | null;
  /** S2: executor walking-call index (fixed-clock substep datum); null on old builds. */
  walkSimSubsteps: number | null;
  /** S2: knee flexion degrees per side, for the amplitude counterweight; null on old builds. */
  kneeFlexionDeg: { left: number | null; right: number | null } | null;
  /** Walk-start rest toe separation (world m); null on old builds / before the walk. */
  restStanceSepXzM: number | null;
  /** M2 rest-stance slice: live-scene poses per actor root (empty before spawn). */
  liveActors: LiveActorPose[];
};

/**
 * COPIED VERBATIM from settle-entry-capture.ts PROBE_SOURCE (see file header).
 * One roundtrip per frame: evidence tail + walk clip time + leg/foot orientations.
 */
const PROBE_SOURCE = `
(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  const samples = ev && ev.samples ? ev.samples : [];
  const tail = samples.length ? samples[samples.length - 1] : null;
  const scene = globalThis.__openClinXrDebugScene;
  let clipTime = null;
  let upperL = null, upperR = null, footYawL = null, footYawR = null;
  let legBones = null, legWorlds = null, headYaw = null;
  if (scene) {
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
    if (physRoot) {
      physRoot.traverse((o) => {
        const ud = o.userData || {};
        if (clipTime === null && ud.openClinXrLocomotionClipPlayback
            && typeof ud.openClinXrLocomotionClipPlayback.timeSeconds === "number") {
          clipTime = ud.openClinXrLocomotionClipPlayback.timeSeconds;
        }
      });
      const byName = (n) => physRoot.getObjectByName(n) || null;
      const qOf = (a, b) => {
        const bone = byName(a) || byName(b);
        if (!bone) return null;
        if (typeof bone.updateWorldMatrix === "function") bone.updateWorldMatrix(true, false);
        const q = bone.quaternion;
        return q ? { x: q.x, y: q.y, z: q.z, w: q.w } : null;
      };
      upperL = qOf("upperleg01L", "upperleg01.L");
      upperR = qOf("upperleg01R", "upperleg01.R");
      legBones = {};
      for (const base of ["upperleg01", "upperleg02", "lowerleg01", "lowerleg02"]) {
        for (const side of ["L", "R"]) {
          legBones[base + side] = qOf(base + side, base + "." + side);
        }
      }
      const wOf = (a, b) => {
        const bone = byName(a) || byName(b);
        if (!bone) return null;
        if (typeof bone.updateWorldMatrix === "function") bone.updateWorldMatrix(true, false);
        const e = bone.matrixWorld.elements;
        return { x: e[12], y: e[13], z: e[14] };
      };
      legWorlds = {
        hipL: wOf("upperleg01L", "upperleg01.L"),
        kneeL: wOf("lowerleg01L", "lowerleg01.L"),
        heelL: wOf("footL", "foot.L"),
        hipR: wOf("upperleg01R", "upperleg01.R"),
        kneeR: wOf("lowerleg01R", "lowerleg01.R"),
        heelR: wOf("footR", "foot.R"),
      };
      const yawOf = (a, b) => {
        const bone = byName(a) || byName(b);
        if (!bone) return null;
        if (typeof bone.updateWorldMatrix === "function") bone.updateWorldMatrix(true, false);
        const e = bone.matrixWorld.elements;
        return Math.atan2(e[8], e[10]);
      };
      footYawL = yawOf("footL", "foot.L");
      footYawR = yawOf("footR", "foot.R");
      let headBone = null;
      physRoot.traverse((o) => {
        if (headBone) return;
        const n = typeof o.name === "string" ? o.name.replaceAll(".", "") : "";
        if (n === "head") headBone = o;
      });
      if (headBone) {
        if (typeof headBone.updateWorldMatrix === "function") headBone.updateWorldMatrix(true, false);
        const e = headBone.matrixWorld.elements;
        headYaw = Math.atan2(e[8], e[10]);
      }
    }
  }
  return {
    phase: ev ? ev.phase : null,
    sampleCount: samples.length,
    slot: tail && tail.slot ? tail.slot : null,
    leftToe: tail ? tail.leftToe : null,
    rightToe: tail ? tail.rightToe : null,
    stanceFoot: tail ? tail.stanceFoot : null,
    travelledMeters: tail && tail.travelledMeters !== undefined ? tail.travelledMeters : null,
    clipTime,
    upperL, upperR, legBones, legWorlds, footYawL, footYawR, headYaw,
    stoppedSeconds: ev ? ev.stoppedSeconds : 0,
    targetHeading: ev ? ev.targetHeadingRadians : null,
    travelHeading: ev ? ev.travelHeadingRadians : null,
    startWorld: ev ? ev.startWorld : null,
    targetWorld: ev ? ev.targetWorld : null,
    walkSimSubsteps: tail && tail.walkSimSubsteps !== undefined ? tail.walkSimSubsteps : null,
    kneeFlexionDeg: tail && tail.kneeFlexionDeg !== undefined ? tail.kneeFlexionDeg : null,
    restStanceSepXzM: ev ? (ev.restStanceSepXzM ?? null) : null,
  };
})()
`;

/**
 * Standing-pitch slice (2026-10-17): heel-sole CONTACT world per foot.
 *
 * legWorlds.heelL/R above reads the foot.L/R bone ORIGIN (the ankle joint —
 * wOf("footL", "foot.L") in PROBE_SOURCE). The sole that touches the floor
 * sits ~0.069 m below and ~0.014 m behind it, so this probe transforms a
 * fixed foot-bone-local heel-sole point into world per frame.
 *
 * HEEL_LOCAL provenance (measured 2026-10-17 off the shipped bytes
 * apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb via
 * @gltf-transform/core, NOT hand-picked): among vertices whose dominant skin
 * weight (>= 0.5) is the foot.L/R joint, in bind pose, the lowest-Y vertex on
 * the posterior half (opposite the ankle->toe-joint XZ direction) is the heel
 * sole (y=0.0017, body mesh v4676; toe sole y=0.0000 v4747; ankle 0.0689 above
 * the heel sole). footLocal = inverseBind(foot) * POSITION. L/R mirrored in x.
 * All mesh-node worlds are identity, so world = footBone.matrixWorld * local
 * (matrixWorld already carries the 0.86 actor scale).
 */
const HEEL_LOCAL_L = [-0.0022, 0.01817, 0.06779];
const HEEL_LOCAL_R = [0.0022, 0.01817, 0.06779];

const STANDING_PITCH_PROBE_SOURCE = `
(() => {
  const LOCALS = { L: ${JSON.stringify(HEEL_LOCAL_L)}, R: ${JSON.stringify(HEEL_LOCAL_R)} };
  const none = { heelContactL: null, heelContactR: null };
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return none;
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
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
  if (!physRoot) return none;
  const contactOf = (a, b, local) => {
    const bone = physRoot.getObjectByName(a) || physRoot.getObjectByName(b);
    if (!bone) return null;
    if (typeof bone.updateWorldMatrix === "function") bone.updateWorldMatrix(true, false);
    const e = bone.matrixWorld.elements;
    return {
      x: e[0] * local[0] + e[4] * local[1] + e[8] * local[2] + e[12],
      y: e[1] * local[0] + e[5] * local[1] + e[9] * local[2] + e[13],
      z: e[2] * local[0] + e[6] * local[1] + e[10] * local[2] + e[14],
    };
  };
  return {
    heelContactL: contactOf("footL", "foot.L", LOCALS.L),
    heelContactR: contactOf("footR", "foot.R", LOCALS.R),
  };
})()
`;

/** COPIED VERBATIM from settle-entry-capture.ts LABELS_SOURCE (see file header). */
const LABELS_SOURCE = `
(() => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return null;
  let found = null;
  scene.traverse((o) => {
    if (found) return;
    const ud = o.userData || {};
    if (ud.openClinXrLocomotionStanceLabels) found = ud.openClinXrLocomotionStanceLabels;
  });
  return found;
})()
`;

async function probe(page: Page): Promise<FrameProbe> {
  const tail = (await page.evaluate(PROBE_SOURCE)) as FrameProbe;
  const liveActors = (await page.evaluate(LIVE_POSE_PROBE_SOURCE)) as LiveActorPose[];
  // Standing-pitch additive read; old builds / pre-spawn frames yield nulls.
  // A failing second evaluate must never lose the primary tail: default nulls.
  let heel: { heelContactL: Vec3 | null; heelContactR: Vec3 | null } = {
    heelContactL: null,
    heelContactR: null,
  };
  try {
    const read = (await page.evaluate(STANDING_PITCH_PROBE_SOURCE)) as typeof heel;
    if (read && typeof read === "object") heel = { ...heel, ...read };
  } catch {
    /* contact stays null; the tail still records */
  }
  return {
    ...tail,
    heelContactL: tail.heelContactL ?? heel.heelContactL,
    heelContactR: tail.heelContactR ?? heel.heelContactR,
    liveActors: Array.isArray(liveActors) ? liveActors : [],
  };
}

type DistProof = Array<{ file: string; sha256: string; markerHits: number }>;

function baseQuery(vehicle: Vehicle): string {
  if (vehicle === "loco") return "locoGround=1";
  return "steppingTurn=1";
}

async function runOnce(
  vehicle: Vehicle,
  runIndex: number,
  outDir: string,
  distProof: DistProof,
  bundleJson: string,
  baseUrl: string,
  extraQuery: string,
  browser: Browser,
): Promise<void> {
  const tag = `${vehicle}-run${runIndex}`;
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    const fullQuery = extraQuery ? `${baseQuery(vehicle)}&${extraQuery}` : baseQuery(vehicle);
    const url = `${buildSceneClosureUrl(baseUrl)}&${fullQuery}`;
    await page.goto(url, { waitUntil: "load", timeout: 180_000 });
    await page.clock.install();
    const pinMs = (await page.evaluate(`(() => Date.now())()`)) as number;
    await page.clock.pauseAt(pinMs + 2000);
    const t0 = (await page.evaluate(`(() => Date.now())()`)) as number;
    await realSleep(1500);
    const t1 = (await page.evaluate(`(() => Date.now())()`)) as number;
    const clockHonoured = Math.abs(t1 - t0) < 300;
    process.stdout.write(`[${tag}] clock-hold: Date advanced ${(t1 - t0).toFixed(0)} ms over 1500 ms wall\n`);
    if (!clockHonoured) throw new Error("fake clock not honoured; refusing capture");

    // Pre-walk: coarse steps until walking (real sleeps let GLB I/O proceed).
    const preWalk: Array<FrameProbe & { preStep: number }> = [];
    let p = await probe(page);
    let preSteps = 0;
    while (p.phase !== "walking" && preSteps < PRE_WALK_STEP_CAP) {
      preWalk.push({ ...p, preStep: preSteps });
      await page.clock.fastForward(PRE_WALK_STEP_MS);
      await realSleep(150);
      p = await probe(page);
      preSteps += 1;
    }
    if (p.phase !== "walking") throw new Error(`never reached walking (phase=${p.phase})`);
    const g0 = p.sampleCount;
    await page.clock.fastForward(500);
    await realSleep(300);
    const g1 = (await probe(page)).sampleCount;
    process.stdout.write(`[${tag}] sample-growth: ${g0} -> ${g1} per 500 ms simulated\n`);
    if (g1 <= g0) throw new Error("no samples under fake clock");

    // Stance labels: static per clip, fetch once.
    const labels = (await page.evaluate(LABELS_SOURCE)) as {
      clipName: string;
      cycleSeconds: number;
      atMs: number[];
      left: boolean[];
      right: boolean[];
    } | null;

    // M2 rest-stance slice: keep the first walking probe. The loop above drops
    // it (exit condition), but its live skeleton still holds idle while the
    // drive already reports walking — and the sample tail skips it (lock
    // unarmed) — so it is the only record of the rest pose. Analysis joins
    // the physician's live entry by physicianActorId retrospectively.
    preWalk.push({ ...p, preStep: preSteps });

    // Fine steps: record every frame until the arrival close is observable
    // done. The close reports done at or before its 120th arrived frame
    // (ARRIVAL_CLOSE_FRAME_CAP, arrival-stance-close-mod.ts), so 120 arrived
    // frames observe the whole close; stoppedSeconds is wall-clock state, not
    // the close, and is no longer the stop rule.
    const ARRIVED_FRAME_CAP = 120;
    const frames: Array<FrameProbe & { step: number }> = [];
    let step = 0;
    let arrivedFrames = 0;
    for (;;) {
      await page.clock.fastForward(STEP_SECONDS * 1000);
      const f = await probe(page);
      frames.push({ ...f, step });
      step += 1;
      if (f.phase === "arrived") arrivedFrames += 1;
      if (step % 60 === 0) {
        process.stdout.write(
          `[${tag}] step ${step}: phase=${f.phase} clipTime=${f.clipTime?.toFixed(3) ?? "?"} stance=${f.stanceFoot} stopped=${f.stoppedSeconds.toFixed(2)}s arrivedFrames=${arrivedFrames}\n`,
        );
      }
      if (arrivedFrames >= ARRIVED_FRAME_CAP) break;
      if (step >= STEP_CAP) throw new Error(`still not arrived after ${step} steps (phase=${f.phase})`);
    }
    const first = frames[0];
    process.stdout.write(
      `[${tag}] frames=${frames.length} route=${first?.startWorld ? `${Math.hypot((first.targetWorld?.x ?? 0) - first.startWorld.x, (first.targetWorld?.z ?? 0) - first.startWorld.z).toFixed(2)}m` : "?"} labels=${labels ? "yes" : "NO-LABELS"}\n`,
    );
    // Footstep-plan M1 tap (creep slice): drain the per-substep ring the
    // flagged run recorded (`__openClinXrFootstepTap`; empty on control
    // runs). Named `tap-<tag>.json` so the meter's `<vehicle>-run` filter
    // never picks it up as a run file.
    const tapRecords = (await page.evaluate(
      `(() => Array.isArray(globalThis.__openClinXrFootstepTap) ? globalThis.__openClinXrFootstepTap : [])()`,
    )) as unknown[];
    await writeFile(
      path.join(outDir, `tap-${tag}.json`),
      JSON.stringify(
        {
          schemaVersion: "openclinxr.footstep-tap.v1",
          measuredAt: new Date().toISOString(),
          vehicle,
          runIndex,
          urlQuery: fullQuery,
          records: tapRecords,
        },
        null,
        2,
      ),
    );
    process.stdout.write(`[${tag}] tapRecords=${tapRecords.length}\n`);
    await writeFile(
      path.join(outDir, `${tag}.json`),
      JSON.stringify(
        {
          schemaVersion: "openclinxr.settle-entry-capture.v1",
          measuredAt: new Date().toISOString(),
          vehicle,
          runIndex,
          urlQuery: fullQuery,
          scenario: SCENE_CLOSURE_SCENARIO_ID,
          distProof,
          clockHonoured,
          labels,
          preWalk,
          probeGapMs: 500,
          frames,
        },
        null,
        2,
      ),
    );
  } finally {
    await context?.close();
  }
}

async function main(): Promise<void> {
  const vehicle = vehicleFromArgv();
  const runs = runsFromArgv();
  const start = startFromArgv();
  const outDir = outFromArgv();
  const extraQuery = queryFromArgv();
  await mkdir(outDir, { recursive: true });

  const distProof: DistProof = [];
  for (const file of DIST_FILES) {
    const bytes = await readFile(file, "utf8");
    distProof.push({
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      markerHits: bytes.split(DIST_MARKER).length - 1,
    });
  }
  for (const entry of distProof) {
    process.stdout.write(`[dist] ${entry.file} sha256=${entry.sha256.slice(0, 16)}\n`);
  }
  const markerFile = distProof.find((d) => d.file.endsWith("station-bedside-approach-mod.js"));
  if (!markerFile || markerFile.markerHits < 1) {
    throw new Error("dist marker absent; rebuild before capturing");
  }

  const bundleJson = buildSceneClosureBundleJson();
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const services = createLocalComputeServices();
  try {
    await services.sceneCapture.withBrowser(`footstep-${vehicle}`, async (browser) => {
      for (let i = start; i < start + runs; i += 1) {
        await runOnce(vehicle, i, outDir, distProof, bundleJson, server.url, extraQuery, browser as Browser);
      }
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
