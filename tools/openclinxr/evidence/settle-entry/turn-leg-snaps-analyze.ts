/**
 * Turn-leg-snaps stage-1 snap classification (2026-10-12 slice): reads one
 * SC-05 capture dir (settle-entry-capture.ts outputs with `legs` trace records
 * and `--trace`), finds every frame where a leg bone steps more than 24.5 deg
 * between consecutive settling trace frames, prints which solve quantities
 * jumped on that frame and which did not, and classifies the snap.
 *
 * Classes (first match wins): plane_flip | knee_side_flip | target_jump |
 * hold_transition | plan_end | reach_saturation | other.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/settle-entry/turn-leg-snaps-analyze.ts \
 *     --dir=.openclinxr/evidence/turn-leg-snaps/stage1 --out=.openclinxr/evidence/turn-leg-snaps/stage1-classes.json
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { quatNorm, quatStepDeg } from "./quat-norm-math.js";

const SNAP_DEG = 24.5;
const PLANE_FLIP_DEG = 45;
const TARGET_JUMP_M = 0.05;
const REACH_SATURATED = 0.995;

type Quat = { x: number; y: number; z: number; w: number };
type Vec3 = { x: number; y: number; z: number };

type LegTrace = {
  side: string;
  toeTarget: Vec3;
  heelTarget: Vec3;
  hipWorld: Vec3;
  reachRatio: number;
  plane: Vec3 | null;
  planeSource: string;
  planeAngleDeg: number | null;
  kneeSideSign: number;
  iterations: number;
  residualM: number;
  skipped: boolean;
  quatsBefore: Record<string, Quat | null>;
  quatsAfter: Record<string, Quat | null>;
  stance: boolean;
  stepIndex: number;
  planDone: boolean;
};

type TraceFrame = {
  frame: number;
  elapsedS: number;
  stepIndex: number;
  stanceFoot: string;
  legs: LegTrace[];
};

type SnapEvent = {
  run: string;
  frame: number;
  side: string;
  bone: string;
  stepDeg: number;
  solveDeltaDeg: number;
  dToeM: number;
  dHeelM: number;
  reachPrev: number;
  reachCurr: number;
  sourcePrev: string;
  sourceCurr: string;
  planeAngleDeg: number | null;
  kneePrev: number;
  kneeCurr: number;
  skippedPrev: boolean;
  skippedCurr: boolean;
  stepPrev: number;
  stepCurr: number;
  planDone: boolean;
  stance: boolean;
  klass: string;
};

function dirFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
  if (!flag) throw new Error("usage: turn-leg-snaps-analyze.ts --dir=captureDir [--out=classes.json]");
  return flag;
}

function outFromArgv(): string | null {
  return process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;
}

function vecStep(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function classify(e: Omit<SnapEvent, "klass">): string {
  if (e.planeAngleDeg !== null && e.planeAngleDeg > PLANE_FLIP_DEG) return "plane_flip";
  if (e.kneePrev !== 0 && e.kneeCurr !== 0 && e.kneePrev !== e.kneeCurr) return "knee_side_flip";
  if (Math.max(e.dToeM, e.dHeelM) > TARGET_JUMP_M) return "target_jump";
  if (e.skippedPrev !== e.skippedCurr) return "hold_transition";
  if (e.planDone) return "plan_end";
  if (Math.max(e.reachPrev, e.reachCurr) >= REACH_SATURATED) return "reach_saturation";
  return "other";
}

const BONES = ["hip", "upperMid", "knee", "lowerMid"];

async function main(): Promise<void> {
  const dir = dirFromArgv();
  const out = outFromArgv();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".trace.json")).sort();
  if (files.length === 0) throw new Error(`no trace files in ${dir}`);
  const events: SnapEvent[] = [];
  const runMax: Array<{ run: string; frames: number; maxStepDeg: number; snaps: number; minNorm: number }> = [];

  for (const file of files) {
    const run = file.replace(/\.trace\.json$/, "");
    const trace = JSON.parse(await readFile(path.join(dir, file), "utf8")) as TraceFrame[];
    let maxStep = 0;
    let snaps = 0;
    let minNorm = 1;
    for (let i = 1; i < trace.length; i += 1) {
      const prev = trace[i - 1]!;
      const curr = trace[i]!;
      for (const side of ["left", "right"]) {
        const pl = prev.legs.find((l) => l.side === side);
        const cl = curr.legs.find((l) => l.side === side);
        if (!pl || !cl) continue;
        for (const bone of BONES) {
          const qa = pl.quatsAfter[bone];
          const qb = cl.quatsAfter[bone];
          if (!qa || !qb) continue;
          minNorm = Math.min(minNorm, quatNorm(qa), quatNorm(qb));
          const step = quatStepDeg(qa, qb);
          if (step > maxStep) maxStep = step;
          if (step <= SNAP_DEG) continue;
          snaps += 1;
          const before = cl.quatsBefore[bone];
          const after = cl.quatsAfter[bone];
          const base = {
            run,
            frame: curr.frame,
            side,
            bone,
            stepDeg: step,
            solveDeltaDeg: before && after ? quatStepDeg(before, after) : NaN,
            dToeM: vecStep(pl.toeTarget, cl.toeTarget),
            dHeelM: vecStep(pl.heelTarget, cl.heelTarget),
            reachPrev: pl.reachRatio,
            reachCurr: cl.reachRatio,
            sourcePrev: pl.planeSource,
            sourceCurr: cl.planeSource,
            planeAngleDeg: cl.planeAngleDeg,
            kneePrev: pl.kneeSideSign,
            kneeCurr: cl.kneeSideSign,
            skippedPrev: pl.skipped,
            skippedCurr: cl.skipped,
            stepPrev: pl.stepIndex,
            stepCurr: cl.stepIndex,
            planDone: cl.planDone,
            stance: cl.stance,
          };
          events.push({ ...base, klass: classify(base) });
        }
      }
    }
    runMax.push({ run, frames: trace.length, maxStepDeg: maxStep, snaps, minNorm });
  }

  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.klass, (counts.get(e.klass) ?? 0) + 1);

  console.log(`# turn-leg-snaps stage1: ${files.length} runs, thresholds snap>${SNAP_DEG}deg planeFlip>${PLANE_FLIP_DEG}deg targetJump>${TARGET_JUMP_M}m reach>=${REACH_SATURATED}`);
  console.log("## per-run max one-frame leg-bone step (trace quatsAfter, all 4 joints x both legs; normalised angles) + min quat norm");
  for (const r of runMax) {
    console.log(`- ${r.run}: frames=${r.frames} max=${r.maxStepDeg.toFixed(1)}deg snaps=${r.snaps} minNorm=${r.minNorm.toFixed(4)}`);
  }
  console.log("## class counts");
  for (const k of ["plane_flip", "knee_side_flip", "target_jump", "hold_transition", "plan_end", "reach_saturation", "other"]) {
    console.log(`- ${k}: ${counts.get(k) ?? 0}`);
  }
  console.log("## every snap frame (jumped vs quiet quantities)");
  for (const e of events) {
    console.log(
      `- ${e.run} f${e.frame} ${e.side}.${e.bone} step=${e.stepDeg.toFixed(1)}deg solveDelta=${Number.isNaN(e.solveDeltaDeg) ? "?" : e.solveDeltaDeg.toFixed(1)}deg ` +
        `dToe=${(e.dToeM * 1000).toFixed(1)}mm dHeel=${(e.dHeelM * 1000).toFixed(1)}mm reach=${e.reachPrev.toFixed(3)}->${e.reachCurr.toFixed(3)} ` +
        `src=${e.sourcePrev}->${e.sourceCurr} planeAngle=${e.planeAngleDeg === null ? "null" : e.planeAngleDeg.toFixed(1)} ` +
        `knee=${e.kneePrev}->${e.kneeCurr} skip=${e.skippedPrev}->${e.skippedCurr} step=${e.stepPrev}->${e.stepCurr} planDone=${e.planDone} stance=${e.stance} => ${e.klass}`,
    );
  }

  if (out !== null) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify({ dir, thresholds: { SNAP_DEG, PLANE_FLIP_DEG, TARGET_JUMP_M, REACH_SATURATED }, runMax, counts: Object.fromEntries(counts), events }, null, 2));
    console.log(`[classes] wrote ${out}`);
  }
}

await main();
