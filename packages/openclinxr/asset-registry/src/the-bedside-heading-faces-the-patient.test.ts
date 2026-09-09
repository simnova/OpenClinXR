import { describe, expect, it } from "vitest";
import {
  ED_STRETCHER_DECK_BOUNDS,
  bedsideTargetForClinician,
  forwardVectorForHeading,
  headingRadiansToward,
} from "./index.js";

/**
 * Brief §7 step 3: the clinician stands at a bedside target ORIENTED TOWARD THE PATIENT.
 *
 * The heading is checked by ROTATING THE FORWARD VECTOR and asking where it points, never by
 * asserting the radian value I derived. A test that compares atan2 output against a number
 * computed the same way passes whatever the convention is, including a convention that faces the
 * clinician at the wall.
 */
function dot2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.x + a.z * b.z;
}

function unit(v: { x: number; z: number }): { x: number; z: number } {
  const length = Math.hypot(v.x, v.z);
  return length === 0 ? { x: 0, z: 0 } : { x: v.x / length, z: v.z / length };
}

const PATIENT = { x: -0.9, y: 0, z: -0.1 };

describe("the bedside heading faces the patient", () => {
  it("(1) the forward vector points AT the patient, from either approach side", () => {
    for (const side of ["patient_left", "patient_right"] as const) {
      const target = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS, approachSide: side });
      const forward = forwardVectorForHeading(target.headingRadians);
      const toPatient = unit({ x: PATIENT.x - target.position.x, z: PATIENT.z - target.position.z });
      // cos of the angle between them: 1.0 is exactly at the patient.
      expect(dot2(forward, toPatient), `${side} forward does not point at the patient`).toBeCloseTo(1, 6);
    }
  });

  it("(2) COUNTERWEIGHT: the two approach sides produce OPPOSITE headings, so the heading is not a constant", () => {
    // The failure this catches is a function that returns one hardcoded yaw — which is what every
    // heading in the scene is today (-0.26 at actor-staging.ts:210,216 and
    // encounter-actor-framing.ts:137). A constant passes clause (1) for exactly one side.
    const right = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS, approachSide: "patient_right" });
    const left = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS, approachSide: "patient_left" });
    const dotOfForwards = dot2(
      forwardVectorForHeading(right.headingRadians),
      forwardVectorForHeading(left.headingRadians),
    );
    expect(dotOfForwards).toBeCloseTo(-1, 6);
  });

  it("(3) the target stands OFF the patient, not on her", () => {
    const target = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS });
    const separation = Math.hypot(
      target.position.x - PATIENT.x,
      target.position.z - PATIENT.z,
    );
    // Measured, not asserted at the bare standoff: with the deck's bounds supplied the standoff is
    // taken from the deck EDGE (z = 0.38), so the separation from the patient's centre is larger
    // by however far she lies from that edge. A test pinned to 0.75 here would be asserting that
    // the clinician stands on the bed.
    expect(separation).toBeGreaterThan(0.75);
    expect(target.position.z).toBeCloseTo(0.38 + 0.75, 6);
    // And it moves with the patient rather than sitting at a fixed room coordinate. No support
    // bounds here, so this exercises the FALLBACK: offset along +Z by the bare standoff.
    const moved = bedsideTargetForClinician({ patientPosition: { x: 2.4, y: 0, z: 1.1 } });
    expect(moved.position.x).toBeCloseTo(2.4, 6);
    expect(moved.position.z).toBeCloseTo(1.1 + 0.75, 6);
    expect(moved.position.z).not.toBeCloseTo(target.position.z, 3);
  });

  it("(4) coincident points return 0 rather than a guessed direction", () => {
    expect(headingRadiansToward(PATIENT, PATIENT)).toBe(0);
  });
});
