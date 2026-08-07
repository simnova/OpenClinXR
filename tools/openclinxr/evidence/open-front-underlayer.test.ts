import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#103) — four of six shipped humanoids wear an `open_front` garment, and an open
 * cardigan has nothing behind it. #73 removed painted torso clothing wherever a real garment exists,
 * which is correct for a closed top and leaves an open one showing skin by construction.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #121's shoulder span, #124's hem overlap and #73's
 * lower paint must all survive. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS §6p, AND IT IS THE SECOND TIME
 *
 * "A contract that removes something must say what replaces it." #73's contract said *no painted
 * clothing on a torso that wears a real garment*. It passed, it was architecturally right, and the
 * parent came out topless under an open cardigan. The rule was written from that slice and this is
 * the same defect still shipping.
 *
 * The fix is NOT to reinstate paint under every garment — that re-earns #73's double-clothing defect
 * from the other side. A peer round put it plainly: real pipelines author **a closed base layer plus
 * an open outer**, not paint-through-cardigan as the only system. Whatever lands must be scoped to
 * `open_front` and must not touch closed kinds.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS MEASURED AND WHAT IS NOT
 *
 * `#124` measured that every mesh hem now overlaps the painted lower region (hemY 0.515–0.845 against
 * paintTop 0.854–0.907 across all six). So the waist is not the gap. `garment-hem-boundary.ts`
 * already exposes `garmentKind` and `hasPaintedLowerRegion` — reuse that vocabulary rather than
 * inventing a parallel one.
 *
 * The #124 worker's reading of the two remaining skin exposures, which I have **NOT** independently
 * confirmed and you should not treat as fact:
 *   - the band at the end of a short sleeve is "unpainted arm mesh past the cuff" — garment end
 *     against bare limb, not two paint regions
 *   - the midriff skin is "open silhouette / under-layer", not a paint-top-above-mesh-hem gap
 *     (which the numbers forbid for the primary shell)
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DO NOT WRITE A COVERAGE GATE. SIX HAVE DIED HERE.
 *
 * §6t records the class: max-Y in a band, nearest-garment proximity, max-Y over a shoulder footprint,
 * a body hide-mask, an area-weighted outward-normal raycast, and a lofted sector. Every one was a
 * body-relative test of garment PRESENCE, and presence is not wornness — a detached blade satisfies
 * all of them.
 *
 * These contracts deliberately assert something else: that a **closed surface exists behind the
 * opening**, and that the arm below a cuff carries a clothing material region. Both are structural
 * facts about how the asset was built, checkable from the exported glTF. **Neither claims it looks
 * dressed. The pixel grade closes this and it is mine.**
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether the under-layer is a second mesh shell or restored paint scoped to the open gap. Both
 *    are defensible. A mesh costs triangles and re-opens the hem/weights work; paint is cheap and is
 *    what #73 removed, so restoring it needs to be scoped narrowly enough not to re-create double
 *    clothing on closed kinds.
 *  - How "the opening" is identified. `garmentKind === "open_front"` is available today, but the
 *    anterior gap's extent is not — say how you found it.
 *  - Whether the arm past a short cuff is painted, or the sleeve is lengthened. Painting is closer to
 *    #73's existing lower-body treatment; lengthening changes a silhouette a clinician might care
 *    about. **This is a clinical-appearance decision as much as a technical one — say which you chose
 *    and why, and if you believe the other is right, say so in your report and do yours anyway.**
 *  - Which of the six assets are in scope. Four are `open_front` today; enumerate rather than list.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a closed surface behind an open front, and is satisfiable by closing the front — which
 * would delete the open silhouette that distinguishes a cardigan from a tee (#46). (2) forbids that
 * by requiring the outer garment to keep an anterior opening. (3) is green today and forbids buying
 * either by regressing the shoulder span, the hem overlap, or the lower paint.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectOpenFrontUnderLayer()`. What must not
 * change: measurements come from the EXPORTED glTF via NodeIO — never from the Blender script's
 * intent, which #121 paid ~40 turns learning — and every shipped humanoid is enumerated rather than
 * listed.
 *
 * REGENERATION PATH, per §6r: `rebake_role_wardrobe_blender_only.py` on the tracked
 * `*.anny_base.obj` bases. Do NOT run full `orchestrate_character` — without the `anny` package it
 * silently emits ~0.8 MB stub GLBs that pass file checks. The six humanoids under
 * `apps/ui-xr/public/generated-humanoids/` are TRACKED and must be committed.
 *
 * REQUIRED, the observable half: re-capture `psych_suicidal_ideation_safety_v1` and
 * `ed_chest_pain_priority_v1` and say what the figures are wearing. Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write a fourth capture
 * script. After the first successful run, re-run it twice more with `FORCE_COLOR=1`.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: behind the open front ___ ; end of each sleeve ___ ; midriff ___ ;
 *                      closed-kind figures unchanged ___
 * and: CONTRACT_MET_VISUAL: reads_as_dressed | improved_still_exposed | still_bare | other:<text>
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * If satisfying a contract here will make the product visibly worse than before, say so in your
 * report and then satisfy it anyway. Naming it is not disobedience.
 *
 * SCOPE: whether something exists behind an open front and below a short cuff. Says NOTHING about
 * fabric, colour, drape, or whether the resulting outfit is clinically appropriate — that needs a
 * clinician. Says nothing about skin weights (#126) or room contents (#140).
 */

const load = async () => import("./open-front-underlayer.js") as Promise<Record<string, unknown>>;

type AssetLayering = {
  assetPath: string;
  /** From garment-hem-boundary's vocabulary: "open_front", "gown", "scrub", … */
  garmentKind: string;
  /**
   * True when a surface — a second garment mesh or a clothing material region on the body — spans
   * the anterior midline at chest height, so the torso is not bare behind the opening.
   */
  hasClosedUnderLayerAcrossMidline: boolean;
  /** Triangles of whatever provides that closure. Zero when nothing does. */
  underLayerTriangleCount: number;
  /** Outer garment keeps a genuine anterior opening — closing it is not the fix. */
  outerRetainsAnteriorOpening: boolean;
  /** Arm surface distal to the sleeve cuff that carries a clothing material region, as a fraction. */
  armBelowCuffClothedFraction: number;
  /** True when the garment has a cuff above the wrist at all — a long sleeve has nothing to expose. */
  hasShortSleeve: boolean;
  /** #121, #124 and #73's guarantees, for the counterweight. */
  shoulderSpannedByOneComponent: boolean;
  hemOverlapsPaintedLower: boolean;
  hasPaintedLowerRegion: boolean;
};

type Inspect = () => Promise<{ assets: AssetLayering[] }>;

/**
 * Most of the arm below a cuff should read as clothing OR the sleeve should be long. Deliberately
 * not 1.0 — a wrist and hand are meant to be skin.
 */
const MIN_ARM_BELOW_CUFF_CLOTHED = 0.6;

describe("an open front has something behind it (#103)", () => {
  it.fails("every open-front garment has a closed surface across the midline", async () => {
    // #73 removed painted torso clothing wherever a real garment exists. Correct for a closed top;
    // for an open cardigan it leaves the torso bare by construction. §6p, second instance.
    const mod = await load();
    const inspect = mod["inspectOpenFrontUnderLayer"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.assets.length, "no shipped humanoids were inspected").toBeGreaterThan(0);

    const bare: string[] = [];
    for (const a of report.assets) {
      if (a.garmentKind !== "open_front") continue;
      if (!a.hasClosedUnderLayerAcrossMidline) {
        bare.push(`${a.assetPath}: open front with nothing behind it (${a.underLayerTriangleCount} tris)`);
      }
    }
    expect(bare, `open fronts showing bare torso:\n${bare.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("a short sleeve does not end at bare arm", async () => {
    // Kills the cheap satisfaction of the first contract in the adjacent region: closing the torso
    // while the arm below the cuff stays unpainted leaves the same defect one limb over.
    const mod = await load();
    const inspect = mod["inspectOpenFrontUnderLayer"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const exposed: string[] = [];
    for (const a of report.assets) {
      if (!a.hasShortSleeve) continue;
      if (a.armBelowCuffClothedFraction < MIN_ARM_BELOW_CUFF_CLOTHED) {
        exposed.push(
          `${a.assetPath}: only ${(a.armBelowCuffClothedFraction * 100).toFixed(0)}% of the arm below `
          + `the cuff reads as clothing`,
        );
      }
    }
    expect(exposed, `sleeves ending at bare arm:\n${exposed.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("the open silhouette and #121/#124/#73 all survive (COUNTERWEIGHT)", async () => {
    // Three cheap satisfactions, each of which has already happened once in this area: close the
    // front so there is nothing to cover (#46's distinguisher), pull the garment off the shoulder
    // (#121), or delete the lower paint so nothing has to meet (#73).
    const mod = await load();
    const inspect = mod["inspectOpenFrontUnderLayer"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const a of report.assets) {
      expect(a.shoulderSpannedByOneComponent, `${a.assetPath} lost #121's shoulder coverage`).toBe(true);
      expect(a.hemOverlapsPaintedLower, `${a.assetPath} lost #124's hem overlap`).toBe(true);
      expect(a.hasPaintedLowerRegion, `${a.assetPath} lost #73's painted lower clothing`).toBe(true);
      if (a.garmentKind === "open_front") {
        expect(a.outerRetainsAnteriorOpening, `${a.assetPath} closed the front instead of layering`).toBe(true);
      }
    }
  }, 900_000);
});
