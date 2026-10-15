/**
 * Foot-base stride measure (DENSE_v1 footbase-5, STEP 1): per run, for
 * footBase=1 and plan-only captures, over the walking phase:
 *   (a) step length per plant (along-route distance between consecutive
 *       footholds of opposite feet; a plant = first walking frame or a
 *       stanceFoot change, foothold = planting foot's toe XZ that frame);
 *   (b) max trailing-leg extension = |hip-heel| / (|hip-knee| + |knee-heel|)
 *       per frame (heel = foot-bone origin = the ankle proxy the capture
 *       records as heelL/heelR), reported with max frame and side;
 *   (c) max toe height (world Y) of the stance foot over the second half of
 *       each stance interval (the half-cycle before lift-off).
 *
 * INSTRUMENT ONLY. Reads committed capture JSON; writes no product code.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/foot-base-stride-measure.ts \
 *     --footbase=.openclinxr/evidence/foot-base/after3 \
 *     --plan=.openclinxr/evidence/foot-base/before \
 *     --out=.openclinxr/evidence/foot-base/stride-measure.json
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Vec3 = { x: number; y: number; z: number };
type Frame = {
  phase: string | null;
  step?: number;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  stanceFoot: string | null;
  clipTime?: number | null;
  legWorlds: Record<string, Vec3 | null> | null;
  startWorld?: Vec3 | null;
  targetWorld?: Vec3 | null;
};
type RunFile = {
  urlQuery?: string;
  frames: Frame[];
  labels?: { cycleSeconds?: number } | null;
};

/** Mirror of FOOT_BASE_PLANT_PHASE / FOOT_BASE_STANCE_FRACTION (schedule-mod). */
const PLANT = { left: 0.9267100504367475, right: 0.4380801606057965 } as const;
const STANCE_FRac = { left: 0.6403164246610666, right: 0.53605251487726 } as const;
const CYCLE_FALLBACK_S = 1.7083333730697632;

function relPhase(side: "left" | "right", phase01: number): number {
  const rel = (phase01 - PLANT[side]) % 1;
  return ((rel % 1) + 1) % 1;
}

/** Mirror of footBaseScheduleStance (schedule-mod): the plant crown, not the lock label. */
function scheduleCrown(phase01: number): "left" | "right" {
  const wrapped = (((phase01 % 1) + 1) % 1 + 1) % 1;
  const leftStance = relPhase("left", wrapped) < STANCE_FRac.left;
  const rightStance = relPhase("right", wrapped) < STANCE_FRac.right;
  if (leftStance && !rightStance) return "left";
  if (rightStance && !leftStance) return "right";
  const behind = (plant: number): number => (((wrapped - plant) % 1) + 1) % 1;
  return behind(PLANT.left) < behind(PLANT.right) ? "left" : "right";
}

function arg(name: string): string {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!flag) throw new Error(`usage: --${name}=...`);
  return flag;
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

type RunMeasure = {
  file: string;
  nWalking: number;
  stepLengthsM: number[];
  meanStepM: number | null;
  maxExtension: { value: number; frame: number; side: string } | null;
  maxExtensionBySide: Record<string, number | null>;
  maxPaceToeHeightM: { value: number; frame: number; side: string } | null;
  legLengthM: number | null;
};

