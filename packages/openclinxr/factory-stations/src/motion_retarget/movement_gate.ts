/**
 * Movement-agnostic source-vs-bound retarget gate.
 *
 * The walk symmetry gate (walk_symmetry_gate.ts) keeps the gait-specific bars
 * (stride, step duration, duty, thigh asymmetry, lifts, arm swing) as a layer over
 * the generic single-clip primitives here (loop seam, root drift, quaternion norm)
 * plus the source-vs-bound range-of-motion fidelity bar. Any looping or one-shot
 * movement (turn, sit-to-stand, reach, another actor) reuses these bars; only the
 * gait layer is walk-specific.
 *
 * Bars (provenance in MOVEMENT_GATE_BARS): per-joint rotation-range ratio within
 * 15 % (shipped Walk source-vs-bound control: thigh <= 2.1 %, arms <= 7.6 %,
 * docs/openclinxr/locomotion/walk-clip-census-2026-10-12.md); bound loop seam within
 * source seam + 1 deg (bind preserves the seam class 4.34/4.34 deg, same report);
 * bound root drift < 0.01 m (walk-clip census brief, same bar as the walk gate);
 * quaternion |norm - 1| <= 1e-3 on every sample (turn-leg-quaternion-norm-2026-10-12.md:
 * three.js composes |q|^2 scale into the bones).
 *
 * claimScope: offline bind-fidelity measurement of two GLB clips. notEvidenceFor:
 * gait realism, clinical plausibility, runtime playback, Quest readiness.
 */

import { slerpUnit } from "./walk_gait_sample.js";
import type { Quat, WalkSample } from "./walk_gait_sample.js";

/** Identifiers of the four movement-agnostic bind-fidelity bars. */
export type MovementGateBarId = "rom-fidelity" | "loop-seam" | "root-drift" | "quaternion-norm";

/** Fixed gate thresholds with the provenance of each bar. */
export const MOVEMENT_GATE_BARS: Record<MovementGateBarId, { threshold: string; provenance: string }> = {
  "rom-fidelity": {
    threshold: "bound/source rotation range within 15 % per joint",
    provenance: "shipped Walk control thigh <= 2.1 %, arms <= 7.6 % (docs/openclinxr/locomotion/walk-clip-census-2026-10-12.md)",
  },
  "loop-seam": {
    threshold: "bound seam <= source seam + 1 deg",
    provenance: "bind preserves seam class 4.34/4.34 deg (docs/openclinxr/locomotion/walk-clip-census-2026-10-12.md)",
  },
  "root-drift": {
    threshold: "< 0.01 m",
    provenance: "walk-clip census brief (same bar as the walk gate)",
  },
  "quaternion-norm": {
    threshold: "|norm - 1| <= 1e-3 every sample",
    provenance: "docs/openclinxr/locomotion/turn-leg-quaternion-norm-2026-10-12.md",
  },
};

/** One bar verdict: which bar, whether it passed, and the measured detail string. */
export type MovementGateBarResult = { id: MovementGateBarId; pass: boolean; detail: string };

/** One compared joint: its name in the source rig and in the bound rig. */
export type MovementGateJointPair = { source: string; bound: string };

/** Full generic gate report: per-bar verdicts plus the underlying numbers. */
export type MovementGateReport = {
  provenance: { sourceGlb: string; sourceClip: string; boundGlb: string; boundClip: string };
  looping: boolean;
  /** Per-pair bound/source rotation-range ratio (1 = preserved). */
  romRatios: Array<{ source: string; bound: string; sourceDeg: number; boundDeg: number; ratio: number }>;
  worstRomDeviationPct: number;
  sourceSeamDeg: number;
  boundSeamDeg: number;
  sourceRootDriftM: number;
  boundRootDriftM: number;
  worstNormDeviation: number;
  bars: MovementGateBarResult[];
  pass: boolean;
};

const ROM_RATIO_TOLERANCE = 0.15;
const SEAM_PRESERVATION_MARGIN_DEG = 1;
const ROOT_DRIFT_CAP_M = 0.01;
const NORM_DEVIATION_CAP = 1e-3;

