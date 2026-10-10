import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import type { BedsideApproachExecution } from "./bedside-approach-execution-mod.js";

/**
 * The distance-indexed stop handoff, split out of `bedside-approach-execution-mod.ts` to keep
 * that file's 500-line budget; the phase machine owns the branch positions, this module owns
 * the stop math.
 *
 * DISTANCE-INDEXED, NOT PHASE-MATCHED. The stop clip is driven by distance remaining, not by
 * time from a phase match: the wiring precomputes the root path-length-to-end curve R(t) over
 * [tEarliest, end], entry fires as soon as the remaining route fits inside R's range with
 * t0 = R^-1(remaining), and each stopping frame re-derives the clip time the same way
 * (clamped monotone, never rewinding) while the slot advances procedurally at the clip's own
 * path speed. Phase matching cannot guarantee engagement — with the clip rate coupled to
 * ground speed the entry phase advances at the clip's own speed, so every speed law scales
 * both sides of the meeting together — while R^-1 always exists once remaining is inside the
 * curve's range, so engagement is guaranteed on every route long enough to fit the stop.
 */

/**
 * A baked walk-to-stop clip the walking phase can hand off to, replacing the procedural
 * walk-then-settle ending with a played deceleration.
 *
 * ALL FIELDS ARE MEASURED OFF THE CLIP, never configured. The frame loop builds this from the
 * actor's own bound clip and passes it per step; this pure machine only compares and
 * prescribes. Null (or absent) means the actor carries no stop clip and the walk ends exactly
 * as before.
 */
export type StopClipTrigger = {
  clipName: string;
  /** Clip duration in seconds. The handoff to settling fires at this clip time. */
  durationSeconds: number;
  /** Root-bone horizontal track in the clip's own body frame, ascending time. */
  rootTrackXz: Array<{ t: number; x: number; z: number }>;
  /**
   * Yaw mapping the clip body frame onto the route (`travelYawForClipForward` of the route
   * heading and the stop clip's own measured forward). Kept for the pose frame; the slot
   * advance itself is procedural along the route and never replays root positions.
   */
  routeYawRadians: number;
  /**
   * Root path-length-to-end curve R(t) from tEarliestS to the last key, ascending time with
   * non-increasing r. Entry and every stopping frame invert this curve; path length (not
   * chord) so monotonicity holds by construction.
   */
  distCurve: Array<{ t: number; r: number }>;
  /** Earliest admissible entry: one walk cycle before decel onset, stance-snapped. */
  tEarliestS: number;
  /** R(tEarliest): the longest remaining the stop can engage from. */
  rMaxM: number;
  /** R(decelOnset): routes shorter than this cannot fit the deceleration and stay legacy. */
  rDecelM: number;
  /** First root-speed drop below 95% of steady walk, confirmed over the next second. */
  decelOnsetS: number;
  /** First near-stopped root time at or after onset. Reaching it ends the stop. */
  holdOnsetS: number;
};

/** Piecewise-linear sample of a root XZ track at `timeSeconds`, clamped to the end keys. */
export function sampleStopRootTrackXZ(
  track: ReadonlyArray<{ t: number; x: number; z: number }>,
  timeSeconds: number,
): { x: number; z: number } {
  const first = track[0];
  const last = track[track.length - 1];
  if (first === undefined || last === undefined) return { x: 0, z: 0 };
  if (timeSeconds <= first.t) return { x: first.x, z: first.z };
  if (timeSeconds >= last.t) return { x: last.x, z: last.z };
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const next = track[index];
    if (previous === undefined || next === undefined) continue;
    if (timeSeconds <= next.t) {
      const span = next.t - previous.t;
      const blend = span > 0 ? (timeSeconds - previous.t) / span : 0;
      return { x: previous.x + (next.x - previous.x) * blend, z: previous.z + (next.z - previous.z) * blend };
    }
  }
  return { x: last.x, z: last.z };
}

