/**
 * Readiness-summary helpers extracted from environment-generation-queue-panel.tsx.
 *
 * WHY: the file-size ratchet freezes that panel at 758 lines and its rule is explicit — a frozen
 * file "may only SHRINK; any growth fails the gate, forcing extraction" and "do NOT raise the
 * ceiling". W11 (placement/staging authoring) grew it to 773, so the gate correctly refused the
 * next commit touching an architecture-relevant path.
 *
 * These are pure string-summary functions over one readiness record — no JSX, no React state, no
 * panel imports — so they are the clean cut. Nothing outside the panel referenced them, verified
 * before the move, making this a pure relocation rather than an API change.
 */
import type { ScenarioSceneGenerationRequestPublicationReadiness } from "./api-client.js";

export function summarizeMaterializationInputManifest(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.materializationInputManifestSummary;
  if (!summary) {
    return "Materialization input manifest: not attached";
  }
  return `Materialization input manifest: ${summary.actorWorkOrderInputCount} actor inputs; ${summary.equipmentWorkOrderInputCount} equipment inputs; actor cues ${summary.requiredActorCueIds.join(", ") || "none"}; equipment cues ${summary.requiredEquipmentCueIds.join(", ") || "none"}; blockers ${summary.blockerIds.length}; provider ${String(summary.providerExecutionPerformed)}; paid APIs ${String(summary.paidApisUsed)}; external network ${String(summary.externalNetworkUsed)}; ${summary.claimBoundary}`;
}

export function summarizeMaterializationEvidenceAttachments(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.materializationEvidenceAttachmentSummary;
  if (!summary) {
    return "Materialization evidence attachments: not attached";
  }
  return `Materialization evidence attachments: ${summary.attachedSlotCount}/${summary.totalRequiredSlotCount} slots attached; missing ${summary.missingSlotCount}; held or invalid ${summary.heldOrInvalidAttachmentCount}; all slots satisfied ${String(summary.allRequiredSlotsSatisfied)}; blockers ${summary.blockerIds.length}; runtime ${String(summary.runtimeSelectionAllowed)}; learner ${String(summary.learnerLaunchAllowed)}; Quest ${String(summary.questEvidenceRefreshAllowed)}; ${summary.claimBoundary}`;
}

export function summarizeMaterializationInputReviewActions(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const packet = readiness.materializationInputReviewActionPacket;
  if (!packet) {
    return "Materialization input review actions: not attached";
  }
  return `Materialization input review actions: ${packet.availableActions.map((action) => `${action.actionId} ${action.status} (${action.inputCount} inputs; ${action.blockerCount} blockers; provider ${String(action.providerExecutionAllowed)}; runtime ${String(action.runtimeExecutionAllowed)})`).join(", ")}; provider ${String(packet.providerExecutionAllowed)}; runtime ${String(packet.runtimeExecutionAllowed)}; learner ${String(packet.learnerLaunchAllowed)}; Quest ${String(packet.questEvidenceRefreshAllowed)}; ${packet.claimBoundary}`;
}

export function summarizeMaterializationInputReviewDecisionRecord(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const record = readiness.materializationInputReviewDecisionRecord;
  if (!record) {
    return "Materialization input review decisions: not attached";
  }
  return `Materialization input review decisions: ${record.decisionCount} decisions; reviewed ${record.reviewedDecisionCount}; held ${record.heldDecisionCount}; provider ${String(record.providerExecutionAllowed)}; runtime ${String(record.runtimeExecutionAllowed)}; learner ${String(record.learnerLaunchAllowed)}; Quest ${String(record.questEvidenceRefreshAllowed)}; ${record.claimBoundary}`;
}

export function summarizeRuntimeRealismEvidenceInputReviewDecisionRecord(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const record = readiness.runtimeRealismEvidenceInputReviewDecisionRecord;
  if (!record) {
    return "Runtime realism evidence input review decisions: not attached";
  }
  const sampleDecisionIds = record.decisions.slice(0, 3).map((decision) => decision.inputId).join(", ") || "no sample decisions";
  return `Runtime realism evidence input review decisions: ${record.decisionCount} decisions; reviewed ${record.reviewedDecisionCount}; held ${record.heldDecisionCount}; sample inputs ${sampleDecisionIds}; provider ${String(record.providerExecutionAllowed)}; runtime ${String(record.runtimeExecutionAllowed)}; learner ${String(record.learnerLaunchAllowed)}; Quest ${String(record.questEvidenceRefreshAllowed)}; ${record.claimBoundary}`;
}

