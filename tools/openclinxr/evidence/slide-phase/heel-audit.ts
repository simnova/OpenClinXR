/**
 * Heel audit (DENSE_v1 heel-audit slice, STEP 1).
 *
 * The slide meter (slide-phase-analyze.ts) measures TOE XZ inside the 0.06 m
 * contact band - the same band the foot-base actuator holds - so heel
 * behaviour is unmeasured. This instrument measures it, from the heel world
 * positions the captures already record (legWorlds.heelL/R = the foot-bone
 * origin, the ankle proxy foot-base-stride-measure.ts reads).
 *
 * DEFINITIONS (reported verbatim in the output `definition` field):
 * - heel floor[foot] = min heel world Y over the run (capture run, or the
 *   bound clip loop); toe floor likewise from the toe series. The Y gate is
 *   floor + 0.02 m (brief-literal, mirrors live-seam.ts PLANT_Y_BAND_M).
 * - speed gate: consecutive-sample heel XZ step <= 0.02 m/s * dt, with
 *   dt = 1/30 s on captures (CAPTURE_FPS, the fake-clock step) and the
 *   clip's own per-pair sample dt offline (frameTimesMs).
 * - heel plant = maximal run of >= 3 consecutive frames with every frame
 *   Y-gated and every internal pair speed-gated (brief-literal, same
 *   construction as live-seam.ts detectPlants, applied to the HEEL series).
 *   toe plant = the same construction on the toe series.
 * - heel XZ span per plant = max pairwise XZ distance over the plant frames
 *   (metres). spanBaseM (max from the plant base) rides beside it.
 * - stance = one heel plant + the same-foot toe plant with maximal frame
 *   overlap (>= 1 shared frame). A heel plant with no overlapping toe plant
 *   is NOT a stance; it is reported under unpairedHeelPlants.
 * - events per stance: heel-strike = heel plant start, foot-flat = toe plant
 *   start, heel-off = heel plant end, toe-off = toe plant end (frame indices
 *   live; sample times offline).
 * - order valid iff heel-strike < foot-flat < heel-off < toe-off (strict).
 * - gait-cycle fractions: per foot, consecutive heel-strike starts bound
 *   cycles; fraction(event) = (event - cycleStart) / (cycleEnd - cycleStart).
 *   Null when the stance has no closing heel-strike (open final cycle);
 *   events outside the cycle report fractions < 0 or > 1 as-is.
 * - bound clip offline: heel = foot.L/R bone track, toe = toe1-1.L/R track
 *   via bound-clip-foot-track.ts (same rig the ankle-clearance slice uses),
 *   world-scaled x0.86, series loop-duplicated so a plant wrapping the loop
 *   seam still forms; loop-second-half duplicates are folded back (mod loop).
 *
 * DECISION RULE (pre-registered in the slice brief, computed in
 * decideRoute/decideOverall and stored in the output, not in this header):
 * FAIL if any heel span > 0.010 m per plant (Kovar footskate floor) OR the
 * event order is violated in > 10 % of stances. Applied per route and overall.
 *
 * Usage:
 *   pnpm tsx tools/openclinxr/evidence/slide-phase/heel-audit.ts \
 *     --route=sc05:.openclinxr/evidence/foot-base-routes/sc05 \
 *     --route=sc05:.openclinxr/evidence/foot-base-routes/after7/sc05 \
 *     (version route dirs 2.0/3.7/6.0 are machine-local captures, gitignored, never in
 *     HEAD — ci-w8 dropped their example lines; pass --route=label:dir explicitly) \
 *     --out=.openclinxr/evidence/heel-audit/measure.json \
 *     [--bound-glb=...] [--clip=openclinxr_retarget_walk_source]
 *
 * INSTRUMENT ONLY. Reads committed captures/GLBs; writes no product code.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { boundClipJointTrack } from "../foot-plant/bound-clip-foot-track.js";

export const HEEL_Y_BAND_M = 0.02;
export const HEEL_SPEED_THRESH_MPS = 0.02;
export const CAPTURE_FPS = 30;
export const PLANT_MIN_FRAMES = 3;
/** Kovar footskate floor (brief): the per-plant span bar. */
export const KOVAR_SPAN_M = 0.01;
/** Order-violation share bar (brief): FAIL when violated/total > this. */
export const ORDER_VIOLATION_BAR = 0.1;
const BOUND_ACTOR_SCALE = 0.86;

