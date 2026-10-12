/**
 * Arm-settle measurement: per-frame arm joint rotations across the walk -> arrival/idle
 * switch on the scene-closure physician, in the browser under the fake clock.
 *
 * Samples every 1/30 s simulated frame from first walking frame until arrived + 2 s
 * stopped: phase/stoppedSeconds from `__openClinXrBedsideApproachEvidence` plus an arm
 * probe off `__openClinXrDebugScene` (local quats of shoulder/upperarm/lowerarm/wrist
 * bones, world positions of shoulder/elbow/wrist/pelvis/neck, locomotion ownership
 * chains). Offline analysis in this file derives per-frame rotation rates, the walk
 * clip's own max arm rate, the switch-frame spike, and the hold upper-arm-from-trunk
 * angle. Output: `.openclinxr/evidence/arm-settle/<name>.json`.
 *
 * Usage: pnpm tsx tools/openclinxr/evidence/arm-settle/arm-settle-measure.ts [--out=<name>]
 * Flag-default runtime (stepping turn at default = on; no query flags appended).
 */

import { execFileSync } from "node:child_process";
import { mkdir, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "../lib/slotted-playwright.js";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
  SCENE_CLOSURE_SCENARIO_ID,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";

const OUT_DIR = ".openclinxr/evidence/arm-settle";
const STEP_SECONDS = 1 / 30;
const HOLD_SECONDS = 2;

function outNameFromArgv(): string {
  const flag = process.argv.find((arg) => arg.startsWith("--out="));
  return flag ? flag.slice("--out=".length) : "pre-fix";
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Code-under-test proof (arm-settle): rebuild the two runtime packages whose dist the
 * browser serves, then record content markers grepped FROM the built dist plus dist
 * mtimes and the git sha into the measurement JSON. A capture whose dist lacks the
 * expected markers does not count: tsgo --build can skip emit, so mtime alone proves
 * nothing. Expected markers per run are passed in (fix run: slew strings present;
 * control run: slew strings absent).
 */
async function buildAndProve(expected: {
  files: Record<string, { present: string[]; absent: string[] }>;
}): Promise<{
  gitSha: string;
  worktreeStatus: string;
  dist: Record<string, { mtimeMs: number; markers: Record<string, boolean> }>;
}> {
  for (const filter of ["@openclinxr/xr-pose", "@openclinxr/xr-humanoid-animation"]) {
    execFileSync("pnpm", ["-s", "turbo", "run", "build", `--filter=${filter}`], {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 600000,
    });
  }
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  let worktreeStatus = "";
  try {
    worktreeStatus = execFileSync("git", ["status", "--short"], { encoding: "utf8" });
  } catch {
    worktreeStatus = "(unavailable)";
  }
  const dist: Record<string, { mtimeMs: number; markers: Record<string, boolean> }> = {};
  for (const [file, want] of Object.entries(expected.files)) {
    const content = await readFile(path.resolve(process.cwd(), file), "utf8");
    const fileMarkers: Record<string, boolean> = {};
    for (const marker of [...want.present, ...want.absent]) {
      fileMarkers[marker] = content.includes(marker);
    }
    const mtimeMs = (await stat(path.resolve(process.cwd(), file))).mtimeMs;
    dist[file] = { mtimeMs, markers: fileMarkers };
  }
  const problems: string[] = [];
  for (const [file, want] of Object.entries(expected.files)) {
    const record = dist[file];
    if (!record) throw new Error(`missing dist record for ${file}`);
    for (const marker of want.present) {
      if (!record.markers[marker]) problems.push(`${file} lacks expected marker ${marker}`);
    }
    for (const marker of want.absent) {
      if (record.markers[marker]) problems.push(`${file} unexpectedly contains ${marker}`);
    }
  }
  if (problems.length > 0) throw new Error(`code proof failed:\n${problems.join("\n")}`);
  return { gitSha, worktreeStatus, dist };
}

function markersFromArgv(): { files: Record<string, { present: string[]; absent: string[] }> } {
  // --expect-fix: the split-take fix must be in the served animation dist, and the rejected
  // slew/governor smoothing plus temporary mixer debug must be gone. Default (control): the
  // split must be absent. The pose package carries no change in this slice (idle untouched).
  const animationFile = "packages/openclinxr/xr-humanoid-animation/dist/locomotion-clip-playback-mod.js";
  const splitFile = "packages/openclinxr/xr-humanoid-animation/dist/locomotion-clip-split-mod.js";
  const poseFile = "packages/openclinxr/xr-pose/dist/clinical-idle-posture.js";
  if (process.argv.some((arg) => arg === "--expect-fix")) {
    return {
      files: {
        [poseFile]: { present: [], absent: ["writeArmReleaseSlew", "ARM_RELEASE_SLEW_MAX_RAD"] },
        [animationFile]: { present: ["locomotionSplitActions"], absent: ["openClinXrMixerActionDebug"] },
        [splitFile]: {
          present: ["__openclinxr_upper_body", "LOCOMOTION_UPPER_BODY_BLEND_OUT_S"],
          absent: [],
        },
      },
    };
  }
  return {
    files: {
      [poseFile]: { present: [], absent: ["writeArmReleaseSlew", "ARM_RELEASE_SLEW_MAX_RAD"] },
      [animationFile]: {
        present: [],
        absent: ["openClinXrMixerActionDebug", "locomotionSplitActions", "__openclinxr_upper_body"],
      },
    },
  };
}

function controlPathFromArgv(): string | null {
  const flag = process.argv.find((arg) => arg.startsWith("--control="));
  return flag ? flag.slice("--control=".length) : null;
}

function reportRequested(): boolean {
  return process.argv.some((arg) => arg === "--report");
}

const SUMMARY_SOURCE = `
(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  const samples = ev && ev.samples ? ev.samples : [];
  const last = samples.length ? samples[samples.length - 1] : null;
  return {
    phase: ev ? ev.phase : null,
    stoppedSeconds: ev ? ev.stoppedSeconds : 0,
    sampleCount: samples.length,
    lastStance: last ? last.stanceFoot : null,
    driveSource: ev ? ev.driveSource : null,
  };
})()
`;

/**
 * Arm probe: local quaternions/eulers of arm bones + world joint positions + the
 * locomotion ownership claim on the actor. Fail-soft per bone (null when absent).
 */
const ARM_PROBE_SOURCE = `
((p) => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false, reason: "no-debug-scene" };
  const actorId = p.actorId;
  let actor = null;
  scene.traverse((o) => {
    if (actor) return;
    const ud = o.userData || {};
    if (ud.openClinXrActorId === actorId) actor = o;
  });
  if (!actor) return { ok: false, reason: "no-physician-actor-" + actorId };
  const san = (n) => (typeof n === "string" ? n.replaceAll(".", "") : "");
  const pickAll = (tests) => {
    const found = [];
    actor.traverse((o) => {
      const s = san(o.name);
      for (const t of tests) {
        if (t.test(s)) {
          found.push({ name: o.name, uuid: o.uuid, visible: o.visible, parent: o.parent ? o.parent.name : null });
          break;
        }
      }
    });
    return found;
  };
  const pick = (tests) => {
    let found = null;
    actor.traverse((o) => {
      if (found) return;
      const s = san(o.name);
      for (const t of tests) { if (t.test(s)) { found = o; break; } }
    });
    return found;
  };
  // Identity census: every arm-bone object under the actor (uuid distinguishes a flip
  // between same-named objects from real articulation).
  const census = {};
  const censusTests = {
    upperL: [/^upperarm01L$/, /^upper_armL$/],
    upperR: [/^upperarm01R$/, /^upper_armR$/],
    lowerL: [/^lowerarm01L$/, /^forearmL$/],
    lowerR: [/^lowerarm01R$/, /^forearmR$/],
  };
  for (const key of Object.keys(censusTests)) {
    census[key] = pickAll(censusTests[key]).map((m) => ({ uuid: m.uuid.slice(0, 8), visible: m.visible, parent: m.parent }));
  }
  const bone = (o) => {
    if (!o) return null;
    return {
      name: o.name,
      quat: { x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w },
      euler: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
    };
  };
  const worldOf = (o) => {
    if (!o) return null;
    if (typeof o.updateWorldMatrix === "function") o.updateWorldMatrix(true, false);
    const e = o.matrixWorld ? o.matrixWorld.elements : null;
    if (!e) return null;
    return { x: e[12], y: e[13], z: e[14] };
  };
  const upperL = pick([/^upperarm01L$/, /^upper_armL$/]);
  const upperR = pick([/^upperarm01R$/, /^upper_armR$/]);
  const lowerL = pick([/^lowerarm01L$/, /^forearmL$/]);
  const lowerR = pick([/^lowerarm01R$/, /^forearmR$/]);
  const shoL = pick([/^shoulder01L$/]) || upperL;
  const shoR = pick([/^shoulder01R$/]) || upperR;
  const wristL = pick([/^wristL$/, /^handL$/]);
  const wristR = pick([/^wristR$/, /^handR$/]);
  const pelvis = pick([/^pelvis$/, /pelvis/i]);
  const neck = pick([/^neck0[123]$/, /^neck$/, /neck/i]);
  // Ownership claim: set on slot.root userData, which is NOT necessarily an ancestor of
  // the actorId-tagged node (actorSlot vs root split). Search the whole scene instead.
  const claimSites = [];
  const playbackSites = [];
  scene.traverse((o) => {
    const ud = o.userData || {};
    if (Array.isArray(ud.openClinXrOwnedBoneChains)) {
      claimSites.push({
        node: o.name || "(unnamed)",
        actorId: ud.openClinXrActorId || null,
        chains: ud.openClinXrOwnedBoneChains.map((c) => ({
          ownerId: c.ownerId, weight: c.weight,
          bones: Array.isArray(c.boneNames) ? c.boneNames.length : -1,
          hasUpperArm: Array.isArray(c.boneNames) && c.boneNames.some((n) => /upperarm|upper_arm/i.test(String(n))),
        })),
      });
    }
    if (ud.openClinXrLocomotionClipPlayback !== undefined || ud.openClinXrLocomotionLegWeight !== undefined || ud.openClinXrLocomotionCrossfade !== undefined) {
      claimSites.push({
        node: (o.name || "(unnamed)") + "#playback",
        actorId: ud.openClinXrActorId || null,
        chains: [{ ownerId: "playback", weight: null, bones: -1, hasUpperArm: false,
          playback: ud.openClinXrLocomotionClipPlayback || null,
          legWeight: ud.openClinXrLocomotionLegWeight || null,
          crossfade: ud.openClinXrLocomotionCrossfade || null }],
      });
    }
  });
  const chainSummary = claimSites.length ? claimSites : null;
  const postureTag = (o) => (o && o.userData && o.userData.openClinXrClinicalIdlePosture) || null;
  // Served-code proof from inside the page: collect EVERY release store scene-wide
  // (one per humanoid running the fixed pass) with upper-arm entries, so the walker's
  // own blend state is visible even when another actor sorts first in traversal.
  const releaseStores = [];
  scene.traverse((o) => {
    const ud = o.userData || {};
    if (ud.openClinXrArmReleasePrev instanceof Map) {
      const m = ud.openClinXrArmReleasePrev;
      const entries = {};
      m.forEach((v, k) => {
        if (typeof k === "string" && /arm/i.test(k)) entries[k] = v;
      });
      releaseStores.push({ node: o.name || "(unnamed)", actorId: ud.openClinXrActorId || null, size: m.size, upperEntries: entries });
    }
  });
  const releaseStore = releaseStores.length ? releaseStores : null;
  // TEMPORARY snap attribution (arm-settle): the loop stashes pre/post-posture upper-arm quats
  // plus per-action weights/times on the slot root, which is not necessarily the actorId-tagged
  // node the arm probe resolves (actorSlot carries the tag too) — search scene-wide like the
  // claim census does. Reverted after the capture.
  let snapDebug = null;
  scene.traverse((o) => {
    if (snapDebug) return;
    const ud = o.userData || {};
    if (ud.openClinXrSnapDebug !== undefined && ud.openClinXrSnapDebug !== null) snapDebug = ud.openClinXrSnapDebug;
  });
  // LEGS-IDENTICAL probe (arm-settle bar 2): local quats of every leg/foot/pelvis bone plus the
  // actor root's local/world position, compared against the control run within 1e-6. Scene-graph
  // names are dotted (upperleg01.L); san() strips dots before matching, as the arm probe does.
  const legKeys = ["upperleg01L", "upperleg01R", "upperleg02L", "upperleg02R",
    "lowerleg01L", "lowerleg01R", "lowerleg02L", "lowerleg02R",
    "footL", "footR", "toe1-1L", "toe1-1R", "pelvisL", "pelvisR", "pelvis", "root"];
  const legs = {};
  for (const key of legKeys) {
    const o = pick([new RegExp("^" + key + "$")]);
    legs[key] = o
      ? { name: o.name, quat: { x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w } }
      : null;
  }
  const actorRoot = {
    name: actor.name || "(unnamed)",
    local: { x: actor.position.x, y: actor.position.y, z: actor.position.z },
    localQuat: { x: actor.quaternion.x, y: actor.quaternion.y, z: actor.quaternion.z, w: actor.quaternion.w },
    world: worldOf(actor),
  };
  return {
    ok: true,
    releaseStore,
    snapDebug,
    census,
    actorRoot,
    legs,
    bones: {
      upperL: bone(upperL), upperR: bone(upperR),
      lowerL: bone(lowerL), lowerR: bone(lowerR),
      shoL: bone(shoL), shoR: bone(shoR),
    },
    postureTags: {
      upperL: postureTag(upperL), upperR: postureTag(upperR),
      lowerL: postureTag(lowerL), lowerR: postureTag(lowerR),
    },
    points: {
      shoulderL: worldOf(shoL), elbowL: worldOf(lowerL), wristL: worldOf(wristL),
      shoulderR: worldOf(shoR), elbowR: worldOf(lowerR), wristR: worldOf(wristR),
      pelvis: worldOf(pelvis), neck: worldOf(neck),
    },
    chains: chainSummary,
  };
})
`;

type Quat = { x: number; y: number; z: number; w: number };
type Vec3 = { x: number; y: number; z: number };
type ArmFrame = {
  step: number;
  simMs: number;
  rafCount: number | null;
  phase: string | null;
  stoppedSeconds: number;
  bones: Record<string, { name: string; quat: Quat; euler: Vec3 } | null>;
  points: Record<string, Vec3 | null>;
  legs: Record<string, { name: string; quat: Quat } | null>;
  actorRoot: {
    name: string;
    local: Vec3;
    localQuat: Quat;
    world: Vec3 | null;
  } | null;
  snapDebug?: unknown;
  chains: Array<{ ownerId: string; weight: number; bones: number; hasUpperArm: boolean }> | null;
  postureTags?: Record<string, string | null>;
  releaseStore?: Array<{ node: string; actorId: unknown; size: number; upperEntries: Record<string, unknown> }> | null;
  census?: Record<string, Array<{ uuid: string; visible: boolean; parent: string | null }>>;
};

function quatAngleDeg(a: Quat, b: Quat): number {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 0 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

function angleDeg(a: Vec3, b: Vec3): number {
  const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(d) * 180) / Math.PI;
}

async function readSummary(page: Page) {
  return (await page.evaluate(SUMMARY_SOURCE)) as {
    phase: string | null;
    stoppedSeconds: number;
    sampleCount: number;
    lastStance: string | null;
    driveSource: string | null;
  };
}

/** Bar thresholds (arm-settle slice DONE WHEN). */
const ARM_SNAP_MAX_DEG = 4.3;
const LEG_IDENTICAL_TOL = 1e-6;
const SWING_MEDIAN_TOL_DEG = 0.3;
const SWING_P2P_RATIO = 0.9;
const HOLD_TARGET_DEG = 13.1;
const HOLD_TOL_DEG = 1;
const WALK_START_WINDOW_STEPS = 15;
const MID_WALK_FIRST_STEP = 12;
const MID_WALK_LAST_STEP = 22;

type FrameRate = { step: number; phase: string | null; per: Record<string, number>; max: number };

function frameRates(frames: ArmFrame[]): FrameRate[] {
  const armBones = ["upperL", "upperR", "lowerL", "lowerR"] as const;
  return frames.map((f, i) => {
    if (i === 0) return { step: f.step, phase: f.phase, per: {} as Record<string, number>, max: 0 };
    const prev = frames[i - 1];
    if (!prev) return { step: f.step, phase: f.phase, per: {} as Record<string, number>, max: 0 };
    const per: Record<string, number> = {};
    let max = 0;
    for (const b of armBones) {
      const q0 = prev.bones[b]?.quat;
      const q1 = f.bones[b]?.quat;
      const d = q0 && q1 ? quatAngleDeg(q0, q1) : NaN;
      per[b] = d;
      if (Number.isFinite(d) && d > max) max = d;
    }
    return { step: f.step, phase: f.phase, per, max };
  });
}

function trunkAngleSeries(frames: ArmFrame[]): Array<{ L: number; R: number }> {
  return frames.map((f) => {
    const p = f.points;
    if (!p.pelvis || !p.neck) return { L: NaN, R: NaN };
    const trunkUp = norm(sub(p.neck, p.pelvis));
    const down = { x: -trunkUp.x, y: -trunkUp.y, z: -trunkUp.z };
    const aL = p.shoulderL && p.elbowL ? angleDeg(norm(sub(p.elbowL, p.shoulderL)), down) : NaN;
    const aR = p.shoulderR && p.elbowR ? angleDeg(norm(sub(p.elbowR, p.shoulderR)), down) : NaN;
    return { L: aL, R: aR };
  });
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? NaN) : NaN;
}

/** Mid-walk (steps 12-22) arm-swing preservation metrics, computed identically for both runs. */
function midWalkSwing(frames: ArmFrame[], rates: FrameRate[]): {
  upperMedianDegPerFrame: number;
  peakToPeakDeg: { L: number; R: number };
} {
  const winRates = rates.filter((rate) => rate.step >= MID_WALK_FIRST_STEP && rate.step <= MID_WALK_LAST_STEP);
  const upperRates = winRates
    .map((rate) => Math.max(rate.per["upperL"] ?? NaN, rate.per["upperR"] ?? NaN))
    .filter(Number.isFinite);
  const winFrames = frames.filter((frame) => frame.step >= MID_WALK_FIRST_STEP && frame.step <= MID_WALK_LAST_STEP);
  const angles = trunkAngleSeries(winFrames);
  const finite = (xs: number[]) => xs.filter(Number.isFinite);
  const l = finite(angles.map((a) => a.L));
  const r = finite(angles.map((a) => a.R));
  return {
    upperMedianDegPerFrame: median(upperRates),
    peakToPeakDeg: {
      L: l.length ? Math.max(...l) - Math.min(...l) : NaN,
      R: r.length ? Math.max(...r) - Math.min(...r) : NaN,
    },
  };
}

type LegComparison = {
  comparedSteps: number;
  controlFrameCount: number;
  fixFrameCount: number;
  lengthMatch: boolean;
  comparedLegKeys: string[];
  missingLegKeys: string[];
  maxLegQuatComponentDiff: number;
  worstLegBone: string | null;
  worstLegStep: number | null;
  maxRootPosComponentDiff: number;
  worstRootKind: string | null;
  worstRootStep: number | null;
};

/** Bar 2: every leg/foot/pelvis quat and the root position equal within 1e-6 at every step. */
function compareLegs(control: ArmFrame[], fix: ArmFrame[]): LegComparison {
  const n = Math.min(control.length, fix.length);
  const compared = new Set<string>();
  const missing = new Set<string>();
  let maxQuat = 0;
  let worstBone: string | null = null;
  let worstStep: number | null = null;
  let maxRoot = 0;
  let worstRootKind: string | null = null;
  let worstRootStep: number | null = null;
  for (let i = 0; i < n; i++) {
    const c = control[i];
    const f = fix[i];
    if (!c || !f) continue;
    const keys = new Set([...Object.keys(c.legs ?? {}), ...Object.keys(f.legs ?? {})]);
    for (const key of keys) {
      const cq = c.legs?.[key]?.quat;
      const fq = f.legs?.[key]?.quat;
      if (!cq || !fq) {
        missing.add(key);
        continue;
      }
      compared.add(key);
      for (const comp of ["x", "y", "z", "w"] as const) {
        const d = Math.abs(cq[comp] - fq[comp]);
        if (d > maxQuat) {
          maxQuat = d;
          worstBone = key;
          worstStep = c.step;
        }
      }
    }
    const rootKinds = [
      { kind: "local", a: c.actorRoot?.local, b: f.actorRoot?.local },
      { kind: "world", a: c.actorRoot?.world, b: f.actorRoot?.world },
    ] as const;
    for (const { kind, a, b } of rootKinds) {
      if (!a || !b) continue;
      for (const comp of ["x", "y", "z"] as const) {
        const d = Math.abs(a[comp] - b[comp]);
        if (d > maxRoot) {
          maxRoot = d;
          worstRootKind = kind;
          worstRootStep = c.step;
        }
      }
    }
  }
  return {
    comparedSteps: n,
    controlFrameCount: control.length,
    fixFrameCount: fix.length,
    lengthMatch: control.length === fix.length,
    comparedLegKeys: [...compared].sort(),
    missingLegKeys: [...missing].sort(),
    maxLegQuatComponentDiff: maxQuat,
    worstLegBone: worstBone,
    worstLegStep: worstStep,
    maxRootPosComponentDiff: maxRoot,
    worstRootKind: worstRootKind,
    worstRootStep: worstRootStep,
  };
}

async function main(): Promise<void> {
  const outName = outNameFromArgv();
  const codeProof = await buildAndProve(markersFromArgv());
  process.stdout.write(`[arm-settle] code proof: sha=${codeProof.gitSha} markers ok\n`);
  const scenarioId = SCENE_CLOSURE_SCENARIO_ID;
  const bundleJson = buildSceneClosureBundleJson();
  const bundle = JSON.parse(bundleJson) as { actors: Array<{ actorId: string; role: string }> };
  const walkerRole = CASE_FROZEN_SCENE_PLANS[scenarioId]?.case.walkerRole;
  if (!walkerRole) throw new Error("no walkerRole for scenario");
  const walker = bundle.actors.find((actor) => actor.role === walkerRole);
  if (!walker) throw new Error("no walker actor in bundle");
  const walkerActorId = walker.actorId;
  const buildUrl = (baseUrl: string) => buildSceneClosureUrl(baseUrl);
  process.stdout.write(`[arm-settle] scenario=${scenarioId} walker=${walkerActorId} out=${outName}\n`);

  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  try {
    const browser: Browser = await chromium.launch({
      headless: true,
      args: ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--use-gl=swiftshader", "--ignore-gpu-blocklist"],
    });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
      try {
        await page.clock.install();
        await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
          await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
        });
        await page.goto(buildUrl(server.url), { waitUntil: "load", timeout: 180_000 });
        const pinMs = (await page.evaluate(`(() => Date.now())()`)) as number;
        await page.clock.pauseAt(pinMs + 2000);
        // rAF tick counter: under the fake clock, requestAnimationFrame fires only when
        // fastForward elapses fake time past frame deadlines. The per-step delta counts
        // how many runtime frames one probe step actually contains (1 vs many decides
        // whether per-step rates are per-frame rates or pacing artifacts).
        await page.evaluate(`(() => {
          const host = globalThis;
          host.__armSettleRafCount = 0;
          const loop = () => {
            host.__armSettleRafCount += 1;
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        })()`);
        const t0 = (await page.evaluate(`(() => Date.now())()`)) as number;
        await realSleep(1500);
        const t1 = (await page.evaluate(`(() => Date.now())()`)) as number;
        if (Math.abs(t1 - t0) >= 300) throw new Error("fake clock not honoured");
        process.stdout.write(`[arm-settle] clock-hold ok (drift ${(t1 - t0).toFixed(0)} ms)\n`);

        let summary = await readSummary(page);
        let preSteps = 0;
        while (summary.phase !== "walking" && preSteps < 900) {
          await page.clock.fastForward(100);
          await realSleep(150);
          summary = await readSummary(page);
          preSteps += 1;
        }
        if (summary.phase !== "walking") throw new Error(`never reached walking (phase=${summary.phase})`);
        if (summary.driveSource !== "case_owned_bedside_approach") {
          throw new Error(`drive came from ${String(summary.driveSource)}, not the case-owned producer`);
        }
        const growth0 = summary.sampleCount;
        await page.clock.fastForward(500);
        await realSleep(300);
        const growth1 = (await readSummary(page)).sampleCount;
        if (growth1 <= growth0) throw new Error("no samples under fake clock");
        process.stdout.write(`[arm-settle] walking, sample-growth ${growth0} -> ${growth1}\n`);

        const frames: ArmFrame[] = [];
        let step = 0;
        for (;;) {
          await page.clock.fastForward(STEP_SECONDS * 1000);
          await realSleep(120);
          const probe = (await page.evaluate(
            `${ARM_PROBE_SOURCE}(${JSON.stringify({ actorId: walkerActorId })})`,
          )) as
            | { ok: true; bones: ArmFrame["bones"]; points: ArmFrame["points"]; chains: ArmFrame["chains"]; postureTags: Record<string, string | null>; releaseStore: ArmFrame["releaseStore"]; census: Record<string, Array<{ uuid: string; visible: boolean; parent: string | null }>>; legs: ArmFrame["legs"]; actorRoot: ArmFrame["actorRoot"]; snapDebug: unknown }
            | { ok: false; reason?: string };
          if (!probe.ok) throw new Error(`arm probe failed at step ${step}: ${(probe as { reason?: string }).reason}`);
          summary = await readSummary(page);
          const simMs = (await page.evaluate(`(() => Date.now())()`)) as number;
          const rafCount = (await page.evaluate(
            `(() => (globalThis.__armSettleRafCount ?? null))()`,
          )) as number | null;
          frames.push({
            step,
            simMs,
            rafCount,
            phase: summary.phase,
            stoppedSeconds: summary.stoppedSeconds,
            bones: probe.bones,
            points: probe.points,
            legs: probe.legs ?? {},
            actorRoot: probe.actorRoot ?? null,
            snapDebug: probe.snapDebug ?? null,
            chains: probe.chains,
            postureTags: probe.postureTags,
            releaseStore: probe.releaseStore ?? null,
            census: probe.census ?? null,
          });
          step += 1;
          if (step % 60 === 0) {
            process.stdout.write(
              `[arm-settle] step ${step}: phase=${summary.phase} stopped=${summary.stoppedSeconds.toFixed(2)}s\n`,
            );
          }
          if (summary.phase === "arrived" && summary.stoppedSeconds >= HOLD_SECONDS) break;
          if (step >= 1500) throw new Error(`still not 2 s past arrival after ${step} steps`);
        }

        // ---- offline analysis ----
        const armBones = ["upperL", "upperR", "lowerL", "lowerR"] as const;
        const rates = frames.map((f, i) => {
          if (i === 0) return { step: f.step, phase: f.phase, per: {} as Record<string, number>, max: 0 };
          const prev = frames[i - 1];
          if (!prev) return { step: f.step, phase: f.phase, per: {} as Record<string, number>, max: 0 };
          const per: Record<string, number> = {};
          let max = 0;
          for (const b of armBones) {
            const q0 = prev.bones[b]?.quat;
            const q1 = f.bones[b]?.quat;
            const d = q0 && q1 ? quatAngleDeg(q0, q1) : NaN;
            per[b] = d;
            if (Number.isFinite(d) && d > max) max = d;
          }
          return { step: f.step, phase: f.phase, per, max };
        });
        const walkRates = rates.filter((r) => r.phase === "walking").slice(1);
        const walkMax = Math.max(...walkRates.map((r) => r.max));
        const walkMedian =
          walkRates.map((r) => r.max).sort((a, b) => a - b)[Math.floor(walkRates.length / 2)] ?? NaN;
        const firstNonWalking = frames.findIndex((f) => f.phase !== "walking");
        const switchWindow = rates.filter((r) => {
          const f = frames[r.step];
          if (!f) return false;
          return f.phase === "settling" || f.phase === "arrived" || f.phase === "stopping";
        });
        const switchMax = switchWindow.length ? Math.max(...switchWindow.map((r) => r.max)) : NaN;
        const switchFrame = switchWindow.find((r) => r.max === switchMax) ?? null;
        // hold pose: last 10 arrived frames
        const arrived = frames.filter((f) => f.phase === "arrived");
        const hold = arrived.slice(-10);
        const trunkAngles = hold.map((f) => {
          const p = f.points;
          if (!p.pelvis || !p.neck) return { L: NaN, R: NaN };
          const trunkUp = norm(sub(p.neck, p.pelvis));
          const down = { x: -trunkUp.x, y: -trunkUp.y, z: -trunkUp.z };
          const aL = p.shoulderL && p.elbowL ? angleDeg(norm(sub(p.elbowL, p.shoulderL)), down) : NaN;
          const aR = p.shoulderR && p.elbowR ? angleDeg(norm(sub(p.elbowR, p.shoulderR)), down) : NaN;
          return { L: aL, R: aR };
        });
        const holdL = trunkAngles.map((t) => t.L).filter(Number.isFinite);
        const holdR = trunkAngles.map((t) => t.R).filter(Number.isFinite);
        const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
        // elbow bend at hold: 180 - angle(shoulder->elbow, wrist->elbow)... as flexion from straight
        const elbowBend = hold.map((f) => {
          const p = f.points;
          const bL =
            p.shoulderL && p.elbowL && p.wristL
              ? 180 - angleDeg(norm(sub(p.shoulderL, p.elbowL)), norm(sub(p.wristL, p.elbowL)))
              : NaN;
          const bR =
            p.shoulderR && p.elbowR && p.wristR
              ? 180 - angleDeg(norm(sub(p.shoulderR, p.elbowR)), norm(sub(p.wristR, p.elbowR)))
              : NaN;
          return { L: bL, R: bR };
        });
        const analysis = {
          walkClipMaxArmDegPerFrame: walkMax,
          walkMedianArmDegPerFrame: walkMedian,
          walkStartMaxArmDegPerFrame: Math.max(
            ...rates
              .filter((r) => r.phase === "walking" && r.step <= WALK_START_WINDOW_STEPS)
              .map((r) => r.max),
          ),
          walkStartWindowSteps: WALK_START_WINDOW_STEPS,
          switchMaxArmDegPerFrame: switchMax,
          switchStep: switchFrame?.step ?? null,
          switchPhase: switchFrame ? (frames[switchFrame.step]?.phase ?? null) : null,
          firstNonWalkingStep: firstNonWalking,
          midWalk: midWalkSwing(frames, rates),
          holdUpperArmFromTrunkDeg: { L: mean(holdL), R: mean(holdR) },
          holdElbowBendDeg: {
            L: mean(elbowBend.map((e) => e.L).filter(Number.isFinite)),
            R: mean(elbowBend.map((e) => e.R).filter(Number.isFinite)),
          },
          holdFrameCount: hold.length,
          boneNames: {
            upperL: frames[0]?.bones.upperL?.name ?? null,
            upperR: frames[0]?.bones.upperR?.name ?? null,
            lowerL: frames[0]?.bones.lowerL?.name ?? null,
            lowerR: frames[0]?.bones.lowerR?.name ?? null,
          },
        };
        process.stdout.write(`[arm-settle] analysis: ${JSON.stringify(analysis, null, 2)}\n`);

        // ---- control comparison (bars 1-4) ----
        const controlPath = controlPathFromArgv();
        let comparison: null | (LegComparison & {
          controlPath: string;
          controlSwitchMax: number;
          controlWalkStartMax: number;
          controlMidWalk: { upperMedianDegPerFrame: number; peakToPeakDeg: { L: number; R: number } };
          controlHold: { L: number; R: number };
        }) = null;
        if (controlPath !== null) {
          const controlRaw = JSON.parse(await readFile(path.resolve(process.cwd(), controlPath), "utf8")) as {
            analysis: {
              switchMaxArmDegPerFrame: number;
              holdUpperArmFromTrunkDeg: { L: number; R: number };
            };
            frames: ArmFrame[];
          };
          const controlFrames = controlRaw.frames;
          const controlRates = frameRates(controlFrames);
          const controlWalkStartMax = Math.max(
            ...controlRates
              .filter((r) => r.phase === "walking" && r.step <= WALK_START_WINDOW_STEPS)
              .map((r) => r.max),
          );
          comparison = {
            controlPath,
            ...compareLegs(controlFrames, frames),
            controlSwitchMax: controlRaw.analysis.switchMaxArmDegPerFrame,
            controlWalkStartMax,
            controlMidWalk: midWalkSwing(controlFrames, controlRates),
            controlHold: controlRaw.analysis.holdUpperArmFromTrunkDeg,
          };
          process.stdout.write(`[arm-settle] comparison: ${JSON.stringify(comparison, null, 2)}\n`);
        }

        await mkdir(OUT_DIR, { recursive: true });
        const outPath = path.resolve(process.cwd(), OUT_DIR, `${outName}.json`);
        await writeFile(
          outPath,
          `${JSON.stringify(
            {
              schemaVersion: "openclinxr.arm-settle-measurement.v1",
              measuredAt: new Date().toISOString(),
              scenario: scenarioId,
              actorId: walkerActorId,
              codeProof,
              runtimeFlags: "flag-default (no steppingTurn/ccdStanceLock query flags)",
              stepSeconds: STEP_SECONDS,
              holdSeconds: HOLD_SECONDS,
              analysis,
              comparison,
              frames,
            },
            null,
            2,
          )}\n`,
        );
        process.stdout.write(`[arm-settle] wrote ${outPath} (${frames.length} frames)\n`);

        if (reportRequested()) {
          if (comparison === null) throw new Error("--report requires --control=<path>");
          const fixMid = analysis.midWalk as {
            upperMedianDegPerFrame: number;
            peakToPeakDeg: { L: number; R: number };
          };
          const fixHold = analysis.holdUpperArmFromTrunkDeg as { L: number; R: number };
          const bar1 =
            (analysis.switchMaxArmDegPerFrame as number) <= ARM_SNAP_MAX_DEG &&
            (analysis.walkStartMaxArmDegPerFrame as number) <= ARM_SNAP_MAX_DEG;
          const bar2 =
            comparison.lengthMatch &&
            comparison.maxLegQuatComponentDiff <= LEG_IDENTICAL_TOL &&
            comparison.maxRootPosComponentDiff <= LEG_IDENTICAL_TOL;
          const p2p = (m: { peakToPeakDeg: { L: number; R: number } }) =>
            (m.peakToPeakDeg.L + m.peakToPeakDeg.R) / 2;
          const bar3 =
            Math.abs(fixMid.upperMedianDegPerFrame - comparison.controlMidWalk.upperMedianDegPerFrame) <=
              SWING_MEDIAN_TOL_DEG && p2p(fixMid) >= SWING_P2P_RATIO * p2p(comparison.controlMidWalk);
          const bar4 =
            Math.abs(fixHold.L - HOLD_TARGET_DEG) <= HOLD_TOL_DEG &&
            Math.abs(fixHold.R - HOLD_TARGET_DEG) <= HOLD_TOL_DEG;
          const failedBars: string[] = [];
          if (!bar1) failedBars.push("bar1");
          if (!bar2) failedBars.push("bar2");
          if (!bar3) failedBars.push("bar3");
          if (!bar4) failedBars.push("bar4");
          const report = {
            schemaVersion: "openclinxr.arm-settle-report.v1",
            measuredAt: new Date().toISOString(),
            scenario: scenarioId,
            actorId: walkerActorId,
            verdict: failedBars.length === 0 ? "adopt" : "reject",
            failedBars,
            table: {
              switchMaxArmDegPerFrame: { control: comparison.controlSwitchMax, fix: analysis.switchMaxArmDegPerFrame, cap: ARM_SNAP_MAX_DEG },
              walkStartMaxArmDegPerFrame: { control: comparison.controlWalkStartMax, fix: analysis.walkStartMaxArmDegPerFrame, cap: ARM_SNAP_MAX_DEG },
              maxLegQuatComponentDiff: { fixVsControl: comparison.maxLegQuatComponentDiff, tol: LEG_IDENTICAL_TOL, worstBone: comparison.worstLegBone, worstStep: comparison.worstLegStep },
              maxRootPosComponentDiff: { fixVsControl: comparison.maxRootPosComponentDiff, tol: LEG_IDENTICAL_TOL, worstKind: comparison.worstRootKind, worstStep: comparison.worstRootStep },
              frameCount: { control: comparison.controlFrameCount, fix: comparison.fixFrameCount, lengthMatch: comparison.lengthMatch },
              midWalkUpperMedianDegPerFrame: { control: comparison.controlMidWalk.upperMedianDegPerFrame, fix: fixMid.upperMedianDegPerFrame, tol: SWING_MEDIAN_TOL_DEG },
              midWalkPeakToPeakDeg: { control: comparison.controlMidWalk.peakToPeakDeg, fix: fixMid.peakToPeakDeg, ratio: SWING_P2P_RATIO },
              holdUpperArmFromTrunkDeg: { control: comparison.controlHold, fix: fixHold, target: HOLD_TARGET_DEG, tol: HOLD_TOL_DEG },
            },
            legsIdentical: bar2,
            fixCodeProof: codeProof,
          };
          const reportPath = path.resolve(process.cwd(), OUT_DIR, "report.json");
          await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
          process.stdout.write(`[arm-settle] wrote ${reportPath} verdict=${report.verdict}\n`);
        }
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
