/**
 * Settle-entry determinism capture (2026-10-12 slice): per-frame entry-phase
 * record for the walk-to-settling transition, both vehicles, N runs each.
 *
 * Vehicles: `--vehicle=sc05` (SC-05 bedside approach, stepping turn on) and
 * `--vehicle=loco` (6 m proving ground, shipped lock). No screenshots: one
 * page.evaluate per 1/30 s step records the evidence tail, the walk action's
 * clip time (userData playback), and upper-leg/foot bone orientations.
 *
 * Clock/bundle discipline mirrors loco-ground-capture.ts (fake 30 fps clock
 * with hold + growth probes, scene-closure bundle/URL builders, dist marker
 * proof). Browser behind the compute-services facade (no direct launch).
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/settle-entry/settle-entry-capture.ts \
 *     --vehicle=sc05 --runs=6 --out=.openclinxr/evidence/settle-entry/control \
 *     [--pacing=capture|real|fixed72|jitter] [--query=fixedClock=0] [--start=N] [--trace]
 *
 * Pacing: capture = legacy fake 30 fps clock; real = wall-clock rAF with no
 * fake clock; fixed72 = synthetic steady 72 Hz; jitter = seeded uniform over
 * [1/90, 1/45] s, seed 20261012, identical schedule every run.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "../lib/slotted-playwright.js";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
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

type Pacing = "capture" | "real" | "fixed72" | "jitter";

function pacingFromArgv(): Pacing {
  const flag = process.argv.find((a) => a.startsWith("--pacing="))?.slice("--pacing=".length);
  if (flag === undefined) return "capture";
  if (flag === "capture" || flag === "real" || flag === "fixed72" || flag === "jitter") return flag;
  throw new Error("usage: --pacing=capture|real|fixed72|jitter");
}

/** Fixed seed so every jittered run replays the identical dt schedule. */
const JITTER_SEED = 20261012;

/** Deterministic uniform PRNG (mulberry32) for the reproducible jitter schedule. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Per-step simulated dt for a synthetic pacing. capture = legacy 30 Hz fake
 * clock; fixed72 = steady 72 Hz; jitter = seeded uniform over [1/90, 1/45] s.
 */
function syntheticStepSeconds(pacing: Pacing, draw: () => number): number {
  if (pacing === "fixed72") return 1 / 72;
  if (pacing === "jitter") return 1 / 90 + draw() * (1 / 45 - 1 / 90);
  return STEP_SECONDS;
}

function extraQueryFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--query="))?.slice("--query=".length);
  return flag === undefined || flag === "" ? "" : `&${flag}`;
}

function vehicleFromArgv(): Vehicle {
  const flag = process.argv.find((a) => a.startsWith("--vehicle="))?.slice("--vehicle=".length);
  if (flag === "sc05" || flag === "loco") return flag;
  throw new Error("usage: settle-entry-capture.ts --vehicle=sc05|loco --runs=N --out=dir");
}

function runsFromArgv(): number {
  const flag = process.argv.find((a) => a.startsWith("--runs="))?.slice("--runs=".length);
  const n = Number(flag);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("usage: --runs=N (1..20)");
  return n;
}

function outFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);
  if (!flag) throw new Error("usage: settle-entry-capture.ts --out=dir");
  return flag;
}

function startFromArgv(): number {
  const flag = process.argv.find((a) => a.startsWith("--start="))?.slice("--start=".length);
  if (flag === undefined) return 0;
  const n = Number(flag);
  if (!Number.isInteger(n) || n < 0) throw new Error("usage: --start=N (non-negative)");
  return n;
}

function urlQuery(vehicle: Vehicle): string {
  if (vehicle === "loco") return "locoGround=1";
  return "steppingTurn=1";
}

function traceFromArgv(): boolean {
  return process.argv.includes("--trace");
}

const TRACE_SOURCE = `
(() => {
  const t = globalThis.__openClinXrSteppingTurnTrace;
  return Array.isArray(t) ? t : null;
})()
`;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

