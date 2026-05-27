import { describe, expect, it } from "vitest";
import {
  buildEncounterDynamicBehaviorCoverageSummary,
  buildEncounterFactoryDryRunSummary,
  buildEncounterFactoryInputPlanningSummary,
  buildEncounterFactorySummaryContracts,
  buildGuardedRuntimeSelectorDisabledDecision,
  buildEncounterRuntimeAssetBundle,
  createEdChestPainLocalLearnerRuntimeAssetBundle,
} from "./index.js";

describe("encounter factory summary contracts", () => {
  it("builds aligned dynamic behavior coverage and dry-run summary objects", () => {
    const learnerRuntimeBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const actorRoles = learnerRuntimeBundle.actors
      .filter((actor) => actor.embodiment !== "virtual_device" && actor.embodiment !== "voice_only")
      .map((actor) => actor.role);

    const contracts = buildEncounterFactorySummaryContracts({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      scenarioId: "ed_chest_pain_priority_v1",
      learnerRuntimeBundle,
      actorRoles,
      requiredActorRoles: actorRoles,
    });

    expect(contracts.encounterFactoryDryRunSummary).toEqual(
      buildEncounterFactoryDryRunSummary({
        requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
        scenarioId: "ed_chest_pain_priority_v1",
        learnerRuntimeBundle,
        actorRoles,
        requiredActorRoles: actorRoles,
      }),
    );
  });

  it("reuses injected dynamic behavior coverage when provided", () => {
    const requiredActorRoles = ["patient", "nurse", "family_member"];
    const providedCoverage = buildEncounterDynamicBehaviorCoverageSummary({
      learnerRuntimeBundle: null,
      requiredActorRoles,
      scenarioId: "ed_chest_pain_priority_v1",
    });
    const contracts = buildEncounterFactorySummaryContracts({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      scenarioId: "ed_chest_pain_priority_v1",
      actorRoles: requiredActorRoles,
      requiredActorRoles,
      learnerRuntimeBundle: null,
      dynamicBehaviorCoverage: providedCoverage,
      reviewAttached: false,
    });

    expect(contracts.dynamicBehaviorCoverage).toBe(providedCoverage);
    expect(contracts.encounterFactoryDryRunSummary).toEqual(
      buildEncounterFactoryDryRunSummary({
        requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
        scenarioId: "ed_chest_pain_priority_v1",
        actorRoles: requiredActorRoles,
        requiredActorRoles,
        learnerRuntimeBundle: null,
        dynamicBehaviorCoverage: providedCoverage,
        reviewAttached: false,
      }),
    );
    expect(contracts.encounterFactoryDryRunSummary.status).toBe("blocked_pending_runtime_bundle");
    expect(contracts.encounterFactoryDryRunSummary.blockerIds).toEqual(expect.arrayContaining([
      "runtime_bundle_missing_for_behavior_coverage:ed_chest_pain_priority_v1",
    ]));
  });

  it("adapts scenario-derived encounter factory input into provider-free asset planning metadata", () => {
    const encounterFactoryInputSummary = {
      source: "scenario_definition_and_dialogue_seed_bank" as const,
      scenarioBankOrder: 2,
      factorySelectionRole: "next_factory_planning_scenario" as const,
      factorySelectionMode: "next_scenario_fallback" as const,
      factorySelectionClaimBoundary: "review_gated_factory_metadata_only" as const,
      actorAssetWorkOrderCount: 3,
      environmentAssetWorkOrderCount: 1,
      equipmentAssetWorkOrderCount: 6,
      sharedAssetLookupKeys: [
        "semantic::actor::patient::patient_maya_johnson_v1",
        "semantic::environment::pediatric_urgent_care_bay_v1",
        "semantic::equipment::nebulizer_mask",
      ],
      dynamicBehaviorTraceTags: ["oxygen_request", "parent_communication", "urgent_escalation"],
    };

    const inputPlanningSummary = buildEncounterFactoryInputPlanningSummary({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      encounterFactoryInputSummary,
    });
    const contracts = buildEncounterFactorySummaryContracts({
      requestId: "scene_generation_request:peds_asthma_parent_anxiety_v1:local-admin",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      actorRoles: ["patient", "family", "nurse"],
      requiredActorRoles: ["patient", "family", "nurse"],
      learnerRuntimeBundle: null,
      encounterFactoryInputSummary,
      reviewAttached: false,
    });

    expect(inputPlanningSummary).toEqual({
      schemaVersion: "openclinxr.encounter-factory-input-planning-summary.v1",
      claimBoundary: "metadata_only_not_asset_generation",
      source: "scenario_definition_and_dialogue_seed_bank",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      assetWorkOrderIntent: {
        actor: 3,
        environment: 1,
        equipment: 6,
        total: 10,
      },
      sharedAssetLibraryReuse: {
        cacheDisposition: "lookup_before_generate",
        lookupKeyCount: 3,
        lookupKeys: encounterFactoryInputSummary.sharedAssetLookupKeys,
        requiresEvidenceGateCompatibility: true,
      },
      dynamicBehaviorTraceTags: encounterFactoryInputSummary.dynamicBehaviorTraceTags,
      factorySelectionMetadata: {
        scenarioBankOrder: 2,
        factorySelectionRole: "next_factory_planning_scenario",
        factorySelectionMode: "next_scenario_fallback",
        factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
      },
      blockerIds: [],
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    });
    expect(contracts.inputPlanningSummary).toEqual(inputPlanningSummary);
    expect(contracts.encounterFactoryDryRunSummary.claimBoundary).toBe("encounter_factory_dry_run_not_asset_generation");
    expect(contracts.encounterFactoryDryRunSummary.evidenceBoundaries.generatedAssetsMaterialized).toBe(false);
  });

  it("carries provider-disabled remediation plan refs without unblocking learner runtime use", () => {
    const sourceBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const remediationPlanRefs: import("./index.js").EncounterRuntimeRemediationPlanAuditRef[] = [
      {
        planRefId: "visual-remediation-plan:ed:patient:gaze",
        dimension: "gaze" as const,
        sourceWorkOrderRef: "encounter_assets_ed_chest_pain_001:patient:facial-lipsync-gaze",
        executionStatus: "metadata_only_not_executed" as const,
        providerRoutesRequireExplicitApproval: true as const,
        learnerUseBlockedUntilEvidenceGatesAttach: true as const,
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
    ];
    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: sourceBundle.bundleId,
      tenantId: "tenant_alpha",
      userId: "learner_alpha",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      stationId: sourceBundle.stationId,
      scenarioId: sourceBundle.scenarioId,
      assetStore: {
        storeKind: sourceBundle.assetStoreKind,
        containerName: "openclinxr-assets",
      },
      environment: sourceBundle.environment,
      actors: sourceBundle.actors,
      equipment: sourceBundle.equipment,
      uiSurfaces: sourceBundle.uiSurfaces,
      sceneManifest: sourceBundle.sceneManifest,
      evidenceGateRefs: sourceBundle.evidenceGateRefs,
      remediationPlanRefs,
    });

    expect(bundle.assemblyAuditMetadata.remediationPlanRefs).toEqual(remediationPlanRefs);
    expect(bundle.assemblyAuditMetadata.remediationPlanRefs[0]?.executionStatus).toBe("metadata_only_not_executed");
    expect(bundle.assemblyAuditMetadata.remediationPlanRefs[0]?.notEvidenceFor).toContain("quest_readiness");
    expect(bundle.evidenceGateRefs.some((gateRef) => gateRef.status === "pending")).toBe(true);
  });

  it("builds a guarded disabled runtime selector decision for matching bundle intent", () => {
    const learnerRuntimeBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const decision = buildGuardedRuntimeSelectorDisabledDecision({
      selectedRuntimeAssetBundleId: learnerRuntimeBundle.bundleId,
      selectedScenarioId: learnerRuntimeBundle.scenarioId,
      selectedStationId: learnerRuntimeBundle.stationId,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      candidateBundles: [learnerRuntimeBundle],
    });

    expect(decision).toMatchObject({
      schemaVersion: "openclinxr.guarded-runtime-selector-disabled-decision.v1",
      selectionStatus: "disabled_guard_not_runtime_execution",
      claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
      selectedBundleId: null,
      selectedBundleIdForFutureRuntime: learnerRuntimeBundle.bundleId,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
    });
    expect(decision.matchedBundleSummary).toMatchObject({
      bundleId: learnerRuntimeBundle.bundleId,
      scenarioId: learnerRuntimeBundle.scenarioId,
      stationId: learnerRuntimeBundle.stationId,
      assetStoreKind: "app_public_fixture",
      attachedEvidenceGateIds: [],
    });
    expect(decision.matchedBundleSummary?.pendingEvidenceGateIds).toEqual([
      "runtime_realism_evidence",
      "visual_qa_evidence",
      "quest_runtime_evidence",
    ]);
    expect(decision.blockers).toEqual(expect.arrayContaining([
      "runtime_selector_disabled_guard_not_wired",
      "provider_execution_disabled_by_policy",
      "learner_launch_disabled_until_evidence_gates_clear",
      "runtime_realism_evidence_not_attached_to_encounter_bundle",
      "visual_qa_evidence_not_attached_to_encounter_bundle",
      "quest_runtime_evidence_not_attached_to_encounter_bundle",
    ]));
    expect(decision.notEvidenceFor).toEqual([
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ]);
  });

  it("blocks guarded runtime selector intent when bundle scenario or station does not match", () => {
    const learnerRuntimeBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const decision = buildGuardedRuntimeSelectorDisabledDecision({
      selectedRuntimeAssetBundleId: learnerRuntimeBundle.bundleId,
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      selectedStationId: learnerRuntimeBundle.stationId,
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      candidateBundles: [learnerRuntimeBundle],
    });

    expect(decision.selectionStatus).toBe("blocked_intent_bundle_mismatch");
    expect(decision.selectedBundleId).toBeNull();
    expect(decision.selectedBundleIdForFutureRuntime).toBeNull();
    expect(decision.matchedBundleSummary).toBeNull();
    expect(decision.runtimeExecutionAllowed).toBe(false);
    expect(decision.learnerLaunchAllowed).toBe(false);
    expect(decision.providerExecutionPerformed).toBe(false);
    expect(decision.uiLaunchPerformed).toBe(false);
    expect(decision.blockers).toEqual(expect.arrayContaining([
      "runtime_selector_disabled_guard_not_wired",
      "guarded_runtime_intent_bundle_scenario_station_mismatch",
    ]));
  });

  it("blocks guarded runtime selector intent when no candidate bundle is available", () => {
    const decision = buildGuardedRuntimeSelectorDisabledDecision({
      selectedRuntimeAssetBundleId: "missing-runtime-bundle",
      selectedScenarioId: "ed_chest_pain_priority_v1",
      selectedStationId: "ed_chest_pain_station_v1",
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      candidateBundles: [],
    });

    expect(decision.selectionStatus).toBe("blocked_intent_bundle_missing");
    expect(decision.selectedBundleId).toBeNull();
    expect(decision.selectedBundleIdForFutureRuntime).toBeNull();
    expect(decision.matchedBundleSummary).toBeNull();
    expect(decision.blockers).toEqual(expect.arrayContaining([
      "runtime_selector_disabled_guard_not_wired",
      "guarded_runtime_intent_bundle_missing",
    ]));
    expect(decision.notEvidenceFor).toEqual([
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
    ]);
  });
});
