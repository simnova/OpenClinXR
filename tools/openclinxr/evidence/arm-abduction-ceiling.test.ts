import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#117) — standing arms hang, but abducted. Wrists sit 1.5–2× further from the
 * body than a resting arm does.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #91's vertical hang must survive. It is `it.fails`
 * only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * READ THIS FIRST: WHAT THIS CONTRACT DOES NOT CLAIM
 *
 * It does not claim to prove the arms look natural. A research round was explicit that "reads as a
 * natural resting arm" is not machine-checkable — silhouette, elbow stack, hand-versus-thigh and
 * garment occlusion all matter and no scalar captures them. Six gates in this repo have already
 * passed on the defect they were written to catch, and #91's own drop floor was one of them: it went
 * green while the figures still read wrong.
 *
 * So this contract bounds the ABSURD and nothing more. It says "not a T-plank, and not abducted far
 * outside the shoulders". **The pixel grade closes the issue, and it is mine.** If you satisfy these
 * and the figures still do not read as arms at the sides, SAY SO — that is a successful report, not a
 * failure, and it is more useful to me than a tuned number.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT, AND WHERE THE BOUND COMES FROM
 *
 * Live, post-#91, 28 standing arm records across the shipped bank:
 *
 *   | measure                | observed      | target band     | direction        |
 *   |------------------------|---------------|-----------------|------------------|
 *   | shoulder→wrist drop    | 0.325 – 0.485 | ≥ 0.25          | higher is better |
 *   | wrist lateral offset   | 0.309 – 0.452 | ≤ 1.3 × halfSW  | **lower** is better |
 *
 * `halfSW` is HALF THE LIVE SHOULDER SPAN of that same figure — `0.5 × |shoulderL.worldX −
 * shoulderR.worldX|` — not a constant. That is deliberate and it is the whole design:
 *
 *   - Anthropometric rest posture is arms hanging at the sides, palms toward the thighs (the standing
 *     posture used for NHANES-class measurement). Biacromial breadth for adults runs roughly
 *     0.32–0.41 m, so half of it — the shoulder joint's own offset from the mid-line — is about
 *     0.16–0.21 m. A wrist hanging beside the body sits near that, plus a little clearance.
 *   - The figures here measure 0.309–0.452 m. That is 1.5–2× a half-shoulder hang.
 *   - Expressing the bound as a MULTIPLE of the figure's own shoulder span makes the ~1.25 m child
 *     scale automatically. An absolute metre cannot do that, and my last two thresholds were absolute.
 *
 * **There is no published table saying "a wrist must be 0.22 m from the mid-line."** Anyone offering
 * one is inventing the same way my 0.25 m drop floor was invented. The multiple is derived from
 * shoulder geometry, which IS tabulated, and it is stated here so it can be argued with.
 *
 * A-POSE IS A BIND CONVENTION, NOT A RESTING POSE. Arms 30–45° down from horizontal is a rigging
 * compromise for shoulder skinning. Do not treat it as the target for a standing clinical figure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHERE THE SPLAY LIVES — measured, do not go hunting
 *
 * `apps/ui-xr/src/clinical-idle-posture.ts:41-47` carries `z ≈ ±0.74` abduction on `upper_armL/R`,
 * and its own header describes that as the patient path measuring ~0.43 m lateral. **This is #91's
 * own map**, chosen deliberately, and it is the residual.
 *
 * The role-specific maps are NOT the target for adult standing figures — #91 stripped their arm
 * entries and left head/root only (`main.ts:4541-4544`, `:4577-4578`, `:4591-4593`, `:4606-4608`).
 * Peds asthma still overwrites arms to put hands near the chest (`:4550-4565`); that is intentional
 * distress and must not be flattened into a generic hang.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DO NOT CALIBRATE k ON THE CURRENT POSE. That would enshrine the thing being fixed. k = 1.3 is
 * derived from shoulder geometry above, not fitted to what the assets currently do. If you believe it
 * is wrong, argue from anatomy or from a human-graded pose — not from what makes the suite pass.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - How shoulder span is measured when a rig has clavicles as well as upper arms.
 *  - Whether reducing `z` alone gets there, or whether elbow flexion is needed so the arm does not
 *    read as a straight stick angled inward.
 *  - Whether peds asthma is exempted explicitly or its hands-near-chest pose already satisfies the
 *    ceiling. Measure before exempting.
 *  - Whether the seated figures are brought along. They measured ~0.63–0.66 m lateral after #91 —
 *    WORSE than standing — and the counterweight only protects their vertical drop. If you fix them
 *    too, say so; if you leave them, say that.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) caps abduction and is satisfiable by dropping the arms straight down through the torso. (2)
 * forbids that with a floor derived the same way — a wrist inside half the shoulder span is inside
 * the body. (3) is #91's guarantee, green today, and forbids buying either by returning to a plank.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectArmAbduction()`. What must not change:
 * the numbers come from the LIVE scene after the render loop has advanced, via the existing portless
 * probe, and both bounds scale off each figure's own shoulder span.
 *
 * REQUIRED, the observable half: re-capture psych and peds fever and state what the arms look like.
 *
 * IF ANY PROOF IN THIS BRIEF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE,
 * OR ASSERTS THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT. A vacuous proof is my
 * defect exactly as a broken one is — the last slice had one and nobody told me.
 *
 * IN-SCOPE VISUAL VERDICT required: "in psych the standing figures' arms ___". Separately name any
 * out-of-scope wrongness — the object and what it looks like, not "deformed".
 *
 * SCOPE: how far a standing figure's wrists sit from its body. Says NOTHING about whether the pose
 * reads as natural — that is my pixel grade — nor about hands, fingers, or garments.
 */

