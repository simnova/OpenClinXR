import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The routine room capture refreshes 2 of 15 stations, and the other 13 age silently.**
 *
 * #101 says "covers 2 of 12". Measured 2026-08-14, **that premise is dead on both numbers** and the
 * corrected claim is worse, not better, because it is invisible rather than absent:
 *
 *   - **15** scenario bundles ship under `apps/ui-xr/public/xr-assets/generated/`, not 12.
 *   - **All 15 have at least one room capture on disk.** Somebody ran them by hand once.
 *   - But `DEFAULT_SCENARIOS` (`ui-xr-environment-room-capture.ts:145-148`) is a **hardcoded pair** —
 *     `ed_chest_pain_priority_v1` and `telehealth_diabetes_health_literacy_v1` — and
 *     `:959` resolves `input.scenarioIds ?? [...DEFAULT_SCENARIOS]`. So every run that does not pass
 *     `--scenario` refreshes exactly those two.
 *
 * Capture recency per station, measured on disk:
 *
 *   station                                    captures   newest
 *   -----------------------------------------  --------   ------
 *   ed_chest_pain_priority_v1                       6      08-13
 *   peds_asthma_parent_anxiety_v1                   3      08-13
 *   telehealth_diabetes_health_literacy_v1          3      08-13
 *   the other TWELVE                                1      08-12
 *
 * Twelve stations were captured once and have not been re-captured since, across many landings that
 * changed shared code. This is SS7j exactly: a fix at a shared layer propagates to every station, and
 * every appearance verdict here rests on the two rooms already being iterated on. It is also how #100's
 * colour-parse fix was found only because it happened to be in one of the two.
 *
 * ## THE KNOWN-GOOD IS IN THIS REPO, DOING THIS EXACT THING (SS9h)
 *
 * `dialogue-visemes-follow-pronunciation.test.ts` clause (4) enumerates the bank's vocabulary
 * **dynamically from the same `xr-assets/generated/` directory**, precisely so a new scenario is
 * covered the day it ships rather than being green-by-construction against a frozen list. Same
 * directory, same pattern, already proven. Nothing new needs inventing — this is a wire, not a design.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) enumerates | (2) override | (3) captures | result
 *   ---------------------------------------------------|----------------|--------------|--------------|--------
 *   a) today (hardcoded pair)                          |   **FAIL**     |     pass     |     pass     | REFUSED
 *   b) paste all 15 ids into DEFAULT_SCENARIOS         |   **FAIL**     |     pass     |     pass     | REFUSED
 *   c) enumerate dynamically, drop --scenario support  |     pass       |   **FAIL**   |     pass     | REFUSED
 *   d) enumerate 15 and capture none                   |     pass       |     pass     |   **FAIL**   | REFUSED
 *   e) enumerate from the shipped bundles, keep both   |     pass       |     pass     |     pass     | ALL PASS
 *
 * **(b) is the one to watch and it is why clause (1) reads the DIRECTORY, not a count.** Pasting
 * fifteen ids into the constant makes today's numbers right and puts the sixteenth station back in the
 * same hole the day it ships — the frozen-list defect wearing a longer list. Clause (1) requires the
 * default set to be *derived* from what is on disk, so it asserts a source, not a cardinality.
 *
 * **(c) is why clause (2) exists.** `--scenario` is how a single station gets re-captured cheaply
 * during a fix; losing it would make every grade cost a 15-station sweep and the loop would stop being
 * run at all.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the sole RED and fails today. (2) and (3) are
 * counterweights and pass today. They are independent of what (1) measures: changing where the default
 * list comes from cannot remove the `--scenario` flag and cannot stop the capture writing files.
 *
 * NOT TESTED:
 *   - **That the twelve stale rooms are wrong.** This asserts the loop will refresh them; it says
 *     nothing about what they will show. Grading the refreshed sweep is the orchestrator's job.
 *   - **Capture cost.** Fifteen stations is ~7.5× the current default. Execution duration is explicitly
 *     not a constraint (D9), but nothing here bounds it either.
 *   - **Staleness detection.** Whether a capture records the commit it was taken at is #89, untouched.
 *   - **The other capture scripts.** Only `ui-xr-environment-room-capture.ts` is in scope; the grade
 *     and viseme captures have their own subject selection.
 *
 * ## FIXED (#101)
 *
 * `ui-xr-environment-room-capture.ts` now DERIVES its default station set from the shipped bundles:
 * `shippedStationIds()` reads `apps/ui-xr/public/xr-assets/generated/` for directories carrying
 * `learner-runtime-bundle.v1.json` (sorted), and `captureStationEnvironmentRooms` resolves
 * `input.scenarioIds ?? shippedStationIds()`. The hardcoded pair (`DEFAULT_SCENARIOS`,
 * ed_chest_pain_priority_v1 + telehealth_diabetes_health_literacy_v1) is gone; an empty derived set
 * fails closed instead of capturing nothing.
 *
 * Measured on disk 2026-08-14: 15 shipped bundles, all 15 now in the routine sweep. No station id
 * literal remains in the capture module. `--scenario` (clause 2) and the per-station `*-room.png`
 * write path (clause 3) are untouched.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const BUNDLES = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated");