export function summarizeRuntimeVisualEvidenceAttachmentSummary(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.runtimeVisualEvidenceAttachmentSummary;
  if (!summary) {
    return "Runtime visual evidence attachment summary: not attached";
  }
  return `Runtime visual evidence attachment summary: reviewed metadata-only ${summary.reviewedMetadataOnlyCount}; held metadata-only ${summary.heldMetadataOnlyCount}; attached runtime evidence ${summary.attachedRuntimeEvidenceCount}; attached visual QA evidence ${summary.attachedVisualQaEvidenceCount}; blockers ${summary.blockerIds.join(", ") || "none"}; runtime ${String(summary.runtimeExecutionAllowed)}; learner ${String(summary.learnerLaunchAllowed)}; Quest ${String(summary.questEvidenceRefreshAllowed)}; ${summary.claimBoundary}`;
}

export function summarizeRuntimeVisualEvidenceAttachmentRecord(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const record = readiness.runtimeVisualEvidenceAttachmentRecord;
  if (!record) {
    return "Runtime visual evidence attachment record: not attached";
  }
  const sampleRefs = record.attachments
    .slice(0, 3)
    .map((attachment) => `${attachment.inputId} -> ${attachment.evidenceRef}`)
    .join(", ") || "no accepted refs";
  return `Runtime visual evidence attachment record: ${record.attachmentCount} metadata-only refs; runtime refs ${record.runtimeEvidenceAttachmentCount}; visual QA refs ${record.visualQaEvidenceAttachmentCount}; accepted refs ${sampleRefs}; provider ${String(record.providerExecutionAllowed)}; runtime ${String(record.runtimeExecutionAllowed)}; learner ${String(record.learnerLaunchAllowed)}; Quest ${String(record.questEvidenceRefreshAllowed)}; ${record.claimBoundary}`;
}

export function summarizeAssetReleaseLadderReplayProjection(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.assetReleaseLadderReplayProjection;
  if (!summary) {
    return "Asset release ladder replay projection: not attached";
  }
  const sampleBlockedAssets = summary.blockedAssets
    .slice(0, 3)
    .map((asset) => `${asset.assetId}:${asset.firstBlockedStep ?? "blocked"}`)
    .join(", ") || "no blocked assets";
  return `Asset release ladder replay projection: ${summary.assetCount} assets; release-ladder complete ${summary.productionReadyAssetCount}; blocked ${summary.blockedAssetCount}; missing required ${summary.missingRequiredAssetCount}; blockers ${summary.blockerCount}; station budget ${summary.stationBudgetStatus}; sample blocked assets ${sampleBlockedAssets}; runtime ${String(summary.runtimeExecutionAllowed)}; learner ${String(summary.learnerLaunchAllowed)}; Quest ${String(summary.questEvidenceRefreshAllowed)}; production ${String(summary.productionAssetReadinessClaimed)}; ${summary.claimBoundary}`;
}

export function summarizeRuntimeVisualEvidenceAttachmentActions(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const packet = readiness.runtimeVisualEvidenceAttachmentActionPacket;
  if (!packet) {
    return "Runtime visual evidence attachment actions: not attached";
  }
  return `Runtime visual evidence attachment actions: ${packet.availableActions.map((action) => `${action.actionId} ${action.status} (${action.requiredInputCount} inputs; reviewed ${action.reviewedMetadataOnlyCount}; held ${action.heldMetadataOnlyCount}; attached ${action.attachedEvidenceCount}; runtime ${String(action.runtimeExecutionAllowed)}; learner ${String(action.learnerLaunchAllowed)})`).join(", ")}; provider ${String(packet.providerExecutionAllowed)}; runtime ${String(packet.runtimeExecutionAllowed)}; learner ${String(packet.learnerLaunchAllowed)}; Quest ${String(packet.questEvidenceRefreshAllowed)}; ${packet.claimBoundary}`;
}

