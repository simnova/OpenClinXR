import type { BedsideApproachPlan } from "@openclinxr/asset-registry/bedside-approach-path";
import { describe, expect, it } from "vitest";
import {
  type BedsideApproachExecution,
  stepBedsideApproachExecution,
} from "./bedside-approach-execution.js";

/**
 * Late two-half correction (M3) plus the G6 probe legs, through the public
 * entrypoint. Types derive from the entrypoint (Parameters<>), never from
 * the internal phase module.
 *
 * The sim drives observed slot motion from a TRUTH model (per-foot halves
 * at the plan scale) while the executor predicts and corrects from the
 * STRUCT coefficients: that split is exactly the plan-time-error /
 * runtime-truth split the correction exists for. Clip phases mirror the
 * committed SC-05 passings (L 0.55 s, R 1.38 s, cycle 1.70833 s); the M1
 * affine literals are pinned in the xr-humanoid-animation schedule test.
 */

type StepInput = Parameters<typeof stepBedsideApproachExecution>[0];
type FootstepExitInput = NonNullable<StepInput["footstepExit"]>;
type PassingState = NonNullable<NonNullable<StepInput["execution"]>["footstep"]>;
type PassingEntry = NonNullable<PassingState["lastPassing"]>;

const PASS_START_S = 0.55;
const PASS_R_S = 1.38;
const PASS_CYCLE_S = 1.70833;
const DT = 1 / 60;
/** Walk-clip play rate, substeps per clip second (approx: ~2.5 clip-s over 45 frames in captures). */
const CLIP_RATE = 1.65;
/** M1 fit literals (TRUE model in every sim here; the G6 seed lives in the plan k/scale only). */
const A_R = 0.4749;
const B_R = 0.0768;
const A_L = 0.3152;
const B_L = 0.262;

const TRAVEL_HEADING = Math.PI / 2;
const TARGET_HEADING = Math.PI / 2;

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
    runId: "footstep-phase-sim",
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

function truthHalf(halfIndex: number, scale: number): number {
  // Half i (1-based) ends R for odd i, L for even i (L-passing walk start).
  return halfIndex % 2 === 1 ? A_R * scale + B_R : A_L * scale + B_L;
}

function passingClip(halfIndex: number): number {
  // Unwrapped clip seconds of the halfIndex-th passing after walk start.
  const fullCycles = Math.floor(halfIndex / 2);
  return halfIndex % 2 === 1 ? PASS_R_S + fullCycles * PASS_CYCLE_S : PASS_START_S + fullCycles * PASS_CYCLE_S;
}

function makeExit(over: Partial<FootstepExitInput> = {}): FootstepExitInput {
  return {
    steps: 3,
    startPhaseS: PASS_START_S,
    rPassingS: PASS_R_S,
    cycleS: PASS_CYCLE_S,
    clipTimeS: PASS_START_S,
    aEndR: A_R,
    bEndR: B_R,
    aEndL: A_L,
    bEndL: B_L,
    planScale: 0.707,
    ...over,
  };
}

type SimResult = {
  arrival: number;
  passings: PassingEntry[];
  correctScales: number[];
  clamped: boolean[];
  recounts: number;
  trips: string[];
  steps: number;
};

/** Walk the route on truth halves at the plan scale; the executor sees clip + observed only. */
function simulateWalk(input: {
  routeLength: number;
  planSteps: number;
  planScale: number;
  skipCorrection: boolean;
  /** Uniform bias added to every truth half (world-model mismatch probe). */
  truthBiasM?: number;
}): SimResult {
  const bias = input.truthBiasM ?? 0;
  let execution = walking(input.routeLength);
  let observedX = 0;
  const passings: PassingEntry[] = [];
  const correctScales: number[] = [];
  const clamped: boolean[] = [];
  const trips: string[] = [];
  let recounts = 0;
  let lastScale = input.planScale;
  let steps = 0;
  for (let step = 0; step < 3000; step += 1) {
    const clipTime = PASS_START_S + step * DT * CLIP_RATE;
    const out = stepBedsideApproachExecution({
      execution,
      plan: planFor(input.routeLength),
      start: { x: 0, y: 0, z: 0 },
      target: { x: input.routeLength, y: 0, z: 0 },
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
        steps: input.planSteps,
        clipTimeS: clipTime,
        planScale: lastScale,
        ...(input.skipCorrection ? { skipLateCorrection: true } : {}),
      }),
    });
    execution = out;
    const state = out.footstep ?? null;
    if (state?.lastPassing !== null && state?.lastPassing !== undefined) {
      passings.push(state.lastPassing);
    }
    if (state?.correct !== null && state?.correct !== undefined) {
      correctScales.push(state.correct.scale);
      clamped.push(state.correct.clamped);
      lastScale = state.correct.scale;
      if (state.correct.recounted) recounts += 1;
    }
    if (state?.safetyTrip !== null && state?.safetyTrip !== undefined) {
      // Trips persist in cross-step state (the frame drains them once via
      // the drained flag); record each distinct trip once per walk.
      if (trips[trips.length - 1] !== state.safetyTrip.reason) trips.push(state.safetyTrip.reason);
    }
    steps = step + 1;
    if (out.phase !== "walking") break;
    // Truth advance for this substep, distributed by clip overlap across
    // the halves the substep's clip interval touches: a substep straddling
    // a passing must not overfill the half it leaves (11 mm error when the
    // whole substep is billed to the entered half).
    const c0 = clipTime;
    const c1 = clipTime + DT * CLIP_RATE;
    for (let half = 1; half <= input.planSteps + 10; half += 1) {
      const spanStart = half === 1 ? PASS_START_S : passingClip(half - 1);
      const spanEnd = passingClip(half);
      const overlap = Math.min(c1, spanEnd) - Math.max(c0, spanStart);
      if (overlap > 0) observedX += ((truthHalf(half, lastScale) + bias) * overlap) / (spanEnd - spanStart);
    }
  }
  if (execution.phase === "walking") throw new Error("sim never exited the walk");
  return { arrival: input.routeLength - observedX, passings, correctScales, clamped, recounts, trips, steps };
}

