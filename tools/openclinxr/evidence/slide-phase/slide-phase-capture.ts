/**
 * Footstep-plan S1 capture: per-frame settle-entry v1 records for the
 * slide-meter control table, with a `--query` passthrough for flagged runs
 * (e.g. `--query=closedLoopWalk=1`).
 *
 * Pacing, probe, labels, dist proof and record schema follow
 * tools/openclinxr/evidence/settle-entry/settle-entry-capture.ts (read-only
 * reference; that directory is owned by another worker until the fixed clock
 * lands, so this file carries its own copy of the PROBE/LABELS evaluate
 * sources — do not diverge them: the meter's missing[] column check guards
 * the schema). Two behavioural differences: the appended URL query, and the
 * fine-step clock advance, which is substep-counted rather than one fixed
 * fastForward so the sampled lattice is identical run to run (see the
 * fine-step comment in runOnce — without it a compute hiccup can drop the
 * capture a substep and shift a stance-window boundary, reading as phantom
 * foot slide).
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/slide-phase-capture.ts \
 *     --vehicle=sc05 --runs=3 --out=.openclinxr/evidence/footstep-plan/control [--query=closedLoopWalk=1] [--start=N] [--actor=physician|nurse|child]
 *
 * Actors-readiness slice (other-actors): opt-in `--actor=nurse|child` walks the
 * SAME SC-05 frozen-plan bedside route with a different rig in the physician's
 * slot. The runtime resolves the walker's GLB by scenario pool assignment keyed
 * on role (humanoid-runtime-asset-url.ts `pickAdultGlb`), never reading the
 * bundle's model.blob for this scenario — so a bundle-JSON patch would be
 * silently ineffective (measured 2026-09-25, see foot-plant-video-capture.ts
 * `--humanoid`). This tool therefore intercepts the NETWORK REQUEST for the
 * physician GLB and serves the requested rig's bytes instead (capture-only,
 * same pattern as that tool's `installHumanoidOverrideRoute`). Default
 * `--actor=physician` (or absent): no interception, existing invocations are
 * unchanged.
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
  "packages/openclinxr/xr-humanoid-animation/dist/foot-base-knee-budget-mod.js",
  "packages/openclinxr/xr-humanoid-animation/dist/foot-base-stride-retarget-mod.js",
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

type CaptureActor = "physician" | "nurse" | "child";

/** Rig walked in the physician's slot; default physician preserves existing behaviour. */
function actorFromArgv(): CaptureActor {
  const flag = process.argv.find((a) => a.startsWith("--actor="))?.slice("--actor=".length);
  if (flag === undefined || flag === "physician") return "physician";
  if (flag === "nurse" || flag === "child") return flag;
  throw new Error("usage: --actor=physician|nurse|child");
}

const ACTOR_GLB: Record<CaptureActor, string> = {
  physician: "mpfb-clinical-physician-adult.glb",
  nurse: "mpfb-clinical-nurse-adult.glb",
  child: "mpfb-peds-patient-child.glb",
};

/** Repo-relative GLB path for the requested actor (physician = shipped bytes). */
function actorGlbPath(actor: CaptureActor): string {
  return `apps/ui-xr/public/generated-humanoids/${ACTOR_GLB[actor]}`;
}

/** Runtime request path the walker GLB is served from (pool assignment, role-keyed). */
const PHYSICIAN_RUNTIME_GLB_PATH = "/generated-humanoids/mpfb-clinical-physician-adult.glb";

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
  /**
   * Heel-strike slice (2026-10-18): foot/toe-bone LOCAL quaternions per frame
   * for the H6 quaternion-norm gate, read by a SEPARATE evaluate
   * (FOOT_QUAT_PROBE_SOURCE below) so the verbatim PROBE_SOURCE copy above
   * never diverges. Null on old captures.
   */
  footQuatL: Quat | null;
  footQuatR: Quat | null;
  toeQuatL: Quat | null;
  toeQuatR: Quat | null;
  /**
   * Heel-strike slice (2026-10-18): last cap decision mirrored from
   * heel-strike-cap-mod (calls/fired/ease/pitch), null on old builds.
   */
  capDbg: {
    calls: number;
    fired: number;
    ease: number | null;
    schedEase: number | null;
    geomEase: number | null;
    pitch: number | null;
    toeAboveBandM: number | null;
  } | null;
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
  if (scene && typeof scene.updateMatrixWorld === "function") scene.updateMatrixWorld();
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