export function summarizeRuntimeEvidenceCaptureScaffold(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const scaffold = readiness.runtimeEvidenceCaptureScaffold;
  if (!scaffold) {
    return "Runtime evidence capture scaffold: not attached";
  }
  const sampleRefs = scaffold.attachmentCandidates
    .slice(0, 3)
    .map((candidate) => `${candidate.inputId} -> ${candidate.evidenceRef}`)
    .join(", ") || "no candidate refs";
  return `Runtime evidence capture scaffold: ${scaffold.runtimeEvidenceCandidateCount} runtime candidates; ${scaffold.visualQaEvidenceCandidateCount} visual QA candidates; submit candidates ${scaffold.submitRuntimeVisualEvidenceAttachmentInput.attachments.length}; candidate refs ${sampleRefs}; provider ${String(scaffold.gateBoundary.providerExecutionAllowed)}; runtime ${String(scaffold.gateBoundary.runtimeExecutionAllowed)}; learner ${String(scaffold.gateBoundary.learnerLaunchAllowed)}; Quest ${String(scaffold.gateBoundary.questEvidenceRefreshAllowed)}; ${scaffold.claimBoundary}`;
}

export function summarizeEvidenceGateRefs(
  gateRefs: ScenarioSceneGenerationRequestPublicationReadiness["evidenceGateRefs"],
): string {
  if (!gateRefs || gateRefs.length === 0) {
    return "no encounter bundle evidence gates attached";
  }
  return gateRefs
    .map((gateRef) => {
      const blockerSummary = gateRef.blockers.length > 0 ? ` (${gateRef.blockers.length} blockers)` : "";
      const signalSummary = gateRef.requiredSignalIds.length > 0 ? ` requires ${gateRef.requiredSignalIds.join(", ")}` : " requires no additional signal ids";
      return `${gateRef.gateId} ${gateRef.status}${blockerSummary}${signalSummary}`;
    })
    .join(", ");
}

export function summarizePedsGeneratedPlayerAndEmotion(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const scaffold = readiness.runtimeEvidenceCaptureScaffold;
  const emotionReq = (readiness as any).assetNeedsReadiness?.emotionRequirementCount ?? (readiness as any).packets?.[0]?.assetNeedsReadiness?.emotionRequirementCount;
  const player = (scaffold as any)?.pedsRuntimePlayerDemo;
  const timelineLen = (readiness as any).packets?.[0]?.persistenceProjection?.emotionalStateTimeline?.length ?? (readiness as any).packets?.[0]?.caseDerivedExpectations?.emotionTimeline?.length ?? 0;
  const actorTurnsLen = (readiness as any).packets?.[0]?.persistenceProjection?.actorTurns?.length ?? (readiness as any).packets?.[0]?.caseDerivedExpectations?.actorTurnExpectations?.length ?? 0;
  const timelineSummary = `; caseDerived timeline ${timelineLen} steps, actorTurns ${actorTurnsLen} from spec (persistenceProjection/caseDerived for replay evidence; review-safe, gates false)`;
  if (player) {
    const loop = (scaffold as any)?.pedsPlayerStepLoopDemo;
    const loopSummary = loop ? `; stepLoop ${loop.length} steps (first: ${loop[0]?.trigger} -> ${loop[0]?.emotion}/${loop[0]?.cue})` : "";
    return `Peds generated player (from case spec machines/policies): emotion ${player.currentEmotion} nextCue ${player.nextCueId} source ${player.source} visemeHint ${player.visemeHint}${loopSummary}; materialization emotion req count ${emotionReq ?? "n/a"}${timelineSummary}; (review-safe metadata only, gates false, no readiness claim)`;
  }
  if (emotionReq != null) {
    return `Peds materialization emotion req from active case cues: ${emotionReq}${timelineSummary}; (player demo not attached for this packet)`;
  }
  // Virtual env pipeline (caseDerivedVirtualEnvironment from factory + player three render): surface in admin publication queue for review/attach readiness (review-safe; makes virtual env from case spec visible to faculty alongside player/emotion). Ties player visual (main.ts three props for peds/ed) to review surface. Per user evolution: evident in runnable app (player + admin).
  const virtualEnv = (scaffold as any)?.caseDerivedVirtualEnvironment ?? (scaffold as any)?.virtualEnvForPlayer ? { roomType: (scaffold as any).virtualEnvForPlayer } : null;
  if (virtualEnv && ((scaffold as any)?.caseDerivedVirtualEnvironment || (scaffold as any)?.virtualEnvForPlayer)) {
    const ve = (scaffold as any)?.caseDerivedVirtualEnvironment;
    const veSummary = ve ? `${ve.roomType} props:${ve.props?.length ?? "?"} tech:${ve.techStack?.runtime?.split(" + ")[0] ?? "three"}` : (scaffold as any)?.virtualEnvForPlayer ?? "virtual env attached";
    const produced = (scaffold as any)?.envWorldAsset?.producedAssetFilePath || (scaffold as any)?.envWorldAsset?.producedGltfManifest ? 'yes (manifest as produced asset file)' : 'n/a';
    return `Virtual env from case (factory caseDerivedVirtualEnvironment + three player render): ${veSummary}; produced asset file: ${produced}${timelineSummary}; (review-safe metadata, gates false; see player for visual props; attach via consumer; wired from launched world)`;
  }
  return `Peds generated player/emotion req: not attached (non-peds or no active cues from case)${timelineSummary}`;
}

