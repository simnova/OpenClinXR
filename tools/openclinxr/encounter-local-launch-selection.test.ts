import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import { buildEncounterPublicationPayloadReport } from "./encounter-publication-payloads.js";
import {
  buildEncounterLocalLaunchSelectionReport,
  runEncounterLocalLaunchSelectionCli,
  validateEncounterLocalLaunchSelectionReport,
} from "./encounter-local-launch-selection.js";

const bundleReport = () => ({
  generatedAt: "2026-05-23T12:00:00.000Z",
  schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1" as const,
  status: "bundle_ready" as const,
  learnerBundle: {
    bundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
    scenarioId: "ed_chest_pain_priority_v1",
    stationId: "ed_chest_pain_station_v1",
    identityScope: "learner_runtime_opaque_bundle" as const,
    sceneManifest: {
      manifestId: "scene_manifest:ed_chest_pain_priority_v1:ed_chest_pain_station_v1",
      schemaVersion: "openclinxr.encounter-runtime-scene-manifest.v1",
      roomProps: [{ propId: "bed", propType: "bed", semanticRole: "patient_support", evidenceCue: "stretcher" }],
      actorPlacements: {
        patient_robert_hayes_v1: { position: [0, 0, 0], rotationYDegrees: 0 },
        nurse_maria_alvarez_v1: { position: [1, 0, 0], rotationYDegrees: 0 },
        spouse_anna_hayes_v1: { position: [-1, 0, 0], rotationYDegrees: 0 },
      },
      equipmentPlacements: {},
      dialogueTurns: [
        { actorId: "patient_robert_hayes_v1", text: "It hurts.", emotionState: "anxious", gazeTarget: "learner" },
        { actorId: "nurse_maria_alvarez_v1", text: "I can get the ECG.", emotionState: "focused", gazeTarget: "patient_robert_hayes_v1" },
        { actorId: "spouse_anna_hayes_v1", text: "Is he okay?", emotionState: "worried", gazeTarget: "learner" },
      ],
    },
    actors: [
      { actorId: "patient_robert_hayes_v1", role: "patient", embodiment: "humanoid", gazeProfile: { defaultTarget: "learner", supportedTargets: ["learner"] }, affectTimeline: [{ atSecond: 0, emotionState: "focused" }], model: { assetId: "patient", kind: "humanoid_model", blob: { storeKind: "app_public_fixture", url: "/xr-assets/humanoids/neutral-generated-human.glb", blobName: "neutral-generated-human.glb" }, reviewStatus: "fixture_approved_for_local_runtime" }, animationClips: [], phonemeMap: { assetId: "patient_phoneme", kind: "phoneme_map", blob: { storeKind: "app_public_fixture", url: "/phoneme.json", blobName: "phoneme.json" }, reviewStatus: "fixture_approved_for_local_runtime" } },
      { actorId: "nurse_maria_alvarez_v1", role: "nurse", embodiment: "humanoid", gazeProfile: { defaultTarget: "learner", supportedTargets: ["learner"] }, affectTimeline: [{ atSecond: 0, emotionState: "focused" }], model: { assetId: "nurse", kind: "humanoid_model", blob: { storeKind: "app_public_fixture", url: "/xr-assets/humanoids/neutral-generated-human.glb", blobName: "neutral-generated-human.glb" }, reviewStatus: "fixture_approved_for_local_runtime" }, animationClips: [], phonemeMap: { assetId: "nurse_phoneme", kind: "phoneme_map", blob: { storeKind: "app_public_fixture", url: "/phoneme.json", blobName: "phoneme.json" }, reviewStatus: "fixture_approved_for_local_runtime" } },
      { actorId: "spouse_anna_hayes_v1", role: "family", embodiment: "humanoid", gazeProfile: { defaultTarget: "learner", supportedTargets: ["learner"] }, affectTimeline: [{ atSecond: 0, emotionState: "focused" }], model: { assetId: "spouse", kind: "humanoid_model", blob: { storeKind: "app_public_fixture", url: "/xr-assets/humanoids/neutral-generated-human.glb", blobName: "neutral-generated-human.glb" }, reviewStatus: "fixture_approved_for_local_runtime" }, animationClips: [], phonemeMap: { assetId: "spouse_phoneme", kind: "phoneme_map", blob: { storeKind: "app_public_fixture", url: "/phoneme.json", blobName: "phoneme.json" }, reviewStatus: "fixture_approved_for_local_runtime" } },
    ],
    equipment: [{ equipmentId: "ecg_cart_equipment", model: { assetId: "ecg", kind: "equipment_model", blob: { storeKind: "app_public_fixture", url: "/xr-assets/medical-equipment/ecg.glb", blobName: "ecg.glb" }, reviewStatus: "fixture_approved_for_local_runtime" } }],
    environment: { assetId: "ed_env", kind: "environment_model", blob: { storeKind: "app_public_fixture", url: "/xr-assets/environment/ed.glb", blobName: "ed.glb" }, reviewStatus: "fixture_approved_for_local_runtime" },
    uiSurfaces: [],
    evidenceGateRefs: [],
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  },
  blockers: [],
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
            modelAssetId: "patient",
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
      caseDefinedHumanoidRuntimeHandoff: actorRoles.map((actorRole) => ({
        claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only" as const,
        actorRole,
        workOrderIds: [`${actorRole}:role_specific_humanoid_glb`, `${actorRole}:role_idle_animation_glb`],
        locomotionRequired: true as const,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactiveRequired: true,
        requiredSignalIds: [
          "animated_humanoid_runtime_playback",
          "emotion_aligned_expression_transition_cue",
          "dialogue_viseme_and_gaze_mapping",
          "dialogue_eye_micro_saccade_blink_cue",
          "generated_eyelid_blink_control_cue",
        ],
        blockers: [
          "runtime_realism_evidence_not_attached_to_encounter_bundle",
          "visual_qa_evidence_not_attached_to_encounter_bundle",
        ] as const,
        notEvidenceFor: [
          "generated_humanoid_asset_readiness",
          "animation_quality",
          "quest_readiness",
          "runtime_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      })),
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
      caseDefinedHumanoidRuntimeHandoff: [{
        claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
        actorRole: "patient",
        workOrderIds: ["patient:role_specific_humanoid_glb"],
        locomotionRequired: true,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactiveRequired: true,
        requiredSignalIds: ["animated_humanoid_runtime_playback"],
        blockers: [
          "runtime_realism_evidence_not_attached_to_encounter_bundle",
          "visual_qa_evidence_not_attached_to_encounter_bundle",
        ],
        notEvidenceFor: ["generated_humanoid_asset_readiness", "runtime_readiness", "quest_readiness"],
      }],
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
