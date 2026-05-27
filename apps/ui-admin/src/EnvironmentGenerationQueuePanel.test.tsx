import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { EnvironmentGenerationQueue, ScenarioSceneGenerationPipelineWorkOrderQueue } from "@openclinxr/asset-registry";
import { findUnsafeClaimLanguage } from "@openclinxr/domain/claim-language";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentGenerationQueuePanel } from "./EnvironmentGenerationQueuePanel.js";
import {
  sceneGenerationRequestProjectionArtifactStatusColor,
  sceneGenerationRequestProjectionArtifactStatusLabel,
  sceneGenerationRequestReviewStatusColor,
} from "./status-view-model.js";

describe("EnvironmentGenerationQueuePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("surfaces blocked 3D environment packet details without production or Quest readiness claims", () => {
    const onInitiateSceneGeneration = vi.fn();
    const onAttachSceneGenerationReview = vi.fn();
    const onCheckSceneGenerationPublicationReadiness = vi.fn();

    render(
      <EnvironmentGenerationQueuePanel
        environmentGenerationQueue={environmentGenerationQueueFixture()}
        sceneGenerationPipelineQueue={sceneGenerationPipelineQueueFixture()}
        sceneGenerationRequestQueue={{
          requestCount: 1,
          claimBoundary: "scene_generation_request_queue_not_asset_production",
          requests: [
            {
              requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
              scenarioId: "ed_chest_pain_priority_v1",
              createdAt: "2026-05-22T23:09:00.000Z",
              status: "accepted",
              reviewStatus: "pending_runtime_asset_review",
              nextAction: "attach_runtime_asset_review_decisions",
              runtimeAssetReviewDecisionCount: 0,
              accepted: true,
              productionAssetReadinessClaimed: false,
              claimBoundary: "scene_generation_request_not_asset_production",
              factoryPlanningContext: {
                scenarioId: "ed_chest_pain_priority_v1",
                workOrderId: "scene_generation_pipeline:ed_chest_pain_priority_v1",
                isFeaturedFactoryPlanningTarget: false,
                factoryPlanningClaimBoundary: "review_gated_factory_metadata_only",
                generationApprovalInferred: false,
              },
              workOrder: sceneGenerationPipelineQueueFixture().workOrders[0]!,
            },
          ],
        }}
        sceneGenerationPublicationReadiness={{
          requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
          scenarioId: "ed_chest_pain_priority_v1",
          canRunGeneratedBundlePublisher: true,
          canUseGeneratedBundleForLearnerRuntime: false,
          blockers: [],
          learnerRuntimeUseBlockers: [
            "runtime_realism_evidence_not_attached_to_encounter_bundle",
            "visual_qa_evidence_not_attached_to_encounter_bundle",
            "quest_runtime_evidence_not_attached_to_encounter_bundle",
          ],
          scenarioReviewGate: {
            scenarioStatus: "approved",
            approvalBoundary: "approved_scenario_factory_planning_only",
            learnerUseBlocked: false,
            blockerIds: [],
            claimBoundary: "scenario_status_gate_not_clinical_or_production_readiness",
          },
          runtimeBundleGateRefs: [
            {
              gateId: "runtime_bundle_assembly_audit",
              status: "blocked",
              refId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
              blockerIds: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
              claimBoundary: "runtime_bundle_gate_ref_not_published_runtime",
            },
            {
              gateId: "human_runtime_asset_review",
              status: "attached",
              refId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
              blockerIds: [],
              claimBoundary: "runtime_bundle_gate_ref_not_published_runtime",
            },
          ],
          humanoidMetadataBlockerIds: [
            "humanoid_metadata_review_required:animated_humanoid_runtime_playback",
            "humanoid_metadata_review_required:dialogue_viseme_and_gaze_mapping",
          ],
          humanReviewActions: [
            {
              actionId: "review_humanoid_realism_metadata",
              status: "available",
              label: "Review humanoid realism metadata and evidence blockers",
              blockerIds: ["humanoid_metadata_review_required:dialogue_viseme_and_gaze_mapping"],
              evidenceRefs: [],
              claimBoundary: "human_review_action_not_automated_approval",
            },
            {
              actionId: "resolve_scenario_approval_boundary",
              status: "complete",
              label: "Resolve scenario status and no-approval boundary",
              blockerIds: [],
              evidenceRefs: [],
              claimBoundary: "human_review_action_not_automated_approval",
            },
          ],
          nextAction: "run_generated_bundle_publisher",
          evidenceGateRefs: [
            {
              gateId: "asset_production_review",
              status: "attached",
              evidenceRefs: ["generated_patient_model_review_gate_v1:privacy_evidence"],
              requiredSignalIds: [],
              blockers: [],
              notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
            },
            {
              gateId: "runtime_realism_evidence",
              status: "pending",
              evidenceRefs: [],
              requiredSignalIds: ["animated_humanoid_runtime_playback", "emotion_aligned_expression_transition_cue"],
              blockers: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
              notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
            },
            {
              gateId: "visual_qa_evidence",
              status: "pending",
              evidenceRefs: [],
              requiredSignalIds: ["humanoid_realism_visual_qa_review", "emotion_expression_transition_readability"],
              blockers: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
              notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
            },
          ],
          publicationMetadata: {
            bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
            status: "blocked",
            assetStoreKind: "app_public_fixture",
            generatedAssetCount: 6,
            humanoidActorCount: 3,
            equipmentCount: 2,
            learnerRuntimeUseBlocked: true,
            publicationReviewEvidenceRefs: ["generated_patient_model_review_gate_v1:privacy_evidence"],
            humanoidRealismProfileSummary: {
              profileCount: 3,
              actorRoles: ["patient", "nurse", "spouse"],
              requiredSignalIds: [
                "animated_humanoid_runtime_playback",
                "dialogue_viseme_and_gaze_mapping",
                "dialogue_eye_micro_saccade_blink_cue",
                "generated_eyelid_blink_control_cue",
              ],
              claimScope: "metadata_only_not_visual_quality_evidence",
            },
            assemblyAuditMetadata: {
              claimBoundary: "asset_reference_audit_metadata_not_materialized_assets",
              sourceDefinitionRefs: ["scenario_definition:ed_chest_pain_priority_v1"],
              humanoidMetadataRefs: [
                {
                  actorId: "patient_robert_hayes_v1",
                  actorRole: "patient",
                  claimScope: "metadata_only_not_visual_quality_evidence",
                },
              ],
              fallbackPosture: {
                learnerUseBlockedUntilEvidenceGatesAttach: true,
              },
            },
            claimBoundary: "local_publication_metadata_not_runtime_readiness",
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          },
          dynamicBehaviorCoverage: {
            schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1",
            claimBoundary: "metadata_only_not_runtime_behavior_evidence",
            dialogueTurnCoverage: {
              actorRolesWithDialogueTurns: ["patient", "nurse", "spouse"],
              missingActorRoles: [],
              dialogueTurnCount: 4,
            },
            gazeTargetCoverage: {
              actorRolesWithGazeTargets: ["patient", "nurse", "spouse"],
              actorRolesWithActorTargetSupport: ["patient", "nurse", "spouse"],
              missingActorRoles: [],
            },
            actorRolePlacementCoverage: {
              actorRolesWithPlacements: ["patient", "nurse", "spouse"],
              missingActorRoles: [],
            },
            affectTimelineCoverage: {
              actorRolesWithAffectTimelines: ["patient", "nurse", "spouse"],
              missingActorRoles: [],
              affectTimelineCount: 4,
              claimBoundary: "metadata_only_not_runtime_facial_animation_evidence",
            },
            dialogueActorRoles: ["patient", "nurse", "spouse"],
            missingDialogueActorRoles: [],
            gazeActorRoles: ["patient", "nurse", "spouse"],
            missingGazeActorRoles: [],
            placementActorRoles: ["patient", "nurse", "spouse"],
            missingPlacementActorRoles: [],
            affectActorRoles: ["patient", "nurse", "spouse"],
            missingAffectActorRoles: [],
            affectTimelineCount: 4,
            affectClaimBoundary: "metadata_only_not_runtime_facial_animation_evidence",
            blockerIds: [],
            warningIds: [],
          },
          inputPlanningSummary: {
            schemaVersion: "openclinxr.encounter-factory-input-planning-summary.v1",
            claimBoundary: "metadata_only_not_asset_generation",
            source: "scenario_definition_and_dialogue_seed_bank",
            scenarioId: "ed_chest_pain_priority_v1",
            assetWorkOrderIntent: {
              actor: 3,
              environment: 1,
              equipment: 6,
              total: 10,
            },
            sharedAssetLibraryReuse: {
              cacheDisposition: "lookup_before_generate",
              lookupKeyCount: 3,
              lookupKeys: [
                "semantic::actor::patient::patient_robert_hayes_v1",
                "semantic::environment::ed_exam_bay_v1",
                "semantic::equipment::12_lead_ecg_machine",
              ],
              requiresEvidenceGateCompatibility: true,
            },
            dynamicBehaviorTraceTags: ["ecg_request", "family_communication", "urgent_escalation"],
            factorySelectionMetadata: {
              scenarioBankOrder: 1,
              factorySelectionRole: "anchor",
              factorySelectionMode: "next_scenario_fallback",
              factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
            },
            blockerIds: [],
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          },
          encounterFactoryDryRunSummary: {
            planId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin:dry-run-plan:v1",
            status: "review_plan_created_not_asset_generation",
            sourceRequestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
            sourceScenarioId: "ed_chest_pain_priority_v1",
            actorRoles: ["patient", "nurse", "spouse"],
            stageIds: [
              "scenario_definition_to_asset_requirements",
              "humanoid_roles_to_realism_profiles",
              "runtime_bundle_binding_plan",
              "publication_and_evidence_gate_plan",
            ],
            reviewGateIds: ["scenario_configuration_review", "humanoid_profile_review", "dialogue_viseme_gaze_review"],
            blockerIds: [],
            warningIds: [],
            recommendedNextAction: "review_factory_plan_before_generation_or_publication",
            dynamicBehaviorCoverage: {
              schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1",
              claimBoundary: "metadata_only_not_runtime_behavior_evidence",
              dialogueTurnCoverage: {
                actorRolesWithDialogueTurns: ["patient", "nurse", "spouse"],
                missingActorRoles: [],
                dialogueTurnCount: 4,
              },
              gazeTargetCoverage: {
                actorRolesWithGazeTargets: ["patient", "nurse", "spouse"],
                actorRolesWithActorTargetSupport: ["patient", "nurse", "spouse"],
                missingActorRoles: [],
              },
              actorRolePlacementCoverage: {
                actorRolesWithPlacements: ["patient", "nurse", "spouse"],
                missingActorRoles: [],
              },
              affectTimelineCoverage: {
                actorRolesWithAffectTimelines: ["patient", "nurse", "spouse"],
                missingActorRoles: [],
                affectTimelineCount: 4,
                claimBoundary: "metadata_only_not_runtime_facial_animation_evidence",
              },
              blockerIds: [],
              warningIds: [],
            },
            claimBoundary: "encounter_factory_dry_run_not_asset_generation",
            evidenceBoundaries: {
              metadataOnlyPlan: true,
              generatedAssetsMaterialized: false,
              runtimeBundlePublished: false,
              learnerRuntimeEnabled: false,
              questReadinessClaimed: false,
              productionReadinessClaimed: false,
            },
          },
          claimBoundary: "publication_readiness_not_learner_bundle_persistence",
          notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
        }}
        onInitiateSceneGeneration={onInitiateSceneGeneration}
        onAttachSceneGenerationReview={onAttachSceneGenerationReview}
        onCheckSceneGenerationPublicationReadiness={onCheckSceneGenerationPublicationReadiness}
      />,
    );

    const panel = screen.getByLabelText("3D environment generation queue");
    expect(within(panel).getByRole("heading", { name: "3D Environment Generation Queue" })).toBeInTheDocument();
    expect(within(panel).getByText("12 environment packets")).toBeInTheDocument();
    expect(within(panel).getAllByText("12 blocked before generation review").length).toBeGreaterThan(0);
    expect(within(panel).getByText("0 ready for generation review")).toBeInTheDocument();
    expect(within(panel).getByText("5 pending authoring tasks")).toBeInTheDocument();
    expect(within(panel).getByText("1 blocked work order")).toBeInTheDocument();
    expect(within(panel).getByText("work_order_queue_not_asset_production")).toBeInTheDocument();
    expect(within(panel).getByText("attach_environment_generation_evidence: 12")).toBeInTheDocument();
    expect(within(panel).getByText("do_not_use_stablegen_without_legal_exception: 1")).toBeInTheDocument();
    expect(within(panel).getByText("Missing evidence types")).toBeInTheDocument();
    expect(within(panel).getByText("blender_bake_report: 1, clinical_visual_review_request: 1, collider_simplification_report: 1")).toBeInTheDocument();
    expect(within(panel).getByText("ED chest pain exam bay")).toBeInTheDocument();
    expect(within(panel).getByText("ed_exam_bay_environment")).toBeInTheDocument();
    expect(within(panel).getByText("5 spatial zones; first zone: patient_bedside. Required assets: 2.")).toBeInTheDocument();
    expect(panel).toHaveTextContent(
      "Required evidence: blender_bake_report, gltf_validation_report, quest_budget_report",
    );
    expect(panel).toHaveTextContent(
      "Handoff summary: ED chest pain exam bay: 5 authoring tasks and 8 evidence outputs before generation review.",
    );
    expect(panel).toHaveTextContent("Next action: Attach Blender/manual-modeling export evidence.");
    expect(panel).toHaveTextContent("Missing evidence: blender_bake_report, clinical_visual_review_request, collider_simplification_report");
    expect(panel).toHaveTextContent("Review blockers: environment_generation_evidence_missing");
    expect(panel).toHaveTextContent("Handoff boundary: operator_handoff_not_asset_generation");
    expect(panel).toHaveTextContent("Gate blockers: environment_generation_evidence_missing");
    expect(panel).toHaveTextContent("5 authoring tasks");
    expect(panel).toHaveTextContent("prepare_scene_layout");
    expect(panel).toHaveTextContent("blender");
    expect(panel).toHaveTextContent("authoring_work_order_not_generated_asset");
    expect(panel).toHaveTextContent("Admin-initiated scene generation starts after scenario configuration");
    expect(panel).toHaveTextContent("humanoids, hair, clothing, rigging, animation, equipment, environment assets, blob publication, runtime bundle binding, and review evidence");
    expect(panel).toHaveTextContent("Planning/review packet only; no generated asset, runtime dependency, or Quest evidence is implied.");
    expect(within(panel).getByText("9 pending pipeline stages")).toBeInTheDocument();
    expect(within(panel).getByText("scene_generation_pipeline_queue_not_asset_production")).toBeInTheDocument();
    expect(within(panel).getByText("factory target peds_asthma_parent_anxiety_v1")).toBeInTheDocument();
    expect(within(panel).getByText("review_gated_factory_metadata_only; generation approval inferred false")).toBeInTheDocument();
    expect(within(panel).getByText("Scene pipeline: peds_asthma_parent_anxiety_v1")).toBeInTheDocument();
    expect(within(panel).getByText("review-gated factory target")).toBeInTheDocument();
    const humanoidRuntimeHandoff = within(panel).getByLabelText("Humanoid runtime readiness handoff");
    expect(humanoidRuntimeHandoff).toHaveTextContent("Humanoid runtime readiness handoff");
    expect(humanoidRuntimeHandoff).toHaveTextContent("patient");
    expect(humanoidRuntimeHandoff).toHaveTextContent("badge realismBlocked until actor-specific humanoid gate evidence attaches");
    expect(humanoidRuntimeHandoff).toHaveTextContent("animated_humanoid_runtime_playback");
    expect(humanoidRuntimeHandoff).toHaveTextContent("dialogue_viseme_and_gaze_mapping");
    expect(humanoidRuntimeHandoff).toHaveTextContent("emotion_aligned_expression_transition_cue");
    expect(humanoidRuntimeHandoff).toHaveTextContent("dialogue_eye_micro_saccade_blink_cue");
    expect(humanoidRuntimeHandoff).toHaveTextContent("generated_eyelid_blink_control_cue");
    expect(humanoidRuntimeHandoff).toHaveTextContent("locomotion true");
    expect(humanoidRuntimeHandoff).toHaveTextContent("expression true");
    expect(humanoidRuntimeHandoff).toHaveTextContent("gaze true");
    expect(humanoidRuntimeHandoff).toHaveTextContent("lip-sync true");
    expect(humanoidRuntimeHandoff).toHaveTextContent("interactive true");
    expect(humanoidRuntimeHandoff).toHaveTextContent("runtime_realism_evidence_not_attached_to_encounter_bundle");
    expect(humanoidRuntimeHandoff).toHaveTextContent("visual_qa_evidence_not_attached_to_encounter_bundle");
    expect(humanoidRuntimeHandoff).toHaveTextContent("case_definition_humanoid_runtime_handoff_metadata_only");
    expect(humanoidRuntimeHandoff).toHaveTextContent("generated_humanoid_asset_readiness, animation_quality, quest_readiness, runtime_readiness, clinical_validity, scoring_validity");
    expect(within(panel).getByText("1 scene generation requests")).toBeInTheDocument();
    expect(within(panel).getByText("scene_generation_request_queue_not_asset_production")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Latest scene request: ed_chest_pain_priority_v1");
    expect(panel).toHaveTextContent("pending_runtime_asset_review");
    expect(panel).toHaveTextContent("attach_runtime_asset_review_decisions");
    expect(panel).toHaveTextContent("Publication gate: ready to run generated bundle publisher");
    expect(panel).toHaveTextContent("learner runtime gate: blocked");
    expect(panel).toHaveTextContent("Learner-use blockers: runtime_realism_evidence_not_attached_to_encounter_bundle, visual_qa_evidence_not_attached_to_encounter_bundle, quest_runtime_evidence_not_attached_to_encounter_bundle");
    expect(panel).toHaveTextContent("publication_readiness_not_learner_bundle_persistence");
    expect(panel).toHaveTextContent("Evidence gates: asset_production_review attached requires no additional signal ids, runtime_realism_evidence pending (1 blockers) requires animated_humanoid_runtime_playback, emotion_aligned_expression_transition_cue, visual_qa_evidence pending (1 blockers) requires humanoid_realism_visual_qa_review, emotion_expression_transition_readability");
    expect(panel).toHaveTextContent("Scenario status boundary: approved; approved_scenario_factory_planning_only; learner-use blocked=false; blockers none; scenario_status_gate_not_clinical_or_production_readiness");
    expect(panel).toHaveTextContent("Runtime bundle gate refs: runtime_bundle_assembly_audit blocked (runtime_realism_evidence_not_attached_to_encounter_bundle), human_runtime_asset_review attached");
    expect(panel).toHaveTextContent("Runtime bundle assembly audit: sources scenario_definition:ed_chest_pain_priority_v1; humanoid refs patient:patient_robert_hayes_v1; learner-use blocked until gates attach=true; asset_reference_audit_metadata_not_materialized_assets");
    expect(panel).toHaveTextContent("Publication metadata: 6 generated asset refs; 3 humanoids; 2 equipment refs; publication review refs generated_patient_model_review_gate_v1:privacy_evidence; local_publication_metadata_not_runtime_readiness");
    expect(panel).toHaveTextContent("Humanoid realism profiles: 3; actor roles: patient, nurse, spouse; required signals: animated_humanoid_runtime_playback, dialogue_viseme_and_gaze_mapping, dialogue_eye_micro_saccade_blink_cue, generated_eyelid_blink_control_cue; metadata_only_not_visual_quality_evidence");
    expect(panel).toHaveTextContent("Humanoid metadata blockers: humanoid_metadata_review_required:animated_humanoid_runtime_playback, humanoid_metadata_review_required:dialogue_viseme_and_gaze_mapping");
    expect(panel).toHaveTextContent("Human review actions: review_humanoid_realism_metadata available (humanoid_metadata_review_required:dialogue_viseme_and_gaze_mapping), resolve_scenario_approval_boundary complete; human_review_action_not_automated_approval");
    expect(panel).toHaveTextContent("Dynamic behavior coverage: dialogue patient, nurse, spouse; gaze patient, nurse, spouse; placement patient, nurse, spouse; affect patient, nurse, spouse (4 timelines; metadata_only_not_runtime_facial_animation_evidence); missing none; blockers none; metadata_only_not_runtime_behavior_evidence");
    expect(panel).toHaveTextContent("Encounter factory input planning: 10 work-order intents (actors 3, environment 1, equipment 6); shared asset lookup keys 3; dynamic behavior tags ecg_request, family_communication, urgent_escalation; factory selection anchor order 1 via next_scenario_fallback (review_gated_factory_metadata_only); blockers none; metadata_only_not_asset_generation");
    expect(panel).toHaveTextContent(
      "Encounter factory dry-run: status review_plan_created_not_asset_generation; 4 stages; actors patient, nurse, spouse; review gates scenario_configuration_review, humanoid_profile_review, dialogue_viseme_gaze_review; next review_factory_plan_before_generation_or_publication; blockers none; warnings none; boundaries metadataOnly=true generatedAssets=false learnerRuntime=false questClaim=false; encounter_factory_dry_run_not_asset_generation",
    );
    expect(panel).toHaveTextContent("Scene pipeline: peds_asthma_parent_anxiety_v1");
    expect(panel).toHaveTextContent("admin_scenario_configuration -> asset_need_expansion -> humanoid_generation -> hair_clothing_skin_generation -> rigging_animation_generation");
    expect(panel).toHaveTextContent(sceneGenerationRequestProjectionArtifactStatusLabel("pending_runtime_asset_review"));
    expect(panel).toHaveTextContent("0 runtime asset review decisions");
    expect(panel).toHaveTextContent("Factory planning context: scene_generation_pipeline:ed_chest_pain_priority_v1; featured=false; review_gated_factory_metadata_only; generation approval inferred false");
    fireEvent.click(within(panel).getByRole("button", { name: "Initiate scene generation request" }));
    expect(onInitiateSceneGeneration).toHaveBeenCalledWith("peds_asthma_parent_anxiety_v1");
    fireEvent.click(within(panel).getByRole("button", { name: "Attach local runtime review decisions" }));
    expect(onAttachSceneGenerationReview).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
    }));
    fireEvent.click(within(panel).getByRole("button", { name: "Check publication readiness" }));
    expect(onCheckSceneGenerationPublicationReadiness).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
    }));
    expect(findUnsafeClaimLanguage(panel.textContent ?? "")).toEqual([]);
  });

  it("colors attached scene generation review status as the attached state", () => {
    render(
      <EnvironmentGenerationQueuePanel
        environmentGenerationQueue={environmentGenerationQueueFixture()}
        sceneGenerationPipelineQueue={sceneGenerationPipelineQueueFixture()}
        sceneGenerationRequestQueue={{
          requestCount: 1,
          claimBoundary: "scene_generation_request_queue_not_asset_production",
          requests: [
            {
              requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
              scenarioId: "ed_chest_pain_priority_v1",
              createdAt: "2026-05-22T23:09:00.000Z",
              status: "accepted",
              reviewStatus: "runtime_asset_review_attached",
              nextAction: "run_generated_bundle_publisher",
              runtimeAssetReviewDecisionCount: 1,
              accepted: true,
              productionAssetReadinessClaimed: false,
              claimBoundary: "scene_generation_request_not_asset_production",
              workOrder: sceneGenerationPipelineQueueFixture().workOrders[0]!,
            },
          ],
        }}
      />,
    );

    const reviewStatusTag = screen.getByText("runtime_asset_review_attached").closest(".ant-tag");
    expect(reviewStatusTag).toHaveClass(`ant-tag-${sceneGenerationRequestReviewStatusColor("runtime_asset_review_attached")}`);
    expect(findUnsafeClaimLanguage(screen.getByLabelText("Latest scene generation request review status").textContent ?? "")).toEqual([]);

    const projectionArtifactStatusTag = screen.getByText(sceneGenerationRequestProjectionArtifactStatusLabel("runtime_asset_review_attached")).closest(".ant-tag");
    expect(projectionArtifactStatusTag).toHaveClass(
      `ant-tag-${sceneGenerationRequestProjectionArtifactStatusColor("runtime_asset_review_attached")}`,
    );
  });

  it("keeps draft scenario publication readiness visibly blocked after runtime review attaches", () => {
    render(
      <EnvironmentGenerationQueuePanel
        environmentGenerationQueue={environmentGenerationQueueFixture()}
        sceneGenerationPipelineQueue={sceneGenerationPipelineQueueFixture()}
        sceneGenerationRequestQueue={{
          requestCount: 1,
          claimBoundary: "scene_generation_request_queue_not_asset_production",
          requests: [
            {
              requestId: "scene_generation_request:peds_asthma_parent_anxiety_v1:local-admin",
              scenarioId: "peds_asthma_parent_anxiety_v1",
              createdAt: "2026-05-22T23:09:00.000Z",
              status: "accepted",
              reviewStatus: "runtime_asset_review_attached",
              nextAction: "attach_runtime_asset_review_decisions",
              runtimeAssetReviewDecisionCount: 1,
              accepted: true,
              productionAssetReadinessClaimed: false,
              claimBoundary: "scene_generation_request_not_asset_production",
              factoryPlanningContext: {
                scenarioId: "peds_asthma_parent_anxiety_v1",
                workOrderId: "scene_generation_pipeline:peds_asthma_parent_anxiety_v1",
                isFeaturedFactoryPlanningTarget: true,
                factoryPlanningClaimBoundary: "review_gated_factory_metadata_only",
                generationApprovalInferred: false,
              },
              workOrder: sceneGenerationPipelineQueueFixture().workOrders[1]!,
            },
          ],
        }}
        sceneGenerationPublicationReadiness={{
          requestId: "scene_generation_request:peds_asthma_parent_anxiety_v1:local-admin",
          scenarioId: "peds_asthma_parent_anxiety_v1",
          canRunGeneratedBundlePublisher: false,
          canUseGeneratedBundleForLearnerRuntime: false,
          blockers: ["scenario_status:draft", "human_scenario_approval_required"],
          learnerRuntimeUseBlockers: [],
          nextAction: "attach_runtime_asset_review_decisions",
          scenarioReviewGate: {
            scenarioStatus: "draft",
            approvalBoundary: "draft_no_learner_use_without_human_approval",
            learnerUseBlocked: true,
            blockerIds: ["scenario_status:draft", "human_scenario_approval_required"],
            claimBoundary: "scenario_status_gate_not_clinical_or_production_readiness",
          },
          claimBoundary: "publication_readiness_not_learner_bundle_persistence",
          notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
        }}
      />,
    );

    const panel = screen.getByLabelText("3D environment generation queue");
    expect(panel).toHaveTextContent("Publication gate: blocked");
    expect(panel).toHaveTextContent(
      "Scenario status boundary: draft; draft_no_learner_use_without_human_approval; learner-use blocked=true; blockers scenario_status:draft, human_scenario_approval_required; scenario_status_gate_not_clinical_or_production_readiness",
    );
    expect(panel).toHaveTextContent(
      "Factory planning context: scene_generation_pipeline:peds_asthma_parent_anxiety_v1; featured=true; review_gated_factory_metadata_only; generation approval inferred false",
    );
    expect(panel).not.toHaveTextContent("Publication gate: ready to run generated bundle publisher");
    expect(findUnsafeClaimLanguage(panel.textContent ?? "")).toEqual([]);
  });
});

