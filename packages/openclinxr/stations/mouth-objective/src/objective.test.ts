import { describe, expect, it } from "vitest";
import {
  DY_GATE_BIAS_PX,
  DY_GATE_DETRENDED_MEDIAN_PX,
  DY_GATE_MAX_PX,
  PENETRATION_FRAMES_MAX,
  RIM_BAND_MM,
  RIM_TARGET_MM,
  UPPER_DISPLACEMENT_BOUND_MM,
  centroidPacked,
  countPenetratingVerts,
  meanRimGapMm,
  upperDisplacementMm,
  type Problem,
  type Solution,
  type SolverModule,
} from "./index.js";

describe("mouth objective measures", () => {
  it("centroidPacked means packed xyz triples", () => {
    expect(centroidPacked(new Float32Array([0, 0, 0, 3, 6, 9]))).toEqual([1.5, 3, 4.5]);
  });

  it("meanRimGapMm averages nearest-rim distances in mm", () => {
    const teeth = new Float32Array([0, 0, 0, 3, 0, 0]);
    const rim = new Float32Array([0, 0, 4]);
    expect(meanRimGapMm(teeth, rim)).toBeCloseTo(4500, 9);
  });

  it("meanRimGapMm is zero on an empty shell, matching the evaluator divisor guard", () => {
    expect(meanRimGapMm(new Float32Array(0), new Float32Array([0, 0, 1]))).toBe(0);
  });

  it("countPenetratingVerts counts shell verts at or past the lip max +Z", () => {
    const teeth = new Float32Array([0, 0, 1, 0, 0, 2]);
    const lip = new Float32Array([0, 0, 0, 0, 0, 1.5]);
    expect(countPenetratingVerts(teeth, lip)).toBe(1);
  });

  it("upperDisplacementMm scales the centroid distance to mm", () => {
    expect(upperDisplacementMm([1, 2, 2], [0, 0, 0])).toBeCloseTo(3000, 9);
  });

  it("thresholds match the evaluator test pins", () => {
    expect(RIM_TARGET_MM).toBe(6.485);
    expect(RIM_BAND_MM).toBe(0.5);
    expect(UPPER_DISPLACEMENT_BOUND_MM).toBe(0.5);
    expect(PENETRATION_FRAMES_MAX).toBe(0);
    expect(DY_GATE_BIAS_PX).toBe(3);
    expect(DY_GATE_DETRENDED_MEDIAN_PX).toBe(2);
    expect(DY_GATE_MAX_PX).toBe(5);
  });

  it("a solver module solves a problem into a provenance-carrying solution", () => {
    const problem: Problem = { inputHash: "abc", trackId: "step3", frameRate: 30, frameCount: 1 };
    const module: SolverModule = {
      id: "mouth-default",
      version: "0.1.0",
      solve: (input: Problem): Solution => ({
        solverId: "mouth-default",
        solverVersion: "0.1.0",
        inputHash: input.inputHash,
        frames: [],
      }),
    };
    const solution = module.solve(problem);
    expect(solution.inputHash).toBe(problem.inputHash);
    expect(solution.solverId).toBe(module.id);
    expect(solution.solverVersion).toBe(module.version);
  });
});
