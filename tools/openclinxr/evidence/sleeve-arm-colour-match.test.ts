import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#146) — #103 clothed the arm below a short cuff and painted it a hardcoded
 * teal-blue that does not match the garment. Figures now wear bright blue forearms and hands against
 * a pink top, which reads as mismatched gloves.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #103's coverage must survive; the arm must stay
 * clothed. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * I CAUSED THIS. #103 WAS MY SLICE AND I GRADED IT AS A WIN WITH THIS NOTED.
 *
 * The close comment said: *"the exposure is fixed and the arm paint colour is wrong… on the nurse in
 * teal scrubs the arm paint matches and reads as a long sleeve; on the other two it reads as
 * mismatched blue gloves against a garment of a different colour."* This is that residual, filed
 * rather than left in a close comment where nobody would find it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, TRACED — verified against the tree, do not re-derive
 *
 * `automate_blender.py:2405-2408`
 *
 *     arm_mat = create_role_marker_material(
 *         f"openclinxr_role_mesh_clothing_{role}_arm",
 *         top_color if top_color else (0.08, 0.42, 0.55, 1.0),
 *     )
 *
 * When `top_color` is falsy the arm falls back to a **hardcoded teal-blue constant**. That is why it
 * matches on the teal-scrub nurse — coincidence, the fallback happens to be near scrub colour — and
 * clashes on the pink and light-blue figures.
 *
 * **`top_color` is plausibly unset precisely when the torso is a real garment MESH**, because the
 * colour then lives on the garment mesh's own material rather than on a paint region. That would make
 * the fallback fire exactly in the case #121 made the default. I have NOT confirmed that; it is the
 * first thing to measure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Where the arm colour comes from when the torso is a mesh garment. The garment mesh's base colour
 *    is the obvious source; whether that is reachable at the point the arm material is created is the
 *    thing to find out, and it may require reordering.
 *  - Whether the fallback constant survives at all. A fallback that fires silently and produces a
 *    wrong colour is worse than one that fails loudly — but a hard failure in an asset bake is its own
 *    problem. Your call, and say which.
 *  - Whether a sleeve-end arm should match the garment exactly or be a plausible under-layer in a
 *    related tone. Exactly-matching reads as a long sleeve; a related tone reads as an undershirt.
 *    **This is a clinical-appearance decision as much as a technical one** — say which you chose, and
 *    if you think the other is right, say so in your report and do yours anyway.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the arm colour track the garment, and is satisfiable by painting the arm the same
 * colour as the BODY, which would un-clothe it. (2) forbids that by requiring the arm to remain a
 * clothing region distinct from skin. (3) is green today and forbids buying either by reverting
 * #103's coverage — the arm must stay clothed from wrist to cuff.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectSleeveArmColourMatch()`. What must not
 * change: colours come from the EXPORTED glTF via NodeIO — not from the Blender script's intent,
 * which #121 paid roughly 40 turns learning — and every shipped humanoid is enumerated.
 *
 * REGENERATION PATH, per §6r: `rebake_role_wardrobe_blender_only.py` on the tracked
 * `*.anny_base.obj` bases. Do NOT run full `orchestrate_character` — without the `anny` package it
 * silently emits ~0.8 MB stub GLBs that pass file checks. The six humanoids under
 * `apps/ui-xr/public/generated-humanoids/` are TRACKED and must be committed.
 *
 * The provenance writer changed under you an hour ago (#142) — the rebake now records
 * `derivationMode: "blender_only_rebake"` through a shared `humanoid_provenance.py`. If a rebake
 * produces provenance that fails `anny-candidate-preflight`, that is a regression and you should say
 * so rather than hand-editing the JSON, which is the exact loop #142 closed.
 *
 * REQUIRED, the observable half: re-capture `psych_suicidal_ideation_safety_v1` and
 * `ob_headache_preeclampsia_triage_v1` — both currently show the mismatch on more than one figure.
 * Reuse `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write a fourth capture
 * script. After the first successful run, re-run it twice more with `FORCE_COLOR=1`.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: forearms ___ ; hands ___ ; how the arm reads against the garment ___ ;
 *                      anything now broken ___
 * and: CONTRACT_MET_VISUAL: reads_as_sleeve | improved_still_mismatched | unchanged | other:<text>
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * If satisfying a contract here will make the product visibly worse than before, say so in your
 * report and then satisfy it anyway. Naming it is not disobedience.
 *
 * SCOPE: the colour of the arm clothing region relative to its garment. Says NOTHING about coverage
 * (#103 settled it), garment geometry, skin weights (#126), or whether any colour is clinically
 * appropriate — that needs a clinician.
 */

const load = async () => import("./sleeve-arm-colour-match.js") as Promise<Record<string, unknown>>;

type ArmColourFacts = {
  assetPath: string;
  role: string;
  /** True when the garment stops above the wrist, so an arm clothing region exists at all. */
  hasShortSleeve: boolean;
  /** Linear RGB of the arm clothing material, from the exported glTF. */
  armColour: [number, number, number];
  /** Linear RGB of the torso garment — mesh material when a real garment owns the torso, else paint. */
  garmentColour: [number, number, number];
  /** Linear RGB of the body skin region, so the counterweight can see the arm turned into skin. */
  skinColour: [number, number, number];
  /** Euclidean distance in linear RGB between arm and garment. */
  armToGarmentDistance: number;
  /** Euclidean distance between arm and skin. */
  armToSkinDistance: number;
  /** #103's guarantee, for the counterweight. */
  armBelowCuffClothedFraction: number;
};

type Inspect = () => Promise<{ assets: ArmColourFacts[] }>;

/**
 * The arm should read as belonging to the garment. Deliberately loose — an under-layer in a related
 * tone is acceptable and exact equality is not required. The hardcoded fallback (0.08, 0.42, 0.55)
 * against a pink top is roughly 0.7 away, so this discriminates without dictating a palette.
 */
const MAX_ARM_TO_GARMENT_DISTANCE = 0.35;

/** The arm must not become skin. Painting it skin-coloured satisfies nothing and un-clothes it. */
const MIN_ARM_TO_SKIN_DISTANCE = 0.15;

describe("a sleeve-end arm belongs to its garment (#146)", () => {
  it("the arm clothing colour tracks the garment", async () => {
    // automate_blender.py:2405-2408 falls back to a hardcoded (0.08, 0.42, 0.55) when top_color is
    // falsy, which is why it matches the teal nurse by coincidence and clashes everywhere else.
    const mod = await load();
    const inspect = mod["inspectSleeveArmColourMatch"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.assets.length, "no shipped humanoids were inspected").toBeGreaterThan(0);

    const mismatched: string[] = [];
    for (const a of report.assets) {
      if (!a.hasShortSleeve) continue;
      if (a.armToGarmentDistance > MAX_ARM_TO_GARMENT_DISTANCE) {
        mismatched.push(
          `${a.assetPath} (${a.role}): arm ${a.armColour.map((c) => c.toFixed(2)).join(",")} vs garment `
          + `${a.garmentColour.map((c) => c.toFixed(2)).join(",")} — distance ${a.armToGarmentDistance.toFixed(2)}`,
        );
      }
    }
    expect(mismatched, `arms that do not belong to their garment:\n${mismatched.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the arm is still clothing and not skin", async () => {
    // Kills the cheap satisfaction of the first contract: painting the arm the body's colour makes
    // the distance-to-garment check irrelevant by un-clothing the arm, which is #103 undone.
    const mod = await load();
    const inspect = mod["inspectSleeveArmColourMatch"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const skinny: string[] = [];
    for (const a of report.assets) {
      if (!a.hasShortSleeve) continue;
      if (a.armToSkinDistance < MIN_ARM_TO_SKIN_DISTANCE) {
        skinny.push(`${a.assetPath}: arm is ${a.armToSkinDistance.toFixed(2)} from skin colour`);
      }
    }
    expect(skinny, `arms repainted as skin:\n${skinny.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("#103's coverage survives (COUNTERWEIGHT)", async () => {
    // The cheapest way to make a colour check pass is to stop painting the arm at all. #103 measured
    // 0.007-0.53 before and >=0.91 after; that must not regress.
    const mod = await load();
    const inspect = mod["inspectSleeveArmColourMatch"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const a of report.assets) {
      if (!a.hasShortSleeve) continue;
      expect(
        a.armBelowCuffClothedFraction,
        `${a.assetPath} lost #103's arm coverage`,
      ).toBeGreaterThanOrEqual(0.9);
    }
  }, 900_000);
});
