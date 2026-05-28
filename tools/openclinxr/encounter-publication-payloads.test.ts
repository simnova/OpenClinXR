import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEncounterFactorySummaryContracts } from "../../packages/openclinxr/asset-registry/src/index.js";
import {
  buildDynamicEncounterFactoryProjectionArtifact,
  edChestPainScenario,
  edChestPainScenarioV2,
  edChestPainScenarioV3,
  pediatricAsthmaScenario,
  scenarioBank,
  variantScenarioBank,
} from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import { buildEncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import {
  buildEncounterPublicationPayloadReport,
  runEncounterPublicationPayloadsCli,
  summarizeEncounterFactoryDryRunPlan,
  validateEncounterPublicationPayloadReport,
} from "./encounter-publication-payloads.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";
import type { VisualQaRemediationWorkOrderRef } from "./visual-qa-evidence-check.js";

const notEvidenceFor: GeneratedEdStationRuntimeBundleReport["notEvidenceFor"] = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
];

const requireFixtureValue = <T>(value: T | null | undefined, label: string): T => {
  expect(value, label).toBeDefined();
  if (value == null) {
    throw new Error(`Missing required fixture value: ${label}`);
  }
  return value;
};

const actorHumanoidMaterializationContract: NonNullable<GeneratedEdStationRuntimeBundleReport["actorHumanoidMaterializationContract"]> = {
  schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
  scenarioId: "ed_chest_pain_priority_v1",
  source: "generated_station_runtime_bundle",
  actorSpecificVariantKeysRequired: true,
  sharedNeutralMeshReuseDetected: false,
  sharedNeutralMeshReuseActorIds: [],
  actorVariants: [
    {
      actorId: "patient_robert_hayes_v1",
      actorRole: "patient",
      modelAssetId: "patient",
      variantSemanticKey: "ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant",
      sourceBlobName: "patient.glb",
      humanoidVariantProfile: {
        ageBand: "adult",
        bodyScale: "adult_standard",
        clothingLayer: "patient_gown",
        hairFaceRequired: true,
        faceEyeLipRigRequired: true,
        idlePoseRequired: true,
        locomotionRequired: true,
      },
      requiredMaterializationCueIds: [
        "role_specific_body_scale_and_silhouette",
        "role_specific_clothing_layer",
        "hair_face_eye_lip_rig_presence",
        "idle_pose_and_locomotion_animation_set",
      ],
    },
    {
      actorId: "nurse_maria_alvarez_v1",
      actorRole: "nurse",
      modelAssetId: "nurse",
      variantSemanticKey: "ed_chest_pain_priority_v1:nurse_maria_alvarez_v1:nurse:anny_humanoid_variant",
      sourceBlobName: "nurse.glb",
      humanoidVariantProfile: {
        ageBand: "adult",
        bodyScale: "adult_standard",
        clothingLayer: "clinical_scrubs",
        hairFaceRequired: true,
        faceEyeLipRigRequired: true,
        idlePoseRequired: true,
        locomotionRequired: true,
      },
      requiredMaterializationCueIds: [
        "role_specific_body_scale_and_silhouette",
        "role_specific_clothing_layer",
        "hair_face_eye_lip_rig_presence",
        "idle_pose_and_locomotion_animation_set",
      ],
    },
    {
      actorId: "spouse_anna_hayes_v1",
      actorRole: "family",
      modelAssetId: "spouse",
      variantSemanticKey: "ed_chest_pain_priority_v1:spouse_anna_hayes_v1:family:anny_humanoid_variant",
      sourceBlobName: "spouse.glb",
      humanoidVariantProfile: {
        ageBand: "adult",
        bodyScale: "adult_standard",
        clothingLayer: "civilian_family",
        hairFaceRequired: true,
        faceEyeLipRigRequired: true,
        idlePoseRequired: true,
        locomotionRequired: true,
      },
      requiredMaterializationCueIds: [
        "role_specific_body_scale_and_silhouette",
        "role_specific_clothing_layer",
        "hair_face_eye_lip_rig_presence",
        "idle_pose_and_locomotion_animation_set",
      ],
    },
  ],
  recommendedNextAction: "materialize_actor_specific_humanoid_variants_before_runtime_readiness_claim",
  notEvidenceFor: [
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
    "animation_quality",
  ],
};

