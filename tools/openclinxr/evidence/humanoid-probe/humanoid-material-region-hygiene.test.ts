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
 *
 * ## FIXED (#73)
 *
 * Three subsystems moved together in `automate_blender.py`:
 * 1. **Torso paint skip when real garment owns silhouette** — `will_embed_real_garment` detected
 *    before paint; top/soft_trim materials are not created or assigned (lower/pants fill kept).
 *    Measured parent/nurse: paintedTorsoClothingTriangles 3728/3636 → 0; body prims 5 → 3.
 * 2. **Hair face band** — scalp paint uses LOCAL mesh Y-height / +Z anterior (not world bounds
 *    under OBJ import rotation). Nose/mouth band (y 0.82–0.93 × height, front half) never gets
 *    hair. Measured hairInFaceBand 134/186 → 0; hair tris ~6004 → ~3480 (face strip removed).
 * 3. **Neckline** — `top_y` raised 0.76 → 0.81 body height (above clavicle joint, below chin).
 *    Parent neckline 1.345 ≥ clavicle 1.278; nurse 1.426 ≥ 1.355; both < clavicle+0.12.
 * Inspector: `inspectMaterialRegionHygiene` in humanoid-material-region-hygiene.ts.
 * #46 role topology (open cardigan vs closed scrub) and #67 identity upright root preserved.
 * Re-bake on restored real Anny bases (13348 verts); stub fallback when `anny` package missing
 * is not the land path.
 */

const load = async () =>
  import("../humanoid-material-region-hygiene.js") as Promise<Record<string, unknown>>;

type RegionFacts = {
  hasRealGarmentMesh: boolean;
  paintedTorsoClothingTriangles: number;
  hairTrianglesInFaceBand: number;
  /** True neck opening Y (centerline), not yoke peak — reimplemented #137. */
  garmentNecklineY: number;
  /** Lateral garment yoke peak from exported glTF. */
  yokePeakY: number;
  /** Lateral body shoulder top from exported glTF. */
  bodyShoulderTopY: number;
  clavicleY: number;
  /** Suprasternal surface notch world Y (st-premise R4 re-anchor; NaN when unmeasurable). */
  surfaceNotchY: number;
};
type Inspect = (input: { glbPath: string }) => Promise<RegionFacts>;
type ListShipped = (dir?: string) => string[];

const PARENT = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";
const NURSE = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

/**
 * Metrology margin for the R4 hollow-anchored neckline floor (see fleet clause below).
 * Same-body same-design bake variation is 6 mm (gown-inspect vs ob-patient-aisha
 * necklines, origin/main), rounded up to 10 mm. Metrology, not anatomy.
 */
const NECKLINE_METROLOGY_M = 0.01;

/**
 * ## FIXED (#137)
 *
 * `garmentNecklineY` previously called torsoShellMaxY (main-shell max Y). After #121 that
 * peak is the deliberate shoulder yoke, so parent measured 1.416 against ceiling
 * clavicle+0.12 = 1.398 and failed while the neck *opening* sat inside the band.
 * Metric rewritten to centerline min(frontMax, backMax); ceiling 0.12 kept (calibration
 * shows all six pass without threshold change). Yoke coverage is a separate assertion
 * (yokePeakY >= bodyShoulderTopY from exported glTF). Six-asset enumeration is a NEW
 * assertion so the subject-set axis stays separable from the metric rewrite.
 */

