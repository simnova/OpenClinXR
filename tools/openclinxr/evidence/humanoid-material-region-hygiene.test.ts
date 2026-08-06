import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#73) — the body is clothed twice and the hairline is cut into the face.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#73)` block below, and leave the measured table intact.
 *
 * I MISDIAGNOSED THIS TWICE. Recording both so nobody re-walks them:
 *   1. "the garment tears the body at the neck and deltoid" — a shell/body collision. WRONG.
 *   2. corrected when the same torn look appeared on the FACE, where no garment touches.
 *
 * WHAT IT ACTUALLY IS. `apply_role_clothing_material_regions` paints clothing onto the BODY MESH by
 * per-face axis-aligned box tests — `polygon.material_index = trim/top/lower`
 * (automate_blender.py:1713-1719) on `center.z` bands and `rel_x` half-widths. The hair pass does the
 * same (`:2431`) with a `face_front_exclusion_y` guard that `continue`s on front-of-head faces. Every
 * boundary follows the tessellation, so it is a staircase by construction.
 *
 * MEASURED on shipped `peds_anxious_parent.glb` — the body splits into five primitives by material:
 *
 *   anny_generated_pbr (skin)                     15592 tris   y 0.00-1.54
 *   openclinxr_role_mesh_clothing_parent_top       3060 tris   y 0.71-1.21
 *   openclinxr_role_mesh_clothing_parent_lower     1368 tris   y 0.13-0.68
 *   openclinxr_role_mesh_clothing_parent_soft_trim  668 tris   y 0.65-1.25
 *   openclinxr_mesh_native_scalp_hair_surface      6004 tris   y 1.43-1.66
 *
 * THE FIX IS NOT TO SMOOTH THE PAINTING. #46 moved real garment geometry onto a separate mesh driven
 * by `garmentLayers`, and the paint path's own claimScope calls itself
 * `procedural_bounds_based_clothing…not_production_wardrobe` (`:1727-1728`). The runtime already
 * refuses the painted slots — `main.ts:6824-6826` says NEVER tag them because "those produce a giant
 * pants blob while torso stays bare". So the body is clothed twice. Removing the paint where a real
 * garment exists REDUCES materials and triangles; subdividing to smooth a boundary would do the
 * opposite and is explicitly a trivial pass to refuse.
 *
 * THE NECKLINE IS THE THIRD PIECE, and its constant is named: `top_y = body_min_y + body_height *
 * 0.76` (`:1794`), commented "clavicle / shoulder girdle", for EVERY role. It is why both landed
 * garments are off-the-shoulder with bare skin across the shoulders. The #46 worker named this
 * unprompted as the piece that would have tripled its slice.
 *
 * THE FACE PATCH IS A HYPOTHESIS, NOT A FINDING. I believe it is skin showing through a jagged hole
 * in the hair region, from the front-face exclusion. I have not proved it. Cheap ways to settle it,
 * unranked: force hair emissive magenta and skin emissive cyan and see which colour the patch is;
 * disable the hair pass alone in a one-off export and see whether the face artifact vanishes while
 * the clothing steps remain. It could also be normal seams, multi-material lighting, or a morph
 * target. Measure it; do not take my reading as fact, since two of my readings here were wrong.
 *
 * THE THREE CONTRACTS PULL APART. The first removes painted clothing where geometry owns the
 * silhouette — satisfiable by deleting the paint everywhere, which would strip roles that have no
 * garment shell, so it is conditioned on a real garment being present. The second is about the head
 * and cannot be satisfied by anything done to the torso. The third demands the neckline rise, which
 * neither of the others touches — and raising it must not collapse #46's cardigan opening or disturb
 * #67's bind, both of which are in this issue's verify chain.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectMaterialRegionHygiene({ glbPath })`
 * returning per-asset region facts. Change the call sites and say why if a different shape is better.
 * What must not change: no painted torso clothing under a real garment, no hair on the face, and a
 * neckline at the clavicle.
 *
 * SCOPE: material regions and garment coverage. Says nothing about drape, fold quality or whether any
 * of it looks like real clothing — that verdict is read off the renders and recorded on #73.
 */

const load = async () =>
  import("./humanoid-material-region-hygiene.js") as Promise<Record<string, unknown>>;

type RegionFacts = {
  hasRealGarmentMesh: boolean;
  paintedTorsoClothingTriangles: number;
  hairTrianglesInFaceBand: number;
  garmentNecklineY: number;
  clavicleY: number;
};
type Inspect = (input: { glbPath: string }) => Promise<RegionFacts>;

const PARENT = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";
const NURSE = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

describe("material regions do not fight the garment or the face (#73)", () => {
  it.fails("a body wearing a real garment mesh carries no painted clothing regions on the torso", async () => {
    const mod = await load();
    const inspect = mod["inspectMaterialRegionHygiene"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const facts = await inspect!({ glbPath });
      // Conditioned deliberately: a role with no garment shell may still need painted fill, so this
      // must not be satisfiable by deleting the paint unconditionally.
      expect(facts.hasRealGarmentMesh, `${glbPath} has no real garment to supersede the paint`).toBe(true);
      expect(facts.paintedTorsoClothingTriangles, `${glbPath} is clothed twice`).toBe(0);
    }
  }, 180_000);

  it.fails("no scalp-hair face is assigned in the nose and mouth band", async () => {
    // The head, not the torso. Nothing done to the garment can satisfy this one.
    const mod = await load();
    const inspect = mod["inspectMaterialRegionHygiene"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const facts = await inspect!({ glbPath });
      expect(facts.hairTrianglesInFaceBand, `${glbPath} paints hair across the face`).toBe(0);
    }
  }, 180_000);

  it.fails("the garment neckline reaches the clavicle rather than sitting below it", async () => {
    // top_y = body_min_y + body_height * 0.76 (automate_blender.py:1794) for every role, which is why
    // both landed garments are off-the-shoulder. A neckline AT or ABOVE the clavicle is the ask; a
    // garment that swallows the neck would be its own defect, so the upper bound matters too.
    const mod = await load();
    const inspect = mod["inspectMaterialRegionHygiene"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const facts = await inspect!({ glbPath });
      expect(facts.clavicleY, `${glbPath} reported no clavicle`).toBeGreaterThan(0);
      expect(
        facts.garmentNecklineY,
        `${glbPath} neckline ${facts.garmentNecklineY} sits below clavicle ${facts.clavicleY}`,
      ).toBeGreaterThanOrEqual(facts.clavicleY);
      // And not up over the chin — a scarf is not a fix.
      expect(facts.garmentNecklineY).toBeLessThan(facts.clavicleY + 0.12);
    }
  }, 180_000);
});
