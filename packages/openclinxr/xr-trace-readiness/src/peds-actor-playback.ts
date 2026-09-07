import type { Group, Vector3 } from "three";
import type {
  PedsActorListenerAnimationSlot,
  PedsActorListenerCueContext,
  PedsActorListenerCueInput,
  PedsActorListenerEmotion,
  PedsActorListenerExpressionState,
  PedsActorListenerExpressionWeights,
  PedsActorPlayerPlaybackContext,
  PedsActorPlayerPlaybackInput,
} from "./types.js";

export type PedsActorPlayerRuntimeTurnLike = {
  actorId: string;
  turnId: string;
  cue: string;
  text: string;
  emotion: string;
  gazeTargetKind: "learner_camera" | "actor";
  gazeTargetActorId: string | null;
  roleAnimationClipName: string;
  source: "bundle_dialogue_turn" | "actor_player_sample_fallback";
};

export type PedsActorPlayerRuntimeSequenceLike = {
  sequenceId: string;
  traceTag: string;
  source: "bundle_dialogue_sequence" | "single_runtime_turn";
  turns: PedsActorPlayerRuntimeTurnLike[];
};

export function pedsActorPlayerRuntimeTurns(): PedsActorPlayerRuntimeTurnLike[] {
  return [
    {
      actorId: "patient_maya_johnson_v1",
      turnId: "turn_1_inhaler_history",
      cue: "inhaler_history",
      text: "Maya: It feels tight when I breathe.",
      emotion: "pain",
      gazeTargetKind: "learner_camera",
      gazeTargetActorId: null,
      roleAnimationClipName: "openclinxr_role_patient_asthma_breathing_effort",
      source: "actor_player_sample_fallback",
    },
    {
      actorId: "parent_tara_johnson_v1",
      turnId: "turn_6_parent_communication",
      cue: "parent_communication",
      text: "Tara: I am really worried about Maya's breathing.",
      emotion: "anxious",
      gazeTargetKind: "actor",
      gazeTargetActorId: "patient_maya_johnson_v1",
      roleAnimationClipName: "openclinxr_role_parent_anxious_fidget_guard",
      source: "actor_player_sample_fallback",
    },
    {
      actorId: "nurse_kevin_lee_v1",
      turnId: "turn_0_work_of_breathing_assessment",
      cue: "work_of_breathing_assessment",
      text: "Kevin: I am watching her breathing effort and will call out any change.",
      emotion: "concerned",
      gazeTargetKind: "actor",
      gazeTargetActorId: "patient_maya_johnson_v1",
      roleAnimationClipName: "openclinxr_role_nurse_clinical_check_reassure",
      source: "actor_player_sample_fallback",
    },
    {
      actorId: "nurse_kevin_lee_v1",
      turnId: "turn_3_oxygen_request",
      cue: "oxygen_request",
      text: "Kevin: I am starting oxygen and keeping her positioned upright.",
      emotion: "concerned",
      gazeTargetKind: "actor",
      gazeTargetActorId: "patient_maya_johnson_v1",
      roleAnimationClipName: "openclinxr_role_nurse_clinical_check_reassure",
      source: "actor_player_sample_fallback",
    },
    {
      actorId: "parent_tara_johnson_v1",
      turnId: "turn_7_empathy_statement",
      cue: "empathy_statement",
      text: "Tara: Please tell me what is happening and what you need me to do.",
      emotion: "anxious",
      gazeTargetKind: "learner_camera",
      gazeTargetActorId: null,
      roleAnimationClipName: "openclinxr_role_parent_anxious_fidget_guard",
      source: "actor_player_sample_fallback",
    },
    {
      actorId: "patient_maya_johnson_v1",
      turnId: "turn_8_reassessment",
      cue: "reassessment",
      text: "Maya: It is a little easier when I sit up.",
      emotion: "reassured",
      gazeTargetKind: "learner_camera",
      gazeTargetActorId: null,
      roleAnimationClipName: "openclinxr_role_patient_asthma_breathing_effort",
      source: "actor_player_sample_fallback",
    },
  ];
}

export function listenerEmotionForSequence(activeTurn: { emotion: string }): PedsActorListenerEmotion {
  if (activeTurn.emotion === "pain" || activeTurn.emotion === "anxious") {
    return "concerned";
  }
  if (activeTurn.emotion === "reassured") {
    return "reassured";
  }
  return "concerned";
}

