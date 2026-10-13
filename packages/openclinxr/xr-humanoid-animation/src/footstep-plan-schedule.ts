/**
 * Footstep-plan S2 schedule: per-leg stride-amplitude plan for one physician route.
 *
 * Pure function of route length (no runtime labels, no clip bytes, no GLB).
 * M2/M3 literal: each leg holds one scale from its lift-off to its next
 * lift-off; the first half-beat ramps from standing (scale 0 = the standing
 * pose, so no start pop); middle steps run at 1.0 where the route allows;
 * the last carrying step takes the shortfall; the closing beat returns both
 * legs to scale 0 so the walk ends standing feet-together; the walk exits on
 * a plan-complete signal (not on remaining distance) once the closing beat
 * has landed.
 *
 * Halves (travel atoms): from the walk-start passing (FOOTSTEP_START_PHASE_S)
 * the gait is a sequence of stance-majority halves, each 0.854 s of clip
 * (half the mixer period) advancing the root STEP_TRAVEL_M at scale 1 by
 * steady-state periodicity. Half 0 is the freeze beat (both legs at 0 while
 * the clip marches underneath: body static, no drag, no pop); half 1 steps
 * short (its first 0.179 clip-s elapse before the swing leg plants, so its
 * capacity is reduced by the static prefix); halves 2+ are full; the last
 * carrying half takes the shortfall; two closing halves at 0 bring each leg
 * home in turn (swing lands beside the stance because the remaining distance
 * is already ~0, so the root is clamped static: no trail, no drag).
 *
 * Travel data (committed, measured 2026-10-13):
 * - STEP_TRAVEL_M = 0.5935 m per half at scale 1 (loco vehicle, 6 m
 *   straight, n=8 half-cycles over 2 runs, bit-deterministic: L 0.5910 /
 *   R 0.5960; 5 mm apart, so one mean serves every half).
 * - Wrap-to-wrap cycle 1.1869-1.1871 (2 x 0.5935); SC-05 recorded walk
 *   1.14 m over 1.65 clip-s = 1.180/cycle. The S1 contact-phase JSON's
 *   offline stride proxy (L 0.5635 / R 0.5172) reads ~9% low: it measures
 *   stance-phase foot travel relative to the root offline at rate 1, while
 *   the closed loop advances by rendered toe travel at the played rate. The
 *   planner uses the runtime number: it predicts root travel, and G1 grades
 *   root travel against it.
 * - Lift/plant clip seconds and the mixer period come from the committed
 *   S1 contact-phase JSON (physician-walk-contact-phases.json: cycleS,
 *   left liftS, right liftS, left plantS), cited beside each constant.
 * - Walk-start passing t0 = 0.55 clip-s (runtime min-split clips 0.536-0.566
 *   over 6 steady halves; start-phase feet 0.193 m apart vs 0.699 m at clip
 *   0, matching captured rest lateral within 0.03).
 * - First-half static prefix 0.179 clip-s (half 1 starts at t0+0.854 = 1.404;
 *   the swing leg plants at left plantS 1.583; before that the body is
 *   static), i.e. ~0.124 m of capacity at the 0.695 m-per-clip-s cycle rate.
 * - Swing-lift floor: rest toe ~0.02 m + scale x full swing 0.15 m must stay
 *   >= 0.06 m (FOOT_CONTACT_HEIGHT_METERS) on every non-final step, so a
 *   carrying scale below 0.27 is refused and fed from the middles instead.
 *
 * Linearity travel(s) = s x base is graded, not asserted: G1 requires root
 * path within 0.01 m of planned travel, and the STOP rule fires past 0.02 m.
 *
 * claimScope: step counts and scales for the physician walk clip.
 * notEvidenceFor: gait realism, other actors/clips, or any route whose plan
 * refuses here (middle under 0.7, or a last step under the swing floor with
 * no middle left to feed it).
 */

/** Scale-1 travel of one stance-majority half, in metres (see header). */
export const FOOTSTEP_STEP_TRAVEL_M = 0.5935;

/** Clip-local seconds where the walk action starts under the plan (L passing). */
export const FOOTSTEP_START_PHASE_S = 0.55;

/** Mixer loop period, clip-local seconds (contact-phases.json cycleS). */
export const FOOTSTEP_CYCLE_S = 1.7083333730697632;

/** Left lift-off, clip-local seconds (contact-phases.json left liftS). */
export const FOOTSTEP_LIFT_L_S = 0.9686702508237068;

/** Right lift-off, clip-local seconds (contact-phases.json right liftS). */
export const FOOTSTEP_LIFT_R_S = 1.6641433593254427;

/** Left plant (strike), clip-local seconds (contact-phases.json left plantS). */
export const FOOTSTEP_PLANT_L_S = 1.5831297063202592;

