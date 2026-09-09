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
