import { existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The contact sheet is the orchestrator's grading instrument, and it cannot tell you whether the
 * actors had loaded when it fired.**
 *
 * #213: two lit captures of `psych_suicidal_ideation_safety_v1` disagree. #209's multi-station panel
 * shows desk, chairs, monitor, floor mat and **no humanoid geometry**; #211's single-station capture
 * of the same scenario shows **three upright clothed figures** at 32,207 / 34,571 / 38,827 skinned
 * triangles. The single-station capture is the control and it is the measured truth.
 *
 * ## MECHANISM, LOCATED IN SOURCE — do not re-derive
 *
 * `station-room-not-empty.ts:217-219` is the sheet's capture path:
 *
 *     await waitForStationShell(page, 180_000);
 *     await waitForFrames(page, 8, 120_000);
 *     await page.waitForTimeout(900);
 *
 * `waitForStationShell` (`ui-xr-environment-room-capture.ts:889`) resolves the moment the scene
 * carries `openClinXrStationEnvironment.environmentId` **or** a node named
 * `openclinxr.station-environment-shell`. **It says nothing whatsoever about humanoids.** Eight frames
 * and 900 ms later the panel is captured, loaded or not.
 *
 * **`waitForHumanoidAssetsLoaded` exists in the same file, 32 lines below, at `:921`, and this capture
 * never calls it.** That is the repo's characteristic defect — a proven component sitting unconsumed
 * beside the code that needs it.
 *
 * ## THE SHARPER HALF: THE RECORD IS SILENT
 *
 * `RoomFacts` carries `declaredSlotIds`, `builtSlotIds`, `markerCubeSlotIds`, `mountedEquipmentIds`,
 * `hasCeiling`, `shellTriangles`, `patientSupportSurfaceCount`, `actorsIntersectingFurniture`.
 * **There is no count of humanoids that actually rendered.** So a panel captured mid-load is
 * indistinguishable, in the artifact, from a station that genuinely has no cast — and every verdict
 * ever read off this sheet inherits that ambiguity, including #209's readings of the OTHER stations,
 * which nobody has re-checked.
 *
 * Adding the wait alone would fix the symptom and leave the instrument still unable to report on
 * itself. **A capture that grades appearance must record whether it had anything to grade.**
 *
 * ## THE ANTI-CHEAT THAT MATTERS
 *
 * The cheapest way to make "expected equals observed" true forever is to source BOTH numbers from
 * `resolveScenarioActorCast`. That is vacuous by construction and would have passed on the very
 * capture that produced the empty psych panel. `liveObserved` must come from the running scene —
 * traversal of skinned meshes — and `castExpected` from the resolver. Clause (3) feeds the comparator
 * a doctored row where they differ and requires it to be reported.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                            | (1) reports | (2) shell kept | (3) mismatch | result
 *   ------------------------------------------------------|-------------|----------------|--------------|--------
 *   a) today — no humanoid field, no humanoid wait        |  **FAIL**   |      pass      |   **FAIL**   | REFUSED
 *   b) add the wait, record nothing                       |  **FAIL**   |      pass      |   **FAIL**   | REFUSED
 *   c) record both numbers from the resolver              |    pass     |      pass      |   **FAIL**   | REFUSED
 *   d) replace RoomFacts with a humanoid-only record      |    pass     |   **FAIL**     |     pass     | REFUSED
 *   e) wait for humanoids; record live vs resolver        |    pass     |      pass      |     pass     | ALL PASS
 *
 * **Clause (2) is a SOURCE-TEXT check and that is its limit (§6e).** It proves the identifiers survive;
 * it cannot prove they are still populated from the live scene. A behavioural version needs the record
 * this slice is asking for, so it is the honest instrument available before the fix, not after.
 *
 * **(c) is the one to watch** — it is what a worker reaches for when the contract says "expected must
 * equal observed" and nothing says where each comes from (§7r).
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) and (3) are REDs** — the surface does not exist, so
 * both fail on its absence. **(2) passes today** and is a true net. **(4) passes today**; it reads the
 * fixture, not the surface.
 *
 * NOT TESTED:
 *   - **That a re-captured psych panel then shows three figures.** That is a pixel grade and the
 *     orchestrator does it after, from a fresh capture.
 *   - **Whether #209's other station verdicts were also wrong.** They are suspect and unmeasured.
 *   - **The single-station capture path**, which already waits correctly and is the control here.
 *   - **Which of the two waits is sufficient** — #187 established the humanoid wait can itself release
 *     at the first skinned mesh, so wiring it is necessary and may not be sufficient.
 *
 * ## FIXED (#213)
 * - `station-room-not-empty.ts` now waits for humanoid assets on the sheet's capture path
 *   (`waitForHumanoidAssetsLoaded`, the proven wait at `ui-xr-environment-room-capture.ts:921`)
 *   instead of shell-only + 8 frames + 900 ms. The wait is bounded: a station that never finishes
 *   loading is recorded as `liveObserved=0` (a real finding), not allowed to kill the sweep.
 * - `RoomFacts` now carries `castExpectedHumanoids` (from `resolveScenarioActorCast`) and
 *   `liveObservedHumanoids` (outermost `openClinXrActorId` roots carrying a skinned mesh with
 *   nonzero triangles), so a mid-load panel is distinguishable in the artifact from a station
 *   with no cast.
 * - `selectHumanoidPresenceMismatches(rows)` reports scenario ids whose live count fell below
 *   the cast; clauses (1) and (3) flipped to plain `it` and pass on the fixture.
 * - #187's caveat stands: the humanoid wait can itself release at the first skinned mesh, so a
 *   below-cast row with the wait in place is data about the capture, not noise.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, "station-room-not-empty.ts");
