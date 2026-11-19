import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glbGeometryDigest } from "@openclinxr/factory-station-core/runner";
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
 *
 * ## FIXED (current-count integrity)
 *
 * Clause (1) now also recounts each declared current source from the raw GLB bytes named by
 * `doc.sources`: it parses the GLB magic/version/header length/JSON-chunk bounds/type, reads the
 * embedded glTF JSON, and sums raw mesh-primitive triangle totals from accessor metadata
 * (indices accessor count, else POSITION count, divided by 3; TRIANGLES mode 4 only, fail-closed on
 * missing/non-finite/inconsistent metadata or unsupported topology). The declared
 * `doc.triangles[assetId]` must equal that recount. A record-only forgery that sets a current count
 * to 0 while fingerprints and GLBs stay untouched fails this clause. Production definition: raw
 * mesh-primitive sum, not scene instances or draw calls. No quality budget is applied.
 */

const REPO = join(import.meta.dirname, "../../../..");
const ARTIFACT = join(REPO, "packages/openclinxr/asset-registry/src/measured-station-geometry.json");
const HISTORICAL = join(REPO, "tools/openclinxr/evidence/freshness/historical-measured-station-geometry.json");
const HISTORICAL_SHA256 = "b6c98c82d073b47e40dc78452abb4101778495901a8a41ba21e60a1d0232f1e4";

/** Landed counts at the planting commit. Counterweight (4) pins them: regenerating is not the fix. */
const PINNED_TRIANGLES: Readonly<Record<string, number>> = {
  patient_robert_hayes_character: 64_802,
  nurse_maria_alvarez_character: 38_913,
  spouse_anna_hayes_character: 33_623,
};

type Fingerprint = { bytes?: number; sha256?: string; geometrySha256?: string };
type Artifact = {
  generatedBy?: string;
  sources?: Record<string, string>;
  triangles?: Record<string, number>;
  fingerprints?: Record<string, Fingerprint>;
};

function artifact(): Artifact {
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Artifact;
}

// Independent raw-format GLB reader, defined inside this TEST only. It parses the binary glTF
// container (magic/version/header length, JSON chunk bounds/type) and sums raw mesh-primitive
// triangle totals from accessor metadata: indices accessor count, else POSITION count, divided
// by 3. TRIANGLES mode (4) and mode-unset only; fail-closed on missing, non-finite, or
// inconsistent metadata or unsupported topology. Production definition is the raw
// mesh-primitive sum, not scene instances or draw calls; no quality budget.
function recountRawGlbTriangles(abs: string): number {
  const buf = readFileSync(abs);
  const fail = (why: string): never => {
    throw new Error(`${abs}: unrecountable GLB (${why})`);
  };
  if (buf.length < 20) fail("too short for GLB header");
  if (buf.readUInt32LE(0) !== 0x46546c67) fail("bad magic");
  if (buf.readUInt32LE(4) !== 2) fail("unsupported version");
  const totalLen = buf.readUInt32LE(8);
  if (!Number.isFinite(totalLen) || totalLen !== buf.length) fail("inconsistent header length");
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) fail("first chunk is not JSON");
  if (!Number.isFinite(jsonLen) || 20 + jsonLen > buf.length) fail("JSON chunk out of bounds");
  const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as {
    accessors?: Array<{ count?: number }>;
    meshes?: Array<{ primitives?: Array<{ indices?: number; attributes?: Record<string, number>; mode?: number }> }>;
  };
  const accessors = doc.accessors ?? fail("missing accessors");
  const meshes = doc.meshes ?? fail("missing meshes");
  if (meshes.length === 0) fail("no meshes");
  let total = 0;
  let prims = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? fail("missing primitives")) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) fail(`unsupported primitive mode ${mode}`);
      let verts: number;
      if (prim.indices !== undefined) {
        const acc = accessors[prim.indices] ?? fail("missing indices accessor");
        if (!Number.isFinite(acc.count!) || acc.count! <= 0) fail("non-finite indices count");
        if (acc.count! % 3 !== 0) fail("indices count not divisible by 3");
        verts = acc.count!;
      } else {
        const pos = prim.attributes?.["POSITION"] ?? fail("non-indexed primitive without POSITION");
        const acc = accessors[pos] ?? fail("missing POSITION accessor");
        if (!Number.isFinite(acc.count!) || acc.count! <= 0) fail("non-finite POSITION count");
        if (acc.count! % 3 !== 0) fail("POSITION count not divisible by 3");
        verts = acc.count!;
      }
      total += verts / 3;
      prims += 1;
    }
  }
  if (prims === 0) fail("no primitives");
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(total)) fail("non-finite total");
  return total;
}

