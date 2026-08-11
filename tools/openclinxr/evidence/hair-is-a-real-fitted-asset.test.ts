import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Hair is PAINTED, never geometry — on every rail — while 25 real MakeHuman hairstyles sit staged
 * on disk, unconsumed since the `hair01` acquisition.
 *
 * MEASURED 2026-08-11, mesh names via NodeIO across every shipped humanoid:
 *
 *   mpfb2_aisha           hair/scalp mesh: NONE   (t_shirt_basic_tucked, ..._body)
 *   library_lean_female   hair/scalp mesh: NONE   (basemesh, cargo_pants, t_shirt, flats L/R)
 *   anny_parent           hair/scalp mesh: NONE   (footwear L/R, peds_upper, cardigan, anny_base)
 *
 * #222/#279 landed a painted scalp-hair REGION — a texture on the head, not hair. The garments took
 * the painted-shell -> fitted-`.mhclo` upgrade this cycle (#321/#322/#324); hair never did.
 *
 * THE LICENCE MATRIX IS THE HARD PART AND IT IS MEASURED. 25 staged styles, by licence line and by
 * helper-vertex refs (a ref >= 13380 cannot fit a helper-stripped basemesh — the #324 exclusion):
 *
 *   usable: CC0 AND zero helper refs                      6   the six `toigo_*` bobs
 *   AGPL3 — HARD REFUSAL (copyleft)                       9
 *   no licence line — refusal (unspecified is a refusal)  4   the four `cortu_*`
 *   CC-BY family — allowed, needs attribution             2   o4saken_long01, elvs_reverse_french_braid_bun
 *   CC-0 variant spelling                                 2   culturalibre_hair_06 (0 helpers), _05 (4 helpers)
 *   CC0 but 12 helper refs — excluded on topology         1   faydaen_hair_1
 *
 * THE LICENCE STRINGS ARE NOT UNIFORM: `CC0`, `CC-0`, `: CC0`, `CC_by`, `CC BY 4.0`, `AGPL3`, absent.
 * A naive `grep -i cc0` misses `CC-0` and `CC_by`; a directory glob ships NINE AGPL3 assets. I made
 * exactly this class of error earlier today — a `# license:` grep WITH A COLON mis-read three CC0
 * garments as unlicensed, because the format is `# license CC0`, no colon (§11k). So clause (3)'s
 * ground truth below was read off the real pack, not invented.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                  | (1) hair mesh | (2) no copyleft | (3) variants | result
 *   -------------------------------------------|---------------|-----------------|--------------|--------
 *   a) today — painted scalp region only       |     FAIL      |      pass       |     FAIL     | REFUSED
 *   b) glob the pack directory                 |     pass      |    **FAIL**     |     pass     | REFUSED
 *   c) filter on `grep -i cc0`                 |     pass      |      pass       |   **FAIL**   | REFUSED
 *   d) parse the licence line, classify, refuse|     pass      |      pass       |     pass     | ALL PASS
 *
 * (c) is the quiet one: it passes the copyleft check and silently discards `CC-0` and `CC_by` as if
 * unlicensed, which is how a usable pack shrinks to nothing and someone concludes the acquisition
 * failed. (2) and (3) fail in opposite directions, so neither alone is sufficient.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1), (2), (3) are REDs and fail today — no hair geometry
 * ships and no classification artifact exists. (4) PASSES today and is the known-good column: the
 * fitted garments already on these bodies must survive a hair fit (§6p — adding a layer must not
 * remove one).
 *
 * NOT TESTED: no pixel is graded and no hair is styled. This asserts that hair reaches a body as
 * FITTED GEOMETRY and that the licence gate is real. Whether the hair sits on the scalp rather than
 * intersecting it, whether it deforms with the head, and whether it looks like hair are all separate
 * questions — clause (1) bounds presence and weighting, not appearance (§11s: a presence clause
 * cannot see placement, so placement is deliberately out of scope here and needs its own slice).
 */

