import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FOOT_CONTACT_HEIGHT_METERS } from "@openclinxr/asset-registry/approach-executor";
import {
  computeArrivedToeTravel,
  type ArrivedToeTravel,
} from "./arrived-toe-travel.js";

/**
 * Slide-phase meter (2026-10-13 slice): per-phase foot-slide baseline for the
 * physician's bedside approach, read off settle-entry-capture records.
 *
 * INSTRUMENT ONLY. No product code, no thresholds, no bars. Every boundary below
 * comes from the record's own phase/stanceFoot columns; the only numeric constant
 * is the production contact band itself (imported, not retyped).
 *
 * Notation: |a-b|_xz = hypot(a.x-b.x, a.z-b.z). BAND = FOOT_CONTACT_HEIGHT_METERS.
 * planted(f, foot) := f.toe[foot] is present and f.toe[foot].y <= BAND.
 * deepPlanted(f, foot) := f.toe[foot] is present and f.toe[foot].y <= DEEP_BAND_M
 * (0.02 m, footstep-plan S1 M3 measurement, not a bar: the same windows as (2)
 * but only frames with the toe truly near the ground, so heel-strike/toe-off
 * roll inside the 6 cm band separates from true ground slide).
 *
 * Boundaries (record columns only):
 * - W0/W1 = first/last index with phase = "walking".
 * - S0/S1 = first/last index with phase = "settling".
 * - T0 (turn start) = first index >= S0 with phase = "settling" and
 *   stanceFoot in {left, right}; null when no settling frame carries a stance.
 *
 * Per-run quantities (each stated as an expression):
 * 1. start transient:
 *    lift(foot) = min { i in walking indices : toe[foot][i].y > BAND }
 *      (null when the foot never leaves the band; frames with a missing toe
 *      are skipped for that foot).
 *    travel[foot] = SUM over consecutive walking-index pairs (i,i+1) with
 *      W0 <= i < lift(foot), both toes present, of |toe[i+1]-toe[i]|_xz.
 *    firstStanceFoot = stanceFoot[W0]; first step = maximal leading run
 *      [W0..k] with stanceFoot == firstStanceFoot.
 *    firstStepTravel = SUM over pairs (i,i+1), W0 <= i < k, both stance toes
 *      present, of |toe[i+1]-toe[i]|_xz (0 for a single-frame run).
 * 2. walking: windows = maximal runs [a..b] (b-a >= 1) of consecutive indices
 *    with phase = "walking", stanceFoot == F, every frame planted(F), toes present.
 *    windowTravel = MAX_{i in [a..b]} |toeF[i]-toeF[a]|_xz (span from window base,
 *    the settle-entry-analyze method). sumWalkSlide = SUM windowTravel.
 *    rootPathM = SUM over consecutive walking indices with both slots present
 *    of |slot[i]-slot[i-1]|_xz. slidePerMetre = sumWalkSlide / rootPathM
 *    (null when rootPathM == 0).
 * 2b. walking deep-gate (S1 M3): deepWindows = maximal runs as in (2) with
 *    deepPlanted in place of planted. deepSumM = SUM windowTravel.
 *    deepSlidePerMetre = deepSumM / rootPathM (null when rootPathM == 0).
 * 3. settle: pairs (i,i+1) with W1 <= i < T0, both endpoints planted(foot).
 *    settleTravel[foot] = SUM of |toe[i+1]-toe[i]|_xz over those pairs
 *    (0 when T0 == W1 + 1 with no planted pair; missing when T0 is null).
 * 4. turn: windows as in (2) but inside [T0..S1]. pivotFoot = stanceFoot of the
 *    first turn window (null when none). turnMaxM = MAX window travel
 *    (0 when no windows). replicaUngatedMaxM = MAX span-from-base over
 *    stanceFoot runs (>= 2 frames) across ALL settling indices with NO band
 *    gate: a line-for-line replica of settle-entry-analyze's windowSlidesM,
 *    used only to reconcile against the published whole-run figure.
 * 5. end stance at E = S1 (last settling frame: the turn is complete and
 *    arrival-close has not yet reshaped the toes):
 *    d = R-L (world XZ); right = (cos yaw, -sin yaw); fwd = (sin yaw, cos yaw)
 *    (three.js rotation.y = yaw: local +X / +Z in world).
 *    lateralM = d.right; foreAftM = d.fwd.
 *    yawErrRad = atan2(sin(target-yaw), cos(target-yaw)) with targetHeading.
 *    bothInBand = L.y <= BAND && R.y <= BAND (world-Y datum, the same test
 *    footSlideMeters applies: the capture carries no floor datum, and pinned
 *    toes read at or just under y = 0).
 *
 * claimScope: arithmetic over settle-entry-capture v1 records.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance,
 * scoring validity, or any accept/reject verdict on the walk.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Slot = { x: number; y: number; z: number; yaw: number };

export type SlidePhaseFrame = {
  step?: number;
  phase: string | null;
  slot: Slot | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  stanceFoot: string | null;
  travelledMeters?: number | null;
  clipTime?: number | null;
  stoppedSeconds?: number;
  targetHeading?: number | null;
  travelHeading?: number | null;
  startWorld?: Vec3 | null;
  targetWorld?: Vec3 | null;
  /** M2 rest-stance slice: live-scene poses (absent on records predating it). */
  liveActors?: Array<{
    actorId: string;
    slot: Slot | null;
    toeL: Vec3 | null;
    toeR: Vec3 | null;
  }>;
};