/**
 * Actors-readiness calibration: the constants above are measured off the
 * PHYSICIAN bytes (see provenance above). The nurse adult foot is 0.984x the
 * physician foot (rest-frame foot->toe-joint 0.13801 vs 0.14022 m, measured
 * 2026-10-17 via jointTracks rest samples on the shipped bytes) — the
 * physician constants transfer within ~1 mm, so the nurse reuses them. The
 * child foot is 0.674x (0.09447 vs 0.14022 m); reusing the physician point
 * would plant the contact ~2.2 cm behind the true heel, so the child uses the
 * uniformly scaled point (similar-triangles pitch preservation). Production
 * applies the physician point to every rig (foot-flatten-mod.ts HEEL_LOCAL);
 * that reuse is reported as a probable defect in actors-readiness RESULT.json,
 * not corrected here.
 */
const HEEL_LOCAL_BY_ACTOR: Record<CaptureActor, { L: number[]; R: number[] }> = {
  physician: { L: HEEL_LOCAL_L, R: HEEL_LOCAL_R },
  nurse: { L: HEEL_LOCAL_L, R: HEEL_LOCAL_R },
  child: {
    L: [-0.00148, 0.01224, 0.04567],
    R: [0.00148, 0.01224, 0.04567],
  },
};

function standingPitchProbeSource(actor: CaptureActor): string {
  const locals = HEEL_LOCAL_BY_ACTOR[actor];
  return `
(() => {
  const LOCALS = { L: ${JSON.stringify(locals.L)}, R: ${JSON.stringify(locals.R)} };
  const none = { heelContactL: null, heelContactR: null };
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return none;
  if (typeof scene.updateMatrixWorld === "function") scene.updateMatrixWorld();
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
}

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

/**
 * Lightweight walking-call counter read (fixed-clock substep datum), one
 * evaluate, no scene traversal. Used by the fine loop to keep the sampling
 * lattice on a fixed substep grid — see the fine-step comment below.
 */
const SUBSTEP_SOURCE = `
(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  const samples = ev && ev.samples ? ev.samples : [];
  const tail = samples.length ? samples[samples.length - 1] : null;
  return tail && typeof tail.walkSimSubsteps === "number" ? tail.walkSimSubsteps : null;
})()
`;

/**
 * Light phase read for the freeze-aware parity fix-up (turn-tempo slice):
 * the walk counter freezes at walk end, so an odd substep diff after the
 * freeze means the walk ended mid-window, not lattice drift — half-stepping
 * against a frozen counter stretches one sample 0.13-0.17 s and reads a
 * phantom 256-328 deg/s yaw. The fix-up runs only on walking frames;
 * frozen frames advance exactly 1/30 s per sample (see the fine loop).
 */
const PHASE_SOURCE = `
(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  return ev ? ev.phase : null;
})()
`;

async function readSubsteps(page: Page): Promise<number | null> {
  return (await page.evaluate(SUBSTEP_SOURCE)) as number | null;
}

async function probe(page: Page, actor: CaptureActor): Promise<FrameProbe> {
  const tail = (await page.evaluate(PROBE_SOURCE)) as FrameProbe;
  const liveActors = (await page.evaluate(LIVE_POSE_PROBE_SOURCE)) as LiveActorPose[];
  // Standing-pitch additive read; old builds / pre-spawn frames yield nulls.
  // A failing second evaluate must never lose the primary tail: default nulls.
  let heel: { heelContactL: Vec3 | null; heelContactR: Vec3 | null } = {
    heelContactL: null,
    heelContactR: null,
  };
  try {
    const read = (await page.evaluate(standingPitchProbeSource(actor))) as typeof heel;
    if (read && typeof read === "object") heel = { ...heel, ...read };
  } catch {
    /* contact stays null; the tail still records */
  }
  // Heel-strike additive read (same discipline: never lose the tail).
  let quats: {
    footQuatL: Quat | null;
    footQuatR: Quat | null;
    toeQuatL: Quat | null;
    toeQuatR: Quat | null;
    capDbg: FrameProbe["capDbg"];
  } = {
    footQuatL: null,
    footQuatR: null,
    toeQuatL: null,
    toeQuatR: null,
    capDbg: null,
  };
  try {
    const read = (await page.evaluate(FOOT_QUAT_PROBE_SOURCE)) as typeof quats;
    if (read && typeof read === "object") quats = { ...quats, ...read };
  } catch {
    /* quats stay null; the tail still records */
  }
  return {
    ...tail,
    heelContactL: tail.heelContactL ?? heel.heelContactL,
    heelContactR: tail.heelContactR ?? heel.heelContactR,
    footQuatL: tail.footQuatL ?? quats.footQuatL,
    footQuatR: tail.footQuatR ?? quats.footQuatR,
    toeQuatL: tail.toeQuatL ?? quats.toeQuatL,
    toeQuatR: tail.toeQuatR ?? quats.toeQuatR,
    capDbg: tail.capDbg ?? quats.capDbg,
    liveActors: Array.isArray(liveActors) ? liveActors : [],
  };
}

/**
 * Heel-strike slice (2026-10-18): foot/toe-bone LOCAL quaternions for the H6
 * norm gate. Separate evaluate (see FrameProbe): local quaternions are what
 * the bone writers set, so |norm-1| here is the writer contract directly.
 */
const FOOT_QUAT_PROBE_SOURCE = `
(() => {
  const none = { footQuatL: null, footQuatR: null, toeQuatL: null, toeQuatR: null };
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
  const qOf = (a, b) => {
    const bone = physRoot.getObjectByName(a) || physRoot.getObjectByName(b);
    if (!bone) return null;
    const q = bone.quaternion;
    return q ? { x: q.x, y: q.y, z: q.z, w: q.w } : null;
  };
  return {
    footQuatL: qOf("footL", "foot.L"),
    footQuatR: qOf("footR", "foot.R"),
    toeQuatL: qOf("toe1-1L", "toe1-1.L"),
    toeQuatR: qOf("toe1-1R", "toe1-1.R"),
    capDbg: globalThis.__heelStrikeCapDbg ?? null,
  };
})()
`;

type DistProof = Array<{ file: string; sha256: string; markerHits: number }>;

function baseQuery(vehicle: Vehicle): string {
  if (vehicle === "loco") return "locoGround=1";
  return "steppingTurn=1";
}

type ActorOverride = { actor: CaptureActor; file: string; sha256: string; byteLength: number } | null;

async function runOnce(
  vehicle: Vehicle,
  runIndex: number,
  outDir: string,
  distProof: DistProof,
  bundleJson: string,
  baseUrl: string,
  extraQuery: string,
  browser: Browser,
  actor: CaptureActor,
  overrideBytes: Buffer | null,
  overrideProof: ActorOverride,
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
    // Actors-readiness rig swap (capture-only): serve the requested rig's bytes
    // behind the physician's resolved GLB URL. See --actor header note.
    if (actor !== "physician" && overrideBytes !== null) {
      const bytes = overrideBytes;
      const pattern = `**${PHYSICIAN_RUNTIME_GLB_PATH}`;
      await page.route(pattern, async (route) => {
        process.stdout.write(`[${tag}] actor-override: serving ${ACTOR_GLB[actor]} for ${route.request().url()}\n`);
        await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: bytes });
      });
    }
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
    let p = await probe(page, actor);
    let preSteps = 0;
    while (p.phase !== "walking" && preSteps < PRE_WALK_STEP_CAP) {
      preWalk.push({ ...p, preStep: preSteps });
      await page.clock.fastForward(PRE_WALK_STEP_MS);
      await realSleep(150);
      p = await probe(page, actor);
      preSteps += 1;
    }
    if (p.phase !== "walking") throw new Error(`never reached walking (phase=${p.phase})`);
    const g0 = p.sampleCount;
    await page.clock.fastForward(500);
    await realSleep(300);
    const g1Probe = await probe(page, actor);
    const g1 = g1Probe.sampleCount;
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
    // Deterministic substep grid. Under the fake clock a fastForward(1/30 s)
    // is meant to fire two 1/60 s executor substeps, but a real compute
    // hiccup occasionally lets only one rAF fire inside the window (or a
    // sub-frame fastForward fires none). A frame then lands an odd number of
    // substeps off the intended lattice and shifts every later stance-window
    // boundary, letting a within-band foot-roll frame become a window base —
    // measured 0.007-0.017 m of phantom slide, at a different window on each
    // run (child r2-3 / l14-15, nurse l19-21, physician r7-18).
    //
    // Two facts make this deterministic: (1) the recorded lattice has exactly
    // two phases, selected by the walking-call count's PARITY — the physician
    // reads 0.016 m on an even lattice and 0.0000 m on an odd one, the nurse
    // (0.0138 m) and child read the reverse; (2) a half-step fastForward fires
    // 0, 1 or 2 substeps at random, so a single attempt cannot be trusted.
    // Thus: advance half steps until the count's parity matches the rig's
    // measured-clean phase (physician odd, nurse/child even), then hold the
    // grid by cancelling any odd drift inside the fine loop. The half steps
    // never fire after the walk (the executor's counter is frozen in
    // settling/arrived), so arrival timing is unchanged.
    const wantedParity = actor === "physician" ? 1 : 0;
    const HALF_STEP_MS = (STEP_SECONDS * 1000) / 2;
    let lastSub = g1Probe.walkSimSubsteps;
    for (let attempt = 0; lastSub !== null && lastSub % 2 !== wantedParity && attempt < 24; attempt += 1) {
      await page.clock.fastForward(HALF_STEP_MS);
      const s = await readSubsteps(page);
      if (s !== null) lastSub = s;
    }
    for (;;) {
      await page.clock.fastForward(STEP_SECONDS * 1000);
      let subNow = await readSubsteps(page);
      let fix = 0;
      while (lastSub !== null && subNow !== null && (subNow - lastSub) % 2 !== 0 && fix < 8) {
        // Freeze-aware (turn-tempo slice): fix the lattice only while the
        // walk counter is advancing. After the walk ends the counter
        // freezes, so an odd diff is the end-of-walk mid-window partial,
        // not drift — and every half-step then fires zero substeps without
        // ever repairing parity, stretching one sample by 8 half-steps
        // (measured 8.6 deg yaw on the transition frame). Frozen frames
        // advance exactly 1/30 s per sample.
        const phaseNow = (await page.evaluate(PHASE_SOURCE)) as string | null;
        if (phaseNow !== "walking") break;
        await page.clock.fastForward(HALF_STEP_MS);
        const s = await readSubsteps(page);
        if (s === null) break;
        subNow = s;
        fix += 1;
      }
      const f = await probe(page, actor);
      frames.push({ ...f, step });
      step += 1;
      if (typeof f.walkSimSubsteps === "number") lastSub = f.walkSimSubsteps;
      else if (subNow !== null) lastSub = subNow;
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
    // TEMP SPLIT-STANCE TAP drain (measurement only): per-substep foot-base
    // pin mechanics, absent (empty) on runs where foot-base never steps.
    const footBaseTap = (await page.evaluate(
      `(() => Array.isArray(globalThis.__openClinXrFootBaseTap) ? globalThis.__openClinXrFootBaseTap : [])()`,
    )) as unknown[];
    await writeFile(
      path.join(outDir, `footbase-tap-${tag}.json`),
      JSON.stringify(
        {
          schemaVersion: "openclinxr.footbase-tap.v1",
          measuredAt: new Date().toISOString(),
          vehicle,
          runIndex,
          urlQuery: fullQuery,
          records: footBaseTap,
        },
        null,
        2,
      ),
    );
    process.stdout.write(`[${tag}] footBaseTap=${footBaseTap.length}\n`);
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
          actor,
          actorOverride: overrideProof,
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
  const actor = actorFromArgv();
  await mkdir(outDir, { recursive: true });
  // Actors-readiness rig bytes (capture-only route override, see header).
  // Default actor loads the shipped bytes through the normal path (no override).
  let overrideBytes: Buffer | null = null;
  let overrideProof: ActorOverride = null;
  if (actor !== "physician") {
    const file = actorGlbPath(actor);
    const bytes = await readFile(file);
    overrideBytes = bytes;
    overrideProof = {
      actor,
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
    };
    process.stdout.write(`[actor] ${actor}: override ${file} sha256=${overrideProof.sha256.slice(0, 16)} bytes=${bytes.length}\n`);
  }

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
        await runOnce(vehicle, i, outDir, distProof, bundleJson, server.url, extraQuery, browser as Browser, actor, overrideBytes, overrideProof);
      }
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
