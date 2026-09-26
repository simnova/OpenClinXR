import { describe, expect, it } from "vitest";
import { Group } from "three";
import {
  applyCleanEncounterVisualReviewActorFraming,
  resolveActorFramedPosition,
} from "./encounter-actor-framing.js";

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
  it("(1) overriding a pre-resolved position is RECORDED on the actor", () => {
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

  /**
   * ## FIXED (#175)
   *
   * MEASURED after the fix, same harness:
   *   - clause (1), flipped: PASS — OB patient (1.234, 0, 5.678) → (-0.72, 0, 0.08),
   *     openClinXrFramingOverrodePlacement { x:1.234, y:0, z:5.678 } present on userData.
   *   - all 8 position.set branches (OB patient/nurse/family, telehealth chair,
   *     additional_cast, family_or_observer, primary_patient fallback, clinical_team)
   *     now call recordPlacementOverride(actor) immediately BEFORE position.set.
   *   - the seated branch (#591) rewrites rotation/scale only and does NOT call it;
   *     an override is a discarded declared placement, not a framing touch.
   *   - skip path untouched (clause (2) green); framing still frames (clause (3) green).
   */
});

/**
 * ed-reanchor-refreeze investigation (2026-09-26). `resolveActorFramedPosition` is the SHARED
 * function a build-time caller (the sc-06 freeze generator, which has no live `Group` to stage a
 * real actor into) must call to compute the SAME "start" / "patientWorld" position the runtime
 * actually stages — because the runtime ALWAYS runs a standing actor through
 * `applyCleanEncounterVisualReviewActorFraming` on a normal (non-capture) boot, overwriting any
 * manifest-declared position.
 *
 * PINNED VALUES. Measured live (intercepted bundle route + a real ui-xr boot) on 2026-09-26: the
 * ED nurse's manifest declares `(1.78, 0.95, 0.42)` and the runtime actually stages her at
 * `(0.64, 0, 0.3)` — the fixed "clinical_team" framing point, because she is STANDING and the
 * framing pass only exempts seated/supine actors. These two tests pin that value through the
 * shared function so a change to the framing table is caught here, at the same place the freeze
 * generator and the runtime both read it from.
 */
describe("resolveActorFramedPosition matches what the runtime actually stages", () => {
  it("frames a standing clinical_team actor at the fixed clinical review point, not the manifest position", () => {
    const result = resolveActorFramedPosition({
      actorId: "nurse_maria_alvarez_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      role: "nurse",
      slotKind: "clinical_team",
      posture: "standing",
      manifestPosition: { x: 1.78, y: 0.95, z: 0.42 },
    });
    expect(result).toEqual({ x: 0.64, y: 0, z: 0.3 });
  });

  it("leaves a SUPINE patient's manifest position untouched (her XZ is owned by her deck anchor)", () => {
    const result = resolveActorFramedPosition({
      actorId: "patient_robert_hayes_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      role: "patient",
      slotKind: "primary_patient",
      posture: "supine",
      manifestPosition: { x: -0.9, y: 0, z: -0.1 },
    });
    expect(result).toEqual({ x: -0.9, y: 0, z: -0.1 });
  });

  it("frames the ward physician (additional_cast) at the fixed additional-cast framing point", () => {
    // scene_closure's walker is cast into additional_cast, not clinical_team — a different fixed
    // point (ADDITIONAL_CAST_FRAMING_XZ). Pinned so the two cases cannot silently share one value.
    const result = resolveActorFramedPosition({
      actorId: "senior_resident_ward_v1",
      scenarioId: "scene_closure_supine_bedside_v1",
      role: "physician",
      slotKind: "additional_cast",
      posture: "standing",
      manifestPosition: { x: -1.95, y: 0, z: 1.72 },
    });
    expect(result).toEqual({ x: 1.95, y: 0, z: 0.15 });
  });
});
