import type {
  EncounterRuntimeDialogueTurn,
  LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import type {
  ActorTurnPlayback,
  LiveActorTurnConsumption,
} from "@openclinxr/xr-dialogue";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidDialogueGazeTarget,
  HumanoidExpressionEmotion,
  HumanoidSpeechPlayback,
} from "@openclinxr/xr-humanoid-animation";
import type { HumanoidSpeechEvidence } from "@openclinxr/xr-runtime-state";
import type { PedsActorListenerCueContext } from "@openclinxr/xr-trace-readiness";
import type { PedsAdaptiveDialogueBranchResolution } from "./policy.js";

export type ActorDialogueTurn = {
  actorId: string;
  turnId: string;
  cue: string;
  text: string;
  emotion: HumanoidExpressionEmotion;
  gazeTargetKind: "learner_camera" | "actor";
  gazeTargetActorId: string | null;
  roleAnimationClipName: string;
  source: "bundle_dialogue_turn" | "actor_player_sample_fallback";
};

export type ActorDialogueSequenceSource = "bundle_dialogue_sequence" | "single_runtime_turn";

export type ActorDialogueSequence = {
  sequenceId: string;
  traceTag: string;
  source: ActorDialogueSequenceSource;
  turns: ActorDialogueTurn[];
};

export type ActorDialogueAdaptiveEvidence = {
  source: "window.__openClinXrPedsAdaptiveDialogueEvidence";
  scenarioId: "peds_asthma_parent_anxiety_v1" | "ed_chest_pain_priority_v1" | "ed_chest_pain_priority_v2";
  latestRequestedTraceTag: string;
  latestPolicyTrigger: PedsAdaptiveDialogueBranchResolution["policyTrigger"];
  latestBranchType: PedsAdaptiveDialogueBranchResolution["branchType"];
  adaptiveTraceTags: string[];
  emotionTransition: PedsAdaptiveDialogueBranchResolution["emotionTransition"];
  mappingMode: PedsAdaptiveDialogueBranchResolution["mappingMode"];
  reviewSafeMetadata: PedsAdaptiveDialogueBranchResolution["reviewSafeMetadata"];
  latestSequenceSource: "bundle_dialogue_adaptive_branch";
  humanoidSourceComparator?:
    | "peds_anny_school_age_mpfb2_eye_patient"
    | "peds_anny_real_garment_patient"
    | "peds_anny_real_garment_parent"
    | "peds_anny_real_garment_nurse"
    | "ed_anny_real_garment_patient";
  schoolAgePatientAssetPath?: "/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb";
  realGarmentPatientAssetPath?: "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb";
  realGarmentParentAssetPath?: "/generated-humanoids/peds_anxious_parent.glb";
  realGarmentNurseAssetPath?: "/generated-humanoids/peds_nurse_kevin.glb";
  edRealGarmentPatientAssetPath?: "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb";
  notEvidenceFor: string[];
};

export type ActorDialoguePlaybackTriggerSource = "scheduled_preview" | "trace_action" | null;

export type ActorDialoguePlaybackEvidence = {
  source: "window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence";
  scenarioId: "peds_asthma_parent_anxiety_v1" | "ed_chest_pain_priority_v1" | "ed_chest_pain_priority_v2";
  playbackMode: "local_desktop_preview_from_bundle_dialogue_or_actor_player_samples";
  sourceArtifactPath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json";
  scheduled: boolean;
  actorCount: number;
  turnCount: number;
  bundleDialogueTurnCount: number;
  fallbackTurnCount: number;
  latestTurnIndex: number;
  latestActorId: string | null;
  latestTurnId: string | null;
  latestCue: string | null;
  latestEmotion: HumanoidExpressionEmotion | null;
  latestRoleAnimationClipName: string | null;
  latestTurnSource: ActorDialogueTurn["source"] | null;
  latestTriggerSource: ActorDialoguePlaybackTriggerSource;
  latestTraceTag: string | null;
  latestSequenceId: string | null;
  latestSequenceSource: ActorDialogueSequenceSource | null;
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
  notEvidenceFor: [
    "scene_placement_readiness",
    "learner_launch_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};

export type ActorDialogueHumanoidSlot = GeneratedHumanoidAnimationSlot;

export type ActorDialogueDeps = {
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
};

export type ActorDialoguePlaybackDeps = Pick<
  ActorDialogueDeps,
  | "isPediatricAsthmaRuntimeScenario"
  | "selectedHumanoidSourceComparator"
  | "recordBootPhase"
  | "nowMs"
  | "scheduleTimeout"
  | "scheduleInterval"
  | "setDialogueLineText"
  | "speechEvidence"
  | "writeSpeechEvidence"
  | "ensureMissingActorSpeechEvidence"
  | "writeAdaptiveEvidence"
> & {
  encounterBundle: () => LearnerRuntimeAssetBundle;
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
  playbackScheduled: () => boolean;
  playbackLastTraceAtMs: () => number;
  playbackSequenceActiveUntilMs: () => number;
  notePlaybackScheduled: () => void;
  noteTracePlayback: (traceTag: string, turnCount: number) => void;
};

export type ActorDialogueSpeechDeps = Pick<
  ActorDialogueDeps,
  | "encounterBundle"
  | "selectedScenarioId"
  | "recordBootPhase"
  | "nowMs"
  | "runtimePatientActorId"
  | "runtimeClinicalTeamActorId"
  | "runtimeFamilyActorId"
  | "actorIdForTraceTag"
  | "writeSpeechEvidence"
  | "ensureMissingActorSpeechEvidence"
> & {
  runtimeTurnForTraceTag: (tag: string) => EncounterRuntimeDialogueTurn | undefined;
  liveTurnForTrace: (tag: string) => LiveActorTurnConsumption | undefined;
  animationSlotForActor: (actorId: string) => ActorDialogueHumanoidSlot | undefined;
  playFrozenTurn: (
    plan: LiveActorTurnConsumption["plan"],
    execution: LiveActorTurnConsumption["execution"],
    gazeTarget: HumanoidDialogueGazeTarget,
    requirement: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
  ) => ActorTurnPlayback;
  virtualDeviceSpeechByActorId: () => Map<string, HumanoidSpeechPlayback>;
  runtimeEmbodimentForActor: (actorId: string) => LearnerRuntimeAssetBundle["actors"][number]["embodiment"] | undefined;
  reviewCaptureMode: () => boolean;
};
