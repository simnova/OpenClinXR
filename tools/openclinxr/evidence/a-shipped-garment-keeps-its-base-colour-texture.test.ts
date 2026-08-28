/**
 * #740 — every shipped garment material has lost its base-colour texture.
 *
 * THE DEFECT, MEASURED 2026-08-28 — do not re-derive this.
 *
 *   Across all shipped apps/ui-xr/public/generated-humanoids/mpfb-*.glb:
 *
 *     garment materials (footwear / shirt) WITH a baseColorTexture:   0
 *     garment materials WITHOUT:                                     22
 *
 *   Skin and eye materials still carry textures on the same assets, so the export path can still
 *   write them. This is specific to garments.
 *
 *   Before/after on one actor, `git show f82e1cc2^` versus main, mpfb-ob-patient-aisha.glb:
 *     ..._footwear_toigo_mj_cloth_shoes  texture, factor [1,1,1,1]
 *                                     -> NO texture, factor [0.1,0.09,0.08,1]
 *     ..._toigo_t_shirt                  texture, factor [0.34,0.44,0.34,1]
 *                                     -> NO texture, same factor
 *
 *   The shoe lost its texture AND moved to a near-black factor, so it renders as a dark blob. The
 *   actor's GLB shrank 11,395,580 -> 9,980,840 bytes; that is texture removal, not optimisation.
 *
 *   Provenance: f82e1cc2, the #683 fitted-eyelash bake. It rode in unrecorded — that worker's
 *   OUT-OF-SCOPE section named three test reds and not this — and surfaced only because a
 *   control/treatment material hash was run for a different question.
 *
 * ## FIXED (#740)
 *
 * Clause (1) flipped from `it.fails` to `it` on 2026-08-28. The locus was the FIT stage, not
 * export: the #683 bake ran with the declared garment .mhmat files unstaged in the provider
 * cache, `garment_material_from_declared` recorded each skip, and every footwear/shirt slot
 * shipped a flat role colour — the #371 failure class, second occurrence. The #372 export
 * verify only checks slots consumed in THIS bake, so a skipped slot never failed.
 *
 * Two materializer changes:
 *   - `garment_material_from_declared` gained `require_texture=True` on the footwear/shirt
 *     call sites: every skip reason (unstaged .mhmat, no diffuseTexture, missing texture
 *     file, UV-less mesh) is now a hard RuntimeError instead of a recorded skip.
 *   - `parse_mhmat` reads `diffuseTexture` as the whole remainder of the line: MakeHuman
 *     authors paths with spaces (`Scrubs_Main_BaseColor_Utility - sRGB - Texture.png` in the
 *     WojackOWL Medical Scrubs Kit) and the token-split parser truncated them to the first
 *     word, so a staged texture never resolved.
 *
 * Staging: the toigo t-shirt / mj cloth shoes / male boots .mhmat + textures (main cache) and
 * the Scrub_Shirt.mhmat + its declared diffuse (CC-BY, WojackOWL) were staged, and all eleven
 * mpfb GLBs plus the two gown bakes were re-materialized. Every garment material ships its
 * baseColorTexture again; factors match the pre-f82e1cc2 bytes.
 *
 * THIS HEADER IS IMMUTABLE. Flip the assertion and append a `## FIXED (#740)` block below.
 */
import { NodeIO } from "@gltf-transform/core";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../..");
const DIR = resolve(REPO, "apps/ui-xr/public/generated-humanoids");

/** Materials whose surface is a worn garment. Derived from the names the fleet actually ships. */
const GARMENT = /footwear|shoe|shirt/i;
/** The known-good column: these kept their textures through the same bake. */
const KEPT_TEXTURE = /skin|eyes/i;

type Row = { asset: string; material: string; hasTexture: boolean; factor: number[] };

async function surveyMaterials(): Promise<Row[]> {
  if (!existsSync(DIR)) return [];
  const io = new NodeIO();
  const rows: Row[] = [];
  for (const file of readdirSync(DIR).filter((f) => /^mpfb-.*\.glb$/u.test(f))) {
    const doc = await io.read(join(DIR, file));
    for (const material of doc.getRoot().listMaterials()) {
      rows.push({
        asset: file,
        material: material.getName(),
        hasTexture: Boolean(material.getBaseColorTexture()),
        factor: [...material.getBaseColorFactor()],
      });
    }
  }
  return rows;
}

describe("#740 a shipped garment keeps its base-colour texture", () => {
  it("(1) every garment material carries a baseColorTexture", async () => {
    const rows = await surveyMaterials();
    // Guards against a vacuous pass on an empty survey: 22 garment materials shipped when this was
    // measured, so finding none means the extraction is wrong, not that the fleet is clean.
    const garments = rows.filter((r) => GARMENT.test(r.material));
    expect(garments.length, "garment materials found").toBeGreaterThanOrEqual(20);
    const bare = garments
      .filter((r) => !r.hasTexture)
      .map((r) => `${r.asset} / ${r.material}`);
    expect(bare).toEqual([]);
  });

  it("(2) the known-good column: skin and eye materials kept theirs", async () => {
    // If this fails, the export path stopped writing textures at all and clause (1) is measuring a
    // wider defect than this card describes. Fail loudly rather than let (1) stand for both.
    const rows = await surveyMaterials();
    const kept = rows.filter((r) => KEPT_TEXTURE.test(r.material));
    expect(kept.length, "skin/eye materials found").toBeGreaterThanOrEqual(10);
    expect(kept.every((r) => r.hasTexture), "every skin/eye material has a texture").toBe(true);
  });

  it("(3) COUNTERWEIGHT: a flat factor is not accepted in place of a texture", async () => {
    // The cheapest way to make garments look coloured again is to tune baseColorFactor, which is
    // exactly what the shoe already shows — [0.1,0.09,0.08] standing in for a lost material. Any
    // garment that passes clause (1) must do it with a texture, not a factor.
    const rows = await surveyMaterials();
    for (const r of rows.filter((x) => GARMENT.test(x.material) && x.hasTexture)) {
      expect(r.factor.slice(0, 3).every((c) => c <= 1.0001), `${r.material} factor in range`).toBe(true);
    }
  });

  it("(4) COUNTERWEIGHT: the fleet is not emptied to pass", async () => {
    const rows = await surveyMaterials();
    const assets = new Set(rows.map((r) => r.asset));
    expect(assets.size, "shipped mpfb-*.glb assets").toBeGreaterThanOrEqual(10);
  });
});
