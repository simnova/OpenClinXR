import type {
  EnvironmentStateEvidence,
  HumanoidSpeechEvidence,
  LearnerRuntimeUseGateEvidence,
  TraceReadinessSummary,
  ManualPerformanceCaptureSummary,
  ManualPerformanceDraft,
  ManualPerformanceFrameStats,
  ManualPerformanceInputEvidence,
  ManualPerformanceReproducibilityEvidence,
  ManualPerformanceTraceLatencyEvidence,
  RuntimeEvidencePosture,
  RuntimeInteractionEvidence,
  RuntimeMaterializationEvidenceAttachmentSummary,
  RuntimeRemainingRuntimeBlockerReasons,
  XrRuntimeReadinessDecision,
  XrRuntimeState,
  XrTraceActionHandoffAction,
  XrTraceActionHandoffEvidence,
  XrTraceInteractionEvidenceSummary,
} from "@openclinxr/xr-runtime-state";
import type { Group, Vector3 } from "three";

export type XrTraceReadinessPanels = {
  traceSummary: HTMLElement;
  postureSummary: HTMLElement;
  postureModel: HTMLElement;
  postureVoice: HTMLElement;
  postureQuest: HTMLElement;
  postureMr: HTMLElement;
  postureBundleGate: HTMLElement;
  postureLaunch: HTMLElement;
};

export type XrTraceReadinessEvidencePanels = {
  evidenceFrames: HTMLElement;
  evidenceLoop: HTMLElement;
  evidenceInput: HTMLElement;
  evidenceSceneAssets: HTMLElement;
  evidenceSpeechAffect: HTMLElement;
  evidenceActorPlayer: HTMLElement;
  evidenceLocomotion: HTMLElement;
  evidenceTraceInteraction: HTMLElement;
  evidenceTrace: HTMLElement;
  evidenceValidation: HTMLElement;
  copyEvidenceStatus: HTMLElement;
  manualEvidenceJson: HTMLTextAreaElement;
};

export type TraceLatencyRecorder = {
  recordLatency: (startedAtMs: number, tag: string, source: ManualPerformanceTraceLatencyEvidence["source"]) => number;
  currentLatencyMs: () => number | null;
};

export type TraceReadinessPostureDeps = {
  summarizeTraceReadiness: (state: XrRuntimeState) => TraceReadinessSummary;
  buildRuntimeEvidencePosture: (input: {
    traceSummary: TraceReadinessSummary;
    captureSummary: ManualPerformanceCaptureSummary | null;
    webXrSupport: ManualPerformanceReproducibilityEvidence["webXr"];
    traceActionHandoffEvidence: XrTraceActionHandoffEvidence | null;
    runtimeInteractionEvidence: RuntimeInteractionEvidence | null;
    runtimeNowMs: number;
  }) => RuntimeEvidencePosture;
  buildReadinessDecision: (input: {
    posture: RuntimeEvidencePosture;
    iwsdkStationMcpSmokeReady: boolean;
  }) => XrRuntimeReadinessDecision;
  formatPostureLane: (lane: RuntimeEvidencePosture["lanes"][number] | undefined) => string;
  formatReadinessDecision: (decision: XrRuntimeReadinessDecision) => string;
  formatLearnerRuntimeUseGate: (evidence: LearnerRuntimeUseGateEvidence | null) => string;
  roundPerformanceNow: () => number;
};

export type TraceReadinessContext = TraceReadinessPostureDeps & {
  runtimeState: () => XrRuntimeState;
  panels: XrTraceReadinessPanels;
  latestRuntimeInteractionEvidence: () => RuntimeInteractionEvidence | null;
  webXrSupportEvidence: () => ManualPerformanceReproducibilityEvidence["webXr"];
  handoffEvidence: () => XrTraceActionHandoffEvidence | null;
  captureSummary: () => ManualPerformanceCaptureSummary | null;
  learnerRuntimeUseGateEvidence: () => LearnerRuntimeUseGateEvidence | null;
  postureWritten: (posture: RuntimeEvidencePosture, decision: XrRuntimeReadinessDecision) => void;
};

