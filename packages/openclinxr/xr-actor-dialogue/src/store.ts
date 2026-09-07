import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import type {
  ActorTurnPlayback,
  LiveActorTurnConsumption,
} from "@openclinxr/xr-dialogue";
import type {
  HumanoidDialogueEmotionContext,
  HumanoidDialogueGazeTarget,
  HumanoidExpressionEmotion,
  HumanoidSpeechPlayback,
} from "@openclinxr/xr-humanoid-animation";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import type { PedsActorListenerCueContext } from "@openclinxr/xr-trace-readiness";
import type { PedsAdaptiveDialogueBranchResolution } from "./policy.js";
import {
  localDialogueActorIdForTraceTag,
  localDialogueGazeTargetForTraceTag,
  runtimeDialogueTurnForTraceTag,
  scenarioDialogueEmotionContext,
} from "./dialogue-context.js";
import { humanoidDialogueDurationMs } from "./dialogue-duration.js";
import { playLiveFrozenActorTurn } from "./frozen-turn.js";
import { initialDialogueTextForSelectedScenario } from "./initial-dialogue.js";
import {
  applyPedsActorPlayerSequenceListenerCues,
  dedupePedsActorPlayerRuntimeTurns,
  pedsActorPlayerBundleDialogueTurns,
  pedsActorPlayerRuntimeSequenceForTrace,
  pedsActorPlayerTurnForTraceTag,
  pedsActorPlayerTurnFromRuntimeBundleTrace,
  playPedsActorPlayerRuntimeSequence,
  playPedsActorPlayerRuntimeTurn,
  recordPedsActorPlayerRuntimePlaybackEvidence,
  schedulePedsActorPlayerRuntimePlaybackIfReady,
  triggerPedsAdaptiveDialogueBranch,
  triggerPedsActorPlayerRuntimeTurnForTrace,
} from "./playback.js";
import {
  triggerHumanoidDialogue,
  triggerHumanoidDialogueForTrace,
} from "./speech.js";
import { normalizePedsActorPlayerEmotion } from "./playback.js";
import type {
  ActorDialogueAdaptiveEvidence,
  ActorDialogueDeps,
  ActorDialogueHumanoidSlot,
  ActorDialoguePlaybackEvidence,
  ActorDialogueSequence,
  ActorDialogueSpeechDeps,
  ActorDialogueTurn,
} from "./types.js";

export type ActorDialogueStoreOptions = {
  encounterBundle: () => LearnerRuntimeAssetBundle;
  initialDialogueText: () => string;
  isPediatricAsthmaRuntimeScenario: () => boolean;
  isSelectedScenarioRuntimeBundleMismatch: () => boolean;
  selectedScenarioId: () => string;
  selectedHumanoidSourceComparator: () => string | null;
  runtimePatientActorId: () => string;
  runtimeClinicalTeamActorId: () => string;
  runtimeFamilyActorId: () => string;
  actorIdForTraceTag: (tag: string, scenarioId: string) => string | undefined;
  recordBootPhase: (phase: string, error?: unknown) => void;
  nowMs: () => number;
  scheduleTimeout: (callback: () => void, delayMs: number) => void;
  scheduleInterval: (callback: () => void, delayMs: number) => void;
  setDialogueLineText: (text: string) => void;
  speechEvidence: () => HumanoidSpeechEvidence | undefined;
  writeSpeechEvidence: (evidence: HumanoidSpeechEvidence) => void;
  ensureMissingActorSpeechEvidence: () => void;
  writeAdaptiveEvidence: (evidence: ActorDialogueAdaptiveEvidence) => void;
  fallbackTurns: () => ActorDialogueTurn[];
  liveTurnForTrace: (tag: string) => LiveActorTurnConsumption | undefined;
  liveFaceEmotionForCue: (cue: string) => HumanoidExpressionEmotion | undefined;
  animationSlots: () => ActorDialogueHumanoidSlot[];
  animationSlotForActor: (actorId: string) => ActorDialogueHumanoidSlot | undefined;
  slotHasActor: (actorId: string) => boolean;
  roleClipNameForActor: (actorId: string) => string;
  listenerCueContext: () => PedsActorListenerCueContext;
  playbackPanelContext: () => {
    dialogueTurnCount: () => number;
    selectedHumanoidSourceComparator: () => string | null;
    activeGeneratedActorSlotCount: () => number;
    activeHumanoidSpeechEvidenceActorId: () => string | null;
    playbackEvidenceWritten: (evidence: Record<string, unknown>) => void;
  };
  virtualDeviceSpeechByActorId: () => Map<string, HumanoidSpeechPlayback>;
  runtimeEmbodimentForActor: (actorId: string) => LearnerRuntimeAssetBundle["actors"][number]["embodiment"] | undefined;
  reviewCaptureMode: () => boolean;
  responseClipNames: (actorId: string) => string[];
  playClip: (actorId: string, clipName: string) => boolean;
  playFrozenTurn: (
    plan: LiveActorTurnConsumption["plan"],
    execution: LiveActorTurnConsumption["execution"],
    gazeTarget: HumanoidDialogueGazeTarget,
    requirement: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
  ) => ActorTurnPlayback;
  startFaceTransition: (actorId: string, emotion: HumanoidExpressionEmotion, nowMs: number) => void;
};

