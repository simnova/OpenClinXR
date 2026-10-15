/**
 * Ankle clearance attribution (DENSE_v1 ankle slice, STEP 1).
 *
 * Per swing, per route, for foot-base live captures (current main) AND the
 * bound clip (offline, same recipe as phase-attribution.ts):
 *   - ankle sagittal angle curve (swing-phase-normalised, 50 bins),
 *   - heel Y and toe Y above each foot's own PLANTED datum,
 *   - minimum toe clearance in mid-swing (swing-phase 0.3-0.7).
 *
 * DEFINITIONS (reported verbatim in the output `definition` field):
 *   contact: a walking frame whose toe world Y sits within
 *     FOOT_CONTACT_HEIGHT_METERS (0.06, the production constant, imported not
 *     retyped) above that foot's own floor (min toe Y over the walk / clip loop).
 *   swing: liftoff (first above-band frame after a contact run) to the next
 *     touchdown (first contact frame after). Swing-phase 0 at liftoff, 1 at
 *     touchdown; mid-swing is swing-phase 0.3-0.7 inclusive.
 *   planted datum: the MEAN toe (resp. heel) world Y over the contiguous
 *     contact run immediately preceding that swing's liftoff — the stance the
 *     foot just left, not the walk minimum, not the plant pose.
 *   clearance: min over mid-swing samples of (toeY - toeDatum), in mm. Heel
 *     clearance is the same construction with heelY - heelDatum.
 *   ankle angle: geometric angle at the ankle between (knee - ankle) and
 *     (toe - ankle), in degrees (~90 = foot square to the shin). Offline the
 *     joints are lowerleg01 (knee), foot (ankle), toe1-1 (toe); live they are
 *     legWorlds knee/heel plus the tail toe. Uniform actor scale cancels out
 *     of the angle; heights are scaled to world (x0.86 offline) before the
 *     datum subtraction, so datum-relative clearances are world-true.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/ankle-clearance.ts \
 *     --route=sc05 --run=.openclinxr/evidence/knee-budget/sc05/sc05-run0.json \
 *     [--run=...] [--bound-glb=...] [--clip=openclinxr_retarget_walk_source] \
 *     --out=.openclinxr/evidence/ankle/step1-sc05.json
 *
 * INSTRUMENT ONLY. Reads committed captures/GLBs; writes no product code.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import { boundClipJointTrack } from "../foot-plant/bound-clip-foot-track.js";

export const ANKLE_BINS = 50;
export const MID_SWING_LO = 0.3;
export const MID_SWING_HI = 0.7;
const BOUND_ACTOR_SCALE = 0.86;

export const CLEARANCE_DEFINITION =
  "clearance = min over mid-swing (swing-phase 0.3-0.7) of (toeY - toeDatum), mm; " +
  "toeDatum = mean toe world Y over the contiguous contact run immediately preceding that swing's liftoff; " +
  "contact = toeY <= foot-floor + 0.06 m (FOOT_CONTACT_HEIGHT_METERS, production constant); " +
  "foot-floor = min toe Y over the walk (live) or clip loop (bound); " +
  "heel clearance = same with heelY - heelDatum; " +
  "ankle angle = geometric angle at the ankle between (knee-ankle) and (toe-ankle), degrees.";

type Vec3 = { x: number; y: number; z: number };
type Side = "left" | "right";

function arg(name: string, fallback: string | null): string | null {
  const key = name.startsWith("--") ? name.slice(2) : name;
  const flag = process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  if (flag !== undefined) return flag;
  return fallback;
}

function argAll(name: string): string[] {
  const key = name.startsWith("--") ? name.slice(2) : name;
  return process.argv
    .filter((a) => a.startsWith(`--${key}=`))
    .map((a) => a.slice(key.length + 3));
}

export function angleAtAnkleDeg(knee: Vec3, ankle: Vec3, toe: Vec3): number {
  const ax = knee.x - ankle.x;
  const ay = knee.y - ankle.y;
  const az = knee.z - ankle.z;
  const bx = toe.x - ankle.x;
  const by = toe.y - ankle.y;
  const bz = toe.z - ankle.z;
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (!(la > 1e-9 && lb > 1e-9)) return NaN;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Linearly resample values[lo..hi] (inclusive indices) onto `bins` bins. */
export function resampleSwing(values: number[], lo: number, hi: number, bins: number): number[] {
  const out: number[] = [];
  const span = hi - lo;
  for (let b = 0; b < bins; b += 1) {
    const pos = span <= 0 ? lo : lo + ((b + 0.5) / bins) * span;
    const i0 = Math.max(lo, Math.min(hi, Math.floor(pos)));
    const i1 = Math.max(lo, Math.min(hi, i0 + 1));
    const f = Math.max(0, Math.min(1, pos - i0));
    const a = values[i0] ?? NaN;
    const c = values[i1] ?? NaN;
    out.push(a + (c - a) * f);
  }
  return out;
}

