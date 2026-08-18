import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * S0 of the superagent plan, 2026-08-18 — GOWN HELPER-REF PREFLIGHT.
 *
 * The rooms lane closed and handed this lane a staged CC0 patient gown that nothing consumes:
 *
 *   .openclinxr-local/provider-cache/garments/sources/makehuman-community-crude-gown/
 *     crudegown.mhclo  52,420 B   `# author Joel Palmius` / `# license CC0`
 *     crudegown.obj / .mhmat / .thumb          (no PNG)
 *
 * Seven of fourteen patients currently share `ed_chest_pain_adult_cast.glb`
 * (`.openclinxr/probe/mpfb-midriff/anny-patient-pool.json`), so this asset is the gate on the
 * largest measured identity gap in the bank.
 *
 * ## WHY A PREFLIGHT BEFORE ANY FIT — THE POLO TRAP
 *
 * MPFB fits a `.mhclo` by interpolating against basemesh vertex indices. This pipeline
 * HELPER-STRIPS the basemesh at vertex **13,380** (MADR 0052 precondition). A `.mhclo` whose
 * `verts` block references an index at or above that boundary is interpolating against geometry
 * that no longer exists on the stripped body, and the fit is garbage. The ledger already records
 * that class for a previous candidate. Measuring the max reference costs one file read; fitting
 * first and grading the pixels costs a Blender bake.
 *
 * ## KNOWN-GOOD COLUMN (§9h)
 *
 * `toigo_basic_tucked_t-shirt.mhclo` is CONSUMED TODAY on the civilian rail
 * (`materialize_mpfb_humanoid_candidate.py:3186-3188`) and fits the stripped basemesh, so its max
 * vertex reference MUST already be below 13,380. If the instrument says otherwise the instrument
 * is wrong, not the shipped asset — that is what clause (2) is for.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                             | (1) | (2) known-good | (3) | result
 *   ------------------------------------------------------|-----|----------------|-----|--------
 *   a) today — no preflight artifact at all               |FAIL |      pass      |pass | REFUSED
 *   b) count vertices in crudegown.obj instead            |pass |      pass      |FAIL | REFUSED
 *   c) read only the first `verts` line                   |pass |      pass      |FAIL | REFUSED
 *   d) max over every index in the whole `verts` block    |pass |      pass      |pass | ALL PASS
 *
 * (b) is the one to watch: `crudegown.obj` has its OWN vertex count, which is a property of the
 * garment mesh and says nothing about which BODY indices the fit interpolates against. It is the
 * intuitive number and it is measurably the wrong one — clause (3) pins the two apart.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED** — the artifact does not exist.
 * **(2) and (3) pass today** because they read the `.mhclo` files directly, not the absent artifact.
 *
 * NOT TESTED:
 *   - That a sub-13,380 gown actually FITS. Index range is necessary, not sufficient; poke-through,
 *     coverage and drape are all downstream and none are this contract's subject.
 *   - The missing `CrudeGown.png`. A texture gap is not an index gap.
 *   - Whether `hospital_gown` should map here. That is S1 and is deliberately not asserted.
 *
 * ## FIXED (#410)
 *
 *   maxVertRef (crudegown.mhclo, whole verts block): 13351
 *   helperStripVertex: 13380
 *   fitsStrippedBasemesh: true  (13351 < 13380)
 *   knownGoodToigoMaxVertRef: 11017
 *   rowsParsed: crudegown=768, toigo=1391
 *   Artifact: tools/openclinxr/evidence/crudegown-preflight.json
 *   OBJ vertex count (refused quantity): 768 — distinct from maxVertRef.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CACHE = join(REPO_ROOT, ".openclinxr-local/provider-cache/garments/sources");
const GOWN_MHCLO = join(CACHE, "makehuman-community-crude-gown/crudegown.mhclo");
const TOIGO_MHCLO = join(CACHE, "makehuman-shirts01/toigo_basic_tucked_t-shirt/toigo_basic_tucked_t-shirt.mhclo");
/**
 * TRACKED on purpose (#396): an `exists:` proof under a gitignored `.openclinxr/evidence/**` path
 * has no land path — merge-kill refuses the slice after the work is done. The measurement is the
 * deliverable here, so it lives beside the contract that reads it.
 */