/**
 * The R(t) curve: root path-length-to-end from `tEarliestS` to the last key. The curve starts
 * with an interpolated point exactly at tEarliestS, then every key after it; r is the
 * cumulative XZ path from that time to the end, so it is non-increasing in t by construction.
 */
export function buildDistanceCurve(
  track: ReadonlyArray<{ t: number; x: number; z: number }>,
  tEarliestS: number,
): Array<{ t: number; r: number }> {
  const start = sampleStopRootTrackXZ(track, tEarliestS);
  const points: Array<{ x: number; z: number; t: number }> = [{ x: start.x, z: start.z, t: tEarliestS }];
  for (const key of track) {
    if (key.t > tEarliestS) points.push({ x: key.x, z: key.z, t: key.t });
  }
  const curve: Array<{ t: number; r: number }> = points.map((point) => ({ t: point.t, r: 0 }));
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const step = Math.hypot(to.x - from.x, to.z - from.z);
    const next = curve[index + 1];
    if (next === undefined) continue;
    const slot = curve[index];
    if (slot === undefined) continue;
    slot.r = next.r + step;
  }
  return curve;
}

/**
 * R^-1: the clip time whose distance-to-end equals `remainingMeters`, piecewise-linear between
 * curve points, clamped to the curve ends. Always exists; the entry gate guarantees remaining
 * is inside the range, and stopping clamps defensively.
 */
export function distanceCurveInverseS(
  curve: ReadonlyArray<{ t: number; r: number }>,
  remainingMeters: number,
): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (remainingMeters >= first.r) return first.t;
  if (remainingMeters <= last.r) return last.t;
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1];
    const next = curve[index];
    if (previous === undefined || next === undefined) continue;
    if (remainingMeters <= previous.r && remainingMeters >= next.r) {
      const span = previous.r - next.r;
      const blend = span > 0 ? (previous.r - remainingMeters) / span : 0;
      return previous.t + (next.t - previous.t) * blend;
    }
  }
  return last.t;
}

/** Root path speed in m/s at `timeSeconds`: the containing segment's speed, or 0 past the end. */
export function rootPathSpeedAtMps(
  track: ReadonlyArray<{ t: number; x: number; z: number }>,
  timeSeconds: number,
): number {
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const next = track[index];
    if (previous === undefined || next === undefined) continue;
    if (timeSeconds <= next.t) {
      const dt = next.t - previous.t;
      if (!(dt > 0)) return 0;
      return Math.hypot(next.x - previous.x, next.z - previous.z) / dt;
    }
  }
  return 0;
}

type Vector3 = { x: number; y: number; z: number };

export type StopStepInput = {
  execution: BedsideApproachExecution;
  plan: BedsideApproachPlan;
  start: Vector3;
  target: Vector3;
  targetHeadingRadians: number;
  travelHeadingRadians: number;
  observedPositionXz: { x: number; z: number };
  nowMs: number;
  deltaSeconds: number;
  travelledMeters: number;
  remainingMeters: number;
  blendedHeadingRadians: number;
  stop?: StopClipTrigger | null;
};

/**
 * The stop dispatch: one call covering both directions. Stopping steps the baked deceleration;
 * walking tries the handoff. Returns null when neither applies and the legacy flow continues.
 * The caller runs its legacy close-range check first: within one frame of the target the walk
 * ends as before rather than starting a full stop clip.
 */
export function stepStopHandoff(input: StopStepInput): BedsideApproachExecution | null {
  if (input.execution.phase === "stopping") return stepStopping(input);
  if (input.execution.phase === "walking") return tryEnterStopping(input);
  return null;
}

/**
 * The walking-to-stopping handoff. Fires as soon as the remaining route fits inside the stop
 * clip's own R range with room for the deceleration (rDecel <= remaining <= rMax), at
 * t0 = R^-1(remaining) — no stance-phase gate, so the first frame inside the range always
 * engages. Routes too short to fit the deceleration stay legacy, and the caller's
 * close-range check keeps the final frame legacy too.
 */
