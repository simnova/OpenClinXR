import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../packages/openclinxr/asset-registry/src/index.js";
import { buildEncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import {
  buildEncounterPublicationPayloadReport,
  type EncounterPublicationCaseDefinedHumanoidRuntimeHandoff,
} from "./encounter-publication-payloads.js";
import {
  buildEncounterLocalLaunchSelectionReport,
  runEncounterLocalLaunchSelectionCli,
  validateEncounterLocalLaunchSelectionReport,
} from "./encounter-local-launch-selection.js";
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
        actorRoster: expect.arrayContaining([
          expect.objectContaining({
            actorId: "patient_robert_hayes_v1",
            actorRole: "patient",
            modelAssetId: expect.any(String),
            source: "learner_runtime_bundle_humanoid_requirement",
          }),
          expect.objectContaining({
            actorId: "spouse_anna_hayes_v1",
            actorRole: "family",
            source: "learner_runtime_bundle_humanoid_requirement",
          }),
          expect.objectContaining({
            actorId: "nurse_maria_alvarez_v1",
            actorRole: "nurse",
            source: "learner_runtime_bundle_humanoid_requirement",
          }),
        ]),
        caseDefinedActorRealismRequirements: [],
        actorRealismLaunchBadges: [],
        caseDefinitionCoverage: {
          actorRolesCovered: true,
          traceTagsCovered: true,
          equipmentPlacementsPresent: false,
          assetNeedsCarriedByWorkOrders: true,
          blockers: expect.arrayContaining([
            "runtime_bundle_missing_equipment:12_lead_ecg_machine_equipment",
          ]),
        },
        launchBlockingReasons: expect.arrayContaining([
          "runtime_realism_evidence_not_attached",
          "humanoid_visual_qa_evidence_not_attached",
          "quest_webxr_evidence_not_attached",
          "case_defined_actor_realism_requirements_incomplete",
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
    expect(report.dynamicBehaviorTags).toEqual(expect.arrayContaining(["dialogue:patient", "gaze:patient"]));
    expect(report.actorRoles).toEqual(["patient", "family", "nurse"]);
    expect(report.selectedAssetCounts).toMatchObject({ actors: 3, equipment: 1, roomProps: 1 });
    expect(report.launchContract.actorRoster.map((actor) => actor.actorRole).sort()).toEqual([...report.actorRoles].sort());
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
    ]));
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
