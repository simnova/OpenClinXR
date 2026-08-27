import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeedBankAssetReadiness } from "../../../apps/api/src/api-route-support.js";
import { createScenarioPlaceholderManifests } from "../../../packages/openclinxr/asset-registry/src/index.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";

/**
 * OBSERVABLE: the API's readiness surface reports `devReady: true` for EVERY scenario in the bank,
 * on declared numbers, while one station's actors alone exceed the authored budget.
 *
 * MEASURED 2026-08-27 at head 50d6d263 by calling `createSeedBankAssetReadiness()` directly.
 * IMMUTABLE — flip the assertion and append a `## FIXED (#705)` block below; do not rewrite this
 * table.
 *
 *   all 14 scenarios: devReady TRUE, blockers 0, missingRequiredAssetIds 0
 *   declared totals: 108,000 (ed_chest_pain, peds_asthma, adult_abdominal_pain, peds_fever)
 *                     60,000 (ward_delirium, ob_headache, ed_stroke, stepdown_sepsis,
 *                             clinic_abdominal_pain, oncology_bad_news, postop_fever)
 *                     42,000 (telehealth_diabetes, psych_suicidal_ideation, primary_care_dyslipidemia)
 *
 * `api-route-support.ts:691-702` builds an `InMemoryAssetRegistry` from
 * `createScenarioPlaceholderManifests` and calls `registry.evaluateScenarioReadiness(scenario)` with
 * no second argument, so every manifest contributes its DECLARED `geometryBudget.maxTriangles`.
 *
 * #700 landed the seam — `evaluateScenarioReadiness(scenario, measuredTriangleCounts?)` at
 * `asset-registry/src/index.ts:2048` — and a typed `station_triangle_measurements_incomplete` blocker
 * at `:2346`. THREE call sites pass declarations only: `api-route-support.ts:700`,
 * `scenario-runtime.ts:507`, and `asset-registry/src/index.ts:2096`.
 *
 * Measured through the production join, `ed_chest_pain_priority_v1`'s three actors are
 * 64,802 + 38,913 + 33,623 = 137,338, and with the declared remainder the station is 191,338 against
 * an authored 180,000.
 *
 * ## WHERE THE MEASUREMENT COMES FROM — decided 2026-08-27, and the measurement forced it
 *
 * Neither consumer can open a GLB. `apps/api/src` contains no gltf reader outside its tests, and
 * `scenario-runtime`'s dependencies are all workspace packages with no filesystem or glTF library.
 * So request-time measurement is not available to either, and a slice that tried it would add a
 * parsing dependency to two apps.
 *
 * The counts are therefore a BUILD-TIME artifact: the factory measures once and commits the numbers,
 * and every caller reads them. That is the dark-factory shape (D9) and it removes the blocker on
 * `scenario-runtime` entirely — it never touches bytes. Clause (2) requires that artifact to carry
 * provenance and to agree with a fresh read, so a hand-typed table cannot satisfy it.
 *
 * ## THE DISCRIMINATOR — why a blanket false does not pass
 *
 * Most stations have no shipped humanoids at all, so an honest measurement is INCOMPLETE for them and
 * #700's typed blocker is the correct outcome. ED is different: its assets exist and exceed the
 * ceiling. Clause (1) demands the specific `station_triangle_budget_exceeded` on ED, and
 * counterweight (3) demands every non-ready row name a typed reason — so flipping all fourteen to
 * false with an empty blocker list fails.
 *
 * claimScope: whether the API's readiness surface weighs measured shipped geometry.
 * notEvidenceFor: that 180,000 is the right budget, never validated on Quest hardware; that any
 *   station is production-ready, a separate ladder this contract does not touch; that
 *   `scenario-runtime.ts:507` was fixed, which this contract does not reach.
 */

const REPO = join(import.meta.dirname, "../../..");
const MEASURED = join(REPO, "packages/openclinxr/asset-registry/src/measured-station-geometry.json");
const ED = "ed_chest_pain_priority_v1";

/** Declared sum for ED at the planting commit. Counterweight (4) pins it. */
const ED_DECLARED_AT_PLANTING = 108_000;

