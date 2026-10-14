import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FOOT_BASE_CYCLE_S,
  FOOT_BASE_PLANT_PHASE,
  FOOT_BASE_ROWS,
  FOOT_BASE_STANCE_FRAC,
} from "./foot-base-path-data-mod.js";

/**
 * The runtime foot-base literal tracks the factory-stations emitter JSON.
 * Regenerate both together; this test fails on drift, never silently.
 */
describe("foot-base runtime data tracks the emitter JSON", () => {
  it("matches physician-walk-contact-phases.json exactly", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const jsonPath = join(
      here,
      "..",
      "..",
      "factory-stations",
      "src",
      "motion_retarget",
      "physician-walk-contact-phases.json",
    );
    const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      cycleS: number;
      left: { plantPhase: number; contactFraction: number };
      right: { plantPhase: number; contactFraction: number };
      footBase: {
        left: typeof FOOT_BASE_ROWS.left;
        right: typeof FOOT_BASE_ROWS.right;
      };
    };
    expect(FOOT_BASE_CYCLE_S).toBe(doc.cycleS);
    expect(FOOT_BASE_PLANT_PHASE.left).toBe(doc.left.plantPhase);
    expect(FOOT_BASE_PLANT_PHASE.right).toBe(doc.right.plantPhase);
    expect(FOOT_BASE_STANCE_FRAC.left).toBe(doc.left.contactFraction);
    expect(FOOT_BASE_STANCE_FRAC.right).toBe(doc.right.contactFraction);
    expect(FOOT_BASE_ROWS).toEqual({ left: doc.footBase.left, right: doc.footBase.right });
  });
});
