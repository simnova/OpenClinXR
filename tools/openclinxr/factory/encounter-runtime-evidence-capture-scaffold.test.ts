import { describe, expect, it } from "vitest";
import {
  buildRuntimeEvidenceCaptureScaffold,
  validateRuntimeEvidenceCaptureScaffold,
} from "./encounter-runtime-evidence-capture-scaffold.js";
import type { EncounterRuntimeRealismEvidenceInputDraft } from "./encounter-runtime-realism-evidence-input-draft.js";

describe("encounter runtime evidence capture scaffold", () => {
  it("turns evidence input drafts into metadata-only attachment candidates", () => {
    const scaffold = buildRuntimeEvidenceCaptureScaffold({
      evidenceInputDraft: evidenceInputDraftFixture(),
      actorPlayerRuntimeEvidence: actorPlayerRuntimeEvidenceFixture(),
    });

    expect(scaffold).toMatchObject({
      schemaVersion: "openclinxr.encounter-runtime-evidence-capture-scaffold.v1",
      generatedAt: "2026-05-28T13:59:11.201Z",
      source: "encounter_runtime_realism_evidence_input_draft",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      selectedRuntimeAssetBundleId: "encounter_assets_peds_asthma_parent_anxiety_executable_v1:runtime-selection-intent",
      status: "metadata_only_attachment_candidates_not_submitted",
      runtimeEvidenceCandidateCount: 3,
      visualQaEvidenceCandidateCount: 2,
      actorPlayerRuntimeEvidenceAttachment: {
        sourceArtifactPath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
        actorCount: 3,
        projectedTurnCount: 9,
        projectedSampleCount: 27,
        actorSummaries: expect.arrayContaining([
          expect.objectContaining({
            actorId: "nurse_kevin_lee_v1",
            roleAnimationClipNames: ["openclinxr_role_nurse_clinical_check_reassure"],
          }),
        ]),
        providerExecutionPerformed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        scenePlacementEvidenceAllowed: false,
        claimBoundary: "metadata_only_actor_player_runtime_evidence_attachment",
      },
      gateBoundary: {
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "runtime_evidence_capture_scaffold_does_not_clear_launch_gates",
      },
      claimBoundary: "metadata_only_runtime_evidence_capture_scaffold_not_runtime_or_visual_evidence",
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
    expect(scaffold.attachmentCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionId: "attach_runtime_realism_evidence_refs",
        inputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
        inputKind: "runtime_realism_signal_input",
        evidenceRef: "runtime-evidence://metadata-only/actor-player-runtime/peds_asthma_parent_anxiety_v1/patient_maya_johnson_v1",
        localArtifactPath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
        sourceEvidenceRef: "encounter-publication-realism://peds/runtime/patient",
        reviewerId: "runtime_evidence_capture_scaffold",
        attachmentStatus: "attached_metadata_only",
        comments: expect.stringContaining("4 case-derived turns and 12 samples"),
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "metadata_only_runtime_evidence_capture_candidate_not_submitted",
      }),
      expect.objectContaining({
        actionId: "attach_visual_qa_evidence_refs",
        inputId: "visual-qa-evidence-input:pulse_oximeter_equipment",
        inputKind: "visual_qa_review_input",
        evidenceRef: "visual-qa-evidence://metadata-only/local-capture-scaffold/peds_asthma_parent_anxiety_v1/pulse_oximeter_equipment",
        attachmentStatus: "attached_metadata_only",
      }),
    ]));
    expect(scaffold.submitRuntimeVisualEvidenceAttachmentInput).toEqual({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      attachments: scaffold.attachmentCandidates.map((candidate) => ({
        actionId: candidate.actionId,
        inputId: candidate.inputId,
        inputKind: candidate.inputKind,
        evidenceRef: candidate.evidenceRef,
        localArtifactPath: candidate.localArtifactPath,
        reviewerId: candidate.reviewerId,
        attachmentStatus: candidate.attachmentStatus,
        comments: candidate.comments,
        attachedAt: candidate.attachedAt,
      })),
    });
    expect(validateRuntimeEvidenceCaptureScaffold(scaffold)).toEqual({ ok: true, errors: [] });
  });
});