/** Minimum uniform scale: below this the plan refuses (the S2 STOP rule). */
export const FOOTSTEP_MIN_SCALE = 0.7;

/** Swing-lift floor scale: a carrying step below this is fed from middles or refused. */
export const FOOTSTEP_SWING_FLOOR_SCALE = 0.27;

/**
 * Homing allowance after a zero adoption, clip seconds (swing to plant plus
 * the beat). The leg that adopts 0 first trails while the body still moves,
 * so the span covers its next swing after the last zero adoption: only then
 * are both feet home. Cited: mean swing = cycle − mean stance (~0.79 s)
 * from the committed contact phases, plus the beat.
 */
export const FOOTSTEP_HOMING_S = 1.3;

export type FootstepHalf = {
  /** Stance-majority foot of this half (R,L alternating from R). */
  foot: "left" | "right";
  /** Stride-amplitude scale held through this half. */
  scale: number;
};

export type FootstepLegAdoption = {
  /** Elapsed clip seconds from walk start at which this lift-off fires. */
  atS: number;
  /** Scale the leg holds from this lift-off to its next lift-off. */
  scale: number;
};

export type FootstepPlan = {
  /** Carrying halves (half 0 is the freeze beat) plus two closing halves at 0. */
  halves: FootstepHalf[];
  /** Per-leg adoptions in lift-off order (runtime adoption timetable). */
  legs: { left: FootstepLegAdoption[]; right: FootstepLegAdoption[] };
  /** Action-time span from walk start to the plan-complete exit, clip seconds. */
  clipSpanS: number;
  /** Planned root travel in metres (sums the carrying halves). */
  plannedTravelM: number;
};

export type FootstepPlanRefusal = { refused: true; reason: string };

const HALF_S = FOOTSTEP_CYCLE_S / 2;

/** Static-prefix capacity lost on half 1 (swing leg plants mid-half). */
function firstHalfCapacity(): number {
  const halfStart = FOOTSTEP_START_PHASE_S + HALF_S;
  const prefixS = Math.max(0, FOOTSTEP_PLANT_L_S - halfStart);
  return FOOTSTEP_STEP_TRAVEL_M - prefixS * (2 * FOOTSTEP_STEP_TRAVEL_M / FOOTSTEP_CYCLE_S);
}

/**
 * Plan whole steps at per-leg scales for a route of routeLengthMeters.
 * Half 0 freezes at 0; middles run 1.0; the last carrying half takes the
 * shortfall (fed from the middles down to 0.7 when under the swing floor);
 * two closing halves at 0 bring the legs home; the exit fires at clipSpanS.
 * No fitting: counts and scales follow arithmetically from the committed
 * travel data, so 1.31 m -> [0, 1.0, 1.0, 0.417] + close and 2.0 m ->
 * [0, 1.0, 1.0, 1.0, 0.58] + close with no per-route constant.
 */