export const HEEL_AUDIT_DEFINITION =
  "heel floor = min heel world Y over the run (or bound loop); Y gate = floor + 0.02 m; " +
  "speed gate = consecutive-sample heel XZ step <= 0.02 m/s * dt (dt = 1/30 s captures, clip sample dt offline); " +
  "heel/toe plant = maximal >= 3-frame run with all frames Y-gated and all internal pairs speed-gated; " +
  "heel span = max pairwise XZ distance over plant frames, m; " +
  "stance = heel plant + max-overlap same-foot toe plant (>= 1 shared frame); " +
  "order valid iff heel-strike < foot-flat < heel-off < toe-off (strict); " +
  "fractions = (event - cycleStart)/(cycleEnd - cycleStart) over consecutive same-foot heel-strikes, null when open.";

export type Vec3 = { x: number; y: number; z: number };
export type Side = "left" | "right";

export type HeelAuditFrame = {
  step?: number;
  phase: string | null;
  leftToe: Vec3 | null;
  rightToe: Vec3 | null;
  legWorlds: Record<string, Vec3 | null> | null;
};

export type MarkerPlant = {
  foot: Side;
  kind: "heel" | "toe";
  startFrame: number;
  endFrame: number;
  nFrames: number;
  /** Max XZ distance from the plant base frame. */
  spanBaseM: number;
  /** Max pairwise XZ distance over the plant frames. */
  spanPairM: number;
  floorM: number;
  phaseAtStart: string | null;
};

export type StanceEvents = {
  foot: Side;
  heelStrike: number;
  footFlat: number;
  heelOff: number;
  toeOff: number;
  orderOk: boolean;
  /** Which strict inequality failed first, null when orderOk. */
  violatedAt: "heelStrike<footFlat" | "footFlat<heelOff" | "heelOff<toeOff" | null;
  cycleStart: number;
  cycleEnd: number | null;
  fracHeelStrike: number | null;
  fracFootFlat: number | null;
  fracHeelOff: number | null;
  fracToeOff: number | null;
};

function xzDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Number-series read that satisfies noNonNullAssertion: out-of-range reads as NaN. */
function numAt(xs: number[], i: number): number {
  return xs[i] ?? NaN;
}

/**
 * Index-series read with an unreachable sentinel: every call site below only
 * indexes runs/pieces the detector itself just built non-empty, so -1 never
 * flows into output (a [-1]-seeded piece cannot reach the >= 3-frame flush).
 */
function idxAt(xs: number[], i: number): number {
  return xs[i] ?? -1;
}

/**
 * Generic Y + pair-speed plant detector over parallel position/Y/time
 * series. `times` must be strictly increasing seconds; `dt` per pair comes
 * from it, so captures (uniform 1/30 s) and the bound clip (clip rate) share
 * this function. Returns maximal >= minFrames runs; `times`/`loopLen` map
 * sample indices back to frame labels for the caller.
 */
