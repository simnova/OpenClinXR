import { describe, expect, it } from "vitest";
import { planRoomGenerate } from "../index.js";

/**
 * Door style pin + hingeSide perpendicular-axis RED (plan-only: no Blender,
 * no Infinigen). Two guarantees:
 *  (1) door.style is an OPTIONAL closed enum ("panel" | "glass_panel" |
 *      "louver" | "lite"); each valid value plans, "dutch" is refused.
 *  (2) hingeSide must sit on the PERPENDICULAR axis to doorWall: a door on a
 *      +y/-y wall hinges on +x/-x and vice versa. Same-axis pairs refused.
 */

const BASE = {
  environmentId: "exam_bay_v1",
  infinigenPrompt: "clinical single room",
  seed: 203,
  layoutVariant: "single",
};

const FOOTPRINT = { width: 8.77, depth: 7.77, ceilingHeight: 2.42 };
const DOOR = { doorWall: "+y", wallOffsetM: 0.5, hingeSide: "+x", widthM: 0.95, heightM: 2.1 };

const STYLES = ["panel", "glass_panel", "louver", "lite"] as const;

describe("the room generate pins door style", () => {
  for (const style of STYLES) {
    it(`(style) "${style}" plans and is carried on the door payload`, () => {
      const planned = planRoomGenerate({
        ...BASE,
        footprintMeters: FOOTPRINT,
        door: { ...DOOR, style },
      });
      expect(planned.issues).toBeUndefined();
      if (planned.issues !== undefined) return;
      expect((planned.plan["door"] as Record<string, unknown>)["style"]).toBe(style);
    });
  }

  it('(style) "dutch" is refused with a closed-enum error', () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: FOOTPRINT,
      door: { ...DOOR, style: "dutch" },
    });
    expect(planned.issues).not.toBeUndefined();
    const messages = (planned.issues ?? []).map((issue) => issue.message).join("; ");
    expect(messages).toMatch(/door\.style/);
    expect(messages).toMatch(/panel/);
  });

  it("(style) absent style still plans (additive: random draw unchanged)", () => {
    const planned = planRoomGenerate({ ...BASE, footprintMeters: FOOTPRINT, door: DOOR });
    expect(planned.issues).toBeUndefined();
  });
});

const VALID_PAIRS: [string, string][] = [
  ["+y", "+x"],
  ["+y", "-x"],
  ["-y", "+x"],
  ["-y", "-x"],
  ["+x", "+y"],
  ["+x", "-y"],
  ["-x", "+y"],
  ["-x", "-y"],
];

const INVALID_PAIRS: [string, string][] = [
  ["+y", "+y"],
  ["+y", "-y"],
  ["-y", "+y"],
  ["-y", "-y"],
  ["+x", "+x"],
  ["+x", "-x"],
  ["-x", "+x"],
  ["-x", "-x"],
];

describe("the room generate tightens hingeSide to the perpendicular axis", () => {
  for (const [doorWall, hingeSide] of VALID_PAIRS) {
    it(`(hinge) doorWall ${doorWall} + hingeSide ${hingeSide} plans`, () => {
      const planned = planRoomGenerate({
        ...BASE,
        footprintMeters: FOOTPRINT,
        door: { ...DOOR, doorWall, hingeSide },
      });
      expect(planned.issues).toBeUndefined();
    });
  }

  for (const [doorWall, hingeSide] of INVALID_PAIRS) {
    it(`(hinge) doorWall ${doorWall} + hingeSide ${hingeSide} is refused as same-axis`, () => {
      const planned = planRoomGenerate({
        ...BASE,
        footprintMeters: FOOTPRINT,
        door: { ...DOOR, doorWall, hingeSide },
      });
      expect(planned.issues).not.toBeUndefined();
      const messages = (planned.issues ?? []).map((issue) => issue.message).join("; ");
      expect(messages).toMatch(/hingeSide/);
      expect(messages).toMatch(/perpendicular/i);
    });
  }
});

describe("the room generate pins the ward door details", () => {
  it("(handle) lever plans and is carried on the door payload", () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: FOOTPRINT,
      door: { ...DOOR, style: "lite", handle: "lever" },
    });
    expect(planned.issues).toBeUndefined();
    if (planned.issues !== undefined) return;
    expect((planned.plan["door"] as Record<string, unknown>)["handle"]).toBe("lever");
  });

  it('(handle) "ball" is refused with a closed-enum error', () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: FOOTPRINT,
      door: { ...DOOR, handle: "ball" },
    });
    expect(planned.issues).not.toBeUndefined();
    const messages = (planned.issues ?? []).map((issue) => issue.message).join("; ");
    expect(messages).toMatch(/door\.handle/);
  });

  it("(liteRect) ordered fractions in [0, 1] plan", () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: FOOTPRINT,
      door: { ...DOOR, style: "lite", liteRect: [0.64, 0.8, 0.58, 0.87] },
    });
    expect(planned.issues).toBeUndefined();
  });

  it("(liteRect) inverted fractions are refused", () => {
    const planned = planRoomGenerate({
      ...BASE,
      footprintMeters: FOOTPRINT,
      door: { ...DOOR, liteRect: [0.8, 0.64, 0.58, 0.87] },
    });
    expect(planned.issues).not.toBeUndefined();
    const messages = (planned.issues ?? []).map((issue) => issue.message).join("; ");
    expect(messages).toMatch(/door\.liteRect/);
  });

  it("(bevelMm/casingMarginM) non-positive values are refused", () => {
    for (const door of [
      { ...DOOR, bevelMm: -1 },
      { ...DOOR, casingMarginM: 0 },
    ]) {
      const planned = planRoomGenerate({ ...BASE, footprintMeters: FOOTPRINT, door });
      expect(planned.issues).not.toBeUndefined();
    }
  });
});
