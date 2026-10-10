import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import { describe, expect, it } from "vitest";
import {
  type BedsideApproachExecution,
  stepBedsideApproachExecution,
} from "./bedside-approach-execution-mod.js";
import type { StopClipTrigger } from "./bedside-approach-stop-mod.js";

/**
 * The walking-to-stopping handoff: trigger distance, stance-phase match, clip-end transition,
 * and byte-for-byte legacy behaviour without a stop clip.
 */

const START = { x: 0, y: 0, z: 0 };
const TARGET = { x: 3, y: 0, z: 0 };
const TRAVEL_HEADING = Math.PI / 2;
const TARGET_HEADING = Math.PI;
const WALK_SPEED = 0.75;
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

function execution(overrides: Partial<BedsideApproachExecution> = {}): BedsideApproachExecution {
  return {
    runId: "stop-unit",
    physicianActorId: "physician",
    boundGeometryRevision: "geom-test",
    phase: "walking",
    travelledMeters: 0,
    routeLengthMeters: 3,
    prescribedPositionXz: { x: 0, z: 0 },
    headingRadians: TRAVEL_HEADING,
    drive: { locomotion: 1 },
    driveSource: "case_owned_bedside_approach",
    arrivedAtMs: null,
    stoppedSeconds: 0,
    invalidationReason: null,
    ...overrides,
  };
}

function stop(): StopClipTrigger {
  return {
    clipName: "openclinxr_retarget_kimodo_stop_unit",
    displacementMeters: 2.5,
    durationSeconds: 5.5,
    entryStance: { left: true, right: false },
    rootTrackXz: [
      { t: 0, x: 0, z: 0 },
      { t: 5.5, x: 0, z: 2.5 },
    ],
    routeYawRadians: TRAVEL_HEADING,
  };
}

function step(input: {
  execution: BedsideApproachExecution;
  observedPositionXz?: { x: number; z: number };
  stop?: StopClipTrigger | null;
  walkStance?: { left: boolean; right: boolean } | null;
  nowMs?: number;
}): BedsideApproachExecution {
  return stepBedsideApproachExecution({
    execution: input.execution,
    plan: plan(),
    start: START,
    target: TARGET,
    targetHeadingRadians: TARGET_HEADING,
    travelHeadingRadians: TRAVEL_HEADING,
    observedGeometryRevision: "geom-test",
    supportAccepted: true,
    observedPositionXz: input.observedPositionXz ?? { x: 1, z: 0 },
    nowMs: input.nowMs ?? 1000,
    deltaSeconds: DT,
    walkSpeedMetersPerSecond: WALK_SPEED,
    settleTurnRateRadiansPerSecond: 1,
    observedHeadingRadians: TRAVEL_HEADING,
    ...(input.stop ? { stop: input.stop } : {}),
    ...(input.walkStance ? { walkStance: input.walkStance } : {}),
  });
}

