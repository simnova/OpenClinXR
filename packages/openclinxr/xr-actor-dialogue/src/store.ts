import type {
  XrActorDialogueDependencies,
  XrActorDialogueStore,
  PedsActorPlayerRuntimeTurn,
  PedsActorPlayerRuntimeSequenceEvidence,
  PedsActorPlayerRuntimePlaybackEvidence,
  HumanoidDialogueGazeTarget,
  HumanoidDialogueEmotionContext,
  PedsActorPlayerRuntimePlaybackInput,
  PedsActorPlayerPlaybackContext,
  GeneratedHumanoidAnimationSlot,
  PedsAdaptiveDialogueBranchResolution,
  HumanoidExpressionEmotion,
  EncounterRuntimeDialogueTurn,
  LiveActorTurnConsumption,
  ActorTurnPlan,
  ActorTurnExecution,
  HumanoidExpressionWeights,
  HumanoidEmotionExpressionState,
} from "./types.js";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";

export type { XrActorDialogueStore };

export function createXrActorDialogueStore(deps: XrActorDialogueDependencies): XrActorDialogueStore {
  // Private state
  let pedsActorPlayerRuntimePlaybackScheduled = false;
  let pedsActorPlayerRuntimePlaybackLastTraceAtMs = 0;
  let pedsActorPlayerRuntimeSequenceActiveUntilMs = 0;

  return {
    // State getters
    get pedsActorPlayerRuntimePlaybackScheduled() {
      return pedsActorPlayerRuntimePlaybackScheduled;
    },
    get pedsActorPlayerRuntimePlaybackLastTraceAtMs() {
      return pedsActorPlayerRuntimePlaybackLastTraceAtMs;
    },
    get pedsActorPlayerRuntimeSequenceActiveUntilMs() {
      return pedsActorPlayerRuntimeSequenceActiveUntilMs;
    },

    initialDialogueTextForSelectedScenario: (): string => {
      const bundle = deps.encounterRuntimeAssetBundle();
      return deps.initialDialogueTextForScenario({
        scenarioId: deps.selectedScenarioId(),
        runtimeInitialDialogueText:
          bundle.sceneManifest.stationContext?.initialDialogueText ?? null,
        bundleMismatch: false,
      });
    },

    runtimeDialogueTurnForTraceTag: (tag: string): EncounterRuntimeDialogueTurn | undefined => {
      return deps.encounterRuntimeAssetBundle().sceneManifest.dialogueTurns?.find(
        (turn) => turn.traceTag === tag
      );
    },

    schedulePedsActorPlayerRuntimePlaybackIfReady: (): void => {
      if (pedsActorPlayerRuntimePlaybackScheduled || !deps.isPediatricAsthmaRuntimeScenario()) {
        return;
      }
      if (deps.generatedHumanoidAnimationSlots().some((slot) => slot.sourceComparatorFreezeEnabled)) {
        return;
      }
      const turns = deps.pedsActorPlayerRuntimeTurns();
      const requiredActorIds = Array.from(new Set(turns.map((turn) => turn.actorId)));
      if (!requiredActorIds.every((actorId) => deps.generatedHumanoidAnimationSlotsByActorId().has(actorId))) {
        deps.recordPackagePedsActorPlayerRuntimePlaybackEvidence(
          deps.pedsActorPlayerPlaybackPanelContext(),
          {
            scheduled: false,
            turns: turns.map((t) => ({ actorId: t.actorId })),
            latestTurnIndex: -1,
            latestTurn: null,
            latestTriggerSource: null,
            latestTraceTag: null,
            latestSequence: null,
            latestSequenceStepIndex: -1,
            latestListenerActorIds: [],
            latestCoupledSignalIds: [],
          }
        );
        return;
      }
      pedsActorPlayerRuntimePlaybackScheduled = true;
      let turnIndex = 0;
      const playNextTurn = (): void => {
        const nowMs = performance.now();
        if (nowMs - pedsActorPlayerRuntimePlaybackLastTraceAtMs < 3800 || nowMs < pedsActorPlayerRuntimeSequenceActiveUntilMs) {
          return;
        }
        const turn = turns[turnIndex % turns.length];
        if (!turn) return;
        deps.playPedsActorPlayerRuntimeTurn(turn, {
          turns,
          latestTurnIndex: turnIndex % turns.length,
          latestTriggerSource: "scheduled_preview",
          latestTraceTag: null,
          latestSequence: null,
          latestSequenceStepIndex: -1,
        });
        turnIndex += 1;
      };
      window.setTimeout(playNextTurn, 850);
      window.setInterval(playNextTurn, 3200);
      deps.recordBootPhase("peds_actor_player_runtime_playback_scheduled");
    },

    triggerPedsAdaptiveDialogueBranch: (
      branch: PedsAdaptiveDialogueBranchResolution,
      triggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"]
    ): boolean => {
      if (!deps.isPediatricAsthmaRuntimeScenario()) {
        return false;
      }
      const bundleTurns = deps.pedsActorPlayerBundleDialogueTurns();
      const turns = branch.adaptiveTraceTags
        .map((cue) => bundleTurns.find((turn) => turn.cue === cue))
        .filter((turn): turn is PedsActorPlayerRuntimeTurn => Boolean(turn));
      if (turns.length === 0 || turns.some((turn) => !deps.generatedHumanoidAnimationSlotsByActorId().has(turn.actorId))) {
        return false;
      }
      const sequence: PedsActorPlayerRuntimeSequenceEvidence = {
        sequenceId: `adaptive_branch_${branch.policyTrigger}_${branch.requestedTraceTag}`,
        traceTag: branch.requestedTraceTag,
        source: "bundle_dialogue_sequence",
        turns,
      };
      pedsActorPlayerRuntimePlaybackLastTraceAtMs = performance.now();
      pedsActorPlayerRuntimeSequenceActiveUntilMs = pedsActorPlayerRuntimePlaybackLastTraceAtMs + (turns.length * 1250) + 2600;
      deps.playPedsActorPlayerRuntimeSequence(sequence, deps.pedsActorPlayerRuntimeTurns());
      return true;
    },

    triggerPedsActorPlayerRuntimeTurnForTrace: (traceTag: string): boolean => {
      if (!deps.isPediatricAsthmaRuntimeScenario()) {
        return false;
      }
      const turns = deps.pedsActorPlayerRuntimeTurns();
      const sequence = deps.pedsActorPlayerRuntimeSequenceForTrace(traceTag, turns);
      if (!sequence || sequence.turns.some((turn) => !deps.generatedHumanoidAnimationSlotsByActorId().has(turn.actorId))) {
        return false;
      }
      pedsActorPlayerRuntimePlaybackLastTraceAtMs = performance.now();
      pedsActorPlayerRuntimeSequenceActiveUntilMs = pedsActorPlayerRuntimePlaybackLastTraceAtMs + (sequence.turns.length * 1250) + 2600;
      deps.playPedsActorPlayerRuntimeSequence(sequence, turns);
      return true;
    },

    dedupePedsActorPlayerRuntimeTurns: (turns: PedsActorPlayerRuntimeTurn[]): PedsActorPlayerRuntimeTurn[] => {
      const seen = new Set<string>();
      return turns.filter((turn) => {
        const key = `${turn.actorId}:${turn.turnId}:${turn.cue}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },

    pedsActorPlayerBundleDialogueTurns: (): PedsActorPlayerRuntimeTurn[] => {
      return (deps.encounterRuntimeAssetBundle().sceneManifest.dialogueTurns ?? []).map((runtimeTurn) => ({
        actorId: runtimeTurn.actorId,
        turnId: `bundle_${runtimeTurn.traceTag}`,
        cue: runtimeTurn.traceTag,
        text: runtimeTurn.text,
        emotion: deps.resolveLiveActorTurnForTrace(runtimeTurn.traceTag)?.faceEmotion ?? "neutral",
        gazeTargetKind: runtimeTurn.gazeTargetKind,
        gazeTargetActorId: runtimeTurn.gazeTargetActorId,
        roleAnimationClipName: "",
        source: "bundle_dialogue_turn",
      }));
    },

    pedsActorPlayerTurnFromRuntimeBundleTrace: (traceTag: string): PedsActorPlayerRuntimeTurn | undefined => {
      return deps.pedsActorPlayerBundleDialogueTurns().find((turn) => turn.cue === traceTag);
    },

    normalizePedsActorPlayerEmotion: (emotion: string): HumanoidExpressionEmotion => {
      const normalized = emotion.toLowerCase();
      if (normalized.includes("pain") || normalized.includes("frightened")) return "pain";
      if (normalized.includes("anxious")) return "anxious";
      if (normalized.includes("concern")) return "concerned";
      if (normalized.includes("reassur")) return "reassured";
      return "neutral";
    },

    playPedsActorPlayerRuntimeTurn: (
      turn: PedsActorPlayerRuntimeTurn,
      input: {
        turns: PedsActorPlayerRuntimeTurn[];
        latestTurnIndex: number;
        latestTriggerSource: "scheduled_preview" | "trace_action" | null;
        latestTraceTag: string | null;
        latestSequence: PedsActorPlayerRuntimeSequenceEvidence | null;
        latestSequenceStepIndex: number;
      }
    ): void => {
      for (const slot of deps.generatedHumanoidAnimationSlots()) {
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
      const activeSlot = deps.generatedHumanoidAnimationSlotsByActorId().get(turn.actorId);
      if (activeSlot) {
        delete activeSlot.root.userData.openClinXrSequenceListeningCue;
      }
      const nowMs = performance.now();
      const listenerCue = deps.applyPedsActorPlayerSequenceListenerCues(turn, input.latestSequence, nowMs);
      const liveTurn = deps.resolveLiveActorTurnForTrace(turn.cue);
      deps.triggerHumanoidDialogue(turn.actorId, liveTurn?.caption ?? turn.text, {
        kind: turn.gazeTargetKind,
        actorId: turn.gazeTargetActorId,
      }, liveTurn?.faceEmotion ?? turn.emotion, undefined, liveTurn ? "plan.dialogueEmotionTo" : undefined);
      deps.recordPedsActorPlayerRuntimePlaybackEvidence({
        scheduled: pedsActorPlayerRuntimePlaybackScheduled,
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
    },

    applyPedsActorPlayerSequenceListenerCues: (
      activeTurn: PedsActorPlayerRuntimeTurn,
      sequence: PedsActorPlayerRuntimeSequenceEvidence | null,
      nowMs: number
    ): { actorIds: string[]; coupledSignalIds: string[] } => {
      return deps.applyPackagePedsActorPlayerSequenceListenerCues(
        deps.pedsActorListenerCuePanelContext(),
        { actorId: activeTurn.actorId, emotion: activeTurn.emotion },
        sequence
          ? { sequenceId: sequence.sequenceId, traceTag: sequence.traceTag, turns: sequence.turns.map((turn) => ({ actorId: turn.actorId })) }
          : null,
        nowMs
      );
    },

    playPedsActorPlayerRuntimeSequence: (sequence: PedsActorPlayerRuntimeSequenceEvidence, fallbackTurns: PedsActorPlayerRuntimeTurn[]): void => {
      sequence.turns.forEach((turn, stepIndex) => {
        window.setTimeout(() => {
          deps.playPedsActorPlayerRuntimeTurn(turn, {
            turns: fallbackTurns,
            latestTurnIndex: fallbackTurns.findIndex((fallbackTurn) => fallbackTurn.turnId === turn.turnId && fallbackTurn.actorId === turn.actorId),
            latestTriggerSource: "trace_action",
            latestTraceTag: sequence.traceTag,
            latestSequence: sequence,
            latestSequenceStepIndex: stepIndex,
          });
        }, stepIndex * 1150);
      });
    },

    pedsActorPlayerRuntimeTurns: (): PedsActorPlayerRuntimeTurn[] => {
      return deps.pedsActorPlayerRuntimeTurns();
    },

    pedsActorPlayerPlaybackPanelContext: (): PedsActorPlayerPlaybackContext => {
      return {
        dialogueTurnCount: () => deps.encounterRuntimeAssetBundle().sceneManifest.dialogueTurns?.length ?? 0,
        selectedHumanoidSourceComparator: deps.selectedHumanoidSourceComparator,
        activeGeneratedActorSlotCount: () => deps.generatedHumanoidAnimationSlotsByActorId().size,
        activeHumanoidSpeechEvidenceActorId: () => (window as any).__openClinXrHumanoidSpeechEvidence?.activeActorId ?? null,
        playbackEvidenceWritten: (evidence) => {
          (window as any).__openClinXrPedsActorPlayerRuntimePlaybackEvidence = evidence;
        },
      };
    },

    recordPedsActorPlayerRuntimePlaybackEvidence: (input: PedsActorPlayerRuntimePlaybackInput): void => {
      deps.recordPackagePedsActorPlayerRuntimePlaybackEvidence(
        deps.pedsActorPlayerPlaybackPanelContext(),
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
        }
      );
    },

    triggerHumanoidDialogueForTrace: (tag: string, text: string): void => {
      const actorId = deps.localDialogueActorIdForTraceTag(tag);
      const gazeTarget = deps.localDialogueGazeTargetForTraceTag(tag);
      const runtimeTurn = deps.runtimeDialogueTurnForTraceTag(tag);
      const liveTurn = deps.resolveLiveActorTurnForTrace(tag);
      const emotion = liveTurn?.faceEmotion;
      const caption = liveTurn?.caption ?? text;
      const actorRuntimeRealismRequirement = runtimeTurn?.caseDefinitionRuntimeSignals?.actorRuntimeRealismRequirement as {
        actorId: string;
        role: string;
        baselineMood: string[];
        locomotionRequired: boolean;
        expressionRequired: boolean;
        gazeRequired: boolean;
        lipSyncRequired: boolean;
        interactionRequired: boolean;
        requiredCueIds: string[];
      } | undefined;
      if (!actorId) {
        (window as any).__openClinXrHumanoidSpeechEvidence ??= deps.buildHumanoidSpeechEvidence(null, null, null, [], [], null);
        return;
      }
      const emotionSource = liveTurn ? "plan.dialogueEmotionTo" as const : undefined;
      if (deps.runtimeActorEmbodimentImpl(deps.encounterRuntimeAssetBundle(), actorId) === "virtual_device") {
        const emotionContext = deps.scenarioDialogueEmotionContext(actorId, caption, emotion, emotionSource);
        (window as any).__openClinXrHumanoidSpeechEvidence = deps.buildHumanoidSpeechEvidence(
          actorId,
          `virtual_device:${actorId}`,
          caption,
          deps.phonemesForText(caption),
          [],
          gazeTarget,
          emotionContext,
          actorRuntimeRealismRequirement as {
            actorId: string;
            role: string;
            baselineMood: string[];
            locomotionRequired: boolean;
            expressionRequired: boolean;
            gazeRequired: boolean;
            lipSyncRequired: boolean;
            interactionRequired: boolean;
            requiredCueIds: string[];
          } | undefined,
        );
        deps.recordBootPhase("virtual_device_dialogue_routed");
        deps.activeVirtualDeviceSpeechByActorId().set(actorId, {
          actorId,
          assetId: `virtual_device:${actorId}`,
          gazeTargetKind: gazeTarget.kind,
          gazeTargetActorId: gazeTarget.actorId,
          text: caption,
          emotion: emotionContext.emotion,
          emotionContext,
          actorRuntimeRealismRequirement: actorRuntimeRealismRequirement as {
            actorId: string;
            role: string;
            baselineMood: string[];
            locomotionRequired: boolean;
            expressionRequired: boolean;
            gazeRequired: boolean;
            lipSyncRequired: boolean;
            interactionRequired: boolean;
            requiredCueIds: string[];
          } | undefined,
          phonemeSequence: deps.phonemesForText(caption),
          visemeSequence: [],
          startedAtMs: performance.now(),
          durationMs: deps.humanoidDialogueDurationMs(deps.phonemesForText(caption).length, deps.isHumanoidMouthGazePoseReviewCaptureMode()),
        });
        return;
      }
      if (liveTurn) { deps.playLiveFrozenActorTurn(liveTurn.plan, liveTurn.execution, gazeTarget, actorRuntimeRealismRequirement); return; }
      deps.triggerHumanoidDialogue(actorId, caption, gazeTarget, emotion, actorRuntimeRealismRequirement, emotionSource);
    },

    triggerHumanoidDialogue: (
      actorId: string,
      text: string,
      gazeTarget: HumanoidDialogueGazeTarget,
      explicitEmotion?: HumanoidExpressionEmotion,
      actorRuntimeRealismRequirement?: unknown,
      emotionSource?: HumanoidDialogueEmotionContext["source"]
    ): void => {
      const slot = deps.generatedHumanoidAnimationSlotsByActorId().get(actorId);
      const phonemeSequence = deps.phonemesForText(text);
      const visemeSequence = deps.visemesForText(text);
      const emotionContext = deps.scenarioDialogueEmotionContext(actorId, text, explicitEmotion, emotionSource);
      const emotion = emotionContext.emotion;
      if (!slot) {
        (window as any).__openClinXrHumanoidSpeechEvidence = deps.buildHumanoidSpeechEvidence(
          actorId,
          null,
          text,
          phonemeSequence,
          visemeSequence,
          gazeTarget,
          emotionContext,
          actorRuntimeRealismRequirement,
        );
        return;
      }
      slot.activeSpeech = {
        actorId,
        assetId: slot.assetId,
        gazeTargetKind: gazeTarget.kind,
        gazeTargetActorId: gazeTarget.actorId,
        text,
        emotion,
        emotionContext,
        actorRuntimeRealismRequirement: actorRuntimeRealismRequirement as HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"] | undefined,
        phonemeSequence,
        visemeSequence,
        startedAtMs: performance.now(),
        durationMs: deps.humanoidDialogueDurationMs(phonemeSequence.length, deps.isHumanoidMouthGazePoseReviewCaptureMode()),
      };
      deps.startHumanoidEmotionTransition(slot, emotion, performance.now());
      deps.attachBakedCuesToSpeech(slot, text, deps.selectedScenarioId());
      slot.root.userData.openClinXrDialoguePhonemeMapping = {
        actorId,
        phonemeSequence,
        visemeSequence,
        gazeTargetKind: gazeTarget.kind,
        gazeTargetActorId: gazeTarget.actorId,
        mappingMode: "deterministic_text_phoneme_viseme_runtime_cue",
      };
      (window as any).__openClinXrHumanoidSpeechEvidence = deps.buildHumanoidSpeechEvidence(
        actorId,
        slot.assetId,
        text,
        phonemeSequence,
        visemeSequence,
        gazeTarget,
        emotionContext,
        actorRuntimeRealismRequirement as {
          actorId: string;
          role: string;
          baselineMood: string[];
          locomotionRequired: boolean;
          expressionRequired: boolean;
          gazeRequired: boolean;
          lipSyncRequired: boolean;
          interactionRequired: boolean;
          requiredCueIds: string[];
        } | undefined,
      );
      deps.recordBootPhase("humanoid_dialogue_phoneme_mapping_started");
    },

    humanoidDialogueDurationMs: (phonemeCount: number): number => {
      return deps.humanoidDialogueDurationMs(phonemeCount, deps.isHumanoidMouthGazePoseReviewCaptureMode());
    },

    scenarioDialogueEmotionContext: (
      actorId: string,
      _text: string,
      explicitEmotion?: HumanoidExpressionEmotion,
      emotionSource?: HumanoidDialogueEmotionContext["source"]
    ): HumanoidDialogueEmotionContext => {
      const scenario = deps.scenarioBank().find((candidate) => candidate.scenarioId === deps.encounterRuntimeAssetBundle().scenarioId)
        ?? deps.scenarioBank().find((candidate) => candidate.scenarioId === deps.selectedScenarioId())
        ?? null;
      const actor = scenario?.actors.find((candidate) => candidate.actorId === actorId);
      const baselineMood = actor?.communicationProfile?.baselineMood ?? [];
      if (explicitEmotion) {
        return {
          emotion: explicitEmotion,
          source: emotionSource ?? "runtime_affect_timeline",
          baselineMood,
          cueIds: [
            "plan_dialogue_emotion_to_expression_weights",
            "scenario_dialogue_emotion_transition_cue",
            "case_definition_driven_expression_selection",
          ],
        };
      }
      return {
        emotion: "neutral",
        source: "plan_missing",
        baselineMood,
        cueIds: [
          "live_face_requires_actor_turn_plan_dialogue_emotion_to",
          "scenario_dialogue_emotion_transition_cue",
        ],
      };
    },

    localDialogueActorIdForTraceTag: (tag: string): string | undefined => {
      const runtimeTurn = deps.runtimeDialogueTurnForTraceTag(tag);
      if (runtimeTurn) return runtimeTurn.actorId;
      const actorIds: Record<string, string | undefined> = {
        history_opqrst: deps.runtimePatientActorId(),
        risk_factor_question: deps.runtimePatientActorId(),
        associated_symptom_question: deps.runtimePatientActorId(),
        vitals_review: deps.runtimeClinicalTeamActorId(),
        ecg_request: deps.runtimeClinicalTeamActorId(),
        urgent_escalation: deps.runtimeFamilyActorId(),
        team_communication: deps.runtimeClinicalTeamActorId(),
        family_communication: deps.runtimeFamilyActorId(),
        empathy_statement: deps.runtimePatientActorId(),
      };
      return actorIds[tag] ?? deps.actorIdForTraceTag(tag, deps.selectedScenarioId());
    },

    localDialogueGazeTargetForTraceTag: (tag: string): HumanoidDialogueGazeTarget => {
      const runtimeTurn = deps.runtimeDialogueTurnForTraceTag(tag);
      if (runtimeTurn) {
        return {
          kind: runtimeTurn.gazeTargetKind,
          actorId: runtimeTurn.gazeTargetActorId,
        };
      }
      const actorTargets: Record<string, string | undefined> = {
        team_communication: deps.runtimeClinicalTeamActorId(),
        family_communication: deps.runtimeFamilyActorId(),
      };
      const actorTarget = actorTargets[tag];
      return actorTarget
        ? { kind: "actor", actorId: actorTarget }
        : { kind: "learner_camera", actorId: null };
    },
  };
}