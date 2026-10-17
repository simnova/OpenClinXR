import { describe, expect, it } from "vitest";
import { Group, Object3D } from "three";
import { applyCaseOwnedStanceLock } from "./case-owned-approach-runtime.js";

const LEAD_S = 0.35;
const MAX_YAW = (45 * Math.PI) / 180;
const BODY = 2.0465145552132036;
const TARGET = Math.PI;

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
  it("walking with remaining time > LEAD_S applies no head lead", () => {
    setSearch("?steppingTurn=1&footstepPlan=1&fixedClock=1");
    const { approach, head } = buildWalkingApproach({ travelled: 0, route: 1.31, speed: 0.77 });
    applyCaseOwnedStanceLock(approach as never, 1 / 30);
    expect(head.rotation.y).toBeCloseTo(0, 6);
  });

  it("walking at remaining LEAD_S/2 applies about half the bounded delta", () => {
    setSearch("?steppingTurn=1&footstepPlan=1&fixedClock=1");
    const speed = 0.77;
    const route = 1.31;
    const travelled = route - speed * (LEAD_S / 2);
    const { approach, head } = buildWalkingApproach({ travelled, route, speed });
    applyCaseOwnedStanceLock(approach as never, 1 / 30);
    expect(head.rotation.y).toBeCloseTo(MAX_YAW * 0.5, 2);
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
