import { describe, expect, it } from "vitest";
import { Group } from "three";
import { applyCleanEncounterVisualReviewActorFraming } from "./encounter-actor-framing.js";

/**
 * OBSERVABLE: when the visual-review framing pass overrides a placement another source resolved,
 * it says so.
 *
 * MEASURED 2026-08-24, do not re-derive. There are FOUR sources of actor position, and this module
 * is the one that runs LAST:
 *   runtime-actor-placements.ts  hardcoded slotKind table, 10 entries
 *   environment-descriptors.ts   fixtureSlots, 11 slots
 *   shipped bundle               sceneManifest.actorPlacements, 9 of 14 scenarios
 *   THIS MODULE                  rewrites slot positions at runtime, last
 *
 * Its own docstring says "Rewrites slot positions for visual review", and `main.ts:4429` wraps it in
 * a local function that SHADOWS the imported name (imported at :70 as applyEncounterActorFraming).
 * The wrapper passes:
 *
 *     skipFraming: isHumanoidFaceDetailCaptureMode()
 *       || isActorPoseReviewCaptureMode()
 *       || isActorCloseRealismCaptureMode(),        // main.ts:4438-4441
 *
 * So framing is SKIPPED for three capture modes and APPLIED for everything else — including the
 * learner path. A pass written to make capture screenshots frame nicely decides where a learner sees
 * people standing, and is skipped for the captures. That inversion is measured; it is not alleged.
 *
 * WHAT THIS CONTRACT DELIBERATELY DOES NOT DECIDE. #175 records that whether framing SHOULD win in
 * the learner path "is not recorded anywhere I can find". Asserting that it must not override would
 * settle an open product question inside a test fixture, which is the #6n / #7a failure this repo has
 * paid for repeatedly. So this contract is policy-NEUTRAL: framing may still win. It must simply stop
 * winning SILENTLY.
 *
 * WHY SILENCE IS THE HARM, in the card's own words: "several slices have 'fixed placement' by editing
 * one of the other three sources and then graded a capture — a capture whose framing pass may have
 * overridden the edit." A recorded override makes that legible to the next slice instead of costing it
 * a cycle.
 *
 * KNOWN-GOOD COLUMN: the skipFraming path. It works today and must keep working untouched — clause (2)
 * pins it, so "make the module a no-op" cannot pass.
 *
 * claimScope: whether this module records an override of a pre-resolved position, and whether the
 * skip path stays inert.
 * notEvidenceFor: whether framing SHOULD override a declared placement; which source is correct; any
 * rendered appearance, camera framing, or runtime wiring in main.ts.
 */

const OB = "ob_headache_preeclampsia_triage_v1";

/** A slot whose position a DECLARED source already resolved, before framing runs. */
function actorWithDeclaredPlacement(): Group {
  const g = new Group();
  g.position.set(1.234, 0, 5.678);
  g.userData.openClinXrActorRole = "patient";
  return g;
}

describe("the visual-review framing pass does not silently discard a declared placement", () => {
  it.fails("(1) overriding a pre-resolved position is RECORDED on the actor", () => {
    const actor = actorWithDeclaredPlacement();
    const before = actor.position.clone();

    applyCleanEncounterVisualReviewActorFraming({
      actor, actorId: "patient_x", scenarioId: OB, role: "patient", skipFraming: false,
    });

    // Framing DID move it — that is the measured behaviour, not the complaint.
    expect(actor.position.x, "the OB patient branch hardcodes (-0.72, 0, 0.08)").toBeCloseTo(-0.72, 3);

    // The complaint: nothing says a declared placement was discarded.
    const overrode = actor.userData["openClinXrFramingOverrodePlacement"] as
      | { x: number; y: number; z: number } | undefined;
    expect(
      overrode,
      "framing overwrote a position another source resolved and left no record — this is what makes "
        + "a placement fix look applied while a capture shows otherwise",
    ).toBeDefined();
    expect(overrode!.x).toBeCloseTo(before.x, 3);
    expect(overrode!.z).toBeCloseTo(before.z, 3);
  });

  it("(2) KNOWN-GOOD COLUMN: the skip path leaves position AND userData inert", () => {
    const actor = actorWithDeclaredPlacement();
    applyCleanEncounterVisualReviewActorFraming({
      actor, actorId: "patient_x", scenarioId: OB, role: "patient", skipFraming: true,
    });
    expect(actor.position.x).toBeCloseTo(1.234, 3);
    expect(actor.position.z).toBeCloseTo(5.678, 3);
    expect(actor.userData["openClinXrEncounterStaging"]).toBeUndefined();
    expect(actor.userData["openClinXrFramingOverrodePlacement"]).toBeUndefined();
  });

  it("(3) COUNTERWEIGHT: framing still frames — this is not satisfiable by disabling the module", () => {
    const actor = actorWithDeclaredPlacement();
    applyCleanEncounterVisualReviewActorFraming({
      actor, actorId: "patient_x", scenarioId: OB, role: "patient", skipFraming: false,
    });
    expect(actor.position.x, "a no-op module would leave 1.234 here").toBeCloseTo(-0.72, 3);
    expect(
      actor.userData["openClinXrEncounterStaging"],
      "the staging tag other surfaces read must survive",
    ).toBe("ob_patient_standing_beside_offset_stretcher_clear_of_deck_and_work_surface");
  });
});
