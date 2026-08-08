import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#150) — the ED chest-pain patient stands in front of a stretcher that is fully
 * built, and his left shin clips through the deck. `"supine"` is in the posture vocabulary and has
 * no implementation.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the standing actors and #81's seated telehealth
 * patient must both survive. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT — GRADED FROM PIXELS, THEN TRACED. Do not re-derive the trace; DO verify the pose.
 *
 * `.openclinxr/evidence/ui-xr-environment-room/latest/ed_chest_pain_priority_v1-room.png`:
 * the stretcher is built, well placed, white deck with red rails. Robert Hayes — "it feels heavy,
 * like someone is sitting on my chest" — stands in front of it, barefoot, arms out, left shin
 * intersecting the deck.
 *
 * `packages/openclinxr/asset-registry/src/actor-posture.ts`
 *   `ACTOR_POSTURES = ["standing","seated","supine"]`            supine IS in the vocabulary
 *   `defaultPostureForEnvironmentSlot()` `:51-64`                returns "seated" ONLY for
 *       /telehealth/ + primary_patient. Everything else "standing".
 *   `clipBindingForPosture("supine")` `:93-97`                   returns STANDING_CLIP_NAME with
 *       the standing source.
 * `station-stretcher.ts:10` — "supine patient placement (out of scope for #97)"
 *
 * `grep supine apps/ui-xr/src/*.ts` returns two COMMENTS and nothing else. This is the
 * field-with-no-writer shape (§6z), and it is why 14 of 15 stations stand.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A PEER ROUND CORRECTED MY SCOPE TWICE. BOTH CORRECTIONS ARE LOAD-BEARING.
 *
 * **This is NOT a small copy of #81.** Seated is hip flex plus a root Y. Supine is a whole-body
 * reorientation along the bed axis, legs extended, head at the pillow end, plus a root translation
 * in XZ *and* Y onto the deck. `root.rotation.x = 90°` on a standing bind reads as a board and
 * clips the rails. It needs a real recumbent pose module, not an enum arm and one euler.
 *
 * **#81 does not forbid the root translation you need.** `SEATED_HEIGHT_OWNERSHIP` forbids
 * CLIP-owned height (Sitting_Idle carries ~0.33 Y of pelvis translation). Supine must own its own
 * world plant, exactly as `seatedActorWorldPosition` does. Strip the clip's translation, keep yours.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ED ONLY. THIS IS DELIBERATE AND I DO NOT WANT IT WIDENED.
 *
 * Measured across the shipped bundles:
 *   ED chest pain v1/v2   `equipmentPlacements: []` — the support surface is the shell's
 *                         `stretcher` FIXTURE, not equipment. `isStretcherSlotId`
 *                         (`station-stretcher.ts:131`) builds it.
 *   stepdown sepsis       equipment is `monitor_equipment` + `iv_pump_equipment`. **No bed.**
 *                         Supine there has nothing to lie on. That is a separate slice and I have
 *                         filed it rather than folding it in.
 *   the other twelve      take `shell()`'s default `primary_patient` marker slot.
 *
 * **Do NOT make "any station with furniture" supine.** A patient standing beside a bed is a valid
 * clinical scene; an ambulatory patient is not a defect. Supine is resolved for the ED bay's
 * `primary_patient` on a stretcher, and everyone else keeps what they have.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE TRAP THE PEER FOUND, AND IT WOULD HAVE COST A CYCLE
 *
 * `stretcher.userData.seatHeightMeters = STRETCHER_DECK_TOP_METERS` (0.55, `station-stretcher.ts:23`)
 * is a SEATED-height alias on a supine surface. `seatedVerticalOffsetForSeatHeight`
 * (`actor-posture.ts:120-124`) is `seatHeight - 0.03` — hip-on-chair math that assumes hip flex folds
 * the legs. **Torso-on-deck is a different quantity.** Reusing that helper floats or sinks the
 * figure. Derive the supine plant from the deck top and the body's own thickness; do not call it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - How the recumbent pose is produced. A procedural bone map like `clinical-idle-posture.ts`, a
 *    new clip, or a root reorientation plus a limb pass. I do not know which is robust on this
 *    armature and finding out is the first thing to do.
 *  - Which end of the deck is the head. The stretcher's own geometry has an axis; read it rather
 *    than assuming, and put what you read in the report.
 *  - Whether `clipBindingForPosture("supine")` gets its own clip name or keeps returning the
 *    standing one. It currently lies; if you leave it lying, say why.
 *  - Whether the ED default is resolved in `defaultPostureForEnvironmentSlot` or declared per
 *    scenario. Env-rule is fewer edits; declared is more honest. I lean declared and am not certain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the ED patient lie on the deck rather than stand through it, and is satisfiable by
 * rotating the root 90° into a rigid plank. (2) forbids that by requiring the pose to read as a
 * recumbent body — head at one end, legs extended, no limb inside the deck volume. (3) is green
 * today and forbids buying either by making everyone supine or by breaking #81's seated telehealth
 * patient.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectSupinePatientOnDeck()`. What must not
 * change: measurements come from the LIVE scene graph after the scene builds — the defect is where
 * a body ends up relative to geometry, and neither the descriptor nor the Blender script can show
 * that. Stations are enumerated from what ships.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * CALIBRATION — write the pre-fix artifact BEFORE any product edit (§7p)
 *
 * `.openclinxr/evidence/issue-150/pre-fix.json`, from the CURRENT APIs while they are still wrong,
 * carrying every actor's posture, world AABB, and deck penetration depth.
 *
 * | measure | expect pre-fix | target | direction |
 * |---|---|---|---|
 * | ED patient posture | "standing" | "supine" | — |
 * | body long axis vs world Y | near-vertical | near-horizontal | — |
 * | min body Y above deck top (0.55) | negative (through it) | >= 0 | higher = better |
 * | limb volume inside deck AABB | non-zero | 0 | lower = better |
 *
 * I have NOT measured the last two. If they come back different from what I predict, that is data
 * about my grade, not a reason to change the target — report it.
 *
 * REGENERATION: none. No asset is rebaked; this is runtime placement and pose. Do NOT run
 * `orchestrate_character` — without the `anny` package it silently emits ~0.8 MB stub GLBs.
 *
 * REQUIRED, the observable half: re-capture `ed_chest_pain_priority_v1`. Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write another capture
 * script. After the first successful run, re-run it twice more with `FORCE_COLOR=1` (§6i).
 *
 * A concurrent slice (#147) owns `automate_blender.py` and the humanoid GLBs and will re-capture
 * the PSYCH room. Do not touch either, and do not be surprised by a psych png you did not write.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace this with a sentence (§7y):
 *     ed_patient_posture:   supine | seated | standing
 *     on_the_deck:          on | floating | sunk | beside
 *     head_end:             correct | at_the_foot | not_visible
 *     limbs_through_rails:  none | present
 *     other_actors:         unchanged | changed
 *     figures_intact:       yes | no
 *
 * OUT-OF-SCOPE WRONGNESS YOU SAW AND ARE NOT FIXING: name the body part or object and what it looks
 * like (§6m). Do not compress it. Reporting it is not scope creep.
 *
 * IF SATISFYING A CONTRACT HERE MAKES THE PRODUCT VISIBLY WORSE, SAY SO IN YOUR REPORT — and then
 * satisfy it anyway. Naming it will not be read as refusing the work.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: where the ED patient's body is and how it is posed. Says NOTHING about stepdown's missing
 * bed (filed separately), fixture slot builders (#143), equipment (#140), garments (#147, #126), or
 * whether any other station should be supine.
 */

const load = async () => import("./supine-patient-on-deck.js") as Promise<Record<string, unknown>>;

type ActorPlacementFacts = {
  scenarioId: string;
  actorId: string;
  slotKind: string;
  posture: string;
  /** World AABB of the actor's rendered mesh. */
  bodyMin: { x: number; y: number; z: number };
  bodyMax: { x: number; y: number; z: number };
  /** Longest world axis of the body AABB — "x" | "y" | "z". A lying body is not tallest on Y. */
  longestAxis: string;
  /** Deepest penetration of the body into the support surface AABB, metres. 0 = clear. */
  deckPenetrationMeters: number;
  /** Deck top Y of the support surface this actor is assigned to, or null if none. */
  deckTopY: number | null;
  /** Lowest body point minus deck top. Negative = inside the deck. */
  clearanceAboveDeckMeters: number | null;
};

type Inspect = () => Promise<{ actors: ActorPlacementFacts[] }>;

const ED = "ed_chest_pain_priority_v1";

/**
 * A recumbent body's AABB is longer horizontally than vertically.
 * Flat supine (~0°) sits well under 0.6. A 30–45° semi-Fowler tip (#171) raises the
 * head and grows world-Y extent — 0.6 was a flat-deck threshold and rejected a real
 * inclined lie (measured ~0.68 at 30°). 0.9 still rejects a standing figure (~1.5+).
 */
const MAX_SUPINE_HEIGHT_TO_LENGTH = 0.9;

/**
 * Tolerance for a body resting on a surface rather than embedded in it.
 *
 * Geometry (issue-171/below-deck-vertices.json, pre-edit): pelvis/spine/chest plant
 * contacts sit +0.24 m above deckTop; only foot/hand bones and mesh around them
 * go below. After plant fix, skinned minY is lifted to within skin thickness of
 * the seat. 5 cm covers sole thickness under a foot bone on the deck — not a
 * 19 cm whole-body hang. A measurement of −0.19 MUST fail this gate.
 */
const MAX_PENETRATION_METERS = 0.05;

describe("the ED patient lies on the stretcher instead of standing through it (#150)", () => {
  it("the ED primary patient is supine and clear of the deck", async () => {
    // actor-posture.ts:51-64 returns "standing" for everything but telehealth, so the chest-pain
    // patient stands in front of a built stretcher with his shin inside the deck.
    const mod = await load();
    const inspect = mod["inspectSupinePatientOnDeck"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const patients = report.actors.filter(
      (a) => a.scenarioId === ED && a.slotKind === "primary_patient",
    );
    expect(patients.length, "no ED primary patient was evaluated in the live scene").toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const p of patients) {
      if (p.posture !== "supine") wrong.push(`${p.actorId}: posture is "${p.posture}"`);
      if (p.deckPenetrationMeters > MAX_PENETRATION_METERS) {
        wrong.push(`${p.actorId}: ${p.deckPenetrationMeters.toFixed(3)}m of body inside the deck`);
      }
    }
    expect(wrong, `the ED patient is not resting on the stretcher:\n${wrong.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the supine body reads as recumbent, not as a standing figure tipped over", async () => {
    // Kills the cheap satisfaction of the first contract: root.rotation.x = 90 clears the posture
    // string and the penetration check while rendering a rigid plank. A lying body's AABB is longer
    // horizontally than it is tall, and its lowest point sits at the deck, not below it.
    const mod = await load();
    const inspect = mod["inspectSupinePatientOnDeck"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const patients = report.actors.filter(
      (a) => a.scenarioId === ED && a.slotKind === "primary_patient",
    );

    const wrong: string[] = [];
    for (const p of patients) {
      const height = p.bodyMax.y - p.bodyMin.y;
      const length = Math.max(p.bodyMax.x - p.bodyMin.x, p.bodyMax.z - p.bodyMin.z);
      if (length <= 0) {
        wrong.push(`${p.actorId}: degenerate body AABB`);
        continue;
      }
      if (height / length > MAX_SUPINE_HEIGHT_TO_LENGTH) {
        wrong.push(
          `${p.actorId}: body is ${height.toFixed(2)}m tall and ${length.toFixed(2)}m long `
          + `(ratio ${(height / length).toFixed(2)}) — still standing`,
        );
      }
      if (p.longestAxis === "y") wrong.push(`${p.actorId}: longest body axis is still world Y`);
      if (p.clearanceAboveDeckMeters === null) {
        wrong.push(`${p.actorId}: no support surface was resolved for a supine actor`);
      } else if (p.clearanceAboveDeckMeters < -MAX_PENETRATION_METERS) {
        wrong.push(
          `${p.actorId}: sits ${(-p.clearanceAboveDeckMeters).toFixed(3)}m below the deck top`,
        );
      }
    }
    expect(wrong, `the supine pose does not read as a lying body:\n${wrong.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("standing and seated actors elsewhere are untouched (COUNTERWEIGHT)", async () => {
    // The cheapest satisfaction is resolving supine broadly, which lies down the nurse standing at
    // the bedside and every ambulatory patient in the bank. #81's seated telehealth patient is the
    // other thing a posture change can quietly break.
    const mod = await load();
    const inspect = mod["inspectSupinePatientOnDeck"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    const nonPatientSupine = report.actors
      .filter((a) => a.posture === "supine" && a.slotKind !== "primary_patient")
      .map((a) => `${a.scenarioId}/${a.actorId} (${a.slotKind}) was laid down`);
    expect(nonPatientSupine, `non-patient actors made supine:\n${nonPatientSupine.join("\n")}`)
      .toHaveLength(0);

    const seated = report.actors.filter((a) => a.posture === "seated");
    expect(seated.length, "#81's seated telehealth patient is no longer seated anywhere").toBeGreaterThan(0);

    const standing = report.actors.filter((a) => a.posture === "standing");
    expect(standing.length, "every actor in the bank was made non-standing").toBeGreaterThan(4);
  }, 900_000);
});
