import { describe, expect, it } from "vitest";
import {
  firstStanceResidualXz,
  overridePlanWithBackwardFootfalls,
  planBackwardTurnFootfalls,
  planSteppingTurn,
} from "./stepping-turn.js";

const DEG = Math.PI / 180;
/** Capture-derived SC-05 entry (turn-backward/before run0, frame 45: walk exit). */
const ENTRY_YAW = 2.0471;
const TARGET_YAW = ENTRY_YAW + 62.67 * DEG;
const TARGET_XZ = { x: -0.78, z: 1.14 };
const REST_SEP_M = 0.3364;

/** M1-measured rest fore offset: literal so no new public name is bound (see stepping-turn-plan-mod.test.ts). */
const REST_FORE_M = 0.1166;
function backwardInput(steps: Array<{ swingFoot: "left" | "right"; yawRadians: number }>) {
  return {
    targetXz: { ...TARGET_XZ },
    targetHeadingRadians: TARGET_YAW,
    restSepM: REST_SEP_M,
    steps,
  };
}

function bodyAbout(slot: { x: number; z: number }) {
  return (p: { x: number; z: number }): { lat: number; fore: number } => {
    const dx = p.x - slot.x;
    const dz = p.z - slot.z;
    return {
      lat: dx * Math.cos(TARGET_YAW) - dz * Math.sin(TARGET_YAW),
      fore: dx * Math.sin(TARGET_YAW) + dz * Math.cos(TARGET_YAW),
    };
  };
}

describe("the backward-planned turn footfalls", () => {
  it("puts the final pair's midpoint on the target with each foot on its rest offset", () => {
    const footfalls = planBackwardTurnFootfalls(
      backwardInput([
        { swingFoot: "right", yawRadians: 31.335 * DEG },
        { swingFoot: "left", yawRadians: 31.335 * DEG },
      ]),
    );
    const mid = {
      x: (footfalls.finalLeftXz.x + footfalls.finalRightXz.x) / 2,
      z: (footfalls.finalLeftXz.z + footfalls.finalRightXz.z) / 2,
    };
    expect(mid.x).toBeCloseTo(TARGET_XZ.x, 9);
    expect(mid.z).toBeCloseTo(TARGET_XZ.z, 9);
    const toBody = bodyAbout(footfalls.finalSlotXz);
    const left = toBody(footfalls.finalLeftXz);
    const right = toBody(footfalls.finalRightXz);
    expect(left.lat).toBeCloseTo(REST_SEP_M / 2, 9);
    expect(left.fore).toBeCloseTo(REST_FORE_M, 9);
    expect(right.lat).toBeCloseTo(-REST_SEP_M / 2, 9);
    expect(right.fore).toBeCloseTo(REST_FORE_M, 9);
  });

  it("fails when the fore offset is dropped (the fore probe twin)", () => {
    const footfalls = planBackwardTurnFootfalls({
      ...backwardInput([
        { swingFoot: "right", yawRadians: 31.335 * DEG },
        { swingFoot: "left", yawRadians: 31.335 * DEG },
      ]),
      restForeM: 0,
    });
    const mid = {
      x: (footfalls.finalLeftXz.x + footfalls.finalRightXz.x) / 2,
      z: (footfalls.finalLeftXz.z + footfalls.finalRightXz.z) / 2,
    };
    // Midpoint still on target (shared fore cancels), but the feet sit ON the slot row.
    expect(mid.x).toBeCloseTo(TARGET_XZ.x, 9);
    const left = bodyAbout(footfalls.finalSlotXz)(footfalls.finalLeftXz);
    expect(left.fore).toBeCloseTo(0, 9);
    expect(left.fore).not.toBeCloseTo(REST_FORE_M, 1);
  });

  it("chains step 1's landing onto step 0's ideal-free stance through the real plan split", () => {
    // Yaw split straight from the plan under test (fixedClock SC-05 capture).
    const plan = planSteppingTurn({
      residualYawRadians: TARGET_YAW - ENTRY_YAW,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: TARGET_YAW,
      leftToeXz: { x: -0.8364, z: 1.0436 },
      rightToeXz: { x: -0.7828, z: 1.2118 },
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
      entrySlotXz: { x: -0.78, z: 1.14 },
      legScale: 1,
      restSepM: null,
    });
    expect(plan.steps.length).toBe(2);
    const footfalls = planBackwardTurnFootfalls({
      targetXz: { ...TARGET_XZ },
      targetHeadingRadians: TARGET_YAW,
      restSepM: REST_SEP_M,
      steps: plan.steps.map((s) => ({ swingFoot: s.swingFoot, yawRadians: s.yawRadians })),
    });
    const [first, last] = footfalls.steps;
    if (!first || !last) throw new Error("expected 2 footfall steps");
    // First landing == last stance (the chain that makes step 1 exact).
    expect(first.swingToXz.x).toBeCloseTo(last.stanceXz.x, 12);
    expect(first.swingToXz.z).toBeCloseTo(last.stanceXz.z, 12);
    // Last landing/stanc e == the final pair.
    expect(last.swingToXz.x).toBeCloseTo(footfalls.finalLeftXz.x, 12);
    // Positive residual ends swinging left; last stance is the right foot.
    expect(last.swingFoot).toBe("left");
    expect(last.stanceXz.x).toBeCloseTo(footfalls.finalRightXz.x, 12);
    // The plan override consumes the list: placements and stance (steps >= 1) verbatim,
    // step 0 anchored to the live entry feet.
    const overridden = overridePlanWithBackwardFootfalls(plan, footfalls, {
      stanceXz: { x: -0.8364, z: 1.0436 },
      swingFromXz: { x: -0.7828, z: 1.2118 },
    });
    expect(overridden.steps[1]?.swingToXz.x).toBeCloseTo(last.swingToXz.x, 12);
    expect(overridden.steps[1]?.stanceXz.x).toBeCloseTo(last.stanceXz.x, 12);
    expect(overridden.steps[0]?.stanceXz.x).toBeCloseTo(-0.8364, 12);
    // The live stance sat 0.035 m off the ideal (measured in-analysis): the residual.
    const residual = firstStanceResidualXz(footfalls, { x: -0.8364, z: 1.0436 });
    expect(residual.distM).toBeGreaterThan(0.02);
    expect(residual.distM).toBeLessThan(0.3);
  });
});
