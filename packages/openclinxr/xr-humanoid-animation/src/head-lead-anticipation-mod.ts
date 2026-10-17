import { applyHeadGazeLeadYaw } from "./head-gaze-lead-mod.js";
import { readFootstepPlanEnabled } from "./footstep-plan-query-flag-mod.js";
import type { CaseOwnedBedsideApproach } from "./case-owned-approach-runtime-mod.js";

/**
 * Head-lead timed anticipation (module-local timing for the frame module).
 *
 * The head lead becomes a TIMED anticipation: weight 0 while walking until
 * HEAD_LEAD_ANTICIPATION_S before the anticipated turn onset (the
 * walking-exit moment), ramping to 1 over that window, then 1 through
 * settling/stopping. Provenance: human reference (Grok Imagine clips graded
 * by orchestrator, plausibility only) shows the head facing travel while
 * walking and starting toward the new heading 0.1-0.4 s before the
 * body/feet turn (walking-turn ~0.15 s; decelerating-turn ~0.4 s;
 * stop-then-turn 0.1-0.2 s); 0.35 s sits inside that band.
 *
 * The anticipated turn onset uses the executor's own remaining-walk
 * estimate: remaining route distance over current walking speed
 * (execution.routeLengthMeters - execution.travelledMeters over
 * walkSpeedMetersPerSecond). Module-local: not re-exported from any public
 * entrypoint, so no new public export.
 */
export const HEAD_LEAD_ANTICIPATION_S = 0.35;

function smoothstep01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Timed-anticipation weight for the head lead while walking. */
export function headLeadWeightForWalking(input: {
  routeLengthMeters: number;
  travelledMeters: number;
  walkSpeedMetersPerSecond: number;
}): number {
  const remainingMeters = input.routeLengthMeters - input.travelledMeters;
  const speed = input.walkSpeedMetersPerSecond;
  if (!Number.isFinite(remainingMeters) || !Number.isFinite(speed) || speed <= 0) return 1;
  const remainingSeconds = remainingMeters / speed;
  if (remainingSeconds >= HEAD_LEAD_ANTICIPATION_S) return 0;
  if (remainingSeconds <= 0) return 1;
  return smoothstep01(1 - remainingSeconds / HEAD_LEAD_ANTICIPATION_S);
}

/**
 * Gated head-lead application for the frame module. Flag-absent path calls
 * without the weight and stays byte-identical; `footstepPlan=1` walking
 * ramps the bounded yaw by the timed weight; settling/stopping stay full.
 */
export function applyTimedHeadGazeLead(approach: CaseOwnedBedsideApproach): void {
  const phase = approach.execution.phase;
  if (phase !== "walking" && phase !== "settling" && phase !== "stopping") return;
  if (readFootstepPlanEnabled() && phase === "walking") {
    applyHeadGazeLeadYaw({
      actorSlot: approach.actorSlot,
      bodyHeadingRadians: approach.actorSlot.rotation.y,
      targetHeadingRadians: approach.intent.target.headingRadians,
      leadWeight01: headLeadWeightForWalking({
        routeLengthMeters: approach.execution.routeLengthMeters,
        travelledMeters: approach.execution.travelledMeters,
        walkSpeedMetersPerSecond: approach.walkSpeedMetersPerSecond,
      }),
    });
    return;
  }
  applyHeadGazeLeadYaw({
    actorSlot: approach.actorSlot,
    bodyHeadingRadians: approach.actorSlot.rotation.y,
    targetHeadingRadians: approach.intent.target.headingRadians,
  });
}
