import { beforeAll, describe, expect, it } from "vitest";
import { inspectShippedHeadOfBedIncline } from "./shipped-head-of-bed-incline.js";
import { inspectSupinePatientOnDeck } from "./supine-patient-on-deck.js";

/**
 * OBSERVABLE: the supine patient's head rests on the pillow that exists to support it.
 *
 * MEASURED 2026-08-24, do not re-derive. #620 closed the body float — the ED patient's lowest vertex
 * went 0.221 m -> 0.031 m above the deck — with a pure root translate of -0.190 m. My pixel grade of
 * the post-fix capture: back, buttocks and thighs contact the mattress, and "the torso is reclined
 * roughly 30-40 degrees with the head and shoulders overhanging past the head end of the mattress into
 * open space".
 *
 * The float was MASKING this, not replacing it. Pre-#620 live numbers and the landed translate:
 *
 *   30 deg headCenterY   1.533  ->  1.343 (derived: -0.190)
 *   30 deg pillowTopY    1.043  ->  1.043 (pillow is deck-mounted; the translate moved the BODY)
 *   head above pillow    0.490  ->  0.300 (derived)
 *
 * 0.300 m lands within 20 mm of the ~0.32 m #181 recorded before any of this, from #171's worker.
 *
 * THRESHOLD IS DERIVED, NOT FITTED — the same derivation #620 used and landed on. That contract took
 * 0.05 m as contact tolerance, reasoning that a pillow/sole/skin contact band is symmetric and reusing
 * the number `supine-patient-on-deck.ts` already defends for penetration. A head resting on a pillow is
 * the same class of contact as a body resting on a deck. Nothing here was picked to clear an observation.
 *
 * KNOWN-GOOD COLUMN — clause (2): #620's guarantee. `clearanceAboveDeckMeters <= 0.05` AND
 * `deckPenetrationMeters <= 0.05`. This is not decoration: **#171 tried to close this exact head gap
 * with a soft head-Y blend, the blend pulled the whole root down, seat clearance went -0.146 -> -0.190,
 * and the gate had to be widened to cover it.** Dropping the body to reach the pillow is the historical
 * failure mode and clause (2) is what refuses it.
 *
 * COUNTERWEIGHT — clause (3): posture stays "supine" and longestAxis stays "x". Standing the patient up
 * or re-labelling the posture removes the pillow relationship entirely and would vacuously satisfy (1).
 *
 * claimScope: the vertical relationship between the ED patient's head and the pillow top, plus #620's
 * landed deck-contact guarantee, as the repo's own two inspectors report them.
 * notEvidenceFor: the mechanism (whether cervical/thoracic flexion is the right lever is UNPROVEN — #171
 * traced it, nobody has measured it against the landed body); the flat-path residual, which derives to
 * ~0.664 m and is not bounded here; the other stretcher stations.
 */

/** Reused verbatim from #620's landed contract — a contact band, not a new number. */
const MAX_CONTACT_GAP_METERS = 0.05;
const ED = "ed_chest_pain_priority_v1";
const BOOT_TIMEOUT_MS = 420_000;

let headDeck: Awaited<ReturnType<typeof inspectShippedHeadOfBedIncline>>["headDeck"] = [];
let patients: Awaited<ReturnType<typeof inspectSupinePatientOnDeck>>["actors"] = [];

beforeAll(async () => {
  const incline = await inspectShippedHeadOfBedIncline({ force: true });
  headDeck = incline.headDeck;
  const deck = await inspectSupinePatientOnDeck();
  patients = deck.actors.filter((a) => a.scenarioId === ED && a.slotKind === "primary_patient");
}, BOOT_TIMEOUT_MS);

