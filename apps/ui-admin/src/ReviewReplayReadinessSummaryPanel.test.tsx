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
