import { describe, expect, it } from "vitest";
import {
  ED_STRETCHER_DECK_BOUNDS,
  bedsideClearanceViolations,
  bedsideTargetForClinician,
} from "./index.js";

/**
 * The brief refuses a check without controls: "Define tolerances and known-good/known-bad controls
 * before calling a check 'reachability'."
 *
 * KNOWN-GOOD is the shipped ED bay's own geometry — the stretcher the patient lies on and the ECG
 * cart, at their manifest positions. A clinician at the computed bedside target must clear both.
 * KNOWN-BAD is the same station with an obstacle placed ON the target, and with the corridor
 * crossed. Neither control is invented for this test: the good one is where the station already
 * puts things, and the bad one is the good one moved.
 */
const PATIENT = { x: -0.9, y: 0, z: -0.1 };

/** The ECG cart, at the position the shipped manifest gives it, ~0.6 x 0.5 m in plan. */
const ECG_CART = {
  id: "ecg_cart_equipment",
  bounds: { min: { x: -2.15, y: 0, z: 0.25 }, max: { x: -1.55, y: 1.2, z: 0.85 } },
};

/**
 * The stretcher deck, MEASURED off the shipped station rather than invented: xr-station-room's
 * index.ts:325 builds BoxGeometry(2.35, 0.24, 0.92) at (-0.42, 0.42, -0.08).
 *
 * The first version of this test used bounds I made up, and the shape of that mistake is worth
 * keeping: my invented deck was ~2.0 x 0.9 near the patient, which happens to match the real one
 * closely enough that clause (5) still failed for the RIGHT reason — the target was inside the
 * bed. Had my numbers been wrong the other way, the clause would have passed on a fiction.
 */
const STRETCHER = { id: "stretcher", bounds: ED_STRETCHER_DECK_BOUNDS };

const DOORWAY = { x: 2.6, y: 0, z: 2.2 };

describe("the bedside clearance has controls", () => {
  it("(1) KNOWN-GOOD: the computed bedside target clears the shipped cart", () => {
    const target = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS });
    const violations = bedsideClearanceViolations({
      standingPosition: target.position,
      approachFrom: DOORWAY,
      obstacles: [ECG_CART],
    });
    expect(violations, JSON.stringify(violations)).toEqual([]);
  });

  it("(2) KNOWN-BAD, body: an obstacle ON the target is reported, with the overlap measured", () => {
    const target = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS });
    const onTarget = {
      id: "iv_pole_in_the_way",
      bounds: {
        min: { x: target.position.x - 0.1, y: 0, z: target.position.z - 0.1 },
        max: { x: target.position.x + 0.1, y: 1.6, z: target.position.z + 0.1 },
      },
    };
    const violations = bedsideClearanceViolations({
      standingPosition: target.position,
      obstacles: [onTarget],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("body_clearance");
    expect(violations[0]?.obstacleId).toBe("iv_pole_in_the_way");
    // The overlap is a MEASUREMENT, not a boolean: the footprint radius minus zero distance.
    expect(violations[0]?.overlapMeters).toBeCloseTo(0.3, 6);
  });

  it("(3) KNOWN-BAD, corridor: an obstacle the clinician must walk THROUGH is reported even though the target itself is clear", () => {
    const target = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS });
    const midpoint = {
      x: (DOORWAY.x + target.position.x) / 2,
      z: (DOORWAY.z + target.position.z) / 2,
    };
    const acrossTheRoute = {
      id: "cart_across_the_route",
      bounds: {
        min: { x: midpoint.x - 0.25, y: 0, z: midpoint.z - 0.25 },
        max: { x: midpoint.x + 0.25, y: 1.1, z: midpoint.z + 0.25 },
      },
    };
    const violations = bedsideClearanceViolations({
      standingPosition: target.position,
      approachFrom: DOORWAY,
      obstacles: [acrossTheRoute],
    });
    // The distinction that matters: standing is fine, GETTING there is not.
    expect(violations.map((violation) => violation.kind)).toEqual(["approach_corridor"]);
    expect(violations[0]?.overlapMeters).toBeGreaterThan(0);
  });

  it("(4) COUNTERWEIGHT: without an approach origin NO corridor violation is invented", () => {
    // A checker that reports a corridor block with no route to check would pass clause (3) and
    // mean nothing. The same blocking obstacle, no approachFrom, must yield nothing.
    const target = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS });
    const midpoint = {
      x: (DOORWAY.x + target.position.x) / 2,
      z: (DOORWAY.z + target.position.z) / 2,
    };
    const violations = bedsideClearanceViolations({
      standingPosition: target.position,
      obstacles: [{
        id: "cart_across_the_route",
        bounds: {
          min: { x: midpoint.x - 0.25, y: 0, z: midpoint.z - 0.25 },
          max: { x: midpoint.x + 0.25, y: 1.1, z: midpoint.z + 0.25 },
        },
      }],
    });
    expect(violations).toEqual([]);
  });

  it("(5) the patient's own support is NOT a violation to stand beside — the check would be useless if it were", () => {
    // The clinician stands 0.75 m from the patient, and the stretcher extends toward her. If the
    // deck counted as an obstacle at the bedside, every bedside target in the product would
    // report a violation and the check would be discarded rather than believed.
    const target = bedsideTargetForClinician({ patientPosition: PATIENT, supportBounds: ED_STRETCHER_DECK_BOUNDS });
    const violations = bedsideClearanceViolations({
      standingPosition: target.position,
      obstacles: [STRETCHER],
    });
    const bodyViolations = violations.filter((violation) => violation.kind === "body_clearance");
    expect(
      bodyViolations,
      `standing 0.75 m from the patient must clear her own deck: ${JSON.stringify(bodyViolations)}`,
    ).toEqual([]);
  });
});