export function detectMarkerPlants(input: {
  xs: number[];
  zs: number[];
  ys: number[];
  times: number[];
  foot: Side;
  kind: "heel" | "toe";
  yBandM?: number;
  speedMps?: number;
  minFrames?: number;
  phaseAt?: (index: number) => string | null;
}): MarkerPlant[] {
  const { xs, zs, ys, times, foot, kind } = input;
  const yBandM = input.yBandM ?? HEEL_Y_BAND_M;
  const speedMps = input.speedMps ?? HEEL_SPEED_THRESH_MPS;
  const minFrames = input.minFrames ?? PLANT_MIN_FRAMES;
  const n = xs.length;
  const finite = ys.filter((y) => Number.isFinite(y));
  if (n === 0 || finite.length === 0) return [];
  const floor = Math.min(...finite);
  const yOk: boolean[] = ys.map((y) => Number.isFinite(y) && y <= floor + yBandM);
  const runs: number[][] = [];
  let open: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (!yOk[i]) {
      if (open.length > 0) runs.push(open);
      open = [];
      continue;
    }
    if (open.length > 0 && i !== idxAt(open, open.length - 1) + 1) {
      runs.push(open);
      open = [];
    }
    open.push(i);
  }
  if (open.length > 0) runs.push(open);
  const out: MarkerPlant[] = [];
  for (const run of runs) {
    if (run.length === 0) continue;
    let piece: number[] = [idxAt(run, 0)];
    const flush = (): void => {
      if (piece.length >= minFrames) {
        const base = idxAt(piece, 0);
        let spanBase = 0;
        let spanPair = 0;
        for (const i of piece) {
          spanBase = Math.max(spanBase, xzDist({ x: numAt(xs, i), z: numAt(zs, i) }, { x: numAt(xs, base), z: numAt(zs, base) }));
        }
        for (const a of piece) {
          for (const b of piece) {
            spanPair = Math.max(spanPair, xzDist({ x: numAt(xs, a), z: numAt(zs, a) }, { x: numAt(xs, b), z: numAt(zs, b) }));
          }
        }
        out.push({
          foot,
          kind,
          startFrame: idxAt(piece, 0),
          endFrame: idxAt(piece, piece.length - 1),
          nFrames: piece.length,
          spanBaseM: spanBase,
          spanPairM: spanPair,
          floorM: floor,
          phaseAtStart: input.phaseAt ? input.phaseAt(idxAt(piece, 0)) : null,
        });
      }
      piece = [];
    };
    for (let k = 1; k < run.length; k += 1) {
      const a = idxAt(run, k - 1);
      const b = idxAt(run, k);
      const dt = numAt(times, b) - numAt(times, a);
      const step = xzDist({ x: numAt(xs, a), z: numAt(zs, a) }, { x: numAt(xs, b), z: numAt(zs, b) });
      if (dt > 0 && step <= speedMps * dt + 1e-12) {
        piece.push(b);
      } else {
        flush();
        piece = [b];
      }
    }
    flush();
  }
  return out;
}

function orderOf(hs: number, ff: number, ho: number, to: number): StanceEvents["violatedAt"] {
  if (!(hs < ff)) return "heelStrike<footFlat";
  if (!(ff < ho)) return "footFlat<heelOff";
  if (!(ho < to)) return "heelOff<toeOff";
  return null;
}

export type RunAudit = {
  tag: string;
  sourceFile: string;
  nFrames: number;
  floorM: { leftHeel: number | null; rightHeel: number | null; leftToe: number | null; rightToe: number | null };
  heelPlants: MarkerPlant[];
  toePlants: MarkerPlant[];
  stances: StanceEvents[];
  unpairedHeelPlants: MarkerPlant[];
  maxHeelSpanM: number | null;
  violationRate: number | null;
  walkingStances: number;
};

function toeOf(f: HeelAuditFrame, foot: Side): Vec3 | null {
  return foot === "left" ? f.leftToe : f.rightToe;
}

function heelOf(f: HeelAuditFrame, foot: Side): Vec3 | null {
  const key = foot === "left" ? "heelL" : "heelR";
  return f.legWorlds?.[key] ?? null;
}

function floorOf(frames: HeelAuditFrame[], pick: (f: HeelAuditFrame) => Vec3 | null): number | null {
  let min: number | null = null;
  for (const f of frames) {
    const p = pick(f);
    if (p === null || !Number.isFinite(p.y)) continue;
    if (min === null || p.y < min) min = p.y;
  }
  return min;
}

