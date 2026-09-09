import { describe, expect, it } from "vitest";

// A planted RED reads dynamically imported modules whose shapes are exactly what the slice
// must define. Narrowing them here would encode the answer the card is supposed to produce,
// and the worker would have to rewrite it anyway.
// biome-ignore lint/suspicious/noExplicitAny: see the three lines above
type Loose = any;

/**
 * OBSERVABLE: The factory's compile node for Placement omits the authored plantOffsetMeters
 * from clinic-knee-pain (encounter-materialization-evidence.ts:309-323 emits supportSurface only),
 * the factory stage hardcodes plantOffsetMeters: 0 and supportSurface from posture
 * (multi-case-runner.ts:806-807), the placement builder derives position from the actor index
 * (actor-placement.ts:48-50), and the runtime bundle has four hardcoded positions
 * (generated-ed-station-runtime-bundle.ts:1248-1275). The authored clinic-knee-pain vectors
 * {0.4,0,0}, {-0.55,0,0.2}, {0.9,0,-0.35} never reach Loose consumer.
 *
 * MEASURED 2026-09-09. Authored data: scenario-fixtures/src/clinic-knee-pain.ts:53,76,99.
 * Compile node: encounter-materialization-evidence.ts:309-323 omits offset; status "planned_unsplit".
 * Factory stage: multi-case-runner.ts:806-807 hardcodes plantOffsetMeters: 0 and supportSurface from posture.
 * Placement builder: asset-registry/src/actor-placement.ts:48-50 derives position from actor index.
 * Runtime bundle: generated-ed-station-runtime-bundle.ts:1248-1275 four hardcoded positions.
 *
 * known-good: generatedActorPlacement (asset-registry/src/actor-placement.ts:24-59) already threads
 * a per-actor record through the stage into the bundle. The threading is the known-good; the
 * derivation at :48-50 is the defect. Writing the offset onto the emitted spec is necessary and
 * not sufficient — a baker has to read it, and none does today.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED (<card>)
 * below. Never rewrite the diagnosis or the measured anchors. A rejection still
 * flips: the clause asserts the report, not the outcome. Never delete an
 * inverted guard.
 *
 * CONTRACTED EXPORT (the honest slice adds exactly this):
 *   // asset-registry/src/actor-placement.ts — generatedActorPlacement gains a case input.
 *   // Read the CURRENT signature first and extend it; do not invent a new function.
 *   // The new input carries, per actor: the authored plantOffsetMeters {x,y,z} (optional),
 *   // the supportSurface, and Loose authored facing. When an authored offset is present the
 *   // returned position is derived FROM IT, not from the actor index. When absent, the
 *   // existing index-derived position is kept unchanged.
 *
 * IN-SCOPE: tools/openclinxr/factory/encounter-materialization-evidence.ts, tools/openclinxr/dark-factory/multi-case-runner.ts, tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts, packages/openclinxr/asset-registry/src/actor-placement.ts
 * OUT-OF-SCOPE: encounter-materialization-compile.ts, apps/ui-xr, actor-posture helpers, the admin control, the station schema.
 *
 * ## FIXED
 * generatedActorPlacement gained the contracted case input
 * ({ scenarioId, casePlacements }) and returns the authored plantOffsetMeters
 * as the placement position when present, keeping the index-derived position
 * otherwise; authored headingRadians is set only when numeric, never 0 by
 * default. emitCompileNodes writes the authored plantOffsetMeters and
 * supportSurface onto each Placement node spec. runPlacementStage is exported,
 * reads the case-authored placement per actor, and passes the authored vector
 * and surface through runStaging and the placements.json artifact instead of
 * the hardcoded 0/posture pair. runtimeActorPlacementsForScenario overrides
 * each scenario position with the case-authored offset when the case authors
 * one; unauthored stations keep their hardcoded defaults.
 */

import type { EncounterRuntimeActorAsset } from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";

// CONTRACTED: generatedActorPlacement gains a case input carrying per-actor authored offsets.
// Current signature: generatedActorPlacement(actor, index, { scenarioId })
// Extended signature: generatedActorPlacement(actor, index, { scenarioId, casePlacements? })
// where casePlacements maps actorId -> { plantOffsetMeters?: {x,y,z}, supportSurface?: string, headingRadians?: number }