type Row = {
  scenarioId: string;
  devReady: boolean;
  stationBudget: { totalTriangles: number; blockers: string[]; maxVisibleTriangles: number };
  missingRequiredAssetIds: string[];
};

function rows(): Row[] {
  return createSeedBankAssetReadiness() as unknown as Row[];
}

function edRow(): Row {
  const row = rows().find((r) => r.scenarioId === ED);
  expect(row, `${ED} must be in the seed bank surface`).toBeTruthy();
  return row!;
}

describe("the API readiness surface weighs shipped geometry (#705)", () => {
  it.fails("(1) the ED station is not devReady, and names the budget as the reason", () => {
    const row = edRow();
    expect(
      row.stationBudget.blockers,
      "ED's three shipped actors measure 137,338 and the station 191,338 against 180,000, while this "
        + "surface sums 108,000 of declarations",
    ).toContain("station_triangle_budget_exceeded");
    expect(row.devReady, "devReady is gated on stationBudget.blockers being empty").toBe(false);
  });

  it.fails("(2) a measured-geometry artifact exists with provenance and agrees with the bytes", () => {
    expect(
      existsSync(MEASURED),
      `${MEASURED} must exist and be TRACKED. Neither consumer can open a GLB — apps/api has no gltf `
        + "reader outside tests and scenario-runtime depends only on workspace packages — so the "
        + "counts are a build-time artifact the factory commits, not a request-time read.",
    ).toBe(true);
    const doc = JSON.parse(readFileSync(MEASURED, "utf8")) as {
      generatedBy?: string;
      sources?: Record<string, string>;
      triangles?: Record<string, number>;
    };
    expect(
      doc.generatedBy,
      "a hand-typed table is the cheap way to satisfy clause (1); provenance names what produced this",
    ).toBeTruthy();
    expect(Object.keys(doc.triangles ?? {}).length, "no measured counts recorded").toBeGreaterThan(0);
    for (const [assetId, count] of Object.entries(doc.triangles ?? {})) {
      expect(count, `${assetId}: measured triangles`).toBeGreaterThan(0);
      const source = doc.sources?.[assetId];
      expect(source, `${assetId}: every count names the GLB it was read from`).toBeTruthy();
      expect(existsSync(join(REPO, String(source))), `${assetId}: ${source} must exist`).toBe(true);
    }
  });

  it("(3) COUNTERWEIGHT: every station that is not devReady names a typed reason", () => {
    for (const row of rows()) {
      if (row.devReady) continue;
      expect(
        row.stationBudget.blockers.length + row.missingRequiredAssetIds.length,
        `${row.scenarioId}: flipping every station to devReady false with no stated reason satisfies `
          + "clause (1) and tells an operator nothing. Most stations have no shipped humanoids, so "
          + "station_triangle_measurements_incomplete is the honest blocker for them — but it has to "
          + "be SAID.",
      ).toBeGreaterThan(0);
    }
  });

  it("(4) COUNTERWEIGHT: the ceiling and the declarations are not moved", () => {
    const row = edRow();
    expect(
      row.stationBudget.maxVisibleTriangles,
      "raising the authored ceiling past 191,338 keeps clause (1) green forever and changes what the "
        + "factory promises rather than what it measures",
    ).toBe(180_000);
    const edScenario = scenarioBank.find((sc) => sc.scenarioId === ED);
    const declared = createScenarioPlaceholderManifests(edScenario as never)
      .reduce((sum, m) => sum + m.geometryBudget.maxTriangles, 0);
    expect(
      declared,
      "the DECLARATIONS are the input and the fix must not touch them. Inflating them until the "
        + "declared sum breaches 180,000 flips clause (1) without any path ever opening a GLB, which "
        + "is the other cheap fix. The station TOTAL may rise as measured counts replace declared "
        + "ones; this sum may not.",
    ).toBe(ED_DECLARED_AT_PLANTING);
  });
});

// NOT TESTED: `scenario-runtime.ts:507` and `asset-registry/src/index.ts:2096`, the other two bare
// callers, which this contract does not reach; whether 180,000 is right, never validated on Quest
// hardware; the production-readiness ladder, a separate surface; whether the measured artifact stays
// fresh when an asset is rebaked, which nothing here checks and which is the obvious way for this to
// rot.
