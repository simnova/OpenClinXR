import { describe, expect, it } from "vitest";
import {
  InMemoryAssetRegistry,
  createEdChestPainLocalAssetEvidenceFixtureManifests,
} from "../../../packages/openclinxr/asset-registry/src/index.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";

/**
 * OBSERVABLE: `evaluateScenarioReadiness` reports `devReady: true` for the ED chest-pain station
 * while that station's actors, measured through the production join, exceed the authored Quest
 * budget by 11,338 triangles.
 *
 * MEASURED 2026-08-26 at head 8666e83f. IMMUTABLE — flip the assertion and append a
 * `## FIXED (#700)` block below; do not rewrite these numbers.
 *
 * `InMemoryAssetRegistry.evaluateScenarioReadiness` (`asset-registry/src/index.ts:2089`):
 *
 *     const stationBudget = evaluateScenarioAssetBudget(presentRequiredManifests);
 *
 * No second argument, so every manifest contributes its DECLARED `geometryBudget.maxTriangles`. Two
 * lines below, `stationBudget.blockers.length === 0` gates both `devReady` and `productionReady`.
 *
 * #699 gave `evaluateScenarioAssetBudget` an optional `measuredTriangleCounts` parameter and wired
 * exactly one caller — the readiness benchmark. This one, which produces the verdict, still passes
 * declarations only. Measured through `createEdChestPainLocalEncounterRuntimeAssetBundle`:
 *
 *     declared, as this path computes it      108,000     no blockers
 *     measured characters + declared rest     191,338     station_triangle_budget_exceeded
 *
 * against `quest3StationBudget.maxVisibleTriangles` of 180,000. Per-actor measured:
 * `patient_robert_hayes_character` 64,802, `nurse_maria_alvarez_character` 38,913,
 * `spouse_anna_hayes_character` 33,623. The 54,000 difference between the character sum and the
 * total is the declared fallback for the non-character manifests.
 *
 * ## THE SCOPE OF THE CLAIM IS NARROWER THAN IT LOOKS — do not widen it
 *
 * `productionReady` is ALREADY false on this station, and NOT because of the budget: the budget
 * contributed zero blockers, and both `missingRequiredAssetIds` and `blockedAssets` are empty, so the
 * false comes from `productionBlockedAssets`. This is a `devReady` defect. It is not a
 * production-readiness overclaim and must not be written up as one.
 *
 * ## THE POPULATION IS DEGENERATE, AND THAT IS WHY THERE IS NO SECOND KNOWN-GOOD
 *
 * Measured across all fourteen bank scenarios with the ED fixture manifests upserted: ED is the ONLY
 * one reporting `devReady: true`. The other thirteen are false because their manifests are absent
 * (`missingRequiredAssetIds` 2-10 each, `stationBudget.totalTriangles` 0 for twelve of them and
 * 20,000 for `adult_abdominal_pain_v1`). So a counterweight of the form "some other scenario stays
 * devReady" cannot be written — there is no such scenario. Counterweights (2)-(4) guard the cheap
 * fixes directly instead, and clause (1)'s flip must come from the BUDGET and nothing else.
 *
 * ## WHICH CALLER SHOULD READ GEOMETRY, decided 2026-08-26
 *
 * This one, and not `buildEnvironmentGenerationPacket` (`index.ts:1215`). That caller builds a
 * generation packet — it runs BEFORE the assets it describes exist, so reading shipped bytes there is
 * wrong by construction and its declared `questBudget` is correct as it stands. A contract requiring
 * every call site to pass measured counts would have decided that by default and been wrong.
 *
 * claimScope: whether the readiness verdict for one station weighs measured shipped geometry.
 * notEvidenceFor: that 180,000 is the right budget — it has never been validated on Quest hardware,
 *   so this proves a DECLARED budget is breached and nothing about real frame cost; that any other
 *   scenario's verdict is correct, since thirteen of fourteen have no manifests at all; that
 *   `productionReady` is affected, which it is not.
 */

const ED = "ed_chest_pain_priority_v1";

/** Declared sum at the planting commit. Counterweight (4) pins it so the flip cannot come from here. */
const DECLARED_TOTAL_AT_PLANTING = 108_000;

type Readiness = {
  devReady: boolean;
  productionReady: boolean;
  /** `evaluateScenarioAssetBudget` spreads the authored budget into its return, so the ceiling is
   *  readable from the verdict itself — the constant is module-private and must not be read by
   *  scanning source text. */
  stationBudget: { totalTriangles: number; blockers: string[]; maxVisibleTriangles: number };
  missingRequiredAssetIds: string[];
  blockedAssets: unknown[];
};

function edReadiness(): Readiness {
  const registry = new InMemoryAssetRegistry();
  for (const manifest of createEdChestPainLocalAssetEvidenceFixtureManifests()) registry.upsert(manifest);
  const scenario = scenarioBank.find((s) => s.scenarioId === ED);
  expect(scenario, `${ED} must be in the bank`).toBeTruthy();
  return registry.evaluateScenarioReadiness(scenario as never) as unknown as Readiness;
}

describe("the readiness verdict weighs the geometry that ships (#700)", () => {
  it.fails("(1) the ED station is not devReady while its shipped actors exceed the budget", () => {
    const r = edReadiness();
    expect(
      r.stationBudget.blockers,
      "the station measures 191,338 triangles through the production join against an authored "
        + "180,000, and this path sums 108,000 of declarations instead",
    ).toContain("station_triangle_budget_exceeded");
    expect(r.devReady, "devReady is gated on stationBudget.blockers being empty").toBe(false);
  });

  it("(2) COUNTERWEIGHT: the authored station budget is not raised", () => {
    expect(
      edReadiness().stationBudget.maxVisibleTriangles,
      "raising the budget past the measured 191,338 is the cheapest way to keep clause (1) green "
        + "later, and it changes what the factory promises rather than what it measures",
    ).toBe(180_000);
  });

  it("(3) COUNTERWEIGHT: the flip comes from the budget, not from assets going missing or blocked", () => {
    const r = edReadiness();
    expect(
      r.missingRequiredAssetIds,
      "marking a required asset missing also drives devReady false, and would satisfy clause (1) "
        + "while measuring nothing about geometry",
    ).toEqual([]);
    expect(
      r.blockedAssets,
      "blocking an asset is the other route to a false devReady that has nothing to do with the "
        + "budget",
    ).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the declared maxima are not raised to force a blocker", () => {
    const declared = createEdChestPainLocalAssetEvidenceFixtureManifests()
      .reduce((sum, m) => sum + m.geometryBudget.maxTriangles, 0);
    expect(
      declared,
      "inflating declarations until the DECLARED sum breaches 180,000 would flip clause (1) without "
        + "any path ever opening a GLB — the declared-vs-measured gap is the defect, not the lever",
    ).toBe(DECLARED_TOTAL_AT_PLANTING);
  });
});

// NOT TESTED: the other thirteen bank scenarios, none of which has manifests here and all of which
// are already devReady false for a different reason; whether 180,000 is the right budget, never
// validated on Quest hardware; whether `buildEnvironmentGenerationPacket` should read geometry, which
// this contract deliberately leaves declaration-only because it runs before assets exist; texture
// megabytes and draw calls, still summed from declarations at every call site including #699's.