export function tryEnterStopping(input: StopStepInput): BedsideApproachExecution | null {
  if (input.execution.phase !== "walking") return null;
  const stop = input.stop ?? null;
  if (
    stop === null
    || !(stop.durationSeconds > 0)
    || stop.distCurve.length < 2
    || !(stop.rMaxM > 0)
    || input.remainingMeters > stop.rMaxM
    || input.remainingMeters < stop.rDecelM
  ) {
    return null;
  }
  const entryTimeS = distanceCurveInverseS(stop.distCurve, input.remainingMeters);
  return {
    ...input.execution,
    phase: "stopping",
    travelledMeters: input.travelledMeters,
    drive: { locomotion: 1 },
    headingRadians: input.blendedHeadingRadians,
    prescribedPositionXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
    arrivedAtMs: null,
    stoppedSeconds: 0,
    stopElapsedSeconds: 0,
    stopClipTimeS: entryTimeS,
    stopTriggerXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
  };
}

/**
 * One frame of the baked deceleration. The slot advance stays the executor's (procedural):
 * it steps forward at the clip's own root path speed at the current clip time, so the
 * remaining route follows R and the clip time re-derived from it stays consistent. The slot
 * XZ is never overwritten from the clip root; the skeleton (root-removed take, posed at the
 * derived clip time) carries the pose. At the clip end — or the hold, whichever comes first —
 * settling begins with the same snapshot the walking-to-settling handoff takes. Heading stays
 * the travel heading throughout: the patient-facing turn waits for settling, exactly as
 * before.
 */
export function stepStopping(input: StopStepInput): BedsideApproachExecution {
  const execution = input.execution;
  const stop = input.stop ?? null;
  if (stop === null) {
    // The clip this stop was entered with is gone mid-stop. Freeze rather than invent motion.
    return { ...execution, travelledMeters: input.travelledMeters, drive: { locomotion: 0 } };
  }
  const previousTimeS = execution.stopClipTimeS
    ?? distanceCurveInverseS(stop.distCurve, input.remainingMeters);
  if (previousTimeS >= stop.holdOnsetS) {
    return settleFromStop(input);
  }
  const speedMps = rootPathSpeedAtMps(stop.rootTrackXz, previousTimeS);
  const advance = Math.min(Math.max(0, speedMps * input.deltaSeconds), input.remainingMeters);
  const remainingAfter = input.remainingMeters - advance;
  // Monotone, never rewinding: the inverse re-derives from the new remaining, floored at the
  // previous clip time so a noisy observed position cannot drag the pose backwards.
  const clipTimeS = Math.max(
    previousTimeS,
    distanceCurveInverseS(stop.distCurve, remainingAfter),
  );
  if (clipTimeS >= stop.durationSeconds || remainingAfter <= 0) {
    return settleFromStop(input);
  }
  const routeDx = input.target.x - input.start.x;
  const routeDz = input.target.z - input.start.z;
  const routeLength = Math.hypot(routeDx, routeDz);
  const unit = routeLength === 0 ? { x: 0, z: 0 } : { x: routeDx / routeLength, z: routeDz / routeLength };
  return {
    ...execution,
    travelledMeters: input.travelledMeters,
    drive: { locomotion: 1 },
    headingRadians: input.travelHeadingRadians,
    prescribedPositionXz: {
      x: input.observedPositionXz.x + unit.x * advance,
      z: input.observedPositionXz.z + unit.z * advance,
    },
    stoppedSeconds: 0,
    stopElapsedSeconds: (execution.stopElapsedSeconds ?? 0) + input.deltaSeconds,
    stopClipTimeS: clipTimeS,
  };
}

function settleFromStop(input: StopStepInput): BedsideApproachExecution {
  return {
    ...input.execution,
    phase: "settling",
    travelledMeters: input.travelledMeters,
    drive: { locomotion: 0 },
    headingRadians: input.travelHeadingRadians,
    prescribedPositionXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
    arrivedAtMs: input.nowMs,
    stoppedSeconds: 0,
  };
}
