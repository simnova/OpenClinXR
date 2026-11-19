/**
 * Aisha-parity eyeShade lever (P4a): fail-closed value + globe refusal.
 * No browser: refusal paths only (empty Group), never a WebGL render.
 */
import { Group } from "three";
import { describe, expect, it } from "vitest";
import { applyParityEyeShade } from "./parity-eye-shade.js";

describe("parity eyeShade lever", () => {
  it("refuses garbage scleraAtten (-1, NaN) as a value error", () => {
    const root = new Group();
    expect(() =>
      applyParityEyeShade(root, { scleraAtten: -1, lidBandM: 0.007, lidDarken: 0.85 }),
    ).toThrow(/scleraAtten/);
    expect(() =>
      applyParityEyeShade(root, { scleraAtten: NaN, lidBandM: 0.007, lidDarken: 0.85 }),
    ).toThrow(/scleraAtten/);
  });
  it("counterweight: valid values on a scene with no globe mesh refuse with the 0-globe message (not a value error)", () => {
    const root = new Group();
    expect(() =>
      applyParityEyeShade(root, { scleraAtten: 0.35, lidBandM: 0.007, lidDarken: 0.85 }),
    ).toThrow(/0 globe/);
  });
});