function measureRun(file: string, run: RunFile): RunMeasure {
  const frames = run.frames;
  const walking = frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.phase === "walking");
  const first = frames[0];
  let ux = 0;
  let uz = 1;
  if (first?.startWorld && first?.targetWorld) {
    const dx = first.targetWorld.x - first.startWorld.x;
    const dz = first.targetWorld.z - first.startWorld.z;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      ux = dx / len;
      uz = dz / len;
    }
  }
  const startX = first?.startWorld?.x ?? 0;
  const startZ = first?.startWorld?.z ?? 0;
  const along = (p: { x: number; z: number }): number =>
    (p.x - startX) * ux + (p.z - startZ) * uz;

  // (a) plants: schedule-crown changes over walking frames with a clip
  // time (the plant crown, a pure function of clip phase: one change per
  // plant boundary). The record's stanceFoot is the observe-only lock label
  // (flaps mid-swing, emits None) and must NOT drive plant detection.
  // Foothold at a plant = the planting foot's toe XZ that frame (the slot
  // pin puts it exactly on the foothold); the entry pair (first walking
  // frame, both toes) bases the first step.
  const cycleS = run.labels?.cycleSeconds && run.labels.cycleSeconds > 0
    ? run.labels.cycleSeconds
    : CYCLE_FALLBACK_S;
  const phase01Of = (clipTime: number | null | undefined): number | null => {
    if (typeof clipTime !== "number" || !Number.isFinite(clipTime)) return null;
    return (((((clipTime % cycleS) + cycleS) % cycleS) + cycleS) % cycleS) / cycleS;
  };
  const plants: Array<{ frame: number; side: string; alongM: number }> = [];
  const firstWalking = walking[0];
  if (firstWalking) {
    const lToe = firstWalking.f.leftToe;
    const rToe = firstWalking.f.rightToe;
    if (lToe) plants.push({ frame: firstWalking.i, side: "left-entry", alongM: along(lToe) });
    if (rToe) plants.push({ frame: firstWalking.i, side: "right-entry", alongM: along(rToe) });
  }
  let prevCrown: string | null = null;
  for (const { f, i } of walking) {
    const phase01 = phase01Of(f.clipTime);
    if (phase01 === null) {
      prevCrown = null;
      continue;
    }
    const crown = scheduleCrown(phase01);
    if (prevCrown === null || crown !== prevCrown) {
      const toe = crown === "left" ? f.leftToe : f.rightToe;
      if (toe) plants.push({ frame: i, side: crown, alongM: along(toe) });
    }
    prevCrown = crown;
  }
  plants.sort((a, b) => a.frame - b.frame || (a.side.endsWith("entry") ? -1 : 1));
  // Consecutive footholds must alternate feet; drop same-side repeats from
  // same-frame entries (entry pair) keeping the alternating chain.
  const chain: typeof plants = [];
  for (const p of plants) {
    const foot = p.side.startsWith("left") ? "left" : "right";
    const prevFoot = chain.length ? (chain[chain.length - 1]!.side.startsWith("left") ? "left" : "right") : null;
    if (prevFoot === foot) continue;
    chain.push(p);
  }
  const stepLengthsM: number[] = [];
  for (let k = 1; k < chain.length; k += 1) {
    // Skip the entry-pair separation (both footholds same frame): the first
    // real step runs from the other foot's entry foothold to the first plant.
    if (k === 1 && chain[0]!.side.endsWith("entry") && chain[1]!.side.endsWith("entry")) continue;
    stepLengthsM.push(Math.abs(chain[k]!.alongM - chain[k - 1]!.alongM));
  }
  const meanStepM = stepLengthsM.length
    ? stepLengthsM.reduce((a, b) => a + b, 0) / stepLengthsM.length
    : null;

  // (b) per-frame leg extension; (c) stance-interval second-half toe height.
  let maxExt: RunMeasure["maxExtension"] = null;
  const maxBySide: Record<string, number | null> = { left: null, right: null };
  const legLens: number[] = [];
  for (const { f, i } of walking) {
    for (const side of ["left", "right"] as const) {
      const key = side === "left" ? "L" : "R";
      const hip = f.legWorlds?.[`hip${key}`] ?? null;
      const knee = f.legWorlds?.[`knee${key}`] ?? null;
      const heel = f.legWorlds?.[`heel${key}`] ?? null;
      if (!hip || !knee || !heel) continue;
      const thigh = dist3(hip, knee);
      const shin = dist3(knee, heel);
      if (!(thigh > 0 && shin > 0)) continue;
      legLens.push(thigh + shin);
      const ext = dist3(hip, heel) / (thigh + shin);
      if (maxBySide[side] === null || ext > (maxBySide[side] as number)) {
        maxBySide[side] = ext;
      }
      if (maxExt === null || ext > maxExt.value) {
        maxExt = { value: ext, frame: i, side };
      }
    }
  }
  legLens.sort((a, b) => a - b);
  const legLengthM = legLens.length ? legLens[Math.floor(legLens.length / 2)]! : null;

  // (c) stance intervals over walking frames; second half of each interval.
  let maxToe: RunMeasure["maxPaceToeHeightM"] = null;
  let intStart = -1;
  let intSide: string | null = null;
  const closeInterval = (endExclusive: number): void => {
    if (intStart < 0 || intSide === null) return;
    const idx = walking
      .map(({ i }) => i)
      .filter((i) => i >= intStart && i < endExclusive);
    if (idx.length >= 1) {
      const secondHalf = idx.slice(Math.floor(idx.length / 2));
      for (const i of secondHalf) {
        const toe = intSide === "left" ? frames[i]!.leftToe : frames[i]!.rightToe;
        if (!toe) continue;
        if (maxToe === null || toe.y > maxToe.value) {
          maxToe = { value: toe.y, frame: i, side: intSide };
        }
      }
    }
  };
  for (const { f, i } of walking) {
    const s = f.stanceFoot === "left" || f.stanceFoot === "right" ? f.stanceFoot : null;
    if (s !== intSide) {
      closeInterval(i);
      intStart = s === null ? -1 : i;
      intSide = s;
    }
  }
  closeInterval(Number.MAX_SAFE_INTEGER);

  return {
    file,
    nWalking: walking.length,
    stepLengthsM,
    meanStepM,
    maxExtension: maxExt,
    maxExtensionBySide: maxBySide,
    maxPaceToeHeightM: maxToe,
    legLengthM,
  };
}

