/**
 * Settle-entry determinism analysis (2026-10-12 slice): reads one capture dir
 * (settle-entry-capture.ts outputs) and prints the whole table.
 *
 * Per run: entry clip time + stance labels on last-walking / first-settling
 * frames, predicted vs actual pivot / first swing, arrival slot + yaw, planted
 * foot yaw, arrival error (along-route / lateral), settling + walk duration,
 * max one-frame foot + upper-leg steps over the last 0.6 s of walking plus
 * settling, stance-foot slide per planted window. Then mean/sd/range per
 * metric, a group table by entry phase / pivot foot, and the divergence scan
 * (first step + field where two runs differ, with magnitudes).
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/settle-entry/settle-entry-analyze.ts \
 *     --dir=.openclinxr/evidence/settle-entry/control --out=.openclinxr/evidence/settle-entry/control-summary.json
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normBandOf, quatStepDeg, type NormBand } from "./quat-norm-math.js";

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };
type Slot = { x: number; y: number; z: number; yaw: number };

type Frame = {
  step: number;
  /** Simulated dt of this display frame; absent on pre-pacing captures (legacy 1/30 s). */
  dtSeconds?: number;
  phase: string | null;
  slot: Slot | null;
  /** Live rendered root XZ; null on pre-pacing captures. */
  liveSlot?: { x: number; z: number } | null;
  /** Per-display-frame fixed-clock stats; null without the clock. */
  fixedClock?: { substeps: number; frameMs: number } | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  stanceFoot: string | null;
  travelledMeters: number | null;
  clipTime: number | null;
  upperL: Quat | null;
  upperR: Quat | null;
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

type RunFile = {
  vehicle: string;
  pacing?: string;
  seed?: number | null;
  runIndex: number;
  labels: { clipName: string; cycleSeconds: number; atMs: number[]; left: boolean[]; right: boolean[] } | null;
  preWalk: Array<Record<string, unknown>>;
  /** First telemetry sample at phase arrived; null on pre-pacing captures. */
  arrivalSample?: { slot: Slot | null; atMs: number | null; sampleCount: number } | null;
  frames: Frame[];
};

function dirFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
  if (!flag) throw new Error("usage: settle-entry-analyze.ts --dir=captureDir [--out=summary.json]");
  return flag;
}

function outFromArgv(): string | null {
  return process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;
}

/** Nearest-sample stance read, mirroring stanceAtTime (locomotion-stance-labels.ts). */
function stanceAt(
  labels: { cycleSeconds: number; atMs: number[]; left: boolean[]; right: boolean[] },
  t: number,
): { left: boolean; right: boolean } {
  const count = labels.atMs.length;
  if (count === 0 || !(labels.cycleSeconds > 0)) return { left: false, right: false };
  const wrapped = ((t % labels.cycleSeconds) + labels.cycleSeconds) % labels.cycleSeconds;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const sampleTime = (labels.atMs[index] ?? 0) / 1000;
    const direct = Math.abs(sampleTime - wrapped);
    const distance = Math.min(direct, labels.cycleSeconds - direct);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return { left: labels.left[best] ?? false, right: labels.right[best] ?? false };
}

function shortestYawDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function xzStep(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function stats(values: number[]): { n: number; mean: number; sd: number; min: number; max: number } {
  const n = values.length;
  const mean = n === 0 ? Number.NaN : values.reduce((s, v) => s + v, 0) / n;
  const sd = n < 2 ? 0 : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, min: n === 0 ? Number.NaN : Math.min(...values), max: n === 0 ? Number.NaN : Math.max(...values) };
}

const fmt = (v: number, digits = 4): string =>
  Number.isNaN(v) ? "NaN" : v.toFixed(digits);

function labelStr(s: { left: boolean; right: boolean }): string {
  if (s.left && s.right) return "both";
  if (s.left) return "L";
  if (s.right) return "R";
  return "none";
}

