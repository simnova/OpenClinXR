/**
 * Contact-window walk exit (fixed-clock slice, stage 2). Internal to
 * xr-runtime-state: imported by bedside-approach-execution-mod.ts, never
 * re-exported, so the package's public surface is unchanged.
 *
 * The legacy exit fires on the first frame with remaining <= one frame's
 * advance, so the walk-end clip phase is a property of the frame rate. This
 * module gates that band on the walk clip's own stance labels: the walk ends
 * only inside a single-support contact window. The exit substep is then a
 * clip-phase event, identical across frame pacings, and it names the settling
 * turn's pivot foot deterministically.
 *
 * The stance read mirrors contactAtClipTime (xr-humanoid-animation,
 * fixed-timestep-clock-mod.ts) line for line instead of importing it: that
 * package depends on this one, so the import would point the wrong way.
 *
 * Also homes two walking-phase math helpers extracted whole from
 * bedside-approach-execution-mod.ts under the 500-line file budget
 * (behaviour and comments unchanged, only the module boundary moved):
 * approachRouteLengthMeters and shortestYawDelta.
 */

import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import type { BedsideApproachExecution } from "./bedside-approach-execution-mod.js";

/** Total XZ length of a plan's polyline, in metres. */
export function approachRouteLengthMeters(plan: BedsideApproachPlan): number {
  let total = 0;
  for (let index = 1; index < plan.waypoints.length; index += 1) {
    const from = plan.waypoints[index - 1]?.position;
    const to = plan.waypoints[index]?.position;
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.z - from.z);
  }
  return total;
}

/** Shortest signed angle from `from` to `to`, in radians. */
export function shortestYawDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  return (((to - from + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
}

export type WalkExitContactWindow = {
  cycleSeconds: number;
  atMs: ReadonlyArray<number>;
  left: ReadonlyArray<boolean>;
  right: ReadonlyArray<boolean>;
  /** The walk action's current clip time, in seconds. Null when unknown. */
  clipTimeSeconds: number | null;
};

function contactAtClipTime(
  labels: WalkExitContactWindow,
  clipTimeSeconds: number,
): { left: boolean; right: boolean } {
  const count = labels.atMs.length;
  if (count === 0 || !(labels.cycleSeconds > 0)) return { left: false, right: false };
  const wrapped =
    ((clipTimeSeconds % labels.cycleSeconds) + labels.cycleSeconds) % labels.cycleSeconds;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const sampleTime = (labels.atMs[index] ?? 0) / 1000;
    const direct = Math.abs(sampleTime - wrapped);
    const distance = Math.min(direct, labels.cycleSeconds - direct);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return { left: labels.left[best] ?? false, right: labels.right[best] ?? false };
}

/**
 * One walking-band substep inside the legacy overshoot band. Always returns a
 * step: the walk exits inside a single-support window; armed but out of window
 * it keeps the walking advance rule (landing on, then holding, the route end)
 * with the wait counted; after WALK_EXIT_MAX_WAIT_SUBSTEPS it exits regardless,
 * which bounds the wait against degenerate labels without any caller state.
 * Call only with phase walking and remaining <= frameAdvance.
 */
export function buildWalkExitBandStep(input: {
  execution: BedsideApproachExecution;
  travelledMeters: number;
  remainingMeters: number;
  frameAdvanceMeters: number;
  unit: { x: number; z: number };
  observedPositionXz: { x: number; z: number };
  nowMs: number;
  blendedHeadingRadians: number;
  contact: WalkExitContactWindow;
}): BedsideApproachExecution {
  const walkAdvanceMeters = Math.min(input.frameAdvanceMeters, Math.max(0, input.remainingMeters));
  const contact =
    input.contact.clipTimeSeconds === null
      ? null
      : contactAtClipTime(input.contact, input.contact.clipTimeSeconds);
  const inWindow = contact !== null && contact.left !== contact.right;
  const waited = input.execution.walkExitWaitSubsteps ?? 0;
  if (inWindow || waited >= WALK_EXIT_MAX_WAIT_SUBSTEPS) {
    return {
      ...input.execution,
      phase: "settling",
      travelledMeters: input.travelledMeters,
      drive: { locomotion: 0 },
      headingRadians: input.blendedHeadingRadians,
      prescribedPositionXz: {
        x: input.observedPositionXz.x + input.unit.x * walkAdvanceMeters,
        z: input.observedPositionXz.z + input.unit.z * walkAdvanceMeters,
      },
      arrivedAtMs: input.nowMs,
      stoppedSeconds: 0,
    };
  }
  return {
    ...input.execution,
    phase: "walking",
    travelledMeters: input.execution.travelledMeters,
    drive: { locomotion: 1 },
    headingRadians: input.blendedHeadingRadians,
    prescribedPositionXz: {
      x: input.observedPositionXz.x + input.unit.x * walkAdvanceMeters,
      z: input.observedPositionXz.z + input.unit.z * walkAdvanceMeters,
    },
    arrivedAtMs: null,
    stoppedSeconds: 0,
  };
}
