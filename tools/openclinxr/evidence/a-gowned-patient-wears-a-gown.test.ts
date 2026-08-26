import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * OBSERVABLE: the asset a learner meets at the gowned-patient station wears a gown.
 *
 * ## THE PREMISE ON THE CARD WAS WRONG AND IS CORRECTED HERE (#684)
 *
 * CORRECTED CLAIM: `mpfb-gown-adult-patient.glb` CARRIED the hospital gown for three commits and
 * LOST it in a rebake. Measured across the asset's whole history, counting the literal string
 * `hospital_gown` in the bytes:
 *
 *     af1fed4e  14,314,744 B   gown x4   cargo_pants x0   <- #490 baked the gowned patient
 *     e9ef9e3f  15,688,336 B   gown x4   cargo_pants x0   <- #542 brows/lashes/teeth
 *     99c56fd5  11,203,280 B   gown x4   cargo_pants x0   <- #598 footwear swap
 *     f3bf8d13   9,361,272 B   gown x0   cargo_pants x3   <- #651 HEIGHT REBAKE, gown gone
 *
 * WITHDRAWN: "the pipeline makes it and the cast asset does not get it" — there was never a
 * delivery gap. `f3bf8d13` ("fix(#651): the ED patient's body is the height his case declares")
 * regenerated the body from 166.6 to 177.6 cm and rebuilt the wardrobe from the default set. Its
 * contract measured HEIGHT and passed 3/3. Nothing measured what the rebake threw away.
 *
 * ## THE GENERAL DEFECT, WHICH OUTLIVES THIS ASSET
 *
 * A rebake station has no invariant that it preserves what the asset already had. Any slice that
 * regenerates a humanoid for one property can silently drop every other property, and the only
 * detector is somebody opening the file. This one survived a day.
 *
 * ## THE CONTRACT READS GEOMETRY, NEVER A NAME — that is the card's own thesis
 *
 * #684 was filed because an asset called `gown-adult-patient` has no gown, alongside six MPFB
 * assets whose iris materials name a manifest that does not exist and fourteen provenance sidecars
 * that cannot authenticate their own bytes. A name is a claim. Asserting on the string "gown"
 * would be the fourth instance of the defect, inside the contract written to catch it.
 *
 * So the pass condition is a SHAPE: one garment mesh continuous from below the hip to above the
 * shoulder. A hospital gown is a single sheet across the waist; a trousers-and-shirt wardrobe is
 * two meshes that meet there.
 *
 * ## KNOWN-GOOD COLUMN — `mpfb-gown-inspect.glb`, the same body, same reference, shipped today
 *
 *     mesh                                          tris    y-fraction of body height
 *     openclinxr_real_garment_hospital_gown_..._L0   5829    0.320 .. 0.863   <- ONE mesh, crosses
 *
 * against the regressed asset, whose two largest garments split at the waist:
 *
 *     mat_makeclothes_library_cargo_pants.001        2775    0.056 .. 0.607   <- stops below chest
 *     mat_makeclothes_library_toigo_t_shirt          2700    0.588 .. 0.860   <- starts above hip
 *
 * SPAN ALONE DOES NOT DISCRIMINATE and a span clause would be vacuous: the gown spans 0.543 of
 * body height and cargo_pants spans 0.551. What separates them is WHERE, not HOW MUCH. Hence the
 * two landmarks rather than a width.
 *
 * ## THRESHOLD PROVENANCE
 *
 * `HIP_FRACTION = 0.40` and `SHOULDER_FRACTION = 0.80` are anatomical landmarks on the body, not
 * quantiles of any observation. The known-good gown clears the lower by 0.080 and the upper by
 * 0.063; both regressed garments miss by 0.19 or more, so the gap is an order of magnitude wider
 * than the margin. Neither number can be met by distorting the garment without producing a
 * garment that genuinely reaches the hip and the shoulder, which is the property under test.
 *
 * claimScope: whether the gowned-patient cast asset carries a single garment mesh spanning hip to
 *   shoulder, and whether the height #651 established survives the fix.
 * notEvidenceFor: whether the gown LOOKS right on this body (gown-inspect may be posed or scaled
 *   differently — the orchestrator grades that after the bytes change); whether any other rebake
 *   dropped a property; whether the base wardrobe should persist underneath a gown.
 */

