import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../packages/openclinxr/asset-registry/src/index.js";
import { buildEncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import {
  buildEncounterLocalLaunchSelectionReport,
  runEncounterLocalLaunchSelectionCli,
  validateEncounterLocalLaunchSelectionReport,
} from "./encounter-local-launch-selection.js";
import {
  buildEncounterPublicationPayloadReport,
  type EncounterPublicationCaseDefinedHumanoidRuntimeHandoff,
  type EncounterPublicationHumanoidRuntimeRequirement,
} from "./encounter-publication-payloads.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

const notEvidenceFor: GeneratedEdStationRuntimeBundleReport["notEvidenceFor"] = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
];

const bundleReport = (): GeneratedEdStationRuntimeBundleReport => ({
  generatedAt: "2026-05-23T12:00:00.000Z",
  schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
  status: "bundle_ready",
  bundle: null,
  learnerBundle: createEdChestPainLocalLearnerRuntimeAssetBundle({
    assetStore: {
      storeKind: "azurite_blob",
      containerName: "openclinxr-assets",
    },
  }),
  actorHumanoidMaterializationContract: null,
  equipmentMaterializationContract: null,
  bundleBlobName: null,
  runtimeAssetReviewDecisions: [],
  blockers: [],
  productionCloudCall: false,
  notEvidenceFor,
});

const humanoidHandoff = (
  actorRole: string,
  workOrderIds: string[],
  requiredSignalIds: string[],
): EncounterPublicationCaseDefinedHumanoidRuntimeHandoff => ({
  claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
  actorRole,
  humanoidVariantProfile: {
    bodyScaleSource: "scenario_actor_role_and_factory_work_order",
    clothingLayer: actorRole === "patient"
      ? "patient_gown"
      : actorRole === "nurse"
        ? "clinical_scrubs"
        : actorRole === "family"
          ? "civilian_family"
          : "role_specific",
    hairFaceRequired: true,
    faceEyeLipRigRequired: true,
    idlePoseRequired: true,
    locomotionRequired: true,
  },
  workOrderIds,
  locomotionRequired: true,
  expressionRequired: true,
  gazeRequired: true,
  lipSyncRequired: true,
  interactiveRequired: true,
  requiredSignalIds,
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
});

const humanoidRuntimeRequirement = (
  actorRole: string,
  actorId: string,
): EncounterPublicationHumanoidRuntimeRequirement => ({
  actorId,
  actorRole,
  modelAssetId: `${actorId}:model`,
  requiredAssetKinds: [
    "generated_humanoid_mesh",
    "viseme_phoneme_map",
    "gaze_blink_control",
  ],
  requiredSignalIds: [
    "animated_humanoid_runtime_playback",
    "emotion_aligned_expression_transition_cue",
    "dialogue_viseme_and_gaze_mapping",
    "dialogue_eye_micro_saccade_blink_cue",
    "generated_eyelid_blink_control_cue",
  ],
  gazeTargetRequired: true,
  visemeMapRequired: true,
  notEvidenceFor,
});

