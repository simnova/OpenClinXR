/**
 * Build-time contact phases of one bound walk clip (footstep-plan S1 O3).
 *
 * Internal module beside the gate (not a package entrypoint: the arch
 * ratchets hold the published surface shrink-only, so planner data travels
 * by deep import, the same convention as movement_gate.js). Single source
 * for the math is still the gate: this module only reduces
 * evaluateWalkSymmetry output to planner-ready phases.
 */
import {
  evaluateWalkSymmetry,
  type WalkGateFootMetrics,
  type WalkGateJoints,
  type WalkSample,
} from "./walk_symmetry_gate.js";
import { slerpUnit, type Quat } from "./walk_gait_sample.js";

/** One foot's build-time contact description for the S2 footstep planner. */
export type WalkContactPhaseFoot = {
  /** Plant (strike) time, clip-local seconds (mixer origin). */
  plantS: number;
  /** Liftoff time, clip-local seconds (mixer origin). NaN when never lifts. */
  liftS: number;
  /** Plant as a fraction of the loop period: ((plantS % cycleS) + cycleS) % cycleS / cycleS. */
  plantPhase: number;
  /** Liftoff as a fraction of the loop period, same expression. */
  liftPhase: number;
  /** Step length in metres: the gate stride proxy (stance-phase foot travel relative to the root). */
  stepLengthM: number;
  /** Stance duration in seconds at the native clip rate: (liftS - plantS) mod cycleS. */
  stanceDurationS: number;
  /** Contact fraction of the cycle: stanceDurationS / cycleS. */
  contactFraction: number;
};

/**
 * Per-foot plant/lift in seconds and cycle fractions, step length, stance
 * duration. First contact window per foot; contactWindows counts the windows
 * so the S2 half-cycle assumption (1 per foot) is pinned by the test, not
 * by this function.
 *
 * Phase datum: loopPeriodS, the raw sample's last timestamp (three.js
 * LoopRepeat period, 1.708 s on the shipped walk) — the same origin the
 * runtime mixer reads as clip time. gateCircleS is the gate's own duty
 * normalizer ((clipSpan + step) / windows after seam-drop); it differs from
 * the mixer period by one frame interval when the seam duplicate is
 * dropped, so fractions use the mixer period, never the gate circle.
 */
export type WalkContactPhases = {
  /** Mixer loop period in seconds (raw last timestamp). */
  cycleS: number;
  /** Gate duty/cadence normalizer (post-seam-drop circle). */
  gateCircleS: number;
  /** True when the last frame duplicated the first and was dropped. */
  seamDroppedEndFrame: boolean;
  left: WalkContactPhaseFoot;
  right: WalkContactPhaseFoot;
  /** Plant-to-opposite-plant fractions: left plant to right plant. */
  stepFractionLeftToRight: number;
  /** Plant-to-opposite-plant fractions: right plant to left plant. */
  stepFractionRightToLeft: number;
  contactWindows: { left: number; right: number };
};