export function computeRunAudit(tag: string, sourceFile: string, frames: HeelAuditFrame[]): RunAudit {
  const n = frames.length;
  const times = frames.map((_, i) => i / CAPTURE_FPS);
  const heelPlants: MarkerPlant[] = [];
  const toePlants: MarkerPlant[] = [];
  const floorM: RunAudit["floorM"] = { leftHeel: null, rightHeel: null, leftToe: null, rightToe: null };
  for (const foot of ["left", "right"] as const) {
    const hx = frames.map((f) => heelOf(f, foot)?.x ?? NaN);
    const hz = frames.map((f) => heelOf(f, foot)?.z ?? NaN);
    const hy = frames.map((f) => heelOf(f, foot)?.y ?? NaN);
    const tx = frames.map((f) => toeOf(f, foot)?.x ?? NaN);
    const tz = frames.map((f) => toeOf(f, foot)?.z ?? NaN);
    const ty = frames.map((f) => toeOf(f, foot)?.y ?? NaN);
    const hFloor = floorOf(frames, (f) => heelOf(f, foot));
    const tFloor = floorOf(frames, (f) => toeOf(f, foot));
    if (foot === "left") {
      floorM.leftHeel = hFloor;
      floorM.leftToe = tFloor;
    } else {
      floorM.rightHeel = hFloor;
      floorM.rightToe = tFloor;
    }
    if (hFloor !== null) {
      heelPlants.push(
        ...detectMarkerPlants({
          xs: hx, zs: hz, ys: hy, times, foot, kind: "heel",
          phaseAt: (i) => frames[i]?.phase ?? null,
        }),
      );
    }
    if (tFloor !== null) {
      toePlants.push(
        ...detectMarkerPlants({
          xs: tx, zs: tz, ys: ty, times, foot, kind: "toe",
          phaseAt: (i) => frames[i]?.phase ?? null,
        }),
      );
    }
  }
  heelPlants.sort((a, b) => a.startFrame - b.startFrame);
  toePlants.sort((a, b) => a.startFrame - b.startFrame);

  const heelStrikesByFoot = new Map<Side, number[]>();
  for (const foot of ["left", "right"] as const) {
    heelStrikesByFoot.set(
      foot,
      heelPlants.filter((p) => p.foot === foot).map((p) => p.startFrame).sort((a, b) => a - b),
    );
  }

  const stances: StanceEvents[] = [];
  const unpairedHeelPlants: MarkerPlant[] = [];
  for (const hp of heelPlants) {
    const cands = toePlants.filter(
      (cand) => cand.foot === hp.foot && cand.startFrame <= hp.endFrame && hp.startFrame <= cand.endFrame,
    );
    if (cands.length === 0) {
      unpairedHeelPlants.push(hp);
      continue;
    }
    cands.sort((a, b) => {
      const overlapA = Math.min(hp.endFrame, a.endFrame) - Math.max(hp.startFrame, a.startFrame);
      const overlapB = Math.min(hp.endFrame, b.endFrame) - Math.max(hp.startFrame, b.startFrame);
      if (overlapB !== overlapA) return overlapB - overlapA;
      return a.startFrame - b.startFrame;
    });
    const tp = cands[0];
    if (tp === undefined) continue;
    const hs = hp.startFrame;
    const ff = tp.startFrame;
    const ho = hp.endFrame;
    const to = tp.endFrame;
    const violatedAt = orderOf(hs, ff, ho, to);
    const strikes = heelStrikesByFoot.get(hp.foot) ?? [];
    const pos = strikes.indexOf(hs);
    const next = pos >= 0 && pos + 1 < strikes.length ? (strikes[pos + 1] ?? null) : null;
    const frac = (e: number): number | null => (next === null ? null : (e - hs) / (next - hs));
    stances.push({
      foot: hp.foot,
      heelStrike: hs,
      footFlat: ff,
      heelOff: ho,
      toeOff: to,
      orderOk: violatedAt === null,
      violatedAt,
      cycleStart: hs,
      cycleEnd: next,
      fracHeelStrike: frac(hs),
      fracFootFlat: frac(ff),
      fracHeelOff: frac(ho),
      fracToeOff: frac(to),
    });
  }
  stances.sort((a, b) => a.heelStrike - b.heelStrike);
  const maxHeelSpanM =
    heelPlants.length === 0 ? null : Math.max(...heelPlants.map((p) => p.spanPairM));
  const violated = stances.filter((s) => !s.orderOk).length;
  return {
    tag,
    sourceFile,
    nFrames: n,
    floorM,
    heelPlants,
    toePlants,
    stances,
    unpairedHeelPlants,
    maxHeelSpanM,
    violationRate: stances.length === 0 ? null : violated / stances.length,
    walkingStances: stances.filter((s) => frames[s.heelStrike]?.phase === "walking").length,
  };
}

export type RouteDecision = {
  route: string;
  nRuns: number;
  nHeelPlants: number;
  nStances: number;
  nUnpairedHeelPlants: number;
  nWalkingStances: number;
  maxHeelSpanM: number | null;
  violationRate: number | null;
  spanPass: boolean;
  orderPass: boolean;
  pass: boolean;
};