type FrameProbe = {
  phase: string | null;
  sampleCount: number;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  /** Live rendered XZ of the physician root (post-interpolation once the fixed clock lands). */
  liveSlot: { x: number; z: number } | null;
  /** Per-display-frame fixed-clock stats; null on builds without the clock. */
  fixedClock: { substeps: number; frameMs: number } | null;
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
  stoppedSeconds: number;
  targetHeading: number | null;
  travelHeading: number | null;
  startWorld: Vec3 | null;
  targetWorld: Vec3 | null;
};

/** One roundtrip per frame: evidence tail + walk clip time + leg/foot orientations. */
const PROBE_SOURCE = `
(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  const samples = ev && ev.samples ? ev.samples : [];
  const tail = samples.length ? samples[samples.length - 1] : null;
  const scene = globalThis.__openClinXrDebugScene;
  let clipTime = null;
  let liveSlot = null;
  let fixedClock = null;
  try {
    const stats = globalThis.__openClinXrFixedClockStats;
    if (stats && typeof stats.substeps === "number") {
      fixedClock = { substeps: stats.substeps, frameMs: stats.frameMs };
    }
  } catch { fixedClock = null; }
  let upperL = null, upperR = null, footYawL = null, footYawR = null;
  let legBones = null, legWorlds = null;
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
      liveSlot = { x: physRoot.position.x, z: physRoot.position.z };
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
        hipR: wOf("upperleg01R", "upperleg01.R"),
        kneeR: wOf("lowerleg01R", "lowerleg01.R"),
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
    }
  }
  return {
    phase: ev ? ev.phase : null,
    sampleCount: samples.length,
    slot: tail && tail.slot ? tail.slot : null,
    liveSlot,
    fixedClock,
    leftToe: tail ? tail.leftToe : null,
    rightToe: tail ? tail.rightToe : null,
    stanceFoot: tail ? tail.stanceFoot : null,
    travelledMeters: tail && tail.travelledMeters !== undefined ? tail.travelledMeters : null,
    clipTime,
    upperL, upperR, legBones, legWorlds, footYawL, footYawR,
    stoppedSeconds: ev ? ev.stoppedSeconds : 0,
    targetHeading: ev ? ev.targetHeadingRadians : null,
    travelHeading: ev ? ev.travelHeadingRadians : null,
    startWorld: ev ? ev.startWorld : null,
    targetWorld: ev ? ev.targetWorld : null,
  };
})()
`;

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

const ARRIVAL_SOURCE = `
(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  const samples = ev && ev.samples ? ev.samples : [];
  for (const s of samples) {
    if (s && s.phase === "arrived") return { slot: s.slot ?? null, atMs: s.atMs ?? null, sampleCount: samples.length };
  }
  return null;
})()
`;

async function probe(page: Page): Promise<FrameProbe> {
  return (await page.evaluate(PROBE_SOURCE)) as FrameProbe;
}

type DistProof = Array<{ file: string; sha256: string; markerHits: number }>;

type CapturedFrame = FrameProbe & { step: number; dtSeconds: number };

type LabelsRecord = {
  clipName: string;
  cycleSeconds: number;
  atMs: number[];
  left: boolean[];
  right: boolean[];
} | null;

async function readLabels(page: Page): Promise<LabelsRecord> {
  return (await page.evaluate(LABELS_SOURCE)) as LabelsRecord;
}

async function readArrival(page: Page): Promise<{ slot: unknown; atMs: unknown; sampleCount: number } | null> {
  return (await page.evaluate(ARRIVAL_SOURCE)) as { slot: unknown; atMs: unknown; sampleCount: number } | null;
}