describe("encounter publication payloads", () => {
  it("materializes generated scene manifest and learner runtime bundle payloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-publication-payloads-"));
    try {
      const remediationWorkOrderRefs: VisualQaRemediationWorkOrderRef[] = [
        {
          schemaVersion: "openclinxr.visual-qa-remediation-work-order-ref.v1",
          scenarioId: "ed_chest_pain_priority_v1",
          sourceEvidenceRef: "visual-qa-evidence://ed_chest_pain_priority_v1/remediation-loop",
          blockerId: "mouth_talking_realism",
          targetKind: "role_idle_animation_glb",
          capabilityId: "animation-generation",
          workOrderRef: "encounter-generation-work-order://ed_chest_pain_priority_v1/role_idle_animation_glb/mouth_talking_realism",
          status: "planned_metadata_only",
          recommendedWorkerAction: "refresh the idle animation and mouth movement cues before operator review",
          notEvidenceFor: [
            "production_asset_readiness",
            "quest_readiness",
            "clinical_validity",
            "scoring_validity",
          ],
        },
      ];
      const queueReport = buildEncounterAssetGenerationQueueReport({
        generatedAt: "2026-05-23T12:00:00.000Z",
      });
      const report = await buildEncounterPublicationPayloadReport({
        queueReport,
        bundleReport: bundleReport(),
        generatedAt: "2026-05-23T12:30:00.000Z",
        artifactRoot: tempDir,
        remediationWorkOrderRefs,
      });

      expect(report).toMatchObject({
        schemaVersion: "openclinxr.encounter-publication-payloads.v1",
        status: "materialized",
        requestId: "encounter_assets_ed_chest_pain_executable_v1",
        publicationTargets: {
          generatedSceneManifestBlobName:
            "encounter-assets/local_tenant/ed_chest_pain_priority_v1/ed_chest_pain_encounter_v1/scene-manifest.v1.json",
          learnerRuntimeBundleBlobName:
            "encounter-assets/local_tenant/ed_chest_pain_priority_v1/ed_chest_pain_encounter_v1/learner-runtime-bundle.v1.json",
          learnerRuntimeBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
          learnerRuntimeBundleMongoCollection: "learner_runtime_asset_bundles",
          jobStateMongoCollection: "encounter_asset_generation_jobs",
        },
        payloadSummary: {
          sceneManifestId: "scene_manifest:ed_chest_pain_priority_v1:ed_chest_pain_station_v1",
          roomPropCount: 1,
          learnerBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
          actorCount: 3,
          humanoidRequirementActorCount: 3,
          humanoidRuntimeRequirementActorCount: 3,
          humanoidRealismProfileCount: 3,
          equipmentCount: 1,
          uiSurfaceCount: 0,
        },
        humanoidRealismRequirements: {
          schemaVersion: "openclinxr.encounter-humanoid-realism-requirements.v1",
          source: "scenario_actor_definitions",
        },
        encounterAssetNeedsReadinessManifest: {
          schemaVersion: "openclinxr.encounter-asset-needs-readiness.v1",
          scenarioId: "ed_chest_pain_priority_v1",
          scenarioStatus: "approved",
          blockers: expect.any(Array),
        },
        realismEvidenceRefs: {
          schemaVersion: "openclinxr.encounter-publication-realism-evidence-refs.v1",
          claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
          runtimeExecutionAllowed: false,
          providerExecutionPerformed: false,
          questReadinessClaimed: false,
          refs: expect.arrayContaining([
            expect.objectContaining({ refId: "humanoid-realism-gate", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached" }),
            expect.objectContaining({ refId: "runtime-realism-evidence-check", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached" }),
            expect.objectContaining({ refId: "visual-qa-evidence-check", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached" }),
          ]),
        },
        dynamicEncounterBehaviorCoverage: {
          schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1",
          claimBoundary: "metadata_only_not_runtime_behavior_evidence",
          dialogueTurnCoverage: {
            actorRolesWithDialogueTurns: ["patient", "nurse", "family"],
            missingActorRoles: [],
            dialogueTurnCount: 3,
          },
          gazeTargetCoverage: {
            actorRolesWithGazeTargets: ["patient", "nurse", "family"],
            actorRolesWithActorTargetSupport: ["patient", "nurse", "family"],
            missingActorRoles: [],
          },
          actorRolePlacementCoverage: {
            actorRolesWithPlacements: ["patient", "nurse", "family"],
            missingActorRoles: [],
          },
          affectTimelineCoverage: {
            actorRolesWithAffectTimelines: ["patient", "nurse", "family"],
            missingActorRoles: [],
            affectTimelineCount: 3,
            claimBoundary: "metadata_only_not_runtime_facial_animation_evidence",
          },
          blockerIds: [],
          warningIds: [],
        },
        encounterFactoryDryRunPlan: {
          schemaVersion: "openclinxr.encounter-factory-dry-run-plan.v1",
          planId: "encounter_assets_ed_chest_pain_executable_v1:dry-run-plan:v1",
          status: "review_plan_created_not_asset_generation",
          sourceRequestId: "encounter_assets_ed_chest_pain_executable_v1",
          sourceScenarioId: "ed_chest_pain_priority_v1",
          actorRoles: ["patient", "family", "nurse"],
          stageCount: 5,
          generationWorkOrders: expect.arrayContaining([
            expect.objectContaining({
              targetKind: "role_specific_humanoid_glb",
              capabilityId: "character-generation",
              actorRole: "patient",
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
                cacheDisposition: "lookup_before_generate",
                sharedLibraryRefs: {
                  blobPrefix: expect.stringContaining("blob://openclinxr-assets/shared-encounter-assets/"),
                  mongooseCollectionName: "shared_encounter_asset_library",
                },
                lruCache: expect.objectContaining({
                  enabled: true,
                  evictionPolicy: "least_recently_used",
                  reuseRequiresEvidenceGateCompatibility: true,
                  updateRecencyOnHit: true,
                }),
              }),
            }),
            expect.objectContaining({
              targetKind: "role_idle_animation_glb",
              capabilityId: "animation-generation",
              visualQaBlockerRefs: expect.arrayContaining(["eye_contact_logic", "mouth_talking_realism"]),
            }),
            expect.objectContaining({
              targetKind: "medical_equipment_glb",
              capabilityId: "medical-equipment-generation",
              providerRoutingPreference: [
                "hunyuan3d_local",
                "meshy_cloud_requires_approval",
                "tripo_cloud_requires_approval",
              ],
            }),
            expect.objectContaining({
              targetKind: "visual_feedback_closure",
              capabilityId: "asset-bake",
              acceptanceCriteria: expect.arrayContaining([
                "framework_can_apply_the_same_feedback_to_many_encounter_definitions",
              ]),
            }),
          ]),
          reviewPosture: {
            requiredReviewerRoles: ["asset_pipeline", "clinical_simulation", "xr_performance", "security_privacy"],
            nextAction: "review_factory_plan_before_generation_or_publication",
            claimBoundary: "encounter_factory_dry_run_not_asset_generation",
          },
          evidenceBoundaries: {
            metadataOnlyPlan: true,
            generatedAssetsMaterialized: false,
            runtimeBundlePublished: false,
            learnerRuntimeEnabled: false,
            questReadinessClaimed: false,
            productionReadinessClaimed: false,
          },
        },
        localMaterializationHandoffManifest: {
          schemaVersion: "openclinxr.worker-materialization-plan.v1",
          requestId: "encounter_assets_ed_chest_pain_executable_v1",
          scenarioId: "ed_chest_pain_priority_v1",
          rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v1/encounter_assets_ed_chest_pain_executable_v1",
          generatedAssetsMaterialized: false,
          paidApisUsed: false,
          productionReadinessClaimed: false,
          claimBoundary: "planned_metadata_only",
        },
        operationalNotes: {
          providerDisabledBoundary: {
            claimBoundary: "provider_gate_metadata_not_live_provider_readiness",
            missingEvidenceIds: [
              "provider_credentials_or_operator_approval_missing",
              "provider_runtime_evidence_missing",
            ],
          },
          localOnlyBoundary: {
            claimBoundary: "local_only_asset_pipeline_metadata_not_live_provider_readiness",
            missingEvidenceIds: [
              "local_blender_ffmpeg_toolchain_evidence_missing",
              "hunyuan3d_local_install_license_cache_evidence_missing",
              "shared_asset_library_lru_reuse_evidence_missing",
              "azurite_or_queue_emulator_evidence_missing",
              "durable_job_checkpoint_evidence_missing",
            ],
          },
        },
        evidenceBoundaries: {
          localPayloadsMaterialized: true,
          dynamicEncounterPayload: true,
          runtimeHardcodingRequired: false,
          azureCloudOperationPerformed: false,
          mongoWritePerformed: false,
          paidApisUsed: false,
          productionReadinessClaimed: false,
          questReadinessClaimed: false,
          clinicalValidityClaimed: false,
          scoringValidityClaimed: false,
        },
        blockers: [],
      });
      expect(report.humanoidRealismProfiles).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actorRole: "patient",
          claimScope: "metadata_only_not_visual_quality_evidence",
          requiredRealismEvidenceIds: expect.arrayContaining([
            "dialogue_viseme_and_gaze_mapping",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
          ]),
        }),
      ]));
      expect(report.localMaterializationHandoffManifest.outputs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          targetKind: "role_specific_humanoid_glb",
          artifactPath: expect.stringContaining("/role_specific_humanoid_glb/"),
          generatedAssetsMaterialized: false,
        }),
        expect.objectContaining({
          targetKind: "role_idle_animation_glb",
          artifactPath: expect.stringContaining("/role_idle_animation_glb/"),
          paidApisUsed: false,
        }),
        expect.objectContaining({
          targetKind: "medical_equipment_glb",
          artifactPath: expect.stringContaining("/medical_equipment_glb/"),
        }),
        expect.objectContaining({
          targetKind: "visual_feedback_closure",
          artifactPath: expect.stringContaining("/visual_feedback_closure/"),
        }),
      ]));
      expect(report.encounterFactoryDryRunPlan.stages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stageId: "generation_work_order_routing_plan",
          outputRefs: expect.arrayContaining([
            "role_specific_humanoid_glb",
            "role_idle_animation_glb",
            "medical_equipment_glb",
            "visual_feedback_closure",
            "role_readability",
            "mouth_talking_realism",
            "floating_geometry",
          ]),
          reviewGateIds: ["asset_pipeline", "adversarial_visual_qa_review", "model_provider_policy_review"],
          status: "planned_metadata_only",
        }),
        expect.objectContaining({
          stageId: "humanoid_roles_to_realism_profiles",
          outputRefs: expect.arrayContaining([
            "dialogue_viseme_and_gaze_mapping",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
            "emotion_aligned_expression_transition_cue",
          ]),
          reviewGateIds: ["humanoid_profile_review", "dialogue_viseme_gaze_review"],
          status: "planned_metadata_only",
        }),
        expect.objectContaining({
          stageId: "publication_and_evidence_gate_plan",
          outputRefs: expect.arrayContaining([
            "scene_manifest",
            "learner_runtime_asset_bundle",
            "runtime_realism_evidence",
            "emotion_aligned_expression_transition_cue",
            "visual_qa_evidence",
            "emotion_expression_transition_readability",
            "quest_runtime_evidence",
          ]),
          status: "planned_metadata_only",
        }),
      ]));
      expect(summarizeEncounterFactoryDryRunPlan(report)).toMatchObject({
        planId: "encounter_assets_ed_chest_pain_executable_v1:dry-run-plan:v1",
        status: "review_plan_created_not_asset_generation",
        sourceRequestId: "encounter_assets_ed_chest_pain_executable_v1",
        sourceScenarioId: "ed_chest_pain_priority_v1",
        actorRoles: ["patient", "family", "nurse"],
        stageIds: [
          "scenario_definition_to_asset_requirements",
          "generation_work_order_routing_plan",
          "humanoid_roles_to_realism_profiles",
          "runtime_bundle_binding_plan",
          "publication_and_evidence_gate_plan",
        ],
        reviewGateIds: expect.arrayContaining([
          "humanoid_profile_review",
          "dialogue_viseme_gaze_review",
          "adversarial_visual_qa_review",
          "model_provider_policy_review",
          "runtime_asset_review",
          "learner_runtime_boundary_review",
        ]),
        dynamicBehaviorCoverage: {
          schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1",
          claimBoundary: "metadata_only_not_runtime_behavior_evidence",
          dialogueTurnCoverage: {
            actorRolesWithDialogueTurns: ["patient", "nurse", "family"],
            missingActorRoles: [],
          },
          gazeTargetCoverage: {
            actorRolesWithGazeTargets: ["patient", "nurse", "family"],
            missingActorRoles: [],
          },
          actorRolePlacementCoverage: {
            actorRolesWithPlacements: ["patient", "nurse", "family"],
            missingActorRoles: [],
          },
          affectTimelineCoverage: {
            actorRolesWithAffectTimelines: ["patient", "nurse", "family"],
            missingActorRoles: [],
          },
          blockerIds: [],
          warningIds: [],
        },
        recommendedNextAction: "review_factory_plan_before_generation_or_publication",
        blockerIds: [],
        evidenceBoundaries: {
          metadataOnlyPlan: true,
          generatedAssetsMaterialized: false,
          runtimeBundlePublished: false,
          learnerRuntimeEnabled: false,
          questReadinessClaimed: false,
          productionReadinessClaimed: false,
        },
        claimBoundary: "encounter_factory_dry_run_not_asset_generation",
      });
      expect(report.humanoidRuntimeRequirements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actorId: "patient_robert_hayes_v1",
            actorRole: "patient",
            modelAssetId: "patient",
            gazeTargetRequired: true,
            visemeMapRequired: true,
            requiredAssetKinds: expect.arrayContaining(["generated_humanoid_mesh", "viseme_phoneme_map", "gaze_blink_control"]),
            requiredSignalIds: expect.arrayContaining([
              "dialogue_viseme_and_gaze_mapping",
              "dialogue_eye_micro_saccade_blink_cue",
              "generated_eyelid_blink_control_cue",
            ]),
            notEvidenceFor,
          }),
        ]),
      );
      expect(
        report.humanoidRuntimeRequirements.every((requirement) =>
          requirement.requiredSignalIds.includes("dialogue_eye_micro_saccade_blink_cue")
          && requirement.requiredSignalIds.includes("generated_eyelid_blink_control_cue")
        ),
      ).toBe(true);
      expect(report.remediationWorkOrderRefs).toEqual(remediationWorkOrderRefs);
      expect(report.encounterFactoryDryRunPlan.generationWorkOrders.map((workOrder) => ({
        workOrderId: workOrder.workOrderId,
        lookupKey: workOrder.sharedAssetLibraryReuse.lookupKey,
        cacheDisposition: workOrder.sharedAssetLibraryReuse.cacheDisposition,
        lruCache: workOrder.sharedAssetLibraryReuse.lruCache,
      }))).toEqual(queueReport.plan.generationWorkOrders.map((workOrder) => ({
        workOrderId: workOrder.workOrderId,
        lookupKey: workOrder.sharedAssetLibraryReuse.lookupKey,
        cacheDisposition: "lookup_before_generate",
        lruCache: workOrder.sharedAssetLibraryReuse.lruCache,
      })));
      await expect(readFile(report.localArtifacts.sceneManifestPath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        schemaVersion: "openclinxr.runtime-scene-manifest.v1",
      });
      await expect(readFile(report.localArtifacts.learnerRuntimeBundlePath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        identityScope: "learner_runtime_opaque_bundle",
      });
      await expect(readFile(report.localArtifacts.uiXrPublicLearnerRuntimeBundlePath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        identityScope: "learner_runtime_opaque_bundle",
      });
      expect(validateEncounterPublicationPayloadReport(report)).toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("materializes canonical factory-summary contracts for publication output", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-publication-contract-parity-"));
    try {
      const queueReport = buildEncounterAssetGenerationQueueReport({
        generatedAt: "2026-05-23T12:00:00.000Z",
      });
      const report = await buildEncounterPublicationPayloadReport({
        queueReport,
        bundleReport: bundleReport(),
        generatedAt: "2026-05-23T12:30:00.000Z",
        artifactRoot: tempDir,
      });
      const learnerBundle = (await readFile(report.localArtifacts.learnerRuntimeBundlePath, "utf8").then(JSON.parse)) as NonNullable<GeneratedEdStationRuntimeBundleReport["learnerBundle"]>;
      const encounterFactorySummary = summarizeEncounterFactoryDryRunPlan(report);
      const expectedContract = buildEncounterFactorySummaryContracts({
        requestId: report.requestId,
        scenarioId: report.scenarioId,
        learnerRuntimeBundle: learnerBundle,
        actorRoles: encounterFactorySummary.actorRoles,
        requiredActorRoles: encounterFactorySummary.actorRoles,
        reviewGateIds: encounterFactorySummary.reviewGateIds,
        stageIds: encounterFactorySummary.stageIds,
      });

      expect(encounterFactorySummary).toMatchObject(expectedContract.encounterFactoryDryRunSummary);
      expect(report.dynamicEncounterBehaviorCoverage).toEqual(expectedContract.dynamicBehaviorCoverage);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates projection-artifact-driven scenario selection into publication payloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-publication-projection-"));
    const queueReport = buildEncounterAssetGenerationQueueReport({
      projectionArtifact: buildDynamicEncounterFactoryProjectionArtifact(variantScenarioBank, edChestPainScenario.scenarioId),
    });
    const report = await buildEncounterPublicationPayloadReport({
      queueReport,
      bundleReport: bundleReportForScenario(edChestPainScenarioV2.scenarioId),
      generatedAt: "2026-05-23T12:30:00.000Z",
      artifactRoot: tempDir,
    });

    expect(report.scenarioId).toBe(edChestPainScenarioV2.scenarioId);
    expect(report.encounterFactoryDryRunPlan.sourceScenarioId).toBe(edChestPainScenarioV2.scenarioId);
    expect(report.projectionArtifactConsumption).toMatchObject({
      source: "scenario_bank_dynamic_encounter_factory_projection_artifact",
      anchorScenarioId: edChestPainScenario.scenarioId,
      nextFactoryPlanningScenarioId: edChestPainScenarioV2.scenarioId,
      nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant",
      scenarioBankSliceSize: 3,
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
    expect(report.encounterFactoryDryRunPlan.generationWorkOrders.map((workOrder) => workOrder.sharedAssetLibraryReuse.sharedLibraryRefs))
      .toEqual(
        queueReport.plan.generationWorkOrders.map((workOrder) => workOrder.sharedAssetLibraryReuse.sharedLibraryRefs),
      );
    expect(report.payloadSummary.actorCount).toBe(3);
    expect(queueReport.plan.generationWorkOrders).toEqual(
      expect.arrayContaining(report.encounterFactoryDryRunPlan.generationWorkOrders),
    );
    expect(validateEncounterPublicationPayloadReport(report)).toEqual({ ok: true });
  });

  it("reports blocked when generated bundle is not ready", async () => {
    const queueReport = buildEncounterAssetGenerationQueueReport({
      generatedAt: "2026-05-23T12:00:00.000Z",
    });
    if (queueReport.encounterAssetNeedsReadinessManifest) {
      queueReport.encounterAssetNeedsReadinessManifest.blockers = [
        ...queueReport.encounterAssetNeedsReadinessManifest.blockers,
        "missing_required_asset_need:unit_test_guard_blocker",
      ];
    }
    const report = await buildEncounterPublicationPayloadReport({
      queueReport,
      bundleReport: {
        ...bundleReport(),
        status: "blocked",
        learnerBundle: null,
        blockers: ["asset_blocked:patient"],
      },
      generatedAt: "2026-05-23T12:30:00.000Z",
      artifactRoot: ".openclinxr/test-publication",
    });

    expect(report.status).toBe("blocked");
    expect(report.blockers).toEqual(expect.arrayContaining([
      "asset_blocked:patient",
      "missing_required_asset_need:unit_test_guard_blocker",
    ]));
    expect(report.encounterAssetNeedsReadinessManifest?.blockers).toEqual(expect.arrayContaining(["missing_required_asset_need:unit_test_guard_blocker"]));
    expect(report.evidenceBoundaries.localPayloadsMaterialized).toBe(false);
    expect(report.dynamicEncounterBehaviorCoverage).toMatchObject({
      claimBoundary: "metadata_only_not_runtime_behavior_evidence",
      blockerIds: ["runtime_bundle_missing_for_behavior_coverage:ed_chest_pain_priority_v1"],
    });
    expect(report.encounterFactoryDryRunPlan).toMatchObject({
      status: "blocked_pending_runtime_bundle",
      reviewPosture: {
        nextAction: "resolve_bundle_blockers_before_factory_plan_review",
        claimBoundary: "encounter_factory_dry_run_not_asset_generation",
      },
      evidenceBoundaries: {
        metadataOnlyPlan: true,
        generatedAssetsMaterialized: false,
        runtimeBundlePublished: false,
        learnerRuntimeEnabled: false,
      },
    });
    expect(report.operationalNotes.providerDisabledBoundary.claimBoundary).toBe("provider_gate_metadata_not_live_provider_readiness");
    expect(validateEncounterPublicationPayloadReport(report)).toEqual({ ok: true });
  });

  it("blocks publication when the queue scenario and learner bundle scenario differ", async () => {
    const report = await buildEncounterPublicationPayloadReport({
      queueReport: buildEncounterAssetGenerationQueueReport({
        generatedAt: "2026-05-23T12:00:00.000Z",
      }),
      bundleReport: {
        ...bundleReport(),
        learnerBundle: {
          ...(bundleReport().learnerBundle as NonNullable<GeneratedEdStationRuntimeBundleReport["learnerBundle"]>),
          scenarioId: "peds_asthma_parent_anxiety_v1",
        },
      },
      generatedAt: "2026-05-23T12:30:00.000Z",
      artifactRoot: ".openclinxr/test-publication",
    });

    expect(report.status).toBe("blocked");
    expect(report.blockers).toEqual([
      "scenario_mismatch:queue=ed_chest_pain_priority_v1:bundle=peds_asthma_parent_anxiety_v1",
    ]);
    expect(report.evidenceBoundaries.localPayloadsMaterialized).toBe(false);
    expect(validateEncounterPublicationPayloadReport(report)).toEqual({ ok: true });
  });

  it("rejects publication reports with corrupted humanoid realism boundaries", async () => {
    const report = await buildEncounterPublicationPayloadReport({
      queueReport: buildEncounterAssetGenerationQueueReport({
        generatedAt: "2026-05-23T12:00:00.000Z",
      }),
      bundleReport: bundleReport(),
      generatedAt: "2026-05-23T12:30:00.000Z",
      artifactRoot: ".openclinxr/test-publication",
    });
    const invalid = structuredClone(report);
    invalid.humanoidRealismRequirements.notEvidenceFor = ["production_asset_readiness"];
    invalid.humanoidRealismRequirements.requirements[0].requiredSignalIds = [
      "animated_humanoid_runtime_playback",
    ];
    invalid.encounterAssetNeedsReadinessManifest = {
      ...(invalid.encounterAssetNeedsReadinessManifest ?? {}),
      schemaVersion: "wrong-version",
      blockers: "not-an-array",
    } as unknown as typeof invalid.encounterAssetNeedsReadinessManifest;
    invalid.payloadSummary.humanoidRuntimeRequirementActorCount = 99;
    invalid.payloadSummary.humanoidRealismProfileCount = 99;
    invalid.humanoidRealismProfiles[0].actorRole = "unmatched_actor";
    invalid.humanoidRealismProfiles[0].requiredRealismEvidenceIds = ["dialogue_viseme_and_gaze_mapping"];
    (invalid.humanoidRuntimeRequirements[0] as { gazeTargetRequired: boolean }).gazeTargetRequired = false;
    invalid.humanoidRuntimeRequirements[0].requiredSignalIds = ["dialogue_viseme_and_gaze_mapping"];
    (invalid.humanoidRuntimeRequirements[0] as { notEvidenceFor: string[] }).notEvidenceFor = ["production_asset_readiness"];
    invalid.realismEvidenceRefs.refs = invalid.realismEvidenceRefs.refs.filter((ref) => ref.refId !== "runtime-realism-evidence-check");
    invalid.realismEvidenceRefs.refs[0].notEvidenceFor = ["quest_readiness"];
    (invalid.realismEvidenceRefs as { runtimeExecutionAllowed: boolean }).runtimeExecutionAllowed = true;
    invalid.operationalNotes.providerDisabledBoundary.claimBoundary = "local_only_asset_pipeline_metadata_not_live_provider_readiness";
    invalid.operationalNotes.providerDisabledBoundary.missingEvidenceIds = [];
    invalid.operationalNotes.localOnlyBoundary.missingEvidenceIds = ["azurite_or_queue_emulator_evidence_missing"];
    (invalid.dynamicEncounterBehaviorCoverage as { claimBoundary: string }).claimBoundary = "runtime_behavior_evidence_claimed";
    (invalid.dynamicEncounterBehaviorCoverage as { dialogueTurnCoverage: unknown }).dialogueTurnCoverage = {
      actorRolesWithDialogueTurns: ["patient"],
      missingActorRoles: [],
      dialogueTurnCount: "zero",
    };
    invalid.dynamicEncounterBehaviorCoverage.gazeTargetCoverage = {
      actorRolesWithGazeTargets: ["patient"],
      actorRolesWithActorTargetSupport: ["unknown_actor"],
      missingActorRoles: ["nurse"],
    };
    invalid.dynamicEncounterBehaviorCoverage.actorRolePlacementCoverage = {
      actorRolesWithPlacements: ["patient"],
      missingActorRoles: ["nurse", "not_required"],
    };
    invalid.dynamicEncounterBehaviorCoverage.blockerIds = ["gaze_target_missing:nurse"];
    invalid.encounterFactoryDryRunPlan.stageCount = 99;
    invalid.encounterFactoryDryRunPlan.actorRoles = ["unmatched_actor", "nurse", "family"];
    invalid.encounterFactoryDryRunPlan.stages = invalid.encounterFactoryDryRunPlan.stages.filter((stage) =>
      stage.stageId !== "runtime_bundle_binding_plan"
    );
    (invalid.encounterFactoryDryRunPlan.evidenceBoundaries as { generatedAssetsMaterialized: boolean }).generatedAssetsMaterialized = true;
    (invalid.encounterFactoryDryRunPlan.generationWorkOrders[0].sharedAssetLibraryReuse as { cacheDisposition: string }).cacheDisposition = "generate_without_lookup";

    expect(validateEncounterPublicationPayloadReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/encounterAssetNeedsReadinessManifest/schemaVersion must be \"openclinxr.encounter-asset-needs-readiness.v1\"",
        "/encounterAssetNeedsReadinessManifest/blockers must be array",
        "/humanoidRealismRequirements/notEvidenceFor must include quest_readiness",
        "/humanoidRealismRequirements/notEvidenceFor must include clinical_validity",
        "/humanoidRealismRequirements/notEvidenceFor must include scoring_validity",
        "/humanoidRealismRequirements/requirements/0/requiredSignalIds must include dialogue_viseme_and_gaze_mapping",
        "/humanoidRealismRequirements/requirements/0/requiredSignalIds must include emotion_aligned_expression_transition_cue",
        "/payloadSummary/humanoidRuntimeRequirementActorCount must match /humanoidRuntimeRequirements length",
        "/payloadSummary/humanoidRealismProfileCount must match /humanoidRealismProfiles length",
        "/humanoidRealismProfiles/0/actorRole must match a humanoid realism requirement actorRole",
        "/humanoidRealismProfiles/0/requiredRealismEvidenceIds must include dialogue_eye_micro_saccade_blink_cue",
        "/humanoidRealismProfiles/0/requiredRealismEvidenceIds must include generated_eyelid_blink_control_cue",
        "/humanoidRealismProfiles/0/requiredRealismEvidenceIds must include emotion_aligned_expression_transition_cue",
        "/humanoidRuntimeRequirements/0/gazeTargetRequired must be true",
        "/humanoidRuntimeRequirements/0/requiredSignalIds must include dialogue_eye_micro_saccade_blink_cue",
        "/humanoidRuntimeRequirements/0/requiredSignalIds must include generated_eyelid_blink_control_cue",
        "/humanoidRuntimeRequirements/0/requiredSignalIds must include emotion_aligned_expression_transition_cue",
        "/humanoidRuntimeRequirements/0/notEvidenceFor must include quest_readiness",
        "/humanoidRuntimeRequirements/0/notEvidenceFor must include clinical_validity",
        "/humanoidRuntimeRequirements/0/notEvidenceFor must include scoring_validity",
        "/realismEvidenceRefs/runtimeExecutionAllowed must be false",
        "/realismEvidenceRefs/refs/0/notEvidenceFor must include production_asset_readiness",
        "/realismEvidenceRefs/refs/0/notEvidenceFor must include clinical_validity",
        "/realismEvidenceRefs/refs/0/notEvidenceFor must include scoring_validity",
        "/realismEvidenceRefs/refs must include runtime-realism-evidence-check when materialized humanoid runtime requirements exist",
        "/operationalNotes/providerDisabledBoundary/claimBoundary must be \"provider_gate_metadata_not_live_provider_readiness\"",
        "/operationalNotes/providerDisabledBoundary/missingEvidenceIds must include provider_credentials_or_operator_approval_missing",
        "/operationalNotes/providerDisabledBoundary/missingEvidenceIds must include provider_runtime_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include local_blender_ffmpeg_toolchain_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include hunyuan3d_local_install_license_cache_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include shared_asset_library_lru_reuse_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include durable_job_checkpoint_evidence_missing",
        "/dynamicEncounterBehaviorCoverage/claimBoundary must be \"metadata_only_not_runtime_behavior_evidence\"",
        "/dynamicEncounterBehaviorCoverage/dialogueTurnCoverage/dialogueTurnCount must be number",
        "/dynamicEncounterBehaviorCoverage/dialogueTurnCoverage must cover or mark missing actor role nurse",
        "/dynamicEncounterBehaviorCoverage/dialogueTurnCoverage must cover or mark missing actor role family",
        "/dynamicEncounterBehaviorCoverage/gazeTargetCoverage/actorRolesWithActorTargetSupport must only include required humanoid actor roles",
        "/dynamicEncounterBehaviorCoverage/gazeTargetCoverage must cover or mark missing actor role family",
        "/dynamicEncounterBehaviorCoverage/actorRolePlacementCoverage/missingActorRoles must only include required humanoid actor roles",
        "/dynamicEncounterBehaviorCoverage/actorRolePlacementCoverage must cover or mark missing actor role family",
        "/dynamicEncounterBehaviorCoverage/blockerIds must include actor_placement_missing:nurse",
        "/encounterFactoryDryRunPlan/evidenceBoundaries/generatedAssetsMaterialized must be false",
        "/encounterFactoryDryRunPlan/generationWorkOrders/0/sharedAssetLibraryReuse/cacheDisposition must be \"lookup_before_generate\"",
        "/encounterFactoryDryRunPlan/stageCount must match /encounterFactoryDryRunPlan/stages length",
        "/encounterFactoryDryRunPlan/stages must include runtime_bundle_binding_plan",
      ]),
    });
  });

  it("validates reports from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-publication-cli-"));
    const previousExitCode = process.exitCode;
    try {
      const outputPath = path.join(tempDir, "publication-report.json");
      await runEncounterPublicationPayloadsCli(["--output", outputPath]);
      await expect(runEncounterPublicationPayloadsCli(["--validate", outputPath])).resolves.toBeUndefined();
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("supports generating publication payloads from projection-artifact queue inputs via CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-publication-queue-projection-cli-"));
    const projectionArtifactPath = path.join(tempDir, "encounter-projection-artifact.json");
    const outputPath = path.join(tempDir, "encounter-publication-payload-report.json");
    const bundleReportPath = path.join(tempDir, "generated-ed-station-runtime-bundle-report.json");
    const projectionArtifact = buildDynamicEncounterFactoryProjectionArtifact(
      variantScenarioBank,
      edChestPainScenario.scenarioId,
    );
    const previousExitCode = process.exitCode;

    await writeFile(projectionArtifactPath, `${JSON.stringify(projectionArtifact, null, 2)}\n`, "utf8");
    await writeFile(
      bundleReportPath,
      `${JSON.stringify(bundleReportForScenario(edChestPainScenarioV2.scenarioId), null, 2)}\n`,
      "utf8",
    );

    try {
      await runEncounterPublicationPayloadsCli([
        "--projection-artifact",
        projectionArtifactPath,
        "--bundle-report",
        bundleReportPath,
        "--output",
        outputPath,
      ]);
      const report = JSON.parse(await readFile(outputPath, "utf8")) as {
        scenarioId: string;
        localArtifacts: {
          sceneManifestPath: string;
        };
        caseDefinedHumanoidRuntimeHandoff: Array<{
          actorRole: string;
          humanoidVariantProfile: {
            clothingLayer: string;
            faceEyeLipRigRequired: boolean;
            idlePoseRequired: boolean;
          };
          lipSyncRequired: boolean;
          requiredSignalIds: string[];
          blockers: string[];
          claimBoundary: string;
          notEvidenceFor: string[];
        }>;
        projectionArtifactConsumption?: {
          nextFactoryPlanningScenarioSelectionMode: string;
          sharedAssetReuseSummary?: {
            scenarioBankSliceScenarioIds: string[];
          };
        };
      };

      expect(report.scenarioId).toBe(edChestPainScenarioV2.scenarioId);
      expect(report.projectionArtifactConsumption?.nextFactoryPlanningScenarioSelectionMode).toBe("approved_encounter_variant");
      expect(report.projectionArtifactConsumption?.sharedAssetReuseSummary?.scenarioBankSliceScenarioIds).toEqual([
        edChestPainScenario.scenarioId,
        edChestPainScenarioV2.scenarioId,
        edChestPainScenarioV3.scenarioId,
      ]);
      expect(report.caseDefinedHumanoidRuntimeHandoff).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actorRole: "patient",
          humanoidVariantProfile: expect.objectContaining({
            clothingLayer: "patient_gown",
            faceEyeLipRigRequired: true,
            idlePoseRequired: true,
          }),
          lipSyncRequired: false,
          requiredSignalIds: expect.arrayContaining([
            "animated_humanoid_runtime_playback",
            "dialogue_eye_micro_saccade_blink_cue",
            "generated_eyelid_blink_control_cue",
            "emotion_aligned_expression_transition_cue",
          ]),
          blockers: [
            "runtime_realism_evidence_not_attached_to_encounter_bundle",
            "visual_qa_evidence_not_attached_to_encounter_bundle",
          ],
          claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
          notEvidenceFor: [
            "generated_humanoid_asset_readiness",
            "animation_quality",
            "quest_readiness",
            "runtime_readiness",
            "clinical_validity",
            "scoring_validity",
          ],
        }),
      ]));
      const sceneManifest = JSON.parse(await readFile(report.localArtifacts.sceneManifestPath, "utf8")) as {
        caseDefinedHumanoidRuntimeHandoff?: unknown[];
      };
      expect(sceneManifest.caseDefinedHumanoidRuntimeHandoff).toEqual(report.caseDefinedHumanoidRuntimeHandoff);
      expect(validateEncounterPublicationPayloadReport(report)).toEqual({ ok: true });
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("carries case-defined humanoid runtime handoff for the pediatric asthma factory-planning scenario", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-publication-peds-handoff-"));
    const projectionArtifactPath = path.join(tempDir, "encounter-projection-artifact.json");
    const outputPath = path.join(tempDir, "encounter-publication-payload-report.json");
    const bundleReportPath = path.join(tempDir, "generated-peds-station-runtime-bundle-report.json");
    const projectionArtifact = buildDynamicEncounterFactoryProjectionArtifact(
      scenarioBank,
      edChestPainScenario.scenarioId,
    );
    const previousExitCode = process.exitCode;

    await writeFile(projectionArtifactPath, `${JSON.stringify(projectionArtifact, null, 2)}\n`, "utf8");
    await writeFile(
      bundleReportPath,
      `${JSON.stringify(bundleReportForScenario(pediatricAsthmaScenario.scenarioId), null, 2)}\n`,
      "utf8",
    );

    try {
      await runEncounterPublicationPayloadsCli([
        "--projection-artifact",
        projectionArtifactPath,
        "--bundle-report",
        bundleReportPath,
        "--output",
        outputPath,
      ]);
      const report = JSON.parse(await readFile(outputPath, "utf8")) as {
        scenarioId: string;
        localArtifacts: {
          sceneManifestPath: string;
        };
        caseDefinedHumanoidRuntimeHandoff: Array<{
          actorRole: string;
          humanoidVariantProfile?: {
            faceEyeLipRigRequired?: boolean;
            idlePoseRequired?: boolean;
          };
          requiredSignalIds: string[];
          blockers: string[];
          claimBoundary: string;
          notEvidenceFor: string[];
        }>;
        caseDefinitionDrivenFactoryCoverage: {
          scenarioId: string;
          source: string;
          scenarioStatus: string | null;
          requiredActorRoles: string[];
          learnerBundleActorRoles: string[];
          requiredTraceTags: string[];
          learnerBundleTraceTags: string[];
          requiredEquipmentAssetNeedIds: string[];
          learnerBundleEquipmentIds: string[];
          coverage: {
            actorRolesCovered: boolean;
            traceTagsCovered: boolean;
            equipmentPlacementsPresent: boolean;
            assetNeedsCarriedByWorkOrders: boolean;
          };
          blockers: string[];
          notEvidenceFor: string[];
        };
        projectionArtifactConsumption?: {
          nextFactoryPlanningScenarioSelectionMode: string;
          nextFactoryPlanningScenarioId: string;
        };
      };

      expect(report.scenarioId).toBe(pediatricAsthmaScenario.scenarioId);
      expect(report.projectionArtifactConsumption).toMatchObject({
        nextFactoryPlanningScenarioSelectionMode: "next_scenario_fallback",
        nextFactoryPlanningScenarioId: pediatricAsthmaScenario.scenarioId,
      });
      expect(report.caseDefinedHumanoidRuntimeHandoff.map((handoff) => handoff.actorRole).sort()).toEqual([
        "family",
        "nurse",
        "patient",
      ]);
      expect(report.caseDefinedHumanoidRuntimeHandoff.every((handoff) =>
        handoff.claimBoundary === "case_definition_humanoid_runtime_handoff_metadata_only"
        && handoff.humanoidVariantProfile?.faceEyeLipRigRequired === true
        && handoff.humanoidVariantProfile?.idlePoseRequired === true
        && handoff.requiredSignalIds.includes("animated_humanoid_runtime_playback")
        && handoff.requiredSignalIds.includes("dialogue_eye_micro_saccade_blink_cue")
        && handoff.requiredSignalIds.includes("generated_eyelid_blink_control_cue")
        && handoff.blockers.includes("runtime_realism_evidence_not_attached_to_encounter_bundle")
        && handoff.blockers.includes("visual_qa_evidence_not_attached_to_encounter_bundle")
        && handoff.notEvidenceFor.includes("generated_humanoid_asset_readiness")
        && handoff.notEvidenceFor.includes("runtime_readiness")
        && handoff.notEvidenceFor.includes("quest_readiness")
        && handoff.notEvidenceFor.includes("scoring_validity")
      )).toBe(true);
      expect(report.caseDefinitionDrivenFactoryCoverage).toMatchObject({
        scenarioId: pediatricAsthmaScenario.scenarioId,
        source: "scenario_definition_and_dialogue_seed_bank",
        scenarioStatus: "draft",
        requiredActorRoles: ["patient", "family", "nurse"],
        learnerBundleActorRoles: ["patient", "family", "nurse"],
        coverage: {
          actorRolesCovered: true,
          traceTagsCovered: true,
          equipmentPlacementsPresent: true,
          assetNeedsCarriedByWorkOrders: true,
        },
        blockers: [],
        notEvidenceFor,
      });
      expect(report.caseDefinitionDrivenFactoryCoverage.requiredTraceTags).toEqual(
        expect.arrayContaining(pediatricAsthmaScenario.requiredTraceTags),
      );
      expect(report.caseDefinitionDrivenFactoryCoverage.learnerBundleTraceTags).toEqual(
        expect.arrayContaining(pediatricAsthmaScenario.requiredTraceTags),
      );
      expect(report.caseDefinitionDrivenFactoryCoverage.requiredEquipmentAssetNeedIds).toEqual(expect.arrayContaining([
        "pulse_oximeter_equipment",
        "nebulizer_mask_equipment",
        "oxygen_wall_port_equipment",
        "pediatric_stretcher_equipment",
        "parent_chair_equipment",
        "inhaler_spacer_equipment",
      ]));
      expect(report.caseDefinitionDrivenFactoryCoverage.learnerBundleEquipmentIds).toEqual(expect.arrayContaining([
        "pulse_oximeter_equipment",
        "nebulizer_mask_equipment",
        "oxygen_wall_port_equipment",
        "pediatric_stretcher_equipment",
        "parent_chair_equipment",
        "inhaler_spacer_equipment",
      ]));
      const sceneManifest = JSON.parse(await readFile(report.localArtifacts.sceneManifestPath, "utf8")) as {
        stationContext?: {
          title?: string;
          chiefConcern?: string;
        };
        dialogueTurns?: Array<{ traceTag?: string }>;
        equipmentPlacements?: Record<string, unknown>;
        caseDefinedHumanoidRuntimeHandoff?: unknown[];
      };
      expect(sceneManifest.stationContext).toMatchObject({
        title: "Pediatric Asthma",
        chiefConcern: "Wheezing and increased work of breathing",
      });
      expect(sceneManifest.dialogueTurns?.map((turn) => turn.traceTag)).toEqual(
        expect.arrayContaining(pediatricAsthmaScenario.requiredTraceTags),
      );
      expect(Object.keys(sceneManifest.equipmentPlacements ?? {})).toEqual(expect.arrayContaining([
        "pulse_oximeter_equipment",
        "nebulizer_mask_equipment",
        "oxygen_wall_port_equipment",
      ]));
      expect(sceneManifest.caseDefinedHumanoidRuntimeHandoff).toEqual(report.caseDefinedHumanoidRuntimeHandoff);
      expect(validateEncounterPublicationPayloadReport(report)).toEqual({ ok: true });
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("summarizes dry-run plans from the CLI without materializing assets", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-publication-summary-"));
    const previousLog = console.log;
    const logs: string[] = [];
    try {
      console.log = (message?: unknown) => {
        logs.push(String(message ?? ""));
      };
      const report = await buildEncounterPublicationPayloadReport({
        queueReport: buildEncounterAssetGenerationQueueReport({
          generatedAt: "2026-05-23T12:00:00.000Z",
        }),
        bundleReport: bundleReport(),
        generatedAt: "2026-05-23T12:30:00.000Z",
        artifactRoot: tempDir,
      });
      const reportPath = path.join(tempDir, "publication-report.json");
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      await runEncounterPublicationPayloadsCli(["--summarize-dry-run-plan", reportPath]);

      const summary = JSON.parse(logs.at(-1) ?? "{}") as ReturnType<typeof summarizeEncounterFactoryDryRunPlan>;
      expect(summary).toMatchObject({
        planId: "encounter_assets_ed_chest_pain_executable_v1:dry-run-plan:v1",
        status: "review_plan_created_not_asset_generation",
        recommendedNextAction: "review_factory_plan_before_generation_or_publication",
        claimBoundary: "encounter_factory_dry_run_not_asset_generation",
        dynamicBehaviorCoverage: {
          dialogueTurnCoverage: {
            actorRolesWithDialogueTurns: ["patient", "nurse", "family"],
          },
          gazeTargetCoverage: {
            actorRolesWithGazeTargets: ["patient", "nurse", "family"],
          },
          actorRolePlacementCoverage: {
            actorRolesWithPlacements: ["patient", "nurse", "family"],
          },
          affectTimelineCoverage: {
            actorRolesWithAffectTimelines: ["patient", "nurse", "family"],
          },
          blockerIds: [],
        },
        evidenceBoundaries: {
          generatedAssetsMaterialized: false,
          runtimeBundlePublished: false,
          learnerRuntimeEnabled: false,
          questReadinessClaimed: false,
          productionReadinessClaimed: false,
        },
      });
    } finally {
      console.log = previousLog;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("exposes root package scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:encounter-publication:materialize"]).toBe(
      "tsx tools/openclinxr/encounter-publication-payloads.ts",
    );
    expect(rootPackage.scripts["asset:encounter-publication:validate"]).toBe(
      "tsx tools/openclinxr/encounter-publication-payloads.ts --validate-latest",
    );
    expect(rootPackage.scripts["asset:encounter-publication:summarize-dry-run"]).toBe(
      "tsx tools/openclinxr/encounter-publication-payloads.ts --summarize-dry-run-plan",
    );
  });
});

