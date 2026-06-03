import { describe, expect, it } from "vitest";
import type { EncounterMaterializationEvidenceReport } from "./encounter-materialization-evidence.js";
import {
  buildEncounterMaterializationInputManifest,
  validateEncounterMaterializationInputManifest,
} from "./encounter-materialization-input-manifest.js";

describe("encounter materialization input manifest", () => {
  it("groups actor and equipment evidence refs into provider-neutral metadata-only work-order inputs", () => {
    const manifest = buildEncounterMaterializationInputManifest({
      generatedAt: "2026-05-28T00:00:00.000Z",
      evidenceReport: evidenceReportFixture(),
    });

    expect(manifest).toMatchObject({
      schemaVersion: "openclinxr.encounter-materialization-input-manifest.v1",
      source: "encounter_materialization_evidence_report",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      status: "planned_metadata_only_blocked_until_provider_approval",
      actorWorkOrderInputs: [
        expect.objectContaining({
          workOrderInputId: "actor-materialization-input:patient_maya_johnson_v1",
          actorId: "patient_maya_johnson_v1",
          requiredCueIds: ["actor_specific_body_profile_required", "actor_specific_clothing_required"],
          targetCapabilityIds: ["character-generation", "animation-generation", "asset-bake"],
          providerExecutionStatus: "metadata_only_not_executed",
          claimBoundary: "provider_neutral_materialization_input_not_asset_readiness",
        }),
      ],
      equipmentWorkOrderInputs: [
        expect.objectContaining({
          workOrderInputId: "equipment-materialization-input:nebulizer_mask_equipment",
          equipmentId: "nebulizer_mask_equipment",
          requiredCueIds: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence"],
          targetCapabilityIds: ["medical-equipment-generation", "asset-bake"],
          providerExecutionStatus: "metadata_only_not_executed",
        }),
      ],
      providerBoundary: {
        providerExecutionPerformed: false,
        paidApisUsed: false,
        externalNetworkUsed: false,
        productionAssetReadinessClaimed: false,
        questReadinessClaimed: false,
        runtimeReadinessClaimed: false,
        claimBoundary: "provider_neutral_input_manifest_no_execution",
      },
      blockers: expect.arrayContaining([
        "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
        "equipment_materialization_evidence_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
      ]),
    });
    expect(validateEncounterMaterializationInputManifest(manifest)).toEqual({ ok: true, errors: [] });
  });
});

function evidenceReportFixture(): EncounterMaterializationEvidenceReport {
  return {
    schemaVersion: "openclinxr.encounter-materialization-evidence.v1",
    generatedAt: "2026-05-28T00:00:00.000Z",
    source: "generated_station_runtime_bundle_materialization_contracts",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    status: "blocked_missing_actor_or_equipment_specific_evidence",
    attachableToRuntimeSelection: false,
    actorEvidence: [{
      actorId: "patient_maya_johnson_v1",
      actorRole: "patient",
      variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
      sourceBlobName: ".openclinxr/asset-production/neutral-generated-human.glb",
      requiredEvidenceRefs: [
        "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_body_profile_required",
        "actor-materialization-evidence://peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant/actor_specific_clothing_required",
      ],
      blockers: [
        "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
        "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_clothing_required",
      ],
    }],
    equipmentEvidence: [{
      equipmentId: "nebulizer_mask_equipment",
      variantSemanticKey: "peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant",
      sourceBlobName: ".openclinxr/asset-production/ecg-cart-12-lead.glb",
      requiredEvidenceRefs: [
        "equipment-materialization-evidence://peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant/scenario_specific_equipment_variant_evidence",
        "equipment-materialization-evidence://peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant/equipment_scale_validation_evidence",
      ],
      blockers: [
        "equipment_materialization_evidence_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
        "equipment_materialization_evidence_missing:nebulizer_mask_equipment:equipment_scale_validation_evidence",
      ],
    }],
    blockers: [
      "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
      "equipment_materialization_evidence_missing:nebulizer_mask_equipment:scenario_specific_equipment_variant_evidence",
    ],
    recommendedNextActions: ["materialize provider-neutral inputs after approval"],
    claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness",
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}
