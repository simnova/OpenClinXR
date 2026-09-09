import { describe, expect, it } from "vitest";
import { supportedActorPlacementPosition } from "./index.js";

/**
 * Brief §3: "With no intent, retain the existing resolved defaults and label their provenance; do
 * not copy them back into the case as faculty decisions."
 *
 * Once composed, a default and an authored value are the same three numbers. Without the label a
 * reviewer reading the runtime cannot tell which placements a clinician actually decided, which is
 * the difference between a recorded clinical choice and a fixture that happened to land there.
 *
 * AND THE STANDING REFUSAL WAS UNREACHABLE. `supportedActorPlacementPosition` returned early for
 * standing, before `composeSupportedActorWorldPosition` ran, so the "`none` is not a frame" refusal
 * this repo landed the same day was correct and inert — its only runtime caller never asked it.
 */

const RESOLVED = { x: 3, y: 0, z: 2 };

function place(posture: "standing" | "seated" | "supine", scenarioId: string, actorId: string) {
  return supportedActorPlacementPosition({
    posture,
    actorId,
    slotKind: "primary_patient",
    scenarioId,
    environmentId: "ed_exam_bay_v1",
    resolvedPosition: RESOLVED,
  });
}

describe("a resolved placement says where it came from", () => {
  it("(1) an UNAUTHORED supported placement is labelled a resolved default", () => {
    const result = place("supine", "no_such_scenario", "no_such_actor");
    expect(result.provenance).toBe("resolved_default");
    expect(result.refusalReason).toBeUndefined();
  });

  it("(2) an AUTHORED offset that composes is labelled authored intent", () => {
    // clinic_knee_pain_return_to_play_v1 is the scenario that AUTHORS plant offsets — its seated
    // patient carries {x: 0.4, y: 0, z: 0}. The first draft of this clause named the ED station,
    // which authors none: the fixture would have exercised the default branch and reported the
    // label as broken. Measured before correcting it: `plantOffsetMeters` appears zero times in
    // ed-chest-pain.ts and three times in clinic-knee-pain.ts.
    const result = place("seated", "clinic_knee_pain_return_to_play_v1", "patient_jordan_cole_v1");
    expect(result.refusalReason).toBeUndefined();
    expect(result.provenance).toBe("authored_intent");
    // And the two labels really are distinguishable on otherwise identical inputs.
    expect(place("seated", "no_such_scenario", "patient_jordan_cole_v1").provenance).toBe("resolved_default");
  });

  it("(3) a STANDING actor now REACHES the compose, so its refusal is live", () => {
    // The early return meant this path never consulted the frame rule. A standing actor with no
    // authored offset resolves; the refusal branch is exercised by the asset-registry clause that
    // owns it, and this clause proves the call site is no longer short-circuited.
    const result = place("standing", "no_such_scenario", "no_such_actor");
    expect(result.position).toEqual(RESOLVED);
    expect(result.provenance).toBe("resolved_default");
    expect(result.refusalReason).toBeUndefined();
  });

  it("(4) COUNTERWEIGHT: a refusal is labelled a DEFAULT, never authored", () => {
    // On a refusal the anchor stands and nothing the author asked for was applied. Calling that
    // "authored_intent" would be the false claim the label exists to prevent, and it is the label
    // a naive implementation writes BECAUSE an offset was present. The standing posture with an
    // authored offset is exactly that case: `none` is not a frame, so it refuses.
    const refused = place("standing", "clinic_knee_pain_return_to_play_v1", "patient_jordan_cole_v1");
    expect(refused.refusalReason).toMatch(/not a frame/u);
    expect(refused.provenance).toBe("resolved_default");
    expect(refused.position).toEqual(RESOLVED);
  });
});

/**
 * Brief §3: "Keep placement provisional until that geometry is ready; a pending exact support
 * withholds promotion while loading, without silently selecting another instance."
 *
 * The dangerous branch is the third one below: the named instance is absent while a DIFFERENT
 * instance of the same kind IS mounted. That is when substituting looks harmless, and it puts the
 * patient on the wrong bed.
 */
describe("a placement stays provisional until its exact support is mounted", () => {
  function readiness(supportInstanceId: string | undefined, mounted: readonly string[]) {
    return supportedActorPlacementPosition({
      posture: "supine",
      actorId: "patient_robert_hayes_v1",
      slotKind: "primary_patient",
      scenarioId: "ed_chest_pain_priority_v2",
      environmentId: "ed_exam_bay_v1",
      resolvedPosition: RESOLVED,
      ...(supportInstanceId ? { supportInstanceId } : {}),
      mountedSupportInstanceIds: mounted,
    }).supportReadiness;
  }

  it("(5) the NAMED support mounted reads mounted", () => {
    expect(readiness("ed_stretcher_bed_equipment", ["ed_stretcher_bed_equipment"])).toEqual({
      status: "mounted",
      supportInstanceId: "ed_stretcher_bed_equipment",
    });
  });

  it("(6) nothing mounted reads PENDING and names the instance it is waiting for", () => {
    const result = readiness("ed_stretcher_bed_equipment", []);
    expect(result.status).toBe("pending");
    if (result.status !== "pending") return;
    expect(result.supportInstanceId).toBe("ed_stretcher_bed_equipment");
    expect(result.reason).toMatch(/No other support instance is mounted/u);
  });

  it("(7) ANOTHER instance mounted is still PENDING, and the reason says it was not taken", () => {
    // The substitution branch. A caller that promotes here has put the patient on a bed the case
    // did not name, and the placement would look resolved.
    const result = readiness("ed_stretcher_bed_equipment", ["stretcher_equipment", "exam_table_equipment"]);
    expect(result.status).toBe("pending");
    if (result.status !== "pending") return;
    expect(result.supportInstanceId).toBe("ed_stretcher_bed_equipment");
    expect(result.reason).toContain("stretcher_equipment");
    expect(result.reason).toMatch(/none was substituted/u);
  });

  it("(8) COUNTERWEIGHT: a placement that names NO support, and a standing actor, are not_required", () => {
    // Reporting pending for every placement would satisfy clauses (6) and (7) and stall the scene.
    expect(readiness(undefined, [])).toEqual({ status: "not_required" });
    expect(
      supportedActorPlacementPosition({
        posture: "standing",
        actorId: "x",
        slotKind: "primary_patient",
        scenarioId: "no_such_scenario",
        environmentId: "ed_exam_bay_v1",
        resolvedPosition: RESOLVED,
        supportInstanceId: "ed_stretcher_bed_equipment",
        mountedSupportInstanceIds: [],
      }).supportReadiness,
    ).toEqual({ status: "not_required" });
  });
});