describe("the measured geometry artifact knows when it is stale (#707)", () => {
  it("(1) every source carries a geometry fingerprint that matches the bytes on disk now, and each declared current count equals the raw GLB recount", () => {
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
      expect(
        typeof fp!.geometrySha256 === "string" && /^[0-9a-f]{64}$/.test(fp!.geometrySha256),
        `${assetId}: the recorded geometry pin must be a full 64-hex digest, not a whole-file hash`,
      ).toBe(true);
      const abs = join(REPO, rel);
      expect(existsSync(abs), `${assetId}: ${rel} must exist`).toBe(true);
      const bytes = readFileSync(abs);
      expect(
        fp!.geometrySha256,
        `${assetId}: recorded geometry digest must match the GLB on disk; a material-only stage `
          + "keeps it, a geometry change moves it",
      ).toBe(glbGeometryDigest(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
      const declared = doc.triangles?.[assetId];
      expect(
        declared,
        `${assetId}: the artifact names ${rel} but declares no current count`,
      ).toBeTruthy();
      expect(Number.isInteger(declared!), `${assetId}: declared count must be an integer`).toBe(true);
      const actual = recountRawGlbTriangles(abs);
      expect(
        declared,
        `${assetId}: declared current count ${declared} disagrees with raw GLB recount ${actual} `
          + `of ${rel}; a record-only edit (forged 0/±count with untouched fingerprints) must fail here`,
      ).toBe(actual);
    }
    // Forged-count negative: same bytes and fingerprints, one declared count set to 0.
    const forged = JSON.parse(JSON.stringify(doc)) as Artifact;
    const first = Object.keys(sources)[0]!;
    expect(first, "no-key guard: a first declared source must exist").toBeTruthy();
    forged.triangles![first] = 0;
    const forgedAbs = join(REPO, sources[first]!);
    const forgedActual = recountRawGlbTriangles(forgedAbs);
    expect(
      forgedActual,
      "recount of the untouched GLB must stay positive so the forged 0 cannot agree with physics",
    ).toBeGreaterThan(0);
    expect(
      forged.triangles![first],
      `forged current count 0 for ${first} must disagree with raw recount ${forgedActual}`,
    ).not.toBe(forgedActual);
  });

  it("(2) a corrupted fingerprint is DETECTED — the approved public fresh-count API fails closed", async () => {
    // This clause proves the APPROVED production contract
    // (`freshMeasuredTriangleCounts` from the public subpath
    // `@openclinxr/asset-registry/measured-station-geometry-freshness`), not a private
    // comparator and not a recreated checker: a stale assetId must lose its count while
    // every other fresh count is retained.
    const mod = (await import(
      "@openclinxr/asset-registry/measured-station-geometry-freshness"
    )) as { freshMeasuredTriangleCounts?: (doc: unknown, repoRoot: string) => Record<string, number> };
    expect(
      typeof mod.freshMeasuredTriangleCounts,
      "the approved public fresh-count API must exist and be callable via the package subpath; "
        + "reaching through to a private src file would bypass the production contract",
    ).toBe("function");

    const clean = artifact();
    const cleanFresh = mod.freshMeasuredTriangleCounts!(clean, REPO);
    expect(
      cleanFresh,
      "the committed artifact must report every recorded count as FRESH, or the API is a false alarm",
    ).toEqual(clean.triangles);
    const freshKeys = Object.keys(cleanFresh);
    expect(freshKeys.length, "clean positive must be non-vacuous: at least one fresh count").toBeGreaterThan(0);
    expect(
      cleanFresh,
      "an empty or always-{} API must fail this clean positive",
    ).not.toEqual({});

    const first = freshKeys[0]!;
    expect(first, "no-key guard: a first fresh key must exist").toBeTruthy();

    const corrupted = JSON.parse(JSON.stringify(clean)) as Artifact;
    corrupted.fingerprints![first] = { geometrySha256: "0".repeat(64) };
    const after = mod.freshMeasuredTriangleCounts!(corrupted, REPO);
    expect(
      after[first],
      `a wrong geometry digest for ${first} must omit its count; retaining the count means the API `
        + "cannot see the defect it exists for",
    ).toBeUndefined();
    for (const key of freshKeys) {
      if (key === first) continue;
      expect(
        after[key],
        `${key}: all other fresh counts must be retained while ${first} is stale`,
      ).toBe(cleanFresh[key]);
    }

    const legacyCorrupted = JSON.parse(JSON.stringify(clean)) as Artifact;
    legacyCorrupted.fingerprints![first] = { bytes: 1, sha256: "0".repeat(64) };
    const legacyAfter = mod.freshMeasuredTriangleCounts!(legacyCorrupted, REPO);
    expect(
      legacyAfter[first],
      `a wrong legacy fingerprint for ${first} must still omit its count: legacy rows stay honored`,
    ).toBeUndefined();

    const firstRel = (clean.sources as Record<string, string>)[first];
    if (typeof firstRel !== "string") throw new Error("first source must exist");
    const firstBytes = readFileSync(join(REPO, firstRel));
    const legacySizeOnly = JSON.parse(JSON.stringify(clean)) as Artifact;
    legacySizeOnly.fingerprints![first] = {
      bytes: firstBytes.length,
      sha256: "0".repeat(64),
    };
    expect(
      mod.freshMeasuredTriangleCounts!(legacySizeOnly, REPO)[first],
      "a legacy row with correct bytes but a wrong sha256 must be stale: the SHA comparison is load-bearing",
    ).toBeUndefined();
    const legacyShaOnly = JSON.parse(JSON.stringify(clean)) as Artifact;
    legacyShaOnly.fingerprints![first] = {
      sha256: createHash("sha256").update(firstBytes).digest("hex"),
    };
    expect(
      mod.freshMeasuredTriangleCounts!(legacyShaOnly, REPO),
      "a legacy row with a correct sha256 and no bytes must stay fresh",
    ).toEqual(cleanFresh);
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
    const historical = JSON.parse(readFileSync(HISTORICAL, "utf8")) as Artifact;
    expect(
      createHash("sha256").update(readFileSync(HISTORICAL)).digest("hex"),
      "the historical artifact must be byte-identical; a regenerated copy proves nothing",
    ).toBe(HISTORICAL_SHA256);
    for (const [assetId, count] of Object.entries(PINNED_TRIANGLES)) {
      expect(
        historical.triangles?.[assetId],
        `${assetId}: the counts are correct as far as anyone has measured, and the defect is the `
          + "ABSENT CHECK. A slice that only regenerates refreshes today's numbers and leaves "
          + "tomorrow's rot.",
      ).toBe(count);
    }
  });

  it("(5) a material-only copy stays FRESH while a 1-ULP copy goes stale on geometry alone", async () => {
    const mod = (await import(
      "@openclinxr/asset-registry/measured-station-geometry-freshness"
    )) as { freshMeasuredTriangleCounts?: (doc: unknown, repoRoot: string) => Record<string, number> };
    expect(typeof mod.freshMeasuredTriangleCounts).toBe("function");

    const doc = artifact();
    const assetId = "spouse_anna_hayes_character";
    const rel = doc.sources?.[assetId];
    expect(rel, "no-key guard: the spouse source must exist").toBeTruthy();
    const orig = readFileSync(join(REPO, rel!));
    const recorded = doc.fingerprints?.[assetId];
    expect(recorded?.geometrySha256, `${assetId}: the committed artifact must carry a geometry pin`).toBeTruthy();
    const count = doc.triangles?.[assetId];
    expect(count, `${assetId}: the committed artifact must carry a count`).toBeTruthy();

    const origView = new DataView(orig.buffer, orig.byteOffset, orig.byteLength);
    const jsonLen = origView.getUint32(12, true);
    const binLen = origView.getUint32(20 + jsonLen, true);
    const binStart = 20 + jsonLen + 8;
    const jsonDoc = JSON.parse(orig.subarray(20, 20 + jsonLen).toString("utf8")) as {
      accessors?: Array<{ bufferView?: number; byteOffset?: number }>;
      bufferViews?: Array<{ byteOffset?: number }>;
      images?: unknown[];
      materials?: Array<{ pbrMetallicRoughness?: { roughnessFactor?: number } }>;
      meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
    };
    const toU8 = (buf: Buffer): Uint8Array =>
      new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const rebuild = (mutate: (d: typeof jsonDoc) => void): Buffer => {
      const d = JSON.parse(JSON.stringify(jsonDoc)) as typeof jsonDoc;
      mutate(d);
      let json = Buffer.from(JSON.stringify(d));
      json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
      const out = Buffer.alloc(12 + 8 + json.length + 8 + binLen);
      orig.copy(out, 0, 0, 12);
      out.writeUInt32LE(json.length, 12);
      out.writeUInt32LE(0x4e4f534a, 16);
      json.copy(out, 20);
      out.writeUInt32LE(binLen, 20 + json.length);
      out.writeUInt32LE(0x004e4942, 20 + json.length + 4);
      orig.copy(out, 20 + json.length + 8, binStart, binStart + binLen);
      out.writeUInt32LE(out.length, 8);
      return out;
    };

    const matOnly = rebuild((d) => {
      const target = d.materials?.find(
        (m) => typeof m.pbrMetallicRoughness?.roughnessFactor === "number",
      );
      if (!target?.pbrMetallicRoughness) throw new Error("no material with roughnessFactor found");
      const before = target.pbrMetallicRoughness.roughnessFactor;
      target.pbrMetallicRoughness.roughnessFactor = before === 0.5 ? 0.6 : 0.5;
    });
    expect(
      glbGeometryDigest(toU8(matOnly)),
      "a material-only JSON edit must keep the geometry digest",
    ).toBe(recorded!.geometrySha256);

    const prim = jsonDoc.meshes?.flatMap((m) => m.primitives ?? []).find((p) => p.attributes?.["POSITION"] !== undefined);
    if (!prim?.attributes) throw new Error("no POSITION primitive found");
    const ai = prim.attributes["POSITION"]!;
    const acc = jsonDoc.accessors?.[ai];
    const bv = jsonDoc.bufferViews?.[acc?.bufferView ?? -1];
    if (!acc || !bv) throw new Error("POSITION accessor metadata missing");
    const off = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const ulp = Buffer.from(orig);
    ulp.writeUInt32LE((origView.getUint32(off, true) ^ 1) >>> 0, off);
    expect(
      glbGeometryDigest(toU8(ulp)),
      "a 1-ULP vertex edit must move the geometry digest",
    ).not.toBe(recorded!.geometrySha256);

    const dir = mkdtempSync(join(tmpdir(), "geometry-pin-"));
    try {
      writeFileSync(join(dir, "mat-only.glb"), matOnly);
      writeFileSync(join(dir, "ulp.glb"), ulp);
      const fresh = (file: string): Record<string, number> =>
        mod.freshMeasuredTriangleCounts!(
          { sources: { [assetId]: file }, triangles: { [assetId]: count }, fingerprints: { [assetId]: recorded } },
          dir,
        );
      expect(
        fresh("mat-only.glb"),
        "a material-only copy (new JSON bytes, identical geometry) must stay FRESH",
      ).toEqual({ [assetId]: count });
      expect(ulp.length, "the 1-ULP copy must agree on file length").toBe(orig.length);
      expect(
        recountRawGlbTriangles(join(dir, "ulp.glb")),
        "the 1-ULP copy must agree on triangle recount",
      ).toBe(recountRawGlbTriangles(join(REPO, rel!)));
      expect(
        (JSON.parse(ulp.subarray(20, 20 + new DataView(ulp.buffer, ulp.byteOffset, ulp.byteLength).getUint32(12, true)).toString("utf8")) as { images?: unknown[] }).images?.length ?? 0,
        "the 1-ULP copy must agree on texture count",
      ).toBe(jsonDoc.images?.length ?? 0);
      expect(
        fresh("ulp.glb"),
        "a 1-ULP copy (length, triangles, and textures agreeing) must go stale on the geometry pin alone",
      ).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// NOT TESTED: whether any consumer reacts correctly to a stale artifact — this file proves the
// mismatch is detected, not that the readiness verdict degrades to the typed incomplete blocker when
// it is. Nor whether the generator should run in CI. Nor whether hashing every source is affordable
// wherever the gate ends up running, which was never measured.

// 2026-10-28: the original private checker (findStaleMeasuredGeometry) was intentionally closed per
// PSR-01d; this candidate consumes only the approved public freshness API
// (freshMeasuredTriangleCounts) as the production contract. Historical count calibration is
// original and unchanged.