export type TraceHandoffContext = {
  runtimeState: () => XrRuntimeState;
  handoffActions: () => readonly XrTraceActionHandoffAction[];
  lastTraceLatencyEvidence: () => ManualPerformanceTraceLatencyEvidence | null;
  buildHandoffEvidence: (input: {
    state: XrRuntimeState;
    actions: readonly XrTraceActionHandoffAction[];
    generatedAtMs: number;
    lastTraceLatencyEvidence: ManualPerformanceTraceLatencyEvidence | null;
  }) => XrTraceActionHandoffEvidence;
  roundPerformanceNow: () => number;
  handoffWritten: (evidence: XrTraceActionHandoffEvidence) => void;
  interactionSummaryWritten: (summary: XrTraceInteractionEvidenceSummary) => void;
  buildInteractionSummary: (handoff: XrTraceActionHandoffEvidence | null | undefined) => XrTraceInteractionEvidenceSummary;
};

export type TraceInteractionSummaryContext = {
  buildSummary: (handoff: XrTraceActionHandoffEvidence | null | undefined) => XrTraceInteractionEvidenceSummary;
  interactionSummaryWritten: (summary: XrTraceInteractionEvidenceSummary) => void;
};

export type EnvironmentTraceContext = {
  previousActiveTraceTags: () => readonly string[];
  equipmentIdsForTag: (tag: string) => string[];
  realismCueIds: readonly string[];
  applyEnvironmentStateVisuals: (evidence: EnvironmentStateEvidence) => void;
  applyRuntimeEquipmentTraceVisuals: (evidence: EnvironmentStateEvidence) => void;
  environmentStateWritten: (evidence: EnvironmentStateEvidence) => void;
};

export type XrSupportStatusContext = {
  supportEvidence: () => ManualPerformanceReproducibilityEvidence["webXr"];
  captureSummary: () => ManualPerformanceCaptureSummary | null;
  traceReadinessForPanel: (captureSummary: ManualPerformanceCaptureSummary | null) => RuntimeEvidencePosture;
  roundPerformanceNow: () => number;
  formatUnknownError: (error: unknown) => string;
  statusWritten: (evidence: ManualPerformanceReproducibilityEvidence["webXr"]) => void;
};

export type RuntimeReproducibilityContext = {
  appMetadata: () => { packageName: string; version: string; gitCommit: string; buildTime: string; mode: string };
  webXrSupportEvidence: () => ManualPerformanceReproducibilityEvidence["webXr"];
  viewportSize: () => { width: number; height: number };
  screenSize: () => { width: number | null; height: number | null };
  devicePixelRatio: () => number;
  visibilityState: () => string;
  pageUrl: () => string;
  userAgent: () => string;
  buildReproducibility: (input: {
    url: string;
    userAgent: string;
    app: { packageName: string; version: string; gitCommit: string; buildTime: string; mode: string };
    webXr: ManualPerformanceReproducibilityEvidence["webXr"];
    display: {
      viewportWidth: number;
      viewportHeight: number;
      screenWidth: number | null;
      screenHeight: number | null;
      devicePixelRatio: number;
      visibilityState: string;
    };
  }) => ManualPerformanceReproducibilityEvidence;
};

export type FrameRecordingContext = {
  elapsedSecond: () => number;
  completedTraceTags: () => readonly string[];
  lastTraceSelectLatencyMs: () => number | null;
  experienceModeEvidence: () => ManualPerformanceDraft["experience"] | undefined;
  experienceModeFallback: ManualPerformanceDraft["experience"];
  inputEvidence: () => ManualPerformanceInputEvidence | null;
  traceLatencyEvidence: () => ManualPerformanceTraceLatencyEvidence | null;
  reproducibilityEvidence: () => ManualPerformanceReproducibilityEvidence;
  immersiveSessionStarted: () => boolean;
  foregroundPageConfirmed: () => boolean;
  generatedAt: () => string;
  nowMs: () => number;
  frameStatsWritten: (stats: ManualPerformanceFrameStats) => void;
  draftWritten: (draft: ManualPerformanceDraft) => void;
  captureSummaryWritten: (summary: ManualPerformanceCaptureSummary) => void;
  afterFirstOrThirtiethFrame: () => void;
  buildFrameStats: (input: {
    frameDeltasMs: number[];
    framesObserved: number;
    firstFrameAtMs: number | null;
    latestFrameAtMs: number;
    previewFramesObserved: number;
    immersiveFramesObserved: number;
    qualitySource: "webxr_animation_loop" | "flat_preview_fallback";
    isPresenting: boolean;
    visibilityState: string;
  }) => ManualPerformanceFrameStats;
  buildDraft: (input: {
    generatedAt: string;
    elapsedSecond: number;
    foregroundPageConfirmed: boolean;
    traceInteractionPassed: boolean;
    frameStats: ManualPerformanceFrameStats;
    controllerSelectLatencyMs: number | null;
    experienceModeEvidence?: ManualPerformanceDraft["experience"] | undefined;
    inputEvidence?: ManualPerformanceInputEvidence | null | undefined;
    traceLatencyEvidence: ManualPerformanceTraceLatencyEvidence | null;
    reproducibilityEvidence: ManualPerformanceReproducibilityEvidence;
    immersiveSessionStarted: boolean;
  }) => ManualPerformanceDraft;
  buildCaptureSummary: (input: {
    draft: ManualPerformanceDraft | null;
    frameStats: ManualPerformanceFrameStats | null;
    now: number;
  }) => ManualPerformanceCaptureSummary;
};