export function summarizePublicationMetadata(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const metadata = readiness.publicationMetadata;
  if (!metadata) {
    return "Publication metadata: not attached";
  }
  return `Publication metadata: ${metadata.generatedAssetCount} generated asset refs; ${metadata.humanoidActorCount} humanoids; ${metadata.equipmentCount} equipment refs; publication review refs ${metadata.publicationReviewEvidenceRefs?.join(", ") || "none"}; ${metadata.claimBoundary}`;
}

export function summarizeRuntimeBundleAssemblyAudit(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const audit = readiness.publicationMetadata?.assemblyAuditMetadata;
  if (!audit) {
    return "Runtime bundle assembly audit: not attached";
  }
  return `Runtime bundle assembly audit: sources ${audit.sourceDefinitionRefs.join(", ") || "none"}; humanoid refs ${audit.humanoidMetadataRefs.map((ref) => `${ref.actorRole}:${ref.actorId}`).join(", ") || "none"}; learner-use blocked until gates attach=${String(audit.fallbackPosture.learnerUseBlockedUntilEvidenceGatesAttach)}; ${audit.claimBoundary}`;
}

export function summarizeHumanoidRealismProfiles(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.publicationMetadata?.humanoidRealismProfileSummary;
  if (!summary) {
    return "Humanoid realism profiles: not attached";
  }
  const actorRoleSummary = summary.actorRoles.length > 0 ? summary.actorRoles.join(", ") : "roles not attached";
  return `Humanoid realism profiles: ${summary.profileCount}; actor roles: ${actorRoleSummary}; required signals: ${summary.requiredSignalIds.join(", ")}; ${summary.claimScope}`;
}

export function summarizeHumanoidMetadataBlockers(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const blockers = readiness.humanoidMetadataBlockerIds ?? [];
  return `Humanoid metadata blockers: ${blockers.length > 0 ? blockers.join(", ") : "none"}`;
}

export function summarizeScenarioReviewGate(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const gate = readiness.scenarioReviewGate;
  if (!gate) {
    return "Scenario status boundary: not attached";
  }
  return `Scenario status boundary: ${gate.scenarioStatus}; ${gate.approvalBoundary}; learner-use blocked=${String(gate.learnerUseBlocked)}; blockers ${gate.blockerIds.join(", ") || "none"}; ${gate.claimBoundary}`;
}

export function summarizeRuntimeBundleGateRefs(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const refs = readiness.runtimeBundleGateRefs ?? [];
  if (refs.length === 0) {
    return "Runtime bundle gate refs: not attached";
  }
  return `Runtime bundle gate refs: ${refs.map((ref) => `${ref.gateId} ${ref.status}${ref.blockerIds.length > 0 ? ` (${ref.blockerIds.join(", ")})` : ""}`).join(", ")}`;
}

