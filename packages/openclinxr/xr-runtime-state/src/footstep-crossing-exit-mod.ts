/**
 * Footstep-plan toe-crossing exit (exit-phase-per-foot M2, 2026-10-13).
 *
 * Holds the passing/half time helpers moved whole out of
 * `footstep-phase-mod.ts` under that file's 500-line zone budget
 * (verbatim, behaviour unchanged), plus the one new pure helper below.
 * Internal to xr-runtime-state: imported by `footstep-phase-mod.ts`,
 * never re-exported, so the package's public surface is unchanged.
 */

import type { FootstepPhaseExit } from "./footstep-phase-mod.js";

/** End foot of the j-th half (1-based): halves alternate R, L from the L-passing start. */
export function endFootOf(j: number): "L" | "R" {
  return j % 2 === 1 ? "R" : "L";
}

/** Unwrapped clip seconds of the j-th passing (j >= 1); the walk start itself is passing zero. */
export function passingTimeU(exit: FootstepPhaseExit, j: number): number {
  const fullCycles = Math.floor(j / 2);
  return j % 2 === 1
    ? exit.rPassingS + fullCycles * exit.cycleS
    : exit.startPhaseS + fullCycles * exit.cycleS;
}

/** Clip duration of one half ending at the named foot (R halves span start->rPassing). */
export function halfDurationS(exit: FootstepPhaseExit, endFoot: "L" | "R"): number {
  const rHalf = exit.rPassingS - exit.startPhaseS;
  return endFoot === "R" ? rHalf : exit.cycleS - rHalf;
}

/**
 * One walking-substep toe-crossing exit test (M2). The frame module raises
 * `toeCrossed` on each route-axis R-L separation sign flip; flips are
 * clockwork (measured: one per passing, ~31 substeps apart, no flicker on
 * 1.31/2.0/6.0 m walks), so the flip COUNT names the passing: the walk
 * exits on the target-th flip, whichever foot that is, at any scale. A
 * recorded crossing owns the exit: the phase target is the backstop only
 * until one is seen. `delaySubsteps` is the G4 probe channel (hold a
 * recorded crossing late); 0 exits on the detecting substep. Passings are
 * deliberately not consulted: the stale phase count races the flip by
 * +-1 substep (measured: the 2.0 m last-half opener fired the exit a full
 * half early), while the count is exact.
 */
export function stepFootstepToeCrossing(input: {
  toeCrossed: boolean;
  delaySubsteps: number;
  substep: number;
  crossedAt: number | null;
  flipCount: number;
  targetFlip: number;
}): { fire: boolean; crossedAt: number | null; flipCount: number } {
  const delay = input.delaySubsteps > 0 ? Math.floor(input.delaySubsteps) : 0;
  const count = input.flipCount + (input.toeCrossed ? 1 : 0);
  if (input.crossedAt !== null) {
    return { fire: input.substep >= input.crossedAt + delay, crossedAt: input.crossedAt, flipCount: count };
  }
  if (input.toeCrossed && count === input.targetFlip) {
    return { fire: delay <= 0, crossedAt: input.substep, flipCount: count };
  }
  return { fire: false, crossedAt: null, flipCount: count };
}
