import { describe, expect, it } from "vitest";
import { planRoomGenerate } from "../index.js";

/**
 * room_generate accepts the opt-in fixed-footprint payload and refuses a
 * doorWall outside the closed wall enum at plan time (no silent pass-through,
 * no crash deep in generation). Plan-only: no Blender, no Infinigen.
 */

const BASE = {
  environmentId: "exam_bay_v1",
  infinigenPrompt: "clinical single room",
  seed: 203,
  layoutVariant: "single",
};

const FOOTPRINT = { width: 8.77, depth: 7.77, ceilingHeight: 2.42 };
const DOOR = { doorWall: "+y", wallOffsetM: 0.5, hingeSide: "+x", widthM: 0.95, heightM: 2.1 };

describe("the room generate accepts footprint and door", () => {
  it("(1) a valid footprintMeters+door payload plans with both fields carried", () => {
    const planned = planRoomGenerate({ ...BASE, footprintMeters: FOOTPRINT, door: DOOR });
    expect(planned.issues).toBeUndefined();
    if (planned.issues !== undefined) return;
    expect(planned.plan["footprintMeters"]).toEqual(FOOTPRINT);
    expect(planned.plan["door"]).toEqual(DOOR);
    expect(planned.plan["seed"]).toBe(203);
  });

  it("(2) legacy payload without the new fields still plans (opt-in step)", () => {
    const planned = planRoomGenerate({ ...BASE });
    expect(planned.issues).toBeUndefined();
    if (planned.issues !== undefined) return;
    expect(planned.plan["seed"]).toBe(203);
    expect("footprintMeters" in planned.plan).toBe(false);
  });

  it("(3) doorWall 'north' is refused with a closed-enum error", () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: FOOTPRINT,
      door: { ...DOOR, doorWall: "north" },
    });
    expect(planned.issues).not.toBeUndefined();
    const messages = (planned.issues ?? []).map((issue) => issue.message).join("; ");
    expect(messages).toMatch(/doorWall/);
    expect(messages).toMatch(/\+x/);
  });

  it("(4) an empty doorWall string is refused, not passed through", () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: FOOTPRINT,
      door: { ...DOOR, doorWall: "" },
    });
    expect(planned.issues).not.toBeUndefined();
    const messages = (planned.issues ?? []).map((issue) => issue.message).join("; ");
    expect(messages).toMatch(/doorWall/);
  });

  it("(5) a non-positive footprint width is refused at plan time", () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: { ...FOOTPRINT, width: 0 },
      door: DOOR,
    });
    expect(planned.issues).not.toBeUndefined();
    const messages = (planned.issues ?? []).map((issue) => issue.message).join("; ");
    expect(messages).toMatch(/footprintMeters/);
  });
});