describe("late two-half correction", () => {
  it("fires once at the antepenultimate passing and holds a true model", () => {
    // 1.31 m, k=3 at 0.7070, truth == model: the correction solves ~the
    // seed scale and arrival is substep quantization.
    const sim = simulateWalk({ routeLength: 1.31, planSteps: 3, planScale: 0.707, skipCorrection: false });
    expect(sim.correctScales.length).toBe(1);
    expect(sim.correctScales[0]!).toBeCloseTo(0.7071, 2);
    expect(sim.recounts).toBe(0);
    expect(sim.arrival).toBeLessThan(0.01);
    expect(sim.passings.length).toBe(3);
    // r_1 against the seed plan is ~zero when the model is exact.
    expect(Math.abs(sim.passings[0]!.residualM)).toBeLessThan(0.005);
  });

  it("G6 off-leg (2 m): seeded plan without correction arrives >= 0.10 short", () => {
    // ?footstepProbeModel=1.2 plans 2.0 m as k=3 at 0.989 (pinned in the
    // schedule test); truth halves at that scale total ~1.667 m.
    const sim = simulateWalk({ routeLength: 2.0, planSteps: 3, planScale: 0.989, skipCorrection: true });
    expect(sim.arrival).toBeGreaterThanOrEqual(0.1);
    expect(sim.passings.length).toBe(3);
    // r_1 shows the error: remaining exceeds the seed plan's prediction.
    expect(sim.passings[0]!.residualM).toBeGreaterThan(0.25);
  });

  it("G6 on-leg (2 m): correction recovers the seeded plan via recount", () => {
    const sim = simulateWalk({ routeLength: 2.0, planSteps: 3, planScale: 0.989, skipCorrection: false });
    expect(sim.recounts).toBe(1);
    expect(sim.arrival).toBeLessThan(0.033);
    expect(sim.passings[0]!.residualM).toBeGreaterThan(0.25);
    expect(Math.abs(sim.passings[sim.passings.length - 1]!.residualM)).toBeLessThan(0.033);
  });

  it("G6 legs (6 m): seeded plan k=9, off-leg ~1.0 short, on-leg recovers", () => {
    // ?footstepProbeModel=1.2 plans 6.0 m as k=9 at 0.9815 (schedule test).
    const off = simulateWalk({ routeLength: 6.0, planSteps: 9, planScale: 0.9815, skipCorrection: true });
    expect(off.arrival).toBeGreaterThanOrEqual(0.1);
    expect(off.passings[0]!.residualM).toBeGreaterThan(0.5);
    const on = simulateWalk({ routeLength: 6.0, planSteps: 9, planScale: 0.9815, skipCorrection: false });
    expect(on.recounts).toBe(1);
    expect(on.arrival).toBeLessThan(0.033);
  });

  it("deadband: a solve 13 mm under the floor clamps to 0.7 without recount", () => {
    // Reland fix for the M3 regression: truth halves 20 mm long move R_1
    // to 0.877 (s* = 0.681), inside the quantization deadband. The walk
    // holds k=3 at the clamped 0.7 and still arrives feet-together.
    const sim = simulateWalk({
      routeLength: 1.31,
      planSteps: 3,
      planScale: 0.707,
      skipCorrection: false,
      truthBiasM: 0.02,
    });
    expect(sim.correctScales.length).toBe(1);
    expect(sim.correctScales[0]!).toBe(0.7);
    expect(sim.clamped).toEqual([true]);
    expect(sim.recounts).toBe(0);
    expect(sim.trips).toEqual([]);
    expect(sim.arrival).toBeLessThan(0.033);
  });

  it("give-up: no recount fits, the walk holds the phase exit and fails loud", () => {
    // Truth halves 150 mm long: no (k', s') covers R_1, and R_1 stays far
    // above the exit-now bound. The walk continues to the k-th passing
    // (single terminator) with a loud correction-gave-up trip.
    const sim = simulateWalk({
      routeLength: 1.31,
      planSteps: 3,
      planScale: 0.707,
      skipCorrection: false,
      truthBiasM: 0.15,
    });
    expect(sim.correctScales).toEqual([]);
    expect(sim.recounts).toBe(0);
    expect(sim.trips).toEqual(["correction-gave-up"]);
    expect(sim.passings.length).toBe(3);
  });
});