const clinicKneePainScenarioId = "clinic_knee_pain_return_to_play_v1";

function makeActor(actorId: string, role: EncounterRuntimeActorAsset["role"]): EncounterRuntimeActorAsset {
  return {
    actorId,
    embodiment: "humanoid",
    role,
    model: {
      assetId: actorId,
      version: "v1",
      kind: "humanoid_model",
      displayName: actorId,
      scenarioAssetId: actorId,
      blob: {
        storeKind: "app_public_fixture",
        containerName: "generated-humanoids",
        blobName: `${actorId}.glb`,
        contentType: "model/gltf-binary",
        url: `${actorId}.glb`,
      },
      reviewStatus: "fixture_approved_for_local_runtime",
      provenanceRefs: [],
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    },
    animationClips: [],
    gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: false },
  };
}

describe("The factory resolves actor placement from the case, not from the actor index", () => {
  it("(1) generatedActorPlacement returns the three clinic-knee-pain authored vectors for the three actors, not index-derived positions", async () => {
    // Authored vectors from clinic-knee-pain.ts:53,76,99
    const patient = makeActor("patient_jordan_cole_v1", "patient");
    const parent = makeActor("parent_lena_cole_v1", "family");
    const ma = makeActor("medical_assistant_rui_park_v1", "medical_assistant");

    // Current behavior: position derived from actor index via slotKind logic
    // The fix must make generatedActorPlacement read the authored offsets from the case
    // and return them when present, ignoring the index-derived position.

    // This import will fail until the function signature is extended with case input
    const mod = await import("../../../packages/openclinxr/asset-registry/src/actor-placement.js");
    const fn = (mod as Record<string, unknown>)["generatedActorPlacement"];
    expect(typeof fn).toBe("function");

    // When case placements are provided with authored offsets, they must be used
    const casePlacements = {
      patient_jordan_cole_v1: { plantOffsetMeters: { x: 0.4, y: 0, z: 0 }, supportSurface: "chair" },
      parent_lena_cole_v1: { plantOffsetMeters: { x: -0.55, y: 0, z: 0.2 }, supportSurface: "chair" },
      medical_assistant_rui_park_v1: { plantOffsetMeters: { x: 0.9, y: 0, z: -0.35 }, supportSurface: "none" },
    };

    // The extended function should accept casePlacements and return authored positions
    const patientPlacement = fn(patient, 0, { scenarioId: clinicKneePainScenarioId, casePlacements });
    const parentPlacement = fn(parent, 1, { scenarioId: clinicKneePainScenarioId, casePlacements });
    const maPlacement = fn(ma, 2, { scenarioId: clinicKneePainScenarioId, casePlacements });

    // Assert the three authored vectors exactly — NOT the index-derived positions
    expect(patientPlacement.position).toEqual({ x: 0.4, y: 0, z: 0 });
    expect(parentPlacement.position).toEqual({ x: -0.55, y: 0, z: 0.2 });
    expect(maPlacement.position).toEqual({ x: 0.9, y: 0, z: -0.35 });

    // The index-derived positions would be:
    // patient (index 0, primary_patient): { x: -0.8, y: 0.95, z: 0.3 }
    // parent (index 1, family_or_observer): { x: 0, y: 0.95, z: 0.75 }
    // ma (index 2, clinical_team): { x: 0.8, y: 0.95, z: 0.3 }
    // These must NOT match
    expect(patientPlacement.position).not.toEqual({ x: -0.8, y: 0.95, z: 0.3 });
    expect(parentPlacement.position).not.toEqual({ x: 0, y: 0.95, z: 0.75 });
    expect(maPlacement.position).not.toEqual({ x: 0.8, y: 0.95, z: 0.3 });
  });

  it("(2) emitCompileNodes emits Placement nodes with plantOffsetMeters and supportSurface from the case", async () => {
    const { emitCompileNodes } = await import("./encounter-materialization-evidence.js");
    const { buildEncounterMaterializationEvidenceReport } = await import("./encounter-materialization-evidence.js");

    // Build a minimal report for clinic-knee-pain
    const bundleReport = await import("./generated-ed-station-runtime-bundle.js").then(m =>
      m.buildGeneratedEdStationRuntimeBundleReport({
        humanReportPath: ".openclinxr/evidence/fixtures/clinic-knee-pain/human.json",
        equipmentReportPath: ".openclinxr/evidence/fixtures/clinic-knee-pain/equipment.json",
        environmentReportPath: ".openclinxr/evidence/fixtures/clinic-knee-pain/environment.json",
        scenarioId: clinicKneePainScenarioId,
      })
    );

    const evidenceBundleReport = {
      ...bundleReport,
      actorHumanoidMaterializationContract: {
        schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
        scenarioId: clinicKneePainScenarioId,
        source: "generated_station_runtime_bundle",
        actorSpecificVariantKeysRequired: true,
        sharedNeutralMeshReuseDetected: false,
        sharedNeutralMeshReuseActorIds: [],
        actorVariants: [
          {
            actorId: "patient_jordan_cole_v1",
            actorRole: "patient",
            modelAssetId: "patient",
            variantSemanticKey: `${clinicKneePainScenarioId}:patient_jordan_cole_v1:patient:anny_humanoid_variant`,
            sourceBlobName: "patient.glb",
            humanoidVariantProfile: {
              ageBand: "adult",
              bodyScale: "adult_standard",
              hairFaceRequired: true,
              clothingLayer: "role_specific",
              faceEyeLipRigRequired: true,
              idlePoseRequired: true,
              locomotionRequired: false,
            },
            requiredMaterializationCueIds: [
              "actor_specific_body_profile_required",
              "actor_specific_clothing_required",
              "actor_specific_hair_face_required",
              "actor_specific_rig_preservation_required",
            ],
          },
          {
            actorId: "parent_lena_cole_v1",
            actorRole: "family",
            modelAssetId: "parent",
            variantSemanticKey: `${clinicKneePainScenarioId}:parent_lena_cole_v1:family:anny_humanoid_variant`,
            sourceBlobName: "parent.glb",
            humanoidVariantProfile: {
              ageBand: "adult",
              bodyScale: "adult_standard",
              hairFaceRequired: true,
              clothingLayer: "role_specific",
              faceEyeLipRigRequired: true,
              idlePoseRequired: true,
              locomotionRequired: false,
            },
            requiredMaterializationCueIds: [
              "actor_specific_body_profile_required",
              "actor_specific_clothing_required",
              "actor_specific_hair_face_required",
              "actor_specific_rig_preservation_required",
            ],
          },
          {
            actorId: "medical_assistant_rui_park_v1",
            actorRole: "medical_assistant",
            modelAssetId: "ma",
            variantSemanticKey: `${clinicKneePainScenarioId}:medical_assistant_rui_park_v1:medical_assistant:anny_humanoid_variant`,
            sourceBlobName: "ma.glb",
            humanoidVariantProfile: {
              ageBand: "adult",
              bodyScale: "adult_standard",
              hairFaceRequired: true,
              clothingLayer: "role_specific",
              faceEyeLipRigRequired: true,
              idlePoseRequired: true,
              locomotionRequired: false,
            },
            requiredMaterializationCueIds: [
              "actor_specific_body_profile_required",
              "actor_specific_clothing_required",
              "actor_specific_hair_face_required",
              "actor_specific_rig_preservation_required",
            ],
          },
        ],
        materializationBlockers: [],
        caveats: [],
        recommendedNextAction: "preserve actor-specific humanoid variant keys through publication and visual QA",
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "animation_quality"],
      },
      equipmentMaterializationContract: bundleReport.equipmentMaterializationContract,
    };
    const report = buildEncounterMaterializationEvidenceReport({ bundleReport: evidenceBundleReport });

    // Resolve the case descriptor for clinic-knee-pain to get authored placements
    const { findScenarioFixtureById } = await import("../../../packages/openclinxr/scenario-fixtures/src/index.js");
    const caseDescriptor = findScenarioFixtureById(clinicKneePainScenarioId) as Loose;

    const nodes = emitCompileNodes(report, [], caseDescriptor);
    const placementNodes = nodes.filter((n: Loose) => n.family === "Placement");

    expect(placementNodes.length).toBe(3);

    // Each placement node must carry the authored plantOffsetMeters and supportSurface
    const patientPlacement = placementNodes.find((n: Loose) => n.spec.actorId === "patient_jordan_cole_v1");
    const parentPlacement = placementNodes.find((n: Loose) => n.spec.actorId === "parent_lena_cole_v1");
    const maPlacement = placementNodes.find((n: Loose) => n.spec.actorId === "medical_assistant_rui_park_v1");

    expect(patientPlacement).toBeDefined();
    expect(patientPlacement.spec.plantOffsetMeters).toEqual({ x: 0.4, y: 0, z: 0 });
    expect(patientPlacement.spec.supportSurface).toBe("chair");

    expect(parentPlacement).toBeDefined();
    expect(parentPlacement.spec.plantOffsetMeters).toEqual({ x: -0.55, y: 0, z: 0.2 });
    expect(parentPlacement.spec.supportSurface).toBe("chair");

    expect(maPlacement).toBeDefined();
    expect(maPlacement.spec.plantOffsetMeters).toEqual({ x: 0.9, y: 0, z: -0.35 });
    expect(maPlacement.spec.supportSurface).toBe("none");

    // Verify status is planned_unsplit (not omitted)
    expect(patientPlacement.status).toBe("planned_unsplit");
    expect(parentPlacement.status).toBe("planned_unsplit");
    expect(maPlacement.status).toBe("planned_unsplit");
  });

  it("(3) multi-case-runner staging_placement station passes authored plantOffsetMeters and supportSurface, not hardcoded 0/posture", async () => {
    const { runPlacementStage } = await import("../dark-factory/multi-case-runner.js");

    // The staging_placement station currently hardcodes:
    //   supportSurface: placement.posture ?? "stretcher"
    //   plantOffsetMeters: 0
    // It must instead read the authored placement from the case and pass it through.

    const stageDir = "/tmp/test-placement-stage";
    const run = await runPlacementStage(clinicKneePainScenarioId, stageDir);

    expect(run.row.classification).toBe("deterministic");
    expect(run.row.artifactPaths.length).toBeGreaterThan(0);

    // Read the artifact and verify it carries the authored offsets
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const artifact = JSON.parse(await readFile(join(stageDir, "placements.json"), "utf8")) as Loose;

    const patientRow = artifact.rows.find((r: Loose) => r.actorId === "patient_jordan_cole_v1");
    const parentRow = artifact.rows.find((r: Loose) => r.actorId === "parent_lena_cole_v1");
    const maRow = artifact.rows.find((r: Loose) => r.actorId === "medical_assistant_rui_park_v1");

    expect(patientRow).toBeDefined();
    expect(patientRow.placement.plantOffsetMeters).toEqual({ x: 0.4, y: 0, z: 0 });
    expect(patientRow.placement.supportSurface).toBe("chair");

    expect(parentRow).toBeDefined();
    expect(parentRow.placement.plantOffsetMeters).toEqual({ x: -0.55, y: 0, z: 0.2 });
    expect(parentRow.placement.supportSurface).toBe("chair");

    expect(maRow).toBeDefined();
    expect(maRow.placement.plantOffsetMeters).toEqual({ x: 0.9, y: 0, z: -0.35 });
    expect(maRow.placement.supportSurface).toBe("none");

    // The hardcoded values must NOT appear
    expect(patientRow.placement.plantOffsetMeters).not.toEqual({ x: 0, y: 0, z: 0 });
    expect(patientRow.placement.supportSurface).not.toBe("stretcher");
  });

  it("(4) headingRadians is populated when the case authors a facing, undefined when absent (never 0)", async () => {
    const mod = await import("../../../packages/openclinxr/asset-registry/src/actor-placement.js");
    const fn = (mod as Record<string, unknown>)["generatedActorPlacement"];
    expect(typeof fn).toBe("function");

    const patient = makeActor("patient_jordan_cole_v1", "patient");
    const parent = makeActor("parent_lena_cole_v1", "family");

    // clinic-knee-pain does NOT author headingRadians (no facing field in placement)
    const casePlacementsNoHeading = {
      patient_jordan_cole_v1: { plantOffsetMeters: { x: 0.4, y: 0, z: 0 }, supportSurface: "chair" },
      parent_lena_cole_v1: { plantOffsetMeters: { x: -0.55, y: 0, z: 0.2 }, supportSurface: "chair" },
    };

    const patientPlacement = fn(patient, 0, { scenarioId: clinicKneePainScenarioId, casePlacements: casePlacementsNoHeading });
    const parentPlacement = fn(parent, 1, { scenarioId: clinicKneePainScenarioId, casePlacements: casePlacementsNoHeading });

    // headingRadians must be undefined when the case does not author a facing
    // Zero is a real heading (facing +X); undefined means "not authored"
    expect(patientPlacement.headingRadians).toBeUndefined();
    expect(parentPlacement.headingRadians).toBeUndefined();

    // Now test with an authored heading
    const casePlacementsWithHeading = {
      patient_jordan_cole_v1: { plantOffsetMeters: { x: 0.4, y: 0, z: 0 }, supportSurface: "chair", headingRadians: Math.PI / 2 },
      parent_lena_cole_v1: { plantOffsetMeters: { x: -0.55, y: 0, z: 0.2 }, supportSurface: "chair" },
    };

    const patientWithHeading = fn(patient, 0, { scenarioId: clinicKneePainScenarioId, casePlacements: casePlacementsWithHeading });
    const parentWithoutHeading = fn(parent, 1, { scenarioId: clinicKneePainScenarioId, casePlacements: casePlacementsWithHeading });

    // Actor with authored heading gets the value
    expect(patientWithHeading.headingRadians).toBe(Math.PI / 2);
    // Actor without authored heading gets undefined (not 0)
    expect(parentWithoutHeading.headingRadians).toBeUndefined();
  });

  it("(5) CONTROL, GREEN ON HEAD AND AFTER: the unauthored ED station keeps its default Z. This is the known-good column, not a target — it passes today and must still pass once clauses 1-4 are green, which is what proves the authored path did not leak into an unauthored station", async () => {
    // The default ED bundle stores patient position {x:-0.9,y:0,z:-0.1} which equals
    // DEFAULT_STRETCHER_POSITION (actor-posture.ts:215). Asserting "it did not move" is
    // vacuous — it passes whether the offset path leaks or not because the value is
    // identical to the default.
    //
    // Discriminator: use the Z component. The ED chest pain patient is at z: -0.1.
    // The clinic-knee-pain patient is at z: 0. The medical_assistant in clinic-knee-pain is at z: -0.35.
    // If the authored offset path leaks into the ED patient, its Z would shift from -0.1.
    // Z is the discriminator because the default stretcher Z is -0.1, not 0, and the
    // clinic-knee-pain patient authored z: 0 would move it if leaked.

    const { createEdChestPainRuntimeSceneManifest } = await import("../../../packages/openclinxr/asset-registry/src/runtime-bundles.js");
    const manifest = createEdChestPainRuntimeSceneManifest({ scenarioId: "ed_chest_pain_priority_v1" });

    const edPatientPlacement = manifest.actorPlacements["patient_robert_hayes_v1"];

    // This is the discriminator: Z must remain exactly -0.1 (DEFAULT_STRETCHER_POSITION.z)
    // If the offset path leaks, it would become 0 (clinic-knee-pain patient z) or -0.35 (MA z)
    expect(edPatientPlacement.position.z).toBe(-0.1);

    // Also assert the full position to catch Loose leak
    expect(edPatientPlacement.position).toEqual({ x: -0.9, y: 0, z: -0.1 });

    // The discriminator component is Z because:
    // - DEFAULT_STRETCHER_POSITION.z = -0.1 (not 0)
    // - clinic-knee-pain patient z = 0 (authored)
    // - clinic-knee-pain MA z = -0.35 (authored)
    // A leak from clinic to ED would change Z from -0.1 to 0 or -0.35
    // X and Y could coincidentally match in some configurations; Z is the clean discriminator.
  });
});