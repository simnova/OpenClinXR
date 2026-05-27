// @ts-nocheck
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEncounterLocalFactoryHandoffPreflightReport,
  runEncounterLocalFactoryHandoffPreflightCli,
  validateEncounterLocalFactoryHandoffPreflightReport,
} from "./encounter-local-factory-handoff-preflight.js";
import type { EncounterLocalFactoryOperationManifest } from "./encounter-local-factory-operation-manifest.js";

function manifest(root: string): EncounterLocalFactoryOperationManifest {
  return {
    generatedAt: "2026-05-23T13:30:00.000Z",
    schemaVersion: "openclinxr.encounter-local-factory-operation-manifest.v1",
    source: "encounter_local_launch_selection",
    selectedScenarioId: "ed_chest_pain_priority_v1",
    selectedEncounterId: "encounter_assets_ed_chest_pain_executable_v1",
    selectedStationId: "ed_chest_pain_station_v1",
    selectedRuntimeAssetBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
    operationMode: "local_deterministic_factory_plan_only",
    factoryOperations: [
      "read_local_publication_payload_refs",
      "resolve_scene_manifest_and_runtime_bundle_paths",
      "derive_actor_runtime_slots",
      "derive_static_equipment_and_room_slots",
      "derive_dynamic_behavior_trace_slots",
      "prepare_review_blocked_runtime_handoff",
    ],
    localFilesystemPaths: {
      sceneManifestPath: path.join(root, "scene-manifest.v1.json"),
      learnerRuntimeBundlePath: path.join(root, "learner-runtime-bundle.v1.json"),
      uiXrPublicSceneManifestPath: path.join(root, "public-scene-manifest.v1.json"),
      uiXrPublicLearnerRuntimeBundlePath: path.join(root, "public-learner-runtime-bundle.v1.json"),
    },
    localAssetUrls: {
      sceneManifestUrl: "/xr-assets/generated/ed_chest_pain_priority_v1/scene-manifest.v1.json",
      learnerRuntimeBundleUrl: "/xr-assets/generated/ed_chest_pain_priority_v1/learner-runtime-bundle.v1.json",
    },
    dynamicBehaviorTags: ["dialogue:patient", "gaze:patient"],
    actorRoles: ["patient", "family", "nurse"],
    actorRuntimeRealismRequirements: [
      {
        actorId: "patient_robert_hayes_v1",
        role: "patient",
        baselineMood: ["uncomfortable", "worried"],
        locomotionRequired: true,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactionRequired: true,
        requiredCueIds: ["case_definition_driven_expression_selection", "dialogue_viseme_and_gaze_mapping"],
      },
      {
        actorId: "spouse_anna_hayes_v1",
        role: "family",
        baselineMood: ["anxious"],
        locomotionRequired: true,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactionRequired: true,
        requiredCueIds: ["case_definition_driven_expression_selection", "actor_target_gaze_from_trace_intent"],
      },
      {
        actorId: "nurse_maria_alvarez_v1",
        role: "nurse",
        baselineMood: ["focused"],
        locomotionRequired: true,
        expressionRequired: true,
        gazeRequired: true,
        lipSyncRequired: true,
        interactionRequired: true,
        requiredCueIds: ["scenario_actor_interaction_affordance"],
      },
    ],
    guardedRuntimeSelectorDecision: {
      schemaVersion: "openclinxr.guarded-runtime-selector-disabled-decision.v1",
      selectionStatus: "blocked_intent_bundle_missing",
      claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
      selectedScenarioId: "ed_chest_pain_priority_v1",
      selectedStationId: "ed_chest_pain_station_v1",
      selectedRuntimeAssetBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
      selectedBundleId: null,
      selectedBundleIdForFutureRuntime: null,
      matchedBundleSummary: null,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      blockers: ["runtime_selector_disabled_guard_not_wired", "guarded_runtime_intent_bundle_missing"],
      nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    },
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    blockers: ["runtime_realism_evidence_not_attached", "humanoid_visual_qa_evidence_not_attached", "quest_webxr_evidence_not_attached"],
    evidenceBoundaries: {
      localFactoryPlanningOnly: true,
      uiLaunchPerformed: false,
      cloudOperationPerformed: false,
      providerExecutionPerformed: false,
      questEvidenceRefreshed: false,
      broadVerificationPerformed: false,
      learnerLaunchEnabled: false,
      productionReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
    claimBoundary: "local_factory_operation_manifest_not_runtime_execution",
  };
}

describe("encounter local factory handoff preflight", () => {
  it("preflights local handoff artifacts while keeping runtime bridge blocked", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-handoff-preflight-"));
    try {
      const input = manifest(tempDir);
      await Promise.all(Object.values(input.localFilesystemPaths).map((filePath) =>
        writeFile(filePath, JSON.stringify({ scenarioId: input.selectedScenarioId }), "utf8")
      ));
      const report = await buildEncounterLocalFactoryHandoffPreflightReport(input, "2026-05-23T14:00:00.000Z");
      expect(report).toMatchObject({
        generatedAt: "2026-05-23T14:00:00.000Z",
        schemaVersion: "openclinxr.encounter-local-factory-handoff-preflight.v1",
        source: "encounter_local_factory_operation_manifest",
        handoffMode: "local_filesystem_preflight_only",
        internallyPaired: true,
        guardedRuntimeSelectorDecision: {
          selectionStatus: "blocked_intent_bundle_missing",
          runtimeExecutionAllowed: false,
          learnerLaunchAllowed: false,
          providerExecutionPerformed: false,
          uiLaunchPerformed: false,
          questEvidenceRefreshed: false,
        },
        runtimeBridgeAllowed: false,
        learnerLaunchAllowed: false,
        caseDefinedActorRealismLaunchBadges: [
          {
            actorId: "patient_robert_hayes_v1",
            actorRole: "patient",
            baselineMood: ["uncomfortable", "worried"],
            requiredCueIds: ["case_definition_driven_expression_selection", "dialogue_viseme_and_gaze_mapping"],
            requiredDimensions: ["locomotion", "expression", "gaze", "lip_sync", "interaction"],
            status: "realismBlocked",
            blockers: [
              "actor_specific_humanoid_realism_gate_not_attached",
              "runtime_realism_evidence_not_attached",
              "humanoid_visual_qa_evidence_not_attached",
              "quest_webxr_evidence_not_attached",
            ],
            claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
          },
          {
            actorRole: "family",
            status: "realismBlocked",
          },
          {
            actorRole: "nurse",
            status: "realismBlocked",
          },
        ],
        blockers: ["runtime_realism_evidence_not_attached", "humanoid_visual_qa_evidence_not_attached", "quest_webxr_evidence_not_attached"],
        claimBoundary: "local_factory_handoff_preflight_not_runtime_execution",
      });
      expect(report.localArtifactChecks.every((check) => check.present && check.scenarioIdMatches)).toBe(true);
      expect(report.caseDefinedActorRealismLaunchBadges.every((badge) =>
        badge.blockers.includes("actor_specific_humanoid_realism_gate_not_attached")
      )).toBe(true);
      expect(validateEncounterLocalFactoryHandoffPreflightReport(report)).toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes and validates preflight reports from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-handoff-preflight-cli-"));
    try {
      const input = manifest(tempDir);
      const manifestPath = path.join(tempDir, "operation-manifest.json");
      const outputPath = path.join(tempDir, "preflight.json");
      await Promise.all(Object.values(input.localFilesystemPaths).map((filePath) =>
        writeFile(filePath, JSON.stringify({ scenarioId: input.selectedScenarioId }), "utf8")
      ));
      await writeFile(manifestPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
      await runEncounterLocalFactoryHandoffPreflightCli(["--operation-manifest", manifestPath, "--output", outputPath]);
      await expect(runEncounterLocalFactoryHandoffPreflightCli(["--validate", outputPath])).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects actor realism launch badges that imply readiness without actor-specific gate evidence", () => {
    const invalid = {
      generatedAt: "2026-05-23T14:00:00.000Z",
      schemaVersion: "openclinxr.encounter-local-factory-handoff-preflight.v1",
      source: "encounter_local_factory_operation_manifest",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      selectedEncounterId: "encounter_assets_peds_asthma_v1",
      selectedStationId: "peds_asthma_station_v1",
      handoffMode: "local_filesystem_preflight_only",
      localArtifactChecks: [],
      internallyPaired: true,
      guardedRuntimeSelectorDecision: {
        claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        providerExecutionPerformed: false,
        uiLaunchPerformed: false,
        questEvidenceRefreshed: false,
      },
      runtimeBridgeAllowed: false,
      learnerLaunchAllowed: false,
      caseDefinedActorRealismLaunchBadges: [{
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        baselineMood: ["breathless"],
        requiredCueIds: ["dialogue_viseme_and_gaze_mapping"],
        requiredDimensions: ["expression", "gaze"],
        status: "realismReady",
        blockers: [],
        claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
      }],
      blockers: [],
      evidenceBoundaries: {
        uiLaunchPerformed: false,
        cloudOperationPerformed: false,
        providerExecutionPerformed: false,
        questEvidenceRefreshed: false,
        broadVerificationPerformed: false,
        learnerLaunchEnabled: false,
        productionReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
      },
      claimBoundary: "local_factory_handoff_preflight_not_runtime_execution",
    };

    expect(validateEncounterLocalFactoryHandoffPreflightReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/caseDefinedActorRealismLaunchBadges/0/status must be \"realismBlocked\"",
        "/caseDefinedActorRealismLaunchBadges/0/blockers must include actor_specific_humanoid_realism_gate_not_attached",
      ]),
    });
  });

  it("rejects preflight reports that drop all actor realism launch badges", () => {
    const invalid = {
      ...manifest("/tmp/openclinxr"),
      generatedAt: "2026-05-23T14:00:00.000Z",
      schemaVersion: "openclinxr.encounter-local-factory-handoff-preflight.v1",
      source: "encounter_local_factory_operation_manifest",
      handoffMode: "local_filesystem_preflight_only",
      localArtifactChecks: [],
      internallyPaired: true,
      runtimeBridgeAllowed: false,
      learnerLaunchAllowed: false,
      caseDefinedActorRealismLaunchBadges: [],
      evidenceBoundaries: {
        uiLaunchPerformed: false,
        cloudOperationPerformed: false,
        providerExecutionPerformed: false,
        questEvidenceRefreshed: false,
        broadVerificationPerformed: false,
        learnerLaunchEnabled: false,
        productionReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
      },
      claimBoundary: "local_factory_handoff_preflight_not_runtime_execution",
    };

    expect(validateEncounterLocalFactoryHandoffPreflightReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/caseDefinedActorRealismLaunchBadges must include at least one actor badge",
      ]),
    });
  });
});
