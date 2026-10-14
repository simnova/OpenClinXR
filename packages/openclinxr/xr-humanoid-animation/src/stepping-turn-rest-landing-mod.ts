/**
 * Final-turn-footfall rest landing (footstep-plan settle slice, M2).
 *
 * CAUSE (measured M1, `.openclinxr/evidence/footstep-plan/settle-m1-*`): the plan's
 * mirrored footfall goal (`swingTo = 2 * slotEnd - stance`, `stepping-turn-plan-mod.ts`)
 * centers every landing exactly under the pelvis, but the end split then equals twice
 * the final stance foot's fore-aft offset from the slot's fore-aft axis at landing —
 * and that offset is set by the walk-exit pose, not by anything the turn controls.
 * Recomputed plans predicted the measured end split to <1 mm on 1.31 m (+0.012),
 * 2.0 m (+0.102) and 3.7 m (+0.057): the execution is faithful, the mirror geometry
 * is the cause. It correlates with entry foot only because the entry pose (which
 * foot is forward, slot-offset side) differs by parity — 1.31 m and 3.7 m share the
 * right entry foot yet end +0.012 vs +0.057, and 2.0 m pivots on its planted foot
 * already yet splits worst.
 *
 * FIX (last step only): land the swing foot BESIDE the stance — same fore-aft
 * coordinate as the stance in the predicted end frame, laterally separated by the
 * walk-start rest snapshot's own separation (`captureRestStance`, not a constant) —
 * on the side the swing lifts from (anatomical side only on an exact tie). The end
 * fore-aft split is then 0 by construction on any route and either entry foot.
 *
 * What this deliberately does NOT touch: earlier steps keep the mirror (their
 * landings become the next step's stance anchors, so changing them would move the
 * slot path); the slot arcs about the stance anchors only, so the slot path — and
 * hence arrival accuracy — is byte-identical to the mirror plan. The planted stance
 * foot is never re-posed. Invalid rest separation (null/NaN/non-positive) falls
 * back to the mirror, so callers without a snapshot behave exactly as before.
 *
 * PURE GEOMETRY: no three.js, no bones, no mixer — same discipline as the plan module.
 */

export type RestLandingXz = { x: number; z: number };

export function restBesideStanceLanding(input: {
  /** World XZ of the final step's stance foot (pinned, never moved). */
  stanceXz: RestLandingXz;
  /** World XZ of the predicted slot position at the end of the final step. */
  slotEndXz: RestLandingXz;
  /** Absolute slot yaw at turn end (the plan lands exactly on target by construction). */
  endYawRadians: number;
  /** Which foot is swinging into the landing. */
  swingFoot: "left" | "right";
  /** World XZ the swing foot lifts from (the previous landing). */
  swingFromXz: RestLandingXz;
  /** Walk-start rest toe separation, world metres (must be > 0; validated by caller). */
  restSepM: number;
}): RestLandingXz {
  const { stanceXz, slotEndXz, endYawRadians, swingFoot, swingFromXz, restSepM } = input;
  const cos = Math.cos(endYawRadians);
  const sin = Math.sin(endYawRadians);
  // World offset -> end body frame: lat = dx*cos - dz*sin, fore = dx*sin + dz*cos
  // (the same projection `slide-phase-analyze.ts` grades the end stance in).
  const toBody = (p: RestLandingXz): RestLandingXz => ({
    x: (p.x - slotEndXz.x) * cos - (p.z - slotEndXz.z) * sin,
    z: (p.x - slotEndXz.x) * sin + (p.z - slotEndXz.z) * cos,
  });
  const stanceB = toBody(stanceXz);
  const fromB = toBody(swingFromXz);
  const side =
    fromB.x > stanceB.x ? 1 : fromB.x < stanceB.x ? -1 : swingFoot === "left" ? 1 : -1;
  const targetLat = stanceB.x + side * restSepM;
  const targetFore = stanceB.z;
  // End body frame -> world (exact inverse of the projection above).
  return {
    x: slotEndXz.x + targetLat * cos + targetFore * sin,
    z: slotEndXz.z - targetLat * sin + targetFore * cos,
  };
}
