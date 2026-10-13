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
 * Linearity assumption travel(s) = s x STEP_TRAVEL_M is superseded for the
 * planner by the per-foot affine model below (M1, stop-any-route): halves
 * ending at R and L travel different affines, and planFootsteps solves the
 * uniform scale from their sum. halfCycleTravelMeters keeps the legacy
 * linear table read (graded by the same gates as before); the planner no
 * longer calls it.
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

/**
 * Clip-local seconds of the R feet-passing, same run as the start phase
 * (schedule header: L ~0.55 s, R ~1.38 s; fresh-tree s2c-a interpolates the
 * R zero-crossing at 1.379 s). With the start phase this locates every
 * passing: L at start + m x cycle, R at R_PASSING + m x cycle. The M2 exit
 * counts the k-th passing after the start; the M3 freeze rewinds to it.
 */
export const FOOTSTEP_R_PASSING_S = 1.38;

/** Minimum uniform scale: below this the plan refuses (the S2 STOP rule). */
export const FOOTSTEP_MIN_SCALE = 0.7;

/**
 * Which passing a passing-to-passing half ends at. The stance foot carries
 * the half: an R half (L passing -> R passing) travels on the planted right
 * foot while the left swings, and symmetrically for L. Named by the END
 * passing because the walk exits by counting passings (M2/M4).
 */
export type FootstepHalfEnd = "L" | "R";

/*
 * Per-foot affine travel model (stop-any-route M1, measured 2026-10-13):
 * travel of one half ending at the named passing is a_foot x s + b_foot.
 *
 * Fit from zero-crossing halves on disk (see
 * .openclinxr/evidence/stop-fit/half-travel-table.json for the full table,
 * exclusions, and build shas): L ends (0.7334: 0.4943, 0.8425: 0.5246,
 * 0.9190: 0.5533, rms 2.1 mm); R ends (0.7334 first-half 0.4292 flagged
 * transient-suspect, 0.8425 middle 0.4669, 0.9190 all-run mean 0.5191 over a
 * 0.508-0.532 run-to-run span on the loco scene, rms 7.1 mm). Last halves
 * are excluded (exit clamp/band, D2); the stale-build 1.31 m L point is
 * superseded by the current-build point at the same scale.
 *
 * The intercepts are interpolation-local, not physics (L extrapolates to
 * 0.26 m at s = 0): valid only on s in [0.7, 1.0], the only range the
 * planner (M2) and the late correction (M3) ever solve in. Refit with
 * same-scene current-build captures (C3) before trusting residuals below.
 */
const TRAVEL_A_END_L = 0.3152;
const TRAVEL_B_END_L = 0.262;
const TRAVEL_A_END_R = 0.4749;
const TRAVEL_B_END_R = 0.0768;

/**
 * Model coefficients for the frame module's exit-struct fill (M3): the
 * executor cannot import this module (package direction), so the numbers
 * ride the FootstepPhaseExit struct as data. Module export, deliberately
 * NOT re-exported from `./footstep-plan` (no new public symbol).
 */
export const FOOTSTEP_TRAVEL_COEFFS = {
  aEndL: TRAVEL_A_END_L,
  bEndL: TRAVEL_B_END_L,
  aEndR: TRAVEL_A_END_R,
  bEndR: TRAVEL_B_END_R,
} as const;

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
 * Plan k whole halves at one uniform scale for a route of routeLengthMeters.
 * Halves alternate R-end, L-end from the L-passing walk start (half i ends R
 * for odd i, L for even i), and each half's travel comes from the per-foot
 * affine model (M1), not the shared linear table: k is the smallest count
 * with the solved scale <= 1; refusal when that scale < 0.7 (a middle step
 * under 0.7) or the length is not positive. The one scale seeds every half;
 * the late correction (M3) re-solves it for the last two at the
 * antepenultimate passing. No per-route constant: 1.31 m -> 3 halves at
 * 0.7070, 2.0 m -> 4 halves at 0.8369, 6.0 m -> 11 halves at 0.9557.
 *
 * modelScale (default 1) multiplies the affines before solving: the G6
 * probe channel only (?footstepProbeModel=1.2 seeds +20% at plan time; the
 * correction always uses the TRUE model, which is what lets M3 recover).
 */
export function planFootsteps(routeLengthMeters: number, modelScale = 1): FootstepPlan | FootstepPlanRefusal {
  if (!(routeLengthMeters > 0) || !Number.isFinite(routeLengthMeters)) {
    return { refused: true, reason: `no plan for route length ${routeLengthMeters}: nothing to walk` };
  }
  const aR = TRAVEL_A_END_R * modelScale;
  const bR = TRAVEL_B_END_R * modelScale;
  const aL = TRAVEL_A_END_L * modelScale;
  const bL = TRAVEL_B_END_L * modelScale;
  for (let steps = 1; steps <= 1000; steps += 1) {
    let slope = 0;
    let intercept = 0;
    for (let half = 1; half <= steps; half += 1) {
      if (half % 2 === 1) {
        slope += aR;
        intercept += bR;
      } else {
        slope += aL;
        intercept += bL;
      }
    }
    const scale = (routeLengthMeters - intercept) / slope;
    if (scale > 1) continue;
    if (scale < FOOTSTEP_MIN_SCALE) {
      return {
        refused: true,
        reason:
          `route ${routeLengthMeters} m needs scale ${scale.toFixed(4)} < ${FOOTSTEP_MIN_SCALE}: `
          + "a middle step under 0.7 (S2 STOP rule)",
      };
    }
    let plannedTravelM = 0;
    for (let half = 1; half <= steps; half += 1) {
      plannedTravelM += half % 2 === 1 ? aR * scale + bR : aL * scale + bL;
    }
    return { steps, scale, plannedTravelM };
  }
  return {
    refused: true,
    reason: `no plan for route length ${routeLengthMeters}: no whole-half count under 1000 reaches it`,
  };
}
