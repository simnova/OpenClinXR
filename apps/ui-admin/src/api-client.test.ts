import {
  CreateStationRunQueueSnapshotDocument,
  ReviewPacketReplayDocument,
  SaveFacultyScoreDraftDocument,
  ScenarioBankDocument,
  ScenarioDetailDocument,
  ScenarioReviewDecisionsDocument,
  StationRunQueueSnapshotsDocument,
  SubmitScenarioReviewDocument,
} from "@openclinxr/graphql/client";
import { print } from "graphql";
import { describe, expect, it, vi } from "vitest";
import { type AdminApolloGraphqlClient, buildAdminGraphqlEndpoint, createAdminControlPlaneClient } from "./api-client.js";

describe("admin control-plane API client", () => {
  it("builds the Apollo endpoint from the same base URL as fetch-backed GraphQL requests", () => {
    expect(buildAdminGraphqlEndpoint("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001/admin/graphql");
    expect(buildAdminGraphqlEndpoint("")).toBe("/admin/graphql");
  });

  it("reads readiness through stable REST routes and queue snapshots through GraphQL", async () => {
    const listSnapshotsDocument = print(StationRunQueueSnapshotsDocument);
    const createSnapshotDocument = print(CreateStationRunQueueSnapshotDocument);
    const scenarioBankDocument = print(ScenarioBankDocument);
    const scenarioDetailDocument = print(ScenarioDetailDocument);
    const scenarioReviewDecisionsDocument = print(ScenarioReviewDecisionsDocument);
    const submitScenarioReviewDocument = print(SubmitScenarioReviewDocument);
    const saveFacultyScoreDraftDocument = print(SaveFacultyScoreDraftDocument);
    const reviewPacketReplayDocument = print(ReviewPacketReplayDocument);
    const requests: RecordedRequest[] = [];
    const queueSnapshot = {
      snapshotId: "queue_snapshot_ui_001",
      createdAt: "2026-05-03T17:00:00.000Z",
      reviewerId: "psychometrician_001",
      queue: { canStartLearnerExam: false, stationQueue: new Array(12).fill(null), summary: { activationReady: 1, draftBlocked: 11 } },
    };
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        "/exam-blueprints/step2cs-seed": { stationSlots: new Array(12).fill(null), timing: { breakAfterStationOrders: [3, 6, 9] } },
        "/exam-blueprints/step2cs-seed/readiness": { canAssembleReadyForm: false, blockedScenarioIds: new Array(11).fill(null) },
        "/exam-blueprints/step2cs-seed/timing-plan": { stationWindows: new Array(12).fill(null), totalStationTimeSeconds: 18720 },
        "/exam-blueprints/step2cs-seed/station-run-queue": { canStartLearnerExam: false, stationQueue: new Array(12).fill(null) },
        "/scenario-bank/scene-generation/pipeline": {
          scenarioCount: 12,
          workOrderCount: 12,
          pendingStageCount: 108,
          claimBoundary: "scene_generation_pipeline_queue_not_asset_production",
          workOrders: [
            {
              scenarioId: "ed_chest_pain_priority_v1",
              initiatedFrom: "admin_scenario_configuration",
              stages: [{ stageId: "humanoid_generation" }],
            },
          ],
        },
        "GET /scenario-bank/scene-generation/requests": {
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
              workOrder: {
                scenarioId: "ed_chest_pain_priority_v1",
                initiatedFrom: "admin_scenario_configuration",
              },
            },
          ],
        },
        "POST /scenario-bank/scene-generation/requests": {
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
          workOrder: {
            scenarioId: "ed_chest_pain_priority_v1",
            initiatedFrom: "admin_scenario_configuration",
          },
        },
        "POST /scenario-bank/scene-generation/requests/scene_generation_request%3Aed_chest_pain_priority_v1%3Alocal-admin/runtime-asset-review-decisions": {
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
          workOrder: {
            scenarioId: "ed_chest_pain_priority_v1",
            initiatedFrom: "admin_scenario_configuration",
          },
        },
        "POST /scenario-bank/scene-generation/requests/scene_generation_request%3Aed_chest_pain_priority_v1%3Alocal-admin/materialization-input-review-decisions": {
          schemaVersion: "openclinxr.encounter-materialization-input-review-decision-record.v1",
          source: "admin_materialization_input_review_decisions",
          requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
          scenarioId: "ed_chest_pain_priority_v1",
          decisionCount: 1,
          reviewedDecisionCount: 0,
          heldDecisionCount: 1,
          decisions: [
            {
              actionId: "hold_actor_materialization_inputs",
              reviewerId: "asset_pipeline_reviewer",
              decision: "held_metadata_only",
              comments: "Hold actor inputs until evidence attaches.",
              evidenceRefs: ["encounter-materialization-input-manifest-peds-asthma-parent-anxiety-2026-05-28"],
              reviewedAt: "2026-05-28T06:30:00.000Z",
            },
          ],
          providerExecutionAllowed: false,
          runtimeExecutionAllowed: false,
          learnerLaunchAllowed: false,
          questEvidenceRefreshAllowed: false,
          claimBoundary: "metadata_only_materialization_input_review_decisions",
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
        },
        "GET /scenario-bank/scene-generation/requests/scene_generation_request%3Aed_chest_pain_priority_v1%3Alocal-admin/publication-readiness": {
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
              blockerIds: [
                "runtime_realism_evidence_not_attached_to_encounter_bundle",
                "visual_qa_evidence_not_attached_to_encounter_bundle",
                "quest_runtime_evidence_not_attached_to_encounter_bundle",
              ],
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
            "humanoid_metadata_review_required:dialogue_viseme_and_gaze_mapping",
            "humanoid_metadata_review_required:generated_eyelid_blink_control_cue",
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
          ],
          nextAction: "run_generated_bundle_publisher",
          evidenceGateRefs: [
            {
              gateId: "asset_production_review",
              status: "attached",
              evidenceRefs: ["generated_patient_model_review_gate_v1:privacy_evidence"],
              requiredSignalIds: [],
              blockers: [],
              notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
            },
            {
              gateId: "runtime_realism_evidence",
              status: "pending",
              evidenceRefs: [],
              requiredSignalIds: ["animated_humanoid_runtime_playback", "emotion_aligned_expression_transition_cue"],
              blockers: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
              notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
            },
            {
              gateId: "visual_qa_evidence",
              status: "pending",
              evidenceRefs: [],
              requiredSignalIds: ["humanoid_realism_visual_qa_review", "emotion_expression_transition_readability"],
              blockers: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
              notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
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
            humanoidRealismProfileSummary: {
              profileCount: 3,
              actorRoles: ["patient", "nurse", "spouse"],
              requiredSignalIds: [
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
            notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
          },
          dynamicBehaviorCoverage: {
            claimBoundary: "metadata_only_not_runtime_behavior_evidence",
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
          encounterFactoryDryRunSummary: {
            planId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin:dry-run-plan:v1",
            status: "review_plan_created_not_asset_generation",
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
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
        },
        "/sessions": { stationRunId: "run_ed_chest_pain_priority_v1_admin_review_seed", scenarioId: "ed_chest_pain_priority_v1", phase: "doorway" },
        "/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/start-encounter": { stationRunId: "run_ed_chest_pain_priority_v1_admin_review_seed", phase: "encounter" },
        "/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/events": { stationRunId: "run_ed_chest_pain_priority_v1_admin_review_seed", eventType: "learner.action" },
        "/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/note": { phase: "review" },
        "/admin/graphql#ScenarioBank": {
          data: {
            scenarios: [
              {
                scenarioId: "ed_chest_pain_priority_v1",
                version: 1,
                title: "ED Chest Pain With Nurse Interruption And Family Pressure",
                status: "APPROVED",
                clinicalObjectives: ["Elicit focused chest pain history and risk factors"],
                requiredTraceTags: ["ecg_request", "urgent_escalation"],
                review: { clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
                governance: {
                  scoreUseLabel: "formative_local_only",
                  syntheticCaseDisclosure: "Synthetic local training scenario; not a validated summative assessment.",
                  validationStage: "stage_1_expert_reviewed",
                  requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
                  sourceIds: ["src-step2cs-public-archive"],
                },
                actors: [
                  { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious" },
                ],
                assetNeeds: [
                  { assetId: "ed_exam_bay_environment", assetType: "environment", licenseStatus: "placeholder-approved" },
                ],
              },
            ],
          },
        },
        "/admin/graphql#ScenarioDetail": {
          data: {
            scenario: {
              scenarioId: "ed_chest_pain_priority_v1",
              version: 1,
              title: "ED Chest Pain With Nurse Interruption And Family Pressure",
              status: "APPROVED",
              clinicalObjectives: ["Elicit focused chest pain history and risk factors"],
              requiredTraceTags: ["ecg_request", "urgent_escalation"],
              review: { clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
              governance: {
                scoreUseLabel: "formative_local_only",
                syntheticCaseDisclosure: "Synthetic local training scenario; not a validated summative assessment.",
                validationStage: "stage_1_expert_reviewed",
                requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
                sourceIds: ["src-step2cs-public-archive"],
              },
              environment: {
                environmentId: "ed_exam_bay_v1",
                name: "Emergency department exam bay",
                description: "Busy ED bay with monitor alarms and nurse interruptions",
              },
              equipment: ["12-lead ECG machine"],
              actors: [
                { actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes", demeanor: "anxious" },
              ],
              assetNeeds: [
                { assetId: "ed_exam_bay_environment", assetType: "environment", description: "ED bay", licenseStatus: "placeholder-approved" },
              ],
            },
            assetReadiness: {
              scenarioId: "ed_chest_pain_priority_v1",
              devReady: true,
              productionReady: false,
              missingRequiredAssetIds: [],
              blockedAssets: [],
              productionBlockedAssets: [
                { assetId: "patient_robert_hayes_character", blockers: ["placeholder_asset_not_clinical_release_ready"] },
              ],
              productionReadinessLadder: {
                scenarioId: "ed_chest_pain_priority_v1",
                productionReady: false,
                assetCount: 1,
                productionReadyAssetIds: [],
                blockedAssetIds: ["patient_robert_hayes_character"],
                missingRequiredAssetIds: [],
                blockers: ["patient_robert_hayes_character:visual_clinical_critique_missing"],
                stationBudget: {
                  totalTriangles: 48000,
                  totalTextureMegabytes: 72,
                  totalDrawCalls: 24,
                  blockers: [],
                },
                assetLadders: [
                  {
                    assetId: "patient_robert_hayes_character",
                    productionReady: false,
                    blockers: ["visual_clinical_critique_missing"],
                    steps: [
                      { step: "provenance_license", status: "complete", evidenceRefs: ["license:patient"], blockers: [] },
                      { step: "visual_clinical_critique", status: "blocked", evidenceRefs: [], blockers: ["visual_clinical_critique_missing"] },
                    ],
                  },
                ],
              },
            },
          },
        },
        "/admin/graphql#StationRunQueueSnapshots": { data: { stationRunQueueSnapshots: [queueSnapshot] } },
        "/admin/graphql#CreateStationRunQueueSnapshot": { data: { createStationRunQueueSnapshot: queueSnapshot } },
        "/admin/graphql#SubmitScenarioReview": {
          data: {
            submitScenarioReview: {
              scenarioId: "peds_asthma_parent_anxiety_v1",
              version: 1,
              title: "Pediatric Asthma With Parent Anxiety",
              status: "READY_FOR_REVIEW",
              clinicalObjectives: ["Assess pediatric respiratory distress"],
              requiredTraceTags: ["oxygen_request"],
              review: { clinical: "approved", psychometric: "draft", legal: "draft", simulationQa: "draft" },
              governance: {
                scoreUseLabel: "formative_local_only",
                syntheticCaseDisclosure: "Synthetic local training scenario.",
                validationStage: "stage_0_synthetic_draft",
                requiredReviewerRoles: ["pediatrician", "psychometrician", "legal", "simulation_qa"],
                sourceIds: ["src-openclinxr-sample-case-bank-v1"],
              },
              environment: null,
              equipment: [],
              actors: [],
              assetNeeds: [],
            },
          },
        },
        "/admin/graphql#ScenarioReviewDecisions": {
          data: {
            scenarioReviewDecisions: [
              {
                scenarioId: "peds_asthma_parent_anxiety_v1",
                version: 1,
                reviewerRole: "clinical",
                reviewerId: "pediatrician_001",
                decision: "approved",
                comments: "Clinical review complete.",
                evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
                reviewedAt: "2026-05-04T09:00:00.000Z",
              },
            ],
          },
        },
        "/admin/graphql#SaveFacultyScoreDraft": {
          data: {
            saveFacultyScoreDraft: {
              stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
              scenarioId: "ed_chest_pain_priority_v1",
              observedTraceTags: ["ecg_request"],
              missingRequiredTraceTags: ["team_communication"],
              lateTraceTags: [],
              unsafeEvents: [],
              traceQuality: {
                eventCount: 3,
                modelGeneratedEventCount: 0,
                modelFailedEventCount: 0,
                voiceAudioEventCount: 0,
                blockedGuardrailCount: 0,
                unsafeEventCount: 0,
                missingRequiredTraceTagCount: 1,
                hasPatientNote: false,
                hasModelProvenance: false,
              },
              facultyScoreDraft: {
                reviewerId: "faculty_002",
                status: "draft",
                comments: "ECG escalation was captured.",
              },
            },
          },
        },
        "/admin/graphql#ReviewPacketReplay": {
          data: {
            reviewPacket: {
              stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
              scenarioId: "ed_chest_pain_priority_v1",
              observedTraceTags: ["ecg_request", "urgent_escalation"],
              missingRequiredTraceTags: ["team_communication"],
              lateTraceTags: [],
              unsafeEvents: [],
              timeline: [
                {
                  sequence: 2,
                  atSecond: 83,
                  eventType: "learner.utterance",
                  source: "learner",
                  actorId: "patient_robert_hayes_v1",
                  tag: "ecg_request",
                  summary: "Learner requested an ECG.",
                },
              ],
              traceQuality: {
                eventCount: 4,
                modelGeneratedEventCount: 1,
                modelFailedEventCount: 0,
                voiceAudioEventCount: 0,
                blockedGuardrailCount: 0,
                unsafeEventCount: 0,
                missingRequiredTraceTagCount: 1,
                hasPatientNote: true,
                hasModelProvenance: true,
              },
              patientNote: {
                submittedAtSecond: 960,
                text: "Chest pain requires urgent ECG escalation.",
              },
              facultyScoreDraft: {
                reviewerId: "faculty_001",
                status: "draft",
                comments: "Needs team communication evidence.",
              },
            },
            clinicalEventReviewSummary: {
              stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
              eventCount: 1,
              redactedEventCount: 1,
              clinicalEventKinds: { clinical_action_recorded: 1 },
              traceTags: ["ecg_request"],
              statusCounts: { completed: 1 },
              latestAtSecond: 83,
              durableStore: "database_source_of_truth",
              safeForFacultyReview: true,
            },
            traceEvents: [
              {
                sequence: 2,
                eventType: "learner.utterance",
                atSecond: 83,
                source: "learner",
                actorId: "patient_robert_hayes_v1",
                tag: "ecg_request",
              },
            ],
          },
        },
        "/sessions/run_ed_chest_pain_priority_v1_learner_001/review-replay-readiness": {
          stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
          replayEvidenceReady: false,
          facultyReviewSafe: true,
          timelineEntryCount: 1,
          traceEventCount: 2,
          durableEventCount: 1,
          redactedDurableEventCount: 1,
          missingRequiredBehaviorCount: 1,
          lateBehaviorCount: 1,
          safetySignalCount: 1,
          blockers: ["missing_required_behavior", "late_behavior_present"],
          recommendedNextAction: "review_missing_required_behavior",
          replayBoundary: "summary_only_faculty_review_not_score_use",
          caseDefinedHumanoidPerformanceContract: {
            claimBoundary: "case_definition_humanoid_performance_metadata_only",
            actorCount: 3,
            locomotionActorRoles: ["family", "nurse", "patient"],
            expressionActorRoles: ["family", "nurse", "patient"],
            gazeActorRoles: ["family", "nurse", "patient"],
            lipSyncActorRoles: ["family", "nurse", "patient"],
            interactiveActorRoles: ["family", "nurse", "patient"],
            emotionStateCount: 9,
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
          },
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
        },
        "/scenario-bank/assets/readiness": [{ scenarioId: "ed_chest_pain_priority_v1", devReady: true, productionReady: false }],
        "/scenarios/ed-chest-pain/publication-readiness": {
          scenarioId: "ed_chest_pain_priority_v1",
          targetUse: "local_formative",
          releaseLabel: "formative_local_only",
          canPublishForLearnerUse: false,
          requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
          missingReviewerRoles: ["legal"],
          gateResults: [],
          blockerVisibility: {
            claimBoundary: "publication_blocker_visibility_not_readiness_claim",
            humanReviewRequired: true,
            blockerIds: ["publication_gate_blocked:reviewer_evidence"],
            warningIds: ["publication_gate_warning:asset_readiness"],
            recommendedNextAction: "collect_required_reviewer_evidence",
          },
        },
        "/scenario-bank/maturity": {
          scenarioCount: 12,
          targetScenarioCount: 12,
          missingScenarioCount: 0,
          activationEligibleScenarioIds: ["ed_chest_pain_priority_v1"],
          blockedScenarioIds: [{ scenarioId: "peds_asthma_parent_anxiety_v1", reason: "not_approved" }],
          scenarioMaturityBreakdown: [
            {
              scenarioId: "ed_chest_pain_priority_v1",
              status: "approved",
              validationStage: "stage_1_expert_reviewed",
              activationEligible: true,
              blockerIds: [],
              dialogueSeedReady: true,
              traceabilityReady: true,
              requiredTraceTagCount: 9,
              assetNeedTypes: ["character", "environment"],
              environmentId: "ed_exam_bay_v1",
              recommendedNextAction: "ready_for_local_formative_queue_assembly",
            },
          ],
          clinicalSettings: Array.from({ length: 12 }, (_, index) => `clinical_setting_${index + 1}`),
          hiddenFactPolicy: { redactsAll: true, requiresTriggerForAll: true },
          fixtureCompleteness: { missingRequiredActorRoles: [] },
          pressureActorCoverage: {
            completeScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
            incompleteScenarioIds: [],
            scenarioCountWithNonPatientActors: 12,
            minimumNonPatientActorCount: 1,
          },
          communicationProfileCoverage: {
            actorCount: { total: 38, withCommunicationProfile: 38 },
            incompleteScenarioIds: [],
          },
          dialogueSeedCoverage: {
            seededScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
            missingSeedScenarioIds: [],
            guardrailProbeScenarioIds: Array.from({ length: 12 }, (_, index) => `scenario_${index + 1}`),
          },
        },
        "/scenario-bank/exam-sequence": {
          source: "scenario_bank_ordered_sequence",
          targetStationCount: 12,
          stationCount: 12,
          missingStationCount: 0,
          activationEligibleCount: 1,
          learnerUseBoundary: "activation_ready_only",
          stations: [
            {
              stationOrder: 1,
              scenarioId: "ed_chest_pain_priority_v1",
              learnerUseBoundary: "activation_ready",
              reviewBlockers: [],
            },
            ...Array.from({ length: 11 }, (_, index) => ({
              stationOrder: index + 2,
              scenarioId: `draft_scenario_${index + 1}`,
              learnerUseBoundary: "draft_review_required",
              reviewBlockers: ["scenario_status:draft", "faculty_review_required"],
            })),
          ],
        },
        "/scenario-bank/environments/generation-queue": {
          scenarioCount: 12,
          packetCount: 12,
          readyForGenerationReviewScenarioIds: [],
          blockedScenarioIds: ["ed_chest_pain_priority_v1"],
          nextReviewGateCounts: { attach_environment_generation_evidence: 12 },
          packets: [
            {
              scenarioId: "ed_chest_pain_priority_v1",
              environmentAssetId: "ed_exam_bay_environment",
              displayName: "Emergency department exam bay",
              claimBoundary: "environment_generation_plan_not_generated_asset",
              readyForGenerationReview: false,
              blockedToolIds: ["stablegen"],
              spatialZones: [{ zoneId: "patient_bedside" }],
            },
          ],
        },
        "/scenario-bank/environments/work-orders": {
          scenarioCount: 12,
          workOrderCount: 12,
          blockedWorkOrderCount: 12,
          pendingTaskCount: 60,
          readyForGenerationReviewWorkOrderIds: [],
          claimBoundary: "work_order_queue_not_asset_production",
          nextEvidenceGateCounts: { attach_environment_generation_evidence: 12 },
          prohibitedActionCounts: { do_not_use_stablegen_without_legal_exception: 12 },
          missingEvidenceCounts: { blender_bake_report: 12 },
          workOrders: [
            {
              workOrderId: "environment_work_order:ed_chest_pain_priority_v1:ed_exam_bay_environment",
              scenarioId: "ed_chest_pain_priority_v1",
              environmentAssetId: "ed_exam_bay_environment",
              authoringToolId: "blender",
              claimBoundary: "authoring_work_order_not_generated_asset",
              status: "blocked_pending_evidence",
              tasks: [{ taskId: "prepare_scene_layout" }],
            },
          ],
        },
        "/runtime/provider-readiness": {
          source: "capability-routing-matrix",
          claimBoundary: "deterministic_replay_ready_is_not_live_provider_readiness",
          surfaces: [
            {
              profile: "local-development",
              deterministicReplayReady: true,
              liveInteractiveProviderReady: false,
              interactiveRuntime: { readyCapabilityIds: ["model-dialogue"], notConfiguredCapabilityIds: [], plannedCapabilityIds: [], blockedCapabilityIds: [] },
              assetPipeline: { readyCapabilityIds: [], notConfiguredCapabilityIds: [], plannedCapabilityIds: ["character-generation"], blockedCapabilityIds: [] },
              persistence: { readyCapabilityIds: ["persistence"], notConfiguredCapabilityIds: [], plannedCapabilityIds: [], blockedCapabilityIds: [] },
              warnings: ["deterministic_mock_only_not_live_provider_readiness"],
            },
          ],
        },
        "/scenario-bank/dynamic-encounter-factory/planning": {
          source: "scenario_bank_dynamic_encounter_factory_planning",
          claimBoundary: "review_gated_factory_metadata_only",
          anchorScenarioId: "ed_chest_pain_priority_v1",
          nextFactoryPlanningScenarioId: "ed_chest_pain_priority_v2",
          nextFactoryPlanningScenarioSelectionMode: "next_scenario_fallback",
          learnerUseBoundary: "activation_ready_only",
          scenarios: [
            {
              factoryPlanningOrder: 1,
              scenarioId: "ed_chest_pain_priority_v1",
              title: "Emergency chest pain priority assessment",
              status: "approved",
              validationStage: "stage_1_expert_reviewed",
              actorRoles: ["family", "nurse", "patient"],
              actorCount: 3,
              multiActorReady: true,
              dialogueSeedCount: 3,
              dialogueSeedReady: true,
              traceabilityReady: true,
              requiredTraceTagCount: 10,
              safetyCriticalTraceTagCount: 3,
              eventScheduleCount: 4,
              rubricCount: 5,
              requiredReviewerRoleCount: 4,
              environmentId: "ed_exam_bay_environment",
              equipmentCount: 6,
              assetNeedTypes: ["equipment", "humanoid", "environment"],
              factoryPlanningMetadataComplete: true,
              factoryPlanningMetadataBlockers: [],
              encounterFactoryInputSummary: {
                source: "scenario_definition_and_dialogue_seed_bank",
                scenarioBankOrder: 1,
                factorySelectionRole: "anchor",
                factorySelectionMode: "next_scenario_fallback",
                factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
                actorAssetWorkOrderCount: 3,
                environmentAssetWorkOrderCount: 1,
                equipmentAssetWorkOrderCount: 6,
                sharedAssetLookupKeys: ["actor:patient", "actor:family"],
                dynamicBehaviorTraceTags: ["ecg_request", "family_communication"],
              },
              activationEligible: true,
              learnerUseBoundary: "activation_ready",
              reviewBlockers: [],
              recommendedNextAction: "ready_for_local_formative_exam_sequence",
            },
          ],
          routeContractBoundary: {
            posture: "read_only_review_packet",
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
            learnerLaunchAllowed: false,
            questEvidenceRefreshAllowed: false,
          },
        },
        "/runtime/selection-review-packet": {
          schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
          source: "api_local_runtime_bundle_fixture",
          reviewPacketMode: "read_only_guarded_runtime_handoff",
          selectedScenarioId: "ed_chest_pain_priority_v1",
          selectedEncounterId: "ed_chest_pain_local_encounter",
          selectedStationId: "ed_chest_pain_station_v1",
          selectedRuntimeAssetBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
          handoffArtifactsInternallyPaired: true,
          runtimeCandidates: { model: "mock", voice: "mock" },
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
              plannedOutputCount: 8,
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
              sharedAssetLibrarySemanticKeyCount: 8,
            },
            actorEquipmentMaterializationGate: {
              runtimeSelectionBlockedUntilEvidenceAttached: true,
              actorBlockers: ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"],
              equipmentBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
              caveats: [
                "Shared neutral humanoid reuse is local runtime scaffolding only until actor-specific variants attach.",
                "Generic equipment reuse is local runtime scaffolding only until equipment-specific evidence attaches.",
              ],
              recommendedNextActions: [
                "materialize actor-specific Anny humanoid GLBs before runtime selection",
                "materialize equipment-specific generated GLBs before runtime selection",
              ],
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
            ],
            materializationRequiredBeforeRuntime: true,
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
            questEvidenceRefreshAllowed: false,
            claimBoundary: "operator_review_readiness_metadata_only",
          },
          materializationInputManifestSummary: {
            schemaVersion: "openclinxr.encounter-materialization-input-manifest-summary.v1",
            source: "encounter_materialization_input_manifest",
            scenarioId: "peds_asthma_parent_anxiety_v1",
            actorWorkOrderInputCount: 3,
            equipmentWorkOrderInputCount: 6,
            requiredActorCueIds: ["actor_specific_body_profile_required"],
            requiredEquipmentCueIds: ["clinical_affordance_evidence"],
            blockerIds: [
              "shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness",
              "generic_equipment_reuse_blocks_equipment_specific_asset_readiness",
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
            actorRequiredCueIds: ["actor_specific_body_profile_required"],
            equipmentRequiredCueIds: ["clinical_affordance_evidence"],
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
                comments: "Actor inputs reviewed as metadata only.",
                evidenceRefs: ["encounter-materialization-input://peds/actors"],
                reviewedAt: "2026-05-28T06:00:00.000Z",
              },
              {
                actionId: "hold_equipment_materialization_inputs",
                reviewerId: "asset-reviewer",
                decision: "held_metadata_only",
                comments: "Equipment inputs held until evidence attaches.",
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
            { checkId: "confirm_selector_guard_remains_disabled", status: "required_before_runtime_wiring", blockerIds: ["runtime_selector_disabled_guard_not_wired"] },
          ],
          blockers: ["runtime_selector_disabled_guard_not_wired", "publication_payload_not_materialized"],
          nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
          claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
        },
        "/runtime/protocols": {
          primaryRuntimeTarget: "bun-hono",
          localFallbackRuntimeTarget: "node-hono",
          azureRuntimeTarget: "azure-functions-node",
          protocols: [
            {
              protocolId: "websocket",
              status: "contract_ready",
              claimScope: "contract_only",
              runtimeTarget: "bun-hono",
              role: "media-transport",
              clinicalMediaAllowed: true,
              path: "/voice/realtime/ws",
              blockers: ["api_bun_websocket_runtime_not_verified"],
              notes: "Evidence required before runtime-ready claim.",
            },
          ],
        },
        "/voice/realtime/posture": {
          policy: {
            cloudApisUsed: false,
            paidApisUsed: false,
            modelDownloadsPerformed: false,
            productionUseAllowed: false,
          },
          transports: {
            websocket: { status: "working_spike_transport", path: "/voice/realtime/ws", codec: "opus" },
            webTransport: { status: "blocked_pending_runtime_support", blockers: ["quest_webtransport_path_not_verified"] },
          },
          gatewayRuntime: { target: "bun-hono-http3", localVerifiedFallback: "node-hono-ws", blockers: [] },
          backends: {
            pythonFastApi: {
              status: "source_present_not_executed",
              websocketPath: "/voice/realtime/ws",
              transportProxy: {
                status: "not_configured",
                backendUrlConfigured: false,
                readyForLiveDialog: false,
                blockers: ["python_backend_websocket_url_not_configured"],
              },
              blockers: ["python_backend_not_executed"],
            },
          },
          protocolLanes: [],
          recommendedProtocolSelection: {
            selectedLane: {
              id: "websocket-media",
              protocol: "websocket",
              role: "media-transport",
              status: "working_spike_transport",
              mediaAllowed: true,
              blockers: [],
              notes: "WebSocket media lane.",
            },
            rejectedLaneReasons: [],
          },
        },
      }),
    });

    await client.getStep2CsSeedBlueprint();
    await client.getStep2CsSeedBlueprintReadiness();
    await client.getStep2CsSeedTimingPlan();
    await client.getStep2CsSeedStationRunQueue();
    await expect(client.getRuntimeProviderReadiness()).resolves.toEqual(expect.objectContaining({
      claimBoundary: "deterministic_replay_ready_is_not_live_provider_readiness",
    }));
    await expect(client.getDynamicEncounterFactoryPlanning()).resolves.toEqual(expect.objectContaining({
      claimBoundary: "review_gated_factory_metadata_only",
      routeContractBoundary: expect.objectContaining({
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
      }),
    }));
    await expect(client.getRuntimeSelectionReviewPacket()).resolves.toEqual(expect.objectContaining({
      claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
      guardedRuntimeSelectorDecision: expect.objectContaining({
        claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
      }),
      operatorReviewReadiness: expect.objectContaining({
        claimBoundary: "operator_review_readiness_metadata_only",
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        questEvidenceRefreshAllowed: false,
      }),
      publicationPayloadLinkage: expect.objectContaining({
        actorEquipmentMaterializationGate: expect.objectContaining({
          runtimeSelectionBlockedUntilEvidenceAttached: true,
          actorBlockers: ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"],
          equipmentBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
          claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness",
        }),
      }),
      materializationInputManifestSummary: expect.objectContaining({
        actorWorkOrderInputCount: 3,
        equipmentWorkOrderInputCount: 6,
        providerExecutionPerformed: false,
        paidApisUsed: false,
        externalNetworkUsed: false,
        claimBoundary: "metadata_only_provider_neutral_materialization_inputs",
      }),
      materializationAttachmentPlanSummary: expect.objectContaining({
        actorAttachmentSlotCount: 12,
        equipmentAttachmentSlotCount: 24,
        missingAttachmentCount: 36,
        providerExecutionPerformed: false,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_attachment_plan",
      }),
      materializationEvidenceAttachmentSummary: expect.objectContaining({
        totalRequiredSlotCount: 36,
        attachedSlotCount: 36,
        missingSlotCount: 0,
        heldOrInvalidAttachmentCount: 0,
        allRequiredSlotsSatisfied: true,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
      }),
      materializationInputReviewDecisionRecord: expect.objectContaining({
        decisionCount: 2,
        reviewedDecisionCount: 1,
        heldDecisionCount: 1,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_input_review_decisions",
      }),
    }));
    await expect(client.getRuntimeProtocolPosture()).resolves.toEqual(expect.objectContaining({
      primaryRuntimeTarget: "bun-hono",
    }));
    await expect(client.getRealtimeVoicePosture()).resolves.toEqual(expect.objectContaining({
      policy: expect.objectContaining({ cloudApisUsed: false }),
    }));
    await expect(client.createLocalReviewReplaySeed({ learnerId: "admin_review_seed" })).resolves.toEqual({
      stationRunId: "run_ed_chest_pain_priority_v1_admin_review_seed",
    });
    await expect(client.listScenarios({ status: "APPROVED" })).resolves.toEqual([
      expect.objectContaining({
        scenarioId: "ed_chest_pain_priority_v1",
        status: "APPROVED",
        actors: [expect.objectContaining({ displayName: "Robert Hayes" })],
      }),
    ]);
    await expect(client.getScenarioDetail({ scenarioId: "ed_chest_pain_priority_v1", version: 1 })).resolves.toEqual({
      scenario: expect.objectContaining({
        scenarioId: "ed_chest_pain_priority_v1",
        equipment: ["12-lead ECG machine"],
      }),
      assetReadiness: expect.objectContaining({
        devReady: true,
        productionReady: false,
      }),
    });
    await expect(client.submitScenarioReview({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      version: 1,
      reviewerRole: "clinical",
      reviewerId: "pediatrician_001",
      decision: "APPROVED",
      comments: "Clinical review complete.",
      evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
    })).resolves.toEqual(expect.objectContaining({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      status: "READY_FOR_REVIEW",
      review: expect.objectContaining({ clinical: "approved" }),
    }));
    await expect(client.listScenarioReviewDecisions({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      version: 1,
    })).resolves.toEqual([
      expect.objectContaining({
        scenarioId: "peds_asthma_parent_anxiety_v1",
        reviewerRole: "clinical",
        reviewerId: "pediatrician_001",
        evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
      }),
    ]);
    await expect(client.saveFacultyScoreDraft({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
      reviewerId: "faculty_002",
      comments: "ECG escalation was captured.",
      rubricScores: {
        urgent_recognition: 2,
      },
    })).resolves.toEqual(expect.objectContaining({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
      facultyScoreDraft: expect.objectContaining({
        reviewerId: "faculty_002",
        comments: "ECG escalation was captured.",
      }),
    }));
    await expect(client.getReviewReplayReadinessSummary({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
    })).resolves.toMatchObject({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
      recommendedNextAction: "review_missing_required_behavior",
      replayBoundary: "summary_only_faculty_review_not_score_use",
      caseDefinedHumanoidPerformanceContract: {
        claimBoundary: "case_definition_humanoid_performance_metadata_only",
        actorCount: 3,
        locomotionActorRoles: ["family", "nurse", "patient"],
        expressionActorRoles: ["family", "nurse", "patient"],
        gazeActorRoles: ["family", "nurse", "patient"],
        lipSyncActorRoles: ["family", "nurse", "patient"],
        interactiveActorRoles: ["family", "nurse", "patient"],
        notEvidenceFor: [
          "generated_humanoid_asset_readiness",
          "animation_quality",
          "quest_readiness",
          "runtime_readiness",
          "clinical_validity",
        ],
      },
      caseDefinedHumanoidRuntimeHandoff: expect.arrayContaining([
        expect.objectContaining({
          claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
          actorRole: "patient",
          requiredSignalIds: expect.arrayContaining(["animated_humanoid_runtime_playback"]),
          blockers: expect.arrayContaining(["runtime_realism_evidence_not_attached_to_encounter_bundle"]),
          notEvidenceFor: expect.arrayContaining(["runtime_readiness", "quest_readiness", "scoring_validity"]),
        }),
      ]),
    });
    await expect(client.getReviewPacketReplay({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
    })).resolves.toEqual(expect.objectContaining({
      reviewPacket: expect.objectContaining({
        stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
        missingRequiredTraceTags: ["team_communication"],
        facultyScoreDraft: expect.objectContaining({
          comments: "Needs team communication evidence.",
        }),
      }),
      traceEvents: [
        expect.objectContaining({
          eventType: "learner.utterance",
          tag: "ecg_request",
        }),
      ],
    }));
    await expect(client.listStep2CsSeedStationRunQueueSnapshots()).resolves.toEqual([queueSnapshot]);
    await expect(client.createStep2CsSeedStationRunQueueSnapshot({
      snapshotId: "queue_snapshot_ui_001",
      reviewerId: "psychometrician_001",
      createdAt: "2026-05-03T17:00:00.000Z",
    })).resolves.toEqual(queueSnapshot);
    await client.getScenarioBankAssetReadiness();
    await expect(client.getEdChestPainPublicationReadiness({
      targetUse: "local_formative",
      reviewerEvidence: [],
    })).resolves.toMatchObject({
      canPublishForLearnerUse: false,
      blockerVisibility: {
        claimBoundary: "publication_blocker_visibility_not_readiness_claim",
        humanReviewRequired: true,
        blockerIds: ["publication_gate_blocked:reviewer_evidence"],
        warningIds: ["publication_gate_warning:asset_readiness"],
        recommendedNextAction: "collect_required_reviewer_evidence",
      },
    });
    await expect(client.getScenarioBankMaturity()).resolves.toMatchObject({
      scenarioCount: 12,
      targetScenarioCount: 12,
      activationEligibleScenarioIds: ["ed_chest_pain_priority_v1"],
      blockedScenarioIds: [{ scenarioId: "peds_asthma_parent_anxiety_v1", reason: "not_approved" }],
      scenarioMaturityBreakdown: [
        expect.objectContaining({
          scenarioId: "ed_chest_pain_priority_v1",
          blockerIds: [],
          dialogueSeedReady: true,
          traceabilityReady: true,
          recommendedNextAction: "ready_for_local_formative_queue_assembly",
        }),
      ],
      pressureActorCoverage: {
        scenarioCountWithNonPatientActors: 12,
        incompleteScenarioIds: [],
      },
    });
    await expect(client.getScenarioBankExamSequence()).resolves.toMatchObject({
      source: "scenario_bank_ordered_sequence",
      stationCount: 12,
      activationEligibleCount: 1,
      learnerUseBoundary: "activation_ready_only",
    });
    await expect(client.getScenarioBankEnvironmentGenerationQueue()).resolves.toMatchObject({
      scenarioCount: 12,
      packetCount: 12,
      readyForGenerationReviewScenarioIds: [],
      nextReviewGateCounts: { attach_environment_generation_evidence: 12 },
      packets: [
        expect.objectContaining({
          scenarioId: "ed_chest_pain_priority_v1",
          environmentAssetId: "ed_exam_bay_environment",
          claimBoundary: "environment_generation_plan_not_generated_asset",
          readyForGenerationReview: false,
        }),
      ],
    });
    await expect(client.getScenarioBankEnvironmentWorkOrderQueue()).resolves.toMatchObject({
      scenarioCount: 12,
      workOrderCount: 12,
      blockedWorkOrderCount: 12,
      pendingTaskCount: 60,
      claimBoundary: "work_order_queue_not_asset_production",
      workOrders: [
        expect.objectContaining({
          scenarioId: "ed_chest_pain_priority_v1",
          environmentAssetId: "ed_exam_bay_environment",
          authoringToolId: "blender",
        }),
      ],
    });
    await expect(client.getScenarioBankSceneGenerationPipelineQueue()).resolves.toMatchObject({
      scenarioCount: 12,
      workOrderCount: 12,
      pendingStageCount: 108,
      claimBoundary: "scene_generation_pipeline_queue_not_asset_production",
      workOrders: [
        expect.objectContaining({
          scenarioId: "ed_chest_pain_priority_v1",
          initiatedFrom: "admin_scenario_configuration",
        }),
      ],
    });
    await expect(client.listScenarioSceneGenerationRequests()).resolves.toMatchObject({
      requestCount: 1,
      claimBoundary: "scene_generation_request_queue_not_asset_production",
      requests: [
        {
          requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
          scenarioId: "ed_chest_pain_priority_v1",
          status: "accepted",
          reviewStatus: "pending_runtime_asset_review",
          nextAction: "attach_runtime_asset_review_decisions",
          runtimeAssetReviewDecisionCount: 0,
          productionAssetReadinessClaimed: false,
          claimBoundary: "scene_generation_request_not_asset_production",
        },
      ],
    });
    await expect(client.createScenarioSceneGenerationRequest({ scenarioId: "ed_chest_pain_priority_v1" })).resolves.toMatchObject({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      scenarioId: "ed_chest_pain_priority_v1",
      status: "accepted",
      reviewStatus: "pending_runtime_asset_review",
      nextAction: "attach_runtime_asset_review_decisions",
      runtimeAssetReviewDecisionCount: 0,
      accepted: true,
      productionAssetReadinessClaimed: false,
      claimBoundary: "scene_generation_request_not_asset_production",
      workOrder: {
        scenarioId: "ed_chest_pain_priority_v1",
        initiatedFrom: "admin_scenario_configuration",
      },
    });
    await expect(client.submitScenarioSceneGenerationRequestReview({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      decisions: [
        {
          assetId: "generated_patient_model_review_gate_v1",
          reviewerRole: "asset_pipeline",
          reviewerId: "asset_pipeline_reviewer",
          decision: "approved_for_local_runtime",
          comments: "Local runtime evidence attached.",
          evidenceRefs: ["generated_patient_model_review_gate_v1:pipeline_evidence"],
          reviewedAt: "2026-05-22T23:30:00.000Z",
        },
      ],
    })).resolves.toMatchObject({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      reviewStatus: "runtime_asset_review_attached",
      nextAction: "run_generated_bundle_publisher",
      runtimeAssetReviewDecisionCount: 1,
    });
    await expect(client.submitScenarioSceneGenerationMaterializationInputReview({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      decisions: [
        {
          actionId: "hold_actor_materialization_inputs",
          reviewerId: "asset_pipeline_reviewer",
          decision: "held_metadata_only",
          comments: "Hold actor inputs until evidence attaches.",
          evidenceRefs: ["encounter-materialization-input-manifest-peds-asthma-parent-anxiety-2026-05-28"],
          reviewedAt: "2026-05-28T06:30:00.000Z",
        },
      ],
    })).resolves.toMatchObject({
      decisionCount: 1,
      heldDecisionCount: 1,
      providerExecutionAllowed: false,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "metadata_only_materialization_input_review_decisions",
    });
    await expect(client.getScenarioSceneGenerationRequestPublicationReadiness({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
    })).resolves.toMatchObject({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
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
      runtimeBundleGateRefs: expect.arrayContaining([
        expect.objectContaining({
          gateId: "runtime_bundle_assembly_audit",
          status: "blocked",
          blockerIds: [
            "runtime_realism_evidence_not_attached_to_encounter_bundle",
            "visual_qa_evidence_not_attached_to_encounter_bundle",
            "quest_runtime_evidence_not_attached_to_encounter_bundle",
          ],
          claimBoundary: "runtime_bundle_gate_ref_not_published_runtime",
        }),
      ]),
      humanoidMetadataBlockerIds: expect.arrayContaining([
        "humanoid_metadata_review_required:dialogue_viseme_and_gaze_mapping",
        "humanoid_metadata_review_required:generated_eyelid_blink_control_cue",
      ]),
      humanReviewActions: expect.arrayContaining([
        expect.objectContaining({
          actionId: "review_humanoid_realism_metadata",
          status: "available",
          claimBoundary: "human_review_action_not_automated_approval",
        }),
      ]),
      nextAction: "run_generated_bundle_publisher",
      evidenceGateRefs: [
        expect.objectContaining({
          gateId: "asset_production_review",
          status: "attached",
          evidenceRefs: ["generated_patient_model_review_gate_v1:privacy_evidence"],
        }),
        expect.objectContaining({
          gateId: "runtime_realism_evidence",
          status: "pending",
          requiredSignalIds: expect.arrayContaining(["emotion_aligned_expression_transition_cue"]),
          blockers: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
        }),
        expect.objectContaining({
          gateId: "visual_qa_evidence",
          status: "pending",
          requiredSignalIds: expect.arrayContaining(["emotion_expression_transition_readability"]),
          blockers: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
        }),
      ],
      publicationMetadata: expect.objectContaining({
        generatedAssetCount: 6,
        humanoidActorCount: 3,
        equipmentCount: 2,
        assemblyAuditMetadata: expect.objectContaining({
          claimBoundary: "asset_reference_audit_metadata_not_materialized_assets",
          sourceDefinitionRefs: ["scenario_definition:ed_chest_pain_priority_v1"],
          humanoidMetadataRefs: [
            {
              actorId: "patient_robert_hayes_v1",
              actorRole: "patient",
              claimScope: "metadata_only_not_visual_quality_evidence",
            },
          ],
        }),
        humanoidRealismProfileSummary: expect.objectContaining({
          profileCount: 3,
          actorRoles: ["patient", "nurse", "spouse"],
          requiredSignalIds: expect.arrayContaining([
            "dialogue_viseme_and_gaze_mapping",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
          ]),
          claimScope: "metadata_only_not_visual_quality_evidence",
        }),
        claimBoundary: "local_publication_metadata_not_runtime_readiness",
      }),
      dynamicBehaviorCoverage: expect.objectContaining({
        claimBoundary: "metadata_only_not_runtime_behavior_evidence",
        dialogueActorRoles: ["patient", "nurse", "spouse"],
        missingDialogueActorRoles: [],
        gazeActorRoles: ["patient", "nurse", "spouse"],
        missingGazeActorRoles: [],
        placementActorRoles: ["patient", "nurse", "spouse"],
        missingPlacementActorRoles: [],
        affectActorRoles: ["patient", "nurse", "spouse"],
        missingAffectActorRoles: [],
        affectTimelineCount: expect.any(Number),
        affectClaimBoundary: "metadata_only_not_runtime_facial_animation_evidence",
        blockerIds: [],
      }),
      encounterFactoryDryRunSummary: expect.objectContaining({
        stageIds: [
          "scenario_definition_to_asset_requirements",
          "humanoid_roles_to_realism_profiles",
          "runtime_bundle_binding_plan",
          "publication_and_evidence_gate_plan",
        ],
        recommendedNextAction: "review_factory_plan_before_generation_or_publication",
        claimBoundary: "encounter_factory_dry_run_not_asset_generation",
        evidenceBoundaries: {
          metadataOnlyPlan: true,
          generatedAssetsMaterialized: false,
          runtimeBundlePublished: false,
          learnerRuntimeEnabled: false,
          questReadinessClaimed: false,
          productionReadinessClaimed: false,
        },
      }),
      claimBoundary: "publication_readiness_not_learner_bundle_persistence",
    });

    expect(requests).toEqual([
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/readiness", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/timing-plan", method: "GET" },
      { url: "http://localhost:8787/exam-blueprints/step2cs-seed/station-run-queue", method: "GET" },
      { url: "http://localhost:8787/runtime/provider-readiness", method: "GET" },
      { url: "http://localhost:8787/scenario-bank/dynamic-encounter-factory/planning", method: "GET" },
      { url: "http://localhost:8787/runtime/selection-review-packet", method: "GET" },
      { url: "http://localhost:8787/runtime/protocols", method: "GET" },
      { url: "http://localhost:8787/voice/realtime/posture", method: "GET" },
      {
        url: "http://localhost:8787/sessions",
        method: "POST",
        body: {
          learnerId: "admin_review_seed",
          consentAccepted: true,
        },
      },
      {
        url: "http://localhost:8787/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/start-encounter",
        method: "POST",
        body: {
          atSecond: 60,
        },
      },
      {
        url: "http://localhost:8787/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/events",
        method: "POST",
        body: {
          eventType: "learner.action",
          atSecond: 83,
          tag: "ecg_request",
          actorId: "patient_robert_hayes_v1",
        },
      },
      {
        url: "http://localhost:8787/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/events",
        method: "POST",
        body: {
          eventType: "learner.action",
          atSecond: 140,
          tag: "urgent_escalation",
          actorId: "nurse_amelia_singh_v1",
        },
      },
      {
        url: "http://localhost:8787/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/events",
        method: "POST",
        body: {
          eventType: "learner.action",
          atSecond: 190,
          tag: "team_communication",
          actorId: "spouse_linda_hayes_v1",
        },
      },
      {
        url: "http://localhost:8787/sessions/run_ed_chest_pain_priority_v1_admin_review_seed/note",
        method: "POST",
        body: {
          atSecond: 960,
          text: "Chest pain requires urgent ECG escalation and team communication follow-up.",
        },
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "ScenarioBank",
          query: scenarioBankDocument,
          variables: {
            status: "APPROVED",
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "ScenarioDetail",
          query: scenarioDetailDocument,
          variables: {
            scenarioId: "ed_chest_pain_priority_v1",
            version: 1,
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "SubmitScenarioReview",
          query: submitScenarioReviewDocument,
          variables: {
            input: {
              scenarioId: "peds_asthma_parent_anxiety_v1",
              version: 1,
              reviewerRole: "clinical",
              reviewerId: "pediatrician_001",
              decision: "APPROVED",
              comments: "Clinical review complete.",
              evidenceRefs: ["evidence:peds:clinical:2026-05-04"],
            },
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "ScenarioReviewDecisions",
          query: scenarioReviewDecisionsDocument,
          variables: {
            scenarioId: "peds_asthma_parent_anxiety_v1",
            version: 1,
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "SaveFacultyScoreDraft",
          query: saveFacultyScoreDraftDocument,
          variables: {
            input: {
              stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
              reviewerId: "faculty_002",
              comments: "ECG escalation was captured.",
              rubricScores: {
                urgent_recognition: 2,
              },
            },
          },
        }),
      },
      { url: "http://localhost:8787/sessions/run_ed_chest_pain_priority_v1_learner_001/review-replay-readiness", method: "GET" },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "ReviewPacketReplay",
          query: reviewPacketReplayDocument,
          variables: {
            stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "StationRunQueueSnapshots",
          query: listSnapshotsDocument,
          variables: {
            blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
          },
        }),
      },
      {
        url: "http://localhost:8787/admin/graphql",
        method: "POST",
        body: expect.objectContaining({
          operationName: "CreateStationRunQueueSnapshot",
          query: createSnapshotDocument,
          variables: {
            input: {
              snapshotId: "queue_snapshot_ui_001",
              reviewerId: "psychometrician_001",
              createdAt: "2026-05-03T17:00:00.000Z",
            },
          },
        }),
      },
      { url: "http://localhost:8787/scenario-bank/assets/readiness", method: "GET" },
      {
        url: "http://localhost:8787/scenarios/ed-chest-pain/publication-readiness",
        method: "POST",
        body: {
          targetUse: "local_formative",
          reviewerEvidence: [],
        },
      },
      { url: "http://localhost:8787/scenario-bank/maturity", method: "GET" },
      { url: "http://localhost:8787/scenario-bank/exam-sequence", method: "GET" },
      { url: "http://localhost:8787/scenario-bank/environments/generation-queue", method: "GET" },
      { url: "http://localhost:8787/scenario-bank/environments/work-orders", method: "GET" },
      { url: "http://localhost:8787/scenario-bank/scene-generation/pipeline", method: "GET" },
      { url: "http://localhost:8787/scenario-bank/scene-generation/requests", method: "GET" },
      {
        url: "http://localhost:8787/scenario-bank/scene-generation/requests",
        method: "POST",
        body: { scenarioId: "ed_chest_pain_priority_v1" },
      },
      {
        url: "http://localhost:8787/scenario-bank/scene-generation/requests/scene_generation_request%3Aed_chest_pain_priority_v1%3Alocal-admin/runtime-asset-review-decisions",
        method: "POST",
        body: {
          decisions: [
            {
              assetId: "generated_patient_model_review_gate_v1",
              reviewerRole: "asset_pipeline",
              reviewerId: "asset_pipeline_reviewer",
              decision: "approved_for_local_runtime",
              comments: "Local runtime evidence attached.",
              evidenceRefs: ["generated_patient_model_review_gate_v1:pipeline_evidence"],
              reviewedAt: "2026-05-22T23:30:00.000Z",
            },
          ],
        },
      },
      {
        url: "http://localhost:8787/scenario-bank/scene-generation/requests/scene_generation_request%3Aed_chest_pain_priority_v1%3Alocal-admin/materialization-input-review-decisions",
        method: "POST",
        body: {
          decisions: [
            {
              actionId: "hold_actor_materialization_inputs",
              reviewerId: "asset_pipeline_reviewer",
              decision: "held_metadata_only",
              comments: "Hold actor inputs until evidence attaches.",
              evidenceRefs: ["encounter-materialization-input-manifest-peds-asthma-parent-anxiety-2026-05-28"],
              reviewedAt: "2026-05-28T06:30:00.000Z",
            },
          ],
        },
      },
      {
        url: "http://localhost:8787/scenario-bank/scene-generation/requests/scene_generation_request%3Aed_chest_pain_priority_v1%3Alocal-admin/publication-readiness",
        method: "GET",
      },
    ]);
  });

  it("throws an actionable error when GraphQL returns errors", async () => {
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787",
      fetch: recordingFetch([], {
        "/admin/graphql#CreateStationRunQueueSnapshot": {
          errors: [{ message: "reviewer_not_authorized" }],
        },
      }),
    });

    await expect(client.createStep2CsSeedStationRunQueueSnapshot({
      snapshotId: "queue_snapshot_ui_001",
      reviewerId: "psychometrician_001",
      createdAt: "2026-05-03T17:00:00.000Z",
    })).rejects.toThrow("OpenClinXR admin GraphQL request failed: CreateStationRunQueueSnapshot reviewer_not_authorized");
  });

  it("stops local review replay seed creation when the session response is malformed", async () => {
    const requests: RecordedRequest[] = [];
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787",
      fetch: recordingFetch(requests, {
        "/sessions": { scenarioId: "ed_chest_pain_priority_v1", phase: "doorway" },
      }),
    });

    await expect(client.createLocalReviewReplaySeed()).rejects.toThrow(
      "OpenClinXR admin API request failed: POST http://localhost:8787/sessions missing stationRunId",
    );
    expect(requests).toEqual([
      {
        url: "http://localhost:8787/sessions",
        method: "POST",
        body: {
          learnerId: "admin_review_seed",
          consentAccepted: true,
        },
      },
    ]);
  });

  it("uses Apollo Client for generated queue snapshot operations when provided", async () => {
    const queueSnapshot = {
      snapshotId: "queue_snapshot_apollo_001",
      createdAt: "2026-05-04T02:30:00.000Z",
      reviewerId: null,
      queue: { canStartLearnerExam: false, stationQueue: [], summary: { activationReady: 1, draftBlocked: 11 } },
    };
    const scenario = {
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      status: "APPROVED",
      clinicalObjectives: [],
      requiredTraceTags: [],
      review: { clinical: "approved", psychometric: "approved", legal: "approved", simulationQa: "approved" },
      governance: {
        scoreUseLabel: "formative_local_only",
        syntheticCaseDisclosure: "Synthetic local training scenario.",
        validationStage: "stage_1_expert_reviewed",
        requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
        sourceIds: ["src-step2cs-public-archive"],
      },
      actors: [],
      environment: null,
      equipment: [],
      assetNeeds: [],
    };
    const reviewPacket = {
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
      scenarioId: "ed_chest_pain_priority_v1",
      observedTraceTags: ["ecg_request"],
      missingRequiredTraceTags: [],
      lateTraceTags: [],
      unsafeEvents: [],
      traceQuality: {
        eventCount: 3,
        modelGeneratedEventCount: 0,
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 0,
        hasPatientNote: false,
        hasModelProvenance: false,
      },
      facultyScoreDraft: {
        reviewerId: "faculty_002",
        status: "draft",
        comments: "ECG escalation was captured.",
      },
    };
    const reviewPacketReplay = {
      reviewPacket: {
        ...reviewPacket,
        timeline: [
          {
            sequence: 2,
            atSecond: 83,
            eventType: "learner.utterance",
            source: "learner",
            actorId: "patient_robert_hayes_v1",
            tag: "ecg_request",
            summary: "Learner requested an ECG.",
          },
        ],
        patientNote: null,
      },
      clinicalEventReviewSummary: {
        stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
        eventCount: 1,
        redactedEventCount: 1,
        clinicalEventKinds: { clinical_action_recorded: 1 },
        traceTags: ["ecg_request"],
        statusCounts: { completed: 1 },
        latestAtSecond: 83,
        durableStore: "database_source_of_truth",
        safeForFacultyReview: true,
      },
      traceEvents: [
        {
          sequence: 2,
          eventType: "learner.utterance",
          atSecond: 83,
          source: "learner",
          actorId: "patient_robert_hayes_v1",
          tag: "ecg_request",
        },
      ],
    };
    const reviewDecisions = [
      {
        scenarioId: "ed_chest_pain_priority_v1",
        version: 1,
        reviewerRole: "clinical",
        reviewerId: "clinician_001",
        decision: "approved",
        comments: "Approved.",
        evidenceRefs: ["evidence:clinical:2026-05-04"],
        reviewedAt: "2026-05-04T09:00:00.000Z",
      },
    ];
    const apolloClient = {
      query: vi.fn(async ({ query }) => {
        if (query === ScenarioDetailDocument) {
          return {
            data: {
              scenario,
              assetReadiness: {
                scenarioId: "ed_chest_pain_priority_v1",
                devReady: true,
                productionReady: false,
                missingRequiredAssetIds: [],
                blockedAssets: [],
                productionBlockedAssets: [],
                productionReadinessLadder: {
                  scenarioId: "ed_chest_pain_priority_v1",
                  productionReady: false,
                  assetCount: 1,
                  productionReadyAssetIds: [],
                  blockedAssetIds: ["patient_robert_hayes_character"],
                  missingRequiredAssetIds: [],
                  blockers: ["patient_robert_hayes_character:visual_clinical_critique_missing"],
                  stationBudget: {
                    totalTriangles: 48000,
                    totalTextureMegabytes: 72,
                    totalDrawCalls: 24,
                    blockers: [],
                  },
                  assetLadders: [
                    {
                      assetId: "patient_robert_hayes_character",
                      productionReady: false,
                      blockers: ["visual_clinical_critique_missing"],
                      steps: [
                        { step: "provenance_license", status: "complete", evidenceRefs: ["license:patient"], blockers: [] },
                        { step: "visual_clinical_critique", status: "blocked", evidenceRefs: [], blockers: ["visual_clinical_critique_missing"] },
                      ],
                    },
                  ],
                },
              },
            },
          };
        }
        if (query === ScenarioBankDocument) {
          return { data: { scenarios: [scenario] } };
        }
        if (query === ReviewPacketReplayDocument) {
          return { data: reviewPacketReplay };
        }
        if (query === ScenarioReviewDecisionsDocument) {
          return { data: { scenarioReviewDecisions: reviewDecisions } };
        }
        return { data: { stationRunQueueSnapshots: [queueSnapshot] } };
      }),
      mutate: vi.fn(async ({ mutation }) => {
        if (mutation === SubmitScenarioReviewDocument) {
          return { data: { submitScenarioReview: scenario } };
        }
        if (mutation === SaveFacultyScoreDraftDocument) {
          return { data: { saveFacultyScoreDraft: reviewPacket } };
        }
        return { data: { createStationRunQueueSnapshot: queueSnapshot } };
      }),
    } as unknown as AdminApolloGraphqlClient;
    const fetcher = vi.fn<typeof fetch>();
    const client = createAdminControlPlaneClient({
      apolloClient,
      baseUrl: "http://localhost:8787",
      fetch: fetcher,
    });

    await expect(client.listScenarios({ status: "APPROVED" })).resolves.toEqual([scenario]);
    await expect(client.getScenarioDetail({ scenarioId: "ed_chest_pain_priority_v1", version: 1 })).resolves.toEqual({
      scenario,
      assetReadiness: expect.objectContaining({ devReady: true }),
    });
    await expect(client.submitScenarioReview({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      reviewerRole: "clinical",
      reviewerId: "clinician_001",
      decision: "APPROVED",
      comments: "Approved.",
      evidenceRefs: ["evidence:clinical:2026-05-04"],
    })).resolves.toEqual(scenario);
    await expect(client.listScenarioReviewDecisions({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
    })).resolves.toEqual(reviewDecisions);
    await expect(client.saveFacultyScoreDraft({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
      reviewerId: "faculty_002",
      comments: "ECG escalation was captured.",
      rubricScores: {
        urgent_recognition: 2,
      },
    })).resolves.toEqual(reviewPacket);
    await expect(client.getReviewPacketReplay({
      stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
    })).resolves.toEqual(reviewPacketReplay);
    await expect(client.listStep2CsSeedStationRunQueueSnapshots()).resolves.toEqual([queueSnapshot]);
    await expect(client.createStep2CsSeedStationRunQueueSnapshot({
      createdAt: "2026-05-04T02:30:00.000Z",
    })).resolves.toEqual(queueSnapshot);

    expect(apolloClient.query).toHaveBeenCalledWith({
      query: ScenarioBankDocument,
      variables: {
        status: "APPROVED",
      },
      fetchPolicy: "network-only",
    });
    expect(apolloClient.query).toHaveBeenCalledWith({
      query: ScenarioDetailDocument,
      variables: {
        scenarioId: "ed_chest_pain_priority_v1",
        version: 1,
      },
      fetchPolicy: "network-only",
    });
    expect(apolloClient.query).toHaveBeenCalledWith({
      query: ReviewPacketReplayDocument,
      variables: {
        stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
      },
      fetchPolicy: "network-only",
    });
    expect(apolloClient.query).toHaveBeenCalledWith({
      query: StationRunQueueSnapshotsDocument,
      variables: {
        blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      },
      fetchPolicy: "network-only",
    });
    expect(apolloClient.mutate).toHaveBeenCalledWith({
      mutation: SubmitScenarioReviewDocument,
      variables: {
        input: {
          scenarioId: "ed_chest_pain_priority_v1",
          version: 1,
          reviewerRole: "clinical",
          reviewerId: "clinician_001",
          decision: "APPROVED",
          comments: "Approved.",
          evidenceRefs: ["evidence:clinical:2026-05-04"],
        },
      },
    });
    expect(apolloClient.mutate).toHaveBeenCalledWith({
      mutation: SaveFacultyScoreDraftDocument,
      variables: {
        input: {
          stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
          reviewerId: "faculty_002",
          comments: "ECG escalation was captured.",
          rubricScores: {
            urgent_recognition: 2,
          },
        },
      },
    });
    expect(apolloClient.mutate).toHaveBeenCalledWith({
      mutation: CreateStationRunQueueSnapshotDocument,
      variables: {
        input: {
          createdAt: "2026-05-04T02:30:00.000Z",
        },
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("throws an actionable error when a control-plane request fails", async () => {
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787",
      fetch: async () =>
        new Response(JSON.stringify({ error: "route_not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.getStep2CsSeedTimingPlan()).rejects.toThrow(
      "OpenClinXR admin API request failed: GET http://localhost:8787/exam-blueprints/step2cs-seed/timing-plan 404 route_not_found",
    );
  });

  it("accepts scenario_review_gate boundaries used for approved scenarios", async () => {
    const requests: RecordedRequest[] = [];
    const requestId = "scene_generation_request:ed_chest_pain_priority_v1:local-admin";
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787",
      fetch: recordingFetch(requests, {
        [`GET /scenario-bank/scene-generation/requests/${encodeURIComponent(requestId)}/publication-readiness`]: {
          requestId,
          scenarioId: "ed_chest_pain_priority_v1",
          canRunGeneratedBundlePublisher: true,
          blockers: [],
          learnerRuntimeUseBlockers: [],
          nextAction: "run_generated_bundle_publisher",
          scenarioReviewGate: {
            scenarioStatus: "approved",
            approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
            learnerUseBlocked: false,
            blockerIds: [],
            claimBoundary: "scenario_status_gate_not_clinical_or_production_readiness",
          },
          materializationInputManifestSummary: {
            schemaVersion: "openclinxr.encounter-materialization-input-manifest-summary.v1",
            source: "encounter_materialization_input_manifest",
            scenarioId: "peds_asthma_parent_anxiety_v1",
            actorWorkOrderInputCount: 3,
            equipmentWorkOrderInputCount: 6,
            requiredActorCueIds: ["actor_specific_body_profile_required"],
            requiredEquipmentCueIds: ["clinical_affordance_evidence"],
            blockerIds: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
            providerExecutionPerformed: false,
            paidApisUsed: false,
            externalNetworkUsed: false,
            claimBoundary: "metadata_only_provider_neutral_materialization_inputs",
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
          materializationInputReviewActionPacket: {
            schemaVersion: "openclinxr.encounter-materialization-input-review-action-packet.v1",
            source: "materialization_input_manifest_summary",
            scenarioId: "peds_asthma_parent_anxiety_v1",
            actionMode: "metadata_only_review_actions_not_provider_execution",
            availableActions: [
              {
                actionId: "review_actor_materialization_inputs",
                status: "available",
                inputCount: 3,
                blockerCount: 13,
                requiredCueIds: ["actor_specific_body_profile_required"],
                providerExecutionAllowed: false,
                runtimeExecutionAllowed: false,
                claimBoundary: "materialization_input_review_action_not_provider_execution",
              },
            ],
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
            learnerLaunchAllowed: false,
            questEvidenceRefreshAllowed: false,
            claimBoundary: "metadata_only_materialization_input_review_actions",
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
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
                reviewerId: "runtime_reviewer",
                decision: "reviewed_metadata_only",
                comments: "Runtime actor evidence input reviewed as metadata only.",
                evidenceRefs: ["runtime-realism-evidence-input://patient"],
                reviewedAt: "2026-05-28T10:20:00.000Z",
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
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          },
          runtimeVisualEvidenceAttachmentSummary: {
            schemaVersion: "openclinxr.runtime-realism-evidence-attachment-summary.v1",
            source: "runtime_realism_evidence_input_review_decisions",
            scenarioId: "peds_asthma_parent_anxiety_v1",
            runtimeActorEvidenceInputCount: 1,
            visualQaEvidenceInputCount: 0,
            reviewedMetadataOnlyCount: 1,
            heldMetadataOnlyCount: 0,
            attachedRuntimeEvidenceCount: 0,
            attachedVisualQaEvidenceCount: 0,
            reviewedMetadataOnlyInputIds: ["runtime-realism-evidence-input:patient_maya_johnson_v1"],
            heldMetadataOnlyInputIds: [],
            blockerIds: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
            learnerLaunchAllowed: false,
            questEvidenceRefreshAllowed: false,
            productionAssetReadinessClaimed: false,
            clinicalValidityClaimed: false,
            scoringValidityClaimed: false,
            claimBoundary: "runtime_visual_evidence_attachment_summary_metadata_only_until_artifacts_attach",
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
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
            ],
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
            learnerLaunchAllowed: false,
            questEvidenceRefreshAllowed: false,
            productionAssetReadinessClaimed: false,
            clinicalValidityClaimed: false,
            scoringValidityClaimed: false,
            claimBoundary: "metadata_only_runtime_visual_evidence_attachment_actions",
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          },
          assetReleaseLadderReplayProjection: {
            schemaVersion: "openclinxr.asset-release-ladder-replay-projection.v1",
            source: "scenario_asset_production_readiness_ladder",
            scenarioId: "peds_asthma_parent_anxiety_v1",
            productionReady: false,
            assetCount: 9,
            productionReadyAssetCount: 2,
            blockedAssetCount: 7,
            missingRequiredAssetCount: 0,
            stationBudgetStatus: "ready",
            blockerCount: 8,
            blockerIds: ["asset_release_ladder_blocked:patient_maya_johnson_v1"],
            blockedAssets: [
              {
                assetId: "patient_maya_johnson_v1",
                blockerCount: 2,
                firstBlockedStep: "provenance_license",
                blockerIds: ["actor_specific_body_profile_required", "actor_specific_clothing_required"],
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
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          },
          claimBoundary: "publication_readiness_not_learner_bundle_persistence",
          notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
        },
      }),
    });

    await expect(client.getScenarioSceneGenerationRequestPublicationReadiness({ requestId })).resolves.toMatchObject({
      scenarioReviewGate: {
        approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
      },
      materializationInputManifestSummary: expect.objectContaining({
        actorWorkOrderInputCount: 3,
        equipmentWorkOrderInputCount: 6,
        providerExecutionPerformed: false,
        paidApisUsed: false,
        externalNetworkUsed: false,
        claimBoundary: "metadata_only_provider_neutral_materialization_inputs",
      }),
      materializationEvidenceAttachmentSummary: expect.objectContaining({
        totalRequiredSlotCount: 36,
        attachedSlotCount: 36,
        missingSlotCount: 0,
        heldOrInvalidAttachmentCount: 0,
        allRequiredSlotsSatisfied: true,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
      }),
      materializationInputReviewActionPacket: expect.objectContaining({
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_input_review_actions",
        availableActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: "review_actor_materialization_inputs",
            inputCount: 3,
            providerExecutionAllowed: false,
            runtimeExecutionAllowed: false,
          }),
        ]),
      }),
      runtimeRealismEvidenceInputReviewDecisionRecord: expect.objectContaining({
        decisionCount: 2,
        reviewedDecisionCount: 1,
        heldDecisionCount: 1,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "metadata_only_runtime_realism_evidence_input_review_decisions",
      }),
      runtimeVisualEvidenceAttachmentSummary: expect.objectContaining({
        reviewedMetadataOnlyCount: 1,
        heldMetadataOnlyCount: 0,
        attachedRuntimeEvidenceCount: 0,
        attachedVisualQaEvidenceCount: 0,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "runtime_visual_evidence_attachment_summary_metadata_only_until_artifacts_attach",
      }),
      runtimeVisualEvidenceAttachmentActionPacket: expect.objectContaining({
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_runtime_visual_evidence_attachment_actions",
        availableActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: "attach_runtime_realism_evidence_refs",
            requiredInputCount: 1,
            attachedEvidenceCount: 0,
            runtimeExecutionAllowed: false,
            learnerLaunchAllowed: false,
          }),
        ]),
      }),
      assetReleaseLadderReplayProjection: expect.objectContaining({
        schemaVersion: "openclinxr.asset-release-ladder-replay-projection.v1",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        assetCount: 9,
        blockedAssetCount: 7,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        productionAssetReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "summary_only_asset_release_ladder_replay_projection_not_release_readiness",
      }),
    });

    expect(requests).toEqual([
      {
        url: `http://localhost:8787/scenario-bank/scene-generation/requests/${encodeURIComponent(requestId)}/publication-readiness`,
        method: "GET",
      },
    ]);
  });

  it("submits runtime visual evidence attachment refs through the metadata-only control-plane route", async () => {
    const requests: RecordedRequest[] = [];
    const attachment = {
      actionId: "attach_runtime_realism_evidence_refs" as const,
      inputId: "runtime-realism-evidence-input:patient_maya_johnson_v1",
      inputKind: "runtime_realism_signal_input" as const,
      evidenceRef: "runtime-evidence://local-browser/patient-gaze-expression",
      localArtifactPath: "docs/openclinxr/evidence/runtime/patient-gaze-expression.json",
      reviewerId: "runtime_reviewer",
      attachmentStatus: "attached_metadata_only" as const,
      comments: "Metadata ref attached to reviewed runtime realism input.",
      attachedAt: "2026-05-28T10:30:00.000Z",
    };
    const client = createAdminControlPlaneClient({
      baseUrl: "http://localhost:8787/",
      fetch: recordingFetch(requests, {
        "POST /runtime/visual-evidence-attachments": {
          schemaVersion: "openclinxr.runtime-visual-evidence-attachment-record.v1",
          source: "admin_runtime_visual_evidence_attachment_refs",
          scenarioId: "ed_chest_pain_priority_v1",
          attachmentCount: 1,
          runtimeEvidenceAttachmentCount: 1,
          visualQaEvidenceAttachmentCount: 0,
          attachments: [attachment],
          providerExecutionAllowed: false,
          runtimeExecutionAllowed: false,
          learnerLaunchAllowed: false,
          questEvidenceRefreshAllowed: false,
          productionAssetReadinessClaimed: false,
          clinicalValidityClaimed: false,
          scoringValidityClaimed: false,
          claimBoundary: "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence",
          notEvidenceFor: ["runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity"],
        },
      }),
    });

    await expect(client.submitRuntimeVisualEvidenceAttachment({
      scenarioId: "ed_chest_pain_priority_v1",
      attachments: [attachment],
    })).resolves.toMatchObject({
      attachmentCount: 1,
      runtimeEvidenceAttachmentCount: 1,
      visualQaEvidenceAttachmentCount: 0,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence",
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:8787/runtime/visual-evidence-attachments",
        method: "POST",
        body: {
          scenarioId: "ed_chest_pain_priority_v1",
          attachments: [attachment],
        },
      },
    ]);
  });
});

type RecordedRequest = {
  url: string;
  method: string;
  body?: unknown;
};

function recordingFetch(requests: RecordedRequest[], responseByPath: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestUrl = new URL(url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    requests.push({
      url,
      method: init?.method ?? "GET",
      ...(body !== undefined ? { body } : {}),
    });
    const responseKey = requestUrl.pathname === "/admin/graphql" && isRecord(body) && typeof body.operationName === "string"
      ? `${requestUrl.pathname}#${body.operationName}`
      : requestUrl.pathname;
    const methodResponseKey = `${init?.method ?? "GET"} ${requestUrl.pathname}`;

    return new Response(JSON.stringify(responseByPath[methodResponseKey] ?? responseByPath[responseKey] ?? { ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
