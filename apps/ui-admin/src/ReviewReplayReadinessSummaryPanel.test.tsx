import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminCaseDefinedHumanoidPerformanceContract, AdminReviewPacketReplay } from "./api-client.js";
import { ReviewReplayReadinessSummaryPanel } from "./ReviewReplayReadinessSummaryPanel.js";

type ReviewReplayReadinessSummary = NonNullable<AdminReviewPacketReplay["reviewReplayReadinessSummary"]>;

describe("ReviewReplayReadinessSummaryPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("surfaces review-safe XR trace evidence without readiness claims", () => {
    render(
      <ReviewReplayReadinessSummaryPanel
        summary={summaryFixture()}
        humanoidPerformanceContract={humanoidPerformanceContractFixture()}
      />,
    );

    const panel = screen.getByLabelText("Review replay readiness summary");
    const xrHandoff = within(panel).getByLabelText("XR trace evidence handoff");
    expect(xrHandoff).toHaveTextContent("ecg_request");
    expect(xrHandoff).toHaveTextContent("ui_xr_runtime_trace");
    expect(xrHandoff).toHaveTextContent("distance 0.4m; turn 0.12rad");
    expect(xrHandoff).toHaveTextContent("trace_action:ecg_request, dom_click_trace_button");
    expect(xrHandoff).toHaveTextContent("12.5ms latest latency");
    expect(xrHandoff).toHaveTextContent("window.__openClinXrTraceActionHandoffEvidence");
    expect(xrHandoff).toHaveTextContent("headset_input_not_claimed");
    expect(xrHandoff).toHaveTextContent("xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness");
    expect(panel).toHaveTextContent("not approve score use, clinical-validity, live provider readiness, Quest-readiness, or production release");
    expect(panel).toHaveTextContent("Summary packet readiness only");
    expect(panel).toHaveTextContent("XR trace summary only");
    const runtimeVisualReplay = within(panel).getByLabelText("Runtime visual evidence replay projection");
    expect(runtimeVisualReplay).toHaveTextContent("2 accepted metadata refs");
    expect(runtimeVisualReplay).toHaveTextContent("1 runtime refs; 1 visual QA refs");
    expect(runtimeVisualReplay).toHaveTextContent("2 reviewed; 0 held");
    expect(runtimeVisualReplay).toHaveTextContent("Raw payload not displayed");
    expect(runtimeVisualReplay).toHaveTextContent("Replay evidence still blocked");
    expect(runtimeVisualReplay).toHaveTextContent("runtime false; learner false; Quest false");
    expect(runtimeVisualReplay).toHaveTextContent("runtime_visual_evidence_refs_are_metadata_only_not_replay_payloads");
    expect(runtimeVisualReplay).toHaveTextContent("summary_only_runtime_visual_evidence_replay_projection_not_raw_payload_or_readiness");
    const uiXrWorkflow = within(panel).getByLabelText("UI-XR consumer operator workflow summary");
    expect(uiXrWorkflow).toHaveTextContent("POST /runtime/visual-evidence-attachments");
    expect(uiXrWorkflow).toHaveTextContent("submitRuntimeVisualEvidenceAttachmentInput");
    expect(uiXrWorkflow).toHaveTextContent("2 UI-XR metadata refs");
    expect(uiXrWorkflow).toHaveTextContent("1 runtime refs; 1 visual QA refs");
    expect(uiXrWorkflow).toHaveTextContent("2 submit-preview refs");
    expect(uiXrWorkflow).toHaveTextContent("operator-selectable up to 2");
    expect(uiXrWorkflow).toHaveTextContent("subset-via-count");
    expect(uiXrWorkflow).toHaveTextContent("runtime-realism-evidence-input:patient_robert_hayes_v1");
    expect(uiXrWorkflow).toHaveTextContent("visual-qa-evidence-input:ecg_monitor_equipment");
    expect(uiXrWorkflow).toHaveTextContent("2 local artifact refs");
    expect(uiXrWorkflow).toHaveTextContent("ui_xr_consumer_workflow_submit_preview_metadata_only");
    expect(uiXrWorkflow).toHaveTextContent("Raw UI-XR payload hidden");
    expect(uiXrWorkflow).toHaveTextContent("submit_metadata_only_runtime_visual_evidence_refs");
    expect(uiXrWorkflow).toHaveTextContent("scenario_id_matches_payload_and_expected_scenario");
    expect(uiXrWorkflow).toHaveTextContent("all_execution_and_readiness_gates_false");
    expect(uiXrWorkflow).toHaveTextContent("ui_xr_consumer_refs_are_metadata_only_not_runtime_or_visual_proof");
    const uiXrWorkflowNextActions = within(panel).getByLabelText("UI-XR consumer operator workflow next actions");
    expect(uiXrWorkflowNextActions).toHaveTextContent("submit 2 metadata-only UI-XR runtime/visual refs through the guarded attachment route");
    expect(uiXrWorkflowNextActions).toHaveTextContent("confirm Admin replay projection shows raw payload hidden and all readiness gates false");
    expect(uiXrWorkflowNextActions).toHaveTextContent("keep runtime, learner, Quest, production, clinical, and scoring gates blocked");
    const runtimeVisualReplayNextActions = within(panel).getByLabelText("Runtime visual evidence replay next actions");
    expect(runtimeVisualReplayNextActions).toHaveTextContent("review 2 accepted metadata-only runtime/visual refs before scenario iteration");
    expect(runtimeVisualReplayNextActions).toHaveTextContent("carry forward projection blockers runtime_visual_evidence_refs_are_metadata_only_not_replay_payloads");
    expect(runtimeVisualReplayNextActions).toHaveTextContent("keep runtime, learner, Quest, production, clinical, and scoring gates blocked");
    const assetReleaseReplay = within(panel).getByLabelText("Asset release ladder replay projection");
    expect(assetReleaseReplay).toHaveTextContent("3 blocked assets");
    expect(assetReleaseReplay).toHaveTextContent("5 total; 2 release-ladder complete");
    expect(assetReleaseReplay).toHaveTextContent("4 release blockers");
    expect(assetReleaseReplay).toHaveTextContent("patient_robert_hayes_character:provenance_license");
    expect(assetReleaseReplay).toHaveTextContent("Production release blocked");
    expect(assetReleaseReplay).toHaveTextContent("runtime false; learner false; Quest false");
    expect(assetReleaseReplay).toHaveTextContent("summary_only_asset_release_ladder_replay_projection_not_release_readiness");
    const humanoidContract = within(panel).getByLabelText("Case-defined humanoid performance metadata");
    expect(humanoidContract).toHaveTextContent("3 humanoid actors");
    expect(humanoidContract).toHaveTextContent("2 emotion states");
    expect(humanoidContract).toHaveTextContent("patient, nurse, family");
    expect(humanoidContract).toHaveTextContent("dialogueDrivenVisemeMappingRequired:true");
    expect(humanoidContract).toHaveTextContent("gazeTargetingRequired:true");
    expect(humanoidContract).toHaveTextContent("locomotionPlanningRequired:true");
    expect(humanoidContract).toHaveTextContent("case_definition_humanoid_performance_metadata_only");
    expect(humanoidContract).toHaveTextContent("generated_humanoid_asset_readiness");
    expect(humanoidContract).toHaveTextContent("animation_quality");
    expect(humanoidContract).toHaveTextContent("quest_readiness");
    expect(humanoidContract).toHaveTextContent("runtime_readiness");
    expect(humanoidContract).toHaveTextContent("clinical_validity");
    const handoff = within(panel).getByLabelText("Case-defined humanoid runtime handoff");
    expect(handoff).toHaveTextContent("patient");
    expect(handoff).toHaveTextContent("animated_humanoid_runtime_playback");
    expect(handoff).toHaveTextContent("case_definition_humanoid_runtime_handoff_metadata_only");
    expect(panel).toHaveTextContent("caseDefinedHumanoidRuntimeHandoff");
    expect(panel).toHaveTextContent("not generated-humanoid-asset readiness");
    expect(panel).toHaveTextContent("not runtime-readiness");
    expect(panel).toHaveTextContent("not Quest-readiness");
    expect(panel.textContent).not.toContain("Quest ready");
    expect(panel.textContent).not.toContain("score ready");
    expect(panel.textContent).not.toContain("clinically valid");
    expect(panel.textContent).not.toContain("runtime ready");
  });
});

