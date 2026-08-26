import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEdChestPainPlaceholderManifests,
  evaluateScenarioAssetBudget,
} from "../../../packages/openclinxr/asset-registry/src/index.js";

/**
 * OBSERVABLE: the readiness verdict that gates `devReady` computes its station budget from DECLARED
 * triangles. #699 gave the evaluator a measured-geometry input; nothing on the readiness path passes
 * it.
 *
 * MEASURED 2026-08-26 at head 3b979a25. `evaluateScenarioAssetBudget` takes an optional
 * `measuredTriangleCounts` and falls back per asset to `manifest.geometryBudget.maxTriangles`
 * (`asset-registry/src/index.ts:2343`). Three callers:
 *
 *   index.ts:1215  questBudget    NO measurements
 *   index.ts:2089  stationBudget  NO measurements   <- and :2093 / :2097 read its blockers
 *   asset-production-readiness-benchmark.ts:854     yes
 *
 * Run on the ten ED manifests:
 *
 *   declarations only, which is what :2089 passes   108,000   no blockers
 *   the three characters' shipped bytes             159,608   no blockers
 *
 * Both clear the authored 180,000, so nothing is misreported TODAY and the readiness path is 51,608
 * triangles blind. Latent, not live — the same shape as the contract-verify hole earlier today.
 *
 * A FIGURE OF 191,338 WITH `station_triangle_budget_exceeded` WAS PROPOSED FOR THIS CARD AND DOES NOT
 * REPRODUCE. Measuring the three characters gives 159,608 and no blocker. Rather than plant a number
 * nobody can reproduce, these clauses assert the MECHANISM and never a total.
 *
 * KNOWN-GOOD COLUMN: `asset-production-readiness-benchmark.ts:854` already passes measured counts, so
 * the call shape is demonstrated in-tree and clause (1) is not asking for something unproven.
 *
 * claimScope: whether the readiness path supplies measured geometry, and whether a partial
 *   measurement set fails closed.
 * notEvidenceFor: that 180,000 is the right budget, that any station exceeds it, or that the seven
 *   unmeasured ED manifests resolve to shipped assets at all.
 */

const REGISTRY = join(process.cwd(), "packages/openclinxr/asset-registry/src/index.ts");

/** The measured counts for the three ED characters that DO join a shipped GLB via runtime-bundles.ts:712. */
const MEASURED_THREE: Readonly<Record<string, number>> = {
  patient_robert_hayes_character: 32_208,
  nurse_maria_alvarez_character: 34_572,
  spouse_anna_hayes_character: 38_828,
};

/** Reads the argument list of the readiness call site so a clause can see what it passes. */
function stationBudgetCallSite(): string {
  const src = readFileSync(REGISTRY, "utf8");
  const m = src.match(/const stationBudget = evaluateScenarioAssetBudget\(([^)]*)\)/);
  if (!m) throw new Error("the stationBudget call site moved; this clause must be re-aimed, not deleted");
  return m[1]!.trim();
}

describe("the readiness verdict reads measured geometry", () => {
  it.fails("(1) the readiness call site passes measured geometry, not manifests alone", () => {
    const args = stationBudgetCallSite();
    const argCount = args.split(",").filter((a) => a.trim().length > 0).length;
    expect(
      argCount,
      `evaluateScenarioAssetBudget(${args}) — one argument means declarations. index.ts:2093 and `
        + ":2097 read this result's blockers to compute devReady, so the gate that decides readiness "
        + "cannot see a shipped asset's real geometry. The call shape is already demonstrated at "
        + "asset-production-readiness-benchmark.ts:854",
    ).toBeGreaterThanOrEqual(2);
  });

  it.fails("(2) a PARTIAL measurement set fails closed rather than mixing real and declared", () => {
    const manifests = createEdChestPainPlaceholderManifests();
    // Three of ten assets measured. The evaluator's per-asset fallback silently supplies declarations
    // for the other seven, producing one total that is part real and part fiction.
    const partial = evaluateScenarioAssetBudget(manifests, MEASURED_THREE);
    const declaredOnly = evaluateScenarioAssetBudget(manifests);
    // TIGHTENED before dispatch, after a consult found the loophole: asserting only that the totals
    // match lets a worker DISCARD the partial measurements, return the declared 108,000, leave
    // readiness green, and flip this clause. The refusal has to be CONSEQUENTIAL, and it is —
    // index.ts:2093 computes devReady from stationBudget.blockers.
    expect(
      partial.blockers,
      "a measurement set covering 3 of 10 assets must produce a typed blocker, not a blended total. "
        + `Today: declared ${declaredOnly.totalTriangles}, blended ${partial.totalTriangles}, `
        + `blockers ${JSON.stringify(partial.blockers)}. Silently discarding the partial input and `
        + "returning the declared total would satisfy a totals-only assertion while preserving the "
        + "exact defect this card exists to remove",
    ).toContain("station_triangle_measurements_incomplete");
  });

  it("(3) COUNTERWEIGHT: the declared-vs-measured gap is real, so (1) is not hypothetical", () => {
    const manifests = createEdChestPainPlaceholderManifests();
    const declared = evaluateScenarioAssetBudget(manifests).totalTriangles;
    const withThree = evaluateScenarioAssetBudget(manifests, MEASURED_THREE).totalTriangles;
    expect(declared, "the declaration-only total this card exists to replace").toBe(108_000);
    expect(withThree, "three characters' shipped bytes against 18,000 declared each").toBe(159_608);
    expect(
      withThree - declared,
      "51,608 triangles the readiness gate cannot currently see; if this ever reaches 0 the gap "
        + "closed by raising the declarations, which clause (4) refuses",
    ).toBe(51_608);
  });

  it("(4) COUNTERWEIGHT: the declared maxima are not raised to match the bytes", () => {
    for (const m of createEdChestPainPlaceholderManifests()) {
      if (m.kind !== "character") continue;
      expect(
        m.geometryBudget.maxTriangles,
        `${m.assetId}: raising the declaration to meet the bytes satisfies any total-based clause `
          + "while deleting the signal this card is about",
      ).toBe(18_000);
    }
  });

  it("(5) COUNTERWEIGHT: the pre-generation planning path may stay declaration-based", () => {
    const src = readFileSync(REGISTRY, "utf8");
    expect(
      src.includes("buildEnvironmentGenerationPacket"),
      "before generation the assets do not exist to measure, so forcing measurement there would "
        + "break planning; this clause records that the exemption is deliberate",
    ).toBe(true);
  });
});

// NOT TESTED: that 180,000 is the right budget — it is authored policy never validated on Quest
// hardware. Nor whether the seven non-character ED manifests resolve to shipped assets; only the
// three characters have a demonstrated join at runtime-bundles.ts:712.
