import { describe, expect, it } from "vitest";
import {
  buildEncounterMaterializationAttachmentPlan,
  validateEncounterMaterializationAttachmentPlan,
} from "./encounter-materialization-attachment-plan.js";
import type { EncounterMaterializationInputManifest } from "./encounter-materialization-input-manifest.js";

describe("encounter materialization attachment plan", () => {
  it("creates reusable missing-evidence attachment slots without provider or runtime execution", () => {
    const plan = buildEncounterMaterializationAttachmentPlan({
      generatedAt: "2026-05-28T07:00:00.000Z",
      inputManifest: inputManifestFixture(),
    });

    expect(plan).toMatchObject({
      schemaVersion: "openclinxr.encounter-materialization-attachment-plan.v1",
      source: "encounter_materialization_input_manifest",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      status: "attachment_slots_created_not_evidence_attached",
      attachableToRuntimeSelection: false,
      actorAttachmentSlots: [
        expect.objectContaining({
          attachmentSlotId: "actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_body_profile_required",
          workOrderInputId: "actor-materialization-input:patient_maya_johnson_v1",
          actorId: "patient_maya_johnson_v1",
          actorRole: "patient",
          requiredCueId: "actor_specific_body_profile_required",
          expectedArtifactKinds: ["actor_specific_humanoid_glb", "actor_materialization_review_packet", "humanoid_visual_qa_reference"],
          attachmentStatus: "missing_evidence",
          providerExecutionAllowed: false,
          runtimeSelectionAllowed: false,
          claimBoundary: "materialization_attachment_slot_not_runtime_readiness",
        }),
      ],
      equipmentAttachmentSlots: [
        expect.objectContaining({
          attachmentSlotId: "equipment-materialization-attachment:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
          workOrderInputId: "equipment-materialization-input:nebulizer_mask_equipment",
          equipmentId: "nebulizer_mask_equipment",
          requiredCueId: "scenario_specific_equipment_variant_evidence",
          expectedArtifactKinds: ["equipment_specific_glb_or_prefab", "equipment_scale_placement_review_packet", "clinical_affordance_review_packet"],
          attachmentStatus: "missing_evidence",
          providerExecutionAllowed: false,
          runtimeSelectionAllowed: false,
        }),
      ],
      attachmentBoundary: {
        providerExecutionPerformed: false,
        paidApisUsed: false,
        externalNetworkUsed: false,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "materialization_attachment_plan_metadata_only",
      },
      blockers: expect.arrayContaining([
        "actor_materialization_attachment_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
        "equipment_materialization_attachment_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
      ]),
      claimBoundary: "materialization_attachment_plan_not_provider_or_runtime_execution",
      notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
    expect(validateEncounterMaterializationAttachmentPlan(plan)).toEqual({ ok: true, errors: [] });
  });
});

function inputManifestFixture(): EncounterMaterializationInputManifest {
  return {
    schemaVersion: "openclinxr.encounter-materialization-input-manifest.v1",
    generatedAt: "2026-05-28T00:00:00.000Z",
    source: "encounter_materialization_evidence_report",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    status: "planned_metadata_only_blocked_until_provider_approval",
    actorWorkOrderInputs: [{
      workOrderInputId: "actor-materialization-input:patient_maya_johnson_v1",
      actorId: "patient_maya_johnson_v1",
      actorRole: "patient",
      variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
      sourceBlobName: ".openclinxr/asset-production/neutral-generated-human.glb",
      requiredEvidenceRefs: [
        "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_body_profile_required",
      ],
      requiredCueIds: ["actor_specific_body_profile_required"],
      blockerIds: ["actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required"],
      targetCapabilityIds: ["character-generation", "animation-generation", "asset-bake"],
      providerExecutionStatus: "metadata_only_not_executed",
      claimBoundary: "provider_neutral_materialization_input_not_asset_readiness",
    }],
    equipmentWorkOrderInputs: [{
      workOrderInputId: "equipment-materialization-input:nebulizer_mask_equipment",
      equipmentId: "nebulizer_mask_equipment",
      variantSemanticKey: "peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant",
      sourceBlobName: ".openclinxr/asset-production/ecg-cart-12-lead.glb",
      requiredEvidenceRefs: [
        "equipment-materialization-evidence://peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant/scenario_specific_equipment_variant_evidence",
      ],
      requiredCueIds: ["scenario_specific_equipment_variant_evidence"],
      blockerIds: ["equipment_materialization_evidence_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence"],
      targetCapabilityIds: ["medical-equipment-generation", "asset-bake"],
      providerExecutionStatus: "metadata_only_not_executed",
      claimBoundary: "provider_neutral_materialization_input_not_asset_readiness",
    }],
    providerBoundary: {
      providerExecutionPerformed: false,
      paidApisUsed: false,
      externalNetworkUsed: false,
      productionAssetReadinessClaimed: false,
      questReadinessClaimed: false,
      runtimeReadinessClaimed: false,
      claimBoundary: "provider_neutral_input_manifest_no_execution",
    },
    blockers: [
      "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
      "equipment_materialization_evidence_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
    ],
    recommendedNextActions: ["review provider-neutral work-order inputs before approving any provider execution"],
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}
