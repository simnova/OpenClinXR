/**
 * Types for xr-actor-dialogue package - extracted from apps/ui-xr/src/main.ts
 * for the actor dialogue concern group.
 */

import type { Group, Vector3 } from "three";
import type { EncounterRuntimeDialogueTurn } from "@openclinxr/asset-registry";
import type { UiXrExpressionEmotion, UiXrExpressionWeights, LiveActorTurnConsumption } from "@openclinxr/xr-dialogue";
import type { ActorTurnPlan, ActorTurnExecution, DialogueEmotion } from "@openclinxr/shared-schemas";
import type { HumanoidEmotionExpressionState, GeneratedHumanoidAnimationSlot as PackageGeneratedHumanoidAnimationSlot, HumanoidDialogueGazeTarget, HumanoidDialogueEmotionContext, HumanoidSpeechPlayback } from "@openclinxr/xr-humanoid-animation";
import type { PedsAdaptiveDialogueBranchResolution } from "./peds-adaptive-dialogue-policy.js";
import type { Scenario } from "@openclinxr/shared-schemas";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";

export type { 
  HumanoidDialogueGazeTarget, 
  HumanoidDialogueEmotionContext, 
  PedsAdaptiveDialogueBranchResolution,
  EncounterRuntimeDialogueTurn,
  LiveActorTurnConsumption,
  ActorTurnPlan,
  ActorTurnExecution,
  DialogueEmotion,
  HumanoidEmotionExpressionState,
  UiXrExpressionEmotion,
  UiXrExpressionWeights,
};

export type PedsActorPlayerRuntimeTurn = {
  actorId: string;
  turnId: string;
  cue: string;
  text: string;
  emotion: UiXrExpressionEmotion;
  gazeTargetKind: "learner_camera" | "actor";
  gazeTargetActorId: string | null;
  roleAnimationClipName: string;
  source: "bundle_dialogue_turn" | "actor_player_sample_fallback";
};

export type PedsActorPlayerRuntimeSequenceSource = "bundle_dialogue_sequence" | "single_runtime_turn";

export type PedsActorPlayerRuntimeSequenceEvidence = {
  sequenceId: string;
  traceTag: string;
  source: PedsActorPlayerRuntimeSequenceSource;
  turns: PedsActorPlayerRuntimeTurn[];
};

export type PedsActorPlayerRuntimePlaybackEvidence = {
  source: "window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence";
  scenarioId: "peds_asthma_parent_anxiety_v1" | "ed_chest_pain_priority_v1" | "ed_chest_pain_priority_v2";
  playbackMode: "local_desktop_preview_from_bundle_dialogue_or_actor_player_samples";
  sourceArtifactPath: string;
  scheduled: boolean;
  actorCount: number;
  turnCount: number;
  bundleDialogueTurnCount: number;
  fallbackTurnCount: number;
  latestTurnIndex: number;
  latestActorId: string | null;
  latestTurnId: string | null;
  latestCue: string | null;
  latestEmotion: UiXrExpressionEmotion | null;
  latestRoleAnimationClipName: string | null;
  latestTurnSource: PedsActorPlayerRuntimeTurn["source"] | null;
  latestTriggerSource: "scheduled_preview" | "trace_action" | null;
  latestTraceTag: string | null;
  latestSequenceId: string | null;
  latestSequenceSource: PedsActorPlayerRuntimeSequenceSource | null;
  latestSequenceStepIndex: number;
  latestSequenceTurnCount: number;
  latestSequenceActorIds: string[];
  latestListenerActorIds: string[];
  latestCoupledSignalIds: string[];
  activeGeneratedActorSlotCount: number;
  activeHumanoidSpeechEvidenceActorId: string | null;
  scenePlacementEvidenceAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "local_actor_player_runtime_preview_not_readiness";
  notEvidenceFor: string[];
};

export type HumanoidExpressionEmotion = UiXrExpressionEmotion;
export type HumanoidExpressionWeights = UiXrExpressionWeights;

export type GeneratedHumanoidAnimationSlot = PackageGeneratedHumanoidAnimationSlot;

