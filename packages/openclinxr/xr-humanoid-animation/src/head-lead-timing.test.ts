import { describe, expect, it } from "vitest";
import { Group, Object3D } from "three";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

const LEAD_S = 0.25;
const MAX_YAW = (45 * Math.PI) / 180;
const BODY = 2.0465145552132036;
const TARGET = Math.PI;
const DT = 1 / 30;
const ROUTE = 1.31;

function setSearch(search: string): void {
  (globalThis as unknown as { window?: unknown }).window = { location: { search } };
}

function buildWalkingApproach(input: { travelled: number; route: number; speed: number }) {
  const actorSlot = new Group();
  const head = new Object3D();
  head.name = "head";
  actorSlot.add(head);
  actorSlot.rotation.y = BODY;
  actorSlot.updateMatrixWorld(true);
  const approach = {
    actorSlot,
    leftToe: null,
    rightToe: null,
    floorOriginY: 0,
    contactBandMeters: 0.06,
    walkSpeedMetersPerSecond: input.speed,
    lockArmed: false,
    lastHeelMissM: null,
    steppingTurnEnabled: false,
    steppingTurn: null,
    stopSettleBlendT: null,
    execution: {
      phase: "walking",
      routeLengthMeters: input.route,
      travelledMeters: input.travelled,
      drive: { locomotion: 0 },
    },
    intent: { target: { headingRadians: TARGET } },
  };
  return { approach, head };
}

function buildSettlingApproach() {
  const actorSlot = new Group();
  const head = new Object3D();
  head.name = "head";
  actorSlot.add(head);
  actorSlot.rotation.y = BODY;
  actorSlot.updateMatrixWorld(true);
  const approach = {
    actorSlot,
    leftToe: null,
    rightToe: null,
    floorOriginY: 0,
    contactBandMeters: 0.06,
    walkSpeedMetersPerSecond: 0.77,
    lockArmed: false,
    lastHeelMissM: null,
    steppingTurnEnabled: false,
    steppingTurn: null,
    stopSettleBlendT: null,
    clipTurn: { pin: { left: { anchorXz: null, weight: 0 }, right: { anchorXz: null, weight: 0 } } },
    execution: {
      phase: "settling",
      routeLengthMeters: 1.31,
      travelledMeters: 1.31,
      drive: { locomotion: 0 },
    },
    intent: { target: { headingRadians: TARGET } },
  };
  return { approach, head };
}

describe("head-lead timed anticipation", () => {
  it("fresh walk applies no head lead (realized speed still unknown)", () => {
    setSearch("?steppingTurn=1&footstepPlan=1&fixedClock=1");
    const { approach, head } = buildWalkingApproach({ travelled: 0, route: ROUTE, speed: 0.77 });
    applyCaseOwnedStanceLock(approach as never, DT);
    expect(head.rotation.y).toBeCloseTo(0, 6);
  });

  it("stays at zero where the nominal estimator would already ramp", () => {
    // 37 frames at 0.029 m/frame: realized speed is exactly 0.87 m/s, so the
    // remaining 0.237 m reads as 0.272 s (> LEAD_S) and the weight is exactly
    // 0. The round-1 nominal estimator (1.37 m/s) would read 0.173 s and ramp
    // to ~11 deg here, so this case distinguishes the two estimators.
    setSearch("?steppingTurn=1&footstepPlan=1&fixedClock=1");
    const built = buildWalkingApproach({ travelled: 0, route: ROUTE, speed: 0.77 });
    const exec = built.approach.execution;
    for (let frame = 0; frame < 37; frame += 1) {
      built.head.rotation.y = 0;
      if (frame > 0) exec.travelledMeters += 0.029;
      applyCaseOwnedStanceLock(built.approach as never, DT);
    }
    expect(built.head.rotation.y).toBeCloseTo(0, 6);
  });

  it("at remaining LEAD_S/2 of realized time applies about half the bounded delta", () => {
    // 30 history frames seed the datum (start 0, elapsed E), then the final
    // frame jumps travelled to exactly T with (ROUTE - T) / ((T - 0) / Ef) =
    // LEAD_S / 2, so the weight is smoothstep(0.5) = 0.5 up to float error.
    setSearch("?steppingTurn=1&footstepPlan=1&fixedClock=1");
    const built = buildWalkingApproach({ travelled: 0, route: ROUTE, speed: 0.77 });
    const exec = built.approach.execution;
    let elapsed = 0;
    for (let frame = 0; frame < 30; frame += 1) {
      built.head.rotation.y = 0;
      if (frame > 0) exec.travelledMeters += 0.03;
      applyCaseOwnedStanceLock(built.approach as never, DT);
      elapsed += DT;
    }
    const ef = elapsed + DT;
    exec.travelledMeters = (ROUTE * ef) / (ef + LEAD_S / 2);
    built.head.rotation.y = 0;
    applyCaseOwnedStanceLock(built.approach as never, DT);
    expect(built.head.rotation.y).toBeCloseTo(MAX_YAW * 0.5, 4);
  });

  it("settling applies the full bounded delta", () => {
    setSearch("?steppingTurn=1&footstepPlan=1&fixedClock=1");
    const { approach, head } = buildSettlingApproach();
    applyCaseOwnedStanceLock(approach as never, 1 / 30);
    expect(head.rotation.y).toBeCloseTo(MAX_YAW, 6);
  });

  it("flag-absent walking applies the full bounded delta, bit-identical across runs", () => {
    setSearch("?steppingTurn=1");
    const first = buildWalkingApproach({ travelled: 0, route: 1.31, speed: 0.77 });
    const second = buildWalkingApproach({ travelled: 0, route: 1.31, speed: 0.77 });
    applyCaseOwnedStanceLock(first.approach as never, 1 / 30);
    applyCaseOwnedStanceLock(second.approach as never, 1 / 30);
    expect(first.head.rotation.y).toBeCloseTo(MAX_YAW, 6);
    expect(second.head.rotation.y).toBe(first.head.rotation.y);
  });
});