const PREFLIGHT = join(REPO_ROOT, "tools/openclinxr/evidence/crudegown-preflight.json");

/** MADR 0052 helper-strip boundary. Not tuned — it is the basemesh split point. */
const HELPER_STRIP_VERTEX = 13380;

/**
 * Max basemesh vertex index referenced anywhere in a `.mhclo` `verts` block.
 * Each data row is `i0 i1 i2 w0 w1 w2 dx dy dz` — the first three are BODY vertex indices.
 */
function maxBodyVertexRef(mhcloPath: string): { max: number; rows: number } {
  const lines = readFileSync(mhcloPath, "utf8").split("\n");
  let inVerts = false;
  let max = -1;
  let rows = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("verts")) { inVerts = true; continue; }
    if (!inVerts) continue;
    if (!line || /^[a-z_]+\s/i.test(line)) { if (rows > 0) break; continue; }
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const idx = parts.slice(0, 3).map(Number);
    if (idx.some((n) => !Number.isInteger(n))) continue;
    rows += 1;
    for (const n of idx) if (n > max) max = n;
  }
  return { max, rows };
}

/** An unreadable source must FAIL, never pass vacuously (§7t). Plain `it` on purpose. */
function requireSources(): void {
  expect(existsSync(GOWN_MHCLO), `staged gown mhclo at ${GOWN_MHCLO}`).toBe(true);
  expect(existsSync(TOIGO_MHCLO), `known-good toigo mhclo at ${TOIGO_MHCLO}`).toBe(true);
}

describe("the staged crude gown fits the helper-stripped basemesh", () => {
  it("(1) RED: the preflight artifact records the gown's max body-vertex reference", () => {
    requireSources();
    expect(
      existsSync(PREFLIGHT),
      `${PREFLIGHT} must exist and be written BEFORE any resolver edit — index range decides whether a fit is even possible`,
    ).toBe(true);
    const report = JSON.parse(readFileSync(PREFLIGHT, "utf8")) as {
      maxVertRef?: number;
      helperStripVertex?: number;
      fitsStrippedBasemesh?: boolean;
      knownGoodToigoMaxVertRef?: number;
    };
    expect(report.helperStripVertex, "the boundary the verdict is against").toBe(HELPER_STRIP_VERTEX);
    expect(typeof report.maxVertRef, "measured gown max body-vertex reference").toBe("number");
    expect(
      report.fitsStrippedBasemesh,
      `must equal maxVertRef < ${HELPER_STRIP_VERTEX} (measured ${report.maxVertRef})`,
    ).toBe((report.maxVertRef ?? Number.MAX_SAFE_INTEGER) < HELPER_STRIP_VERTEX);
    expect(report.knownGoodToigoMaxVertRef, "the known-good column must be recorded beside it").toBeTypeOf("number");
  });

  it(`(2) NET known-good: the CONSUMED toigo shirt references below ${HELPER_STRIP_VERTEX}`, () => {
    // Refuses an instrument that reports everything as out of range. Toigo ships on the civilian
    // rail today, so a reading at or above the boundary convicts the reader, not the asset.
    requireSources();
    const { max, rows } = maxBodyVertexRef(TOIGO_MHCLO);
    expect(rows, "toigo verts rows parsed").toBeGreaterThan(100);
    expect(max, `toigo max body-vertex ref ${max} — it is consumed today, so it must fit`).toBeLessThan(
      HELPER_STRIP_VERTEX,
    );
  });

  it("(3) COUNTERWEIGHT: the gown's own OBJ vertex count is NOT the measured quantity", () => {
    // Refuses (b) and (c). crudegown.obj has its own vertex count; the fit interpolates against
    // BODY indices in the .mhclo. Reading the wrong one gives a confident wrong answer.
    requireSources();
    const { max, rows } = maxBodyVertexRef(GOWN_MHCLO);
    expect(rows, "gown verts rows parsed — a single-line read would give 1").toBeGreaterThan(100);
    const objVerts = readFileSync(join(CACHE, "makehuman-community-crude-gown/crudegown.obj"), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("v ")).length;
    expect(objVerts, "the gown OBJ has its own vertex count").toBeGreaterThan(0);
    expect(
      max,
      `body-vertex refs (max ${max}) are a different quantity from the garment's own ${objVerts} OBJ vertices`,
    ).not.toBe(objVerts);
  });
});