function bundleReport(): GeneratedEdStationRuntimeBundleReport {
  const sceneManifest: NonNullable<GeneratedEdStationRuntimeBundleReport["learnerBundle"]>["sceneManifest"] = {
    schemaVersion: "openclinxr.runtime-scene-manifest.v1",
    manifestId: "scene_manifest:ed_chest_pain_priority_v1:ed_chest_pain_station_v1",
    source: "generated_scene_pipeline",
    scenarioId: "ed_chest_pain_priority_v1",
    stationId: "ed_chest_pain_station_v1",
    stationContext: {
      title: "ED Chest Pain",
      subtitle: "Patient, spouse, and nurse in a time-boxed emergency department encounter.",
      chiefConcern: "Crushing substernal chest pressure",
      initialVitals: "BP 152/92, HR 104, RR 20, SpO2 96%",
      interruption: "Nurse repeats vitals at minute seven",
      stageAriaLabel: "Emergency department station scene",
      canvasAriaLabel: "3D emergency department bay preview",
      initialDialogueText: "Robert Hayes: It feels heavy, like someone is sitting on my chest.",
    },
    roomProps: [
      {
        propId: "monitor",
        label: "Monitor",
        semanticRole: "objective_cue",
        evidenceCue: "Vitals monitor anchors the ED chest pain assessment.",
        colorHex: "#111827",
        accentColorHex: "#f59e0b",
        position: { x: 1, y: 1, z: 1 },
        scale: { x: 1, y: 1, z: 1 },
        affordanceCueIds: ["vitals_monitor"],
        interactionTags: ["monitor"],
        generatedBy: "scene_manifest",
      },
    ],
    dialogueTurns: [
      {
        traceTag: "opening_patient_chest_pain",
        actorId: "patient_robert_hayes_v1",
        text: "My chest is tight and it started about twenty minutes ago.",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        affectTimeline: affectTimeline("pain", 0.82),
      },
      {
        traceTag: "nurse_interruption_ecg",
        actorId: "nurse_maria_alvarez_v1",
        text: "Doctor, the ECG is ready and his blood pressure is drifting down.",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        affectTimeline: affectTimeline("concerned", 0.58),
      },
      {
        traceTag: "spouse_anxiety_context",
        actorId: "spouse_anna_hayes_v1",
        text: "He never complains like this. Is he going to be okay?",
        gazeTargetKind: "learner_camera",
        gazeTargetActorId: null,
        affectTimeline: affectTimeline("anxious", 0.68),
      },
    ],
    actorPlacements: {
      patient_robert_hayes_v1: {
        slotKind: "primary_patient",
        position: { x: 0, y: 0, z: -1.2 },
        scale: { x: 1, y: 1, z: 1 },
        verticalOffsetMeters: 0,
        labelPrefix: "Patient",
      },
      nurse_maria_alvarez_v1: {
        slotKind: "clinical_team",
        position: { x: -1.2, y: 0, z: -0.8 },
        scale: { x: 1, y: 1, z: 1 },
        verticalOffsetMeters: 0,
        labelPrefix: "Nurse",
      },
      spouse_anna_hayes_v1: {
        slotKind: "family_or_observer",
        position: { x: 1.2, y: 0, z: -0.8 },
        scale: { x: 1, y: 1, z: 1 },
        verticalOffsetMeters: 0,
        labelPrefix: "Family",
      },
    },
    equipmentPlacements: {},
    productionReadinessClaimed: false,
    notEvidenceFor,
  };
  const learnerBundle: NonNullable<GeneratedEdStationRuntimeBundleReport["learnerBundle"]> = {
    bundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
    stationId: "ed_chest_pain_station_v1",
    scenarioId: "ed_chest_pain_priority_v1",
    assetStoreKind: "azurite_blob",
    environment: {
      assetId: "ed_environment",
      version: "v1",
      kind: "environment_model",
      displayName: "ED",
      scenarioAssetId: "ed",
      blob: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobName: "ed.glb", url: "http://127.0.0.1/ed.glb" },
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["fixture"],
      notEvidenceFor,
    },
    actors: [
      {
        actorId: "patient_robert_hayes_v1",
        embodiment: "humanoid",
        role: "patient",
        model: {
          assetId: "patient",
          version: "v1",
          kind: "humanoid_model",
          displayName: "Patient",
          scenarioAssetId: "patient",
          blob: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobName: "patient.glb", url: "http://127.0.0.1/patient.glb" },
          reviewStatus: "approved_for_local_runtime",
          provenanceRefs: ["fixture"],
          notEvidenceFor,
        },
        animationClips: [],
        gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: true },
      },
      {
        actorId: "nurse_maria_alvarez_v1",
        embodiment: "humanoid",
        role: "nurse",
        model: {
          assetId: "nurse",
          version: "v1",
          kind: "humanoid_model",
          displayName: "Nurse",
          scenarioAssetId: "nurse",
          blob: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobName: "nurse.glb", url: "http://127.0.0.1/nurse.glb" },
          reviewStatus: "approved_for_local_runtime",
          provenanceRefs: ["fixture"],
          notEvidenceFor,
        },
        animationClips: [],
        gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: true },
      },
      {
        actorId: "spouse_anna_hayes_v1",
        embodiment: "humanoid",
        role: "family",
        model: {
          assetId: "spouse",
          version: "v1",
          kind: "humanoid_model",
          displayName: "Family Member",
          scenarioAssetId: "spouse",
          blob: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobName: "spouse.glb", url: "http://127.0.0.1/spouse.glb" },
          reviewStatus: "approved_for_local_runtime",
          provenanceRefs: ["fixture"],
          notEvidenceFor,
        },
        animationClips: [],
        gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: true },
      },
    ],
    equipment: [
      {
        equipmentId: "ecg_cart_equipment",
        model: {
          assetId: "ecg",
          version: "v1",
          kind: "equipment_model",
          displayName: "ECG",
          scenarioAssetId: "ecg",
          blob: { storeKind: "azurite_blob", containerName: "openclinxr-assets", blobName: "ecg.glb", url: "http://127.0.0.1/ecg.glb" },
          reviewStatus: "approved_for_local_runtime",
          provenanceRefs: ["fixture"],
          notEvidenceFor,
        },
      },
    ],
    uiSurfaces: [],
    sceneManifest,
    generatedAt: "2026-05-23T12:00:00.000Z",
    expiresAt: null,
    frozenForEncounter: true,
    evidenceGateRefs: [],
    assemblyAuditMetadata: {
      schemaVersion: "openclinxr.runtime-bundle-assembly-audit.v1",
      claimBoundary: "asset_reference_audit_metadata_not_materialized_assets",
      sourceDefinitionRefs: ["test_fixture:encounter-publication-payloads"],
      workOrderRefs: [],
      factoryRequestRefs: [],
      generatedAssetRefs: [],
      humanoidMetadataRefs: [],
      remediationPlanRefs: [],
      evidenceGateIds: [],
      fallbackPosture: {
        usesLocalFixtureFallbackAssets: true,
        fallbackAssetIds: ["patient", "nurse", "spouse", "ecg"],
        learnerUseBlockedUntilEvidenceGatesAttach: true,
      },
      notEvidenceFor,
    },
    notEvidenceFor,
    identityScope: "learner_runtime_opaque_bundle",
  };
  return {
    schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
    generatedAt: "2026-05-23T12:00:00.000Z",
    status: "bundle_ready",
    bundle: null,
    learnerBundle,
    actorHumanoidMaterializationContract,
    bundleBlobName: null,
    runtimeAssetReviewDecisions: [],
    blockers: [],
    productionCloudCall: false,
    notEvidenceFor,
  };
}