export function decideRoute(route: string, runs: RunAudit[]): RouteDecision {
  const heelSpans = runs.flatMap((r) => r.heelPlants.map((p) => p.spanPairM));
  const stances = runs.flatMap((r) => r.stances);
  const violated = stances.filter((s) => !s.orderOk).length;
  const maxHeelSpanM = heelSpans.length === 0 ? null : Math.max(...heelSpans);
  const violationRate = stances.length === 0 ? null : violated / stances.length;
  // No plant over the bar: a run with no plants contributes no span evidence
  // (reported via nHeelPlants, not hidden). No stances: 0 % violated.
  const spanPass = maxHeelSpanM === null || maxHeelSpanM <= KOVAR_SPAN_M;
  const orderPass = violationRate === null || violationRate <= ORDER_VIOLATION_BAR;
  return {
    route,
    nRuns: runs.length,
    nHeelPlants: heelSpans.length,
    nStances: stances.length,
    nUnpairedHeelPlants: runs.reduce((s, r) => s + r.unpairedHeelPlants.length, 0),
    nWalkingStances: runs.reduce((s, r) => s + r.walkingStances, 0),
    maxHeelSpanM,
    violationRate,
    spanPass,
    orderPass,
    pass: spanPass && orderPass,
  };
}

export type BoundAudit = {
  glb: string;
  clip: string;
  actorScale: number;
  loopDurationS: number;
  nLoopSamples: number;
  floorM: { leftHeel: number | null; rightHeel: number | null; leftToe: number | null; rightToe: number | null };
  heelPlants: MarkerPlant[];
  toePlants: MarkerPlant[];
  stances: StanceEvents[];
  unpairedHeelPlants: MarkerPlant[];
  maxHeelSpanM: number | null;
  violationRate: number | null;
};

