import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: every readiness verdict the API serves now rests on a committed measurement, and
 * nothing checks that the measurement still describes the files it names.
 *
 * MEASURED 2026-08-27 at head e083f92f. IMMUTABLE — flip the assertion and append a
 * `## FIXED (#707)` block below; do not rewrite these numbers.
 *
 * `packages/openclinxr/asset-registry/src/measured-station-geometry.json` top-level keys:
 *
 *     generatedAt, generatedBy, sources, triangles
 *
 * No hash. No size. No commit. `generatedAt` is a wall-clock stamp that says nothing about the
 * assets. `tools/openclinxr/measure-station-geometry.ts` is run by hand and no gate invokes it.
 *
 * The counts it carries, and what they now decide (#705, landed):
 *
 *     patient_robert_hayes_character   64,802
 *     nurse_maria_alvarez_character    38,913
 *     spouse_anna_hayes_character      33,623
 *
 *     ed_chest_pain_priority_v1  ->  191,338  station_triangle_budget_exceeded
 *     the other thirteen         ->  station_triangle_measurements_incomplete
 *
 * A rebake changes the bytes and leaves the numbers. The verdict keeps citing them and nothing
 * notices.
 *
 * ## THIS IS THE FOURTH RESTING PLACE OF ONE DEFECT
 *
 * #699: a gate summed declared triangles and never opened a GLB. #700: the readiness path forwarded
 * nothing. #705: no caller filled the seam. Each fix moved the lie one layer along. The numbers are
 * now real, and nothing keeps them real.
 *
 * ## WHERE THE CHECK GOES — decided 2026-08-27, and #705's constraint decides it
 *
 * Not at read time. `scenario-runtime` consumes this registry and has NO filesystem dependency — the
 * same constraint that forced the build-time decision in #705 — so it cannot stat a file, let alone
 * hash one. A check every consumer must run is a check one consumer cannot run.
 *
 * So the artifact carries the fingerprint and a GATE compares it. Consumers keep trusting the
 * artifact; the gate is what makes that trust earned. Clause (2) requires the comparison to fail
 * closed, and proves it inside this file against a corrupted copy rather than asserting it.
 *
 * ## RE-RUNNING THE GENERATOR IS NOT THE FIX
 *
 * That refreshes today's numbers and leaves tomorrow's rot. Counterweight (4) pins the three counts
 * so a slice that only regenerates changes nothing and still fails.
 *
 * claimScope: whether the artifact carries a per-source fingerprint that matches the bytes on disk,
 *   and whether a mismatch is detected rather than ignored.
 * notEvidenceFor: that the counts are correct — clause (1) proves they describe the CURRENT files,
 *   not that the triangle arithmetic was right; that any consumer reacts correctly to a stale
 *   artifact, which no clause here reaches; that the generator runs in CI, a separate question.
 *
 * ## FIXED (#707)
 *
 * The artifact now carries a per-source `fingerprints` map (bytes + sha256), emitted by
 * `tools/openclinxr/measure-station-geometry.ts` from the bytes it already reads. The gate is
 * `findStaleMeasuredGeometry(doc, repoRoot)` in
 * `packages/openclinxr/asset-registry/src/measured-station-geometry-freshness.ts`: it compares each
 * recorded fingerprint against the file and returns the assetIds whose recorded content disagrees —
 * fail-closed on a missing fingerprint, a missing file, or a size/hash mismatch. Clauses (1) and (2)
 * flipped from `it.fails` to `it`. Consumers are unchanged and keep trusting the artifact; the gate
 * is what makes that trust earned. Counterweight (4) still pins the three counts, so regenerating
 * alone is not a pass.
 */

const REPO = join(import.meta.dirname, "../../..");
const ARTIFACT = join(REPO, "packages/openclinxr/asset-registry/src/measured-station-geometry.json");

/** Landed counts at the planting commit. Counterweight (4) pins them: regenerating is not the fix. */
const PINNED_TRIANGLES: Readonly<Record<string, number>> = {
  patient_robert_hayes_character: 64_802,
  nurse_maria_alvarez_character: 38_913,
  spouse_anna_hayes_character: 33_623,
};

type Fingerprint = { bytes?: number; sha256?: string };
type Artifact = {
  generatedBy?: string;
  sources?: Record<string, string>;
  triangles?: Record<string, number>;
  fingerprints?: Record<string, Fingerprint>;
};

function artifact(): Artifact {
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Artifact;
}

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the measured geometry artifact knows when it is stale (#707)", () => {
  it("(1) every source carries a fingerprint that matches the bytes on disk now", () => {
    const doc = artifact();
    const sources = doc.sources ?? {};
    expect(Object.keys(sources).length, "no sources recorded").toBeGreaterThan(0);
    for (const [assetId, rel] of Object.entries(sources)) {
      const fp = doc.fingerprints?.[assetId];
      expect(
        fp,
        `${assetId}: the artifact names ${rel} and records nothing about its content. A rebake `
          + "changes the bytes and leaves the count, and every readiness verdict keeps citing it.",
      ).toBeTruthy();
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${assetId}: ${rel} must exist`).toBe(true);
      expect(fp!.bytes, `${assetId}: recorded size must match ${rel}`).toBe(statSync(abs).size);
      expect(fp!.sha256, `${assetId}: recorded hash must match ${rel}`).toBe(sha256Of(abs));
    }
  });

  it("(2) a corrupted fingerprint is DETECTED — the comparison fails closed", async () => {
    // The destructive probe lives in the contract rather than in a note beside it: a checker that
    // reports nothing would satisfy clause (1) forever, because clause (1) only reads a matching
    // artifact.
    const mod = (await import(
      "../../../packages/openclinxr/asset-registry/src/measured-station-geometry-freshness.js"
    )) as { findStaleMeasuredGeometry?: (doc: unknown, repoRoot: string) => string[] };
    expect(
      typeof mod.findStaleMeasuredGeometry,
      "a comparison must exist and be callable; the artifact carrying a hash nobody reads is the "
        + "same defect one layer along",
    ).toBe("function");

    const clean = artifact();
    expect(
      mod.findStaleMeasuredGeometry!(clean, REPO),
      "the committed artifact must be reported FRESH, or the checker is a false alarm",
    ).toEqual([]);

    const corrupted = JSON.parse(JSON.stringify(clean)) as Artifact;
    const first = Object.keys(corrupted.sources ?? {})[0]!;
    corrupted.fingerprints![first] = { bytes: 1, sha256: "0".repeat(64) };
    expect(
      mod.findStaleMeasuredGeometry!(corrupted, REPO),
      `a wrong fingerprint for ${first} must be reported; an empty result here means the checker `
        + "cannot see the defect it exists for",
    ).toContain(first);
  });

  it("(3) COUNTERWEIGHT: an empty artifact is not a passing artifact", () => {
    const doc = artifact();
    expect(
      Object.keys(doc.triangles ?? {}).length,
      "emptying the maps satisfies a for-loop over them vacuously, and the readiness surface would "
        + "fall back to declarations for everything while this file stayed green",
    ).toBeGreaterThan(0);
    expect(doc.generatedBy, "provenance must survive").toBeTruthy();
  });

  it("(4) COUNTERWEIGHT: re-running the generator is not the fix", () => {
    const doc = artifact();
    for (const [assetId, count] of Object.entries(PINNED_TRIANGLES)) {
      expect(
        doc.triangles?.[assetId],
        `${assetId}: the counts are correct as far as anyone has measured, and the defect is the `
          + "ABSENT CHECK. A slice that only regenerates refreshes today's numbers and leaves "
          + "tomorrow's rot.",
      ).toBe(count);
    }
  });
});

// NOT TESTED: whether any consumer reacts correctly to a stale artifact — this file proves the
// mismatch is detected, not that the readiness verdict degrades to the typed incomplete blocker when
// it is. Nor whether the generator should run in CI. Nor whether hashing every source is affordable
// wherever the gate ends up running, which was never measured.
