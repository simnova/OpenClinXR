import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#159) — the ED chest-pain patient lies FLAT because the stretcher has no head of
 * bed to recline against. A clinical consult puts the plausible staging at semi-Fowler ~30–45°, high
 * confidence on "not flat", medium on 30 versus 45.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — flat supine (#150/#153) must still work, and the
 * incline must not be chosen by weakening the contact checks. It is `it.fails` only because the
 * module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE HARNESS ALREADY ANSWERED THE FIRST QUESTION AND THE ANSWER WAS NO
 *
 * #163's isolated harness rendered the same body on the same deck at 0/15/30/45° in one contact
 * sheet, in 6.4 seconds. **The deck stays flat in all four frames.** The body rotates about a hip
 * pivot against nothing — at 30° it folds, at 45° it crumples. It reads as a patient collapsing, not
 * reclining.
 *
 * So the incline is not the thing to tune. **The bed has to articulate first.** That was predicted by
 * a peer round before the sweep and is now a picture.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE SEAM THAT WOULD MAKE THIS HALF-WORK — verified, and it is the whole reason this is L5
 *
 * `supine-pose.ts:238`:
 *
 *     const targetContactY = deckTopWorldY + torsoHalfThickness;
 *
 * **The plant is against a single flat scalar.** Hinge the mattress without changing this and the
 * back section lifts away from a body still planted at 0.55 — or the body crumples into the seat
 * section. Every single-column check would pass and the render would be worse than flat.
 *
 * This is the #67/#156 class again: **every column at once**, or it looks like a win and is not.
 *
 * `station-stretcher.ts:100-116` also fixes the **rails** at `STRETCHER_DECK_TOP_METERS + railH/2`
 * and the pillow with them. At 45° full-length rails may clip a raised torso and the pillow may sit
 * wrong. Say what you find; fixing both is in scope, pretending they are fine is not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ONE INCLINE SSOT. THE DECK LEADS, THE BODY FOLLOWS.
 *
 * A peer round was explicit and I agree: **the deck angle is the source of truth and the pose reads
 * from it.** One `inclineDeg`. If the body and the deck each carry their own angle they will desync —
 * a body at 45° on a deck at 30° is exactly the failure this slice exists to prevent.
 *
 * Order of operations: **stretcher API first** (named back/seat sections, incline on `userData`),
 * **then** the plant reads the live back plane, **then** the harness sweep. Not the other way round.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ONE HINGE IS THE RIGHT MODEL — AND SAY WHAT IT IS NOT
 *
 * Real beds articulate in multiple sections (back / seat / leg, Gatch). A **single head-of-bed hinge
 * at the hip line** is enough for "head of bed up" in a learner's view. Do **not** expand to three
 * hinges here.
 *
 * `claimScope`: staging incline. `notEvidenceFor`: trained-eye hospital-bed fidelity, multi-joint
 * articulation, clinical positioning correctness.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ANGLE IS NOT YOURS TO PICK, AND NOT MINE EITHER — IT COMES FROM THE SHEET
 *
 * A threshold in a contract becomes a design target (§7a), so this contract deliberately does **not**
 * name a target incline. Produce the sweep at 0/15/30/45° against the **articulating** deck and leave
 * the contact sheet for me to grade. The consult's own confidence between 30 and 45 was only medium;
 * the number should come from looking.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **How the incline reaches the pose.** A live query of the back section's world plane, or a value
 *    threaded through placement. The live query cannot desync; threading is simpler. **I lean live
 *    query** and I am not certain.
 *  - **Whether `ACTOR_POSTURES` changes.** A peer preferred `standing | seated | recumbent` with
 *    `recumbent.inclineDeg ∈ [0,45]` over a fourth opaque enum member. **This slice does not require
 *    it** — 0° must remain exactly today's supine behaviour either way. If you change the enum, say
 *    why and prove the 0° regression.
 *  - **What N is** in "torso axis within N° of the back plane". A peer suggested starting at 10–15°
 *    and calibrating from the sheet. Pick one, record what it admits, and say if the sheet says it is
 *    wrong.
 *  - **Rails and pillow at high incline.** Shorten, split, or follow the back section. Your call; say
 *    what you saw at 45° before deciding.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the deck actually articulate and the body follow it, and is satisfiable by rotating the
 * body to match a deck it is not touching. (2) forbids that by requiring contact — back against back
 * section, pelvis on seat section, no penetration. (3) is green today and forbids buying either by
 * regressing flat supine, which #150 and #153 landed and which the ED station uses right now.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectArticulatingHeadOfBed()`. What must not
 * change: angles are measured in WORLD space from the live scene after the render loop advances —
 * bind-relative eulers lie once the root is reoriented (§8s, which cost #153 half its discovery).
 *
 * CALIBRATION — `.openclinxr/evidence/issue-159/pre-fix.json` BEFORE any product edit: at each of
 * 0/15/30/45°, the back-section world angle (expected **0 at every incline** today), the torso axis
 * angle, and the gap between the body's back and the deck. **My prediction is that the deck angle
 * reads 0 at all four.** If it does not, STOP — the harness sheet and I are both wrong and I want to
 * know first.
 *
 * REQUIRED, the observable half: a SECOND contact sheet at 0/15/30/45° against the articulating deck,
 * via #163's harness. Do not write another capture script.
 *
 * IN-SCOPE VISUAL — answer EVERY line, FOR EACH of the four variants:
 *     deck_articulates:   yes | flat
 *     back_supported:     resting_on_deck | floating | penetrating
 *     pelvis_on_seat:     yes | no
 *     rails_clip_torso:   none | present
 *     pillow_position:    correct | wrong | not_visible
 *     reads_as:           reclining | collapsing | flat | other:<text>
 *
 * IF SATISFYING A CONTRACT HERE MAKES THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then
 * satisfy it anyway.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether the stretcher's head of bed raises and whether a supine body follows it. Says
 * NOTHING about which angle ships (mine, from the sheet), other stations, the ward bed, or clinical
 * positioning correctness.
 */

const load = async () => import("./articulating-head-of-bed.js") as Promise<Record<string, unknown>>;

type InclineSample = {
  /** Requested incline for this sample. */
  requestedDeg: number;
  /** Measured world angle of the deck's back section from horizontal. */
  backSectionWorldDeg: number;
  /** Measured world angle of the body's torso axis from horizontal. */
  torsoWorldDeg: number;
  /** Largest gap between the body's back surface and the back section, metres. Negative = inside. */
  backToDeckGapMeters: number;
  /** True when the pelvis rests on the seat section rather than in the air or inside it. */
  pelvisOnSeatSection: boolean;
  /** Rails intersecting the torso volume at this incline. */
  railsClippingTorso: boolean;
  /** Frames advanced before measuring — a pose read before the loop runs is the #153 defect. */
  framesAdvanced: number;
};

type Inspect = () => Promise<{
  samples: InclineSample[];
  /** Path to the contact sheet the orchestrator grades. */
  contactSheetPath: string;
  /** Deck sections the stretcher now exposes, by name. */
  deckSectionNames: string[];
}>;

/** Requested and delivered deck angle must agree. Generous — this catches "did not move", not polish. */
const MAX_DECK_ANGLE_ERROR_DEG = 5;

/** Contact: the back may compress into the mattress a little; it may not float or sink through. */
const MAX_BACK_GAP_METERS = 0.06;
const MAX_BACK_PENETRATION_METERS = 0.04;

describe("the head of bed raises and the body follows it (#159)", () => {
  it.fails("the deck articulates to the requested incline", async () => {
    // #163's harness sweep showed the deck flat at all four inclines while the body rotated against
    // nothing. station-stretcher.ts builds one rigid mattress; there is no back section to raise.
    const mod = await load();
    const inspect = mod["inspectArticulatingHeadOfBed"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.samples.length, "fewer than four inclines were sampled").toBeGreaterThan(3);
    expect(report.deckSectionNames.length, "the deck is still one rigid section").toBeGreaterThan(1);

    const wrong: string[] = [];
    for (const s of report.samples) {
      expect(s.framesAdvanced, `incline ${s.requestedDeg}: measured before the render loop advanced`)
        .toBeGreaterThan(0);
      const err = Math.abs(s.backSectionWorldDeg - s.requestedDeg);
      if (err > MAX_DECK_ANGLE_ERROR_DEG) {
        wrong.push(
          `requested ${s.requestedDeg}°, back section measured ${s.backSectionWorldDeg.toFixed(1)}°`,
        );
      }
    }
    expect(wrong, `the deck did not reach the requested incline:\n${wrong.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  it.fails("the body rests ON the raised deck, not against air", async () => {
    // Kills the cheap satisfaction of the first contract: rotate the mattress and the body
    // independently so both report the right angle while the body floats above the back section or
    // sinks into the seat. supine-pose.ts:238 plants against a single flat scalar today, so this is
    // the seam that would make the fix half-work.
    const mod = await load();
    const inspect = mod["inspectArticulatingHeadOfBed"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const wrong: string[] = [];
    for (const s of report.samples) {
      const err = Math.abs(s.torsoWorldDeg - s.backSectionWorldDeg);
      if (err > 15) {
        wrong.push(
          `incline ${s.requestedDeg}°: torso at ${s.torsoWorldDeg.toFixed(1)}° against a deck at ${s.backSectionWorldDeg.toFixed(1)}°`,
        );
      }
      if (s.backToDeckGapMeters > MAX_BACK_GAP_METERS) {
        wrong.push(`incline ${s.requestedDeg}°: back floats ${s.backToDeckGapMeters.toFixed(3)}m above the deck`);
      }
      if (s.backToDeckGapMeters < -MAX_BACK_PENETRATION_METERS) {
        wrong.push(`incline ${s.requestedDeg}°: back sinks ${(-s.backToDeckGapMeters).toFixed(3)}m into the deck`);
      }
      if (!s.pelvisOnSeatSection) {
        wrong.push(`incline ${s.requestedDeg}°: pelvis is not on the seat section`);
      }
    }
    expect(wrong, `the body is not resting on the deck:\n${wrong.join("\n")}`).toHaveLength(0);

    expect(report.contactSheetPath.length, "no contact sheet was produced for grading").toBeGreaterThan(0);
  }, 1_800_000);

  it.fails("flat supine still works exactly as it does today (COUNTERWEIGHT)", async () => {
    // #150 and #153 landed flat supine and the ED station uses it right now. An articulating deck
    // that regresses 0° trades a working state for an unproven one, and the angle has not been
    // chosen yet — 0° may well remain what ships.
    const mod = await load();
    const inspect = mod["inspectArticulatingHeadOfBed"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const flat = report.samples.find((s) => s.requestedDeg === 0);
    expect(flat, "0° was not sampled — the regression case is the one that must not break").toBeDefined();

    expect(Math.abs(flat!.backSectionWorldDeg), "the deck is not flat at 0°").toBeLessThanOrEqual(MAX_DECK_ANGLE_ERROR_DEG);
    expect(Math.abs(flat!.torsoWorldDeg), "the body is not flat at 0°").toBeLessThanOrEqual(15);
    expect(flat!.pelvisOnSeatSection, "the pelvis left the deck at 0°").toBe(true);
    expect(flat!.railsClippingTorso, "rails clip the torso even at 0°").toBe(false);
  }, 1_800_000);
});
