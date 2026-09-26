/**
 * Body direction during idle and speech: a persistent heading with a bounded deviation on top.
 *
 * Brief §7 step 3 asks for "the proposed persistent heading consumed and composed body direction
 * checked during idle and speech, including allowed speech deviations".
 *
 * The frame loop wrote `actor.rotation.y = Math.sin(now / 900) * 0.12` (apps/ui-xr/src/main.ts:3485
 * for the clinical actor, :3484 for the patient). That ASSIGNS: whatever heading was consumed at
 * staging is destroyed on the first frame, so a clinician placed facing the patient faces wherever
 * the sine happens to be. It is the same defect as the position writes the transform card fixed,
 * one axis over.
 *
 * Composition is the fix, and the ALLOWANCE is what makes it checkable: a sway that composes but
 * wanders 90 degrees off is no better than one that assigns.
 */

/**
 * How far the body may turn from its persistent heading, in radians.
 *
 * 0.20 rad is ~11.5 degrees. It is derived from the shipped sway amplitudes rather than invented:
 * the two in the frame loop are 0.08 and 0.12 rad, and the allowance is their sum, so both compose
 * within it and a third that exceeded them both would not. A larger deviation is not idle motion,
 * it is turning to face something else, and that is a placement decision rather than a sway.
 */
export const IDLE_BODY_DIRECTION_ALLOWANCE_RADIANS = 0.2;

/** Wrap to (-pi, pi] so a deviation across the seam is measured the short way round. */
export function shortestAngleDelta(a: number, b: number): number {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * The heading to write this frame: the persistent base plus a bounded sway.
 *
 * The sway is CLAMPED to the allowance rather than trusted. An amplitude larger than the allowance
 * is a caller error, and silently obeying it would let a future edit turn an actor away from the
 * patient one frame at a time without any check firing.
 */
export function composedIdleBodyHeading(input: {
  baseHeadingRadians: number;
  nowMs: number;
  periodMs: number;
  amplitudeRadians: number;
  allowanceRadians?: number;
}): number {
  const allowance = input.allowanceRadians ?? IDLE_BODY_DIRECTION_ALLOWANCE_RADIANS;
  const amplitude = Math.min(Math.abs(input.amplitudeRadians), allowance);
  return input.baseHeadingRadians + Math.sin(input.nowMs / input.periodMs) * amplitude;
}

/** Whether an observed heading is still within the allowance of its persistent base. */
export function bodyDirectionWithinAllowance(input: {
  observedHeadingRadians: number;
  baseHeadingRadians: number;
  allowanceRadians?: number;
}): { within: boolean; deviationRadians: number } {
  const allowance = input.allowanceRadians ?? IDLE_BODY_DIRECTION_ALLOWANCE_RADIANS;
  const deviation = Math.abs(
    shortestAngleDelta(input.observedHeadingRadians, input.baseHeadingRadians),
  );
  return { within: deviation <= allowance + 1e-9, deviationRadians: deviation };
}

/**
 * The two staged actors' idle sway, composed onto their persistent headings.
 *
 * MOVED OUT OF `apps/ui-xr/src/main.ts` UNCHANGED, for the reason
 * `composition-root-conventions.ts` states: "an app module may only compose, boot, and expose what a
 * package built." The two exclusions below are the ones that were already there and both are
 * load-bearing.
 *
 * A SUPINE ACTOR IS SKIPPED. A recumbent root's orientation is owned by the plant hold
 * (`applySupinePoseHoldingIncline` plus the stored hinge quaternion); a per-frame yaw re-derives the
 * actor quaternion away from the stored tip and lifts the head off the pillow.
 *
 * THE SWAY IS COMPOSED, NEVER ASSIGNED. These used to be `rotation.y = Math.sin(...) * amplitude`,
 * which destroyed a consumed heading on the first frame — the same defect as the position writes,
 * one axis over. The base is `openClinXrBaseHeadingRadians`, stamped at staging after everything
 * else that writes rotation.y.
 */
export function applyStationIdleSway(input: {
  patient: { rotation: { y: number }; userData: Record<string, unknown>; children?: unknown[] };
  nurse: { rotation: { y: number }; userData: Record<string, unknown> };
  nowMs: number;
}): void {
  const children = Array.isArray(input.patient.children) ? input.patient.children : [];
  const posture = (userData: Record<string, unknown> | undefined): unknown =>
    userData === undefined ? undefined : Reflect.get(userData, "openClinXrActorPosture");
  const supine =
    posture(input.patient.userData) === "supine"
    || children.some((child) => posture((child as { userData?: Record<string, unknown> }).userData) === "supine");
  const base = (userData: Record<string, unknown>): number => {
    const heading = Reflect.get(userData, "openClinXrBaseHeadingRadians");
    return typeof heading === "number" ? heading : 0;
  };
  if (!supine) {
    input.patient.rotation.y = composedIdleBodyHeading({
      baseHeadingRadians: base(input.patient.userData),
      nowMs: input.nowMs,
      periodMs: 1200,
      amplitudeRadians: 0.08,
    });
  }
  // AN ORDER-DRIVEN ACTOR IS SKIPPED, same reasoning as the supine exclusion above: this composer
  // has no idea a locomotion order exists, and unconditionally overwriting rotation.y here every
  // frame silently discards the settling turn's own yaw progress. Measured live (2026-09-26): a
  // nurse under an order walked and entered "settling" needing a ~110 deg turn, applied real
  // per-phase increments (`clip-driven-settling-turn-mod.ts`), and STILL never converged --
  // `applyStationIdleSway` ran one line later in `apps/ui-xr/src/main.ts`'s frame loop and
  // reasserted `baseHeadingRadians + sin(...)*0.12` over her rotation every single frame, which is
  // why her own settling-turn instrumentation showed a value at the TOP of the next frame's stance
  // lock that did not match the value written at the END of the previous frame's. `locomotion-
  // order-mod.ts` (xr-humanoid-animation) stamps this flag while an order is walking or settling,
  // and clears it once arrived (or refused), so a nurse who is NOT under an order still sways.
  if (Reflect.get(input.nurse.userData, "openClinXrLocomotionOrderActive") !== true) {
    input.nurse.rotation.y = composedIdleBodyHeading({
      baseHeadingRadians: base(input.nurse.userData),
      nowMs: input.nowMs,
      periodMs: 900,
      amplitudeRadians: 0.12,
    });
  }
}