export type SwingSample = {
  lo: number;
  td: number;
  toeDatum: number;
  heelDatum: number;
  /** Min (toeY - toeDatum) over mid-swing, metres; null when <3 mid samples. */
  minToeClrM: number | null;
  minHeelClrM: number | null;
  nMid: number;
};

export type FootSwingResult = {
  swings: SwingSample[];
  minToeClrMm: number | null;
  meanAnkleCurve: Array<number | null>;
  meanToeAboveCurve: Array<number | null>;
  meanHeelAboveCurve: Array<number | null>;
  nSwings: number;
};

/**
 * Per-swing analysis over parallel walking series. `contact[i]` marks
 * in-contact frames; any swing without a preceding contact run or a following
 * touchdown is skipped (incomplete at the walk edges).
 */
export function analyzeSwings(input: {
  toeY: number[];
  heelY: number[];
  ankleDeg: number[];
  contact: boolean[];
  bins: number;
}): FootSwingResult {
  const { toeY, heelY, ankleDeg, contact, bins } = input;
  const n = toeY.length;
  const swings: SwingSample[] = [];
  const ankleCurves: number[][] = [];
  const toeCurves: number[][] = [];
  const heelCurves: number[][] = [];
  for (let lo = 1; lo < n; lo += 1) {
    if (contact[lo] !== false || contact[lo - 1] !== true) continue;
    let runStart = lo - 1;
    while (runStart - 1 >= 0 && contact[runStart - 1] === true) runStart -= 1;
    let td: number | null = null;
    for (let i = lo + 1; i < n; i += 1) {
      if (contact[i] === true) {
        td = i;
        break;
      }
    }
    if (td === null || td - lo < 2) continue;
    let toeDatum = 0;
    let heelDatum = 0;
    let m = 0;
    for (let i = runStart; i < lo; i += 1) {
      const t = toeY[i];
      const h = heelY[i];
      if (typeof t !== "number" || !Number.isFinite(t)) continue;
      if (typeof h !== "number" || !Number.isFinite(h)) continue;
      toeDatum += t;
      heelDatum += h;
      m += 1;
    }
    if (m === 0) continue;
    toeDatum /= m;
    heelDatum /= m;
    const span = td - lo;
    let minToe = Infinity;
    let minHeel = Infinity;
    let nMid = 0;
    for (let i = lo; i <= td; i += 1) {
      const phase = (i - lo) / span;
      if (phase < MID_SWING_LO || phase > MID_SWING_HI) continue;
      const t = toeY[i];
      const h = heelY[i];
      if (typeof t !== "number" || !Number.isFinite(t)) continue;
      if (typeof h === "number" && Number.isFinite(h)) {
        minHeel = Math.min(minHeel, h - heelDatum);
      }
      minToe = Math.min(minToe, t - toeDatum);
      nMid += 1;
    }
    swings.push({
      lo,
      td,
      toeDatum,
      heelDatum,
      minToeClrM: nMid >= 3 ? minToe : null,
      minHeelClrM: nMid >= 3 && minHeel !== Infinity ? minHeel : null,
      nMid,
    });
    const toeAbove = toeY.map((v) => (typeof v === "number" && Number.isFinite(v) ? v - toeDatum : NaN));
    const heelAbove = heelY.map((v) => (typeof v === "number" && Number.isFinite(v) ? v - heelDatum : NaN));
    ankleCurves.push(resampleSwing(ankleDeg, lo, td, bins));
    toeCurves.push(resampleSwing(toeAbove, lo, td, bins));
    heelCurves.push(resampleSwing(heelAbove, lo, td, bins));
  }
  const mean = (curves: number[][]): Array<number | null> => {
    const first = curves[0];
    if (first === undefined) return new Array<number | null>(bins).fill(null);
    return first.map((_, b) => {
      let s = 0;
      let c = 0;
      for (const curve of curves) {
        const v = curve[b];
        if (typeof v === "number" && Number.isFinite(v)) {
          s += v;
          c += 1;
        }
      }
      return c > 0 ? s / c : null;
    });
  };
  const mins = swings.map((s) => s.minToeClrM).filter((v): v is number => v !== null);
  return {
    swings,
    minToeClrMm: mins.length > 0 ? Math.min(...mins) * 1000 : null,
    meanAnkleCurve: mean(ankleCurves),
    meanToeAboveCurve: mean(toeCurves),
    meanHeelAboveCurve: mean(heelCurves),
    nSwings: swings.length,
  };
}

