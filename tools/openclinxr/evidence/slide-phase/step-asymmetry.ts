/**
 * Step-asymmetry measure (DENSE_v1 step-asym slice, STEP 1 + STEP 3 gates).
 *
 * MEASUREMENT ONLY. Reads slide-phase-capture JSON dirs; never imports
 * planner, runtime, or executor modules. Plant detection is reused verbatim
 * from the live-seam instrument (`detectPlants` / `computeRunSeam`: floor =
 * min toe Y in the run, Y gate 0.02 m, speed gate 0.02 m/s at 30 Hz, >= 3
 * consecutive frames, plant xz = mean toe XZ).
 *
 * Per run, over plants whose phase at start is "walking":
 * - walking step lengths: consecutive opposite-foot plants, |along diff|
 *   in the run's own walk frame (start->target); direction L->R = a left
 *   plant followed by a right plant; asymmetry % = |L-R|/mean.
 * - step time per foot: consecutive same-foot plant start-frame gaps / 30;
 *   L->R / R->L step times: consecutive opposite-foot plant start gaps / 30.
 * - duty per foot: mean plant duration / mean same-foot plant interval.
 * - knee peak: max kneeFlexionDeg over walking frames (A5 baseline).
 *
 * Bound-clip offline row: the committed contact JSON's stance-phase stride
 * proxy (stepLengthM L/R, same method as the walk-clip census
 * walk_symmetry_gate) separates clip asymmetry (source, census: 0.1 %) from
 * bind asymmetry from plan-fit asymmetry.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/step-asymmetry.ts \
 *     --route=sc05:.openclinxr/evidence/step-asym/pre/sc05 \
 *     (version route dirs are machine-local, gitignored, never in HEAD — ci-w8;
 *     pass --route=label:dir explicitly with job-local dirs) \
 *     --contact-json=packages/openclinxr/factory-stations/src/motion_retarget/physician-walk-contact-phases.json \
 *     --out="${OPENCLINXR_JOB_TMP:?}/step-asym/measure.json"
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FOOT_BASE_PLANT_PHASE, footBaseScheduleStance } from "@openclinxr/xr-humanoid-animation/foot-base";
import { CAPTURE_FPS, computeRunSeam, type LiveSeamRunFile } from "./live-seam.js";

/** Fixed-clock substeps per wall second (the capture's fixedClock=1 regime). */
const FIXED_SUBSTEPS_PER_S = 60;
/** Mixer loop period of the bound walk clip (contact-JSON cycleS). */
const CYCLE_FALLBACK_S = 1.7083333730697632;

type CaptureFrame = {
  step?: number;
  phase: string | null;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  leftToe: { x: number; y: number; z: number } | null;
  rightToe: { x: number; y: number; z: number } | null;
  headYaw?: number | null;
  startWorld?: { x: number; y: number; z: number } | null;
  targetWorld?: { x: number; y: number; z: number } | null;
  targetHeading?: number | null;
  kneeFlexionDeg?: { left: number | null; right: number | null } | null;
  clipTime?: number | null;
  walkSimSubsteps?: number | null;
};
type CaptureFile = {
  vehicle?: string;
  runIndex?: number;
  urlQuery?: string;
  measuredAt?: string;
  labels?: { cycleSeconds?: number } | null;
  frames: CaptureFrame[];
};

export type StepEntry = {
  fromFoot: "left" | "right";
  toFoot: "left" | "right";
  direction: "L->R" | "R->L";
  lengthM: number;
  timeS: number;
  fromFrame: number;
  toFrame: number;
};