function environmentGenerationQueueFixture(): EnvironmentGenerationQueue {
  return {
    scenarioCount: 12,
    packetCount: 12,
    readyForGenerationReviewScenarioIds: [],
    blockedScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
    nextReviewGateCounts: { attach_environment_generation_evidence: 12 },
    packets: [
      {
        scenarioId: "ed_chest_pain_priority_v1",
        environmentAssetId: "ed_exam_bay_environment",
        displayName: "ED chest pain exam bay",
        targetRuntime: "quest3_webxr",
        claimBoundary: "environment_generation_plan_not_generated_asset",
        requiredAssetIds: ["ed_exam_bay_environment", "patient_robert_hayes_character"],
        optionalContextAssetIds: ["ecg_cart_equipment"],
        spatialZones: [
          {
            zoneId: "patient_bedside",
            label: "Patient bedside interaction",
            purpose: "Anchor history and focused exam interaction.",
            assetIds: ["ed_exam_bay_environment", "patient_robert_hayes_character"],
            spatialAnchors: ["patient_head_position"],
            clinicalFidelityNotes: ["Keep bedside interaction readable."],
          },
          {
            zoneId: "learner_entry",
            label: "Learner entry",
            purpose: "Start the station safely.",
            assetIds: ["ed_exam_bay_environment"],
            spatialAnchors: ["doorway_panel"],
            clinicalFidelityNotes: ["Clear entry sightline."],
          },
          {
            zoneId: "nurse_workflow",
            label: "Nurse workflow",
            purpose: "Support handoff pressure.",
            assetIds: ["nurse_maria_alvarez_character"],
            spatialAnchors: ["nurse_standing_zone"],
            clinicalFidelityNotes: ["Visible from bedside."],
          },
          {
            zoneId: "family_interrupt",
            label: "Family interruption",
            purpose: "Support family pressure beats.",
            assetIds: ["spouse_anna_hayes_character"],
            spatialAnchors: ["doorway_interrupt_position"],
            clinicalFidelityNotes: ["Do not block bedside access."],
          },
          {
            zoneId: "diagnostic_equipment",
            label: "Diagnostic equipment",
            purpose: "Support ECG and monitor trace events.",
            assetIds: ["ecg_cart_equipment"],
            spatialAnchors: ["ecg_cart_parking_spot"],
            clinicalFidelityNotes: ["Readable low-poly silhouettes."],
          },
        ],
        questBudget: {
          maxVisibleTriangles: 180000,
          maxTextureMegabytes: 512,
          maxDrawCalls: 120,
          totalTriangles: 60000,
          totalTextureMegabytes: 80,
          totalDrawCalls: 28,
          blockers: [],
        },
        authoringToolIds: ["blender"],
        sidecarToolIds: ["skintokens_tokenrig"],
        blockedToolIds: ["stablegen"],
        productionRuntimeToolIds: [],
        reviewGates: [
          {
            gate: "attach_environment_generation_evidence",
            status: "blocked",
            evidenceRefs: [],
            blockers: ["environment_generation_evidence_missing"],
            recommendedAction: "Attach Blender/manual-modeling export evidence.",
          },
        ],
        nextReviewGate: "attach_environment_generation_evidence",
        readyForGenerationReview: false,
      },
    ],
  };
}