export type ManualEvidencePanelContext = TraceReadinessPostureDeps & {
  runtimeState: () => XrRuntimeState;
  panels: XrTraceReadinessPanels & XrTraceReadinessEvidencePanels;
  captureSummary: () => ManualPerformanceCaptureSummary | null;
  postureWritten: (posture: RuntimeEvidencePosture, decision: XrRuntimeReadinessDecision) => void;
  frameStats: () => ManualPerformanceFrameStats | null;
  draft: () => ManualPerformanceDraft | null;
  copyDisposition: () => string;
  latestRuntimeInteractionEvidence: () => RuntimeInteractionEvidence | null;
  webXrSupportEvidence: () => ManualPerformanceReproducibilityEvidence["webXr"];
  handoffEvidence: () => XrTraceActionHandoffEvidence | null;
  learnerRuntimeUseGateEvidence: () => LearnerRuntimeUseGateEvidence | null;
  formatSceneAssetEvidenceStatus: (evidence: Record<string, unknown> | null) => string;
  formatHumanoidSpeechAffectEvidence: (evidence: HumanoidSpeechEvidence | null) => string;
  formatPerformanceContractEvidence: (evidence: Record<string, unknown> | null) => string;
  formatActorPlayerRuntimeMetadataSummary: (
    evidence: Record<string, unknown> | null,
    playback: Record<string, unknown> | null,
  ) => string;
  formatPortalTransitionEvidence: (evidence: Record<string, unknown> | null) => string;
  formatLocomotionPathQuality: (quality: ManualPerformanceCaptureSummary["locomotionPathQuality"]) => string;
  formatLocomotionDiagnosticSummary: (
    summary: ManualPerformanceCaptureSummary["locomotionDiagnosticSummary"],
  ) => string;
  formatLocomotionProbeSummary: (summary: ManualPerformanceCaptureSummary["locomotionProbeSummary"]) => string;
  formatTechnicalGapStatus: (summary: ManualPerformanceCaptureSummary | null) => string;
  formatManualEvidenceCopyStatus: (summary: ManualPerformanceCaptureSummary, disposition: string) => string;
  buildCaptureSummary: (input: {
    draft: ManualPerformanceDraft | null;
    frameStats: ManualPerformanceFrameStats | null;
    now: number;
  }) => ManualPerformanceCaptureSummary;
  buildEvidencePayload: (input: {
    manualPerformanceDraft: ManualPerformanceDraft | null;
    captureSummary: ManualPerformanceCaptureSummary;
    runtimeAssetBundleId: string | null;
    learnerRuntimeUseGateEvidence: LearnerRuntimeUseGateEvidence | null;
    runtimeSceneManifestEvidence: Record<string, unknown> | null;
    textPanelEvidence: Record<string, unknown> | null;
    traceActionHandoffEvidence: XrTraceActionHandoffEvidence | null;
    sceneAssetEvidence: Record<string, unknown> | null;
    environmentStateEvidence: EnvironmentStateEvidence | null;
    humanoidSpeechEvidence: HumanoidSpeechEvidence | null;
    caseDefinedHumanoidPerformanceContractEvidence: Record<string, unknown> | null;
    actorPlayerRuntimeMetadataSummary: Record<string, unknown> | null;
    examineeLocomotionEvidence: Record<string, unknown> | null;
    runtimeInteractionEvidence: RuntimeInteractionEvidence | null;
    traceInteractionEvidenceSummary: XrTraceInteractionEvidenceSummary | null;
  }) => Record<string, unknown>;
  sceneAssetEvidence: () => Record<string, unknown> | null;
  humanoidSpeechEvidence: () => HumanoidSpeechEvidence | null;
  performanceContractEvidence: () => Record<string, unknown> | null;
  actorPlayerRuntimeMetadataSummary: () => Record<string, unknown> | null;
  examineeLocomotionEvidence: () => Record<string, unknown> | null;
  selectedRuntimeAssetBundleId: () => string | null;
  runtimeSceneManifestEvidence: () => Record<string, unknown> | null;
  textPanelEvidence: () => Record<string, unknown> | null;
  environmentStateEvidence: () => EnvironmentStateEvidence | null;
  pedsActorPlayerRuntimePlaybackEvidence: () => Record<string, unknown> | null;
  portalTransitionEvidence: () => Record<string, unknown> | null;
  examFlowEvidence: () => Record<string, unknown> | null;
  examRunSummaryEvidence: () => Record<string, unknown> | null;
  interactionSummary: () => XrTraceInteractionEvidenceSummary | null;
  captureSummaryWritten: (summary: ManualPerformanceCaptureSummary) => void;
};

