import { describe, expect, it } from "vitest";
import type { EncounterMaterializationAttachmentPlan } from "./encounter-materialization-attachment-plan.js";
import {
  buildEncounterMaterializationEvidenceAttachmentRecords,
  type MaterializationEvidenceAttachmentInput,
  validateEncounterMaterializationEvidenceAttachmentRecords,
} from "./encounter-materialization-evidence-attachments.js";

describe("encounter materialization evidence attachments", () => {
  it("satisfies slots only from explicit reviewed local evidence refs while runtime gates stay blocked", () => {
    const records = buildEncounterMaterializationEvidenceAttachmentRecords({
      generatedAt: "2026-05-28T07:40:00.000Z",
      attachmentPlan: attachmentPlanFixture(),
      attachments: attachmentInputsFixture(),
    });

    expect(records).toMatchObject({
      schemaVersion: "openclinxr.encounter-materialization-evidence-attachments.v1",
      source: "encounter_materialization_attachment_plan",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      status: "partial_slots_attached_runtime_blocked",
      actorAttachmentRecords: [
        expect.objectContaining({
          attachmentSlotId: "actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_body_profile_required",
          evidenceAttachmentStatus: "attached_metadata_only",
          slotSatisfiedByEvidence: true,
          attachedEvidenceRefs: [
            "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_body_profile_required",
          ],
          localArtifactPaths: ["docs/openclinxr/materialization-evidence/patient-maya-body-profile-review.json"],
          providerExecutionAllowed: false,
          runtimeSelectionAllowed: false,
          learnerLaunchAllowed: false,
          questEvidenceRefreshAllowed: false,
          claimBoundary: "materialization_evidence_attachment_record_not_runtime_readiness",
        }),
        expect.objectContaining({
          attachmentSlotId: "actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_clothing_required",
          evidenceAttachmentStatus: "held_or_invalid_evidence",
          slotSatisfiedByEvidence: false,
          unsatisfiedReasonIds: [
            "materialization_evidence_attachment_missing:actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_clothing_required",
          ],
        }),
      ],
      equipmentAttachmentRecords: [
        expect.objectContaining({
          attachmentSlotId: "equipment-materialization-attachment:nebulizer_mask_equipment:clinical_affordance_evidence",
          evidenceAttachmentStatus: "missing_evidence",
          slotSatisfiedByEvidence: false,
          unsatisfiedReasonIds: [
            "materialization_evidence_attachment_missing:equipment-materialization-attachment:nebulizer_mask_equipment:clinical_affordance_evidence",
          ],
        }),
      ],
      attachmentCompleteness: {
        totalRequiredSlotCount: 3,
        attachedSlotCount: 1,
        missingSlotCount: 2,
        heldOrInvalidAttachmentCount: 1,
        allRequiredSlotsSatisfied: false,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "materialization_evidence_attachment_completeness_not_runtime_readiness",
      },
      blockers: expect.arrayContaining([
        "materialization_evidence_attachment_missing:actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_clothing_required",
        "materialization_evidence_attachment_missing:equipment-materialization-attachment:nebulizer_mask_equipment:clinical_affordance_evidence",
      ]),
      claimBoundary: "materialization_evidence_attachments_not_provider_or_runtime_execution",
      notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    });
    expect(validateEncounterMaterializationEvidenceAttachmentRecords(records)).toEqual({ ok: true, errors: [] });
  });
});

