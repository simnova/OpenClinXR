import {
  applyPedsActorPlayerSequenceListenerCues as applyPackagePedsActorPlayerSequenceListenerCues,
  recordPedsActorPlayerRuntimePlaybackEvidence as recordPackagePlaybackEvidence,
} from "@openclinxr/xr-trace-readiness";
import type { HumanoidExpressionEmotion } from "@openclinxr/xr-humanoid-animation";
import type { PedsAdaptiveDialogueBranchResolution } from "./policy.js";
import type {
  ActorDialogueAdaptiveEvidence,
  ActorDialoguePlaybackDeps,
  ActorDialoguePlaybackEvidence,
  ActorDialogueSequence,
  ActorDialogueTurn,
} from "./types.js";

export function normalizePedsActorPlayerEmotion(emotion: string): HumanoidExpressionEmotion {
  const normalized = emotion.toLowerCase();
  if (normalized.includes("pain") || normalized.includes("frightened")) return "pain";
  if (normalized.includes("anxious")) return "anxious";
  if (normalized.includes("concern")) return "concerned";
  if (normalized.includes("reassur")) return "reassured";
  return "neutral";
}

export function dedupePedsActorPlayerRuntimeTurns(turns: ActorDialogueTurn[]): ActorDialogueTurn[] {
  const seen = new Set<string>();
  return turns.filter((turn) => {
    const key = `${turn.actorId}:${turn.turnId}:${turn.cue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function pedsActorPlayerBundleDialogueTurns(
  deps: {
    encounterBundle: ActorDialoguePlaybackDeps["encounterBundle"];
    liveFaceEmotionForCue: ActorDialoguePlaybackDeps["liveFaceEmotionForCue"];
    roleClipNameForActor: ActorDialoguePlaybackDeps["roleClipNameForActor"];
  },
): ActorDialogueTurn[] {
  return (deps.encounterBundle().sceneManifest.dialogueTurns ?? []).map((runtimeTurn: {
    actorId: string;
    traceTag: string;
    text: string;
    gazeTargetKind: "learner_camera" | "actor";
    gazeTargetActorId: string | null;
  }) => ({
    actorId: runtimeTurn.actorId,
    turnId: `bundle_${runtimeTurn.traceTag}`,
    cue: runtimeTurn.traceTag,
    text: runtimeTurn.text,
    emotion: deps.liveFaceEmotionForCue(runtimeTurn.traceTag) ?? "neutral",
    gazeTargetKind: runtimeTurn.gazeTargetKind,
    gazeTargetActorId: runtimeTurn.gazeTargetActorId,
    roleAnimationClipName: deps.roleClipNameForActor(runtimeTurn.actorId),
    source: "bundle_dialogue_turn",
  }));
}

export function pedsActorPlayerTurnFromRuntimeBundleTrace(
  deps: {
    encounterBundle: ActorDialoguePlaybackDeps["encounterBundle"];
    liveFaceEmotionForCue: ActorDialoguePlaybackDeps["liveFaceEmotionForCue"];
    roleClipNameForActor: ActorDialoguePlaybackDeps["roleClipNameForActor"];
  },
  traceTag: string,
): ActorDialogueTurn | undefined {
  return pedsActorPlayerBundleDialogueTurns(deps).find((turn) => turn.cue === traceTag);
}

export function pedsActorPlayerTurnForTraceTag(
  deps: {
    encounterBundle: ActorDialoguePlaybackDeps["encounterBundle"];
    liveFaceEmotionForCue: ActorDialoguePlaybackDeps["liveFaceEmotionForCue"];
    roleClipNameForActor: ActorDialoguePlaybackDeps["roleClipNameForActor"];
    fallbackTurns: ActorDialoguePlaybackDeps["fallbackTurns"];
  },
  traceTag: string,
  turns: ActorDialogueTurn[] = deps.fallbackTurns(),
): ActorDialogueTurn | undefined {
  const bundleTurn = pedsActorPlayerTurnFromRuntimeBundleTrace(deps, traceTag);
  if (bundleTurn) {
    return bundleTurn;
  }
  const traceToTurnId: Record<string, string> = {
    inhaler_history: "turn_1_inhaler_history",
    trigger_history: "turn_2_trigger_history",
    work_of_breathing_assessment: "turn_0_work_of_breathing_assessment",
    oxygen_request: "turn_3_oxygen_request",
    parent_communication: "turn_6_parent_communication",
    family_communication: "turn_6_parent_communication",
    empathy_statement: "turn_7_empathy_statement",
    reassessment: "turn_8_reassessment",
    bronchodilator_plan: "turn_8_reassessment",
  };
  const turnId = traceToTurnId[traceTag];
  return turnId ? turns.find((turn) => turn.turnId === turnId) : turns.find((turn) => turn.cue === traceTag);
}

export function pedsActorPlayerRuntimeSequenceForTrace(
  deps: {
    encounterBundle: ActorDialoguePlaybackDeps["encounterBundle"];
    liveFaceEmotionForCue: ActorDialoguePlaybackDeps["liveFaceEmotionForCue"];
    roleClipNameForActor: ActorDialoguePlaybackDeps["roleClipNameForActor"];
    fallbackTurns: ActorDialoguePlaybackDeps["fallbackTurns"];
  },
  traceTag: string,
  fallbackTurns: ActorDialogueTurn[] = deps.fallbackTurns(),
): ActorDialogueSequence | undefined {
  const bundleTurns = pedsActorPlayerBundleDialogueTurns(deps);
  const bundleSequenceTraceTags: Record<string, string[]> = {
    oxygen_request: ["oxygen_request", "work_of_breathing_assessment"],
    bronchodilator_plan: ["bronchodilator_plan", "empathy_statement"],
    parent_communication: ["parent_communication", "empathy_statement"],
    family_communication: ["parent_communication", "empathy_statement"],
    inhaler_history: ["inhaler_history", "trigger_history"],
    trigger_history: ["trigger_history", "inhaler_history"],
  };
  const requestedBundleTurns = (bundleSequenceTraceTags[traceTag] ?? [traceTag])
    .map((candidateTraceTag) => bundleTurns.find((turn) => turn.cue === candidateTraceTag))
    .filter((turn): turn is ActorDialogueTurn => Boolean(turn));
  const uniqueBundleTurns = dedupePedsActorPlayerRuntimeTurns(requestedBundleTurns);
  if (uniqueBundleTurns.length > 0) {
    return {
      sequenceId: `bundle_sequence_${traceTag}`,
      traceTag,
      source: uniqueBundleTurns.length > 1 ? "bundle_dialogue_sequence" : "single_runtime_turn",
      turns: uniqueBundleTurns,
    };
  }
  const fallbackTurn = pedsActorPlayerTurnForTraceTag(deps, traceTag, fallbackTurns);
  return fallbackTurn
    ? {
      sequenceId: `fallback_sequence_${traceTag}`,
      traceTag,
      source: "single_runtime_turn",
      turns: [fallbackTurn],
    }
    : undefined;
}

export function applyPedsActorPlayerSequenceListenerCues(
  deps: { listenerCueContext: ActorDialoguePlaybackDeps["listenerCueContext"] },
  activeTurn: ActorDialogueTurn,
  sequence: ActorDialogueSequence | null,
  nowMs: number,
): { actorIds: string[]; coupledSignalIds: string[] } {
  return applyPackagePedsActorPlayerSequenceListenerCues(
    deps.listenerCueContext(),
    { actorId: activeTurn.actorId, emotion: activeTurn.emotion },
    sequence
      ? { sequenceId: sequence.sequenceId, traceTag: sequence.traceTag, turns: sequence.turns.map((turn) => ({ actorId: turn.actorId })) }
      : null,
    nowMs,
  );
}

export function recordPedsActorPlayerRuntimePlaybackEvidence(
  deps: { playbackPanelContext: ActorDialoguePlaybackDeps["playbackPanelContext"] },
  input: {
    scheduled: boolean;
    turns: ActorDialogueTurn[];
    latestTurnIndex: number;
    latestTurn: ActorDialogueTurn | null;
    latestTriggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"];
    latestTraceTag: string | null;
    latestSequence: ActorDialogueSequence | null;
    latestSequenceStepIndex: number;
    latestListenerActorIds: string[];
    latestCoupledSignalIds: string[];
  },
): void {
  recordPackagePlaybackEvidence(
    deps.playbackPanelContext(),
    {
      scheduled: input.scheduled,
      turns: input.turns.map((turn) => ({ actorId: turn.actorId })),
      latestTurnIndex: input.latestTurnIndex,
      latestTurn: input.latestTurn
        ? {
            actorId: input.latestTurn.actorId,
            turnId: input.latestTurn.turnId,
            cue: input.latestTurn.cue,
            emotion: input.latestTurn.emotion,
            roleAnimationClipName: input.latestTurn.roleAnimationClipName,
            source: input.latestTurn.source,
          }
        : null,
      latestTriggerSource: input.latestTriggerSource,
      latestTraceTag: input.latestTraceTag,
      latestSequence: input.latestSequence
        ? {
            sequenceId: input.latestSequence.sequenceId,
            source: input.latestSequence.source,
            turns: input.latestSequence.turns.map((turn) => ({ actorId: turn.actorId })),
          }
        : null,
      latestSequenceStepIndex: input.latestSequenceStepIndex,
      latestListenerActorIds: input.latestListenerActorIds,
      latestCoupledSignalIds: input.latestCoupledSignalIds,
    },
  );
}

export function playPedsActorPlayerRuntimeTurn(
  deps: Pick<
    ActorDialoguePlaybackDeps,
    | "nowMs"
    | "animationSlots"
    | "animationSlotForActor"
    | "listenerCueContext"
    | "liveTurnForTrace"
    | "playbackPanelContext"
    | "playbackScheduled"
    | "setDialogueLineText"
  > & {
    triggerDialogueTurn: (
      turn: ActorDialogueTurn,
      input: {
        turns: ActorDialogueTurn[];
        latestTurnIndex: number;
        latestTriggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"];
        latestTraceTag: string | null;
        latestSequence: ActorDialogueSequence | null;
        latestSequenceStepIndex: number;
      },
    ) => void;
  },
  turn: ActorDialogueTurn,
  input: {
    turns: ActorDialogueTurn[];
    latestTurnIndex: number;
    latestTriggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"];
    latestTraceTag: string | null;
    latestSequence: ActorDialogueSequence | null;
    latestSequenceStepIndex: number;
  },
): void {
  for (const slot of deps.animationSlots()) {
    if (slot.sourceComparatorFreezeEnabled) {
      continue;
    }
    if (slot.actorId !== turn.actorId) {
      slot.activeSpeech = undefined;
      slot.mouthCue.visible = false;
      slot.gazeCue.visible = false;
      slot.eyeFocusCue.visible = false;
      slot.expressionCue.visible = false;
    }
  }
  const activeSlot = deps.animationSlotForActor(turn.actorId);
  if (activeSlot) {
    delete activeSlot.root.userData.openClinXrSequenceListeningCue;
  }
  const nowMs = deps.nowMs();
  const listenerCue = applyPedsActorPlayerSequenceListenerCues(deps, turn, input.latestSequence, nowMs);
  const liveTurn = deps.liveTurnForTrace(turn.cue);
  deps.triggerDialogueTurn(turn, {
    turns: input.turns,
    latestTurnIndex: input.latestTurnIndex,
    latestTriggerSource: input.latestTriggerSource,
    latestTraceTag: input.latestTraceTag,
    latestSequence: input.latestSequence,
    latestSequenceStepIndex: input.latestSequenceStepIndex,
  });
  recordPedsActorPlayerRuntimePlaybackEvidence(deps, {
    scheduled: deps.playbackScheduled(),
    turns: input.turns,
    latestTurnIndex: input.latestTurnIndex,
    latestTurn: turn,
    latestTriggerSource: input.latestTriggerSource,
    latestTraceTag: input.latestTraceTag,
    latestSequence: input.latestSequence,
    latestSequenceStepIndex: input.latestSequenceStepIndex,
    latestListenerActorIds: listenerCue.actorIds,
    latestCoupledSignalIds: listenerCue.coupledSignalIds,
  });
  deps.setDialogueLineText(turn.text);
}

export function playPedsActorPlayerRuntimeSequence(
  deps: Pick<ActorDialoguePlaybackDeps, "scheduleTimeout"> & {
    playTurn: (
      turn: ActorDialogueTurn,
      input: {
        turns: ActorDialogueTurn[];
        latestTurnIndex: number;
        latestTriggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"];
        latestTraceTag: string | null;
        latestSequence: ActorDialogueSequence | null;
        latestSequenceStepIndex: number;
      },
    ) => void;
  },
  sequence: ActorDialogueSequence,
  fallbackTurns: ActorDialogueTurn[],
): void {
  sequence.turns.forEach((turn, stepIndex) => {
    deps.scheduleTimeout(() => {
      deps.playTurn(turn, {
        turns: fallbackTurns,
        latestTurnIndex: fallbackTurns.findIndex((fallbackTurn) => fallbackTurn.turnId === turn.turnId && fallbackTurn.actorId === turn.actorId),
        latestTriggerSource: "trace_action",
        latestTraceTag: sequence.traceTag,
        latestSequence: sequence,
        latestSequenceStepIndex: stepIndex,
      });
    }, stepIndex * 1150);
  });
}

export function triggerPedsActorPlayerRuntimeTurnForTrace(
  deps: Pick<
    ActorDialoguePlaybackDeps,
    "isPediatricAsthmaRuntimeScenario" | "fallbackTurns" | "slotHasActor" | "noteTracePlayback" | "encounterBundle" | "liveFaceEmotionForCue" | "roleClipNameForActor"
  > & {
    playSequence: (sequence: ActorDialogueSequence, turns: ActorDialogueTurn[]) => void;
  },
  traceTag: string,
): boolean {
  if (!deps.isPediatricAsthmaRuntimeScenario()) {
    return false;
  }
  const turns = deps.fallbackTurns();
  const sequence = pedsActorPlayerRuntimeSequenceForTrace(deps, traceTag, turns);
  if (!sequence || sequence.turns.some((turn) => !deps.slotHasActor(turn.actorId))) {
    return false;
  }
  deps.noteTracePlayback(traceTag, sequence.turns.length);
  deps.playSequence(sequence, turns);
  return true;
}

export function schedulePedsActorPlayerRuntimePlaybackIfReady(
  deps: Pick<
    ActorDialoguePlaybackDeps,
    | "playbackScheduled"
    | "isPediatricAsthmaRuntimeScenario"
    | "animationSlots"
    | "fallbackTurns"
    | "slotHasActor"
    | "playbackPanelContext"
    | "notePlaybackScheduled"
    | "nowMs"
    | "playbackLastTraceAtMs"
    | "playbackSequenceActiveUntilMs"
    | "scheduleTimeout"
    | "scheduleInterval"
    | "recordBootPhase"
  > & {
    playTurn: (
      turn: ActorDialogueTurn,
      input: {
        turns: ActorDialogueTurn[];
        latestTurnIndex: number;
        latestTriggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"];
        latestTraceTag: string | null;
        latestSequence: ActorDialogueSequence | null;
        latestSequenceStepIndex: number;
      },
    ) => void;
  },
): void {
  if (deps.playbackScheduled() || !deps.isPediatricAsthmaRuntimeScenario()) {
    return;
  }
  if (deps.animationSlots().some((slot) => slot.sourceComparatorFreezeEnabled)) {
    return;
  }
  const turns = deps.fallbackTurns();
  const requiredActorIds = Array.from(new Set(turns.map((turn) => turn.actorId)));
  if (!requiredActorIds.every((actorId) => deps.slotHasActor(actorId))) {
    recordPedsActorPlayerRuntimePlaybackEvidence(deps, {
      scheduled: false,
      turns,
      latestTurnIndex: -1,
      latestTurn: null,
      latestTriggerSource: null,
      latestTraceTag: null,
      latestSequence: null,
      latestSequenceStepIndex: -1,
      latestListenerActorIds: [],
      latestCoupledSignalIds: [],
    });
    return;
  }
  deps.notePlaybackScheduled();
  let turnIndex = 0;
  const playNextTurn = (): void => {
    const nowMs = deps.nowMs();
    if (nowMs - deps.playbackLastTraceAtMs() < 3800 || nowMs < deps.playbackSequenceActiveUntilMs()) {
      return;
    }
    const turn = turns[turnIndex % turns.length];
    if (!turn) return;
    deps.playTurn(turn, {
      turns,
      latestTurnIndex: turnIndex % turns.length,
      latestTriggerSource: "scheduled_preview",
      latestTraceTag: null,
      latestSequence: null,
      latestSequenceStepIndex: -1,
    });
    turnIndex += 1;
  };
  deps.scheduleTimeout(playNextTurn, 850);
  deps.scheduleInterval(playNextTurn, 3200);
  deps.recordBootPhase("peds_actor_player_runtime_playback_scheduled");
}

export function triggerPedsAdaptiveDialogueBranch(
  deps: Pick<
    ActorDialoguePlaybackDeps,
    | "isPediatricAsthmaRuntimeScenario"
    | "encounterBundle"
    | "liveFaceEmotionForCue"
    | "roleClipNameForActor"
    | "slotHasActor"
    | "noteTracePlayback"
    | "fallbackTurns"
    | "selectedHumanoidSourceComparator"
    | "writeAdaptiveEvidence"
    | "playbackScheduled"
    | "playbackPanelContext"
  > & {
    playSequence: (sequence: ActorDialogueSequence, turns: ActorDialogueTurn[]) => void;
  },
  branch: PedsAdaptiveDialogueBranchResolution,
  triggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"],
): boolean {
  if (!deps.isPediatricAsthmaRuntimeScenario()) {
    return false;
  }
  const bundleTurns = pedsActorPlayerBundleDialogueTurns(deps);
  const turns = branch.adaptiveTraceTags
    .map((cue) => bundleTurns.find((turn) => turn.cue === cue))
    .filter((turn): turn is ActorDialogueTurn => Boolean(turn));
  if (turns.length === 0 || turns.some((turn) => !deps.slotHasActor(turn.actorId))) {
    return false;
  }
  const sequence: ActorDialogueSequence = {
    sequenceId: `adaptive_branch_${branch.policyTrigger}_${branch.requestedTraceTag}`,
    traceTag: branch.requestedTraceTag,
    source: "bundle_dialogue_sequence",
    turns,
  };
  deps.noteTracePlayback(branch.requestedTraceTag, turns.length);
  deps.playSequence(sequence, deps.fallbackTurns());
  const comparator = deps.selectedHumanoidSourceComparator();
  const pedsRealGarmentOrSchoolComparator = ["peds_anny_school_age_mpfb2_eye_patient", "peds_anny_real_garment_patient", "peds_anny_real_garment_parent", "peds_anny_real_garment_nurse", "ed_anny_real_garment_patient"].includes(comparator ?? "")
    ? (comparator as "peds_anny_school_age_mpfb2_eye_patient" | "peds_anny_real_garment_patient" | "peds_anny_real_garment_parent" | "peds_anny_real_garment_nurse" | "ed_anny_real_garment_patient")
    : undefined;
  const evidence: ActorDialogueAdaptiveEvidence = {
    source: "window.__openClinXrPedsAdaptiveDialogueEvidence",
    scenarioId: deps.selectedHumanoidSourceComparator() === "ed_anny_real_garment_patient" ? "ed_chest_pain_priority_v1" : "peds_asthma_parent_anxiety_v1",
    latestRequestedTraceTag: branch.requestedTraceTag,
    latestPolicyTrigger: branch.policyTrigger,
    latestBranchType: branch.branchType,
    adaptiveTraceTags: branch.adaptiveTraceTags,
    emotionTransition: branch.emotionTransition,
    mappingMode: branch.mappingMode,
    reviewSafeMetadata: branch.reviewSafeMetadata,
    latestSequenceSource: "bundle_dialogue_adaptive_branch",
    ...(pedsRealGarmentOrSchoolComparator
      ? {
        humanoidSourceComparator: pedsRealGarmentOrSchoolComparator,
        ...(pedsRealGarmentOrSchoolComparator === "peds_anny_real_garment_patient"
          ? { realGarmentPatientAssetPath: "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb" as const }
          : pedsRealGarmentOrSchoolComparator === "peds_anny_real_garment_parent"
            ? { realGarmentParentAssetPath: "/generated-humanoids/peds_anxious_parent.glb" as const }
            : pedsRealGarmentOrSchoolComparator === "peds_anny_real_garment_nurse"
              ? { realGarmentNurseAssetPath: "/generated-humanoids/peds_nurse_kevin.glb" as const }
              : pedsRealGarmentOrSchoolComparator === "ed_anny_real_garment_patient"
                ? { edRealGarmentPatientAssetPath: "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb" as const, promotionFlow: "ed_gown_geo_reorchestrate:promotionStatus_from_rigging_report+realGarmentRegionFromPhenotype" }
                : { schoolAgePatientAssetPath: "/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb" as const }),
      }
      : {}),
    notEvidenceFor: branch.reviewSafeMetadata.notEvidenceFor,
  };
  deps.writeAdaptiveEvidence(evidence);
  recordPedsActorPlayerRuntimePlaybackEvidence(deps, {
    scheduled: deps.playbackScheduled(),
    turns: deps.fallbackTurns(),
    latestTurnIndex: turns.length - 1,
    latestTurn: turns[turns.length - 1] ?? null,
    latestTriggerSource: triggerSource,
    latestTraceTag: branch.requestedTraceTag,
    latestSequence: sequence,
    latestSequenceStepIndex: turns.length - 1,
    latestListenerActorIds: [],
    latestCoupledSignalIds: ["bundle_dialogue_adaptive_branch", `policy_${branch.policyTrigger}`],
  });
  return true;
}
