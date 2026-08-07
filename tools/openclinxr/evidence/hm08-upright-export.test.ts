import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#156) — the hm08 candidate #134 produced exports LYING DOWN. Its longest axis
 * is Z, its height is 0.436 m, and the grade capture put the camera inside the mesh while its
 * self-check reported perfect agreement.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #134's rig-carry result must survive unchanged.
 * It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED BY ME, 2026-08-07 — trust these numbers, verify the inference
 *
 * `.openclinxr/evidence/issue-134/hm08-rig-carry-candidate.glb`, read with glTF-transform NodeIO:
 *
 * | | W | H | D | minY | maxY |
 * |---|---|---|---|---|---|
 * | hm08 candidate | 0.995 | **0.436** | **1.695** | −0.326 | 0.110 |
 * | `peds_nurse_kevin.glb` (shipped) | 1.078 | **1.760** | 0.466 | 0.000 | 1.760 |
 *
 * Longest axis Z, height 0.436, origin mid-body. `model-vetting-glb-grade-capture --glb` reported
 * `agrees: true, relativeError: 0.00027` and produced four unusable images — the camera framed a
 * 0.436-tall box around a 1.695-long figure and ended up inside it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE TREE ALREADY DOCUMENTS THE RULE THIS BROKE. A peer round found it; I verified it.
 *
 * `makeclothes_anny_reference_stage.py:160-166`, docstring, verbatim:
 *
 *     Anny OBJ files are Y-up; MPFB create_human is already Z-up. Export uses export_yup=True
 *     so final glTF has height on +Y.
 *
 * and it calls `force_z_up_standing(obj)` at `:211` before exporting.
 *
 * `hm08_rig_carry_stage.py:294-298` instead sets `export_yup=False` with the comment *"Y-height
 * content; keep export_yup=False so height stays on Y (#67 working pattern)"* — **the Anny rule
 * applied to MPFB content.** `add_mpfb2_eye_rig.py:57-60` records the same mistake and its symptom in
 * as many words: *"export_yup=False here left joints/mesh on Z."*
 *
 * So `export_yup` is CONDITIONAL on what the Blender scene already holds, and the flag is a slogan
 * unless you know which content you have.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DO NOT SHIP ON A FLAG FLIP. #67 COST A FULL CYCLE ON EXACTLY THIS.
 *
 * #67 tried the obvious fix first and it FAILED in a way that looked like a win:
 *
 * | treatment | root | joints | mesh POSITION |
 * |---|---|---|---|
 * | object +90° on the node (#58, shipped) | non-identity | stand on Y | height on Y |
 * | rest-data bake + `export_yup=True` | identity | stand on Y | **height on Z** |
 * | identity object + `export_yup=False` | identity | stand on Y | height on Y |
 *
 * Row two is the trap: identity root, joints standing, probe green — **and the mesh lying down**.
 *
 * **The success criterion is EVERY COLUMN AT ONCE:** root transform, joint ordering, mesh AABB with
 * height exceeding both horizontal extents, AND the pixels reading upright. Any single column green
 * is how #58, #64 and #67's second treatment all looked like wins. Report the whole table for every
 * treatment you try, including the ones that fail.
 *
 * `force_z_up_standing` may also be needed, not only the flag — the working path calls both.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS NOT — a peer round corrected my scope and I accept it
 *
 * I was going to bundle this with "assert a supine body is on its back". **That is already fixed:**
 * `supine-pose.ts:126` sets `openClinXrSupineRootBasis = "head_neg_x_left_neg_z_face_pos_y"` and
 * #153's post-fix shoulders read 0.773/0.773. Bundling a mostly-solved cause with an open one invites
 * a shallow assertion on the solved half while the open half burns the budget. Filed separately.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE SELF-CHECK CANNOT SEE THIS, SO DO NOT TRUST `agrees`
 *
 * `glb-grade-capture` compares a NodeIO AABB against a three.js AABB. §6e records the residual its
 * own author named: *"both deliberately measure world mesh AABB — if that metric is blind, both stay
 * green together."* An axis-swapped figure has a perfectly consistent AABB in both instruments.
 * `agrees: true` is real agreement about a quantity that cannot answer this question.
 *
 * **The pixels are the only instrument that closes this, and grading them is MINE.** Produce the
 * images; do not grade them yourself beyond the closed checklist below.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether the fix is `export_yup=True` alone, `force_z_up_standing` alone, or both. The working
 *    MPFB path uses both. I do not know which is sufficient and the table is how you find out.
 *  - Whether the candidate is regenerated in place or written alongside the existing one. Keeping the
 *    old one makes the before/after comparison reproducible; replacing it is tidier.
 *  - `hm08_rig_carry_stage.py:302` sets `export_morph=False`, so the morph inventory stays 0 whatever
 *    happens to the axis. Say whether you changed it. **I lean leave it** — #134 scoped morph parity
 *    out deliberately and recorded the gap as a number — but if you flip it, say why.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the exported candidate stand upright, and is satisfiable by scaling or rotating the
 * mesh alone while the skeleton stays on Z. (2) forbids that by requiring the JOINTS to be upright in
 * the same frame as the mesh — a figure whose mesh stands while its rig lies down cannot be posed.
 * (3) is green today and forbids buying either by losing #134's rig-carry result.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectHm08UprightExport()`. What must not
 * change: measurements come from the EXPORTED glTF via NodeIO and joint names are read as three.js
 * sees them (dots stripped, §6v).
 *
 * CALIBRATION — one row per treatment tried, written to
 * `.openclinxr/evidence/issue-156/pre-fix.json` BEFORE any product edit (§8o):
 *
 *   treatment | export_yup | force_z_up | rootIsIdentity | meshW/H/D | jointSpanUpAxis | verdict
 *
 * The pre-fix row is the CURRENT candidate and must reproduce W=0.995 H=0.436 D=1.695. If it does
 * not, stop — my measurement is wrong and I want to know that before anything else.
 *
 * REQUIRED, the observable half: re-run
 * `pnpm exec tsx tools/openclinxr/evidence/model-vetting-glb-grade-capture.ts --glb <candidate>`
 * and leave the four images on disk for me to grade. Do not write another capture script.
 *
 * IN-SCOPE VISUAL — answer EVERY line from the images you produced. Do not replace with a sentence:
 *     figure_orientation:   upright | lying | inverted | camera_inside_mesh
 *     limbs_present:        all | some_missing | not_visible
 *     proportions:          plausible | distorted | not_visible
 *     surface:              continuous | torn | not_visible
 *
 * OUT-OF-SCOPE WRONGNESS you saw and are not fixing: name the object and what it looks like (§6m),
 * even on the same body part. #134's own worker described this candidate as "a faceted doll, seam-like
 * hair shell, flat face, bare feet on a pedestal-like sole block" — say whether you agree and what
 * else you see.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: the exported orientation of the hm08 candidate. Says NOTHING about whether to adopt hm08 in
 * production (#134 scoped that), morph parity, weight quality (#126), or the supine runtime pose.
 */

const load = async () => import("./hm08-upright-export.js") as Promise<Record<string, unknown>>;

type AxisMeasure = {
  /** Where the candidate was read from. */
  assetPath: string;
  meshWidth: number;
  meshHeight: number;
  meshDepth: number;
  meshMinY: number;
  /** Longest world axis of the MESH — "x" | "y" | "z". Upright means "y". */
  meshLongestAxis: string;
  /** Longest world axis of the JOINT cloud. Must agree with the mesh or the figure cannot be posed. */
  jointLongestAxis: string;
  /** Vertical span of the skeleton in world space. */
  jointSpanY: number;
  /** True when the armature root node carries no rotation. */
  rootIsIdentity: boolean;
  /** Joint names as three.js sees them — dots stripped. */
  runtimeJointNames: string[];
  triangleCount: number;
};

type Treatment = AxisMeasure & { treatment: string; exportYup: boolean; forceZUpStanding: boolean };

type Inspect = () => Promise<{ current: AxisMeasure; treatments: Treatment[]; chosen: string }>;

/** A standing humanoid is taller than it is wide or deep. */
const MIN_HEIGHT_OVER_HORIZONTAL = 1.5;

/** Adult stature band — generous; the shipped humanoids are 1.25–1.76 m. */
const MIN_PLAUSIBLE_HEIGHT = 1.0;

describe("the hm08 candidate exports upright (#156)", () => {
  it.fails("the exported mesh stands taller than it is wide or deep", async () => {
    // Measured: W=0.995 H=0.436 D=1.695. hm08_rig_carry_stage.py:298 sets export_yup=False, which is
    // the Anny rule (content already Y-height) applied to MPFB content that is native Blender Z-up.
    const mod = await load();
    const inspect = mod["inspectHm08UprightExport"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const c = report.current;
    const horizontal = Math.max(c.meshWidth, c.meshDepth);
    expect(horizontal, `${c.assetPath}: degenerate horizontal extent`).toBeGreaterThan(0);
    expect(
      c.meshHeight / horizontal,
      `${c.assetPath} is ${c.meshHeight.toFixed(3)}m tall and ${horizontal.toFixed(3)}m across — lying down`,
    ).toBeGreaterThan(MIN_HEIGHT_OVER_HORIZONTAL);
    expect(c.meshLongestAxis, `${c.assetPath}: longest mesh axis is ${c.meshLongestAxis}`).toBe("y");
    expect(c.meshHeight, `${c.assetPath} is only ${c.meshHeight.toFixed(3)}m tall`)
      .toBeGreaterThan(MIN_PLAUSIBLE_HEIGHT);
  }, 1_800_000);

  it.fails("the skeleton stands in the SAME frame as the mesh", async () => {
    // Kills the cheap satisfaction of the first contract, and it is the exact trap #67 fell into:
    // rotating the mesh alone gives an upright figure whose rig still lies on Z, so it cannot be
    // posed. Treatment two in #67's table had identity root and standing joints WITH a lying mesh —
    // the mirror image of this, and it passed every single-column check.
    const mod = await load();
    const inspect = mod["inspectHm08UprightExport"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const c = report.current;
    expect(c.jointLongestAxis, `joints lie along ${c.jointLongestAxis} while the mesh stands on y`)
      .toBe(c.meshLongestAxis);
    expect(
      c.jointSpanY,
      `skeleton spans only ${c.jointSpanY.toFixed(3)}m vertically against a ${c.meshHeight.toFixed(3)}m mesh`,
    ).toBeGreaterThan(c.meshHeight * 0.6);

    // Every treatment attempted must be recorded, passing or failing — the table is the deliverable.
    expect(report.treatments.length, "no treatment table was recorded").toBeGreaterThan(0);
    for (const t of report.treatments) {
      expect(t.treatment.length, "a treatment row has no name").toBeGreaterThan(0);
    }
    expect(report.chosen.length, "no treatment was recorded as chosen").toBeGreaterThan(0);
  }, 1_800_000);

  it.fails("#134's rig-carry result survives (COUNTERWEIGHT)", async () => {
    // The cheapest way to make an axis check pass is to re-export something simpler — a mesh with no
    // skin, or a rig with fewer joints. #134's finding is that hm08 carries all 23 canonical names at
    // 36,972 triangles, and that must still be true of whatever ships out of this slice.
    const mod = await load();
    const inspect = mod["inspectHm08UprightExport"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const CANON = [
      "pelvis", "spine", "chest", "neck", "head",
      "thighL", "thighR", "shinL", "shinR", "footL", "footR",
      "upper_armL", "upper_armR", "forearmL", "forearmR", "handL", "handR",
    ];
    const missing = CANON.filter((n) => !report.current.runtimeJointNames.includes(n));
    expect(missing, `canonical joints lost by the re-export:\n${missing.join(", ")}`).toHaveLength(0);
    expect(report.current.triangleCount, "the candidate lost geometry").toBeGreaterThan(30_000);
    expect(report.current.triangleCount, "the candidate exceeds the per-asset ceiling")
      .toBeLessThanOrEqual(60_000);
  }, 1_800_000);
});