async function runOnce(
  vehicle: Vehicle,
  pacing: Pacing,
  extraQuery: string,
  runIndex: number,
  outDir: string,
  distProof: DistProof,
  bundleJson: string,
  baseUrl: string,
  browser: Browser,
): Promise<void> {
  if (pacing === "real") {
    await runOnceRealTime(vehicle, extraQuery, runIndex, outDir, distProof, bundleJson, baseUrl, browser);
    return;
  }
  await runOnceSynthetic(vehicle, pacing, extraQuery, runIndex, outDir, distProof, bundleJson, baseUrl, browser);
}

async function runOnceRealTime(
  vehicle: Vehicle,
  extraQuery: string,
  runIndex: number,
  outDir: string,
  distProof: DistProof,
  bundleJson: string,
  baseUrl: string,
  browser: Browser,
): Promise<void> {
  const tag = `${vehicle}-run${runIndex}`;
  const pacing: Pacing = "real";
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    const url = `${buildSceneClosureUrl(baseUrl)}&${urlQuery(vehicle)}${extraQuery}${traceFromArgv() ? "&steppingTurnTrace=1" : ""}`;
    await page.goto(url, { waitUntil: "load", timeout: 180_000 });
    // No fake clock: the page runs on wall-clock rAF pacing. Pre-walk polls let GLB I/O proceed.
    const preWalk: Array<FrameProbe & { preStep: number }> = [];
    let poll = await probe(page);
    let preSteps = 0;
    while (poll.phase !== "walking" && preSteps < PRE_WALK_STEP_CAP) {
      preWalk.push({ ...poll, preStep: preSteps });
      await realSleep(200);
      poll = await probe(page);
      preSteps += 1;
    }
    if (poll.phase !== "walking") throw new Error(`never reached walking (phase=${poll.phase})`);
    const g0 = poll.sampleCount;
    await realSleep(1000);
    const g1 = (await probe(page)).sampleCount;
    process.stdout.write(`[${tag}] sample-growth: ${g0} -> ${g1} per 1000 ms wall\n`);
    if (g1 <= g0) throw new Error("no samples in wall-clock mode");
    const labels = await readLabels(page);
    const frames: CapturedFrame[] = [];
    let step = 0;
    let previousWall = Date.now();
    for (;;) {
      await realSleep(50);
      const frame = await probe(page);
      const wallNow = Date.now();
      frames.push({ ...frame, step, dtSeconds: (wallNow - previousWall) / 1000 });
      previousWall = wallNow;
      step += 1;
      if (step % 60 === 0) {
        process.stdout.write(
          `[${tag}] poll ${step}: phase=${frame.phase} clipTime=${frame.clipTime?.toFixed(3) ?? "?"} stance=${frame.stanceFoot} stopped=${frame.stoppedSeconds.toFixed(2)}s\n`,
        );
      }
      if (frame.phase === "arrived" && (frame.stoppedSeconds ?? 0) >= 1) break;
      if (step >= 2400) throw new Error(`still not arrived after ${step} wall polls (phase=${frame.phase})`);
    }
    const first = frames[0];
    process.stdout.write(
      `[${tag}] frames=${frames.length} route=${first?.startWorld ? `${Math.hypot((first.targetWorld?.x ?? 0) - first.startWorld.x, (first.targetWorld?.z ?? 0) - first.startWorld.z).toFixed(2)}m` : "?"} labels=${labels ? "yes" : "NO-LABELS"}\n`,
    );
    const trace = traceFromArgv() ? ((await page.evaluate(TRACE_SOURCE)) as unknown[] | null) : null;
    process.stdout.write(`[${tag}] stepping-turn trace frames=${trace === null ? "OFF" : trace.length}\n`);
    if (traceFromArgv()) {
      await writeFile(path.join(outDir, `${tag}.trace.json`), JSON.stringify(trace, null, 2));
    }
    await writeFile(
      path.join(outDir, `${tag}.json`),
      JSON.stringify(
        {
          schemaVersion: "openclinxr.settle-entry-capture.v1",
          measuredAt: new Date().toISOString(),
          vehicle,
          pacing,
          seed: null,
          runIndex,
          urlQuery: `${urlQuery(vehicle)}${extraQuery}`,
          scenario: SCENE_CLOSURE_SCENARIO_ID,
          distProof,
          clockHonoured: false,
          labels,
          preWalk,
          probeGapMs: null,
          arrivalSample: await readArrival(page),
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

async function runOnceSynthetic(
  vehicle: Vehicle,
  pacing: Pacing,
  extraQuery: string,
  runIndex: number,
  outDir: string,
  distProof: DistProof,
  bundleJson: string,
  baseUrl: string,
  browser: Browser,
): Promise<void> {
  const tag = `${vehicle}-run${runIndex}`;
  const draw = mulberry32(JITTER_SEED);
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    const url = `${buildSceneClosureUrl(baseUrl)}&${urlQuery(vehicle)}${extraQuery}${traceFromArgv() ? "&steppingTurnTrace=1" : ""}`;
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
    // Keep every pre-walk tail so the divergence analysis sees walk-start
    // nondeterminism (idle phase, asset-load timing) instead of only the walk.
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
    const labels = await readLabels(page);

    // Fine steps: record every frame until 1 s arrived.
    const frames: CapturedFrame[] = [];
    let step = 0;
    for (;;) {
      const stepSeconds = syntheticStepSeconds(pacing, draw);
      await page.clock.fastForward(stepSeconds * 1000);
      const f = await probe(page);
      frames.push({ ...f, step, dtSeconds: stepSeconds });
      step += 1;
      if (step % 60 === 0) {
        process.stdout.write(
          `[${tag}] step ${step}: phase=${f.phase} clipTime=${f.clipTime?.toFixed(3) ?? "?"} stance=${f.stanceFoot} stopped=${f.stoppedSeconds.toFixed(2)}s\n`,
        );
      }
      if (f.phase === "arrived" && (f.stoppedSeconds ?? 0) >= 1) break;
      if (step >= STEP_CAP) throw new Error(`still not arrived after ${step} steps (phase=${f.phase})`);
    }
    const first = frames[0];
    process.stdout.write(
      `[${tag}] frames=${frames.length} route=${first?.startWorld ? `${Math.hypot((first.targetWorld?.x ?? 0) - first.startWorld.x, (first.targetWorld?.z ?? 0) - first.startWorld.z).toFixed(2)}m` : "?"} labels=${labels ? "yes" : "NO-LABELS"}\n`,
    );
    const trace = traceFromArgv() ? ((await page.evaluate(TRACE_SOURCE)) as unknown[] | null) : null;
    process.stdout.write(`[${tag}] stepping-turn trace frames=${trace === null ? "OFF" : trace.length}\n`);
    if (traceFromArgv()) {
      await writeFile(path.join(outDir, `${tag}.trace.json`), JSON.stringify(trace, null, 2));
    }
    await writeFile(
      path.join(outDir, `${tag}.json`),
      JSON.stringify(
        {
          schemaVersion: "openclinxr.settle-entry-capture.v1",
          measuredAt: new Date().toISOString(),
          vehicle,
          pacing,
          seed: pacing === "jitter" ? JITTER_SEED : null,
          runIndex,
          urlQuery: `${urlQuery(vehicle)}${extraQuery}`,
          scenario: SCENE_CLOSURE_SCENARIO_ID,
          distProof,
          clockHonoured,
          labels,
          preWalk,
          probeGapMs: 500,
          arrivalSample: await readArrival(page),
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
  const pacing = pacingFromArgv();
  const extraQuery = extraQueryFromArgv();
  const runs = runsFromArgv();
  const start = startFromArgv();
  const outDir = outFromArgv();
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
    await services.sceneCapture.withBrowser(`settle-entry-${vehicle}-${pacing}`, async (browser) => {
      for (let i = start; i < start + runs; i += 1) {
        await runOnce(vehicle, pacing, extraQuery, i, outDir, distProof, bundleJson, server.url, browser as Browser);
      }
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
