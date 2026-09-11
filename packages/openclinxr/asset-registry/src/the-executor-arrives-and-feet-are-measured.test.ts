import { footSlideMeters, stepBedsideApproach } from "@openclinxr/asset-registry/approach-executor";
import { planBedsideApproach } from "@openclinxr/asset-registry/bedside-approach-path";
import { describe, expect, it } from "vitest";
import {
  bedsideTargetForClinician,
  ED_STRETCHER_DECK_BOUNDS,
} from "./index.js";

const PATIENT = { x: -0.9, y: 0, z: -0.1 };
const DOORWAY = { x: 2.6, y: 0, z: 2.2 };

function clearPlan() {
  return planBedsideApproach({
    from: DOORWAY,
    target: bedsideTargetForClinician({
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
    }).position,
    facing: PATIENT,
    obstacles: [],
  });
}

describe("the executor arrives, and feet are measured rather than assumed", () => {
  it("(1) it STOPS at the goal and stays there — the pose does not drift past it", () => {
    const plan = clearPlan();
    const atArrival = stepBedsideApproach({ plan, elapsedMs: 60_000 });
    const longAfter = stepBedsideApproach({ plan, elapsedMs: 600_000 });
    expect(atArrival.arrived).toBe(true);
    expect(longAfter.position).toEqual(atArrival.position);
    expect(longAfter.remainingMeters).toBe(0);
  });

  it("(2) it is PARTWAY at a partway time, so arrival is not immediate", () => {
    // Without this, an executor that teleports to the goal on frame one passes clause (1).
    const plan = clearPlan();
    const early = stepBedsideApproach({ plan, elapsedMs: 500 });
    expect(early.arrived).toBe(false);
    expect(early.remainingMeters).toBeGreaterThan(0);
    const startDistance = Math.hypot(early.position.x - DOORWAY.x, early.position.z - DOORWAY.z);
    expect(startDistance).toBeGreaterThan(0);
    expect(startDistance).toBeLessThan(1.0);
  });

  it("(3) it REFUSES to execute a plan that was never proven clear", () => {
    const to = bedsideTargetForClinician({
      patientPosition: PATIENT,
      supportBounds: ED_STRETCHER_DECK_BOUNDS,
    }).position;
    const midpoint = { x: (DOORWAY.x + to.x) / 2, z: (DOORWAY.z + to.z) / 2 };
    const blocked = planBedsideApproach({
      from: DOORWAY,
      target: to,
      facing: PATIENT,
      obstacles: [{
        id: "cart",
        bounds: {
          min: { x: midpoint.x - 0.3, y: 0, z: midpoint.z - 0.3 },
          max: { x: midpoint.x + 0.3, y: 1.1, z: midpoint.z + 0.3 },
        },
      }],
    });
    expect(() => stepBedsideApproach({ plan: blocked, elapsedMs: 1000 })).toThrow(
      /refused to execute a plan with 1 path violation/,
    );
  });

  it("(4) FOOT SLIDING: a planted foot that does not move measures ZERO", () => {
    const planted = [0, 16, 33, 50].map((atMs) => ({ atMs, position: { x: 1.2, y: 0.02, z: 0.4 } }));
    const report = footSlideMeters(planted);
    expect(report.slideMeters).toBe(0);
    expect(report.contactFrames).toBe(4);
  });

  it("(5) FOOT SLIDING: a foot dragged while in contact measures the DRAG, summed not averaged", () => {
    // Three 0.05 m steps while planted. Averaging would report 0.05 and hide the total; a pop
    // inside a long clean stretch is exactly what a viewer sees, so the sum and the worst frame
    // are both reported.
    const dragged = [0, 16, 33, 50].map((atMs, index) => ({
      atMs,
      position: { x: 1.2 + index * 0.05, y: 0.02, z: 0.4 },
    }));
    const report = footSlideMeters(dragged);
    expect(report.slideMeters).toBeCloseTo(0.15, 6);
    expect(report.worstFrameSlideMeters).toBeCloseTo(0.05, 6);
  });

  it("(6) COUNTERWEIGHT: a foot that never touches the floor reports ZERO slide AND ZERO contact", () => {
    // Zero slide with zero contact is the metric saying it observed nothing. It must not look like
    // a pass, which is why contactFrames travels with the number.
    const airborne = [0, 16, 33].map((atMs) => ({ atMs, position: { x: 1.2, y: 0.9, z: 0.4 } }));
    const report = footSlideMeters(airborne);
    expect(report.slideMeters).toBe(0);
    expect(report.contactFrames).toBe(0);
  });

  it("(7) THE MEASURED TRUTH about this executor: a root-driven walk slides its feet the whole way", () => {
    // No locomotion clip ships, so the feet ride the root. This clause records what the runtime
    // ACTUALLY does rather than asserting a target nobody has met: the slide equals the distance
    // travelled, and it will drop when a real clip drives the legs.
    const plan = clearPlan();
    const samples = [];
    for (let elapsedMs = 0; elapsedMs <= 4000; elapsedMs += 100) {
      const pose = stepBedsideApproach({ plan, elapsedMs });
      samples.push({ atMs: elapsedMs, position: { x: pose.position.x, y: 0.02, z: pose.position.z } });
    }
    const report = footSlideMeters(samples);
    const pathLength = Math.hypot(
      plan.waypoints[plan.waypoints.length - 1]!.position.x - DOORWAY.x,
      plan.waypoints[plan.waypoints.length - 1]!.position.z - DOORWAY.z,
    );
    expect(report.slideMeters).toBeGreaterThan(pathLength * 0.95);
    expect(report.contactFrames).toBeGreaterThan(10);
  });
});
