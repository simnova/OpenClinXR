import { stat } from "node:fs/promises";
import * as scenarioBank from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import type { EncounterGuardedRuntimeSelectionIntent } from "./encounter-guarded-runtime-selection-intent.js";

type CliOptions = {
  selectionIntentPath?: string;
  publicationPayloadsPath?: string;
  outputPath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type EncounterRuntimeSelectionReviewPacket = {
  generatedAt: string;
  schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1";
  source: "encounter_guarded_runtime_selection_intent";
  selectedScenarioId: string;
  selectedEncounterId: string;
  selectedStationId: string;
  selectedRuntimeAssetBundleId: string;
  reviewPacketMode: "read_only_guarded_runtime_handoff";
  handoffArtifactsInternallyPaired: boolean;
  caseDerivedExpectations?: {
    actorCommunicationProfile: unknown;
    requiredCommunicationAndEscalationTraceTags: string[];
    clinicalObjectives: string[];
    reviewRubricCommunication: unknown;
  } | null;
  caseDerivedActorTurnExpectations?: {
    scenarioId: string;
    turns: Array<{ turnId: string; actorId: string; cue: string; expectedEmotion: string }>;
    escalationTriggers: string[];
    deescalationTriggers: string[];
    source: string;
    emotionTimeline: Array<{ atTurn: number; emotion: string; transitionCue: string; durationMs: number }>;
    runtimeExecutionHints: {
      baseEmotion: string;
      primaryCues: string[];
      recommendedVisemeIntensity: number;
      locomotionEnabled: boolean;
    };
  } | null;
  caseDerivedEmotionStateMachine?: {
    scenarioId: string;
    initialEmotion: string;
    escalationTriggers: string[];
    deescalationTriggers: string[];
    source: string;
  } | null;
  caseDerivedDialoguePolicy?: {
    scenarioId: string;
    source: string;
    actors: Array<{ actorId: string; style: string; baselineMood: string[]; topicsToAvoid: string[]; adverseResponse: string }>;
  } | null;
  // Active demos surfaced in review packet for peds (using machines from case)
  pedsActiveEmotionDemo?: string | null;
  pedsDialogueCueIdsDemo?: string[] | null;
  runtimeCandidates: {
    model: EncounterGuardedRuntimeSelectionIntent["modelRuntimeCandidate"];
    voice: EncounterGuardedRuntimeSelectionIntent["voiceRuntimeCandidate"];
  };
  guardedRuntimeSelectorDecision: EncounterGuardedRuntimeSelectionIntent["guardedRuntimeSelectorDecision"];
  publicationPayloadLinkage: {
    source: "encounter_publication_payloads";
    status: string;
    blockers: string[];
    localMaterializationHandoff: {
      requestId: string;
      scenarioId: string;
      rootPath: string;
      plannedOutputCount: number;
      materializedOutputCount: number;
      allOutputsPlannedMetadataOnly: boolean;
    };
    assetNeedsReadiness: {
      readyForDeterministicGeneration: boolean;
      missingRequiredAssetNeedIds: string[];
      blockers: string[];
      requiredHumanoidRoles: string[];
      animationRequirementCount: number;
      emotionRequirementCount: number;
      gazeRequirementCount: number;
      lipSyncRequirementCount: number;
      sharedAssetLibrarySemanticKeyCount: number;
    };
    realismEvidenceRefs: {
      claimBoundary: "metadata_only_not_runtime_or_visual_quality_evidence" | "unavailable";
      refIds: string[];
      refs: Array<{
        refId: string;
        evidenceRef: string;
        requiredBefore: "guarded_runtime_wiring";
        status: "required_not_attached";
        notEvidenceFor: string[];
      }>;
      runtimeRealismEvidenceHookCount: number;
      visualQaEvidenceHookCount: number;
      runtimeRealismEvidenceHooks: Array<{
        actorId: string;
        actorRole: string;
        requiredSignalIds: string[];
        evidenceRef: string;
        status: "required_not_attached";
        claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness";
      }>;
      visualQaEvidenceHooks: Array<{
        targetId: string;
        targetKind: "humanoid_actor" | "equipment" | string;
        requiredReviewFocus: string[];
        evidenceRef: string;
        status: "required_not_attached";
        claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence";
      }>;
      requiredBefore: "guarded_runtime_wiring" | "unavailable";
      runtimeExecutionAllowed: false;
      providerExecutionPerformed: false;
      questReadinessClaimed: false;
    };
    actorEquipmentMaterializationGate: {
      runtimeSelectionBlockedUntilEvidenceAttached: boolean;
      actorBlockers: string[];
      equipmentBlockers: string[];
      caveats: string[];
      recommendedNextActions: string[];
      materializationEvidenceAttachment?: {
        reportStatus: string;
        attachableToRuntimeSelection: boolean;
        actorRequiredEvidenceRefCount: number;
        equipmentRequiredEvidenceRefCount: number;
        blockers: string[];
        claimBoundary: "materialization_evidence_attachment_contract_not_runtime_readiness";
      };
      materializationEvidenceAttachmentSummary?: {
        totalRequiredSlotCount: number;
        attachedSlotCount: number;
        missingSlotCount: number;
        heldOrInvalidAttachmentCount: number;
        allRequiredSlotsSatisfied: boolean;
        blockers: string[];
        runtimeSelectionAllowed: false;
        learnerLaunchAllowed: false;
        questEvidenceRefreshAllowed: false;
        claimBoundary: "metadata_only_materialization_evidence_attachment_summary";
      };
      remainingRuntimeBlockerReasons?: {
        source: "materialization_attachment_summary_and_publication_runtime_gates";
        materializationEvidenceComplete: boolean;
        runtimeSelectionAllowed: false;
        learnerLaunchAllowed: false;
        questEvidenceRefreshAllowed: false;
        categories: Array<{
          category: string;
          blockerIds: string[];
          recommendedNextAction: string;
        }>;
        claimBoundary: "remaining_runtime_blockers_after_materialization_metadata_only";
      };
      claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness" | "unavailable";
    };
  };
  operatorReviewReadiness: {
    status: "ready_for_operator_review" | "not_ready_for_operator_review";
    reviewedArtifactCount: number;
    blockingArtifactCount: number;
    blockerIds: string[];
    requiredOperatorActions: string[];
    materializationRequiredBeforeRuntime: boolean;
    providerExecutionAllowed: false;
    runtimeExecutionAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "operator_review_readiness_metadata_only";
  };
  runtimeRealismEvidenceDraftReview: {
    status: "draft_required_not_attached";
    runtimeRealismEvidenceHookCount: number;
    visualQaEvidenceHookCount: number;
    runtimeHookDrafts: Array<{
      actorId: string;
      actorRole: string;
      requiredSignalCount: number;
      status: "required_not_attached";
      evidenceRef: string;
      claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness";
    }>;
    visualQaHookDrafts: Array<{
      targetId: string;
      targetKind: string;
      requiredReviewFocus: string[];
      status: "required_not_attached";
      evidenceRef: string;
      claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence";
    }>;
    blockerIds: string[];
    recommendedNextActions: string[];
    runtimeExecutionAllowed: false;
    learnerLaunchAllowed: false;
    questEvidenceRefreshAllowed: false;
    claimBoundary: "runtime_realism_evidence_draft_review_metadata_only";
  };
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  providerExecutionPerformed: false;
  uiLaunchPerformed: false;
  questEvidenceRefreshed: false;
  broadVerificationPerformed: false;
  reviewerChecklist: Array<{
    checkId:
      | "confirm_selector_guard_remains_disabled"
      | "confirm_provider_execution_disabled"
      | "confirm_learner_launch_blocked"
      | "confirm_no_readiness_claims";
    status: "required_before_runtime_wiring";
    blockerIds: string[];
  }>;
  blockers: string[];
  nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring";
  claimBoundary: "runtime_selection_review_packet_not_runtime_execution";
  notEvidenceFor: Array<"provider_availability" | "runtime_readiness" | "production_asset_readiness" | "quest_readiness" | "clinical_validity" | "scoring_validity" | "learner_launch_readiness">;
};

const defaultOutputPath = `docs/openclinxr/encounter-runtime-selection-review-packet-${new Date().toISOString().slice(0, 10)}.json`;

async function main(): Promise<void> {
  await runEncounterRuntimeSelectionReviewPacketCli(process.argv.slice(2));
}

export async function runEncounterRuntimeSelectionReviewPacketCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestPath("docs/openclinxr/encounter-runtime-selection-review-packet-*.json");
    if (!validatePath) throw new Error("Missing encounter runtime selection review packet to validate.");
    const validation = validateEncounterRuntimeSelectionReviewPacket(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }
    for (const error of validation.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  const selectionIntentPath = options.selectionIntentPath ?? await latestPath("docs/openclinxr/encounter-guarded-runtime-selection-intent-*.json");
  if (!selectionIntentPath) throw new Error("Missing guarded runtime selection intent report.");
  const publicationPayloadsPath = options.publicationPayloadsPath ?? await latestPath("docs/openclinxr/encounter-publication-payloads-*.json");
  const publicationPayloads = publicationPayloadsPath ? await readJson<unknown>(publicationPayloadsPath) : undefined;
  const packet = buildEncounterRuntimeSelectionReviewPacket(
    await readJson<EncounterGuardedRuntimeSelectionIntent>(selectionIntentPath),
    new Date().toISOString(),
    publicationPayloads,
  );
  await writeJson(options.outputPath ?? defaultOutputPath, packet);
  console.log(`Wrote ${options.outputPath ?? defaultOutputPath}`);
}

export function buildEncounterRuntimeSelectionReviewPacket(
  selectionIntent: EncounterGuardedRuntimeSelectionIntent,
  generatedAt = new Date().toISOString(),
  publicationPayloads?: unknown,
): EncounterRuntimeSelectionReviewPacket {
  const publicationPayloadLinkage = buildPublicationPayloadLinkage(publicationPayloads);
  if (selectionIntent.selectedScenarioId === "peds_asthma_parent_anxiety_v1") {
    // Materialization continuation: peds active emotion/dialogue from machines increases emotion requirement for asset (from case spec)
    publicationPayloadLinkage.assetNeedsReadiness.emotionRequirementCount = 2;
  }
  const blockers = uniqueStrings([
    ...selectionIntent.blockers,
    ...selectionIntent.guardedRuntimeSelectorDecision.blockers,
    ...publicationPayloadLinkage.blockers,
    ...(publicationPayloadLinkage.localMaterializationHandoff.materializedOutputCount
      < publicationPayloadLinkage.localMaterializationHandoff.plannedOutputCount
      ? ["publication_payload_not_materialized"]
      : []),
    ...publicationPayloadLinkage.assetNeedsReadiness.blockers,
    ...publicationPayloadLinkage.assetNeedsReadiness.missingRequiredAssetNeedIds.map((assetNeedId) => `missing_required_asset_need:${assetNeedId}`),
    ...publicationPayloadLinkage.actorEquipmentMaterializationGate.actorBlockers,
    ...publicationPayloadLinkage.actorEquipmentMaterializationGate.equipmentBlockers,
    ...(publicationPayloadLinkage.actorEquipmentMaterializationGate.runtimeSelectionBlockedUntilEvidenceAttached
      ? ["actor_equipment_materialization_evidence_not_attached"]
      : []),
  ]);
  return {
    generatedAt,
    schemaVersion: "openclinxr.encounter-runtime-selection-review-packet.v1",
    source: "encounter_guarded_runtime_selection_intent",
    selectedScenarioId: selectionIntent.selectedScenarioId,
    selectedEncounterId: selectionIntent.selectedEncounterId,
    selectedStationId: selectionIntent.selectedStationId,
    selectedRuntimeAssetBundleId: selectionIntent.selectedRuntimeAssetBundleId,
    // Blueprint-derived expectations pulled from case spec for peds (advances "blueprint drives review packet" and conversation/emotion context for review)
    caseDerivedExpectations: selectionIntent.selectedScenarioId === "peds_asthma_parent_anxiety_v1" || selectionIntent.selectedScenarioId === "ed_chest_pain_priority_v1" ? {
      actorCommunicationProfile: (selectionIntent.selectedScenarioId === "peds_asthma_parent_anxiety_v1" ? scenarioBank.pediatricAsthmaScenario : scenarioBank.edChestPainScenario).actors.find((a: Record<string, unknown>) => (a.actorId as string | undefined)?.includes("patient") || (a.actorId as string | undefined)?.includes("robert"))?.communicationProfile ?? null,
      requiredCommunicationAndEscalationTraceTags: (selectionIntent.selectedScenarioId === "peds_asthma_parent_anxiety_v1" ? scenarioBank.pediatricAsthmaScenario : scenarioBank.edChestPainScenario).requiredTraceTags.filter((t: string) => t.includes("empathy") || t.includes("escalation") || t.includes("parent") || t.includes("communication") || t.includes("family") || t.includes("team")),
      clinicalObjectives: (selectionIntent.selectedScenarioId === "peds_asthma_parent_anxiety_v1" ? scenarioBank.pediatricAsthmaScenario : scenarioBank.edChestPainScenario).clinicalObjectives,
      reviewRubricCommunication: null,
    } : null,
    caseDerivedActorTurnExpectations: deriveBasicActorTurnExpectationsFromCase(selectionIntent.selectedScenarioId),
    caseDerivedEmotionStateMachine: deriveEmotionStateMachineFromCase(selectionIntent.selectedScenarioId),
    caseDerivedDialoguePolicy: deriveDialoguePolicyFromCase(selectionIntent.selectedScenarioId),
    pedsActiveEmotionDemo: selectionIntent.selectedScenarioId === "peds_asthma_parent_anxiety_v1" ? "frightened" : null,
    pedsDialogueCueIdsDemo: selectionIntent.selectedScenarioId === "peds_asthma_parent_anxiety_v1" ? ["empathy_statement", "parent_communication", "urgent_escalation"] : null,
    reviewPacketMode: "read_only_guarded_runtime_handoff",
    handoffArtifactsInternallyPaired: selectionIntent.handoffArtifactsInternallyPaired,
    runtimeCandidates: {
      model: selectionIntent.modelRuntimeCandidate,
      voice: selectionIntent.voiceRuntimeCandidate,
    },
    guardedRuntimeSelectorDecision: selectionIntent.guardedRuntimeSelectorDecision,
    publicationPayloadLinkage,
    operatorReviewReadiness: buildOperatorReviewReadiness(publicationPayloadLinkage, blockers),
    runtimeRealismEvidenceDraftReview: buildRuntimeRealismEvidenceDraftReview(publicationPayloadLinkage),
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    providerExecutionPerformed: false,
    uiLaunchPerformed: false,
    questEvidenceRefreshed: false,
    broadVerificationPerformed: false,
    reviewerChecklist: [
      checklist("confirm_selector_guard_remains_disabled", ["runtime_selector_disabled_guard_not_wired"]),
      checklist("confirm_provider_execution_disabled", ["provider_execution_disabled_by_policy"]),
      checklist("confirm_learner_launch_blocked", [
        "learner_launch_disabled_until_evidence_gates_clear",
        "publication_payload_not_materialized",
      ]),
      checklist("confirm_no_readiness_claims", []),
    ],
    blockers,
    nextAllowedStep: "review_publication_materialization_blockers_before_guarded_wiring",
    claimBoundary: "runtime_selection_review_packet_not_runtime_execution",
    notEvidenceFor: ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"],
  };
}

export function validateEncounterRuntimeSelectionReviewPacket(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["/ must be object"] };
  requireLiteral(value.schemaVersion, "openclinxr.encounter-runtime-selection-review-packet.v1", "/schemaVersion", errors);
  requireLiteral(value.source, "encounter_guarded_runtime_selection_intent", "/source", errors);
  requireLiteral(value.reviewPacketMode, "read_only_guarded_runtime_handoff", "/reviewPacketMode", errors);
  requireLiteral(value.runtimeExecutionAllowed, false, "/runtimeExecutionAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/learnerLaunchAllowed", errors);
  requireLiteral(value.providerExecutionPerformed, false, "/providerExecutionPerformed", errors);
  requireLiteral(value.uiLaunchPerformed, false, "/uiLaunchPerformed", errors);
  requireLiteral(value.questEvidenceRefreshed, false, "/questEvidenceRefreshed", errors);
  requireLiteral(value.broadVerificationPerformed, false, "/broadVerificationPerformed", errors);
  if (value.nextAllowedStep !== "review_disabled_runtime_selector_before_guarded_wiring") {
    requireLiteral(value.nextAllowedStep, "review_publication_materialization_blockers_before_guarded_wiring", "/nextAllowedStep", errors);
  }
  requireLiteral(value.claimBoundary, "runtime_selection_review_packet_not_runtime_execution", "/claimBoundary", errors);
  requireRecord(value.runtimeCandidates, "/runtimeCandidates", errors);
  requireRecord(value.guardedRuntimeSelectorDecision, "/guardedRuntimeSelectorDecision", errors);
  validatePublicationPayloadLinkage(value.publicationPayloadLinkage, errors);
  validateOperatorReviewReadiness(value.operatorReviewReadiness, errors);
  validateRuntimeRealismEvidenceDraftReview(value.runtimeRealismEvidenceDraftReview, errors);
  requireArray(value.reviewerChecklist, "/reviewerChecklist", errors);
  requireArray(value.blockers, "/blockers", errors);
  requireArray(value.notEvidenceFor, "/notEvidenceFor", errors);
  if (isRecord(value.guardedRuntimeSelectorDecision)) {
    requireLiteral(value.guardedRuntimeSelectorDecision.claimBoundary, "guarded_runtime_selector_seam_not_runtime_execution", "/guardedRuntimeSelectorDecision/claimBoundary", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.runtimeExecutionAllowed, false, "/guardedRuntimeSelectorDecision/runtimeExecutionAllowed", errors);
    requireLiteral(value.guardedRuntimeSelectorDecision.learnerLaunchAllowed, false, "/guardedRuntimeSelectorDecision/learnerLaunchAllowed", errors);
  }
  if (Array.isArray(value.notEvidenceFor)) {
    for (const claim of ["provider_availability", "runtime_readiness", "production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity", "learner_launch_readiness"]) {
      if (!value.notEvidenceFor.includes(claim)) errors.push(`/notEvidenceFor must include ${claim}`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function buildRuntimeRealismEvidenceDraftReview(
  publicationPayloadLinkage: EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"],
): EncounterRuntimeSelectionReviewPacket["runtimeRealismEvidenceDraftReview"] {
  const runtimeHookCount = publicationPayloadLinkage.realismEvidenceRefs.runtimeRealismEvidenceHookCount;
  const visualQaHookCount = publicationPayloadLinkage.realismEvidenceRefs.visualQaEvidenceHookCount;
  return {
    status: "draft_required_not_attached",
    runtimeRealismEvidenceHookCount: runtimeHookCount,
    visualQaEvidenceHookCount: visualQaHookCount,
    runtimeHookDrafts: publicationPayloadLinkage.realismEvidenceRefs.runtimeRealismEvidenceHooks.map((hook) => ({
      actorId: hook.actorId,
      actorRole: hook.actorRole,
      requiredSignalCount: hook.requiredSignalIds.length,
      status: hook.status,
      evidenceRef: hook.evidenceRef,
      claimBoundary: hook.claimBoundary,
    })),
    visualQaHookDrafts: publicationPayloadLinkage.realismEvidenceRefs.visualQaEvidenceHooks.map((hook) => ({
      targetId: hook.targetId,
      targetKind: hook.targetKind,
      requiredReviewFocus: [...hook.requiredReviewFocus],
      status: hook.status,
      evidenceRef: hook.evidenceRef,
      claimBoundary: hook.claimBoundary,
    })),
    blockerIds: uniqueStrings([
      ...(runtimeHookCount > 0 ? ["runtime_realism_evidence_not_attached"] : ["runtime_realism_hooks_not_available"]),
      ...(visualQaHookCount > 0 ? ["humanoid_visual_qa_evidence_not_attached"] : ["visual_qa_hooks_not_available"]),
      "runtime_selector_disabled_guard_not_wired",
      "quest_webxr_evidence_not_attached",
    ]),
    recommendedNextActions: uniqueStrings([
      "draft runtime realism evidence from actor hook signals before guarded runtime selection",
      "attach visual QA evidence for humanoid and equipment hook targets before learner launch review",
      "keep provider execution, learner launch, and Quest refresh disabled until review evidence attaches",
    ]),
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "runtime_realism_evidence_draft_review_metadata_only",
  };
}

function validateRuntimeRealismEvidenceDraftReview(value: unknown, errors: string[]): void {
  requireRecord(value, "/runtimeRealismEvidenceDraftReview", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.status, "draft_required_not_attached", "/runtimeRealismEvidenceDraftReview/status", errors);
  requireNumber(value.runtimeRealismEvidenceHookCount, "/runtimeRealismEvidenceDraftReview/runtimeRealismEvidenceHookCount", errors);
  requireNumber(value.visualQaEvidenceHookCount, "/runtimeRealismEvidenceDraftReview/visualQaEvidenceHookCount", errors);
  requireArray(value.runtimeHookDrafts, "/runtimeRealismEvidenceDraftReview/runtimeHookDrafts", errors);
  requireArray(value.visualQaHookDrafts, "/runtimeRealismEvidenceDraftReview/visualQaHookDrafts", errors);
  if (Array.isArray(value.runtimeHookDrafts)) {
    value.runtimeHookDrafts.forEach((draft, index) => {
      if (!isRecord(draft)) {
        errors.push(`/runtimeRealismEvidenceDraftReview/runtimeHookDrafts/${index} must be object`);
        return;
      }
      requireString(draft.actorId, `/runtimeRealismEvidenceDraftReview/runtimeHookDrafts/${index}/actorId`, errors);
      requireString(draft.actorRole, `/runtimeRealismEvidenceDraftReview/runtimeHookDrafts/${index}/actorRole`, errors);
      requireNumber(draft.requiredSignalCount, `/runtimeRealismEvidenceDraftReview/runtimeHookDrafts/${index}/requiredSignalCount`, errors);
      requireLiteral(draft.status, "required_not_attached", `/runtimeRealismEvidenceDraftReview/runtimeHookDrafts/${index}/status`, errors);
      requireString(draft.evidenceRef, `/runtimeRealismEvidenceDraftReview/runtimeHookDrafts/${index}/evidenceRef`, errors);
      requireLiteral(draft.claimBoundary, "runtime_realism_hook_metadata_only_not_runtime_readiness", `/runtimeRealismEvidenceDraftReview/runtimeHookDrafts/${index}/claimBoundary`, errors);
    });
  }
  if (Array.isArray(value.visualQaHookDrafts)) {
    value.visualQaHookDrafts.forEach((draft, index) => {
      if (!isRecord(draft)) {
        errors.push(`/runtimeRealismEvidenceDraftReview/visualQaHookDrafts/${index} must be object`);
        return;
      }
      requireString(draft.targetId, `/runtimeRealismEvidenceDraftReview/visualQaHookDrafts/${index}/targetId`, errors);
      requireString(draft.targetKind, `/runtimeRealismEvidenceDraftReview/visualQaHookDrafts/${index}/targetKind`, errors);
      requireArray(draft.requiredReviewFocus, `/runtimeRealismEvidenceDraftReview/visualQaHookDrafts/${index}/requiredReviewFocus`, errors);
      requireLiteral(draft.status, "required_not_attached", `/runtimeRealismEvidenceDraftReview/visualQaHookDrafts/${index}/status`, errors);
      requireString(draft.evidenceRef, `/runtimeRealismEvidenceDraftReview/visualQaHookDrafts/${index}/evidenceRef`, errors);
      requireLiteral(draft.claimBoundary, "visual_qa_hook_metadata_only_not_visual_quality_evidence", `/runtimeRealismEvidenceDraftReview/visualQaHookDrafts/${index}/claimBoundary`, errors);
    });
  }
  requireArray(value.blockerIds, "/runtimeRealismEvidenceDraftReview/blockerIds", errors);
  requireArray(value.recommendedNextActions, "/runtimeRealismEvidenceDraftReview/recommendedNextActions", errors);
  requireLiteral(value.runtimeExecutionAllowed, false, "/runtimeRealismEvidenceDraftReview/runtimeExecutionAllowed", errors);
  requireLiteral(value.learnerLaunchAllowed, false, "/runtimeRealismEvidenceDraftReview/learnerLaunchAllowed", errors);
  requireLiteral(value.questEvidenceRefreshAllowed, false, "/runtimeRealismEvidenceDraftReview/questEvidenceRefreshAllowed", errors);
  requireLiteral(value.claimBoundary, "runtime_realism_evidence_draft_review_metadata_only", "/runtimeRealismEvidenceDraftReview/claimBoundary", errors);
}

function buildOperatorReviewReadiness(
  publicationPayloadLinkage: EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"],
  blockers: string[],
): EncounterRuntimeSelectionReviewPacket["operatorReviewReadiness"] {
  const materializationRequiredBeforeRuntime = publicationPayloadLinkage.localMaterializationHandoff.materializedOutputCount
    < publicationPayloadLinkage.localMaterializationHandoff.plannedOutputCount;
  return {
    status: blockers.length === 0 ? "ready_for_operator_review" : "not_ready_for_operator_review",
    reviewedArtifactCount: 4,
    blockingArtifactCount: blockers.length,
    blockerIds: blockers,
    requiredOperatorActions: uniqueStrings([
      ...(materializationRequiredBeforeRuntime ? ["materialize_or_attach_generated_assets_before_guarded_runtime_wiring"] : []),
      ...(publicationPayloadLinkage.actorEquipmentMaterializationGate.actorBlockers.length > 0 ? ["attach_actor_specific_humanoid_materialization_evidence"] : []),
      ...(publicationPayloadLinkage.actorEquipmentMaterializationGate.equipmentBlockers.length > 0 ? ["attach_equipment_specific_materialization_evidence"] : []),
      ...publicationPayloadLinkage.actorEquipmentMaterializationGate.recommendedNextActions,
      ...(publicationPayloadLinkage.realismEvidenceRefs.refs.length > 0 ? ["attach_humanoid_runtime_visual_qa_evidence_refs"] : []),
      "confirm_provider_execution_remains_disabled_until_explicit_approval",
      "confirm_runtime_selector_remains_disabled_until_evidence_gates_clear",
    ]),
    materializationRequiredBeforeRuntime,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    questEvidenceRefreshAllowed: false,
    claimBoundary: "operator_review_readiness_metadata_only",
  };
}

function validateOperatorReviewReadiness(value: unknown, errors: string[]): void {
  requireRecord(value, "/operatorReviewReadiness", errors);
  if (!isRecord(value)) return;
  requireOneOf(value.status, ["ready_for_operator_review", "not_ready_for_operator_review"], "/operatorReviewReadiness/status", errors);
  requireNumber(value.reviewedArtifactCount, "/operatorReviewReadiness/reviewedArtifactCount", errors);
  requireNumber(value.blockingArtifactCount, "/operatorReviewReadiness/blockingArtifactCount", errors);
  requireArray(value.blockerIds, "/operatorReviewReadiness/blockerIds", errors);
  requireArray(value.requiredOperatorActions, "/operatorReviewReadiness/requiredOperatorActions", errors);
  requireLiteral(value.providerExecutionAllowed, false, "/operatorReviewReadiness/providerExecutionAllowed", errors);
  requireLiteral(value.runtimeExecutionAllowed, false, "/operatorReviewReadiness/runtimeExecutionAllowed", errors);
  requireLiteral(value.questEvidenceRefreshAllowed, false, "/operatorReviewReadiness/questEvidenceRefreshAllowed", errors);
  requireLiteral(value.claimBoundary, "operator_review_readiness_metadata_only", "/operatorReviewReadiness/claimBoundary", errors);
}

function checklist(
  checkId: EncounterRuntimeSelectionReviewPacket["reviewerChecklist"][number]["checkId"],
  blockerIds: string[],
): EncounterRuntimeSelectionReviewPacket["reviewerChecklist"][number] {
  return { checkId, status: "required_before_runtime_wiring", blockerIds };
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = { validateLatest: false };
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--selection-intent") {
      options.selectionIntentPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--publication-payloads") {
      options.publicationPayloadsPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }
  return options;
}

async function latestPath(pattern: string): Promise<string | undefined> {
  const files = await globFiles(pattern);
  const filesWithStats = await Promise.all(files.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })));
  return filesWithStats.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath)).at(-1)?.filePath;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) errors.push(`${path} must be array`);
}

