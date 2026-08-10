import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#96 + #94) — the ED renders three copies of the same nurse, and the pediatric
 * patient is naked.
 *
 * ALL FOUR ARE `it.fails` AND ALL FOUR FLIP TO `it(`. They are not all REDs:
 *   (1) (2) (3) are REDs — behaviour that does not exist.
 *   (4) is a COUNTERWEIGHT — parent and nurse already carry real garment shells and must still carry
 *       them afterwards. It is `it.fails` only because the module is absent.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * MEASURED — verify none of this, it is established
 *
 *   shasum -a 256:  ed_chest_pain_adult_cast.glb  ==  peds_nurse_kevin.glb   (identical, 5,999,280 B)
 *
 * The "adult cast" IS the nurse file. Its body mesh is literally named `peds_nurse_kevin.anny_base`
 * and it wears `scrub_top+scrub_pocket`. `runtime-bundles.ts` assigns that one asset to ALL THREE ED
 * roles — `patient_robert_hayes` (`:763`), `nurse_maria_alvarez` (`:771`), `spouse_anna_hayes`
 * (`:779`). So a learner sees three identical nurses, one of whom is the cardiac patient they are
 * there to examine, and one of whom is his wife.
 *
 *   peds_patient_child.glb   1 mesh, NO garment, 17 joints
 *   peds_anxious_parent.glb  4 meshes (1148 + 1284 tri garments), 23 joints
 *   peds_nurse_kevin.glb     4 meshes (812 + 844 tri garments), 23 joints
 *
 * The child is missing `eye.L eye.R clavicle.L clavicle.R index_finger_base.L index_finger_base.R`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * YOU DO NOT NEED TO GENERATE A NEW BASE, AND YOU CANNOT
 *
 * The `anny` python package is NOT importable on this machine. Full `orchestrate_character` without
 * it silently emits ~0.8 MB stub GLBs that pass file checks — that cost #73 its largest turn sink.
 * **Blender-only re-bake on the tracked `.anny_base.obj` files is the path.**
 *
 * Three bases are tracked and available, with distinct phenotypes:
 *
 *   peds_anxious_parent.anny_base.obj   adult_female_parent   166 cm  warm_light / dark_brown
 *   peds_nurse_kevin.anny_base.obj      adult_male_nurse      176 cm  medium_warm / black
 *   peds_patient_child.anny_base.obj    child                 125 cm  warm_light_child
 *
 * Two distinct ADULT bases exist. Combined with role-appropriate `garmentLayers`, that is enough to
 * make the ED cast distinguishable without generating anything. The garment presets already exist:
 * `orchestrate_character.py:72` patient tshirt, `:108` parent casual+cardigan, `:144` nurse scrubs,
 * `:184` hospital_gown.
 *
 * HOW ROLES MAP TO BASES IS YOUR DECISION and must be named in the commit message. An ED cardiac
 * patient in a hospital gown or street clothes, a nurse in scrubs, and a spouse in street clothes is
 * one coherent answer; there are others. What must not survive is three identical figures.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY (3) IS SHAPED THE WAY IT IS — a peer round killed two weaker versions
 *
 * "A mesh named `openclinxr_real_garment_*` with >200 tris" was refused: the SAME prefix sits on
 * `openclinxr_declared_upper_layers__*` meshes that are ONE TRIANGLE, so name-plus-floor asserts
 * "the generator ran".
 *
 * "The provenance records the garmentLayers applied" was refused harder — it is ALREADY GREEN ON THE
 * NAKED FIGURE. `peds_patient_child_rigging_report.json` today has `wardrobeTags.garmentLayers =
 * tshirt` with `realGarmentRegionFromPhenotype = null`. The generator echoes declarations without
 * requiring geometry. That check would have passed on a bare mannequin — the marker problem, which
 * six gates in this repo have now failed to survive.
 *
 * So (3) requires the DECLARATION AND THE GEOMETRY TO AGREE: a real garment mesh in the peer band,
 * AND `realGarmentRegionFromPhenotype` non-null whose face count matches THAT mesh. Neither half is
 * satisfiable alone.
 *
 * IT IS STILL NOT A COVERAGE CHECK. A dense detached scrap in the peer band passes it. That is why
 * the close is a pixel grade — five coverage gates have failed here and a sixth is not being
 * attempted.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE COUNTERWEIGHT DELIBERATELY EXCLUDES THE ADULT CAST. Asserting the cast keeps its garments is
 * VACUOUS while it is the nurse file — it inherits the nurse's shells by construction. Parent and
 * nurse only.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE 17-JOINT RIG IS NOT REQUIRED BY THESE CONTRACTS. If the same re-bake produces 23 joints, say
 * so and it is a bonus. If the rig subset is decided elsewhere in the pipeline, say that and leave
 * it — do NOT chase it at the cost of the wardrobe work. I have NOT determined which, and neither
 * outcome is a failure.
 *
 * WATCH THE ABSOLUTE FLOORS ON A CHILD BODY. Garment constants are mostly body-relative
 * (`body_height * 0.31`, `arm_len * 0.92`, `torso_half_w * 1.14`) but a few are absolute — e.g.
 * `sleeve_r0 = max(..., 0.045)`. On a 1.25 m body those floors can over-inflate sleeves relative to
 * an adult-tuned result. If you see that, REPORT IT; do not tune the constants to hide it, because
 * hand-tuning garment literals is the thing the operator has ruled against.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectActorIdentityAndWardrobe()`. Change the
 * call sites and say why if a different shape is better. What must not change: identity is compared
 * by resolved asset content, not by assetId string; and the garment claim requires declaration and
 * geometry to agree.
 *
 * IN-SCOPE VISUAL VERDICT required, naming figures: "the patient, nurse and spouse are ___" and "the
 * pediatric patient is ___". If you produce a capture I will grade it. Separately name any
 * out-of-scope wrongness — the object and what it looks like, not the word "deformed".
 *
 * SCOPE: which asset each role resolves to, and whether declared garments exist as geometry. Says
 * NOTHING about whether any garment looks good, drapes, or is clinically appropriate — the last
 * needs a clinician and is not claimed.
 *
 * ## FIXED (#96 + #94)
 *
 * ROLE → BASE MAP (named decision):
 *   - ED patient  → adult_male base (`peds_nurse_kevin.anny_base.obj`, 176 cm) + `hospital_gown`
 *     → `ed_chest_pain_adult_cast.glb`
 *   - ED nurse    → same adult_male base + scrub_top/scrub_pocket
 *     → `ed_chest_pain_nurse_adult.glb` (ED provenance, not peds nurse file)
 *   - ED spouse   → adult_female base (`peds_anxious_parent.anny_base.obj`, 166 cm) + casual_top/open_cardigan
 *     → `ed_chest_pain_spouse_adult.glb` (ED provenance)
 *   - Peds patient → `peds_patient_child.anny_base.obj` (125 cm) + `short_sleeve_exam_tshirt`
 *     → re-baked `peds_patient_child.glb` with real garment mesh + non-null region
 *
 * Rejected:
 *   - Full `orchestrate_character` without anny (silent ~0.8 MB stubs — #73 thrash class)
 *   - Three assetIds pointing at one scrub nurse GLB (the measured defect)
 *   - Pointing ED nurse/spouse at peds_* GLBs (fails #85 same-scenario provenance)
 *   - Generating new Anny bases (package not importable)
 *   - Hand-tuning garment shape literals in automate_blender.py (operator ruled against)
 *   - Child base for any ED adult role (age-band refuse still holds)
 *
 * Rig note: same child re-bake produced **23 joints** (bonus — previously 17). Not chased as a goal.
 *
 * Absolute-floor note (child sleeve_r0 max(..., 0.045)): factory constants left unchanged; if sleeves
 * read over-inflated on the 1.25 m body in pixel grade, that is a factory residual, not hand-tuned away.
 *
 * Wiring: actor-casting SSOT + runtime-bundles role blob paths + UI-XR resolveHumanoidVariantOrCastPath
 * per-role ED map. Inspector: inspectActorIdentityAndWardrobe (content hash + garment inventory).
 */

const load = async () =>
  import("./actor-identity-and-wardrobe.js") as Promise<Record<string, unknown>>;

type ActorAsset = {
  actorId: string;
  resolvedAssetPath: string;
  /** Content hash of the resolved GLB — identity by bytes, not by assetId string. */
  assetContentHash: string;
  garmentMeshNames: string[];
  garmentTriangleCounts: number[];
  /** From the asset's rigging report; null when the generator declared without producing geometry. */
  realGarmentRegionFaceCount: number | null;
};
type Inspect = (input: { scenarioId: string }) => Promise<{ actors: ActorAsset[] }>;

const ED = "ed_chest_pain_priority_v1";
const PEDS = "peds_asthma_parent_anxiety_v1";

describe("actors are distinguishable and dressed (#96 + #94)", () => {
  it("no two ED roles resolve to the same asset content", async () => {
    // Identity by CONTENT HASH, not assetId — the current defect has three distinct assetIds
    // (`..._glb`, `..._nurse_glb`, `..._spouse_glb`) all pointing at byte-identical data.
    const mod = await load();
    const inspect = mod["inspectActorIdentityAndWardrobe"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioId: ED });
    expect(report.actors.length, "the ED encounter resolved no actors").toBeGreaterThan(1);

    const hashes = report.actors.map((a) => a.assetContentHash);
    const duplicated = hashes.filter((h, i) => hashes.indexOf(h) !== i);
    expect(
      duplicated,
      `ED roles share asset content: ${report.actors.map((a) => `${a.actorId}=${a.assetContentHash.slice(0, 8)}`).join(", ")}`,
    ).toHaveLength(0);
  }, 600_000);

  it("the ED patient is not dressed as clinical staff", async () => {
    // A cardiac patient in scrub_top+scrub_pocket is indistinguishable from the nurse examining him,
    // which is the specific thing that makes "address the right person" unassessable.
    const mod = await load();
    const inspect = mod["inspectActorIdentityAndWardrobe"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioId: ED });
    const patient = report.actors.find((a) => a.actorId.includes("patient"));
    expect(patient, "no patient role in the ED encounter").toBeDefined();
    expect(
      patient!.garmentMeshNames.some((n) => /scrub/i.test(n)),
      `the ED patient wears ${patient!.garmentMeshNames.join(", ")}`,
    ).toBe(false);
    expect(patient!.garmentMeshNames.length, "the ED patient wears nothing at all").toBeGreaterThan(0);
  }, 600_000);

  it("the pediatric patient's declared garment exists as geometry", async () => {
    // Declaration AND geometry must agree. Today the report says `garmentLayers: tshirt` while
    // `realGarmentRegionFromPhenotype` is null and the GLB has one mesh — the declaration alone is
    // already green on a naked figure.
    const mod = await load();
    const inspect = mod["inspectActorIdentityAndWardrobe"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioId: PEDS });
    const child = report.actors.find((a) => a.actorId.includes("patient"));
    expect(child, "no patient role in the pediatric encounter").toBeDefined();

    const real = child!.garmentMeshNames.filter(
      (n) => n.includes("openclinxr_real_garment_") && !n.includes("declared_upper_layers"),
    );
    expect(real.length, "the pediatric patient has no real garment mesh").toBeGreaterThan(0);

    // Peer band: parent garments are 1148 and 1284 tris, nurse 812 and 844. Not 1 (a marker), not
    // ~27,000 (the body).
    const inBand = child!.garmentTriangleCounts.filter((t) => t >= 400 && t <= 4000);
    expect(inBand.length, `garment triangle counts were ${child!.garmentTriangleCounts.join(", ")}`).toBeGreaterThan(0);

    expect(
      child!.realGarmentRegionFaceCount,
      "the rigging report declares a garment region that does not exist",
    ).not.toBeNull();
    expect(inBand, `region face count ${child!.realGarmentRegionFaceCount} matches no garment mesh`).toContain(
      child!.realGarmentRegionFaceCount,
    );
  }, 600_000);

  it("the parent and nurse still carry their garment shells (COUNTERWEIGHT — already true)", async () => {
    // Deliberately EXCLUDES the adult cast: asserting it keeps its garments is vacuous while it is
    // the nurse file byte-for-byte. A re-bake that dresses the child must not undress anyone.
    const mod = await load();
    const inspect = mod["inspectActorIdentityAndWardrobe"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!({ scenarioId: PEDS });
    const others = report.actors.filter((a) => !a.actorId.includes("patient"));
    expect(others.length, "the pediatric encounter has no non-patient actors").toBeGreaterThan(0);
    for (const actor of others) {
      // #278: parent/nurse re-cast onto the hm08 library bodies — they now wear MakeClothes
      // library garments (makeclothes_library_*), the other rail's real garment meshes.
      // The counterweight intent (nobody got undressed) holds when either rail dresses them.
      const real = actor.garmentMeshNames.filter(
        (n) =>
          (n.includes("openclinxr_real_garment_")
            || /makeclothes_library_.*(scrub|shirt|pant|trouser|gown)/i.test(n))
          && !n.includes("declared_upper_layers"),
      );
      expect(real.length, `${actor.actorId} lost its garment shells`).toBeGreaterThan(0);
    }
  }, 600_000);
});
