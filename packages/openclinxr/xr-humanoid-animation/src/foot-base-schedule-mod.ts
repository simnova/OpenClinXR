import {
  FOOTSTEP_R_PASSING_S,
  FOOTSTEP_START_PHASE_S,
  FOOTSTEP_TRAVEL_COEFFS,
} from "./footstep-plan-schedule.js";
import {
  FOOT_BASE_PLANT_PHASE,
  FOOT_BASE_ROWS,
  type FootBasePathRow,
} from "./foot-base-path-data-mod.js";

/**
 * Foot-base schedule/role math for the walking phase (foot-base slice, SC-05).
 *
 * Moved verbatim out of `./foot-base-stride-retarget-mod.js` to hold that
 * file's 500-line zone budget; behaviour is unchanged. This module owns the
 * pure schedule: plant-relative phase, the schedule-only stance role, the
 * interpolated toe-path row, and the passing-to-passing half helpers. The
 * stateful step (`applyFootBaseStep`) stays in the stride-retarget module
 * and re-exports these names so existing deep importers keep working.
 */

export type FootBaseSide = "left" | "right";

/** Plant-relative phase of one foot at this loop phase. */
export function footBaseRelPhase(side: FootBaseSide, phase01: number): number {
  const rel = (phase01 - FOOT_BASE_PLANT_PHASE[side]) % 1;
  return ((rel % 1) + 1) % 1;
}

/**
 * Lift phase per foot (fraction of the loop period): the row-table datum's
 * stance interval for this foot is plantPhase..liftPhase (mod 1).
 * Tracks physician-walk-contact-phases.json left/right liftPhase; pinned by
 * the stride-retarget test against that JSON.
 */
export const FOOT_BASE_LIFT_PHASE = {
  left: 0.5670264750978142,
  right: 0.9741326754830563,
} as const;

/** Stance fraction per foot ((lift - plant) mod 1): left 0.6403, right 0.5361. */
export const FOOT_BASE_STANCE_FRACTION = {
  left: 0.6403164246610666,
  right: 0.53605251487726,
} as const;

/**
 * Band-hold release backstop, in plant-relative phase (footbase-6): a foot
 * past its schedule lift stays pinned while its last solved toe sits inside
 * the contact band (toe roll), but never more than this far past lift, so a
 * dragging foot cannot hold the slot. 0.10 ≈ 3 walking frames; measured lifts
 * clear the 0.06 band one frame past lift (row height jumps ~16 mm), so the
 * backstop never binds in practice.
 */
export const FOOT_BASE_BAND_HOLD_REL = 0.10;

/**
 * Feet the band-hold keeps pinned past their schedule lift (footbase-6, pure).
 * A foot inside its own contact interval is never named here (the schedule
 * owns it); a foot past lift within the backstop whose last solved toe world
 * Y sits at or under floorY + bandM is held, so its first swing motion
 * happens out of band and no stance window spans liftoff motion. Null last
 * toe (before the first solve) never holds: release only once above the band.
 */
export function footBaseBandHoldSides(input: {
  phase01: number;
  lastToeY: Record<FootBaseSide, number | null>;
  floorY: number;
  bandM: number;
}): FootBaseSide[] {
  const held: FootBaseSide[] = [];
  for (const side of ["left", "right"] as const) {
    if (footBaseRelPhase(side, input.phase01) < FOOT_BASE_STANCE_FRACTION[side]) continue;
    const pastLift = footBaseRelPhase(side, input.phase01) - FOOT_BASE_STANCE_FRACTION[side];
    if (!(pastLift > 0 && pastLift <= FOOT_BASE_BAND_HOLD_REL)) continue;
    const lastY = input.lastToeY[side];
    if (lastY === null || !Number.isFinite(lastY)) continue;
    if (lastY <= input.floorY + input.bandM) held.push(side);
  }
  return held;
}

/**
 * Plant-toe height datum per foot, in metres (footbase-5): the row table's
 * heightM is documented (emit-walk-contact-phases.ts) as "toe Y minus this
 * stance's plant toe Y" — relative to the heel-strike toe-up pose, NOT the
 * floor. The absolute target is floorY + datum + scale x heightM, where the
 * datum is the plant toe clearance above flat contact, recovered from the
 * rows themselves as minus the deepest stance dip (mid-stance foot-flat
 * rides at the floor): left 0.0503, right 0.0547. Reading heightM raw above
 * the floor buried every stance target ~5 cm under the ground at the 1.31 m
 * stride (hip 0.78-0.83 m vs 0.735 m leg): the analytic hinge takes the
 * straightest reaching shape, so both knees locked at ~5-6 degrees flexion
 * for the whole walk while plan-only cycles 10-55 degrees, and the slot pin
  * yanked the body 0.41 m ahead of the feet.
  */
