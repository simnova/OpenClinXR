import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#46) — the case declares different clothing per role and the factory ships one shell.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#46)` block below, and leave the measured table intact.
 *
 * MEASURED via glTF-Transform on the shipped assets:
 *
 *   peds_anxious_parent.glb              openclinxr_real_garment_peds_upper_v1_mesh   480 verts / 760 tris
 *   peds_nurse_kevin.glb                 openclinxr_real_garment_peds_upper_v1_mesh   480 verts / 760 tris
 *   ed_chest_pain_patient_real_garment   openclinxr_real_garment_peds_upper_v1_mesh   480 verts / 760 tris
 *
 * Three roles, two scenarios, one shell. The parent's `garmentLayers` is
 * ["casual_top","open_cardigan"]; the nurse's is ["scrub_top","scrub_pocket"].
 * `apply_role_clothing_material_regions` (automate_blender.py:1649) branches on `is_gown` for
 * SOLIDIFY thickness (:2000), a sleeve-length fraction (:2117) and colour (:1994) — and emits the
 * same topology from the same `from_pydata` call either way.
 *
 * SAME SHAPE AS #44's environmentId: a declared blueprint field that reaches the generator and does
 * not change what comes out. This is a Q1 violation, not a garment-technology question — which is
 * why the bake-off this issue was originally filed as is explicitly NOT this slice.
 *
 * THE FLOOR FOR "DISTINGUISHABLE" IS COVERAGE AND OPENING, NOT COLOUR. A viewer reads a scrub top by
 * its closed front and short sleeve, a cardigan by its FRONT OPENING, a gown by its drape and
 * coverage. Colour plus a 10% sleeve change is below what anyone registers.
 *
 * THE THREE CONTRACTS PULL APART, and the third is the anti-cheat.
 *
 * The first demands two roles differ on two geometric features. Satisfiable by scaling one shell and
 * calling it another garment — so the third refuses a difference that is only scale, colour or a
 * mesh rename. The second demands an open-front garment not share topology with a closed one, which
 * a uniform ring-and-tube generator cannot satisfy by tuning constants.
 *
 * WHAT I HAVE NOT DETERMINED, offered as one line each and possibly all wrong: whether the ring/tube
 * construction can express a front opening at all without a different build; whether the anterior gap
 * is better as two mesh islands or one ring with a cut; whether `is_gown`'s existing branch is the
 * right place to hang a topology switch. Measure the generator, name what you actually find, and if
 * the honest answer is that this construction cannot express an opening, SAY SO WITH THE MEASUREMENT
 * — that is a successful outcome and it is exactly the finding that would justify the bake-off.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `describeGarmentGeometry({ glbPath })` returning
 * per-garment features. Change the call sites and say why if a different shape is better. What must
 * not change: two roles differ geometrically, an opening is topology rather than a texture, and a
 * scaled recolour is refused.
 *
 * SCOPE: that the declared garment changes the geometry. Says NOTHING about whether any of it looks
 * like real clothing — "distinct class of clothing" is gradeable from a render and is recorded on
 * #46; "believable clinical costume" needs a clinician and is explicitly not claimed.
 */

const load = async () =>
  import("./garment-role-distinguish.js") as Promise<Record<string, unknown>>;

type GarmentFeatures = {
  meshName: string;
  vertexCount: number;
  hasAnteriorOpening: boolean;
  sleeveLengthClass: string;
  hemHeightRatio: number;
};
type Describe = (input: { glbPath: string }) => Promise<GarmentFeatures | null>;
type Differ = (a: GarmentFeatures, b: GarmentFeatures) => { distinguishable: boolean; features: string[] };

const PARENT = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";
const NURSE = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

describe("the declared garment changes the geometry (#46)", () => {
  it.fails("the parent and nurse garments differ on at least two geometric features, not only colour", async () => {
    const mod = await load();
    const describeGarment = mod["describeGarmentGeometry"] as Describe | undefined;
    const differ = mod["garmentsDistinguishable"] as Differ | undefined;
    expect(describeGarment).toBeTypeOf("function");
    expect(differ).toBeTypeOf("function");

    const parent = await describeGarment!({ glbPath: PARENT });
    const nurse = await describeGarment!({ glbPath: NURSE });
    expect(parent, `no garment found in ${PARENT}`).not.toBeNull();
    expect(nurse, `no garment found in ${NURSE}`).not.toBeNull();

    const verdict = differ!(parent!, nurse!);
    expect(verdict.distinguishable).toBe(true);
    expect(verdict.features.length, `differed only on: ${verdict.features.join(", ")}`).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it.fails("an open-front garment is not the same topology as a closed one", async () => {
    // open_cardigan is in the parent's garmentLayers; scrub_top is in the nurse's. A generator that
    // tunes thickness and sleeve length cannot produce an opening, so this is the contract that
    // forces a real construction difference rather than a constant change.
    const mod = await load();
    const describeGarment = mod["describeGarmentGeometry"] as Describe | undefined;
    expect(describeGarment).toBeTypeOf("function");

    const parent = await describeGarment!({ glbPath: PARENT });
    const nurse = await describeGarment!({ glbPath: NURSE });
    expect(parent!.hasAnteriorOpening, "an open cardigan must have a front opening").toBe(true);
    expect(nurse!.hasAnteriorOpening, "a scrub top must not").toBe(false);
    expect(parent!.vertexCount).not.toBe(nurse!.vertexCount);
  }, 180_000);

  it.fails("a garment scaled or recoloured from another role is refused as a distinguishing difference", async () => {
    // The anti-cheat. Scale one shell by 1.1, tint it, rename the mesh — every count changes and
    // nothing about the garment does. This must NOT read as distinguishable.
    const mod = await load();
    const differ = mod["garmentsDistinguishable"] as Differ | undefined;
    expect(differ).toBeTypeOf("function");

    const scrub: GarmentFeatures = {
      meshName: "openclinxr_real_garment_scrub_top_v1_mesh",
      vertexCount: 480,
      hasAnteriorOpening: false,
      sleeveLengthClass: "short",
      hemHeightRatio: 0.42,
    };
    const sameShellRenamed: GarmentFeatures = {
      ...scrub,
      meshName: "openclinxr_real_garment_cardigan_v1_mesh",
    };
    expect(differ!(scrub, sameShellRenamed).distinguishable).toBe(false);

    // And a genuine difference must still read as one, or "never distinguishable" passes the above.
    const cardigan: GarmentFeatures = {
      meshName: "openclinxr_real_garment_cardigan_v1_mesh",
      vertexCount: 704,
      hasAnteriorOpening: true,
      sleeveLengthClass: "long",
      hemHeightRatio: 0.31,
    };
    expect(differ!(scrub, cardigan).distinguishable).toBe(true);
  });
});
