/**
 * The registry pin is checked before solve (MADR 0061 d5, d7).
 *
 * A pin naming an unknown solver id or a skewed version throws from the
 * resolver, so the mismatch never reaches a solver. The verifier re-run
 * (verifySolution) re-solves with the checked module and refuses a solution
 * whose solver id, version, input hash or frames differ: output produced by
 * calling apply directly with an unpinned solution is caught. Fast clauses
 * use in-memory pins and forged solutions; only the receipt hash is read
 * from disk, never a GLB.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mouthClosedformSolver } from "@openclinxr/station-mouth-solver-closedform";
import { describe, expect, it } from "vitest";
import { loadPin, loadPinnedSolver, verifySolution } from "./run.js";
import { mouthSolverModules } from "./solver-map.generated.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..", "..");
const RECEIPT_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.provenance.json";

describe("the pin is checked before solve", () => {
  it("pin.json carries exactly solverId and solverVersion, matching the checked module", () => {
    const pinText = readFileSync(new URL("./pin.json", import.meta.url), "utf8");
    expect(Object.keys(JSON.parse(pinText)).sort()).toEqual(["solverId", "solverVersion"]);
    const pin = loadPin();
    expect(pin).toEqual({
      solverId: mouthClosedformSolver.id,
      solverVersion: mouthClosedformSolver.version,
    });
  });

  it("the generated map holds the checked module with an id, a version and a solve", () => {
    expect(mouthSolverModules.length).toBeGreaterThan(0);
    for (const module of mouthSolverModules) {
      expect(typeof module.id).toBe("string");
      expect(typeof module.version).toBe("string");
      expect(typeof module.solve).toBe("function");
    }
    expect(mouthSolverModules).toContain(mouthClosedformSolver);
    expect(loadPinnedSolver(loadPin())).toBe(mouthClosedformSolver);
  });

  it("a pin naming an unknown solver id throws before solve", () => {
    expect(() =>
      loadPinnedSolver({ solverId: "mouth-other", solverVersion: "0.1.0" }),
    ).toThrow(/not in the generated map/);
  });

  it("a pin with a skewed version throws before solve", () => {
    expect(() =>
      loadPinnedSolver({ solverId: mouthClosedformSolver.id, solverVersion: "9.9.9" }),
    ).toThrow(/pin wants/);
  });

  it("the re-run accepts the pinned solution and refuses an unpinned apply", () => {
    const receipt = JSON.parse(readFileSync(path.join(REPO, RECEIPT_REL), "utf8")) as {
      preImageSha256: string;
    };
    // STEP3 constants mirror the executor's buildProblem (problem.ts); the
    // input hash is the receipt's pre-image hash, which the solver tuning pins.
    const problem = {
      inputHash: receipt.preImageSha256,
      trackId: "step3-fixed-capture",
      frameRate: 30,
      frameCount: 4,
    };
    const genuine = mouthClosedformSolver.solve(problem);
    expect(() => verifySolution(problem, genuine)).not.toThrow();
    expect(() =>
      verifySolution(problem, { ...genuine, solverId: "mouth-direct-apply", solverVersion: "0.0.0" }),
    ).toThrow(/unpinned solution refused/);
    expect(() => verifySolution(problem, { ...genuine, frames: [] })).toThrow(
      /unpinned solution refused/,
    );
  });

  it('public-api.json "." lists exactly the reviewed surface', () => {
    const api = JSON.parse(
      readFileSync(path.join(HERE, "..", "public-api.json"), "utf8"),
    ) as { entrypoints: { ".": string[] } };
    expect([...api.entrypoints["."]].sort()).toEqual([
      "Problem",
      "RegistryPin",
      "RunOptions",
      "RunResult",
      "Solution",
      "loadPin",
      "loadPinnedSolver",
      "run",
      "verifySolution",
    ]);
  });
});