export function summarizeHumanReviewActions(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const actions = readiness.humanReviewActions ?? [];
  if (actions.length === 0) {
    return "Human review actions: not attached";
  }
  return `Human review actions: ${actions.map((action) => `${action.actionId} ${action.status}${action.blockerIds.length > 0 ? ` (${action.blockerIds.join(", ")})` : ""}`).join(", ")}; human_review_action_not_automated_approval`;
}

export function summarizeDynamicBehaviorCoverage(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const coverage = readiness.dynamicBehaviorCoverage;
  if (!coverage) {
    return "Dynamic behavior coverage: not attached";
  }
  const missing = [
    ...coverage.missingDialogueActorRoles.map((actorRole) => `dialogue:${actorRole}`),
    ...coverage.missingGazeActorRoles.map((actorRole) => `gaze:${actorRole}`),
    ...coverage.missingPlacementActorRoles.map((actorRole) => `placement:${actorRole}`),
    ...(coverage.missingAffectActorRoles ?? []).map((actorRole) => `affect:${actorRole}`),
  ];
  return `Dynamic behavior coverage: dialogue ${coverage.dialogueActorRoles.join(", ") || "none"}; gaze ${coverage.gazeActorRoles.join(", ") || "none"}; placement ${coverage.placementActorRoles.join(", ") || "none"}; affect ${(coverage.affectActorRoles ?? []).join(", ") || "none"} (${coverage.affectTimelineCount ?? 0} timelines; ${coverage.affectClaimBoundary ?? "metadata_only_not_runtime_facial_animation_evidence"}); missing ${missing.join(", ") || "none"}; blockers ${coverage.blockerIds.join(", ") || "none"}; ${coverage.claimBoundary}`;
}

export function summarizeEncounterFactoryDryRun(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.encounterFactoryDryRunSummary;
  if (!summary) {
    return "Encounter factory dry-run: not attached";
  }
  return `Encounter factory dry-run: status ${summary.status}; ${summary.stageIds.length} stages; actors ${summary.actorRoles.join(", ") || "none"}; review gates ${summary.reviewGateIds.join(", ") || "none"}; next ${summary.recommendedNextAction}; blockers ${summary.blockerIds.join(", ") || "none"}; warnings ${summary.warningIds.join(", ") || "none"}; boundaries metadataOnly=${String(summary.evidenceBoundaries.metadataOnlyPlan)} generatedAssets=${String(summary.evidenceBoundaries.generatedAssetsMaterialized)} learnerRuntime=${String(summary.evidenceBoundaries.learnerRuntimeEnabled)} questClaim=${String(summary.evidenceBoundaries.questReadinessClaimed)}; ${summary.claimBoundary}`;
}

export function summarizeEncounterFactoryInputPlanning(readiness: ScenarioSceneGenerationRequestPublicationReadiness): string {
  const summary = readiness.inputPlanningSummary;
  if (!summary) {
    return "Encounter factory input planning: not attached";
  }
  const selection = summary.factorySelectionMetadata
    ? `; factory selection ${summary.factorySelectionMetadata.factorySelectionRole} order ${summary.factorySelectionMetadata.scenarioBankOrder ?? "unspecified"} via ${summary.factorySelectionMetadata.factorySelectionMode} (${summary.factorySelectionMetadata.factorySelectionClaimBoundary})`
    : "";
  return `Encounter factory input planning: ${summary.assetWorkOrderIntent.total} work-order intents (actors ${summary.assetWorkOrderIntent.actor}, environment ${summary.assetWorkOrderIntent.environment}, equipment ${summary.assetWorkOrderIntent.equipment}); shared asset lookup keys ${summary.sharedAssetLibraryReuse.lookupKeyCount}; dynamic behavior tags ${summary.dynamicBehaviorTraceTags.join(", ") || "none"}${selection}; blockers ${summary.blockerIds.join(", ") || "none"}; ${summary.claimBoundary}`;
}
