import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Shell-floor pin: under OPENCLINXR_ROOM_REALISM=1 room_floors() must pin to
 * BumpyRubberFloor (never the Rug placeholder) with the calibrated
 * base_color threaded through .apply(), never through construction or
 * floor_fn() (BumpyRubberFloor.generate() takes no params -- a
 * construction-time kwarg crashes the same way Plaster(plaster_colored=..)
 * did). Static on the versioned patch: no Blender, no Infinigen.
 *
 * Calibration anchor (real seed-205 ward bake + real ui-xr runtime capture
 * pose runtime-06-floor-base, 2026-09-28):
 * RED (unfixed Rug): baked albedo center mean (182.0,178.5,178.8) std
 *   (0.30,0.56,0.47); rendered floor-interior mean (207.3,202.7,197.5) std
 *   (0.57,0.54,0.57) -- flat/featureless.
 * GREEN (this pin, albedo base_color (0.43,0.44,0.46,1.0) linear): baked
 *   albedo center mean (169.5,171.3,174.7) std (4.78,4.82,4.91); rendered
 *   floor-interior mean (200.0,198.2,194.7) std (2.68,2.64,2.70), within
 *   +/-8 per channel of reference box A (200.9,201.0,198.5) with texture
 *   stddev inside the reference 2.3-4.0 band, not near-zero.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PATCH = path.join(HERE, "infinigen_generate/0003-room-walls-plaster-floors-rug-realism-env.patch");
const GENERATE_TS = path.join(HERE, "generate.ts");

function readPatch(): string {
  return readFileSync(PATCH, "utf8");
}

describe("the room floors pin bumpy rubber under realism", () => {
  it("(1) room_floors pins to BumpyRubberFloor, not the Rug placeholder", () => {
    const patch = readPatch();
    expect(patch).toContain("material_assignments.plastic.BumpyRubberFloor()");
    expect(patch).not.toContain("fabric.Rug()");
  });

  it("(2) base_color rides apply(), never construction or floor_fn()", () => {
    const patch = readPatch();
    expect(patch).toContain("floor_fn.apply(rooms__, base_color=");
    // No construction-time kwargs: BumpyRubberFloor() takes none.
    for (const line of patch.split("\n")) {
      if (line.includes("BumpyRubberFloor(") && !line.includes("BumpyRubberFloor()")) {
        expect(`construction kwarg forbidden: ${line}`).toBe("");
      }
    }
    expect(patch).not.toMatch(/BumpyRubberFloor\(base_color/);
  });

  it("(3) the apply branch skips surface.assign_material (apply assigns itself)", () => {
    const patch = readPatch();
    const branch = patch.slice(patch.indexOf('__name__ == "BumpyRubberFloor"'));
    expect(branch).toMatch(/floor_fn\.apply\(rooms__[\s\S]{0,400}?continue/);
  });

  it("(4) base_color is the calibrated linear value", () => {
    const patch = readPatch();
    const match = patch.match(/base_color=\(([^)]+)\)/);
    expect(match).not.toBeNull();
    const channels = match![1]!.split(",").map((part) => Number(part.trim()));
    expect(channels).toEqual([0.43, 0.44, 0.46, 1.0]);
  });

  it("(5) generate.ts documents the rubber pin, not Rug", () => {
    const source = readFileSync(GENERATE_TS, "utf8");
    expect(source).toContain("BumpyRubberFloor");
    expect(source).not.toContain("room_floors to Rug");
  });
});
