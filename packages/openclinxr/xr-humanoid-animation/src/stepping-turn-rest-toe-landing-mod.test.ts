import { describe, expect, it } from "vitest";
import {
  planSteppingTurn,
  restToeLanding,
  STEPPING_TURN_REST_FORE_OFFSET_M,
} from "./stepping-turn.js";

const DEG = Math.PI / 180;
const ENTRY_YAW = (117.33 * Math.PI) / 180;
const REST_SEP_M = 0.3364;
const FORE_M = STEPPING_TURN_REST_FORE_OFFSET_M;

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
  it("lands each foot at its own rest offset (lateral AND fore-aft)", () => {
    const slotEnd = { x: 1.95, z: 0.15 };
    const endYaw = Math.PI;
    for (const swingFoot of ["left", "right"] as const) {
      const landing = restToeLanding({
        slotEndXz: slotEnd,
        endYawRadians: endYaw,
        swingFoot,
        restSepM: REST_SEP_M,
      });
      const body = toBody(slotEnd, endYaw, landing);
      expect(body.lat).toBeCloseTo((swingFoot === "left" ? 1 : -1) * (REST_SEP_M / 2), 9);
      expect(body.fore).toBeCloseTo(FORE_M, 9);
    }
  });

  it("reproduces the M1 rest snapshot through the meter projection", () => {
    // Staging numbers from the M1 table (rest-before-131 run1 preWalk):
    // rest L body (+0.1682, +0.1166), R (−0.1682, +0.1166).
    const slotEnd = { x: 0, z: 0 };
    const left = restToeLanding({
      slotEndXz: slotEnd,
      endYawRadians: ENTRY_YAW,
      swingFoot: "left",
      restSepM: REST_SEP_M,
    });
    const right = restToeLanding({
      slotEndXz: slotEnd,
      endYawRadians: ENTRY_YAW,
      swingFoot: "right",
      restSepM: REST_SEP_M,
    });
    expect(toBody(slotEnd, ENTRY_YAW, left).lat).toBeCloseTo(0.1682, 4);
    expect(toBody(slotEnd, ENTRY_YAW, left).fore).toBeCloseTo(0.1166, 4);
    expect(toBody(slotEnd, ENTRY_YAW, right).lat).toBeCloseTo(-0.1682, 4);
    expect(toBody(slotEnd, ENTRY_YAW, right).fore).toBeCloseTo(0.1166, 4);
  });

  it("fails when the fore-aft rest offset is dropped (the G5 probe twin)", () => {
    // Dropping the fore offset (restForeM = 0) must NOT land on the rest fore:
    // this is what makes the probe red, and this assertion is what goes red
    // here if anyone wires the plan without the offset.
    const landing = restToeLanding({
      slotEndXz: { x: 0, z: 0 },
      endYawRadians: ENTRY_YAW,
      swingFoot: "left",
      restSepM: REST_SEP_M,
      restForeM: 0,
    });
    const body = toBody({ x: 0, z: 0 }, ENTRY_YAW, landing);
    expect(body.fore).toBeCloseTo(0, 9);
    expect(body.fore).not.toBeCloseTo(FORE_M, 1);
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
