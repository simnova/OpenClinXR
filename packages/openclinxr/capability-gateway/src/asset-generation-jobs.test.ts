import { describe, expect, it } from "vitest";
import {
  AssetGenerationCapabilityFacade,
  type AssetGenerationJobRequest,
  type AssetGenerationWorkerAdapter,
  buildDefaultHumanoidRemediationLoopInputs,
  buildEncounterAssetGenerationEvidenceGateRefs,
  buildEncounterAssetGenerationPlan,
  buildEncounterAssetGenerationPublicationTargets,
  buildVisualQaRemediationWorkOrderPlans,
  type CommandRunner,
  createDeterministicAssetGenerationAdapter,
  createEncounterAssetGenerationQueueMessage,
  decodeAzureStorageQueueMessage,
  type EncounterAssetGenerationQueueClient,
  encodeAzureStorageQueueMessage,
  processEncounterAssetGenerationQueueMessage,
  processNextEncounterAssetGenerationQueueMessage,
} from "./index.js";

describe("asset-generation job facade", () => {
  it("creates Azure Storage Queue messages for long-running executable encounter generation", () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_ed_chest_pain_001",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: {
        storeKind: "mongoose",
        collectionName: "scenario_definitions",
        documentId: "scenario_ed_chest_pain_v1",
      },
      encounterFactoryInputSummary: {
        source: "scenario_definition_and_dialogue_seed_bank",
        scenarioBankOrder: 1,
        factorySelectionRole: "anchor",
        factorySelectionMode: "next_scenario_fallback",
        factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
        actorAssetWorkOrderCount: 3,
        environmentAssetWorkOrderCount: 1,
        equipmentAssetWorkOrderCount: 6,
        sharedAssetLookupKeys: [
          "semantic::actor::patient::patient_robert_hayes_v1",
          "semantic::environment::ed_exam_bay_v1",
          "semantic::equipment::12_lead_ecg_machine",
        ],
        dynamicBehaviorTraceTags: ["ecg_request", "family_communication", "urgent_escalation"],
      },
      targetAssetStore: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/",
      },
      persistenceTarget: {
        storeKind: "mongoose",
        collectionName: "encounter_asset_generation_jobs",
      },
      requestedStages: [
        "encounter-definition-ingested",
        "character-generation",
        "medical-equipment-generation",
        "environment-generation",
        "animation-generation",
        "voice-asset-generation",
        "asset-bake",
        "scene-manifest-freeze",
        "runtime-bundle-publication",
        "review-evidence-gate",
      ],
      humanoidRealismRequirements: {
        schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
        source: "scenario_actor_definitions",
        requirements: [
          {
            actorRole: "patient",
            requiredAssetKinds: ["generated_humanoid_mesh", "clinical_idle_animation", "viseme_phoneme_map", "gaze_blink_control"],
            requiredSignalIds: [
              "animated_humanoid_runtime_playback",
              "authored_clinical_idle_pose_runtime_cue",
              "visible_mouth_eye_expression_cues",
              "dialogue_viseme_and_gaze_mapping",
              "dialogue_eye_micro_saccade_blink_cue",
              "generated_eyelid_blink_control_cue",
              "emotion_aligned_expression_transition_cue",
            ],
            realismProfile: {
              ageBand: "adult",
              bodyPostureNotes: ["clinical_idle_pose_must_match_encounter_context"],
              clothingClinicalContextCues: ["patient_role_appropriate_clothing"],
              expressionAffectCues: ["subtle_blink_and_micro_saccade_motion"],
              mobilityPositioningConstraints: ["movement_must_preserve_clinical_spatial_blocking"],
              requiredRealismEvidenceIds: [
                "animated_humanoid_runtime_playback",
                "authored_clinical_idle_pose_runtime_cue",
                "visible_mouth_eye_expression_cues",
                "dialogue_viseme_and_gaze_mapping",
                "dialogue_eye_micro_saccade_blink_cue",
                "generated_eyelid_blink_control_cue",
                "emotion_aligned_expression_transition_cue",
              ],
              claimScope: "metadata_only_not_visual_quality_evidence",
            },
          },
        ],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      optimizationWindow: {
        expectedMinimumHours: 2,
        expectedMaximumHours: 72,
        mayRunForDays: true,
        checkpointIntervalMinutes: 30,
      },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: {
        allowPaidCloudApis: false,
        allowProductionDeployment: false,
        productionReadinessClaimed: false,
      },
    });
    const encoded = encodeAzureStorageQueueMessage(message);
    const decoded = decodeAzureStorageQueueMessage(encoded);
    const plan = buildEncounterAssetGenerationPlan(decoded);

    expect(message).toMatchObject({
      schemaVersion: "openclinxr.azure-storage-queue.encounter-asset-generation.v1",
      queueName: "encounter-asset-generation",
      messageKind: "encounter_definition_to_executable_encounter",
      visibilityTimeoutSeconds: 300,
      dequeueAttemptLimit: 25,
    });
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThan(64 * 1024);
    expect(decoded.request.optimizationWindow).toMatchObject({
      expectedMaximumHours: 72,
      mayRunForDays: true,
    });
    expect(decoded.request.humanoidRealismRequirements?.requirements[0]?.realismProfile).toMatchObject({
      claimScope: "metadata_only_not_visual_quality_evidence",
      ageBand: "adult",
      requiredRealismEvidenceIds: expect.arrayContaining([
        "dialogue_viseme_and_gaze_mapping",
        "dialogue_eye_micro_saccade_blink_cue",
        "generated_eyelid_blink_control_cue",
        "emotion_aligned_expression_transition_cue",
      ]),
    });
    expect(plan.humanoidRealismRequirements?.requirements[0]?.realismProfile).toMatchObject({
      claimScope: "metadata_only_not_visual_quality_evidence",
    });
    expect(plan).toMatchObject({
      schemaVersion: "openclinxr.encounter-asset-generation-plan.v1",
      requestId: "encounter_assets_ed_chest_pain_001",
      expectedDuration: {
        minimumHours: 2,
        maximumHours: 72,
        mayRunForDays: true,
      },
      productionReadinessClaimed: false,
    });
    expect(plan.stages.find((stage) => stage.stage === "runtime-bundle-publication")).toMatchObject({
      queueMessageRequired: true,
      durableCheckpointRequired: true,
      outputTarget: "blob_and_mongoose",
    });
    expect(plan.executableEncounterReadyOnlyAfter).toContain("learner_runtime_bundle_persisted_to_mongoose_or_mongodb");
    expect(plan.executableEncounterReadyOnlyAfter).toEqual(expect.arrayContaining([
      "human_review_gate_passed_for_local_runtime",
      "runtime_realism_evidence_attached",
      "humanoid_visual_qa_evidence_attached",
      "quest_runtime_evidence_attached_before_quest_readiness_claim",
    ]));
    expect(plan.generationWorkOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workOrderId: "encounter_assets_ed_chest_pain_001:patient:role-specific-humanoid",
        targetKind: "role_specific_humanoid_glb",
        capabilityId: "character-generation",
        actorRole: "patient",
        providerRoute: "open-source-local-model-planned",
        providerRoutingPreference: [
          "meshy_cloud_requires_approval",
          "hunyuan3d_local",
          "blender_mixamo_style_rigging_fallback",
        ],
        modelProviderPolicy: expect.objectContaining({
          executionStatus: "metadata_only_not_executed",
          allowPaidCloudApis: false,
          allowExternalNetwork: false,
          providerRoutesRequireExplicitApproval: true,
        }),
        sharedAssetLibraryReuse: expect.objectContaining({
          lookupKey: expect.stringContaining("role_specific_humanoid_glb__patient"),
          lookupKeySource: "encounter_definition_semantic_requirements",
          sharedLibraryRefs: {
            blobPrefix: expect.stringContaining("blob://openclinxr-assets/shared-encounter-assets/"),
            mongooseCollectionName: "shared_encounter_asset_library",
          },
          lruCache: expect.objectContaining({
            enabled: true,
            maxEntries: 500,
            evictionPolicy: "least_recently_used",
            reuseRequiresEvidenceGateCompatibility: true,
            updateRecencyOnHit: true,
          }),
          cacheDisposition: "lookup_before_generate",
        }),
        inputRefs: expect.arrayContaining([
          expect.stringMatching(/^shared-asset-library-lookup:\/\//),
          "encounter-factory-input-summary://semantic::actor::patient::patient_robert_hayes_v1",
        ]),
        outputRefs: expect.arrayContaining([
          expect.stringContaining("shared-encounter-assets"),
          expect.stringContaining("mongoose://shared_encounter_asset_library/"),
        ]),
        visualQaBlockerRefs: expect.arrayContaining(["role_readability", "clothing_authenticity", "pose_intent"]),
      }),
      expect.objectContaining({
        workOrderId: "encounter_assets_ed_chest_pain_001:patient:role-animation",
        targetKind: "role_idle_animation_glb",
        capabilityId: "animation-generation",
        actorRole: "patient",
        providerRoutingPreference: expect.arrayContaining(["blender_mixamo_style_rigging_fallback"]),
        visualQaBlockerRefs: expect.arrayContaining(["eye_contact_logic", "mouth_talking_realism", "idle_motion"]),
      }),
      expect.objectContaining({
        workOrderId: "encounter_assets_ed_chest_pain_001:scenario-medical-equipment",
        targetKind: "medical_equipment_glb",
        capabilityId: "medical-equipment-generation",
        providerRoutingPreference: [
          "hunyuan3d_local",
          "meshy_cloud_requires_approval",
          "tripo_cloud_requires_approval",
        ],
        inputRefs: expect.arrayContaining([
          "encounter-factory-input-summary://semantic::environment::ed_exam_bay_v1",
          "encounter-factory-input-summary://semantic::equipment::12_lead_ecg_machine",
        ]),
      }),
      expect.objectContaining({
        workOrderId: "encounter_assets_ed_chest_pain_001:adversarial-visual-feedback-closure",
        targetKind: "visual_feedback_closure",
        capabilityId: "asset-bake",
        providerRoute: "deterministic-mock",
        providerRoutingPreference: [
          "local_open_vlm_if_available",
          "frontier_cloud_vlm_requires_approval",
          "deterministic_fixture",
        ],
        acceptanceCriteria: expect.arrayContaining([
          "adversarial_multimodal_findings_are_converted_to_worker_remediation_inputs",
          "framework_can_apply_the_same_feedback_to_many_encounter_definitions",
        ]),
      }),
    ]));
  });

  it("builds provider-disabled humanoid remediation planning metadata across realism dimensions", () => {
    const plans = buildVisualQaRemediationWorkOrderPlans({
      requestId: "encounter_assets_ed_chest_pain_001",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      sourceEvidenceRef: "visual-qa-evidence://ed/latest",
      encounterDefinitionRef: {
        storeKind: "mongoose",
        collectionName: "scenario_definitions",
        documentId: "scenario_ed_chest_pain_v1",
      },
      targetAssetStore: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/",
      },
      persistenceTarget: {
        storeKind: "mongoose",
        collectionName: "encounter_asset_generation_jobs",
      },
      remediationInputs: buildDefaultHumanoidRemediationLoopInputs({
        actorRole: "patient",
        workOrderRefs: ["encounter_assets_ed_chest_pain_001:patient:role-specific-humanoid"],
      }),
    });

    expect(plans.map((plan) => plan.providerDisabledPlanningMetadata.dimension)).toEqual([
      "gaze",
      "mouth_viseme",
      "pose",
      "posture_collision",
      "clothing",
      "shared_asset_reuse",
    ]);
    expect(plans.every((plan) =>
      plan.providerDisabledPlanningMetadata.providerExecutionBoundary.executionStatus === "metadata_only_not_executed"
      && plan.providerDisabledPlanningMetadata.providerExecutionBoundary.allowPaidCloudApis === false
      && plan.providerDisabledPlanningMetadata.providerExecutionBoundary.allowExternalNetwork === false
      && plan.providerDisabledPlanningMetadata.providerExecutionBoundary.providerRoutesRequireExplicitApproval === true
      && plan.providerDisabledPlanningMetadata.notEvidenceFor.includes("quest_readiness")
      && plan.providerDisabledPlanningMetadata.notEvidenceFor.includes("production_asset_readiness")
    )).toBe(true);
    expect(plans.find((plan) => plan.providerDisabledPlanningMetadata.dimension === "gaze")?.providerDisabledPlanningMetadata.requiredSignalRefs)
      .toEqual(expect.arrayContaining(["speaker_targeting", "gaze_blink_control_map"]));
    expect(plans.find((plan) => plan.providerDisabledPlanningMetadata.dimension === "shared_asset_reuse")?.providerDisabledPlanningMetadata.acceptanceCriteria)
      .toEqual(expect.arrayContaining(["shared_asset_reuse_plan_requires_evidence_gate_compatible_cache_reuse_before_regeneration"]));
  });

  it("rejects encounter asset queue messages that skip required publication gates", () => {
    expect(() => createEncounterAssetGenerationQueueMessage({
      requestId: "bad",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: ["character-generation"],
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 72, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    })).toThrow("Encounter asset generation requests require scene-manifest-freeze");
  });

  it("rejects humanoid realism profiles that drop eye realism metadata boundaries", () => {
    expect(() => createEncounterAssetGenerationQueueMessage({
      requestId: "bad_humanoid_profile",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: ["scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
      humanoidRealismRequirements: {
        schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
        source: "scenario_actor_definitions",
        requirements: [
          {
            actorRole: "patient",
            requiredAssetKinds: ["generated_humanoid_mesh", "clinical_idle_animation", "viseme_phoneme_map", "gaze_blink_control"],
            requiredSignalIds: ["animated_humanoid_runtime_playback", "dialogue_viseme_and_gaze_mapping"],
            realismProfile: {
              ageBand: "adult",
              bodyPostureNotes: ["clinical_idle_pose_must_match_encounter_context"],
              clothingClinicalContextCues: ["patient_role_appropriate_clothing"],
              expressionAffectCues: ["subtle_blink_and_micro_saccade_motion"],
              mobilityPositioningConstraints: ["movement_must_preserve_clinical_spatial_blocking"],
              requiredRealismEvidenceIds: ["dialogue_viseme_and_gaze_mapping"],
              claimScope: "metadata_only_not_visual_quality_evidence",
            },
          },
        ],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 72, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    })).toThrow("Humanoid realism requirements for patient require dialogue_eye_micro_saccade_blink_cue");
  });

  it("rejects humanoid requirements without metadata-only realism profiles", () => {
    expect(() => createEncounterAssetGenerationQueueMessage({
      requestId: "bad_missing_profile",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: ["scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
      humanoidRealismRequirements: {
        schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
        source: "scenario_actor_definitions",
        requirements: [
          {
            actorRole: "patient",
            requiredAssetKinds: ["generated_humanoid_mesh", "clinical_idle_animation", "viseme_phoneme_map", "gaze_blink_control"],
            requiredSignalIds: [
              "animated_humanoid_runtime_playback",
              "dialogue_viseme_and_gaze_mapping",
              "dialogue_eye_micro_saccade_blink_cue",
              "generated_eyelid_blink_control_cue",
              "emotion_aligned_expression_transition_cue",
            ],
          },
        ],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 72, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    })).toThrow("Humanoid realism requirements for patient require metadata-only realismProfile");
  });

  it("rejects humanoid requirements with duplicate actor roles", () => {
    expect(() => createEncounterAssetGenerationQueueMessage({
      requestId: "bad_duplicate_roles",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: ["scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
      humanoidRealismRequirements: {
        schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
        source: "scenario_actor_definitions",
        requirements: [
          {
            actorRole: "patient",
            requiredAssetKinds: ["generated_humanoid_mesh", "clinical_idle_animation", "viseme_phoneme_map", "gaze_blink_control"],
            requiredSignalIds: [
              "animated_humanoid_runtime_playback",
              "dialogue_viseme_and_gaze_mapping",
              "dialogue_eye_micro_saccade_blink_cue",
              "generated_eyelid_blink_control_cue",
              "emotion_aligned_expression_transition_cue",
            ],
            realismProfile: {
              ageBand: "adult",
              bodyPostureNotes: ["clinical_idle_pose_must_match_encounter_context"],
              clothingClinicalContextCues: ["patient_role_appropriate_clothing"],
              expressionAffectCues: ["subtle_blink_and_micro_saccade_motion"],
              mobilityPositioningConstraints: ["movement_must_preserve_clinical_spatial_blocking"],
              requiredRealismEvidenceIds: [
                "dialogue_viseme_and_gaze_mapping",
                "dialogue_eye_micro_saccade_blink_cue",
                "generated_eyelid_blink_control_cue",
                "emotion_aligned_expression_transition_cue",
              ],
              claimScope: "metadata_only_not_visual_quality_evidence",
            },
          },
          {
            actorRole: "patient",
            requiredAssetKinds: ["generated_humanoid_mesh", "clinical_idle_animation", "viseme_phoneme_map", "gaze_blink_control"],
            requiredSignalIds: [
              "animated_humanoid_runtime_playback",
              "dialogue_viseme_and_gaze_mapping",
              "dialogue_eye_micro_saccade_blink_cue",
              "generated_eyelid_blink_control_cue",
              "emotion_aligned_expression_transition_cue",
            ],
            realismProfile: {
              ageBand: "adult",
              bodyPostureNotes: ["clinical_idle_pose_must_match_encounter_context"],
              clothingClinicalContextCues: ["patient_role_appropriate_clothing"],
              expressionAffectCues: ["subtle_blink_and_micro_saccade_motion"],
              mobilityPositioningConstraints: ["movement_must_preserve_clinical_spatial_blocking"],
              requiredRealismEvidenceIds: [
                "dialogue_viseme_and_gaze_mapping",
                "dialogue_eye_micro_saccade_blink_cue",
                "generated_eyelid_blink_control_cue",
                "emotion_aligned_expression_transition_cue",
              ],
              claimScope: "metadata_only_not_visual_quality_evidence",
            },
          },
        ],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 72, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    })).toThrow("Humanoid realism actor requirements require unique actorRole");
  });

  it("processes one encounter asset generation queue message into durable worker checkpoints", async () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_ed_chest_pain_001",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: {
        storeKind: "mongoose",
        collectionName: "scenario_definitions",
        documentId: "scenario_ed_chest_pain_v1",
      },
      targetAssetStore: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/",
      },
      persistenceTarget: {
        storeKind: "mongoose",
        collectionName: "encounter_asset_generation_jobs",
      },
      requestedStages: [
        "encounter-definition-ingested",
        "character-generation",
        "medical-equipment-generation",
        "environment-generation",
        "animation-generation",
        "voice-asset-generation",
        "asset-bake",
        "scene-manifest-freeze",
        "runtime-bundle-publication",
        "review-evidence-gate",
      ],
      optimizationWindow: {
        expectedMinimumHours: 2,
        expectedMaximumHours: 96,
        mayRunForDays: true,
        checkpointIntervalMinutes: 30,
      },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: {
        allowPaidCloudApis: false,
        allowProductionDeployment: false,
        productionReadinessClaimed: false,
      },
    });
    let clock = 0;
    const execution = await processEncounterAssetGenerationQueueMessage(encodeAzureStorageQueueMessage(message), {
      now: () => `2026-05-23T12:${String(clock++).padStart(2, "0")}:00.000Z`,
    });

    expect(execution).toMatchObject({
      schemaVersion: "openclinxr.encounter-asset-generation-worker-execution.v1",
      requestId: "encounter_assets_ed_chest_pain_001",
      queueName: "encounter-asset-generation",
      status: "review_blocked",
      generatedSceneManifestBlobName: "scenario-assets/ed_chest_pain_priority_v1/encounter_1/scene-manifest.v1.json",
      learnerRuntimeBundleId: "encounter_1:learner-runtime-bundle:v1",
      productionReadinessClaimed: false,
    });
    expect(execution.evidenceGateRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gateId: "asset_production_review",
        status: "pending",
        blockers: ["asset_production_review_not_attached_to_generation_job"],
      }),
      expect.objectContaining({
        gateId: "runtime_realism_evidence",
        status: "pending",
        requiredSignalIds: expect.arrayContaining([
          "animated_humanoid_runtime_playback",
          "authored_clinical_idle_pose_runtime_cue",
          "visible_mouth_eye_expression_cues",
          "dialogue_viseme_and_gaze_mapping",
          "emotion_aligned_expression_transition_cue",
        ]),
        blockers: ["runtime_realism_evidence_not_attached_to_generation_job"],
      }),
      expect.objectContaining({
        gateId: "visual_qa_evidence",
        status: "pending",
        requiredSignalIds: expect.arrayContaining(["emotion_expression_transition_readability"]),
        blockers: ["visual_qa_evidence_not_attached_to_generation_job"],
      }),
      expect.objectContaining({
        gateId: "quest_runtime_evidence",
        status: "pending",
        blockers: ["quest_runtime_evidence_not_attached_to_generation_job"],
      }),
    ]));
    expect(execution.checkpoints).toHaveLength(20);
    expect(execution.sharedAssetLibraryCacheEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        result: "cache_miss_generation_required",
        targetKind: "visual_feedback_closure",
        notEvidenceFor: [
          "generated_asset_quality",
          "provider_runtime_readiness",
          "production_asset_readiness",
          "quest_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      }),
    ]));
    expect(execution.checkpoints[0]).toMatchObject({
      stage: "encounter-definition-ingested",
      status: "running",
      artifactRefs: [],
    });
    expect(execution.checkpoints.at(-1)).toMatchObject({
      stage: "review-evidence-gate",
      status: "review_blocked",
      artifactRefs: ["scenario-assets/ed_chest_pain_priority_v1/encounter_1/review-gate.required.json"],
      message: "Human review evidence is required before learner runtime use; no readiness claim is made.",
    });
  });

  it("records shared asset library cache hits so compatible work orders can skip generation", async () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_cache_reuse",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: ["character-generation", "scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
      humanoidRealismRequirements: {
        schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
        source: "scenario_actor_definitions",
        requirements: [
          {
            actorRole: "patient",
            requiredAssetKinds: ["generated_humanoid_mesh", "clinical_idle_animation", "viseme_phoneme_map", "gaze_blink_control"],
            requiredSignalIds: [
              "animated_humanoid_runtime_playback",
              "authored_clinical_idle_pose_runtime_cue",
              "visible_mouth_eye_expression_cues",
              "dialogue_viseme_and_gaze_mapping",
              "dialogue_eye_micro_saccade_blink_cue",
              "generated_eyelid_blink_control_cue",
              "emotion_aligned_expression_transition_cue",
            ],
            realismProfile: {
              ageBand: "adult",
              bodyPostureNotes: ["clinical_idle_pose_must_match_encounter_context"],
              clothingClinicalContextCues: ["patient_role_appropriate_clothing"],
              expressionAffectCues: ["subtle_blink_and_micro_saccade_motion"],
              mobilityPositioningConstraints: ["movement_must_preserve_clinical_spatial_blocking"],
              requiredRealismEvidenceIds: [
                "dialogue_viseme_and_gaze_mapping",
                "dialogue_eye_micro_saccade_blink_cue",
                "generated_eyelid_blink_control_cue",
                "emotion_aligned_expression_transition_cue",
              ],
              claimScope: "metadata_only_not_visual_quality_evidence",
            },
          },
        ],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 96, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    });
    const plan = buildEncounterAssetGenerationPlan(message);
    const reusableWorkOrder = plan.generationWorkOrders.find((workOrder) => workOrder.targetKind === "role_specific_humanoid_glb");
    expect(reusableWorkOrder).toBeDefined();

    const execution = await processEncounterAssetGenerationQueueMessage(message, {
      now: () => "2026-05-25T10:00:00.000Z",
      sharedAssetLibraryEntries: reusableWorkOrder
        ? [{
            lookupKey: reusableWorkOrder.sharedAssetLibraryReuse.lookupKey,
            assetRef: "blob://openclinxr-assets/shared-encounter-assets/reused-patient/model.glb",
            evidenceGateRefs: reusableWorkOrder.evidenceGateRefs,
            lastUsedAt: "2026-05-25T09:00:00.000Z",
          }]
        : [],
    });

    expect(execution.sharedAssetLibraryCacheEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workOrderId: reusableWorkOrder?.workOrderId,
        result: "cache_hit_reuse_generation_skipped",
        generationDisposition: "skip_generation_reuse_cached_asset",
        evidenceGateCompatibility: {
          required: true,
          checkedBeforeReuse: true,
          disposition: "compatible_cached_asset_reused",
        },
        assetRef: "blob://openclinxr-assets/shared-encounter-assets/reused-patient/model.glb",
        targetKind: "role_specific_humanoid_glb",
      }),
      expect.objectContaining({
        result: "cache_miss_generation_required",
        generationDisposition: "generate_and_store_asset",
        evidenceGateCompatibility: {
          required: true,
          checkedBeforeReuse: true,
          disposition: "requires_review_before_new_asset_reuse",
        },
        targetKind: "visual_feedback_closure",
      }),
    ]));
    expect(execution.operationalNotes.sharedLibraryNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workOrderId: reusableWorkOrder?.workOrderId,
        result: "cache_hit_reuse_generation_skipped",
        retryCheckpoint: "reuse_cached_asset",
        retryable: false,
      }),
    ]));
  });

  it("derives Blob and Mongoose publication targets from the encounter request", () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_publication_targets",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: ["scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 96, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    });

    expect(buildEncounterAssetGenerationPublicationTargets(message.request)).toEqual({
      generatedSceneManifestBlobName: "scenario-assets/ed/scene-manifest.v1.json",
      learnerRuntimeBundleBlobName: "scenario-assets/ed/learner-runtime-bundle.v1.json",
      learnerRuntimeBundleId: "encounter_1:learner-runtime-bundle:v1",
      learnerRuntimeBundleMongoCollection: "learner_runtime_asset_bundles",
      jobStateMongoCollection: "encounter_asset_generation_jobs",
    });
  });

  it("derives encounter generation evidence gates from the queue request", () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_evidence_gates",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: ["scene-manifest-freeze", "runtime-bundle-publication", "review-evidence-gate"],
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 96, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    });

    expect(buildEncounterAssetGenerationEvidenceGateRefs(message.request).map((gateRef) => gateRef.gateId)).toEqual([
      "asset_production_review",
      "runtime_realism_evidence",
      "visual_qa_evidence",
      "quest_runtime_evidence",
    ]);
  });

  it("stops encounter asset generation workers at the first failed stage", async () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_failed",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: [
        "encounter-definition-ingested",
        "character-generation",
        "scene-manifest-freeze",
        "runtime-bundle-publication",
        "review-evidence-gate",
      ],
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 24, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    });

    const execution = await processEncounterAssetGenerationQueueMessage(message, {
      now: () => "2026-05-23T12:00:00.000Z",
      runStage: ({ stage }) => {
        if (stage === "character-generation") {
          throw new Error("character mesh generation failed");
        }
        return { artifactRefs: [`artifact://${stage}`] };
      },
    });

    expect(execution.status).toBe("failed");
    expect(execution.checkpoints).toEqual([
      {
        stage: "encounter-definition-ingested",
        status: "running",
        at: "2026-05-23T12:00:00.000Z",
        artifactRefs: [],
      },
      {
        stage: "encounter-definition-ingested",
        status: "succeeded",
        at: "2026-05-23T12:00:00.000Z",
        artifactRefs: ["artifact://encounter-definition-ingested"],
      },
      {
        stage: "character-generation",
        status: "running",
        at: "2026-05-23T12:00:00.000Z",
        artifactRefs: [],
      },
      {
        stage: "character-generation",
        status: "failed",
        at: "2026-05-23T12:00:00.000Z",
        artifactRefs: [],
        message: "character mesh generation failed",
      },
    ]);
    expect(execution.operationalNotes.stageNotes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "character-generation",
        transitions: ["queued_to_running", "running_to_failed"],
        retryCheckpoint: "after_stage_failure",
        retryable: true,
      }),
    ]));
    expect(execution.workerMaterializationPlan).toMatchObject({
      schemaVersion: "openclinxr.worker-materialization-plan.v1",
      requestId: "encounter_assets_failed",
      scenarioId: "ed_chest_pain_priority_v1",
      rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v1/encounter_assets_failed",
      generatedAssetsMaterialized: false,
      paidApisUsed: false,
      productionReadinessClaimed: false,
      claimBoundary: "planned_metadata_only",
    });
  });

  it("processes one received queue message only after durable execution persistence", async () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_queue_client",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: [
        "encounter-definition-ingested",
        "scene-manifest-freeze",
        "runtime-bundle-publication",
        "review-evidence-gate",
      ],
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 96, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    });
    const calls: string[] = [];
    const queueClient: EncounterAssetGenerationQueueClient = {
      async receiveEncounterAssetGenerationMessage() {
        calls.push("receive");
        return {
          messageId: "message-1",
          popReceipt: "receipt-1",
          messageText: encodeAzureStorageQueueMessage(message),
          dequeueCount: 1,
        };
      },
      async deleteEncounterAssetGenerationMessage(messageId, popReceipt) {
        calls.push(`delete:${messageId}:${popReceipt}`);
      },
    };

    const result = await processNextEncounterAssetGenerationQueueMessage({
      queueClient,
      now: () => "2026-05-23T12:00:00.000Z",
      persistExecution: async (execution, envelope) => {
        calls.push(`persist:${execution.requestId}:${envelope.messageId}:${execution.status}`);
      },
    });

    expect(result).toMatchObject({
      status: "processed",
      messageReceived: true,
      messageDeleted: true,
      execution: {
        requestId: "encounter_assets_queue_client",
        status: "review_blocked",
        productionReadinessClaimed: false,
      },
    });
    expect(calls).toEqual([
      "receive",
      "persist:encounter_assets_queue_client:message-1:review_blocked",
      "delete:message-1:receipt-1",
    ]);
  });

  it("does not delete queue messages when durable persistence fails", async () => {
    const message = createEncounterAssetGenerationQueueMessage({
      requestId: "encounter_assets_persist_failed",
      tenantId: "tenant_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      encounterDefinitionRef: { storeKind: "mongoose", documentId: "scenario_ed_chest_pain_v1" },
      targetAssetStore: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobPrefix: "scenario-assets/ed/" },
      persistenceTarget: { storeKind: "mongoose", collectionName: "encounter_asset_generation_jobs" },
      requestedStages: [
        "encounter-definition-ingested",
        "scene-manifest-freeze",
        "runtime-bundle-publication",
        "review-evidence-gate",
      ],
      optimizationWindow: { expectedMinimumHours: 2, expectedMaximumHours: 96, mayRunForDays: true, checkpointIntervalMinutes: 30 },
      evidenceGates: {
        requireGeneratedSceneManifest: true,
        requireRuntimeBundlePublication: true,
        requireHumanReviewBeforeLearnerUse: true,
        requireQuestEvidenceBeforeQuestReadinessClaim: true,
      },
      policy: { allowPaidCloudApis: false, allowProductionDeployment: false, productionReadinessClaimed: false },
    });
    const calls: string[] = [];
    const queueClient: EncounterAssetGenerationQueueClient = {
      async receiveEncounterAssetGenerationMessage() {
        calls.push("receive");
        return {
          messageId: "message-1",
          popReceipt: "receipt-1",
          messageText: encodeAzureStorageQueueMessage(message),
        };
      },
      async deleteEncounterAssetGenerationMessage() {
        calls.push("delete");
      },
    };

    const result = await processNextEncounterAssetGenerationQueueMessage({
      queueClient,
      now: () => "2026-05-23T12:00:00.000Z",
      persistExecution: async () => {
        calls.push("persist");
        throw new Error("mongoose unavailable");
      },
    });

    expect(result).toEqual({
      status: "failed_before_delete",
      messageReceived: true,
      messageDeleted: false,
      envelope: {
        messageId: "message-1",
        popReceipt: "receipt-1",
        messageText: encodeAzureStorageQueueMessage(message),
      },
      error: "mongoose unavailable",
    });
    expect(calls).toEqual(["receive", "persist"]);
  });

  it.each([
    "character-generation",
    "medical-equipment-generation",
    "voice-asset-generation",
    "animation-generation",
    "asset-bake",
  ] as const)("submits deterministic no-spend jobs for %s", async (capabilityId) => {
    const facade = new AssetGenerationCapabilityFacade({
      idFactory: () => `job-${capabilityId}`,
      now: fixedClock([
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:01.000Z",
        "2026-01-01T00:00:02.000Z",
      ]),
    });

    const record = await facade.submit({
      profile: "local-development",
      capabilityId,
      payload: {
        requestId: `req-${capabilityId}`,
      },
    });

    expect(record.status).toBe("succeeded");
    expect(record.request.capabilityId).toBe(capabilityId);
    expect(record.manifest).toMatchObject({
      schemaVersion: "asset-generation-manifest.v1",
      capabilityId,
    });
    expect(record.provenance).toMatchObject({
      spendCents: 0,
      externalNetworkUsed: false,
    });
    expect(record.history.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
  });

  it("stores a full deterministic no-spend job lifecycle in memory", async () => {
    let sequence = 0;
    const facade = new AssetGenerationCapabilityFacade({
      idFactory: () => `job-${++sequence}`,
      now: fixedClock([
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:01.000Z",
        "2026-01-01T00:00:02.000Z",
      ]),
    });

    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "character-generation",
      payload: {
        clinicalRole: "standardized-patient",
        scenarioId: "ed-chest-pain",
      },
    });

    expect(record).toMatchObject({
      id: "job-1",
      status: "succeeded",
      policy: {
        timeoutMs: 120_000,
        sandboxWorkdir: ".openclinxr/asset-generation",
        requireArtifactManifest: true,
        requireLicenseProvenance: true,
        allowExternalNetwork: false,
        spendLimitCents: 0,
        runtime: {
          providerKind: "deterministic-mock",
          implementationLanguage: "typescript",
          transport: "in-process",
        },
      },
      manifest: {
        schemaVersion: "asset-generation-manifest.v1",
        capabilityId: "character-generation",
      },
      provenance: {
        license: "openclinxr-deterministic-test-fixture",
        spendCents: 0,
        externalNetworkUsed: false,
      },
    });
    expect(record.history.map((event) => event.status)).toEqual(["queued", "running", "succeeded"]);
    expect(record.artifacts).toEqual([
      {
        kind: "manifest",
        path: ".openclinxr/asset-generation/job-1/character-generation-manifest.json",
        mediaType: "application/json",
      },
      {
        kind: "source",
        path: ".openclinxr/asset-generation/job-1/character-generation-source.asset.json",
        mediaType: "application/json",
      },
    ]);
    await expect(facade.get("job-1")).resolves.toEqual(record);
    expect(await facade.list()).toEqual([record]);

    record.history.push({ status: "failed", at: "2026-01-01T00:00:03.000Z" });
    const firstArtifact = record.artifacts[0];
    if (firstArtifact === undefined) {
      throw new Error("Expected job record to include at least one artifact");
    }
    firstArtifact.path = "mutated.json";
    await expect(facade.get("job-1")).resolves.toMatchObject({
      artifacts: [
        {
          path: ".openclinxr/asset-generation/job-1/character-generation-manifest.json",
        },
        {
          path: ".openclinxr/asset-generation/job-1/character-generation-source.asset.json",
        },
      ],
      history: [
        { status: "queued" },
        { status: "running" },
        { status: "succeeded" },
      ],
    });
  });

  it("rejects blank generated job IDs before persisting lifecycle records", async () => {
    const facade = new AssetGenerationCapabilityFacade({
      idFactory: () => "   ",
    });

    await expect(facade.submit({
      profile: "local-development",
      capabilityId: "character-generation",
      payload: {},
    })).rejects.toThrow("Asset generation jobs require a job id");
  });

  it("invokes Python/native workers through a fake command runner only", async () => {
    const calls: unknown[] = [];
    const runner: CommandRunner = {
      async run(invocation) {
        calls.push(invocation);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            artifacts: [
              {
                kind: "mesh",
                path: ".openclinxr/asset-generation/native-1/baked.glb",
                mediaType: "model/gltf-binary",
              },
            ],
            manifest: {
              schemaVersion: "asset-generation-manifest.v1",
              capabilityId: "asset-bake",
              outputs: ["baked.glb"],
            },
            provenance: {
              generator: "fake-blender",
              license: "fixture-only",
              spendCents: 0,
              externalNetworkUsed: false,
            },
          }),
          stderr: "",
        };
      },
    };
    const facade = new AssetGenerationCapabilityFacade({
      adapters: [
        createDeterministicAssetGenerationAdapter("character-generation"),
        createDeterministicAssetGenerationAdapter("medical-equipment-generation"),
        {
          capabilityId: "asset-bake",
          providerId: "fake-native-bake",
          providerKind: "native-executable-worker",
          implementationLanguage: "native-executable",
          transport: "local-executable-worker",
          async run(request, policy, context) {
            return context.commandRunner.run({
              executable: "fake-blender",
              args: ["--background", "--python", "bake.py", "--job", context.jobId],
              cwd: policy.sandboxWorkdir,
              timeoutMs: policy.timeoutMs,
              env: {
                OPENCLINXR_NO_EXTERNAL_NETWORK: "1",
                OPENCLINXR_SPEND_LIMIT_CENTS: "0",
              },
              input: JSON.stringify(request.payload),
            }).then((result) => {
              if (result.exitCode !== 0) {
                throw new Error(result.stderr || `Worker exited with ${result.exitCode}`);
              }
              return JSON.parse(result.stdout);
            });
          },
        } satisfies AssetGenerationWorkerAdapter,
      ],
      commandRunner: runner,
      idFactory: () => "native-1",
    });

    const record = await facade.submit({
      profile: "local-production",
      capabilityId: "asset-bake",
      payload: { sourceAsset: "clinical-room.glb" },
      policy: {
        timeoutMs: 30_000,
        sandboxWorkdir: ".openclinxr/custom-worker",
      },
    });

    expect(record.status).toBe("succeeded");
    expect(record.worker).toMatchObject({
      providerId: "fake-native-bake",
      providerKind: "native-executable-worker",
      implementationLanguage: "native-executable",
      transport: "local-executable-worker",
    });
    expect(calls).toEqual([
      {
        executable: "fake-blender",
        args: ["--background", "--python", "bake.py", "--job", "native-1"],
        cwd: ".openclinxr/custom-worker",
        timeoutMs: 30_000,
        env: {
          OPENCLINXR_NO_EXTERNAL_NETWORK: "1",
          OPENCLINXR_SPEND_LIMIT_CENTS: "0",
        },
        input: JSON.stringify({ sourceAsset: "clinical-room.glb" }),
      },
    ]);
    expect(record.provenance).toMatchObject({
      spendCents: 0,
      externalNetworkUsed: false,
    });
  });

  it("records worker failures without losing policy or request context", async () => {
    const failingAdapter: AssetGenerationWorkerAdapter = {
      capabilityId: "medical-equipment-generation",
      providerId: "fake-python-equipment",
      providerKind: "python-worker",
      implementationLanguage: "python",
      transport: "local-executable-worker",
      async run() {
        throw new Error("mesh generator crashed");
      },
    };
    const facade = new AssetGenerationCapabilityFacade({
      adapters: [failingAdapter],
      idFactory: () => "failed-1",
    });
    const request: AssetGenerationJobRequest = {
      profile: "local-development",
      capabilityId: "medical-equipment-generation",
      payload: { equipmentType: "defibrillator" },
    };

    const record = await facade.submit(request);

    expect(record).toMatchObject({
      id: "failed-1",
      status: "failed",
      request,
      policy: {
        allowExternalNetwork: false,
        spendLimitCents: 0,
        requireArtifactManifest: true,
        requireLicenseProvenance: true,
      },
      error: {
        message: "mesh generator crashed",
      },
    });
    expect(record.history.map((event) => event.status)).toEqual(["queued", "running", "failed"]);
    await expect(facade.get("failed-1")).resolves.toMatchObject({ status: "failed" });
  });

  it("fails jobs whose returned manifest does not match the requested capability", async () => {
    const mismatchedAdapter: AssetGenerationWorkerAdapter = {
      capabilityId: "character-generation",
      providerId: "mismatched-manifest-worker",
      providerKind: "deterministic-mock",
      implementationLanguage: "typescript",
      transport: "in-process",
      async run() {
        return {
          artifacts: [],
          manifest: {
            schemaVersion: "asset-generation-manifest.v1",
            capabilityId: "asset-bake",
          },
          provenance: {
            license: "fixture-only",
            spendCents: 0,
            externalNetworkUsed: false,
          },
        };
      },
    };
    const facade = new AssetGenerationCapabilityFacade({
      adapters: [mismatchedAdapter],
      idFactory: () => "manifest-mismatch-1",
    });

    const record = await facade.submit({
      profile: "local-development",
      capabilityId: "character-generation",
      payload: {},
    });

    expect(record.status).toBe("failed");
    expect(record.error?.message).toBe("Asset generation worker returned manifest for asset-bake, expected character-generation");
  });

  it("rejects policy/runtime swaps that would use cloud spend or external network", async () => {
    const facade = new AssetGenerationCapabilityFacade();

    await expect(facade.submit({
      profile: "production",
      capabilityId: "asset-bake",
      payload: {},
      policy: {
        allowExternalNetwork: true,
      },
    })).rejects.toThrow("Asset generation jobs must disable external network access");

    await expect(facade.submit({
      profile: "production",
      capabilityId: "asset-bake",
      payload: {},
      policy: {
        spendLimitCents: 1,
      },
    })).rejects.toThrow("Asset generation jobs must be configured for zero spend");

    await expect(facade.submit({
      profile: "production",
      capabilityId: "asset-bake",
      payload: {},
      policy: {
        runtime: {
          providerKind: "paid-cloud-provider",
        },
      },
    })).rejects.toThrow("Asset generation runtime swaps cannot use paid cloud providers");
  });
});

function fixedClock(values: string[]): () => string {
  let index = 0;
  return () => {
    const value = values[Math.min(index++, values.length - 1)];
    const fallback = values[values.length - 1];
    if (value !== undefined) {
      return value;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error("fixedClock requires at least one value");
  };
}