export type XrActorDialogueDependencies = {
  encounterRuntimeAssetBundle: () => {
    sceneManifest: {
      dialogueTurns?: EncounterRuntimeDialogueTurn[];
      stationContext?: { initialDialogueText?: string | null };
    };
    scenarioId: string;
  };
  initialDialogueText: () => string;
  selectedScenarioId: () => string;
  generatedHumanoidAnimationSlotsByActorId: () => Map<string, GeneratedHumanoidAnimationSlot>;
  generatedHumanoidAnimationSlots: () => GeneratedHumanoidAnimationSlot[];
  generatedHumanoidActorSlotsByActorId: () => Map<string, Group>;
  virtualDeviceActorSlotsByActorId: () => Map<string, Group>;
  activeVirtualDeviceSpeechByActorId: () => Map<string, HumanoidSpeechPlayback>;
  runtimePatientActorId: () => string;
  runtimeFamilyActorId: () => string;
  runtimeClinicalTeamActorId: () => string;
  humanoidDialogueDurationMs: (phonemeCount: number, isReviewCapture: boolean) => number;
  isPediatricAsthmaRuntimeScenario: () => boolean;
  isHumanoidMouthGazePoseReviewCaptureMode: () => boolean;
  isDeterministicCaptureClock: () => boolean;
  selectedHumanoidSourceComparator: () => string | null;
  buildHumanoidSpeechEvidence: (
    actorId: string | null,
    assetId: string | null,
    text: string | null,
    phonemeSequence: string[],
    visemeSequence: string[],
    gazeTarget: HumanoidDialogueGazeTarget | null,
    emotionContext?: HumanoidDialogueEmotionContext,
    requirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"] | unknown
  ) => Record<string, unknown>;
  recordBootPhase: (phase: string, error?: unknown) => void;
  startHumanoidEmotionTransition: (slot: GeneratedHumanoidAnimationSlot, emotion: HumanoidExpressionEmotion, nowMs: number) => void;
  attachBakedCuesToSpeech: (slot: GeneratedHumanoidAnimationSlot, text: string, scenarioId: string) => void;
  phonemesForText: (text: string) => string[];
  visemesForText: (text: string) => string[];
  orientHumanoidEyeFocusCue: (slot: GeneratedHumanoidAnimationSlot, gazeOrigin: Vector3, boundedTarget: Vector3) => void;
  orientHumanoidTowardGazeTarget: (slot: GeneratedHumanoidAnimationSlot, targetWorld: Vector3) => void;
  updateHumanoidEmotionExpression: (slot: GeneratedHumanoidAnimationSlot, nowMs: number) => HumanoidEmotionExpressionState;
  applyHumanoidMorphTargetCue: (slot: GeneratedHumanoidAnimationSlot, openness: number, viseme: string, weights: HumanoidExpressionWeights) => void;
  applyPackagePedsActorPlayerSequenceListenerCues: (context: {
    actorSlotsByActorId: Map<string, Group>;
    animationSlotsByActorId: Map<string, GeneratedHumanoidAnimationSlot>;
    orientEyeFocusCue: (slot: GeneratedHumanoidAnimationSlot, gazeOrigin: Vector3, boundedTarget: Vector3) => void;
    orientTowardGazeTarget: (slot: GeneratedHumanoidAnimationSlot, targetWorld: Vector3) => void;
    startEmotionTransition: (slot: GeneratedHumanoidAnimationSlot, emotion: HumanoidExpressionEmotion, nowMs: number) => void;
    updateEmotionExpression: (slot: GeneratedHumanoidAnimationSlot, nowMs: number) => HumanoidEmotionExpressionState;
    applyMorphTargetCue: (slot: GeneratedHumanoidAnimationSlot, openness: number, viseme: string, weights: HumanoidExpressionWeights) => void;
    createVector: (x: number, y: number, z: number) => Vector3;
  }, activeTurn: { actorId: string; emotion: string }, sequence: { sequenceId: string; traceTag: string; turns: Array<{ actorId: string }> } | null, nowMs: number) => { actorIds: string[]; coupledSignalIds: string[] };
  listenerPackageEmotionForSequence: (activeTurn: { emotion: string }) => HumanoidExpressionEmotion;
  recordPackagePedsActorPlayerRuntimePlaybackEvidence: (context: PedsActorPlayerPlaybackContext, input: PedsActorPlayerRuntimePlaybackInput) => void;
  initialDialogueTextForScenario: (input: { scenarioId: string; runtimeInitialDialogueText?: string | null; bundleMismatch?: boolean }) => string;
  resolveLiveActorTurnForTrace: (tag: string) => LiveActorTurnConsumption | undefined;
  actorIdForTraceTag: (tag: string, scenarioId: string) => string | undefined;
  playLiveFrozenActorTurn: (plan: ActorTurnPlan, execution: ActorTurnExecution | null, gazeTarget: HumanoidDialogueGazeTarget, actorRuntimeRealismRequirement?: unknown) => boolean;
  playOneShotResponseClip: (actorId: string, clipName: string) => void;
  createHumanoidEmotionExpressionState: (options: { deterministicClock: boolean }) => HumanoidEmotionExpressionState;
  startPackageHumanoidEmotionTransition: (slot: GeneratedHumanoidAnimationSlot, emotion: HumanoidExpressionEmotion, nowMs: number) => void;
  updatePackageHumanoidEmotionExpression: (slot: GeneratedHumanoidAnimationSlot, nowMs: number) => HumanoidEmotionExpressionState;
  scenarioBank: () => Scenario[];
  runtimeActorEmbodimentImpl: (bundle: ReturnType<XrActorDialogueDependencies["encounterRuntimeAssetBundle"]>, actorId: string) => string;
  pedsActorPlayerRuntimeTurns: () => PedsActorPlayerRuntimeTurn[];
  pedsActorPlayerBundleDialogueTurns: () => PedsActorPlayerRuntimeTurn[];
  pedsActorPlayerTurnFromRuntimeBundleTrace: (traceTag: string) => PedsActorPlayerRuntimeTurn | undefined;
  pedsActorPlayerTurnForTraceTag: (traceTag: string, fallbackTurns?: PedsActorPlayerRuntimeTurn[]) => PedsActorPlayerRuntimeTurn | undefined;
  pedsActorPlayerRuntimeSequenceForTrace: (traceTag: string, fallbackTurns?: PedsActorPlayerRuntimeTurn[]) => PedsActorPlayerRuntimeSequenceEvidence | undefined;
  dedupePedsActorPlayerRuntimeTurns: (turns: PedsActorPlayerRuntimeTurn[]) => PedsActorPlayerRuntimeTurn[];
  playPedsActorPlayerRuntimeTurn: (turn: PedsActorPlayerRuntimeTurn, input: {
    turns: PedsActorPlayerRuntimeTurn[];
    latestTurnIndex: number;
    latestTriggerSource: "scheduled_preview" | "trace_action" | null;
    latestTraceTag: string | null;
    latestSequence: PedsActorPlayerRuntimeSequenceEvidence | null;
    latestSequenceStepIndex: number;
  }) => void;
  playPedsActorPlayerRuntimeSequence: (sequence: PedsActorPlayerRuntimeSequenceEvidence, fallbackTurns: PedsActorPlayerRuntimeTurn[]) => void;
  pedsActorListenerCuePanelContext: () => {
    actorSlotsByActorId: Map<string, Group>;
    animationSlotsByActorId: Map<string, GeneratedHumanoidAnimationSlot>;
    orientEyeFocusCue: (slot: GeneratedHumanoidAnimationSlot, gazeOrigin: Vector3, boundedTarget: Vector3) => void;
    orientTowardGazeTarget: (slot: GeneratedHumanoidAnimationSlot, targetWorld: Vector3) => void;
    startEmotionTransition: (slot: GeneratedHumanoidAnimationSlot, emotion: HumanoidExpressionEmotion, nowMs: number) => void;
    updateEmotionExpression: (slot: GeneratedHumanoidAnimationSlot, nowMs: number) => HumanoidEmotionExpressionState;
    applyMorphTargetCue: (slot: GeneratedHumanoidAnimationSlot, openness: number, viseme: string, weights: HumanoidExpressionWeights) => void;
    createVector: (x: number, y: number, z: number) => Vector3;
  };
  applyPedsActorPlayerSequenceListenerCues: (activeTurn: PedsActorPlayerRuntimeTurn, sequence: PedsActorPlayerRuntimeSequenceEvidence | null, nowMs: number) => { actorIds: string[]; coupledSignalIds: string[] };
  pedsActorPlayerPlaybackPanelContext: () => PedsActorPlayerPlaybackContext;
  recordPedsActorPlayerRuntimePlaybackEvidence: (input: PedsActorPlayerRuntimePlaybackInput) => void;
  localDialogueActorIdForTraceTag: (tag: string) => string | undefined;
  localDialogueGazeTargetForTraceTag: (tag: string) => HumanoidDialogueGazeTarget;
  runtimeDialogueTurnForTraceTag: (tag: string) => EncounterRuntimeDialogueTurn | undefined;
  scenarioDialogueEmotionContext: (
    actorId: string,
    text: string,
    explicitEmotion?: HumanoidExpressionEmotion,
    emotionSource?: HumanoidDialogueEmotionContext["source"]
  ) => HumanoidDialogueEmotionContext;
  triggerHumanoidDialogue: (
    actorId: string,
    text: string,
    gazeTarget: HumanoidDialogueGazeTarget,
    explicitEmotion?: HumanoidExpressionEmotion,
    actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"] | unknown,
    emotionSource?: HumanoidDialogueEmotionContext["source"]
  ) => void;
  triggerHumanoidDialogueForTrace: (tag: string, text: string) => void;
};