export type SlidePhaseRunFile = {
  vehicle?: string;
  runIndex?: number;
  labels?: unknown;
  preWalk?: unknown[];
  frames: SlidePhaseFrame[];
};

export type StanceWindow = {
  foot: "left" | "right";
  startFrame: number;
  endFrame: number;
  frames: number;
  travelM: number;
};

export type SlidePhaseMetrics = {
  tag: string;
  nFrames: number;
  phaseCounts: Record<string, number>;
  walkRange: { first: number; last: number } | null;
  settlingRange: { first: number; last: number } | null;
  turnStart: number | null;
  startTransient: {
    leftTravelM: number | null;
    rightTravelM: number | null;
    liftFrame: { left: number | null; right: number | null };
    firstStanceFoot: string | null;
    firstStepTravelM: number | null;
  };
  walking: {
    windows: StanceWindow[];
    singleFrameRuns: number;
    sumM: number;
    rootPathM: number;
    slidePerMetre: number | null;
    /** S1 M3: same windows under the deep gate (toe.y <= 0.02 m). */
    deepWindows: StanceWindow[];
    deepSumM: number;
    deepSlidePerMetre: number | null;
    /**
     * S1 T1: isolated sub-0.02 m frames that cannot form a window (singleton
     * stance runs under the deep gate). When deepWindows is empty and this is
     * small, the reading is "no window formed", not "no data": the
     * stance-labelled walking foot never dwells within 2 cm of the floor.
     */
    deepSingleFrameRuns: number;
  };
  settle: {
    fromFrame: number | null;
    toFrame: number | null;
    leftTravelM: number | null;
    rightTravelM: number | null;
  };
  turn: {
    startFrame: number | null;
    endFrame: number | null;
    pivotFoot: string | null;
    windows: StanceWindow[];
    maxM: number;
    /** Ungated replica of settle-entry-analyze windowSlidesM; reconciliation only. */
    replicaUngatedMaxM: number;
    replicaUngatedWindows: number;
  };
  endStance: {
    frame: number | null;
    lateralM: number | null;
    foreAftM: number | null;
    yawErrorRad: number | null;
    yawErrorDeg: number | null;
    bothInBand: boolean | null;
  };
  /**
   * T2-handback: the pose at the LAST RECORDED frame (phase arrived) plus the
   * arrived-phase excursion that got there. The gate grades the pose a viewer
   * is left looking at — not just the last settling frame.
   */
  arrivedStance: {
    frame: number | null;
    lateralM: number | null;
    foreAftM: number | null;
    /** Max |fore-aft split| over all arrived frames (excursion-then-return check). */
    maxAbsForeM: number | null;
    /** Min toe world height over both toes over all arrived frames (floor check). */
    minToeYM: number | null;
  };
  /**
   * M2 rest-stance slice: per-toe horizontal travel during arrived, from the
   * first arrived frame (see arrived-toe-travel.ts: maxM is the visible glide,
   * sumM the path diagnostic).
   */
  arrivedToeTravel: ArrivedToeTravel;
  /** Sub-quantities that could not be computed, with the missing column named. */
  missing: string[];
};

