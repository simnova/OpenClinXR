import { describe, expect, it } from "vitest";
import { binByNormPhase, detectLiftOffs, meanPhaseCurve, PHASE_BINS, resampleSegment, rmse, rmseIntersection, rmseShiftTolerant } from "./phase-attribution.js";

describe("phase attribution helpers", () => {
  it("detects lift-off as the contact -> airborne edge", () => {
    // contact, contact, air, air, contact, air
    expect(detectLiftOffs([true, true, false, false, true, false])).toEqual([2, 5]);
    expect(detectLiftOffs([true, true, true])).toEqual([]);
  });

  it("resamples a linear segment exactly onto bins", () => {
    const out = resampleSegment([0, 10], 0, 1, 5);
    expect(out).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it("averages two lift-off-to-lift-off segments", () => {
    // Two identical saw ramps 0..10 over 11 samples each, separated so the
    // lift-off edges sit at 2 and 13 (segment length 11 >= 5).
    const samples = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0];
    const contact = samples.map((_, i) => !(i === 2 || i === 13));
    const curve = meanPhaseCurve(samples, contact, PHASE_BINS);
    expect(curve?.nSegments).toBe(1);
    // Phase 0 = lift-off (ramp start 0), phase 1 = next lift-off (ramp
    // restart 0); the ramp peak sits mid-segment.
    expect(curve!.mean[0]).toBeCloseTo(0, 9);
    expect(curve!.mean[PHASE_BINS - 1]).toBeCloseTo(0, 9);
    expect(Math.max(...curve!.mean)).toBeCloseTo(10, 0);
  });

  it("rmse separates identical and shifted curves", () => {
    const a = [0, 10, 20];
    expect(rmse(a, [...a])).toBe(0);
    expect(rmse(a, [3, 13, 23])).toBeCloseTo(3, 9);
    expect(rmse(a, [0, 10])).toBeNaN();
  });

  it("intersection rmse skips null bins; shift-tolerant finds the alignment", () => {
    const a = [0, 10, 20, null];
    const b = [null, 0, 10, 20];
    const inter = rmseIntersection(a, b);
    expect(inter.nBins).toBe(2);
    expect(inter.rmse).toBeCloseTo(Math.sqrt((100 + 100) / 2), 9);
    const shifted = rmseShiftTolerant([0, 10, 20, 30], [20, 30, 0, 10]);
    expect(shifted.best).toBeCloseTo(0, 9);
    expect(shifted.shiftBins).toBe(2);
  });

  it("anchor binning averages samples into lift-off-normalised bins", () => {
    const { mean, counts } = binByNormPhase([10, 20, 30], [0.05, 0.05, 0.55], 4);
    expect(counts).toEqual([2, 0, 1, 0]);
    expect(mean[0]).toBeCloseTo(15, 9);
    expect(mean[2]).toBeCloseTo(30, 9);
    expect(mean[1]).toBeNull();
  });
});