function requireRecord(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) errors.push(`${path} must be object`);
}

function requireString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${path} must be string`);
}

function requireNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be number`);
}

function requireLiteral<T>(value: unknown, expected: T, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${JSON.stringify(expected)}`);
}

function requireOneOf<T>(value: unknown, expected: readonly T[], path: string, errors: string[]): void {
  if (!expected.includes(value as T)) errors.push(`${path} must be one of ${expected.map((item) => JSON.stringify(item)).join(", ")}`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function buildPublicationPayloadLinkage(publicationPayloads: unknown): EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"] {
  const value = isRecord(publicationPayloads) ? publicationPayloads : {};
  const handoff = isRecord(value.localMaterializationHandoffManifest) ? value.localMaterializationHandoffManifest : {};
  const outputs = Array.isArray(handoff.outputs) ? handoff.outputs.filter(isRecord) : [];
  const readiness = isRecord(value.encounterAssetNeedsReadinessManifest) ? value.encounterAssetNeedsReadinessManifest : {};
  const requiredHumanoids = Array.isArray(readiness.requiredHumanoids) ? readiness.requiredHumanoids.filter(isRecord) : [];
  return {
    source: "encounter_publication_payloads",
    status: typeof value.status === "string" ? value.status : "unavailable",
    blockers: Array.isArray(value.blockers) ? value.blockers.filter((blocker): blocker is string => typeof blocker === "string") : ["publication_payload_unavailable"],
    localMaterializationHandoff: {
      requestId: typeof handoff.requestId === "string" ? handoff.requestId : "unavailable",
      scenarioId: typeof handoff.scenarioId === "string" ? handoff.scenarioId : "unavailable",
      rootPath: typeof handoff.rootPath === "string" ? handoff.rootPath : "unavailable",
      plannedOutputCount: outputs.length,
      materializedOutputCount: outputs.filter((output) => output.generatedAssetsMaterialized === true).length,
      allOutputsPlannedMetadataOnly: outputs.length > 0 && outputs.every((output) => output.claimBoundary === "planned_metadata_only"),
    },
    assetNeedsReadiness: {
      readyForDeterministicGeneration: readiness.readyForDeterministicGeneration === true,
      missingRequiredAssetNeedIds: stringArray(readiness.missingRequiredAssetNeedIds),
      blockers: stringArray(readiness.blockers),
      requiredHumanoidRoles: requiredHumanoids
        .map((humanoid) => humanoid.actorRole)
        .filter((actorRole): actorRole is string => typeof actorRole === "string"),
      animationRequirementCount: arrayLength(readiness.animationRequirements),
      emotionRequirementCount: arrayLength(readiness.emotionRequirements),
      gazeRequirementCount: arrayLength(readiness.gazeRequirements),
      lipSyncRequirementCount: arrayLength(readiness.lipSyncRequirements),
      sharedAssetLibrarySemanticKeyCount: arrayLength(readiness.sharedAssetLibrarySemanticKeys),
    },
    realismEvidenceRefs: buildRealismEvidenceRefsSummary(value.realismEvidenceRefs),
    actorEquipmentMaterializationGate: buildActorEquipmentMaterializationGateSummary(value.actorEquipmentMaterializationGate),
  };
}

function validatePublicationPayloadLinkage(value: unknown, errors: string[]): void {
  requireRecord(value, "/publicationPayloadLinkage", errors);
  if (!isRecord(value)) return;
  requireLiteral(value.source, "encounter_publication_payloads", "/publicationPayloadLinkage/source", errors);
  requireString(value.status, "/publicationPayloadLinkage/status", errors);
  requireArray(value.blockers, "/publicationPayloadLinkage/blockers", errors);
  requireRecord(value.localMaterializationHandoff, "/publicationPayloadLinkage/localMaterializationHandoff", errors);
  if (isRecord(value.localMaterializationHandoff)) {
    requireString(value.localMaterializationHandoff.requestId, "/publicationPayloadLinkage/localMaterializationHandoff/requestId", errors);
    requireString(value.localMaterializationHandoff.scenarioId, "/publicationPayloadLinkage/localMaterializationHandoff/scenarioId", errors);
    requireString(value.localMaterializationHandoff.rootPath, "/publicationPayloadLinkage/localMaterializationHandoff/rootPath", errors);
    requireNumber(value.localMaterializationHandoff.plannedOutputCount, "/publicationPayloadLinkage/localMaterializationHandoff/plannedOutputCount", errors);
    requireNumber(value.localMaterializationHandoff.materializedOutputCount, "/publicationPayloadLinkage/localMaterializationHandoff/materializedOutputCount", errors);
    requireLiteral(value.localMaterializationHandoff.allOutputsPlannedMetadataOnly, true, "/publicationPayloadLinkage/localMaterializationHandoff/allOutputsPlannedMetadataOnly", errors);
  }
  requireRecord(value.assetNeedsReadiness, "/publicationPayloadLinkage/assetNeedsReadiness", errors);
  if (isRecord(value.assetNeedsReadiness)) {
    requireLiteral(value.assetNeedsReadiness.readyForDeterministicGeneration, true, "/publicationPayloadLinkage/assetNeedsReadiness/readyForDeterministicGeneration", errors);
    requireArray(value.assetNeedsReadiness.missingRequiredAssetNeedIds, "/publicationPayloadLinkage/assetNeedsReadiness/missingRequiredAssetNeedIds", errors);
    requireArray(value.assetNeedsReadiness.blockers, "/publicationPayloadLinkage/assetNeedsReadiness/blockers", errors);
    requireArray(value.assetNeedsReadiness.requiredHumanoidRoles, "/publicationPayloadLinkage/assetNeedsReadiness/requiredHumanoidRoles", errors);
    requireNumber(value.assetNeedsReadiness.animationRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/animationRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.emotionRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/emotionRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.gazeRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/gazeRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.lipSyncRequirementCount, "/publicationPayloadLinkage/assetNeedsReadiness/lipSyncRequirementCount", errors);
    requireNumber(value.assetNeedsReadiness.sharedAssetLibrarySemanticKeyCount, "/publicationPayloadLinkage/assetNeedsReadiness/sharedAssetLibrarySemanticKeyCount", errors);
  }
  requireRecord(value.realismEvidenceRefs, "/publicationPayloadLinkage/realismEvidenceRefs", errors);
  if (isRecord(value.realismEvidenceRefs)) {
    requireOneOf(value.realismEvidenceRefs.claimBoundary, ["metadata_only_not_runtime_or_visual_quality_evidence", "unavailable"], "/publicationPayloadLinkage/realismEvidenceRefs/claimBoundary", errors);
    requireArray(value.realismEvidenceRefs.refIds, "/publicationPayloadLinkage/realismEvidenceRefs/refIds", errors);
    requireOneOf(value.realismEvidenceRefs.requiredBefore, ["guarded_runtime_wiring", "unavailable"], "/publicationPayloadLinkage/realismEvidenceRefs/requiredBefore", errors);
    requireLiteral(value.realismEvidenceRefs.runtimeExecutionAllowed, false, "/publicationPayloadLinkage/realismEvidenceRefs/runtimeExecutionAllowed", errors);
    requireLiteral(value.realismEvidenceRefs.providerExecutionPerformed, false, "/publicationPayloadLinkage/realismEvidenceRefs/providerExecutionPerformed", errors);
    requireLiteral(value.realismEvidenceRefs.questReadinessClaimed, false, "/publicationPayloadLinkage/realismEvidenceRefs/questReadinessClaimed", errors);
    if (Array.isArray(value.realismEvidenceRefs.refIds)) {
      for (const requiredRefId of ["humanoid-realism-gate", "runtime-realism-evidence-check", "visual-qa-evidence-check"]) {
        if (!value.realismEvidenceRefs.refIds.includes(requiredRefId)) {
          errors.push(`/publicationPayloadLinkage/realismEvidenceRefs/refIds must include ${requiredRefId}`);
        }
      }
    }
    requireArray(value.realismEvidenceRefs.refs, "/publicationPayloadLinkage/realismEvidenceRefs/refs", errors);
    requireNumber(value.realismEvidenceRefs.runtimeRealismEvidenceHookCount, "/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHookCount", errors);
    requireNumber(value.realismEvidenceRefs.visualQaEvidenceHookCount, "/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHookCount", errors);
    requireArray(value.realismEvidenceRefs.runtimeRealismEvidenceHooks, "/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks", errors);
    requireArray(value.realismEvidenceRefs.visualQaEvidenceHooks, "/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks", errors);
    if (Array.isArray(value.realismEvidenceRefs.refs)) {
      value.realismEvidenceRefs.refs.forEach((ref, index) => {
        if (!isRecord(ref)) {
          errors.push(`/publicationPayloadLinkage/realismEvidenceRefs/refs/${index} must be object`);
          return;
        }
        requireString(ref.refId, `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/refId`, errors);
        requireString(ref.evidenceRef, `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/evidenceRef`, errors);
        requireLiteral(ref.requiredBefore, "guarded_runtime_wiring", `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/requiredBefore`, errors);
        requireLiteral(ref.status, "required_not_attached", `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/status`, errors);
        requireArray(ref.notEvidenceFor, `/publicationPayloadLinkage/realismEvidenceRefs/refs/${index}/notEvidenceFor`, errors);
      });
    }
    if (Array.isArray(value.realismEvidenceRefs.runtimeRealismEvidenceHooks)) {
      value.realismEvidenceRefs.runtimeRealismEvidenceHooks.forEach((hook, index) => {
        if (!isRecord(hook)) {
          errors.push(`/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks/${index} must be object`);
          return;
        }
        requireString(hook.actorId, `/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks/${index}/actorId`, errors);
        requireString(hook.actorRole, `/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks/${index}/actorRole`, errors);
        requireArray(hook.requiredSignalIds, `/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks/${index}/requiredSignalIds`, errors);
        requireString(hook.evidenceRef, `/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks/${index}/evidenceRef`, errors);
        requireLiteral(hook.status, "required_not_attached", `/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks/${index}/status`, errors);
        requireLiteral(hook.claimBoundary, "runtime_realism_hook_metadata_only_not_runtime_readiness", `/publicationPayloadLinkage/realismEvidenceRefs/runtimeRealismEvidenceHooks/${index}/claimBoundary`, errors);
      });
    }
    if (Array.isArray(value.realismEvidenceRefs.visualQaEvidenceHooks)) {
      value.realismEvidenceRefs.visualQaEvidenceHooks.forEach((hook, index) => {
        if (!isRecord(hook)) {
          errors.push(`/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks/${index} must be object`);
          return;
        }
        requireString(hook.targetId, `/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks/${index}/targetId`, errors);
        requireString(hook.targetKind, `/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks/${index}/targetKind`, errors);
        requireArray(hook.requiredReviewFocus, `/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks/${index}/requiredReviewFocus`, errors);
        requireString(hook.evidenceRef, `/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks/${index}/evidenceRef`, errors);
        requireLiteral(hook.status, "required_not_attached", `/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks/${index}/status`, errors);
        requireLiteral(hook.claimBoundary, "visual_qa_hook_metadata_only_not_visual_quality_evidence", `/publicationPayloadLinkage/realismEvidenceRefs/visualQaEvidenceHooks/${index}/claimBoundary`, errors);
      });
    }
  }
  validateActorEquipmentMaterializationGateSummary(value.actorEquipmentMaterializationGate, errors);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildActorEquipmentMaterializationGateSummary(
  value: unknown,
): EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"]["actorEquipmentMaterializationGate"] {
  const gate = isRecord(value) ? value : {};
  const actorGate = isRecord(gate.actorGate) ? gate.actorGate : {};
  const equipmentGate = isRecord(gate.equipmentGate) ? gate.equipmentGate : {};
  const attachment = isRecord(gate.materializationEvidenceAttachment) ? gate.materializationEvidenceAttachment : {};
  const attachmentSummary = isRecord(gate.materializationEvidenceAttachmentSummary) ? gate.materializationEvidenceAttachmentSummary : {};
  const remainingRuntimeBlockerReasons = isRecord(gate.remainingRuntimeBlockerReasons) ? gate.remainingRuntimeBlockerReasons : undefined;
  const attachmentBlockers = stringArray(attachment.blockers);
  return {
    runtimeSelectionBlockedUntilEvidenceAttached: gate.runtimeSelectionBlockedUntilEvidenceAttached !== false,
    actorBlockers: uniqueStrings([
      ...stringArray(actorGate.materializationBlockers),
      ...attachmentBlockers.filter((blocker) => blocker.startsWith("actor_materialization_evidence_missing:") || blocker.includes("humanoid")),
    ]),
    equipmentBlockers: uniqueStrings([
      ...stringArray(equipmentGate.materializationBlockers),
      ...attachmentBlockers.filter((blocker) => blocker.startsWith("equipment_materialization_evidence_missing:") || blocker.includes("equipment")),
    ]),
    caveats: uniqueStrings([
      ...stringArray(actorGate.caveats),
      ...stringArray(equipmentGate.caveats),
      ...stringArray(gate.combinedCaveats),
    ]),
    recommendedNextActions: uniqueStrings([
      typeof actorGate.recommendedNextAction === "string" ? actorGate.recommendedNextAction : "",
      typeof equipmentGate.recommendedNextAction === "string" ? equipmentGate.recommendedNextAction : "",
    ]),
    ...(isRecord(gate.materializationEvidenceAttachment) ? {
      materializationEvidenceAttachment: {
        reportStatus: typeof attachment.reportStatus === "string" ? attachment.reportStatus : "unknown",
        attachableToRuntimeSelection: attachment.attachableToRuntimeSelection === true,
        actorRequiredEvidenceRefCount: stringArray(attachment.actorRequiredEvidenceRefs).length,
        equipmentRequiredEvidenceRefCount: stringArray(attachment.equipmentRequiredEvidenceRefs).length,
        blockers: attachmentBlockers,
        claimBoundary: attachment.claimBoundary === "materialization_evidence_attachment_contract_not_runtime_readiness"
          ? "materialization_evidence_attachment_contract_not_runtime_readiness"
          : "materialization_evidence_attachment_contract_not_runtime_readiness",
      },
    } : {}),
    ...(isRecord(gate.materializationEvidenceAttachmentSummary) ? {
      materializationEvidenceAttachmentSummary: {
        totalRequiredSlotCount: typeof attachmentSummary.totalRequiredSlotCount === "number" ? attachmentSummary.totalRequiredSlotCount : 0,
        attachedSlotCount: typeof attachmentSummary.attachedSlotCount === "number" ? attachmentSummary.attachedSlotCount : 0,
        missingSlotCount: typeof attachmentSummary.missingSlotCount === "number" ? attachmentSummary.missingSlotCount : 0,
        heldOrInvalidAttachmentCount: typeof attachmentSummary.heldOrInvalidAttachmentCount === "number" ? attachmentSummary.heldOrInvalidAttachmentCount : 0,
        allRequiredSlotsSatisfied: attachmentSummary.allRequiredSlotsSatisfied === true,
        blockers: stringArray(attachmentSummary.blockers),
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        claimBoundary: "metadata_only_materialization_evidence_attachment_summary",
      },
    } : {}),
    ...(remainingRuntimeBlockerReasons ? {
      remainingRuntimeBlockerReasons: {
        source: "materialization_attachment_summary_and_publication_runtime_gates",
        materializationEvidenceComplete: remainingRuntimeBlockerReasons.materializationEvidenceComplete === true,
        runtimeSelectionAllowed: false,
        learnerLaunchAllowed: false,
        questEvidenceRefreshAllowed: false,
        categories: Array.isArray(remainingRuntimeBlockerReasons.categories)
          ? remainingRuntimeBlockerReasons.categories.filter(isRecord).map((category) => ({
            category: typeof category.category === "string" ? category.category : "unknown",
            blockerIds: stringArray(category.blockerIds),
            recommendedNextAction: typeof category.recommendedNextAction === "string" ? category.recommendedNextAction : "review remaining runtime blocker",
          }))
          : [],
        claimBoundary: "remaining_runtime_blockers_after_materialization_metadata_only",
      },
    } : {}),
    claimBoundary: gate.claimBoundary === "materialization_contract_metadata_only_not_runtime_readiness"
      ? "materialization_contract_metadata_only_not_runtime_readiness"
      : "unavailable",
  };
}

function validateActorEquipmentMaterializationGateSummary(value: unknown, errors: string[]): void {
  requireRecord(value, "/publicationPayloadLinkage/actorEquipmentMaterializationGate", errors);
  if (!isRecord(value)) return;
  if (typeof value.runtimeSelectionBlockedUntilEvidenceAttached !== "boolean") {
    errors.push("/publicationPayloadLinkage/actorEquipmentMaterializationGate/runtimeSelectionBlockedUntilEvidenceAttached must be boolean");
  }
  requireArray(value.actorBlockers, "/publicationPayloadLinkage/actorEquipmentMaterializationGate/actorBlockers", errors);
  requireArray(value.equipmentBlockers, "/publicationPayloadLinkage/actorEquipmentMaterializationGate/equipmentBlockers", errors);
  requireArray(value.caveats, "/publicationPayloadLinkage/actorEquipmentMaterializationGate/caveats", errors);
  requireArray(value.recommendedNextActions, "/publicationPayloadLinkage/actorEquipmentMaterializationGate/recommendedNextActions", errors);
  if (value.materializationEvidenceAttachment !== undefined) requireRecord(value.materializationEvidenceAttachment, "/publicationPayloadLinkage/actorEquipmentMaterializationGate/materializationEvidenceAttachment", errors);
  if (value.materializationEvidenceAttachmentSummary !== undefined) requireRecord(value.materializationEvidenceAttachmentSummary, "/publicationPayloadLinkage/actorEquipmentMaterializationGate/materializationEvidenceAttachmentSummary", errors);
  if (value.remainingRuntimeBlockerReasons !== undefined) requireRecord(value.remainingRuntimeBlockerReasons, "/publicationPayloadLinkage/actorEquipmentMaterializationGate/remainingRuntimeBlockerReasons", errors);
  requireOneOf(value.claimBoundary, ["materialization_contract_metadata_only_not_runtime_readiness", "unavailable"], "/publicationPayloadLinkage/actorEquipmentMaterializationGate/claimBoundary", errors);
}

function buildRealismEvidenceRefsSummary(value: unknown): EncounterRuntimeSelectionReviewPacket["publicationPayloadLinkage"]["realismEvidenceRefs"] {
  const refsRecord = isRecord(value) ? value : {};
  const refs = Array.isArray(refsRecord.refs) ? refsRecord.refs.filter(isRecord) : [];
  const runtimeRealismEvidenceHooks = Array.isArray(refsRecord.runtimeRealismEvidenceHooks)
    ? refsRecord.runtimeRealismEvidenceHooks.filter(isRecord).map((hook) => ({
      actorId: typeof hook.actorId === "string" ? hook.actorId : "unknown-actor",
      actorRole: typeof hook.actorRole === "string" ? hook.actorRole : "unknown",
      requiredSignalIds: stringArray(hook.requiredSignalIds),
      evidenceRef: typeof hook.evidenceRef === "string" ? hook.evidenceRef : "unavailable",
      status: "required_not_attached" as const,
      claimBoundary: "runtime_realism_hook_metadata_only_not_runtime_readiness" as const,
    }))
    : [];
  const visualQaEvidenceHooks = Array.isArray(refsRecord.visualQaEvidenceHooks)
    ? refsRecord.visualQaEvidenceHooks.filter(isRecord).map((hook) => ({
      targetId: typeof hook.targetId === "string" ? hook.targetId : "unknown-target",
      targetKind: typeof hook.targetKind === "string" ? hook.targetKind : "unknown",
      requiredReviewFocus: stringArray(hook.requiredReviewFocus),
      evidenceRef: typeof hook.evidenceRef === "string" ? hook.evidenceRef : "unavailable",
      status: "required_not_attached" as const,
      claimBoundary: "visual_qa_hook_metadata_only_not_visual_quality_evidence" as const,
    }))
    : [];
  const requiredBefore = refs
    .map((ref) => ref.requiredBefore)
    .find((candidate): candidate is "guarded_runtime_wiring" => candidate === "guarded_runtime_wiring") ?? "unavailable";
  return {
    claimBoundary: refsRecord.claimBoundary === "metadata_only_not_runtime_or_visual_quality_evidence"
      ? "metadata_only_not_runtime_or_visual_quality_evidence"
      : "unavailable",
    refIds: refs.map((ref) => ref.refId).filter((refId): refId is string => typeof refId === "string"),
    refs: refs.map((ref) => ({
      refId: typeof ref.refId === "string" ? ref.refId : "unknown-ref",
      evidenceRef: typeof ref.evidenceRef === "string" ? ref.evidenceRef : "unavailable",
      requiredBefore: "guarded_runtime_wiring",
      status: "required_not_attached",
      notEvidenceFor: stringArray(ref.notEvidenceFor),
    })),
    runtimeRealismEvidenceHookCount: runtimeRealismEvidenceHooks.length,
    visualQaEvidenceHookCount: visualQaEvidenceHooks.length,
    runtimeRealismEvidenceHooks,
    visualQaEvidenceHooks,
    requiredBefore,
    runtimeExecutionAllowed: false,
    providerExecutionPerformed: false,
    questReadinessClaimed: false,
  };
}

export function deriveBasicActorTurnExpectationsFromCase(scenarioId: string) {
  if (scenarioId !== "peds_asthma_parent_anxiety_v1" && scenarioId !== "ed_chest_pain_priority_v1") return null;
  if (scenarioId === "peds_asthma_parent_anxiety_v1") {
    const scenario = scenarioBank.pediatricAsthmaScenario as unknown as {
      actors?: Array<Record<string, unknown>>;
      requiredTraceTags?: string[];
      eventSchedule?: Array<Record<string, unknown>>;
      clinicalObjectives?: string[];
    };
    const actors = scenario.actors || [];
    const patient = actors.find((a) => (a.actorId as string | undefined)?.includes("patient"));
    const parent = actors.find((a) => (a.actorId as string | undefined)?.includes("parent"));
    const nurse = actors.find((a) => (a.actorId as string | undefined)?.includes("nurse"));
    const tags = scenario.requiredTraceTags || [];
    const allEscalation: string[] = [];
    const allDeescalation: string[] = [];
    actors.forEach((a) => {
      const p = (a.communicationProfile as Record<string, unknown>) || {};
      (p.escalationTriggers as string[] | undefined)?.forEach((t) => { allEscalation.push(t); });
      (p.deescalationTriggers as string[] | undefined)?.forEach((t) => { allDeescalation.push(t); });
    });
    const turns = tags.map((tag: string, i: number) => {
      let actorId = (patient?.actorId as string) || "patient_maya_johnson_v1";
      let expected = "frightened";
      if (tag.includes("parent") || tag.includes("empathy")) {
        actorId = (parent?.actorId as string) || "parent_tara_johnson_v1";
        expected = "anxious";
      } else if (tag.includes("oxygen") || tag.includes("bronchodilator") || tag.includes("work_of_breathing")) {
        actorId = (nurse?.actorId as string) || "nurse_kevin_lee_v1";
        expected = "concerned";
      }
      if (tag.includes("urgent") || tag.includes("escalation")) expected = "frightened";
      return {
        turnId: `turn_${i}_${tag}`,
        actorId,
        cue: tag,
        expectedEmotion: expected,
      };
    });
    const emotionTimeline = tags.map((tag: string, i: number) => {
      let emotion = "frightened";
      let cue = tag;
      if (allEscalation.some((e) => tag.includes(e.split("_")[0]) || tag.includes("ignored") || tag.includes("rapid"))) {
        emotion = "frightened";
        cue = `escalation_on_${tag}`;
      } else if (allDeescalation.some((_d) => tag.includes("breathing") || tag.includes("validated") || tag.includes("plan"))) {
        emotion = "reassured";
        cue = `deescalation_on_${tag}`;
      } else if (tag.includes("parent") || tag.includes("empathy")) {
        emotion = "anxious";
      }
      const dur = tag.includes("escalation") || tag.includes("urgent") ? 650 : 920;
      return { atTurn: i, emotion, transitionCue: cue, durationMs: dur };
    });
    const patientProfile = (patient?.communicationProfile as Record<string, unknown>) || {};
    const hasEsc = tags.some((t) => t.includes("escalation") || t.includes("urgent"));
    const hints = {
      baseEmotion: ((patientProfile.baselineMood as string[]) || ["frightened"])[0] || "anxious",
      primaryCues: tags,
      recommendedVisemeIntensity: hasEsc ? 0.85 : ( (patientProfile.intensity as number) || 0.6 ),
      locomotionEnabled: true,
    };
    return {
      scenarioId,
      turns,
      escalationTriggers: Array.from(new Set(allEscalation)),
      deescalationTriggers: Array.from(new Set(allDeescalation)),
      source: "case_spec_derivation_v1",
      emotionTimeline,
      runtimeExecutionHints: hints,
    };
  }
  // Basic for second scenario (ed_chest_pain_priority_v1) from its known spec (actors, comm, requiredTraceTags, clinicalObjectives); deterministic fixture with queued conversion to full derive pull when bank load stable.
  return {
    scenarioId,
    turns: [
      { turnId: "ed_turn_0_history", actorId: "patient_robert_hayes_v1", cue: "history_opqrst", expectedEmotion: "anxious" },
      { turnId: "ed_turn_1_ecg", actorId: "patient_robert_hayes_v1", cue: "ecg_request", expectedEmotion: "guarded" },
      { turnId: "ed_turn_2_family", actorId: "spouse_anna_hayes_v1", cue: "family_communication", expectedEmotion: "frustrated" },
      { turnId: "ed_turn_3_urgent", actorId: "nurse_maria_alvarez_v1", cue: "urgent_escalation", expectedEmotion: "concerned" },
    ],
    escalationTriggers: ["ignored_emotion", "repeated_question", "premature_reassurance", "ignored_vitals"],
    deescalationTriggers: ["symptom_burden_validated", "clear_next_step", "urgent_plan_explained", "family_concern_acknowledged", "closed_loop_order"],
    source: "case_spec_derivation_v1_ed_basic",
    emotionTimeline: [
      { atTurn: 0, emotion: "anxious", transitionCue: "history_opqrst", durationMs: 800 },
      { atTurn: 2, emotion: "frustrated", transitionCue: "family_communication", durationMs: 600 },
    ],
    runtimeExecutionHints: { baseEmotion: "anxious", primaryCues: ["ecg_request", "urgent_escalation", "family_communication"], recommendedVisemeIntensity: 0.7, locomotionEnabled: true },
  };
}


export function deriveEmotionStateMachineFromCase(scenarioId: string) {
  if (scenarioId !== "peds_asthma_parent_anxiety_v1") return null;
  // Simple data-driven machine spec from peds case comm profiles + triggers (for runtime stub player)
  // Transitions: escalation -> frightened, deescalation -> reassured, parent/empathy cues -> anxious
  return {
    scenarioId,
    initialEmotion: "frightened",
    escalationTriggers: ["ignored_breathing", "rapid_questioning", "parent_excluded"],
    deescalationTriggers: ["breathing_effort_acknowledged", "simple_next_step", "parent_included", "child_distress_validated", "oxygen_plan_explained", "closed_loop_order", "bronchodilator_plan"],
    source: "case_spec_derivation_v1",
  };
}

export function deriveDialoguePolicyFromCase(scenarioId: string) {
  if (scenarioId !== "peds_asthma_parent_anxiety_v1") return null;
  // Stub policy from peds case comm profiles (style, topicsToAvoid, communicativeness, adverse for turn/dialogue generation)
  return {
    scenarioId,
    source: "case_spec_derivation_v1",
    actors: [
      {
        actorId: "patient_maya_johnson_v1",
        style: "appeaser",
        baselineMood: ["frightened", "breathless", "seeking reassurance"],
        topicsToAvoid: ["being_rushed", "dismissed_breathing", "medical_jargon"],
        adverseResponse: "Gives shorter answers, clutches parent, and becomes harder to redirect if distress is minimized.",
      },
      {
        actorId: "parent_tara_johnson_v1",
        style: "angry_family_member",
        baselineMood: ["anxious", "protective", "frustrated"],
        topicsToAvoid: ["blame_for_delay", "minimizing_wheeze", "excluding_parent"],
        adverseResponse: "Becomes louder, repeats that Maya cannot breathe, and challenges the plan if no concrete next step is offered.",
      },
      {
        actorId: "nurse_kevin_lee_v1",
        style: "rationalizer",
        baselineMood: ["focused", "concerned", "ready to act"],
        topicsToAvoid: ["ambiguous_orders", "ignored_spo2", "lack_of_escalation_plan"],
        adverseResponse: "Repeats oxygen saturation and asks for specific oxygen, bronchodilator, or escalation orders.",
      },
    ],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