function sceneGenerationPipelineQueueFixture(): ScenarioSceneGenerationPipelineWorkOrderQueue {
  return {
    scenarioCount: 1,
    workOrderCount: 1,
    pendingStageCount: 9,
    claimBoundary: "scene_generation_pipeline_queue_not_asset_production",
    featuredFactoryPlanningScenarioId: "peds_asthma_parent_anxiety_v1",
    featuredFactoryPlanningWorkOrderId: "scene_generation_pipeline:peds_asthma_parent_anxiety_v1",
    factoryPlanningClaimBoundary: "review_gated_factory_metadata_only",
    generationApprovalInferred: false,
    storageTargets: [
      {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/",
        emulatorAllowed: true,
      },
    ],
    workOrders: [
      {
        workOrderId: "scene_generation_pipeline:ed_chest_pain_priority_v1",
        scenarioId: "ed_chest_pain_priority_v1",
        scenarioStatus: "approved",
        approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
        initiatedFrom: "admin_scenario_configuration",
        claimBoundary: "admin_initiated_pipeline_contract_not_generated_asset",
        targetRuntime: "quest3_webxr",
        storageTarget: {
          storeKind: "azurite_blob",
          containerName: "openclinxr-assets",
          blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/",
          emulatorAllowed: true,
        },
        scenarioAssetIds: ["patient_robert_hayes_character"],
        characterAssetIds: ["patient_robert_hayes_character"],
        environmentAssetIds: ["ed_exam_bay_environment"],
        equipmentAssetIds: ["12-lead ECG machine"],
        actorWorkOrders: [sceneGenerationActorWorkOrderFixture("patient")],
        environmentWorkOrder: {} as never,
        pipelineStageCount: 9,
        stages: [
          "admin_scenario_configuration",
          "asset_need_expansion",
          "humanoid_generation",
          "hair_clothing_skin_generation",
          "rigging_animation_generation",
          "equipment_environment_generation",
          "blob_storage_publication",
          "runtime_bundle_binding",
          "review_and_quest_evidence",
        ].map((stageId) => ({
          stageId: stageId as never,
          title: stageId,
          status: "pending",
          initiatedBy: "admin_user_after_scenario_configuration",
          requiredInputs: [],
          expectedOutputs: [],
        })),
        requiredOutputEvidence: ["learner_runtime_asset_bundle"],
        prohibitedActions: ["do_not_generate_assets_before_admin_scenario_configuration"],
      },
      {
        workOrderId: "scene_generation_pipeline:peds_asthma_parent_anxiety_v1",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        scenarioStatus: "draft",
        approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
        initiatedFrom: "admin_scenario_configuration",
        claimBoundary: "admin_initiated_pipeline_contract_not_generated_asset",
        targetRuntime: "quest3_webxr",
        storageTarget: {
          storeKind: "azurite_blob",
          containerName: "openclinxr-assets",
          blobPrefix: "scenario-assets/peds_asthma_parent_anxiety_v1/",
          emulatorAllowed: true,
        },
        scenarioAssetIds: ["peds_asthma_patient_character"],
        characterAssetIds: ["peds_asthma_patient_character"],
        environmentAssetIds: ["peds_exam_room_environment"],
        equipmentAssetIds: ["nebulizer"],
        actorWorkOrders: [sceneGenerationActorWorkOrderFixture("patient")],
        environmentWorkOrder: {} as never,
        pipelineStageCount: 9,
        stages: [
          "admin_scenario_configuration",
          "asset_need_expansion",
          "humanoid_generation",
          "hair_clothing_skin_generation",
          "rigging_animation_generation",
          "equipment_environment_generation",
          "blob_storage_publication",
          "runtime_bundle_binding",
          "review_and_quest_evidence",
        ].map((stageId) => ({
          stageId: stageId as never,
          title: stageId,
          status: "pending",
          initiatedBy: "admin_user_after_scenario_configuration",
          requiredInputs: [],
          expectedOutputs: [],
        })),
        requiredOutputEvidence: ["learner_runtime_asset_bundle"],
        prohibitedActions: ["do_not_generate_assets_before_admin_scenario_configuration"],
      },
    ],
  };
}

