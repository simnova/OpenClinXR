import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

const archTsconfig = "../../../tsconfig.archunit.json";

// C23 RED: scenario-rubric.ts and review-packet.ts imported each other (C20
// carried defect). Imports inside the encounter server must go one way only.
describe("xr-sync-server import graph", () => {
  it("keeps xr-sync-server source free of circular imports", async () => {
    const violations = await projectFiles(archTsconfig)
      .inFolder("packages/openclinxr/xr-sync-server/src/**")
      .should()
      .haveNoCycles()
      .check();

    expect(violations).toEqual([]);
  }, 60_000);
});
