import { describe, expect, it } from "vitest";

/**
 * FINISH PARITY (#219), RETIRED WITH ITS SUBJECT.
 *
 * The test staged `ed_chest_pain_priority_v1` and compared a body-param
 * library figure standing beside Anny actors (wrist hang + footwear). Both
 * sides of that comparison were deliberately retired from casting:
 *
 * - library rail: af8571555 ("#479: cast peds_fever child + ED spouse off
 *   MPFB") dropped #218's library-rail coverage — the spouse rides the
 *   137-joint MPFB family-partner body, not the 64-joint library body.
 * - Anny rail: fc78bb2f6 ("fix(#652): retire the Anny rail from casting")
 *   removed every Anny member from the pools and tails after a0f64c5c3
 *   ("#403 step 2") moved the nurse/spouse slots to MPFB bodies.
 *
 * The staged scene is now all-MPFB, so there is no library figure to finish
 * and no Anny column to compare against. This file asserts that retirement
 * fact; the library bodies stay on disk as candidates (S2 swap path intact).
 */

import { existsSync } from "node:fs";
import {
  LIBRARY_ADULT_HEAVY_MALE_GLB,
  LIBRARY_ADULT_LEAN_FEMALE_GLB,
} from "../../../../../../tools/openclinxr/evidence/garment-selection-by-role.js";
import { resolveScenarioActorCast } from "../../../../../../tools/openclinxr/evidence/library-figure-finish-parity.js";
import { CANDIDATES_DIR } from "../../../../../../tools/openclinxr/evidence/garment-selection-by-role.js";
import path from "node:path";

const STAGED_SCENARIO_ID = "ed_chest_pain_priority_v1";

describe("a library figure is finished to Anny parity (#219)", () => {
  it("RETIRED: the staged scene is all-MPFB — no library figure, no Anny column", () => {
    // #479 retired the library rail from the cast; #652 retired the Anny rail.
    const cast = resolveScenarioActorCast(STAGED_SCENARIO_ID);
    expect(cast.length, "staged scenario has no cast — retirement assertion vacuous").toBeGreaterThan(0);
    const nonMpfb = cast
      .map((a) => a.assetPath)
      .filter((p) => !/mpfb-/i.test(p));
    expect(nonMpfb, "a non-MPFB body returned to the staged cast").toEqual([]);
  });

  it("COUNTERWEIGHT: the retired library bodies stay staged as candidates", () => {
    // The constants stay exported for the S2 gowned-patient swap and the
    // candidate GLBs stay on disk — retirement is from the cast, not deletion.
    for (const glb of [LIBRARY_ADULT_LEAN_FEMALE_GLB, LIBRARY_ADULT_HEAVY_MALE_GLB]) {
      expect(glb).toMatch(/body-param-.*-library\.glb/);
      expect(existsSync(path.join(CANDIDATES_DIR, glb)), `retired library candidate missing: ${glb}`).toBe(true);
    }
  });
});
