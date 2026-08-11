import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The MPFB macros produce differentiated statures and the reference-alignment step destroys them.
 *
 * MEASURED 2026-08-11 from the two shipped library bodies and their own provenance:
 *
 *   body                | phenotype           | pre-alignment | shipped body mesh
 *   --------------------|---------------------|---------------|------------------
 *   adult_lean_female   | weight .18 gender 0 |   17.324526   | 1.760000
 *   adult_heavy_male    | weight .88 gender 1 |   16.974011   | 1.760000
 *
 * Two bodies with opposite phenotypes ship at **identical stature to six decimal places**. The macros
 * had produced a 3.51 cm spread — and that spread agrees with MADR 0052's measured Jacobian, which puts
 * `gender` at **-0.0317 m per unit macro**, so the heavier/male body is correctly the SHORTER one. The
 * body model was working. The alignment overwrote it.
 *
 * CAUSE, located: `body_param_stage.py:251-273` (`align_body_to_reference`) computes
 * `scale = ref_stature / body_stature` and applies it uniformly. The recorded factors are **0.10159**
 * and **0.10369** — beyond the MakeHuman decimetre conversion, each body is additionally stretched
 * 1.6% and 3.7% to land on one target.
 *
 * WHERE THE TARGET COMES FROM, and why it is not a real reference: both bodies record a different
 * `annyReferenceAsset` (`ed_chest_pain_nurse_adult`, `ed_chest_pain_adult_cast`) and both files are
 * **byte-identical, sha256 46a6ca8fa552** — two of the four actors sharing one body (#303's header).
 * Both therefore record `referenceStatureMeters` and `referenceGirthMeters` identical to 16 digits.
 * The two library bodies are being matched to the same borrowed body under two names.
 *
 * NOTE the stage's docstring is stale against its own code: it says "then horizontal girth match", but
 * `:275-284` hardcodes `girthScaleHorizontal: 1.0` and explains why. Girth is NOT forced. Only stature
 * is, which is what this contract is about — do not read the docstring as the behaviour.
 *
 * WHY CONTRACT (2) IS A RATIO. Asserting "stature equals 0.1 x pre-alignment" would require this
 * contract to know that MakeHuman base units are decimetres — a constant I would be asserting, not
 * measuring. The RATIO of the two bodies' statures is unit-free: whatever the conversion is, it
 * cancels. So (2) needs no invented constant and cannot be satisfied by picking two nicer numbers.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment              | lean   | heavy  | (1) spread | (2) ratio | (3) human | result
 *   -----------------------|--------|--------|------------|-----------|-----------|--------
 *   shipped today          | 1.7646 | 1.7646 |    FAIL    |   FAIL    |   PASS    | REFUSED
 *   two hardcoded heights  | 1.7000 | 1.8000 |    pass    | **FAIL**  |   PASS    | REFUSED
 *   drop the conversion    | 17.325 | 16.974 |    pass    |   pass    | **FAIL**  | REFUSED
 *   conversion only, no    | 1.7325 | 1.6974 |    pass    |   pass    |   PASS    | ALL PASS
 *   stature override       |        |        |            |           |           |
 *
 * Each cheap fix is caught by a DIFFERENT clause, and each clause is demonstrably able to fail. In
 * particular (3) is the reason the fix cannot simply delete the alignment call: the raw bodies are
 * ~17 units tall and shipping them unconverted would be a 17 m human.
 *
 * BANDS, both external floors rather than fitted numbers:
 *   - (1) floor is HALF THE MACRO-PRODUCED SPREAD, derived from the recorded pre-alignment statures.
 *     It references the INPUT of the causal chain, so it cannot be satisfied by construction: the
 *     macros move whether or not the alignment preserves them (PROTO_VERIFY_DELEGATION section 9s).
 *   - (2) tolerance is +/-1 cm of stadiometer agreement on a ~1.7 m body, expressed as a ratio.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today. (3) PASSES today and
 * is the known-good column — 1.76 m is a human height; a fix must not regress it.
 *
 * NOT TESTED: whether 1.7325 m / 1.6974 m are the RIGHT statures for these two body classes. They are
 * what the authored macros produce, and neither library body class carries an authored `height_cm` at
 * all — its phenotype is only {weight, gender, age, muscle}. That authoring gap is #293, not this
 * contract's business. Nothing here claims the girth, mass or proportions are correct, and nothing here
 * touches the Anny rail's own duplication (#303).
 *
 * ## FIXED (#304)
 *
 * `body_param_stage.py` (`align_body_to_reference`) no longer scales the body onto the reference's
 * stature. The applied scale is the MakeHuman decimetre→metre conversion only (`MH_UNITS_TO_METRES
 * = 0.1` — the same constant the no-Anny path already used), so each body keeps the stature its own
 * macros produced. The Anny reference still supplies foot/centre placement and the recorded girth
 * proxy; girth remains deliberately unforced (`girthScaleHorizontal: 1.0`). The two reference OBJs
 * are byte-identical duplicates (#303), so matching to them erased the macro spread.
 *
 * Re-baked 2026-08-11 via `pnpm asset:body-param:fit -- --once`:
 *
 *   body                | phenotype           | pre-alignment | shipped body mesh
 *   --------------------|---------------------|---------------|------------------
 *   adult_lean_female   | weight .18 gender 0 |   17.324526   | 1.732453
 *   adult_heavy_male    | weight .88 gender 1 |   16.974011   | 1.697401
 *
 * Both record `uniformScale: 0.10000000`. The 3.51 cm macro-produced spread is now preserved in
 * metres; the two RED assertions above hold, and the known-good human-stature column still holds.
 * The two `it.fails` wrappers are flipped to `it`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const CANDIDATES = `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates`;

const BODIES = ["adult_lean_female", "adult_heavy_male"] as const;

/** Stadiometer agreement, +/-1 cm on a ~1.7 m body, expressed as a dimensionless ratio. */
const RATIO_TOLERANCE = 0.01 / 1.7;

/** An adult human stature, in metres. An external floor — not derived from these meshes. */
const HUMAN_MIN_M = 1.4;
const HUMAN_MAX_M = 2.0;

const io = new NodeIO();

/** Stature of the BODY mesh alone — hair, garments and shoes sit outside it and must not count. */
async function bodyStatureMeters(bodyClass: string): Promise<number> {
  const doc = await io.read(`${CANDIDATES}/body-param-${bodyClass}-library.glb`);
  const mesh = doc
    .getRoot()
    .listMeshes()
    .find((m) => m.getName().startsWith("hm08_basemesh_"));
  if (!mesh) throw new Error(`no hm08_basemesh_ mesh in ${bodyClass}`);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const el: number[] = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")!;
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, el);
      const y = el[1]!;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return hi - lo;
}

/** What the macros produced before `align_body_to_reference` scaled it, in MakeHuman units. */
function preAlignmentStature(bodyClass: string): number {
  const p = JSON.parse(
    readFileSync(`${CANDIDATES}/body-param-${bodyClass}-library.provenance.json`, "utf8"),
  ) as { annyStatureAlign?: { bodyStatureBeforeScaleMeters?: number } };
  const v = p.annyStatureAlign?.bodyStatureBeforeScaleMeters;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${bodyClass}: provenance has no annyStatureAlign.bodyStatureBeforeScaleMeters`);
  }
  return v;
}

const shipped = Object.fromEntries(
  await Promise.all(BODIES.map(async (b) => [b, await bodyStatureMeters(b)] as const)),
) as Record<(typeof BODIES)[number], number>;

const pre = Object.fromEntries(
  BODIES.map((b) => [b, preAlignmentStature(b)] as const),
) as Record<(typeof BODIES)[number], number>;

describe("a library body's stature comes from its macros, not from a shared reference", () => {
  it(
    "(1) FIXED (#304): the two body classes differ in stature by at least half the spread their own macros produced",
    () => {
      const macroSpread = Math.abs(pre.adult_lean_female - pre.adult_heavy_male);
      const shippedSpread = Math.abs(shipped.adult_lean_female - shipped.adult_heavy_male);
      // the pre-alignment values share whatever unit the base mesh uses; scale the floor by the same
      // conversion the shipped bodies underwent, so both sides of the comparison are in metres
      const conversion = shipped.adult_lean_female / pre.adult_lean_female;
      const floor = (macroSpread * conversion) / 2;
      expect(
        shippedSpread,
        `shipped spread ${shippedSpread.toFixed(6)} m vs macro-produced ${(macroSpread * conversion).toFixed(4)} m`,
      ).toBeGreaterThanOrEqual(floor);
    },
  );

  it(
    "(2) FIXED (#304) COUNTERWEIGHT: the ratio of the two statures equals the ratio their macros produced — two hardcoded heights cannot satisfy this",
    () => {
      const wantRatio = pre.adult_lean_female / pre.adult_heavy_male;
      const gotRatio = shipped.adult_lean_female / shipped.adult_heavy_male;
      expect(
        Math.abs(gotRatio - wantRatio),
        `shipped ratio ${gotRatio.toFixed(6)} vs macro ratio ${wantRatio.toFixed(6)}`,
      ).toBeLessThanOrEqual(RATIO_TOLERANCE);
    },
  );

  it("(3) NET known-good: every shipped body is a human stature — the fix must not ship unconverted units", () => {
    for (const b of BODIES) {
      expect(shipped[b], `${b} stature ${shipped[b].toFixed(4)} m`).toBeGreaterThanOrEqual(HUMAN_MIN_M);
      expect(shipped[b], `${b} stature ${shipped[b].toFixed(4)} m`).toBeLessThanOrEqual(HUMAN_MAX_M);
    }
  });
});
