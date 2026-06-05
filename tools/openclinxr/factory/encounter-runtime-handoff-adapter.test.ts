import { describe, expect, it } from "vitest";
import type { EncounterLocalLaunchSelectionReport } from "./encounter-local-launch-selection.js";
import { buildEncounterRuntimeHandoffAdapterReport } from "./encounter-runtime-handoff-adapter.js";

const launchSelection = (): EncounterLocalLaunchSelectionReport => ({
  generatedAt: "2026-05-26T14:45:00.000Z",
  schemaVersion: "openclinxr.encounter-local-launch-selection.v1",
  selectedScenarioId: "peds_asthma_parent_anxiety_v1",
  selectedEncounterId: "encounter_assets_peds_asthma_executable_v1",
  selectedStationId: "pediatric_urgent_care_station_v1",
  selectedRuntimeAssetBundleId: "peds_asthma_parent_anxiety_v1:learner-runtime-bundle:v1",
  selectionSource: "materialized_publication_payload",
  launchMode: "local_static_public_assets",
  sceneManifestUrl: "/xr-assets/generated/peds_asthma_parent_anxiety_v1/scene-manifest.v1.json",
  learnerRuntimeBundleUrl: "/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json",
  localFilesystemPaths: {
    sceneManifestPath: ".openclinxr/encounter-publication/local_tenant/peds_asthma_parent_anxiety_v1/encounter_assets_peds_asthma_executable_v1/scene-manifest.v1.json",
    learnerRuntimeBundlePath: ".openclinxr/encounter-publication/local_tenant/peds_asthma_parent_anxiety_v1/encounter_assets_peds_asthma_executable_v1/learner-runtime-bundle.v1.json",
    uiXrPublicSceneManifestPath: "apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/scene-manifest.v1.json",
    uiXrPublicLearnerRuntimeBundlePath: "apps/ui-xr/public/xr-assets/generated/peds_asthma_parent_anxiety_v1/learner-runtime-bundle.v1.json",
  },
  dynamicBehaviorTags: ["dialogue:patient", "dialogue:family", "dialogue:nurse", "gaze:patient", "affect:patient"],
  actorRoles: ["patient", "family", "nurse"],
  selectedAssetCounts: {
    actors: 3,
    humanoidRuntimeRequirements: 3,
    equipment: 6,
    roomProps: 1,
    uiSurfaces: 0,
  },
  launchContract: {
    schemaVersion: "openclinxr.case-definition-driven-webxr-launch-contract.v1",
    contractId: "encounter_assets_peds_asthma_executable_v1:webxr-launch-contract:v1",
    status: "blocked_pending_evidence",
    selectedScenarioId: "peds_asthma_parent_anxiety_v1",
    selectedEncounterId: "encounter_assets_peds_asthma_executable_v1",
    selectedStationId: "pediatric_urgent_care_station_v1",
    runtimeAssetBundleId: "peds_asthma_parent_anxiety_v1:learner-runtime-bundle:v1",
    actorRoster: [
      { actorId: "patient_maya_johnson_v1", actorRole: "patient", modelAssetId: "patient_maya_johnson_character", source: "learner_runtime_bundle_humanoid_requirement" },
      { actorId: "parent_tara_johnson_v1", actorRole: "family", modelAssetId: "parent_tara_johnson_character", source: "learner_runtime_bundle_humanoid_requirement" },
      { actorId: "nurse_kevin_lee_v1", actorRole: "nurse", modelAssetId: "nurse_kevin_lee_character", source: "learner_runtime_bundle_humanoid_requirement" },
    ],
    caseDefinedActorRealismRequirements: ["patient", "family", "nurse"].map((actorRole, index) => ({
      actorId: ["patient_maya_johnson_v1", "parent_tara_johnson_v1", "nurse_kevin_lee_v1"][index] ?? actorRole,
      actorRole,
      sourceWorkOrderIds: [`${actorRole}:role_specific_humanoid_glb`, `${actorRole}:role_idle_animation_glb`],
      requiredSignalIds: [
        "animated_humanoid_runtime_playback",
        "emotion_aligned_expression_transition_cue",
        "dialogue_viseme_and_gaze_mapping",
        "dialogue_eye_micro_saccade_blink_cue",
        "generated_eyelid_blink_control_cue",
      ],
      locomotionRequired: true,
      expressionRequired: true,
      gazeRequired: true,
      lipSyncRequired: true,
      interactiveRequired: true,
      claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
    })),
    actorRealismLaunchBadges: ["patient", "family", "nurse"].map((actorRole, index) => ({
      actorId: ["patient_maya_johnson_v1", "parent_tara_johnson_v1", "nurse_kevin_lee_v1"][index] ?? actorRole,
      actorRole,
      status: "realismBlocked",
      blockers: [
        "actor_specific_humanoid_realism_gate_not_attached",
        "runtime_realism_evidence_not_attached",
        "humanoid_visual_qa_evidence_not_attached",
      ],
      claimBoundary: "actor_specific_humanoid_gate_required_before_runtime_launch",
    })),
    caseDefinitionCoverage: {
      actorRolesCovered: true,
      traceTagsCovered: true,
      equipmentPlacementsPresent: true,
      assetNeedsCarriedByWorkOrders: true,
      blockers: [],
    },
    launchBlockingReasons: [
      "actor_specific_humanoid_realism_gate_not_attached",
      "runtime_realism_evidence_not_attached",
      "humanoid_visual_qa_evidence_not_attached",
      "quest_webxr_evidence_not_attached",
    ],
    notEvidenceFor: ["runtime_readiness", "quest_readiness", "production_readiness", "clinical_validity", "scoring_validity"],
  },
  pedsRuntimeMaterializationHandoff: {
    schemaVersion: "openclinxr.peds-runtime-materialization-handoff-summary.v1",
    source: "publication_payload_pedsHumanoidMaterializationHandoff",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    handoffAssetCount: 2,
    actorRuntimeAssetPreferences: [
      {
        actorRole: "patient",
        runtimeAssetPath: "/generated-humanoids/peds_patient_child.glb",
        provenanceManifestPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json",
        realAnnyWeightsUsed: false,
        realismGrade: "B",
        promotionStatus: "runtime_candidate_not_realism_gate_pass",
        claimBoundary: "metadata_only_runtime_asset_preference_not_readiness",
      },
      {
        actorRole: "anxious_parent",
        runtimeAssetPath: "/generated-humanoids/peds_anxious_parent.glb",
        provenanceManifestPath: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.provenance.json",
        realAnnyWeightsUsed: false,
        realismGrade: "B",
        promotionStatus: "runtime_candidate_not_realism_gate_pass",
        claimBoundary: "metadata_only_runtime_asset_preference_not_readiness",
      },
    ],
    generatedAssetsMaterialized: true,
    localCandidateAssetsSelected: true,
    productionReadinessClaimed: false,
    questReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "peds_humanoid_materialization_handoff_summary_metadata_only",
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

describe("encounter runtime handoff adapter", () => {
  it("keeps pediatric asthma launch handoff blocked while preserving actor-specific requirements", () => {
    const report = buildEncounterRuntimeHandoffAdapterReport(launchSelection(), {}, "2026-05-26T14:50:00.000Z");

    expect(report).toMatchObject({
      generatedAt: "2026-05-26T14:50:00.000Z",
      schemaVersion: "openclinxr.evidence-gated-runtime-handoff-adapter.v1",
      sourceLaunchContractId: "encounter_assets_peds_asthma_executable_v1:webxr-launch-contract:v1",
      selectedScenarioId: "peds_asthma_parent_anxiety_v1",
      status: "launchBlocked",
      learnerLaunchAllowed: false,
      localRuntimeHandoffAllowed: false,
      evidenceGates: {
        runtimeRealismEvidenceAttached: false,
        humanoidVisualQaEvidenceAttached: false,
        questWebxrEvidenceAttached: false,
        providerExecutionApproved: false,
        providerExecutionConfigured: false,
      },
      pedsRuntimeMaterializationHandoff: {
        schemaVersion: "openclinxr.peds-runtime-materialization-handoff-summary.v1",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        handoffAssetCount: 2,
        actorRuntimeAssetPreferences: [
          expect.objectContaining({
            actorRole: "patient",
            runtimeAssetPath: "/generated-humanoids/peds_patient_child.glb",
            realAnnyWeightsUsed: false,
            realismGrade: "B",
          }),
          expect.objectContaining({
            actorRole: "anxious_parent",
            runtimeAssetPath: "/generated-humanoids/peds_anxious_parent.glb",
            realAnnyWeightsUsed: false,
            realismGrade: "B",
          }),
        ],
        productionReadinessClaimed: false,
        questReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
        claimBoundary: "peds_humanoid_materialization_handoff_summary_metadata_only",
      },
      blockers: expect.arrayContaining([
        "case_defined_humanoid_realism_evidence_missing",
        "runtime_realism_evidence_missing",
        "humanoid_visual_qa_evidence_missing",
        "quest_webxr_foreground_evidence_missing",
        "provider_execution_not_approved_or_configured",
      ]),
      claimBoundary: "runtime_handoff_adapter_not_learner_launch",
    });
    expect(report.actorRuntimeHandoffs).toHaveLength(3);
    expect(report.actorRuntimeHandoffs[0]).toMatchObject({
      actorId: "patient_maya_johnson_v1",
      actorRole: "patient",
      actorHumanoidGateEvidenceAttached: false,
      launchBadgeStatus: "realismBlocked",
      blockers: expect.arrayContaining(["case_defined_humanoid_realism_evidence_missing"]),
      requiredSignalIds: expect.arrayContaining([
        "animated_humanoid_runtime_playback",
        "emotion_aligned_expression_transition_cue",
        "dialogue_viseme_and_gaze_mapping",
      ]),
    });
    expect(report.notEvidenceFor).toEqual(["quest_readiness", "production_readiness", "clinical_validity", "scoring_validity", "provider_readiness"]);
  });

  it("allows only local runtime handoff when mock runtime evidence is attached while Quest/provider claims stay blocked", () => {
    const report = buildEncounterRuntimeHandoffAdapterReport(launchSelection(), {
      runtimeRealismEvidenceAttached: true,
      humanoidVisualQaEvidenceAttached: true,
      questWebxrEvidenceAttached: false,
      providerExecutionApproved: false,
      providerExecutionConfigured: false,
      actorHumanoidGateEvidenceAttachedActorIds: [
        "patient_maya_johnson_v1",
        "parent_tara_johnson_v1",
        "nurse_kevin_lee_v1",
      ],
    });

    expect(report.status).toBe("localRuntimeHandoffReadyQuestBlocked");
    expect(report.localRuntimeHandoffAllowed).toBe(true);
    expect(report.learnerLaunchAllowed).toBe(false);
    expect(report.evidenceGates).toMatchObject({
      runtimeRealismEvidenceAttached: true,
      humanoidVisualQaEvidenceAttached: true,
      questWebxrEvidenceAttached: false,
      providerExecutionApproved: false,
      providerExecutionConfigured: false,
    });
    expect(report.actorRuntimeHandoffs.every((handoff) => handoff.actorHumanoidGateEvidenceAttached)).toBe(true);
    expect(report.blockers).toEqual(expect.arrayContaining([
      "quest_webxr_foreground_evidence_missing",
      "provider_execution_not_approved_or_configured",
    ]));
    expect(report.notEvidenceFor).toContain("quest_readiness");
    expect(report.notEvidenceFor).toContain("provider_readiness");
  });
});