export type HumanoidSpeechEvidenceContext = {
  buildEvidence: (
    actorId: string | null,
    assetId: string | null,
    text: string | null,
    phonemeSequence: string[],
    visemeSequence: string[],
    gazeTarget: { kind: "learner_camera" | "actor"; actorId: string | null } | null,
    emotionContext?: unknown,
    requirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
  ) => HumanoidSpeechEvidence;
};

export type PedsActorListenerCueContext = {
  actorSlotsByActorId: ReadonlyMap<string, Group>;
  animationSlotsByActorId: ReadonlyMap<string, PedsActorListenerAnimationSlot>;
  orientEyeFocusCue: (slot: PedsActorListenerAnimationSlot, gazeOrigin: Vector3, boundedTarget: Vector3) => void;
  orientTowardGazeTarget: (slot: PedsActorListenerAnimationSlot, targetWorld: Vector3) => void;
  startEmotionTransition: (
    slot: PedsActorListenerAnimationSlot,
    emotion: PedsActorListenerEmotion,
    nowMs: number,
  ) => void;
  updateEmotionExpression: (
    slot: PedsActorListenerAnimationSlot,
    nowMs: number,
  ) => {
    targetEmotion: PedsActorListenerEmotion;
    weights: { mouthOpen: number; cheekTension: number; browConcern: number };
  };
  applyMorphTargetCue: (
    slot: PedsActorListenerAnimationSlot,
    openness: number,
    viseme: string,
    weights: { mouthOpen: number; cheekTension: number; browConcern: number },
  ) => void;
  createVector: (x: number, y: number, z: number) => Vector3;
};

export type PedsActorListenerEmotion = "concerned" | "reassured" | "neutral" | "anxious" | "pain";

export type PedsActorListenerExpressionWeights = {
  mouthOpen: number;
  cheekTension: number;
  browConcern: number;
};

export type PedsActorListenerExpressionState = {
  targetEmotion: PedsActorListenerEmotion;
  weights: PedsActorListenerExpressionWeights;
};

export type PedsActorListenerAnimationSlot = {
  root: Group & {
    worldToLocal: (vector: Vector3) => Vector3;
    userData: Record<string, unknown>;
  };
  gazeCue: { geometry: { setFromPoints: (points: Vector3[]) => void }; visible: boolean };
  expressionCue: { visible: boolean; scale: { set: (x: number, y: number, z: number) => void } };
  activeSpeech?: unknown;
  sourceComparatorFreezeEnabled: boolean;
};

export type PedsActorListenerCueInput = {
  activeTurn: { actorId: string; emotion: string };
  sequence: { sequenceId: string; traceTag: string; turns: Array<{ actorId: string }> } | null;
  nowMs: number;
};

export type PedsActorPlayerPlaybackInput = {
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

export type TraceReadinessMaterializationSummary = {
  runtimeSelectionBlockedUntilEvidenceAttached?: boolean;
  actorBlockers?: readonly string[];
  equipmentBlockers?: readonly string[];
  materializationEvidenceAttachmentSummary?: RuntimeMaterializationEvidenceAttachmentSummary | null | undefined;
  remainingRuntimeBlockerReasons?: RuntimeRemainingRuntimeBlockerReasons | null | undefined;
};
