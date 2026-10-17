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
 * stop-then-turn 0.1-0.2 s).
 *
 * LEAD_S = 0.25 s, from two constraints (round-2 handback). H3 caps the
 * smoothstep peak rate (1.5 x 45 deg / LEAD_S <= 300 deg/s), so LEAD_S must
 * be at least 0.225 s. The measured lead is LEAD_S plus the ~0.133 s lag
 * between walk exit and the body yaw first leaving travel (firstYawLeave 48
 * vs walkEnd 44 at 30 Hz) plus a small detection offset, so 0.25 s centres
 * the measured lead near 0.3 s: 0.25 + 0.133 + ~0.02 = ~0.40 s worst side,
 * inside the 0.1-0.5 s gate with margin on both ends.
 *
 * The anticipated turn onset uses the REALIZED walking speed: travelledMeters
 * delta over elapsed walking time since the first walking frame (cumulative,
 * per-approach datum below), not the nominal walkSpeedMetersPerSecond, which
 * runs ~1.57x hotter than the lock-corrected advance (1.37 vs ~0.87 m/s) and
 * pushed round-1 onset ~0.22 s early. Module-local: not re-exported from any
 * public entrypoint, so no new public export.
 */
export const HEAD_LEAD_ANTICIPATION_S = 0.25;

type WalkDatum = { travelledStartMeters: number; elapsedSeconds: number };

/**
 * Per-approach walking history, keyed by identity. A WeakMap (not a field on
 * the approach type) keeps this slice to one file: no constructor or shared
 * type changes, nothing reachable from any public entrypoint. Entries die
 * with their approach; the datum resets whenever the phase leaves walking.
 */
const walkData = new WeakMap<object, WalkDatum>();

/**
 * Cumulative realized walking speed in m/s, or null when unknown (first
 * walking frame, non-finite inputs, or no forward progress). Unknown reads
 * as "plenty of walk left", which fails safe toward the head staying on the
 * travel heading.
 */
function realizedSpeedMps(approach: CaseOwnedBedsideApproach, deltaSeconds: number): number | null {
  if (approach.execution.phase !== "walking") {
    walkData.delete(approach);
    return null;
  }
  let datum = walkData.get(approach);
  if (datum === undefined) {
    datum = { travelledStartMeters: approach.execution.travelledMeters, elapsedSeconds: 0 };
    walkData.set(approach, datum);
  }
  if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) datum.elapsedSeconds += deltaSeconds;
  const travelled = approach.execution.travelledMeters;
  if (!Number.isFinite(travelled) || !Number.isFinite(datum.travelledStartMeters)) return null;
  if (!(datum.elapsedSeconds > 1e-6)) return null;
  const speed = (travelled - datum.travelledStartMeters) / datum.elapsedSeconds;
  return speed > 0 ? speed : null;
}

function smoothstep01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Timed-anticipation weight for the head lead while walking. */
export function headLeadWeightForWalking(input: {
  routeLengthMeters: number;
  travelledMeters: number;
  /** Cumulative realized speed, or null when unknown (reads as 0 weight). */
  realizedSpeedMps: number | null;
}): number {
  const remainingMeters = input.routeLengthMeters - input.travelledMeters;
  const speed = input.realizedSpeedMps;
  if (!Number.isFinite(remainingMeters) || speed === null || !Number.isFinite(speed) || speed <= 0) return 0;
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
export function applyTimedHeadGazeLead(approach: CaseOwnedBedsideApproach, deltaSeconds: number): void {
  const phase = approach.execution.phase;
  if (phase !== "walking" && phase !== "settling" && phase !== "stopping") {
    walkData.delete(approach);
    return;
  }
  if (readFootstepPlanEnabled() && phase === "walking") {
    applyHeadGazeLeadYaw({
      actorSlot: approach.actorSlot,
      bodyHeadingRadians: approach.actorSlot.rotation.y,
      targetHeadingRadians: approach.intent.target.headingRadians,
      leadWeight01: headLeadWeightForWalking({
        routeLengthMeters: approach.execution.routeLengthMeters,
        travelledMeters: approach.execution.travelledMeters,
        realizedSpeedMps: realizedSpeedMps(approach, deltaSeconds),
      }),
    });
    return;
  }
  walkData.delete(approach);
  applyHeadGazeLeadYaw({
    actorSlot: approach.actorSlot,
    bodyHeadingRadians: approach.actorSlot.rotation.y,
    targetHeadingRadians: approach.intent.target.headingRadians,
  });
}
