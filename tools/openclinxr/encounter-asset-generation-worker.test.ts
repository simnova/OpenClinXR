import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import {
  buildEncounterAssetGenerationWorkerReport,
  type EncounterAssetGenerationWorkerReport,
  isAzuriteConnectionString,
  runEncounterAssetGenerationWorkerCli,
  validateEncounterAssetGenerationWorkerReport,
} from "./encounter-asset-generation-worker.js";
import type { EncounterMaterializationAttachmentPlan } from "./encounter-materialization-attachment-plan.js";
import type { EncounterMaterializationEvidenceAttachmentRecords } from "./encounter-materialization-evidence-attachments.js";
import type { EncounterMaterializationInputManifest } from "./encounter-materialization-input-manifest.js";
import type { VisualQaRemediationWorkOrderRef } from "./visual-qa-evidence-check.js";

const requireFixtureValue = <T>(value: T | null | undefined, label: string): T => {
  expect(value, label).toBeDefined();
  if (value == null) {
    throw new Error(`Missing required fixture value: ${label}`);
  }
  return value;
};

function materializationInputManifestFixture(): EncounterMaterializationInputManifest {
  return {
    schemaVersion: "openclinxr.encounter-materialization-input-manifest.v1",
    generatedAt: "2026-05-28T00:00:00.000Z",
    source: "encounter_materialization_evidence_report",
    scenarioId: "ed_chest_pain_priority_v1",
    status: "planned_metadata_only_blocked_until_provider_approval",
    actorWorkOrderInputs: [{
      workOrderInputId: "actor-materialization-input:patient_robert_hayes_v1",
      actorId: "patient_robert_hayes_v1",
      actorRole: "patient",
      variantSemanticKey: "ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant",
      sourceBlobName: "patient.glb",
      requiredEvidenceRefs: [
        "actor-materialization-evidence://ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant/role_specific_body_scale_and_silhouette",
        "actor-materialization-evidence://ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant/role_specific_clothing_layer",
      ],
      requiredCueIds: ["role_specific_body_scale_and_silhouette", "role_specific_clothing_layer"],
      blockerIds: ["actor_materialization_evidence_missing:patient_robert_hayes_v1:role_specific_body_scale_and_silhouette"],
      targetCapabilityIds: ["character-generation", "animation-generation", "asset-bake"],
      providerExecutionStatus: "metadata_only_not_executed",
      claimBoundary: "provider_neutral_materialization_input_not_asset_readiness",
    }],
    equipmentWorkOrderInputs: [{
      workOrderInputId: "equipment-materialization-input:ecg_cart_equipment",
      equipmentId: "ecg_cart_equipment",
      variantSemanticKey: "ed_chest_pain_priority_v1:ecg_cart_equipment:equipment_materialization_variant",
      sourceBlobName: "ecg.glb",
      requiredEvidenceRefs: [
        "equipment-materialization-evidence://ed_chest_pain_priority_v1:ecg_cart_equipment:equipment_materialization_variant/scenario_specific_equipment_variant_evidence",
        "equipment-materialization-evidence://ed_chest_pain_priority_v1:ecg_cart_equipment:equipment_materialization_variant/equipment_scale_validation_evidence",
      ],
      requiredCueIds: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence"],
      blockerIds: ["equipment_materialization_evidence_missing:ecg_cart_equipment:scenario_specific_equipment_variant_evidence"],
      targetCapabilityIds: ["medical-equipment-generation", "asset-bake"],
      providerExecutionStatus: "metadata_only_not_executed",
      claimBoundary: "provider_neutral_materialization_input_not_asset_readiness",
    }],
    providerBoundary: {
      providerExecutionPerformed: false,
      paidApisUsed: false,
      externalNetworkUsed: false,
      productionAssetReadinessClaimed: false,
      questReadinessClaimed: false,
      runtimeReadinessClaimed: false,
      claimBoundary: "provider_neutral_input_manifest_no_execution",
    },
    blockers: [
      "actor_materialization_evidence_missing:patient_robert_hayes_v1:role_specific_body_scale_and_silhouette",
      "equipment_materialization_evidence_missing:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
    ],
    recommendedNextActions: ["review provider-neutral work-order inputs before execution"],
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}

function materializationAttachmentPlanFixture(): EncounterMaterializationAttachmentPlan {
  return {
    schemaVersion: "openclinxr.encounter-materialization-attachment-plan.v1",
    generatedAt: "2026-05-28T07:00:00.000Z",
    source: "encounter_materialization_input_manifest",
    scenarioId: "ed_chest_pain_priority_v1",
    status: "attachment_slots_created_not_evidence_attached",
    attachableToRuntimeSelection: false,
    actorAttachmentSlots: [{
      attachmentSlotId: "actor-materialization-attachment:patient_robert_hayes_v1:role_specific_body_scale_and_silhouette",
      workOrderInputId: "actor-materialization-input:patient_robert_hayes_v1",
      actorId: "patient_robert_hayes_v1",
      actorRole: "patient",
      variantSemanticKey: "ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant",
      requiredCueId: "role_specific_body_scale_and_silhouette",
      requiredEvidenceRef: "actor-materialization-evidence://ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant/role_specific_body_scale_and_silhouette",
      expectedArtifactKinds: ["actor_specific_humanoid_glb", "actor_materialization_review_packet", "humanoid_visual_qa_reference"],
      attachmentStatus: "missing_evidence",
      providerExecutionAllowed: false,
      runtimeSelectionAllowed: false,
      claimBoundary: "materialization_attachment_slot_not_runtime_readiness",
    }],
    equipmentAttachmentSlots: [{
      attachmentSlotId: "equipment-materialization-attachment:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
      workOrderInputId: "equipment-materialization-input:ecg_cart_equipment",
      equipmentId: "ecg_cart_equipment",
      variantSemanticKey: "ed_chest_pain_priority_v1:ecg_cart_equipment:equipment_materialization_variant",
      requiredCueId: "scenario_specific_equipment_variant_evidence",
      requiredEvidenceRef: "equipment-materialization-evidence://ed_chest_pain_priority_v1:ecg_cart_equipment:equipment_materialization_variant/scenario_specific_equipment_variant_evidence",
      expectedArtifactKinds: ["equipment_specific_glb_or_prefab", "equipment_scale_placement_review_packet", "clinical_affordance_review_packet"],
      attachmentStatus: "missing_evidence",
      providerExecutionAllowed: false,
      runtimeSelectionAllowed: false,
      claimBoundary: "materialization_attachment_slot_not_runtime_readiness",
    }],
    attachmentBoundary: {
      providerExecutionPerformed: false,
      paidApisUsed: false,
      externalNetworkUsed: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "materialization_attachment_plan_metadata_only",
    },
    blockers: [
      "actor_materialization_attachment_missing:patient_robert_hayes_v1:role_specific_body_scale_and_silhouette",
      "equipment_materialization_attachment_missing:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
    ],
    recommendedNextActions: ["attach actor/equipment evidence before runtime selection can clear"],
    claimBoundary: "materialization_attachment_plan_not_provider_or_runtime_execution",
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}

function materializationEvidenceAttachmentRecordsFixture(): EncounterMaterializationEvidenceAttachmentRecords {
  return {
    schemaVersion: "openclinxr.encounter-materialization-evidence-attachments.v1",
    generatedAt: "2026-05-28T07:40:00.000Z",
    source: "encounter_materialization_attachment_plan",
    scenarioId: "ed_chest_pain_priority_v1",
    status: "partial_slots_attached_runtime_blocked",
    actorAttachmentRecords: [{
      attachmentSlotId: "actor-materialization-attachment:patient_robert_hayes_v1:role_specific_body_scale_and_silhouette",
      workOrderInputId: "actor-materialization-input:patient_robert_hayes_v1",
      requiredCueId: "role_specific_body_scale_and_silhouette",
      requiredEvidenceRef: "actor-materialization-evidence://ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant/role_specific_body_scale_and_silhouette",
      expectedArtifactKinds: ["actor_specific_humanoid_glb", "actor_materialization_review_packet", "humanoid_visual_qa_reference"],
      evidenceAttachmentStatus: "attached_metadata_only",
      slotSatisfiedByEvidence: true,
      attachedEvidenceRefs: [
        "actor-materialization-evidence://ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant/role_specific_body_scale_and_silhouette",
      ],
      localArtifactPaths: ["docs/openclinxr/materialization-evidence/robert-hayes-body-profile.json"],
      unsatisfiedReasonIds: [],
      providerExecutionAllowed: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "materialization_evidence_attachment_record_not_runtime_readiness",
      actorId: "patient_robert_hayes_v1",
      actorRole: "patient",
      variantSemanticKey: "ed_chest_pain_priority_v1:patient_robert_hayes_v1:patient:anny_humanoid_variant",
    }],
    equipmentAttachmentRecords: [{
      attachmentSlotId: "equipment-materialization-attachment:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
      workOrderInputId: "equipment-materialization-input:ecg_cart_equipment",
      requiredCueId: "scenario_specific_equipment_variant_evidence",
      requiredEvidenceRef: "equipment-materialization-evidence://ed_chest_pain_priority_v1:ecg_cart_equipment:equipment_materialization_variant/scenario_specific_equipment_variant_evidence",
      expectedArtifactKinds: ["equipment_specific_glb_or_prefab", "equipment_scale_placement_review_packet", "clinical_affordance_review_packet"],
      evidenceAttachmentStatus: "missing_evidence",
      slotSatisfiedByEvidence: false,
      attachedEvidenceRefs: [],
      localArtifactPaths: [],
      unsatisfiedReasonIds: [
        "materialization_evidence_attachment_missing:equipment-materialization-attachment:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
      ],
      providerExecutionAllowed: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "materialization_evidence_attachment_record_not_runtime_readiness",
      equipmentId: "ecg_cart_equipment",
      variantSemanticKey: "ed_chest_pain_priority_v1:ecg_cart_equipment:equipment_materialization_variant",
    }],
    attachmentCompleteness: {
      totalRequiredSlotCount: 2,
      attachedSlotCount: 1,
      missingSlotCount: 1,
      heldOrInvalidAttachmentCount: 0,
      allRequiredSlotsSatisfied: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
      claimBoundary: "materialization_evidence_attachment_completeness_not_runtime_readiness",
    },
    blockers: [
      "materialization_evidence_attachment_missing:equipment-materialization-attachment:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
    ],
    recommendedNextActions: ["attach reviewed local evidence refs for every actor/equipment materialization slot before runtime-selection blockers can be reconsidered"],
    claimBoundary: "materialization_evidence_attachments_not_provider_or_runtime_execution",
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_asset_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}

describe("encounter asset generation worker report", () => {
  it("exposes worker generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:encounter-worker:run"]).toBe(
      "tsx tools/openclinxr/encounter-asset-generation-worker.ts",
    );
    expect(rootPackage.scripts["asset:encounter-worker:validate"]).toBe(
      "tsx tools/openclinxr/encounter-asset-generation-worker.ts --validate-latest",
    );
    expect(rootPackage.scripts["asset:encounter-worker:azurite"]).toBe(
      "tsx tools/openclinxr/encounter-asset-generation-worker.ts --azure-storage-queue",
    );
  });

  it("turns a queue report into one persisted worker execution", async () => {
    const remediationWorkOrderRefs: VisualQaRemediationWorkOrderRef[] = [
      {
        schemaVersion: "openclinxr.visual-qa-remediation-work-order-ref.v1",
        scenarioId: "ed_chest_pain_priority_v1",
        sourceEvidenceRef: "visual-qa-evidence://ed_chest_pain_priority_v1/remediation-loop",
        blockerId: "eye_contact_logic",
        targetKind: "role_specific_humanoid_glb",
        capabilityId: "character-generation",
        workOrderRef: "encounter-generation-work-order://ed_chest_pain_priority_v1/role_specific_humanoid_glb/eye_contact_logic",
        status: "planned_metadata_only",
        recommendedWorkerAction: "adjust the humanoid asset generation inputs so eye contact cues are clearer",
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
    const workerReport = await buildEncounterAssetGenerationWorkerReport({
      queueReport,
      sourceQueueReportPath: "docs/openclinxr/encounter-asset-generation-queue-2026-05-23.json",
      generatedAt: "2026-05-23T12:30:00.000Z",
      remediationWorkOrderRefs,
      materializationInputManifest: materializationInputManifestFixture(),
      materializationAttachmentPlan: materializationAttachmentPlanFixture(),
      materializationEvidenceAttachments: materializationEvidenceAttachmentRecordsFixture(),
    });

    expect(workerReport).toMatchObject({
      generatedAt: "2026-05-23T12:30:00.000Z",
      schemaVersion: "openclinxr.encounter-asset-generation-worker-report.v1",
      status: "processed",
      sourceQueueReportPath: "docs/openclinxr/encounter-asset-generation-queue-2026-05-23.json",
      processingResult: {
        status: "processed",
        messageReceived: true,
        messageDeleted: true,
      },
      evidenceBoundaries: {
        localOneMessageWorkerExecuted: true,
        azuriteCompatibleEnvelopeUsed: true,
        azureCloudOperationPerformed: false,
        mongoosePersistenceAttempted: false,
        paidApisUsed: false,
        productionDeploymentPerformed: false,
        productionReadinessClaimed: false,
        questReadinessClaimed: false,
      },
      sharedAssetLibraryCacheSummary: {
        cacheEventCount: 8,
        cacheHitReuseCount: 0,
        cacheMissGenerationRequiredCount: 8,
        lruEvictionCount: 0,
        generatedAssetsStillDynamic: true,
        lookupBeforeGenerate: true,
      },
      materializationInputManifestSummary: {
        schemaVersion: "openclinxr.encounter-materialization-input-manifest-summary.v1",
        source: "encounter_materialization_input_manifest",
        scenarioId: "ed_chest_pain_priority_v1",
        actorWorkOrderInputCount: 1,
        equipmentWorkOrderInputCount: 1,
        requiredActorCueIds: ["role_specific_body_scale_and_silhouette", "role_specific_clothing_layer"],
        requiredEquipmentCueIds: ["scenario_specific_equipment_variant_evidence", "equipment_scale_validation_evidence"],
        blockerIds: [
          "actor_materialization_evidence_missing:patient_robert_hayes_v1:role_specific_body_scale_and_silhouette",
          "equipment_materialization_evidence_missing:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
        ],
        providerExecutionPerformed: false,
        paidApisUsed: false,
        externalNetworkUsed: false,
        claimBoundary: "metadata_only_provider_neutral_materialization_inputs",
      },
      materializationAttachmentPlanSummary: {
        schemaVersion: "openclinxr.encounter-materialization-attachment-plan-summary.v1",
        source: "encounter_materialization_attachment_plan",
        scenarioId: "ed_chest_pain_priority_v1",
        actorAttachmentSlotCount: 1,
        equipmentAttachmentSlotCount: 1,
        missingAttachmentCount: 2,
        actorRequiredCueIds: ["role_specific_body_scale_and_silhouette"],
        equipmentRequiredCueIds: ["scenario_specific_equipment_variant_evidence"],
        blockerIds: [
          "actor_materialization_attachment_missing:patient_robert_hayes_v1:role_specific_body_scale_and_silhouette",
          "equipment_materialization_attachment_missing:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
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
        scenarioId: "ed_chest_pain_priority_v1",
        totalRequiredSlotCount: 2,
        attachedSlotCount: 1,
        missingSlotCount: 1,
        heldOrInvalidAttachmentCount: 0,
        allRequiredSlotsSatisfied: false,
        blockerIds: [
          "materialization_evidence_attachment_missing:equipment-materialization-attachment:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
        ],
        providerExecutionPerformed: false,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
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
    });
    expect(workerReport.persistedExecutions).toHaveLength(1);
    expect(workerReport.remediationWorkOrderRefs).toEqual(remediationWorkOrderRefs);
    expect(workerReport.persistedExecutions[0]).toMatchObject({
      requestId: "encounter_assets_ed_chest_pain_executable_v1",
      status: "review_blocked",
      generatedSceneManifestBlobName:
        "encounter-assets/local_tenant/ed_chest_pain_priority_v1/ed_chest_pain_encounter_v1/scene-manifest.v1.json",
      learnerRuntimeBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
      productionReadinessClaimed: false,
    });
    expect(workerReport.workerMaterializationPlan).toMatchObject({
      schemaVersion: "openclinxr.worker-materialization-plan.v1",
      requestId: "encounter_assets_ed_chest_pain_executable_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v1/encounter_assets_ed_chest_pain_executable_v1",
      generatedAssetsMaterialized: false,
      paidApisUsed: false,
      productionReadinessClaimed: false,
      claimBoundary: "planned_metadata_only",
    });
    expect(workerReport.workerMaterializationPlan?.outputs).toEqual(expect.arrayContaining([
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
    expect(workerReport.persistedExecutions[0]?.plan.humanoidRealismRequirements?.requirements.map((requirement) => requirement.actorRole)).toEqual([
      "patient",
      "family",
      "nurse",
    ]);
    expect(workerReport.persistedExecutions[0]?.plan.humanoidRealismRequirements?.requirements[0]?.requiredSignalIds).toEqual(expect.arrayContaining([
      "animated_humanoid_runtime_playback",
      "dialogue_viseme_and_gaze_mapping",
    ]));
    expect(workerReport.persistedExecutions[0]?.sharedAssetLibraryCacheEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        result: "cache_miss_generation_required",
        generationDisposition: "generate_and_store_asset",
        evidenceGateCompatibility: {
          required: true,
          checkedBeforeReuse: true,
          disposition: "requires_review_before_new_asset_reuse",
        },
        targetKind: "role_specific_humanoid_glb",
        lookupKey: expect.stringContaining("role_specific_humanoid_glb__patient"),
        notEvidenceFor: [
          "generated_asset_quality",
          "provider_runtime_readiness",
          "production_asset_readiness",
          "quest_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      }),
      expect.objectContaining({
        result: "cache_miss_generation_required",
        generationDisposition: "generate_and_store_asset",
        targetKind: "visual_feedback_closure",
      }),
    ]));
    expect(validateEncounterAssetGenerationWorkerReport(workerReport)).toEqual({ ok: true });
  });

  it("allows only local Azurite-style connection strings for queue worker mode", () => {
    expect(isAzuriteConnectionString("UseDevelopmentStorage=true")).toBe(true);
    expect(isAzuriteConnectionString("DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=fixture;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;")).toBe(true);
    expect(isAzuriteConnectionString("DefaultEndpointsProtocol=https;AccountName=prod;AccountKey=secret;EndpointSuffix=core.windows.net")).toBe(false);
  });

  it("validates idle worker reports for empty emulator queues", async () => {
    const queueReport = buildEncounterAssetGenerationQueueReport({
      generatedAt: "2026-05-23T12:00:00.000Z",
    });
    const workerReport = await buildEncounterAssetGenerationWorkerReport({
      queueReport,
      generatedAt: "2026-05-23T12:30:00.000Z",
      queueClient: {
        async receiveEncounterAssetGenerationMessage() {
          return undefined;
        },
        async deleteEncounterAssetGenerationMessage() {
          throw new Error("delete should not be called for idle queue");
        },
      },
    });

    expect(workerReport).toMatchObject({
      status: "idle",
      processingResult: {
        status: "idle",
        messageReceived: false,
      },
      persistedExecutions: [],
    });
    expect(validateEncounterAssetGenerationWorkerReport(workerReport)).toEqual({ ok: true });
  });

  it("rejects worker reports with corrupted provider-disabled and local-only boundaries", async () => {
    const queueReport = buildEncounterAssetGenerationQueueReport({
      generatedAt: "2026-05-23T12:00:00.000Z",
    });
    const workerReport = await buildEncounterAssetGenerationWorkerReport({
      queueReport,
      generatedAt: "2026-05-23T12:30:00.000Z",
    });
    const invalidReport = structuredClone(workerReport) as EncounterAssetGenerationWorkerReport & {
      operationalNotes: {
        providerDisabledBoundary: { claimBoundary: string; missingEvidenceIds: string[] };
        localOnlyBoundary: { missingEvidenceIds: string[] };
      };
    };
    invalidReport.operationalNotes.providerDisabledBoundary.claimBoundary = "local_only_asset_pipeline_metadata_not_live_provider_readiness";
    invalidReport.operationalNotes.providerDisabledBoundary.missingEvidenceIds = [];
    invalidReport.operationalNotes.localOnlyBoundary.missingEvidenceIds = ["azurite_or_queue_emulator_evidence_missing"];

    expect(validateEncounterAssetGenerationWorkerReport(invalidReport)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/operationalNotes/providerDisabledBoundary/claimBoundary must be \"provider_gate_metadata_not_live_provider_readiness\"",
        "/operationalNotes/providerDisabledBoundary/missingEvidenceIds must include provider_credentials_or_operator_approval_missing",
        "/operationalNotes/providerDisabledBoundary/missingEvidenceIds must include provider_runtime_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include local_blender_ffmpeg_toolchain_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include hunyuan3d_local_install_license_cache_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include shared_asset_library_lru_reuse_evidence_missing",
        "/operationalNotes/localOnlyBoundary/missingEvidenceIds must include durable_job_checkpoint_evidence_missing",
      ]),
    });
  });

  it("validates reports from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-encounter-worker-"));
    const queueReportPath = path.join(tempDir, "queue.json");
    const outputPath = path.join(tempDir, "worker.json");
    const invalidPath = path.join(tempDir, "worker-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      await writeFile(
        queueReportPath,
        `${JSON.stringify(buildEncounterAssetGenerationQueueReport({ generatedAt: "2026-05-23T12:00:00.000Z" }), null, 2)}\n`,
        "utf8",
      );
      await runEncounterAssetGenerationWorkerCli(["--queue-report", queueReportPath, "--output", outputPath]);
      await expect(runEncounterAssetGenerationWorkerCli(["--validate", outputPath])).resolves.toBeUndefined();

      const invalidReport = JSON.parse(await readFile(outputPath, "utf8")) as {
        evidenceBoundaries: { azureCloudOperationPerformed: boolean };
        persistedExecutions: Array<{
          plan: { humanoidRealismRequirements: { requirements: Array<{ requiredAssetKinds: string[] }> } };
          evidenceGateRefs: Array<{ gateId: string; requiredSignalIds: string[] }>;
          sharedAssetLibraryCacheEvents: Array<{
            notEvidenceFor: string[];
            generationDisposition: string;
            evidenceGateCompatibility: { checkedBeforeReuse: boolean };
          }>;
        }>;
      };
      invalidReport.evidenceBoundaries.azureCloudOperationPerformed = true;
      const persistedExecution = requireFixtureValue(invalidReport.persistedExecutions[0], "persisted worker execution");
      requireFixtureValue(
        persistedExecution.plan.humanoidRealismRequirements.requirements[0],
        "first humanoid realism requirement",
      ).requiredAssetKinds = ["generated_humanoid_mesh"];
      requireFixtureValue(
        persistedExecution.evidenceGateRefs.find((gate) => gate.gateId === "runtime_realism_evidence"),
        "runtime realism evidence gate",
      ).requiredSignalIds = ["animated_humanoid_runtime_playback"];
      requireFixtureValue(
        persistedExecution.sharedAssetLibraryCacheEvents[0],
        "first shared asset library cache event",
      ).notEvidenceFor = ["quest_readiness"];
      const secondCacheEvent = requireFixtureValue(
        persistedExecution.sharedAssetLibraryCacheEvents[1],
        "second shared asset library cache event",
      );
      secondCacheEvent.generationDisposition = "skip_generation_reuse_cached_asset";
      secondCacheEvent.evidenceGateCompatibility.checkedBeforeReuse = false;
      persistedExecution.sharedAssetLibraryCacheEvents.pop();
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runEncounterAssetGenerationWorkerCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects worker reports whose cache summary drops persisted cache events", async () => {
    const queueReport = buildEncounterAssetGenerationQueueReport({
      generatedAt: "2026-05-23T12:00:00.000Z",
    });
    const workerReport = await buildEncounterAssetGenerationWorkerReport({
      queueReport,
      generatedAt: "2026-05-23T12:30:00.000Z",
    });
    const invalidReport = structuredClone(workerReport);
    invalidReport.sharedAssetLibraryCacheSummary.cacheEventCount -= 1;

    expect(validateEncounterAssetGenerationWorkerReport(invalidReport)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/sharedAssetLibraryCacheSummary/cacheEventCount must match persisted shared asset library cache events",
      ]),
    });
  });
});