type RunMetrics = {
  tag: string;
  walkFrames: number;
  settlingFrames: number;
  clipTimeW: number | null;
  clipTimeS: number | null;
  labelW: string;
  labelS: string;
  /** First single-stance label at/after entry (the clip-driven pivot prediction). */
  firstSingleAfterEntry: string;
  entryYawDeg: number | null;
  residualDeg: number | null;
  predictedFirstSwing: string | null;
  actualFirstStance: string | null;
  actualFirstSwing: string | null;
  arrivalSlot: { x: number; z: number } | null;
  arrivalYawDeg: number | null;
  plantFoot: string | null;
  plantYawDeg: number | null;
  alongM: number | null;
  lateralM: number | null;
  settlingS: number;
  walkRecordedS: number;
  maxFootStepM: number;
  maxLegStepDeg: number;
  /** Min/max quaternion norm per bone over all frames (its own metric). */
  legNormBands: Record<string, NormBand | null>;
  /** Thigh segment (hip-to-knee world) min/max per side; null without legWorlds. */
  thighLenL: NormBand | null;
  thighLenR: NormBand | null;
  windowSlidesM: number[];
  meanWindowSlideM: number;
  maxWindowSlideM: number;
  /** Walking-phase along-route monotonicity of the rendered track (bar 5). */
  renderedReversals: number;
  renderedMaxSecondDiffM: number;
  /** Per-display-frame substep counts; empty without the fixed clock. */
  substepHist: Record<string, number>;
  meanFixedClockFrameMs: number | null;
};

