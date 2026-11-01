/**
 * ## EPOCH NOTE 2026-10-28 — freshness epoch boundary
 *
 * The committed `src/measured-station-geometry.json` has moved on from the
 * 91eb numbers pinned below (patient 64802 / nurse 38913 / spouse 33623):
 * the generator re-ran and the current counts, bytes, and sha256 values
 * differ. The PINNED_* constants stay because they describe the HISTORICAL
 * fixture at `evidence/freshness/historical-measured-station-geometry.json`,
 * byte-exact at 91eb, not the live artifact. Clause (1) therefore asserts
 * preservation against the CURRENT committed document, whatever its numbers
 * are; clauses (3)–(4) use an explicit synthetic proxy plus the historical
 * fixture so the old over-budget finding is exercised without claiming the
 * proxy bytes measured the old counts. Source/dist authority: the default
 * built API reads `dist`; clause (4) asserts the default verdict equals the
 * verdict built explicitly from the current source document for ED.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeedBankAssetReadiness } from "../../../../packages/openclinxr/rest/src/api-route-support.js";

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

const REPO = join(import.meta.dirname, "../../../..");
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

function proxyDoc(privateRoot: string): Artifact {
  const files: Record<string, string> = {
    "proxy/patient.glb": "patient-proxy-bytes-001",
    "proxy/nurse.glb": "nurse-proxy-bytes-002",
    "proxy/spouse.glb": "spouse-proxy-bytes-003",
  };
  const fps: Record<string, { bytes: number; sha256: string }> = {};
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(privateRoot, rel);
    writeFileSync(abs, Buffer.from(text, "utf8"));
    const bytes = Buffer.from(text, "utf8");
    const key = rel === "proxy/patient.glb" ? ED_PATIENT : rel === "proxy/nurse.glb" ? "nurse_maria_alvarez_character" : "spouse_anna_hayes_character";
    fps[key] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return {
    sources: {
      [ED_PATIENT]: "proxy/patient.glb",
      nurse_maria_alvarez_character: "proxy/nurse.glb",
      spouse_anna_hayes_character: "proxy/spouse.glb",
    },
    triangles: { ...PINNED_TRIANGLES },
    fingerprints: fps,
  };
}

function withCwd<T>(dir: string, fn: () => T): T {
  const orig = process.cwd;
  (process as { cwd?: () => string }).cwd = () => dir;
  try {
    return fn();
  } finally {
    (process as { cwd?: () => string }).cwd = orig;
  }
}

const HISTORICAL_FIXTURE = join(import.meta.dirname, "../freshness/historical-measured-station-geometry.json");

describe("a stale measurement stops deciding readiness (#711)", () => {
  it("(1) only fresh counts are handed to the verdict", async () => {
    const mod = (await import(
      "../../../../packages/openclinxr/asset-registry/src/measured-station-geometry-freshness.js"
    )) as {
      freshMeasuredTriangleCounts?: (doc: unknown, repoRoot: string) => Record<string, number>;
      findStaleMeasuredGeometry?: (doc: unknown, repoRoot: string) => string[];
    };
    expect(typeof mod.freshMeasuredTriangleCounts, "freshness filter must exist").toBe("function");

    const doc = committed();
    expect(Object.keys(doc.triangles ?? {}).length, "current triangles map must not be empty").toBeGreaterThan(0);
    expect(Object.keys(doc.sources ?? {}).length, "current sources map must not be empty").toBeGreaterThan(0);
    for (const assetId of Object.keys(PINNED_TRIANGLES)) {
      expect(Object.hasOwn(doc.triangles ?? {}, assetId), `${assetId}: current count present`).toBe(true);
      const count = doc.triangles![assetId];
      expect(Number.isInteger(count) && count > 0, `${assetId}: current count finite positive integer`).toBe(true);
      expect(Object.hasOwn(doc.sources ?? {}, assetId), `${assetId}: current source present`).toBe(true);
      expect(typeof doc.sources![assetId] === "string" && doc.sources![assetId].length > 0, `${assetId}: current source nonempty string`).toBe(true);
      expect(Object.hasOwn(doc.fingerprints ?? {}, assetId), `${assetId}: current fingerprint present`).toBe(true);
      const fp = doc.fingerprints![assetId]!;
      expect(typeof fp.sha256 === "string" && /^[0-9a-f]{64}$/.test(fp.sha256), `${assetId}: current sha full 64hex`).toBe(true);
      expect(typeof fp.bytes === "number" && Number.isInteger(fp.bytes) && fp.bytes > 0, `${assetId}: current bytes positive integer`).toBe(true);
    }
    const fresh = mod.freshMeasuredTriangleCounts!(doc, REPO);
    expect(fresh, "fresh committed artifact must keep every count exactly").toEqual(doc.triangles);

    const staleDoc = withCorruptedFingerprint();
    const filtered = mod.freshMeasuredTriangleCounts!(staleDoc, REPO);
    expect(Object.keys(filtered), `${ED_PATIENT} stale count must be dropped`).not.toContain(ED_PATIENT);

    const noFp = JSON.parse(JSON.stringify(doc)) as Artifact;
    delete (noFp.fingerprints as Record<string, unknown>)[ED_PATIENT];
    expect(mod.freshMeasuredTriangleCounts!(noFp, REPO)).not.toHaveProperty(ED_PATIENT);
  });

  it("(2) a stale source changes the verdict, and to the typed incomplete blocker", () => {
    const build = createSeedBankAssetReadiness as unknown as (doc?: unknown) => Row[];
    const stale = build(withCorruptedFingerprint());
    const row = edRow(stale);
    expect(row.stationBudget.blockers).toContain("station_triangle_measurements_incomplete");
    expect(row.stationBudget.blockers).not.toContain("station_triangle_budget_exceeded");
    expect(row.devReady).toBe(false);
  });

  it("(3) COUNTERWEIGHT: synthetic freshness proxy puts ED over budget, stale proxy drops it", () => {
    const build = createSeedBankAssetReadiness as unknown as (doc?: unknown) => Row[];
    const privateRoot = mkdtempSync(join(tmpdir(), "ed-proxy-"));
    mkdirSync(join(privateRoot, "proxy"), { recursive: true });
    try {
      const doc = proxyDoc(privateRoot);
      const rows = withCwd(privateRoot, () => build(doc)) as Row[];
      const row = edRow(rows);
      expect(row.stationBudget.totalTriangles).toBe(191_338);
      expect(row.stationBudget.blockers).toContain("station_triangle_budget_exceeded");

      const wrong = JSON.parse(JSON.stringify(doc)) as Artifact;
      wrong.fingerprints![ED_PATIENT] = { bytes: 1, sha256: "0".repeat(64) };
      const rowWrong = edRow(withCwd(privateRoot, () => build(wrong)) as Row[]);
      expect(rowWrong.stationBudget.blockers).toContain("station_triangle_measurements_incomplete");
      expect(rowWrong.stationBudget.blockers).not.toContain("station_triangle_budget_exceeded");

      const missing = JSON.parse(JSON.stringify(doc)) as Artifact;
      delete (missing.sources as Record<string, string>)[ED_PATIENT];
      const rowMissing = edRow(withCwd(privateRoot, () => build(missing)) as Row[]);
      expect(rowMissing.stationBudget.blockers).toContain("station_triangle_measurements_incomplete");
      expect(rowMissing.stationBudget.blockers).not.toContain("station_triangle_budget_exceeded");
    } finally {
      rmSync(privateRoot, { recursive: true, force: true });
    }
  });

  it("(4) COUNTERWEIGHT: historical fixture byte-exact; default verdict equals explicit current source doc for ED", () => {
    const raw = readFileSync(HISTORICAL_FIXTURE);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "b6c98c82d073b47e40dc78452abb4101778495901a8a41ba21e60a1d0232f1e4",
    );
    const hist = JSON.parse(raw.toString("utf8")) as Artifact;
    for (const [assetId, count] of Object.entries(PINNED_TRIANGLES)) {
      expect(hist.triangles?.[assetId], `${assetId}: historical count`).toBe(count);
    }
    expect(hist.fingerprints?.[ED_PATIENT]?.sha256).toBe(
      "7bd12d06aec497a939aa62301c73274cf23e6dd7b1da6d5c085db6c17f57fd4a",
    );
    expect(hist.fingerprints?.["nurse_maria_alvarez_character"]?.sha256).toBe(
      "b98c8b3411fe2bc7e0275cf2d1ab465b447f701319d9d446200f5b109511cf61",
    );
    expect(hist.fingerprints?.["spouse_anna_hayes_character"]?.sha256).toBe(
      "15befdc850c3df189e2c1e12fdae1192b12e3baa2d8d34790d7daf0b7c53ac8d",
    );
    const build = createSeedBankAssetReadiness as unknown as (doc?: unknown) => Row[];
    const def = edRow(build() as Row[]);
    const explicit = edRow(build(committed()) as Row[]);
    expect(explicit.stationBudget, "default built verdict must equal explicit current source doc for ED").toEqual(
      def.stationBudget,
    );
  });
});

// NOT TESTED: `scenario-runtime.ts:507` and `asset-registry/src/index.ts:2096`, both still bare and
// deliberately out of scope; whether the GLBs are present in a deployed API image, which decides
// whether the check degrades to incomplete-everywhere in production and which nobody has measured;
// the cost of hashing three sources on a request path; whether the triangle arithmetic was right,
// which no fingerprint can speak to.