describe("the baked stop handoff", () => {
  it("fires at the trigger distance on a matching stance foot", () => {
    const next = step({
      execution: execution(),
      observedPositionXz: { x: 1, z: 0 },
      stop: stop(),
      walkStance: { left: true, right: false },
    });
    expect(next.phase).toBe("stopping");
    expect(next.prescribedPositionXz).toEqual({ x: 1, z: 0 });
    expect(next.stopTriggerXz).toEqual({ x: 1, z: 0 });
    expect(next.stopElapsedSeconds).toBe(0);
    expect(next.drive).toEqual({ locomotion: 1 });
    expect(next.headingRadians).toBe(TRAVEL_HEADING);
  });

  it("keeps walking on a stance mismatch (the residual)", () => {
    const next = step({
      execution: execution(),
      observedPositionXz: { x: 1, z: 0 },
      stop: stop(),
      walkStance: { left: false, right: true },
    });
    expect(next.phase).toBe("walking");
    expect(next.prescribedPositionXz.x).toBeCloseTo(1 + WALK_SPEED * DT, 9);
    expect(next.stopElapsedSeconds ?? 0).toBe(0);
  });

  it("prescribes the clip root travel, rotated into the route, mid-stop", () => {
    const elapsed = 5.4;
    const next = stepBedsideApproachExecution({
      execution: execution({ phase: "stopping", stopElapsedSeconds: elapsed, stopTriggerXz: { x: 1, z: 0 } }),
      plan: plan(),
      start: START,
      target: TARGET,
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
      observedPositionXz: { x: 1, z: 0 },
      nowMs: 2000,
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: WALK_SPEED,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
      stop: stop(),
    });
    expect(next.phase).toBe("stopping");
    const advanced = elapsed + DT;
    expect(next.stopElapsedSeconds ?? 0).toBeCloseTo(advanced, 9);
    expect(next.prescribedPositionXz.x).toBeCloseTo(1 + 2.5 * (advanced / 5.5), 9);
    expect(next.prescribedPositionXz.z).toBeCloseTo(0, 9);
    expect(next.headingRadians).toBe(TRAVEL_HEADING);
  });

  it("enters settling at the clip end with the legacy snapshot", () => {
    const next = stepBedsideApproachExecution({
      execution: execution({
        phase: "stopping",
        stopElapsedSeconds: 5.5 - DT / 2,
        stopTriggerXz: { x: 1, z: 0 },
      }),
      plan: plan(),
      start: START,
      target: TARGET,
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
      observedPositionXz: { x: 3.4, z: 0 },
      nowMs: 7000,
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: WALK_SPEED,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
      stop: stop(),
    });
    expect(next.phase).toBe("settling");
    expect(next.drive).toEqual({ locomotion: 0 });
    expect(next.prescribedPositionXz).toEqual({ x: 3.4, z: 0 });
    expect(next.arrivedAtMs).toBe(7000);
  });

  it("never fires on an entry stance with no planted foot", () => {
    const noEntry: StopClipTrigger = { ...stop(), entryStance: { left: false, right: false } };
    const next = step({
      execution: execution(),
      observedPositionXz: { x: 1, z: 0 },
      stop: noEntry,
      walkStance: { left: false, right: false },
    });
    expect(next.phase).toBe("walking");
  });

  it("ends the walk as before within one frame of the target, stop or not", () => {
    const atTarget = { x: 3 - WALK_SPEED * DT / 2, z: 0 };
    const next = step({ execution: execution(), observedPositionXz: atTarget, stop: stop(), walkStance: { left: true, right: false } });
    expect(next.phase).toBe("settling");
  });

  it("walks byte-for-byte as before with no stop clip", () => {
    const walking = step({ execution: execution(), observedPositionXz: { x: 1, z: 0 } });
    expect(walking.phase).toBe("walking");
    expect(walking.prescribedPositionXz.x).toBeCloseTo(1 + WALK_SPEED * DT, 12);
    expect(walking.drive).toEqual({ locomotion: 1 });
    expect(walking.stopTriggerXz ?? null).toBeNull();
    const ending = step({
      execution: execution(),
      observedPositionXz: { x: 3 - WALK_SPEED * DT / 2, z: 0 },
    });
    expect(ending.phase).toBe("settling");
    expect(ending.prescribedPositionXz.x).toBeCloseTo(3 - WALK_SPEED * DT / 2, 12);
  });

  it("invalidates mid-stop on a geometry change", () => {
    const next = stepBedsideApproachExecution({
      execution: execution({ phase: "stopping", stopElapsedSeconds: 1, stopTriggerXz: { x: 1, z: 0 } }),
      plan: plan(),
      start: START,
      target: TARGET,
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-changed",
      supportAccepted: true,
      observedPositionXz: { x: 1, z: 0 },
      nowMs: 3000,
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: WALK_SPEED,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
      stop: stop(),
    });
    expect(next.phase).toBe("invalidated");
  });
});
