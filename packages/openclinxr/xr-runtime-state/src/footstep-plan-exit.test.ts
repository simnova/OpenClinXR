import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import { describe, expect, it } from "vitest";
import {
  type BedsideApproachExecution,
  stepBedsideApproachExecution,
} from "./bedside-approach-execution.js";

/**
 * Footstep-plan exit through the public entrypoint: while the plan clock
 * runs the legacy band is suppressed (the walk holds past the distance the
 * band would exit at); the walk ends on the plan-complete clock, or on the
 * backstop at the target. Absent clock keeps the legacy exit byte-for-byte.
 */

type StepInput = Parameters<typeof stepBedsideApproachExecution>[0];

const START = { x: 0, y: 0, z: 0 };
const TARGET = { x: 2, y: 0, z: 0 };
const TRAVEL_HEADING = Math.PI / 2;
const TARGET_HEADING = Math.PI / 2;
const WALK_SPEED = 0.6;
const DT = 1 / 60;

function plan(): BedsideApproachPlan {
  return {
    waypoints: [
      { position: { ...START }, headingRadians: TRAVEL_HEADING },
      { position: { ...TARGET }, headingRadians: TARGET_HEADING },
    ],
    pathViolations: [],
    arrivesAtTarget: true,
    finalPoseErrorMeters: 0,
  };
}

function walking(): BedsideApproachExecution {
  return {
    runId: "footstep-exit-unit",
    physicianActorId: "physician",
    boundGeometryRevision: "geom-test",
    phase: "walking",
    travelledMeters: 0,
    routeLengthMeters: 2,
    prescribedPositionXz: { x: 0, z: 0 },
    headingRadians: TRAVEL_HEADING,
    drive: { locomotion: 1 },
    driveSource: "case_owned_bedside_approach",
    arrivedAtMs: null,
    stoppedSeconds: 0,
    invalidationReason: null,
  };
}

function step(
  execution: BedsideApproachExecution,
  observedX: number,
  extra?: Partial<StepInput>,
): BedsideApproachExecution {
  return stepBedsideApproachExecution({
    execution,
    plan: plan(),
    start: START,
    target: TARGET,
    targetHeadingRadians: TARGET_HEADING,
    travelHeadingRadians: TRAVEL_HEADING,
    observedGeometryRevision: "geom-test",
    supportAccepted: true,
    observedPositionXz: { x: observedX, z: 0 },
    nowMs: 1000,
    deltaSeconds: DT,
    walkSpeedMetersPerSecond: WALK_SPEED,
    settleTurnRateRadiansPerSecond: 1,
    observedHeadingRadians: TRAVEL_HEADING,
    ...extra,
  });
}

describe("footstep-plan exit", () => {
  it("suppresses the band while the clock runs, exits on plan-complete", () => {
    const clock = { clipElapsedS: 0, clipSpanS: 10 };
    // Inside the legacy band (remaining 0.005 < one frame 0.01) the plan holds.
    const held = step(walking(), 2 - 0.005, { footstep: clock });
    expect(held.phase).toBe("walking");
    // Plan-complete clock exits with the legacy settling shape.
    const exited = step(walking(), 1.0, { footstep: { clipElapsedS: 10, clipSpanS: 10 } });
    expect(exited.phase).toBe("settling");
    expect(exited.drive).toEqual({ locomotion: 0 });
    expect(exited.prescribedPositionXz).toEqual({ x: 1.0, z: 0 });
  });

  it("backstops at the target when the plan overshoots", () => {
    const clock = { clipElapsedS: 0, clipSpanS: 10 };
    const exited = step(walking(), 2.05, { footstep: clock });
    expect(exited.phase).toBe("settling");
  });

  it("keeps the legacy band exit byte-for-byte without the clock", () => {
    const out = step(walking(), 2 - WALK_SPEED * DT * 0.5);
    expect(out.phase).toBe("settling");
    expect(out.prescribedPositionXz).toEqual({ x: 2 - WALK_SPEED * DT * 0.5, z: 0 });
  });
});