export function applyPedsActorPlayerSequenceListenerCues(
  ctx: PedsActorListenerCueContext,
  activeTurn: PedsActorListenerCueInput["activeTurn"],
  sequence: PedsActorListenerCueInput["sequence"],
  nowMs: number,
): { actorIds: string[]; coupledSignalIds: string[] } {
  if (!sequence || sequence.turns.length <= 1) {
    return { actorIds: [], coupledSignalIds: [] };
  }
  const activeActorSlot = ctx.actorSlotsByActorId.get(activeTurn.actorId);
  if (!activeActorSlot) {
    return { actorIds: [], coupledSignalIds: [] };
  }
  const targetWorld = activeActorSlot.getWorldPosition(ctx.createVector(0, 0, 0));
  targetWorld.y += 1.18;
  const listenerActorIds = Array.from(
    new Set(sequence.turns.map((turn) => turn.actorId).filter((actorId) => actorId !== activeTurn.actorId)),
  );
  const coupledSignalIds = [
    "sequence_listener_gaze_to_active_speaker",
    "sequence_listener_expression_residual",
    "sequence_listener_body_attention_shift",
  ];
  for (const listenerActorId of listenerActorIds) {
    const slot = ctx.animationSlotsByActorId.get(listenerActorId);
    if (!slot || slot.activeSpeech || slot.sourceComparatorFreezeEnabled) {
      continue;
    }
    const gazeOrigin = ctx.createVector(0, 1.57, 0.29);
    const targetLocal = slot.root.worldToLocal(cloneVector(ctx, targetWorld));
    const boundedTarget = addVector(ctx, clampVectorLength(ctx, subtractVector(ctx, targetLocal, gazeOrigin), 0.35, 1.15), gazeOrigin);
    slot.gazeCue.geometry.setFromPoints([gazeOrigin, boundedTarget]);
    slot.gazeCue.visible = true;
    ctx.orientEyeFocusCue(slot, gazeOrigin, boundedTarget);
    ctx.orientTowardGazeTarget(slot, targetWorld);
    ctx.startEmotionTransition(slot, listenerEmotionForSequence(activeTurn), nowMs);
    const expressionState = ctx.updateEmotionExpression(slot, nowMs);
    slot.expressionCue.visible = true;
    slot.expressionCue.scale.set(
      1 + expressionState.weights.cheekTension * 0.12,
      1 + expressionState.weights.browConcern * 0.09,
      1,
    );
    ctx.applyMorphTargetCue(slot, 0.025, "rest", expressionState.weights);
    slot.root.userData["openClinXrSequenceListeningCue"] = {
      activeSpeakerActorId: activeTurn.actorId,
      sequenceId: sequence.sequenceId,
      traceTag: sequence.traceTag,
      listenerEmotion: expressionState.targetEmotion,
      cueIds: coupledSignalIds,
      notEvidenceFor: "production social gaze, clinical communication scoring, or motion-capture realism",
    };
  }
  return { actorIds: listenerActorIds, coupledSignalIds };
}

function cloneVector(ctx: PedsActorListenerCueContext, vector: Vector3): Vector3 {
  return ctx.createVector(vector.x, vector.y, vector.z);
}

function subtractVector(ctx: PedsActorListenerCueContext, left: Vector3, right: Vector3): Vector3 {
  return ctx.createVector(left.x - right.x, left.y - right.y, left.z - right.z);
}

function addVector(ctx: PedsActorListenerCueContext, left: Vector3, right: Vector3): Vector3 {
  return ctx.createVector(left.x + right.x, left.y + right.y, left.z + right.z);
}

function clampVectorLength(ctx: PedsActorListenerCueContext, vector: Vector3, min: number, max: number): Vector3 {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (length === 0) {
    return vector;
  }
  const clamped = Math.min(max, Math.max(min, length));
  const scale = clamped / length;
  return ctx.createVector(vector.x * scale, vector.y * scale, vector.z * scale);
}

export function formatActorPlayerRuntimeMetadataSummary(
  evidence: {
    executionMode: string;
    actorCount: number;
    projectedTurnCount: number;
    projectedSampleCount: number;
    actorSummaries: Array<{
      actorId: string;
      turnCount: number;
      sampleCount: number;
      roleAnimationClipNames?: string[];
      sceneExecutionStatus: string;
      blockerIds: string[];
    }>;
    sourceArtifactPath: string;
    claimBoundary: string;
    notEvidenceFor: string[];
  } | null,
  playback: {
    scheduled: boolean;
    latestTriggerSource?: string | null;
    latestTraceTag?: string | null;
    latestTurnSource?: string | null;
    latestActorId?: string | null;
    latestCue?: string | null;
    latestEmotion?: string | null;
    latestRoleAnimationClipName?: string | null;
    latestSequenceSource?: string | null;
    latestSequenceStepIndex: number;
    latestSequenceTurnCount?: number;
    latestSequenceActorIds?: string[];
    latestListenerActorIds?: string[];
    latestCoupledSignalIds?: string[];
    bundleDialogueTurnCount?: number;
    fallbackTurnCount?: number;
    claimBoundary?: string;
  } | null = null,
): string {
  if (!evidence) {
    return "actor-player metadata pending";
  }
  const actorRows = evidence.actorSummaries
    .map((actor) => {
      const clips = actor.roleAnimationClipNames?.length ? ` clips ${actor.roleAnimationClipNames.join(",")}` : "";
      return `${actor.actorId} ${actor.turnCount}t/${actor.sampleCount}s ${actor.sceneExecutionStatus}${clips}`;
    })
    .join("; ");
  const blockers = Array.from(new Set(evidence.actorSummaries.flatMap((actor) => actor.blockerIds))).join(",");
  return [
    "review-only actor-player metadata",
    evidence.executionMode,
    `${evidence.actorCount} actors`,
    `${evidence.projectedTurnCount} turns`,
    `${evidence.projectedSampleCount} samples`,
    actorRows,
    `source ${evidence.sourceArtifactPath}`,
    playback?.scheduled
      ? `live preview ${playback.latestTriggerSource ?? "pending"} ${playback.latestTraceTag ?? "no-trace"} ${playback.latestTurnSource ?? "unknown-source"} ${playback.latestActorId ?? "pending"} ${playback.latestCue ?? "pending"} emotion ${playback.latestEmotion ?? "pending"} ${playback.latestRoleAnimationClipName ?? "no-role-clip"} sequence ${playback.latestSequenceSource ?? "none"} ${playback.latestSequenceStepIndex + 1}/${playback.latestSequenceTurnCount || 0} actors ${(playback.latestSequenceActorIds ?? []).join(",") || "none"} listeners ${(playback.latestListenerActorIds ?? []).join(",") || "none"} coupled ${(playback.latestCoupledSignalIds ?? []).join(",") || "none"} bundle ${playback.bundleDialogueTurnCount} fallback ${playback.fallbackTurnCount}`
      : "live preview pending",
    `blocked ${blockers || "none"}`,
    evidence.claimBoundary,
    playback?.claimBoundary ?? "local_actor_player_runtime_preview_not_started",
    `not readiness ${evidence.notEvidenceFor.join(",")}`,
  ].join(" | ");
}