function xzStep(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function toeOf(f: SlidePhaseFrame, foot: "left" | "right"): Vec3 | null {
  return foot === "left" ? f.leftToe : f.rightToe;
}

function planted(f: SlidePhaseFrame, foot: "left" | "right"): boolean {
  const t = toeOf(f, foot);
  return t !== null && t.y <= FOOT_CONTACT_HEIGHT_METERS;
}

/**
 * S1 M3 deep gate (measurement, not a bar): toe truly near the ground.
 * Literal 0.02 m from the brief; mirrors planted()'s <= convention.
 */
const DEEP_BAND_M = 0.02;

function gated(f: SlidePhaseFrame, foot: "left" | "right", bandMeters: number | null): boolean {
  if (bandMeters === null) return toeOf(f, foot) !== null;
  const t = toeOf(f, foot);
  return t !== null && t.y <= bandMeters;
}

/** Maximal stanceFoot runs (>= 1 frame) inside an index list; singletons counted out. */
function stanceRuns(
  frames: SlidePhaseFrame[],
  idx: number[],
  opts: { bandMeters: number | null },
): { windows: StanceWindow[]; singleFrameRuns: number } {
  const windows: StanceWindow[] = [];
  let singleFrameRuns = 0;
  let open: { foot: "left" | "right"; idx: number[] } | null = null;
  const flush = (): void => {
    if (open === null) return;
    if (open.idx.length < 2) {
      singleFrameRuns += 1;
    } else {
      const a = open.idx[0]!;
      const base = toeOf(frames[a]!, open.foot)!;
      let travel = 0;
      for (const i of open.idx) {
        travel = Math.max(travel, xzStep(toeOf(frames[i]!, open.foot)!, base));
      }
      windows.push({
        foot: open.foot,
        startFrame: a,
        endFrame: open.idx[open.idx.length - 1]!,
        frames: open.idx.length,
        travelM: travel,
      });
    }
    open = null;
  };
  for (const i of idx) {
    const f = frames[i]!;
    const stance = f.stanceFoot;
    const foot: "left" | "right" | null =
      stance === "left" || stance === "right" ? stance : null;
    const usable =
      foot !== null &&
      toeOf(f, foot) !== null &&
      gated(f, foot, opts.bandMeters);
    if (!usable || foot === null) {
      flush();
      continue;
    }
    if (open !== null && open.foot !== foot) flush();
    if (open === null) open = { foot, idx: [] };
    open.idx.push(i);
  }
  flush();
  return { windows, singleFrameRuns };
}

/** Sum of consecutive XZ steps for a foot over walking-index pairs in [lo, hi). */
function footPathSum(
  frames: SlidePhaseFrame[],
  walkingIdx: number[],
  foot: "left" | "right",
  lo: number,
  hi: number,
): number {
  let sum = 0;
  for (let k = 0; k + 1 < walkingIdx.length; k += 1) {
    const i = walkingIdx[k]!;
    const j = walkingIdx[k + 1]!;
    if (i < lo || j < lo || i >= hi || j > hi) continue;
    const a = toeOf(frames[i]!, foot);
    const b = toeOf(frames[j]!, foot);
    if (a !== null && b !== null) sum += xzStep(a, b);
  }
  return sum;
}

export function computeSlidePhase(tag: string, run: SlidePhaseRunFile): SlidePhaseMetrics {
  const frames = run.frames;
  const missing: string[] = [];
  const phaseCounts: Record<string, number> = {};
  const walkingIdx: number[] = [];
  const settlingIdx: number[] = [];
  frames.forEach((f, i) => {
    const p = f.phase ?? "null";
    phaseCounts[p] = (phaseCounts[p] ?? 0) + 1;
    if (f.phase === "walking") walkingIdx.push(i);
    if (f.phase === "settling") settlingIdx.push(i);
  });
  const walkRange =
    walkingIdx.length > 0
      ? { first: walkingIdx[0]!, last: walkingIdx[walkingIdx.length - 1]! }
      : null;
  const settlingRange =
    settlingIdx.length > 0
      ? { first: settlingIdx[0]!, last: settlingIdx[settlingIdx.length - 1]! }
      : null;
  const W0 = walkRange?.first ?? null;
  const W1 = walkRange?.last ?? null;
  const S1 = settlingRange?.last ?? null;
  let turnStart: number | null = null;
  for (const i of settlingIdx) {
    const s = frames[i]!.stanceFoot;
    if (s === "left" || s === "right") {
      turnStart = i;
      break;
    }
  }

  // (1) start transient.
  const liftFrame: { left: number | null; right: number | null } = { left: null, right: null };
  let leftTravelM: number | null = null;
  let rightTravelM: number | null = null;
  let firstStanceFoot: string | null = null;
  let firstStepTravelM: number | null = null;
  if (W0 === null) {
    missing.push("startTransient: no frame with phase=walking (phase column)");
  } else {
    for (const foot of ["left", "right"] as const) {
      let lift: number | null = null;
      for (const i of walkingIdx) {
        const t = toeOf(frames[i]!, foot);
        if (t !== null && t.y > FOOT_CONTACT_HEIGHT_METERS) {
          lift = i;
          break;
        }
      }
      liftFrame[foot] = lift;
    }
    leftTravelM =
      liftFrame.left === null ? null : footPathSum(frames, walkingIdx, "left", W0, liftFrame.left);
    rightTravelM =
      liftFrame.right === null ? null : footPathSum(frames, walkingIdx, "right", W0, liftFrame.right);
    if (liftFrame.left === null || liftFrame.right === null) {
      missing.push(
        `startTransient: ${liftFrame.left === null ? "left" : "right"} toe never exceeds ` +
          `FOOT_CONTACT_HEIGHT_METERS in walking (leftToe/rightToe y column)`,
      );
    }
    firstStanceFoot = frames[W0]!.stanceFoot;
    let k = W0;
    while (
      k + 1 < frames.length &&
      frames[k + 1]!.phase === "walking" &&
      frames[k + 1]!.stanceFoot === firstStanceFoot
    ) {
      k += 1;
    }
    if (firstStanceFoot === "left" || firstStanceFoot === "right") {
      firstStepTravelM = footPathSum(frames, walkingIdx, firstStanceFoot, W0, k);
    } else {
      firstStepTravelM = null;
      missing.push("startTransient.firstStep: stanceFoot[walk start] is not left/right (stanceFoot column)");
    }
  }

  // (2) walking.
  const walkRuns =
    W0 === null
      ? { windows: [] as StanceWindow[], singleFrameRuns: 0 }
      : stanceRuns(frames, walkingIdx, { bandMeters: FOOT_CONTACT_HEIGHT_METERS });
  const sumM = walkRuns.windows.reduce((s, w) => s + w.travelM, 0);
  // (2b) walking deep-gate: same windows, toe.y <= 0.02 m.
  const deepRuns =
    W0 === null
      ? { windows: [] as StanceWindow[], singleFrameRuns: 0 }
      : stanceRuns(frames, walkingIdx, { bandMeters: DEEP_BAND_M });
  const deepSumM = deepRuns.windows.reduce((s, w) => s + w.travelM, 0);
  let rootPathM = 0;
  for (let k = 1; k < walkingIdx.length; k += 1) {
    const a = frames[walkingIdx[k - 1]!]!.slot;
    const b = frames[walkingIdx[k]!]!.slot;
    if (a !== null && b !== null) rootPathM += Math.hypot(a.x - b.x, a.z - b.z);
  }
  if (W0 === null) missing.push("walking: no frame with phase=walking (phase column)");

  // (3) settle: [W1..T0].
  let settleFrom: number | null = null;
  let settleTo: number | null = null;
  let settleLeft: number | null = null;
  let settleRight: number | null = null;
  if (W1 === null || turnStart === null) {
    missing.push(
      "settle: needs last walking frame (phase column) and first settling frame " +
        "with stanceFoot left/right (stanceFoot column)",
    );
  } else {
    settleFrom = W1;
    settleTo = turnStart;
    const pairSum = (foot: "left" | "right"): number => {
      let sum = 0;
      for (let i = W1; i < turnStart; i += 1) {
        const a = frames[i]!;
        const b = frames[i + 1]!;
        if (planted(a, foot) && planted(b, foot)) {
          sum += xzStep(toeOf(a, foot)!, toeOf(b, foot)!);
        }
      }
      return sum;
    };
    settleLeft = pairSum("left");
    settleRight = pairSum("right");
  }

  // (4) turn: [T0..S1], band-gated windows + ungated replica.
  const turnIdx =
    turnStart !== null && S1 !== null
      ? settlingIdx.filter((i) => i >= turnStart && i <= S1)
      : [];
  const turnRuns = stanceRuns(frames, turnIdx, { bandMeters: FOOT_CONTACT_HEIGHT_METERS });
  const replicaRuns = stanceRuns(frames, settlingIdx, { bandMeters: null });
  const turnMax = turnRuns.windows.length === 0 ? 0 : Math.max(...turnRuns.windows.map((w) => w.travelM));
  const replicaMax =
    replicaRuns.windows.length === 0 ? 0 : Math.max(...replicaRuns.windows.map((w) => w.travelM));
  const pivotFoot = turnRuns.windows.length > 0 ? turnRuns.windows[0]!.foot : null;
  if (turnStart === null || S1 === null) {
    missing.push("turn: no settling stance window (phase/stanceFoot columns)");
  }

  // (5) end stance at E = S1.
  let endFrame: number | null = null;
  let lateralM: number | null = null;
  let foreAftM: number | null = null;
  let yawErrorRad: number | null = null;
  let bothInBand: boolean | null = null;
  if (S1 === null) {
    missing.push("endStance: no frame with phase=settling (phase column)");
  } else {
    const f = frames[S1]!;
    endFrame = S1;
    const targetHeading = f.targetHeading ?? null;
    if (f.leftToe !== null && f.rightToe !== null && f.slot !== null && targetHeading !== null) {
      const dx = f.rightToe.x - f.leftToe.x;
      const dz = f.rightToe.z - f.leftToe.z;
      const yaw = f.slot.yaw;
      lateralM = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
      foreAftM = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      yawErrorRad = Math.atan2(
        Math.sin(targetHeading - yaw),
        Math.cos(targetHeading - yaw),
      );
      bothInBand =
        f.leftToe.y <= FOOT_CONTACT_HEIGHT_METERS &&
        f.rightToe.y <= FOOT_CONTACT_HEIGHT_METERS;
    } else {
      missing.push(
        "endStance: last settling frame lacks leftToe/rightToe/slot/targetHeading (record columns)",
      );
    }
  }

  // (5b) arrived stance at E2 = last recorded frame + arrived-phase extremes.
  let arrivedFrame: number | null = null;
  let arrivedLateralM: number | null = null;
  let arrivedForeAftM: number | null = null;
  let arrivedMaxAbsForeM: number | null = null;
  let arrivedMinToeYM: number | null = null;
  const arrivedIdx: number[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i]!.phase === "arrived") arrivedIdx.push(i);
  }
  if (arrivedIdx.length === 0) {
    missing.push("arrivedStance: no frame with phase=arrived (phase column)");
  } else {
    const e2 = arrivedIdx[arrivedIdx.length - 1]!;
    const f = frames[e2]!;
    arrivedFrame = e2;
    if (f.leftToe !== null && f.rightToe !== null && f.slot !== null) {
      const dx = f.rightToe.x - f.leftToe.x;
      const dz = f.rightToe.z - f.leftToe.z;
      const yaw = f.slot.yaw;
      arrivedLateralM = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
      arrivedForeAftM = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    } else {
      missing.push("arrivedStance: last frame lacks leftToe/rightToe/slot (record columns)");
    }
    let maxAbsFore = 0;
    let minToeY = Number.POSITIVE_INFINITY;
    let extremesOk = true;
    for (const i of arrivedIdx) {
      const g = frames[i]!;
      if (g.leftToe === null || g.rightToe === null || g.slot === null) {
        extremesOk = false;
        break;
      }
      const dx = g.rightToe.x - g.leftToe.x;
      const dz = g.rightToe.z - g.leftToe.z;
      const fore = dx * Math.sin(g.slot.yaw) + dz * Math.cos(g.slot.yaw);
      maxAbsFore = Math.max(maxAbsFore, Math.abs(fore));
      minToeY = Math.min(minToeY, g.leftToe.y, g.rightToe.y);
    }
    if (extremesOk) {
      arrivedMaxAbsForeM = maxAbsFore;
      arrivedMinToeYM = minToeY;
    } else {
      missing.push("arrivedStance: an arrived frame lacks leftToe/rightToe/slot (record columns)");
    }
  }

  return {
    tag,
    nFrames: frames.length,
    phaseCounts,
    walkRange,
    settlingRange,
    turnStart,
    startTransient: {
      leftTravelM,
      rightTravelM,
      liftFrame,
      firstStanceFoot,
      firstStepTravelM,
    },
    walking: {
      windows: walkRuns.windows,
      singleFrameRuns: walkRuns.singleFrameRuns,
      sumM,
      rootPathM,
      slidePerMetre: rootPathM === 0 ? null : sumM / rootPathM,
      deepWindows: deepRuns.windows,
      deepSumM,
      deepSlidePerMetre: rootPathM === 0 ? null : deepSumM / rootPathM,
      deepSingleFrameRuns: deepRuns.singleFrameRuns,
    },
    settle: {
      fromFrame: settleFrom,
      toFrame: settleTo,
      leftTravelM: settleLeft,
      rightTravelM: settleRight,
    },
    turn: {
      startFrame: turnStart,
      endFrame: S1,
      pivotFoot,
      windows: turnRuns.windows,
      maxM: turnMax,
      replicaUngatedMaxM: replicaMax,
      replicaUngatedWindows: replicaRuns.windows.length,
    },
    endStance: {
      frame: endFrame,
      lateralM,
      foreAftM,
      yawErrorRad,
      yawErrorDeg: yawErrorRad === null ? null : (yawErrorRad * 180) / Math.PI,
      bothInBand,
    },
    arrivedStance: {
      frame: arrivedFrame,
      lateralM: arrivedLateralM,
      foreAftM: arrivedForeAftM,
      maxAbsForeM: arrivedMaxAbsForeM,
      minToeYM: arrivedMinToeYM,
    },
    arrivedToeTravel: computeArrivedToeTravel(frames),
    missing,
  };
}

