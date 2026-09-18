import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Body Catmull-Clark subdiv is added AFTER the helper strip (so mhclo still
 * binds to 13,380 verts) and baked with bake_subdiv=True only at export.
 *
 * MEASURED 2026-09-18: native face crop of the adult-nurse scratch bake showed
 * crumpled polygonal facets on forehead/cheeks/neck. create_human does not add
 * a SUBSURF modifier; bake_subdiv=True at the strip would apply nothing and
 * would also reindex the basemesh before clothes.
 *
 * claimScope: the materializer adds an unapplied SUBSURF (viewport 0) after
 *   HELPER_STRIP and applies it with bake_subdiv=True, remove_helpers=False
 *   immediately before the skin bake; the strip call itself stays
 *   bake_subdiv=False. Adult-nurse albedo is the CC0 skins01 mhmat.
 * notEvidenceFor: whether the subdivided nurse LOOKS smooth (pixel grade);
 *   Quest triangle budget; other actors' albedo.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

describe("the body subdiv bakes after the helper strip", () => {
  it("(1) the helper strip still refuses bake_subdiv so mhclo binds to 13,380 verts", () => {
    const src = readFileSync(MAT, "utf8");
    expect(src, "strip call keeps bake_subdiv=False").toMatch(
      /ExportService\.bake_modifiers_remove_helpers\(\s*human, bake_masks=False, bake_subdiv=False, remove_helpers=True/,
    );
  });

  it("(2) an unapplied body SUBSURF is added after HELPER_STRIP", () => {
    const src = readFileSync(MAT, "utf8");
    expect(src, "BODY_SUBSURF helper exists").toMatch(/def ensure_body_subsurf\(/);
    expect(src, "viewport levels stay 0 during clothes fit").toMatch(/existing\.levels = 0/);
    expect(src, "called after HELPER_STRIP print").toMatch(
      /HELPER_STRIP verts[\s\S]{0,400}ensure_body_subsurf\(human/,
    );
  });

  it("(3) bake_subdiv=True runs with remove_helpers=False immediately before the skin bake", () => {
    const src = readFileSync(MAT, "utf8");
    expect(src, "export subdiv apply").toMatch(
      /bake_masks=False, bake_subdiv=True, remove_helpers=False/,
    );
    expect(src, "BODY_SUBDIV_APPLIED census").toMatch(/BODY_SUBDIV_APPLIED/);
    expect(src, "shade_smooth after subdiv so face crops are not flat-shaded facets").toMatch(
      /bpy\.ops\.object\.shade_smooth\(\)/,
    );
  });

  it("(4) COUNTERWEIGHT: adult nurse albedo is the CC0 skins01 mhmat, not a hand-authored graph", () => {
    const src = readFileSync(MAT, "utf8");
    expect(src, "skins01 nurse stem").toMatch(
      /ed_chest_pain_nurse_adult": "toigo_light_skin_with_natural_makeup"/,
    );
    expect(src, "create_v2_skin_material consumes mhmat_file").toMatch(
      /create_v2_skin_material\(\s*skin_material_name,\s*human,\s*mhmat_file=/,
    );
  });
});
