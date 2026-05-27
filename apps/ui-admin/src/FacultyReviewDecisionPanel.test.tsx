import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminCaseDefinedHumanoidPerformanceContract, AdminReviewPacketReplay } from "./api-client.js";
import { FacultyReviewDecisionPanel } from "./FacultyReviewDecisionPanel.js";

type ReviewPacket = NonNullable<AdminReviewPacketReplay["reviewPacket"]>;
type ClinicalEventReviewSummary = NonNullable<AdminReviewPacketReplay["clinicalEventReviewSummary"]>;

describe("FacultyReviewDecisionPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("surfaces deterministic review blocker ids without score-use or clinical-validity claims", () => {
    render(
      <FacultyReviewDecisionPanel
        packet={reviewPacketFixture()}
        clinicalEventReviewSummary={clinicalEventReviewSummaryFixture()}
        reviewReplayReadinessSummary={reviewReplayReadinessSummaryFixture()}
        humanoidPerformanceContract={humanoidPerformanceContractFixture()}
        traceEventCount={1}
        safetyFlagLabels={["unsafe empathy response"]}
      />,
    );

    const panel = screen.getByLabelText("Faculty review decision handoff");
    const blockerList = within(panel).getByLabelText("Faculty review blocker IDs");
    expect(blockerList).toHaveTextContent("durable_summary_requires_redaction_review");
    expect(blockerList).toHaveTextContent("missing_required_behavior:focused_exam");
    expect(blockerList).toHaveTextContent("late_behavior:oral_handoff");
    expect(blockerList).toHaveTextContent("safety_signal:unsafe empathy response");
    expect(within(panel).getByLabelText("Canonical replay readiness blocker IDs")).toHaveTextContent("missing_required_behavior");
    expect(panel).toHaveTextContent("Canonical replay action: review_missing_required_behavior");
    expect(within(panel).getByLabelText("XR trace evidence handoff")).toHaveTextContent("latest ecg_request from ui_xr_runtime_trace");
    const humanoidContract = within(panel).getByLabelText("Case-defined humanoid performance metadata");
    expect(humanoidContract).toHaveTextContent("3 humanoid actors");
    expect(humanoidContract).toHaveTextContent("2 emotion states");
    expect(humanoidContract).toHaveTextContent("locomotion roles patient, nurse, family");
    expect(humanoidContract).toHaveTextContent("expression roles patient, nurse, family");
    expect(humanoidContract).toHaveTextContent("gaze roles patient, nurse, family");
    expect(humanoidContract).toHaveTextContent("lip-sync roles patient, nurse, family");
    expect(humanoidContract).toHaveTextContent("interactive roles patient, nurse, family");
    expect(humanoidContract).toHaveTextContent("dialogueDrivenVisemeMappingRequired:true");
    expect(humanoidContract).toHaveTextContent("gazeTargetingRequired:true");
    expect(humanoidContract).toHaveTextContent("locomotionPlanningRequired:true");
    expect(humanoidContract).toHaveTextContent("case_definition_humanoid_performance_metadata_only");
    expect(humanoidContract).toHaveTextContent("generated_humanoid_asset_readiness");
    expect(humanoidContract).toHaveTextContent("animation_quality");
    expect(humanoidContract).toHaveTextContent("quest_readiness");
    expect(humanoidContract).toHaveTextContent("runtime_readiness");
    expect(humanoidContract).toHaveTextContent("clinical_validity");
    const remediationPlanningContext = within(panel).getByLabelText("Remediation planning context");
    expect(remediationPlanningContext).toHaveTextContent("runtime remediation plan ref: remediation-plan:ed-chest-pain-runtime-evidence");
    expect(remediationPlanningContext).toHaveTextContent("local-voice-provider: disabled");
    expect(remediationPlanningContext).toHaveTextContent("provider_disabled_remediation_metadata_not_runtime_readiness");
    expect(panel).toHaveTextContent("Metadata only for admin/faculty planning");
    const reviewerDecisionPosture = within(panel).getByLabelText("Reviewer decision posture metrics");
    expect(reviewerDecisionPosture).toHaveTextContent("1 timeline entry");
    expect(reviewerDecisionPosture).toHaveTextContent("latest at 12s");
    expect(reviewerDecisionPosture).toHaveTextContent("Faculty draft draft");
    expect(reviewerDecisionPosture).toHaveTextContent("reviewer faculty_001");
    expect(reviewerDecisionPosture).toHaveTextContent("Draft comments empty");
    expect(reviewerDecisionPosture).toHaveTextContent("Patient note missing");
    expect(reviewerDecisionPosture).toHaveTextContent("1 trace-quality missing tag");
    expect(panel).toHaveTextContent("This is a local faculty review aid");
    expect(panel).toHaveTextContent("Faculty decision support only");
    expect(panel).toHaveTextContent("Canonical replay readiness here is metadata-only");
    expect(panel).toHaveTextContent("Faculty draft status is a review artifact only");
    expect(panel.textContent).not.toContain("clinical validity");
    expect(panel.textContent).not.toContain("certify");
    expect(panel.textContent).not.toContain("score ready");
    expect(panel.textContent).not.toContain("Quest ready");
    expect(panel.textContent).not.toContain("runtime ready");
  });
});

