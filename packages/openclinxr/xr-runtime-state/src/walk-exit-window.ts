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

/** Footstep-plan clock: elapsed clip time against the plan-complete span. */
export type FootstepExitClock = {
  clipElapsedS: number;
  clipSpanS: number;
};

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

function contactAtClipTime(  labels: WalkExitContactWindow,
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
 * Footstep-plan exit (S2): leave the walk when the stride plan completes,
 * not when the remaining distance hits the band. The plan's closing beat
 * lands both feet together while the remaining distance is ~0 (root clamped
 * static), so exiting on the clock ends the walk standing; exiting on the
 * band would fire mid-beat with feet split. Backstop: if the body reaches
 * the target first (plan overshoot), exit there rather than walking past it.
 * Same settling shape as the legacy exit below (frozen at the observed spot,
 * drive stopped); null keeps walking. Internal like buildWalkExitBandStep.
 */
export function stepFootstepPlanExit(input: {
  execution: BedsideApproachExecution;
  walkSimSubsteps: number;
  travelledMeters: number;
  remainingMeters: number;
  unit: { x: number; z: number };
  observedPositionXz: { x: number; z: number };
  nowMs: number;
  blendedHeadingRadians: number;
  footstep: FootstepExitClock;
}): BedsideApproachExecution | null {
  const complete = input.footstep.clipElapsedS >= input.footstep.clipSpanS;
  const backstop = input.remainingMeters <= 0;
  if (!complete && !backstop) return null;
  return {
    ...input.execution,
    walkSimSubsteps: input.walkSimSubsteps,
    phase: "settling",
    travelledMeters: input.travelledMeters,
    drive: { locomotion: 0 },
    headingRadians: input.blendedHeadingRadians,
    prescribedPositionXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
    arrivedAtMs: input.nowMs,
    stoppedSeconds: 0,
  };
}

/**
 * STOP WHEN THE NEXT FRAME WOULD OVERSHOOT. The legacy band is one frame's
 * advance rather than a fixed tolerance, so it is a property of the frame rate
 * and the walk speed and cannot be widened to admit an observation: at 60 Hz
 * and 0.676 m/s it is 11 mm, well inside the 0.05 m arrival cap the acceptance
 * contract fixes, and the residual is MEASURED by that metric rather than
 * assumed.
 *
 * CONTACT-WINDOW GATING (fixed-clock slice): with a contact present the band
 * is evaluated per fixed 1/60 s substep, so it is one simulator step, and the
 * exit additionally requires the walk clip to sit inside a single-support
 * contact window. The exit substep is then a clip-phase event rather than a
 * frame-pacing artefact.
 *
 * Band width: the contact-gated path compares against WALK_EXIT_BAND_SECONDS
 * of walk (the legacy 1/30 s frame's physical advance); the ungated path
 * keeps its own frame's advance. A checked-every-2nd-substep cadence was
 * tried and removed: it provably nullifies any width difference on this
 * route, and the window gate already quantises the exit when opted in.
 *
 * Returns the stepped execution when this call ends the walk (in-band exit or
 * gated wait counted inside buildWalkExitBandStep), else null so the caller
 * continues with the stop dispatch and the walking advance below.
 */
export function stepWalkExitBand(input: {
  execution: BedsideApproachExecution;
  walkSimSubsteps: number;
  walkExit: WalkExitContactWindow | null;
  footstep?: FootstepExitClock | null;
  walkSpeedMetersPerSecond: number;
  frameAdvanceMeters: number;
  deltaSeconds: number;
  travelledMeters: number;
  remainingMeters: number;
  unit: { x: number; z: number };
  observedPositionXz: { x: number; z: number };
  nowMs: number;
  blendedHeadingRadians: number;
}): BedsideApproachExecution | null {
  // Footstep plan (S2): the legacy band is suppressed while the plan runs;
  // the walk exits on the plan-complete clock, or on the backstop if the
  // body ever reaches the target first. Absent clock keeps legacy behavior.
  if (input.footstep !== undefined && input.footstep !== null) {
    return stepFootstepPlanExit({
      execution: input.execution,
      walkSimSubsteps: input.walkSimSubsteps,
      travelledMeters: input.travelledMeters,
      remainingMeters: input.remainingMeters,
      unit: input.unit,
      observedPositionXz: input.observedPositionXz,
      nowMs: input.nowMs,
      blendedHeadingRadians: input.blendedHeadingRadians,
      footstep: input.footstep,
    });
  }
  // The exit band is one frame's advance on genuine legacy frames
  // (byte-identical legacy behavior) and WALK_EXIT_BAND_SECONDS of walk on
  // the contact-gated path. Fixed-clock substeps on the ungated path keep
  // their own substep advance: widening it to the legacy width was tried
  // twice (handbacks 1-2) and moved arrival the wrong way or not at all, so
  // the default stays narrow while the offset stands as a known limit.
  const exitBandMeters =
    input.walkExit !== undefined && input.walkExit !== null
      ? input.walkSpeedMetersPerSecond * WALK_EXIT_BAND_SECONDS
      : input.frameAdvanceMeters;
  if (input.execution.phase !== "walking" || input.remainingMeters > exitBandMeters) {
    return null;
  }
  if (input.walkExit !== undefined && input.walkExit !== null) {
    return buildWalkExitBandStep({
      execution: { ...input.execution, walkSimSubsteps: input.walkSimSubsteps },
      travelledMeters: input.travelledMeters,
      remainingMeters: input.remainingMeters,
      frameAdvanceMeters: input.frameAdvanceMeters,
      unit: input.unit,
      observedPositionXz: input.observedPositionXz,
      nowMs: input.nowMs,
      blendedHeadingRadians: input.blendedHeadingRadians,
      contact: input.walkExit,
    });
  }
  return {
    ...input.execution,
    walkSimSubsteps: input.walkSimSubsteps,
    phase: "settling",
    travelledMeters: input.travelledMeters,
    drive: { locomotion: 0 },
    headingRadians: input.blendedHeadingRadians,
    prescribedPositionXz: { x: input.observedPositionXz.x, z: input.observedPositionXz.z },
    arrivedAtMs: input.nowMs,
    stoppedSeconds: 0,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __openClinXrWalkExitProbe:
    | { clipTimeSeconds: number | null; waitedSubsteps: number; walkSimSubsteps: number }
    | undefined;
}

/**
 * Width of the walk-exit band under the fixed clock, in seconds of walk
 * advance (two 1/60 s substeps). The legacy frame-dt path exits on the first
 * frame with remaining <= one frame's advance; at the deterministic 1/30 s
 * capture frame that band is twice the substep band, so a one-substep band
 * enters ~1 frame later and the clip-driven turn starts from a later gait
 * phase (measured: exit clip 1.571 vs legacy 1.476, lateral arrival +23 mm).
 * A fixed 1/30 s band keeps the exit route position pacing-independent while
 * the per-substep advance granularity is unchanged.
 */
export const WALK_EXIT_BAND_SECONDS = 1 / 30;

/**
 * Upper bound on substeps the exit may wait inside the legacy band for a
 * window before forcing the exit. Single support covers most of every cycle,
 * so a longer wait means degenerate labels, not a late window; forcing
 * preserves progress and the wait is reported, never silently extended.
 */
export const WALK_EXIT_MAX_WAIT_SUBSTEPS = 60;

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
    // Bar-2 probe: the exit substep's own clip time + wait + walking-call
    // index, published for the capture instrument. Node-safe: globalThis var
    // is undefined outside the browser, and the assignment is a no-op there
    // for behavior (no read ever feeds back into the sim).
    try {
      (globalThis as unknown as { __openClinXrWalkExitProbe?: unknown }).__openClinXrWalkExitProbe = {
        clipTimeSeconds: input.contact.clipTimeSeconds,
        waitedSubsteps: waited,
        walkSimSubsteps: input.execution.walkSimSubsteps ?? 0,
      };
    } catch { /* telemetry must never break the sim */ }
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
    travelledMeters: input.travelledMeters,
    drive: { locomotion: 1 },
    headingRadians: input.blendedHeadingRadians,
    prescribedPositionXz: {
      x: input.observedPositionXz.x + input.unit.x * walkAdvanceMeters,
      z: input.observedPositionXz.z + input.unit.z * walkAdvanceMeters,
    },
    arrivedAtMs: null,
    stoppedSeconds: 0,
    walkExitWaitSubsteps: waited + 1,
  };
}
