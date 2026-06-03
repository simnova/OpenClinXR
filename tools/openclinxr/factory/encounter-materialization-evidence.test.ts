import { describe, expect, it } from "vitest";
import {
  buildEncounterMaterializationEvidenceReport,
  validateEncounterMaterializationEvidenceReport,
} from "./encounter-materialization-evidence.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

const notEvidenceFor = ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] as const;

describe("encounter materialization evidence", () => {
  it("keeps actor/equipment evidence non-attachable while shared-neutral and generic evidence is missing", () => {
    const report = buildEncounterMaterializationEvidenceReport({
      generatedAt: "2026-05-28T00:00:00.000Z",
      bundleReport: bundleReportFixture(),
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.encounter-materialization-evidence.v1",
      status: "blocked_missing_actor_or_equipment_specific_evidence",
      attachableToRuntimeSelection: false,
      scenarioId: "peds_asthma_parent_anxiety_v1",
      blockers: expect.arrayContaining([
        "shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness",
        "generic_equipment_reuse_blocks_equipment_specific_asset_readiness",
        "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
        "equipment_materialization_evidence_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
      ]),
      actorEvidence: [
        expect.objectContaining({
          actorId: "patient_maya_johnson_v1",
          variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
          requiredEvidenceRefs: expect.arrayContaining([
            "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_body_profile_required",
          ]),
        }),
      ],
      equipmentEvidence: [
        expect.objectContaining({
          equipmentId: "nebulizer_mask_equipment",
          requiredEvidenceRefs: expect.arrayContaining([
            "equipment-materialization-evidence://peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant/scenario_specific_equipment_variant_evidence",
          ]),
        }),
      ],
      claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness",
      notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
    expect(validateEncounterMaterializationEvidenceReport(report)).toEqual({ ok: true, errors: [] });
  });
});

function bundleReportFixture(): GeneratedEdStationRuntimeBundleReport {
  return {
    schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
    generatedAt: "2026-05-28T00:00:00.000Z",
    status: "bundle_ready",
    bundle: null,
    learnerBundle: null,
    actorHumanoidMaterializationContract: {
      schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      actorSpecificVariantKeysRequired: true,
      sharedNeutralMeshReuseDetected: true,
      sharedNeutralMeshReuseActorIds: ["patient_maya_johnson_v1"],
      actorVariants: [{
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        modelAssetId: "openclinxr.peds.patient.generated-humanoid",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
        sourceBlobName: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
        humanoidVariantProfile: {
          ageBand: "child",
          bodyScale: "small_child",
          hairFaceRequired: true,
          clothingLayer: "patient_gown",
          faceEyeLipRigRequired: true,
          idlePoseRequired: true,
          locomotionRequired: true,
        },
        requiredMaterializationCueIds: [
          "actor_specific_body_profile_required",
          "actor_specific_clothing_required",
          "actor_specific_hair_face_required",
          "actor_specific_rig_preservation_required",
        ],
      }],
      materializationBlockers: ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"],
      caveats: ["Shared neutral humanoid reuse is local runtime scaffolding only."],
      recommendedNextAction: "materialize actor-specific Anny humanoid GLBs before treating visual role distinction as asset-level progress",
      notEvidenceFor: [...notEvidenceFor, "animation_quality"],
    },
    equipmentMaterializationContract: {
      schemaVersion: "openclinxr.equipment-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      equipmentSpecificVariantKeysRequired: true,
      genericEquipmentReuseDetected: true,
      genericEquipmentReuseEquipmentIds: ["nebulizer_mask_equipment"],
      equipmentVariants: [{
        equipmentId: "nebulizer_mask_equipment",
        modelAssetId: "openclinxr.peds.nebulizer.generated-equipment",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant",
        sourceBlobName: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb",
        equipmentVariantProfile: {
          equipmentFamily: "nebulizer_mask",
          pediatricUseRequired: true,
          scenarioPlacementRequired: true,
          scaleValidationRequired: true,
          interactionAffordanceRequired: true,
        },
        requiredMaterializationCueIds: [
          "equipment_specific_mesh_required",
          "equipment_specific_scale_required",
          "equipment_specific_placement_required",
          "equipment_specific_affordance_required",
        ],
        requiredEvidenceRefs: [
          "scenario_specific_equipment_variant_evidence",
          "equipment_scale_validation_evidence",
          "equipment_placement_anchor_evidence",
          "clinical_affordance_evidence",
        ],
      }],
      materializationBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
      caveats: ["Generic equipment reuse is local runtime scaffolding only."],
      recommendedNextAction: "materialize equipment-specific generated GLBs or prefabs before treating pediatric equipment as Quest, clinical, scoring, or production-ready",
      notEvidenceFor,
    },
    bundleBlobName: null,
    runtimeAssetReviewDecisions: [],
    blockers: [],
    productionCloudCall: false,
    notEvidenceFor,
  };
}
