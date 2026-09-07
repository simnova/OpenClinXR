import {
  attachBakedCuesToSpeech,
  phonemesForText,
  resolveLiveActorTurnForTrace,
  visemesForText,
} from "@openclinxr/xr-dialogue";
import {
  buildHumanoidSpeechEvidence as buildPackageHumanoidSpeechEvidence,
  startHumanoidEmotionTransition as startPackageHumanoidEmotionTransition,
  type HumanoidDialogueEmotionContext,
  type HumanoidDialogueGazeTarget,
  type HumanoidExpressionEmotion,
} from "@openclinxr/xr-humanoid-animation";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import {
  localDialogueActorIdForTraceTag,
  localDialogueGazeTargetForTraceTag,
  runtimeDialogueTurnForTraceTag,
  scenarioDialogueEmotionContext,
} from "./dialogue-context.js";
import { humanoidDialogueDurationMs } from "./dialogue-duration.js";
import type { ActorDialogueSpeechDeps } from "./types.js";

export function triggerHumanoidDialogueForTrace(
  deps: ActorDialogueSpeechDeps & {
    triggerDialogue: (
      actorId: string,
      text: string,
      gazeTarget: HumanoidDialogueGazeTarget,
      explicitEmotion: HumanoidExpressionEmotion | undefined,
      requirement: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
      emotionSource: HumanoidDialogueEmotionContext["source"] | undefined,
    ) => void;
  },
  tag: string,
  text: string,
): void {
  const actorId = localDialogueActorIdForTraceTag(deps, tag);
  const gazeTarget = localDialogueGazeTargetForTraceTag(deps, tag);
  const runtimeTurn = runtimeDialogueTurnForTraceTag(deps, tag);
  const liveTurn = resolveLiveActorTurnForTrace(tag);
  const emotion = liveTurn?.faceEmotion;
  const caption = liveTurn?.caption ?? text;
  const actorRuntimeRealismRequirement = runtimeTurn?.caseDefinitionRuntimeSignals?.actorRuntimeRealismRequirement;
  if (!actorId) {
    deps.ensureMissingActorSpeechEvidence();
    return;
  }
  const emotionSource = liveTurn ? "plan.dialogueEmotionTo" as const : undefined;
  if (deps.runtimeEmbodimentForActor(actorId) === "virtual_device") {
    const emotionContext = scenarioDialogueEmotionContext(deps, actorId, caption, emotion, emotionSource);
    deps.writeSpeechEvidence(
      buildPackageHumanoidSpeechEvidence(
        actorId,
        `virtual_device:${actorId}`,
        caption,
        phonemesForText(caption),
        [],
        gazeTarget,
        emotionContext,
        actorRuntimeRealismRequirement,
      ),
    );
    deps.recordBootPhase("virtual_device_dialogue_routed");
    deps.virtualDeviceSpeechByActorId().set(actorId, {
      actorId,
      assetId: `virtual_device:${actorId}`,
      gazeTargetKind: gazeTarget.kind,
      gazeTargetActorId: gazeTarget.actorId,
      text: caption,
      emotion: emotionContext.emotion,
      emotionContext,
      actorRuntimeRealismRequirement,
      phonemeSequence: phonemesForText(caption),
      visemeSequence: [],
      startedAtMs: deps.nowMs(),
      durationMs: humanoidDialogueDurationMs(deps, phonemesForText(caption).length),
    });
    return;
  }
  if (liveTurn) {
    deps.playFrozenTurn(liveTurn.plan, liveTurn.execution, gazeTarget, actorRuntimeRealismRequirement);
    return;
  }
  deps.triggerDialogue(actorId, caption, gazeTarget, emotion, actorRuntimeRealismRequirement, emotionSource);
}

export function triggerHumanoidDialogue(
  deps: ActorDialogueSpeechDeps & {
    selectedScenarioIdValue: () => string;
  },
  actorId: string,
  text: string,
  gazeTarget: HumanoidDialogueGazeTarget,
  explicitEmotion?: HumanoidExpressionEmotion,
  actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
  emotionSource?: HumanoidDialogueEmotionContext["source"],
): void {
  const slot = deps.animationSlotForActor(actorId);
  const phonemeSequence = phonemesForText(text);
  const visemeSequence = visemesForText(text);
  const emotionContext = scenarioDialogueEmotionContext(deps, actorId, text, explicitEmotion, emotionSource);
  const emotion = emotionContext.emotion;
  if (!slot) {
    deps.writeSpeechEvidence(
      buildPackageHumanoidSpeechEvidence(
        actorId,
        null,
        text,
        phonemeSequence,
        visemeSequence,
        gazeTarget,
        emotionContext,
        actorRuntimeRealismRequirement,
      ),
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
    actorRuntimeRealismRequirement,
    phonemeSequence,
    visemeSequence,
    startedAtMs: deps.nowMs(),
    durationMs: humanoidDialogueDurationMs(deps, phonemeSequence.length),
  };
  startPackageHumanoidEmotionTransition(slot, emotion, deps.nowMs());
  attachBakedCuesToSpeech(slot, text, deps.selectedScenarioIdValue());
  slot.root.userData.openClinXrDialoguePhonemeMapping = {
    actorId,
    phonemeSequence,
    visemeSequence,
    gazeTargetKind: gazeTarget.kind,
    gazeTargetActorId: gazeTarget.actorId,
    mappingMode: "deterministic_text_phoneme_viseme_runtime_cue",
  };
  deps.writeSpeechEvidence(
    buildPackageHumanoidSpeechEvidence(
      actorId,
      slot.assetId,
      text,
      phonemeSequence,
      visemeSequence,
      gazeTarget,
      emotionContext,
      actorRuntimeRealismRequirement,
    ),
  );
  deps.recordBootPhase("humanoid_dialogue_phoneme_mapping_started");
}