export function stepsFromPlants(
  plants: Array<{ foot: "left" | "right"; startFrame: number; endFrame: number; alongM: number | null }>,
): StepEntry[] {
  const sorted = [...plants].sort((a, b) => a.startFrame - b.startFrame);
  const out: StepEntry[] = [];
  for (let k = 1; k < sorted.length; k += 1) {
    const prev = sorted[k - 1]!;
    const cur = sorted[k]!;
    if (prev.foot === cur.foot) continue;
    if (prev.alongM === null || cur.alongM === null) continue;
    out.push({
      fromFoot: prev.foot,
      toFoot: cur.foot,
      direction: prev.foot === "left" ? "L->R" : "R->L",
      lengthM: Math.abs(cur.alongM - prev.alongM),
      timeS: (cur.startFrame - prev.startFrame) / CAPTURE_FPS,
      fromFrame: prev.startFrame,
      toFrame: cur.startFrame,
    });
  }
  return out;
}

export function asymmetryPct(a: number | null, b: number | null): number | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const avg = (a + b) / 2;
  if (!(avg > 0)) return null;
  return (Math.abs(a - b) / avg) * 100;
}

export type CrownPlant = {
  foot: "left" | "right";
  frame: number;
  alongM: number;
  entry: boolean;
  /** Sub-frame wall time (run frames, fractional) of the plant-phase crossing. */
  wallFrame: number | null;
  /** Sub-frame SIM time (walkSimSubsteps, fractional) of the crossing. */
  wallSub: number | null;
};

/**
 * Schedule-crown plants (full-coverage live-toe cross-check): plant TIMES
 * come from the product schedule itself (footBaseScheduleStance changes over
 * walking frames with a clip time — one change per plant boundary, none
 * between), plant POSITIONS (footholds) are the planting foot's LIVE toe XZ
 * that frame. Same-foot repeats (only the entry pair produces them: the
 * first crown plant supersedes its entry mate) drop the EARLIER plant; gaps
 * between two same-frame entry plants (stance width, not a step) are skipped.
 * Steps are consecutive opposite-foot along gaps, exactly like the detector
 * method. Pre-change this must reproduce the plan-half asymmetry on live
 * toes; post-change it is the A1 instrument (the Y-dip detector structurally
 * under-covers long routes: stance toes ride at datum + row height, so only
 * mid-stance dips pass its run-min Y gate).
 */