export function walkContactPhases(sample: WalkSample, joints: WalkGateJoints): WalkContactPhases {
  const rep = evaluateWalkSymmetry(sample, joints);
  const cycleS = sample.times[sample.times.length - 1]!;
  const gateCircleS = rep.foot.left.cycleS;
  const mod = (t: number): number => (((t % cycleS) + cycleS) % cycleS) / cycleS;
  const foot = (m: WalkGateFootMetrics): WalkContactPhaseFoot => {
    const plantS = m.strikeTimes[0] ?? Number.NaN;
    const liftS = m.liftTimes[0] ?? Number.NaN;
    const stanceDurationS =
      Number.isNaN(plantS) || Number.isNaN(liftS)
        ? Number.NaN
        : (((liftS - plantS) % cycleS) + cycleS) % cycleS;
    return {
      plantS,
      liftS,
      plantPhase: Number.isNaN(plantS) ? Number.NaN : mod(plantS),
      liftPhase: Number.isNaN(liftS) ? Number.NaN : mod(liftS),
      stepLengthM: m.strideM,
      stanceDurationS,
      contactFraction: Number.isNaN(stanceDurationS) ? Number.NaN : stanceDurationS / cycleS,
    };
  };
  const left = foot(rep.foot.left);
  const right = foot(rep.foot.right);
  const stepFractionLeftToRight =
    Number.isNaN(left.plantS) || Number.isNaN(right.plantS)
      ? Number.NaN
      : (((right.plantS - left.plantS) % cycleS) + cycleS) % cycleS / cycleS;
  const stepFractionRightToLeft =
    Number.isNaN(left.plantS) || Number.isNaN(right.plantS)
      ? Number.NaN
      : (((left.plantS - right.plantS) % cycleS) + cycleS) % cycleS / cycleS;
  return {
    cycleS,
    gateCircleS,
    seamDroppedEndFrame: rep.seamDroppedEndFrame,
    left,
    right,
    stepFractionLeftToRight,
    stepFractionRightToLeft,
    contactWindows: { left: rep.foot.left.contactWindows, right: rep.foot.right.contactWindows },
  };
}

/** One foot-base path row: the toe relative to its stride segment at one cycle phase. */
export type FootBasePathRow = {
  /** Fraction of the cycle past this foot's plant: k/40 for k in 0..40. */
  phase: number;
  /** Fraction along the liftoff-to-next-plant segment (0 at liftoff, 1 at touchdown). */
  along01: number;
  /** Signed metres off the segment (left-normal side positive), in the clip-root frame. */
  lateralM: number;
  /** Toe Y minus this stance's plant toe Y, in metres. */
  heightM: number;
  /** Toe yaw minus segment yaw, in radians, wrapped to [-pi, pi]. */
  yawRad: number;
};

/** Foot-base rows per cycle: 41 uniformly spaced phases, plant to plant. */
export const FOOT_BASE_ROW_COUNT = 41;

