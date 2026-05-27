import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEncounterAssetGenerationQueueReport,
  buildEncounterAssetGenerationRequestForScenario,
  type EncounterAssetGenerationQueueReport,
  runEncounterAssetGenerationQueueCli,
  validateEncounterAssetGenerationQueueReport,
} from "./encounter-asset-generation-queue.js";
import { buildDynamicEncounterFactoryProjectionArtifact, edChestPainScenario, edChestPainScenarioV2, edChestPainScenarioV3, variantScenarioBank } from "../../packages/openclinxr/scenario-fixtures/src/index.js";

describe("encounter asset generation queue report", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:encounter-queue:plan"]).toBe(
      "tsx tools/openclinxr/encounter-asset-generation-queue.ts",
    );
    expect(rootPackage.scripts["asset:encounter-queue:validate"]).toBe(
      "tsx tools/openclinxr/encounter-asset-generation-queue.ts --validate-latest",
    );
  });

  it("builds an Azurite-compatible multi-day queue contract without readiness claims", () => {
    const report = buildEncounterAssetGenerationQueueReport({
      generatedAt: "2026-05-23T12:00:00.000Z",
    });

    expect(report).toMatchObject({
      generatedAt: "2026-05-23T12:00:00.000Z",
      schemaVersion: "openclinxr.encounter-asset-generation-queue-report.v1",
      status: "planned",
      queue: {
        queueName: "encounter-asset-generation",
        messageKind: "encounter_definition_to_executable_encounter",
        visibilityTimeoutSeconds: 300,
        dequeueAttemptLimit: 25,
      },
      storageTargets: {
        blobStoreKind: "azurite_blob",
        blobContainerName: "openclinxr-assets",
        durableStateStoreKind: "mongoose",
        durableStateCollectionName: "encounter_asset_generation_jobs",
      },
      operationalNotes: {
        longRunningOptimizationAccepted: true,
        expectedMinimumHours: 2,
        expectedMaximumHours: 96,
        mayRunForDays: true,
        checkpointIntervalMinutes: 30,
        generatedAssetsMustRemainDynamic: true,
        sceneIsNotHardcodedInRuntime: true,
        providerDisabledBoundary: {
          claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
          executionEnabled: false,
          externalProviderExecutionAttempted: false,
          liveProviderReady: false,
          credentialEvidencePresent: false,
          runtimeEvidencePresent: false,
          reportMetadataOnly: true,
          surfacedInQueueReport: true,
          missingEvidenceIds: [
            "provider_credentials_or_operator_approval_missing",
            "provider_runtime_evidence_missing",
          ],
          notEvidenceFor: [
            "provider_runtime_readiness",
            "generated_asset_quality",
            "production_asset_readiness",
            "quest_readiness",
            "clinical_validity",
            "scoring_validity",
          ],
          recommendedNextAction: "keep_live_provider_generation_disabled_until_operator_approval_and_runtime_evidence_exist",
        },
        localOnlyBoundary: {
          claimBoundary: "local_only_asset_pipeline_metadata_not_live_provider_readiness",
          executionEnabled: false,
          externalProviderExecutionAttempted: false,
          liveProviderReady: false,
          credentialEvidencePresent: false,
          runtimeEvidencePresent: false,
          reportMetadataOnly: true,
          surfacedInQueueReport: true,
          missingEvidenceIds: [
            "local_blender_ffmpeg_toolchain_evidence_missing",
            "hunyuan3d_local_install_license_cache_evidence_missing",
            "shared_asset_library_lru_reuse_evidence_missing",
            "azurite_or_queue_emulator_evidence_missing",
            "durable_job_checkpoint_evidence_missing",
          ],
          notEvidenceFor: [
            "provider_runtime_readiness",
            "generated_asset_quality",
            "production_asset_readiness",
            "quest_readiness",
            "clinical_validity",
            "scoring_validity",
          ],
          recommendedNextAction: "attach_local_toolchain_and_queue_emulator_evidence_before_claiming_live_generation",
        },
      },
      evidenceBoundaries: {
        azureQueueMessagePrepared: true,
        azuriteCompatible: true,
        azureCloudOperationPerformed: false,
        paidApisUsed: false,
        productionDeploymentPerformed: false,
        productionReadinessClaimed: false,
        questReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
      },
    });
    expect(report.queue.encodedMessageBytes).toBeLessThan(64 * 1024);
    expect(report.plan.stages.map((stage) => stage.stage)).toEqual(report.request.requestedStages);
    expect(report.plan.stages.find((stage) => stage.stage === "runtime-bundle-publication")).toMatchObject({
      outputTarget: "blob_and_mongoose",
      durableCheckpointRequired: true,
    });
    expect(report.humanoidRealismRequirements).toMatchObject({
      schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
      source: "scenario_actor_definitions",
      notEvidenceFor: expect.arrayContaining([
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ]),
    });
    expect(report.encounterAssetNeedsReadinessManifest).toMatchObject({
      schemaVersion: "openclinxr.encounter-asset-needs-readiness.v1",
      scenarioId: "ed_chest_pain_priority_v1",
      scenarioStatus: "approved",
      requiredHumanoids: expect.arrayContaining([
        expect.objectContaining({ actorRole: "patient" }),
        expect.objectContaining({ actorRole: "nurse" }),
      ]),
      animationRequirements: expect.any(Object),
      emotionRequirements: expect.any(Object),
      gazeRequirements: expect.any(Object),
      lipSyncRequirements: expect.any(Object),
      requiredPropsAndEquipment: expect.any(Array),
      sharedAssetLibrarySemanticKeys: expect.any(Array),
      blockers: expect.any(Array),
      readyForDeterministicGeneration: expect.any(Boolean),
    });
    expect(report.humanoidRealismRequirements?.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorRole: "patient",
        requiredAssetKinds: expect.arrayContaining([
          "generated_humanoid_mesh",
          "clinical_idle_animation",
          "viseme_phoneme_map",
          "gaze_blink_control",
        ]),
        requiredSignalIds: expect.arrayContaining([
          "animated_humanoid_runtime_playback",
          "dialogue_viseme_and_gaze_mapping",
          "dialogue_eye_micro_saccade_blink_cue",
          "generated_eyelid_blink_control_cue",
          "emotion_aligned_expression_transition_cue",
        ]),
      }),
    ]));
    expect(report.humanoidRealismProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorRole: "patient",
        ageBand: "adult",
        claimScope: "metadata_only_not_visual_quality_evidence",
        bodyPostureNotes: expect.arrayContaining(["clinical_idle_pose_must_match_encounter_context"]),
        clothingClinicalContextCues: expect.arrayContaining(["patient_role_appropriate_clothing"]),
        expressionAffectCues: expect.arrayContaining(["subtle_blink_and_micro_saccade_motion"]),
        mobilityPositioningConstraints: expect.arrayContaining(["movement_must_preserve_clinical_spatial_blocking"]),
        requiredRealismEvidenceIds: expect.arrayContaining([
          "dialogue_viseme_and_gaze_mapping",
          "dialogue_eye_micro_saccade_blink_cue",
          "generated_eyelid_blink_control_cue",
        ]),
      }),
    ]));
    expect(report.operationalNotes.providerDisabledBoundary).toMatchObject({
      claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
      executionEnabled: false,
      externalProviderExecutionAttempted: false,
      liveProviderReady: false,
      credentialEvidencePresent: false,
      runtimeEvidencePresent: false,
      reportMetadataOnly: true,
      surfacedInQueueReport: true,
      missingEvidenceIds: expect.arrayContaining([
        "provider_credentials_or_operator_approval_missing",
        "provider_runtime_evidence_missing",
      ]),
      notEvidenceFor: expect.arrayContaining([
        "provider_runtime_readiness",
        "generated_asset_quality",
      ]),
    });
    expect(report.operationalNotes.localOnlyBoundary).toMatchObject({
      claimBoundary: "local_only_asset_pipeline_metadata_not_live_provider_readiness",
      executionEnabled: false,
      externalProviderExecutionAttempted: false,
      liveProviderReady: false,
      credentialEvidencePresent: false,
      runtimeEvidencePresent: false,
      reportMetadataOnly: true,
      surfacedInQueueReport: true,
      missingEvidenceIds: expect.arrayContaining([
        "local_blender_ffmpeg_toolchain_evidence_missing",
        "hunyuan3d_local_install_license_cache_evidence_missing",
        "shared_asset_library_lru_reuse_evidence_missing",
        "azurite_or_queue_emulator_evidence_missing",
        "durable_job_checkpoint_evidence_missing",
      ]),
    });
    expect(report.humanoidRealismRequirements?.requirements[0]?.realismProfile).toEqual({
      ageBand: report.humanoidRealismProfiles[0]?.ageBand,
      bodyPostureNotes: report.humanoidRealismProfiles[0]?.bodyPostureNotes,
      clothingClinicalContextCues: report.humanoidRealismProfiles[0]?.clothingClinicalContextCues,
      expressionAffectCues: report.humanoidRealismProfiles[0]?.expressionAffectCues,
      mobilityPositioningConstraints: report.humanoidRealismProfiles[0]?.mobilityPositioningConstraints,
      requiredRealismEvidenceIds: report.humanoidRealismProfiles[0]?.requiredRealismEvidenceIds,
      claimScope: "metadata_only_not_visual_quality_evidence",
    });
    expect(report.plan.humanoidRealismRequirements?.requirements.map((requirement) => requirement.actorRole)).toEqual([
      "patient",
      "family",
      "nurse",
    ]);
    expect(
      report.plan.humanoidRealismRequirements?.requirements.every((requirement) =>
        requirement.requiredSignalIds.includes("dialogue_eye_micro_saccade_blink_cue")
        && requirement.requiredSignalIds.includes("generated_eyelid_blink_control_cue")
      ),
    ).toBe(true);
    expect(report.plan.executableEncounterReadyOnlyAfter).toEqual(expect.arrayContaining([
      "generated_scene_manifest_persisted",
      "assets_written_to_blob_store",
      "learner_runtime_bundle_persisted_to_mongoose_or_mongodb",
      "human_review_gate_passed_for_local_runtime",
      "runtime_realism_evidence_attached",
      "humanoid_visual_qa_evidence_attached",
      "quest_runtime_evidence_attached_before_quest_readiness_claim",
    ]));
    expect(report.plan.generationWorkOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({
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
        ]),
        outputRefs: expect.arrayContaining([
          expect.stringContaining("shared-encounter-assets"),
          expect.stringContaining("mongoose://shared_encounter_asset_library/"),
        ]),
        visualQaBlockerRefs: expect.arrayContaining([
          "role_readability",
          "clothing_authenticity",
          "pose_intent",
        ]),
        acceptanceCriteria: expect.arrayContaining([
          "actor_role_is_distinguishable_without_runtime_overlay_labels",
          "mesh_includes_face_eye_lip_rig_metadata_or_morph_targets",
        ]),
        notEvidenceFor: expect.arrayContaining([
          "production_asset_readiness",
          "quest_readiness",
          "clinical_validity",
          "scoring_validity",
        ]),
      }),
      expect.objectContaining({
        targetKind: "role_idle_animation_glb",
        capabilityId: "animation-generation",
        actorRole: "patient",
        visualQaBlockerRefs: expect.arrayContaining([
          "eye_contact_logic",
          "mouth_talking_realism",
          "idle_motion",
        ]),
        acceptanceCriteria: expect.arrayContaining([
          "dialogue_animation_includes_viseme_phoneme_gaze_and_emotion_transition_tracks",
        ]),
      }),
      expect.objectContaining({
        targetKind: "medical_equipment_glb",
        capabilityId: "medical-equipment-generation",
        providerRoutingPreference: [
          "hunyuan3d_local",
          "meshy_cloud_requires_approval",
          "tripo_cloud_requires_approval",
        ],
        visualQaBlockerRefs: expect.arrayContaining([
          "recognizable_ed_props",
          "functional_placement",
          "cable_tube_logic",
        ]),
      }),
      expect.objectContaining({
        targetKind: "visual_feedback_closure",
        capabilityId: "asset-bake",
        providerRoute: "deterministic-mock",
        inputRefs: expect.arrayContaining([
          "visual-qa-evidence://ed_chest_pain_priority_v1/latest-adversarial-review",
          "screenshot-analysis://ed_chest_pain_priority_v1/latest-multimodal-findings",
        ]),
        acceptanceCriteria: expect.arrayContaining([
          "adversarial_multimodal_findings_are_converted_to_worker_remediation_inputs",
          "framework_can_apply_the_same_feedback_to_many_encounter_definitions",
        ]),
      }),
    ]));
  });

  it("builds selectable queue contracts for the next encounter loop", () => {
    const report = buildEncounterAssetGenerationQueueReport({
      generatedAt: "2026-05-23T12:00:00.000Z",
      request: buildEncounterAssetGenerationRequestForScenario("peds_asthma_parent_anxiety_v1"),
    });

    expect(report.request).toMatchObject({
      requestId: "encounter_assets_peds_asthma_parent_anxiety_executable_v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      encounterId: "peds_asthma_parent_anxiety_encounter_v1",
      stationId: "peds_asthma_parent_anxiety_station_v1",
      targetAssetStore: {
        storeKind: "azurite_blob",
        blobPrefix: "encounter-assets/local_tenant/peds_asthma_parent_anxiety_v1/peds_asthma_parent_anxiety_encounter_v1/",
      },
    });
    expect(report.operationalNotes.expectedMaximumHours).toBe(120);
    expect(report.humanoidRealismRequirements?.requirements.map((requirement) => requirement.actorRole)).toEqual([
      "patient",
      "family",
      "nurse",
    ]);
    expect(report.encounterAssetNeedsReadinessManifest?.requiredHumanoids?.map((humanoid) => humanoid.actorRole)).toEqual(
      expect.arrayContaining(["patient", "family", "nurse"]),
    );
    expect(report.humanoidRealismProfiles.find((profile) => profile.actorRole === "patient")).toMatchObject({
      ageBand: "child_or_adolescent",
      claimScope: "metadata_only_not_visual_quality_evidence",
    });
    expect(
      report.humanoidRealismRequirements?.requirements.every((requirement) =>
        requirement.requiredSignalIds.includes("dialogue_eye_micro_saccade_blink_cue")
        && requirement.requiredSignalIds.includes("generated_eyelid_blink_control_cue")
      ),
    ).toBe(true);
    expect(report.evidenceBoundaries.productionReadinessClaimed).toBe(false);
    expect(validateEncounterAssetGenerationQueueReport(report)).toEqual({ ok: true });
  });

  it("builds queue contracts from projection artifacts selecting approved same-encounter variants", () => {
    const projectionArtifact = buildDynamicEncounterFactoryProjectionArtifact(
      variantScenarioBank,
      edChestPainScenario.scenarioId,
    );
    const report = buildEncounterAssetGenerationQueueReport({
      projectionArtifact,
    });

    expect(report.request.scenarioId).toBe(edChestPainScenarioV2.scenarioId);
    expect(report.encounterAssetNeedsReadinessManifest).toMatchObject({
      scenarioId: edChestPainScenarioV2.scenarioId,
      scenarioStatus: "approved",
      requiredHumanoids: expect.any(Array),
    });
      expect(report.projectionArtifactConsumption).toMatchObject({
        source: "scenario_bank_dynamic_encounter_factory_projection_artifact",
        sourceSchemaVersion: "openclinxr.dynamic-encounter-factory-projection-artifact.v1",
        anchorScenarioId: edChestPainScenario.scenarioId,
        nextFactoryPlanningScenarioId: edChestPainScenarioV2.scenarioId,
        nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant",
        scenarioBankSliceSize: 3,
        factorySelectionMetadata: {
          scenarioBankOrder: 2,
          factorySelectionRole: "next_factory_planning_scenario",
          factorySelectionMode: "approved_encounter_variant",
          factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
          metadataOnly: true,
          generationApprovalInferred: false,
        },
        sharedAssetReuseSummary: {
        scenarioBankSliceScenarioIds: [
          edChestPainScenario.scenarioId,
          edChestPainScenarioV2.scenarioId,
          edChestPainScenarioV3.scenarioId,
        ],
        scenarioBankSliceSize: 3,
        workOrderCount: expect.any(Number),
        sharedLibraryMongooseCollectionName: "shared_encounter_asset_library",
      },
    });
    expect(report.plan.generationWorkOrders[0]?.sharedAssetLibraryReuse).toMatchObject({
      cacheDisposition: "lookup_before_generate",
      sharedLibraryRefs: {
        blobPrefix: expect.stringContaining("blob://openclinxr-assets/shared-encounter-assets/"),
        mongooseCollectionName: "shared_encounter_asset_library",
      },
    });
    expect(report.plan.generationWorkOrders.find((workOrder) =>
      workOrder.targetKind === "role_specific_humanoid_glb" && workOrder.actorRole === "patient"
    )?.caseDefinedHumanoidPerformanceRequirements).toMatchObject({
      claimBoundary: "case_definition_humanoid_performance_metadata_only",
      actorRole: "patient",
      locomotionRequired: true,
      expressionRequired: true,
      gazeRequired: true,
      lipSyncRequired: false,
      interactiveRequired: true,
      dialogueDrivenVisemeMappingRequired: false,
      gazeTargetingRequired: true,
      locomotionPlanningRequired: true,
      notEvidenceFor: expect.arrayContaining([
        "generated_humanoid_asset_readiness",
        "animation_quality",
        "quest_readiness",
        "runtime_readiness",
        "clinical_validity",
      ]),
    });
    expect(report.plan.generationWorkOrders.find((workOrder) =>
      workOrder.targetKind === "role_idle_animation_glb" && workOrder.actorRole === "patient"
    )?.caseDefinedHumanoidPerformanceRequirements).toMatchObject({
      lipSyncRequired: false,
      gazeRequired: true,
      expressionRequired: true,
      interactiveRequired: true,
    });
    expect(report.humanoidRealismRequirements?.requirements.map((requirement) => requirement.actorRole)).toEqual([
      "patient",
      "family",
      "nurse",
    ]);
    expect(report.projectionArtifactConsumption?.scenarioBankSliceSize).toBe(projectionArtifact.scenarioBankSlice.length);
    expect(report.projectionArtifactConsumption?.sharedAssetReuseSummary).toMatchObject({
      scenarioBankSliceScenarioIds: [
        edChestPainScenario.scenarioId,
        edChestPainScenarioV2.scenarioId,
        edChestPainScenarioV3.scenarioId,
      ],
      scenarioBankSliceSize: 3,
      sharedLibraryMongooseCollectionName: "shared_encounter_asset_library",
    });
    expect(report.caseDefinedHumanoidPerformanceContract).toMatchObject({
      claimBoundary: "case_definition_humanoid_performance_metadata_only",
      actorCount: 3,
      locomotionActorRoles: ["family", "nurse", "patient"],
      expressionActorRoles: ["family", "nurse", "patient"],
      gazeActorRoles: ["family", "nurse", "patient"],
      lipSyncActorRoles: [],
      interactiveActorRoles: ["family", "nurse", "patient"],
      dialogueDrivenVisemeMappingRequired: false,
      gazeTargetingRequired: true,
      locomotionPlanningRequired: true,
      notEvidenceFor: [
        "generated_humanoid_asset_readiness",
        "animation_quality",
        "quest_readiness",
        "runtime_readiness",
        "clinical_validity",
      ],
    });
    expect(report.projectionArtifactConsumption?.caseDefinedHumanoidPerformanceContract).toEqual(
      report.caseDefinedHumanoidPerformanceContract,
    );
    expect(report.caseDefinedHumanoidPerformanceWorkOrderCoverage).toMatchObject({
      claimBoundary: "case_definition_humanoid_contract_to_work_order_coverage_metadata_only",
      scenarioId: edChestPainScenarioV2.scenarioId,
      actorRoles: ["family", "nurse", "patient"],
      missingActorRoles: [],
      notEvidenceFor: expect.arrayContaining([
        "generated_humanoid_asset_readiness",
        "animation_quality",
        "quest_readiness",
        "runtime_readiness",
        "clinical_validity",
      ]),
    });
    expect(report.caseDefinedHumanoidPerformanceWorkOrderCoverage?.actorRoleCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorRole: "patient",
        humanoidWorkOrderId: expect.stringContaining(":patient:role-specific-humanoid"),
        animationWorkOrderId: expect.stringContaining(":patient:role-animation"),
        requiredSignalIds: expect.arrayContaining([
          "dialogue_viseme_and_gaze_mapping",
          "dialogue_eye_micro_saccade_blink_cue",
          "generated_eyelid_blink_control_cue",
          "emotion_aligned_expression_transition_cue",
        ]),
      }),
      expect.objectContaining({
        actorRole: "family",
        humanoidWorkOrderId: expect.stringContaining(":family:role-specific-humanoid"),
        animationWorkOrderId: expect.stringContaining(":family:role-animation"),
      }),
      expect.objectContaining({
        actorRole: "nurse",
        humanoidWorkOrderId: expect.stringContaining(":nurse:role-specific-humanoid"),
        animationWorkOrderId: expect.stringContaining(":nurse:role-animation"),
      }),
    ]));
  });

  it("validates case-defined humanoid performance contracts in projection queue reports", () => {
    const projectionArtifact = buildDynamicEncounterFactoryProjectionArtifact(
      variantScenarioBank,
      edChestPainScenario.scenarioId,
    );
    const report = buildEncounterAssetGenerationQueueReport({ projectionArtifact });
    expect(validateEncounterAssetGenerationQueueReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report);
    invalid.caseDefinedHumanoidPerformanceContract!.claimBoundary = "runtime_ready" as never;
    invalid.caseDefinedHumanoidPerformanceContract!.actorCount = 0;
    invalid.caseDefinedHumanoidPerformanceContract!.notEvidenceFor = ["quest_readiness"] as never;
    invalid.projectionArtifactConsumption!.caseDefinedHumanoidPerformanceContract = undefined as never;
    invalid.caseDefinedHumanoidPerformanceWorkOrderCoverage!.missingActorRoles = ["patient"];
    invalid.caseDefinedHumanoidPerformanceWorkOrderCoverage!.actorRoleCoverage.pop();
    invalid.caseDefinedHumanoidPerformanceWorkOrderCoverage!.notEvidenceFor = ["quest_readiness"] as never;
    const invalidPatientWorkOrder = invalid.plan.generationWorkOrders.find((workOrder) =>
      workOrder.targetKind === "role_specific_humanoid_glb" && workOrder.actorRole === "patient"
    );
    if (invalidPatientWorkOrder) {
      invalidPatientWorkOrder.caseDefinedHumanoidPerformanceRequirements = {
        ...invalidPatientWorkOrder.caseDefinedHumanoidPerformanceRequirements!,
        claimBoundary: "runtime_ready" as never,
        gazeRequired: "yes" as never,
        expressionRequired: false,
        locomotionPlanningRequired: false,
        notEvidenceFor: ["quest_readiness"] as never,
      };
    }

    expect(validateEncounterAssetGenerationQueueReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/projectionArtifactConsumption/caseDefinedHumanoidPerformanceContract must be object",
        "/caseDefinedHumanoidPerformanceContract/claimBoundary must be \"case_definition_humanoid_performance_metadata_only\"",
        "/caseDefinedHumanoidPerformanceContract/actorCount must be positive number",
        "/caseDefinedHumanoidPerformanceContract/notEvidenceFor must include generated_humanoid_asset_readiness",
        "/caseDefinedHumanoidPerformanceContract/notEvidenceFor must include animation_quality",
        "/caseDefinedHumanoidPerformanceContract/notEvidenceFor must include runtime_readiness",
        "/caseDefinedHumanoidPerformanceWorkOrderCoverage/actorRoleCoverage length must match /caseDefinedHumanoidPerformanceWorkOrderCoverage/actorRoles length",
        "/caseDefinedHumanoidPerformanceWorkOrderCoverage/notEvidenceFor must include generated_humanoid_asset_readiness",
        "/caseDefinedHumanoidPerformanceWorkOrderCoverage/notEvidenceFor must include animation_quality",
        "/caseDefinedHumanoidPerformanceWorkOrderCoverage/notEvidenceFor must include runtime_readiness",
        "/plan/generationWorkOrders/0/caseDefinedHumanoidPerformanceRequirements/claimBoundary must be \"case_definition_humanoid_performance_metadata_only\"",
        "/plan/generationWorkOrders/0/caseDefinedHumanoidPerformanceRequirements/gazeRequired must be boolean",
        "/plan/generationWorkOrders/0/caseDefinedHumanoidPerformanceRequirements/expressionRequired must match /caseDefinedHumanoidPerformanceContract role membership",
        "/plan/generationWorkOrders/0/caseDefinedHumanoidPerformanceRequirements/locomotionPlanningRequired must match /caseDefinedHumanoidPerformanceContract/locomotionPlanningRequired",
        "/plan/generationWorkOrders/0/caseDefinedHumanoidPerformanceRequirements/notEvidenceFor must include generated_humanoid_asset_readiness",
        "/plan/generationWorkOrders/0/caseDefinedHumanoidPerformanceRequirements/notEvidenceFor must include animation_quality",
        "/plan/generationWorkOrders/0/caseDefinedHumanoidPerformanceRequirements/notEvidenceFor must include runtime_readiness",
      ]),
    });
  });

  it("validates generated queue reports", () => {
    const report = buildEncounterAssetGenerationQueueReport({
      generatedAt: "2026-05-23T12:00:00.000Z",
    });
    expect(validateEncounterAssetGenerationQueueReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as {
      evidenceBoundaries: { productionReadinessClaimed: boolean };
      operationalNotes: {
        mayRunForDays: boolean;
        providerDisabledBoundary: { claimBoundary: string; missingEvidenceIds: string[] };
        localOnlyBoundary: { missingEvidenceIds: string[] };
      };
      humanoidRealismRequirements: {
        requirements: Array<{
          actorRole: string;
          requiredSignalIds: string[];
          realismProfile: { requiredRealismEvidenceIds: string[] } | undefined;
        }>;
      };
      humanoidRealismProfiles: Array<{
        actorRole: string;
        requiredRealismEvidenceIds: string[];
      }>;
      plan: {
        generationWorkOrders: Array<{
          targetKind: string;
          modelProviderPolicy: { allowPaidCloudApis: boolean };
          sharedAssetLibraryReuse: { lruCache: { enabled: boolean } };
          providerRoutingPreference: string[];
          providerRoute: string;
        }>;
      };
    };
    invalid.evidenceBoundaries.productionReadinessClaimed = true;
    invalid.operationalNotes.mayRunForDays = false;
    invalid.humanoidRealismRequirements!.requirements[0]!.requiredSignalIds = ["animated_humanoid_runtime_playback"];
    invalid.humanoidRealismRequirements!.requirements[0]!.realismProfile!.requiredRealismEvidenceIds = ["dialogue_viseme_and_gaze_mapping"];
    invalid.humanoidRealismRequirements!.requirements[0]!.realismProfile = undefined as never;
    invalid.humanoidRealismRequirements!.requirements[1]!.actorRole = invalid.humanoidRealismRequirements!.requirements[0]!.actorRole;
    invalid.humanoidRealismProfiles[0]!.requiredRealismEvidenceIds = ["dialogue_viseme_and_gaze_mapping"];
    invalid.humanoidRealismProfiles[0]!.actorRole = "unmatched_actor";
    invalid.humanoidRealismProfiles.pop();
    invalid.plan.generationWorkOrders = invalid.plan.generationWorkOrders.filter((workOrder) => workOrder.targetKind !== "visual_feedback_closure");
    invalid.plan.generationWorkOrders[0]!.modelProviderPolicy.allowPaidCloudApis = true;
    invalid.plan.generationWorkOrders[0]!.sharedAssetLibraryReuse.lruCache.enabled = false;
    invalid.plan.generationWorkOrders[0]!.providerRoutingPreference = [];
    invalid.plan.generationWorkOrders[0]!.providerRoute = "cloud-approved-planned";
    invalid.operationalNotes.providerDisabledBoundary.claimBoundary = "metadata_only_claimed_as_live_provider_readiness";
    invalid.operationalNotes.providerDisabledBoundary.missingEvidenceIds = [];
    invalid.operationalNotes.localOnlyBoundary.missingEvidenceIds = ["azurite_or_queue_emulator_evidence_missing"];

    expect(validateEncounterAssetGenerationQueueReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/operationalNotes/mayRunForDays must be true",
        "/plan/generationWorkOrders/0/providerRoute must stay on the local-only provider boundary",
        "/plan/generationWorkOrders must include visual_feedback_closure",
        "/plan/generationWorkOrders/0/modelProviderPolicy/allowPaidCloudApis must be false",
        "/plan/generationWorkOrders/0/sharedAssetLibraryReuse/lruCache/enabled must be true",
        "/plan/generationWorkOrders/0/providerRoutingPreference must contain at least one provider route",
        "/operationalNotes/providerDisabledBoundary/claimBoundary must be \"provider_gate_metadata_not_live_provider_readiness\"",
        "/operationalNotes/providerDisabledBoundary/missingEvidenceIds must include provider_credentials_or_operator_approval_missing",
        "/operationalNotes/providerDisabledBoundary/missingEvidenceIds must include provider_runtime_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include local_blender_ffmpeg_toolchain_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include hunyuan3d_local_install_license_cache_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include shared_asset_library_lru_reuse_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include durable_job_checkpoint_evidence_missing",
        "/humanoidRealismRequirements/requirements/0/requiredSignalIds must include dialogue_viseme_and_gaze_mapping",
        "/humanoidRealismRequirements/requirements/0/requiredSignalIds must include dialogue_eye_micro_saccade_blink_cue",
        "/humanoidRealismRequirements/requirements/0/requiredSignalIds must include generated_eyelid_blink_control_cue",
        "/humanoidRealismRequirements/requirements/0/requiredSignalIds must include emotion_aligned_expression_transition_cue",
        "/humanoidRealismRequirements/requirements/0/realismProfile must be object",
        "/humanoidRealismRequirements/requirements/1/actorRole must be unique",
        "/humanoidRealismProfiles length must match /humanoidRealismRequirements/requirements length",
        "/humanoidRealismProfiles/0/actorRole must match a humanoid requirement actorRole",
        "/humanoidRealismProfiles/0/requiredRealismEvidenceIds must include dialogue_eye_micro_saccade_blink_cue",
        "/humanoidRealismProfiles/0/requiredRealismEvidenceIds must include generated_eyelid_blink_control_cue",
        "/humanoidRealismProfiles actorRole must match each humanoid requirement actorRole exactly once",
        "/evidenceBoundaries/productionReadinessClaimed must be false",
      ]),
    });
  });

  it("supports generating queue contracts from projection artifacts via CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-encounter-queue-artifact-"));
    const outputPath = path.join(tempDir, "encounter-asset-generation-queue.json");
    const projectionArtifactPath = path.join(tempDir, "encounter-projection-artifact.json");
    const projectionArtifact = buildDynamicEncounterFactoryProjectionArtifact(
      variantScenarioBank,
      edChestPainScenario.scenarioId,
    );

    await writeFile(projectionArtifactPath, `${JSON.stringify(projectionArtifact, null, 2)}\n`, "utf8");

    try {
      await runEncounterAssetGenerationQueueCli(["--projection-artifact", projectionArtifactPath, "--output", outputPath]);
      const report = JSON.parse(await readFile(outputPath, "utf8")) as {
        request: {
          scenarioId: string;
          encounterFactoryInputSummary?: {
            factorySelectionRole: string;
            factorySelectionClaimBoundary: string;
          };
        };
        projectionArtifactConsumption?: {
          nextFactoryPlanningScenarioSelectionMode: string;
          scenarioBankSliceSize: number;
          factorySelectionMetadata?: {
            factorySelectionRole: string;
            generationApprovalInferred: boolean;
          };
          sharedAssetReuseSummary?: {
            scenarioBankSliceScenarioIds: string[];
          };
        };
      };

      expect(report.request.scenarioId).toBe(edChestPainScenarioV2.scenarioId);
      expect(report.request.encounterFactoryInputSummary).toMatchObject({
        factorySelectionRole: "next_factory_planning_scenario",
        factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
      });
      expect(report.projectionArtifactConsumption?.nextFactoryPlanningScenarioSelectionMode).toBe("approved_encounter_variant");
      expect(report.projectionArtifactConsumption?.factorySelectionMetadata).toMatchObject({
        factorySelectionRole: "next_factory_planning_scenario",
        generationApprovalInferred: false,
      });
      expect(report.projectionArtifactConsumption?.scenarioBankSliceSize).toBe(3);
      expect(report.projectionArtifactConsumption?.sharedAssetReuseSummary?.scenarioBankSliceScenarioIds).toEqual([
        edChestPainScenario.scenarioId,
        edChestPainScenarioV2.scenarioId,
        edChestPainScenarioV3.scenarioId,
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates reports from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-encounter-queue-"));
    const outputPath = path.join(tempDir, "encounter-asset-generation-queue.json");
    const invalidPath = path.join(tempDir, "encounter-asset-generation-queue-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      await runEncounterAssetGenerationQueueCli(["--output", outputPath]);
      await expect(runEncounterAssetGenerationQueueCli(["--validate", outputPath])).resolves.toBeUndefined();

      const invalidReport = JSON.parse(await readFile(outputPath, "utf8"));
      invalidReport.evidenceBoundaries.paidApisUsed = true;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runEncounterAssetGenerationQueueCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