const DIR = "apps/ui-xr/public/generated-humanoids";
const CAST = "mpfb-gown-adult-patient.glb";
const KNOWN_GOOD = "mpfb-gown-inspect.glb";

/** Anatomical landmarks as a fraction of body height. Not derived from any observed garment. */
const HIP_FRACTION = 0.4;
const SHOULDER_FRACTION = 0.8;

/** Body height comes from the skin and hidden-body meshes only, never from a garment. */
const BODY = /skin|body_mesh/i;
/** Excluded from garment candidacy: they are body, hair, brow, lash, teeth or shoes by role. */
const NOT_A_TORSO_GARMENT = /skin|body_mesh|hair|eyebrow|eyelash|teeth|tongue|eyes|footwear/i;

interface MeshSpan {
  readonly material: string;
  readonly triangles: number;
  readonly minFraction: number;
  readonly maxFraction: number;
}

interface AssetSpans {
  readonly bodyHeightMeters: number;
  readonly garments: readonly MeshSpan[];
}

async function measureSpans(file: string): Promise<AssetSpans> {
  const doc = await new NodeIO().read(`${DIR}/${file}`);
  const raw: Array<{ material: string; triangles: number; lo: number; hi: number }> = [];
  let bodyLo = Number.POSITIVE_INFINITY;
  let bodyHi = Number.NEGATIVE_INFINITY;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const material = prim.getMaterial()?.getName() ?? "(unnamed)";
      const triangles = Math.round((prim.getIndices()?.getCount() ?? pos.getCount()) / 3);
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        if (v[1]! < lo) lo = v[1]!;
        if (v[1]! > hi) hi = v[1]!;
      }
      if (BODY.test(material)) { bodyLo = Math.min(bodyLo, lo); bodyHi = Math.max(bodyHi, hi); }
      raw.push({ material, triangles, lo, hi });
    }
  }
  const height = bodyHi - bodyLo;
  return {
    bodyHeightMeters: height,
    garments: raw
      .filter((r) => !NOT_A_TORSO_GARMENT.test(r.material))
      .map((r) => ({
        material: r.material,
        triangles: r.triangles,
        minFraction: (r.lo - bodyLo) / height,
        maxFraction: (r.hi - bodyLo) / height,
      })),
  };
}

/** A gown: ONE mesh reaching below the hip and above the shoulder. Names are never consulted. */
function spanningGarments(spans: AssetSpans): readonly MeshSpan[] {
  return spans.garments.filter(
    (g) => g.minFraction <= HIP_FRACTION && g.maxFraction >= SHOULDER_FRACTION,
  );
}

function describeSpans(spans: AssetSpans): string {
  return spans.garments
    .slice()
    .sort((a, b) => b.triangles - a.triangles)
    .map((g) => `${g.material} ${g.triangles}t ${g.minFraction.toFixed(3)}..${g.maxFraction.toFixed(3)}`)
    .join("; ");
}

