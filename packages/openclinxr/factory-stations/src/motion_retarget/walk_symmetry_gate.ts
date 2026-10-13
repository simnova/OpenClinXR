/**
 * Retarget-station symmetry gate for walk clips (slice 2, locomotion plan).
 *
 * ONE reusable module imported by the walk-clip census CLI and by the motion-retarget
 * station runner (run.ts, optional post-bind gate). Reports per-clip gait symmetry plus
 * a pass/fail verdict against fixed bars, on source and bound clips alike.
 *
 * Bars (provenance in GATE_BARS): stride and step-duration asymmetry <= 5 %, thigh ROM
 * asymmetry <= 10 %, duty 0.55-0.65 per foot (two-consultant review 2026-10-12); toe lift
 * >= 0.06 m and ankle lift >= 0.10 m (walk-clip brief; shipped control 0.03 m); loop seam
 * pose error < 1 deg; loop root drift < 0.01 m; arm swing >= 10 deg.
 *
 * Contact definition matches the proving ground: toe height within 0.06 m (the production
 * constant) of the clip's own floor.
 *
 * claimScope: offline symmetry measurement of one GLB clip. notEvidenceFor: gait realism,
 * clinical plausibility, runtime playback, Quest readiness.
 */

import { MESHMOTION_WALK_JOINTS, MPFB_WALK_JOINTS, sampleWalkClip, slerpUnit } from "./walk_gait_sample.js";
import type { Quat, Vec3, WalkGateJoints, WalkSample } from "./walk_gait_sample.js";

export type { Quat, Vec3, WalkGateJoints, WalkSample };
export { MESHMOTION_WALK_JOINTS, MPFB_WALK_JOINTS, sampleWalkClip };

export type GateBarId =
  | "stride-asymmetry"
  | "step-duration-asymmetry"
  | "thigh-rom-asymmetry"
  | "duty-range"
  | "toe-lift"
  | "ankle-lift"
  | "seam-error"
  | "root-drift"
  | "arm-swing";

export const GATE_BARS: Record<GateBarId, { threshold: string; provenance: string }> = {
  "stride-asymmetry": { threshold: "<= 5 %", provenance: "two-consultant review 2026-10-12" },
  "step-duration-asymmetry": { threshold: "<= 5 %", provenance: "two-consultant review 2026-10-12" },
  "thigh-rom-asymmetry": { threshold: "<= 10 %", provenance: "two-consultant review 2026-10-12" },
  "duty-range": { threshold: "0.55-0.65 per foot", provenance: "two-consultant review 2026-10-12" },
  "toe-lift": { threshold: ">= 0.06 m per foot", provenance: "walk-clip brief (control 0.03 m)" },
  "ankle-lift": { threshold: ">= 0.10 m per foot", provenance: "walk-clip brief (control 0.03 m)" },
  "seam-error": { threshold: "< 1 deg", provenance: "walk-clip census brief" },
  "root-drift": { threshold: "< 0.01 m", provenance: "walk-clip census brief" },
  "arm-swing": { threshold: ">= 10 deg per side", provenance: "walk-clip census brief" },
};

export type WalkGateBarResult = { id: GateBarId; pass: boolean; detail: string };

export type WalkGateFootMetrics = {
  duty: number;
  strideM: number;
  stepDurationS: number;
  swingToeMaxM: number;
  swingAnkleMaxM: number;
  naturalSpeedMps: number;
  contactWindows: number;
};

export type WalkGateReport = {
  provenance: { glb: string; clip: string; sha256: string; frames: number; durationS: number };
  foot: { left: WalkGateFootMetrics; right: WalkGateFootMetrics };
  strideAsymmetryPct: number;
  stepDurationAsymmetryPct: number;
  thighRomDeg: { left: number; right: number; asymmetryPct: number };
  kneeRomDeg: { left: number; right: number };
  ankleRomDeg: { left: number; right: number };
  pelvisLateralRangeM: number;
  armSwingDeg: { left: number; right: number };
  seamErrorDeg: number;
  seamWorstJoint: string;
  rootDriftM: number;
  cadenceSpm: number;
  bars: WalkGateBarResult[];
  pass: boolean;
};

