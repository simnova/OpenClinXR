import { describe, expect, it } from "vitest";
import { planSteppingTurn, steppingTurnAt } from "./stepping-turn.js";

const DEG = Math.PI / 180;
const ENTRY_YAW = (117.33 * Math.PI) / 180;
const REST_SEP_M = 0.3364;
/** M1-measured rest fore offset: literal so no new public name is bound (see stepping-turn-plan-mod.test.ts). */
const FORE_M = 0.1166;

/** End body frame projection (the meter's own convention). */
function toBody(
  slot: { x: number; z: number },
  yaw: number,
  p: { x: number; z: number },
): { lat: number; fore: number } {
  const dx = p.x - slot.x;
  const dz = p.z - slot.z;
  return {
    lat: dx * Math.cos(yaw) - dz * Math.sin(yaw),
    fore: dx * Math.sin(yaw) + dz * Math.cos(yaw),
  };
}

describe("the per-toe rest landing", () => {
  it("lands both feet on rest through a real SC-05 entry (telescoping)", () => {
    // Capture-derived entry (rest-before-131 run0 frame 45): the walk-exit
    // stagger the plan must absorb. Both swung feet must end at absolute rest
    // with a non-lunging first step.
    const entryYaw = 2.0471;
    const plan = planSteppingTurn({
      residualYawRadians: 62.67 * DEG,
      entryYawRadians: entryYaw,
      targetHeadingRadians: entryYaw + 62.67 * DEG,
      leftToeXz: { x: -0.8364, z: 1.0436 },
      rightToeXz: { x: -0.7828, z: 1.2118 },
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
      entrySlotXz: { x: -0.78, z: 1.14 },
      legScale: 1,
      restSepM: 0.3364,
    });
    expect(plan.steps.length).toBe(2);
    const [first, last] = plan.steps;
    if (!first || !last) throw new Error("expected 2 steps");
    // Reach: the first step absorbs the walk-exit stagger without lunging.
    const reach0 = Math.hypot(
      first.swingToXz.x - first.swingFromXz.x,
      first.swingToXz.z - first.swingFromXz.z,
    );
    expect(reach0).toBeLessThan(0.35);
    // Final pair in the end frame: both feet at absolute rest.
    const endYaw = entryYaw + 62.67 * DEG;
    let slot = { x: -0.78, z: 1.14 };
    for (const step of plan.steps) {
      const dx = slot.x - step.stanceXz.x;
      const dz = slot.z - step.stanceXz.z;
      const c = Math.cos(step.yawRadians);
      const s = Math.sin(step.yawRadians);
      slot = {
        x: step.stanceXz.x + dx * c + dz * s,
        z: step.stanceXz.z - dx * s + dz * c,
      };
    }
    const end = steppingTurnAt(plan, plan.totalS);
    const leftWorld = last.swingFoot === "left" ? end.swingToe : end.stanceToe;
    const rightWorld = last.swingFoot === "right" ? end.swingToe : end.stanceToe;
    const leftB = toBody(slot, endYaw, leftWorld);
    const rightB = toBody(slot, endYaw, rightWorld);
    expect(leftB.lat).toBeCloseTo(0.1682, 3);
    expect(leftB.fore).toBeCloseTo(0.1166, 3);
    expect(rightB.lat).toBeCloseTo(-0.1682, 3);
    expect(rightB.fore).toBeCloseTo(0.1166, 3);
  });

  it("lands the plan final swing at its rest offset on the SC-05 residual", () => {
    const plan = planSteppingTurn({
      residualYawRadians: 62.67 * DEG,
      entryYawRadians: ENTRY_YAW,
      targetHeadingRadians: ENTRY_YAW + 62.67 * DEG,
      leftToeXz: { x: -0.1, z: 0 },
      rightToeXz: { x: 0.1, z: 0 },
      leftToeY: 0.016,
      rightToeY: 0.016,
      stanceBaselineY: 0.016,
      entrySlotXz: { x: 0, z: 0 },
      legScale: 1,
      restSepM: REST_SEP_M,
    });
    const last = plan.steps[plan.steps.length - 1];
    if (!last) throw new Error("expected steps");
    // Positive residual: first swing right, final swing left.
    expect(last.swingFoot).toBe("left");
    // Predicted slot at hold: rigid arcs about each stance.
    let slot = { x: 0, z: 0 };
    for (const step of plan.steps) {
      const dx = slot.x - step.stanceXz.x;
      const dz = slot.z - step.stanceXz.z;
      const c = Math.cos(step.yawRadians);
      const s = Math.sin(step.yawRadians);
      slot = {
        x: step.stanceXz.x + dx * c + dz * s,
        z: step.stanceXz.z - dx * s + dz * c,
      };
    }
    const endYaw = ENTRY_YAW + 62.67 * DEG;
    const body = toBody(slot, endYaw, last.swingToXz);
    expect(body.lat).toBeCloseTo(REST_SEP_M / 2, 9);
    expect(body.fore).toBeCloseTo(FORE_M, 9);
    // Reach: the final step stays a short placement, never a lunge.
    const reach = Math.hypot(
      last.swingToXz.x - last.swingFromXz.x,
      last.swingToXz.z - last.swingFromXz.z,
    );
    expect(reach).toBeLessThan(0.25);
  });

  it("keeps the mirror on the final step for an invalid rest separation", () => {
    for (const restSepM of [0, -0.2, null, undefined]) {
      const plan = planSteppingTurn({
        residualYawRadians: 30 * DEG,
        entryYawRadians: ENTRY_YAW,
        targetHeadingRadians: ENTRY_YAW + 30 * DEG,
        leftToeXz: { x: -0.1, z: 0 },
        rightToeXz: { x: 0.1, z: 0 },
        leftToeY: 0.016,
        rightToeY: 0.016,
        stanceBaselineY: 0.016,
        entrySlotXz: { x: 0, z: 0 },
        legScale: 1,
        restSepM: restSepM ?? null,
      });
      expect(plan.steps.length).toBe(1);
      const only = plan.steps[0];
      if (!only) throw new Error("expected 1 step");
      const cos = Math.cos(only.yawRadians);
      const sin = Math.sin(only.yawRadians);
      const slotEnd = {
        x: only.stanceXz.x + (0 - only.stanceXz.x) * cos + (0 - only.stanceXz.z) * sin,
        z: only.stanceXz.z - (0 - only.stanceXz.x) * sin + (0 - only.stanceXz.z) * cos,
      };
      expect(only.swingToXz.x).toBeCloseTo(2 * slotEnd.x - only.stanceXz.x, 9);
      expect(only.swingToXz.z).toBeCloseTo(2 * slotEnd.z - only.stanceXz.z, 9);
    }
  });
});
