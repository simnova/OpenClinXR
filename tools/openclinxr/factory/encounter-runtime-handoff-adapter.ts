import type { EncounterLocalLaunchSelectionReport } from "./encounter-local-launch-selection.js";

export type EncounterRuntimeHandoffEvidence = {
  runtimeRealismEvidenceAttached?: boolean;
  humanoidVisualQaEvidenceAttached?: boolean;
  questWebxrEvidenceAttached?: boolean;
  providerExecutionApproved?: boolean;
  providerExecutionConfigured?: boolean;
  actorHumanoidGateEvidenceAttachedActorIds?: string[];
};

export type EncounterRuntimeHandoffAdapterReport = {
  generatedAt: string;
  schemaVersion: "openclinxr.evidence-gated-runtime-handoff-adapter.v1";
  sourceLaunchContractId: string;
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  runtimeAssetBundleId: string;
  status: "launchBlocked" | "localRuntimeHandoffReadyQuestBlocked";
  learnerLaunchAllowed: false;
  localRuntimeHandoffAllowed: boolean;
  actorRuntimeHandoffs: Array<{
    actorId: string;
    actorRole: string;
    requiredSignalIds: string[];
    locomotionRequired: boolean;
    expressionRequired: boolean;
    gazeRequired: boolean;
    lipSyncRequired: boolean;
    interactiveRequired: boolean;
    actorHumanoidGateEvidenceAttached: boolean;
    launchBadgeStatus: "realismBlocked";
    blockers: string[];
    claimBoundary: "actor_runtime_handoff_requires_attached_humanoid_evidence";
  }>;
  evidenceGates: {
    runtimeRealismEvidenceAttached: boolean;
    humanoidVisualQaEvidenceAttached: boolean;
    questWebxrEvidenceAttached: boolean;
    providerExecutionApproved: boolean;
    providerExecutionConfigured: boolean;
  };
  pedsRuntimeMaterializationHandoff?: NonNullable<EncounterLocalLaunchSelectionReport["pedsRuntimeMaterializationHandoff"]>;
  blockers: string[];
  notEvidenceFor: Array<"quest_readiness" | "production_readiness" | "clinical_validity" | "scoring_validity" | "provider_readiness">;
  claimBoundary: "runtime_handoff_adapter_not_learner_launch";
};

export function buildEncounterRuntimeHandoffAdapterReport(
  launchSelection: EncounterLocalLaunchSelectionReport,
  evidence: EncounterRuntimeHandoffEvidence = {},
  generatedAt = new Date().toISOString(),
): EncounterRuntimeHandoffAdapterReport {
  const attachedActorIds = new Set(evidence.actorHumanoidGateEvidenceAttachedActorIds ?? []);
  const badgeByActor = new Map(launchSelection.launchContract.actorRealismLaunchBadges
    .map((badge) => [`${badge.actorRole}:${badge.actorId}`, badge]));
  const actorRuntimeHandoffs = launchSelection.launchContract.caseDefinedActorRealismRequirements.map((requirement) => {
    const badge = badgeByActor.get(`${requirement.actorRole}:${requirement.actorId}`);
    const actorHumanoidGateEvidenceAttached = attachedActorIds.has(requirement.actorId);
    return {
      actorId: requirement.actorId,
      actorRole: requirement.actorRole,
      requiredSignalIds: [...requirement.requiredSignalIds],
      locomotionRequired: requirement.locomotionRequired,
      expressionRequired: requirement.expressionRequired,
      gazeRequired: requirement.gazeRequired,
      lipSyncRequired: requirement.lipSyncRequired,
      interactiveRequired: requirement.interactiveRequired,
      actorHumanoidGateEvidenceAttached,
      launchBadgeStatus: "realismBlocked" as const,
      blockers: uniqueStrings([
        ...(badge?.blockers ?? ["actor_specific_humanoid_realism_gate_not_attached"]),
        ...(actorHumanoidGateEvidenceAttached ? [] : ["case_defined_humanoid_realism_evidence_missing"]),
      ]),
      claimBoundary: "actor_runtime_handoff_requires_attached_humanoid_evidence" as const,
    };
  });
  const evidenceGates = {
    runtimeRealismEvidenceAttached: evidence.runtimeRealismEvidenceAttached === true,
    humanoidVisualQaEvidenceAttached: evidence.humanoidVisualQaEvidenceAttached === true,
    questWebxrEvidenceAttached: evidence.questWebxrEvidenceAttached === true,
    providerExecutionApproved: evidence.providerExecutionApproved === true,
    providerExecutionConfigured: evidence.providerExecutionConfigured === true,
  };
  const actorGateMissing = actorRuntimeHandoffs.some((handoff) => !handoff.actorHumanoidGateEvidenceAttached);
  const blockers = uniqueStrings([
    ...launchSelection.launchContract.launchBlockingReasons,
    ...(actorRuntimeHandoffs.length === 0 ? ["case_defined_actor_realism_requirements_missing"] : []),
    ...(actorGateMissing ? ["case_defined_humanoid_realism_evidence_missing"] : []),
    ...(evidenceGates.runtimeRealismEvidenceAttached ? [] : ["runtime_realism_evidence_missing"]),
    ...(evidenceGates.humanoidVisualQaEvidenceAttached ? [] : ["humanoid_visual_qa_evidence_missing"]),
    ...(evidenceGates.questWebxrEvidenceAttached ? [] : ["quest_webxr_foreground_evidence_missing"]),
    ...(evidenceGates.providerExecutionApproved && evidenceGates.providerExecutionConfigured ? [] : ["provider_execution_not_approved_or_configured"]),
  ]);
  const localRuntimeHandoffAllowed = actorRuntimeHandoffs.length > 0
    && !actorGateMissing
    && evidenceGates.runtimeRealismEvidenceAttached
    && evidenceGates.humanoidVisualQaEvidenceAttached;
  return {
    generatedAt,
    schemaVersion: "openclinxr.evidence-gated-runtime-handoff-adapter.v1",
    sourceLaunchContractId: launchSelection.launchContract.contractId,
    selectedScenarioId: launchSelection.selectedScenarioId,
    selectedEncounterId: launchSelection.selectedEncounterId,
    selectedStationId: launchSelection.selectedStationId,
    runtimeAssetBundleId: launchSelection.selectedRuntimeAssetBundleId,
    status: localRuntimeHandoffAllowed ? "localRuntimeHandoffReadyQuestBlocked" : "launchBlocked",
    learnerLaunchAllowed: false,
    localRuntimeHandoffAllowed,
    actorRuntimeHandoffs,
    evidenceGates,
    ...(launchSelection.pedsRuntimeMaterializationHandoff
      ? { pedsRuntimeMaterializationHandoff: launchSelection.pedsRuntimeMaterializationHandoff }
      : {}),
    blockers,
    notEvidenceFor: ["quest_readiness", "production_readiness", "clinical_validity", "scoring_validity", "provider_readiness"],
    claimBoundary: "runtime_handoff_adapter_not_learner_launch",
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
