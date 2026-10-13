/**
 * Footstep-plan phase exit (split 2026-10-13, stop-any-route budget split).
 *
 * Moved whole out of `walk-exit-window.ts` under that file's 500-line zone
 * budget (behaviour and comments unchanged, only the module boundary moved).
 * Internal to xr-runtime-state: imported by bedside-approach-execution-mod.ts,
 * never re-exported, so the package's public surface is unchanged. Holds the
 * k-th-passing phase exit plus, from the stop-any-route slice, the passing
 * count, the late two-half correction, the loud safety bound, and the
 * per-passing residual log state (M3/M4/M5).
 */

import type { BedsideApproachExecution } from "./bedside-approach-execution-mod.js";

/**
 * Footstep-plan S2c M2 exit input. All numbers cross from the frame module
 * (which owns the clip constants and the action read); this module holds no
 * clip data of its own, mirroring contactAtClipTime's no-import discipline
 * (xr-humanoid-animation depends on this package, so the constants cannot be
 * imported here).
 */
export type FootstepPhaseExit = {
  /** Whole half-cycles the plan covers (k). */
  steps: number;
  /** L passing the walk starts at (clip seconds). */
  startPhaseS: number;
  /** R passing (clip seconds, same cycle as the start). */
  rPassingS: number;
  /** Clip cycle (seconds). */
  cycleS: number;
  /** Walk action's current clip time, in seconds (1 substep stale, as read). */
  clipTimeS: number;
};

/**
 * Unwrapped clip seconds of the k-th feet-passing after the walk start
 * (the start itself is passing zero). Passings alternate R/L every half:
 * odd k lands on R (rPassing + j x cycle), even k on L (start + j x cycle).
 * Null when the inputs cannot locate a passing (no exit, band fallback).
 */
export function footstepExitPhaseForSteps(input: {
  steps: number;
  startPhaseS: number;
  rPassingS: number;
  cycleS: number;
}): number | null {
  const { steps, startPhaseS, rPassingS, cycleS } = input;
  if (!Number.isInteger(steps) || steps < 1) return null;
  if (!(cycleS > 0) || !(rPassingS > startPhaseS) || !Number.isFinite(startPhaseS)) return null;
  const fullCycles = Math.floor(steps / 2);
  return steps % 2 === 1
    ? rPassingS + fullCycles * cycleS
    : startPhaseS + fullCycles * cycleS;
}

/**
 * One walking-substep phase test: exit when the unwrapped clip time reaches
 * the k-th passing. Wrap counting is carried in (wraps, lastClipS) across
 * calls; a null lastClipS initialises without firing (the action may read a
 * stale pre-start time on its first substep). Returns null when the exit is
 * not configured, so the caller keeps the legacy band.
 */
export function stepFootstepPhaseExit(input: {
  exit: FootstepPhaseExit;
  wraps: number;
  lastClipS: number | null;
}): { reached: boolean; wraps: number; lastClipS: number } | null {
  const { exit } = input;
  if (!Number.isFinite(exit.clipTimeS) || !(exit.cycleS > 0)) return null;
  const target = footstepExitPhaseForSteps(exit);
  if (target === null) return null;
  if (input.lastClipS === null || !Number.isFinite(input.lastClipS)) {
    return { reached: false, wraps: 0, lastClipS: exit.clipTimeS };
  }
  let wraps = input.wraps;
  // One wrap per call at most: the clip advances far less than half a cycle
  // per substep, so a backward jump past half a cycle is exactly one wrap.
  // Self-healing across calls (a missed wrap is caught on the next one).
  // No rewind ever runs while walking (the M3 rewind is settling-only).
  const lastUnwrapped = input.lastClipS + wraps * exit.cycleS;
  if (exit.clipTimeS + wraps * exit.cycleS < lastUnwrapped - exit.cycleS / 2) {
    wraps += 1;
  }
  return { reached: exit.clipTimeS + wraps * exit.cycleS >= target, wraps, lastClipS: exit.clipTimeS };
}

/**
 * Progress-only backstop for the phase exit, in walking substeps: a walk
 * that never reaches its passing (stalled clip, lost action) must still end.
 * Never steers the exit phase — the count is an order of magnitude past any
 * planned walk (SC-05 ~95, 2.0 m ~150) — it only rescues a stranded run.
 */
export const FOOTSTEP_EXIT_MAX_WAIT_SUBSTEPS = 600;

/**
 * One walking-substep dispatch for the S2c M2 phase exit. Armed only with a
 * footstepExit input on a walking execution; anything else reads "off" and
 * the caller keeps the legacy band. While armed ("armed") the caller must
 * skip the band (it fires 1-2 substeps early, D2 again) and persist the
 * carry into its walking continue. On the exit substep ("exited") the
 * prescription mirrors the band's (at most one frame's advance, never past
 * the route end), so arrival is the clamp-pinned spot, not a teleport.
 */
export type FootstepExitDispatch =
  | { kind: "exited"; execution: BedsideApproachExecution }
  | { kind: "armed"; lastClipS: number; wraps: number }
  | { kind: "off" };

export function stepFootstepPhaseExitBand(input: {
  execution: BedsideApproachExecution;
  walkSimSubsteps: number;
  footstepExit: FootstepPhaseExit | null;
  frameAdvanceMeters: number;
  travelledMeters: number;
  remainingMeters: number;
  unit: { x: number; z: number };
  observedPositionXz: { x: number; z: number };
  nowMs: number;
  blendedHeadingRadians: number;
}): FootstepExitDispatch {
  if (input.execution.phase !== "walking" || input.footstepExit === null) return { kind: "off" };
  const phaseTest = stepFootstepPhaseExit({
    exit: input.footstepExit,
    wraps: input.execution.footstepWraps ?? 0,
    lastClipS: input.execution.footstepLastClipS ?? null,
  });
  if (phaseTest === null) return { kind: "off" };
  if (phaseTest.reached || input.walkSimSubsteps >= FOOTSTEP_EXIT_MAX_WAIT_SUBSTEPS) {
    const exitAdvanceMeters = Math.min(input.frameAdvanceMeters, Math.max(0, input.remainingMeters));
    return {
      kind: "exited",
      execution: {
        ...input.execution,
        walkSimSubsteps: input.walkSimSubsteps,
        phase: "settling",
        travelledMeters: input.travelledMeters,
        drive: { locomotion: 0 },
        headingRadians: input.blendedHeadingRadians,
        prescribedPositionXz: {
          x: input.observedPositionXz.x + input.unit.x * exitAdvanceMeters,
          z: input.observedPositionXz.z + input.unit.z * exitAdvanceMeters,
        },
        arrivedAtMs: input.nowMs,
        stoppedSeconds: 0,
        footstepLastClipS: phaseTest.lastClipS,
        footstepWraps: phaseTest.wraps,
      },
    };
  }
  return { kind: "armed", lastClipS: phaseTest.lastClipS, wraps: phaseTest.wraps };
}