describe("a gowned patient wears a gown (#684)", () => {
  it(
    "(1) the gowned-patient cast asset carries one garment mesh spanning hip to shoulder",
    async () => {
      const spans = await measureSpans(CAST);
      const spanning = spanningGarments(spans);
      expect(
        spanning.map((g) => `${g.material} ${g.minFraction.toFixed(3)}..${g.maxFraction.toFixed(3)}`),
        `no single garment mesh on ${CAST} reaches from <= ${HIP_FRACTION} to >= ${SHOULDER_FRACTION} `
          + `of body height. Measured garments: ${describeSpans(spans)}. `
          + `${KNOWN_GOOD} ships the same body wearing one mesh at 0.320..0.863. `
          + "The gown was present through 99c56fd5 and lost at f3bf8d13, a height rebake whose "
          + "contract measured only height.",
      ).not.toEqual([]);
    },
    120_000,
  );

  it(
    "(2) COUNTERWEIGHT: the body height #651 established survives the fix",
    async () => {
      // Refuses the cheapest fix: `git checkout 99c56fd5 -- <asset>` restores the gown and reverts
      // the body to 1.667 m, undoing #651. The declared height is 178 cm (ed-chest-pain.ts:126);
      // the pre-#651 body measured 1.667 m and the post-#651 body 1.776 m, so the floor sits
      // between them and cannot be met by restoring the old bytes.
      const spans = await measureSpans(CAST);
      expect(
        spans.bodyHeightMeters,
        `body height ${spans.bodyHeightMeters.toFixed(3)} m. #651 rebaked this body from 1.667 to `
          + "1.776 m against a declared 178 cm. Restoring a pre-#651 revision to recover the gown "
          + "reverts that and fails here. Re-bake with the gown instead.",
      ).toBeGreaterThan(1.72);
    },
    120_000,
  );

  it(
    "(3) COUNTERWEIGHT: the known-good asset still satisfies clause (1)'s predicate",
    async () => {
      // Refuses widening the landmarks until anything passes. If HIP_FRACTION rises or
      // SHOULDER_FRACTION falls far enough for cargo_pants (..0.607) or the t-shirt (0.588..) to
      // qualify, this clause still holds — so it is not a mirror of (1). What it pins is that the
      // predicate is satisfiable TODAY by a real gown on a real body, which is what makes (1)'s
      // red a product defect rather than an impossible assertion.
      const spans = await measureSpans(KNOWN_GOOD);
      const spanning = spanningGarments(spans);
      expect(
        spanning.length,
        `${KNOWN_GOOD} is the known-good column and must satisfy the same predicate. `
          + `Measured: ${describeSpans(spans)}`,
      ).toBeGreaterThan(0);
    },
    120_000,
  );
});

/*
 * ## FIXED (#684)
 *
 * Clause (1) flipped from `it.fails` to `it` on 2026-08-26. Measured after the
 * fix (same instrument, same landmarks):
 *
 *     mpfb-gown-adult-patient.glb   body 1.7756 m (height survives #651)
 *     openclinxr_real_garment_hospital_gown_phenotype_L0   6654t  0.320..0.869   ONE mesh
 *     mat_makeclothes_library_toigo_t_shirt                 2700t  0.588..0.860   (under-gown layer)
 *     (unnamed) declaration marker                            1t
 *
 * THE CAUSE, TRACED: the gown was never part of `materialize_mpfb_humanoid_candidate.py`'s
 * wardrobe. Every pre-#651 gown-carrying bake of this asset was TWO stages: the materializer
 * produced the body, then `bake_mpfb_gown_inspect.py` (--input-glb <body> --output-glb
 * mpfb-gown-adult-patient.glb) added the gown — see the #598 report's "Gown fifth invocation"
 * and its exact invocation. #651's height rebake ran ONLY the first stage with the cast asset as
 * --output, so the wardrobe was rebuilt from the default set (t-shirt + cargo_pants) and the gown
 * stage was never run again. Nothing measured wardrobe preservation across the rebake.
 *
 * THE FIX: re-ran the second stage on the #651 output (input == the 177.6 cm cast asset), which
 * strips the cargo_pants (bake_mpfb_gown_inspect.py `_strip_lower_garments`), invokes the same
 * `apply_role_clothing_material_regions` gown builder the known-good ships, and exports. The body
 * is imported and exported, never regenerated, so the #651 height is preserved by construction.
 * The t-shirt persists underneath the gown (matching the pre-#651 cast composition and the
 * known-good); the gown covers 0.320..0.869, replacing the pants' 0.056..0.607 coverage down to
 * the knee-length hem — the same exposure profile as the pixel-graded known-good.
 */