function bundleReportForScenario(scenarioId: string): GeneratedEdStationRuntimeBundleReport {
  const report = bundleReport();
  const learnerBundle = report.learnerBundle;
  if (!learnerBundle) {
    throw new Error("typed test fixture expected learner bundle");
  }
  if (scenarioId === pediatricAsthmaScenario.scenarioId) {
    const patientActor = requireFixtureValue(learnerBundle.actors[0], "pediatric source patient actor");
    const familyActor = requireFixtureValue(learnerBundle.actors[2], "pediatric source family actor");
    const nurseActor = requireFixtureValue(learnerBundle.actors[1], "pediatric source nurse actor");
    const equipmentTemplate = requireFixtureValue(learnerBundle.equipment[0], "pediatric equipment template");
    return {
      ...report,
      learnerBundle: {
        ...learnerBundle,
        scenarioId,
        stationId: "pediatric_urgent_care_station_v1",
        bundleId: "peds_asthma_parent_anxiety_v1:learner-runtime-bundle:v1",
        environment: {
          ...learnerBundle.environment,
          assetId: "pediatric_urgent_care_bay_environment",
          displayName: "Pediatric Urgent Care Bay",
          scenarioAssetId: "pediatric_urgent_care_bay_environment",
          blob: {
            ...learnerBundle.environment.blob,
            blobName: "pediatric_urgent_care_bay_environment.glb",
            url: "http://127.0.0.1/pediatric_urgent_care_bay_environment.glb",
          },
        },
        actors: [
          {
            ...patientActor,
            actorId: "patient_maya_johnson_v1",
            role: "patient",
            model: {
              ...patientActor.model,
              assetId: "patient_maya_johnson_character",
              displayName: "Maya Johnson",
              scenarioAssetId: "patient_maya_johnson_character",
            },
          },
          {
            ...familyActor,
            actorId: "parent_tara_johnson_v1",
            role: "family",
            model: {
              ...familyActor.model,
              assetId: "parent_tara_johnson_character",
              displayName: "Tara Johnson",
              scenarioAssetId: "parent_tara_johnson_character",
            },
          },
          {
            ...nurseActor,
            actorId: "nurse_kevin_lee_v1",
            role: "nurse",
            model: {
              ...nurseActor.model,
              assetId: "nurse_kevin_lee_character",
              displayName: "Kevin Lee",
              scenarioAssetId: "nurse_kevin_lee_character",
            },
          },
        ],
        equipment: [
          "pulse_oximeter_equipment",
          "nebulizer_mask_equipment",
          "oxygen_wall_port_equipment",
          "pediatric_stretcher_equipment",
          "parent_chair_equipment",
          "inhaler_spacer_equipment",
        ].map((equipmentId) => ({
          equipmentId,
          model: {
            ...equipmentTemplate.model,
            assetId: equipmentId,
            displayName: equipmentId.replace(/_/g, " "),
            scenarioAssetId: equipmentId,
            blob: {
              ...equipmentTemplate.model.blob,
              blobName: `${equipmentId}.glb`,
              url: `http://127.0.0.1/${equipmentId}.glb`,
            },
          },
        })),
        sceneManifest: {
          ...learnerBundle.sceneManifest,
          scenarioId,
          stationId: "pediatric_urgent_care_station_v1",
          manifestId: `scene_manifest:${scenarioId}:pediatric_urgent_care_station_v1`,
          stationContext: {
            title: "Pediatric Asthma",
            subtitle: "Child, parent, and nurse in a pediatric urgent-care respiratory distress encounter.",
            chiefConcern: "Wheezing and increased work of breathing",
            initialVitals: "HR 128, RR 32, SpO2 91% on room air",
            interruption: "Parent interrupts if breathing distress is not acknowledged",
            stageAriaLabel: "Pediatric urgent-care station scene",
            canvasAriaLabel: "3D pediatric urgent-care bay preview",
            initialDialogueText: "Maya Johnson: It is hard to breathe.",
          },
          dialogueTurns: [
            { traceTag: "work_of_breathing_assessment", actorId: "patient_maya_johnson_v1", text: "Maya Johnson: It is hard to breathe and my chest feels tight.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("anxious", 0.78) },
            { traceTag: "inhaler_history", actorId: "parent_tara_johnson_v1", text: "Tara Johnson: Her rescue inhaler ran out yesterday.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("anxious", 0.7) },
            { traceTag: "trigger_history", actorId: "parent_tara_johnson_v1", text: "Tara Johnson: We visited family with cats before this got worse.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("concerned", 0.64) },
            { traceTag: "oxygen_request", actorId: "nurse_kevin_lee_v1", text: "Kevin Lee: Oxygen is started and her saturation is being watched closely.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("concerned", 0.56) },
            { traceTag: "bronchodilator_plan", actorId: "nurse_kevin_lee_v1", text: "Kevin Lee: Nebulized bronchodilator treatment is ready.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("reassured", 0.36) },
            { traceTag: "urgent_escalation", actorId: "nurse_kevin_lee_v1", text: "Kevin Lee: I will call for urgent pediatric support if her work of breathing worsens.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("concerned", 0.6) },
            { traceTag: "parent_communication", actorId: "parent_tara_johnson_v1", text: "Tara Johnson: Please tell me exactly what I can do to help her.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("anxious", 0.66) },
            { traceTag: "empathy_statement", actorId: "patient_maya_johnson_v1", text: "Maya Johnson: I feel a little better when you explain it slowly.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("reassured", 0.32) },
            { traceTag: "patient_note_submitted", actorId: "nurse_kevin_lee_v1", text: "System: Pediatric asthma note saved for faculty review.", gazeTargetKind: "learner_camera", gazeTargetActorId: null, affectTimeline: affectTimeline("neutral", 0.2) },
          ],
          actorPlacements: {
            patient_maya_johnson_v1: { slotKind: "primary_patient", position: { x: -0.12, y: 0.9, z: -1.05 }, scale: { x: 0.82, y: 0.82, z: 0.82 }, verticalOffsetMeters: -0.72, labelPrefix: "Patient" },
            parent_tara_johnson_v1: { slotKind: "family_or_observer", position: { x: -1.35, y: 0.95, z: -0.62 }, scale: { x: 0.96, y: 0.96, z: 0.96 }, verticalOffsetMeters: -0.92, labelPrefix: "Parent" },
            nurse_kevin_lee_v1: { slotKind: "clinical_team", position: { x: 1.25, y: 0.95, z: -0.72 }, scale: { x: 0.98, y: 0.98, z: 0.98 }, verticalOffsetMeters: -0.94, labelPrefix: "Nurse" },
          },
          equipmentPlacements: {
            pulse_oximeter_equipment: { position: { x: 0.55, y: 0.7, z: -0.88 }, label: "Pulse oximeter", interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"] },
            nebulizer_mask_equipment: { position: { x: 0.2, y: 0.82, z: -0.7 }, label: "Nebulizer mask", interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"] },
            oxygen_wall_port_equipment: { position: { x: 1.55, y: 1.2, z: -1.36 }, label: "Oxygen wall port", interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"] },
            pediatric_stretcher_equipment: { position: { x: -0.15, y: 0, z: -0.98 }, label: "Pediatric stretcher", interactionCueIds: ["selectable_equipment_reference"] },
            parent_chair_equipment: { position: { x: -1.62, y: 0, z: -0.45 }, label: "Parent chair", interactionCueIds: ["selectable_equipment_reference"] },
            inhaler_spacer_equipment: { position: { x: 0.68, y: 0.74, z: -0.54 }, label: "Inhaler spacer", interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"] },
          },
        },
      },
    };
  }
  return {
    ...report,
    learnerBundle: {
      ...learnerBundle,
      scenarioId,
      bundleId: learnerBundle.bundleId.replace("ed_chest_pain_priority_v1", scenarioId),
      sceneManifest: {
        ...learnerBundle.sceneManifest,
        scenarioId,
        manifestId: `scene_manifest:${scenarioId}:ed_chest_pain_station_v1`,
      },
      stationId: "ed_chest_pain_station_v1",
    },
  };
}

function affectTimeline(emotion: "neutral" | "anxious" | "concerned" | "reassured" | "pain", intensity: number) {
  return {
    emotion,
    intensity,
    onsetMs: 120,
    transitionMs: emotion === "pain" || emotion === "anxious" ? 650 : 950,
    decayMs: 900,
    evidenceCueIds: [
      "emotion_aligned_expression_transition_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "dialogue_viseme_and_gaze_mapping",
    ],
    notEvidenceFor: ["clinical_validity", "scoring_validity", "production_asset_readiness"] as Array<"clinical_validity" | "scoring_validity" | "production_asset_readiness">,
  };
}
