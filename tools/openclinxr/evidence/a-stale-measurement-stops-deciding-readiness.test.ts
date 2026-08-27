import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeedBankAssetReadiness } from "../../../apps/api/src/api-route-support.js";

/**
 * OBSERVABLE: the readiness verdict trusts `MEASURED_STATION_GEOMETRY.triangles` unconditionally, and
 * the freshness checker built to police it has no caller.
 *
 * MEASURED 2026-08-27 at head 91eb6479. IMMUTABLE — flip the assertion and append a
 * `## FIXED (#711)` block below; do not rewrite these paths or numbers.
 *
 *   api-route-support.ts:704
 *     ...registry.evaluateScenarioReadiness(scenario, MEASURED_STATION_GEOMETRY.triangles),
 *
 * `findStaleMeasuredGeometry` (#707) has ZERO non-test callers and is not re-exported from
 * `asset-registry/src/index.ts`. Grepping `apps`, `packages` and `tools` outside the module and its
 * tests returns a `dist` `.d.ts` and one docstring mention at
 * `tools/openclinxr/measure-station-geometry.ts:18`. Neither is a call.
 *
 * So a rebake changes the GLB, the fingerprint stops matching, and the verdict keeps citing the old
 * count. Today that count is what puts `ed_chest_pain_priority_v1` at 191,338 with
 * `station_triangle_budget_exceeded` while the other thirteen carry
 * `station_triangle_measurements_incomplete`.
 *
 * ## FIFTH LAYER OF ONE DEFECT
 *
 * #699 summed declarations and never opened a GLB. #700 forwarded nothing. #705 had no caller filling
 * the seam. #707 gave the artifact a fingerprint and a checker. Each fix was real and each moved the
 * lie one layer along. **A mechanism that lands without a caller is not done**, and exporting this one
 * from the barrel would be the same defect with a shorter grep.
 *
 * ## THE PRECONDITION IS MEASURED, NOT ASSUMED
 *
 * `apps/api` already reads the repo tree at runtime — `api-support.ts:17` is a `readFileSync` behind
 * `readRepoGeneratedJsonIfExists`, and `:46` names a path under `apps/ui-xr/public/`, returning
 * `undefined` when the file is absent. So a filesystem check is available to this consumer, and the
 * degrade-when-missing idiom already exists here. `scenario-runtime` still cannot do this and is out
 * of scope, as it was for #705 and #707.
 *
 * ## A SECOND STALENESS AXIS, MEASURED HERE AND NOT PREVIOUSLY NAMED
 *
 * `packages/openclinxr/asset-registry/dist/measured-station-geometry.json` is a SEPARATE COPY, 1,187
 * bytes, and the API resolves the package to `dist`. So the verdict reads the BUILT artifact while
 * the generator and #707's checker operate on `src`. They agree today. Nothing makes them agree.
 *
 * A freshness check that validates `src` therefore does not police what the verdict consumes, and a
 * slice here must say which copy is authoritative and make the check read that one.
 *
 * HONEST LIMIT ON COUNTERWEIGHT (3): it goes through `createSeedBankAssetReadiness`, so it reads the
 * BUILT copy. Editing `src` — emptying the maps, deleting a count — does not move it, which means I
 * could NOT falsify it by hand and it is recorded as unproven rather than as a probed guard.
 * Counterweight (4) reads `src` directly and DID red on both edits.
 *
 * ## THE HONEST OUTCOME ALREADY EXISTS
 *
 * A stale or unreadable source must drop that count so #700's typed
 * `station_triangle_measurements_incomplete` fires for the affected station. Not a silent fall back to
 * the declaration, and not the stale number.
 *
 * claimScope: whether a stale fingerprint stops a measured count from deciding a readiness verdict.
 * notEvidenceFor: that the counts are arithmetically right, which fingerprints cannot speak to; that
 *   `scenario-runtime.ts:507` or `asset-registry/src/index.ts:2096` were fixed, both still bare and
 *   both out of scope; that the check runs anywhere other than this consumer.
 */

/**
 * ## FIXED (#711)
 *
 * `freshMeasuredTriangleCounts(doc, repoRoot)` now composes `findStaleMeasuredGeometry` and filters
 * `doc.triangles` down to fingerprint-matching counts; `createSeedBankAssetReadiness(doc?)`
 * consumes it (apps/api/src/api-route-support.ts) with an optional artifact override, defaulting to
 * the built `MEASURED_STATION_GEOMETRY` the verdict reads. A stale or missing source drops that
 * count, so `evaluateScenarioAssetBudget` fires #700's typed
 * `station_triangle_measurements_incomplete` instead of the stale number or a declaration fallback.
 * Repo root resolves like `readRepoGeneratedJsonIfExists` (cwd, then the `../..` hop from
 * `apps/api`), so the committed artifact still puts ED at 191,338 over budget — clause (3) now
 * falsifiable via the built copy or the GLBs, no longer only via editing `src`.
 */

