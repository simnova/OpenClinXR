import { describe, expect, it } from "vitest";
import {
  buildEncounterRuntimeRealismEvidenceInputDraft,
  validateEncounterRuntimeRealismEvidenceInputDraft,
} from "./encounter-runtime-realism-evidence-input-draft.js";
import type { EncounterRuntimeSelectionReviewPacket } from "./encounter-runtime-selection-review-packet.js";

describe("encounter runtime realism evidence input draft", () => {
  it("turns runtime-selection hook drafts into metadata-only reviewer evidence inputs", () => {
    const draft = buildEncounterRuntimeRealismEvidenceInputDraft({
      generatedAt: "2026-05-28T00:00:00.000Z",
      reviewPacket: reviewPacketFixture(),
    });

    expect(draft).toMatchObject({
      schemaVersion: "openclinxr.encounter-runtime-realism-evidence-input-draft.v1",
      source: "encounter_runtime_selection_review_packet",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      status: "draft_inputs_required_not_attached",
      runtimeActorEvidenceInputs: expect.arrayContaining([
        expect.objectContaining({
          inputKind: "runtime_realism_signal_input",
          evidenceInputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
          actorId: "patient_maya_johnson_v1",
          requiredSignalCount: 5,
          requiredEvidenceStatus: "required_not_attached",
          providerExecutionStatus: "metadata_only_not_executed",
          claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness",
        }),
      ]),
      visualQaEvidenceInputs: expect.arrayContaining([
        expect.objectContaining({
          inputKind: "visual_qa_review_input",
          evidenceInputId: "visual-qa-evidence-input:pulse_oximeter_equipment",
          targetId: "pulse_oximeter_equipment",
          requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence"],
          requiredEvidenceStatus: "required_not_attached",
          providerExecutionStatus: "metadata_only_not_executed",
          claimBoundary: "visual_qa_evidence_input_metadata_only_not_visual_quality_evidence",
        }),
      ]),
      gateBoundary: {
        providerExecutionAllowed: false,
        providerExecutionPerformed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "runtime_realism_evidence_inputs_do_not_clear_launch_gates",
      },
      blockers: expect.arrayContaining([
        "runtime_realism_evidence_not_attached",
        "runtime_realism_evidence_inputs_not_attached",
        "visual_qa_evidence_inputs_not_attached",
      ]),
      notEvidenceFor: [
        "provider_availability",
        "runtime_readiness",
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
        "learner_launch_readiness",
      ],
    });
    expect(draft.runtimeActorEvidenceInputs).toHaveLength(3);
    expect(draft.visualQaEvidenceInputs).toHaveLength(9);
    expect(validateEncounterRuntimeRealismEvidenceInputDraft(draft)).toEqual({ ok: true, errors: [] });
  });
});