function analyzeRun(tag: string, run: RunFile): RunMetrics {
  const frames = run.frames;
  const walkIdx = frames.map((f, i) => (f.phase === "walking" ? i : -1)).filter((i) => i >= 0);
  const settleIdx = frames.map((f, i) => (f.phase === "settling" ? i : -1)).filter((i) => i >= 0);
  const arrivedIdx = frames.map((f, i) => (f.phase === "arrived" ? i : -1)).filter((i) => i >= 0);
  const lastW = walkIdx.length > 0 ? frames[walkIdx[walkIdx.length - 1]!]! : null;
  const firstS = settleIdx.length > 0 ? frames[settleIdx[0]!]! : null;
  const lastS = settleIdx.length > 0 ? frames[settleIdx[settleIdx.length - 1]!]! : null;
  const firstA = arrivedIdx.length > 0 ? frames[arrivedIdx[0]!]! : null;

  const clipTimeW = lastW?.clipTime ?? null;
  const clipTimeS = firstS?.clipTime ?? null;
  let labelW = "?";
  let labelS = "?";
  let firstSingleAfterEntry = "?";
  if (run.labels !== null) {
    if (clipTimeW !== null) labelW = labelStr(stanceAt(run.labels, clipTimeW));
    if (clipTimeS !== null) {
      labelS = labelStr(stanceAt(run.labels, clipTimeS));
      // Scan forward in clip time for the first single label (double support waits).
      const cyc = run.labels.cycleSeconds;
      for (let dt = 0; dt <= cyc + 1e-9; dt += 1 / 30) {
        const lab = labelStr(stanceAt(run.labels, clipTimeS + dt));
        if (lab === "L" || lab === "R") {
          firstSingleAfterEntry = lab;
          break;
        }
      }
    }
  }

  const entryYaw = firstS?.slot?.yaw ?? lastW?.slot?.yaw ?? null;
  const targetHeading = firstS?.targetHeading ?? firstA?.targetHeading ?? null;
  const residual = entryYaw !== null && targetHeading !== null ? shortestYawDelta(entryYaw, targetHeading) : null;
  const predictedFirstSwing =
    residual === null ? null : residual >= 0 ? "right" : "left";
  const actualFirstStance = firstS?.stanceFoot ?? null;
  const actualFirstSwing =
    actualFirstStance === "left" ? "right" : actualFirstStance === "right" ? "left" : null;

  const arrivalSlot =
    run.arrivalSample?.slot !== null && run.arrivalSample?.slot !== undefined
      ? { x: run.arrivalSample.slot.x, z: run.arrivalSample.slot.z }
      : firstA?.slot !== null && firstA?.slot !== undefined
        ? { x: firstA.slot.x, z: firstA.slot.z }
        : lastS?.slot !== null && lastS?.slot !== undefined
          ? { x: lastS.slot.x, z: lastS.slot.z }
          : null;
  const arrivalYaw = firstA?.slot?.yaw ?? lastS?.slot?.yaw ?? null;
  // Plant foot: the lower toe on the arrival frame.
  const arrivalFrame = firstA ?? lastS;
  let plantFoot: string | null = null;
  if (arrivalFrame?.leftToe && arrivalFrame?.rightToe) {
    plantFoot = arrivalFrame.leftToe.y <= arrivalFrame.rightToe.y ? "left" : "right";
  } else {
    plantFoot = arrivalFrame?.stanceFoot ?? null;
  }
  const plantYaw =
    plantFoot === "left" ? (arrivalFrame?.footYawL ?? null) : plantFoot === "right" ? (arrivalFrame?.footYawR ?? null) : null;

  // Arrival error along-route / lateral from start->target axis.
  const start = firstS?.startWorld ?? firstA?.startWorld ?? null;
  const target = firstS?.targetWorld ?? firstA?.targetWorld ?? null;
  let along: number | null = null;
  let lateral: number | null = null;
  if (start !== null && target !== null && arrivalSlot !== null) {
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      const ux = dx / len;
      const uz = dz / len;
      const ex = arrivalSlot.x - target.x;
      const ez = arrivalSlot.z - target.z;
      along = ex * ux + ez * uz;
      lateral = ex * -uz + ez * ux;
    }
  }

  const frameDt = (f: Frame): number => (typeof f.dtSeconds === "number" && f.dtSeconds > 0 ? f.dtSeconds : 1 / 30);
  const settlingS = settleIdx.length > 0 ? settleIdx.reduce((s, i) => s + frameDt(frames[i]!), 0) : 0;
  const walkRecordedS = walkIdx.length > 0 ? walkIdx.reduce((s, i) => s + frameDt(frames[i]!), 0) : 0;

  // Window: last 0.6 s of walking (18 frames) plus all settling.
  const windowIdx = [
    ...walkIdx.slice(Math.max(0, walkIdx.length - 18)),
    ...settleIdx,
  ];
  let maxFootStepM = 0;
  let maxLegStepDeg = 0;
  for (let k = 1; k < windowIdx.length; k += 1) {
    const a = frames[windowIdx[k - 1]!]!;
    const b = frames[windowIdx[k]!]!;
    if (a.leftToe && b.leftToe) maxFootStepM = Math.max(maxFootStepM, xzStep(a.leftToe, b.leftToe));
    if (a.rightToe && b.rightToe) maxFootStepM = Math.max(maxFootStepM, xzStep(a.rightToe, b.rightToe));
    if (a.upperL && b.upperL) maxLegStepDeg = Math.max(maxLegStepDeg, quatStepDeg(a.upperL, b.upperL));
    if (a.upperR && b.upperR) maxLegStepDeg = Math.max(maxLegStepDeg, quatStepDeg(a.upperR, b.upperR));
    // All four leg joints per side when the capture records them (turn-leg-snaps).
    for (const key of ["upperleg01L", "upperleg02L", "lowerleg01L", "lowerleg02L", "upperleg01R", "upperleg02R", "lowerleg01R", "lowerleg02R"]) {
      const qa = a.legBones?.[key] ?? null;
      const qb = b.legBones?.[key] ?? null;
      if (qa && qb) maxLegStepDeg = Math.max(maxLegStepDeg, quatStepDeg(qa, qb));
    }
  }

  // Planted windows during settling: runs of equal stanceFoot; slide = stance-toe XZ span.
  const windowSlidesM: number[] = [];
  const runStart: number | null = null;
  const runFoot: string | null = null;
  const flush = (): void => {
    if (runStart === null || runFoot === null) return;
    const end = windowSlidesM.length; // placeholder, replaced below
    void end;
  };
  void flush;
  let curFoot: string | null = null;
  let curToes: Vec3[] = [];
  const pushRun = (): void => {
    if (curFoot !== null && curToes.length >= 2) {
      const base = curToes[0]!;
      let span = 0;
      for (const t of curToes) span = Math.max(span, xzStep(base, t));
      windowSlidesM.push(span);
    }
    curFoot = null;
    curToes = [];
  };
  for (const i of settleIdx) {
    const f = frames[i]!;
    const stance = f.stanceFoot;
    const toe = stance === "left" ? f.leftToe : stance === "right" ? f.rightToe : null;
    if (stance !== curFoot) {
      pushRun();
      curFoot = stance;
      curToes = [];
    }
    if (toe !== null && (stance === "left" || stance === "right")) curToes.push(toe);
  }
  pushRun();
  void runStart;
  void runFoot;

  // Per-bone quaternion norm bands over ALL frames (not just the window).
  const legNormBands: Record<string, NormBand | null> = {};
  const boneKeys = [
    "upperleg01L", "upperleg02L", "lowerleg01L", "lowerleg02L",
    "upperleg01R", "upperleg02R", "lowerleg01R", "lowerleg02R",
  ];
  for (const key of boneKeys) {
    legNormBands[key] = normBandOf(frames.map((f) => f.legBones?.[key] ?? null));
  }
  legNormBands["upperL"] = normBandOf(frames.map((f) => f.upperL));
  legNormBands["upperR"] = normBandOf(frames.map((f) => f.upperR));
  // Thigh segment length (hip-to-knee world distance) per side; needs legWorlds.
  const thighLen = (side: "L" | "R"): NormBand | null => {
    const lens: number[] = [];
    for (const f of frames) {
      const hip = f.legWorlds?.[`hip${side}`] ?? null;
      const knee = f.legWorlds?.[`knee${side}`] ?? null;
      if (hip && knee) lens.push(Math.hypot(hip.x - knee.x, hip.y - knee.y, hip.z - knee.z));
    }
    if (lens.length === 0) return null;
    return { min: Math.min(...lens), max: Math.max(...lens) };
  };

  // Rendered-track monotonicity (bar 5): along-route projection of the live
  // rendered root while walking must never step backward; second differences
  // bound the stutter. Falls back to the telemetry slot on old captures.
  let renderedReversals = 0;
  let renderedMaxSecondDiffM = 0;
  if (start !== null && target !== null) {
    const rdx = target.x - start.x;
    const rdz = target.z - start.z;
    const rlen = Math.hypot(rdx, rdz);
    if (rlen > 0) {
      const alongs: number[] = [];
      for (const i of walkIdx) {
        const f = frames[i]!;
        const px = f.liveSlot?.x ?? f.slot?.x ?? null;
        const pz = f.liveSlot?.z ?? f.slot?.z ?? null;
        if (px === null || pz === null) continue;
        alongs.push(((px - start.x) * rdx + (pz - start.z) * rdz) / rlen);
      }
      for (let k = 1; k < alongs.length; k += 1) {
        if (alongs[k]! - alongs[k - 1]! < -1e-9) renderedReversals += 1;
      }
      for (let k = 1; k + 1 < alongs.length; k += 1) {
        const second = Math.abs(alongs[k + 1]! - 2 * alongs[k]! + alongs[k - 1]!);
        if (second > renderedMaxSecondDiffM) renderedMaxSecondDiffM = second;
      }
    }
  }
  const substepHist: Record<string, number> = {};
  const frameMsValues: number[] = [];
  for (const f of frames) {
    if (f.fixedClock !== null && f.fixedClock !== undefined) {
      const key = String(f.fixedClock.substeps);
      substepHist[key] = (substepHist[key] ?? 0) + 1;
      frameMsValues.push(f.fixedClock.frameMs);
    }
  }

  return {
    tag,
    walkFrames: walkIdx.length,
    settlingFrames: settleIdx.length,
    clipTimeW,
    clipTimeS,
    labelW,
    labelS,
    firstSingleAfterEntry,
    entryYawDeg: entryYaw !== null ? (entryYaw * 180) / Math.PI : null,
    residualDeg: residual !== null ? (residual * 180) / Math.PI : null,
    predictedFirstSwing,
    actualFirstStance,
    actualFirstSwing,
    arrivalSlot,
    arrivalYawDeg: arrivalYaw !== null ? (arrivalYaw * 180) / Math.PI : null,
    plantFoot,
    plantYawDeg: plantYaw !== null ? (plantYaw * 180) / Math.PI : null,
    alongM: along,
    lateralM: lateral,
    settlingS,
    walkRecordedS,
    maxFootStepM,
    maxLegStepDeg,
    legNormBands,
    thighLenL: thighLen("L"),
    thighLenR: thighLen("R"),
    windowSlidesM,
    meanWindowSlideM:
      windowSlidesM.length === 0 ? 0 : windowSlidesM.reduce((s, v) => s + v, 0) / windowSlidesM.length,
    maxWindowSlideM: windowSlidesM.length === 0 ? 0 : Math.max(...windowSlidesM),
    renderedReversals,
    renderedMaxSecondDiffM,
    substepHist,
    meanFixedClockFrameMs:
      frameMsValues.length === 0 ? null : frameMsValues.reduce((s, v) => s + v, 0) / frameMsValues.length,
  };
}