/** Computed so TypeScript cannot resolve a not-yet-exported symbol at compile time (#383/#352). */
const SPECIFIER = ["./station-room-not", "empty.js"].join("-");

/** One station's humanoid presence as the artifact must carry it. */
type PresenceRow = { scenarioId: string; castExpected: number; liveObserved: number };

/** Two stations agree, one is a mid-load capture — the shape the psych panel actually was. */
const FIXTURE: PresenceRow[] = [
  { scenarioId: "ed_chest_pain_priority_v1", castExpected: 3, liveObserved: 3 },
  { scenarioId: "psych_suicidal_ideation_safety_v1", castExpected: 3, liveObserved: 0 },
  { scenarioId: "peds_asthma_parent_anxiety_v1", castExpected: 3, liveObserved: 3 },
];
const MISMATCHED = "psych_suicidal_ideation_safety_v1";

type Select = (rows: readonly PresenceRow[]) => string[];

async function loadSelector(): Promise<Select | null> {
  if (!existsSync(CAPTURE)) return null;
  try {
    const mod = (await import(SPECIFIER)) as { selectHumanoidPresenceMismatches?: Select };
    return mod.selectHumanoidPresenceMismatches ?? null;
  } catch {
    return null;
  }
}

const selector = await loadSelector();

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireSelector(): Select {
  expect(
    selector,
    "station-room-not-empty.ts must export selectHumanoidPresenceMismatches(rows) — today RoomFacts carries no humanoid count at all",
  ).not.toBeNull();
  return selector as Select;
}

describe("the station sheet records whether the actors loaded", () => {
  it("(1) RED: the capture reports a humanoid presence row per station", () => {
    const mismatches = requireSelector()(FIXTURE);
    expect(Array.isArray(mismatches), "a mismatch selector over per-station presence rows").toBe(true);
  });

  it("(3) RED / ANTI-CHEAT: a station whose live count is below its cast is reported", () => {
    // Refuses (c). If both numbers come from the resolver they can never differ, and the capture that
    // produced the empty psych panel would still pass.
    const mismatches = requireSelector()(FIXTURE);
    expect(
      mismatches,
      `${MISMATCHED} rendered 0 of 3 cast actors — a mid-load capture must not be indistinguishable from an empty station`,
    ).toEqual([MISMATCHED]);
  });

  it("(2) COUNTERWEIGHT: the existing room facts stay in the record", () => {
    // Refuses (d). The sheet's staging verdicts — slots, equipment, ceiling, furniture intersection —
    // are the reason it exists; a humanoid field must be added beside them, not instead of them.
    const src = require("node:fs").readFileSync(CAPTURE, "utf8") as string;
    for (const field of [
      "declaredSlotIds",
      "builtSlotIds",
      "markerCubeSlotIds",
      "mountedEquipmentIds",
      "hasCeiling",
      "shellTriangles",
      "patientSupportSurfaceCount",
      "actorsIntersectingFurniture",
    ]) {
      // WORD-BOUNDARY, not `toContain`. A destructive probe renaming `hasCeiling` -> `hasCeilingPROBE`
      // PASSED a substring check — the §7k marker problem in a check written to catch it. Re-probed
      // after this change and it bites.
      expect(
        new RegExp(`\\b${field}\\b`, "u").test(src),
        `RoomFacts must still carry ${field} (exact identifier, not a superset name)`,
      ).toBe(true);
    }
  });

  it("(4) VACUITY GUARD: the fixture contains a matching and a mismatching station", () => {
    expect(FIXTURE.filter((r) => r.liveObserved === r.castExpected).length, "agreeing stations").toBeGreaterThan(0);
    expect(FIXTURE.filter((r) => r.liveObserved < r.castExpected).length, "mid-load stations").toBe(1);
  });
});
