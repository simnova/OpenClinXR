import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEncounterRuntimeSelectionReviewPacket,
  runEncounterRuntimeSelectionReviewPacketCli,
  validateEncounterRuntimeSelectionReviewPacket,
} from "./encounter-runtime-selection-review-packet.js";
import type { EncounterGuardedRuntimeSelectionIntent } from "./encounter-guarded-runtime-selection-intent.js";

const selectionIntent = (): EncounterGuardedRuntimeSelectionIntent => ({
  generatedAt: "2026-05-23T14:30:00.000Z",
  schemaVersion: "openclinxr.encounter-guarded-runtime-selection-intent.v1",
  source: "encounter_local_factory_handoff_preflight",
  selectionMode: "guarded_runtime_selection_intent_only",
  selectedScenarioId: "ed_chest_pain_priority_v1",
  selectedEncounterId: "encounter_assets_ed_chest_pain_executable_v1",
  selectedStationId: "ed_chest_pain_station_v1",
  selectedRuntimeAssetBundleId: "encounter_assets_ed_chest_pain_executable_v1:runtime-selection-intent",
  handoffArtifactsInternallyPaired: true,
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
  modelRuntimeCandidate: "local_configured_not_executed",
  voiceRuntimeCandidate: "local_configured_not_executed",
  runtimeExecutionAllowed: false,
  learnerLaunchAllowed: false,
  providerExecutionPerformed: false,
  uiLaunchPerformed: false,
  questEvidenceRefreshed: false,
  broadVerificationPerformed: false,
  blockers: [
    "runtime_selector_disabled_guard_not_wired",
    "provider_execution_disabled_by_policy",
    "learner_launch_disabled_until_evidence_gates_clear",
  ],
  nextAllowedStep: "wire_runtime_selector_behind_disabled_guard",
  claimBoundary: "guarded_runtime_selection_intent_not_runtime_execution",
});