function sceneGenerationActorWorkOrderFixture(actorRole: string): ScenarioSceneGenerationPipelineWorkOrderQueue["workOrders"][number]["actorWorkOrders"][number] {
  return {
    workOrderId: `actor_asset_work_order:peds_asthma_parent_anxiety_v1:${actorRole}`,
    actorId: `${actorRole}_actor_v1`,
    actorRole,
    displayName: actorRole,
    characterAssetId: `${actorRole}_character_pending_definition`,
    source: "scenario_actor_definition",
    ageBand: "adult",
    appearanceCues: {
      roleAppropriateClothing: [`${actorRole}_role_appropriate_clothing`],
      hairOrHeadCovering: [`${actorRole}_hair_or_head_covering_profile`],
      skinMaterial: [`${actorRole}_skin_material_or_morph_target_profile`],
    },
    riggingAndAnimationCues: ["canonical_skeleton_contract"],
    humanoidRuntimeReadinessHandoff: {
      claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
      actorRole,
      requiredSignalIds: [
        "animated_humanoid_runtime_playback",
        "dialogue_viseme_and_gaze_mapping",
        "emotion_aligned_expression_transition_cue",
        "dialogue_eye_micro_saccade_blink_cue",
        "generated_eyelid_blink_control_cue",
      ],
      locomotionRequired: true,
      expressionRequired: true,
      gazeRequired: true,
      lipSyncRequired: true,
      interactiveRequired: true,
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
    humanoidRealismMetadata: {} as never,
    provenanceAndLicensingRefs: [],
    optimizationAndPerformanceRefs: [],
    requiredEvidenceIds: [],
    evidenceGateRefs: [],
    claimBoundary: "metadata_work_order_not_generated_asset",
  };
}