export function stats(values: number[]): {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
} {
  const n = values.length;
  const mean = n === 0 ? Number.NaN : values.reduce((s, v) => s + v, 0) / n;
  const sd =
    n < 2 ? 0 : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, min: n === 0 ? Number.NaN : Math.min(...values), max: n === 0 ? Number.NaN : Math.max(...values) };
}

function dirFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
  if (!flag) throw new Error("usage: slide-phase-analyze.ts --dir=captureDir --vehicle=sc05|loco [--out=summary.json]");
  return flag;
}

function vehicleFromArgv(): string {
  const flag = process.argv.find((a) => a.startsWith("--vehicle="))?.slice("--vehicle=".length);
  if (flag !== "sc05" && flag !== "loco") throw new Error("usage: --vehicle=sc05|loco");
  return flag;
}

function outFromArgv(): string | null {
  return process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;
}

const fmt = (v: number | null, digits = 4): string =>
  v === null || Number.isNaN(v) ? "n/a" : v.toFixed(digits);

async function main(): Promise<void> {
  const dir = dirFromArgv();
  const vehicle = vehicleFromArgv();
  const out = outFromArgv();
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".json") && f.startsWith(`${vehicle}-run`))
    .sort();
  if (files.length === 0) throw new Error(`no ${vehicle} run files in ${dir}`);
  const first = JSON.parse(await readFile(path.join(dir, files[0]!), "utf8")) as SlidePhaseRunFile;
  if (!Array.isArray(first.frames)) throw new Error(`${files[0]} carries no frames array`);
  const recordKeys = {
    top: Object.keys(first).sort(),
    frame: Object.keys(first.frames[0] ?? {}).sort(),
  };
  process.stdout.write(`recordKeys.top: ${recordKeys.top.join(",")}\n`);
  process.stdout.write(`recordKeys.frame: ${recordKeys.frame.join(",")}\n`);
  process.stdout.write(`contactBandM: FOOT_CONTACT_HEIGHT_METERS=${FOOT_CONTACT_HEIGHT_METERS} (imported)\n`);

  const metrics: SlidePhaseMetrics[] = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(path.join(dir, file), "utf8")) as SlidePhaseRunFile;
    if (!Array.isArray(run.frames)) continue;
    metrics.push(computeSlidePhase(file.replace(/\.json$/, ""), run));
  }

  const lines: string[] = [];
  lines.push(`# slide-phase: ${dir} vehicle=${vehicle} (${metrics.length} runs)`);
  lines.push("| run | startL | startR | 1stStep | walkWin | walkSum | deepWin | deepSum | rootM | slide/m | deep/m | settleL | settleR | turnMax | pivot | lat | foreAft | yawErrDeg | band | arrLat | arrFore | arrMaxFore | arrMinToeY |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const m of metrics) {
    lines.push(
      `| ${m.tag} | ${fmt(m.startTransient.leftTravelM)} | ${fmt(m.startTransient.rightTravelM)} | ` +
        `${fmt(m.startTransient.firstStepTravelM)} | ${m.walking.windows.length} | ${fmt(m.walking.sumM)} | ` +
        `${m.walking.deepWindows.length} | ${fmt(m.walking.deepSumM)} | ` +
        `${fmt(m.walking.rootPathM, 3)} | ${fmt(m.walking.slidePerMetre)} | ${fmt(m.walking.deepSlidePerMetre)} | ` +
        `${fmt(m.settle.leftTravelM)} | ` +
        `${fmt(m.settle.rightTravelM)} | ${fmt(m.turn.maxM)} | ${m.turn.pivotFoot ?? "n/a"} | ` +
        `${fmt(m.endStance.lateralM)} | ${fmt(m.endStance.foreAftM)} | ${fmt(m.endStance.yawErrorDeg, 2)} | ` +
        `${m.endStance.bothInBand === null ? "n/a" : m.endStance.bothInBand ? "yes" : "NO"} | ` +
        `${fmt(m.arrivedStance.lateralM)} | ${fmt(m.arrivedStance.foreAftM)} | ` +
        `${fmt(m.arrivedStance.maxAbsForeM)} | ${fmt(m.arrivedStance.minToeYM)} |`,
    );
  }
  lines.push("");
  const show = (name: string, unit: string, values: Array<number | null>, digits = 4): void => {
    const clean = values.filter((v): v is number => v !== null && !Number.isNaN(v));
    const s = stats(clean);
    lines.push(
      `- ${name}: n=${s.n} mean=${fmt(s.mean, digits)}${unit} sd=${fmt(s.sd, digits)}${unit} ` +
        `range=[${fmt(s.min, digits)},${fmt(s.max, digits)}]${unit}`,
    );
  };
  lines.push("## aggregate (mean/sd/range)");
  show("startTransient.leftTravelM", "m", metrics.map((m) => m.startTransient.leftTravelM));
  show("startTransient.rightTravelM", "m", metrics.map((m) => m.startTransient.rightTravelM));
  show("startTransient.firstStepTravelM", "m", metrics.map((m) => m.startTransient.firstStepTravelM));
  show("walking.sumM", "m", metrics.map((m) => m.walking.sumM));
  show("walking.deepSumM", "m", metrics.map((m) => m.walking.deepSumM));
  show("walking.deepSingleFrameRuns", "frames", metrics.map((m) => m.walking.deepSingleFrameRuns), 0);
  show("walking.rootPathM", "m", metrics.map((m) => m.walking.rootPathM), 3);
  show("walking.slidePerMetre", "m/m", metrics.map((m) => m.walking.slidePerMetre));
  show("walking.deepSlidePerMetre", "m/m", metrics.map((m) => m.walking.deepSlidePerMetre));
  show("settle.leftTravelM", "m", metrics.map((m) => m.settle.leftTravelM));
  show("settle.rightTravelM", "m", metrics.map((m) => m.settle.rightTravelM));
  show("turn.maxM", "m", metrics.map((m) => m.turn.maxM));
  show("turn.replicaUngatedMaxM", "m", metrics.map((m) => m.turn.replicaUngatedMaxM));
  show("endStance.lateralM", "m", metrics.map((m) => m.endStance.lateralM));
  show("endStance.foreAftM", "m", metrics.map((m) => m.endStance.foreAftM));
  show("endStance.yawErrorDeg", "deg", metrics.map((m) => m.endStance.yawErrorDeg), 2);
  show("arrivedStance.lateralM", "m", metrics.map((m) => m.arrivedStance.lateralM));
  show("arrivedStance.foreAftM", "m", metrics.map((m) => m.arrivedStance.foreAftM));
  show("arrivedToeTravel.leftMaxM", "m", metrics.map((m) => m.arrivedToeTravel.leftMaxM));
  show("arrivedToeTravel.rightMaxM", "m", metrics.map((m) => m.arrivedToeTravel.rightMaxM));
  show("arrivedToeTravel.leftSumM", "m", metrics.map((m) => m.arrivedToeTravel.leftSumM));
  show("arrivedToeTravel.rightSumM", "m", metrics.map((m) => m.arrivedToeTravel.rightSumM));
  show("arrivedStance.maxAbsForeM", "m", metrics.map((m) => m.arrivedStance.maxAbsForeM));
  show("arrivedStance.minToeYM", "m", metrics.map((m) => m.arrivedStance.minToeYM));
  lines.push("");
  for (const m of metrics) {
    const t = m.arrivedToeTravel;
    lines.push(
      `- ${m.tag}: arrivedToeTravel start=${t.startFrame ?? "n/a"} frames=${t.frames} ` +
        `leftMax=${fmt(t.leftMaxM)} leftSum=${fmt(t.leftSumM)} ` +
        `rightMax=${fmt(t.rightMaxM)} rightSum=${fmt(t.rightSumM)}`,
    );
  }
  for (const m of metrics) {
    lines.push(
      `- ${m.tag}: walkWindows=[${m.walking.windows.map((w) => `${w.foot}${w.startFrame}-${w.endFrame}:${w.travelM.toFixed(4)}`).join(" ")}] ` +
        `deepWindows=[${m.walking.deepWindows.map((w) => `${w.foot}${w.startFrame}-${w.endFrame}:${w.travelM.toFixed(4)}`).join(" ")}] ` +
        `deepSingles=${m.walking.deepSingleFrameRuns} ` +
        `turnWindows=[${m.turn.windows.map((w) => `${w.foot}${w.startFrame}-${w.endFrame}:${w.travelM.toFixed(4)}`).join(" ")}] ` +
        `replicaUngatedMax=${m.turn.replicaUngatedMaxM.toFixed(4)} missing=[${m.missing.join("; ") || "none"}]`,
    );
  }
  const text = lines.join("\n");
  process.stdout.write(`${text}\n`);
  if (out !== null) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(out, JSON.stringify({ dir, vehicle, recordKeys, metrics }, null, 2));
    process.stdout.write(`[summary] wrote ${out}\n`);
  }
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("slide-phase-analyze.ts");

if (invokedAsScript) {
  await main();
}
