import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminRuntimeSelectionReviewPacket } from "./api-client.js";
import { RuntimeSelectionReviewPacketPanel } from "./RuntimeSelectionReviewPacketPanel.js";

describe("RuntimeSelectionReviewPacketPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("surfaces guarded selector review context without runtime or readiness claims", () => {
    render(<RuntimeSelectionReviewPacketPanel packet={packetFixture()} />);

    const panel = screen.getByLabelText("Runtime selection review packet");
    expect(within(panel).getByRole("heading", { name: "Runtime Selection Review Packet" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("Provider-disabled review bundle");
    expect(panel).toHaveTextContent("read-only guarded runtime handoff");
    expect(panel).toHaveTextContent("does not launch the encounter, execute providers, refresh Quest evidence, run broad verification");
    expect(panel).toHaveTextContent("runtime_selection_review_packet_not_runtime_execution");
    expect(panel).toHaveTextContent("guarded_runtime_selector_seam_not_runtime_execution");
    expect(within(panel).getByLabelText("Operator review readiness metrics")).toHaveTextContent("not_ready_for_operator_review");
    expect(within(panel).getByLabelText("Operator review readiness metrics")).toHaveTextContent("operator_review_readiness_metadata_only");
    expect(within(panel).getByLabelText("Operator review readiness metrics")).toHaveTextContent("provider/runtime/learner/Quest execution disabled; no readiness claim");
    expect(within(panel).getByLabelText("Operator review readiness metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false; broad verification false");
    expect(within(panel).getByLabelText("Operator review required actions")).toHaveTextContent("materialize_or_attach_generated_assets_before_guarded_runtime_wiring");
    expect(within(panel).getByLabelText("Operator review required actions")).toHaveTextContent("attach_humanoid_runtime_visual_qa_evidence_refs");
    expect(within(panel).getByLabelText("Runtime selection review metrics")).toHaveTextContent("disabled_guard_not_runtime_execution");
    expect(within(panel).getByLabelText("Runtime selection review metrics")).toHaveTextContent("model local_configured_not_executed");
    expect(within(panel).getByLabelText("Runtime selection review metrics")).toHaveTextContent("voice local_configured_not_executed");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("local XR review URL");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("openclinxrScenarioId=ed_chest_pain_priority_v1");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("openclinxrCaptureMode=actor-realism");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("launch remains blocked");
    expect(within(panel).getByRole("link", { name: "Open local XR review handoff" })).toHaveAttribute(
      "href",
      expect.stringContaining("openclinxrRuntimeAssetBundleId=local_exam_run%3Aed_chest_pain_local_encounter%3Aruntime-assets"),
    );
    expect(within(panel).getByLabelText("Runtime selection reviewer checklist")).toHaveTextContent("confirm_selector_guard_remains_disabled");
    expect(within(panel).getByLabelText("Publication materialization metrics")).toHaveTextContent("materialized 0/2");
    expect(within(panel).getByLabelText("Publication materialization metrics")).toHaveTextContent("humanoids patient, family, nurse");
    expect(within(panel).getByLabelText("Publication materialization metrics")).toHaveTextContent("humanoid-realism-gate, runtime-realism-evidence-check, visual-qa-evidence-check");
    expect(within(panel).getByLabelText("Publication materialization blockers")).toHaveTextContent("humanoid_realism_requirement_actor_missing:family");
    expect(within(panel).getByLabelText("Publication realism evidence trace")).toHaveTextContent("humanoid-realism-gate: required_not_attached before guarded_runtime_wiring");
    expect(within(panel).getByLabelText("Publication realism evidence trace")).toHaveTextContent("encounter-publication-realism://scenario/request/humanoid-realism-gate/3-actors");
    expect(within(panel).getByLabelText("Runtime selection blockers")).toHaveTextContent("runtime_selector_disabled_guard_not_wired");
    expect(within(panel).getByLabelText("Runtime selection blockers")).toHaveTextContent("publication_payload_not_materialized");
    expect(panel).toHaveTextContent("Not evidence for: provider_availability, runtime_readiness, production_asset_readiness, quest_readiness, clinical_validity, scoring_validity, learner_launch_readiness.");
    expect(panel.textContent).not.toContain("Quest ready");
    expect(panel.textContent).not.toContain("clinical validity approved");
    expect(panel.textContent).not.toContain("clinically valid");
    expect(panel.textContent).not.toContain("scoring validated");
    expect(panel.textContent).not.toContain("learner launch ready");
    expect(panel.textContent).not.toContain("provider available");
    expect(panel.textContent).not.toContain("runtime ready");
  });
});

function packetFixture(): AdminRuntimeSelectionReviewPacket {
  return {
    schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
    source: "api_local_runtime_bundle_fixture",
    reviewPacketMode: "read_only_guarded_runtime_handoff",
    selectedScenarioId: "ed_chest_pain_priority_v1",
    selectedEncounterId: "ed_chest_pain_local_encounter",
    selectedStationId: "ed_chest_pain_station_v1",
    selectedRuntimeAssetBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
    handoffArtifactsInternallyPaired: true,
    runtimeCandidates: { model: "local_configured_not_executed", voice: "local_configured_not_executed" },
    guardedRuntimeSelectorDecision: {
      selectionStatus: "disabled_guard_not_runtime_execution",
      claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      blockers: ["runtime_selector_disabled_guard_not_wired"],
    },
    publicationPayloadLinkage: {
      source: "encounter_publication_payloads",
      status: "blocked",
      blockers: ["humanoid_realism_requirement_actor_missing:family"],
      localMaterializationHandoff: {
        requestId: "encounter_assets_ed_chest_pain_priority_executable_v1",
        scenarioId: "ed_chest_pain_priority_v2",
        rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1",
        plannedOutputCount: 2,
        materializedOutputCount: 0,
        allOutputsPlannedMetadataOnly: true,
      },
      assetNeedsReadiness: {
        readyForDeterministicGeneration: true,
        missingRequiredAssetNeedIds: [],
        blockers: [],
        requiredHumanoidRoles: ["patient", "family", "nurse"],
        animationRequirementCount: 1,
        emotionRequirementCount: 1,
        gazeRequirementCount: 1,
        lipSyncRequirementCount: 1,
        sharedAssetLibrarySemanticKeyCount: 1,
      },
      realismEvidenceRefs: {
        claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
        refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
        refs: [
          { refId: "humanoid-realism-gate", evidenceRef: "encounter-publication-realism://scenario/request/humanoid-realism-gate/3-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] },
        ],
        requiredBefore: "guarded_runtime_wiring",
        runtimeExecutionAllowed: false,
        providerExecutionPerformed: false,
        questReadinessClaimed: false,
      },
    },
    operatorReviewReadiness: {
      status: "not_ready_for_operator_review",
      reviewedArtifactCount: 4,
      blockingArtifactCount: 2,
      blockerIds: ["runtime_selector_disabled_guard_not_wired", "publication_payload_not_materialized"],
      requiredOperatorActions: [
        "materialize_or_attach_generated_assets_before_guarded_runtime_wiring",
        "attach_humanoid_runtime_visual_qa_evidence_refs",
        "confirm_provider_execution_remains_disabled_until_explicit_approval",
        "confirm_runtime_selector_remains_disabled_until_evidence_gates_clear",
      ],
      materializationRequiredBeforeRuntime: true,
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "operator_review_readiness_metadata_only",
    },
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    providerExecutionPerformed: false,
    uiLaunchPerformed: false,
    questEvidenceRefreshed: false,
    broadVerificationPerformed: false,
    reviewerChecklist: [
      {
        checkId: "confirm_selector_guard_remains_disabled",
        status: "required_before_runtime_wiring",
        blockerIds: ["runtime_selector_disabled_guard_not_wired"],
      },
    ],
    blockers: ["runtime_selector_disabled_guard_not_wired", "publication_payload_not_materialized"],
    nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
    claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}
