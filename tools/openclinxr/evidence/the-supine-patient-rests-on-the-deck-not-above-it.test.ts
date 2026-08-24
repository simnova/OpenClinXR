import { beforeAll, describe, expect, it } from "vitest";
import { inspectSupinePatientOnDeck } from "./supine-patient-on-deck.js";

/**
 * OBSERVABLE: the ED patient's body touches the stretcher he is lying on.
 *
 * MEASURED 2026-08-24, do not re-derive. `supine-patient-on-deck.test.ts` is GREEN 3/3 on main
 * while the shipped capture shows the patient suspended in mid-air above and behind the stretcher,
 * arms outstretched, with clear space between his body and the mattress.
 *
 * Live inspector output for the ED primary patient:
 *
 *   deckTopY                  0.550
 *   bodyMinY                  0.771
 *   bodyMaxY                  1.650
 *   posture                   "supine"        <- correct
 *   longestAxis               "x"             <- correct, he IS oriented recumbent
 *   deckPenetrationMeters     0.000           <- ASSERTED (<= 0.05). Passes.
 *   clearanceAboveDeckMeters  0.221           <- computed by the SAME inspector, asserted by NOTHING
 *
 * THE GAP IS DIRECTIONAL. `supine-patient-on-deck.test.ts:182,194` bounds only how far the body may
 * sink INTO the deck (`toBeGreaterThan(-MAX_PENETRATION_METERS)`). A body floating any distance ABOVE
 * the deck has penetration 0, keeps posture "supine", and still "reads as recumbent" — every existing
 * clause passes. This is the §11s shape: the clause bounds an extreme in one direction and the defect
 * lives on the other side.
 *
 * THRESHOLD IS DERIVED, NOT FITTED. `supine-patient-on-deck.ts` defends 0.05 m as contact tolerance in
 * the sinking direction, reasoning "5 cm covers sole thickness under a foot bone on the deck — not a
 * 19 cm whole-body hang". Contact tolerance is symmetric: the same 5 cm bounds the resting direction.
 * The measured 0.221 m is 4.4x that, so this is not a threshold picked to clear an observation — it is
 * the existing gate's own number applied to the axis nobody bounded.
 *
 * KNOWN-GOOD COLUMN: `deckPenetrationMeters`. It is 0.000 today and the existing contract defends it.
 * Clause (2) pins it, so the cheapest cheat — drop the body until it rests by sinking through — fails.
 *
 * COUNTERWEIGHT: clause (3). The other cheap way to pass clause (1) is to stop calling him supine, or
 * to stand him up, which makes `clearanceAboveDeckMeters` null and vacuously satisfied. Posture and
 * longest axis are pinned so that route is closed.
 *
 * claimScope: the vertical relationship between the ED primary patient's body AABB and the stretcher
 * deck top, as the repo's own inspector reports it.
 * notEvidenceFor: why the body is suspended; the head-to-pillow gap (#181); the body's tilt, which is
 * real (0.879 m vertical span for a recumbent adult) but is a separate defect; any other station.
 *
 * ## FIXED (#620) — inclined-path skinned float settle in supine-deck-plant.ts
 *
 * The ED patient is the MPFB gown adult (`ED_RUNTIME_CAST_BY_ACTOR.patient_robert_hayes_v1`
 * → `mpfb-gown-adult-patient.glb`), and the inclined path had NO float-close: the flat path
 * settles the bind-pose surface (#494) but the inclined branch only closed SINKING (bounded
 * seat lift), so a 30° body sat 0.221 m above the deck while penetration read 0. Fix:
 * `settleSupineFloatOntoDeck` (hob-body-align.ts) measures the skinned AABB minY with the
 * contract inspector's own sampling density (count/4000) and lowers the root until the lowest
 * rendered vertex rests on the deck top. It runs after the bounded seat lift and never raises
 * (the lift owns the sink side with the back-gap trade).
 *
 * MEASURED 2026-08-24 after the fix, live inspector, same bank:
 *
 *   bodyMinY                  0.581        (was 0.771)
 *   bodyMaxY                  1.461        (was 1.650)
 *   clearanceAboveDeckMeters  0.031        (was 0.221; ≤ 0.05 now)
 *   deckPenetrationMeters     0.000        (was 0.000 — #150 guarantee intact)
 *   posture                   "supine"     longestAxis "x"   (unchanged)
 *
 * The settle targets the deck top (rest clearance 0), because the contract inspector reads
 * ~29–31 mm ABOVE the register-time settle on this rig (measured across three runs: target
 * 0.02 → 0.047–0.049; target 0.0 → 0.031). The contract reading therefore lands mid-band
 * with ~19 mm of margin each way; the body's lowest point never goes below the deck top, so
 * penetration stays 0.
 *
 * DECISIONS RECORDED: root translate (a deck-relative offset), not a per-bone plant — the
 * whole body was elevated ~0.3–0.5 m along its length and a single translate lands the lowest
 * point. Other stretcher stations (ed_chest_pain_priority_v2, ward_delirium, stepdown, postop,
 * adult_abdominal) are LEFT for a follow-up: they float less (0.127–0.129 m) on the FLAT path,
 * whose bind-pose settle is pinned by #492/#494's dump contract — landing them with a skinned
 * settle would sink their bind-pose surface below the deck and break that contract's known-good
 * column. The #159 harness (Anny body) is unaffected: it rests already, so the settle no-ops
 * there (verified live, back gap +0.02 / pelvis on seat at every incline).
 *
 * OUT-OF-SCOPE, unchanged by this fix: the body is still tilted (vertical span 0.880 m) — the
 * back floats above the back section while the lowest point rests. That is the separate defect
 * this contract deliberately does not bound.
 */

