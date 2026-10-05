import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runStaging } from "../index.js";

/**
 * OBSERVABLE: the unsolved staging result before MADR 0060's pilot.
 *
 * runStaging on the catalog staging payload with no options returns
 * `placement: null`. The pilot replaces the entry with a solved placement;
 * this golden freezes today's behaviour so that change is a visible diff,
 * not a silent drift. run.ts is untouched: the freeze is data, not code.
 */

const STAGING_PAYLOAD = {
  actorId: "actor_a",
  supportSurface: "stretcher",
  plantOffsetMeters: { x: 0.1, y: 0, z: 0 },
};

describe("runStaging unsolved golden", () => {
  it("deep-equals the committed unsolved golden (placement: null)", () => {
    const golden = JSON.parse(
      readFileSync(join(import.meta.dirname, "run-staging.golden.json"), "utf8"),
    ) as unknown;
    expect(runStaging(STAGING_PAYLOAD)).toEqual(golden);
  });
});

// NOT TESTED: the solved golden (arrives with the staging-solver branch).