function mean(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

async function readRuns(dir: string): Promise<RunMeasure[]> {
  const files = (await readdir(dir))
    .filter((f) => /^sc05-run\d+\.json$/.test(f))
    .sort();
  const out: RunMeasure[] = [];
  for (const f of files) {
    const run = JSON.parse(await readFile(path.join(dir, f), "utf8")) as RunFile;
    out.push(measureRun(f, run));
  }
  return out;
}

async function main(): Promise<void> {
  const footbaseDir = arg("footbase");
  const planDir = arg("plan");
  const outPath = arg("out");
  const footbase = await readRuns(footbaseDir);
  const plan = await readRuns(planDir);
  const planMeanStep = mean(plan.map((r) => r.meanStepM));
  const fbMeanStep = mean(footbase.map((r) => r.meanStepM));
  const planMaxExt = mean(plan.map((r) => r.maxExtension?.value ?? null));
  const fbMaxExt = mean(footbase.map((r) => r.maxExtension?.value ?? null));
  const planMaxToe = mean(plan.map((r) => r.maxPaceToeHeightM?.value ?? null));
  const fbMaxToe = mean(footbase.map((r) => r.maxPaceToeHeightM?.value ?? null));
  const rel = (fb: number | null, pl: number | null): number | null =>
    fb === null || pl === null || pl === 0 ? null : (fb - pl) / Math.abs(pl);
  const result = {
    schemaVersion: "openclinxr.foot-base-stride-measure.v1",
    measuredAt: new Date().toISOString(),
    footbaseDir,
    planDir,
    footbase,
    plan,
    compare: {
      meanStepM: {
        footbase: fbMeanStep,
        plan: planMaxExt === null ? planMeanStep : planMeanStep,
        relDiff: rel(fbMeanStep, planMeanStep),
        within10Pct:
          rel(fbMeanStep, planMeanStep) !== null && Math.abs(rel(fbMeanStep, planMeanStep)!) <= 0.1,
      },
      maxExtension: {
        footbase: fbMaxExt,
        plan: planMaxExt,
        relDiff: rel(fbMaxExt, planMaxExt),
        within10Pct:
          rel(fbMaxExt, planMaxExt) !== null && Math.abs(rel(fbMaxExt, planMaxExt)!) <= 0.1,
      },
      maxPreLiftToeHeightM: {
        footbase: fbMaxToe,
        plan: planMaxToe,
        relDiff: rel(fbMaxToe, planMaxToe),
        within10Pct:
          rel(fbMaxToe, planMaxToe) !== null && Math.abs(rel(fbMaxToe, planMaxToe)!) <= 0.1,
      },
    },
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2));
  process.stdout.write(
    `footbase meanStep=${fbMeanStep?.toFixed(4) ?? "n/a"} plan=${planMeanStep?.toFixed(4) ?? "n/a"} `
    + `rel=${rel(fbMeanStep, planMeanStep)?.toFixed(3) ?? "n/a"}\n`,
  );
  process.stdout.write(
    `footbase maxExt=${fbMaxExt?.toFixed(4) ?? "n/a"} plan=${planMaxExt?.toFixed(4) ?? "n/a"} `
    + `rel=${rel(fbMaxExt, planMaxExt)?.toFixed(3) ?? "n/a"}\n`,
  );
  process.stdout.write(
    `footbase maxToe=${fbMaxToe?.toFixed(4) ?? "n/a"} plan=${planMaxToe?.toFixed(4) ?? "n/a"} `
    + `rel=${rel(fbMaxToe, planMaxToe)?.toFixed(3) ?? "n/a"}\n`,
  );
}

await main();