function reviewPacketFixture(): EncounterRuntimeSelectionReviewPacket {
  const runtimeHookDrafts = [
    ["patient_maya_johnson_v1", "patient", 5],
    ["family_mrs_johnson_v1", "family", 4],
    ["nurse_patel_v1", "nurse", 4],
  ].map(([actorId, actorRole, requiredSignalCount]) => ({
    actorId: String(actorId),
    actorRole: String(actorRole),
    requiredSignalCount: Number(requiredSignalCount),
    status: "required_not_attached" as const,
    evidenceRef: `encounter-publication-realism://scenario/request/runtime-realism/${actorId}`,
    claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness" as const,
  }));
  const visualQaHookDrafts = [
    ["patient_maya_johnson_v1", "humanoid_actor"],
    ["family_mrs_johnson_v1", "humanoid_actor"],
    ["nurse_patel_v1", "humanoid_actor"],
    ["pulse_oximeter_equipment", "equipment"],
    ["nebulizer_mask_equipment", "equipment"],
    ["albuterol_vial_equipment", "equipment"],
    ["stethoscope_equipment", "equipment"],
    ["exam_bed_equipment", "equipment"],
    ["inhaler_spacer_equipment", "equipment"],
  ].map(([targetId, targetKind]) => ({
    targetId,
    targetKind,
    requiredReviewFocus: targetKind === "equipment"
      ? ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence"]
      : ["body_profile", "clothing"],
    status: "required_not_attached" as const,
    evidenceRef: `encounter-publication-realism://scenario/request/visual-qa/${targetId}`,
    claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence" as const,
  }));

  return {
    generatedAt: "2026-05-28T00:00:00.000Z",
    schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
    source: "encounter_guarded_runtime_selection_intent",
    selectedScenarioId: "peds_asthma_parent_anxiety_v1",
    selectedEncounterId: "peds_asthma_parent_anxiety_local_encounter",
    selectedStationId: "peds_asthma_parent_anxiety_station_v1",
    selectedRuntimeAssetBundleId: "local_exam_run:peds_asthma_parent_anxiety:runtime-assets",
    reviewPacketMode: "read_only_guarded_runtime_handoff",
    handoffArtifactsInternallyPaired: true,
    runtimeCandidates: {
      model: "local_configured_not_executed",
      voice: "local_configured_not_executed",
    },
    guardedRuntimeSelectorDecision: {
      schemaVersion: "openclinxr.guarded-runtime-selector-disabled-decision.v1",
      selectionStatus: "disabled_guard_not_runtime_execution",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      selectedStationId: "peds_asthma_parent_anxiety_station_v1",
      selectedRuntimeAssetBundleId: "local_exam_run:peds_asthma_parent_anxiety:runtime-assets",
      selectedBundleId: null,
      selectedBundleIdForFutureRuntime: null,
      matchedBundleSummary: null,
      blockers: ["runtime_selector_disabled_guard_not_wired"],
      nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
    },
    publicationPayloadLinkage: {
      source: "encounter_publication_payloads",
      status: "blocked",
      blockers: [],
      localMaterializationHandoff: {
        requestId: "encounter_assets_peds_asthma_parent_anxiety",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        rootPath: ".openclinxr/encounter-factory/peds",
        plannedOutputCount: 2,
        materializedOutputCount: 0,
        allOutputsPlannedMetadataOnly: true,
      },
      assetNeedsReadiness: {
        readyForDeterministicGeneration: true,
        missingRequiredAssetNeedIds: [],
        blockers: [],
        requiredHumanoidRoles: ["patient", "family", "nurse"],
        animationRequirementCount: 3,
        emotionRequirementCount: 3,
        gazeRequirementCount: 3,
        lipSyncRequirementCount: 3,
        sharedAssetLibrarySemanticKeyCount: 1,
      },
      realismEvidenceRefs: {
        claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
        refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
        refs: [],
        runtimeRealismEvidenceHookCount: 3,
        visualQaEvidenceHookCount: 9,
        runtimeRealismEvidenceHooks: [],
        visualQaEvidenceHooks: [],
        requiredBefore: "guarded_runtime_wiring",
        runtimeExecutionAllowed: false,
        providerExecutionPerformed: false,
        questReadinessClaimed: false,
      },
      actorEquipmentMaterializationGate: {
        runtimeSelectionBlockedUntilEvidenceAttached: true,
        actorBlockers: [],
        equipmentBlockers: [],
        caveats: [],
        recommendedNextActions: [],
        claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness",
      },
    },
    operatorReviewReadiness: {
      status: "not_ready_for_operator_review",
      reviewedArtifactCount: 4,
      blockingArtifactCount: 2,
      blockerIds: ["runtime_selector_disabled_guard_not_wired"],
      requiredOperatorActions: ["attach_humanoid_runtime_visual_qa_evidence_refs"],
      materializationRequiredBeforeRuntime: true,
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "operator_review_readiness_metadata_only",
    },
    runtimeRealismEvidenceDraftReview: {
      status: "draft_required_not_attached",
      runtimeRealismEvidenceHookCount: 3,
      visualQaEvidenceHookCount: 9,
      runtimeHookDrafts,
      visualQaHookDrafts,
      blockerIds: ["runtime_realism_evidence_not_attached", "humanoid_visual_qa_evidence_not_attached"],
      recommendedNextActions: ["draft runtime realism evidence from actor hook signals before guarded runtime selection"],
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "runtime_realism_evidence_draft_review_metadata_only",
    },
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    providerExecutionPerformed: false,
    uiLaunchPerformed: false,
    questEvidenceRefreshed: false,
    broadVerificationPerformed: false,
    reviewerChecklist: [],
    blockers: ["runtime_selector_disabled_guard_not_wired"],
    nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
    claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}
