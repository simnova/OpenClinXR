import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEncounterLocalFactoryOperationManifest,
  runEncounterLocalFactoryOperationManifestCli,
  validateEncounterLocalFactoryOperationManifest,
} from "./encounter-local-factory-operation-manifest.js";
import type { EncounterLocalLaunchSelectionReport } from "./encounter-local-launch-selection.js";

const launchSelection = (): EncounterLocalLaunchSelectionReport => ({
  generatedAt: "2026-05-23T13:00:00.000Z",
  schemaVersion: "openclinxr.encounter-local-launch-selection.v1",
  selectedScenarioId: "ed_chest_pain_priority_v1",
  selectedEncounterId: "encounter_assets_ed_chest_pain_executable_v1",
  selectedStationId: "ed_chest_pain_station_v1",
  selectedRuntimeAssetBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
  selectionSource: "materialized_publication_payload",
  launchMode: "local_static_public_assets",
  sceneManifestUrl: "/xr-assets/generated/ed_chest_pain_priority_v1/scene-manifest.v1.json",
  learnerRuntimeBundleUrl: "/xr-assets/generated/ed_chest_pain_priority_v1/learner-runtime-bundle.v1.json",
  localFilesystemPaths: {
    sceneManifestPath: ".openclinxr/encounter-publication/local_tenant/ed_chest_pain_priority_v1/ed_chest_pain_encounter_v1/scene-manifest.v1.json",
    learnerRuntimeBundlePath: ".openclinxr/encounter-publication/local_tenant/ed_chest_pain_priority_v1/ed_chest_pain_encounter_v1/learner-runtime-bundle.v1.json",
    uiXrPublicSceneManifestPath: "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/scene-manifest.v1.json",
    uiXrPublicLearnerRuntimeBundlePath: "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/learner-runtime-bundle.v1.json",
  },
  dynamicBehaviorTags: ["dialogue:patient", "gaze:patient"],
  actorRoles: ["patient", "family", "nurse"],
  selectedAssetCounts: { actors: 3, humanoidRuntimeRequirements: 3, equipment: 1, roomProps: 1, uiSurfaces: 0 },
  realismEvidenceRefs: {
    claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
    refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
    requiredBefore: "guarded_runtime_wiring",
    runtimeExecutionAllowed: false,
    providerExecutionPerformed: false,
    questReadinessClaimed: false,
  },
  learnerLaunchAllowed: false,
  blockers: ["runtime_realism_evidence_not_attached", "humanoid_visual_qa_evidence_not_attached", "quest_webxr_evidence_not_attached"],
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

describe("encounter local factory operation manifest", () => {
  it("builds a review-blocked local factory operation manifest from launch selection", () => {
    const report = buildEncounterLocalFactoryOperationManifest(launchSelection(), "2026-05-23T13:30:00.000Z");
    expect(report).toMatchObject({
      generatedAt: "2026-05-23T13:30:00.000Z",
      schemaVersion: "openclinxr.encounter-local-factory-operation-manifest.v1",
      source: "encounter_local_launch_selection",
      selectedScenarioId: "ed_chest_pain_priority_v1",
      operationMode: "local_deterministic_factory_plan_only",
      realismEvidenceRefs: {
        refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
        runtimeExecutionAllowed: false,
        providerExecutionPerformed: false,
        questReadinessClaimed: false,
      },
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      actorRuntimeRealismRequirements: expect.arrayContaining([
        expect.objectContaining({
          actorId: "patient_robert_hayes_v1",
          role: "patient",
          locomotionRequired: true,
          expressionRequired: true,
          gazeRequired: true,
          lipSyncRequired: true,
          interactionRequired: true,
          requiredCueIds: expect.arrayContaining([
            "case_definition_driven_expression_selection",
            "dialogue_viseme_and_gaze_mapping",
            "actor_target_gaze_from_trace_intent",
          ]),
        }),
      ]),
      guardedRuntimeSelectorDecision: {
        schemaVersion: "openclinxr.guarded-runtime-selector-disabled-decision.v1",
        selectionStatus: "blocked_intent_bundle_missing",
        claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
        selectedRuntimeAssetBundleId: "ed_chest_pain_encounter_v1:learner-runtime-bundle:v1",
        selectedBundleId: null,
        selectedBundleIdForFutureRuntime: null,
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
        providerExecutionPerformed: false,
        uiLaunchPerformed: false,
        questEvidenceRefreshed: false,
        blockers: [
          "runtime_selector_disabled_guard_not_wired",
          "provider_execution_disabled_by_policy",
          "learner_launch_disabled_until_evidence_gates_clear",
          "guarded_runtime_intent_bundle_missing",
          "runtime_realism_evidence_not_attached",
          "humanoid_visual_qa_evidence_not_attached",
          "quest_webxr_evidence_not_attached",
        ],
      },
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
    });
    expect(report.factoryOperations).toEqual([
      "read_local_publication_payload_refs",
      "resolve_scene_manifest_and_runtime_bundle_paths",
      "derive_actor_runtime_slots",
      "derive_static_equipment_and_room_slots",
      "derive_dynamic_behavior_trace_slots",
      "prepare_review_blocked_runtime_handoff",
    ]);
    expect(validateEncounterLocalFactoryOperationManifest(report)).toEqual({ ok: true });
  });

  it("writes and validates operation manifests from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-factory-operation-"));
    try {
      const launchPath = path.join(tempDir, "launch-selection.json");
      const outputPath = path.join(tempDir, "factory-operation.json");
      await writeFile(launchPath, `${JSON.stringify(launchSelection(), null, 2)}\n`, "utf8");
      await runEncounterLocalFactoryOperationManifestCli(["--launch-selection", launchPath, "--output", outputPath]);
      await expect(runEncounterLocalFactoryOperationManifestCli(["--validate", outputPath])).resolves.toBeUndefined();
      await expect(readFile(outputPath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        source: "encounter_local_launch_selection",
        runtimeExecutionAllowed: false,
        guardedRuntimeSelectorDecision: {
          runtimeExecutionAllowed: false,
          learnerLaunchAllowed: false,
          providerExecutionPerformed: false,
          uiLaunchPerformed: false,
          questEvidenceRefreshed: false,
        },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
