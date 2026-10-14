/**
 * Final-turn-footfall per-toe rest landing (rest-stance slice, M3).
 *
 * CAUSE (measured M1/M2, `.openclinxr/evidence/footstep-plan/rest-before-*`):
 * the walk-start idle stance is symmetric about the slot — lateral ±sep/2
 * with BOTH toes `REST_STANCE_FORE_OFFSET_M` ahead of the slot center — while
 * the scalar `restBesideStanceLanding` put the final swing beside the stance
 * (same fore-aft as the stance foot, lateral = full sep). The turn-end pair
 * then has the rest SHAPE but sits translated by (+0.057 lat, −0.111 fore) in
 * the body frame, identically on both toes (M1 table, stable to 4 decimals
 * across runs, routes, and flag states). The arrival close pins the plant and
 * drags the swing across that translation — measured 0.110 m of close-active
 * swing glide on 1.31 m (0.085 m on 2.0 m): a foot gliding after the stop.
 *
 * FIX (every step): land each step's swing foot at its rest offset in THAT
 * step's end frame (anatomical-side lateral ±sep/2 from the per-run snapshot
 * separation plus the measured rest fore offset). Rotations compose across
 * steps, so a foot placed at rest in its landing frame is still at rest in
 * the turn's final frame — every foot the turn ever swings ends on its own
 * rest toe position, and the arrival close (which pins one foot and converges
 * the other toward rest) has nothing to move on either. The stance foot is
 * never re-posed; the slot still arcs about the stance anchors only, so the
 * turn keeps its lift-and-place structure with new anchors.
 *
 * WHY A CONSTANT FOR FORE. The snapshot (`captureRestStance`) keeps only the
 * scalar world separation for XZ — its per-toe locals are foot-relative, so
 * the slot-relative fore offset is not recoverable from it without a forward
 * pass the pure plan cannot do. The offset itself is idle-pose anatomy
 * (same actor, same idle every run), measured 0.1166 m identically on 1.31 m,
 * 2.0 m, and flags-off captures — route-independent by construction, and M4
 * re-verifies it on both routes rather than fitting it to one. The G5 probe
 * (fore → 0) reverts to a fore-less absolute landing and must go red.
 *
 * PURE GEOMETRY: no three.js, no bones, no mixer — same discipline as the plan module.
 */

export type RestToeLandingXz = { x: number; z: number };

/**
 * Measured walk-start idle toe fore offset from the slot center, body frame,
 * world metres (M1: +0.1166 both toes, runs/routes/flags agree to 4 decimals).
 * Both toes share it (rest fore split is 0); lateral is ±sep/2 per side.
 */
export const STEPPING_TURN_REST_FORE_OFFSET_M = 0.1166;

export function restToeLanding(input: {
  /** World XZ of the predicted slot position at the end of the final step. */
  slotEndXz: RestToeLandingXz;
  /** Absolute slot yaw at turn end (the plan lands exactly on target by construction). */
  endYawRadians: number;
  /** Which foot is swinging into the landing (anatomical side sets the lateral sign). */
  swingFoot: "left" | "right";
  /** Walk-start rest toe separation, world metres (must be > 0; validated by caller). */
  restSepM: number;
  /** Rest fore offset, body frame (defaults to the measured idle anatomy above). */
  restForeM?: number | null;
}): RestToeLandingXz {
  const { slotEndXz, endYawRadians, swingFoot, restSepM } = input;
  const restForeM = input.restForeM ?? STEPPING_TURN_REST_FORE_OFFSET_M;
  const cos = Math.cos(endYawRadians);
  const sin = Math.sin(endYawRadians);
  // Absolute rest offset in the end body frame: anatomical side lateral
  // (left +, right −, matching the meter's body projection), shared fore.
  const targetLat = (swingFoot === "left" ? 1 : -1) * (restSepM / 2);
  // End body frame -> world (exact inverse of the meter's projection).
  return {
    x: slotEndXz.x + targetLat * cos + restForeM * sin,
    z: slotEndXz.z - targetLat * sin + restForeM * cos,
  };
}
