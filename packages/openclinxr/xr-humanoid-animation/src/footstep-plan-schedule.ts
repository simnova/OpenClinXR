/**
 * Footstep-plan S2 schedule: stride-amplitude plan for one physician route.
 *
 * Pure function of route length (no runtime labels, no clip bytes, no GLB):
 * plan(routeLength) -> N whole passing-to-passing steps at one uniform scale.
 * The runtime (`footstep-plan-amplitude-mod.ts`) blends leg+pelvis rotations
 * between the standing snapshot and the clip pose by that scale and starts
 * the walk action at FOOTSTEP_START_PHASE_S (feet passing, near standing, so
 * the walk-start adoption is centimetres, not the 0.285 m control snap); the
 * walk then exits on the executor's own remaining<=band rule at the passing
 * where cumulative planned travel reaches the route, feet fore-aft together.
 *
 * Travel data (committed, measured 2026-10-13):
 * - Per passing-to-passing step at scale 1 under the closed loop:
 *   STEP_TRAVEL_M = 0.5935 m (loco vehicle, 6 m straight, n=8 steps over
 *   2 runs, bit-deterministic: L-halves 0.5910, R-halves 0.5960; the two
 *   differ by 5 mm, so one mean serves every step).
 * - Cross-checks: wrap-to-wrap cycle 1.1869-1.1871 (2 x 0.5935); SC-05
 *   recorded walk 1.14 m over 1.65 clip-s = 1.180/cycle; the S1 contact-phase
 *   JSON's offline stride proxy (L 0.5635 / R 0.5172, sum 1.0807) reads ~9%
 *   low because it measures stance-phase foot travel relative to the root
 *   offline at rate 1, while the closed loop advances by rendered toe travel
 *   at the played rate. The planner uses the runtime number: it predicts
 *   root travel, and G1 grades root travel against it.
 * - Passing clip phases (runtime, same runs): L ~0.55 s, R ~1.38 s;
 *   travel from a half start to its passing 0.351 m; min fore-aft split at
 *   passing -0.005..+0.058 m (5 of 6 halves within 0.027), lateral -0.166 m.
 * - Start-phase pose (bound GLB offline): feet |L-R| 0.699 m at clip 0
 *   (mid-stride: the control snap) vs 0.193 m at clip 0.55 (passing: stance
 *   width, matching the captured rest lateral ~0.19 m within 0.03).
 *
 * Linearity assumption travel(s) = s x STEP_TRAVEL_M is graded, not
 * asserted: G1 requires root path within 0.01 m of planned travel, and the
 * STOP rule fires past 0.02 m.
 *
 * claimScope: step counts and scales for the physician walk clip.
 * notEvidenceFor: gait realism, other actors/clips, or any route whose plan
 * refuses here (short routes needing a middle step under 0.7).
 */

/** Scale-1 travel of one passing-to-passing step, in metres (see header). */
export const FOOTSTEP_STEP_TRAVEL_M = 0.5935;

/**
 * Travel of one half-cycle (one passing-to-passing step) at stride scale s,
 * in metres: linear in s from the committed scale-1 table value.
 *
 * D1 check (S2c): D1's measured half is 0.486 m at A's nominal scale, while
 * this function predicts halfCycleTravel(0.7357) = 0.4366 m. Inverted, D1's
 * half maps to effective scale 0.486 / 0.5935 = 0.8189, i.e. +11% travel
 * excess over the table on that half. Fresh-tree captures (s2c-a, n=3,
 * scale 0.7334 certain) split it by half type: odd halves 0.430 m (table
 * linear within 1.5%) run cool, even halves 0.481 m (D1 within 1%) run hot.
 * The plan below keeps the committed table (no per-route fit); the excess
 * is graded by the gates (arrival via the closed-loop clamp, last-window
 * slide), not absorbed here.
 */
export function halfCycleTravelMeters(scale: number): number {
  return scale * FOOTSTEP_STEP_TRAVEL_M;
}

/** Clip-local seconds where the walk action starts under the plan (L passing). */
export const FOOTSTEP_START_PHASE_S = 0.55;

/** Minimum uniform scale: below this the plan refuses (the S2 STOP rule). */
export const FOOTSTEP_MIN_SCALE = 0.7;

export type FootstepPlan = {
  /** Whole passing-to-passing steps. */
  steps: number;
  /** Uniform stride-amplitude scale applied to every step. */
  scale: number;
  /** Planned root travel in metres (=== route length by construction). */
  plannedTravelM: number;
};

export type FootstepPlanRefusal = { refused: true; reason: string };

/**
 * Plan N whole steps at one uniform scale for a route of routeLengthMeters.
 * n is the smallest count with scale <= 1; refusal when that scale < 0.7
 * (a middle step under 0.7) or the length is not positive. No fitting: n and
 * scale follow arithmetically from the committed step travel, so 1.31 m -> 3
 * steps at 0.7357 and 2.0 m -> 4 steps at 0.8425 with no per-route constant.
 */
export function planFootsteps(routeLengthMeters: number): FootstepPlan | FootstepPlanRefusal {
  if (!(routeLengthMeters > 0) || !Number.isFinite(routeLengthMeters)) {
    return { refused: true, reason: `no plan for route length ${routeLengthMeters}: nothing to walk` };
  }
  let steps = Math.max(1, Math.ceil(routeLengthMeters / FOOTSTEP_STEP_TRAVEL_M));
  let scale = routeLengthMeters / (steps * FOOTSTEP_STEP_TRAVEL_M);
  while (scale > 1 && steps < 1000) {
    steps += 1;
    scale = routeLengthMeters / (steps * FOOTSTEP_STEP_TRAVEL_M);
  }
  if (scale < FOOTSTEP_MIN_SCALE) {
    return {
      refused: true,
      reason:
        `route ${routeLengthMeters} m needs scale ${scale.toFixed(4)} < ${FOOTSTEP_MIN_SCALE}: `
        + "a middle step under 0.7 (S2 STOP rule)",
    };
  }
  return { steps, scale, plannedTravelM: steps * scale * FOOTSTEP_STEP_TRAVEL_M };
}
