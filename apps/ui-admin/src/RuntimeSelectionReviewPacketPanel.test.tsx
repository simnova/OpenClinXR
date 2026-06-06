import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(within(panel).getByLabelText("Runtime realism evidence draft metrics")).toHaveTextContent("draft_required_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence draft metrics")).toHaveTextContent("runtime hooks 3; visual QA hooks 9");
    expect(within(panel).getByLabelText("Runtime realism evidence draft metrics")).toHaveTextContent("runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Runtime realism evidence draft blockers")).toHaveTextContent("runtime_realism_evidence_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence draft blockers")).toHaveTextContent("humanoid_visual_qa_evidence_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence draft actions")).toHaveTextContent("draft runtime realism evidence from actor hook signals before guarded runtime selection");
    expect(within(panel).getByLabelText("Runtime realism evidence draft hook details")).toHaveTextContent("patient_maya_johnson_v1 (patient): required_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence draft hook details")).toHaveTextContent("runtime_realism_hook_metadata_only_not_runtime_readiness");
    expect(within(panel).getByLabelText("Runtime realism evidence draft hook details")).toHaveTextContent("pulse_oximeter_equipment (equipment): required_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence draft hook details")).toHaveTextContent("visual_qa_hook_metadata_only_not_visual_quality_evidence");
    expect(within(panel).getByLabelText("Actor-player runtime evidence metrics")).toHaveTextContent("metadata_only_actor_player_stub_execution_not_scene_or_learner_runtime");
    expect(within(panel).getByLabelText("Actor-player runtime evidence metrics")).toHaveTextContent("3 actors; missing 0; complete true");
    expect(within(panel).getByLabelText("Actor-player runtime evidence metrics")).toHaveTextContent("runtime false; scene false; learner false; provider false");
    expect(within(panel).getByLabelText("Actor-player runtime evidence details")).toHaveTextContent("nurse_kevin_lee_v1: 4 guarded hooks; 3 turns; 9 samples; nurse_work_of_breathing_assessment");
    expect(within(panel).getByLabelText("Actor-player runtime evidence details")).toHaveTextContent("speech_viseme_timeline_binding:3:not_scene_executed");
    expect(within(panel).getByLabelText("Actor-player runtime evidence details")).toHaveTextContent("model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json");
    expect(within(panel).getByLabelText("Runtime realism evidence input draft metrics")).toHaveTextContent("draft_inputs_required_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence input draft metrics")).toHaveTextContent("3 actor inputs; 9 visual QA inputs");
    expect(within(panel).getByLabelText("Runtime realism evidence input draft metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Runtime realism evidence input draft details")).toHaveTextContent("patient_maya_johnson_v1 (patient): required_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence input draft details")).toHaveTextContent("runtime_realism_evidence_input_metadata_only_not_runtime_readiness");
    expect(within(panel).getByLabelText("Runtime realism evidence input draft details")).toHaveTextContent("pulse_oximeter_equipment (equipment): required_not_attached");
    expect(within(panel).getByLabelText("Runtime realism evidence input review decision metrics")).toHaveTextContent("2 evidence input decisions");
    expect(within(panel).getByLabelText("Runtime realism evidence input review decision metrics")).toHaveTextContent("reviewed 1; held 1");
    expect(within(panel).getByLabelText("Runtime realism evidence input review decision metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Runtime realism evidence input review decision details")).toHaveTextContent("runtime-realism-evidence-input:patient_maya_johnson_v1: reviewed_metadata_only");
    expect(within(panel).getByLabelText("Runtime realism evidence input review decision details")).toHaveTextContent("visual-qa-evidence-input:pulse_oximeter_equipment: held_metadata_only");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment summary metrics")).toHaveTextContent("1 reviewed metadata-only; 1 held metadata-only");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment summary metrics")).toHaveTextContent("0 runtime evidence refs; 0 visual QA evidence refs");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment summary metrics")).toHaveTextContent("runtime_visual_evidence_attachment_summary_metadata_only_until_artifacts_attach");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment summary metrics")).toHaveTextContent("runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment record metrics")).toHaveTextContent("1 metadata-only attachment refs");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment record metrics")).toHaveTextContent("1 runtime evidence refs; 0 visual QA refs");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment record metrics")).toHaveTextContent("metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment record metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment record details")).toHaveTextContent("runtime-realism-evidence-input:patient_maya_johnson_v1: attached_metadata_only");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment record details")).toHaveTextContent("runtime-evidence://local-browser/patient-gaze-expression");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment action metrics")).toHaveTextContent("metadata_only_runtime_visual_evidence_attachment_actions");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment action metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment action details")).toHaveTextContent("attach_runtime_realism_evidence_refs: available");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment action details")).toHaveTextContent("1 inputs; reviewed 1; held 0; attached 0; runtime false; learner false");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment action details")).toHaveTextContent("attach_visual_qa_evidence_refs: available");
    expect(within(panel).getByLabelText("Runtime visual evidence attachment action details")).toHaveTextContent("1 inputs; reviewed 0; held 1; attached 0; runtime false; learner false");
    expect(within(panel).getByLabelText("Runtime evidence capture scaffold metrics")).toHaveTextContent("3 runtime candidates; 9 visual QA candidates");
    expect(within(panel).getByLabelText("Runtime evidence capture scaffold metrics")).toHaveTextContent("12 metadata-only submit candidates");
    expect(within(panel).getByLabelText("Runtime evidence capture scaffold metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Runtime evidence capture scaffold metrics")).toHaveTextContent("metadata_only_actor_player_runtime_evidence_attachment");
    expect(within(panel).getByLabelText("Runtime evidence capture scaffold metrics")).toHaveTextContent("3 actors; 9 turns; 27 samples; provider false; runtime false; learner false; scene false");
    expect(within(panel).getByLabelText("Runtime evidence capture scaffold candidate details")).toHaveTextContent("runtime-realism-evidence-input:patient_maya_johnson_v1: attach_runtime_realism_evidence_refs");
    expect(within(panel).getByLabelText("Runtime evidence capture scaffold candidate details")).toHaveTextContent("runtime-evidence://metadata-only/local-capture-scaffold/peds_asthma_parent_anxiety_v1/patient_maya_johnson_v1");
    expect(within(panel).getByLabelText("Runtime selection review metrics")).toHaveTextContent("disabled_guard_not_runtime_execution");
    expect(within(panel).getByLabelText("Runtime selection review metrics")).toHaveTextContent("model local_configured_not_executed");
    expect(within(panel).getByLabelText("Runtime selection review metrics")).toHaveTextContent("voice local_configured_not_executed");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("local XR review URL");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("openclinxrScenarioId=ed_chest_pain_priority_v1");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("openclinxrCaptureMode=actor-realism");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("launch remains blocked");
    expect(within(panel).getByLabelText("Prepare local XR handoff metrics")).toHaveTextContent("actor/equipment materialization evidence required");
    expect(within(panel).getByRole("link", { name: "Open local XR review handoff" })).toHaveAttribute(
      "href",
      expect.stringContaining("openclinxrRuntimeAssetBundleId=local_exam_run%3Aed_chest_pain_local_encounter%3Aruntime-assets"),
    );
    expect(within(panel).getByLabelText("Runtime selection reviewer checklist")).toHaveTextContent("confirm_selector_guard_remains_disabled");
    expect(within(panel).getByLabelText("Worker materialization input summary metrics")).toHaveTextContent("3 actor materialization inputs");
    expect(within(panel).getByLabelText("Worker materialization input summary metrics")).toHaveTextContent("6 equipment materialization inputs");
    expect(within(panel).getByLabelText("Worker materialization input summary metrics")).toHaveTextContent("metadata_only_provider_neutral_materialization_inputs");
    expect(within(panel).getByLabelText("Worker materialization input summary metrics")).toHaveTextContent("provider false; paid APIs false; external network false");
    expect(within(panel).getByLabelText("Worker materialization input summary metrics")).toHaveTextContent("actor_specific_body_profile_required");
    expect(within(panel).getByLabelText("Worker materialization input summary metrics")).toHaveTextContent("clinical_affordance_evidence");
    expect(within(panel).getByLabelText("Worker materialization input blockers")).toHaveTextContent("actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required");
    expect(within(panel).getByLabelText("Worker materialization input blockers")).toHaveTextContent("generic_equipment_reuse_blocks_equipment_specific_asset_readiness");
    expect(within(panel).getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("36 missing attachment slots");
    expect(within(panel).getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("12 actor slots; 24 equipment slots");
    expect(within(panel).getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("metadata_only_materialization_attachment_plan");
    expect(within(panel).getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("actor_specific_body_profile_required");
    expect(within(panel).getByLabelText("Worker materialization attachment plan metrics")).toHaveTextContent("clinical_affordance_evidence");
    expect(within(panel).getByLabelText("Worker materialization attachment blockers")).toHaveTextContent("actor_materialization_attachment_missing:patient_maya_johnson_v1:actor_specific_body_profile_required");
    expect(within(panel).getByLabelText("Worker materialization attachment blockers")).toHaveTextContent("equipment_materialization_attachment_missing:nebulizer_mask_equipment:clinical_affordance_evidence");
    expect(within(panel).getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("36/36 attachment slots satisfied");
    expect(within(panel).getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("0 missing; 0 held or invalid");
    expect(within(panel).getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("metadata_only_materialization_evidence_attachment_summary");
    expect(within(panel).getByLabelText("Worker materialization evidence attachment metrics")).toHaveTextContent("all slots satisfied true; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Worker materialization evidence attachment blockers")).toHaveTextContent("materialization_evidence_attachment_missing:actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_clothing_required");
    expect(within(panel).getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("2 materialization input decisions");
    expect(within(panel).getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("reviewed 1; held 1");
    expect(within(panel).getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("metadata_only_materialization_input_review_decisions");
    expect(within(panel).getByLabelText("Worker materialization input review decision metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Worker materialization input review decision details")).toHaveTextContent("review_actor_materialization_inputs: reviewed_metadata_only");
    expect(within(panel).getByLabelText("Worker materialization input review decision details")).toHaveTextContent("hold_equipment_materialization_inputs: held_metadata_only");
    expect(within(panel).getByLabelText("Publication materialization metrics")).toHaveTextContent("materialized 0/2");
    expect(within(panel).getByLabelText("Publication materialization metrics")).toHaveTextContent("humanoids patient, family, nurse");
    expect(within(panel).getByLabelText("Publication materialization metrics")).toHaveTextContent("humanoid-realism-gate, runtime-realism-evidence-check, visual-qa-evidence-check");
    expect(within(panel).getByLabelText("Publication materialization metrics")).toHaveTextContent("runtime hooks 3; visual QA hooks 9");
    expect(within(panel).getByLabelText("Publication materialization blockers")).toHaveTextContent("humanoid_realism_requirement_actor_missing:family");
    expect(within(panel).getByLabelText("Actor equipment materialization caveats")).toHaveTextContent("Shared neutral humanoid reuse is fixture scaffolding.");
    expect(within(panel).getByLabelText("Actor equipment materialization caveats")).toHaveTextContent("materialize equipment-specific GLBs before runtime selection");
    expect(within(panel).getByLabelText("Remaining runtime blocker review metrics")).toHaveTextContent("materialization complete true; runtime false; learner false; Quest false");
    expect(within(panel).getByLabelText("Remaining runtime blocker review reasons")).toHaveTextContent("runtime_selector: runtime_selector_disabled_guard_not_wired");
    expect(within(panel).getByLabelText("Remaining runtime blocker review reasons")).toHaveTextContent("runtime_realism: runtime_realism_evidence_not_attached");
    expect(within(panel).getByLabelText("Remaining runtime blocker review reasons")).toHaveTextContent("metadata_only_assets: materialization_evidence_refs_are_metadata_only_not_generated_asset_readiness");
    expect(panel).toHaveTextContent("shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness");
    expect(panel).toHaveTextContent("generic_equipment_reuse_blocks_equipment_specific_asset_readiness");
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

  it("submits scenario-matched metadata-only runtime evidence capture scaffold refs without clearing launch gates", () => {
    const onSubmitRuntimeVisualEvidenceAttachment = vi.fn();
    const packet = {
      ...packetFixture(),
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
    };

    render(
      <RuntimeSelectionReviewPacketPanel
        packet={packet}
        onSubmitRuntimeVisualEvidenceAttachment={onSubmitRuntimeVisualEvidenceAttachment}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit metadata-only capture scaffold refs" }));

    expect(onSubmitRuntimeVisualEvidenceAttachment).toHaveBeenCalledWith(expect.objectContaining({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      attachments: expect.arrayContaining([
        expect.objectContaining({
          actionId: "attach_runtime_realism_evidence_refs",
          inputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
          inputKind: "runtime_realism_signal_input",
          evidenceRef: "runtime-evidence://metadata-only/local-capture-scaffold/ref-0",
          attachmentStatus: "attached_metadata_only",
        }),
        expect.objectContaining({
          actionId: "attach_visual_qa_evidence_refs",
          inputKind: "visual_qa_review_input",
          attachmentStatus: "attached_metadata_only",
        }),
      ]),
    }));
    expect(onSubmitRuntimeVisualEvidenceAttachment.mock.calls[0]?.[0].attachments).toHaveLength(12);
    expect(screen.getByLabelText("Runtime evidence capture scaffold metrics")).toHaveTextContent("provider false; runtime false; learner false; Quest false");
  });

  it("shows the peds humanoid handoff as review/replay metadata with false readiness claims", () => {
    const basePacket = packetFixture();
    if (!basePacket.publicationPayloadLinkage) throw new Error("packet fixture must include publication payload linkage");
    const publicationPayloadLinkage = basePacket.publicationPayloadLinkage;
    const packet: AdminRuntimeSelectionReviewPacket = {
      ...basePacket,
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      publicationPayloadLinkage: {
        ...publicationPayloadLinkage,
        pedsHumanoidMaterializationHandoff: {
          schemaVersion: "openclinxr.peds-humanoid-materialization-handoff.v1",
          source: "worker_role_specific_humanoid_glb_materialization_metadata",
          scenarioId: "peds_asthma_parent_anxiety_v1",
          targetKind: "role_specific_humanoid_glb",
          generatedAssetsMaterialized: true,
          localCandidateAssetsSelected: true,
          reviewPacketPath: "docs/openclinxr/peds-humanoid-materialization-handoff-2026-06-04.json",
          assets: [
            {
              actorRole: "patient",
              assetPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
              runtimeAssetPath: "/generated-humanoids/peds_patient_child.glb",
              provenanceManifestPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json",
              generatorMode: "anny_compatible_stub_plus_blender_procedural",
              sourceKind: "case_driven_generated_humanoid_candidate",
              realAnnyWeightsUsed: false,
              textureMode: "procedural_fallback",
              animationMode: "procedural_clinical_idle_conversation_posture_fallback",
              realismGrade: "B",
              promotionStatus: "runtime_candidate_not_realism_gate_pass",
              notEvidenceFor: [
                "real_anny_model_output",
                "b_plus_visual_realism_gate",
                "production_asset_readiness",
                "quest_readiness",
                "clinical_validity",
                "scoring_validity",
              ],
            },
            {
              actorRole: "anxious_parent",
              assetPath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
              runtimeAssetPath: "/generated-humanoids/peds_anxious_parent.glb",
              provenanceManifestPath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.provenance.json",
              generatorMode: "anny_compatible_stub_plus_blender_procedural",
              sourceKind: "case_driven_generated_humanoid_candidate",
              realAnnyWeightsUsed: false,
              textureMode: "procedural_fallback",
              animationMode: "procedural_clinical_idle_conversation_posture_fallback",
              realismGrade: "B",
              promotionStatus: "runtime_candidate_not_realism_gate_pass",
              notEvidenceFor: [
                "real_anny_model_output",
                "b_plus_visual_realism_gate",
                "production_asset_readiness",
                "quest_readiness",
                "clinical_validity",
                "scoring_validity",
              ],
            },
          ],
          productionReadinessClaimed: false,
          questReadinessClaimed: false,
          clinicalValidityClaimed: false,
          scoringValidityClaimed: false,
          claimBoundary: "local_generated_humanoid_candidate_metadata_not_runtime_or_production_readiness",
        },
      },
    };

    render(<RuntimeSelectionReviewPacketPanel packet={packet} />);

    const panel = screen.getByLabelText("Runtime selection review packet");
    expect(panel).toHaveTextContent("Peds humanoid materialization handoff");
    expect(within(panel).getByLabelText("Peds humanoid materialization handoff metrics")).toHaveTextContent("local_generated_humanoid_candidate_metadata_not_runtime_or_production_readiness");
    expect(within(panel).getByLabelText("Peds humanoid materialization handoff metrics")).toHaveTextContent("generated assets true; local candidates true");
    expect(within(panel).getByLabelText("Peds humanoid materialization handoff metrics")).toHaveTextContent("production false; Quest false; clinical false; scoring false");
    expect(within(panel).getByLabelText("Peds humanoid materialization handoff metrics")).toHaveTextContent("docs/openclinxr/peds-humanoid-materialization-handoff-2026-06-04.json");
    expect(panel).toHaveTextContent("patient: /generated-humanoids/peds_patient_child.glb; grade B; real Anny false; runtime_candidate_not_realism_gate_pass");
    expect(panel).toHaveTextContent("anxious_parent: /generated-humanoids/peds_anxious_parent.glb; grade B; real Anny false; runtime_candidate_not_realism_gate_pass");
    expect(panel).toHaveTextContent("apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json");
    expect(panel).toHaveTextContent("real_anny_model_output, b_plus_visual_realism_gate, production_asset_readiness, quest_readiness, clinical_validity, scoring_validity");
    expect(panel.textContent).not.toContain("Quest ready");
    expect(panel.textContent).not.toContain("learner launch ready");
    expect(panel.textContent).not.toContain("clinically valid");
  });
});

function actorPlayerHook(hookId: string) {
  return {
    hookId,
    runtimeSurfaceStatus: "executed_in_guarded_local_actor_player_stub" as const,
    sceneExecutionStatus: "not_scene_executed" as const,
    sampleCount: 3,
    remainingBlockers: ["scene_runtime_not_executed", "review_packet_attachment_metadata_only"],
  };
}

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
        runtimeRealismEvidenceHookCount: 3,
        visualQaEvidenceHookCount: 9,
        requiredBefore: "guarded_runtime_wiring",
        runtimeExecutionAllowed: false,
        providerExecutionPerformed: false,
        questReadinessClaimed: false,
      },
      actorEquipmentMaterializationGate: {
        runtimeSelectionBlockedUntilEvidenceAttached: true,
        actorBlockers: ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"],
        equipmentBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
        caveats: [
          "Shared neutral humanoid reuse is fixture scaffolding.",
          "Generic equipment reuse is fixture scaffolding.",
        ],
        recommendedNextActions: [
          "materialize actor-specific humanoid GLBs before runtime selection",
          "materialize equipment-specific GLBs before runtime selection",
        ],
        remainingRuntimeBlockerReasons: {
          source: "materialization_attachment_summary_and_publication_runtime_gates",
          materializationEvidenceComplete: true,
          runtimeSelectionAllowed: false,
          learnerLaunchAllowed: false,
          questEvidenceRefreshAllowed: false,
          categories: [
            {
              category: "runtime_selector",
              blockerIds: ["runtime_selector_disabled_guard_not_wired"],
              recommendedNextAction: "review guarded runtime selector wiring only after runtime, visual QA, and Quest evidence refs attach",
            },
            {
              category: "runtime_realism",
              blockerIds: ["runtime_realism_evidence_not_attached"],
              recommendedNextAction: "attach case-derived runtime realism evidence before runtime selection",
            },
            {
              category: "metadata_only_assets",
              blockerIds: ["materialization_evidence_refs_are_metadata_only_not_generated_asset_readiness"],
              recommendedNextAction: "treat completed actor/equipment evidence refs as review metadata",
            },
          ],
          claimBoundary: "remaining_runtime_blockers_after_materialization_metadata_only",
        },
        claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness",
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
    runtimeRealismEvidenceDraftReview: {
      status: "draft_required_not_attached",
      runtimeRealismEvidenceHookCount: 3,
      visualQaEvidenceHookCount: 9,
      runtimeHookDrafts: [
        {
          actorId: "patient_maya_johnson_v1",
          actorRole: "patient",
          requiredSignalCount: 5,
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/runtime-realism/patient_maya_johnson_v1",
          claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness",
        },
        {
          actorId: "family_mrs_johnson_v1",
          actorRole: "family",
          requiredSignalCount: 4,
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/runtime-realism/family_mrs_johnson_v1",
          claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness",
        },
        {
          actorId: "nurse_patel_v1",
          actorRole: "nurse",
          requiredSignalCount: 4,
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/runtime-realism/nurse_patel_v1",
          claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness",
        },
      ],
      visualQaHookDrafts: [
        {
          targetId: "patient_maya_johnson_v1",
          targetKind: "humanoid_actor",
          requiredReviewFocus: ["body_profile", "clothing", "hair_face", "rig"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/patient_maya_johnson_v1",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "family_mrs_johnson_v1",
          targetKind: "humanoid_actor",
          requiredReviewFocus: ["body_profile", "clothing", "hair_face", "rig"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/family_mrs_johnson_v1",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "nurse_patel_v1",
          targetKind: "humanoid_actor",
          requiredReviewFocus: ["body_profile", "clothing", "hair_face", "rig"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/nurse_patel_v1",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "pulse_oximeter_equipment",
          targetKind: "equipment",
          requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence", "equipment_placement_anchor_evidence", "clinical_affordance_evidence"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/pulse_oximeter_equipment",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "nebulizer_mask_equipment",
          targetKind: "equipment",
          requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence", "equipment_placement_anchor_evidence", "clinical_affordance_evidence"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/nebulizer_mask_equipment",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "albuterol_vial_equipment",
          targetKind: "equipment",
          requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence", "equipment_placement_anchor_evidence", "clinical_affordance_evidence"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/albuterol_vial_equipment",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "stethoscope_equipment",
          targetKind: "equipment",
          requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence", "equipment_placement_anchor_evidence", "clinical_affordance_evidence"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/stethoscope_equipment",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "exam_bed_equipment",
          targetKind: "equipment",
          requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence", "equipment_placement_anchor_evidence", "clinical_affordance_evidence"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/exam_bed_equipment",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
        {
          targetId: "inhaler_spacer_equipment",
          targetKind: "equipment",
          requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence", "equipment_placement_anchor_evidence", "clinical_affordance_evidence"],
          status: "required_not_attached",
          evidenceRef: "encounter-publication-realism://scenario/request/visual-qa/inhaler_spacer_equipment",
          claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence",
        },
      ],
      blockerIds: [
        "runtime_realism_evidence_not_attached",
        "humanoid_visual_qa_evidence_not_attached",
        "runtime_selector_disabled_guard_not_wired",
        "quest_webxr_evidence_not_attached",
      ],
      recommendedNextActions: [
        "draft runtime realism evidence from actor hook signals before guarded runtime selection",
        "attach visual QA evidence for humanoid and equipment hook targets before learner launch review",
      ],
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "runtime_realism_evidence_draft_review_metadata_only",
    },
    caseDerivedActorPlayerRuntimeEvidence: {
      schemaVersion: "openclinxr.case-derived-actor-player-runtime-evidence.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "case_spec_derivation_plus_model_vetting_actor_player_runtime",
      sourceActorPlayerRuntimeEvidencePath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
      claimBoundary: "metadata_only_actor_player_stub_execution_not_scene_or_learner_runtime",
      actorRuntimeSummaries: [
        {
          actorId: "patient_maya_johnson_v1",
          candidateId: "peds_patient_child",
          caseDerivedTurnIds: ["patient-child-turn-1"],
          caseDerivedRuntimeTurnCount: 4,
          caseDerivedRuntimeSampleCount: 12,
          turnTraceTag: "patient_dyspnea_short_answer",
          executedHookCount: 4,
          hookExecutions: [
            actorPlayerHook("speech_viseme_timeline_binding"),
            actorPlayerHook("emotion_transition_state_binding"),
            actorPlayerHook("gaze_blink_runtime_binding"),
            actorPlayerHook("posture_locomotion_runtime_binding"),
          ],
        },
        {
          actorId: "parent_tara_johnson_v1",
          candidateId: "peds_anxious_parent",
          caseDerivedTurnIds: ["parent-turn-1"],
          caseDerivedRuntimeTurnCount: 2,
          caseDerivedRuntimeSampleCount: 6,
          turnTraceTag: "parent_anxiety_initial_concern",
          executedHookCount: 4,
          hookExecutions: [
            actorPlayerHook("speech_viseme_timeline_binding"),
            actorPlayerHook("emotion_transition_state_binding"),
            actorPlayerHook("gaze_blink_runtime_binding"),
            actorPlayerHook("posture_locomotion_runtime_binding"),
          ],
        },
        {
          actorId: "nurse_kevin_lee_v1",
          candidateId: "peds_nurse_kevin",
          caseDerivedTurnIds: ["nurse-turn-1"],
          caseDerivedRuntimeTurnCount: 3,
          caseDerivedRuntimeSampleCount: 9,
          turnTraceTag: "nurse_work_of_breathing_assessment",
          executedHookCount: 4,
          hookExecutions: [
            actorPlayerHook("speech_viseme_timeline_binding"),
            actorPlayerHook("emotion_transition_state_binding"),
            actorPlayerHook("gaze_blink_runtime_binding"),
            actorPlayerHook("posture_locomotion_runtime_binding"),
          ],
        },
      ],
      missingCaseActorIds: [],
      decision: {
        actorPlayerRuntimeEvidenceAttached: true,
        localActorPlayerRuntimeEvidenceExecuted: true,
        actorPlayerRuntimeEvidenceComplete: true,
        runtimeActorMappingReady: false,
        scenePlacementEvidenceAllowed: false,
        runtimePromotionAllowed: false,
        productionManifestPromotionAllowed: false,
        learnerLaunchAllowed: false,
        providerExecutionPerformed: false,
        nextSafeStep: "Expose this metadata in reviewer/admin surfaces and expand to multi-turn actor-player evidence before any scene-placement claim.",
      },
      notEvidenceFor: ["real_anny_model_output", "b_plus_visual_realism_gate", "quest_readiness", "production_asset_readiness", "learner_readiness", "clinical_validity", "scoring_validity"],
    },
    runtimeRealismEvidenceInputDraft: {
      schemaVersion: "openclinxr.encounter-runtime-realism-evidence-input-draft.v1",
      source: "encounter_runtime_selection_review_packet",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      status: "draft_inputs_required_not_attached",
      runtimeActorEvidenceInputs: [
        {
          inputKind: "runtime_realism_signal_input",
          evidenceInputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
          actorId: "patient_maya_johnson_v1",
          actorRole: "patient",
          requiredSignalCount: 5,
          sourceEvidenceRef: "encounter-publication-realism://scenario/request/runtime-realism/patient_maya_johnson_v1",
          requiredEvidenceStatus: "required_not_attached",
          providerExecutionStatus: "metadata_only_not_executed",
          claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness",
        },
        {
          inputKind: "runtime_realism_signal_input",
          evidenceInputId: "runtime-realism-evidence-input:family_mrs_johnson_v1",
          actorId: "family_mrs_johnson_v1",
          actorRole: "family",
          requiredSignalCount: 4,
          sourceEvidenceRef: "encounter-publication-realism://scenario/request/runtime-realism/family_mrs_johnson_v1",
          requiredEvidenceStatus: "required_not_attached",
          providerExecutionStatus: "metadata_only_not_executed",
          claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness",
        },
        {
          inputKind: "runtime_realism_signal_input",
          evidenceInputId: "runtime-realism-evidence-input:nurse_patel_v1",
          actorId: "nurse_patel_v1",
          actorRole: "nurse",
          requiredSignalCount: 4,
          sourceEvidenceRef: "encounter-publication-realism://scenario/request/runtime-realism/nurse_patel_v1",
          requiredEvidenceStatus: "required_not_attached",
          providerExecutionStatus: "metadata_only_not_executed",
          claimBoundary: "runtime_realism_evidence_input_metadata_only_not_runtime_readiness",
        },
      ],
      visualQaEvidenceInputs: Array.from({ length: 9 }, (_, index) => ({
        inputKind: "visual_qa_review_input" as const,
        evidenceInputId: `visual-qa-evidence-input:${index === 3 ? "pulse_oximeter_equipment" : `target_${index}`}`,
        targetId: index === 3 ? "pulse_oximeter_equipment" : `target_${index}`,
        targetKind: index < 3 ? "humanoid_actor" : "equipment",
        requiredReviewFocus: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence"],
        sourceEvidenceRef: `encounter-publication-realism://scenario/request/visual-qa/${index === 3 ? "pulse_oximeter_equipment" : `target_${index}`}`,
        requiredEvidenceStatus: "required_not_attached" as const,
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
      recommendedNextActions: ["attach reviewer-supplied runtime realism evidence metadata"],
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    },
    runtimeRealismEvidenceInputReviewDecisionRecord: {
      schemaVersion: "openclinxr.runtime-realism-evidence-input-review-decision-record.v1",
      source: "admin_runtime_realism_evidence_input_review_decisions",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      decisionCount: 2,
      reviewedDecisionCount: 1,
      heldDecisionCount: 1,
      decisions: [
        {
          inputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
          inputKind: "runtime_realism_signal_input",
          reviewerId: "runtime-reviewer",
          decision: "reviewed_metadata_only",
          comments: "Actor runtime realism input reviewed as metadata only.",
          evidenceRefs: ["runtime-realism-evidence-input://patient"],
          reviewedAt: "2026-05-28T10:00:00.000Z",
        },
        {
          inputId: "visual-qa-evidence-input:pulse_oximeter_equipment",
          inputKind: "visual_qa_review_input",
          reviewerId: "runtime-reviewer",
          decision: "held_metadata_only",
          comments: "Equipment visual QA remains held until review evidence attaches.",
          evidenceRefs: ["visual-qa-evidence-input://pulse-oximeter"],
          reviewedAt: "2026-05-28T10:01:00.000Z",
        },
      ],
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "metadata_only_runtime_realism_evidence_input_review_decisions",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    },
    runtimeVisualEvidenceAttachmentSummary: {
      schemaVersion: "openclinxr.runtime-realism-evidence-attachment-summary.v1",
      source: "runtime_realism_evidence_input_review_decisions",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      runtimeActorEvidenceInputCount: 1,
      visualQaEvidenceInputCount: 1,
      reviewedMetadataOnlyCount: 1,
      heldMetadataOnlyCount: 1,
      attachedRuntimeEvidenceCount: 0,
      attachedVisualQaEvidenceCount: 0,
      reviewedMetadataOnlyInputIds: ["runtime-realism-evidence-input:patient_maya_johnson_v1"],
      heldMetadataOnlyInputIds: ["visual-qa-evidence-input:pulse_oximeter_equipment"],
      blockerIds: [
        "runtime_realism_evidence_not_attached_to_encounter_bundle",
        "visual_qa_evidence_not_attached_to_encounter_bundle",
      ],
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "runtime_visual_evidence_attachment_summary_metadata_only_until_artifacts_attach",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    },
    runtimeVisualEvidenceAttachmentActionPacket: {
      schemaVersion: "openclinxr.runtime-visual-evidence-attachment-action-packet.v1",
      source: "runtime_visual_evidence_attachment_summary",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actionMode: "metadata_only_attachment_actions_not_runtime_execution",
      availableActions: [
        {
          actionId: "attach_runtime_realism_evidence_refs",
          status: "available",
          requiredInputCount: 1,
          reviewedMetadataOnlyCount: 1,
          heldMetadataOnlyCount: 0,
          attachedEvidenceCount: 0,
          blockerIds: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
          providerExecutionAllowed: false,
          runtimeExecutionAllowed: false,
          learnerLaunchAllowed: false,
          claimBoundary: "runtime_visual_evidence_attachment_action_not_runtime_execution",
        },
        {
          actionId: "attach_visual_qa_evidence_refs",
          status: "available",
          requiredInputCount: 1,
          reviewedMetadataOnlyCount: 0,
          heldMetadataOnlyCount: 1,
          attachedEvidenceCount: 0,
          blockerIds: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
          providerExecutionAllowed: false,
          runtimeExecutionAllowed: false,
          learnerLaunchAllowed: false,
          claimBoundary: "runtime_visual_evidence_attachment_action_not_runtime_execution",
        },
      ],
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "metadata_only_runtime_visual_evidence_attachment_actions",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    },
    runtimeVisualEvidenceAttachmentRecord: {
      schemaVersion: "openclinxr.runtime-visual-evidence-attachment-record.v1",
      source: "admin_runtime_visual_evidence_attachment_refs",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      attachmentCount: 1,
      runtimeEvidenceAttachmentCount: 1,
      visualQaEvidenceAttachmentCount: 0,
      attachments: [
        {
          actionId: "attach_runtime_realism_evidence_refs",
          inputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
          inputKind: "runtime_realism_signal_input",
          evidenceRef: "runtime-evidence://local-browser/patient-gaze-expression",
          localArtifactPath: "docs/openclinxr/evidence/runtime/patient-gaze-expression.json",
          reviewerId: "runtime-reviewer",
          attachmentStatus: "attached_metadata_only",
          comments: "Metadata ref attached to reviewed runtime realism input.",
          attachedAt: "2026-05-28T10:30:00.000Z",
        },
      ],
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      productionAssetReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
      claimBoundary: "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    },
    runtimeEvidenceCaptureScaffold: {
      schemaVersion: "openclinxr.encounter-runtime-evidence-capture-scaffold.v1",
      source: "encounter_runtime_realism_evidence_input_draft",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      status: "metadata_only_attachment_candidates_not_submitted",
      runtimeEvidenceCandidateCount: 3,
      visualQaEvidenceCandidateCount: 9,
      actorPlayerRuntimeEvidenceAttachment: {
        sourceArtifactPath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
        actorCount: 3,
        projectedTurnCount: 9,
        projectedSampleCount: 27,
        providerExecutionPerformed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        scenePlacementEvidenceAllowed: false,
        claimBoundary: "metadata_only_actor_player_runtime_evidence_attachment",
      },
      attachmentCandidates: [
        {
          actionId: "attach_runtime_realism_evidence_refs",
          inputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
          inputKind: "runtime_realism_signal_input",
          evidenceRef: "runtime-evidence://metadata-only/local-capture-scaffold/peds_asthma_parent_anxiety_v1/patient_maya_johnson_v1",
          localArtifactPath: "runtime-evidence-capture-scaffold/peds_asthma_parent_anxiety_v1/patient_maya_johnson_v1-runtime-realism.json",
          sourceEvidenceRef: "encounter-publication-realism://peds/runtime/patient",
          reviewerId: "runtime_evidence_capture_scaffold",
          attachmentStatus: "attached_metadata_only",
          comments: "Metadata-only runtime-realism capture scaffold.",
          attachedAt: "2026-05-28T13:59:11.201Z",
          providerExecutionAllowed: false,
          runtimeExecutionAllowed: false,
          learnerLaunchAllowed: false,
          questEvidenceRefreshAllowed: false,
          productionAssetReadinessClaimed: false,
          clinicalValidityClaimed: false,
          scoringValidityClaimed: false,
          claimBoundary: "metadata_only_runtime_evidence_capture_candidate_not_submitted",
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
        },
      ],
      submitRuntimeVisualEvidenceAttachmentInput: {
        scenarioId: "peds_asthma_parent_anxiety_v1",
        attachments: Array.from({ length: 12 }, (_, index) => ({
          actionId: index === 0 ? "attach_runtime_realism_evidence_refs" as const : "attach_visual_qa_evidence_refs" as const,
          inputId: index === 0 ? "runtime-realism-evidence-input:patient_maya_johnson_v1" : `visual-qa-evidence-input:target-${index}`,
          inputKind: index === 0 ? "runtime_realism_signal_input" as const : "visual_qa_review_input" as const,
          evidenceRef: `runtime-evidence://metadata-only/local-capture-scaffold/ref-${index}`,
          localArtifactPath: `runtime-evidence-capture-scaffold/ref-${index}.json`,
          reviewerId: "runtime_evidence_capture_scaffold",
          attachmentStatus: "attached_metadata_only" as const,
          comments: "Metadata-only scaffold candidate.",
          attachedAt: "2026-05-28T13:59:11.201Z",
        })),
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
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
    },
    materializationInputManifestSummary: {
      schemaVersion: "openclinxr.encounter-materialization-input-manifest-summary.v1",
      source: "encounter_materialization_input_manifest",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actorWorkOrderInputCount: 3,
      equipmentWorkOrderInputCount: 6,
      requiredActorCueIds: [
        "actor_specific_body_profile_required",
        "actor_specific_clothing_required",
        "actor_specific_hair_face_required",
        "actor_specific_rig_preservation_required",
      ],
      requiredEquipmentCueIds: [
        "scenario_specific_equipment_variant_evidence",
        "equipment_scale_validation_evidence",
        "equipment_placement_anchor_evidence",
        "clinical_affordance_evidence",
      ],
      blockerIds: [
        "shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness",
        "generic_equipment_reuse_blocks_equipment_specific_asset_readiness",
        "actor_materialization_evidence_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
      ],
      providerExecutionPerformed: false,
      paidApisUsed: false,
      externalNetworkUsed: false,
      claimBoundary: "metadata_only_provider_neutral_materialization_inputs",
    },
    materializationAttachmentPlanSummary: {
      schemaVersion: "openclinxr.encounter-materialization-attachment-plan-summary.v1",
      source: "encounter_materialization_attachment_plan",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actorAttachmentSlotCount: 12,
      equipmentAttachmentSlotCount: 24,
      missingAttachmentCount: 36,
      actorRequiredCueIds: [
        "actor_specific_body_profile_required",
        "actor_specific_clothing_required",
        "actor_specific_hair_face_required",
        "actor_specific_rig_preservation_required",
      ],
      equipmentRequiredCueIds: [
        "scenario_specific_equipment_variant_evidence",
        "equipment_scale_validation_evidence",
        "equipment_placement_anchor_evidence",
        "clinical_affordance_evidence",
      ],
      blockerIds: [
        "actor_materialization_attachment_missing:patient_maya_johnson_v1:actor_specific_body_profile_required",
        "equipment_materialization_attachment_missing:nebulizer_mask_equipment:clinical_affordance_evidence",
      ],
      providerExecutionPerformed: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "metadata_only_materialization_attachment_plan",
    },
    materializationEvidenceAttachmentSummary: {
      schemaVersion: "openclinxr.encounter-materialization-evidence-attachment-summary.v1",
      source: "encounter_materialization_evidence_attachments",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      totalRequiredSlotCount: 36,
      attachedSlotCount: 36,
      missingSlotCount: 0,
      heldOrInvalidAttachmentCount: 0,
      allRequiredSlotsSatisfied: true,
      blockerIds: [
        "materialization_evidence_attachment_missing:actor-materialization-attachment:patient_maya_johnson_v1:actor_specific_clothing_required",
      ],
      providerExecutionPerformed: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
    },
    materializationInputReviewDecisionRecord: {
      schemaVersion: "openclinxr.encounter-materialization-input-review-decision-record.v1",
      source: "admin_materialization_input_review_decisions",
      requestId: "scene_generation_request:peds_asthma_parent_anxiety_v1:local-admin",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      decisionCount: 2,
      reviewedDecisionCount: 1,
      heldDecisionCount: 1,
      decisions: [
        {
          actionId: "review_actor_materialization_inputs",
          reviewerId: "asset-reviewer",
          decision: "reviewed_metadata_only",
          comments: "Actor materialization inputs reviewed as metadata only.",
          evidenceRefs: ["encounter-materialization-input://peds/actors"],
          reviewedAt: "2026-05-28T06:00:00.000Z",
        },
        {
          actionId: "hold_equipment_materialization_inputs",
          reviewerId: "asset-reviewer",
          decision: "held_metadata_only",
          comments: "Equipment remains held until specific GLB evidence attaches.",
          evidenceRefs: ["encounter-materialization-input://peds/equipment"],
          reviewedAt: "2026-05-28T06:01:00.000Z",
        },
      ],
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "metadata_only_materialization_input_review_decisions",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
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