const load = async () => import("./arm-abduction-ceiling.js") as Promise<Record<string, unknown>>;

type ArmAbduction = {
  scenarioId: string;
  actorId: string;
  posture: string;
  side: string;
  /** Half the live shoulder span of THIS figure: 0.5 * |shoulderL.worldX - shoulderR.worldX|. */
  halfShoulderSpanMeters: number;
  wristLateralOffsetMeters: number;
  shoulderWorldY: number;
  wristWorldY: number;
  framesAdvanced: number;
};
type Inspect = () => Promise<{ scenarios: string[]; arms: ArmAbduction[] }>;

/** Derived from shoulder geometry, NOT fitted to the current pose. See the header. */
const MAX_ABDUCTION_RATIO = 1.3;
/** A wrist inside half the shoulder span is inside the body. */
const MIN_ABDUCTION_RATIO = 0.5;
/** #91's guarantee. */
const MIN_SHOULDER_TO_WRIST_DROP_METERS = 0.25;

const standing = (arms: ArmAbduction[]) => arms.filter((a) => a.posture === "standing");

describe("standing arms hang beside the body, not abducted (#117)", () => {
  // ## FIXED (#117) — clinical-idle upper_arm |z| 0.74→1.12 (hang-from-T toward side rest).
  // Pre-fix standing ratio 2.14–2.29; post-fix psych+peds fever 1.10–1.25 (≤1.3). Diagnosis above
  // is immutable. k=1.3 was not fitted to the pose.
  it("no standing wrist sits further out than 1.3x the figure's half shoulder span", async () => {
    // Post-#91 the range is 0.309-0.452m absolute, which is 1.5-2x a half-shoulder hang. The bound is
    // relative so the child scales with it.
    const mod = await load();
    const inspect = mod["inspectArmAbduction"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const arms = standing(report.arms);
    expect(arms.length, "no standing arms were measured").toBeGreaterThan(0);

    const abducted: string[] = [];
    for (const a of arms) {
      expect(a.framesAdvanced, `${a.actorId} measured before the render loop advanced`).toBeGreaterThan(0);
      expect(a.halfShoulderSpanMeters, `${a.actorId} reported no shoulder span`).toBeGreaterThan(0);
      const ratio = a.wristLateralOffsetMeters / a.halfShoulderSpanMeters;
      if (ratio > MAX_ABDUCTION_RATIO) {
        abducted.push(
          `${a.scenarioId}/${a.actorId}.${a.side} ratio ${ratio.toFixed(2)} `
          + `(${a.wristLateralOffsetMeters.toFixed(3)}m / halfSpan ${a.halfShoulderSpanMeters.toFixed(3)}m)`,
        );
      }
    }
    expect(abducted, `wrists abducted beyond the shoulders:\n${abducted.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  // ## FIXED (#117) — counterweight to the ceiling: wrists stay ≥0.5× halfSpan (not through torso).
  it("no standing wrist is pulled inside the body", async () => {
    // Kills the cheap satisfaction of the first contract: rotating the arms inward until the wrists
    // pass through the torso would clear any ceiling.
    const mod = await load();
    const inspect = mod["inspectArmAbduction"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const inside = standing(report.arms).filter(
      (a) => a.wristLateralOffsetMeters / a.halfShoulderSpanMeters < MIN_ABDUCTION_RATIO,
    );
    expect(
      inside.map((a) => `${a.scenarioId}/${a.actorId}.${a.side} ratio ${(a.wristLateralOffsetMeters / a.halfShoulderSpanMeters).toFixed(2)}`),
      "wrists pulled inside the torso",
    ).toHaveLength(0);
  }, 1_800_000);

  // ## FIXED (#117) — #91 drop floor still holds after abduction was reduced (module now present).
  it("#91's vertical hang survives (COUNTERWEIGHT — green today)", async () => {
    // Bringing the arms in must not put them back up. #91 took the minimum standing drop from 0.232
    // to 0.325.
    const mod = await load();
    const inspect = mod["inspectArmAbduction"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const arms = standing(report.arms);
    expect(arms.length, "no standing arms were measured").toBeGreaterThan(0);
    for (const a of arms) {
      expect(
        a.shoulderWorldY - a.wristWorldY,
        `${a.scenarioId}/${a.actorId}.${a.side} lost #91's hang`,
      ).toBeGreaterThan(MIN_SHOULDER_TO_WRIST_DROP_METERS);
    }
  }, 1_800_000);
});
