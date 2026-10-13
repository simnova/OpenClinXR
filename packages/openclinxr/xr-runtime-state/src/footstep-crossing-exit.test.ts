import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import { describe, expect, it } from "vitest";
import {
  type BedsideApproachExecution,
  stepBedsideApproachExecution,
} from "./bedside-approach-execution.js";

/**
 * M2 toe-crossing exit (exit-phase-per-foot), through the public
 * entrypoint. Types derive from the entrypoint (Parameters<>), never from
 * the internal crossing module.
 *
 * The frame module raises `toeCrossed` on the route-axis R-L separation
 * sign flip; the executor fires from that event during the planned last
 * half only. Clip phases mirror the committed SC-05 passings (L 0.55 s,
 * R 1.38 s, cycle 1.70833 s). The correction is skipped throughout (its
 * own suite covers it), so the plan scale never moves under these sims.
 */

type StepInput = Parameters<typeof stepBedsideApproachExecution>[0];
type FootstepExitInput = NonNullable<StepInput["footstepExit"]>;

const PASS_START_S = 0.55;
const PASS_R_S = 1.38;
const PASS_CYCLE_S = 1.70833;
const DT = 1 / 60;
const CLIP_RATE = 1.65;
const A_R = 0.4749;
const B_R = 0.0768;
const A_L = 0.3152;
const B_L = 0.262;

const TRAVEL_HEADING = Math.PI / 2;
const TARGET_HEADING = Math.PI / 2;
const ROUTE_M = 10;

function planFor(routeLength: number): BedsideApproachPlan {
  return {
    waypoints: [
      { position: { x: 0, y: 0, z: 0 }, headingRadians: TRAVEL_HEADING },
      { position: { x: routeLength, y: 0, z: 0 }, headingRadians: TARGET_HEADING },
    ],
    pathViolations: [],
    arrivesAtTarget: true,
    finalPoseErrorMeters: 0,
  };
}

function walking(routeLength: number): BedsideApproachExecution {
  return {
    runId: "footstep-crossing-sim",
    physicianActorId: "physician",
    boundGeometryRevision: "geom-test",
    phase: "walking",
    travelledMeters: 0,
    routeLengthMeters: routeLength,
    prescribedPositionXz: { x: 0, z: 0 },
    headingRadians: TRAVEL_HEADING,
    drive: { locomotion: 1 },
    driveSource: "case_owned_bedside_approach",
    arrivedAtMs: null,
    stoppedSeconds: 0,
    invalidationReason: null,
  };
}

function makeExit(over: Partial<FootstepExitInput> = {}): FootstepExitInput {
  return {
    steps: 2,
    startPhaseS: PASS_START_S,
    rPassingS: PASS_R_S,
    cycleS: PASS_CYCLE_S,
    clipTimeS: PASS_START_S,
    aEndR: A_R,
    bEndR: B_R,
    aEndL: A_L,
    bEndL: B_L,
    planScale: 0.8,
    skipLateCorrection: true,
    ...over,
  };
}

type CrossSim = {
  exitStep: number | null;
  exitClip: number | null;
  phases: string[];
};

/**
 * Step the executor with a scripted toeCrossed event. flipAt lists the
 * zero-based step indices raising the event; clip advances at CLIP_RATE
 * and the observed slot at walk speed, so remaining stays far above every
 * band and only the footstep terminator can fire.
 */
function simulateCrossing(input: {
  steps: number;
  flipAt: number[];
  delay?: number;
}): CrossSim {
  let execution = walking(ROUTE_M);
  let observedX = 0;
  const phases: string[] = [];
  let exitStep: number | null = null;
  let exitClip: number | null = null;
  for (let step = 0; step < 3000; step += 1) {
    const clipTime = PASS_START_S + step * DT * CLIP_RATE;
    const out = stepBedsideApproachExecution({
      execution,
      plan: planFor(ROUTE_M),
      start: { x: 0, y: 0, z: 0 },
      target: { x: ROUTE_M, y: 0, z: 0 },
      targetHeadingRadians: TARGET_HEADING,
      travelHeadingRadians: TRAVEL_HEADING,
      observedGeometryRevision: "geom-test",
      supportAccepted: true,
      observedPositionXz: { x: observedX, z: 0 },
      nowMs: 1000 + step * (DT * 1000),
      deltaSeconds: DT,
      walkSpeedMetersPerSecond: 0.6,
      settleTurnRateRadiansPerSecond: 1,
      observedHeadingRadians: TRAVEL_HEADING,
      footstepExit: makeExit({
        steps: input.steps,
        clipTimeS: clipTime,
        toeCrossed: input.flipAt.includes(step),
        ...(input.delay !== undefined ? { exitDelaySubsteps: input.delay } : {}),
      }),
    });
    execution = out;
    phases.push(out.phase);
    if (out.phase !== "walking" && exitStep === null) {
      exitStep = step;
      exitClip = clipTime;
    }
    if (out.phase !== "walking") break;
    observedX += 0.6 * DT;
  }
  return { exitStep, exitClip, phases };
}

describe("toe-crossing exit", () => {
  it("fires on the last-half flip, far ahead of the phase target", () => {
    // k=2: the last half opens at the R passing (unwrapped 1.38, ~step 30).
    // The flip at step 40 exits there; the phase target (L passing 2.2583,
    // ~step 62) never comes into play.
    const sim = simulateCrossing({ steps: 2, flipAt: [40] });
    expect(sim.exitStep).toBe(40);
    expect(sim.exitClip ?? Number.NaN).toBeLessThan(2.0);
  });

  it("ignores a mid-walk flip and falls back to the phase target", () => {
    // k=3: the flip at step 5 lands in the first half (no passing crossed
    // yet), so the walk continues to the k-th passing at 3.0883 (~step 92).
    const sim = simulateCrossing({ steps: 3, flipAt: [5] });
    expect(sim.exitStep).not.toBeNull();
    expect(sim.exitStep ?? 0).toBeGreaterThan(80);
    expect(sim.exitClip ?? Number.NaN).toBeCloseTo(3.0883, 1);
  });

  it("without any flip the phase target still terminates the walk", () => {
    const sim = simulateCrossing({ steps: 2, flipAt: [] });
    expect(sim.exitStep).not.toBeNull();
    expect(sim.exitClip ?? Number.NaN).toBeCloseTo(2.2583, 1);
  });

  it("delay holds a recorded crossing past the phase target (G4 probe)", () => {
    // k=2, flip 3 substeps ahead of the phase target with delay 6: the
    // target crossing at ~step 62 must not fire early; the exit lands 6
    // substeps after the flip, past the target.
    const targetStep = Math.round((2.2583 - PASS_START_S) / (DT * CLIP_RATE));
    const flip = targetStep - 3;
    const sim = simulateCrossing({ steps: 2, flipAt: [flip], delay: 6 });
    expect(sim.exitStep).toBe(flip + 6);
    expect(sim.exitClip ?? Number.NaN).toBeGreaterThan(2.2583);
  });
});
