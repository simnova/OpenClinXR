import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyCleanEncounterVisualReviewActorFraming, type EncounterActorFramingInput } from "./index.js";
import { ensureActorPlacementsForStagedSlots, type ActorPlacementSsotEvidence } from "@openclinxr/xr-runtime-state";

/**
 * SPLIT NOTE: clause (5), the frame-loop baseX composition, moved to
// xr-humanoid-animation/src/the-frame-loop-composes-position-x-from-its-base.test.ts.
// xr-scene does NOT depend on @openclinxr/xr-humanoid-animation (xr-scene/package.json lists
// asset-registry, exam-assembly, scenario-fixtures, shared-schemas, xr-runtime-state, xr-station,
// xr-pose, three), so a single file cannot carry all five clauses.
//
// OBSERVABLE: Slot repair overwrites position/scale without reporting the rewritten ids (runtime-actor-placements.ts:102-114).
 * The frame loop assigns position.x from emotionalSway + dialogueWeightShift instead of composing from slot.baseX (animation-loop.ts:156).
 * Framing at encounter-actor-framing.ts:69-115 only guards seated posture; supine falls through to floor-standing default.
 * The evidence type carries only declaredActorIds and addedActorIds but not the actors whose position or scale was REWRITTEN.
 *
 * MEASURED 2026-09-09. Slot repair overwrites and reports nothing. xr-runtime-state/src/runtime-actor-placements.ts:102-114
 * rewrites position and scale from SLOT_PLACEMENT_ANCHORS when slotKind differs. addedActorIds is pushed only at :114 when !existing,
 * and the evidence type at :121-125,134-139 carries only declaredActorIds and addedActorIds. The header at :15-16
 * still claims it "only ADDS" and is FALSE. Keep the re-anchor (suppressing it reintroduces #136) and add a third list.
 * The frame loop assigns. xr-humanoid-animation/src/animation-loop.ts:156 writes slot.root.position.x = emotionalSway + dialogueWeightShift
 * while :155 is slot.root.position.y = slot.baseY + breathing * 0.018 and the scale lines compose from bases. slot.baseX is captured at
 * xr-asset-loading/src/humanoid-animation.ts:119 and unused. Framing. xr-scene/src/encounter-actor-framing.ts:69-115 are the OB and telehealth
 * branches, not an unconditional override. The SEATED keep-XZ branch is :133-141, and :137 writes actor.rotation.y = -0.26. The guard at
 * :133-135 reads actor.userData.openClinXrActorPosture or input.posture.
 *
 * known-good: The SUPINE frame path already composes correctly: animation-loop.ts:148-153 restores x, y, z and all three scales
 * from captured bases through holdSupinePlantFrame. The non-supine branch at :154-161 assigns.
 * The SEATED keep-XZ branch at encounter-actor-framing.ts:133-141 IS GREEN ON HEAD. It is the CONTROL, not a target.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED (<card>) below. Never rewrite the diagnosis or the measured anchors. A rejection still
 * flips: the clause asserts the report, not the outcome. Never delete an inverted guard.
 *
 * CONTRACTED EXPORT (the honest slice adds exactly this):
 * No new export is required. The change is three edits, each stated as behaviour:
 * - encounter-actor-framing.ts:133-141 extends its EXISTING if to keep XZ for supine as well as seated, and REFUSES an unrecognised posture explicitly rather than falling through to the floor-standing default. DO NOT HOIST the guard above :107: that would skip the telehealth chair plant.
 * - runtime-actor-placements.ts adds a third id list to its evidence type naming the actors whose position or scale was REWRITTEN, and corrects the false header at :15-16.
 * - animation-loop.ts:156 composes slot.root.position.x from slot.baseX, matching :155.
 *
 * IN-SCOPE: xr-runtime-state/src/runtime-actor-placements.ts, xr-scene/src/encounter-actor-framing.ts, xr-humanoid-animation/src/animation-loop.ts
 * OUT-OF-SCOPE: apps/ui-xr/src/main.ts and actor-staging.ts.
 */