function wrapAnglePi(a: number): number {
  const twoPi = Math.PI * 2;
  return ((((a + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

function yawOfQuat(q: Quat): number {
  const [x, y, z, w] = q;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
}

/**
 * Foot-base stride segment rows for one foot (foot-base slice, SC-05).
 *
 * The toe (in the contemporary clip-root frame, translation-invariant here:
 * the shipped root is static, so root-relative and bind-space projections are
 * identical) is projected onto the segment from this stance's LIFTOFF toe to
 * the NEXT PLANT toe — not plant-to-plant. The shipped clip is in-place and
 * cyclic, so consecutive plants of one foot coincide (segment ~0, degenerate);
 * the liftoff-to-next-plant segment is the swing excursion (~0.5 m) and reads
 * along01 0 at liftoff, 1 at touchdown, which is exactly what the runtime
 * rebuild (prev + along01 * (next - prev)) needs. Stance rows then read
 * along01 1 -> 0 (unused for stance XZ: the stance foot pins to its foothold)
 * with heightM ~0. Pure; fails loud on a degenerate segment or NaN inputs.
 */
export function footBaseRowsFor(
  sample: WalkSample,
  joints: WalkGateJoints,
  input: { plantS: number; liftS: number; cycleS: number; foot: "left" | "right" },
): FootBasePathRow[] {
  const { plantS, liftS, cycleS, foot } = input;
  if (!(cycleS > 0) || !Number.isFinite(plantS) || !Number.isFinite(liftS)) {
    throw new Error(`foot-base rows need finite plant/lift/cycle, got plantS=${plantS} liftS=${liftS} cycleS=${cycleS}`);
  }
  const s = joints.scale;
  const toeName = foot === "left" ? joints.toeL : joints.toeR;
  const rootName = joints.root;
  const times = sample.times;
  const n = times.length;
  const toePos = sample.pos[toeName];
  const toeQuat = sample.quat[toeName];
  const rootPos = sample.pos[rootName];
  if (!toePos || !toeQuat || !rootPos || toePos.length !== n) {
    throw new Error(`foot-base rows: missing or ragged tracks for ${toeName}/${rootName}`);
  }
  // Cyclic track read with LoopRepeat wrap (period = last timestamp; the wrap
  // takes no time, so the last keyframe doubles as time 0).
  const at = (t: number): { toe: [number, number, number]; root: [number, number, number]; quat: Quat } => {
    const wrapped = (((t % cycleS) + cycleS) % cycleS + cycleS) % cycleS;
    const last = times[n - 1]!;
    if (wrapped >= last) {
      const p = toePos[n - 1]!;
      const r = rootPos[n - 1]!;
      return { toe: [p[0] * s, p[1] * s, p[2] * s], root: [r[0] * s, r[1] * s, r[2] * s], quat: toeQuat[n - 1]! };
    }
    let lo = n - 1;
    let loT = 0;
    let hi = 0;
    let hiT = times[0]!;
    for (let i = 0; i < n; i += 1) {
      const t0 = i === 0 ? 0 : times[i - 1]!;
      const t1 = times[i]!;
      if (wrapped >= t0 && wrapped <= t1) {
        lo = i === 0 ? n - 1 : i - 1;
        loT = t0;
        hi = i;
        hiT = t1;
        break;
      }
    }
    const span = hiT - loT;
    const f = span <= 0 ? 0 : (wrapped - loT) / span;
    const lp = toePos[lo]!;
    const hp = toePos[hi]!;
    const lr = rootPos[lo]!;
    const hr = rootPos[hi]!;
    return {
      toe: [
        (lp[0] + (hp[0] - lp[0]) * f) * s,
        (lp[1] + (hp[1] - lp[1]) * f) * s,
        (lp[2] + (hp[2] - lp[2]) * f) * s,
      ],
      root: [
        (lr[0] + (hr[0] - lr[0]) * f) * s,
        (lr[1] + (hr[1] - lr[1]) * f) * s,
        (lr[2] + (hr[2] - lr[2]) * f) * s,
      ],
      quat: slerpUnit(toeQuat[lo]!, toeQuat[hi]!, f),
    };
  };
  const rel = (t: number): { x: number; y: number; z: number; yaw: number } => {
    const r = at(t);
    return {
      x: r.toe[0] - r.root[0],
      y: r.toe[1] - r.root[1],
      z: r.toe[2] - r.root[2],
      yaw: yawOfQuat(r.quat),
    };
  };
  const lift = rel(liftS);
  const nextPlant = rel(plantS + cycleS);
  const plant = rel(plantS);
  const segX = nextPlant.x - lift.x;
  const segZ = nextPlant.z - lift.z;
  const segLenSq = segX * segX + segZ * segZ;
  if (!(segLenSq > 1e-8)) {
    throw new Error(`foot-base rows (${foot}): degenerate liftoff-to-next-plant segment (lenSq=${segLenSq})`);
  }
  const segLen = Math.sqrt(segLenSq);
  // Left normal of the segment in XZ: the lateral sign datum, shared with the runtime rebuild.
  const sideX = -segZ / segLen;
  const sideZ = segX / segLen;
  const segYaw = Math.atan2(segX, segZ);
  const rows: FootBasePathRow[] = [];
  for (let k = 0; k < FOOT_BASE_ROW_COUNT; k += 1) {
    const phase = k / (FOOT_BASE_ROW_COUNT - 1);
    const cur = rel(plantS + phase * cycleS);
    const dx = cur.x - lift.x;
    const dz = cur.z - lift.z;
    const along01 = (dx * segX + dz * segZ) / segLenSq;
    const px = lift.x + along01 * segX;
    const pz = lift.z + along01 * segZ;
    rows.push({
      phase,
      along01,
      lateralM: (cur.x - px) * sideX + (cur.z - pz) * sideZ,
      heightM: cur.y - plant.y,
      yawRad: wrapAnglePi(cur.yaw - segYaw),
    });
  }
  return rows;
}