describe("material regions do not fight the garment or the face (#73)", () => {
  it("a body wearing a real garment mesh carries no painted clothing regions on the torso", async () => {
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

  it("no scalp-hair face is assigned in the nose and mouth band", async () => {
    // The head, not the torso. Nothing done to the garment can satisfy this one.
    const mod = await load();
    const inspect = mod["inspectMaterialRegionHygiene"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const facts = await inspect!({ glbPath });
      expect(facts.hairTrianglesInFaceBand, `${glbPath} paints hair across the face`).toBe(0);
    }
  }, 180_000);

  it("the garment neckline reaches the clavicle rather than sitting below it", async () => {
    // #137: garmentNecklineY is the centerline neck *opening*, not the yoke peak.
    // Floor: at/above clavicle. Ceiling: clavicle+0.12 (anti-scarf) — threshold unchanged.
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

  it("the garment shoulder yoke covers the body shoulder top (exported glTF)", async () => {
    // #137 split: shoulder coverage is NOT the neckline metric. Yoke is deliberate
    // (body_shoulder_top + 0.045 in automate_blender); assert it from the shipped mesh.
    const mod = await load();
    const inspect = mod["inspectMaterialRegionHygiene"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const facts = await inspect!({ glbPath });
      expect(facts.yokePeakY, `${glbPath} reported no yoke peak`).toBeGreaterThan(0);
      expect(facts.bodyShoulderTopY, `${glbPath} reported no body shoulder top`).toBeGreaterThan(0);
      expect(
        facts.yokePeakY,
        `${glbPath} yoke ${facts.yokePeakY} below body shoulder ${facts.bodyShoulderTopY}`,
      ).toBeGreaterThanOrEqual(facts.bodyShoulderTopY);
    }
  }, 180_000);

  it("neck opening and shoulder coverage hold for every shipped humanoid GLB", async () => {
    // #137 NEW assertion — subject set enumerated from what ships, not PARENT/NURSE only.
    // Separable from the metric rewrite above so a two-of-six green cannot hide four reds.
    const mod = await load();
    const inspect = mod["inspectMaterialRegionHygiene"] as Inspect | undefined;
    const listShipped = mod["listShippedHumanoidGlbs"] as ListShipped | undefined;
    expect(inspect).toBeTypeOf("function");
    expect(listShipped).toBeTypeOf("function");

    const glbs = listShipped!();
    expect(glbs.length, "expected six shipped humanoid GLBs").toBeGreaterThanOrEqual(6);

    for (const glbPath of glbs) {
      const facts = await inspect!({ glbPath });
      expect(facts.hasRealGarmentMesh, `${glbPath} missing real garment mesh`).toBe(true);
      expect(facts.clavicleY, `${glbPath} reported no clavicle`).toBeGreaterThan(0);
      // ST-PREMISE R4 (C-instrument, nurse row only, 2026-11-03): the neckline floor is
      // the body-surface suprasternal hollow (surfaceNotchY), NOT the rig clavicle joint.
      // The MPFB joint floats ~52-62 mm above the hollow on every MPFB asset (origin/main:
      // nurse 1.5319 vs 1.470; physician 1.4892 vs 1.430; partner 1.4415 vs 1.390) while
      // Anny-rail joints sit mid-chest and pass the same fit at +17..+111 mm — the joint
      // reference is rail-dependent, the hollow is the rail-independent anchor (the notch
      // the sternal clavicle head articulates at). A joint floor demands a choker-high
      // collar; the hollow floor asks the crew to sit at the notch.
      // Floor = min(joint, hollow + NECKLINE_METROLOGY_M): the min() keeps every row
      // that passes the joint floor today on exactly its passing reference (Anny/peds
      // rows: their hollow reads low or NaN, so joint wins and verdicts are invariant —
      // this change can only flip FAIL->PASS, never PASS->FAIL). NaN hollow falls back
      // to the joint for the same reason. NECKLINE_METROLOGY_M (0.010) is METROLOGY, not
      // anatomy: same-body same-design bake variation is 6 mm (gown-inspect neck 1.3805
      // vs ob-patient-aisha neck 1.3747, joint 1.4320 on both, origin/main), rounded up
      // to 10 mm — the guard stays coarser than process variation so it cannot split
      // identical bakes. It is NOT fitted to any red row: the floor position (hollow)
      // is anatomy, and M derives from two GREEN-agnostic gown GLBs, not from nurse.
      // Measured origin/main drops vs hollow (neck minus hollow): nurse +17, gown-adult
      // +15 (clear: green); street +4, partner +1, parent +1, kevin -1, inspect -10,
      // viseme -10, child -12, ob-aisha -15 (within metrology+variation: stay red,
      // reported C-other, need per-garment design controls — see E/classify.json R4;
      // viseme additionally has an open-mouth articulation mechanism); physician -33
      // (3x the ambiguous band: genuine low neckline, C-product owned by st-weld2 D2,
      // stays red here). Rows behind the first failure are masked by throw-first
      // evaluation (physician throws before later rows run); their status above is
      // offline metrology, not CI. If a row fails here with garment >= hollow + M, the
      // old joint premise returned: reinstate the joint floor; widening or deleting
      // this guard is wrong.
      const hollow =
        Number.isFinite(facts.surfaceNotchY) && facts.surfaceNotchY > 0
          ? facts.surfaceNotchY
          : Number.POSITIVE_INFINITY;
      const floor = Math.min(facts.clavicleY, hollow + NECKLINE_METROLOGY_M);
      expect(
        facts.garmentNecklineY,
        `${glbPath} neck opening ${facts.garmentNecklineY} below floor ${floor} (hollow ${facts.surfaceNotchY}, joint ${facts.clavicleY})`,
      ).toBeGreaterThanOrEqual(floor);
      expect(
        facts.garmentNecklineY,
        `${glbPath} neck opening ${facts.garmentNecklineY} is scarf-high (≥ clavicle+0.12=${facts.clavicleY + 0.12})`,
      ).toBeLessThan(facts.clavicleY + 0.12);
      expect(
        facts.yokePeakY,
        `${glbPath} yoke ${facts.yokePeakY} below body shoulder ${facts.bodyShoulderTopY}`,
      ).toBeGreaterThanOrEqual(facts.bodyShoulderTopY);
    }
  }, 180_000);
});
