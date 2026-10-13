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