export type PedsActorPlayerRuntimePlaybackInput = {
  scheduled: boolean;
  turns: Array<{ actorId: string }>;
  latestTurnIndex: number;
  latestTurn: {
    actorId: string;
    turnId: string;
    cue: string;
    emotion: string;
    roleAnimationClipName: string;
    source: string;
  } | null;
  latestTriggerSource: "scheduled_preview" | "trace_action" | null;
  latestTraceTag: string | null;
  latestSequence: { sequenceId: string; source: string | null; turns: Array<{ actorId: string }> } | null;
  latestSequenceStepIndex: number;
  latestListenerActorIds: string[];
  latestCoupledSignalIds: string[];
};

export type PedsActorPlayerPlaybackContext = {
  dialogueTurnCount: () => number;
  selectedHumanoidSourceComparator: () => string | null;
  activeGeneratedActorSlotCount: () => number;
  activeHumanoidSpeechEvidenceActorId: () => string | null;
  playbackEvidenceWritten: (evidence: Record<string, unknown>) => void;
};

export type XrActorDialogueStore = {
  // Private state (accessed via getters)
  pedsActorPlayerRuntimePlaybackScheduled: boolean;
  pedsActorPlayerRuntimePlaybackLastTraceAtMs: number;
  pedsActorPlayerRuntimeSequenceActiveUntilMs: number;
  
  // Functions
  initialDialogueTextForSelectedScenario: () => string;
  runtimeDialogueTurnForTraceTag: (tag: string) => EncounterRuntimeDialogueTurn | undefined;
  schedulePedsActorPlayerRuntimePlaybackIfReady: () => void;
  triggerPedsAdaptiveDialogueBranch: (branch: PedsAdaptiveDialogueBranchResolution, triggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"]) => boolean;
  triggerPedsActorPlayerRuntimeTurnForTrace: (traceTag: string) => boolean;
  dedupePedsActorPlayerRuntimeTurns: (turns: PedsActorPlayerRuntimeTurn[]) => PedsActorPlayerRuntimeTurn[];
  pedsActorPlayerBundleDialogueTurns: () => PedsActorPlayerRuntimeTurn[];
  pedsActorPlayerTurnFromRuntimeBundleTrace: (traceTag: string) => PedsActorPlayerRuntimeTurn | undefined;
  normalizePedsActorPlayerEmotion: (emotion: string) => HumanoidExpressionEmotion;
  playPedsActorPlayerRuntimeTurn: (turn: PedsActorPlayerRuntimeTurn, input: {
    turns: PedsActorPlayerRuntimeTurn[];
    latestTurnIndex: number;
    latestTriggerSource: "scheduled_preview" | "trace_action" | null;
    latestTraceTag: string | null;
    latestSequence: PedsActorPlayerRuntimeSequenceEvidence | null;
    latestSequenceStepIndex: number;
  }) => void;
  applyPedsActorPlayerSequenceListenerCues: (
    activeTurn: PedsActorPlayerRuntimeTurn,
    sequence: PedsActorPlayerRuntimeSequenceEvidence | null,
    nowMs: number
  ) => { actorIds: string[]; coupledSignalIds: string[] };
  playPedsActorPlayerRuntimeSequence: (sequence: PedsActorPlayerRuntimeSequenceEvidence, fallbackTurns: PedsActorPlayerRuntimeTurn[]) => void;
  pedsActorPlayerRuntimeTurns: () => PedsActorPlayerRuntimeTurn[];
  pedsActorPlayerPlaybackPanelContext: () => PedsActorPlayerPlaybackContext;
  recordPedsActorPlayerRuntimePlaybackEvidence: (input: PedsActorPlayerRuntimePlaybackInput) => void;
  triggerHumanoidDialogueForTrace: (tag: string, text: string) => void;
  triggerHumanoidDialogue: (
    actorId: string,
    text: string,
    gazeTarget: HumanoidDialogueGazeTarget,
    explicitEmotion?: HumanoidExpressionEmotion,
    actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"] | unknown,
    emotionSource?: HumanoidDialogueEmotionContext["source"]
  ) => void;
  humanoidDialogueDurationMs: (phonemeCount: number) => number;
  scenarioDialogueEmotionContext: (
    actorId: string,
    text: string,
    explicitEmotion?: HumanoidExpressionEmotion,
    emotionSource?: HumanoidDialogueEmotionContext["source"]
  ) => HumanoidDialogueEmotionContext;
  localDialogueActorIdForTraceTag: (tag: string) => string | undefined;
  localDialogueGazeTargetForTraceTag: (tag: string) => HumanoidDialogueGazeTarget;
};