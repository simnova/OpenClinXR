import { describe, expect, it } from "vitest";
import {
  ED_STRETCHER_DECK_BOUNDS,
  bedsideTargetForClinician,
  planBedsideApproach,
} from "./index.js";

const PATIENT = { x: -0.9, y: 0, z: -0.1 };
const DOORWAY = { x: 2.6, y: 0, z: 2.2 };

function target() {
  return bedsideTargetForClinician({
    patientPosition: PATIENT,
    supportBounds: ED_STRETCHER_DECK_BOUNDS,
  }).position;
}

describe("the approach path stops at the proven target", () => {
  it("(1) KNOWN-GOOD: a clear route arrives, ends ON the target, and faces the patient", () => {
    const plan = planBedsideApproach({
      from: DOORWAY,
      target: target(),
      facing: PATIENT,
      obstacles: [],
    });
    expect(plan.arrivesAtTarget).toBe(true);
    expect(plan.finalPoseErrorMeters).toBeLessThanOrEqual(0.001);
    expect(plan.pathViolations).toEqual([]);

    // Facing is checked as a DIRECTION, not a number: the final heading must point at the patient.
    const last = plan.waypoints[plan.waypoints.length - 1]!;
    const forward = { x: Math.sin(last.headingRadians), z: Math.cos(last.headingRadians) };
    const toPatient = { x: PATIENT.x - last.position.x, z: PATIENT.z - last.position.z };
    const length = Math.hypot(toPatient.x, toPatient.z);
    expect((forward.x * toPatient.x + forward.z * toPatient.z) / length).toBeCloseTo(1, 6);
  });

  it("(2) KNOWN-BAD: a cart mid-route is caught even though BOTH endpoints are clear", () => {
    // This is the whole point of a continuous-path check. Testing only the endpoints passes a
    // route that walks straight through a cart.
    const to = target();
    const midpoint = { x: (DOORWAY.x + to.x) / 2, z: (DOORWAY.z + to.z) / 2 };
    const plan = planBedsideApproach({
      from: DOORWAY,
      target: to,
      facing: PATIENT,
      obstacles: [{
        id: "cart_mid_route",
        bounds: {
          min: { x: midpoint.x - 0.3, y: 0, z: midpoint.z - 0.3 },
          max: { x: midpoint.x + 0.3, y: 1.1, z: midpoint.z + 0.3 },
        },
      }],
    });
    expect(plan.pathViolations.map((violation) => violation.obstacleId)).toEqual(["cart_mid_route"]);
    // Blocked is NOT arrival, however close the last waypoint sits to the target.
    expect(plan.arrivesAtTarget).toBe(false);
    expect(plan.finalPoseErrorMeters).toBeLessThanOrEqual(0.001);
  });

  it("(3) it REPORTS a block rather than routing around it — no invented detour", () => {
    const to = target();
    const midpoint = { x: (DOORWAY.x + to.x) / 2, z: (DOORWAY.z + to.z) / 2 };
    const plan = planBedsideApproach({
      from: DOORWAY,
      target: to,
      facing: PATIENT,
      obstacles: [{
        id: "cart_mid_route",
        bounds: {
          min: { x: midpoint.x - 0.3, y: 0, z: midpoint.z - 0.3 },
          max: { x: midpoint.x + 0.3, y: 1.1, z: midpoint.z + 0.3 },
        },
      }],
    });
    // Every waypoint stays on the straight line between the two points. A detour would mean the
    // path was invented by something nobody validated, which step 4 does not ask for.
    const dx = to.x - DOORWAY.x;
    const dz = to.z - DOORWAY.z;
    const length = Math.hypot(dx, dz);
    for (const waypoint of plan.waypoints) {
      const cross = Math.abs(
        (waypoint.position.x - DOORWAY.x) * dz - (waypoint.position.z - DOORWAY.z) * dx,
      ) / length;
      expect(cross).toBeLessThan(1e-9);
    }
  });

  it("(4) COUNTERWEIGHT: the waypoints are SAMPLED, so a thin obstacle between two of them is still caught", () => {
    // Waypoints are 0.35 m apart, and the corridor test at each one has a 0.3 m radius, so a
    // 0.05 m pole exactly between two samples is the adversarial case. It must still be found.
    const to = target();
    const t = 0.5;
    const between = {
      x: DOORWAY.x + (to.x - DOORWAY.x) * t,
      z: DOORWAY.z + (to.z - DOORWAY.z) * t,
    };
    const plan = planBedsideApproach({
      from: DOORWAY,
      target: to,
      facing: PATIENT,
      obstacles: [{
        id: "iv_pole",
        bounds: {
          min: { x: between.x - 0.025, y: 0, z: between.z - 0.025 },
          max: { x: between.x + 0.025, y: 1.7, z: between.z + 0.025 },
        },
      }],
    });
    expect(plan.pathViolations.length).toBeGreaterThan(0);
  });

  it("(5) the patient is not moved, and no clip is played — step 4's other two clauses are NOT claimed", () => {
    const plan = planBedsideApproach({ from: DOORWAY, target: target(), facing: PATIENT, obstacles: [] });
    // The plan is data. It carries no clip id, no duration and no foot contacts, so nothing here
    // can be mistaken for a foot-sliding or executor measurement.
    expect(Object.keys(plan).sort()).toEqual([
      "arrivesAtTarget",
      "finalPoseErrorMeters",
      "pathViolations",
      "waypoints",
    ]);
  });
});