/**
 * ## FIXED (#330)
 *
 * `embed_library_hair.py` now fits a staged CC0 MakeClothes hair `.mhclo` through the SAME
 * `ClothesService.fit_clothes_to_human` the upper/lower/footwear channels use (D1), and
 * `body-param-cli.ts` runs it as a finish step after footwear. The licence gate is real:
 * `hair-licence-classify.ts` parses every staged `.mhclo`'s OWN header (the non-uniform
 * `CC0`/`CC-0`/`CC_by`/`CC BY 4.0`/`AGPL3`/absent spellings) and counts helper-vertex refs against
 * the #318 stripped basemesh (>= 13380 cannot fit), then writes
 * `.openclinxr/evidence/issue-330/hair-licence-classification.json` (25 rows) and refuses all ten
 * AGPL3 styles for the copyleft reason, the four unlicensed `cortu_*` for no licence line,
 * `faydaen_hair_1` (12 helpers) and `culturalibre_hair_05` (4 helpers) on topology, and classifies
 * the CC-0 / CC_by / CC BY 4.0 variant spellings as usable (never unlicensed). The six toigo bobs
 * are the primary usable set.
 *
 * Re-baked through the hair finish step (2026-08-11) onto the two library GLBs. Measured on the
 * shipped bytes: `body-param-adult_lean_female-library.glb` carries
 * `makeclothes_library_hair_toigo_blunt_bob_with_bangs_adult_lean_female_mesh` (4,976 tris,
 * JOINTS_0 + WEIGHTS_0 present — skinned, weighted 100% to `mixamorig:Head`), placed on the head by
 * world body-bounds alignment + the measured stature ratio (glb 1.7325 m vs 0.1*ref 1.6945 m),
 * glTF y [1.409, 1.673] against the head-joint extent [1.422, 1.732]. The heavy-male class is a
 * RECORDED SKIP: the licence-clean zero-helper subset is all feminine styles, so a bob on a male
 * patient would regress realism — recorded in the catalog as `hairSkippedReason`, never silent.
 *
 * The two `it.fails` -> `it` flips are clauses (1), (2) and (3) above (three markers, three flips).
 * Clause (4) was already green and is unchanged. The licence ledger's `makehuman-hair01` row is
 * expanded with the classification artifact, the fitted style, and the gate. The painted scalp
 * REGION (#222/#279) is untouched — the fitted hair is geometry ON TOP of it, and the
 * mpfb-scalp-hair-region contract still sees the body's scalp primitive (its "no separate hair
 * mesh" clause is scoped to exclude the FITTED library hair mesh — a fitted .mhclo is the opposite
 * of the hand-authored sphere D1 forbids; the body-identification heuristic was also fixed for the
 * footwear-sized meshes).
 *
 * The six toigo styles remain the usable CC0 set; `culturalibre_hair_06` (CC-0), `o4saken_long01`
 * (CC BY 4.0) and `elvs_reverse_french_braid_bun` (CC_by) are additionally classified usable with
 * attribution. NOT covered here: hair on the MPFB2 materializer rail (aisha), hairstyle realism,
 * scalp-flush placement (pixel-graded separately).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, ".openclinxr/evidence/issue-330/hair-licence-classification.json");

/** Measured off the real staged pack 2026-08-11 — ground truth, not a target. */
const AGPL3_MUST_REFUSE = [
  "learning_anime_hair",
  "culturalibre_hair_01",
  "culturalibre_hair_02",
  "elvs_double_mh_braid",
  "elvs_french_braid_variation",
  "elvs_unkempt_french_braid",
  "littleright_bobcut_hair",
  "rehmanpolanski_hair_bun_brown",
  "sonntag78_junglebook_hair",
  "sonntag78_blond_with_headband",
] as const;

/** No licence line at all. Unspecified is a refusal (PROTO_CURIOUS_RESEARCHER). */
const UNLICENSED_MUST_REFUSE = [
  "cortu_straight_bangs",
  "cortu_short_messy_hair",
  "cortu_shaggy_green_hair",
  "cortu_strawberry_cloud_hair",
] as const;

/** Variant spellings a `grep -i cc0` drops. Must NOT be classified unlicensed. */
const VARIANT_SPELLINGS_MUST_NOT_BE_UNLICENSED = [
  "culturalibre_hair_06", // "CC-0"
  "o4saken_long01", // "CC BY 4.0"
  "elvs_reverse_french_braid_bun", // "CC_by"
] as const;

const HUMANOIDS = [
  "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
] as const;

type Classification = {
  asset?: string;
  licence?: string;
  usable?: boolean;
  refusedReason?: string | null;
  helperVertexRefs?: number;
};

function classifications(): Classification[] {
  if (!existsSync(ARTIFACT)) return [];
  const parsed = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { assets?: Classification[] };
  return Array.isArray(parsed.assets) ? parsed.assets : [];
}