const REPO = join(import.meta.dirname, "../../..");
const ARTIFACT = join(REPO, "packages/openclinxr/asset-registry/src/measured-station-geometry.json");
const ED = "ed_chest_pain_priority_v1";
const ED_PATIENT = "patient_robert_hayes_character";

/** Landed counts. Counterweight (4) pins them: regenerating is not a fix, and neither is deleting. */
const PINNED_TRIANGLES: Readonly<Record<string, number>> = {
  patient_robert_hayes_character: 64_802,
  nurse_maria_alvarez_character: 38_913,
  spouse_anna_hayes_character: 33_623,
};

type Artifact = {
  sources?: Record<string, string>;
  triangles?: Record<string, number>;
  fingerprints?: Record<string, { bytes?: number; sha256?: string }>;
};

function committed(): Artifact {
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Artifact;
}

function withCorruptedFingerprint(): Artifact {
  const doc = JSON.parse(JSON.stringify(committed())) as Artifact;
  doc.fingerprints![ED_PATIENT] = { bytes: 1, sha256: "0".repeat(64) };
  return doc;
}

type Row = { scenarioId: string; devReady: boolean; stationBudget: { totalTriangles: number; blockers: string[] } };

function edRow(rows: Row[]): Row {
  const row = rows.find((r) => r.scenarioId === ED);
  expect(row, `${ED} must be present`).toBeTruthy();
  return row!;
}

describe("a stale measurement stops deciding readiness (#711)", () => {
  it("(1) only fresh counts are handed to the verdict", async () => {
    const mod = (await import(
      "../../../packages/openclinxr/asset-registry/src/measured-station-geometry-freshness.js"
    )) as { freshMeasuredTriangleCounts?: (doc: unknown, repoRoot: string) => Record<string, number> };
    expect(
      typeof mod.freshMeasuredTriangleCounts,
      "the counts handed to evaluateScenarioReadiness must be filtered by the freshness check, so "
        + "there has to be something that does the filtering",
    ).toBe("function");

    const fresh = mod.freshMeasuredTriangleCounts!(committed(), REPO);
    for (const [assetId, count] of Object.entries(PINNED_TRIANGLES)) {
      expect(fresh[assetId], `${assetId}: a fresh artifact must keep every count`).toBe(count);
    }

    const filtered = mod.freshMeasuredTriangleCounts!(withCorruptedFingerprint(), REPO);
    expect(
      Object.keys(filtered),
      `${ED_PATIENT}'s fingerprint no longer matches its GLB, so its count must be dropped rather `
        + "than handed on",
    ).not.toContain(ED_PATIENT);
  });

  it("(2) a stale source changes the verdict, and to the typed incomplete blocker", () => {
    // The seam: `createSeedBankAssetReadiness` accepts an artifact override so a stale document can
    // be exercised without mutating a tracked file. Default stays the committed artifact.
    const build = createSeedBankAssetReadiness as unknown as (doc?: unknown) => Row[];
    const stale = build(withCorruptedFingerprint());
    const row = edRow(stale);
    expect(
      row.stationBudget.blockers,
      "with the patient's count dropped, ED can no longer be shown over budget — the honest verdict "
        + "is #700's typed incomplete blocker, not a silent fall back to declarations",
    ).toContain("station_triangle_measurements_incomplete");
    expect(
      row.stationBudget.blockers,
      "citing a count whose fingerprint no longer matches is the defect this card exists for",
    ).not.toContain("station_triangle_budget_exceeded");
    expect(row.devReady, "a station with an unusable measurement is not dev-ready").toBe(false);
  });

  it("(3) COUNTERWEIGHT: the committed artifact still puts ED over budget", () => {
    const row = edRow(createSeedBankAssetReadiness() as unknown as Row[]);
    expect(
      row.stationBudget.blockers,
      "making every station report incomplete satisfies clause (2) and destroys the finding #705 "
        + "landed. With a FRESH artifact the budget breach must still be reported. NOTE: this reads "
        + "the BUILT copy in dist, so an edit to src does not move it — see the header; treat this "
        + "clause as unproven until the src/dist authority question is settled.",
    ).toContain("station_triangle_budget_exceeded");
    expect(row.stationBudget.totalTriangles, "ED's measured total").toBe(191_338);
  });

  it("(4) COUNTERWEIGHT: the counts and fingerprints are not edited away", () => {
    const doc = committed();
    for (const [assetId, count] of Object.entries(PINNED_TRIANGLES)) {
      expect(doc.triangles?.[assetId], `${assetId}: count must not change`).toBe(count);
      expect(
        doc.fingerprints?.[assetId]?.sha256,
        `${assetId}: deleting the fingerprint makes the freshness question unanswerable, which is a `
          + "way to pass clause (1) by removing the check's input",
      ).toBeTruthy();
    }
  });
});

// NOT TESTED: `scenario-runtime.ts:507` and `asset-registry/src/index.ts:2096`, both still bare and
// deliberately out of scope; whether the GLBs are present in a deployed API image, which decides
// whether the check degrades to incomplete-everywhere in production and which nobody has measured;
// the cost of hashing three sources on a request path; whether the triangle arithmetic was right,
// which no fingerprint can speak to.
