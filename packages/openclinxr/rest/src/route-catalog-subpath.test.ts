import { describe, expect, it } from "vitest";
import * as entry from "./route-catalog-entry.js";
import {
  buildSessionRoutePath as rootBuild,
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH as rootPromo,
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH as rootPromoPreview,
  routeById as rootById,
} from "./index.js";

describe("REST route-catalog public subpath", () => {
  it("exposes exactly the four externally bound names with root identities", () => {
    expect(Object.keys(entry).sort()).toEqual(
      [
        "FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH",
        "FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH",
        "buildSessionRoutePath",
        "routeById",
      ].sort(),
    );
    expect(entry.buildSessionRoutePath).toBe(rootBuild);
    expect(entry.routeById).toBe(rootById);
    expect(entry.FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH).toBe(rootPromo);
    expect(entry.FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH).toBe(rootPromoPreview);
    expect(entry.FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH).toBe("/faculty/encounter-bundle-promotion");
    expect(entry.FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH).toBe("/faculty/encounter-bundle-promotion/preview");
  });

  it("refuses the three internal-only root helpers through the subpath", () => {
    expect("matchOpenClinXrRestRoute" in entry).toBe(false);
    expect("openClinXrRestRoutes" in entry).toBe(false);
    expect("openClinXrRestRouteIds" in entry).toBe(false);
  });

  it("preserves encoding and refusal behavior through the subpath", () => {
    expect(entry.buildSessionRoutePath("actor-response", "run 1/2")).toBe("/sessions/run%201%2F2/actor-response");
    expect(() => entry.buildSessionRoutePath("health", "run_001")).toThrow("Route health is not station-run scoped");
    expect(() => entry.buildSessionRoutePath("actor-response", "")).toThrow("stationRunId is required");
    expect(() => entry.buildSessionRoutePath("actor-response", "   ")).toThrow("stationRunId is required");
    expect(entry.routeById("actor-response")).toMatchObject({ id: "actor-response" });
    expect(() => entry.routeById("no-such-route" as never)).toThrow("Unknown REST route");
  });
});