function evidenceInputDraftFixture(): EncounterRuntimeRealismEvidenceInputDraft {
  return {
    schemaVersion: "openclinxr.encounter-runtime-realism-evidence-input-draft.v1",
    generatedAt: "2026-05-28T13:59:11.201Z",
    source: "encounter_runtime_selection_review_packet",
    selectedScenarioId: "peds_asthma_parent_anxiety_v1",
    selectedEncounterId: "encounter_assets_peds_asthma_parent_anxiety_executable_v1",
    selectedStationId: "peds_asthma_parent_anxiety_station_v1",
    selectedRuntimeAssetBundleId: "encounter_assets_peds_asthma_parent_anxiety_executable_v1:runtime-selection-intent",
    status: "draft_inputs_required_not_attached",
    runtimeActorEvidenceInputs: [
      ["patient_maya_johnson_v1", "patient", "encounter-publication-realism://peds/runtime/patient"],
      ["parent_tara_johnson_v1", "family", "encounter-publication-realism://peds/runtime/parent"],
      ["nurse_kevin_lee_v1", "nurse", "encounter-publication-realism://peds/runtime/nurse"],
    ].map(([actorId, actorRole, sourceEvidenceRef]) => ({
      evidenceInputId: `runtime-realism-evidence-input:${actorId}`,
      inputKind: "runtime_realism_signal_input" as const,
      actorId,
      actorRole,
      requiredSignalCount: 7,
      sourceEvidenceRef,
      requiredEvidenceStatus: "required_not_attached" as const,
      reviewerAction: "attach_runtime_realism_evidence_metadata_before_guarded_runtime_selection" as const,
      providerExecutionStatus: "metadata_only_not_executed" as const,
      claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness" as const,
    })),
    visualQaEvidenceInputs: [
      ["patient_maya_johnson_v1", "humanoid_actor", "encounter-publication-realism://peds/visual/patient"],
      ["pulse_oximeter_equipment", "equipment", "encounter-publication-realism://peds/visual/pulse-oximeter"],
    ].map(([targetId, targetKind, sourceEvidenceRef]) => ({
      evidenceInputId: `visual-qa-evidence-input:${targetId}`,
      inputKind: "visual_qa_review_input" as const,
      targetId,
      targetKind,
      requiredReviewFocus: ["face_gaze_lip_sync_expression"],
      sourceEvidenceRef,
      requiredEvidenceStatus: "required_not_attached" as const,
      reviewerAction: "attach_visual_qa_evidence_metadata_before_learner_launch_review" as const,
      providerExecutionStatus: "metadata_only_not_executed" as const,
      claimBoundary: "visual_qa_evidence_input_metadata_only_not_visual_quality_evidence" as const,
    })),
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
    blockers: ["runtime_realism_evidence_inputs_not_attached"],
    recommendedNextActions: ["attach reviewed runtime realism evidence metadata"],
    notEvidenceFor: [
      "provider_availability",
      "runtime_readiness",
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "learner_launch_readiness",
    ],
  };
}

function actorPlayerRuntimeEvidenceFixture(): { path: string; evidence: unknown } {
  return {
    path: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
    evidence: {
      actors: [
        actorPlayerActor("patient_maya_johnson_v1", 4, "openclinxr_role_patient_asthma_breathing_effort"),
        actorPlayerActor("parent_tara_johnson_v1", 2, "openclinxr_role_parent_anxious_fidget_guard"),
        actorPlayerActor("nurse_kevin_lee_v1", 3, "openclinxr_role_nurse_clinical_check_reassure"),
      ],
    },
  };
}

function actorPlayerActor(actorId: string, turnCount: number, roleAnimationClipName: string) {
  return {
    actorId,
    caseDerivedTurnSequence: Array.from({ length: turnCount }, (_, index) => ({
      turnId: `${actorId}:turn:${index}`,
      roleAnimationClipName,
      samples: [{ sampleMs: 0, roleAnimationClipName }, { sampleMs: 500, roleAnimationClipName }, { sampleMs: 1000, roleAnimationClipName }],
    })),
  };
}