const CONTACT_BAND_M = 0.06;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / (values.length || 1);
}

function asymPct(left: number, right: number): number {
  const denom = (Math.abs(left) + Math.abs(right)) / 2;
  return denom === 0 ? 0 : (Math.abs(left - right) / denom) * 100;
}

function vecAngleDeg(a: Vec3, b: Vec3): number {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (la === 0 || lb === 0) return 0;
  const c = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Joint angle in degrees, normalising first (non-unit quats otherwise read as motion). */
function quatAngleDeg(a: Quat, b: Quat): number {
  const na = Math.hypot(a[0], a[1], a[2], a[3]);
  const nb = Math.hypot(b[0], b[1], b[2], b[3]);
  if (!(na > 0) || !(nb > 0)) return Number.NaN;
  const dot = Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (na * nb));
  return ((2 * Math.acos(Math.min(1, dot))) * 180) / Math.PI;
}

/** Max pairwise angle of a segment direction over the clip (peak-to-peak ROM diameter). */
function segmentDiameter(track: Vec3[]): number {
  let worst = 0;
  for (let i = 0; i < track.length; i += 1) {
    for (let j = i + 1; j < track.length; j += 1) {
      const d = vecAngleDeg(track[i]!, track[j]!);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function midTracks(a: Vec3[], b: Vec3[]): Vec3[] {
  return a.map((p, i) => [(p[0] + b[i]![0]) / 2, (p[1] + b[i]![1]) / 2, (p[2] + b[i]![2]) / 2] as Vec3);
}

function measureFoot(toe: Vec3[], ankle: Vec3[], root: Vec3[], times: number[], floorY: number): WalkGateFootMetrics {
  const n = times.length;
  const inContact = toe.map((p) => p[1] - floorY <= CONTACT_BAND_M);
  const strikes: number[] = [];
  const wins: Array<{ s: number; e: number }> = [];
  let i = 0;
  while (i < n) {
    if (!inContact[i]) {
      i += 1;
      continue;
    }
    let e = i;
    while (e + 1 < n && inContact[e + 1]) e += 1;
    wins.push({ s: i, e });
    i = e + 1;
  }
  // Looped clip: a window touching the last frame continues into frame 0; index 0 then
  // counts as a heel strike rather than a second window.
  const wraps = inContact[0] === true && inContact[n - 1] === true;
  for (const w of wins) {
    if (w.s > 0 || !wraps) strikes.push(w.s);
  }
  const clipSpan = times[n - 1]! - times[0]!;
  const stepDurationS = strikes.length > 0 ? clipSpan / strikes.length : clipSpan;
  const contactTotal = wins.reduce((a, w) => a + (times[w.e]! - times[w.s]!), 0);
  const duty = clipSpan > 0 ? contactTotal / clipSpan : Number.NaN;
  const strides: number[] = [];
  for (const w of wins) {
    if (w.e - w.s < 2) continue;
    const ax = toe[w.s]![0] - root[w.s]![0];
    const az = toe[w.s]![2] - root[w.s]![2];
    const bx = toe[w.e]![0] - root[w.e]![0];
    const bz = toe[w.e]![2] - root[w.e]![2];
    strides.push(Math.hypot(bx - ax, bz - az));
  }
  const strideM = strides.length > 0 ? mean(strides) : Number.NaN;
  let swingToeMax = -Infinity;
  let swingAnkleMax = -Infinity;
  for (let j = 0; j < n; j += 1) {
    if (inContact[j]) continue;
    swingToeMax = Math.max(swingToeMax, toe[j]![1] - floorY);
    swingAnkleMax = Math.max(swingAnkleMax, ankle[j]![1] - floorY);
  }
  return {
    duty,
    strideM,
    stepDurationS,
    swingToeMaxM: swingToeMax === -Infinity ? Number.NaN : swingToeMax,
    swingAnkleMaxM: swingAnkleMax === -Infinity ? Number.NaN : swingAnkleMax,
    naturalSpeedMps: stepDurationS > 0 ? strideM / stepDurationS : Number.NaN,
    contactWindows: wins.length,
  };
}

/** Pure gate: metrics plus one verdict per bar from an already-sampled clip. */
export function evaluateWalkSymmetry(sample: WalkSample, joints: WalkGateJoints): Omit<WalkGateReport, "provenance"> {
  const s = joints.scale;
  const P = (name: string): Vec3[] => sample.pos[name]!.map((p) => [p[0] * s, p[1] * s, p[2] * s] as Vec3);
  const pelvis = joints.hips.length === 2 ? midTracks(P(joints.hips[0]!), P(joints.hips[1]!)) : P(joints.hips[0]!);
  const root = P(joints.root);
  const toeL = P(joints.toeL);
  const toeR = P(joints.toeR);
  const floorY = Math.min(...toeL.map((p) => p[1]), ...toeR.map((p) => p[1]));
  const left = measureFoot(toeL, P(joints.ankleL), root, sample.times, floorY);
  const right = measureFoot(toeR, P(joints.ankleR), root, sample.times, floorY);

  const hipL = joints.hips.length === 2 ? P(joints.hips[0]!) : pelvis;
  const hipR = joints.hips.length === 2 ? P(joints.hips[1]!) : pelvis;
  const thighDir = (knee: Vec3[], hip: Vec3[]): Vec3[] => knee.map((k, j) => sub3(k, hip[j]!));
  const thighRomL = segmentDiameter(thighDir(P(joints.kneeL), hipL));
  const thighRomR = segmentDiameter(thighDir(P(joints.kneeR), hipR));
  const jointRange = (prox: Vec3[], mid: Vec3[], dist: Vec3[], flex: boolean): number => {
    const series = prox.map((p, j) => {
      const a = vecAngleDeg(sub3(p, mid[j]!), sub3(dist[j]!, mid[j]!));
      return flex ? 180 - a : a;
    });
    return Math.max(...series) - Math.min(...series);
  };
  const kneeL = jointRange(P(joints.thighL), P(joints.kneeL), P(joints.ankleL), true);
  const kneeR = jointRange(P(joints.thighR), P(joints.kneeR), P(joints.ankleR), true);
  const ankleL = jointRange(P(joints.kneeL), P(joints.ankleL), toeL, false);
  const ankleR = jointRange(P(joints.kneeR), P(joints.ankleR), toeR, false);

  // Travel basis: net toe-travel direction when the clip travels, else the horizontal
  // axis the pelvis moves least along (in-place cycles have ~zero net travel).
  const dirL = sub3(toeL[toeL.length - 1]!, toeL[0]!);
  const dirR = sub3(toeR[toeR.length - 1]!, toeR[0]!);
  const mx = (dirL[0] + dirR[0]) / 2;
  const mz = (dirL[2] + dirR[2]) / 2;
  const ml = Math.hypot(mx, mz);
  const pxs = pelvis.map((p) => p[0]);
  const pzs = pelvis.map((p) => p[2]);
  const rangeX = Math.max(...pxs) - Math.min(...pxs);
  const rangeZ = Math.max(...pzs) - Math.min(...pzs);
  const lateral: Vec3 = ml > 1e-4 ? [-mz / ml, 0, mx / ml] : rangeX < rangeZ ? [1, 0, 0] : [0, 0, 1];
  const latSeries = pelvis.map((p) => p[0] * lateral[0]! + p[2] * lateral[2]!);
  const pelvisLateralRangeM = Math.max(...latSeries) - Math.min(...latSeries);

  const shoulderL = P(joints.shoulderL);
  const shoulderR = P(joints.shoulderR);
  const armL = segmentDiameter(P(joints.elbowL).map((e, j) => sub3(e, shoulderL[j]!)));
  const armR = segmentDiameter(P(joints.elbowR).map((e, j) => sub3(e, shoulderR[j]!)));

  // Seam: extrapolate each joint one frame past the end, compare angle to frame 0.
  const n = sample.times.length;
  let seamErrorDeg = 0;
  let seamWorstJoint = "";
  for (const name of Object.keys(sample.quat)) {
    const track = sample.quat[name]!;
    const err = quatAngleDeg(slerpUnit(track[n - 2]!, track[n - 1]!, 2), track[0]!);
    if (!(err >= 0)) continue;
    if (err > seamErrorDeg) {
      seamErrorDeg = err;
      seamWorstJoint = name;
    }
  }
  const rootDriftM = Math.hypot(root[n - 1]![0] - root[0]![0], root[n - 1]![1] - root[0]![1], root[n - 1]![2] - root[0]![2]);
  const cycleS = (left.stepDurationS + right.stepDurationS) / 2;
  const cadenceSpm = cycleS > 0 ? 120 / cycleS : Number.NaN;

  const strideAsymmetryPct = asymPct(left.strideM, right.strideM);
  const stepDurationAsymmetryPct = asymPct(left.stepDurationS, right.stepDurationS);
  const thighAsymmetryPct = asymPct(thighRomL, thighRomR);
  const fix = (v: number, d = 3): string => (Number.isNaN(v) ? "n/a" : v.toFixed(d));
  const bars: WalkGateBarResult[] = [
    { id: "stride-asymmetry", pass: strideAsymmetryPct <= 5, detail: `${fix(strideAsymmetryPct, 1)} % (L ${fix(left.strideM)} / R ${fix(right.strideM)} m)` },
    { id: "step-duration-asymmetry", pass: stepDurationAsymmetryPct <= 5, detail: `${fix(stepDurationAsymmetryPct, 1)} % (L ${fix(left.stepDurationS)} / R ${fix(right.stepDurationS)} s)` },
    { id: "thigh-rom-asymmetry", pass: thighAsymmetryPct <= 10, detail: `${fix(thighAsymmetryPct, 1)} % (L ${fix(thighRomL, 1)} / R ${fix(thighRomR, 1)} deg)` },
    { id: "duty-range", pass: left.duty >= 0.55 && left.duty <= 0.65 && right.duty >= 0.55 && right.duty <= 0.65, detail: `L ${fix(left.duty, 2)} / R ${fix(right.duty, 2)}` },
    { id: "toe-lift", pass: left.swingToeMaxM >= 0.06 && right.swingToeMaxM >= 0.06, detail: `L ${fix(left.swingToeMaxM)} / R ${fix(right.swingToeMaxM)} m` },
    { id: "ankle-lift", pass: left.swingAnkleMaxM >= 0.1 && right.swingAnkleMaxM >= 0.1, detail: `L ${fix(left.swingAnkleMaxM)} / R ${fix(right.swingAnkleMaxM)} m` },
    { id: "seam-error", pass: seamErrorDeg < 1, detail: `${fix(seamErrorDeg, 2)} deg worst ${seamWorstJoint || "none"}` },
    { id: "root-drift", pass: rootDriftM < 0.01, detail: `${fix(rootDriftM, 4)} m` },
    { id: "arm-swing", pass: armL >= 10 && armR >= 10, detail: `L ${fix(armL, 1)} / R ${fix(armR, 1)} deg` },
  ];
  return {
    foot: { left, right },
    strideAsymmetryPct,
    stepDurationAsymmetryPct,
    thighRomDeg: { left: thighRomL, right: thighRomR, asymmetryPct: thighAsymmetryPct },
    kneeRomDeg: { left: kneeL, right: kneeR },
    ankleRomDeg: { left: ankleL, right: ankleR },
    pelvisLateralRangeM,
    armSwingDeg: { left: armL, right: armR },
    seamErrorDeg,
    seamWorstJoint,
    rootDriftM,
    cadenceSpm,
    bars,
    pass: bars.every((b) => b.pass),
  };
}

/** Full gate: sample one GLB clip and evaluate it. */
export async function gateWalkClip(input: {
  glbPath: string;
  clipName: string;
  joints: WalkGateJoints;
}): Promise<WalkGateReport> {
  const { sample, frames, durationS, sha256 } = await sampleWalkClip(input);
  return {
    provenance: { glb: input.glbPath, clip: input.clipName, sha256, frames, durationS },
    ...evaluateWalkSymmetry(sample, input.joints),
  };
}