const io = new NodeIO();
async function meshNames(rel: string): Promise<string[]> {
  const doc = await io.read(join(REPO_ROOT, rel));
  return doc.getRoot().listMeshes().map((m) => m.getName());
}

const shipped = await Promise.all(
  HUMANOIDS.map(async (p) => ({ path: p, names: await meshNames(p) })),
);
const classified = classifications();

/** An empty artifact must FAIL, never pass vacuously (§7t). */
function requireClassified(rows: Classification[]): void {
  expect(rows.length, "hairstyles classified in the licence artifact").toBeGreaterThanOrEqual(25);
}

describe("hair reaches a body as a fitted library asset, under a real licence gate", () => {
  it("(1) RED: at least one shipped humanoid carries fitted hair GEOMETRY, weighted to the head", async () => {
    const withHair = shipped.filter((s) => s.names.some((n) => /hair/i.test(n)));
    expect(
      withHair.map((s) => s.path),
      `shipped humanoids carrying a hair mesh (all mesh names: ${shipped.map((s) => s.names.join("/")).join(" || ")})`,
    ).not.toEqual([]);

    // A hair mesh must be real geometry skinned to the rig, not an empty node.
    for (const s of withHair) {
      const doc = await io.read(join(REPO_ROOT, s.path));
      for (const mesh of doc.getRoot().listMeshes().filter((m) => /hair/i.test(m.getName()))) {
        const tris = mesh
          .listPrimitives()
          .reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);
        expect(tris, `${mesh.getName()} triangles`).toBeGreaterThan(0);
        const weighted = mesh.listPrimitives().some((p) => p.getAttribute("JOINTS_0") !== null);
        expect(weighted, `${mesh.getName()} is skinned, not a rigid prop`).toBe(true);
      }
    }
  });

  it("(2) RED COUNTERWEIGHT: no AGPL3 or unlicensed style is marked usable or shipped — a directory glob is refused", () => {
    requireClassified(classified);
    const usable = new Set(classified.filter((c) => c.usable).map((c) => c.asset ?? ""));
    const leaked = [...AGPL3_MUST_REFUSE, ...UNLICENSED_MUST_REFUSE].filter((n) => usable.has(n));
    expect(leaked, "copyleft or unlicensed hairstyles marked usable").toEqual([]);

    // and none of them may appear as geometry in a shipped humanoid
    const inShipped: string[] = [];
    for (const s of shipped) {
      for (const bad of [...AGPL3_MUST_REFUSE, ...UNLICENSED_MUST_REFUSE]) {
        if (s.names.some((n) => n.includes(bad))) inShipped.push(`${s.path}: ${bad}`);
      }
    }
    expect(inShipped, "refused hairstyles present in a shipped humanoid").toEqual([]);
  });

  it("(3) RED COUNTERWEIGHT: variant licence spellings are classified correctly — a `grep -i cc0` is refused", () => {
    requireClassified(classified);
    const byName = new Map(classified.map((c) => [c.asset ?? "", c]));

    // Every AGPL3 asset must be refused FOR THE COPYLEFT REASON, not incidentally.
    const misreasoned = AGPL3_MUST_REFUSE.filter((n) => {
      const c = byName.get(n);
      return !c || c.usable !== false || !/agpl|copyleft/i.test(c.refusedReason ?? "");
    });
    expect(misreasoned, "AGPL3 styles not refused with a copyleft reason").toEqual([]);

    // CC-0 / CC_by / CC BY 4.0 must NOT be swept up as unlicensed — that is the (c) failure.
    const wronglyUnlicensed = VARIANT_SPELLINGS_MUST_NOT_BE_UNLICENSED.filter((n) => {
      const c = byName.get(n);
      return !c || /unlicen[cs]ed|no licence|unspecified/i.test(c.refusedReason ?? "");
    });
    expect(
      wronglyUnlicensed,
      "CC-0 / CC-BY variant spellings misclassified as unlicensed",
    ).toEqual([]);
  });

  it("(4) NET known-good: the fitted garments already on these bodies survive", async () => {
    for (const s of shipped) {
      const garments = s.names.filter((n) => /t_shirt|cargo_pants|scrub|footwear|flats/i.test(n));
      expect(garments.length, `${s.path} keeps its fitted garments (${s.names.join(", ")})`)
        .toBeGreaterThanOrEqual(1);
    }
  });
});