export function crownPlants(
  walking: Array<{
    frame: number;
    clipTime: number | null | undefined;
    substeps: number | null | undefined;
    leftToe: { x: number; z: number } | null;
    rightToe: { x: number; z: number } | null;
  }>,
  cycleS: number,
  along: (p: { x: number; z: number }) => number,
): CrownPlant[] {
  const phase01Of = (clipTime: number | null | undefined): number | null => {
    if (typeof clipTime !== "number" || !Number.isFinite(clipTime) || !(cycleS > 0)) return null;
    return (((((clipTime % cycleS) + cycleS) % cycleS) + cycleS) % cycleS) / cycleS;
  };
  const raw: CrownPlant[] = [];
  const first = walking[0];
  if (first) {
    const sub0 = typeof first.substeps === "number" ? first.substeps : null;
    if (first.leftToe) raw.push({ foot: "left", frame: first.frame, alongM: along(first.leftToe), entry: true, wallFrame: first.frame, wallSub: sub0 });
    if (first.rightToe) raw.push({ foot: "right", frame: first.frame, alongM: along(first.rightToe), entry: true, wallFrame: first.frame, wallSub: sub0 });
  }
  // Unwrapped clip-phase per walking frame for sub-frame crossing interp.
  const unwrapped: Array<number | null> = walking.map(({ clipTime }) => {
    if (typeof clipTime !== "number" || !Number.isFinite(clipTime) || !(cycleS > 0)) return null;
    return (((((clipTime % cycleS) + cycleS) % cycleS) + cycleS) % cycleS) / cycleS;
  });
  let base = 0;
  let prevU: number | null = null;
  const uOf = (k: number): number | null => {
    const p = unwrapped[k];
    if (p === null) {
      prevU = null;
      return null;
    }
    let u = base + p;
    if (prevU !== null) {
      while (u < prevU) {
        u += 1;
        base += 1;
      }
    }
    prevU = u;
    return u;
  };
  const uVals: Array<number | null> = walking.map((_, k) => uOf(k));
  let prevCrown: string | null = null;
  for (let k = 0; k < walking.length; k += 1) {
    const { frame, clipTime, substeps, leftToe, rightToe } = walking[k]!;
    const phase01 = phase01Of(clipTime);
    if (phase01 === null) {
      prevCrown = null;
      continue;
    }
    const crown = footBaseScheduleStance(phase01);
    if (prevCrown === null || crown !== prevCrown) {
      const toe = crown === "left" ? leftToe : rightToe;
      if (toe) {
        // Interpolated crossing of this foot's plant phase between the
        // previous and current walking frame (sub-frame wall + sim time).
        // SIM time (walkSimSubsteps) is the gait clock: a capture-harness
        // hitch (one substep instead of two in a frame) shifts wall-frame
        // times by half a frame but leaves sim time exact.
        let wallFrame: number | null = frame;
        let wallSub: number | null = typeof substeps === "number" ? substeps : null;
        const uPrev = k > 0 ? uVals[k - 1] : null;
        const uCur = uVals[k];
        if (uPrev !== null && uCur !== null && uCur > uPrev) {
          const boundary = FOOT_BASE_PLANT_PHASE[crown];
          let target = Math.floor(uPrev) + boundary;
          if (target < uPrev) target += 1;
          if (target >= uPrev && target <= uCur) {
            const f = (target - uPrev) / (uCur - uPrev);
            wallFrame = walking[k - 1]!.frame + f * (frame - walking[k - 1]!.frame);
            const sPrev = walking[k - 1]!.substeps;
            const sCur = substeps;
            if (typeof sPrev === "number" && typeof sCur === "number" && sCur >= sPrev) {
              wallSub = sPrev + f * (sCur - sPrev);
            }
          }
        }
        raw.push({ foot: crown, frame, alongM: along(toe), entry: false, wallFrame, wallSub });
      }
    }
    prevCrown = crown;
  }
  raw.sort((a, b) => a.frame - b.frame || Number(b.entry) - Number(a.entry) || (a.foot < b.foot ? -1 : 1));
  // Drop-earlier on same-foot repeats; entry-frame gaps are skipped later.
  const chain: CrownPlant[] = [];
  for (const p of raw) {
    const prevFoot = chain.length ? chain[chain.length - 1]!.foot : null;
    if (prevFoot === p.foot) chain[chain.length - 1] = p;
    else chain.push(p);
  }
  return chain;
}

