import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mouthClosedformSolver } from "./index.js";

const tuning = JSON.parse(
  readFileSync(new URL("./tuning.json", import.meta.url), "utf8"),
) as { inputHash: string };

describe("solve is deterministic", () => {
  it("solves the same problem to byte-identical Solution JSON twice", () => {
    const problem = { inputHash: tuning.inputHash, trackId: "step3", frameRate: 30, frameCount: 4 };
    const first = JSON.stringify(mouthClosedformSolver.solve(problem));
    const second = JSON.stringify(mouthClosedformSolver.solve(problem));
    expect(second).toBe(first);
  });

  it("carries solver provenance and the rest closed form", () => {
    const problem = { inputHash: tuning.inputHash, trackId: "step3", frameRate: 30, frameCount: 4 };
    const solution = mouthClosedformSolver.solve(problem);
    expect(solution.solverId).toBe("mouth-closedform");
    expect(solution.solverVersion).toBe("0.1.0");
    expect(solution.inputHash).toBe(problem.inputHash);
    expect(solution.frames).toHaveLength(4);
    expect(solution.frames[0]).toEqual({
      frame: 0,
      rimGapHeadLocalMm: 5.575,
      forwardGapHeadLocalMm: 0.5,
      penetratingVerts: 0,
      upperTeethDisplacementHeadLocalMm: 0,
    });
  });

  it('public-api "." lists exactly one runtime export', () => {
    const api = JSON.parse(
      readFileSync(new URL("../public-api.json", import.meta.url), "utf8"),
    ) as { entrypoints?: Record<string, string[]> };
    expect(api.entrypoints?.["."]).toEqual(["mouthClosedformSolver"]);
  });
});
