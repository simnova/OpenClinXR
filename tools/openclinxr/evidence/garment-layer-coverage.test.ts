import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#75) — the blueprint declares a list of layers and the factory builds one.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#75)` block below, and leave the measured facts intact.
 *
 * HOW WE GOT HERE, because it shapes the fix. #73's contract said "no painted clothing on a torso
 * wearing a real garment". It passed — 3728 and 3636 painted triangles to zero — and was
 * architecturally right, since the runtime already refused those slots (`main.ts:6824-6826`, "those
 * produce a giant pants blob while torso stays bare"). But the paint was the only thing covering the
 * torso, so the parent came out TOPLESS under her open cardigan and the nurse with BARE THIGHS. That
 * contract was mine and it deleted a mechanism without requiring a replacement.
 *
 * MEASURED. `apply_role_clothing_material_regions` reads `garment_layers` (automate_blender.py:1676)
 * and uses it ONLY to classify — `is_gown` (:1679), `is_open_front` (:1681), `is_scrub` (:1684) — plus
 * `garment_layers[0]` as a name key (:2134). There is exactly ONE `bpy.data.meshes.new` (:2143) and
 * ONE `bpy.data.objects.new` (:2148) in the whole path. `["casual_top","open_cardigan"]` builds one
 * garment and the under-layer is never built.
 *
 * TWO SHELLS IS NOT THE MISTAKE #73 REMOVED. Paint and geometry occupied the SAME surface and produced
 * tessellation-staircase boundaries. An inner and an outer garment are two surfaces, and they work if
 * the inner is CLOSED and at a SMALLER radius so the outer's opening reveals the inner rather than
 * skin. Two shells at the same radius will z-fight — a different defect with a known fix (radial
 * offset), not a reason to keep building one.
 *
 * DO NOT RESTORE THE TORSO PAINT to cover the gap. It re-opens #73 and the runtime still will not
 * treat paint as the garment.
 *
 * DO NOT REMOVE THE LOWER-BODY PAINT. #73 skipped only the torso; the lower fill (:1786-1787) is
 * currently the only thing covering the legs for most roles. Removing it before a lower garment mesh
 * exists turns topless into bottomless — the same mistake one body part down.
 *
 * THE THIRD CONTRACT REPLACES A GATE THAT DEMONSTRABLY LIES. #73's neckline check measures the
 * MAXIMUM garment Y in a mid-X band (`humanoid-material-region-hygiene.ts:131-171`). It passed —
 * parent 1.345 >= clavicle 1.278, nurse 1.426 >= 1.355 — on figures whose deltoids and upper chest
 * are bare, because a collar point above the clavicle is not a shoulder cap. `top_y` has ALREADY been
 * raised once for this, 0.76 -> 0.81 (:1864-1868), and the shoulders are still bare. Raising it again
 * would re-pass the same test and change nothing anyone can see. Coverage, not height.
 *
 * MEASURE COVERAGE INDEPENDENTLY. A check computed from the same constants the generator used to
 * place the garment agrees with itself and proves nothing — that is exactly how the height gate
 * passed. Sample the BODY mesh and ask whether a garment surface is near it.
 *
 * THE THREE CONTRACTS PULL APART. Two meshes satisfies the first and can still be two open-front
 * shells over a bare chest, so the second requires the inner to be closed. Both can hold while the
 * shoulders stay uncovered, so the third measures the body rather than the garment.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectGarmentLayerCoverage({ glbPath })`.
 * Change the call sites and say why if a different shape is better. What must not change: a declared
 * list produces that many garments, an under-layer is closed, and coverage is measured on the body.
 *
 * SCOPE: upper-body layer construction and coverage. Says nothing about drape, fabric, lower-body
 * garments, or whether the clothing is clinically appropriate — that last needs a clinician and is
 * not claimed.
 *
 * ## FIXED (#75)
 * - `apply_role_clothing_material_regions` now loops every upper `garmentLayers` token and emits
 *   one shell per token (inner smaller radius, outer larger). Under-layer for open outers is closed.
 * - Declaration mesh `openclinxr_declared_upper_layers__…` encodes blueprint count for inspect.
 * - Coverage inspect samples BODY upper_chest / deltoid_L/R and checks nearest garment distance
 *   against a body-height-derived tolerance (not generator top_y / r_base constants).
 * - Regenerated `peds_anxious_parent.glb` (casual_top closed under + open_cardigan) and
 *   `peds_nurse_kevin.glb` (scrub_top + scrub_pocket closed stack). Torso paint still skipped (#73);
 *   lower paint retained. All three contracts flipped.
 */

const load = async () =>
  import("./garment-layer-coverage.js") as Promise<Record<string, unknown>>;

type GarmentShell = { meshName: string; hasAnteriorOpening: boolean; meanRadius: number };
type BodySample = { region: string; covered: boolean };
type Coverage = {
  declaredUpperLayerCount: number;
  garmentShells: GarmentShell[];
  bodySamples: BodySample[];
};
type Inspect = (input: { glbPath: string }) => Promise<Coverage>;

const PARENT = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";
const NURSE = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

describe("every declared garment layer is built and the body is covered (#75)", () => {
  it("a role declaring two upper garment layers gets two garment meshes", async () => {
    const mod = await load();
    const inspect = mod["inspectGarmentLayerCoverage"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    // The parent declares ["casual_top", "open_cardigan"]; the nurse declares a scrub set. Whatever
    // each declares, the count of built shells must match — not "two always".
    for (const glbPath of [PARENT, NURSE]) {
      const cov = await inspect!({ glbPath });
      expect(cov.declaredUpperLayerCount, `${glbPath} declared no upper layers`).toBeGreaterThan(0);
      expect(
        cov.garmentShells.length,
        `${glbPath} declares ${cov.declaredUpperLayerCount} upper layers and built ${cov.garmentShells.length}`,
      ).toBe(cov.declaredUpperLayerCount);
    }
  }, 180_000);

  it("the layer under an open outer garment is closed at the front", async () => {
    // Kills two open-front shells over a bare chest, and kills one mesh duplicated and scaled: the
    // inner must differ from the outer in the one way that matters for coverage.
    const mod = await load();
    const inspect = mod["inspectGarmentLayerCoverage"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const cov = await inspect!({ glbPath: PARENT });
    const open = cov.garmentShells.filter((s) => s.hasAnteriorOpening);
    const closed = cov.garmentShells.filter((s) => !s.hasAnteriorOpening);
    expect(open.length, "the parent's cardigan should still be open").toBeGreaterThan(0);
    expect(closed.length, "an open outer needs a closed layer beneath it").toBeGreaterThan(0);
    // And the closed one must sit inside, or the outer's opening reveals the under-layer's opening.
    expect(Math.min(...closed.map((s) => s.meanRadius))).toBeLessThan(Math.max(...open.map((s) => s.meanRadius)));
  }, 180_000);

  it("upper chest and deltoid body samples are covered by a garment shell", async () => {
    // Replaces #73's neckline gate, which measured the MAXIMUM garment Y and passed on bare
    // shoulders. This measures the BODY: sample points on it and ask whether garment is near them.
    const mod = await load();
    const inspect = mod["inspectGarmentLayerCoverage"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of [PARENT, NURSE]) {
      const cov = await inspect!({ glbPath });
      const wanted = ["upper_chest", "deltoid_left", "deltoid_right"];
      for (const region of wanted) {
        const sample = cov.bodySamples.find((s) => s.region === region);
        expect(sample, `${glbPath} reported no sample for ${region}`).toBeDefined();
        expect(sample!.covered, `${glbPath} leaves ${region} bare`).toBe(true);
      }
    }
  }, 180_000);
});