function summaryFixture(): ReviewReplayReadinessSummary {
  return {
    stationRunId: "station_run_001",
    replayEvidenceReady: false,
    facultyReviewSafe: false,
    timelineEntryCount: 1,
    traceEventCount: 1,
    durableEventCount: 1,
    redactedDurableEventCount: 1,
    missingRequiredBehaviorCount: 1,
    lateBehaviorCount: 0,
    safetySignalCount: 0,
    blockers: ["missing_required_behavior"],
    recommendedNextAction: "review_missing_required_behavior",
    replayBoundary: "summary_only_faculty_review_not_score_use",
    caseDefinedHumanoidRuntimeHandoff: [
      {
        claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
        actorRole: "patient",
        workOrderIds: ["actor_asset_work_order:ed_chest_pain_priority_v1:patient_robert_hayes_v1"],
        locomotionRequired: true,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactiveRequired: true,
        requiredSignalIds: [
          "animated_humanoid_runtime_playback",
          "dialogue_eye_micro_saccade_blink_cue",
          "generated_eyelid_blink_control_cue",
        ],
        blockers: [
          "runtime_realism_evidence_not_attached_to_encounter_bundle",
          "visual_qa_evidence_not_attached_to_encounter_bundle",
        ],
        notEvidenceFor: [
          "generated_humanoid_asset_readiness",
          "animation_quality",
          "quest_readiness",
          "runtime_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      },
    ],
    xrTraceEvidenceSummary: {
      stationRunId: "station_run_001",
      source: "ui_xr_runtime_trace",
      evidenceRef: "window.__openClinXrTraceActionHandoffEvidence",
      activeLocomotionSource: "keyboard",
      locomotionDistanceMeters: 0.4,
      locomotionTurnRadians: 0.12,
      interactionSignalRefs: ["trace_action:ecg_request", "dom_click_trace_button"],
      latestTraceTag: "ecg_request",
      latestTraceLatencyMs: 12.5,
      blockers: ["headset_input_not_claimed"],
      claimBoundary: "xr_trace_evidence_summary_not_score_use_quest_readiness_clinical_validity_or_raw_payload_readiness",
    },
    runtimeVisualEvidenceReplayProjection: {
      schemaVersion: "openclinxr.runtime-visual-evidence-replay-projection.v1",
      source: "runtime_visual_evidence_attachment_record_summary",
      stationRunId: "station_run_001",
      scenarioId: "ed_chest_pain_priority_v1",
      reviewedMetadataOnlyCount: 2,
      heldMetadataOnlyCount: 0,
      acceptedAttachmentRefCount: 2,
      runtimeEvidenceRefCount: 1,
      visualQaEvidenceRefCount: 1,
      acceptedActionIds: ["attach_runtime_realism_evidence_refs", "attach_visual_qa_evidence_refs"],
      rawPayloadDisplayed: false,
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      replayEvidenceReady: false,
      blockerIds: ["runtime_visual_evidence_refs_are_metadata_only_not_replay_payloads"],
      uiXrConsumerOperatorWorkflowSummary: {
        schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-workflow-summary.v1",
        source: "ui_xr_runtime_evidence_consumer_operator_workflow",
        scenarioId: "ed_chest_pain_priority_v1",
        acceptedAttachmentRefCount: 2,
        runtimeEvidenceRefCount: 1,
        visualQaEvidenceRefCount: 1,
        targetRoute: "/runtime/visual-evidence-attachments",
        method: "POST",
        submitBodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
        submitPreview: {
          route: "/runtime/visual-evidence-attachments",
          bodyRef: "submitRuntimeVisualEvidenceAttachmentInput",
          attachmentCount: 2,
          operatorSelectableAttachmentCount: 2,
          operatorSelectionEnabled: true,
          operatorSelectionSupport: 'subset-via-count',
          actionIds: ["attach_runtime_realism_evidence_refs", "attach_visual_qa_evidence_refs"],
          inputIds: [
            "runtime-realism-evidence-input:patient_robert_hayes_v1",
            "visual-qa-evidence-input:ecg_monitor_equipment",
          ],
          localArtifactPaths: [
            "ui-xr/manual-performance-evidence/ed_chest_pain_priority_v1/patient_robert_hayes_v1-runtime-realism.json",
            "ui-xr/manual-performance-evidence/ed_chest_pain_priority_v1/ecg_monitor_equipment-visual-qa.json",
          ],
          rawPayloadDisplayed: false,
          claimBoundary: "ui_xr_consumer_workflow_submit_preview_metadata_only",
        },
        reviewerAction: "submit_metadata_only_runtime_visual_evidence_refs",
        preflightChecks: [
          "scenario_id_matches_payload_and_expected_scenario",
          "attachments_non_empty",
          "raw_payload_hidden",
          "all_execution_and_readiness_gates_false",
        ],
        nextActions: [
          "submit 2 metadata-only UI-XR runtime/visual refs through the guarded attachment route",
          "confirm Admin replay projection shows raw payload hidden and all readiness gates false",
          "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until real runtime and visual-QA evidence clears review",
        ],
        rawPayloadDisplayed: false,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        blockerIds: ["ui_xr_consumer_refs_are_metadata_only_not_runtime_or_visual_proof"],
        claimBoundary: "summary_only_ui_xr_consumer_workflow_not_raw_payload_or_readiness",
        notEvidenceFor: [
          "raw_payload_display",
          "runtime_readiness",
          "learner_launch_readiness",
          "quest_readiness",
          "production_asset_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      },
      claimBoundary: "summary_only_runtime_visual_evidence_replay_projection_not_raw_payload_or_readiness",
      notEvidenceFor: [
        "raw_payload_display",
        "runtime_readiness",
        "learner_launch_readiness",
        "quest_readiness",
        "production_asset_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    },
    assetReleaseLadderReplayProjection: {
      schemaVersion: "openclinxr.asset-release-ladder-replay-projection.v1",
      source: "scenario_asset_production_readiness_ladder",
      scenarioId: "ed_chest_pain_priority_v1",
      productionReady: false,
      assetCount: 5,
      productionReadyAssetCount: 2,
      blockedAssetCount: 3,
      missingRequiredAssetCount: 0,
      stationBudgetStatus: "ready",
      blockerCount: 4,
      blockerIds: [
        "patient_robert_hayes_character:placeholder_asset_not_clinical_release_ready",
        "patient_robert_hayes_character:provenance_license_missing",
        "ed_exam_bay_v1:quest_qa_missing",
        "ecg_monitor_equipment:visual_clinical_critique_missing",
      ],
      blockedAssets: [
        {
          assetId: "patient_robert_hayes_character",
          blockerCount: 2,
          firstBlockedStep: "provenance_license",
          blockerIds: [
            "placeholder_asset_not_clinical_release_ready",
            "provenance_license_missing",
          ],
        },
      ],
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "summary_only_asset_release_ladder_replay_projection_not_release_readiness",
      notEvidenceFor: [
        "provider_availability",
        "runtime_readiness",
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
        "learner_launch_readiness",
      ],
    },
  };
}

function humanoidPerformanceContractFixture(): AdminCaseDefinedHumanoidPerformanceContract {
  return {
    claimBoundary: "case_definition_humanoid_performance_metadata_only" as const,
    actorCount: 3,
    locomotionActorRoles: ["patient", "nurse", "family"],
    expressionActorRoles: ["patient", "nurse", "family"],
    gazeActorRoles: ["patient", "nurse", "family"],
    lipSyncActorRoles: ["patient", "nurse", "family"],
    interactiveActorRoles: ["patient", "nurse", "family"],
    emotionStateCount: 2,
    dialogueDrivenVisemeMappingRequired: true,
    gazeTargetingRequired: true,
    locomotionPlanningRequired: true,
    notEvidenceFor: [
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
    ],
  };
}
