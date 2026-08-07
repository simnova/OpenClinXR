import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#153) — the supine ED patient's arms read as rotated rather than posed, and his
 * head hangs past the pillow. #150's contracts pass because an AABB cannot see this: a supine body
 * with its arms above its head has the same bounding box as one with arms at its sides.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #150's plant and recumbency, and today's floor-contact
 * exemption, must all survive. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE IS TRACED. Do not re-derive it; DO verify it before trusting me.
 *
 * **The limb map is not the problem.** `supine-pose.ts:51-55` ALREADY sets
 * `upper_armL z = -70°` / `upper_armR z = +70°` under the comment "Arms along sides — not T-pose
 * plank that punches through rails". The intent is correct and already written.
 *
 * **Two composition defects sit on top of it:**
 *
 * 1. **Load-time order.** `main.ts:6972` applies the supine pose, then `main.ts:7104` calls
 *    `applyGeneratedHumanoidClinicalIdlePosture(humanoid)` and `:7105`
 *    `applyGeneratedHumanoidRoleSpecificPosture(...)` — guarded ONLY by
 *    `!cleanSourceComparatorCapture`, **not by posture**. The standing arm hang overwrites the
 *    recumbent map at load. The per-frame path at `:8140-8150` guards correctly and re-applies, so
 *    this is a load-time-only defect that anything capturing before or between frames will see.
 *
 * 2. **The map is not a complete override.** It names 16 bones —
 *    `pelvis spine chest thighL thighR shinL shinR footL footR upper_armL upper_armR forearmL
 *    forearmR handL handR head` — and the standing idle also writes **`neck`**, which supine never
 *    sets. So the standing neck angle survives on a recumbent figure. That is the head hanging past
 *    the pillow, and it needs no guess about angles.
 *
 * MEASURED by me on 2026-08-07 by diffing the bone names each path writes. Verify it; do not take it
 * as fact if the tree disagrees.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE WORLD POSITIONS, NOT EULERS
 *
 * A peer round's point and it is correct: eulers are bind-relative and lie once the root is
 * reoriented by `root.rotation.z = +π/2`. Measure where the wrist, elbow and head actually ARE in
 * world space after the reorientation, relative to the torso axis and the deck plane.
 *
 * `supine-patient-on-deck.ts` writes
 * `.openclinxr/evidence/supine-patient-on-deck/supine-patient-on-deck.json` today with posture,
 * world AABB, and deck penetration/clearance — and NOTHING per limb. Extend that inspector's fields
 * rather than writing a second one (§6k).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHERE MY JUDGEMENT STOPS, AND THIS IS A REAL LINE
 *
 * I can grade "those arms are not resting". I CANNOT specify correct anatomical angles, and neither
 * should you — inventing a degree table from taste is how #83 produced a figure with its chin on its
 * chest that passed every contract.
 *
 * So these contracts assert **staging**, not clinical validity: hands near the deck rather than near
 * the head, wrists inside the torso's own width, head at the pillow end. A peer round put the line
 * exactly there — reject absurd, do not invent anatomy. Clinical lying validity needs a clinician and
 * this slice does not claim it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * TWO GUESSES #150's WORKER MADE THAT YOU INHERIT — it named them in its own retro
 *
 *  - `torsoHalfThickness = 0.26`, tuned from two failed smoke runs (first floated 0.06, then sank),
 *    **not measured from the mesh**. If your work touches the plant, measure it instead of retuning.
 *  - `root.rotation.z = +π/2` for head → −X, read from the stretcher's pillow side with **no live
 *    probe of the figure's facing** before the first plant.
 *
 * Neither is necessarily wrong. Both are unverified, and if either turns out wrong that is a finding
 * worth more than the fix.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether the load-time fix guards the idle call by posture, or re-applies supine after it. The
 *    frame loop does the latter. Guarding is cleaner and touches a call site other postures use.
 *  - Whether `neck` joins `SUPINE_BONE_EULERS`, or the map gains a "reset every bone the standing
 *    path writes" step. The second is more robust and more invasive.
 *  - What "resting" means numerically for the wrist. I have deliberately NOT given you a number for
 *    the arm, only the shape of the assertion — say what you chose and what it is measured against.
 *  - Whether the legs need anything. Both graders said "slightly bent/elevated relative to a flat
 *    mattress" and neither of us measured it. It may be fine.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the hands rest near the deck rather than near the head, and is satisfiable by collapsing
 * the arms into the torso so the wrists clip through the ribs. (2) forbids that by requiring the
 * wrists to stay outside the torso volume and inside the deck rails. (3) is green today and forbids
 * buying either by breaking #150's plant, recumbency, or the floor-contact exemption.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectSupineLimbRest()`. What must not change:
 * measurements are world positions from the LIVE scene after the render loop has advanced — a pose
 * read before the first frame is exactly the defect under test.
 *
 * CALIBRATION — per-subject rows, written BEFORE any product edit (§8o).
 * `.openclinxr/evidence/issue-153/pre-fix.json` with, per actor: posture, and the world position of
 * head / neck / both shoulders / elbows / wrists / hips / knees / ankles, plus the deck top Y and the
 * torso axis. Produced by calling the CURRENT APIs while they are still wrong.
 *
 * | measure | expect pre-fix | target | direction |
 * |---|---|---|---|
 * | wrist Y above deck | HIGH (hand near the head) | near the deck | lower = better |
 * | wrist lateral offset from torso axis | unknown to me | inside the rails, outside the ribs | — |
 * | head position vs pillow end | past it | on it | — |
 * | neck angle source | the standing idle | the supine map | — |
 *
 * I have measured NONE of the numeric rows. If they come back different from what I predict, that is
 * data about my grade, not a reason to change the target — report it.
 *
 * REGENERATION: none. No asset is rebaked. Do NOT run `orchestrate_character` — without the `anny`
 * package it silently emits ~0.8 MB stub GLBs that pass file checks.
 *
 * SCOPE THE FIRST MEASUREMENT TO THE ED STATION ONLY (§8o). #150's worker ran the full bank for a
 * smoke test and named it as its largest avoidable cost. Sweep the bank only after the fix works.
 *
 * REQUIRED, the observable half: re-capture `ed_chest_pain_priority_v1`. Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write another capture script.
 * After the first successful run, re-run it twice more with `FORCE_COLOR=1` (§6i).
 *
 * A concurrent slice (#134) owns `tools/openclinxr/evidence/hm08-*` and `docs/madr/`. Do not touch
 * either.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace this with a sentence (§7y):
 *     arms:            resting | raised | out_from_body | clipping_torso
 *     hands:           near_deck | near_head | inside_body | not_visible
 *     head:            on_pillow | past_pillow | tilted | not_visible
 *     legs:            flat | bent | elevated
 *     still_on_deck:   yes | no
 *     other_actors:    unchanged | changed
 *
 * OUT-OF-SCOPE WRONGNESS you saw and are not fixing: name the body part or object and what it looks
 * like (§6m), even on the same body part. Known and not yours: bare feet, flat doll faces, a pale
 * patch on the patient's chest under the gown, rooms reading empty.
 *
 * IF SATISFYING A CONTRACT HERE MAKES THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then
 * satisfy it anyway. Naming it will not be read as refusing the work.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: where a supine figure's limbs and head end up. Says NOTHING about other stations' postures,
 * clinical validity of the resulting pose, garments (#147), or the body itself (#151).
 */

const load = async () => import("./supine-limb-rest.js") as Promise<Record<string, unknown>>;

type Vec3 = { x: number; y: number; z: number };

type SupineLimbFacts = {
  scenarioId: string;
  actorId: string;
  posture: string;
  /** World position of each landmark AFTER the render loop has advanced. */
  head: Vec3;
  neck: Vec3;
  wristL: Vec3;
  wristR: Vec3;
  elbowL: Vec3;
  elbowR: Vec3;
  /** Deck top Y of the support surface this actor rests on. */
  deckTopY: number;
  /** Torso long axis in world space, normalised — a supine body's is horizontal. */
  torsoAxis: Vec3;
  /** Half-width of the torso at chest height. Wrists inside this are clipping the ribs. */
  torsoHalfWidth: number;
  /** Lateral rail positions of the support surface, so "inside the rails" is measurable. */
  railHalfWidth: number;
  /** World position of the pillow end of the deck. */
  pillowEnd: Vec3;
  /** Which module last wrote the neck rotation — the standing idle or the supine map. */
  neckPoseSource: string;
  /** Frames advanced before measurement. Zero means the load-time defect is what was measured. */
  framesAdvanced: number;
};

type Inspect = () => Promise<{ actors: SupineLimbFacts[] }>;

const ED = "ed_chest_pain_priority_v1";

/** A resting hand is nearer the deck than the shoulder is. Deliberately generous. */
const MAX_WRIST_ABOVE_DECK_METERS = 0.35;

/** The head belongs at the pillow end, not beyond it. */
const MAX_HEAD_PAST_PILLOW_METERS = 0.08;

const dist = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("a supine figure's limbs rest rather than float (#153)", () => {
  it.fails("the hands rest near the deck and the head is on the pillow", async () => {
    // main.ts:7104 applies the standing clinical idle after the supine map with no posture guard, and
    // the map never names `neck`, so the standing neck angle survives on a recumbent figure.
    const mod = await load();
    const inspect = mod["inspectSupineLimbRest"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const supine = report.actors.filter((a) => a.scenarioId === ED && a.posture === "supine");
    expect(supine.length, "no supine ED actor was measured in the live scene").toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const a of supine) {
      expect(a.framesAdvanced, `${a.actorId} measured before the render loop advanced`).toBeGreaterThan(0);

      for (const [label, w] of [["L", a.wristL], ["R", a.wristR]] as const) {
        const above = w.y - a.deckTopY;
        if (above > MAX_WRIST_ABOVE_DECK_METERS) {
          wrong.push(`${a.actorId}: wrist ${label} sits ${above.toFixed(3)}m above the deck`);
        }
      }

      const headPast = dist(a.head, a.pillowEnd);
      if (headPast > MAX_HEAD_PAST_PILLOW_METERS) {
        wrong.push(`${a.actorId}: head is ${headPast.toFixed(3)}m from the pillow end`);
      }
      if (!/supine/i.test(a.neckPoseSource)) {
        wrong.push(`${a.actorId}: neck rotation last written by "${a.neckPoseSource}", not the supine map`);
      }
    }
    expect(wrong, `supine limbs that are not resting:\n${wrong.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  it.fails("the arms are beside the torso, not inside it or through the rails", async () => {
    // Kills the cheap satisfaction of the first contract: driving the arms into the torso puts the
    // wrists near the deck and inside the ribs, which reads worse than the raised arm it replaces.
    const mod = await load();
    const inspect = mod["inspectSupineLimbRest"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const supine = report.actors.filter((a) => a.scenarioId === ED && a.posture === "supine");

    const wrong: string[] = [];
    for (const a of supine) {
      for (const [label, w] of [["L", a.wristL], ["R", a.wristR]] as const) {
        // Lateral offset from the torso long axis, measured in the deck plane.
        const lateral = Math.abs(w.z - a.head.z);
        if (lateral < a.torsoHalfWidth * 0.6) {
          wrong.push(
            `${a.actorId}: wrist ${label} is ${lateral.toFixed(3)}m from the torso axis — inside the ribs`,
          );
        }
        if (lateral > a.railHalfWidth) {
          wrong.push(
            `${a.actorId}: wrist ${label} is ${lateral.toFixed(3)}m out, past the rail at ${a.railHalfWidth.toFixed(3)}m`,
          );
        }
      }
    }
    expect(wrong, `arms that are not beside the torso:\n${wrong.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  it.fails("#150's plant and the floor-contact exemption survive (COUNTERWEIGHT)", async () => {
    // Changing the limb map can move the body's lowest vertex and re-open the float/sink loop #150's
    // worker spent its discovery budget on, or push the actor off the deck entirely.
    const mod = await load();
    const inspect = mod["inspectSupineLimbRest"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const supine = report.actors.filter((a) => a.posture === "supine");
    expect(supine.length, "no supine actor survived the change").toBeGreaterThan(0);

    for (const a of supine) {
      // Still lying down: the torso axis is horizontal, not vertical.
      expect(
        Math.abs(a.torsoAxis.y),
        `${a.actorId} is no longer recumbent — torso axis Y is ${a.torsoAxis.y.toFixed(3)}`,
      ).toBeLessThan(0.5);
      // Still on its deck rather than relocated.
      expect(
        Math.abs(a.head.y - a.deckTopY),
        `${a.actorId}'s head is ${Math.abs(a.head.y - a.deckTopY).toFixed(3)}m from the deck plane`,
      ).toBeLessThan(0.6);
    }

    const standing = report.actors.filter((a) => a.posture === "standing");
    expect(standing.length, "every actor was made supine").toBeGreaterThan(0);
  }, 1_800_000);
});