/** Joint angle in degrees, normalising first (non-unit quats otherwise read as motion). */
export function quatAngleDegNorm(a: Quat, b: Quat): number {
  const na = Math.hypot(a[0], a[1], a[2], a[3]);
  const nb = Math.hypot(b[0], b[1], b[2], b[3]);
  if (!(na > 0) || !(nb > 0)) return Number.NaN;
  const dot = Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (na * nb));
  return ((2 * Math.acos(Math.min(1, dot))) * 180) / Math.PI;
}

/** Max pairwise world-orientation angle of one joint over the clip (rotation range). */
export function jointRotationRange(sample: WalkSample, joint: string): number {
  const track = sample.quat[joint];
  if (!track) throw new Error(`no joint ${joint} in sample`);
  let worst = 0;
  for (let i = 0; i < track.length; i += 1) {
    for (let j = i + 1; j < track.length; j += 1) {
      const d = quatAngleDegNorm(track[i]!, track[j]!);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** A last frame duplicating the first poisons every loop metric; detect and drop it. */
export function dropDuplicatedEndFrame(sample: WalkSample): { sample: WalkSample; dropped: boolean } {
  const n = sample.times.length;
  if (n < 3) return { sample, dropped: false };
  let dupErr = 0;
  for (const name of Object.keys(sample.quat)) {
    const track = sample.quat[name]!;
    dupErr = Math.max(dupErr, quatAngleDegNorm(track[n - 1]!, track[0]!));
  }
  let dupPos = 0;
  for (const name of Object.keys(sample.pos)) {
    const track = sample.pos[name]!;
    dupPos = Math.max(
      dupPos,
      Math.hypot(track[n - 1]![0] - track[0]![0], track[n - 1]![1] - track[0]![1], track[n - 1]![2] - track[0]![2]),
    );
  }
  if (!(dupErr < 0.5) || !(dupPos < 0.001)) return { sample, dropped: false };
  return {
    sample: {
      times: sample.times.slice(0, n - 1),
      pos: Object.fromEntries(Object.entries(sample.pos).map(([k, v]) => [k, v.slice(0, n - 1)])),
      quat: Object.fromEntries(Object.entries(sample.quat).map(([k, v]) => [k, v.slice(0, n - 1)])),
    },
    dropped: true,
  };
}

/**
 * Loop seam: max joint-orientation angle between the loop end (extrapolated one frame
 * past it, three.js LoopRepeat period = last timestamp) and the loop start. Rotations
 * are root-translation invariant, so root-motion clips need no delta removal.
 */
export function measureLoopSeam(sample: WalkSample): {
  sample: WalkSample;
  droppedEndFrame: boolean;
  seamErrorDeg: number;
  worstJoint: string;
} {
  const { sample: loop, dropped } = dropDuplicatedEndFrame(sample);
  const n = loop.times.length;
  let seamErrorDeg = 0;
  let worstJoint = "";
  for (const name of Object.keys(loop.quat)) {
    const track = loop.quat[name]!;
    const err = quatAngleDegNorm(slerpUnit(track[n - 2]!, track[n - 1]!, 2), track[0]!);
    if (!(err >= 0)) continue;
    if (err > seamErrorDeg) {
      seamErrorDeg = err;
      worstJoint = name;
    }
  }
  return { sample: loop, droppedEndFrame: dropped, seamErrorDeg, worstJoint };
}

/** Root drift: first-to-last root world distance, scaled to metres. */
export function measureRootDrift(sample: WalkSample, rootName: string, scale: number): number {
  const track = sample.pos[rootName];
  if (!track) throw new Error(`no root ${rootName} in sample`);
  const n = track.length;
  const first = track[0]!;
  const last = track[n - 1]!;
  return (
    Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]) * scale
  );
}

/** Worst |norm - 1| over every quaternion in the sample (raw norms, never normalised). */
export function measureQuatNormDeviation(sample: WalkSample): number {
  let worst = 0;
  for (const name of Object.keys(sample.quat)) {
    for (const q of sample.quat[name]!) {
      const d = Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

function ratioInTolerance(boundDeg: number, sourceDeg: number): number {
  if (sourceDeg === 0) return boundDeg === 0 ? 1 : Number.POSITIVE_INFINITY;
  return boundDeg / sourceDeg;
}

/**
 * Pure gate: bind-fidelity verdict from an already-sampled source/bound pair.
 * Position units cancel in ratios; root drift is scaled to metres per side.
 */
export function evaluateMovementGate(input: {
  source: WalkSample;
  bound: WalkSample;
  pairs: MovementGateJointPair[];
  sourceRoot: string;
  boundRoot: string;
  boundScale?: number;
  looping: boolean;
  provenance: MovementGateReport["provenance"];
}): MovementGateReport {
  const boundScale = input.boundScale ?? 1;

  // Loop metrics run on the closed loop: a duplicated end frame is dropped first,
  // exactly as the walk gait layer does (otherwise seam reads 0 and drift reads 0
  // on clips that repeat frame 0 at the end, e.g. the shipped Walk bound clip).
  const sourceLoop = dropDuplicatedEndFrame(input.source).sample;
  const boundLoop = dropDuplicatedEndFrame(input.bound).sample;

  const romRatios = input.pairs.map((pair) => {
    const sourceDeg = jointRotationRange(sourceLoop, pair.source);
    const boundDeg = jointRotationRange(boundLoop, pair.bound);
    return { ...pair, sourceDeg, boundDeg, ratio: ratioInTolerance(boundDeg, sourceDeg) };
  });
  const worstRomDeviationPct = Math.max(
    0,
    ...romRatios.map(({ ratio }) => (Number.isFinite(ratio) ? Math.abs(ratio - 1) * 100 : Number.POSITIVE_INFINITY)),
  );

  const sourceSeam = measureLoopSeam(sourceLoop);
  const boundSeam = measureLoopSeam(boundLoop);
  const sourceRootDriftM = measureRootDrift(sourceLoop, input.sourceRoot, 1);
  const boundRootDriftM = measureRootDrift(boundLoop, input.boundRoot, boundScale);
  const worstNormDeviation = Math.max(
    measureQuatNormDeviation(sourceLoop),
    measureQuatNormDeviation(boundLoop),
  );

  const fix = (v: number, d = 3): string => (Number.isNaN(v) ? "n/a" : v.toFixed(d));
  const bars: MovementGateBarResult[] = [
    {
      id: "rom-fidelity",
      pass: romRatios.every(({ ratio }) => Number.isFinite(ratio) && Math.abs(ratio - 1) <= ROM_RATIO_TOLERANCE),
      detail: `worst ${fix(worstRomDeviationPct, 1)} % over ${romRatios.length} joints`,
    },
    {
      id: "loop-seam",
      pass: !input.looping || boundSeam.seamErrorDeg <= sourceSeam.seamErrorDeg + SEAM_PRESERVATION_MARGIN_DEG,
      detail: input.looping
        ? `bound ${fix(boundSeam.seamErrorDeg, 2)} deg vs source ${fix(sourceSeam.seamErrorDeg, 2)} deg`
        : "n/a (one-shot clip)",
    },
    {
      id: "root-drift",
      pass: boundRootDriftM < ROOT_DRIFT_CAP_M,
      detail: `${fix(boundRootDriftM, 4)} m`,
    },
    {
      id: "quaternion-norm",
      pass: worstNormDeviation <= NORM_DEVIATION_CAP,
      detail: `worst |norm-1| ${worstNormDeviation.toExponential(1)}`,
    },
  ];
  return {
    provenance: input.provenance,
    looping: input.looping,
    romRatios,
    worstRomDeviationPct,
    sourceSeamDeg: sourceSeam.seamErrorDeg,
    boundSeamDeg: boundSeam.seamErrorDeg,
    sourceRootDriftM,
    boundRootDriftM,
    worstNormDeviation,
    bars,
    pass: bars.every((b) => b.pass),
  };
}