export function rmseIntersection(
  a: Array<number | null>,
  b: Array<number | null>,
): { rmse: number; nBins: number } {
  let s = 0;
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      s += (x - y) ** 2;
      count += 1;
    }
  }
  return count === 0 ? { rmse: NaN, nBins: 0 } : { rmse: Math.sqrt(s / count), nBins: count };
}

type LiveFrame = {
  phase: string | null;
  clipTime?: number | null;
  leftToe?: Vec3 | null;
  rightToe?: Vec3 | null;
  legWorlds?: Record<string, Vec3 | null> | null;
  legBones?: Record<string, { x: number; y: number; z: number; w: number } | null> | null;
  kneeFlexionDeg?: { left: number | null; right: number | null } | null;
};
type LiveRun = { urlQuery?: string; labels?: { cycleSeconds?: number } | null; frames: LiveFrame[] };

function liveSideSeries(frames: LiveFrame[], side: Side): {
  toeY: number[];
  heelY: number[];
  ankleDeg: number[];
  contact: boolean[];
  kneePeakDeg: number | null;
  quatMaxDev: number;
} {
  const walking = frames.filter((f) => f.phase === "walking");
  const toeKey = side === "left" ? "leftToe" : "rightToe";
  const heelKey = side === "left" ? "heelL" : "heelR";
  const kneeKey = side === "left" ? "kneeL" : "kneeR";
  const hipKey = side === "left" ? "hipL" : "hipR";
  const toeY = walking.map((f) => f[toeKey]?.y ?? NaN);
  const heelY = walking.map((f) => f.legWorlds?.[heelKey]?.y ?? NaN);
  const ankleDeg = walking.map((f) => {
    const knee = f.legWorlds?.[kneeKey];
    const heel = f.legWorlds?.[heelKey];
    const toe = f[toeKey];
    if (!knee || !heel || !toe) return NaN;
    return angleAtAnkleDeg(knee, heel, toe);
  });
  const validToe = toeY.filter((v) => Number.isFinite(v));
  const floor = validToe.length > 0 ? Math.min(...validToe) : NaN;
  const contact = toeY.map((y) => Number.isFinite(y) && y - floor <= FOOT_CONTACT_HEIGHT_METERS);
  const knees = walking
    .map((f) => f.kneeFlexionDeg?.[side] ?? null)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let quatMaxDev = 0;
  for (const f of walking) {
    for (const q of Object.values(f.legBones ?? {})) {
      if (!q) continue;
      quatMaxDev = Math.max(quatMaxDev, Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1));
    }
  }
  void hipKey;
  return {
    toeY,
    heelY,
    ankleDeg,
    contact,
    kneePeakDeg: knees.length > 0 ? Math.max(...knees) : null,
    quatMaxDev,
  };
}

async function boundSideSeries(
  glbPath: string,
  clip: string,
  side: Side,
): Promise<{ toeY: number[]; heelY: number[]; ankleDeg: number[]; contact: boolean[] }> {
  const sfx = side === "left" ? ".L" : ".R";
  const [kneeT, ankleT, toeT] = await Promise.all([
    boundClipJointTrack({ glbPath, clipName: clip, boneName: `lowerleg01${sfx}` }),
    boundClipJointTrack({ glbPath, clipName: clip, boneName: `foot${sfx}` }),
    boundClipJointTrack({ glbPath, clipName: clip, boneName: `toe1-1${sfx}` }),
  ]);
  const frames = kneeT.samples.length;
  const toeY: number[] = [];
  const heelY: number[] = [];
  const ankleDeg: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    const knee = kneeT.samples[i]?.position;
    const ankle = ankleT.samples[i]?.position;
    const toe = toeT.samples[i]?.position;
    if (!knee || !ankle || !toe) {
      toeY.push(NaN);
      heelY.push(NaN);
      ankleDeg.push(NaN);
      continue;
    }
    toeY.push(toe.y * BOUND_ACTOR_SCALE);
    heelY.push(ankle.y * BOUND_ACTOR_SCALE);
    ankleDeg.push(
      angleAtAnkleDeg(
        { x: knee.x * BOUND_ACTOR_SCALE, y: knee.y * BOUND_ACTOR_SCALE, z: knee.z * BOUND_ACTOR_SCALE },
        { x: ankle.x * BOUND_ACTOR_SCALE, y: ankle.y * BOUND_ACTOR_SCALE, z: ankle.z * BOUND_ACTOR_SCALE },
        { x: toe.x * BOUND_ACTOR_SCALE, y: toe.y * BOUND_ACTOR_SCALE, z: toe.z * BOUND_ACTOR_SCALE },
      ),
    );
  }
  // The clip loops: duplicate the series so a swing wrapping the loop end
  // still finds its touchdown.
  const loop = (xs: number[]): number[] => [...xs, ...xs];
  const toe2 = loop(toeY);
  const heel2 = loop(heelY);
  const ankle2 = loop(ankleDeg);
  const floor = Math.min(...toeY.filter((v) => Number.isFinite(v)));
  const contact2 = toe2.map((y) => Number.isFinite(y) && y - floor <= FOOT_CONTACT_HEIGHT_METERS);
  return { toeY: toe2, heelY: heel2, ankleDeg: ankle2, contact: contact2 };
}