export const FOOT_BASE_HEIGHT_DATUM: Record<FootBaseSide, number> = (() => {
  const datum = {} as Record<FootBaseSide, number>;
  for (const side of ["left", "right"] as const) {
    let min = Number.POSITIVE_INFINITY;
    for (const row of FOOT_BASE_ROWS[side]) {
      if (row.phase < FOOT_BASE_STANCE_FRACTION[side] && row.heightM < min) min = row.heightM;
    }
    datum[side] = Number.isFinite(min) ? -min : 0;
  }
  return datum;
})();

/**
  * Schedule-only stance foot at this loop phase: each foot is stance over
 * exactly its plant-to-lift contact interval. Double support goes to the
 * most-recently-planted foot; the empty case (absent from the shipped clip,
 * kept total for alternating test schedules) does the same. Pure function of
 * phase: exactly one role change per plant boundary, none between, no lock
 * read, no hysteresis, no dwell.
 */
export function footBaseScheduleStance(phase01: number): FootBaseSide {
  const wrapped = (((phase01 % 1) + 1) % 1 + 1) % 1;
  const leftStance = footBaseRelPhase("left", wrapped) < FOOT_BASE_STANCE_FRACTION.left;
  const rightStance = footBaseRelPhase("right", wrapped) < FOOT_BASE_STANCE_FRACTION.right;
  if (leftStance && !rightStance) return "left";
  if (rightStance && !leftStance) return "right";
  const behind = (plant: number): number => (((wrapped - plant) % 1) + 1) % 1;
  return behind(FOOT_BASE_PLANT_PHASE.left) < behind(FOOT_BASE_PLANT_PHASE.right) ? "left" : "right";
}

/** Interpolated toe-path row for one foot at its plant-relative phase. */
export function footBaseRowAt(side: FootBaseSide, relPhase01: number): FootBasePathRow {
  const rows = FOOT_BASE_ROWS[side];
  const last = rows.length - 1;
  const wrapped = (((relPhase01 % 1) + 1) % 1 + 1) % 1;
  const f = Math.min(Math.max(wrapped, 0), 1) * last;
  const i0 = Math.min(Math.floor(f), last - 1);
  const fr = f - i0;
  const a = rows[i0]!;
  const b = rows[i0 + 1]!;
  return {
    phase: a.phase + (b.phase - a.phase) * fr,
    along01: a.along01 + (b.along01 - a.along01) * fr,
    lateralM: a.lateralM + (b.lateralM - a.lateralM) * fr,
    heightM: a.heightM + (b.heightM - a.heightM) * fr,
    yawRad: a.yawRad + (b.yawRad - a.yawRad) * fr,
  };
}

/**
 * 1-based passing-to-passing half containing this unwrapped action time.
 * Halves start at the walk-start passing (L, 0.55 s) and alternate R-end /
 * L-end from there, matching planFootsteps' odd-R/even-L convention.
 */
export function footBaseHalfIndex(unwrappedActionTimeS: number, cycleS: number): number {
  if (!(cycleS > 0)) return 1;
  for (let half = 1; half <= 1000; half += 1) {
    const end = half % 2 === 1
      ? FOOTSTEP_R_PASSING_S + ((half - 1) / 2) * cycleS
      : FOOTSTEP_START_PHASE_S + (half / 2) * cycleS;
    if (unwrappedActionTimeS < end) return half;
  }
  return 1000;
}

/** This half's ground travel at stride scale s, from the per-foot affines. */
export function footBaseHalfTravelM(halfIndex: number, scale: number): number {
  const c = FOOTSTEP_TRAVEL_COEFFS;
  return halfIndex % 2 === 1 ? c.aEndR * scale + c.bEndR : c.aEndL * scale + c.bEndL;
}

/**
 * Action-time bounds of one passing-to-passing half: half 1 opens at the
 * walk-start passing; every half opens where the previous one ended.
 */
export function footBaseHalfBounds(halfIndex: number, cycleS: number): { start: number; end: number } {
  const endOf = (half: number): number =>
    half % 2 === 1
      ? FOOTSTEP_R_PASSING_S + ((half - 1) / 2) * cycleS
      : FOOTSTEP_START_PHASE_S + (half / 2) * cycleS;
  return {
    start: halfIndex <= 1 ? FOOTSTEP_START_PHASE_S : endOf(halfIndex - 1),
    end: endOf(Math.max(halfIndex, 1)),
  };
}
