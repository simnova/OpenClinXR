import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import type { BedsideApproachExecution } from "./bedside-approach-execution-mod.js";

/**
 * The baked-stop handoff, split out of `bedside-approach-execution-mod.ts` to keep that file's
 * 500-line budget; the phase machine owns the branch positions, this module owns the stop math.
 */

/** Which feet a stance reading holds planted. */
export type StopClipFoot = { left: boolean; right: boolean };

/**
 * A baked walk-to-stop clip the walking phase can hand off to, replacing the procedural
 * walk-then-settle ending with a played deceleration.
 *
 * ALL FIELDS ARE MEASURED OFF THE CLIP, never configured. The frame loop builds this from the
 * actor's own bound clip (root-bone XZ track, stance labels at frame 0, stance-window forward)
 * and passes it per step; this pure machine only compares and prescribes. Null (or absent) means
 * the actor carries no stop clip and the walk ends exactly as before.
 */
export type StopClipTrigger = {
  clipName: string;
  /** Net horizontal root travel, first to last key, in metres. The trigger distance. */
  displacementMeters: number;
  /** Clip duration in seconds. The handoff to settling fires at this elapsed time. */
  durationSeconds: number;
  /** Stance-label reading at the entry time. The walk hands off only on an equal reading. */
  entryStance: StopClipFoot;
  /**
   * Clip time the handoff starts playing from, in seconds. The walk-to-stop take opens with
   * steady walking the runtime has already covered; playback starts at the last entry-foot
   * stance window before deceleration instead. Optional for older constructions; absent means
   * the clip start.
   */
  entryTimeS?: number;
  /** Root-bone horizontal track in the clip's own body frame, ascending time. */
  rootTrackXz: Array<{ t: number; x: number; z: number }>;
  /**
   * Yaw mapping the clip body frame onto the route (`travelYawForClipForward` of the route
   * heading and the stop clip's own measured forward). Applied to root-track deltas.
   */
  routeYawRadians: number;
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
  walkStance?: StopClipFoot | null;
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
 * The walking-to-stopping handoff. Returns the stopping entry, or null when the handoff does
 * not fire this frame. Fires once the remaining route fits inside the stop clip's own travel
 * AND the walk loop stands on the foot the stop clip starts on. A phase mismatch keeps walking:
 * the extra distance is the trigger residual, bounded by one full walk-loop cycle (one stride —
 * the entry pair recurs at least once per cycle at walking duty factors), and if the pair never
 * recurs the legacy frameAdvance check still ends the walk. An entry stance with no planted foot
 * never fires: a stop that starts mid-air has no continuity anchor. The caller runs its legacy
 * close-range check first: within one frame of the target the walk ends as before rather than
 * starting a full stop clip.
 */
export function tryEnterStopping(input: StopStepInput): BedsideApproachExecution | null {
  if (input.execution.phase !== "walking") return null;
  const stop = input.stop ?? null;
  const walkStance = input.walkStance ?? null;
  if (
    stop === null
    || walkStance === null
    || !(stop.displacementMeters > 0)
    || !(stop.durationSeconds > 0)
    || (!stop.entryStance.left && !stop.entryStance.right)
    || walkStance.left !== stop.entryStance.left
    || walkStance.right !== stop.entryStance.right
    || input.remainingMeters > stop.displacementMeters
  ) {
    return null;
  }
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
    stopTriggerXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
  };
}

/**
 * One frame of the baked deceleration. The slot follows the stop clip's own root travel from
 * the entry time on, measured from the trigger point and rotated into the route heading; the
 * skeleton plays the same span with its root travel removed, so the travel is counted once.
 * Heading stays the travel heading throughout: the patient-facing turn waits for settling,
 * exactly as before. At the clip end, settling begins with the same snapshot the
 * walking-to-settling handoff takes.
 */
export function stepStopping(input: StopStepInput): BedsideApproachExecution {
  const execution = input.execution;
  const stop = input.stop ?? null;
  if (stop === null) {
    // The clip this stop was entered with is gone mid-stop. Freeze rather than invent motion.
    return { ...execution, travelledMeters: input.travelledMeters, drive: { locomotion: 0 } };
  }
  const entryTimeS = stop.entryTimeS ?? 0;
  const elapsedSeconds = (execution.stopElapsedSeconds ?? 0) + input.deltaSeconds;
  if (elapsedSeconds >= stop.durationSeconds - entryTimeS) {
    return {
      ...execution,
      phase: "settling",
      travelledMeters: input.travelledMeters,
      drive: { locomotion: 0 },
      headingRadians: input.travelHeadingRadians,
      prescribedPositionXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
      arrivedAtMs: input.nowMs,
      stoppedSeconds: 0,
    };
  }
  const at = sampleStopRootTrackXZ(stop.rootTrackXz, entryTimeS + elapsedSeconds);
  const atTrigger = sampleStopRootTrackXZ(stop.rootTrackXz, entryTimeS);
  const localDx = at.x - atTrigger.x;
  const localDz = at.z - atTrigger.z;
  const cosYaw = Math.cos(stop.routeYawRadians);
  const sinYaw = Math.sin(stop.routeYawRadians);
  const trigger = execution.stopTriggerXz ?? input.observedPositionXz;
  return {
    ...execution,
    travelledMeters: input.travelledMeters,
    drive: { locomotion: 1 },
    headingRadians: input.travelHeadingRadians,
    prescribedPositionXz: {
      x: trigger.x + localDx * cosYaw + localDz * sinYaw,
      z: trigger.z - localDx * sinYaw + localDz * cosYaw,
    },
    stoppedSeconds: 0,
    stopElapsedSeconds: elapsedSeconds,
  };
}