export type ActorDialogueStore = {
  initialDialogueTextForSelectedScenario: () => string;
  runtimeDialogueTurnForTraceTag: (tag: string) => LearnerRuntimeAssetBundle["sceneManifest"]["dialogueTurns"] extends (infer T)[] | undefined ? T | undefined : never;
  schedulePedsActorPlayerRuntimePlaybackIfReady: () => void;
  triggerPedsAdaptiveDialogueBranch: (
    branch: PedsAdaptiveDialogueBranchResolution,
    triggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"],
  ) => boolean;
  triggerPedsActorPlayerRuntimeTurnForTrace: (traceTag: string) => boolean;
  dedupePedsActorPlayerRuntimeTurns: (turns: ActorDialogueTurn[]) => ActorDialogueTurn[];
  pedsActorPlayerBundleDialogueTurns: () => ActorDialogueTurn[];
  normalizePedsActorPlayerEmotion: (emotion: string) => HumanoidExpressionEmotion;
  playPedsActorPlayerRuntimeTurn: (
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
  applyPedsActorPlayerSequenceListenerCues: (
    activeTurn: ActorDialogueTurn,
    sequence: ActorDialogueSequence | null,
    nowMs: number,
  ) => { actorIds: string[]; coupledSignalIds: string[] };
  playPedsActorPlayerRuntimeSequence: (sequence: ActorDialogueSequence, fallbackTurns: ActorDialogueTurn[]) => void;
  recordPedsActorPlayerRuntimePlaybackEvidence: (input: {
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
  }) => void;
  triggerHumanoidDialogueForTrace: (tag: string, text: string) => void;
  triggerHumanoidDialogue: (
    actorId: string,
    text: string,
    gazeTarget: HumanoidDialogueGazeTarget,
    explicitEmotion?: HumanoidExpressionEmotion,
    actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
    emotionSource?: HumanoidDialogueEmotionContext["source"],
  ) => void;
  humanoidDialogueDurationMs: (phonemeCount: number) => number;
  scenarioDialogueEmotionContext: (
    actorId: string,
    text: string,
    explicitEmotion?: HumanoidExpressionEmotion,
    emotionSource?: HumanoidDialogueEmotionContext["source"],
  ) => HumanoidDialogueEmotionContext;
  localDialogueActorIdForTraceTag: (tag: string) => string | undefined;
  localDialogueGazeTargetForTraceTag: (tag: string) => HumanoidDialogueGazeTarget;
  playbackScheduled: () => boolean;
  playbackLastTraceAtMs: () => number;
  playbackSequenceActiveUntilMs: () => number;
};

export function createActorDialogueStore(options: ActorDialogueStoreOptions): ActorDialogueStore {
  let playbackScheduled = false;
  let playbackLastTraceAtMs = 0;
  let playbackSequenceActiveUntilMs = 0;

  const speechDeps: ActorDialogueSpeechDeps = {
    encounterBundle: options.encounterBundle,
    selectedScenarioId: options.selectedScenarioId,
    recordBootPhase: options.recordBootPhase,
    nowMs: options.nowMs,
    runtimePatientActorId: options.runtimePatientActorId,
    runtimeClinicalTeamActorId: options.runtimeClinicalTeamActorId,
    runtimeFamilyActorId: options.runtimeFamilyActorId,
    actorIdForTraceTag: options.actorIdForTraceTag,
    writeSpeechEvidence: options.writeSpeechEvidence,
    ensureMissingActorSpeechEvidence: options.ensureMissingActorSpeechEvidence,
    runtimeTurnForTraceTag: (tag) => runtimeDialogueTurnForTraceTag(speechDepsShim(), tag),
    liveTurnForTrace: options.liveTurnForTrace,
    animationSlotForActor: options.animationSlotForActor,
    playFrozenTurn: options.playFrozenTurn,
    virtualDeviceSpeechByActorId: options.virtualDeviceSpeechByActorId,
    runtimeEmbodimentForActor: options.runtimeEmbodimentForActor,
    reviewCaptureMode: options.reviewCaptureMode,
  };
  const speechDepsShim = (): ActorDialogueSpeechDeps => speechDeps;

  const fireDialogue = (
    actorId: string,
    text: string,
    gazeTarget: HumanoidDialogueGazeTarget,
    explicitEmotion?: HumanoidExpressionEmotion,
    requirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
    emotionSource?: HumanoidDialogueEmotionContext["source"],
  ): void => {
    triggerHumanoidDialogue({ ...speechDeps, selectedScenarioIdValue: options.selectedScenarioId }, actorId, text, gazeTarget, explicitEmotion, requirement, emotionSource);
  };

  const fireDialogueForTrace = (tag: string, text: string): void => {
    triggerHumanoidDialogueForTrace({ ...speechDeps, triggerDialogue: fireDialogue }, tag, text);
  };

  const playbackDeps = (): {
    encounterBundle: ActorDialogueStoreOptions["encounterBundle"];
    liveFaceEmotionForCue: ActorDialogueStoreOptions["liveFaceEmotionForCue"];
    roleClipNameForActor: ActorDialogueStoreOptions["roleClipNameForActor"];
    fallbackTurns: ActorDialogueStoreOptions["fallbackTurns"];
    liveTurnForTrace: ActorDialogueStoreOptions["liveTurnForTrace"];
    animationSlots: ActorDialogueStoreOptions["animationSlots"];
    animationSlotForActor: ActorDialogueStoreOptions["animationSlotForActor"];
    slotHasActor: ActorDialogueStoreOptions["slotHasActor"];
    listenerCueContext: ActorDialogueStoreOptions["listenerCueContext"];
    playbackPanelContext: ActorDialogueStoreOptions["playbackPanelContext"];
    isPediatricAsthmaRuntimeScenario: ActorDialogueStoreOptions["isPediatricAsthmaRuntimeScenario"];
    selectedHumanoidSourceComparator: ActorDialogueStoreOptions["selectedHumanoidSourceComparator"];
    recordBootPhase: ActorDialogueStoreOptions["recordBootPhase"];
    nowMs: ActorDialogueStoreOptions["nowMs"];
    scheduleTimeout: ActorDialogueStoreOptions["scheduleTimeout"];
    scheduleInterval: ActorDialogueStoreOptions["scheduleInterval"];
    setDialogueLineText: ActorDialogueStoreOptions["setDialogueLineText"];
    writeAdaptiveEvidence: ActorDialogueStoreOptions["writeAdaptiveEvidence"];
    playbackScheduled: () => boolean;
    playbackLastTraceAtMs: () => number;
    playbackSequenceActiveUntilMs: () => number;
    notePlaybackScheduled: () => void;
    noteTracePlayback: (traceTag: string, turnCount: number) => void;
  } => ({
    encounterBundle: options.encounterBundle,
    liveFaceEmotionForCue: options.liveFaceEmotionForCue,
    roleClipNameForActor: options.roleClipNameForActor,
    fallbackTurns: options.fallbackTurns,
    liveTurnForTrace: options.liveTurnForTrace,
    animationSlots: options.animationSlots,
    animationSlotForActor: options.animationSlotForActor,
    slotHasActor: options.slotHasActor,
    listenerCueContext: options.listenerCueContext,
    playbackPanelContext: options.playbackPanelContext,
    isPediatricAsthmaRuntimeScenario: options.isPediatricAsthmaRuntimeScenario,
    selectedHumanoidSourceComparator: options.selectedHumanoidSourceComparator,
    recordBootPhase: options.recordBootPhase,
    nowMs: options.nowMs,
    scheduleTimeout: options.scheduleTimeout,
    scheduleInterval: options.scheduleInterval,
    setDialogueLineText: options.setDialogueLineText,
    writeAdaptiveEvidence: options.writeAdaptiveEvidence,
    playbackScheduled: () => playbackScheduled,
    playbackLastTraceAtMs: () => playbackLastTraceAtMs,
    playbackSequenceActiveUntilMs: () => playbackSequenceActiveUntilMs,
    notePlaybackScheduled: () => {
      playbackScheduled = true;
    },
    noteTracePlayback: (_traceTag, turnCount) => {
      playbackLastTraceAtMs = options.nowMs();
      playbackSequenceActiveUntilMs = playbackLastTraceAtMs + (turnCount * 1250) + 2600;
    },
  });

  const playTurn = (
    turn: ActorDialogueTurn,
    input: {
      turns: ActorDialogueTurn[];
      latestTurnIndex: number;
      latestTriggerSource: ActorDialoguePlaybackEvidence["latestTriggerSource"];
      latestTraceTag: string | null;
      latestSequence: ActorDialogueSequence | null;
      latestSequenceStepIndex: number;
    },
  ): void => {
    playPedsActorPlayerRuntimeTurn(
      {
        ...playbackDeps(),
        triggerDialogueTurn: (dialogueTurn, dialogueInput) => {
          const liveTurn = options.liveTurnForTrace(dialogueTurn.cue);
          fireDialogue(
            dialogueTurn.actorId,
            liveTurn?.caption ?? dialogueTurn.text,
            {
              kind: dialogueTurn.gazeTargetKind,
              actorId: dialogueTurn.gazeTargetActorId,
            },
            liveTurn?.faceEmotion ?? dialogueTurn.emotion,
            undefined,
            liveTurn ? "plan.dialogueEmotionTo" : undefined,
          );
          void dialogueInput;
        },
      },
      turn,
      input,
    );
  };

  const playSequence = (sequence: ActorDialogueSequence, turns: ActorDialogueTurn[]): void => {
    playPedsActorPlayerRuntimeSequence({ scheduleTimeout: options.scheduleTimeout, playTurn }, sequence, turns);
  };

  void playLiveFrozenActorTurn;

  return {
    initialDialogueTextForSelectedScenario: () => initialDialogueTextForSelectedScenario(options),
    runtimeDialogueTurnForTraceTag: (tag) => runtimeDialogueTurnForTraceTag(speechDeps, tag) as ReturnType<ActorDialogueStore["runtimeDialogueTurnForTraceTag"]>,
    schedulePedsActorPlayerRuntimePlaybackIfReady: () => schedulePedsActorPlayerRuntimePlaybackIfReady({ ...playbackDeps(), playTurn }),
    triggerPedsAdaptiveDialogueBranch: (branch, triggerSource) =>
      triggerPedsAdaptiveDialogueBranch({ ...playbackDeps(), playSequence }, branch, triggerSource),
    triggerPedsActorPlayerRuntimeTurnForTrace: (traceTag) =>
      triggerPedsActorPlayerRuntimeTurnForTrace({ ...playbackDeps(), playSequence }, traceTag),
    dedupePedsActorPlayerRuntimeTurns: (turns) => dedupePedsActorPlayerRuntimeTurns(turns),
    pedsActorPlayerBundleDialogueTurns: () => pedsActorPlayerBundleDialogueTurns(playbackDeps()),
    normalizePedsActorPlayerEmotion: (emotion) => normalizePedsActorPlayerEmotion(emotion),
    playPedsActorPlayerRuntimeTurn: (turn, input) => playTurn(turn, input),
    applyPedsActorPlayerSequenceListenerCues: (activeTurn, sequence, nowMs) =>
      applyPedsActorPlayerSequenceListenerCues(playbackDeps(), activeTurn, sequence, nowMs),
    playPedsActorPlayerRuntimeSequence: (sequence, fallbackTurns) => playSequence(sequence, fallbackTurns),
    recordPedsActorPlayerRuntimePlaybackEvidence: (input) => recordPedsActorPlayerRuntimePlaybackEvidence(playbackDeps(), input),
    triggerHumanoidDialogueForTrace: (tag, text) => fireDialogueForTrace(tag, text),
    triggerHumanoidDialogue: (actorId, text, gazeTarget, explicitEmotion, requirement, emotionSource) =>
      fireDialogue(actorId, text, gazeTarget, explicitEmotion, requirement, emotionSource),
    humanoidDialogueDurationMs: (phonemeCount) => humanoidDialogueDurationMs(speechDeps, phonemeCount),
    scenarioDialogueEmotionContext: (actorId, text, explicitEmotion, emotionSource) =>
      scenarioDialogueEmotionContext(options, actorId, text, explicitEmotion, emotionSource),
    localDialogueActorIdForTraceTag: (tag) => localDialogueActorIdForTraceTag(speechDeps, tag),
    localDialogueGazeTargetForTraceTag: (tag) => localDialogueGazeTargetForTraceTag(speechDeps, tag),
    playbackScheduled: () => playbackScheduled,
    playbackLastTraceAtMs: () => playbackLastTraceAtMs,
    playbackSequenceActiveUntilMs: () => playbackSequenceActiveUntilMs,
  };
}

export type {
  ActorDialogueDeps,
  ActorDialogueTurn as PedsActorPlayerRuntimeTurn,
  ActorDialogueSequence as PedsActorPlayerRuntimeSequenceEvidence,
  ActorDialoguePlaybackEvidence as PedsActorPlayerRuntimePlaybackEvidence,
  ActorDialogueAdaptiveEvidence as PedsAdaptiveDialogueEvidence,
};
export type { PedsAdaptiveDialogueBranchResolution };
export { pedsActorPlayerTurnForTraceTag, pedsActorPlayerTurnFromRuntimeBundleTrace, pedsActorPlayerRuntimeSequenceForTrace };