function reviewPacketFixture(): ReviewPacket {
  return {
    stationRunId: "station_run_001",
    scenarioId: "ed_chest_pain_priority_v1",
    observedTraceTags: ["initial_introduction"],
    missingRequiredTraceTags: ["focused_exam"],
    lateTraceTags: ["oral_handoff"],
    unsafeEvents: [],
    timeline: [
      {
        sequence: 0,
        atSecond: 12,
        eventType: "actor_response",
        source: "model",
        actorId: "patient_robert_hayes",
        tag: "initial_introduction",
        summary: "Patient greeting captured for review.",
      },
    ],
    traceQuality: {
      eventCount: 1,
      modelGeneratedEventCount: 1,
      modelFailedEventCount: 0,
      voiceAudioEventCount: 0,
      blockedGuardrailCount: 0,
      unsafeEventCount: 0,
      missingRequiredTraceTagCount: 1,
      hasPatientNote: true,
      hasModelProvenance: true,
    },
    patientNote: null,
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "",
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

function clinicalEventReviewSummaryFixture(): ClinicalEventReviewSummary {
  return {
    stationRunId: "station_run_001",
    eventCount: 1,
    redactedEventCount: 1,
    clinicalEventKinds: ["actor_response"],
    traceTags: ["initial_introduction"],
    statusCounts: { safe: 1 },
    latestAtSecond: 12,
    durableStore: "in_memory",
    safeForFacultyReview: false,
  };
}

function reviewReplayReadinessSummaryFixture(): AdminReviewPacketReplay["reviewReplayReadinessSummary"] {
  return {
    stationRunId: "station_run_001",
    replayEvidenceReady: false,
    facultyReviewSafe: false,
    timelineEntryCount: 1,
    traceEventCount: 1,
    durableEventCount: 1,
    redactedDurableEventCount: 1,
    missingRequiredBehaviorCount: 1,
    lateBehaviorCount: 1,
    safetySignalCount: 1,
    blockers: ["missing_required_behavior", "late_behavior_present"],
    recommendedNextAction: "review_missing_required_behavior",
    replayBoundary: "summary_only_faculty_review_not_score_use",
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
    runtimeRemediationPlanRefs: ["remediation-plan:ed-chest-pain-runtime-evidence"],
    providerDisabledRemediation: [
      {
        providerId: "local-voice-provider",
        status: "disabled",
        remediationPlanRefs: ["remediation-plan:local-voice-provider"],
        blockers: ["voice_provider_disabled"],
        claimBoundary: "provider_disabled_remediation_metadata_not_runtime_readiness",
      },
    ],
  };
}