describe("the supine patient's head rests on its pillow", () => {
  it("(1) at the shipped incline the head is within contact tolerance of the pillow top", () => {
    const raised = headDeck.find((g) => Math.abs(g.inclineDegrees) >= 1);
    expect(raised, "no inclined row in the head-deck report; the instrument found no shipped angle").toBeDefined();
    expect(
      raised!.pillowTopY,
      "pillowTopY is null — the instrument could not resolve the pillow, so this clause cannot judge",
    ).not.toBeNull();
    const gap = raised!.headCenterY - raised!.pillowTopY!;
    expect(
      gap,
      `the head sits ${gap.toFixed(3)}m above the pillow top at ${raised!.inclineDegrees} degrees. #620 `
        + "landed the BODY on the deck; the head still overhangs the head end into open space.",
    ).toBeLessThanOrEqual(MAX_CONTACT_GAP_METERS);
  });

  it("(2) KNOWN-GOOD COLUMN: #620's deck contact survives — the body is not dropped to reach the pillow", () => {
    // #171 closed this same gap with a head-Y blend; it pulled the root down and seat clearance went
    // -0.146 -> -0.190. That is the failure mode this clause exists to refuse.
    expect(patients.length, "no ED primary patient in the live scene").toBeGreaterThan(0);
    for (const p of patients) {
      expect(p.clearanceAboveDeckMeters, `${p.actorId} has no deck to rest on`).not.toBeNull();
      expect(
        p.clearanceAboveDeckMeters!,
        `${p.actorId} floats ${p.clearanceAboveDeckMeters}m — #620's landing must survive any head fix`,
      ).toBeLessThanOrEqual(MAX_CONTACT_GAP_METERS);
      expect(
        p.deckPenetrationMeters,
        `${p.actorId} sank into the deck reaching for the pillow — #150's guarantee must hold`,
      ).toBeLessThanOrEqual(MAX_CONTACT_GAP_METERS);
    }
  });

  it("(3) COUNTERWEIGHT: still supine and still recumbent, not re-posed to dodge clause (1)", () => {
    expect(patients.length).toBeGreaterThan(0);
    for (const p of patients) {
      expect(p.posture, `${p.actorId} is no longer supine`).toBe("supine");
      expect(p.longestAxis, `${p.actorId} is no longer recumbent along x`).toBe("x");
    }
  });
});

/**
 * ## FIXED (#181) — appended 2026-08-26; the planted header above is immutable
 *
 * The RED was already green-by-construction at first live run: clause (1)'s inner assertion
 * PASSED (vitest "Expect test to fail"), because commit `ec5cbd42` — landed ~90 minutes after
 * this plant, same day — had shipped the distributed upper-spine/neck flex
 * (`hob-head-flex.ts`, wired into `supine-deck-plant.ts` `head_flex`) but never flipped this
 * file. This slice verified that fix against the live room and closed the contract.
 *
 * MECHANISM, measured (the card's cervical/thoracic-flexion trace was right in kind):
 * - ED patient rides the MPFB2 rail (#496 skips the 17 SUPINE_BONE_EULERS), so the inclined
 *   body was a rigid plank: per-frame applySupinePose resets only the root quat, and the
 *   register-time chain flex on spine01-03/neck persists across frames. ec5cbd42 also gated
 *   main.ts's standing-idle sway to non-supine roots — it had been writing patient.rotation.y
 *   every frame, re-deriving the stored hinge quat away.
 * - Live numbers this run (shipped-head-of-bed-incline.ts): flat headCenterY 1.0315 /
 *   pillowTopY 0.6300; 30° headCenterY 1.0920 / pillowTopY 1.0426 → gap 0.0493 m vs bound
 *   0.05. Clause (2)/(3): clear=0.034, pen=0.000, posture=supine, longestAxis=x.
 * - Residual tuned: 0.0493 was sub-millimetre from the band edge while the documented
 *   register-vs-live instrument spread is 0.06-0.08 m. Flex setpoint deepened −0.03 → −0.05 m
 *   (hob-head-flex.ts default targetGapMeters) so the live reading centres mid-band instead of
 *   sitting at its edge — derived from the spread, not fitted to today's draw.
 *
 * NOT TESTED: whether the deeper setpoint over-flexes visibly (chin-to-chest staging); the
 * other stretcher stations' head-pillow relationship (ward/stepdown/postop read supine here,
 * incline unmeasured); the ~0.664 m flat-path gap noted in claimScope; MAX_HEAD_PAST_PILLOW
 * 0.40 in supine-limb-rest.test.ts, left alone per brief.
 */
