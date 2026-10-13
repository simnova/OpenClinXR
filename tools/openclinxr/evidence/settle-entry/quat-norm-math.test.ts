import { describe, expect, it } from "vitest";
import { normBandOf, quatNorm, quatStepDeg } from "./quat-norm-math.js";

describe("quat-norm-math", () => {
  it("two identical non-unit quaternions measure 0 deg", () => {
    const q = { x: 0.3, y: 0.4, z: 0.1, w: 0.75 };
    expect(quatNorm(q)).toBeLessThan(1);
    // Raw-dot reading of this pair is 69.3 deg; normalised it is rest.
    expect(quatStepDeg(q, { ...q })).toBeCloseTo(0, 9);
  });

  it("a quarter turn still measures 90 deg after normalising", () => {
    const scaled = { x: 0, y: 0, z: 0.6, w: 0.6 };
    expect(quatStepDeg({ x: 0, y: 0, z: 0, w: 1 }, scaled)).toBeCloseTo(90, 9);
  });

  it("normBandOf tracks the min and max norm, skipping nulls", () => {
    const band = normBandOf([
      null,
      { x: 0, y: 0, z: 0, w: 0.862 },
      { x: 0, y: 0, z: 0, w: 1.024 },
    ]);
    expect(band?.min).toBeCloseTo(0.862, 9);
    expect(band?.max).toBeCloseTo(1.024, 9);
    expect(normBandOf([null])).toBeNull();
  });
});