const ED = "ed_chest_pain_priority_v1";

/** One live boot for the whole file (§7b): three tests must not pay three dev servers. */
const BOOT_TIMEOUT_MS = 300_000;
let patients: Awaited<ReturnType<typeof inspectSupinePatientOnDeck>>["actors"] = [];

beforeAll(async () => {
  const report = await inspectSupinePatientOnDeck();
  patients = report.actors.filter((a) => a.scenarioId === ED && a.slotKind === "primary_patient");
}, BOOT_TIMEOUT_MS);

/** The existing contract's own contact tolerance, reused rather than re-invented. */
const MAX_CONTACT_GAP_METERS = 0.05;

describe("the supine ED patient rests ON the deck, not above it", () => {
  it("(1) the body's lowest point is within contact tolerance of the deck top", () => {
    expect(patients.length, "no ED primary patient in the live scene").toBeGreaterThan(0);

    for (const p of patients) {
      expect(
        p.clearanceAboveDeckMeters,
        `${p.actorId} has no deck to rest on — clearanceAboveDeckMeters is null`,
      ).not.toBeNull();
      expect(
        p.clearanceAboveDeckMeters!,
        `${p.actorId} floats ${p.clearanceAboveDeckMeters}m above the deck top; a body resting on a `
          + "stretcher touches it. The existing contract bounds only the sinking direction, so this "
          + "passes today while the capture shows him suspended in mid-air.",
      ).toBeLessThanOrEqual(MAX_CONTACT_GAP_METERS);
    }
  });

  it("(2) KNOWN-GOOD COLUMN: the body still does not sink through the deck", () => {
    // The guarantee #150 won. A fix that lands the body by dropping it through fails here.
    expect(patients.length).toBeGreaterThan(0);
    for (const p of patients) {
      expect(
        p.deckPenetrationMeters,
        `${p.actorId} sank into the deck; #150's guarantee must survive any landing fix`,
      ).toBeLessThanOrEqual(MAX_CONTACT_GAP_METERS);
    }
  });

  it("(3) COUNTERWEIGHT: he is still supine and still recumbent, not stood up to dodge clause (1)", () => {
    // Standing him up makes clearanceAboveDeckMeters null, which would vacuously satisfy (1).
    expect(patients.length).toBeGreaterThan(0);
    for (const p of patients) {
      expect(p.posture, `${p.actorId} is no longer supine`).toBe("supine");
      expect(
        p.longestAxis,
        `${p.actorId} is no longer recumbent — its longest AABB axis is ${p.longestAxis}, not x`,
      ).toBe("x");
    }
  });
});