function attachmentInputsFixture(): MaterializationEvidenceAttachmentInput[] {
  return [
    {
      attachmentSlotId: "actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_body_profile_required",
      evidenceRef: "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_body_profile_required",
      artifactKind: "actor_specific_humanoid_glb",
      localArtifactPath: "docs/openclinxr/materialization-evidence/patient-maya-body-profile-review.json",
      reviewStatus: "reviewed_metadata_only",
      provenanceRef: "local-review://asset-pipeline/patient-maya-body-profile",
      providerExecutionPerformed: false,
      runtimeReadinessClaimed: false,
      questReadinessClaimed: false,
      productionAssetReadinessClaimed: false,
      claimBoundary: "local_materialization_evidence_ref_not_runtime_readiness",
    },
    {
      attachmentSlotId: "actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_clothing_required",
      evidenceRef: "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_clothing_required",
      artifactKind: "actor_materialization_review_packet",
      localArtifactPath: "docs/openclinxr/materialization-evidence/patient-maya-clothing-review.json",
      reviewStatus: "held_metadata_only",
      provenanceRef: "local-review://asset-pipeline/patient-maya-clothing",
      providerExecutionPerformed: false,
      runtimeReadinessClaimed: false,
      questReadinessClaimed: false,
      productionAssetReadinessClaimed: false,
      claimBoundary: "local_materialization_evidence_ref_not_runtime_readiness",
    },
  ];
}

function attachmentPlanFixture(): EncounterMaterializationAttachmentPlan {
  return {
    schemaVersion: "openclinxr.encounter-materialization-attachment-plan.v1",
    generatedAt: "2026-05-28T07:00:00.000Z",
    source: "encounter_materialization_input_manifest",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    status: "attachment_slots_created_not_evidence_attached",
    attachableToRuntimeSelection: false,
    actorAttachmentSlots: [
      {
        attachmentSlotId: "actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_body_profile_required",
        workOrderInputId: "actor-materialization-input:patient_maya_johnson_v1",
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
        requiredCueId: "actor_specific_body_profile_required",
        requiredEvidenceRef: "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_body_profile_required",
        expectedArtifactKinds: ["actor_specific_humanoid_glb", "actor_materialization_review_packet", "humanoid_visual_qa_reference"],
        attachmentStatus: "missing_evidence",
        providerExecutionAllowed: false,
        runtimeSelectionAllowed: false,
        claimBoundary: "materialization_attachment_slot_not_runtime_readiness",
      },
      {
        attachmentSlotId: "actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_clothing_required",
        workOrderInputId: "actor-materialization-input:patient_maya_johnson_v1",
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
        requiredCueId: "actor_specific_clothing_required",
        requiredEvidenceRef: "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_clothing_required",
        expectedArtifactKinds: ["actor_specific_humanoid_glb", "actor_materialization_review_packet", "humanoid_visual_qa_reference"],
        attachmentStatus: "missing_evidence",
        providerExecutionAllowed: false,
        runtimeSelectionAllowed: false,
        claimBoundary: "materialization_attachment_slot_not_runtime_readiness",
      },
    ],
    equipmentAttachmentSlots: [
      {
        attachmentSlotId: "equipment-materialization-attachment:nebulizer_mask_equipment:clinical_affordance_evidence",
        workOrderInputId: "equipment-materialization-input:nebulizer_mask_equipment",
        equipmentId: "nebulizer_mask_equipment",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant",
        requiredCueId: "clinical_affordance_evidence",
        requiredEvidenceRef: "equipment-materialization-evidence://peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant/clinical_affordance_evidence",
        expectedArtifactKinds: ["equipment_specific_glb_or_prefab", "equipment_scale_placement_review_packet", "clinical_affordance_review_packet"],
        attachmentStatus: "missing_evidence",
        providerExecutionAllowed: false,
        runtimeSelectionAllowed: false,
        claimBoundary: "materialization_attachment_slot_not_runtime_readiness",
      },
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
    blockers: [
      "actor_materialization_attachment_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
      "actor_materialization_attachment_missing:patient_maya_johnson_v1:actor_specific_clothing_required",
      "equipment_materialization_attachment_missing:nebulizer_mask_equipment:clinical_affordance_evidence",
    ],
    recommendedNextActions: ["attach reviewed local materialization evidence refs"],
    claimBoundary: "materialization_attachment_plan_not_provider_or_runtime_execution",
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}