export async function computeBoundAudit(glb: string, clip: string): Promise<BoundAudit> {
  const perSide: Record<Side, { heelPlants: MarkerPlant[]; toePlants: MarkerPlant[] }> = {
    left: { heelPlants: [], toePlants: [] },
    right: { heelPlants: [], toePlants: [] },
  };
  const floorM: BoundAudit["floorM"] = { leftHeel: null, rightHeel: null, leftToe: null, rightToe: null };
  let loopDurationS = 0;
  let nLoopSamples = 0;
  for (const side of ["left", "right"] as const) {
    const sfx = side === "left" ? ".L" : ".R";
    const [heelT, toeT] = await Promise.all([
      boundClipJointTrack({ glbPath: glb, clipName: clip, boneName: `foot${sfx}` }),
      boundClipJointTrack({ glbPath: glb, clipName: clip, boneName: `toe1-1${sfx}` }),
    ]);
    const nLoop = heelT.samples.length;
    nLoopSamples = nLoop;
    const t0 = heelT.frameTimesMs.map((t) => t / 1000);
    const loopS = numAt(t0, nLoop - 1) - numAt(t0, 0) + (nLoop > 1 ? numAt(t0, 1) - numAt(t0, 0) : 0);
    loopDurationS = loopS;
    const loopIdx = (i: number): number => ((i % nLoop) + nLoop) % nLoop;
    for (const [kind, track] of [["heel", heelT], ["toe", toeT]] as const) {
      const xs1 = track.samples.map((s) => s.position.x * BOUND_ACTOR_SCALE);
      const zs1 = track.samples.map((s) => s.position.z * BOUND_ACTOR_SCALE);
      const ys1 = track.samples.map((s) => s.position.y * BOUND_ACTOR_SCALE);
      const xs = [...xs1, ...xs1];
      const zs = [...zs1, ...zs1];
      const ys = [...ys1, ...ys1];
      const times = [...t0, ...t0.map((t) => t + loopS)];
      const found = detectMarkerPlants({ xs, zs, ys, times, foot: side, kind });
      // Fold loop-second-half duplicates back; keep the first occurrence.
      const seen = new Set<string>();
      for (const p of found) {
        const a = loopIdx(p.startFrame);
        const b = loopIdx(p.endFrame);
        const key = `${side}:${kind}:${a}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        perSide[side][kind === "heel" ? "heelPlants" : "toePlants"].push({ ...p, startFrame: a, endFrame: b });
      }
      const loopFloor = Math.min(...ys1.filter((y) => Number.isFinite(y)));
      if (kind === "heel") {
        if (side === "left") floorM.leftHeel = loopFloor;
        else floorM.rightHeel = loopFloor;
      } else {
        if (side === "left") floorM.leftToe = loopFloor;
        else floorM.rightToe = loopFloor;
      }
    }
  }
  const heelPlants = [...perSide.left.heelPlants, ...perSide.right.heelPlants].sort(
    (a, b) => a.startFrame - b.startFrame,
  );
  const toePlants = [...perSide.left.toePlants, ...perSide.right.toePlants].sort(
    (a, b) => a.startFrame - b.startFrame,
  );
  // Pairing + order on loop-sample indices; fractions over the loop duration.
  const strikesByFoot = new Map<Side, number[]>();
  for (const foot of ["left", "right"] as const) {
    strikesByFoot.set(
      foot,
      heelPlants.filter((p) => p.foot === foot).map((p) => p.startFrame).sort((a, b) => a - b),
    );
  }
  const stances: StanceEvents[] = [];
  const unpairedHeelPlants: MarkerPlant[] = [];
  for (const hp of heelPlants) {
    const cands = toePlants.filter(
      (cand) => cand.foot === hp.foot && cand.startFrame <= hp.endFrame && hp.startFrame <= cand.endFrame,
    );
    if (cands.length === 0) {
      unpairedHeelPlants.push(hp);
      continue;
    }
    cands.sort((a, b) => {
      const overlapA = Math.min(hp.endFrame, a.endFrame) - Math.max(hp.startFrame, a.startFrame);
      const overlapB = Math.min(hp.endFrame, b.endFrame) - Math.max(hp.startFrame, b.startFrame);
      if (overlapB !== overlapA) return overlapB - overlapA;
      return a.startFrame - b.startFrame;
    });
    const boundTp = cands[0];
    if (boundTp === undefined) continue;
    const violatedAt = orderOf(hp.startFrame, boundTp.startFrame, hp.endFrame, boundTp.endFrame);
    stances.push({
      foot: hp.foot,
      heelStrike: hp.startFrame,
      footFlat: boundTp.startFrame,
      heelOff: hp.endFrame,
      toeOff: boundTp.endFrame,
      orderOk: violatedAt === null,
      violatedAt,
      cycleStart: hp.startFrame,
      cycleEnd: null,
      fracHeelStrike: 0,
      fracFootFlat: loopDurationS > 0 ? (boundTp.startFrame - hp.startFrame) / nLoopSamples : null,
      fracHeelOff: loopDurationS > 0 ? (hp.endFrame - hp.startFrame) / nLoopSamples : null,
      fracToeOff: loopDurationS > 0 ? (boundTp.endFrame - hp.startFrame) / nLoopSamples : null,
    });
  }
  const maxHeelSpanM = heelPlants.length === 0 ? null : Math.max(...heelPlants.map((p) => p.spanPairM));
  const violated = stances.filter((s) => !s.orderOk).length;
  return {
    glb,
    clip,
    actorScale: BOUND_ACTOR_SCALE,
    loopDurationS,
    nLoopSamples,
    floorM,
    heelPlants,
    toePlants,
    stances,
    unpairedHeelPlants,
    maxHeelSpanM,
    violationRate: stances.length === 0 ? null : violated / stances.length,
  };
}

function routeFromArgv(): Array<{ name: string; dir: string }> {
  const pairs = process.argv
    .filter((a) => a.startsWith("--route="))
    .map((a) => a.slice("--route=".length));
  if (pairs.length === 0) throw new Error("usage: heel-audit.ts --route=name:dir [--route=name:dir] --out=measure.json");
  return pairs.map((p) => {
    const cut = p.indexOf(":");
    if (cut < 0) throw new Error(`bad --route=${p}, want name:dir`);
    return { name: p.slice(0, cut), dir: p.slice(cut + 1) };
  });
}

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

export type HeelAuditMeasure = {
  schemaVersion: string;
  measuredAt: string;
  definition: string;
  bars: { spanM: number; orderViolationShare: number };
  routes: Record<string, { runs: RunAudit[]; decision: RouteDecision }>;
  bound: BoundAudit;
  boundDecision: { maxHeelSpanM: number | null; spanPass: boolean };
  decision: { pass: boolean; reason: string };
};

async function readRuns(dir: string): Promise<Array<{ file: string; frames: HeelAuditFrame[] }>> {
  const files = (await readdir(dir))
    .filter((f) => /^sc05-run\d+\.json$/.test(f))
    .sort();
  const out: Array<{ file: string; frames: HeelAuditFrame[] }> = [];
  for (const f of files) {
    const run = JSON.parse(await readFile(path.join(dir, f), "utf8")) as { frames?: HeelAuditFrame[] };
    if (!Array.isArray(run.frames)) continue;
    out.push({ file: f, frames: run.frames });
  }
  return out;
}

async function main(): Promise<void> {
  const routes = routeFromArgv();
  const outPath = arg("out");
  if (!outPath) throw new Error("usage: heel-audit.ts --route=name:dir --out=measure.json");
  const boundGlb = arg("bound-glb") ?? "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
  const clip = arg("clip") ?? "openclinxr_retarget_walk_source";
  const grouped = new Map<string, string[]>();
  for (const r of routes) {
    const list = grouped.get(r.name) ?? [];
    list.push(r.dir);
    grouped.set(r.name, list);
  }
  const routeResults: HeelAuditMeasure["routes"] = {};
  for (const [name, dirs] of grouped) {
    const runs: RunAudit[] = [];
    for (const dir of dirs) {
      // Tag carries the full dir string: different dirs may share a basename
      // (e.g. sc05 and after7/sc05), and tags must stay unique.
      for (const run of await readRuns(dir)) {
        runs.push(computeRunAudit(`${name}:${dir}:${run.file.replace(/\.json$/, "")}`, run.file, run.frames));
      }
    }
    runs.sort((a, b) => (a.tag < b.tag ? -1 : 1));
    process.stdout.write(`[${name}] ${runs.length} runs, ${runs.reduce((s, r) => s + r.heelPlants.length, 0)} heel plants, ${runs.reduce((s, r) => s + r.stances.length, 0)} stances\n`);
    for (const r of runs) {
      const spans = r.heelPlants.map((p) => `${p.foot}[${p.startFrame},${p.endFrame}]:${(p.spanPairM * 1000).toFixed(2)}mm`).join(" ");
      const orders = r.stances.map((s) => `${s.foot} hs=${s.heelStrike} ff=${s.footFlat} ho=${s.heelOff} to=${s.toeOff} ${s.orderOk ? "OK" : `VIOL@${s.violatedAt}`}`).join(" | ");
      process.stdout.write(
        `  ${r.tag}: maxSpan=${r.maxHeelSpanM === null ? "n/a" : `${(r.maxHeelSpanM * 1000).toFixed(2)}mm`} ` +
          `viol=${r.violationRate === null ? "n/a" : r.violationRate.toFixed(2)} walkingStances=${r.walkingStances} unpaired=${r.unpairedHeelPlants.length}\n` +
          `    heels: ${spans || "none"}\n` +
          `    stances: ${orders || "none"}\n`,
      );
    }
    routeResults[name] = { runs, decision: decideRoute(name, runs) };
  }
  const bound = await computeBoundAudit(boundGlb, clip);
  process.stdout.write(
    `[bound] loop=${bound.loopDurationS.toFixed(3)}s heelPlants=${bound.heelPlants.length} stances=${bound.stances.length} maxSpan=${bound.maxHeelSpanM === null ? "n/a" : `${(bound.maxHeelSpanM * 1000).toFixed(2)}mm`}\n`,
  );
  const boundSpanPass = bound.maxHeelSpanM === null || bound.maxHeelSpanM <= KOVAR_SPAN_M;
  const routePasses = Object.values(routeResults).map((r) => r.decision);
  const allPass = routePasses.every((d) => d.pass) && boundSpanPass;
  const failing = routePasses.filter((d) => !d.pass).map((d) => d.route);
  if (!boundSpanPass) failing.push("bound");
  const result: HeelAuditMeasure = {
    schemaVersion: "openclinxr.heel-audit.v1",
    measuredAt: new Date().toISOString(),
    definition: HEEL_AUDIT_DEFINITION,
    bars: { spanM: KOVAR_SPAN_M, orderViolationShare: ORDER_VIOLATION_BAR },
    routes: routeResults,
    bound,
    boundDecision: { maxHeelSpanM: bound.maxHeelSpanM, spanPass: boundSpanPass },
    decision: {
      pass: allPass,
      reason: allPass
        ? "every route: max heel span <= 0.010 m and order violations <= 10 % of stances; bound clip span clean"
        : `FAIL: ${failing.join(", ")}`,
    },
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`wrote ${outPath} decision=${allPass ? "PASS" : "FAIL"}\n`);
  if (!allPass) process.exitCode = 1;
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("heel-audit.ts");

if (invokedAsScript) {
  await main();
}
