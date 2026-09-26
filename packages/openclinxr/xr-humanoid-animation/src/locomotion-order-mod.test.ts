import type { GeneratedHumanoidAnimationSlot } from "@openclinxr/xr-humanoid-animation";
import { Group } from "three";
import { describe, expect, it } from "vitest";
import {
  applyLocomotionOrderStanceLocks,
  createLocomotionOrderRegistry,
  stepLocomotionOrders,
} from "./locomotion-order-mod.js";

/**
 * A bare `Group`-based fake slot: no real skeleton, mixer or clip. `resolveLocomotionClipTimeScale`
 * -- the FIRST thing `stepLocomotionOrders` calls for a not-yet-resolved actor -- needs a bound
 * `locomotionClipName` and `mixer` to measure anything and returns null without one, so this fixture
 * can only exercise the refusal path. Real movement (the shared `createCaseOwnedApproachForOrder` /
 * `advanceCaseOwnedBedsideApproach` / `applyCaseOwnedStanceLock` pipeline this module now delegates
 * to) is exercised by live browser capture, not a fake-skeleton unit test -- same limitation the
 * frozen-plan physician's own producer has (see `case-owned-approach-runtime-mod.ts`'s test file).
 */
function fakeSlot(actorId: string, startX: number, startZ: number): GeneratedHumanoidAnimationSlot {
  const actorSlot = new Group();
  actorSlot.position.set(startX, 0, startZ);
  const root = new Group();
  return {
    assetId: "test",
    actorId,
    root,
    actorSlot,
    baseY: 0,
    baseX: startX,
    baseScaleX: 1,
    baseScaleY: 1,
    baseScaleZ: 1,
    baseRotationY: 0,
    baseZ: startZ,
    phaseOffsetMs: 0,
  } as unknown as GeneratedHumanoidAnimationSlot;
}

describe("stepLocomotionOrders", () => {
  it("returns no drive for an actor whose clip speed cannot be measured (no bound clip on the fake slot)", () => {
    const slot = fakeSlot("nurse", 0, 0);
    const slots = new Map([["nurse", slot]]);
    const orders = new Map([["nurse", { target: { x: 1, z: 0 } }]]);
    const registry = createLocomotionOrderRegistry();
    const drives = stepLocomotionOrders(orders, slots, registry, 0, 1 / 30);
    expect(drives.size).toBe(0);
    // Registry records the refusal so a second call does not retry every frame.
    expect(registry.get("nurse")).toBeNull();
    const drivesAgain = stepLocomotionOrders(orders, slots, registry, 1000, 1 / 30);
    expect(drivesAgain.size).toBe(0);
    // The actor's own position is untouched by a refused order.
    expect(slot.actorSlot.position.x).toBe(0);
    expect(slot.actorSlot.position.z).toBe(0);
  });

  it("ignores an order for an actor with no loaded slot", () => {
    const slots = new Map<string, GeneratedHumanoidAnimationSlot>();
    const orders = new Map([["nobody", { target: { x: 1, z: 0 } }]]);
    const registry = createLocomotionOrderRegistry();
    const drives = stepLocomotionOrders(orders, slots, registry, 0, 1 / 30);
    expect(drives.size).toBe(0);
    expect(registry.size).toBe(0);
  });

  it("does not touch an actor with no authored order", () => {
    const slot = fakeSlot("bystander", 3, 4);
    const slots = new Map([["bystander", slot]]);
    const registry = createLocomotionOrderRegistry();
    const drives = stepLocomotionOrders(new Map(), slots, registry, 0, 1 / 30);
    expect(drives.size).toBe(0);
    expect(registry.size).toBe(0);
  });
});

describe("applyLocomotionOrderStanceLocks", () => {
  it("is a no-op over an empty or refused-only registry", () => {
    const registry = createLocomotionOrderRegistry();
    registry.set("nurse", null);
    expect(() => applyLocomotionOrderStanceLocks(registry, 1 / 30, 0)).not.toThrow();
  });
});
