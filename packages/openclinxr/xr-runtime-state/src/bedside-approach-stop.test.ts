import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import { describe, expect, it } from "vitest";
import {
  type BedsideApproachExecution,
  stepBedsideApproachExecution,
} from "./bedside-approach-execution-mod.js";
import { buildDistanceCurve, type StopClipTrigger } from "./bedside-approach-stop-mod.js";

/**
 * The distance-indexed stop handoff: R-range entry with no stance gate, procedural stopping
 * advance at the clip's own path speed, monotone clip time, and byte-for-byte legacy
 * behaviour without a stop clip.
 */

const START = { x: 0, y: 0, z: 0 };
const TARGET = { x: 3, y: 0, z: 0 };
const TRAVEL_HEADING = Math.PI / 2;
const TARGET_HEADING = Math.PI;
const WALK_SPEED = 0.75;
const DT = 1 / 60;
const TRACK = [
  { t: 0, x: 0, z: 0 },
  { t: 5.5, x: 0, z: 2.5 },
];
const PATH_SPEED = 2.5 / 5.5;

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
  const distCurve = buildDistanceCurve(TRACK, 0);
  return {
    clipName: "openclinxr_retarget_kimodo_stop_unit",
    durationSeconds: 5.5,
    rootTrackXz: TRACK.map((key) => ({ ...key })),
    routeYawRadians: TRAVEL_HEADING,
    distCurve,
    tEarliestS: 0,
    rMaxM: distCurve[0]?.r ?? 0,
    // R at the decel onset (t = 2.0): the path from 2.0 to 5.5.
    rDecelM: (2.5 * 3.5) / 5.5,
    decelOnsetS: 2.0,
    holdOnsetS: 4.5,
  };
}

function step(input: {
  execution: BedsideApproachExecution;
  observedPositionXz?: { x: number; z: number };
  stop?: StopClipTrigger | null;
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
  });
}

describe("the distance-indexed stop handoff", () => {
  it("fires as soon as remaining fits inside R, with no stance gate", () => {
    const next = step({
      execution: execution(),
      observedPositionXz: { x: 1, z: 0 },
      stop: stop(),
    });
    expect(next.phase).toBe("stopping");
    expect(next.prescribedPositionXz).toEqual({ x: 1, z: 0 });
    expect(next.stopTriggerXz).toEqual({ x: 1, z: 0 });
    expect(next.stopElapsedSeconds).toBe(0);
    // R^-1(2.0) on a 2.5 m / 5.5 s straight track: t = 1.1.
    expect(next.stopClipTimeS ?? NaN).toBeCloseTo(1.1, 9);
    expect(next.drive).toEqual({ locomotion: 1 });
    expect(next.headingRadians).toBe(TRAVEL_HEADING);
  });

  it("keeps walking while remaining exceeds Rmax", () => {
    const next = step({
      execution: execution(),
      observedPositionXz: { x: 0.2, z: 0 },
      stop: stop(),
    });
    expect(next.phase).toBe("walking");
    expect(next.prescribedPositionXz.x).toBeCloseTo(0.2 + WALK_SPEED * DT, 9);
    expect(next.stopElapsedSeconds ?? 0).toBe(0);
  });

  it("stays legacy on a route too short to fit the deceleration", () => {
    const next = step({
      execution: execution(),
      observedPositionXz: { x: 2, z: 0 },
      stop: stop(),
    });
    expect(next.phase).toBe("walking");
  });

  it("advances the slot procedurally at the clip path speed mid-stop", () => {
    // Consistent mid-stop state: clip time 1.0 with remaining R(1.0), so the re-derived
    // time agrees with the procedural advance exactly.
    const atT1 = 3 - (2.5 * 4.5) / 5.5;
    const next = stepBedsideApproachExecution({
      execution: execution({ phase: "stopping", stopElapsedSeconds: 1, stopClipTimeS: 1, stopTriggerXz: { x: atT1, z: 0 } }),
      plan: plan(),
      start: START,
      target: TARGET,
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
      observedPositionXz: { x: atT1, z: 0 },
      nowMs: 2000,
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: WALK_SPEED,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
      stop: stop(),
    });
    expect(next.phase).toBe("stopping");
    expect(next.stopElapsedSeconds ?? 0).toBeCloseTo(1 + DT, 9);
    // Clip time re-derived from the new remaining agrees with the procedural advance.
    expect(next.stopClipTimeS ?? NaN).toBeCloseTo(1 + DT, 9);
    expect(next.prescribedPositionXz.x).toBeCloseTo(atT1 + PATH_SPEED * DT, 9);
    expect(next.prescribedPositionXz.z).toBeCloseTo(0, 9);
    expect(next.headingRadians).toBe(TRAVEL_HEADING);
  });

  it("never rewinds the clip time on a noisy observed position", () => {
    const next = step({
      execution: execution({ phase: "stopping", stopElapsedSeconds: 2, stopClipTimeS: 2, stopTriggerXz: { x: 1, z: 0 } }),
      observedPositionXz: { x: 0.5, z: 0 },
      stop: stop(),
    });
    expect(next.phase).toBe("stopping");
    expect(next.stopClipTimeS ?? NaN).toBe(2);
  });

  it("enters settling at the hold with the legacy snapshot", () => {
    const next = stepBedsideApproachExecution({
      execution: execution({
        phase: "stopping",
        stopElapsedSeconds: 2,
        stopClipTimeS: 4.6,
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

  it("enters settling at the clip end", () => {
    const ending = stepBedsideApproachExecution({
      execution: execution({ phase: "stopping", stopElapsedSeconds: 3, stopClipTimeS: 5.5, stopTriggerXz: { x: 1, z: 0 } }),
      plan: plan(),
      start: START,
      target: TARGET,
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
      observedPositionXz: { x: 2, z: 0 },
      nowMs: 7000,
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: WALK_SPEED,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
      stop: { ...stop(), holdOnsetS: 99 },
    });
    expect(ending.phase).toBe("settling");
  });

  it("ends the walk as before within one frame of the target, stop or not", () => {
    const atTarget = { x: 3 - WALK_SPEED * DT / 2, z: 0 };
    const next = step({ execution: execution(), observedPositionXz: atTarget, stop: stop() });
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

  it("freezes rather than inventing motion when the clip is gone mid-stop", () => {
    const next = step({
      execution: execution({ phase: "stopping", stopElapsedSeconds: 1, stopTriggerXz: { x: 1, z: 0 } }),
      observedPositionXz: { x: 1, z: 0 },
    });
    expect(next.phase).toBe("stopping");
    expect(next.drive).toEqual({ locomotion: 0 });
  });
});
