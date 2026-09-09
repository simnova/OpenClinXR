import { describe, expect, it } from "vitest";
import {
  IDLE_BODY_DIRECTION_ALLOWANCE_RADIANS,
  bodyDirectionWithinAllowance,
  composedIdleBodyHeading,
} from "./index.js";

/**
 * The defect: `actor.rotation.y = Math.sin(now / 900) * 0.12` (apps/ui-xr/src/main.ts:3485).
 * It ASSIGNS, so a consumed heading is destroyed on the first frame.
 *
 * The clinician's heading in the shipped ward case is PI — facing the patient across the bed.
 * These clauses use it rather than a round number, so a regression shows up as the clinician
 * turning away from a real patient.
 */
const FACING_THE_PATIENT = Math.PI;

describe("the sway composes onto the persistent heading", () => {
  it("(1) the composed heading stays near the base across a whole sway period, never near zero", () => {
    // The assigning version returns values around 0 regardless of base. Sampling a full period
    // catches that at every phase, not just the one where sin() happens to be small.
    for (let step = 0; step < 24; step += 1) {
      const nowMs = (900 * 2 * Math.PI * step) / 24;
      const heading = composedIdleBodyHeading({
        baseHeadingRadians: FACING_THE_PATIENT,
        nowMs,
        periodMs: 900,
        amplitudeRadians: 0.12,
      });
      const check = bodyDirectionWithinAllowance({
        observedHeadingRadians: heading,
        baseHeadingRadians: FACING_THE_PATIENT,
      });
      expect(check.within, `phase ${step}: deviation ${check.deviationRadians}`).toBe(true);
      expect(check.deviationRadians).toBeLessThanOrEqual(0.12 + 1e-9);
    }
  });

  it("(2) COUNTERWEIGHT: the ASSIGNING form fails the same check, so the check is not vacuous", () => {
    // This is what the frame loop did. If it passed, clause (1) would prove nothing.
    const assigned = Math.sin(1234 / 900) * 0.12;
    const check = bodyDirectionWithinAllowance({
      observedHeadingRadians: assigned,
      baseHeadingRadians: FACING_THE_PATIENT,
    });
    expect(check.within).toBe(false);
    expect(check.deviationRadians).toBeGreaterThan(3);
  });

  it("(3) an amplitude beyond the allowance is CLAMPED, not obeyed", () => {
    const heading = composedIdleBodyHeading({
      baseHeadingRadians: FACING_THE_PATIENT,
      nowMs: (900 * Math.PI) / 2,
      periodMs: 900,
      amplitudeRadians: 1.4,
    });
    const check = bodyDirectionWithinAllowance({
      observedHeadingRadians: heading,
      baseHeadingRadians: FACING_THE_PATIENT,
    });
    expect(check.within).toBe(true);
    expect(check.deviationRadians).toBeLessThanOrEqual(IDLE_BODY_DIRECTION_ALLOWANCE_RADIANS + 1e-9);
  });

  it("(4) the deviation is measured the SHORT way round the circle", () => {
    // A base just below +pi and an observed heading just above -pi are 0.02 rad apart, not 6.26.
    // Without wrapping, an actor facing the patient across the seam reports a 359-degree deviation
    // and every check fires on a scene that is correct.
    const check = bodyDirectionWithinAllowance({
      observedHeadingRadians: -Math.PI + 0.01,
      baseHeadingRadians: Math.PI - 0.01,
    });
    expect(check.deviationRadians).toBeCloseTo(0.02, 6);
    expect(check.within).toBe(true);
  });
});