const publicationPayloads = () => ({
  schemaVersion: "openclinxr.encounter-publication-payloads.v1",
  status: "blocked",
  blockers: ["humanoid_realism_requirement_actor_missing:family"],
  localMaterializationHandoffManifest: {
    schemaVersion: "openclinxr.worker-materialization-plan.v1",
    requestId: "encounter_assets_ed_chest_pain_priority_executable_v1",
    scenarioId: "ed_chest_pain_priority_v2",
    rootPath: ".openclinxr/encounter-factory/ed_chest_pain_priority_v2/encounter_assets_ed_chest_pain_priority_executable_v1",
    outputs: [
      {
        workOrderId: "patient-humanoid",
        generatedAssetsMaterialized: false,
        claimBoundary: "planned_metadata_only",
      },
      {
        workOrderId: "patient-animation",
        generatedAssetsMaterialized: false,
        claimBoundary: "planned_metadata_only",
      },
    ],
  },
  encounterAssetNeedsReadinessManifest: {
    readyForDeterministicGeneration: true,
    missingRequiredAssetNeedIds: [],
    blockers: [],
    requiredHumanoids: [
      { actorRole: "patient" },
      { actorRole: "family" },
      { actorRole: "nurse" },
    ],
    animationRequirements: [{ id: "clinical_idle_animation" }],
    emotionRequirements: [{ id: "emotion_tone_continuity" }],
    gazeRequirements: [{ id: "speaker_targeting" }],
    lipSyncRequirements: [{ id: "viseme_phoneme_map" }],
    sharedAssetLibrarySemanticKeys: ["role_specific_humanoid_glb__patient"],
  },
  realismEvidenceRefs: {
    schemaVersion: "openclinxr.encounter-publication-realism-evidence-refs.v1",
    claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
    runtimeExecutionAllowed: false,
    providerExecutionPerformed: false,
    questReadinessClaimed: false,
    refs: [
      { refId: "humanoid-realism-gate", evidenceRef: "encounter-publication-realism://scenario/request/humanoid-realism-gate/3-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] },
      { refId: "runtime-realism-evidence-check", evidenceRef: "encounter-publication-realism://scenario/request/runtime-realism-evidence-check/3-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] },
      { refId: "visual-qa-evidence-check", evidenceRef: "encounter-publication-realism://scenario/request/visual-qa-evidence-check/3-actors", requiredBefore: "guarded_runtime_wiring", status: "required_not_attached", notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] },
    ],
  },
});

describe("encounter runtime selection review packet", () => {
  it("builds a read-only review packet from guarded runtime selection intent", () => {
    const packet = buildEncounterRuntimeSelectionReviewPacket(selectionIntent(), "2026-05-23T15:00:00.000Z", publicationPayloads());
    expect(packet).toMatchObject({
      generatedAt: "2026-05-23T15:00:00.000Z",
      schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
      source: "encounter_guarded_runtime_selection_intent",
      reviewPacketMode: "read_only_guarded_runtime_handoff",
      selectedScenarioId: "ed_chest_pain_priority_v1",
      runtimeCandidates: {
        model: "local_configured_not_executed",
        voice: "local_configured_not_executed",
      },
      guardedRuntimeSelectorDecision: {
        claimBoundary: "guarded_runtime_selector_seam_not_runtime_execution",
        runtimeExecutionAllowed: false,
        learnerLaunchAllowed: false,
      },
      runtimeExecutionAllowed: false,
      learnerLaunchAllowed: false,
      providerExecutionPerformed: false,
      uiLaunchPerformed: false,
      questEvidenceRefreshed: false,
      broadVerificationPerformed: false,
      nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
      claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
      notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
      publicationPayloadLinkage: {
        source: "encounter_publication_payloads",
        status: "blocked",
        blockers: ["humanoid_realism_requirement_actor_missing:family"],
        localMaterializationHandoff: {
          requestId: "encounter_assets_ed_chest_pain_priority_executable_v1",
          scenarioId: "ed_chest_pain_priority_v2",
          plannedOutputCount: 2,
          materializedOutputCount: 0,
          allOutputsPlannedMetadataOnly: true,
        },
        assetNeedsReadiness: {
          readyForDeterministicGeneration: true,
          requiredHumanoidRoles: ["patient", "family", "nurse"],
          animationRequirementCount: 1,
          emotionRequirementCount: 1,
          gazeRequirementCount: 1,
          lipSyncRequirementCount: 1,
          sharedAssetLibrarySemanticKeyCount: 1,
        },
        realismEvidenceRefs: {
          claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence",
          refIds: ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"],
          refs: expect.arrayContaining([
            expect.objectContaining({
              refId: "humanoid-realism-gate",
              evidenceRef: "encounter-publication-realism://scenario/request/humanoid-realism-gate/3-actors",
              requiredBefore: "guarded_runtime_wiring",
              status: "required_not_attached",
            }),
          ]),
          requiredBefore: "guarded_runtime_wiring",
          runtimeExecutionAllowed: false,
          providerExecutionPerformed: false,
          questReadinessClaimed: false,
        },
      },
      operatorReviewReadiness: {
        status: "not_ready_for_operator_review",
        reviewedArtifactCount: 4,
        blockingArtifactCount: 6,
        blockerIds: expect.arrayContaining([
          "runtime_selector_disabled_guard_not_wired",
          "publication_payload_not_materialized",
          "humanoid_realism_requirement_actor_missing:family",
        ]),
        requiredOperatorActions: expect.arrayContaining([
          "materialize_or_attach_generated_assets_before_guarded_runtime_wiring",
          "attach_humanoid_runtime_visual_qa_evidence_refs",
          "confirm_provider_execution_remains_disabled_until_explicit_approval",
          "confirm_runtime_selector_remains_disabled_until_evidence_gates_clear",
        ]),
        materializationRequiredBeforeRuntime: true,
        providerExecutionAllowed: false,
        runtimeExecutionAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "operator_review_readiness_metadata_only",
      },
    });
    expect(packet.runtimeCandidates).not.toEqual({ model: "mock", voice: "mock" });
    expect(packet.notEvidenceFor).toEqual(expect.arrayContaining([
      "provider_availability",
      "runtime_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "learner_launch_readiness",
    ]));
    expect(packet.reviewerChecklist.map((check) => check.checkId)).toEqual([
      "confirm_selector_guard_remains_disabled",
      "confirm_provider_execution_disabled",
      "confirm_learner_launch_blocked",
      "confirm_no_readiness_claims",
    ]);
    expect(packet.blockers).toEqual(expect.arrayContaining([
      "runtime_selector_disabled_guard_not_wired",
      "provider_execution_disabled_by_policy",
      "learner_launch_disabled_until_evidence_gates_clear",
      "guarded_runtime_intent_bundle_missing",
      "publication_payload_not_materialized",
      "humanoid_realism_requirement_actor_missing:family",
    ]));
    expect(validateEncounterRuntimeSelectionReviewPacket(packet)).toEqual({ ok: true });
  });

  it("writes and validates runtime selection review packets from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-runtime-selection-review-"));
    try {
      const intentPath = path.join(tempDir, "selection-intent.json");
      const publicationPath = path.join(tempDir, "publication-payloads.json");
      const outputPath = path.join(tempDir, "review-packet.json");
      await writeFile(intentPath, `${JSON.stringify(selectionIntent(), null, 2)}\n`, "utf8");
      await writeFile(publicationPath, `${JSON.stringify(publicationPayloads(), null, 2)}\n`, "utf8");
      await runEncounterRuntimeSelectionReviewPacketCli(["--selection-intent", intentPath, "--publication-payloads", publicationPath, "--output", outputPath]);
      await expect(runEncounterRuntimeSelectionReviewPacketCli(["--validate", outputPath])).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
