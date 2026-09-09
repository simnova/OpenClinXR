import type { Group } from "three";
import type { EncounterRuntimeDialogueTurn } from "@openclinxr/asset-registry";
import type { LiveActorTurnConsumption } from "@openclinxr/xr-dialogue";
import type { GeneratedDriveScalarInput, HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import type {
  UiXrExpressionEmotion,
  UiXrExpressionWeights,
} from "@openclinxr/xr-dialogue";

export type HumanoidExpressionEmotion = UiXrExpressionEmotion;
export type HumanoidExpressionWeights = UiXrExpressionWeights;

export type HumanoidEmotionExpressionState = {
  currentEmotion: HumanoidExpressionEmotion;
  targetEmotion: HumanoidExpressionEmotion;
  weights: HumanoidExpressionWeights;
  targetWeights: HumanoidExpressionWeights;
  transitionStartedAtMs: number;
  transitionDurationMs: number;
};

export type HumanoidDialogueGazeTarget = {
  kind: "learner_camera" | "actor";
  actorId: string | null;
};

export type HumanoidDialogueEmotionContext = {
  emotion: HumanoidExpressionEmotion;
  source: "runtime_affect_timeline" | "plan.dialogueEmotionTo" | "plan_missing";
  baselineMood: string[];
  cueIds: string[];
};

export type HumanoidSpeechPlayback = {
  actorId: string;
  assetId: string;
  gazeTargetKind: "learner_camera" | "actor";
  gazeTargetActorId: string | null;
  text: string;
  emotion: HumanoidExpressionEmotion;
  emotionContext: HumanoidDialogueEmotionContext;
  actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"];
  phonemeSequence: string[];
  visemeSequence: string[];
  bakedCues?: import("@openclinxr/xr-dialogue").PhonemeCue[];
  startedAtMs: number;
  durationMs: number;
};

export type GeneratedHumanoidAnimationSlot = {
  assetId: string;
  actorId: string;
  root: Group;
  actorSlot: Group;
  baseY: number;
  baseX: number;
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  baseRotationY: number;
  baseZ: number;
  phaseOffsetMs: number;
  mouthCue: import("three").Mesh;
  gazeCue: import("three").Line;
  eyeFocusCue: Group;
  expressionCue: Group;
  emotionExpression: HumanoidEmotionExpressionState;
  sourceComparatorFreezeEnabled: boolean;
  activeSpeech?: HumanoidSpeechPlayback | undefined;
  mixer?: import("three").AnimationMixer | undefined;
  responseClips?: import("three").AnimationClip[] | undefined;
  /**
   * A retargeted locomotion take present on this actor, excluded from auto-play. A consumer that
   * wants the actor to walk names it; nothing plays it by default.
   */
  locomotionClipName?: string | undefined;
  activeRoleAnimationClipName?: string | undefined;
  activeGazeProbeAnimationClipName?: string | undefined;
};

export type HumanoidRuntimeDrive = {
  locomotion?: GeneratedDriveScalarInput;
  gaze?: GeneratedDriveScalarInput;
  gazeAversion?: GeneratedDriveScalarInput;
  lipSync?: GeneratedDriveScalarInput;
  lipSyncViseme?: GeneratedDriveScalarInput;
};

export type HumanoidActingCueRecord = {
  actorId: string;
  role: string | null;
  cueIds: string[];
  respiratoryRateCueHz?: number | undefined;
  gazeAlternationTargetActorId?: string | null | undefined;
  bodyMotionMode:
    | "procedural_idle_body_motion"
    | "scenario_dialogue_body_motion_runtime"
    | "scenario_pediatric_respiratory_distress_idle_overlay"
    | "source_comparator_runtime_pose_updates_disabled";
};

export type HumanoidEyeMotionMetrics = {
  blinkIntensity: number;
  microSaccadeYaw: number;
  microSaccadePitch: number;
};

export type LiveDialogueTurnSummary = Pick<LiveActorTurnConsumption, "faceEmotion" | "caption">;

export type HumanoidBundleDialogueTurn = {
  actorId: string;
  text: string;
  cue: string;
  affectTimeline?:
    | {
        emotion: string;
        intensity: number;
        onsetMs: number;
        transitionMs: number;
        decayMs: number;
      }
    | null
    | undefined;
};

export type HumanoidAnimationRuntimeContext = {
  slots: GeneratedHumanoidAnimationSlot[];
  slotsByActorId: Map<string, GeneratedHumanoidAnimationSlot>;
  actorSlotsByActorId: Map<string, Group>;
  virtualDeviceSlotsByActorId: Map<string, Group>;
  activeVirtualDeviceSpeechByActorId: Map<string, HumanoidSpeechPlayback>;
  runtimePatientActorId: () => string;
  runtimeFamilyActorId: () => string;
  runtimeClinicalTeamActorId: () => string;
  runtimeActorRole: (actorId: string) => string | undefined;
  isPediatricAsthmaRuntimeScenario: () => boolean;
  shouldUseCleanHumanoidSourceComparatorCapture: () => boolean;
  humanoidDialogueDurationMs: (phonemeCount: number) => number;
  applyIdlePosture: (root: Group) => void;
  applyRolePosture: (root: Group, actorId: string) => void;
  seatedClipPerforming: (root: Group, actorId: string) => boolean;
  resolveGazeTargetWorld: (speech: HumanoidSpeechPlayback, camera: import("three").PerspectiveCamera) => import("three").Vector3;
  normalizeLiveEmotion: (emotion: string) => HumanoidExpressionEmotion;
  liveTurnForCue: (cue: string) => LiveDialogueTurnSummary | undefined;
  bundleTurnsForScenario: () => HumanoidBundleDialogueTurn[];
  runtimeTurnForTraceTag: (tag: string) => EncounterRuntimeDialogueTurn | undefined;
  isDeterministicCaptureClock: () => boolean;
  isMouthGazePoseReviewCaptureMode: () => boolean;
  selectedCaptureMode: () => string;
  selectedHumanoidSourceComparator: () => string | null;
  scenarioIdForEvidence: () => string;
  comparatorScenarioId: (comparator: string) => string;
  assetPathForSlot: (slot: GeneratedHumanoidAnimationSlot) => string;
  animationPlaybackForSlot: (slot: GeneratedHumanoidAnimationSlot) => string | undefined;
  morphTargetAppliedTargetCount: (slot: GeneratedHumanoidAnimationSlot) => number;
  visemeTimelineComparatorEvidencePresent: (slot: GeneratedHumanoidAnimationSlot) => boolean;
  emotionTransitionCuePresent: (slot: GeneratedHumanoidAnimationSlot) => boolean;
  currentSpeechEvidence: () => HumanoidSpeechEvidence | undefined;
  recordActingCueEvidence: (actorCues: HumanoidActingCueRecord[]) => void;
  writeActingCueEvidence?: ((record: Record<string, unknown>) => void) | undefined;
  writeComparatorEvidenceRecord?: ((record: Record<string, unknown>) => void) | undefined;
};