const CAPTURE = join(REPO_ROOT, "tools/openclinxr/evidence/ui-xr-environment-room-capture.ts");

/** A bundle directory is a shipped station when it carries the learner runtime bundle. */
function shippedStations(): string[] {
  if (!existsSync(BUNDLES)) return [];
  return readdirSync(BUNDLES)
    .filter((d) => existsSync(join(BUNDLES, d, "learner-runtime-bundle.v1.json")))
    .sort();
}

const stations = shippedStations();
const source = existsSync(CAPTURE) ? readFileSync(CAPTURE, "utf8") : "";

/**
 * Does the module DERIVE its default station set from the shipped bundles, or carry a frozen list?
 * Reading the source is the honest instrument here: importing the module boots Playwright machinery,
 * and the question is about provenance of the list, not its runtime value.
 */
function derivesDefaultsFromDisk(): boolean {
  return /readdirSync\s*\([^)]*xr-assets\/generated|shippedStationIds|stationIdsFromBundles/.test(
    source,
  );
}

/** Station ids literally pasted into the module — the frozen-list smell, whatever its length. */
function hardcodedStationIds(): string[] {
  return stations.filter((id) => new RegExp(`["'\`]${id}["'\`]`).test(source));
}

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(stations.length, `shipped stations under ${BUNDLES} (15 measured 2026-08-14)`)
    .toBeGreaterThanOrEqual(12);
  expect(source.length, `${CAPTURE} is readable`).toBeGreaterThan(1000);
}

describe("the room capture enumerates every shipped station", () => {
  it("(1) RED: the default station set is derived from the shipped bundles", () => {
    // Refuses (b): asserts the SOURCE of the list, not its length. Fifteen pasted ids still fail.
    requireMeasured();
    const faults: string[] = [];
    if (!derivesDefaultsFromDisk()) {
      const frozen = hardcodedStationIds();
      faults.push(
        `${CAPTURE.split("/").pop()}: default station set is a frozen literal (${frozen.length} station id(s) hardcoded: ${frozen.join(", ") || "none matched, but no dynamic enumeration found either"}); ${stations.length} stations ship, so a routine run refreshes ${frozen.length} of ${stations.length} and the rest age silently`,
      );
    }
    expect(faults, "capture modules with a frozen default station set").toEqual([]);
  });

  it("(2) COUNTERWEIGHT: a single station can still be captured on its own", () => {
    // Refuses (c): losing --scenario makes every grade cost a full sweep, and the loop stops being run.
    requireMeasured();
    const hasFlag = /--scenario/.test(source);
    expect(hasFlag, "the --scenario single-station override must survive").toBe(true);
  });

  it("(3) COUNTERWEIGHT: the capture still writes a room image per station", () => {
    // Refuses (d): enumerating fifteen and capturing nothing satisfies clause (1) and grades nothing.
    requireMeasured();
    const writesImage = /-room\.png|roomPngPath|writeFileSync\([^)]*\.png/.test(source);
    expect(writesImage, "the capture must still emit a per-station room PNG").toBe(true);
  });
});