describe("encounter local launch selection", () => {
  it("selects local static publication assets while keeping learner launch blocked", async () => {
    const publication = await buildEncounterPublicationPayloadReport({
      queueReport: buildEncounterAssetGenerationQueueReport({ generatedAt: "2026-05-23T12:00:00.000Z" }),
      bundleReport: bundleReport(),
      generatedAt: "2026-05-23T12:30:00.000Z",
    });
    const report = buildEncounterLocalLaunchSelectionReport(publication, "2026-05-23T13:00:00.000Z");

    expect(report).toMatchObject({
      generatedAt: "2026-05-23T13:00:00.000Z",
      schemaVersion: "openclinxr.encounter-local-launch-selection.v1",
      selectedScenarioId: "ed_chest_pain_priority_v1",
      selectedStationId: "ed_chest_pain_station_v1",
      selectedRuntimeAssetBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
      selectionSource: "materialized_publication_payload",
      launchMode: "local_static_public_assets",
      sceneManifestUrl: "/xr-assets/generated/ed_chest_pain_priority_v1/scene-manifest.v1.json",
      learnerRuntimeBundleUrl: "/xr-assets/generated/ed_chest_pain_priority_v1/learner-runtime-bundle.v1.json",
      launchContract: {
        schemaVersion: "openclinxr.case-definition-driven-webxr-launch-contract.v1",
        contractId: "encounter_assets_ed_chest_pain_executable_v1:webxr-launch-contract:v1",
        status: "blocked_pending_publication_or_case_alignment",
        selectedScenarioId: "ed_chest_pain_priority_v1",
        selectedStationId: "ed_chest_pain_station_v1",
        runtimeAssetBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
        actorRoster: [],
        caseDefinedActorRealismRequirements: [],
        actorRealismLaunchBadges: [],
        caseDefinitionCoverage: {
          actorRolesCovered: false,
          traceTagsCovered: true,
          equipmentPlacementsPresent: false,
          assetNeedsCarriedByWorkOrders: true,
          blockers: expect.arrayContaining([
            "runtime_bundle_missing_equipment:12_lead_ecg_machine_equipment",
          ]),
        },
        launchBlockingReasons: expect.arrayContaining([
          "publication_payload_not_materialized",
          "runtime_realism_evidence_not_attached",
          "humanoid_visual_qa_evidence_not_attached",
          "quest_webxr_evidence_not_attached",
          "runtime_bundle_missing_for_case_definition_coverage",
          "actor_roster_empty",
        ]),
        notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_readiness", "clinical_validity", "scoring_validity"],
      },
      realismEvidenceRefs: {
        claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
        refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
        requiredBefore: "guarded_runtime_wiring",
        runtimeExecutionAllowed: false,
        providerExecutionPerformed: false,
        questReadinessClaimed: false,
      },
      learnerLaunchAllowed: false,
      blockers: expect.arrayContaining([
        "runtime_realism_evidence_not_attached",
        "humanoid_visual_qa_evidence_not_attached",
        "quest_webxr_evidence_not_attached",
      ]),
      evidenceBoundaries: {
        localStaticAssetSelectionOnly: true,
        cloudOperationPerformed: false,
        providerExecutionPerformed: false,
        generatedAssetsMaterialized: false,
        learnerLaunchEnabled: false,
        questReadinessClaimed: false,
        productionReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
      },
      claimBoundary: "local_launch_selection_not_runtime_readiness",
    });
    expect(report.dynamicBehaviorTags).toEqual([]);
    expect(report.actorRoles).toEqual(["patient", "family", "nurse"]);
    expect(report.selectedAssetCounts).toMatchObject({ actors: 0, equipment: 0, roomProps: 0 });
    expect(report.launchContract.actorRoster).toEqual([]);
    expect(report.launchContract.caseDefinedActorRealismRequirements).toHaveLength(0);
    expect(report.launchContract.actorRealismLaunchBadges).toHaveLength(0);
    expect(validateEncounterLocalLaunchSelectionReport(report)).toEqual({ ok: true });
  });

  it("carries case-defined actor realism requirements into the WebXR launch contract when upstream handoff exists", async () => {
    const publication = await buildEncounterPublicationPayloadReport({
      queueReport: buildEncounterAssetGenerationQueueReport({ generatedAt: "2026-05-23T12:00:00.000Z" }),
      bundleReport: bundleReport(),
      generatedAt: "2026-05-23T12:30:00.000Z",
    });
    const actorRoles = ["patient", "family", "nurse"];
    const caseDefinedPublication = {
      ...publication,
      status: "materialized" as const,
      blockers: [],
      payloadSummary: {
        ...publication.payloadSummary,
        actorCount: 3,
        humanoidRuntimeRequirementActorCount: 3,
      },
      humanoidRuntimeRequirements: [
        humanoidRuntimeRequirement("patient", "patient_robert_hayes_v1"),
        humanoidRuntimeRequirement("family", "spouse_anna_hayes_v1"),
        humanoidRuntimeRequirement("nurse", "nurse_maria_alvarez_v1"),
      ],
      caseDefinedHumanoidRuntimeHandoff: actorRoles.map((actorRole) =>
        humanoidHandoff(
          actorRole,
          [`${actorRole}:role_specific_humanoid_glb`, `${actorRole}:role_idle_animation_glb`],
          [
          "animated_humanoid_runtime_playback",
          "emotion_aligned_expression_transition_cue",
          "dialogue_viseme_and_gaze_mapping",
          "dialogue_eye_micro_saccade_blink_cue",
          "generated_eyelid_blink_control_cue",
          ],
        )
      ),
      caseDefinitionDrivenFactoryCoverage: {
        ...publication.caseDefinitionDrivenFactoryCoverage,
        coverage: {
          actorRolesCovered: true,
          traceTagsCovered: true,
          equipmentPlacementsPresent: true,
          assetNeedsCarriedByWorkOrders: true,
        },
        blockers: [],
      },
      actorEquipmentMaterializationGate: {
        ...publication.actorEquipmentMaterializationGate,
        materializationEvidenceAttachmentSummary: {
          source: "encounter_materialization_evidence_attachments",
          totalRequiredSlotCount: 36,
          attachedSlotCount: 1,
          missingSlotCount: 35,
          heldOrInvalidAttachmentCount: 0,
          allRequiredSlotsSatisfied: false,
          blockers: [
            "materialization_evidence_attachment_missing:actor-materialization-attachment:patient_robert_hayes_v1:actor_specific_clothing_required",
            "materialization_evidence_attachment_missing:equipment-materialization-attachment:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
          ],
          runtimeSelectionAllowed: false,
          learnerLaunchAllowed: false,
          questEvidenceRefreshAllowed: false,
          claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
        },
      },
    };

    const report = buildEncounterLocalLaunchSelectionReport(caseDefinedPublication, "2026-05-23T13:15:00.000Z");

    expect(report.launchContract).toMatchObject({
      status: "blocked_pending_evidence",
      actorRealismLaunchBadges: expect.arrayContaining([
        expect.objectContaining({
          actorId: "patient_robert_hayes_v1",
          actorRole: "patient",
          status: "realismBlocked",
          blockers: expect.arrayContaining(["actor_specific_humanoid_realism_gate_not_attached"]),
        }),
      ]),
      caseDefinitionCoverage: {
        actorRolesCovered: true,
        traceTagsCovered: true,
        equipmentPlacementsPresent: true,
        assetNeedsCarriedByWorkOrders: true,
        blockers: [],
      },
    });
    expect(report.launchContract.caseDefinedActorRealismRequirements).toHaveLength(3);
    expect(report.launchContract.caseDefinedActorRealismRequirements[0]).toMatchObject({
      actorId: "patient_robert_hayes_v1",
      actorRole: "patient",
      locomotionRequired: true,
      expressionRequired: true,
      gazeRequired: true,
      lipSyncRequired: true,
      interactiveRequired: true,
      requiredSignalIds: expect.arrayContaining([
        "animated_humanoid_runtime_playback",
        "emotion_aligned_expression_transition_cue",
        "dialogue_viseme_and_gaze_mapping",
      ]),
    });
    expect(report.launchContract.actorRealismLaunchBadges).toHaveLength(3);
    expect(report.launchContract.launchBlockingReasons).toEqual(expect.arrayContaining([
      "runtime_realism_evidence_not_attached",
      "humanoid_visual_qa_evidence_not_attached",
      "quest_webxr_evidence_not_attached",
      "actor_specific_humanoid_realism_gate_not_attached",
      "materialization_evidence_attachment_missing:actor-materialization-attachment:patient_robert_hayes_v1:actor_specific_clothing_required",
      "materialization_evidence_attachment_missing:equipment-materialization-attachment:ecg_cart_equipment:scenario_specific_equipment_variant_evidence",
    ]));
    expect(report.actorEquipmentMaterializationGate.materializationEvidenceAttachmentSummary).toMatchObject({
      totalRequiredSlotCount: 36,
      attachedSlotCount: 1,
      missingSlotCount: 35,
      allRequiredSlotsSatisfied: false,
      runtimeSelectionAllowed: false,
      learnerLaunchAllowed: false,
      questEvidenceRefreshAllowed: false,
    });
    expect(report.launchContract.actorEquipmentMaterializationGate.materializationEvidenceAttachmentSummary).toMatchObject({
      totalRequiredSlotCount: 36,
      attachedSlotCount: 1,
      missingSlotCount: 35,
      allRequiredSlotsSatisfied: false,
    });
    expect(validateEncounterLocalLaunchSelectionReport(report)).toEqual({ ok: true });
  });

  it("rejects launch contracts that drift from selected scenario/runtime IDs", async () => {
    const publication = await buildEncounterPublicationPayloadReport({
      queueReport: buildEncounterAssetGenerationQueueReport({ generatedAt: "2026-05-23T12:00:00.000Z" }),
      bundleReport: bundleReport(),
      generatedAt: "2026-05-23T12:30:00.000Z",
    });
    const report = buildEncounterLocalLaunchSelectionReport(publication, "2026-05-23T13:30:00.000Z");
    const validation = validateEncounterLocalLaunchSelectionReport({
      ...report,
      sceneManifestUrl: "/xr-assets/generated/wrong_scenario/scene-manifest.v1.json",
      launchContract: {
        ...report.launchContract,
        selectedScenarioId: "wrong_scenario",
        runtimeAssetBundleId: "wrong_bundle",
      },
    });

    expect(validation).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/launchContract/selectedScenarioId must match /selectedScenarioId",
        "/launchContract/runtimeAssetBundleId must match /selectedRuntimeAssetBundleId",
        "/sceneManifestUrl must include selectedScenarioId",
      ]),
    });
  });

  it("rejects launch contracts that drop actor realism badges after requirements are present", async () => {
    const publication = await buildEncounterPublicationPayloadReport({
      queueReport: buildEncounterAssetGenerationQueueReport({ generatedAt: "2026-05-23T12:00:00.000Z" }),
      bundleReport: bundleReport(),
      generatedAt: "2026-05-23T12:30:00.000Z",
    });
    const report = buildEncounterLocalLaunchSelectionReport({
      ...publication,
      status: "materialized",
      blockers: [],
      payloadSummary: {
        ...publication.payloadSummary,
        actorCount: 1,
        humanoidRuntimeRequirementActorCount: 1,
      },
      humanoidRuntimeRequirements: [
        humanoidRuntimeRequirement("patient", "patient_robert_hayes_v1"),
      ],
      caseDefinedHumanoidRuntimeHandoff: [
        humanoidHandoff("patient", ["patient:role_specific_humanoid_glb"], ["animated_humanoid_runtime_playback"]),
      ],
    }, "2026-05-23T13:45:00.000Z");
    const validation = validateEncounterLocalLaunchSelectionReport({
      ...report,
      launchContract: {
        ...report.launchContract,
        actorRealismLaunchBadges: [],
      },
    });

    expect(validation).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/launchContract/actorRealismLaunchBadges must match caseDefinedActorRealismRequirements length",
        "/launchContract/caseDefinedActorRealismRequirements/0 must have matching actorRealismLaunchBadge",
      ]),
    });
  });

  it("writes and validates launch selection reports from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-launch-selection-"));
    try {
      const publicationPath = path.join(tempDir, "publication.json");
      const outputPath = path.join(tempDir, "launch-selection.json");
      const publication = await buildEncounterPublicationPayloadReport({
        queueReport: buildEncounterAssetGenerationQueueReport({ generatedAt: "2026-05-23T12:00:00.000Z" }),
        bundleReport: bundleReport(),
        generatedAt: "2026-05-23T12:30:00.000Z",
        artifactRoot: tempDir,
      });
      await writeFile(publicationPath, `${JSON.stringify(publication, null, 2)}\n`, "utf8");
      await runEncounterLocalLaunchSelectionCli(["--publication-report", publicationPath, "--output", outputPath]);
      await expect(runEncounterLocalLaunchSelectionCli(["--validate", outputPath])).resolves.toBeUndefined();
      await expect(readFile(outputPath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        learnerLaunchAllowed: false,
        selectionSource: "materialized_publication_payload",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
