import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#147) — the sleeve-end arm clothing region runs to the fingertips, so figures
 * appear to wear gloves. On a nurse that is ordinary; on a patient in a hospital gown it is wrong.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #103's forearm coverage and #146's colour match must
 * both survive. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PROPOSAL I ALMOST SHIPPED WAS WRONG. A PEER ROUND CORRECTED IT.
 *
 * I was going to file this as "stop the arm clothing at the wrist", as though #103 had forgotten a
 * bound. **It did not.** `automate_blender.py:2470-2475` already has one:
 *
 *     # Hands below wrist stay skin.
 *     arm_wrist_h = min_h + height_h * 0.12
 *     arm_cuff_h  = min_h + height_h * 0.66
 *     arm_lat_min = body_width_l * 0.20
 *     is_arm_clothing = arm_wrist_h <= ch <= arm_cuff_h and rel_x >= arm_lat_min
 *
 * The comment says hands stay skin and the code intends it. **The wrist is defined as a global
 * body-height plane at 0.12 × height — which is near the ankle, not the wrist.** With arms hanging at
 * the sides, hand faces sit inside the 0.12–0.66 band *and* are lateral, so they get painted.
 *
 * This is the same class as #124's hem: **a global height plane standing in for a limb landmark.**
 * Not a missing stop.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE RIG HAS THE LANDMARK ALREADY
 *
 * `automate_blender.py:315-317` — `hand.L` / `hand.R` are created with `hand.head = hand_pos`, and
 * `forearm.tail` is that same position. **The hand bone head IS the anatomical wrist in this rig.**
 *
 * The neck and arm cuts at `:1739-1757` are already landmark-aligned — a radial band around a
 * landmark, a shoulder→elbow segment. This region is the odd one out.
 *
 * **Do not fix this by lowering `0.12`.** Another height fraction is another version of the same bug,
 * and #124 spent a slice replacing exactly that pattern.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE TRAP, AND IT IS §6p AGAIN
 *
 * Shrinking the Y band re-opens a bare-skin gap between the new boundary and the cuff — which is the
 * defect #103 existed to close, and the shape #73 already taught us (remove a covering, say nothing
 * about what covers the gap).
 *
 * The formulation that avoids it, per the peer round: **clothe by proximity to the forearm segment
 * distal of the cuff; leave skin by proximity to the hand bone.** Two positive rules that meet,
 * rather than one band that shrinks.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * IS THIS EVEN A DEFECT? A ROLE QUESTION, AND THE DEFAULT IS AGENT-MAKEABLE
 *
 * A nurse in gloves is correct. A patient in gloves is not. So this is arguably role-conditional and
 * therefore a clinical-appearance decision.
 *
 * The peer round's position, which I accept for v1: **universal skin hands is simpler and safer than
 * role flags.** A patient not wearing gloves is not a clinical claim; it is the absence of one. Role
 * gloves can come later if a case needs them, and that one *should* have a clinician.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - How "distal of the hand bone head" is computed from mesh vertices. Distance to the bone head,
 *    projection onto the forearm axis, or vertex-group weight on `hand.*` — I do not know which is
 *    robust on this topology and that is the first thing to find out.
 *  - Whether the cuff end also moves to a landmark. It is `0.66 × height` today, the same class of
 *    bug, and it is NOT what this slice is about — say if you think it should be, and leave it.
 *  - Whether any role keeps gloves. Default is none; if you disagree say so and ship the default.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the hand render as skin, and is satisfiable by shrinking the band until the forearm
 * goes bare too. (2) forbids that by requiring the forearm between cuff and wrist to stay clothed at
 * #103's measured level. (3) is green today and forbids buying either by reverting #146's colour
 * match, which would return the mismatched-blue defect.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectSleeveWristBoundary()`. What must not
 * change: measurements come from the EXPORTED glTF via NodeIO — never from the Blender script's
 * intent, which #121 paid roughly 40 turns learning — and every shipped humanoid is enumerated.
 *
 * REGENERATION PATH, per §6r: `rebake_role_wardrobe_blender_only.py` on the tracked
 * `*.anny_base.obj` bases. Do NOT run full `orchestrate_character` — without the `anny` package it
 * silently emits ~0.8 MB stub GLBs that pass file checks. The six humanoids under
 * `apps/ui-xr/public/generated-humanoids/` are TRACKED and must be committed.
 *
 * The provenance writer is mode-tagged since #142. If a rebake produces provenance that fails
 * `anny-candidate-preflight`, that is a regression — say so rather than hand-editing the JSON, which
 * is the exact loop #142 closed.
 *
 * REQUIRED, the observable half: re-capture `psych_suicidal_ideation_safety_v1` — all three figures
 * show the gloves today. Reuse `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not
 * write a fourth capture script. After the first successful run, re-run twice more with
 * `FORCE_COLOR=1`.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace this with a sentence:
 *     hands:                skin | gloved
 *     forearms:             clothed | bare
 *     wrist_boundary:       clean | ragged | not_visible
 *     colour_still_matches: yes | no
 *     figures_intact:       yes | no
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: where the arm clothing region ends. Says NOTHING about its colour (#146 settled it), garment
 * geometry, skin weights (#126), or whether gloves are clinically indicated for any role.
 */

const load = async () => import("./sleeve-wrist-boundary.js") as Promise<Record<string, unknown>>;

type WristBoundaryFacts = {
  assetPath: string;
  role: string;
  hasShortSleeve: boolean;
  /** Fraction of HAND vertices carrying a clothing material region. Should be ~0. */
  handClothedFraction: number;
  /** Fraction of forearm-between-cuff-and-wrist carrying clothing. #103's guarantee. */
  forearmBelowCuffClothedFraction: number;
  /** Distance from the clothing boundary to the hand bone head, in metres. */
  boundaryToHandBoneMeters: number;
  /** How the boundary was derived — a landmark or a height fraction. */
  boundarySource: string;
  /** #146's guarantee: arm clothing still matches the garment. */
  armToGarmentDistance: number;
};

type Inspect = () => Promise<{ assets: WristBoundaryFacts[] }>;

/** A hand is not clothing. Small non-zero allowance for a vertex or two at the seam. */
const MAX_HAND_CLOTHED_FRACTION = 0.1;

/** #103 measured >=0.91 after its fix. The forearm must not regress. */
const MIN_FOREARM_CLOTHED_FRACTION = 0.85;

/** #146's threshold, unchanged. */
const MAX_ARM_TO_GARMENT_DISTANCE = 0.35;

describe("the sleeve ends at the wrist, not the fingertips (#147)", () => {
  it.fails("hands render as skin", async () => {
    // automate_blender.py:2471 defines the wrist as 0.12 * body height — near the ankle. With arms
    // at the sides, hand faces fall inside the band and are lateral, so they get painted.
    const mod = await load();
    const inspect = mod["inspectSleeveWristBoundary"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.assets.length, "no shipped humanoids were inspected").toBeGreaterThan(0);

    const gloved: string[] = [];
    for (const a of report.assets) {
      if (!a.hasShortSleeve) continue;
      if (a.handClothedFraction > MAX_HAND_CLOTHED_FRACTION) {
        gloved.push(
          `${a.assetPath} (${a.role}): ${(a.handClothedFraction * 100).toFixed(0)}% of the hand reads `
          + `as clothing (boundary from ${a.boundarySource})`,
        );
      }
    }
    expect(gloved, `figures wearing gloves:\n${gloved.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("the forearm between cuff and wrist stays clothed", async () => {
    // Kills the cheap satisfaction of the first contract: shrinking the band until the hand clears
    // takes the forearm with it and re-opens the bare-skin band #103 existed to close. §6p.
    const mod = await load();
    const inspect = mod["inspectSleeveWristBoundary"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const bare: string[] = [];
    for (const a of report.assets) {
      if (!a.hasShortSleeve) continue;
      if (a.forearmBelowCuffClothedFraction < MIN_FOREARM_CLOTHED_FRACTION) {
        bare.push(
          `${a.assetPath}: only ${(a.forearmBelowCuffClothedFraction * 100).toFixed(0)}% of the forearm `
          + `below the cuff is clothed — #103 regressed`,
        );
      }
    }
    expect(bare, `forearms that went bare:\n${bare.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("#146's colour match survives (COUNTERWEIGHT)", async () => {
    // The third way to make a boundary check pass is to stop painting the arm at all, or to repaint
    // it something that no longer tracks the garment. #146 landed that an hour before this slice.
    const mod = await load();
    const inspect = mod["inspectSleeveWristBoundary"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const a of report.assets) {
      if (!a.hasShortSleeve) continue;
      expect(
        a.armToGarmentDistance,
        `${a.assetPath} lost #146's arm-to-garment colour match`,
      ).toBeLessThanOrEqual(MAX_ARM_TO_GARMENT_DISTANCE);
    }
  }, 900_000);
});