describe("A staged transform survives slot repair, framing and the frame loop", () => {
  // A real THREE.Group, not an object literal: applyCleanEncounterVisualReviewActorFraming
  // calls actor.scale.setScalar(), which a literal { x, y, z } does not have.
  const makeActor = (position: { x: number; y: number; z: number }, userData: Record<string, unknown>): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(position.x, position.y, position.z);
    Object.assign(g.userData, userData);
    return g;
  };

  it("(1) SEATED keeps its XZ through framing", () => {
    // Control: SEATED branch at encounter-actor-framing.ts:133-141 is GREEN ON HEAD.
    // It must APPLY its own vertical framing (rotation/scale), not merely not crash.
    const actor = makeActor({ x: 1.42, y: 0, z: 0.04 }, {
        openClinXrActorPosture: "seated",
        openClinXrSlotKind: "family_or_observer",
      });

    const input: EncounterActorFramingInput = {
      actor,
      actorId: "test-actor",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      role: "parent",
      posture: "seated",
      skipFraming: false,
    };

    applyCleanEncounterVisualReviewActorFraming(input);

    // SEATED keeps authored seat anchor XZ (position unchanged), only rotation/scale are framed
    expect(actor.position.x).toBe(1.42);
    expect(actor.position.z).toBe(0.04);
    expect(actor.rotation.y).toBe(-0.26);
    expect(actor.scale.x).toBe(0.82);
    expect(actor.scale.y).toBe(0.82);
    expect(actor.scale.z).toBe(0.82);
    expect(actor.userData.openClinXrEncounterStaging).toBe("seated_actor_keeps_authored_seat_anchor_framed_in_place");
  });

  it.fails("(2) SUPINE keeps its XZ through framing", () => {
    // Supine should keep XZ like seated does, not fall through to floor-standing default
    const actor = makeActor({ x: -0.72, y: 1.06, z: -0.12 }, {
        openClinXrActorPosture: "supine",
        openClinXrSlotKind: "primary_patient",
      });

    const input: EncounterActorFramingInput = {
      actor,
      actorId: "patient-1",
      scenarioId: "ed_chest_pain_priority_v2",
      role: "patient",
      posture: "supine",
      skipFraming: false,
    };

    applyCleanEncounterVisualReviewActorFraming(input);

    // Supine should keep its XZ (authored anchor), only rotation/scale framed
    expect(actor.position.x).toBe(-0.72);
    expect(actor.position.z).toBe(-0.12);
    expect(actor.rotation.y).toBe(-0.26); // Same rotation as seated
    expect(actor.scale.x).toBe(0.82);
    expect(actor.scale.y).toBe(0.82);
    expect(actor.scale.z).toBe(0.82);
    expect(actor.userData.openClinXrEncounterStaging).toContain("supine");
  });

  it.fails("(3) An UNKNOWN posture is refused explicitly rather than defaulting to floor-standing", () => {
    // Unknown posture should be rejected, not fall through to floor-standing branches
    const actor = makeActor({ x: 0, y: 0, z: 0 }, {
        openClinXrActorPosture: "levitating", // Unknown posture
        openClinXrSlotKind: "primary_patient",
      });

    const input: EncounterActorFramingInput = {
      actor,
      actorId: "test-actor",
      scenarioId: "generic",
      role: "patient",
      posture: "levitating",
      skipFraming: false,
    };

    // Should throw or set a refusal staging, not apply floor-standing framing
    expect(() => {
      applyCleanEncounterVisualReviewActorFraming(input);
    }).toThrow(/unrecognised posture|refused|invalid posture/i);
  });

  it.fails("(4) The slot re-anchor reports itself: a third list beside declaredActorIds and addedActorIds names the ids whose position or scale was rewritten", () => {
    // ensureActorPlacementsForStagedSlots must return a third list: rewrittenActorIds
    const bundle: Parameters<typeof ensureActorPlacementsForStagedSlots>[0] = {
      sceneManifest: {
        actorPlacements: {
          "actor-1": {
            slotKind: "primary_patient",
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            verticalOffsetMeters: -0.98,
            labelPrefix: "Patient",
          },
          "actor-2": {
            slotKind: "family_or_observer",
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            verticalOffsetMeters: -0.95,
            labelPrefix: "Family",
          },
        },
      },
    };

    const slots: Parameters<typeof ensureActorPlacementsForStagedSlots>[1] = {
      stagedActorIds: ["actor-1", "actor-2", "actor-3", "actor-4"],
      notStagedActorIds: [],
      patientActorId: "actor-1",
      clinicalTeamActorId: "actor-2",
      familyActorId: "actor-3",
      additionalActorId: "actor-4",
    };

    const result = ensureActorPlacementsForStagedSlots(bundle, slots);

    // The result type must include rewrittenActorIds (actors whose position/scale was rewritten from anchor)
    // Currently it only returns { declaredActorIds, addedActorIds }
    const evidence = result as ActorPlacementSsotEvidence & { rewrittenActorIds?: string[] };

    // actor-1 has existing placement with same slotKind -> should NOT be rewritten
    // actor-2 has different slotKind (family_or_observer vs clinical_team) -> SHOULD be rewritten
    // actor-3 and actor-4 are new -> added, not rewritten
    expect(evidence.rewrittenActorIds).toBeDefined();
    expect(evidence.rewrittenActorIds).toContain("actor-2");
    expect(evidence.rewrittenActorIds).not.toContain("actor-1");
    expect(evidence.rewrittenActorIds).not.toContain("actor-3");
    expect(evidence.rewrittenActorIds).not.toContain("actor-4");
  });
});