async function main(): Promise<void> {
  const dir = dirFromArgv();
  const out = outFromArgv();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f.includes("-run")).sort();
  if (files.length === 0) throw new Error(`no run files in ${dir}`);
  const metrics: RunMetrics[] = [];
  const preWalkFirst: Array<{ tag: string; n: number; firstPhase: unknown; lastPhase: unknown }> = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(path.join(dir, file), "utf8")) as RunFile;
    if (!Array.isArray((run as unknown as { frames?: unknown }).frames)) continue;
    const tag = file.replace(/\.json$/, "");
    const m = analyzeRun(tag, run);
    metrics.push(m);
    preWalkFirst.push({
      tag,
      n: run.preWalk.length,
      firstPhase: (run.preWalk[0] as Frame | undefined)?.phase ?? null,
      lastPhase: (run.preWalk[run.preWalk.length - 1] as Frame | undefined)?.phase ?? null,
    });
  }

  const lines: string[] = [];
  lines.push(`# settle-entry analysis: ${dir} (${metrics.length} runs)`);
  lines.push(`pre-walk steps per run: ${preWalkFirst.map((p) => `${p.tag}=${p.n}`).join(" ")}`);
  lines.push("");
  lines.push(
    "| run | clipW | labW | clipS | labS | 1stSingle | residDeg | predSwing | actStance | along(m) | lat(m) | arrYaw | plantYaw | settleS | walkRecS |",
  );
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const m of metrics) {
    lines.push(
      `| ${m.tag} | ${m.clipTimeW?.toFixed(3) ?? "?"} | ${m.labelW} | ${m.clipTimeS?.toFixed(3) ?? "?"} | ${m.labelS} | ${m.firstSingleAfterEntry} | ${m.residualDeg?.toFixed(1) ?? "?"} | ${m.predictedFirstSwing ?? "?"} | ${m.actualFirstStance ?? "?"} | ${m.alongM?.toFixed(3) ?? "?"} | ${m.lateralM?.toFixed(3) ?? "?"} | ${m.arrivalYawDeg?.toFixed(1) ?? "?"} | ${m.plantFoot ?? "?"}:${m.plantYawDeg?.toFixed(1) ?? "?"} | ${m.settlingS.toFixed(2)} | ${m.walkRecordedS.toFixed(2)} |`,
    );
  }
  lines.push("");

  // Per-run leg quaternion norm bands + thigh variation (turn-leg-snaps bars).
  lines.push("## leg quaternion norm per bone (min..max over all frames) + thigh length variation");
  for (const m of metrics) {
    const bands = Object.entries(m.legNormBands)
      .map(([k, b]) => `${k}=${b === null ? "?" : `${b.min.toFixed(4)}..${b.max.toFixed(4)}`}`)
      .join(" ");
    const thigh =
      m.thighLenL === null && m.thighLenR === null
        ? "thigh=n/a(no legWorlds)"
        : `thighL=${m.thighLenL === null ? "?" : `${m.thighLenL.min.toFixed(4)}..${m.thighLenL.max.toFixed(4)}`} `
          + `thighR=${m.thighLenR === null ? "?" : `${m.thighLenR.min.toFixed(4)}..${m.thighLenR.max.toFixed(4)}`}`;
    lines.push(`- ${m.tag}: ${bands} | ${thigh}`);
  }
  lines.push("");

  // Group table by entry phase / pivot foot.
  const groups = new Map<string, RunMetrics[]>();
  for (const m of metrics) {
    const key = `clipS=${m.clipTimeS?.toFixed(3) ?? "?"} labS=${m.labelS} stance=${m.actualFirstStance ?? "?"}`;
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  lines.push("## arrival outcome grouped by entry phase / pivot foot");
  for (const [key, arr] of groups) {
    const along = stats(arr.map((m) => m.alongM ?? Number.NaN).filter((v) => !Number.isNaN(v)));
    const lat = stats(arr.map((m) => m.lateralM ?? Number.NaN).filter((v) => !Number.isNaN(v)));
    lines.push(
      `- ${key} (n=${arr.length}): along mean=${fmt(along.mean)} sd=${fmt(along.sd)} range=[${fmt(along.min)},${fmt(along.max)}]; lat mean=${fmt(lat.mean)} sd=${fmt(lat.sd)} range=[${fmt(lat.min)},${fmt(lat.max)}]`,
    );
  }
  lines.push("");

  // Mean/sd/range per metric.
  const show = (name: string, unit: string, values: number[], digits = 4): void => {
    const s = stats(values);
    lines.push(`- ${name}: n=${s.n} mean=${fmt(s.mean, digits)}${unit} sd=${fmt(s.sd, digits)}${unit} range=[${fmt(s.min, digits)},${fmt(s.max, digits)}]${unit}`);
  };
  lines.push("## aggregate");
  show("entry clip phase", "s", metrics.map((m) => m.clipTimeS ?? Number.NaN).filter((v) => !Number.isNaN(v)), 3);
  show("arrival along error", "m", metrics.map((m) => m.alongM ?? Number.NaN).filter((v) => !Number.isNaN(v)));
  show("arrival lateral error", "m", metrics.map((m) => m.lateralM ?? Number.NaN).filter((v) => !Number.isNaN(v)));
  show("arrival yaw", "deg", metrics.map((m) => m.arrivalYawDeg ?? Number.NaN).filter((v) => !Number.isNaN(v)), 2);
  show("planted foot yaw", "deg", metrics.map((m) => m.plantYawDeg ?? Number.NaN).filter((v) => !Number.isNaN(v)), 2);
  show("settling duration", "s", metrics.map((m) => m.settlingS), 2);
  show("walk recorded duration", "s", metrics.map((m) => m.walkRecordedS), 2);
  show("max one-frame foot step (window)", "m", metrics.map((m) => m.maxFootStepM));
  show("max one-frame upper-leg step (window)", "deg", metrics.map((m) => m.maxLegStepDeg), 2);
  show("mean planted-window slide", "m", metrics.map((m) => m.meanWindowSlideM));
  show("max planted-window slide", "m", metrics.map((m) => m.maxWindowSlideM));
  show("rendered walking reversals", "", metrics.map((m) => m.renderedReversals), 0);
  show("rendered max second difference", "m", metrics.map((m) => m.renderedMaxSecondDiffM));
  lines.push(`- walk-end clip time histogram (s): ${metrics.map((m) => m.clipTimeS?.toFixed(3) ?? "?").sort().join(" ")}`);
  lines.push(`- plant foot per run: ${metrics.map((m) => `${m.tag}=${m.plantFoot ?? "?"}`).join(" ")}`);
  const substepMerged: Record<string, number> = {};
  for (const m of metrics) {
    for (const [key, count] of Object.entries(m.substepHist)) {
      substepMerged[key] = (substepMerged[key] ?? 0) + count;
    }
  }
  lines.push(
    Object.keys(substepMerged).length === 0
      ? `- substeps-per-frame: n/a (no fixed-clock stats in these captures)`
      : `- substeps-per-frame hist: ${Object.entries(substepMerged).map(([k, v]) => `${k}:${v}`).join(" ")}`,
  );
  const frameMsRuns = metrics.map((m) => m.meanFixedClockFrameMs).filter((v) => v !== null);
  lines.push(
    frameMsRuns.length === 0
      ? `- fixed-clock added ms/frame: n/a`
      : `- fixed-clock mean ms/frame per run: ${frameMsRuns.map((v) => v.toFixed(2)).join(" ")}`,
  );
  // Turn-leg-snaps bars: worst min quaternion norm across bones/runs, max thigh variation.
  const worstMinNorm = Math.min(
    ...metrics.flatMap((m) => Object.values(m.legNormBands).map((b) => b?.min ?? 1)),
  );
  const worstMaxNorm = Math.max(
    ...metrics.flatMap((m) => Object.values(m.legNormBands).map((b) => b?.max ?? 1)),
  );
  lines.push(`- leg quaternion norm over all bones/runs: min=${fmt(worstMinNorm)} max=${fmt(worstMaxNorm)} (bar: 1 +/- 1e-4)`);
  const thighVars = metrics.flatMap((m) =>
    [m.thighLenL, m.thighLenR].filter((b) => b !== null).map((b) => b.max - b.min),
  );
  lines.push(
    thighVars.length === 0
      ? `- thigh length variation: n/a (no legWorlds in these captures)`
      : `- thigh length variation (hip-to-knee world): n=${thighVars.length} max=${fmt(Math.max(...thighVars))}m (bar: <= 0.002)`,
  );
  // Slot scatter at arrival.
  const slots = metrics.map((m) => m.arrivalSlot).filter((s) => s !== null);
  if (slots.length >= 2) {
    const cx = slots.reduce((acc, v) => acc + v!.x, 0) / slots.length;
    const cz = slots.reduce((acc, v) => acc + v!.z, 0) / slots.length;
    const dev = slots.map((v) => Math.hypot(v!.x - cx, v!.z - cz));
    const s = stats(dev);
    lines.push(`- arrival slot scatter (dist from centroid): n=${s.n} mean=${fmt(s.mean)}m sd=${fmt(s.sd)}m range=[${fmt(s.min)},${fmt(s.max)}]m`);
  }
  lines.push("");

  // Divergence scan: first step where max pairwise |diff| exceeds epsilon, per field.
  lines.push("## divergence scan (aligned by recorded step index)");
  const eps: Array<{ field: string; tol: number; unit: string; get: (f: Frame) => number | null }> = [
    { field: "clipTime", tol: 1e-9, unit: "s", get: (f) => f.clipTime },
    { field: "slot.x", tol: 1e-6, unit: "m", get: (f) => f.slot?.x ?? null },
    { field: "slot.z", tol: 1e-6, unit: "m", get: (f) => f.slot?.z ?? null },
    { field: "slot.yaw", tol: 1e-6, unit: "rad", get: (f) => f.slot?.yaw ?? null },
    { field: "leftToe.x", tol: 1e-6, unit: "m", get: (f) => f.leftToe?.x ?? null },
    { field: "rightToe.x", tol: 1e-6, unit: "m", get: (f) => f.rightToe?.x ?? null },
  ];
  const runs = metrics.map((m) => m.tag);
  const runByTag = new Map<string, Frame[]>();
  for (const file of files) {
    const run = JSON.parse(await readFile(path.join(dir, file), "utf8")) as RunFile;
    if (!Array.isArray((run as unknown as { frames?: unknown }).frames)) continue;
    runByTag.set(file.replace(/\.json$/, ""), run.frames);
  }
  const maxLen = Math.max(...[...runByTag.values()].map((f) => f.length));
  for (const e of eps) {
    let found: string | null = null;
    for (let step = 0; step < maxLen; step += 1) {
      const vals: number[] = [];
      for (const tag of runs) {
        const fr = runByTag.get(tag)![step];
        if (!fr) continue;
        const v = e.get(fr);
        if (v !== null) vals.push(v);
      }
      if (vals.length >= 2) {
        const spread = Math.max(...vals) - Math.min(...vals);
        if (spread > e.tol) {
          found = `step ${step}: spread=${spread.toExponential(2)}${e.unit} range=[${Math.min(...vals).toFixed(6)},${Math.max(...vals).toFixed(6)}]`;
          break;
        }
      }
    }
    lines.push(`- ${e.field}: ${found ?? `identical (tol ${e.tol}) across all ${runs.length} runs`}`);
  }

  const text = lines.join("\n");
  process.stdout.write(text + "\n");
  if (out !== null) {
    await mkdir(path.dirname(out), { recursive: true });
    const firstRun = files.length > 0
      ? (JSON.parse(await readFile(path.join(dir, files[0]!), "utf8")) as { pacing?: unknown; seed?: unknown })
      : null;
    await writeFile(out, JSON.stringify({ dir, pacing: firstRun?.pacing ?? null, seed: firstRun?.seed ?? null, metrics }, null, 2));
    process.stdout.write(`[summary] wrote ${out}\n`);
  }
}

await main();
