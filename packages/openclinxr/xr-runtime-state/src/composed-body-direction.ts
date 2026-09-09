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
