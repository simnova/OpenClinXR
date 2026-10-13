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
type FootstepExitInput = NonNullable<StepInput["footstepExit"]>;

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

/**
 * Footstep-plan S2c M2 phase exit, through the public entrypoint.
 *
 * With footstepExit armed, the walk exits at the k-th feet-passing clip
 * phase even when the distance band would have fired first (the D2
 * regression: band-first exits mid-stride); without it the legacy band is
 * byte-for-byte. Clip phases mirror the committed SC-05 passings
 * (L 0.55 s, R 1.38 s, cycle 1.70833 s).
 */

const PASS_START_S = 0.55;
const PASS_R_S = 1.38;
const PASS_CYCLE_S = 1.70833;

function footstepExit(over: Partial<FootstepExitInput> = {}): FootstepExitInput {
  return {
    steps: 3,
    startPhaseS: PASS_START_S,
    rPassingS: PASS_R_S,
    cycleS: PASS_CYCLE_S,
    clipTimeS: PASS_START_S,
    ...over,
  };
}

function stepInput(
  execution: BedsideApproachExecution,
  observed: { x: number; z: number },
  step: number,
  extra: Partial<StepInput> = {},
): StepInput {
  return {
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
    ...extra,
  };
}

/** k=3 target: R + one cycle = 1.38 + 1.70833 = 3.08833 (one wrap crossed). */
const K3_TARGET = PASS_R_S + PASS_CYCLE_S;

function runToPhaseExit(clipRate: number, exit: FootstepExitInput): { exitClipTime: number; steps: number } {
  let execution = walking();
  let observed = { x: START.x, z: START.z };
  for (let step = 0; step < 2000; step += 1) {
    const out = stepBedsideApproachExecution(
      stepInput(execution, observed, step, {
        footstepExit: { ...exit, clipTimeS: PASS_START_S + step * DT * clipRate },
      }),
    );
    execution = out;
    observed = { ...out.prescribedPositionXz };
    if (out.phase === "settling") {
      return { exitClipTime: PASS_START_S + step * DT * clipRate, steps: step + 1 };
    }
  }
  throw new Error("phase exit never fired");
}

describe("footstep phase walk exit", () => {
  it("exits at the k-th passing (k=3, one wrap) rather than the band", () => {
    // Route 2 m at 0.6 m/s: the band would fire near step 200; the 3rd
    // passing (unwrapped target 3.08833) lands at loop step 153, i.e. 154
    // calls. The mock clip never wraps; the target is unwrapped either way.
    const { exitClipTime, steps } = runToPhaseExit(1, footstepExit());
    expect(steps).toBe(154);
    expect(exitClipTime).toBeCloseTo(K3_TARGET, 1);
  });

  it("skips the band when remaining hits zero before the passing (D2)", () => {
    // Short route: the band is in reach from step ~99, but the exit must
    // wait for the 3rd passing at step 153 (phase test, not distance).
    const shortPlan: BedsideApproachPlan = {
      waypoints: [
        { position: { ...START }, headingRadians: TRAVEL_HEADING },
        { position: { x: 1, y: 0, z: 0 }, headingRadians: TARGET_HEADING },
      ],
      pathViolations: [],
      arrivesAtTarget: true,
      finalPoseErrorMeters: 0,
    };
    let execution = walking();
    let observed = { x: START.x, z: START.z };
    for (let step = 0; step < 2000; step += 1) {
      const out = stepBedsideApproachExecution(
        stepInput(execution, observed, step, {
          plan: shortPlan,
          target: { x: 1, y: 0, z: 0 },
          footstepExit: { ...footstepExit(), clipTimeS: PASS_START_S + step * DT },
        }),
      );
      execution = out;
      observed = { ...out.prescribedPositionXz };
      if (out.phase === "settling") {
        // Band would have fired at step ~99; phase holds to step 154.
        expect(step + 1).toBe(154);
        return;
      }
    }
    throw new Error("phase exit never fired on the short route");
  });

  it("never fires on the initialising read, even past the target", () => {
    const out = stepBedsideApproachExecution(
      stepInput(walking(), { x: 0, z: 0 }, 0, {
        footstepExit: footstepExit({ clipTimeS: K3_TARGET + 1 }),
      }),
    );
    expect(out.phase).toBe("walking");
  });

  it("falls back to the band when the plan count is unusable", () => {
    const out = stepBedsideApproachExecution(
      stepInput(walking(), { x: 2 - WALK_SPEED * DT * 0.5, z: 0 }, 0, {
        footstepExit: footstepExit({ steps: 0 }),
      }),
    );
    expect(out.phase).toBe("settling");
    expect(out.prescribedPositionXz).toEqual({ x: 2 - WALK_SPEED * DT * 0.5, z: 0 });
  });

  it("backstops a stranded walk after the substep bound", () => {
    let execution = walking();
    let observed = { x: START.x, z: START.z };
    // Frozen clip mid-walk: the phase never arrives; the backstop ends it.
    for (let step = 0; step < 700; step += 1) {
      const out = stepBedsideApproachExecution(
        stepInput(execution, observed, step, {
          footstepExit: footstepExit({ clipTimeS: 0.6 }),
        }),
      );
      execution = out;
      observed = { ...out.prescribedPositionXz };
      if (out.phase === "settling") {
        expect(step + 1).toBe(600);
        return;
      }
    }
    throw new Error("backstop never fired");
  });
});
