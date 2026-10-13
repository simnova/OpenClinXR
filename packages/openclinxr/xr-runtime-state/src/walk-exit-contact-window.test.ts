import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import { describe, expect, it } from "vitest";
import {
  type BedsideApproachExecution,
  stepBedsideApproachExecution,
} from "./bedside-approach-execution.js";

/**
 * Contact-window walk exit, through the public entrypoint.
 *
 * With walkExit labels supplied, the walk ends only inside a single-support
 * window for a sweep of clip-time start offsets; without them the legacy
 * frame-band exit is byte-for-byte. Types derive from the entrypoint
 * (Parameters<>), never from the internal window module.
 */

type StepInput = Parameters<typeof stepBedsideApproachExecution>[0];
type WalkExitInput = NonNullable<StepInput["walkExit"]>;

const START = { x: 0, y: 0, z: 0 };
const TARGET = { x: 2, y: 0, z: 0 };
const TRAVEL_HEADING = Math.PI / 2;
const TARGET_HEADING = Math.PI / 2;
const WALK_SPEED = 0.6;
const DT = 1 / 60;

/** 1 s cycle, 10 samples: left-only [0,0.4), double [0.4,0.6), right-only [0.6,1.0). */
function labels(): Omit<WalkExitInput, "clipTimeSeconds"> {
  return {
    cycleSeconds: 1,
    atMs: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    left: [true, true, true, true, true, false, false, false, false, false],
    right: [false, false, false, false, true, true, true, true, true, false],
  };
}

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
    runId: "walk-exit-unit",
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

function isSingleAt(labelsInput: Omit<WalkExitInput, "clipTimeSeconds">, t: number): boolean {
  const count = labelsInput.atMs.length;
  const wrapped = ((t % 1) + 1) % 1;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const sampleTime = (labelsInput.atMs[index] ?? 0) / 1000;
    const direct = Math.abs(sampleTime - wrapped);
    const distance = Math.min(direct, 1 - direct);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return (labelsInput.left[best] ?? false) !== (labelsInput.right[best] ?? false);
}

function runToSettling(clipOffset: number, gated: boolean): { exitClipTime: number; steps: number } {
  const shared = labels();
  let execution = walking();
  let observed = { x: START.x, z: START.z };
  // The mock mixer advances one clip second per sim second from the offset.
  for (let step = 0; step < 2000; step += 1) {
    const clipTime = clipOffset + step * DT;
    const out = stepBedsideApproachExecution({
      execution,
      plan: plan(),
      start: START,
      target: TARGET,
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
      observedPositionXz: observed,
      nowMs: 1000 + step * (DT * 1000),
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: WALK_SPEED,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
      ...(gated ? { walkExit: { ...shared, clipTimeSeconds: clipTime } } : {}),
    });
    execution = out;
    observed = { ...out.prescribedPositionXz };
    if (out.phase === "settling") return { exitClipTime: clipTime, steps: step + 1 };
  }
  throw new Error(`never settled (offset=${clipOffset}, gated=${gated})`);
}

describe("contact-window walk exit", () => {
  it("lands inside a single-support window for a sweep of clip start offsets", () => {
    const shared = labels();
    for (let k = 0; k < 20; k += 1) {
      const offset = k / 20;
      const { exitClipTime } = runToSettling(offset, true);
      expect(
        isSingleAt(shared, exitClipTime),
        `offset ${offset}: exit clip ${exitClipTime.toFixed(4)} s outside a single window`,
      ).toBe(true);
    }
  });

  it("exits within one substep of the legacy point when already in window", () => {
    // Offset 0.5 arms at clip frac ~0.82 (right-only): gated and legacy exit together.
    const legacy = runToSettling(0.5, false);
    const gated = runToSettling(0.5, true);
    expect(Math.abs(gated.steps - legacy.steps)).toBeLessThanOrEqual(1);
  });

  it("waits past the legacy point when arming inside double support", () => {
    // Offset 0.1 arms at clip frac ~0.42 (double): legacy exits, gated waits
    // for the 0.55 right-only opening.
    const legacy = runToSettling(0.1, false);
    const gated = runToSettling(0.1, true);
    expect(gated.steps).toBeGreaterThan(legacy.steps);
    expect(isSingleAt(labels(), gated.exitClipTime)).toBe(true);
  });

  it("keeps the legacy exit byte-for-byte without walkExit", () => {
    const execution = walking();
    const out = stepBedsideApproachExecution({
      execution,
      plan: plan(),
      start: START,
      target: TARGET,
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
      observedPositionXz: { x: 2 - WALK_SPEED * DT * 0.5, z: 0 },
      nowMs: 1000,
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: WALK_SPEED,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
    });
    expect(out.phase).toBe("settling");
    expect(out.prescribedPositionXz).toEqual({ x: 2 - WALK_SPEED * DT * 0.5, z: 0 });
  });
});