export function planFootsteps(routeLengthMeters: number): FootstepPlan | FootstepPlanRefusal {
  if (!(routeLengthMeters > 0) || !Number.isFinite(routeLengthMeters)) {
    return { refused: true, reason: `no plan for route length ${routeLengthMeters}: nothing to walk` };
  }
  const cap1 = firstHalfCapacity();
  // Grow the carrying count until the last half fits within scale 1.
  let carry = 1;
  while (carry < 40) {
    const middleTravel = cap1 + (carry - 2) * FOOTSTEP_STEP_TRAVEL_M;
    const lastScale = (routeLengthMeters - middleTravel) / FOOTSTEP_STEP_TRAVEL_M;
    if (lastScale <= 1) break;
    carry += 1;
  }
  // Scales: half 0 at 0, middles at 1.0, last takes the remainder.
  const scales: number[] = [0];
  for (let k = 1; k < carry; k += 1) scales.push(1);
  const middleTravel = cap1 + (carry - 2) * FOOTSTEP_STEP_TRAVEL_M;
  scales.push((routeLengthMeters - middleTravel) / FOOTSTEP_STEP_TRAVEL_M);
  // Feed a sub-floor last step from the middles (never below 0.7); else refuse.
  // Moved in TRAVEL units: half 1's base is the reduced firstHalfCapacity,
  // so equal scale moves would not conserve distance.
  const baseOf = (k: number): number => (k === 1 ? cap1 : FOOTSTEP_STEP_TRAVEL_M);
  let last = scales[scales.length - 1]!;
  if (last < 0) {
    return {
      refused: true,
      reason:
        `route ${routeLengthMeters} m underfills even the freeze beat: `
        + "no whole-step plan (S2 STOP rule)",
    };
  }
  for (let k = scales.length - 2; last < FOOTSTEP_SWING_FLOOR_SCALE && k >= 1; k -= 1) {
    const roomT = (scales[k]! - FOOTSTEP_MIN_SCALE) * baseOf(k);
    if (roomT <= 0) continue;
    const needT = (FOOTSTEP_SWING_FLOOR_SCALE - last) * FOOTSTEP_STEP_TRAVEL_M;
    const moveT = Math.min(roomT, needT);
    scales[k]! -= moveT / baseOf(k);
    last += moveT / FOOTSTEP_STEP_TRAVEL_M;
    scales[scales.length - 1] = last;
  }
  if (last < FOOTSTEP_SWING_FLOOR_SCALE) {
    const middles = scales.slice(1, -1);
    if (middles.length > 0 && middles.some((s) => s < FOOTSTEP_MIN_SCALE)) {
      return {
        refused: true,
        reason:
          `route ${routeLengthMeters} m needs a middle-step scale under ${FOOTSTEP_MIN_SCALE} `
          + "(S2 STOP rule)",
      };
    }
    return {
      refused: true,
      reason:
        `route ${routeLengthMeters} m leaves a last step under the swing floor `
        + "with no middle left to feed it (S2 STOP rule)",
    };
  }
  const feet: Array<"left" | "right"> = scales.map((_, k) => (k % 2 === 0 ? "right" : "left"));
  const stanceOfHalf = (k: number): "left" | "right" => (k % 2 === 0 ? "right" : "left");
  const halves: FootstepHalf[] = [
    ...scales.map((scale, k): FootstepHalf => ({ foot: feet[k]!, scale })),
    { foot: stanceOfHalf(scales.length), scale: 0 },
    { foot: stanceOfHalf(scales.length + 1), scale: 0 },
  ];
  // Per-leg scales in lift-off order: each lift-off adopts the scale of that
  // leg's next stance half (time-ordered static lift timetable from the
  // committed lift seconds above; only lifts inside the walk are kept).
  const timed: Array<{ t: number; side: "left" | "right" }> = [];
  for (let n = 0; n < 12; n += 1) {
    for (const side of ["left", "right"] as const) {
      const liftT = (side === "left" ? FOOTSTEP_LIFT_L_S : FOOTSTEP_LIFT_R_S) + n * FOOTSTEP_CYCLE_S;
      if (liftT > FOOTSTEP_START_PHASE_S) timed.push({ t: liftT, side });
    }
  }
  timed.sort((a, b) => a.t - b.t);
  const byLeg: { left: FootstepLegAdoption[]; right: FootstepLegAdoption[] } = { left: [], right: [] };
  for (const lift of timed) {
    // Next stance half of this leg at or after this lift-off.
    let k = Math.max(0, Math.floor((lift.t - FOOTSTEP_START_PHASE_S) / HALF_S));
    while (k < halves.length && stanceOfHalf(k) !== lift.side) k += 1;
    if (k >= halves.length) break;
    byLeg[lift.side].push({ atS: lift.t - FOOTSTEP_START_PHASE_S, scale: halves[k]!.scale });
    if (lift.t - FOOTSTEP_START_PHASE_S > halves.length * HALF_S) break;
  }
  // Clip span: the first zero-adopting leg trails while the body still
  // moves, so the span covers its next swing (homing) after the last zero
  // adoption, plus the beat. Without this the walk exits with that leg
  // trailing (measured 0.15 m); with it both feet are home at the exit.
  const zeroAdoptions: number[] = [];
  for (const side of ["left", "right"] as const) {
    for (const adoption of byLeg[side]) {
      if (adoption.scale === 0) zeroAdoptions.push(adoption.atS + FOOTSTEP_START_PHASE_S);
    }
  }
  zeroAdoptions.sort((a, b) => a - b);
  const firstZero = zeroAdoptions.length > 0 ? zeroAdoptions[0]! : FOOTSTEP_START_PHASE_S;
  const lastZero = zeroAdoptions.length > 0 ? zeroAdoptions[zeroAdoptions.length - 1]! : FOOTSTEP_START_PHASE_S;
  // Next lift of the first-zero leg after the last zero adoption.
  const liftOfSide = { left: FOOTSTEP_LIFT_L_S, right: FOOTSTEP_LIFT_R_S };
  const firstZeroSide = (["left", "right"] as const).find((side) =>
    byLeg[side].some((a) => a.scale === 0 && a.atS + FOOTSTEP_START_PHASE_S === firstZero),
  ) ?? "left";
  let homingLift = liftOfSide[firstZeroSide];
  while (homingLift <= lastZero) homingLift += FOOTSTEP_CYCLE_S;
  const clipSpanS = homingLift - FOOTSTEP_START_PHASE_S + FOOTSTEP_HOMING_S;
  return {
    halves,
    legs: byLeg,
    clipSpanS,
    plannedTravelM: halves.reduce((s, h, k) => s + (k === 0 ? 0 : k === 1 ? h.scale * cap1 : h.scale * FOOTSTEP_STEP_TRAVEL_M), 0),
  };
}
