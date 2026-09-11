import { describe, expect, it } from "vitest";
import {
  bedsideClearanceViolations,
  bedsideTargetForClinician,
  ED_MONITOR_BOUNDS,
  ED_STRETCHER_DECK_BOUNDS,
  monitorVisibilityFrom,
  screenNormal,
} from "./index.js";

const PATIENT = { x: -0.9, y: 0, z: -0.1 };
const ROOM_CENTRE = { x: 0, y: 1.2, z: 0 };

function bedside() {
  return bedsideTargetForClinician({
    patientPosition: PATIENT,
    supportBounds: ED_STRETCHER_DECK_BOUNDS,
  }).position;
}

describe("monitor visibility has two failures, not one", () => {
  it("(1) KNOWN-GOOD: from the computed bedside target the shipped monitor is visible", () => {
    const result = monitorVisibilityFrom({
      standingPosition: bedside(),
      monitorBounds: ED_MONITOR_BOUNDS,
      roomCentre: ROOM_CENTRE,
      obstacles: [],
    });
    expect(result, JSON.stringify(result)).toEqual({ visible: true });
  });

  it("(2) KNOWN-BAD, occlusion: a cabinet on the sight line is reported and NAMED", () => {
    const eye = bedside();
    const screenCentre = { x: 1.7, y: 1.45, z: -0.65 };
    const midpoint = {
      x: (eye.x + screenCentre.x) / 2,
      z: (eye.z + screenCentre.z) / 2,
    };
    const result = monitorVisibilityFrom({
      standingPosition: eye,
      monitorBounds: ED_MONITOR_BOUNDS,
      roomCentre: ROOM_CENTRE,
      obstacles: [{
        id: "supply_cabinet",
        bounds: {
          min: { x: midpoint.x - 0.4, y: 0, z: midpoint.z - 0.4 },
          max: { x: midpoint.x + 0.4, y: 2.0, z: midpoint.z + 0.4 },
        },
      }],
    });
    expect(result).toEqual({ visible: false, reason: "occluded", obstacleId: "supply_cabinet" });
  });

  it("(3) KNOWN-BAD, wrong side: standing BEHIND the screen is not visible, though nothing occludes", () => {
    // This is the failure a pure occlusion check calls visible. The segment from behind the screen
    // to its centre hits nothing, and the clinician still sees the back of a monitor.
    const behind = { x: 1.7, y: 0, z: -1.6 };
    const result = monitorVisibilityFrom({
      standingPosition: behind,
      monitorBounds: ED_MONITOR_BOUNDS,
      roomCentre: ROOM_CENTRE,
      obstacles: [],
    });
    expect(result.visible).toBe(false);
    expect(result).toMatchObject({ reason: "behind_screen" });
  });

  it("(4) the screen normal points INTO the room, taken from the thinnest axis", () => {
    // The shipped monitor is BoxGeometry(0.8, 0.55, 0.08): thin along Z, mounted at z -0.65, so it
    // faces +Z toward a room centred at z 0. A normal derived from the widest axis would face the
    // ceiling and clause (3) would pass for the wrong reason.
    expect(screenNormal(ED_MONITOR_BOUNDS, ROOM_CENTRE)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("(5) COUNTERWEIGHT: a ceiling light above the clinician blocks NEITHER the monitor nor the body", () => {
    // An adversarial review flagged that an XZ-only footprint reports a ceiling fixture as a body
    // violation. Both checks must ignore geometry outside the body's height band, or every station
    // with a light reports a violation and the checks stop being believed.
    const standing = bedside();
    const ceilingLight = {
      id: "ceiling_light",
      bounds: {
        min: { x: standing.x - 0.5, y: 2.4, z: standing.z - 0.5 },
        max: { x: standing.x + 0.5, y: 2.6, z: standing.z + 0.5 },
      },
    };
    expect(bedsideClearanceViolations({ standingPosition: standing, obstacles: [ceilingLight] })).toEqual([]);
    expect(
      monitorVisibilityFrom({
        standingPosition: standing,
        monitorBounds: ED_MONITOR_BOUNDS,
        roomCentre: ROOM_CENTRE,
        obstacles: [ceilingLight],
      }),
    ).toEqual({ visible: true });
  });
});
