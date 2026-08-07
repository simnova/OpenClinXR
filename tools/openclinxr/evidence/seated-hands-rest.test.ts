import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#119) — a seated figure's hands float out beside the chair instead of resting on
 * its thighs.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #87's seated pelvis plant and #91's vertical hang must
 * survive. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * HONEST SIZE: this is a SMALL slice and I am not dressing it up
 *
 * Today exactly one actor is seated — the primary patient in `telehealth_diabetes_health_literacy_v1`.
 * Everything else in the bank stands. So this is two arms, one station. I am dispatching it at that
 * size rather than inflating it, because the alternative is inventing scope, which has cost this
 * project real cycles.
 *
 * What makes it worth doing anyway: the predicate is NEW (nothing here measures hand-to-body contact),
 * and the contract enumerates seated actors dynamically, so the next station that seats someone is
 * covered without a second slice. That enumeration property is the single thing that has made fixes
 * here generalise while per-station fixes did not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE STANDING FIX DOES NOT TRANSFER, AND A PEER ROUND TALKED ME OUT OF SHIPPING IT
 *
 * #117 bounded a STANDING wrist's lateral offset to ≤ 1.3 × the figure's half shoulder span, and it
 * worked — 2.14–2.29 → 1.09–1.26, and the pixels now read as arms at the sides.
 *
 * I proposed applying the same ratio to seated figures. **Do not.** A seated rest is a CONTACT problem,
 * not a hang problem:
 *
 *   - Rest for a chair with no armrests — which is what `station-chair.ts` builds — is hands on the
 *     thighs or in the lap. Ergonomic guidance puts forearms on armrests where they exist and the
 *     hands in the lap where they do not.
 *   - Seated thighs are horizontal in front of the pelvis, so resting hands land FORWARD of the trunk,
 *     on the thigh. A lateral-only measure cannot see that axis at all.
 *   - So a figure could clear a lateral ceiling with both arms hanging straight down beside the chair
 *     and satisfy the standing contract completely. That is not how anyone sits.
 *
 * Note the trap in the sources: the anthropometric "sitting" posture — erect, arms hanging free — is a
 * MEASUREMENT pose for calipers, not a description of resting. Do not anchor to it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree
 *
 * `seated-pose.ts:64-68` sets `upper_armL/R { x: -55°, z: ±10° }` and `forearmL/R { x: 45° }`. Those
 * keys are UNDOTTED and the runtime scene graph is undotted, so they DO apply — I checked, this is not
 * a dead-key case. The pose is hang-ish with mild flexion and **no thigh target at all**. It is
 * open-loop: absolute eulers with nothing closing the loop on where the hand ends up.
 *
 * Result: seated wrists measure **~0.63–0.66 m lateral** — worse than standing figures were before
 * either #91 or #117.
 *
 * #91 moved these entries from ±30°/±12° to −55°/±10° and its own retro named why that did not land:
 * *"without a seated world-anchor"*.
 *
 * THE ANCHOR IS THE THIGH, NOT THE SEAT. The seat surface already owns the pelvis plant (#87). Hands
 * rest on the thigh segment. `thighL` / `thighR` are live bones in this rig.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ELBOW FLEXION IS REQUIRED, AND ITS ABSENCE IS THE CHEAP FIX I AM KILLING
 *
 * A nearly straight arm cannot put a hand on a mid-thigh from a seated shoulder without shoulder
 * contortion that looks worse than the current pose. Contract (2) therefore requires the elbow to be
 * genuinely bent — shoulder, elbow and wrist not collinear. Without it, "rotate the whole stick
 * inward until the wrist is near the thigh" passes contract (1) and looks wrong.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CONTRACT DOES NOT CLAIM
 *
 * Same as #117, and the research round said it again for seated: a gate can bound the absurd — hands
 * not floating far from the body, elbow not a straight stick. It CANNOT prove "reads as a seated
 * person at rest". **The pixel grade closes this and it is mine.** If you satisfy these and the figure
 * still looks wrong, say so — that is a successful report.
 *
 * Report the verdict as one of exactly these, so it cannot be softened into prose:
 *     CONTRACT_MET_VISUAL: still_wrong | improved_not_natural | reads_at_rest | other:<free text>
 * A previous worker compressed "not clean, arms improved" into softer language precisely because the
 * product had moved, and I could not tell from the report which of these it meant.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether the arms are solved iteratively against a thigh target or authored as eulers that happen
 *    to land there. Open-loop eulers are what failed twice; that is a reason to be suspicious of a
 *    third set, not a prohibition.
 *  - Where on the thigh the hands go — hip end, mid-thigh, toward the knee. This changes how the pose
 *    reads and no source settles it.
 *  - Whether `seated-pose.ts` keeps its FOUR DEAD DOTTED KEYS (`thigh.L`, `thigh.R`, `shin.L`,
 *    `shin.R`). The map has both dotted and undotted leg entries; the runtime is undotted, so the
 *    dotted four never match. Removing them is cleanup and is NOT the fix — if you remove them, prove
 *    the legs are unchanged.
 *  - Whether the lateral ratio from #117 is kept as a secondary anti-splay bound for seated figures or
 *    dropped. It is necessary-but-insufficient here.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands hands near the thighs and is satisfiable by a straight arm swung inward. (2) forbids
 * that by requiring a bent elbow. (3) is green today — #87 planted the seated pelvis at a 0.002 m gap
 * with feet on the floor, and #91/#117 gave standing figures their hang; a change to the shared
 * posture path must cost neither.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectSeatedHandRest()`. What must not change:
 * seated actors are enumerated from what the runtime actually seats rather than a hardcoded id, the
 * numbers come from the LIVE scene after the render loop has advanced, and distances are relative to
 * the figure's own limb lengths rather than absolute metres — my absolute thresholds have failed twice.
 *
 * REQUIRED, the observable half: re-capture telehealth and state what the seated figure's hands are
 * doing.
 *
 * IF ANY PROOF HERE CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: where a seated figure's hands are. Says NOTHING about whether the sit is clinically
 * appropriate — that needs a clinician — nor about the chair, the garments, or standing figures.
 */

const load = async () => import("./seated-hands-rest.js") as Promise<Record<string, unknown>>;

type SeatedHand = {
  scenarioId: string;
  actorId: string;
  posture: string;
  side: string;
  /** Shortest world distance from the wrist to this side's thigh bone segment. */
  wristToThighMeters: number;
  /** The figure's own upper-arm + forearm length, so the bound is relative. */
  armLengthMeters: number;
  /** Angle at the elbow. 180 degrees is a straight stick. */
  elbowAngleDegrees: number;
  framesAdvanced: number;
};
type Inspect = () => Promise<{ seatedScenarios: string[]; hands: SeatedHand[] }>;

/** A hand resting on a thigh is within a fraction of an arm length of it. */
const MAX_WRIST_TO_THIGH_RATIO = 0.25;
/** A resting seated arm is visibly bent. 180 is collinear. */
const MAX_ELBOW_ANGLE_DEGREES = 160;

describe("a seated figure rests its hands on its thighs (#119)", () => {
  it("every seated wrist rests near its own thigh", async () => {
    // ## FIXED (#119): iterative thigh-target rest after open-loop seed in seated-pose.ts.
    // Pre-fix: wrist→thigh ratio ~0.99 (0.57 m on a 0.58 m arm), lateral ~0.63–0.66 m.
    // Post-fix: ratio ~0.10, elbow ~85°, hands on thighs for telehealth seated patient.
    // Seated wrists currently measure ~0.63-0.66m lateral with no thigh target at all. The bound is a
    // fraction of the figure's own arm length, not a metre — absolute thresholds have failed twice.
    const mod = await load();
    const inspect = mod["inspectSeatedHandRest"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.hands.length, "no seated hands were measured — is anything seated?").toBeGreaterThan(0);

    const floating: string[] = [];
    for (const h of report.hands) {
      expect(h.framesAdvanced, `${h.actorId} measured before the render loop advanced`).toBeGreaterThan(0);
      expect(h.armLengthMeters, `${h.actorId} reported no arm length`).toBeGreaterThan(0);
      const ratio = h.wristToThighMeters / h.armLengthMeters;
      if (ratio > MAX_WRIST_TO_THIGH_RATIO) {
        floating.push(
          `${h.scenarioId}/${h.actorId}.${h.side} wrist ${h.wristToThighMeters.toFixed(3)}m from thigh `
          + `(${(ratio * 100).toFixed(0)}% of a ${h.armLengthMeters.toFixed(3)}m arm)`,
        );
      }
    }
    expect(floating, `seated hands floating away from the thighs:\n${floating.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  it("the elbow is bent, not a straight stick swung inward", async () => {
    // ## FIXED (#119): elbow ceiling in restSeatedHandsOnThighs (≤155°) keeps arms bent.
    // Pre-fix ambient was already ~135°; the constraint prevents the cheap straight-stick win.
    // Kills the cheap satisfaction of the first contract. A straight arm rotated inward puts the wrist
    // near the thigh and looks worse than the pose it replaced.
    const mod = await load();
    const inspect = mod["inspectSeatedHandRest"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const straight = report.hands.filter((h) => h.elbowAngleDegrees > MAX_ELBOW_ANGLE_DEGREES);
    expect(
      straight.map((h) => `${h.scenarioId}/${h.actorId}.${h.side} elbow ${h.elbowAngleDegrees.toFixed(0)}deg`),
      "seated arms are straight sticks",
    ).toHaveLength(0);
  }, 1_800_000);

  it("standing figures keep #117's hang (COUNTERWEIGHT — green today)", async () => {
    // ## FIXED (#119): module present; standing clinical-idle hang is untouched by seated-pose.
    // seated-pose and clinical-idle share a frame loop and the same bones. #117 brought every standing
    // wrist inside 1.3x its half shoulder span; reaching for the thighs must not cost that.
    const mod = await load();
    const inspectStanding = mod["inspectStandingAbductionForCounterweight"] as
      | (() => Promise<{ arms: { scenarioId: string; actorId: string; side: string; ratio: number }[] }>)
      | undefined;
    expect(inspectStanding, "expose a way to re-check the standing guarantee").toBeTypeOf("function");

    const report = await inspectStanding!();
    expect(report.arms.length, "no standing arms were measured").toBeGreaterThan(0);
    const regressed = report.arms.filter((a) => a.ratio > 1.3);
    expect(
      regressed.map((a) => `${a.scenarioId}/${a.actorId}.${a.side} ratio ${a.ratio.toFixed(2)}`),
      "standing figures lost #117's hang",
    ).toHaveLength(0);
  }, 1_800_000);
});