export function crownSteps(chain: CrownPlant[], entryFrame: number): StepEntry[] {
  const out: StepEntry[] = [];
  for (let k = 1; k < chain.length; k += 1) {
    const prev = chain[k - 1]!;
    const cur = chain[k]!;
    if (prev.foot === cur.foot) continue;
    // Entry-frame plants seed the chain (walk-start adoption, feet mid-stride,
    // not contacts): no gap touching the entry frame is a step. The first
    // real step starts at the first scheduled plant after entry.
    if (prev.frame === entryFrame || cur.frame === entryFrame) continue;
    // Step time in SIM seconds (substeps are the gait clock; wall frames
    // carry capture-harness hitch noise). Fall back to wall frames when a
    // plant lacks a sim time.
    const tPrevSub = prev.wallSub ?? null;
    const tCurSub = cur.wallSub ?? null;
    const timeS =
      tPrevSub !== null && tCurSub !== null
        ? (tCurSub - tPrevSub) / FIXED_SUBSTEPS_PER_S
        : ((cur.wallFrame ?? cur.frame) - (prev.wallFrame ?? prev.frame)) / CAPTURE_FPS;
    out.push({
      fromFoot: prev.foot,
      toFoot: cur.foot,
      direction: prev.foot === "left" ? "L->R" : "R->L",
      lengthM: Math.abs(cur.alongM - prev.alongM),
      timeS,
      fromFrame: prev.frame,
      toFrame: cur.frame,
    });
  }
  return out;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function routesFromArgv(): Array<{ label: string; dir: string }> {
  const flags = process.argv.filter((a) => a.startsWith("--route=")).map((a) => a.slice("--route=".length));
  if (flags.length === 0) throw new Error("usage: step-asymmetry.ts --route=label:dir [--route=...] --out=json");
  return flags.map((f) => {
    const i = f.indexOf(":");
    if (i < 0) throw new Error(`--route must be label:dir, got ${f}`);
    return { label: f.slice(0, i), dir: f.slice(i + 1) };
  });
}

function arg(name: string, fallback: string): string {
  return (
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  );
}

async function main(): Promise<void> {
  const routes = routesFromArgv();
  const contactPath = arg(
    "contact-json",
    "packages/openclinxr/factory-stations/src/motion_retarget/physician-walk-contact-phases.json",
  );
  // Default report path is job-local: the evidence-path default once cited here is a
  // machine-local capture output, gitignored, never in HEAD (ci-w8).
  const outPath = arg("out", path.join(process.env.OPENCLINXR_JOB_TMP ?? tmpdir(), "step-asym", "measure.json"));
  const contact = JSON.parse(await readFile(contactPath, "utf8")) as {
    left: { stepLengthM: number; contactFraction: number };
    right: { stepLengthM: number; contactFraction: number };
    stepFractionLeftToRight: number;
    stepFractionRightToLeft: number;
  };
  const boundStrideAsym = asymmetryPct(contact.left.stepLengthM, contact.right.stepLengthM);

  const routeRows: Record<string, unknown> = {};
  for (const { label, dir } of routes) {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(dir))
      .filter((f) => /^sc05-run\d+\.json$/.test(f))
      .sort();
    if (files.length === 0) throw new Error(`no sc05-run*.json in ${dir}`);
    const runRows: unknown[] = [];
    const poolL2R: number[] = [];
    const poolR2L: number[] = [];
    const poolTimeL2R: number[] = [];
    const poolTimeR2L: number[] = [];
    const poolDutyL: number[] = [];
    const poolDutyR: number[] = [];
    const crownPoolL2R: number[] = [];
    const crownPoolR2L: number[] = [];
    const crownPoolTimeL2R: number[] = [];
    const crownPoolTimeR2L: number[] = [];
    for (const file of files) {
      const cap = JSON.parse(await readFile(path.join(dir, file), "utf8")) as CaptureFile;
      const run = {
        vehicle: cap.vehicle,
        runIndex: cap.runIndex,
        urlQuery: cap.urlQuery,
        frames: cap.frames.map((f) => ({
          step: f.step,
          phase: f.phase,
          slot: f.slot,
          leftToe: f.leftToe,
          rightToe: f.rightToe,
          headYaw: f.headYaw ?? null,
          startWorld: f.startWorld ?? null,
          targetWorld: f.targetWorld ?? null,
          targetHeading: f.targetHeading ?? null,
        })),
      } satisfies LiveSeamRunFile;
      const seam = computeRunSeam(file.replace(/\.json$/, ""), run);
      const walking = seam.plants.filter((p) => p.phaseAtStart === "walking" && p.alongM !== null);
      const steps = stepsFromPlants(walking);
      const l2r = steps.filter((s) => s.direction === "L->R");
      const r2l = steps.filter((s) => s.direction === "R->L");
      poolL2R.push(...l2r.map((s) => s.lengthM));
      poolR2L.push(...r2l.map((s) => s.lengthM));
      poolTimeL2R.push(...l2r.map((s) => s.timeS));
      poolTimeR2L.push(...r2l.map((s) => s.timeS));
      // Duty per foot: mean plant duration / mean same-foot interval.
      const duty: Record<string, number | null> = {};
      for (const foot of ["left", "right"] as const) {
        const same = walking.filter((p) => p.foot === foot).sort((a, b) => a.startFrame - b.startFrame);
        const durations = same.map((p) => (p.endFrame - p.startFrame + 1) / CAPTURE_FPS);
        const intervals: number[] = [];
        for (let k = 1; k < same.length; k += 1) {
          intervals.push((same[k]!.startFrame - same[k - 1]!.startFrame) / CAPTURE_FPS);
        }
        const d = mean(durations);
        const iv = mean(intervals);
        duty[foot] = d !== null && iv !== null && iv > 0 ? d / iv : null;
        (foot === "left" ? poolDutyL : poolDutyR).push(...(duty[foot] !== null ? [duty[foot]!] : []));
      }
      // Knee peak over walking frames (A5 baseline).
      let kneePeak: number | null = null;
      for (const f of cap.frames) {
        if (f.phase !== "walking" || !f.kneeFlexionDeg) continue;
        for (const v of [f.kneeFlexionDeg.left, f.kneeFlexionDeg.right]) {
          if (typeof v === "number" && Number.isFinite(v) && (kneePeak === null || v > kneePeak)) {
            kneePeak = v;
          }
        }
      }
      // Schedule-crown cross-check (full coverage, live-toe footholds).
      const firstFrame = cap.frames[0];
      let ux = 0;
      let uz = 1;
      if (firstFrame?.startWorld && firstFrame?.targetWorld) {
        const dx = firstFrame.targetWorld.x - firstFrame.startWorld.x;
        const dz = firstFrame.targetWorld.z - firstFrame.startWorld.z;
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          ux = dx / len;
          uz = dz / len;
        }
      }
      const sx = firstFrame?.startWorld?.x ?? 0;
      const sz = firstFrame?.startWorld?.z ?? 0;
      const cycleS =
        cap.labels && typeof cap.labels === "object" && (cap.labels as { cycleSeconds?: unknown }).cycleSeconds !== undefined
          && typeof (cap.labels as { cycleSeconds?: unknown }).cycleSeconds === "number"
          && ((cap.labels as { cycleSeconds?: number }).cycleSeconds as number) > 0
          ? ((cap.labels as { cycleSeconds?: number }).cycleSeconds as number)
          : CYCLE_FALLBACK_S;
      const crownChain = crownPlants(
        cap.frames
          .map((f, i) => ({ f, i }))
          .filter(({ f }) => f.phase === "walking")
          .map(({ f, i }) => ({
            frame: i,
            clipTime: (f as { clipTime?: number | null }).clipTime ?? null,
            substeps: (f as { walkSimSubsteps?: number | null }).walkSimSubsteps ?? null,
            leftToe: f.leftToe,
            rightToe: f.rightToe,
          })),
        cycleS,
        (p) => (p.x - sx) * ux + (p.z - sz) * uz,
      );
      const walkStartFrame = cap.frames.findIndex((f) => f.phase === "walking");
      const cSteps = crownSteps(crownChain, walkStartFrame);
      const cL2R = cSteps.filter((s) => s.direction === "L->R");
      const cR2L = cSteps.filter((s) => s.direction === "R->L");
      crownPoolL2R.push(...cL2R.map((s) => s.lengthM));
      crownPoolR2L.push(...cR2L.map((s) => s.lengthM));
      crownPoolTimeL2R.push(...cL2R.map((s) => s.timeS));
      crownPoolTimeR2L.push(...cR2L.map((s) => s.timeS));
      const crownSummary = {
        nPlants: crownChain.length,
        nSteps: cSteps.length,
        meanL2RM: mean(cL2R.map((s) => s.lengthM)),
        meanR2LM: mean(cR2L.map((s) => s.lengthM)),
        stepAsymPct: asymmetryPct(mean(cL2R.map((s) => s.lengthM)), mean(cR2L.map((s) => s.lengthM))),
        meanStepTimeS: { l2r: mean(cL2R.map((s) => s.timeS)), r2l: mean(cR2L.map((s) => s.timeS)) },
      };
      runRows.push({
        file,
        urlQuery: cap.urlQuery ?? null,
        nWalkingPlants: walking.length,
        steps: steps.map((s) => ({
          direction: s.direction,
          lengthM: Number(s.lengthM.toFixed(4)),
          timeS: Number(s.timeS.toFixed(4)),
        })),
        meanL2RM: mean(l2r.map((s) => s.lengthM)),
        meanR2LM: mean(r2l.map((s) => s.lengthM)),
        stepAsymPct: asymmetryPct(mean(l2r.map((s) => s.lengthM)), mean(r2l.map((s) => s.lengthM))),
        meanStepTimeS: { l2r: mean(l2r.map((s) => s.timeS)), r2l: mean(r2l.map((s) => s.timeS)) },
        duty,
        kneePeakDeg: kneePeak,
        missing: seam.missing,
        crown: crownSummary,
      });
    }
    const mL = mean(poolL2R);
    const mR = mean(poolR2L);
    const tL = mean(poolTimeL2R);
    const tR = mean(poolTimeR2L);
    const cL = mean(crownPoolL2R);
    const cR = mean(crownPoolR2L);
    const ctL = mean(crownPoolTimeL2R);
    const ctR = mean(crownPoolTimeR2L);
    routeRows[label] = {
      dir,
      nRuns: files.length,
      pooledStepLengthM: { l2r: mL, r2l: mR, asymPct: asymmetryPct(mL, mR) },
      pooledStepTimeS: { l2r: tL, r2l: tR, asymPct: asymmetryPct(tL, tR) },
      pooledDuty: { left: mean(poolDutyL), right: mean(poolDutyR) },
      crownPooledStepLengthM: { l2r: cL, r2l: cR, asymPct: asymmetryPct(cL, cR) },
      crownPooledStepTimeS: { l2r: ctL, r2l: ctR, asymPct: asymmetryPct(ctL, ctR) },
      kneePeakDeg: runRows.map((r) => (r as { kneePeakDeg: number | null }).kneePeakDeg),
      runs: runRows,
    };
  }

  const result = {
    schemaVersion: "openclinxr.step-asymmetry.v1",
    measuredAt: new Date().toISOString(),
    plantDetector: "live-seam detectPlants/computeRunSeam (floor=min toe Y; Y<=+0.02; speed<=0.02m/s@30Hz; >=3 frames)",
    stepDef: "consecutive opposite-foot walking-phase plants, |along diff| in the run walk frame",
    boundClipOffline: {
      contactJson: contactPath,
      strideProxyM: { left: contact.left.stepLengthM, right: contact.right.stepLengthM },
      strideAsymPct: boundStrideAsym,
      duty: { left: contact.left.contactFraction, right: contact.right.contactFraction },
      stepFraction: { l2r: contact.stepFractionLeftToRight, r2l: contact.stepFractionRightToLeft },
      note: "stance-phase foot travel relative to the root, offline at rate 1 (walk_symmetry_gate method); source-clip census symmetry 0.1 % (walk-clip-census-2026-10-12.md:52) separates clip from bind asymmetry",
    },
    routes: routeRows,
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  for (const [label, row] of Object.entries(routeRows)) {
    const r = row as {
      pooledStepLengthM: { asymPct: number | null };
      pooledStepTimeS: { asymPct: number | null };
      crownPooledStepLengthM: { asymPct: number | null };
      crownPooledStepTimeS: { asymPct: number | null };
    };
    process.stdout.write(
      `[${label}] dip-detector step asym=${r.pooledStepLengthM.asymPct?.toFixed(2) ?? "n/a"}% time asym=${r.pooledStepTimeS.asymPct?.toFixed(2) ?? "n/a"}%`
      + ` | crown step asym=${r.crownPooledStepLengthM.asymPct?.toFixed(2) ?? "n/a"}% time asym=${r.crownPooledStepTimeS.asymPct?.toFixed(2) ?? "n/a"}%\n`,
    );
  }
  process.stdout.write(`bound-clip stride asym=${boundStrideAsym?.toFixed(2) ?? "n/a"}%\n`);
  process.stdout.write(`wrote ${outPath}\n`);
}

const invokedAsScript = typeof process.argv[1] === "string" && process.argv[1].endsWith("step-asymmetry.ts");
if (invokedAsScript) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