export function recordPedsActorPlayerRuntimePlaybackEvidence(
  ctx: PedsActorPlayerPlaybackContext,
  input: PedsActorPlayerPlaybackInput,
): void {
  const actorCount = Array.from(new Set(input.turns.map((turn) => turn.actorId))).length;
  const latestSequenceTurnCount = input.latestSequence?.turns.length ?? 0;
  const latestSequenceActorIds = input.latestSequence
    ? Array.from(new Set(input.latestSequence.turns.map((turn) => turn.actorId)))
    : [];
  ctx.playbackEvidenceWritten({
    source: "window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence",
    scenarioId:
      ctx.selectedHumanoidSourceComparator() === "ed_anny_real_garment_patient"
        ? "ed_chest_pain_priority_v1"
        : "peds_asthma_parent_anxiety_v1",
    playbackMode: "local_desktop_preview_from_bundle_dialogue_or_actor_player_samples",
    sourceArtifactPath:
      "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
    scheduled: input.scheduled,
    actorCount,
    turnCount: input.turns.length,
    bundleDialogueTurnCount: ctx.dialogueTurnCount(),
    fallbackTurnCount: input.turns.length,
    latestTurnIndex: input.latestTurnIndex,
    latestActorId: input.latestTurn?.actorId ?? null,
    latestTurnId: input.latestTurn?.turnId ?? null,
    latestCue: input.latestTurn?.cue ?? null,
    latestEmotion: input.latestTurn?.emotion ?? null,
    latestRoleAnimationClipName: input.latestTurn?.roleAnimationClipName ?? null,
    latestTurnSource: input.latestTurn?.source ?? null,
    latestTriggerSource: input.latestTriggerSource,
    latestTraceTag: input.latestTraceTag,
    latestSequenceId: input.latestSequence?.sequenceId ?? null,
    latestSequenceSource: input.latestSequence?.source ?? null,
    latestSequenceStepIndex: input.latestSequenceStepIndex,
    latestSequenceTurnCount,
    latestSequenceActorIds,
    latestListenerActorIds: input.latestListenerActorIds,
    latestCoupledSignalIds: input.latestCoupledSignalIds,
    activeGeneratedActorSlotCount: ctx.activeGeneratedActorSlotCount(),
    activeHumanoidSpeechEvidenceActorId: ctx.activeHumanoidSpeechEvidenceActorId(),
    scenePlacementEvidenceAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "local_actor_player_runtime_preview_not_readiness",
    notEvidenceFor: [
      "scene_placement_readiness",
      "learner_launch_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  });
}

export function adaptListenerSlotForPackage(
  slot: {
    root: Group;
    gazeCue: { geometry: { setFromPoints: (points: Vector3[]) => void }; visible: boolean };
    expressionCue: { visible: boolean; scale: { set: (x: number, y: number, z: number) => void } };
    activeSpeech: unknown;
    sourceComparatorFreezeEnabled: boolean;
  },
): PedsActorListenerAnimationSlot {
  return slot as PedsActorListenerAnimationSlot;
}

export function adaptListenerEmotionForPackage(emotion: string): PedsActorListenerEmotion {
  if (emotion === "concerned" || emotion === "reassured" || emotion === "neutral" || emotion === "anxious" || emotion === "pain") {
    return emotion;
  }
  return "concerned";
}

export function adaptExpressionStateForPackage(state: {
  targetEmotion: string;
  weights: PedsActorListenerExpressionWeights;
}): PedsActorListenerExpressionState {
  return { targetEmotion: adaptListenerEmotionForPackage(state.targetEmotion), weights: state.weights };
}

export function adaptExpressionWeightsForPackage(weights: {
  mouthOpen: number;
  cheekTension: number;
  browConcern: number;
}): PedsActorListenerExpressionWeights {
  return weights;
}
