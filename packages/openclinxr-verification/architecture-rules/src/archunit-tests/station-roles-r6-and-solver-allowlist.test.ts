import { describe, expect, it } from "vitest";
import {
  checkStationRoleBoundaries,
  type StationPackage,
} from "../checks/station-role-boundaries.js";

/**
 * Station R6 and the solver-importer allowlist (MADR 0061 role rules).
 *
 * WHY: the registry owns running the job against the pinned solver plug-in.
 * An executor reaching a solver reopens the pre-tuned-solver back door, and
 * a verifier reaching a solver bypasses the pin check, so each edge names
 * one rule [ref:MADR 0061 d4-d7].
 */

function plant(
  name: string,
  station: string | undefined,
  opts: { role?: string; registry?: boolean; deps?: string[]; specs?: string[] } = {},
): StationPackage {
  return {
    name,
    dir: `plants/${name}`,
    ...(station === undefined ? {} : { station }),
    ...(opts.role === undefined ? {} : { stationRole: opts.role }),
    ...(opts.registry === undefined ? {} : { stationRegistry: opts.registry }),
    dependencies: opts.deps ?? [],
    sources: [
      {
        file: `plants/${name}/src/index.ts`,
        specifiers: opts.specs ?? [],
      },
    ],
    exportSubpaths: ["."],
  };
}

const OBJECTIVE = "@plants/station-objective";

function objective(): StationPackage {
  return plant(OBJECTIVE, "mouth", { role: "objective" });
}

describe("station R6 and the solver-importer allowlist", () => {
  it("an executor reaching its solver fails naming R6", () => {
    const solver = plant("@plants/station-solver", "mouth", { role: "solver" });
    const executor = plant("@plants/station-executor", "mouth", {
      role: "executor",
      deps: [solver.name, OBJECTIVE],
      specs: [solver.name, OBJECTIVE],
    });
    const violations = checkStationRoleBoundaries([executor, objective(), solver]);
    expect(violations).toHaveLength(2);
    for (const violation of violations) expect(violation).toContain("[station-roles R6]");
  });

  it("a verifier reaching a solver fails naming the allowlist", () => {
    const solver = plant("@plants/station-solver", "mouth", { role: "solver" });
    const verifier = plant("@plants/station-verifier", "mouth", {
      role: "verifier",
      deps: [solver.name, OBJECTIVE],
      specs: [solver.name, OBJECTIVE],
    });
    const violations = checkStationRoleBoundaries([objective(), verifier, solver]);
    expect(violations).toHaveLength(2);
    for (const violation of violations) {
      expect(violation).toContain("[station-roles solver-allowlist]");
    }
  });

  it("extended R3: a solver reaching a verifier or another solver fails naming R3", () => {
    const other = plant("@plants/other-solver", "mouth", { role: "solver" });
    const verifier = plant("@plants/station-verifier", "mouth", { role: "verifier" });
    const solver = plant("@plants/station-solver", "mouth", {
      role: "solver",
      deps: [verifier.name, other.name, OBJECTIVE],
      specs: [verifier.name, other.name, OBJECTIVE],
    });
    const violations = checkStationRoleBoundaries([objective(), verifier, solver, other]);
    expect(violations).toHaveLength(4);
    for (const violation of violations) expect(violation).toContain("[station-roles R3]");
  });

  it("a solver reaching only the objective passes", () => {
    const solver = plant("@plants/station-solver", "mouth", {
      role: "solver",
      deps: [OBJECTIVE],
      specs: [OBJECTIVE],
    });
    expect(checkStationRoleBoundaries([objective(), solver])).toEqual([]);
  });

  it("the registry marker holds a roleless station; a bare roleless station fails R5", () => {
    const solver = plant("@plants/station-solver", "mouth", { role: "solver" });
    const registry = plant("@plants/station-registry", "mouth", {
      registry: true,
      deps: [solver.name, OBJECTIVE],
      specs: [solver.name, OBJECTIVE],
    });
    expect(checkStationRoleBoundaries([objective(), registry, solver])).toEqual([]);

    const bare = plant("@plants/bare-station", "mouth");
    const bareViolations = checkStationRoleBoundaries([bare, objective(), solver]);
    expect(bareViolations).toHaveLength(1);
    expect(bareViolations[0]).toContain("[station-roles R5]");

    const markedRole = plant("@plants/marked-executor", "mouth", {
      role: "executor",
      registry: true,
    });
    const markedViolations = checkStationRoleBoundaries([markedRole, objective(), solver]);
    expect(markedViolations).toHaveLength(1);
    expect(markedViolations[0]).toContain("[station-roles R5]");
  });
});