async function main(): Promise<void> {
  const route = arg("--route", null);
  const runs = argAll("--run");
  const home = process.env["HOME"] ?? "/Users/patrick";
  const boundGlb = arg(
    "--bound-glb",
    "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  ) ?? "";
  void home;
  const clip = arg("--clip", "openclinxr_retarget_walk_source") ?? "";
  const outPath = arg("--out", null);
  if (!route || runs.length === 0 || !outPath) {
    throw new Error("usage: ankle-clearance.ts --route=NAME --run=f.json [--run=g.json] --out=o.json [--bound-glb=...] [--clip=...]");
  }
  process.stdout.write(`bound clip: ${clip} in ${boundGlb}\n`);
  const bound: Record<Side, FootSwingResult> = {
    left: analyzeSwings({ ...(await boundSideSeries(boundGlb, clip, "left")), bins: ANKLE_BINS }),
    right: analyzeSwings({ ...(await boundSideSeries(boundGlb, clip, "right")), bins: ANKLE_BINS }),
  };
  const runResults = [];
  for (const runPath of runs) {
    const run = JSON.parse(await readFile(runPath, "utf8")) as LiveRun;
    const out: Record<string, unknown> = { file: runPath };
    let quatMaxDev = 0;
    for (const side of ["left", "right"] as const) {
      const series = liveSideSeries(run.frames, side);
      const res = analyzeSwings({ ...series, bins: ANKLE_BINS });
      quatMaxDev = Math.max(quatMaxDev, series.quatMaxDev);
      const ankleRmse = rmseIntersection(res.meanAnkleCurve, bound[side].meanAnkleCurve);
      out[side] = {
        ...res,
        kneePeakDeg: series.kneePeakDeg,
        ankleRmseVsBoundDeg: ankleRmse.rmse,
        ankleRmseBins: ankleRmse.nBins,
      };
    }
    out["quatMaxDev"] = quatMaxDev;
    runResults.push(out);
  }
  const result = {
    schemaVersion: "openclinxr.ankle-clearance.v1",
    measuredAt: new Date().toISOString(),
    route,
    definition: CLEARANCE_DEFINITION,
    bins: ANKLE_BINS,
    midSwing: [MID_SWING_LO, MID_SWING_HI],
    contactBandM: FOOT_CONTACT_HEIGHT_METERS,
    boundClip: { glb: boundGlb, clip, actorScale: BOUND_ACTOR_SCALE, left: bound.left, right: bound.right },
    runs: runResults,
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  for (const r of runResults) {
    const l = r["left"] as { minToeClrMm: number | null; ankleRmseVsBoundDeg: number };
    const rr = r["right"] as { minToeClrMm: number | null; ankleRmseVsBoundDeg: number };
    process.stdout.write(
      `${r["file"]}: minToeClr L=${l.minToeClrMm?.toFixed(1) ?? "n/a"} R=${rr.minToeClrMm?.toFixed(1) ?? "n/a"} mm; ` +
        `ankleRMSE L=${Number.isFinite(l.ankleRmseVsBoundDeg) ? l.ankleRmseVsBoundDeg.toFixed(2) : "n/a"} ` +
        `R=${Number.isFinite(rr.ankleRmseVsBoundDeg) ? rr.ankleRmseVsBoundDeg.toFixed(2) : "n/a"} deg\n`,
    );
  }
  process.stdout.write(`wrote ${outPath}\n`);
}

const invokedAsMain = (process.argv[1] ?? "").endsWith("ankle-clearance.ts");
if (invokedAsMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
