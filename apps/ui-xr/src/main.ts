import {
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS,
  type EncounterRuntimeAsset,
  type EncounterRuntimeRoomProp,
  evaluateEncounterRuntimeLearnerUseGate,
  findRuntimeActorAsset,
  findRuntimeEquipmentAsset,
  type LearnerRuntimeAssetBundle,
  type PedsHumanoidMaterializationHandoff,
  resolveRuntimeAssetUrl,
} from "@openclinxr/asset-registry/runtime-bundles";
import {
  resolveHumanoidVariantOrCastPath,
  resolveLocalHumanoidRuntimeAssetUrl,
} from "./humanoid-runtime-asset-url.js";
import {
  assignRuntimeActorSlots,
  type RuntimeSlotAssignment,
} from "./runtime-actor-slots.js";
import {
  additionalCastPlacementFallback,
  ensureAndPublishActorPlacementSsot,
} from "./runtime-actor-placements.js";
import {
  arbitrateTurnTaking,
  buildHistoryTakingCoverageSpec,
  initialHistoryTakingCoverageState,
  updateHistoryTakingCoverage,
  type HistoryTakingCoverageState,
} from "@openclinxr/conversation-policy";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { scenarioBank, responseClipForBodyRegion } from "@openclinxr/scenario-fixtures/scenario-bank";
import { isPedsAsthmaScenario, learnerVisiblePedsDialogueForTraceTag } from "./peds-authored-turn-surface.js";
import {
  bootLearnerExamFormFromApi,
  createLearnerExamFormRunState,
} from "./learner-exam-form-boot.js";
import { scenariosFromFixtureSequence } from "./learner-exam-scenario-source.js";
import { buildStationEnvironment } from "./station-environment.js";
import {
  collectActorWorldBoxes,
  deriveInteriorPreviewCamera,
  loadInfinigenEnvironmentIntoStation,
} from "./infinigen-station-environment.js";
import { roomPropColourNumbers } from "./room-prop-materials.js";
import { buildRoomPropGroup } from "./room-prop-geometry.js";
import {
  roomPropSuppressedByFixtureOwnership,
  stampSuppressedDeclaredEquipmentOntoFixtures,
} from "./fixture-role-ownership.js";
import { prepareLoadedEnvironmentShell } from "./station-stretcher.js";
import {
  buildDeclaredEquipmentGeometry,
  buildGltfEquipmentPlaceholderSlot,
  collectDeclaredEquipmentEvidenceFromScene,
  countEquipmentGeometry,
  normalizeGltfEquipmentMount,
  planStationEquipmentMounts,
  REAL_EQUIPMENT_GLTF_BY_ID,
  stampRoomPropAliasesOnEquipmentRoot,
} from "./station-equipment.js";
import {
  describeRuntimeBundleScenarioMatch,
  resolveEffectiveVerticalOffsetMeters,
} from "./actor-floor-composition.js";
import { enableCaptureRendererShadowMap, isCaptureShadowPath, markActorCastShadow, markFloorReceiveShadow } from "./capture-shadow-map.js";
import { applyStationInteriorLighting, resolveStationInteriorLightingVariantId } from "./station-interior-lighting.js";
import {
  addGeneratedHumanoidRoleContinuityWardrobeCue,
  applyCleanEncounterVisualReviewActorFraming as applyEncounterActorFraming,
} from "./encounter-actor-framing.js";
import { generatedDriveScalar, type GeneratedDriveScalarValue } from "./generated-drive-scalar.js";
import { phonemesForText, visemesForText } from "./dialogue-visemes.js";
import { generatedHumanoidSourceProvenance } from "./generated-humanoid-source-provenance.js";
import {
  resolveLocalEnvironmentRuntimeAssetFileName,
  resolveLocalEquipmentRuntimeAssetFileName,
} from "./runtime-local-asset-filenames.js";
import { createPrimitiveActorMesh } from "./primitive-actor-mesh.js";
import { applyPosturePose, plantSeatedPelvisOnSeat } from "./seated-pose.js";
import { applySupinePose } from "./supine-pose.js";
import {
  applyAndPlantSupineOnDeck, applySupinePoseHoldingIncline, holdSupinePlantFrame, reapplySupineHeadToStoredPillow,
} from "./supine-deck-plant.js";
import {
  applyGeneratedHumanoidClinicalIdlePosture,
  applyHumanoidJointRotationsByAlias,
} from "./clinical-idle-posture.js";
import { animatedTranslationBoneNames, seatedRoleClipIsPlayable } from "./seated-role-clip-policy.js";
import { PATIENT_CHAIR_SEAT_HEIGHT_METERS } from "./station-chair.js";
import { findProceduralStretcherInSceneOf, STRETCHER_DECK_TOP_METERS } from "./station-stretcher.js";
import { createVirtualDeviceActorAffordance as buildVirtualDeviceActorAffordance } from "./virtual-device-actor.js";
import { initialDialogueTextForScenario } from "./initial-dialogue-text.js";
import { initSpeakFixtureBridge } from "./speak-fixture-bridge.js";
import {
  formatActiveActorRealismRequirementLines,
  formatHumanoidSpeechAffectEvidence,
} from "./speech-hud-formatting.js";
import {
  consumeLiveActorTurn,
  expressionWeightsForEmotion,
  liveActorTurnFromPayload,
  registerLiveActorTurn,
  resolveLiveActorTurnForTrace,
  type LiveActorTurnConsumption,
} from "./actor-turn-plan-consumption.js";
import { stationContextForScenario } from "./station-context.js";
import {
  resolveActorPosture,
  resolveEnvironmentShellDescriptor,
  seatedActorWorldPosition,
  seatedVerticalOffsetForSeatHeight,
  supineActorWorldPosition,
  supineVerticalOffsetSeed,
  type ActorPosture,
} from "@openclinxr/asset-registry";
// #196 pattern: subpath avoids growing the frozen asset-registry barrel (index.ts freeze 2843).
import {
  FAMILY_CHAIR,
  resolveFixtureSlotPosition,
} from "@openclinxr/asset-registry/environment-zone-templates";
import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LoadingManager,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { createStationApiClient, createStationApiPersistenceSink, type StationApiClient } from "./api-client.js";
import { assertHumanoidRootUpright } from "./humanoid-load-guard.js";
import { applyRealGarmentEvidenceSurfaces, sleeveDeformCueForAssetPath } from "./real-garment-evidence-surfaces.js";
import { computeMeshBounds, frameCamera } from "./camera-fit-to-bounds.js";
import {
  resolvePedsAdaptiveDialogueBranch,
  type PedsAdaptiveDialogueBranchResolution,
} from "./peds-adaptive-dialogue-policy.js";
import { applyGeneratedScalarVisemeToRoot, applyNamedSpeechVisemes, attachBakedCuesToSpeech, loadBakedMouthCuesForUtterance, resolveMorphIndex, type PhonemeCue } from "./viseme-runtime-wire.js";
import { collectResolvedMorphTargets, MOUTH_OPEN_CAP } from "./viseme-morph-apply.js";
import { applyBlinkClosureToRoot } from "./blink-runtime-wire.js";
import { applyGazeToHumanoid } from "./gaze-drives-eyes.js";
import {
  actorIdForTraceTag,
  actorResponseTextFromApiResult,
  advanceExamFormRunStation,
  buildManualPerformanceCaptureSummary,
  buildManualPerformanceDraft,
  buildManualPerformanceEvidencePayload,
  buildManualPerformanceInputEvidence,
  buildManualPerformanceReproducibility,
  buildReadableVrTextPanelEvidence,
  buildRuntimeEvidencePosture,
  buildRuntimeFrameStats,
  buildXrRuntimeReadinessDecision,
  buildConversationTurnStateEvidence,
  buildXrTraceActionHandoffEvidence,
  buildXrTraceInteractionEvidenceSummary,
  type ActorPlayerRuntimeMetadataSummary,
  type ConversationTurnStateEvidence,
  type CaseDefinedHumanoidPerformanceContractEvidence,
  type CaseDefinedHumanoidRuntimeHandoffEvidence,
  completeTraceAction,
  createInitialRuntimeState,
  createRuntimeStateFromBundle,
  currentExamFormRunStation,
  type ExamFormRunState,
  type EnvironmentStateEvidence,
  type ExamineeLocomotionEvidence,
  eventTypeForTraceTag,
  examFormRunScenarioSequence,
  formatExamFormRunClock,
  formatManualEvidenceCopyStatus,
  formatStationClock,
  type HumanoidSpeechEvidence,
  handGestureLocomotionOriginMeters,
  handGestureRelativeOffsetMeters,
  isImmersiveFrameEvidenceActive,
  iwsdkStationSceneObjectNames,
  iwsdkStationSceneObjects,
  type LearnerRuntimeUseGateEvidence,
  type LocomotionAttemptDiagnosticsEvidence,
  type LocomotionVectorEvidence,
  localHandMeshPath,
  type ManualEvidenceCopyDisposition,
  type ManualPerformanceCaptureSummary,
  type ManualPerformanceDraft,
  type ManualPerformanceFrameStats,
  type ManualPerformanceInputEvidence,
  type ManualPerformanceReproducibilityEvidence,
  type ManualPerformanceTraceLatencyEvidence,
  mapHandGestureLocomotionVector,
  meshHandModelProfile,
  meshHandRepresentationKind,
  nextExamFormRunStation,
  persistExamFormRunQueueSnapshot,
  primitiveHandModelProfile,
  primitiveHandRepresentationKind,
  type ReadableVrTextPanelEvidence,
  type ReadableVrTextPanelEvidenceSet,
  type RigPoseEvidence,
  type RuntimeMaterializationEvidenceAttachmentSummary,
  type RuntimeRemainingRuntimeBlockerReasons,
  type RuntimeEvidencePosture,
  type RuntimeInteractionEvidence,
  type RuntimeSceneManifestEvidence,
  readRuntimeActorEquipmentMaterializationGate,
  remoteActorTurnForTraceTag,
  type SceneAssetEvidence,
  summarizeTraceReadiness,
  tickExamFormRunClock,
  type XrExperienceModeEvidence,
  type XrHandGestureStateEvidence,
  type XrHandSelectStateEvidence,
  type XrInputSourceEvidence,
  type XrRuntimeReadinessDecision,
  type XrRuntimeState,
  type XrTraceActionHandoffAction,
  type XrTraceActionHandoffEvidence,
  type XrTraceInteractionEvidenceSummary,
  xrExperienceModeEvidence,
} from "./runtime-state.js";
import "./styles.css";

// Physics clinical-touch realbind R3 (AD-3): precomputed bone transforms — see physics-touch/.
// PRE-PRODUCTION FENCE: opt-in capture only; default session path does not apply.
import { applyPhysicsBoneTransforms as applyPhysicsBoneTransformsImpl } from "./physics-touch/apply-physics-bone-transforms.js";

/** Pre-production fence: physics bone apply is opt-in capture only. Default session path does NOT apply physics transforms. */
export const UI_XR_PHYSICS_TOUCH_RUNTIME_PROMOTION_ALLOWED = false;

type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: "immersive-vr" | "immersive-ar"): Promise<boolean>;
    requestSession(
      mode: "immersive-vr",
      options?: { optionalFeatures?: string[] },
    ): Promise<XrSession>;
  };
};

type XrSession = {
  inputSources?: Iterable<XrInputSourceWithGamepad>;
  addEventListener(type: "end", listener: () => void, options?: { once?: boolean }): void;
  end(): Promise<void>;
};

type RuntimeWebXrSupportEvidence = ManualPerformanceReproducibilityEvidence["webXr"];
let latestRuntimeInteractionEvidence: RuntimeInteractionEvidence | null = null;

type DynamicSceneObjectNamingEvidence = {
  source: "window.__openClinXrDynamicSceneObjectNamingEvidence";
  scenarioId: string;
  selectedScenarioId: string;
  selectedScenarioMatchesBundle: boolean;
  totalNamedObjects: number;
  scenarioPrefixedObjectCount: number;
  stableIwsdkLegacyObjectNameCount: number;
  stableIwsdkLegacyObjectNames: string[];
  hardcodedEdPrefixLeakCount: number;
  hardcodedEdPrefixLeakNames: string[];
  sampleScenarioPrefixedObjectNames: string[];
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness">;
};

type RoleDistinctHumanoidCueEvidence = {
  source: "window.__openClinXrRoleDistinctHumanoidCueEvidence";
  scenarioId: string;
  cueCount: number;
  cues: Array<{
    actorId: string;
    role: string | null;
    cueId: string;
    sceneObjectName: string;
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "animation_quality">;
};

type PediatricRespiratoryEquipmentCueEvidence = {
  source: "window.__openClinXrPediatricRespiratoryEquipmentCueEvidence";
  scenarioId: string;
  cueCount: number;
  cues: Array<{
    equipmentId: string;
    cueId: string;
    sceneObjectName: string;
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "equipment_asset_readiness">;
};

/** #140 — live declared-equipment mount evidence for inspectors / captures. */
type DeclaredEquipmentMountEvidence = {
  source: "window.__openClinXrDeclaredEquipmentMountEvidence";
  scenarioId: string;
  items: Array<{
    equipmentId: string;
    source: "gltf" | "parametric" | "fallback" | "none";
    triangleCount: number;
    meshCount: number;
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "equipment_asset_readiness">;
};

type RuntimeHumanoidActingCueEvidence = {
  source: "window.__openClinXrRuntimeHumanoidActingCueEvidence";
  scenarioId: string;
  actorCount: number;
  activeCueIds: string[];
  actorCues: Array<{
    actorId: string;
    role: string | null;
    cueIds: string[];
    respiratoryRateCueHz?: number | undefined;
    gazeAlternationTargetActorId?: string | null | undefined;
    bodyMotionMode: "procedural_idle_body_motion" | "scenario_dialogue_body_motion_runtime" | "scenario_pediatric_respiratory_distress_idle_overlay" | "source_comparator_runtime_pose_updates_disabled";
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "animation_quality">;
};

type GeneratedRuntimeDrive = {
  locomotion?: boolean | number | string | GeneratedDriveScalarValue | null;
  gaze?: boolean | number | string | GeneratedDriveScalarValue | null;
  gazeAversion?: boolean | number | string | GeneratedDriveScalarValue | null;
  lipSync?: boolean | number | string | GeneratedDriveScalarValue | null;
  lipSyncViseme?: boolean | number | string | GeneratedDriveScalarValue | null;
};

type PortalTransitionEvidence = {
  source: "window.__openClinXrPortalTransitionEvidence";
  scenarioId: string;
  portalThresholdZ: number;
  headWorldZ: number;
  locomotionRigZ: number;
  desktopPreviewCameraOffsetZ: number;
  transitionProbeZ: number;
  side: "exterior_note_room" | "portal_threshold" | "dynamic_encounter_world";
  encounterEntered: boolean;
  encounterStartedByPortal: boolean;
  deterministicPreviewStart: "exterior_note_room" | "portal_threshold" | "dynamic_encounter_world" | null;
  reusableExteriorHiddenForEncounterView: boolean;
  portalInteriorHiddenObjectNames: string[];
  noteCaptureLocation: "reusable_exterior_anteroom";
  lastTransitionReason: string | null;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "motion_comfort_validation">;
};

type XrInputSourceWithGamepad = {
  handedness?: "left" | "right" | "none" | string;
  hand?: unknown;
  gamepad?: {
    axes?: readonly number[];
  };
};

type XrHandJointGroup = Group & {
  jointRadius?: number;
};

type XrHandGroup = Group & {
  joints?: Record<string, XrHandJointGroup | undefined>;
  userData: {
    openClinXrHandedness?: string;
  };
};

type OpenClinXrFrameStats = ManualPerformanceFrameStats;

type OpenClinXrInputEvidence = ManualPerformanceInputEvidence;

type OpenClinXrBootEvidence = {
  app: "ui-xr";
  events: Array<{
    phase: string;
    atMs: number;
    error?: string;
  }>;
};

type OpenClinXrTraceLatencyEvidence = ManualPerformanceTraceLatencyEvidence;

type XrHeadsetSelectSource = Extract<OpenClinXrTraceLatencyEvidence["source"], "xr_controller_select" | "xr_hand_select">;

type XrSelectControllerEvent = {
  data?: XrInputSourceWithGamepad;
};

type OpenClinXrXrEntryEvidence = {
  sessionMode: "immersive-vr";
  attempts: number;
  lastStatus: "not_requested" | "requesting" | "started" | "ended" | "failed";
  lastRequestedAtMs: number | null;
  lastUpdatedAtMs: number;
  lastError: string | null;
};

type ExamFlowPhase = "encounter" | "note" | "complete";

type OpenClinXrExamFlowEvidence = {
  source: "local_exam_flow_runtime";
  examRunId: string;
  scenarioId: string;
  scenarioIndex: number;
  totalScenarios: number;
  nextScenarioId: string | null;
  phase: ExamFlowPhase;
  encounterDurationSeconds: number;
  noteDurationSeconds: number;
  encounterElapsedSeconds: number;
  noteElapsedSeconds: number;
  encounterRemainingSeconds: number;
  noteRemainingSeconds: number;
  noteTextLength: number;
  noteSubmitted: boolean;
  noteTimeoutElapsed: boolean;
  canAdvanceToNextEncounter: boolean;
  autoAdvanceOnNoteTimeout: boolean;
  lastAdvanceReason: string | null;
  acceleratedByQuery: boolean;
};

type ExamRunStationOutcome = {
  scenarioId: string;
  scenarioIndex: number;
  phase: ExamFlowPhase;
  noteTextLength: number;
  noteSubmitted: boolean;
  lastAdvanceReason: string | null;
  recordedAtIso: string;
  /** Additive multi-station form fields (optional for backward-compatible localStorage). */
  stationOrder?: number;
  slotId?: string;
  startedAtFormSecond?: number;
  endedAtFormSecond?: number | null;
};

type OpenClinXrExamRunSummaryEvidence = {
  source: "local_exam_run_summary";
  examRunId: string;
  totalScenarios: number;
  stationOutcomes: ExamRunStationOutcome[];
  formElapsedSecond?: number;
  formRemainingSecond?: number;
  examFormRunStatus?: ExamFormRunState["status"];
  examEquivalenceGate?: false;
  notEvidenceFor?: readonly string[];
};

type OpenClinXrExamFormRunEvidence = {
  source: "exam_assembly_form_run";
  examRunId: string;
  examFormId: string;
  blueprintId: string;
  status: ExamFormRunState["status"];
  currentStationOrder: number | null;
  currentScenarioId: string | null;
  nextScenarioId: string | null;
  scenarioSequence: string[];
  formElapsedSecond: number;
  formRemainingSecond: number;
  totalStationTimeSeconds: number;
  formClockDisplay: ReturnType<typeof formatExamFormRunClock>;
  stationOutcomeCount: number;
  canStartLearnerExam: boolean;
  examEquivalenceGate: false;
  claimBoundary: ExamFormRunState["claimBoundary"];
  notEvidenceFor: ExamFormRunState["notEvidenceFor"];
};

type StationSceneRuntime = {
  startImmersiveSession(): Promise<void>;
};

type ActiveRuntimeAssetBundleSource = LearnerRuntimeUseGateEvidence["activeBundleSource"];

type ReadableVrTextPanel = {
  mesh: Mesh;
  update(lines: readonly string[]): void;
};

declare global {
  interface Window {
    __openClinXrFrameStats?: OpenClinXrFrameStats;
    __openClinXrManualPerformanceDraft?: ManualPerformanceDraft;
    __openClinXrManualPerformanceCaptureSummary?: ManualPerformanceCaptureSummary;
    __openClinXrExperienceModeEvidence?: XrExperienceModeEvidence;
    __openClinXrInputEvidence?: OpenClinXrInputEvidence;
    __openClinXrExamineeLocomotionEvidence?: ExamineeLocomotionEvidence;
    __openClinXrBootEvidence?: OpenClinXrBootEvidence;
    __openClinXrTraceLatencyEvidence?: OpenClinXrTraceLatencyEvidence;
    __openClinXrXrEntryEvidence?: OpenClinXrXrEntryEvidence;
    __openClinXrTextPanelEvidence?: ReadableVrTextPanelEvidenceSet;
    __openClinXrRuntimeEvidencePosture?: RuntimeEvidencePosture;
    __openClinXrRuntimeReadinessDecision?: XrRuntimeReadinessDecision;
    __openClinXrTraceActionHandoffEvidence?: XrTraceActionHandoffEvidence;
    __openClinXrTraceInteractionEvidenceSummary?: XrTraceInteractionEvidenceSummary;
    __openClinXrSceneAssetEvidence?: SceneAssetEvidence;
    /** #315: model assetId of the actor a comparator capture framed (recorded intent). */
    __openClinXrComparatorCameraTargetActorId?: string;
    /** #315 follow-up: framing measurement — NDC of the framed subject + per-slot visibility/NDC. */
    __openClinXrComparatorFramingDump?: {
      comparator: string;
      namedActorId: string;
      boundsMin: { x: number; y: number; z: number };
      boundsMax: { x: number; y: number; z: number };
      boundsCenter: { x: number; y: number; z: number };
      camPositionLocal: { x: number; y: number; z: number };
      camWorldPosition: { x: number; y: number; z: number };
      camParentName: string | null;
      camParentMatrixWorld: number[] | null;
      frameSpanFraction: number | null;
      ndcBoundsCenter: { x: number; y: number; z: number };
      namedActorSlotVisible: boolean | null;
      slots: Array<{
        slotKind: string;
        actorId: string;
        visible: boolean;
        worldCenter: { x: number; y: number; z: number };
        ndc: { x: number; y: number; z: number };
      }>;
    };
    __openClinXrEnvironmentStateEvidence?: EnvironmentStateEvidence;
    __openClinXrHumanoidSpeechEvidence?: HumanoidSpeechEvidence;
    __openClinXrLiveActorTurnConsumption?: LiveActorTurnConsumption;
    __openClinXrCaseDefinedHumanoidPerformanceContractEvidence?: CaseDefinedHumanoidPerformanceContractEvidence;
    __openClinXrActorPlayerRuntimeMetadataSummary: ActorPlayerRuntimeMetadataSummary | undefined;
    __openClinXrPedsActorPlayerRuntimePlaybackEvidence?: PedsActorPlayerRuntimePlaybackEvidence;
    __openClinXrPedsAdaptiveDialogueEvidence?: PedsAdaptiveDialogueEvidence;
    __openClinXrConversationTurnStateEvidence?: ConversationTurnStateEvidence;
    __openClinXrMouthGazePoseComparatorEvidence?: MouthGazePoseComparatorEvidence;
    __openClinXrDebugScene?: Scene;
    __openClinXrSelectedRuntimeAssetBundleId?: string;
    __openClinXrRuntimeSceneManifestEvidence?: RuntimeSceneManifestEvidence;
    __openClinXrRuntimeBundleScenarioMatch?: { source: "window.__openClinXrRuntimeBundleScenarioMatch"; selectedScenarioId: string; bundleScenarioId: string; matches: boolean; reason?: string };
    /** #122 — machine-readable residual for declared humanoids not staged in a slot. */
    __openClinXrActorSlotAssignment?: {
      source: "window.__openClinXrActorSlotAssignment";
      scenarioId: string;
      declaredHumanoidActorIds: string[];
      stagedActorIds: string[];
      notStagedActorIds: { actorId: string; reason: string }[];
      maxVisibleSlots: number;
    };
    __openClinXrLearnerRuntimeUseGateEvidence?: LearnerRuntimeUseGateEvidence;
    __openClinXrLastStationSceneBootErrorStack?: string;
    __openClinXrExamFlowEvidence?: OpenClinXrExamFlowEvidence;
    __openClinXrExamRunSummaryEvidence?: OpenClinXrExamRunSummaryEvidence;
    __openClinXrExamFormRunEvidence?: OpenClinXrExamFormRunEvidence;
    __openClinXrDynamicSceneObjectNamingEvidence?: DynamicSceneObjectNamingEvidence;
    __openClinXrRoleDistinctHumanoidCueEvidence?: RoleDistinctHumanoidCueEvidence;
     __openClinXrPediatricRespiratoryEquipmentCueEvidence?: PediatricRespiratoryEquipmentCueEvidence;
    __openClinXrDeclaredEquipmentMountEvidence?: DeclaredEquipmentMountEvidence;
     __openClinXrRuntimeHumanoidActingCueEvidence?: RuntimeHumanoidActingCueEvidence;
      __openClinXrPedsDrive?: GeneratedRuntimeDrive;
      __openClinXrPortalTransitionEvidence?: PortalTransitionEvidence;
   }
 }

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

const defaultStaticGeneratedLearnerRuntimeAssetBundleScenarioId = "ed_chest_pain_priority_v1";

window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence = buildCaseDefinedHumanoidPerformanceContractEvidence();
window.__openClinXrActorPlayerRuntimeMetadataSummary = buildActorPlayerRuntimeMetadataSummary();

function buildCaseDefinedHumanoidPerformanceContractEvidence(
  scenarioId = selectedScenarioId(),
): CaseDefinedHumanoidPerformanceContractEvidence {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId) ?? edChestPainScenario;
  const actors = scenario.actors.filter((actor) => actor.role !== "system");
  const actorRoles = Array.from(new Set(actors.map((actor) => actor.role))).sort();
  const emotionStates = Array.from(new Set(actors.flatMap((actor) => actor.communicationProfile?.baselineMood ?? [])));
  const dialogueDrivenVisemeMappingRequired = scenario.requiredTraceTags.length > 0;

  return {
    source: "case_definition_humanoid_performance_contract",
    scenarioId: scenario.scenarioId,
    claimBoundary: "case_definition_humanoid_performance_metadata_only",
    actorCount: actors.length,
    locomotionActorRoles: actorRoles,
    expressionActorRoles: actorRoles,
    gazeActorRoles: actorRoles,
    lipSyncActorRoles: dialogueDrivenVisemeMappingRequired ? actorRoles : [],
    interactiveActorRoles: actorRoles,
    emotionStateCount: emotionStates.length,
    dialogueDrivenVisemeMappingRequired,
    gazeTargetingRequired: actors.length > 1,
    locomotionPlanningRequired: scenario.eventSchedule.length > 0,
    notEvidenceFor: [
      "generated_humanoid_asset_readiness",
      "animation_quality",
      "quest_readiness",
      "runtime_readiness",
      "clinical_validity",
    ],
  };
}

function buildActorPlayerRuntimeMetadataSummary(
  scenarioId = selectedScenarioId(),
): ActorPlayerRuntimeMetadataSummary | undefined {
  if (scenarioId !== "peds_asthma_parent_anxiety_v1") {
    return undefined;
  }
  const blockerIds = [
    "local_multi_actor_preview_not_scene_placement_evidence",
    "learner_runtime_not_enabled",
    "quest_runtime_not_verified",
  ];
  return {
    source: "model_vetting_actor_player_runtime_evidence",
    sourceArtifactPath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
    executionMode: "local_deterministic_non_scene",
    actorCount: 3,
    projectedTurnCount: 9,
    projectedSampleCount: 27,
    actorSummaries: [
      {
        actorId: "patient_maya_johnson_v1",
        turnCount: 4,
        sampleCount: 12,
        roleAnimationClipNames: ["openclinxr_role_patient_asthma_breathing_effort"],
        sceneExecutionStatus: "not_scene_executed",
        blockerIds,
      },
      {
        actorId: "parent_tara_johnson_v1",
        turnCount: 2,
        sampleCount: 6,
        roleAnimationClipNames: ["openclinxr_retarget_seated_talking_cc0", "openclinxr_role_parent_anxious_fidget_guard"],
        sceneExecutionStatus: "not_scene_executed",
        blockerIds,
      },
      {
        actorId: "nurse_kevin_lee_v1",
        turnCount: 3,
        sampleCount: 9,
        roleAnimationClipNames: ["openclinxr_role_nurse_clinical_check_reassure"],
        sceneExecutionStatus: "not_scene_executed",
        blockerIds,
      },
    ],
    providerExecutionPerformed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    scenePlacementEvidenceAllowed: false,
    claimBoundary: "ui_xr_actor_player_metadata_only_not_runtime_execution",
    notEvidenceFor: [
      "real_anny_model_output",
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
    ],
  };
}

function requireElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Missing station runtime element: ${selector}`);
  }
  return element;
}

const bootStartedAtMs = performance.now();

function recordBootPhase(phase: string, error?: unknown): void {
  const current: OpenClinXrBootEvidence = window.__openClinXrBootEvidence ?? { app: "ui-xr", events: [] };
  const nextEvent = {
    phase,
    atMs: Number((performance.now() - bootStartedAtMs).toFixed(2)),
    ...(error === undefined ? {} : { error: formatUnknownError(error) }),
  };
  window.__openClinXrBootEvidence = {
    ...current,
    events: [...current.events, nextEvent].slice(-30),
  };
}

const sceneAssetStatusRecords = new Map<string, SceneAssetEvidence["assets"][number]>();
const runtimeEquipmentSlotsByAssetId = new Map<string, Group>();
/** #315: camera + scene root the comparator capture frames through (assigned in createStationScene). */
let comparatorCaptureCamera: PerspectiveCamera | null = null;
let comparatorCaptureSceneRoot: Object3D | null = null;
let encounterRuntimeAssetBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
let patientRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAsset(encounterRuntimeAssetBundle, "patient_robert_hayes_v1")?.model,
  "patient_robert_hayes_v1",
);
let nurseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAsset(encounterRuntimeAssetBundle, "nurse_maria_alvarez_v1")?.model,
  "nurse_maria_alvarez_v1",
);
let spouseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAsset(encounterRuntimeAssetBundle, "spouse_anna_hayes_v1")?.model,
  "spouse_anna_hayes_v1",
);
let additionalRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAsset(encounterRuntimeAssetBundle, "nurse_maria_alvarez_v1")?.model
    ?? findRuntimeActorAsset(encounterRuntimeAssetBundle, "patient_robert_hayes_v1")?.model,
  "additional_cast_actor",
);
let cachedRuntimeSlotAssignment: RuntimeSlotAssignment | null = null;

function useEncounterRuntimeAssetBundle(
  bundle: LearnerRuntimeAssetBundle,
  options: {
    source: ActiveRuntimeAssetBundleSource;
    fallbackReason?: string | null | undefined;
  } = { source: "local_fixture_fallback" },
): void {
  encounterRuntimeAssetBundle = bundle;
  cachedRuntimeSlotAssignment = null;
  window.__openClinXrSelectedRuntimeAssetBundleId = bundle.bundleId;
  window.__openClinXrRuntimeSceneManifestEvidence = buildRuntimeSceneManifestEvidence(bundle);
  recordLearnerRuntimeUseGateEvidence(bundle, options.source, options.fallbackReason ?? null);
  const slots = resolveRuntimeSlotAssignment(bundle);
  ensureAndPublishActorPlacementSsot(bundle, slots);
  const modelFor = (actorId: string) =>
    (actorId ? findRuntimeActorAsset(bundle, actorId)?.model : undefined)
    ?? bundle.actors.find((a) => a.embodiment !== "virtual_device" && a.embodiment !== "voice_only")?.model
    ?? bundle.actors[0]?.model;
  patientRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
    modelFor(slots.patientActorId),
    slots.patientActorId || "primary_patient_actor",
  );
  nurseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
    modelFor(slots.clinicalTeamActorId || slots.patientActorId),
    slots.clinicalTeamActorId || "clinical_team_actor",
  );
  spouseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
    modelFor(slots.familyActorId || slots.patientActorId),
    slots.familyActorId || "family_or_observer_actor",
  );
  additionalRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
    modelFor(slots.additionalActorId || slots.patientActorId),
    slots.additionalActorId || "additional_cast_actor",
  );
  publishRuntimeActorSlotAssignmentEvidence(bundle, slots);
}

function runtimeBundleMatchesSelectedScenario(bundle: LearnerRuntimeAssetBundle): boolean {
  return describeRuntimeBundleScenarioMatch({
    selectedScenarioId: selectedScenarioId(),
    bundleScenarioId: bundle.scenarioId,
  }).matches;
}

function mismatchedRuntimeBundleFallbackReason(
  bundle: LearnerRuntimeAssetBundle,
  source: ActiveRuntimeAssetBundleSource,
): string | null {
  const match = describeRuntimeBundleScenarioMatch({
    selectedScenarioId: selectedScenarioId(),
    bundleScenarioId: bundle.scenarioId,
  });
  if (match.matches) return null;
  // reason is always set on mismatch — surface it rather than silent composition (#72 / #57 layer).
  return `${source}_scenario_mismatch:${match.reason ?? `${selectedScenarioId()}!=${bundle.scenarioId}`}`;
}

function recordLearnerRuntimeUseGateEvidence(
  bundle: LearnerRuntimeAssetBundle,
  source: ActiveRuntimeAssetBundleSource,
  fallbackReason: string | null,
): LearnerRuntimeUseGateEvidence {
  const learnerUseGate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  const approvedLocalFixtureOnly = bundleUsesOnlyApprovedLocalFixtureAssets(bundle);
  const blockingGateIds = ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS
    .filter((gateId) => learnerUseGate.pendingGateIds.includes(gateId));
  const actorEquipmentMaterializationGate = readRuntimeActorEquipmentMaterializationGate(bundle);
  const evidence: LearnerRuntimeUseGateEvidence = {
    ...learnerUseGate,
    source: "window.__openClinXrLearnerRuntimeUseGateEvidence",
    bundleId: bundle.bundleId,
    scenarioId: bundle.scenarioId,
    assetStoreKind: bundle.assetStoreKind,
    activeBundleSource: source,
    generatedBundleLearnerUseBlocked: !approvedLocalFixtureOnly && !learnerUseGate.canUseGeneratedBundleForLearnerRuntime,
    fallbackActive: source === "local_fixture_fallback" || fallbackReason !== null,
    fallbackReason,
    requiredGateIds: [
      "runtime_realism_evidence",
      "visual_qa_evidence",
      "quest_runtime_evidence",
    ],
    blockingGateIds,
    approvedLocalFixtureOnly,
    actorEquipmentMaterializationGate,
    claimBoundary: "learner_scene_uses_local_fixture_until_runtime_visual_quest_gates_attach",
  };
  window.__openClinXrLearnerRuntimeUseGateEvidence = evidence;
  return evidence;
}

function shouldUseLearnerRuntimeAssetBundle(bundle: LearnerRuntimeAssetBundle): boolean {
  const learnerUseGate = evaluateEncounterRuntimeLearnerUseGate(bundle);
  return bundleUsesOnlyApprovedLocalFixtureAssets(bundle)
    || learnerUseGate.canUseGeneratedBundleForLearnerRuntime;
}

function bundleUsesOnlyApprovedLocalFixtureAssets(bundle: LearnerRuntimeAssetBundle): boolean {
  return runtimeBundleAssets(bundle).every((asset) =>
    asset.blob.storeKind === "app_public_fixture"
      && asset.reviewStatus !== "blocked"
      && (asset.reviewStatus === "fixture_approved_for_local_runtime" || asset.reviewStatus === "approved_for_local_runtime"),
  );
}

function runtimeBundleAssets(bundle: LearnerRuntimeAssetBundle): EncounterRuntimeAsset[] {
  return [
    bundle.environment,
    ...bundle.actors.map((actor) => actor.model),
    ...bundle.actors.flatMap((actor) => actor.animationClips),
    ...bundle.actors.map((actor) => actor.phonemeMap).filter((asset): asset is EncounterRuntimeAsset => Boolean(asset)),
    ...bundle.equipment.map((equipment) => equipment.model),
    ...bundle.uiSurfaces.flatMap((surface) => [surface.schema, surface.data].filter((asset): asset is EncounterRuntimeAsset => Boolean(asset))),
  ];
}

function runtimeActorEmbodiment(bundle: LearnerRuntimeAssetBundle, actorId: string): LearnerRuntimeAssetBundle["actors"][number]["embodiment"] | undefined {
  return bundle.actors.find((actor) => actor.actorId === actorId)?.embodiment;
}

function runtimeActorRole(actorId: string): string | undefined {
  return encounterRuntimeAssetBundle.actors.find((actor) => actor.actorId === actorId)?.role;
}

function isPediatricAsthmaRuntimeScenario(): boolean {
  return encounterRuntimeAssetBundle.scenarioId === "peds_asthma_parent_anxiety_v1";
}

function isSelectedScenarioRuntimeBundleMismatch(): boolean {
  return !describeRuntimeBundleScenarioMatch({
    selectedScenarioId: selectedScenarioId(),
    bundleScenarioId: encounterRuntimeAssetBundle.scenarioId,
  }).matches;
}

function reportRuntimeBundleScenarioMatch(): void {
  const selected = selectedScenarioId();
  const bundleScenarioId = encounterRuntimeAssetBundle.scenarioId;
  const match = describeRuntimeBundleScenarioMatch({ selectedScenarioId: selected, bundleScenarioId });
  window.__openClinXrRuntimeBundleScenarioMatch = {
    source: "window.__openClinXrRuntimeBundleScenarioMatch",
    selectedScenarioId: selected,
    bundleScenarioId,
    matches: match.matches,
    ...(match.reason ? { reason: match.reason } : {}),
  };
}

function resolveRuntimeSlotAssignment(
  bundle: LearnerRuntimeAssetBundle = encounterRuntimeAssetBundle,
): RuntimeSlotAssignment {
  if (cachedRuntimeSlotAssignment && bundle === encounterRuntimeAssetBundle) {
    return cachedRuntimeSlotAssignment;
  }
  const assignment = assignRuntimeActorSlots(
    bundle.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      embodiment: actor.embodiment,
    })),
  );
  if (bundle === encounterRuntimeAssetBundle) {
    cachedRuntimeSlotAssignment = assignment;
  }
  return assignment;
}

function publishRuntimeActorSlotAssignmentEvidence(
  bundle: LearnerRuntimeAssetBundle,
  slots: RuntimeSlotAssignment = resolveRuntimeSlotAssignment(bundle),
): void {
  const declaredHumanoidActorIds = bundle.actors
    .filter((actor) => {
      if (actor.embodiment === "virtual_device" || actor.embodiment === "voice_only") return false;
      if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
      return true;
    })
    .map((actor) => actor.actorId);
  const evidence = {
    source: "window.__openClinXrActorSlotAssignment" as const,
    scenarioId: bundle.scenarioId,
    declaredHumanoidActorIds,
    stagedActorIds: [...slots.stagedActorIds],
    notStagedActorIds: slots.notStagedActorIds.map((n) => ({ ...n })),
    maxVisibleSlots: 4,
  };
  window.__openClinXrActorSlotAssignment = evidence;
}

// #122 unique slot accessors — empty string means unfilled (never clone).
function runtimePatientActorId(): string {
  return resolveRuntimeSlotAssignment().patientActorId;
}
function runtimeClinicalTeamActorId(): string {
  return resolveRuntimeSlotAssignment().clinicalTeamActorId;
}
function runtimeFamilyActorId(): string {
  return resolveRuntimeSlotAssignment().familyActorId;
}
function runtimeAdditionalActorId(): string {
  return resolveRuntimeSlotAssignment().additionalActorId;
}

/**
 * #315 follow-up: the actor a clean comparator capture is named for — the one it must
 * FRAME and SHOW. `peds_anny_real_garment_parent` names the family actor, `..._nurse`
 * the clinical-team actor; every other comparator names the patient. The parent/nurse
 * slots were previously hidden wholesale for clean comparator capture, which is why the
 * fixed camera (aiming at the named actor) rendered the patient at the frame edge: the
 * named actor was invisible. Showing only the named subject makes the frame match the aim.
 */
function comparatorCaptureSubjectActorId(): string {
  const comparator = selectedHumanoidSourceComparator();
  if (comparator === "peds_anny_real_garment_parent") return runtimeFamilyActorId();
  if (comparator === "peds_anny_real_garment_nurse") return runtimeClinicalTeamActorId();
  return runtimePatientActorId();
}

function actorNameplateLabel(prefix: string, actorId: string): string {
  return `${prefix}: ${actorId.replace(/_v\d+$/u, "").replaceAll("_", " ")}`;
}

function hasVector3(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== "object") return false;
  const vector = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof vector.x === "number" && typeof vector.y === "number" && typeof vector.z === "number";
}

function runtimeActorPlacement(
  actorId: string,
  fallback: LearnerRuntimeAssetBundle["sceneManifest"]["actorPlacements"][string],
): LearnerRuntimeAssetBundle["sceneManifest"]["actorPlacements"][string] {
  const placement = encounterRuntimeAssetBundle.sceneManifest.actorPlacements?.[actorId];
  const slotKind = placement?.slotKind ?? fallback.slotKind;
  const posture = resolveActorPosture({
    declared: placement?.posture ?? fallback.posture,
    scenarioId: selectedScenarioId(),
    environmentId: resolveActiveEnvironmentId(),
    slotKind,
  });
  const seated = posture === "seated";
  const supine = posture === "supine";
  // #150: never seatedVerticalOffsetForSeatHeight for supine (hip-on-chair ≠ torso-on-deck).
  // #574: a seated FAMILY actor plants on the family_chair fixture slot, not the patient
  // chair anchor — resolve the same fraction-mapped world position the environment builder
  // used for the chair so she sits ON her authored seat. Unknown env → patient-chair
  // default (telehealth keeps its existing anchor).
  const familyChairWorldPosition = seated && slotKind === "family_or_observer"
    ? familyChairFixtureWorldPosition(resolveActiveEnvironmentId())
    : null;
  const verticalOffsetMeters = seated
    ? seatedVerticalOffsetForSeatHeight(PATIENT_CHAIR_SEAT_HEIGHT_METERS)
    : supine ? supineVerticalOffsetSeed()
      : (placement?.verticalOffsetMeters ?? fallback.verticalOffsetMeters);
  const position = hasVector3(placement?.position) ? placement.position : fallback.position;
  return {
    ...fallback, ...placement,
    position: seated
      ? (familyChairWorldPosition ?? seatedActorWorldPosition({}))
      : supine ? supineActorWorldPosition({}) : position,
    scale: hasVector3(placement?.scale) ? placement.scale : fallback.scale,
    verticalOffsetMeters,
    labelPrefix: placement?.labelPrefix ?? fallback.labelPrefix,
    posture,
  };
}

/**
 * #574: world XZ of the family/parent chair fixture for `environmentId`, resolved with
 * the same fraction mapping the environment builder uses (resolveFixtureSlotsForRoom),
 * so a seated family actor lands ON the authored seat instead of the patient-chair
 * default anchor. Returns null when the environment does not author family seating —
 * callers keep the seatedActorWorldPosition default.
 */
function familyChairFixtureWorldPosition(environmentId: string): { x: number; y: number; z: number } | null {
  const resolved = resolveEnvironmentShellDescriptor(environmentId);
  const familyChair = resolved.descriptor.fixtureSlots.find((slot) => slot.slotId === FAMILY_CHAIR.slotId);
  if (!familyChair) {
    return null;
  }
  return resolveFixtureSlotPosition(
    familyChair,
    {
      widthMeters: resolved.descriptor.roomWidthMeters,
      depthMeters: resolved.descriptor.roomDepthMeters,
      heightMeters: resolved.descriptor.roomHeightMeters,
    },
    {
      widthMeters: resolved.descriptor.roomWidthMeters,
      depthMeters: resolved.descriptor.roomDepthMeters,
      heightMeters: resolved.descriptor.roomHeightMeters,
    },
  );
}

function buildRuntimeSceneManifestEvidence(bundle: LearnerRuntimeAssetBundle): RuntimeSceneManifestEvidence {
  const sceneManifestWithHumanoidRuntimeHandoff = bundle.sceneManifest as unknown as {
    caseDefinedHumanoidRuntimeHandoff?: unknown[];
  };
  const rawCaseDefinedHumanoidRuntimeHandoff = Array.isArray(sceneManifestWithHumanoidRuntimeHandoff.caseDefinedHumanoidRuntimeHandoff)
    ? sceneManifestWithHumanoidRuntimeHandoff.caseDefinedHumanoidRuntimeHandoff
    : [];
  const humanoidRuntimeHandoffNotEvidenceFor: CaseDefinedHumanoidRuntimeHandoffEvidence["notEvidenceFor"] = [
    "generated_humanoid_asset_readiness",
    "animation_quality",
    "quest_readiness",
    "runtime_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
  const caseDefinedHumanoidRuntimeHandoff = rawCaseDefinedHumanoidRuntimeHandoff
    .filter((handoff): handoff is Record<string, unknown> => typeof handoff === "object" && handoff !== null)
    .map((handoff): CaseDefinedHumanoidRuntimeHandoffEvidence => ({
      claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only",
      actorRole: typeof handoff.actorRole === "string" ? handoff.actorRole : "unknown_actor_role",
      workOrderIds: Array.isArray(handoff.workOrderIds)
        ? handoff.workOrderIds.filter((workOrderId): workOrderId is string => typeof workOrderId === "string")
        : [],
      locomotionRequired: handoff.locomotionRequired === true,
      expressionRequired: handoff.expressionRequired === true,
      gazeRequired: handoff.gazeRequired === true,
      lipSyncRequired: handoff.lipSyncRequired === true,
      interactiveRequired: handoff.interactiveRequired === true,
      requiredSignalIds: Array.isArray(handoff.requiredSignalIds)
        ? handoff.requiredSignalIds.filter((signalId): signalId is string => typeof signalId === "string")
        : [],
      blockers: Array.isArray(handoff.blockers)
        ? handoff.blockers.filter((blocker): blocker is string => typeof blocker === "string")
        : [],
      notEvidenceFor: Array.isArray(handoff.notEvidenceFor)
        ? handoff.notEvidenceFor.filter((item): item is CaseDefinedHumanoidRuntimeHandoffEvidence["notEvidenceFor"][number] =>
          humanoidRuntimeHandoffNotEvidenceFor.includes(item as CaseDefinedHumanoidRuntimeHandoffEvidence["notEvidenceFor"][number])
        )
        : humanoidRuntimeHandoffNotEvidenceFor,
    }));
  return {
    source: "learner_runtime_asset_bundle_scene_manifest",
    manifestId: bundle.sceneManifest.manifestId,
    schemaVersion: bundle.sceneManifest.schemaVersion,
    selectedScenarioId: selectedScenarioId(),
    bundleScenarioId: bundle.scenarioId,
    selectedScenarioMatchesBundle: runtimeBundleMatchesSelectedScenario(bundle),
    stationId: bundle.stationId,
    stationContextTitle: bundle.sceneManifest.stationContext?.title ?? null,
    stationContextChiefConcern: bundle.sceneManifest.stationContext?.chiefConcern ?? null,
    actorRoster: bundle.actors.map((actor) => ({
      actorId: actor.actorId,
      role: actor.role,
      embodiment: actor.embodiment,
    })),
    equipmentIds: bundle.equipment.map((equipment) => equipment.equipmentId),
    dialogueTraceTags: (bundle.sceneManifest.dialogueTurns ?? []).map((turn) => turn.traceTag),
    roomPropCount: bundle.sceneManifest.roomProps.length,
    semanticRoomPropCount: bundle.sceneManifest.roomProps.filter((prop) => Boolean(prop.semanticRole && prop.evidenceCue)).length,
    actorPlacementCount: Object.keys(bundle.sceneManifest.actorPlacements ?? {}).length,
    equipmentPlacementCount: Object.keys(bundle.sceneManifest.equipmentPlacements ?? {}).length,
    dialogueTurnCount: bundle.sceneManifest.dialogueTurns?.length ?? 0,
    virtualDeviceActorCount: bundle.actors.filter((actor) => actor.embodiment === "virtual_device").length,
    virtualDeviceDialogueRoutedCount: (bundle.sceneManifest.dialogueTurns ?? []).filter((turn) => runtimeActorEmbodiment(bundle, turn.actorId) === "virtual_device").length,
    generatedBySceneManifestCount: bundle.sceneManifest.roomProps.filter((prop) => prop.generatedBy === "scene_manifest").length,
    propIds: bundle.sceneManifest.roomProps.map((prop) => prop.propId),
    caseDefinedHumanoidRuntimeHandoffCount: caseDefinedHumanoidRuntimeHandoff.length,
    caseDefinedHumanoidRuntimeHandoffActorRoles: Array.from(new Set(caseDefinedHumanoidRuntimeHandoff
      .map((handoff) => typeof handoff.actorRole === "string" ? handoff.actorRole : "")
      .filter((actorRole) => actorRole.length > 0))),
    caseDefinedHumanoidRuntimeHandoffRequiredSignalIds: Array.from(new Set(caseDefinedHumanoidRuntimeHandoff.flatMap((handoff) =>
      Array.isArray(handoff.requiredSignalIds)
        ? handoff.requiredSignalIds.filter((signalId): signalId is string => typeof signalId === "string")
        : []
    ))),
    caseDefinedHumanoidRuntimeHandoff,
    storageBackedBundle: bundle.assetStoreKind === "azurite_blob" || bundle.assetStoreKind === "azure_blob",
    productionReadinessClaimed: false,
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
}

function requireEncounterRuntimeAsset(asset: EncounterRuntimeAsset | undefined, assetId: string): EncounterRuntimeAsset {
  if (!asset) {
    throw new Error(`Missing encounter runtime asset ${assetId}`);
  }
  return asset;
}

async function initializeLearnerRuntimeAssetBundle(client: StationApiClient | undefined): Promise<void> {
  const bundleId = learnerRuntimeAssetBundleId();
  if (!client) {
    if (await initializeStaticGeneratedLearnerRuntimeAssetBundle()) {
      recordBootPhase("learner_runtime_asset_bundle_static_generated_loaded");
      return;
    }
    recordLearnerRuntimeUseGateEvidence(
      encounterRuntimeAssetBundle,
      "local_fixture_fallback",
      mismatchedRuntimeBundleFallbackReason(encounterRuntimeAssetBundle, "local_fixture_fallback"),
    );
    recordBootPhase("learner_runtime_asset_bundle_local_fallback");
    return;
  }
  try {
    const bundle = await client.getLearnerRuntimeAssetBundle(bundleId);
    if (bundle.identityScope !== "learner_runtime_opaque_bundle") {
      throw new Error("learner runtime asset bundle identity scope mismatch");
    }
    if (!shouldUseLearnerRuntimeAssetBundle(bundle)) {
      recordLearnerRuntimeUseGateEvidence(
        bundle,
        "api_bundle",
        `api_bundle_blocked:${bundle.bundleId}`,
      );
      recordBootPhase("learner_runtime_asset_bundle_api_generated_blocked_by_evidence_gates");
      return;
    }
    if (!runtimeBundleMatchesSelectedScenario(bundle)) {
      recordLearnerRuntimeUseGateEvidence(
        bundle,
        "api_bundle",
        mismatchedRuntimeBundleFallbackReason(bundle, "api_bundle"),
      );
      throw new Error(`api learner runtime asset bundle scenario mismatch: selected ${selectedScenarioId()} bundle ${bundle.scenarioId}`);
    }
    useEncounterRuntimeAssetBundle(bundle, { source: "api_bundle" });
    recordBootPhase("learner_runtime_asset_bundle_loaded");
  } catch (error) {
    const selectedScenarioBundle = await selectLearnerRuntimeAssetBundleByScenarioStation(client);
    if (selectedScenarioBundle) {
      try {
        const bundle = await client.getLearnerRuntimeAssetBundle(selectedScenarioBundle.bundleId);
        if (bundle.identityScope !== "learner_runtime_opaque_bundle") {
          throw new Error("learner runtime asset bundle identity scope mismatch");
        }
        if (shouldUseLearnerRuntimeAssetBundle(bundle)) {
          useEncounterRuntimeAssetBundle(bundle, { source: "api_bundle" });
          recordBootPhase("learner_runtime_asset_bundle_loaded_by_scenario_station", error);
          return;
        }
        recordLearnerRuntimeUseGateEvidence(
          bundle,
          "api_bundle",
          `api_scenario_station_bundle_blocked:${bundle.bundleId}`,
        );
        recordBootPhase("learner_runtime_asset_bundle_scenario_station_blocked_by_evidence_gates", error);
        return;
      } catch (scenarioBundleError) {
        recordBootPhase("learner_runtime_asset_bundle_scenario_station_lookup_failed", scenarioBundleError);
      }
    }
    if (await initializeStaticGeneratedLearnerRuntimeAssetBundle()) {
      recordBootPhase("learner_runtime_asset_bundle_static_generated_loaded_after_api_fallback", error);
      return;
    }
    recordLearnerRuntimeUseGateEvidence(
      encounterRuntimeAssetBundle,
      "local_fixture_fallback",
      mismatchedRuntimeBundleFallbackReason(encounterRuntimeAssetBundle, "local_fixture_fallback"),
    );
    recordBootPhase("learner_runtime_asset_bundle_fallback", error);
  }
}

async function selectLearnerRuntimeAssetBundleByScenarioStation(
  client: StationApiClient,
): Promise<{ bundleId: string } | null> {
  const scenarioId = selectedScenarioId();
  const stationId = selectedStationId();
  const selectedBundle = await client.findLearnerRuntimeAssetBundleByScenarioStation({ scenarioId, stationId });
  if (selectedBundle) {
    window.localStorage.setItem("openclinxr.runtimeAssetBundleId", selectedBundle.bundleId);
    window.__openClinXrSelectedRuntimeAssetBundleId = selectedBundle.bundleId;
  }
  return selectedBundle;
}

async function initializeStaticGeneratedLearnerRuntimeAssetBundle(): Promise<boolean> {
  try {
    const response = await fetch(staticGeneratedLearnerRuntimeAssetBundlePath(), { cache: "no-store" });
    if (!response.ok) {
      recordBootPhase("learner_runtime_asset_bundle_static_generated_unavailable", `${response.status}`);
      return false;
    }
    const bundle = await response.json() as LearnerRuntimeAssetBundle;
    if (bundle.identityScope !== "learner_runtime_opaque_bundle") {
      throw new Error("static learner runtime asset bundle identity scope mismatch");
    }
    if (!runtimeBundleMatchesSelectedScenario(bundle)) {
      recordLearnerRuntimeUseGateEvidence(
        bundle,
        "static_generated_bundle",
        mismatchedRuntimeBundleFallbackReason(bundle, "static_generated_bundle"),
      );
      recordBootPhase("learner_runtime_asset_bundle_static_generated_scenario_mismatch_suppressed");
      return false;
    }
    if (!shouldUseLearnerRuntimeAssetBundle(bundle)) {
      recordLearnerRuntimeUseGateEvidence(
        bundle,
        "static_generated_bundle",
        `static_generated_bundle_blocked:${bundle.bundleId}`,
      );
      if (shouldUseStaticGeneratedBundleForVisualReview(bundle)) {
        useEncounterRuntimeAssetBundle(bundle, {
          source: "static_generated_bundle",
          fallbackReason: `static_generated_visual_review_only_learner_use_blocked:${bundle.bundleId}`,
        });
        recordBootPhase("learner_runtime_asset_bundle_static_generated_loaded_for_visual_review_with_blocked_learner_use");
        return true;
      }
      recordBootPhase("learner_runtime_asset_bundle_static_generated_blocked_by_evidence_gates");
      return false;
    }
    useEncounterRuntimeAssetBundle(bundle, { source: "static_generated_bundle" });
    return true;
  } catch (error) {
    recordBootPhase("learner_runtime_asset_bundle_static_generated_failed", error);
    return false;
  }
}

function shouldUseStaticGeneratedBundleForVisualReview(bundle: LearnerRuntimeAssetBundle): boolean {
  return bundle.scenarioId === selectedScenarioId()
    && bundle.identityScope === "learner_runtime_opaque_bundle"
    && bundle.assetStoreKind !== "azure_blob";
}

function staticGeneratedLearnerRuntimeAssetBundlePath(): string {
  const scenarioId = selectedScenarioId();
  window.localStorage.setItem("openclinxr.scenarioId", scenarioId);
  return `/xr-assets/generated/${scenarioId}/learner-runtime-bundle.v1.json`;
}

function selectedScenarioId(): string {
  const params = new URLSearchParams(window.location.search);
  const queryScenarioId = params.get("scenarioId")?.trim()
    ?? params.get("openclinxrScenarioId")?.trim()
    ?? "";
  return queryScenarioId.length > 0
    ? queryScenarioId
    : window.localStorage.getItem("openclinxr.scenarioId")
    ?? defaultStaticGeneratedLearnerRuntimeAssetBundleScenarioId;
}

function selectedStationId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const selected = params.get("stationId")?.trim()
    ?? window.localStorage.getItem("openclinxr.stationId")?.trim()
    ?? null;
  if (selected) {
    window.localStorage.setItem("openclinxr.stationId", selected);
  }
  return selected;
}
function selectedCaptureMode(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("capture")?.trim()
    ?? params.get("openclinxrCaptureMode")?.trim()
    ?? "";
}

function isActorCloseRealismCaptureMode(): boolean {
  return selectedCaptureMode().includes("actor-close");
}

function isHumanoidFaceDetailCaptureMode(): boolean {
  const captureMode = selectedCaptureMode();
  return captureMode.includes("face-rig") || captureMode.includes("face-detail") || captureMode.includes("lip-eye");
}

function isGeneratedSceneOverviewCaptureMode(): boolean {
  const captureMode = selectedCaptureMode();
  return captureMode.includes("dynamic-only")
    || captureMode.includes("generated-scene")
    || captureMode.includes("scene-overview");
}

function isActorPoseReviewCaptureMode(): boolean {
  const captureMode = selectedCaptureMode();
  return captureMode.includes("actor-pose") || captureMode.includes("pose-review") || captureMode.includes("mouth-gaze-pose");
}

function isHumanoidMouthGazePoseReviewCaptureMode(): boolean {
  const captureMode = selectedCaptureMode();
  return captureMode.includes("mouth-gaze-pose") || captureMode.includes("actor-pose") || captureMode.includes("pose-review") || isRealGarmentSleeveDeformCapture();
}

function isRealGarmentSleeveDeformCapture(): boolean {
  const cmp = selectedHumanoidSourceComparator();
  const mode = selectedCaptureMode();
  // ED/parent/nurse real-garment comparators (phenotype.garmentLayers → sleeveDeform evidence).
  const isRealGarmentCmp =
    cmp === "peds_anny_real_garment_patient"
    || cmp === "ed_anny_real_garment_patient"
    || cmp === "peds_anny_real_garment_parent"
    || cmp === "peds_anny_real_garment_nurse";
  return isRealGarmentCmp && (mode.includes("garment-sleeve") || mode.includes("sleeve-deform") || mode.includes("body-motion-garment") || mode.includes("real-garment-body") || mode.includes("sleeve"));
}

/**
 * arena-physics-realbind-r3-ui-xr-bind (R3 / AD-3):
 * Physics-driven palpation bone transforms on real garment comparator — OPT-IN CAPTURE ONLY.
 *
 * PRE-PRODUCTION FENCE (physics-realbind-pre-prod-fence-v1):
 *   Returns true only when capture mode explicitly includes "physics-clinical-touch" or "physics-touch".
 *   Default session path returns false → physics transforms NOT applied.
 *   Gate ensures UI_XR_PHYSICS_TOUCH_RUNTIME_PROMOTION_ALLOWED=false is enforced at runtime.
 *
 * Requires comparator=ed_anny_real_garment_patient (preferred) or peds_anny_real_garment_patient
 * and capture mode including "physics-clinical-touch" or "physics-touch".
 */
function isPhysicsClinicalTouchCapture(): boolean {
  const mode = selectedCaptureMode();
  if (!mode.includes("physics-clinical-touch") && !mode.includes("physics-touch")) return false;
  const cmp = selectedHumanoidSourceComparator();
  return cmp === "ed_anny_real_garment_patient" || cmp === "peds_anny_real_garment_patient";
}

function isDynamicGeneratedEncounterSceneMode(): boolean {
  // #139: "generated learner station" is NOT roomProps.length. Empty scenery is still a
  // generated station; prop-count flipped emptied manifests into debug chrome (reverted 5430b3a).
  // Keep blocked-environment gate. Capture-mode escape hatches still surface markers/panels.
  // Rejected: props|equipment|actors density, dummy prop, three-flag split (peer: overbuild).
  return encounterRuntimeAssetBundle.environment.reviewStatus !== "blocked";
}

function isGeneratedPlaceholderSourceForDifferentScenario(source: string): boolean {
  const scenarioSlug = encounterRuntimeAssetBundle.scenarioId.replaceAll("_", "-");
  const normalizedSource = source.toLowerCase();
  if (isScenarioSpecificRuntimeFixtureForSelectedScenario(normalizedSource)) {
    return false;
  }
  return isDynamicGeneratedEncounterSceneMode()
    && !normalizedSource.includes(encounterRuntimeAssetBundle.scenarioId.toLowerCase())
    && !normalizedSource.includes(scenarioSlug.toLowerCase());
}

function isScenarioSpecificRuntimeFixtureForSelectedScenario(normalizedSource: string): boolean {
  if (encounterRuntimeAssetBundle.scenarioId !== "peds_asthma_parent_anxiety_v1") {
    return false;
  }
  return [
    "pediatric_urgent_care_bay_environment",
    "pulse_oximeter_equipment",
    "nebulizer_mask_equipment",
    "oxygen_wall_port_equipment",
    "pediatric_stretcher_equipment",
    "parent_chair_equipment",
    "inhaler_spacer_equipment",
  ].some((fixtureName) => normalizedSource.includes(fixtureName));
}

function isGeneratedPlaceholderAssetForDifferentScenario(asset: EncounterRuntimeAsset): boolean {
  return isGeneratedPlaceholderSourceForDifferentScenario(`${asset.blob.blobName} ${asset.blob.url ?? ""}`);
}

function shouldSuppressGeneratedEnvironmentShell(asset: EncounterRuntimeAsset): boolean {
  return isGeneratedPlaceholderAssetForDifferentScenario(asset);
}

function shouldSuppressGeneratedEquipmentModel(_assetId: string, assetPath: string): boolean {
  // Real library medical-equipment GLBs are shared clinical equipment, never scenario-mismatched placeholders (#140 counterweight; #245 wall clock).
  if (Object.values(REAL_EQUIPMENT_GLTF_BY_ID).some((fileName) =>
    assetPath.toLowerCase().includes(`/medical-equipment/${fileName.toLowerCase()}`))) {
    return false;
  }
  return isGeneratedPlaceholderSourceForDifferentScenario(assetPath);
}

function refreshDeclaredEquipmentMountEvidenceFromScene(): void {
  const evidence = window.__openClinXrDeclaredEquipmentMountEvidence;
  const scene = window.__openClinXrDebugScene;
  if (!evidence || !scene) return;
  const items = collectDeclaredEquipmentEvidenceFromScene(scene);
  if (items.length === 0) return;
  window.__openClinXrDeclaredEquipmentMountEvidence = { ...evidence, items };
}

function shouldShowRuntimeAffordanceMarkers(): boolean {
  const captureMode = selectedCaptureMode();
  return !isDynamicGeneratedEncounterSceneMode()
    || captureMode.includes("affordance")
    || captureMode.includes("evidence")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

function shouldShowPrimitiveAssetFallbacks(): boolean {
  const captureMode = selectedCaptureMode();
  return !isDynamicGeneratedEncounterSceneMode()
    || captureMode.includes("fallback")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

function shouldShowInSceneEvidencePanels(): boolean {
  const captureMode = selectedCaptureMode();
  return !isDynamicGeneratedEncounterSceneMode()
    || captureMode.includes("panel")
    || captureMode.includes("evidence")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

function shouldShowActorRealismRequirementPanel(evidence: HumanoidSpeechEvidence | null = window.__openClinXrHumanoidSpeechEvidence ?? null): boolean {
  const captureMode = selectedCaptureMode();
  if (shouldUseCleanHumanoidSourceComparatorCapture()) {
    return false;
  }
  return shouldShowInSceneEvidencePanels()
    || isHumanoidMouthGazePoseReviewCaptureMode()
    || (captureMode.includes("actor-realism") && Boolean(evidence?.activeActorRuntimeRealismRequirement));
}

function shouldShowInSceneIdentityLabels(): boolean {
  const captureMode = selectedCaptureMode();
  return !isDynamicGeneratedEncounterSceneMode()
    || captureMode.includes("label")
    || captureMode.includes("identity")
    || captureMode.includes("debug")
    || captureMode.includes("cue-review");
}

function isSceneOnlyVisualReviewCaptureMode(): boolean {
  const captureMode = selectedCaptureMode();
  return captureMode.includes("scene-only")
    || captureMode.includes("dynamic-only")
    || captureMode.includes("visual-cleanup")
    || shouldUseCleanHumanoidSourceComparatorCapture();
}

const sceneOnlyEssentialRoomPropIds = new Set([
  "oxygen-panel",
  "suction-canister",
  "glove-box-stack",
  "supply-cabinet",
  "privacy-curtain",
  "ceiling-exam-light",
  "patient-handoff-whiteboard",
  "ekg-leads-on-bed",
  "monitor-lead-cable",
  "patient-blanket",
  "iv-tubing-line",
  "monitor-waveform-card",
  "monitor-vitals-badge",
  "ecg-paper-strip",
  "nurse-task-tray",
  "call-light-remote",
]);

function shouldRenderRoomPropInVisualReview(prop: EncounterRuntimeRoomProp): boolean {
  if (!isSceneOnlyVisualReviewCaptureMode()) {
    return true;
  }
  if (prop.generatedBy === "scene_manifest" && prop.semanticRole !== "environmental_detail") {
    return true;
  }
  return sceneOnlyEssentialRoomPropIds.has(prop.propId);
}

function configuredExamSequence(): string[] {
  const params = new URLSearchParams(window.location.search);
  const configured = params.get("examSequence")
    ?.split(",")
    .map((scenarioId) => scenarioId.trim())
    .filter((scenarioId) => scenarioId.length > 0);
  if (configured && configured.length > 0) {
    return configured;
  }
  return [
    "ed_chest_pain_priority_v1",
    "ob_headache_preeclampsia_triage_v1",
    "clinic_abdominal_pain_interpreter_v1",
    "oncology_bad_news_family_v1",
    "postop_fever_consult_pressure_v1",
  ];
}

function positiveIntegerQueryParam(name: string, fallback: number): number {
  const params = new URLSearchParams(window.location.search);
  const value = Number.parseInt(params.get(name) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanQueryParam(name: string, fallback: boolean): boolean {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  if (value === null) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

function configuredExamRunId(): string {
  const params = new URLSearchParams(window.location.search);
  const queryRunId = params.get("examRunId")?.trim();
  if (queryRunId) {
    window.localStorage.setItem("openclinxr.examRunId", queryRunId);
    return queryRunId;
  }
  const storedRunId = window.localStorage.getItem("openclinxr.examRunId")?.trim();
  if (storedRunId) {
    return storedRunId;
  }
  const generatedRunId = `local_${Date.now().toString(36)}`;
  window.localStorage.setItem("openclinxr.examRunId", generatedRunId);
  return generatedRunId;
}

function initialDialogueTextForSelectedScenario(): string {
  // Bank is SSOT for who is named (#107). Table extracted so main.ts stays shrink-only.
  return initialDialogueTextForScenario({
    scenarioId: selectedScenarioId(),
    runtimeInitialDialogueText:
      encounterRuntimeAssetBundle.sceneManifest.stationContext?.initialDialogueText,
    bundleMismatch: isSelectedScenarioRuntimeBundleMismatch(),
  });
}

function stationContextForSelectedScenario() {
  // #115: vitals always resolved via station-context (honest unauthored / legacy numeric).
  // Removed the per-scenario vitals/prose table (main.ts:1433-1533) — pure drift, nothing consumed it.
  return stationContextForScenario({
    scenarioId: selectedScenarioId(),
    runtimeContext: encounterRuntimeAssetBundle.sceneManifest.stationContext,
    bundleMismatch: isSelectedScenarioRuntimeBundleMismatch(),
  });
}

function learnerRuntimeAssetBundleId(): string {
  const urlBundleId = new URLSearchParams(window.location.search).get("runtimeAssetBundleId")?.trim();
  if (urlBundleId) {
    window.localStorage.setItem("openclinxr.runtimeAssetBundleId", urlBundleId);
    window.__openClinXrSelectedRuntimeAssetBundleId = urlBundleId;
    return urlBundleId;
  }
  const selectedBundleId = window.localStorage.getItem("openclinxr.runtimeAssetBundleId") ?? "ed_chest_pain_local_encounter";
  window.__openClinXrSelectedRuntimeAssetBundleId = selectedBundleId;
  return selectedBundleId;
}

type GeneratedHumanoidAnimationSlot = {
  assetId: string;
  actorId: string;
  root: Group;
  actorSlot: Group;
  baseY: number;
  baseX: number; // #150 plant X
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  baseRotationY: number;
  baseZ: number;
  phaseOffsetMs: number;
  mouthCue: Mesh;
  gazeCue: Line;
  eyeFocusCue: Group;
  expressionCue: Group;
  emotionExpression: HumanoidEmotionExpressionState;
  sourceComparatorFreezeEnabled: boolean;
  activeSpeech?: HumanoidSpeechPlayback | undefined;
  mixer?: AnimationMixer;
  responseClips?: AnimationClip[];
  activeRoleAnimationClipName?: string | undefined;
  activeGazeProbeAnimationClipName?: string | undefined;
};
type HumanoidExpressionEmotion = "neutral" | "anxious" | "concerned" | "reassured" | "pain";
type HumanoidExpressionWeights = {
  mouthOpen: number;
  browConcern: number;
  cheekTension: number;
};
type HumanoidEmotionExpressionState = {
  currentEmotion: HumanoidExpressionEmotion;
  targetEmotion: HumanoidExpressionEmotion;
  weights: HumanoidExpressionWeights;
  targetWeights: HumanoidExpressionWeights;
  transitionStartedAtMs: number;
  transitionDurationMs: number;
};
type HumanoidSpeechPlayback = {
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
  /** Baked Rhubarb cue timeline for this line, when a served cue file exists (#722). */
  bakedCues?: PhonemeCue[];
  startedAtMs: number;
  durationMs: number;
};
type HumanoidDialogueEmotionContext = {
  emotion: HumanoidExpressionEmotion;
  source: "runtime_affect_timeline" | "plan.dialogueEmotionTo" | "plan_missing";
  baselineMood: string[];
  cueIds: string[];
};
type PedsActorPlayerRuntimeTurn = {
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
type PedsActorPlayerRuntimeSequenceSource = "bundle_dialogue_sequence" | "single_runtime_turn";
type PedsActorPlayerRuntimeSequenceEvidence = {
  sequenceId: string;
  traceTag: string;
  source: PedsActorPlayerRuntimeSequenceSource;
  turns: PedsActorPlayerRuntimeTurn[];
};
type MouthGazePoseComparatorEvidence = {
  source: "window.__openClinXrMouthGazePoseComparatorEvidence";
  captureMode: string;
  comparator: "peds_anny_school_age_mpfb2_eye_patient" | "peds_anny_real_garment_patient" | "peds_anny_real_garment_parent" | "peds_anny_real_garment_nurse" | "ed_anny_real_garment_patient";
  scenarioId: "peds_asthma_parent_anxiety_v1" | "ed_chest_pain_priority_v1" | "ed_chest_pain_priority_v2";
  actorId: string;
  dialogueText: string;
  traceTag: "work_of_breathing_assessment";
  activeViseme: string;
  activeMouthOpenness: number;
  activeEmotionState: HumanoidExpressionEmotion;
  activeExpressionTransitionMs: number;
  activeExpressionWeights: HumanoidExpressionWeights;
  gazeProbePlayback: string | null;
  activeGazeProbeAnimationClipName: string | null;
  morphTargetAppliedTargetCount: number;
  morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue_with_emotion_transition";
  emotionTransitionCuePresent: boolean;
  visemeTimelineComparatorEvidencePresent: boolean;
  activeDialogueTurnRef?: any;
  liveSource?: "live_blueprint_dialogue_emotion_source" | undefined;
  garmentGeometry?: {
    name: string;
    visible: boolean;
    source: string; // surface prepared for future real-garment (phenotype.garmentLayers embed, Q1); null for current school-age peds comparator
    hasVisibleVolume: boolean;
    hasSeamFoldHints: boolean;
    sleeveDeform?: string; // Q1: separate deforming 3D sleeves (skinned, phenotype garmentLayers) vs body; visible in UI-XR peds real_garment captures
  } | null;
  notEvidenceFor: string[];
};
type PedsAdaptiveDialogueEvidence = {
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
  humanoidSourceComparator?: "peds_anny_school_age_mpfb2_eye_patient" | "peds_anny_real_garment_patient" | "peds_anny_real_garment_parent" | "peds_anny_real_garment_nurse" | "ed_anny_real_garment_patient";
  schoolAgePatientAssetPath?: "/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb";
  realGarmentPatientAssetPath?: "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb";
  realGarmentParentAssetPath?: "/generated-humanoids/peds_anxious_parent.glb";
  realGarmentNurseAssetPath?: "/generated-humanoids/peds_nurse_kevin.glb";
  edRealGarmentPatientAssetPath?: "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb"; // ed-gown-geo-reorchestrate: hospital_gown from pheno.garmentLayers in ed_chest_pain_priority_v2
  notEvidenceFor: string[];
};
type PedsActorPlayerRuntimePlaybackEvidence = {
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
  notEvidenceFor: [
    "scene_placement_readiness",
    "learner_launch_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "clinical_validity",
    "scoring_validity",
  ];
};
const generatedHumanoidAnimationSlots: GeneratedHumanoidAnimationSlot[] = [];
const generatedHumanoidAnimationSlotsByActorId = new Map<string, GeneratedHumanoidAnimationSlot>();
const generatedHumanoidActorSlotsByActorId = new Map<string, Group>();
const virtualDeviceActorSlotsByActorId = new Map<string, Group>();
const activeVirtualDeviceSpeechByActorId = new Map<string, HumanoidSpeechPlayback>();
let pedsActorPlayerRuntimePlaybackScheduled = false;
let pedsActorPlayerRuntimePlaybackLastTraceAtMs = 0;
let pedsActorPlayerRuntimeSequenceActiveUntilMs = 0;
const environmentReactiveProps = new Map<string, Group>();
let lastObservedLocomotionSummary: {
  source: NonNullable<OpenClinXrInputEvidence["activeLocomotionSource"]>;
  distanceMeters: number;
  turnRadians: number;
  atMs: number;
} | null = null;
const roomEnvironmentalRealismCueIds = [
  "floor_scuff_path_between_door_bed_monitor",
  "infection_control_wall_signage",
  "handoff_whiteboard_patient_flow_cue",
  "supply_drawer_labels",
  "privacy_zone_floor_tape",
  "glove_and_sanitizer_touchpoint_cluster",
  "monitor_escalation_status_badge",
  "ecg_paper_strip_ready_cue",
  "nurse_task_tray_workflow_cue",
  "doorway_escalation_badge",
  "monitor_lead_cable_run",
  "bed_wheel_lock_safety_cues",
  "curtain_track_ring_hardware",
  "biohazard_trash_liner_detail",
  "iv_tubing_line_context",
] as const;

function recordSceneAssetStatus(input: SceneAssetEvidence["assets"][number]): SceneAssetEvidence {
  sceneAssetStatusRecords.set(input.assetId, { ...input });
  const assets = [...sceneAssetStatusRecords.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const evidence: SceneAssetEvidence = {
    source: "window.__openClinXrSceneAssetEvidence",
    generatedAtMs: roundPerformanceNow(),
    expectedAssetCount: assets.length,
    loadedCount: assets.filter((asset) => asset.status === "loaded").length,
    failedCount: assets.filter((asset) => asset.status === "failed").length,
    pendingCount: assets.filter((asset) => asset.status === "pending").length,
    fallbackActiveCount: assets.filter((asset) => asset.fallbackActive).length,
    cameraFramingCue: "humanoid_camera_framing_decluttered_three_actor_environment_review",
    visualFidelityCueIds: [
      "generated_humanoid_front_fidelity_badge",
      "generated_humanoid_face_hair_eyes_scrubs_shoes_cue",
      "room_prop_label_occlusion_reduced",
      "generated_humanoid_generator_native_front_orientation_preserved",
      "humanoid_interaction_target_decluttered",
      "generated_humanoid_facial_features_unobscured",
      "visible_runtime_mouth_eye_expression_cues",
    ],
    interactionCollisionEvidence: {
      proxyCueCount: assets.filter((asset) =>
        asset.affordanceCueIds?.some((cueId) => cueId.includes("ragdoll_collision_proxy_cue")),
      ).length,
      physicsProbeMode: "runtime_proxy_cues_with_offline_rapier_gate",
      latestProbeReportPath: "docs/openclinxr/humanoid-collision-probe-active-viseme-2026-05-23.json",
      notEvidenceFor: ["production_physics_readiness", "validated_ragdoll_biomechanics", "learner_readiness"],
    },
    assets,
    productionAssetReadinessClaimed: false,
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
    ],
  };
  window.__openClinXrSceneAssetEvidence = evidence;
  return evidence;
}

function runtimeAssetAffordanceCueIds(assetId: string, affordances: readonly string[]): string[] {
  return affordances.map((affordance) => `${assetId}:${affordance}`);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function roundPerformanceNow(): number {
  return Number(performance.now().toFixed(2));
}

function recordXrEntryEvidence(status: OpenClinXrXrEntryEvidence["lastStatus"], error?: unknown): void {
  const current = window.__openClinXrXrEntryEvidence ?? {
    sessionMode: "immersive-vr",
    attempts: 0,
    lastStatus: "not_requested",
    lastRequestedAtMs: null,
    lastUpdatedAtMs: Number(performance.now().toFixed(2)),
    lastError: null,
  };
  const now = Number(performance.now().toFixed(2));
  const requesting = status === "requesting";
  window.__openClinXrXrEntryEvidence = {
    sessionMode: "immersive-vr",
    attempts: current.attempts + (requesting ? 1 : 0),
    lastStatus: status,
    lastRequestedAtMs: requesting ? now : current.lastRequestedAtMs,
    lastUpdatedAtMs: now,
    lastError: error === undefined ? null : formatUnknownError(error),
  };
}

recordXrEntryEvidence("not_requested");

let state: XrRuntimeState = createInitialRuntimeState();
/** Deterministic conversation tooling state for HUD (local, not scored). */
let conversationCurrentTurn = 0;
let conversationLastActorId: string | null = null;
let conversationLastBargeInOutcome: string | null = null;
let conversationActiveBargeIn = false;
let conversationHistoryCoverage: HistoryTakingCoverageState = initialHistoryTakingCoverageState(
  buildHistoryTakingCoverageSpec({
    scenarioId: state.scenarioId,
    requiredTraceTags: state.requiredTraceTags,
  }),
);
let traceActionHandoffActions: XrTraceActionHandoffAction[] = [];
const configuredApiBaseUrl = typeof import.meta.env.VITE_OPENCLINXR_API_BASE_URL === "string" ? import.meta.env.VITE_OPENCLINXR_API_BASE_URL : "";
const stationApi = configuredApiBaseUrl ? createStationApiClient({ baseUrl: configuredApiBaseUrl }) : undefined;
window.__openClinXrRuntimeSceneManifestEvidence = buildRuntimeSceneManifestEvidence(encounterRuntimeAssetBundle);
let remoteStationRunId: string | undefined;
let immersiveSessionActive = false;
let lastTraceSelectLatencyMs: number | null = null;
let runtimeWebXrSupportEvidence: RuntimeWebXrSupportEvidence = {
  navigatorXrPresent: false,
  immersiveVrSupported: null,
  immersiveVrSupportCheckedAtMs: null,
  immersiveArSupported: null,
  immersiveArSupportCheckedAtMs: null,
  supportError: null,
};
let initialDialogueText = initialDialogueTextForSelectedScenario();
let selectedStationContext = stationContextForSelectedScenario();
const examScenarioSequence = configuredExamSequence();
const examScenarioId = selectedScenarioId();
const examNormalizedSequence = examScenarioSequence.includes(examScenarioId)
  ? examScenarioSequence
  : [examScenarioId, ...examScenarioSequence];
const examScenarioIndex = Math.max(0, examNormalizedSequence.indexOf(examScenarioId));
const examRunId = configuredExamRunId();
const examEncounterDurationSeconds = positiveIntegerQueryParam("examEncounterSeconds", 900);
const examNoteDurationSeconds = positiveIntegerQueryParam("examNoteSeconds", 600);
const examAutoAdvanceOnNoteTimeout = booleanQueryParam("examAutoAdvanceOnNoteTimeout", true);
let examFlowPhase: ExamFlowPhase = "encounter";
let examEncounterEndedAtSecond: number | null = null;
let examNoteStartedAtSecond: number | null = null;
let examNoteSubmitted = false;
let examNoteTimeoutHandled = false;
let examLastAdvanceReason: string | null = null;
const examNoteStorageKey = `openclinxr.patientNote.${examRunId}.${examScenarioId}`;
const examRunSummaryStorageKey = `openclinxr.examRunSummary.${examRunId}`;

let examFormRunState: ExamFormRunState | null = createLearnerExamFormRunState(
  examRunId,
  scenariosFromFixtureSequence(examNormalizedSequence),
  examScenarioId,
);
const examFormRunPersistenceSink = stationApi ? createStationApiPersistenceSink(stationApi) : undefined;
updateExamFormRunEvidence();

app.innerHTML = `
  <main class="station-shell${isSceneOnlyVisualReviewCaptureMode() ? " scene-only-visual-review" : ""}">
    <section class="stage" aria-label="${selectedStationContext.stageAriaLabel}">
      <canvas id="station-canvas" aria-label="${selectedStationContext.canvasAriaLabel}"></canvas>
      <div id="scene-boot-message" class="scene-boot-message" hidden>
        <strong>3D scene unavailable</strong>
        <span>WebGL or headset rendering did not initialize. Use Quest/manual evidence before readiness claims.</span>
      </div>
      <div class="status-strip">
        <span id="xr-status">WebXR checking</span>
        <span id="trace-summary">Trace 0/${state.requiredTraceTags.length}</span>
        <button id="enter-xr-button" class="xr-entry-button" type="button" disabled>Enter Full VR</button>
      </div>
    </section>
    <aside class="runtime-panel" aria-label="Station controls and clinical context">
      <header>
        <p class="label">Doorway</p>
        <h1>${selectedStationContext.title}</h1>
        <p class="subtle">${selectedStationContext.subtitle}</p>
      </header>
      <div class="timer-row">
        <span>Encounter</span>
        <strong id="station-clock">00:00</strong>
      </div>
      <section class="ehr-panel" aria-label="Simulated EHR">
        <h2>Simulated EHR</h2>
        <dl>
          <div><dt>Chief concern</dt><dd>${selectedStationContext.chiefConcern}</dd></div>
          <div data-ehr-vitals-charted="${selectedStationContext.presentedAsChartedVitals ? "true" : "false"}"><dt id="ehr-vitals-label">${selectedStationContext.vitalsEhrRowLabel}</dt><dd id="ehr-vitals-value">${selectedStationContext.initialVitals}</dd></div>
          <div><dt>Interruption</dt><dd>${selectedStationContext.interruption}</dd></div>
        </dl>
      </section>
      <section class="dialogue-panel" aria-label="Mock dialogue">
        <h2>Mock Dialogue</h2>
        <p id="dialogue-line">${initialDialogueText}</p>
      </section>
      <section class="trace-panel" aria-label="Trace controls">
        <h2>Trace Actions</h2>
        <div id="trace-actions" class="trace-actions"></div>
      </section>
      <section class="exam-flow-panel evidence-panel" aria-label="Encounter progression and patient note">
        <h2>Encounter Flow</h2>
        <dl class="evidence-grid">
          <div><dt>Station</dt><dd id="exam-flow-station">pending</dd></div>
          <div><dt>Case source</dt><dd id="exam-flow-case-source"></dd></div>
          <div><dt>Phase timer</dt><dd id="exam-flow-timer">pending</dd></div>
          <div><dt>Advance</dt><dd id="exam-flow-advance">pending</dd></div>
        </dl>
        <label class="patient-note-label" for="patient-note-text">Patient note</label>
        <textarea id="patient-note-text" class="patient-note-text" spellcheck="true" aria-label="Patient note for this encounter"></textarea>
        <div class="exam-flow-actions">
          <button id="end-encounter-button" class="trace-button" type="button">End encounter / start note</button>
          <button id="submit-note-button" class="trace-button" type="button">Submit note / next encounter</button>
        </div>
      </section>
      <section class="evidence-panel" aria-label="Reactive room state">
        <h2>Room State</h2>
        <p id="room-state-summary">baseline room state</p>
      </section>
      <section class="evidence-panel runtime-posture-panel" aria-label="Runtime posture">
        <h2>Runtime Posture</h2>
        <p id="posture-summary" class="posture-summary">Mock model/voice active; evidence gates pending.</p>
        <dl class="runtime-posture-grid">
          <div><dt>Model</dt><dd id="posture-model">pending</dd></div>
          <div><dt>Voice</dt><dd id="posture-voice">pending</dd></div>
          <div><dt>Quest</dt><dd id="posture-quest">pending</dd></div>
          <div><dt>MR</dt><dd id="posture-mr">pending</dd></div>
          <div><dt>Bundle Gate</dt><dd id="posture-bundle-gate">pending</dd></div>
          <div><dt>Launch</dt><dd id="posture-launch">pending</dd></div>
        </dl>
      </section>
      <section class="evidence-panel" aria-label="Quest manual evidence">
        <h2>Quest Evidence</h2>
        <dl class="evidence-grid">
          <div><dt>Frames</dt><dd id="evidence-frames">0 / 0</dd></div>
          <div><dt>Loop</dt><dd id="evidence-loop">pending</dd></div>
          <div><dt>Input</dt><dd id="evidence-input">pending</dd></div>
          <div><dt>Assets</dt><dd id="evidence-scene-assets">pending</dd></div>
          <div><dt>Speech affect</dt><dd id="evidence-speech-affect">pending</dd></div>
          <div><dt>Actor-player</dt><dd id="evidence-actor-player">pending</dd></div>
          <div><dt>Movement</dt><dd id="evidence-locomotion">pending</dd></div>
          <div><dt>Trace interaction</dt><dd id="evidence-trace-interaction">not observed</dd></div>
          <div><dt>Trace</dt><dd id="evidence-trace">pending</dd></div>
          <div><dt>Validation</dt><dd id="evidence-validation">pending</dd></div>
        </dl>
        <div class="evidence-actions">
          <button id="copy-evidence-button" class="trace-button" type="button">Copy Evidence</button>
          <span id="copy-evidence-status" aria-live="polite">Not copied</span>
        </div>
        <textarea id="manual-evidence-json" class="manual-evidence-json" readonly spellcheck="false" aria-label="Manual performance JSON"></textarea>
      </section>
    </aside>
  </main>
`;

function refreshStationContextFromRuntimeBundle(): void {
  // #114: pass selectedScenarioId so a foreign ED fallback cannot poison Trace Actions.
  state = createRuntimeStateFromBundle(encounterRuntimeAssetBundle, state, selectedScenarioId());
  window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence =
    buildCaseDefinedHumanoidPerformanceContractEvidence(selectedScenarioId());
  window.__openClinXrActorPlayerRuntimeMetadataSummary =
    buildActorPlayerRuntimeMetadataSummary(encounterRuntimeAssetBundle.scenarioId);
  initialDialogueText = initialDialogueTextForSelectedScenario();
  // #722: warm the served cue cache so the opening line's baked timeline attaches the instant its
  // dialogue fires — the cue fetch must not queue behind the actor GLBs on a cold boot.
  void loadBakedMouthCuesForUtterance(selectedScenarioId(), initialDialogueText);
  selectedStationContext = stationContextForSelectedScenario();
  document.querySelector<HTMLElement>(".stage")?.setAttribute("aria-label", selectedStationContext.stageAriaLabel);
  document.querySelector<HTMLElement>("#station-canvas")?.setAttribute("aria-label", selectedStationContext.canvasAriaLabel);
  const title = document.querySelector<HTMLElement>("header h1");
  if (title) title.textContent = selectedStationContext.title;
  const subtitle = document.querySelector<HTMLElement>("header .subtle");
  if (subtitle) subtitle.textContent = selectedStationContext.subtitle;
  const ehrValues = document.querySelectorAll<HTMLElement>(".ehr-panel dd");
  if (ehrValues[0]) ehrValues[0].textContent = selectedStationContext.chiefConcern;
  if (ehrValues[1]) ehrValues[1].textContent = selectedStationContext.initialVitals;
  if (ehrValues[2]) ehrValues[2].textContent = selectedStationContext.interruption;
  const vitalsLabel = document.querySelector<HTMLElement>("#ehr-vitals-label");
  if (vitalsLabel) vitalsLabel.textContent = selectedStationContext.vitalsEhrRowLabel;
  const vitalsRow = document.querySelector<HTMLElement>("[data-ehr-vitals-charted]");
  if (vitalsRow) {
    vitalsRow.dataset.ehrVitalsCharted = selectedStationContext.presentedAsChartedVitals ? "true" : "false";
  }
  const dialogue = document.querySelector<HTMLElement>("#dialogue-line");
  if (dialogue) dialogue.textContent = initialDialogueText;
}

const canvas = requireElement<HTMLCanvasElement>("#station-canvas");
const clock = requireElement<HTMLElement>("#station-clock");
const traceSummary = requireElement<HTMLElement>("#trace-summary");
const traceActions = requireElement<HTMLElement>("#trace-actions");
const examFlowStation = requireElement<HTMLElement>("#exam-flow-station");
const examFlowCaseSource = requireElement<HTMLElement>("#exam-flow-case-source");
const examFlowTimer = requireElement<HTMLElement>("#exam-flow-timer");
const examFlowAdvance = requireElement<HTMLElement>("#exam-flow-advance");
void bootLearnerExamFormFromApi({
  baseUrl: configuredApiBaseUrl,
  examRunId,
  examScenarioId,
  getState: () => examFormRunState,
  setState: (next) => {
    examFormRunState = next;
  },
  persistenceSink: examFormRunPersistenceSink,
  updateEvidence: () => {
    updateExamFormRunEvidence();
  },
  presentationSink: examFlowCaseSource,
});
const patientNoteText = requireElement<HTMLTextAreaElement>("#patient-note-text");
const endEncounterButton = requireElement<HTMLButtonElement>("#end-encounter-button");
const submitNoteButton = requireElement<HTMLButtonElement>("#submit-note-button");
const roomStateSummary = requireElement<HTMLElement>("#room-state-summary");
const xrStatus = requireElement<HTMLElement>("#xr-status");
const sceneBootMessage = requireElement<HTMLElement>("#scene-boot-message");
const dialogueLine = requireElement<HTMLElement>("#dialogue-line");
const enterXrButton = requireElement<HTMLButtonElement>("#enter-xr-button");
const evidenceFrames = requireElement<HTMLElement>("#evidence-frames");
const evidenceLoop = requireElement<HTMLElement>("#evidence-loop");
const evidenceInput = requireElement<HTMLElement>("#evidence-input");
const evidenceSceneAssets = requireElement<HTMLElement>("#evidence-scene-assets");
const evidenceSpeechAffect = requireElement<HTMLElement>("#evidence-speech-affect");
const evidenceActorPlayer = requireElement<HTMLElement>("#evidence-actor-player");
const evidenceLocomotion = requireElement<HTMLElement>("#evidence-locomotion");
const evidenceTraceInteraction = requireElement<HTMLElement>("#evidence-trace-interaction");
const evidenceTrace = requireElement<HTMLElement>("#evidence-trace");
const evidenceValidation = requireElement<HTMLElement>("#evidence-validation");
const postureSummary = requireElement<HTMLElement>("#posture-summary");
const postureModel = requireElement<HTMLElement>("#posture-model");
const postureVoice = requireElement<HTMLElement>("#posture-voice");
const postureQuest = requireElement<HTMLElement>("#posture-quest");
const postureMr = requireElement<HTMLElement>("#posture-mr");
const postureBundleGate = requireElement<HTMLElement>("#posture-bundle-gate");
const postureLaunch = requireElement<HTMLElement>("#posture-launch");
const copyEvidenceButton = requireElement<HTMLButtonElement>("#copy-evidence-button");
const copyEvidenceStatus = requireElement<HTMLElement>("#copy-evidence-status");
const manualEvidenceJson = requireElement<HTMLTextAreaElement>("#manual-evidence-json");
window.__openClinXrExperienceModeEvidence = xrExperienceModeEvidence;
let evidenceCopyDisposition: ManualEvidenceCopyDisposition = "not_copied";
patientNoteText.value = window.localStorage.getItem(examNoteStorageKey) ?? "";

patientNoteText.addEventListener("input", () => {
  window.localStorage.setItem(examNoteStorageKey, patientNoteText.value);
  updateExamFlowEvidence();
});

endEncounterButton.addEventListener("click", () => {
  if (examFlowPhase !== "encounter") {
    examLastAdvanceReason = `ignored_end_encounter_during_${examFlowPhase}`;
    updateExamFlowEvidence();
    return;
  }
  examFlowPhase = "note";
  examEncounterEndedAtSecond = state.elapsedSecond;
  examNoteStartedAtSecond = state.elapsedSecond;
  examLastAdvanceReason = "encounter_ended_note_phase_started";
  updateExamFlowEvidence();
});

submitNoteButton.addEventListener("click", () => {
  if (examFlowPhase !== "note") {
    examLastAdvanceReason = `blocked_submit_note_during_${examFlowPhase}`;
    updateExamFlowEvidence();
    return;
  }
  if (patientNoteText.value.trim().length === 0) {
    examLastAdvanceReason = "blocked_empty_patient_note";
    updateExamFlowEvidence();
    return;
  }
  examNoteSubmitted = true;
  const nextScenarioId = nextExamScenarioId();
  if (!nextScenarioId) {
    examFlowPhase = "complete";
    examLastAdvanceReason = "last_station_note_submitted_exam_complete";
    recordExamRunStationOutcome();
    updateExamFlowEvidence();
    return;
  }
  examLastAdvanceReason = `patient_note_submitted_advancing_to_${nextScenarioId}`;
  recordExamRunStationOutcome();
  updateExamFlowEvidence();
  navigateToExamScenario(nextScenarioId);
});

copyEvidenceButton.addEventListener("click", () => {
  const payload = updateManualEvidencePanel();
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(payload)
      .then(() => {
        evidenceCopyDisposition = "copied";
        updateManualEvidencePanel();
      })
      .catch(() => {
        evidenceCopyDisposition = "copy_blocked";
        updateManualEvidencePanel();
      });
    return;
  }
  evidenceCopyDisposition = "clipboard_unavailable";
  updateManualEvidencePanel();
});

function renderControls(): void {
  traceActions.innerHTML = "";
  for (const tag of state.requiredTraceTags) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag.replaceAll("_", " ");
    button.className = state.completedTraceTags.includes(tag) ? "trace-button complete" : "trace-button";
    button.addEventListener("click", () => completeTraceActionFromInput(tag, "dom_click_trace_button"));
    traceActions.append(button);
  }
}

function nextExamScenarioId(): string | null {
  if (examFormRunState) {
    const nextFromForm = nextExamFormRunStation(examFormRunState)?.scenarioId ?? null;
    if (nextFromForm) {
      return nextFromForm;
    }
    // Form run may be single-station while URL sequence still has more entries.
  }
  return examNormalizedSequence[examScenarioIndex + 1] ?? null;
}

function navigateToExamScenario(nextScenarioId: string): void {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("scenarioId", nextScenarioId);
  nextUrl.searchParams.set("examSequence", examNormalizedSequence.join(","));
  nextUrl.searchParams.set("examRunId", examRunId);
  nextUrl.searchParams.set("examEncounterSeconds", String(examEncounterDurationSeconds));
  nextUrl.searchParams.set("examNoteSeconds", String(examNoteDurationSeconds));
  nextUrl.searchParams.set("examAutoAdvanceOnNoteTimeout", examAutoAdvanceOnNoteTimeout ? "1" : "0");
  window.location.assign(nextUrl.toString());
}

function formElapsedSecondForCurrentStation(): number {
  if (!examFormRunState) {
    return state.elapsedSecond;
  }
  const station = currentExamFormRunStation(examFormRunState);
  const stationOffset = station?.timing.doorway.startsAtSecond ?? 0;
  return stationOffset + state.elapsedSecond;
}

function updateExamFormRunEvidence(): OpenClinXrExamFormRunEvidence | null {
  if (!examFormRunState) {
    delete window.__openClinXrExamFormRunEvidence;
    return null;
  }
  const current = currentExamFormRunStation(examFormRunState);
  const next = nextExamFormRunStation(examFormRunState);
  const evidence: OpenClinXrExamFormRunEvidence = {
    source: "exam_assembly_form_run",
    examRunId: examFormRunState.examRunId,
    examFormId: examFormRunState.examFormId,
    blueprintId: examFormRunState.blueprintId,
    status: examFormRunState.status,
    currentStationOrder: current?.stationOrder ?? null,
    currentScenarioId: current?.scenarioId ?? null,
    nextScenarioId: next?.scenarioId ?? null,
    scenarioSequence: examFormRunScenarioSequence(examFormRunState),
    formElapsedSecond: examFormRunState.clock.formElapsedSecond,
    formRemainingSecond: examFormRunState.clock.formRemainingSecond,
    totalStationTimeSeconds: examFormRunState.clock.totalStationTimeSeconds,
    formClockDisplay: formatExamFormRunClock(examFormRunState),
    stationOutcomeCount: examFormRunState.stationOutcomes.length,
    canStartLearnerExam: examFormRunState.queue.canStartLearnerExam,
    examEquivalenceGate: false,
    claimBoundary: examFormRunState.claimBoundary,
    notEvidenceFor: examFormRunState.notEvidenceFor,
  };
  window.__openClinXrExamFormRunEvidence = evidence;
  return evidence;
}

function readExamRunSummaryOutcomes(): ExamRunStationOutcome[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(examRunSummaryStorageKey) ?? "[]") as ExamRunStationOutcome[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function updateExamRunSummaryEvidence(): OpenClinXrExamRunSummaryEvidence {
  const formClock = examFormRunState ? formatExamFormRunClock(examFormRunState) : null;
  const evidence: OpenClinXrExamRunSummaryEvidence = {
    source: "local_exam_run_summary",
    examRunId,
    totalScenarios: examNormalizedSequence.length,
    stationOutcomes: readExamRunSummaryOutcomes(),
    examEquivalenceGate: false,
  };
  if (formClock) {
    evidence.formElapsedSecond = formClock.formElapsedSecond;
    evidence.formRemainingSecond = formClock.formRemainingSecond;
  }
  if (examFormRunState) {
    evidence.examFormRunStatus = examFormRunState.status;
    evidence.notEvidenceFor = examFormRunState.notEvidenceFor;
  }
  window.__openClinXrExamRunSummaryEvidence = evidence;
  return evidence;
}

function recordExamRunStationOutcome(): void {
  const formSecond = formElapsedSecondForCurrentStation();
  if (examFormRunState) {
    examFormRunState = tickExamFormRunClock(examFormRunState, formSecond);
    examFormRunState = advanceExamFormRunStation(examFormRunState, {
      phase: examFlowPhase === "complete" ? "complete" : examNoteSubmitted ? "complete" : examFlowPhase,
      noteSubmitted: examNoteSubmitted,
      advanceReason: examLastAdvanceReason,
      endedAtFormSecond: formSecond,
      recordedAtIso: new Date().toISOString(),
    });
    updateExamFormRunEvidence();
    if (examFormRunPersistenceSink) {
      void persistExamFormRunQueueSnapshot(examFormRunState, examFormRunPersistenceSink, {
        snapshotId: `queue_snapshot_${examRunId}_station_${examScenarioIndex + 1}`,
        reviewerId: "ui_xr_learner_runtime",
      }).catch(() => {
        // Best-effort; local outcomes still recorded.
      });
    }
  }

  const formOutcome = examFormRunState?.stationOutcomes.find(
    (outcome) => outcome.stationOrder === examScenarioIndex + 1,
  ) ?? examFormRunState?.stationOutcomes.find(
    (outcome) => outcome.scenarioId === examScenarioId,
  );
  const outcomes = readExamRunSummaryOutcomes();
  const nextOutcome: ExamRunStationOutcome = {
    scenarioId: examScenarioId,
    scenarioIndex: examScenarioIndex,
    phase: examFlowPhase,
    noteTextLength: patientNoteText.value.trim().length,
    noteSubmitted: examNoteSubmitted,
    lastAdvanceReason: examLastAdvanceReason,
    recordedAtIso: formOutcome?.recordedAtIso ?? new Date().toISOString(),
    stationOrder: formOutcome?.stationOrder ?? examScenarioIndex + 1,
    endedAtFormSecond: formOutcome?.endedAtFormSecond ?? formSecond,
  };
  if (formOutcome?.slotId !== undefined) {
    nextOutcome.slotId = formOutcome.slotId;
  }
  if (formOutcome?.startedAtFormSecond !== undefined) {
    nextOutcome.startedAtFormSecond = formOutcome.startedAtFormSecond;
  }
  const withoutCurrent = outcomes.filter((outcome) => outcome.scenarioId !== examScenarioId || outcome.scenarioIndex !== examScenarioIndex);
  window.localStorage.setItem(examRunSummaryStorageKey, JSON.stringify([...withoutCurrent, nextOutcome]));
  updateExamRunSummaryEvidence();
}

function updateExamFlowEvidence(): OpenClinXrExamFlowEvidence {
  const nextScenarioId = nextExamScenarioId();
  const noteElapsedSeconds = examNoteStartedAtSecond === null ? 0 : Math.max(0, state.elapsedSecond - examNoteStartedAtSecond);
  const encounterElapsedSeconds = examEncounterEndedAtSecond === null
    ? state.elapsedSecond
    : Math.max(0, examEncounterEndedAtSecond);
  const noteTextLength = patientNoteText.value.trim().length;
  const evidence: OpenClinXrExamFlowEvidence = {
    source: "local_exam_flow_runtime",
    examRunId,
    scenarioId: examScenarioId,
    scenarioIndex: examScenarioIndex,
    totalScenarios: examNormalizedSequence.length,
    nextScenarioId,
    phase: examFlowPhase,
    encounterDurationSeconds: examEncounterDurationSeconds,
    noteDurationSeconds: examNoteDurationSeconds,
    encounterElapsedSeconds,
    noteElapsedSeconds,
    encounterRemainingSeconds: Math.max(0, examEncounterDurationSeconds - encounterElapsedSeconds),
    noteRemainingSeconds: Math.max(0, examNoteDurationSeconds - noteElapsedSeconds),
    noteTextLength,
    noteSubmitted: examNoteSubmitted,
    noteTimeoutElapsed: examFlowPhase === "note" && noteElapsedSeconds >= examNoteDurationSeconds,
    canAdvanceToNextEncounter: examFlowPhase === "note" && noteTextLength > 0,
    autoAdvanceOnNoteTimeout: examAutoAdvanceOnNoteTimeout,
    lastAdvanceReason: examLastAdvanceReason,
    acceleratedByQuery: examEncounterDurationSeconds !== 900 || examNoteDurationSeconds !== 600,
  };
  window.__openClinXrExamFlowEvidence = evidence;
  updateExamRunSummaryEvidence();
  examFlowStation.textContent = `${evidence.scenarioIndex + 1}/${evidence.totalScenarios}: ${evidence.scenarioId}`;
  examFlowTimer.textContent = evidence.phase === "note"
    ? `note ${formatStationClock(evidence.noteElapsedSeconds)} / ${formatStationClock(evidence.noteDurationSeconds)}`
    : evidence.phase === "complete"
      ? "exam sequence complete"
      : `encounter ${formatStationClock(evidence.encounterElapsedSeconds)} / ${formatStationClock(evidence.encounterDurationSeconds)}`;
  examFlowAdvance.textContent = evidence.canAdvanceToNextEncounter
    ? `ready for ${nextScenarioId ?? "completion"}`
    : evidence.lastAdvanceReason ?? "complete encounter, then submit a non-empty patient note";
  endEncounterButton.disabled = evidence.phase !== "encounter";
  submitNoteButton.disabled = evidence.phase !== "note";
  return evidence;
}

function advanceExamFlowForElapsedTime(): void {
  if (examFlowPhase !== "encounter" || examEncounterEndedAtSecond !== null) {
    return;
  }
  if (state.elapsedSecond < examEncounterDurationSeconds) {
    return;
  }
  examFlowPhase = "note";
  examEncounterEndedAtSecond = examEncounterDurationSeconds;
  examNoteStartedAtSecond = state.elapsedSecond;
  examLastAdvanceReason = "encounter_timer_elapsed_note_phase_started";
}

function advanceExamNoteForElapsedTime(): void {
  if (examFlowPhase !== "note" || examNoteStartedAtSecond === null || examNoteTimeoutHandled) {
    return;
  }
  if (state.elapsedSecond - examNoteStartedAtSecond < examNoteDurationSeconds) {
    return;
  }
  examNoteTimeoutHandled = true;
  if (!examAutoAdvanceOnNoteTimeout) {
    examLastAdvanceReason = "note_timer_elapsed_auto_advance_disabled";
    return;
  }
  if (patientNoteText.value.trim().length === 0) {
    examLastAdvanceReason = "note_timer_elapsed_patient_note_required";
    return;
  }
  examNoteSubmitted = true;
  const nextScenarioId = nextExamScenarioId();
  if (!nextScenarioId) {
    examFlowPhase = "complete";
    examLastAdvanceReason = "note_timer_elapsed_last_station_complete";
    recordExamRunStationOutcome();
    return;
  }
  examLastAdvanceReason = `note_timer_elapsed_advancing_to_${nextScenarioId}`;
  recordExamRunStationOutcome();
  updateExamFlowEvidence();
  navigateToExamScenario(nextScenarioId);
}

function recordTraceSelectLatency(
  startedAtMs: number,
  tag: string,
  source: OpenClinXrTraceLatencyEvidence["source"],
): number {
  lastTraceSelectLatencyMs = Number((performance.now() - startedAtMs).toFixed(2));
  window.__openClinXrTraceLatencyEvidence = {
    lastTraceTag: tag,
    lastSelectLatencyMs: lastTraceSelectLatencyMs,
    source,
    measuredAtMs: Number(performance.now().toFixed(2)),
    productionControllerLatencySubstitute: false,
  };
  return lastTraceSelectLatencyMs;
}

function publishConversationTurnStateEvidence(options?: {
  learnerUtterance?: string;
  traceTags?: readonly string[];
  bargeInOutcome?: string | null;
  activeBargeIn?: boolean;
}): ConversationTurnStateEvidence {
  const scenarioId = encounterRuntimeAssetBundle?.scenarioId ?? state.scenarioId;
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === scenarioId)
    ?? (scenarioId === edChestPainScenario.scenarioId ? edChestPainScenario : null);
  const actors = (scenario?.actors ?? []).map((actor) => ({
    actorId: actor.actorId,
    role: actor.role,
  }));
  if (conversationHistoryCoverage.scenarioId !== scenarioId) {
    // Rebuild coverage domains when the resolved scenario differs from the
    // initial bundle scenario (keeps HUD domains aligned with scenarioId).
    conversationHistoryCoverage = initialHistoryTakingCoverageState(
      buildHistoryTakingCoverageSpec({
        scenarioId,
        requiredTraceTags: scenario?.requiredTraceTags ?? state.requiredTraceTags,
      }),
    );
  }
  if (options?.traceTags || options?.learnerUtterance) {
    const coverageSpec = buildHistoryTakingCoverageSpec({
      scenarioId,
      requiredTraceTags: scenario?.requiredTraceTags ?? state.requiredTraceTags,
    });
    const updated = updateHistoryTakingCoverage(
      conversationHistoryCoverage,
      {
        ...(options.traceTags ? { traceTags: options.traceTags } : {}),
        ...(options.learnerUtterance ? { learnerUtterance: options.learnerUtterance } : {}),
      },
      coverageSpec,
    );
    conversationHistoryCoverage = updated.state;
  }
  if (options?.bargeInOutcome !== undefined) {
    conversationLastBargeInOutcome = options.bargeInOutcome;
  }
  if (options?.activeBargeIn !== undefined) {
    conversationActiveBargeIn = options.activeBargeIn;
  }
  conversationCurrentTurn += 1;
  const turnDecision = actors.length > 0
    ? arbitrateTurnTaking({
      actors,
      lastActorId: conversationLastActorId,
      ...(options?.learnerUtterance !== undefined ? { learnerUtterance: options.learnerUtterance } : {}),
      conversationTurn: conversationCurrentTurn,
    })
    : null;
  if (turnDecision) {
    conversationLastActorId = turnDecision.nextActorId;
  }
  const evidence = buildConversationTurnStateEvidence({
    scenarioId,
    currentTurn: conversationCurrentTurn,
    lastActorId: conversationLastActorId,
    nextActorId: turnDecision?.nextActorId ?? null,
    nextTurnReason: turnDecision?.reason ?? null,
    activeBargeIn: conversationActiveBargeIn,
    lastBargeInOutcome: conversationLastBargeInOutcome,
    historyCoverage: conversationHistoryCoverage,
  });
  window.__openClinXrConversationTurnStateEvidence = evidence;
  return evidence;
}

function formatConversationTurnStatePanelLines(
  evidence: ConversationTurnStateEvidence | null | undefined = window.__openClinXrConversationTurnStateEvidence,
): string[] {
  if (!evidence) {
    return [
      "Turn: pending",
      "Next speaker: pending",
      "History coverage: 0% (domains traced, not scored)",
      "Barge-in: idle",
    ];
  }
  const covered = evidence.historyCoverage.coveredDomainIds.slice(0, 4).join(", ") || "(none)";
  const missing = evidence.historyCoverage.missingDomainIds.slice(0, 4).join(", ") || "(none)";
  return [
    `Turn ${evidence.currentTurn} · next ${evidence.nextActorId ?? "n/a"} (${evidence.nextTurnReason ?? "n/a"})`,
    `Coverage ${evidence.historyCoverage.coveragePercent}% of domains (NOT a clinical score)`,
    `Covered: ${covered}`,
    `Missing: ${missing}`,
    `Barge-in: ${evidence.activeBargeIn ? "ACTIVE" : "idle"}${evidence.lastBargeInOutcome ? ` · last ${evidence.lastBargeInOutcome}` : ""}`,
    `claimScope: ${evidence.claimScope}`,
  ];
}

function completeTraceActionFromInput(
  tag: string,
  source: OpenClinXrTraceLatencyEvidence["source"],
  payload?: Record<string, unknown>,
): void {
  const traceSelectStartedAtMs = performance.now();
  const priorCompletedTraceTags = state.completedTraceTags;
  state = completeTraceAction(state, tag);
  const liveTurn = rememberLiveActorTurnFromPayload(tag, payload);
  if (liveTurn && liveTurn.bargeInKind !== "none") {
    conversationLastBargeInOutcome = liveTurn.bargeInKind;
    conversationActiveBargeIn = true;
  }
  publishConversationTurnStateEvidence({
    traceTags: [tag],
    learnerUtterance: dialogueFor(tag),
  });
  const adaptiveBranch = resolvePedsAdaptiveDialogueBranch(
    tag,
    priorCompletedTraceTags,
    encounterRuntimeAssetBundle.scenarioId,
  );
  // Clinical-touch already fires case-driven dialogue in handleClinicalTouch; skip generic dialogue overwrite.
  const skipGenericDialogue = Boolean(payload?.clinicalTouch);
  const dialogueText = liveTurn?.caption ?? dialogueFor(tag);
  if (!skipGenericDialogue) {
    dialogueLine.textContent = dialogueText;
  }
  if (adaptiveBranch && triggerPedsAdaptiveDialogueBranch(adaptiveBranch, "trace_action")) {
    // Adaptive bundle branch already drove actor turns, viseme, gaze, and emotion transitions.
  } else if (!skipGenericDialogue && !triggerPedsActorPlayerRuntimeTurnForTrace(tag)) {
    triggerHumanoidDialogueForTrace(tag, dialogueText);
  }
  updateEnvironmentStateForTrace(tag);
  renderControls();
  updateReadiness();
  const selectLatencyMs = recordTraceSelectLatency(traceSelectStartedAtMs, tag, source);
  const region = typeof payload?.region === "string" ? payload.region : undefined;
  const actorIdFromPayload = typeof payload?.actorId === "string" ? payload.actorId : undefined;
  traceActionHandoffActions = [
    ...traceActionHandoffActions,
    {
      sequence: traceActionHandoffActions.length + 1,
      traceTag: tag,
      source,
      eventType: eventTypeForTraceTag(tag),
      actorId: actorIdFromPayload ?? localDialogueActorIdForTraceTag(tag) ?? null,
      completedAtSecond: state.elapsedSecond,
      completedAtMs: roundPerformanceNow(),
      selectLatencyMs,
      ...(region ? { region } : {}),
    },
  ];
  updateTraceActionHandoffEvidence();
  void recordRemoteTraceAction(tag, payload);
}

function updateEnvironmentStateForTrace(tag: string): EnvironmentStateEvidence {
  const activeTraceTags = Array.from(new Set([...(window.__openClinXrEnvironmentStateEvidence?.activeTraceTags ?? []), tag]));
  const activeRuntimeEquipmentIds = Array.from(new Set(activeTraceTags.flatMap(runtimeEquipmentIdsForTraceTag)));
  const stressCueIds = [
    ...(activeTraceTags.includes("vitals_review") ? ["monitor_waveform_card_soft_warning", "nurse_workflow_lane_attention"] : []),
    ...(activeTraceTags.includes("ecg_request") ? ["ekg_leads_on_bed_ready", "ecg_cart_workflow_attention"] : []),
    ...(activeTraceTags.includes("work_of_breathing_assessment") ? ["work_of_breathing_runtime_attention", "pulse_oximeter_runtime_attention"] : []),
    ...(activeTraceTags.includes("inhaler_history") ? ["inhaler_spacer_history_runtime_attention"] : []),
    ...(activeTraceTags.includes("trigger_history") ? ["asthma_trigger_history_runtime_attention", "parent_chair_runtime_attention"] : []),
    ...(activeTraceTags.includes("oxygen_request") ? ["oxygen_wall_port_runtime_attention", "pulse_oximeter_runtime_attention"] : []),
    ...(activeTraceTags.includes("bronchodilator_plan") ? ["nebulizer_mask_runtime_attention", "inhaler_spacer_runtime_attention"] : []),
    ...(activeTraceTags.includes("urgent_escalation") ? ["doorway_station_sign_escalation", "ceiling_exam_light_attention"] : []),
    ...(activeTraceTags.includes("urgent_escalation") ? ["pediatric_escalation_runtime_attention", "urgent_family_support_runtime_attention"] : []),
    ...(activeTraceTags.includes("empathy_statement") ? ["pediatric_empathy_deescalation_runtime_attention", "child_parent_reassurance_runtime_attention"] : []),
    ...(activeTraceTags.includes("patient_note_submitted") ? ["patient_note_runtime_completion_attention", "faculty_review_handoff_runtime_attention"] : []),
  ];
  const evidence: EnvironmentStateEvidence = {
    source: "local_trace_tied_environment_state",
    activeTraceTags,
    stressCueIds,
    environmentalRealismCueIds: [...roomEnvironmentalRealismCueIds],
    monitorState: activeTraceTags.includes("bronchodilator_plan")
      ? "bronchodilator_in_progress"
      : activeTraceTags.includes("oxygen_request")
        ? "oxygen_started"
        : activeTraceTags.includes("ecg_request")
          ? "urgent_ecg_requested"
          : activeTraceTags.includes("vitals_review") || activeTraceTags.includes("work_of_breathing_assessment")
            ? "vitals_concerning"
            : "baseline",
    alarmState: activeTraceTags.includes("urgent_escalation")
      ? "urgent_attention"
      : activeTraceTags.includes("vitals_review") || activeTraceTags.includes("work_of_breathing_assessment") || activeTraceTags.includes("oxygen_request")
        ? "soft_warning"
        : "quiet",
    alarmCueMode: activeTraceTags.includes("vitals_review")
      || activeTraceTags.includes("work_of_breathing_assessment")
      || activeTraceTags.includes("oxygen_request")
      || activeTraceTags.includes("urgent_escalation")
      ? "visual_only_no_audio"
      : "none",
    environmentMotionCueMode: activeTraceTags.length > 0 ? "deterministic_visual_pulse" : "none",
    propStateCueIds: [
      "monitor-waveform-card",
      "monitor-vitals-badge",
      "ekg-leads-on-bed",
      "ecg-paper-strip",
      "nurse-task-tray",
      "call-light-remote",
      "ceiling-exam-light",
      "doorway-escalation-badge",
      ...activeRuntimeEquipmentIds,
    ],
    activePropIds: [
      ...(activeTraceTags.includes("vitals_review") ? ["monitor-waveform-card", "monitor-vitals-badge"] : []),
      ...(activeTraceTags.includes("ecg_request") ? ["ekg-leads-on-bed", "ecg-paper-strip", "nurse-task-tray", "call-light-remote"] : []),
      ...(activeTraceTags.includes("urgent_escalation") ? ["ceiling-exam-light", "doorway-escalation-badge"] : []),
      ...activeRuntimeEquipmentIds,
    ],
    productionClinicalMonitoringClaimed: false,
    notEvidenceFor: ["clinical_validity", "scoring_validity", "quest_readiness"],
  };
  window.__openClinXrEnvironmentStateEvidence = evidence;
  applyEnvironmentStateVisuals(evidence);
  applyRuntimeEquipmentTraceVisuals(evidence);
  roomStateSummary.textContent = [
    `monitor ${evidence.monitorState}`,
    `alarm ${evidence.alarmState}`,
    evidence.activePropIds.length > 0 ? `active ${evidence.activePropIds.join(", ")}` : "no active props",
  ].join(" | ");
  return evidence;
}

function applyRuntimeEquipmentTraceVisuals(evidence: EnvironmentStateEvidence): void {
  const activeEquipmentIds = new Set(evidence.activePropIds);
  for (const [assetId, slot] of runtimeEquipmentSlotsByAssetId) {
    const active = activeEquipmentIds.has(assetId);
    const marker = ensureRuntimeEquipmentTraceMarker(slot, assetId);
    marker.visible = active;
    slot.userData.openClinXrTraceLinkedEquipmentActive = active;
    slot.userData.openClinXrTraceLinkedActiveTraceTags = active
      ? evidence.activeTraceTags.filter((tag) => runtimeEquipmentIdsForTraceTag(tag).includes(assetId))
      : [];
  }
}

function ensureRuntimeEquipmentTraceMarker(slot: Group, assetId: string): Mesh {
  const markerName = `${runtimeSceneObjectPrefix()}.equipment-trace-active.${assetId}`;
  const existing = slot.children.find((child): child is Mesh => child instanceof Mesh && child.name === markerName);
  if (existing) {
    return existing;
  }
  const marker = new Mesh(
    new BoxGeometry(0.28, 0.035, 0.028),
    new MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.82 }),
  );
  marker.name = markerName;
  marker.position.set(0, 0.72, 0);
  marker.userData.openClinXrTraceLinkedEquipmentCue =
    "active_when_case_trace_references_this_runtime_equipment";
  marker.visible = false;
  slot.add(marker);
  return marker;
}

function runtimeEquipmentIdsForTraceTag(tag: string): string[] {
  const equipmentIds = encounterRuntimeAssetBundle.equipment.map((equipment) => equipment.equipmentId);
  const includes = (pattern: RegExp) => equipmentIds.filter((equipmentId) => pattern.test(equipmentId));
  if (/oxygen|spo2|saturation|vitals/i.test(tag)) {
    return includes(/oxygen|pulse_ox|monitor|wall_port/i);
  }
  if (/bronchodilator|nebulizer|inhaler|spacer/i.test(tag)) {
    return includes(/nebulizer|inhaler|spacer|oxygen/i);
  }
  if (/trigger/i.test(tag)) {
    return includes(/parent_chair|stretcher|bed/i);
  }
  if (/urgent|escalation|safety/i.test(tag)) {
    return includes(/oxygen|pulse_ox|parent_chair|stretcher|bed/i);
  }
  if (/work_of_breathing|assessment|exam/i.test(tag)) {
    return includes(/stretcher|bed|pulse_ox|monitor/i);
  }
  if (/parent|family|guardian|empathy|communication/i.test(tag)) {
    return includes(/parent_chair|stretcher|bed/i);
  }
  if (/note|documentation/i.test(tag)) {
    return includes(/stretcher|bed|parent_chair|pulse_ox|monitor/i);
  }
  return [];
}

function applyEnvironmentStateVisuals(evidence: EnvironmentStateEvidence): void {
  const activeProps = new Set(evidence.activePropIds);
  for (const [propId, group] of environmentReactiveProps) {
    const active = activeProps.has(propId);
    group.userData.openClinXrEnvironmentStateActive = active;
    group.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshBasicMaterial) {
        object.material.opacity = active ? 0.95 : 0.82;
      }
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
        const material = object.material;
        const baseColorHex = typeof material.userData.openClinXrBaseColorHex === "number"
          ? material.userData.openClinXrBaseColorHex
          : material.color.getHex();
        material.userData.openClinXrBaseColorHex = baseColorHex;
        material.color.copy(new Color(baseColorHex)).lerp(new Color(0xfff2a8), active ? 0.32 : 0);
        material.emissive.setHex(active ? 0x3a2f08 : 0x000000);
        material.emissiveIntensity = active ? 0.35 : 0;
        material.needsUpdate = true;
      }
    });
    group.scale.setScalar(active ? 1.08 : 1);
  }
  const alarmActive = evidence.alarmCueMode === "visual_only_no_audio";
  for (const propId of ["ceiling-exam-light", "monitor-waveform-card"]) {
    const group = environmentReactiveProps.get(propId);
    if (group) {
      group.userData.openClinXrVisualAlarmCue = alarmActive ? evidence.alarmState : "quiet";
    }
  }
}

function updateTraceActionHandoffEvidence(): XrTraceActionHandoffEvidence {
  const evidence = buildXrTraceActionHandoffEvidence({
    state,
    actions: traceActionHandoffActions,
    generatedAtMs: roundPerformanceNow(),
    lastTraceLatencyEvidence: window.__openClinXrTraceLatencyEvidence ?? null,
  });
  window.__openClinXrTraceActionHandoffEvidence = evidence;
  updateTraceInteractionEvidenceSummary(evidence);
  return evidence;
}

function updateTraceInteractionEvidenceSummary(
  handoff: XrTraceActionHandoffEvidence | null | undefined,
): XrTraceInteractionEvidenceSummary {
  const summary = buildXrTraceInteractionEvidenceSummary(handoff);
  window.__openClinXrTraceInteractionEvidenceSummary = summary;
  evidenceTraceInteraction.textContent = [
    summary.latestTraceTag ?? "no learner action",
    summary.latestTraceSource ?? "no source",
    summary.sourceClass,
    `${summary.observedRequiredCount}/${summary.requiredCount} required`,
    summary.nextMissingTraceTag ? `next ${summary.nextMissingTraceTag}` : "all required observed",
    summary.reviewSafe ? "review-safe" : "review pending",
    summary.claimBoundary,
  ].join(" | ");
  return summary;
}

function completeNextTraceActionFromXrSelect(
  isFullVrPresenting: () => boolean,
  source: XrHeadsetSelectSource = "xr_controller_select",
): boolean {
  const tag = isFullVrPresenting()
    ? state.requiredTraceTags.find((candidate) => !state.completedTraceTags.includes(candidate))
    : undefined;
  if (!tag) {
    return false;
  }
  completeTraceActionFromInput(tag, source);
  return true;
}

function classifyXrSelectSource(event: XrSelectControllerEvent): XrHeadsetSelectSource {
  return event.data?.hand ? "xr_hand_select" : "xr_controller_select";
}

async function initializeRemoteTraceSession(client: StationApiClient | undefined): Promise<void> {
  if (!client) {
    return;
  }

  try {
    const session = await client.startSession({
      learnerId: "quest3_local_learner",
      consentAccepted: true,
    });
    remoteStationRunId = session.stationRunId;
    await client.startEncounter(session.stationRunId, { atSecond: 0 });
  } catch {
    remoteStationRunId = undefined;
  }
}

async function recordRemoteTraceAction(
  tag: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  if (!stationApi || !remoteStationRunId) {
    return;
  }

  const atSecond = state.elapsedSecond;
  try {
    const actorId =
      (typeof payload?.actorId === "string" ? payload.actorId : undefined) ?? actorIdForTraceTag(tag, state.scenarioId);
    await stationApi.recordTraceAction(remoteStationRunId, {
      eventType: eventTypeForTraceTag(tag),
      atSecond,
      tag,
      ...(actorId ? { actorId } : {}),
      ...(payload
        ? {
            payload: {
              region: payload.region,
              responseKind: payload.responseKind,
              dialogueLine: payload.dialogueLine,
              notEvidenceFor: payload.notEvidenceFor,
            },
          }
        : {}),
    });
  } catch {
    remoteStationRunId = undefined;
    return;
  }

  const actorTurn = remoteActorTurnForTraceTag(tag, state.scenarioId);
  if (!actorTurn) {
    return;
  }

  try {
    const actorResponse = await stationApi.requestActorResponse(remoteStationRunId, {
      actorId: actorTurn.actorId,
      learnerUtterance: actorTurn.learnerUtterance,
      atSecond,
      traceContextTags: actorTurn.traceContextTags,
    });
    const text = actorResponseTextFromApiResult(actorResponse);
    if (text) {
      const liveTurn = resolveLiveActorTurnForTrace(tag);
      const caption = liveTurn?.caption ?? text;
      dialogueLine.textContent = caption;
      triggerHumanoidDialogue(
        actorTurn.actorId,
        caption,
        localDialogueGazeTargetForTraceTag(tag),
        liveTurn?.faceEmotion,
        undefined,
        liveTurn ? "plan.dialogueEmotionTo" : undefined,
      );
      await stationApi.synthesizeActorSpeech(remoteStationRunId, {
        actorId: actorTurn.actorId,
        voiceId: actorTurn.voiceId,
        text,
        atSecond,
      });
    }
  } catch {
    // Remote dialogue is useful evidence, but local headset tracing should continue if model or voice providers fail.
  }
}

function updateReadiness(): void {
  const summary = summarizeTraceReadiness(state);
  traceSummary.textContent = `Trace ${summary.observedCount}/${state.requiredTraceTags.length}`;
  updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
}

function dialogueFor(tag: string): string {
  const runtimeTurn = runtimeDialogueTurnForTraceTag(tag);
  if (runtimeTurn) return runtimeTurn.text;
  const scenarioId = selectedScenarioId();
  if (isPedsAsthmaScenario(scenarioId)) {
    return learnerVisiblePedsDialogueForTraceTag(tag) ?? "System: Trace event recorded.";
  }
  const lines: Record<string, string> = {
      history_opqrst: "Robert Hayes: It started about half an hour ago while I was walking upstairs.",
      vitals_review: "Nurse Alvarez: His pressure is dropping and he looks more diaphoretic.",
      ecg_request: "Nurse Alvarez: I will get the ECG now and call it out as soon as it prints.",
      urgent_escalation: "Spouse: Are you saying this could be his heart?",
      team_communication: "Nurse Alvarez: Clear plan. ECG, IV access, and senior physician notified.",
      patient_note_submitted: "System: Patient note saved for faculty review.",
    };
  if (scenarioId === "telehealth_diabetes_health_literacy_v1") {
    return {
      history_opqrst: "Luis Martinez: I sometimes skip pills when I am worried about cost.",
      risk_factor_question: "Luis Martinez: I nod along, but I do not always understand the portal words.",
      associated_symptom_question: "Luis Martinez: I felt shaky twice this week after taking the medicine.",
      vitals_review: "Elena Martinez: We have home glucose numbers, but they are not organized.",
      team_communication: "Elena Martinez: I can help, but please make sure my dad understands the plan.",
      family_communication: "Elena Martinez: I can support him if the instructions are simple.",
      empathy_statement: "Luis Martinez: It helps when you say this is common and explain it plainly.",
      patient_note_submitted: "System: Patient note saved for faculty review.",
    }[tag] ?? "System: Trace event recorded.";
  }
  if (scenarioId !== "ed_chest_pain_priority_v1") {
    const primaryActor = actorNameplateLabel("", runtimePatientActorId()).replace(/^: /u, "") || "Patient";
    const secondaryActor = actorNameplateLabel("", runtimeFamilyActorId()).replace(/^: /u, "") || "Care team";
    const genericLines: Record<string, string> = {
      history_opqrst: `${primaryActor}: I can tell you what has been happening if we go step by step.`,
      risk_factor_question: `${primaryActor}: There may be details I only mention if asked clearly.`,
      associated_symptom_question: `${primaryActor}: I have noticed a few related symptoms that worry me.`,
      vitals_review: `${secondaryActor}: I can help review the available status information.`,
      ecg_request: `${secondaryActor}: I will help gather the next piece of clinical information.`,
      urgent_escalation: `${secondaryActor}: I need to know when this becomes urgent.`,
      team_communication: `${secondaryActor}: A clear shared plan will help the team respond.`,
      family_communication: `${secondaryActor}: Please include us in a way that supports the patient.`,
      empathy_statement: `${primaryActor}: It helps when you acknowledge how stressful this feels.`,
      patient_note_submitted: "System: Patient note saved for faculty review.",
    };
    return genericLines[tag] ?? "System: Trace event recorded.";
  }
  return lines[tag] ?? "System: Trace event recorded.";
}

function runtimeDialogueTurnForTraceTag(tag: string) {
  return encounterRuntimeAssetBundle.sceneManifest.dialogueTurns?.find((turn) => turn.traceTag === tag);
}

async function updateXrStatus(): Promise<void> {
  const navigatorWithXr = navigator as NavigatorWithXr;
  if (!navigatorWithXr.xr) {
    runtimeWebXrSupportEvidence = {
      navigatorXrPresent: false,
      immersiveVrSupported: null,
      immersiveVrSupportCheckedAtMs: roundPerformanceNow(),
      immersiveArSupported: null,
      immersiveArSupportCheckedAtMs: null,
      supportError: "navigator.xr_missing",
    };
    xrStatus.textContent = "WebXR unavailable";
    enterXrButton.disabled = true;
    updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
    return;
  }
  try {
    const immersiveVrSupported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
    const immersiveVrSupportCheckedAtMs = roundPerformanceNow();
    let immersiveArSupported: boolean | null = null;
    let immersiveArSupportCheckedAtMs: number | null = null;
    let supportError: string | null = null;
    try {
      immersiveArSupported = await navigatorWithXr.xr.isSessionSupported("immersive-ar");
      immersiveArSupportCheckedAtMs = roundPerformanceNow();
    } catch (error) {
      supportError = `immersive_ar:${formatUnknownError(error)}`;
    }
    runtimeWebXrSupportEvidence = {
      navigatorXrPresent: true,
      immersiveVrSupported,
      immersiveVrSupportCheckedAtMs,
      immersiveArSupported,
      immersiveArSupportCheckedAtMs,
      supportError,
    };
    xrStatus.textContent = immersiveVrSupported ? "Full VR ready" : "WebXR unavailable";
    enterXrButton.disabled = !immersiveVrSupported;
    updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
  } catch (error) {
    runtimeWebXrSupportEvidence = {
      navigatorXrPresent: true,
      immersiveVrSupported: null,
      immersiveVrSupportCheckedAtMs: roundPerformanceNow(),
      immersiveArSupported: null,
      immersiveArSupportCheckedAtMs: null,
      supportError: `immersive_vr:${formatUnknownError(error)}`,
    };
    xrStatus.textContent = "WebXR check blocked";
    enterXrButton.disabled = true;
    updateRuntimePosturePanel(window.__openClinXrManualPerformanceCaptureSummary ?? null);
  }
}

function buildRuntimeReproducibilityEvidence(): ManualPerformanceReproducibilityEvidence {
  return buildManualPerformanceReproducibility({
    url: window.location.href,
    userAgent: navigator.userAgent,
    app: __OPENCLINXR_UI_XR_APP_METADATA__,
    webXr: runtimeWebXrSupportEvidence,
    display: {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen?.width ?? null,
      screenHeight: window.screen?.height ?? null,
      devicePixelRatio: window.devicePixelRatio,
      visibilityState: document.visibilityState,
    },
  });
}

function updateRuntimePosturePanel(captureSummary: ManualPerformanceCaptureSummary | null): RuntimeEvidencePosture {
  const now = performance.now();
  const posture = buildRuntimeEvidencePosture({
    traceSummary: summarizeTraceReadiness(state),
    captureSummary,
    webXrSupport: runtimeWebXrSupportEvidence,
    traceActionHandoffEvidence: window.__openClinXrTraceActionHandoffEvidence ?? null,
    runtimeInteractionEvidence: latestRuntimeInteractionEvidence,
    runtimeNowMs: now,
  });
  const lanes = new Map(posture.lanes.map((lane) => [lane.id, lane]));
  const readinessDecision = buildXrRuntimeReadinessDecision({
    posture,
    iwsdkStationMcpSmokeReady: false,
  });
  window.__openClinXrRuntimeEvidencePosture = posture;
  window.__openClinXrRuntimeReadinessDecision = readinessDecision;
  postureSummary.textContent = posture.summary;
  postureModel.textContent = formatRuntimePostureLane(lanes.get("model_dialogue"));
  postureVoice.textContent = formatRuntimePostureLane(lanes.get("voice_synthesis"));
  postureQuest.textContent = formatRuntimePostureLane(lanes.get("quest_foreground"));
  postureMr.textContent = formatRuntimePostureLane(lanes.get("mixed_reality"));
  postureBundleGate.textContent = formatLearnerRuntimeUseGate(window.__openClinXrLearnerRuntimeUseGateEvidence ?? null);
  postureLaunch.textContent = formatRuntimeReadinessDecision(readinessDecision);
  return posture;
}

function formatLearnerRuntimeUseGate(evidence: LearnerRuntimeUseGateEvidence | null): string {
  if (!evidence) {
    return "bundle gate pending";
  }
  const gateText = evidence.blockingGateIds.length > 0
    ? `blocking ${evidence.blockingGateIds.join(", ")}`
    : "required gates attached";
  const sourceText = evidence.fallbackActive
    ? `using ${evidence.activeBundleSource}`
    : `using ${evidence.activeBundleSource}`;
  const generatedText = evidence.generatedBundleLearnerUseBlocked
    ? "generated learner use blocked"
    : evidence.approvedLocalFixtureOnly
      ? "approved local fixture assets only"
      : "generated learner use gate clear";
  const materializationText = evidence.actorEquipmentMaterializationGate?.runtimeSelectionBlockedUntilEvidenceAttached
    ? `actor/equipment materialization blocked ${[
      ...evidence.actorEquipmentMaterializationGate.actorBlockers,
      ...evidence.actorEquipmentMaterializationGate.equipmentBlockers,
    ].join(", ")}${formatMaterializationAttachmentSummary(evidence.actorEquipmentMaterializationGate.materializationEvidenceAttachmentSummary)}${formatRemainingRuntimeBlockerReasons(evidence.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons)}`
    : "actor/equipment materialization gate not attached";
  return [
    sourceText,
    generatedText,
    gateText,
    materializationText,
    evidence.fallbackReason ? `fallback ${evidence.fallbackReason}` : "no production/clinical/scoring claim",
  ].join(" | ");
}

function formatRemainingRuntimeBlockerReasons(
  reasons: RuntimeRemainingRuntimeBlockerReasons | null | undefined,
): string {
  if (!reasons) {
    return "";
  }
  const categories = reasons.categories.map((category) => `${category.category}:${category.blockerIds.join("+")}`).join(", ");
  return `; remaining runtime blockers after materialization complete ${String(reasons.materializationEvidenceComplete)}: ${categories}; runtime ${reasons.runtimeSelectionAllowed ? "allowed" : "blocked"}`;
}

function formatMaterializationAttachmentSummary(
  summary: RuntimeMaterializationEvidenceAttachmentSummary | null | undefined,
): string {
  if (!summary) {
    return "";
  }
  return `; materialization evidence slots ${summary.attachedSlotCount}/${summary.totalRequiredSlotCount} attached, ${summary.missingSlotCount} missing, runtime ${summary.runtimeSelectionAllowed ? "allowed" : "blocked"}`;
}

function formatRuntimePostureLane(lane: RuntimeEvidencePosture["lanes"][number] | undefined): string {
  if (!lane) {
    return "missing";
  }
  const blockerText = lane.blockers.length === 0
    ? "no blockers"
    : `${lane.blockers.length} ${lane.blockers.length === 1 ? "blocker" : "blockers"}`;
  return `${lane.display}; ${blockerText}`;
}

function formatRuntimeReadinessDecision(decision: XrRuntimeReadinessDecision): string {
  return [
    decision.learnerLaunchReady ? "learner launch ready" : "learner launch blocked",
    `${decision.blockerCount} blockers`,
    `next ${decision.recommendedNextAction}`,
  ].join(" | ");
}

type ScenarioDoorwayVisualTheme = {
  backgroundColor: number;
  floorColor: number;
  panelBackground: string;
  panelAccent: string;
  reusedAssetAccentColor: number;
};

function scenarioDoorwayVisualTheme(): ScenarioDoorwayVisualTheme {
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;
  if (scenarioId === "peds_asthma_parent_anxiety_v1") {
    return { backgroundColor: 0x102432, floorColor: 0x60737a, panelBackground: "#eef9ff", panelAccent: "#0ea5e9", reusedAssetAccentColor: 0x0ea5e9 };
  }
  if (scenarioId === "ed_chest_pain_priority_v1") {
    return { backgroundColor: 0x151b22, floorColor: 0x59636b, panelBackground: "#f1f5f9", panelAccent: "#dc2626", reusedAssetAccentColor: 0xdc2626 };
  }
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    return { backgroundColor: 0xe9dfd6, floorColor: 0x756f78, panelBackground: "#fff4f2", panelAccent: "#db2777", reusedAssetAccentColor: 0xdb2777 };
  }
  if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    return { backgroundColor: 0x12261e, floorColor: 0x5f7167, panelBackground: "#f0fdf4", panelAccent: "#16a34a", reusedAssetAccentColor: 0x16a34a };
  }
  if (scenarioId === "oncology_bad_news_family_v1") {
    return { backgroundColor: 0x1d1a24, floorColor: 0x686273, panelBackground: "#f8f5ff", panelAccent: "#7c3aed", reusedAssetAccentColor: 0x7c3aed };
  }
  if (scenarioId === "postop_fever_consult_pressure_v1") {
    return { backgroundColor: 0x241812, floorColor: 0x73665d, panelBackground: "#fff7ed", panelAccent: "#ea580c", reusedAssetAccentColor: 0xea580c };
  }
  return { backgroundColor: 0x101820, floorColor: 0x55606b, panelBackground: "#eef7f4", panelAccent: "#0f766e", reusedAssetAccentColor: 0x0f766e };
}

function addReusableExteriorPreEncounterRoom(scene: Scene, doorwayTheme: ScenarioDoorwayVisualTheme): void {
  const exterior = new Group();
  reusableExteriorAnteroom = exterior;
  exterior.name = "openclinxr.reusable-pre-encounter-anteroom";
  exterior.userData.openClinXrReusableExteriorRoomPolicy =
    "reused_between_encounters_for_doorway_orientation_and_patient_note_capture_only";
  exterior.userData.openClinXrPortalPolicy =
    "clinical_world_beyond_doorway_is_generated_from_active_encounter_runtime_bundle";

  const exteriorFloor = new Mesh(new BoxGeometry(7, 0.082, 1.7), new MeshStandardMaterial({ color: 0x3f4852, roughness: 0.86 }));
  exteriorFloor.name = "openclinxr.reusable-pre-encounter-anteroom.floor";
  exteriorFloor.position.set(0, -0.035, 1.82);
  exteriorFloor.userData.openClinXrSceneNecessityPolicy = "reusable_exterior_floor_for_pre_encounter_note_capture_not_clinical_environment";
  exterior.add(exteriorFloor);

  const portalWallMaterial = new MeshStandardMaterial({ color: 0x111827, roughness: 0.92 });
  const leftWall = new Mesh(new BoxGeometry(0.72, 2.58, 0.045), portalWallMaterial);
  leftWall.name = "openclinxr.reusable-pre-encounter-anteroom.portal-left-wall";
  leftWall.position.set(-2.35, 1.25, 0.9);
  leftWall.userData.openClinXrPortalWallPolicy = "static_reusable_wall_segment_leaving_dynamic_encounter_window_open";
  exterior.add(leftWall);
  const rightWall = new Mesh(new BoxGeometry(0.72, 2.58, 0.045), portalWallMaterial);
  rightWall.name = "openclinxr.reusable-pre-encounter-anteroom.portal-right-wall";
  rightWall.position.set(2.35, 1.25, 0.9);
  rightWall.userData.openClinXrPortalWallPolicy = "static_reusable_wall_segment_leaving_dynamic_encounter_window_open";
  exterior.add(rightWall);
  const headerWall = new Mesh(new BoxGeometry(5.35, 0.34, 0.045), portalWallMaterial);
  headerWall.name = "openclinxr.reusable-pre-encounter-anteroom.portal-header-wall";
  headerWall.position.set(0, 2.45, 0.9);
  headerWall.userData.openClinXrPortalWallPolicy = "static_reusable_header_above_dynamic_encounter_window";
  exterior.add(headerWall);

  const portalOpening = new Mesh(new BoxGeometry(3.75, 2.0, 0.025), new MeshStandardMaterial({
    color: doorwayTheme.backgroundColor,
    roughness: 0.7,
    emissive: doorwayTheme.backgroundColor,
    emissiveIntensity: 0.18,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  }));
  portalOpening.name = `${runtimeSceneObjectPrefix()}.encounter-portal-dynamic-opening`;
  portalOpening.position.set(0, 1.18, 0.86);
  portalOpening.userData.openClinXrPortalOpeningPolicy =
    "portal_surface_color_and_identity_derive_from_active_encounter_runtime_bundle";
  exterior.add(portalOpening);

  const portalFrameMaterial = new MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.62 });
  const portalAccentMaterial = new MeshStandardMaterial({ color: doorwayTheme.reusedAssetAccentColor, roughness: 0.54, emissive: doorwayTheme.reusedAssetAccentColor, emissiveIntensity: 0.12 });
  const leftJamb = new Mesh(new BoxGeometry(0.12, 2.2, 0.12), portalFrameMaterial);
  leftJamb.name = "openclinxr.reusable-pre-encounter-anteroom.portal-left-jamb";
  leftJamb.position.set(-1.95, 1.15, 0.74);
  exterior.add(leftJamb);
  const rightJamb = new Mesh(new BoxGeometry(0.12, 2.2, 0.12), portalFrameMaterial);
  rightJamb.name = "openclinxr.reusable-pre-encounter-anteroom.portal-right-jamb";
  rightJamb.position.set(1.95, 1.15, 0.74);
  exterior.add(rightJamb);
  const lintel = new Mesh(new BoxGeometry(4.02, 0.12, 0.12), portalFrameMaterial);
  lintel.name = "openclinxr.reusable-pre-encounter-anteroom.portal-lintel";
  lintel.position.set(0, 2.25, 0.74);
  exterior.add(lintel);
  const threshold = new Mesh(new BoxGeometry(4.1, 0.06, 0.18), portalAccentMaterial);
  threshold.name = `${runtimeSceneObjectPrefix()}.encounter-portal-dynamic-threshold`;
  threshold.position.set(0, 0.02, 0.72);
  threshold.userData.openClinXrPortalThresholdPolicy = "crossing_threshold_enters_dynamic_encounter_world";
  exterior.add(threshold);

  const notePanel = createReadableVrTextPanel({
    name: "openclinxr.reusable-pre-encounter-anteroom.patient-note-capture-cue",
    title: "Pre-Encounter",
    lines: [
      "Review doorway context, then enter.",
      "Patient note capture remains in this reusable exterior room.",
      "Clinical scene beyond portal is encounter-generated.",
    ],
    widthMeters: 1.55,
    heightMeters: 0.72,
    background: "#f8fafc",
    accent: "#64748b",
  });
  notePanel.mesh.position.set(-2.3, 1.35, 1.08);
  notePanel.mesh.rotation.y = 0.46;
  notePanel.mesh.userData.openClinXrReusableExteriorNotePolicy =
    "note_capture_affordance_reused_outside_dynamic_clinical_world";
  exterior.add(notePanel.mesh);

  if (shouldUseCleanHumanoidSourceComparatorCapture()) {
    exterior.visible = false;
    exterior.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  scene.add(exterior);
}

const portalThresholdZ = 0.72;
let portalEncounterEntered = false;
let portalEncounterStartedByPortal = false;
let portalLastTransitionReason: string | null = null;
let reusableExteriorAnteroom: Group | null = null;

function selectedPortalPreviewStart(): PortalTransitionEvidence["deterministicPreviewStart"] {
  const params = new URLSearchParams(window.location.search);
  const selected = params.get("openclinxrPortalStart")?.trim() ?? "";
  if (selected === "exterior" || selected === "exterior_note_room") return "exterior_note_room";
  if (selected === "threshold" || selected === "portal_threshold") return "portal_threshold";
  if (selected === "encounter" || selected === "dynamic_encounter_world") return "dynamic_encounter_world";
  return null;
}

function applyDeterministicPortalPreviewStart(locomotionRig: Group): void {
  const selected = selectedPortalPreviewStart();
  if (!selected) return;
  if (selected === "exterior_note_room") {
    locomotionRig.position.z = 1.35;
  } else if (selected === "portal_threshold") {
    locomotionRig.position.z = portalThresholdZ;
  } else {
    locomotionRig.position.z = -0.62;
  }
  portalLastTransitionReason = `deterministic_portal_preview_start_${selected}`;
}

function updatePortalTransitionEvidence(locomotionRig: Group, camera: PerspectiveCamera): PortalTransitionEvidence {
  const headWorldPosition = new Vector3();
  camera.getWorldPosition(headWorldPosition);
  const headWorldZ = Number(headWorldPosition.z.toFixed(3));
  const locomotionRigZ = Number(locomotionRig.position.z.toFixed(3));
  const desktopPreviewCameraOffsetZ = Number(camera.position.z.toFixed(3));
  const transitionProbeZ = Number((headWorldZ - desktopPreviewCameraOffsetZ).toFixed(3));
  const side: PortalTransitionEvidence["side"] = transitionProbeZ > portalThresholdZ + 0.25
    ? "exterior_note_room"
    : transitionProbeZ >= portalThresholdZ - 0.25
      ? "portal_threshold"
      : "dynamic_encounter_world";
  if (!portalEncounterEntered && side === "dynamic_encounter_world") {
    portalEncounterEntered = true;
    portalEncounterStartedByPortal = examFlowPhase === "encounter";
    portalLastTransitionReason = "portal_crossed_into_dynamic_encounter_world";
    if (examFlowPhase === "encounter") {
      examLastAdvanceReason = "portal_crossing_started_or_resumed_encounter";
    }
  }
  const portalInteriorHiddenObjectNames = updateReusableExteriorAnteroomVisibility(side);
  const reusableExteriorHiddenForEncounterView = side === "dynamic_encounter_world";
  const evidence: PortalTransitionEvidence = {
    source: "window.__openClinXrPortalTransitionEvidence",
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    portalThresholdZ,
    headWorldZ,
    locomotionRigZ,
    desktopPreviewCameraOffsetZ,
    transitionProbeZ,
    side,
    encounterEntered: portalEncounterEntered,
    encounterStartedByPortal: portalEncounterStartedByPortal,
    deterministicPreviewStart: selectedPortalPreviewStart(),
    reusableExteriorHiddenForEncounterView,
    portalInteriorHiddenObjectNames,
    noteCaptureLocation: "reusable_exterior_anteroom",
    lastTransitionReason: portalLastTransitionReason,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "motion_comfort_validation"],
  };
  window.__openClinXrPortalTransitionEvidence = evidence;
  return evidence;
}

function updateReusableExteriorAnteroomVisibility(side: PortalTransitionEvidence["side"]): string[] {
  if (!reusableExteriorAnteroom) return [];
  const hiddenObjectNames: string[] = [];
  const insideDynamicEncounter = side === "dynamic_encounter_world";
  reusableExteriorAnteroom.traverse((object) => {
    if (
      object.name.includes("patient-note-capture-cue")
      || object.name.includes("portal-left-wall")
      || object.name.includes("portal-right-wall")
      || object.name.includes("portal-header-wall")
      || object.name.includes("portal-left-jamb")
      || object.name.includes("portal-right-jamb")
      || object.name.includes("portal-lintel")
      || object.name.includes("encounter-portal-dynamic-threshold")
      || object.name.includes("encounter-portal-dynamic-opening")
      || object.name.endsWith(".floor")
      || object.userData.openClinXrPortalInteriorReviewAffordance === true
    ) {
      object.visible = !insideDynamicEncounter;
      object.userData.openClinXrPortalInteriorVisibilityPolicy =
        "hidden_after_portal_entry_so_reusable_note_shell_and_frame_do_not_occlude_dynamic_encounter_world";
      if (insideDynamicEncounter) hiddenObjectNames.push(object.name);
    }
  });
  return hiddenObjectNames;
}

function createStationScene(): StationSceneRuntime {
  recordBootPhase("station_scene_start");
  const doorwayTheme = scenarioDoorwayVisualTheme();
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(doorwayTheme.backgroundColor);
  let activeXrSession: XrSession | undefined;
  let lastLocomotionAtMs: number | null = null;
  let previousRoomScalePose: RigPoseEvidence | null = null;
  let lastAnimateAtMs = performance.now();
  let lastRenderLoopAtMs = 0;
  /** #342b — one-shot latch for the derived interior preview camera. */
  let interiorPreviewCameraApplied = false;
  const flatPreviewFallbackFrameMs = 1000 / 30;

  const scene = new Scene();
  scene.name = iwsdkStationSceneObjects.stationRoot;
  window.__openClinXrDebugScene = scene;
  comparatorCaptureSceneRoot = scene;
  scene.background = new Color(doorwayTheme.backgroundColor);
  scene.userData.openClinXrEncounterDoorwayTheme = {
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    backgroundColor: doorwayTheme.backgroundColor,
    floorColor: doorwayTheme.floorColor,
    reusedAssetAccentColor: doorwayTheme.reusedAssetAccentColor,
    policy: "encounter_specific_theme_applied_to_reused_runtime_assets_no_hardcoded_scene_identity",
  };

  const locomotionRig = new Group();
  locomotionRig.name = `${runtimeSceneObjectPrefix()}.locomotion-rig`;
  applyDeterministicPortalPreviewStart(locomotionRig);
  scene.add(locomotionRig);

  const faceDetailCapture = isHumanoidFaceDetailCaptureMode();
  const actorPoseReviewCapture = isActorPoseReviewCaptureMode();
  const actorCloseCapture = isActorCloseRealismCaptureMode() || actorPoseReviewCapture;
  const generatedSceneOverviewCapture = isGeneratedSceneOverviewCaptureMode();
  const cleanHumanoidSourceComparatorCapture = shouldUseCleanHumanoidSourceComparatorCapture();
  const selectedScenarioRuntimeMismatch = isSelectedScenarioRuntimeBundleMismatch();
  reportRuntimeBundleScenarioMatch();
  const selectedStationContext = stationContextForSelectedScenario();
  const camera = new PerspectiveCamera(faceDetailCapture ? 48 : generatedSceneOverviewCapture ? 60 : actorCloseCapture ? 42 : 52, 1, 0.1, 100);
  // #342b — only the product's own wide default framing is re-derived for a closed generated
  // room. The capture framings below are authored for a specific subject (a face, one actor)
  // and their harnesses do their own reframing; replacing them with a far-wall vantage would
  // destroy the close-up they exist to take.
  let usesAuthoredWideDefaultFraming = false;
  if (faceDetailCapture) {
    camera.position.set(-0.72, 1.54, 3.25);
    camera.lookAt(-0.72, 1.44, -0.12);
    camera.userData.openClinXrCameraFraming = "runtime_patient_humanoid_face_lip_eye_detail_capture";
  } else if (generatedSceneOverviewCapture) {
    camera.position.set(0.18, 1.32, 4.35);
    camera.lookAt(0.02, 1.02, -0.08);
    camera.userData.openClinXrCameraFraming = "generated_scene_overview_multi_actor_dynamic_encounter_capture_clinical_focus";
  } else if (cleanHumanoidSourceComparatorCapture) {
    if (selectedHumanoidSourceComparator() === "peds_anny_mpfb2_eye_rig_patient") {
      camera.fov = 58;
      camera.position.set(-0.88, 0.72, 3.55);
      camera.lookAt(-0.88, 0.02, 0.12);
      camera.userData.openClinXrCameraFraming = "clean_peds_anny_mpfb2_source_comparator_full_body_candidate_capture";
    } else if (selectedHumanoidSourceComparator() === "peds_anny_real_garment_patient") {
      camera.fov = 48;
      camera.position.set(-0.08, 0.86, 3.45);
      camera.lookAt(-0.08, 0.82, -0.96);
      camera.userData.openClinXrCameraFraming = "clean_peds_anny_real_garment_source_comparator_full_body_candidate_capture";
    } else if (selectedHumanoidSourceComparator() === "peds_anny_real_garment_parent") {
      // bindfix re-capture: center primary humanoid (x≈0) closer so torso/sleeve cyan fills frame (≥100kB PNG)
      camera.fov = 42;
      camera.position.set(0.0, 1.05, 2.55);
      camera.lookAt(0.0, 0.95, 0.0);
      camera.userData.openClinXrCameraFraming = "clean_peds_anny_real_garment_parent_source_comparator_full_body_candidate_capture";
    } else if (selectedHumanoidSourceComparator() === "peds_anny_real_garment_nurse") {
      // bindfix re-capture: same patient-primary centering for nurse scrub sleeveDeform volume
      camera.fov = 42;
      camera.position.set(0.0, 1.05, 2.55);
      camera.lookAt(0.0, 0.95, 0.0);
      camera.userData.openClinXrCameraFraming = "clean_peds_anny_real_garment_nurse_source_comparator_full_body_candidate_capture";
    } else if (selectedHumanoidSourceComparator() === "ed_anny_real_garment_patient") {
      // ed-gown-geo-reorchestrate (Q1+Q5): expanded framing for hospital_gown sleeves (baggier adult topology vs peds tshirt); lower/closer to expose 3D deforming sleeve volume + motion in ed bay (cyan/no-cull/userData/garmentGeometry visible in screenshots)
      camera.fov = 50;
      camera.position.set(0.12, 0.92, 2.95);
      camera.lookAt(0.08, 0.68, -0.72);
      camera.userData.openClinXrCameraFraming = "clean_ed_anny_real_garment_source_comparator_full_body_ed_gown_sleeve_deform_capture_ed_bay_ed-gown-geo-reorchestrate";
    } else {
      camera.fov = 48;
      camera.position.set(-0.08, 0.86, 3.45);
      camera.lookAt(-0.08, 0.82, -0.96);
      camera.userData.openClinXrCameraFraming = "clean_humanoid_source_comparator_full_body_candidate_capture";
    }
  } else if (actorPoseReviewCapture) {
    camera.position.set(-0.12, 1.22, 4.05);
    camera.lookAt(-0.18, 1.05, -0.18);
    camera.userData.openClinXrCameraFraming = "actor_pose_review_full_body_deoccluded_capture";
  } else if (actorCloseCapture) {
    camera.position.set(-0.08, 1.36, 3.18);
    camera.lookAt(0, 1.12, -0.24);
    camera.userData.openClinXrCameraFraming = "actor_close_realism_review_face_torso_posture_capture";
  } else {
    camera.fov = 55;
    camera.position.set(0, 1.48, 5.35);
    camera.lookAt(0, 1.04, -0.18);
    camera.userData.openClinXrCameraFraming = "wide_clean_dynamic_encounter_room_review_three_actor_context";
    usesAuthoredWideDefaultFraming = true;
  }
  locomotionRig.add(camera);
  comparatorCaptureCamera = camera;

  applyStationInteriorLighting({ scene, renderer, variantId: resolveStationInteriorLightingVariantId(new URLSearchParams(window.location.search).get("stationLighting")), ambientLightName: iwsdkStationSceneObjects.ambientLight, keyLightName: iwsdkStationSceneObjects.keyLight, keyCastShadow: isCaptureShadowPath(selectedCaptureMode()) });

  addReusableExteriorPreEncounterRoom(scene, doorwayTheme);

  // #44: station shell from shared environmentId descriptor (not scenarioId doorway tint alone).
  const activeEnvironmentId = resolveActiveEnvironmentId();
  const stationEnvironment = buildStationEnvironment({ environmentId: activeEnvironmentId });
  const floor = (stationEnvironment.userData.floorMesh as Mesh | undefined)
    ?? new Mesh(new BoxGeometry(7, 0.08, 3.45), new MeshStandardMaterial({ color: doorwayTheme.floorColor, roughness: 0.8 }));
  floor.name = iwsdkStationSceneObjects.floor;
  if (isCaptureShadowPath(selectedCaptureMode())) { enableCaptureRendererShadowMap(renderer); markFloorReceiveShadow(floor); }
  floor.userData.openClinXrSceneNecessityPolicy = "dynamic_encounter_world_floor_from_environment_descriptor";
  floor.userData.openClinXrEncounterSpecificRuntimeTheme = "floor_color_derived_from_environmentId_descriptor";
  floor.userData.openClinXrPortalBoundaryPolicy = "belongs_to_dynamic_world_on_encounter_side_of_doorway";
  if (cleanHumanoidSourceComparatorCapture) {
    stationEnvironment.visible = false;
    floor.visible = false;
    floor.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  // Case-env glTF handoff (factory caseDerivedVirtualEnvironment → player load).
  // #85 + #189: NEVER load a humanoid/candidate GLB as "environment". The peds asthma
  // handoff pointed at reom-local-authored-curved-clinical-top-candidate.glb and spawned a
  // fourth nude figure (Reom/Tearline at origin) while the real parent cast was clothed at
  // family slot x≈1.42 — the nude learner saw was that orphan, not a missing garment mesh.
  floor.userData.caseDerivedVirtualEnvGltfHandoff = {
    gltfAssetUrl: null,
    policy: "gltf handoff reserved for factory-produced ROOM shells only; humanoid candidates are actors via loadGeneratedHumanoidIntoActorSlot, never environment",
    source: "factory case spec derivation + tech vet",
    producedManifestPath: (() => {
      const sid = encounterRuntimeAssetBundle.scenarioId;
      const room = sid === "peds_asthma_parent_anxiety_v1" ? "peds_asthma_clinic_exam_room" : (sid === "ed_chest_pain_priority_v1" ? "ed_trauma_bay" : null);
      return room ? `/tmp/openclinxr-produced-env-gltf-${room}.json` : null;
    })(),
    producedGltfUrl: null as string | null,
  };
  scene.add(stationEnvironment);
  scene.userData.openClinXrStationEnvironment = {
    environmentId: activeEnvironmentId,
    floorColor: stationEnvironment.userData.floorColor,
    roomDepthMeters: stationEnvironment.userData.roomDepthMeters,
    environmentFallbackActive: stationEnvironment.userData.environmentFallbackActive,
  };
  // #336: generated Infinigen room selected by environmentId; procedural box stays as fallback.
  if (!cleanHumanoidSourceComparatorCapture) {
    loadInfinigenEnvironmentIntoStation({
      scene,
      environmentId: activeEnvironmentId,
      stationEnvironment,
      onStatus: (status) => {
        stationEnvironment.userData.openClinXrInfinigenEnvironmentStatus = status;
      },
    });
  }
  // Env glTF container for factory-produced world assets.
  const gltfEnvContainer = new Group();
  gltfEnvContainer.name = `${runtimeSceneObjectPrefix()}.case-env-gltf-container`;
  gltfEnvContainer.userData.openClinXrGltfEnvHandoff = floor.userData.caseDerivedVirtualEnvGltfHandoff;
  gltfEnvContainer.userData.producedManifestPath = floor.userData.caseDerivedVirtualEnvGltfHandoff?.producedManifestPath;
  gltfEnvContainer.userData.producedGltfUrl = floor.userData.caseDerivedVirtualEnvGltfHandoff?.producedGltfUrl;
  gltfEnvContainer.userData.openClinXrLaunchTestPolicy = "virtual env world launched in player (props + gltf handoff + authoring vet from case); experience via dev server + station select";
  if (cleanHumanoidSourceComparatorCapture) {
    gltfEnvContainer.visible = false;
    gltfEnvContainer.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  }
  scene.add(gltfEnvContainer);
  // Load produced/stub env glTF into the container when available.
  const gltfUrlForActualLoad = floor.userData.caseDerivedVirtualEnvGltfHandoff?.producedGltfUrl || floor.userData.caseDerivedVirtualEnvGltfHandoff?.gltfAssetUrl;
  if (gltfUrlForActualLoad && !cleanHumanoidSourceComparatorCapture) {
    try {
      const loader = new GLTFLoader();
      loader.load(
        gltfUrlForActualLoad,
        (gltf) => {
          gltfEnvContainer.add(gltf.scene);
          gltf.scene.userData.loadedFromFactoryCaseEnv = true;
          gltf.scene.userData.cuesFromGenDrive = "emotionTimeline / runtimeExecutionHints from case spec";
          // Deeper visual cue from drive (tint/scale on env gltf or props from emotion in launched player world). Uses the deeperVisualCue carried in pedsRuntimeDrive / scaffold (fromEnv + fromEmotion). Now applied live per-frame in renderSceneFrame (using cue + current emotion cues for transitions); initial at load. Makes the env world react dynamically to gen emotion (richer integration of caseDerived env + drive). Visible in full webvr experience when station selected after turborepo launch.
          try {
            const cue = (encounterRuntimeAssetBundle.scenarioId === "peds_asthma_parent_anxiety_v1") ? "anxious_parent" : (encounterRuntimeAssetBundle.scenarioId === "ed_chest_pain_priority_v1" ? "urgent" : null);
            if (cue) {
              gltf.scene.traverse((obj) => {
                if (obj instanceof Mesh && obj.material) {
                  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
                  if (mat && mat.emissive !== undefined) {
                    mat.emissive = new Color(cue.includes("anx") || cue.includes("urgent") ? 0x1e3a5f : 0x000000);
                    mat.emissiveIntensity = 0.12;
                  }
                }
              });
              gltf.scene.userData.deeperVisualCueApplied = { cue, atLoad: true, source: "drive fromEmotion" };
            }
          } catch {
            // Non-fatal visual cue.
          }
        },
        undefined,
        (err) => {
          gltfEnvContainer.userData.actualGltfLoadError = err instanceof Error ? err.message : String(err);
          // world remains valid via the three props (exam_table etc) + container (the "produce real" manifest is in the packet/scaffold for factory to use)
        }
      );
    } catch (e) {
      gltfEnvContainer.userData.actualGltfLoadSetupError = String(e);
    }
  }
  if (!cleanHumanoidSourceComparatorCapture) {
    // Room walls/floor come from buildStationEnvironment (environmentId descriptor).
    addScenarioSpecificClinicalSetDressing(scene, doorwayTheme);
  }

  if (selectedScenarioRuntimeMismatch) {
    const mismatchPanel = createReadableVrTextPanel({
      name: `${runtimeSceneObjectPrefix()}.scenario-specific-3d-pending-panel`,
      title: `${selectedStationContext.title} 3D Pending`,
      lines: [
        "Scenario-specific 3D bundle is not loaded yet.",
        `Selected: ${selectedScenarioId()}`,
        `Fallback bundle hidden: ${encounterRuntimeAssetBundle.scenarioId}`,
        "Use factory materialization before realism review.",
      ],
      widthMeters: 2.8,
      heightMeters: 0.92,
      background: "#fff8e5",
      accent: "#d97706",
    });
    mismatchPanel.mesh.position.set(0, 1.55, -1.25);
    mismatchPanel.mesh.userData.openClinXrScenarioMismatchPolicy =
      "selected_scenario_specific_3d_pending_ed_fallback_hidden_to_prevent_false_realism_evidence";
    scene.add(mismatchPanel.mesh);
  } else if (!cleanHumanoidSourceComparatorCapture) {
    addScenarioExpectationPanel(scene, selectedStationContext);
  }

  const environmentShell = new Group();
  environmentShell.name = iwsdkStationSceneObjects.environmentShell;
  if (selectedScenarioRuntimeMismatch) {
    environmentShell.visible = false;
    environmentShell.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
  } else if (shouldSuppressGeneratedEnvironmentShell(encounterRuntimeAssetBundle.environment)) {
    environmentShell.visible = false;
    environmentShell.userData.openClinXrDynamicScenePolicy = "suppressed_mismatched_placeholder_environment_for_case_defined_scene_manifest";
  } else if (cleanHumanoidSourceComparatorCapture) {
    environmentShell.visible = false;
    environmentShell.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (actorPoseReviewCapture) {
    environmentShell.visible = false;
    environmentShell.userData.openClinXrCaptureDeclutterPolicy = "hidden_for_actor_pose_review_only";
  }
  scene.add(environmentShell);
  loadGeneratedEnvironmentIntoSceneSlot(environmentShell, {
    assetPath: resolveEmulatorRuntimeAssetUrl(encounterRuntimeAssetBundle.environment),
    assetId: encounterRuntimeAssetBundle.environment.assetId,
    objectName: runtimeGeneratedSceneObjectName(encounterRuntimeAssetBundle.environment),
  });

  const bed = new Mesh(new BoxGeometry(2.35, 0.24, 0.92), new MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.65 }));
  bed.name = iwsdkStationSceneObjects.bed;
  bed.position.set(-0.42, 0.42, -0.08);
  if (selectedScenarioRuntimeMismatch) {
    bed.visible = false;
    bed.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
  } else if (isDynamicGeneratedEncounterSceneMode()) {
    bed.visible = false;
    bed.userData.openClinXrDynamicScenePolicy = "hidden_when_scene_manifest_and_generated_environment_supply_encounter_context";
  } else if (cleanHumanoidSourceComparatorCapture) {
    bed.visible = false;
    bed.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (actorPoseReviewCapture) {
    bed.visible = false;
    bed.userData.openClinXrCaptureDeclutterPolicy = "hidden_for_actor_pose_review_only";
  }
  scene.add(bed);

  const monitor = new Mesh(new BoxGeometry(0.8, 0.55, 0.08), new MeshStandardMaterial({ color: 0x203040, emissive: 0x0b3d2e }));
  monitor.name = iwsdkStationSceneObjects.monitor;
  monitor.position.set(1.7, 1.45, -0.65);
  if (selectedScenarioRuntimeMismatch) {
    monitor.visible = false;
    monitor.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
  } else if (isDynamicGeneratedEncounterSceneMode()) {
    monitor.visible = false;
    monitor.userData.openClinXrDynamicScenePolicy = "hidden_when_scene_manifest_and_generated_environment_supply_encounter_context";
  } else if (cleanHumanoidSourceComparatorCapture) {
    monitor.visible = false;
    monitor.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (actorPoseReviewCapture) {
    monitor.position.set(1.95, 1.35, -0.92);
    monitor.userData.openClinXrCaptureDeclutterPolicy = "moved_aside_for_actor_pose_review_only";
  }
  scene.add(monitor);

  // #186 — roles owned by shell fixtures suppress dual roomProp / equipment meshes.
  const fixtureOwnedRoles = Array.isArray(stationEnvironment.userData.fixtureOwnedRoles)
    ? (stationEnvironment.userData.fixtureOwnedRoles as string[])
    : [];

  // #140 / #185 — plan equipment BEFORE room props so the XOR exclusive-mount rule
  // can skip builder-backed roomProps already claimed by the equipment channel.
  runtimeEquipmentSlotsByAssetId.clear();
  const equipmentPlan = planStationEquipmentMounts({
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    equipment: encounterRuntimeAssetBundle.equipment,
    equipmentPlacements: encounterRuntimeAssetBundle.sceneManifest.equipmentPlacements ?? {},
    fixtureOwnedRoles,
  });
  const exclusiveMountedEquipmentIds = new Set(equipmentPlan.map((item) => item.equipmentId));

  for (const prop of createDetailedEdRoomProps(
    encounterRuntimeAssetBundle.sceneManifest.roomProps,
    fixtureOwnedRoles,
    exclusiveMountedEquipmentIds,
  )) {
    if (selectedScenarioRuntimeMismatch) {
      prop.visible = false;
      prop.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
    } else if (cleanHumanoidSourceComparatorCapture || actorPoseReviewCapture) {
      prop.visible = false;
      prop.userData.openClinXrCaptureDeclutterPolicy = cleanHumanoidSourceComparatorCapture
        ? "hidden_for_clean_humanoid_source_comparator_capture"
        : "hidden_for_actor_pose_review_only";
    } else if (encounterRuntimeAssetBundle.scenarioId === "ob_headache_preeclampsia_triage_v1") {
      prop.visible = false;
      prop.userData.openClinXrObVisualReviewPolicy = "hidden_when_ob_specific_set_dressing_supplies_required_context_without_generic_prop_artifacts";
    }
    scene.add(prop);
  }

  // #140 — mount equipment declared by this station's scene manifest / bundle
  // (parametric multi-mesh for kinds without real GLBs; keep ED bay GLBs).
  const equipmentEvidenceItems: DeclaredEquipmentMountEvidence["items"] = [];
  for (const item of equipmentPlan) {
    const slot =
      item.source === "gltf"
        ? buildGltfEquipmentPlaceholderSlot(item.equipmentId)
        : buildDeclaredEquipmentGeometry(item.equipmentId);
    if (item.equipmentId === "ecg_cart_equipment" && !isDynamicGeneratedEncounterSceneMode()) {
      slot.name = iwsdkStationSceneObjects.ecgCart;
    } else if (item.equipmentId === "iv_stand_equipment" && !isDynamicGeneratedEncounterSceneMode()) {
      slot.name = iwsdkStationSceneObjects.ivPoleWithPump;
    } else {
      slot.name = `${runtimeSceneObjectPrefix()}.generated-equipment-slot.${item.equipmentId}`;
    }
    slot.position.set(item.position.x, item.position.y, item.position.z);
    slot.visible = !selectedScenarioRuntimeMismatch;
    if (cleanHumanoidSourceComparatorCapture) {
      slot.visible = false;
      slot.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
    }
    slot.userData.openClinXrRuntimeEquipmentPlacementCueIds = item.interactionCueIds;
    slot.userData.openClinXrDynamicEncounterEquipmentSlot = "manifest_declared_equipment_mount";
    slot.userData.openClinXrEquipmentDeclared = item.declared;
    // #223: roomProp ids that alias to this builder (telehealth-tablet-stand → tablet_visit…)
    // so declared-equipment inspectors match the prop declaration without dual geometry.
    stampRoomPropAliasesOnEquipmentRoot(slot, item.equipmentId);
    slot.add(createActorNameplate(item.label, item.source === "gltf" ? 0x286b54 : 0x2563eb));
    scene.add(slot);
    if (item.source === "gltf" && item.gltfFileName) {
      const bundleModel = findRuntimeEquipmentAsset(encounterRuntimeAssetBundle, item.equipmentId)?.model;
      const assetId = bundleModel?.assetId ?? item.equipmentId;
      loadGeneratedEquipmentIntoSceneSlot(slot, {
        assetPath: `/xr-assets/medical-equipment/${item.gltfFileName}`,
        assetId,
        objectName: bundleModel ? runtimeGeneratedSceneObjectName(bundleModel) : item.equipmentId,
      });
    } else {
      addPediatricRespiratoryEquipmentCues(slot, item.equipmentId);
    }
    const counts = countEquipmentGeometry(slot);
    equipmentEvidenceItems.push({
      equipmentId: item.equipmentId,
      source: item.source,
      triangleCount: counts.triangleCount,
      meshCount: counts.meshCount,
    });
  }

  // #209: stamp fixture-suppressed declared ids (no dual mesh). Helper lives outside main.
  equipmentEvidenceItems.push(
    ...stampSuppressedDeclaredEquipmentOntoFixtures({
      shell: stationEnvironment,
      plannedEquipmentIds: equipmentPlan.map((item) => item.equipmentId),
      equipmentPlacements: encounterRuntimeAssetBundle.sceneManifest.equipmentPlacements ?? {},
      equipment: encounterRuntimeAssetBundle.equipment,
      roomProps: encounterRuntimeAssetBundle.sceneManifest.roomProps,
    }),
  );

  window.__openClinXrDeclaredEquipmentMountEvidence = {
    source: "window.__openClinXrDeclaredEquipmentMountEvidence",
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    items: equipmentEvidenceItems,
    notEvidenceFor: [
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "production_readiness",
      "equipment_asset_readiness",
    ],
  };

  // #122 — unique slot fill; unfilled slots stay in the graph but are hidden with empty actorId.
  publishRuntimeActorSlotAssignmentEvidence(encounterRuntimeAssetBundle);
  const patientPlacement = runtimeActorPlacement(runtimePatientActorId() || "unfilled_primary_patient", {
    slotKind: "primary_patient",
    position: { x: -0.72, y: 1.06, z: -0.12 },
    scale: { x: 1.1, y: 1.1, z: 1.1 },
    verticalOffsetMeters: -0.98,
    labelPrefix: "Patient",
  });
  const patient = actorMesh(0x8fb9aa);
  patient.name = iwsdkStationSceneObjects.patientRobertHayes;
  patient.position.set(patientPlacement.position.x, patientPlacement.position.y, patientPlacement.position.z);
  patient.visible = Boolean(runtimePatientActorId()) && !selectedScenarioRuntimeMismatch;
  if (cleanHumanoidSourceComparatorCapture) {
    // #315 follow-up: only the comparator's named subject renders; the patient is the
    // subject for the _patient comparators but NOT for _parent/_nurse (those name family/clinical).
    patient.visible = comparatorCaptureSubjectActorId() === runtimePatientActorId();
    patient.userData.openClinXrComparatorVisibilityPolicy = patient.visible
      ? "shown_as_named_subject_for_clean_humanoid_source_comparator_capture"
      : "hidden_for_clean_humanoid_source_comparator_capture_non_named_actor";
  }
  patient.scale.set(patientPlacement.scale.x, patientPlacement.scale.y, patientPlacement.scale.z);
  if (runtimePatientActorId()) applyCleanEncounterVisualReviewActorFraming(patient, runtimePatientActorId());
  if (runtimePatientActorId()) {
    patient.add(createActorNameplate(actorNameplateLabel(patientPlacement.labelPrefix, runtimePatientActorId()), 0x286b54));
  }
  scene.add(patient);
  // #83/#136: canonical slot kind on the root BEFORE load (never placement.slotKind — stale family tags collide).
  patient.userData.openClinXrSlotKind = "primary_patient";
  patient.userData.openClinXrActorPosture = patientPlacement.posture ?? "standing";
  patient.userData.openClinXrActorId = runtimePatientActorId();
  if (runtimePatientActorId()) {
    loadGeneratedHumanoidIntoActorSlot(patient, {
      assetPath: resolveEmulatorRuntimeAssetUrl(patientRuntimeHumanoidAsset),
      assetId: patientRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(patientRuntimeHumanoidAsset),
      actorId: runtimePatientActorId(),
      roleTintColor: 0x8fb9aa,
      verticalOffsetMeters: patientPlacement.verticalOffsetMeters,
      posture: patientPlacement.posture ?? "standing",
    });
  } else {
    patient.userData.openClinXrSlotUnfilledReason = "no_unique_patient_humanoid_for_station";
  }

  const nursePlacement = runtimeActorPlacement(runtimeClinicalTeamActorId() || "unfilled_clinical_team", {
    slotKind: "clinical_team",
    position: { x: 1.45, y: 0.95, z: 0.55 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Team",
  });
  const nurse = actorMesh(0x5a9bd5);
  nurse.name = iwsdkStationSceneObjects.nurseMariaAlvarez;
  nurse.position.set(nursePlacement.position.x, nursePlacement.position.y, nursePlacement.position.z);
  nurse.visible = Boolean(runtimeClinicalTeamActorId()) && !selectedScenarioRuntimeMismatch;
  if (cleanHumanoidSourceComparatorCapture) {
    // #315 follow-up: the nurse comparator's named subject is the clinical actor — show it.
    nurse.visible = comparatorCaptureSubjectActorId() === runtimeClinicalTeamActorId();
    nurse.userData.openClinXrComparatorVisibilityPolicy = nurse.visible
      ? "shown_as_named_subject_for_clean_humanoid_source_comparator_capture"
      : "hidden_for_clean_humanoid_source_comparator_capture_non_named_actor";
  } else if (!runtimeClinicalTeamActorId()) {
    nurse.visible = false;
  }
  nurse.scale.set(nursePlacement.scale.x, nursePlacement.scale.y, nursePlacement.scale.z);
  if (runtimeClinicalTeamActorId()) applyCleanEncounterVisualReviewActorFraming(nurse, runtimeClinicalTeamActorId());
  if (runtimeClinicalTeamActorId()) {
    nurse.add(createActorNameplate(actorNameplateLabel(nursePlacement.labelPrefix, runtimeClinicalTeamActorId()), 0x2f65a7));
  }
  scene.add(nurse);
  nurse.userData.openClinXrSlotKind = "clinical_team";
  nurse.userData.openClinXrActorPosture = nursePlacement.posture ?? "standing";
  nurse.userData.openClinXrActorId = runtimeClinicalTeamActorId();
  if (runtimeClinicalTeamActorId()) {
    loadGeneratedHumanoidIntoActorSlot(nurse, {
      assetPath: resolveEmulatorRuntimeAssetUrl(nurseRuntimeHumanoidAsset),
      assetId: nurseRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(nurseRuntimeHumanoidAsset),
      actorId: runtimeClinicalTeamActorId(),
      roleTintColor: 0x5a9bd5,
      verticalOffsetMeters: nursePlacement.verticalOffsetMeters,
      posture: nursePlacement.posture ?? "standing",
    });
  } else {
    nurse.userData.openClinXrSlotUnfilledReason = "no_unique_clinical_humanoid_for_station";
  }

  const spousePlacement = runtimeActorPlacement(runtimeFamilyActorId() || "unfilled_family_or_observer", {
    slotKind: "family_or_observer",
    position: { x: -2.0, y: 0.95, z: 0.7 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Family",
  });
  const spouse = actorMesh(0xd5a75a);
  spouse.name = iwsdkStationSceneObjects.spouseAnnaHayes;
  spouse.position.set(spousePlacement.position.x, spousePlacement.position.y, spousePlacement.position.z);
  spouse.visible = Boolean(runtimeFamilyActorId()) && !selectedScenarioRuntimeMismatch;
  if (cleanHumanoidSourceComparatorCapture) {
    // #315 follow-up: the parent comparator's named subject is the family actor — show it.
    spouse.visible = comparatorCaptureSubjectActorId() === runtimeFamilyActorId();
    spouse.userData.openClinXrComparatorVisibilityPolicy = spouse.visible
      ? "shown_as_named_subject_for_clean_humanoid_source_comparator_capture"
      : "hidden_for_clean_humanoid_source_comparator_capture_non_named_actor";
  } else if (!runtimeFamilyActorId()) {
    spouse.visible = false;
  }
  if (isPediatricAsthmaRuntimeScenario() && runtimeFamilyActorId()) {
    // #591: a SEATED parent stays on her authored family_chair anchor (#574) — moving her
    // XZ off the chair unseats her (pre-fix live: slot (1.42, 0.04) vs chair (−0.55, −0.75),
    // feet 0.256 m above the floor). Standing parents keep the three-actor review reframe.
    if (spousePlacement.posture === "seated") {
      spouse.rotation.y = -0.26;
      spouse.userData.openClinXrDynamicScenePolicy =
        "parent_seated_on_authored_family_chair_anchor_for_visible_three_actor_review";
    } else {
      spouse.position.x = Math.max(spouse.position.x, -1.42);
      spouse.position.z = 0.42;
      spouse.rotation.y = -0.26;
      spouse.userData.openClinXrDynamicScenePolicy = "parent_actor_reframed_from_case_defined_parent_chair_zone_for_visible_three_actor_review";
    }
  }
  // #591: stamp slot identity BEFORE framing — the framing's seated guard reads these, and
  // they were previously written only after applyCleanEncounterVisualReviewActorFraming ran.
  spouse.userData.openClinXrSlotKind = "family_or_observer";
  spouse.userData.openClinXrActorPosture = spousePlacement.posture ?? "standing";
  spouse.userData.openClinXrActorId = runtimeFamilyActorId();
  spouse.scale.set(spousePlacement.scale.x, spousePlacement.scale.y, spousePlacement.scale.z);
  if (runtimeFamilyActorId()) applyCleanEncounterVisualReviewActorFraming(spouse, runtimeFamilyActorId());
  if (runtimeFamilyActorId()) {
    spouse.add(createActorNameplate(actorNameplateLabel(spousePlacement.labelPrefix, runtimeFamilyActorId()), 0x9b642d));
  }
  scene.add(spouse);
  if (runtimeFamilyActorId()) {
    loadGeneratedHumanoidIntoActorSlot(spouse, {
      assetPath: resolveEmulatorRuntimeAssetUrl(spouseRuntimeHumanoidAsset),
      assetId: spouseRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(spouseRuntimeHumanoidAsset),
      actorId: runtimeFamilyActorId(),
      roleTintColor: 0xd5a75a,
      verticalOffsetMeters: spousePlacement.verticalOffsetMeters,
      posture: spousePlacement.posture ?? "standing",
    });
  } else {
    spouse.userData.openClinXrSlotUnfilledReason = "no_unique_family_humanoid_for_station";
  }

  // #122/#123 fourth slot — placement SSOT (team-adjacent secondary), not doorway hardcode.
  const additionalPlacement = runtimeActorPlacement(
    runtimeAdditionalActorId() || "unfilled_additional_cast",
    additionalCastPlacementFallback(),
  );
  const additional = actorMesh(0x7c6bb5);
  additional.name = "runtime_additional_cast_slot";
  additional.position.set(additionalPlacement.position.x, additionalPlacement.position.y, additionalPlacement.position.z);
  additional.visible = Boolean(runtimeAdditionalActorId()) && !selectedScenarioRuntimeMismatch;
  if (cleanHumanoidSourceComparatorCapture || !runtimeAdditionalActorId()) {
    additional.visible = false;
    if (cleanHumanoidSourceComparatorCapture) {
      additional.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
    }
  }
  additional.scale.set(additionalPlacement.scale.x, additionalPlacement.scale.y, additionalPlacement.scale.z);
  additional.userData.openClinXrSlotKind = "additional_cast";
  additional.userData.openClinXrActorPosture = additionalPlacement.posture ?? "standing";
  additional.userData.openClinXrActorId = runtimeAdditionalActorId();
  if (runtimeAdditionalActorId()) applyCleanEncounterVisualReviewActorFraming(additional, runtimeAdditionalActorId());
  if (runtimeAdditionalActorId()) {
    additional.add(createActorNameplate(actorNameplateLabel(additionalPlacement.labelPrefix, runtimeAdditionalActorId()), 0x5b4a9a));
  }
  scene.add(additional);
  if (runtimeAdditionalActorId()) {
    loadGeneratedHumanoidIntoActorSlot(additional, {
      assetPath: resolveEmulatorRuntimeAssetUrl(additionalRuntimeHumanoidAsset),
      assetId: additionalRuntimeHumanoidAsset.assetId,
      objectName: runtimeGeneratedSceneObjectName(additionalRuntimeHumanoidAsset),
      actorId: runtimeAdditionalActorId(),
      roleTintColor: 0x7c6bb5,
      verticalOffsetMeters: additionalPlacement.verticalOffsetMeters,
      posture: additionalPlacement.posture ?? "standing",
    });
  } else {
    additional.userData.openClinXrSlotUnfilledReason = "no_remaining_unique_humanoid_for_additional_slot";
  }
  const slotEvidence = window.__openClinXrActorSlotAssignment;
  if (slotEvidence) {
    scene.userData.openClinXrNotStagedActorIds = slotEvidence.notStagedActorIds;
    scene.userData.openClinXrActorSlotAssignment = slotEvidence;
  }

  for (const virtualActor of encounterRuntimeAssetBundle.actors.filter((actor) => actor.embodiment === "virtual_device")) {
    if (!selectedScenarioRuntimeMismatch && !cleanHumanoidSourceComparatorCapture) {
      scene.add(createVirtualDeviceActorAffordance(virtualActor.actorId));
    }
  }

  const clockMesh = new Mesh(new CylinderGeometry(0.25, 0.25, 0.05, 48), new MeshStandardMaterial({ color: 0xf3e8c9 }));
  clockMesh.name = iwsdkStationSceneObjects.wallClock;
  clockMesh.rotation.x = Math.PI / 2;
  clockMesh.position.set(0.9, 3.35, -1.2);
  if (cleanHumanoidSourceComparatorCapture) {
    clockMesh.visible = false;
    clockMesh.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (!shouldShowPrimitiveAssetFallbacks()) {
    clockMesh.visible = false;
    clockMesh.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_fallback_debug_capture";
  }
  scene.add(clockMesh);
  const clinicalPanel = createClinicalPanel();
  if (cleanHumanoidSourceComparatorCapture) {
    clinicalPanel.mesh.visible = false;
    clinicalPanel.mesh.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (!shouldShowInSceneEvidencePanels()) {
    clinicalPanel.mesh.visible = false;
    clinicalPanel.mesh.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_panel_evidence_capture";
  }
  scene.add(clinicalPanel.mesh);
  const dialoguePanel = createReadableVrTextPanel({
    name: iwsdkStationSceneObjects.dialoguePanel,
    title: "Live Dialogue",
    lines: [initialDialogueText, `Trace 0/${state.requiredTraceTags.length}`],
    widthMeters: 1.85,
    heightMeters: 0.95,
    background: "#fff8e5",
    accent: "#286b54",
  });
  dialoguePanel.mesh.position.set(0.85, 2.58, -1.42);
  dialoguePanel.mesh.rotation.y = -0.28;
  if (cleanHumanoidSourceComparatorCapture) {
    dialoguePanel.mesh.visible = false;
    dialoguePanel.mesh.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (!shouldShowInSceneEvidencePanels()) {
    dialoguePanel.mesh.visible = false;
    dialoguePanel.mesh.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_panel_evidence_capture";
  }
  scene.add(dialoguePanel.mesh);
  const actorRealismPanel = createReadableVrTextPanel({
    name: iwsdkStationSceneObjects.actorRealismPanel,
    title: "Actor Realism Requirements",
    lines: formatActiveActorRealismRequirementLines(window.__openClinXrHumanoidSpeechEvidence ?? null),
    widthMeters: 1.8,
    heightMeters: 0.82,
    background: "#f3fff7",
    accent: "#16835a",
  });
  actorRealismPanel.mesh.position.set(-1.1, 2.38, -1.34);
  actorRealismPanel.mesh.rotation.y = 0.2;
  actorRealismPanel.mesh.userData.openClinXrCaseDefinitionRuntimeRequirementPanel =
    "active_dialogue_actor_realism_requirements_visible_for_adversarial_review";
  if (!shouldShowActorRealismRequirementPanel()) {
    actorRealismPanel.mesh.visible = false;
    actorRealismPanel.mesh.userData.openClinXrDynamicScenePolicy = "active_actor_realism_panel_hidden_until_trace_selected";
  }
  scene.add(actorRealismPanel.mesh);
  const inputPanel = createReadableVrTextPanel({
    name: iwsdkStationSceneObjects.inputPanel,
    title: "Input Evidence",
    lines: [
      "Session: Full VR not entered",
      "Hands: pending optional hand-tracking",
      "Movement: room-scale walking, thumbstick, keyboard, or armed hand gesture",
    ],
    widthMeters: 1.65,
    heightMeters: 0.72,
    background: "#eef4ff",
    accent: "#5a6f9f",
  });
  inputPanel.mesh.position.set(1.6, 1.32, -1.08);
  inputPanel.mesh.rotation.y = -0.42;
  if (cleanHumanoidSourceComparatorCapture) {
    inputPanel.mesh.visible = false;
    inputPanel.mesh.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (!shouldShowInSceneEvidencePanels()) {
    inputPanel.mesh.visible = false;
    inputPanel.mesh.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_panel_evidence_capture";
  }
  if (actorCloseCapture) {
    clinicalPanel.mesh.position.set(-2.05, 2.86, -1.72);
    clinicalPanel.mesh.scale.setScalar(0.72);
    dialoguePanel.mesh.position.set(1.38, 2.86, -1.72);
    dialoguePanel.mesh.scale.setScalar(0.72);
    actorRealismPanel.mesh.position.set(-1.62, 0.92, -1.24);
    actorRealismPanel.mesh.scale.setScalar(0.62);
    actorRealismPanel.mesh.userData.openClinXrCaptureDeclutterPolicy = "actor_close_realism_review_panel_scaled_away_from_face_torso";
    inputPanel.mesh.position.set(1.95, 0.92, -1.26);
    inputPanel.mesh.scale.setScalar(0.62);
    inputPanel.mesh.userData.openClinXrCaptureDeclutterPolicy = "actor_close_realism_review_panels_scaled_away_from_face_torso";
  }
  scene.add(inputPanel.mesh);
  // Conversation / history-taking HUD (deterministic local policy; traced domains, not scored).
  publishConversationTurnStateEvidence();
  const conversationPanel = createReadableVrTextPanel({
    name: `${runtimeSceneObjectPrefix()}.conversation-turn-state-panel`,
    title: "Conversation Tooling",
    lines: formatConversationTurnStatePanelLines(),
    widthMeters: 1.9,
    heightMeters: 0.95,
    background: "#fff0f5",
    accent: "#b83280",
  });
  conversationPanel.mesh.position.set(-1.55, 1.28, -1.12);
  conversationPanel.mesh.rotation.y = 0.38;
  conversationPanel.mesh.userData.openClinXrConversationToolingPanel =
    "turn_taking_history_coverage_barge_in_hud_traced_not_scored";
  if (cleanHumanoidSourceComparatorCapture) {
    conversationPanel.mesh.visible = false;
    conversationPanel.mesh.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_humanoid_source_comparator_capture";
  } else if (!shouldShowInSceneEvidencePanels()) {
    conversationPanel.mesh.visible = false;
    conversationPanel.mesh.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_panel_evidence_capture";
  }
  scene.add(conversationPanel.mesh);
  let lastPanelSignature = "";
  addControllerAffordances(renderer, scene, (event) => {
    // XR ray: a controller select that hits a body region is a clinical touch;
    // otherwise fall through to the position-independent trace advance.
    if (tryClinicalTouchFromControllerEvent(event, "xr_controller_select")) return;
    completeNextTraceActionFromXrSelect(
      () => Boolean(activeXrSession && renderer.xr.isPresenting),
      classifyXrSelectSource(event),
    );
  });
  // Desktop pointer ray: pointerdown on the canvas that hits a body region fires a
  // clinical touch (headless-capturable). A miss does nothing (touch-only input).
  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    tryClinicalTouchFromNdc(camera, ndcX, ndcY, "dom_click_trace_button");
  });
  // Test hook: project a touch-region center to a client pixel so the headless
  // clinical-touch gate can click the real canvas and exercise the real ray path.
  (window as unknown as {
    __openClinXrProjectTouchRegionToScreen?: (regionId: string) => { x: number; y: number } | null;
  }).__openClinXrProjectTouchRegionToScreen = (regionId) => {
    const mesh = clinicalTouchRegionTargets.find((target) => target.userData.openClinXrTouchRegionId === regionId);
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false);
    const ndc = new Vector3().setFromMatrixPosition(mesh.matrixWorld).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
  };
  const keyboardLocomotion = createKeyboardLocomotion();
  let handModelStatus: OpenClinXrInputEvidence["handModelStatus"] = "pending_immersive_session";
  let handModelsInstalled = false;
  let activeHandRepresentationKind: OpenClinXrInputEvidence["handRepresentationKind"] = primitiveHandRepresentationKind;
  let handAssetLoadErrors: string[] = [];
  let lastInputObservedAtMs: number | null = null;
  let examineeLocomotionStartPose: RigPoseEvidence | null = null;
  let examineeLocomotionDistanceMeters = 0;
  let examineeLocomotionTurnRadians = 0;
  let examineeLocomotionSampleCount = 0;
  const examineeLocomotionTrail = createExamineeLocomotionTrail();
  scene.add(examineeLocomotionTrail);
  const handGestureLocomotionState = createXrHandGestureLocomotionState();
  const handSelectState = createXrHandSelectState();

  function resize(): void {
    if (renderer.xr.isPresenting) {
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  function animate(timestamp?: number): void {
    renderSceneFrame(timestamp, "webxr_animation_loop");
  }

  /**
   * #342b — stand the flat-preview camera INSIDE a closed generated room.
   *
   * The authored wide framing is a 4.9 m pull-back tuned for the PARAMETRIC box, which is open
   * at +Z. The Infinigen room is a closed shell and the same camera lands 2.38 m beyond its
   * +Z face, so every ray hits the untextured exterior hull and the learner sees a flat grey
   * field. Measured pre-fix: camera world [0,1.48,4.73] vs interior max z 2.3505.
   *
   * Only the flat preview is affected: in an XR session three.js drives the camera from the
   * headset pose, and the locomotion rig — which IS the learner — already stands at the origin
   * inside the room. Runs from the frame loop because the room GLB and the cast both load
   * async; latches on the first frame where both are present so locomotion is not fought
   * afterwards.
   */
  function applyInteriorPreviewCameraOnce(): void {
    if (interiorPreviewCameraApplied) return;
    if (!usesAuthoredWideDefaultFraming) return;
    if (renderer.xr.isPresenting) return;
    const roomRoot = scene.getObjectByName("openclinxr.station-environment.infinigen-room");
    if (!roomRoot) return;
    const actorWorldBoxes = collectActorWorldBoxes(scene);
    if (actorWorldBoxes.length === 0) return;
    const derived = deriveInteriorPreviewCamera({ roomRoot, actorWorldBoxes });
    if (!derived) return;

    // `eye` is a WORLD point; `camera.position` is LOCAL to the locomotion rig it is parented
    // to. Convert through the rig so the applied position matches the derivation. `lookAt`
    // already takes a world point and accounts for the parent.
    camera.position.copy(derived.eye);
    locomotionRig.updateMatrixWorld(true);
    locomotionRig.worldToLocal(camera.position);
    camera.lookAt(derived.lookAt);
    camera.userData.openClinXrCameraFraming =
      "product_default_interior_view_derived_from_generated_room_and_actor_bounds";
    camera.userData.openClinXrInteriorPreviewCamera = {
      eyeWorld: [derived.eye.x, derived.eye.y, derived.eye.z],
      lookAtWorld: [derived.lookAt.x, derived.lookAt.y, derived.lookAt.z],
      interiorMin: [derived.interiorMin.x, derived.interiorMin.y, derived.interiorMin.z],
      interiorMax: [derived.interiorMax.x, derived.interiorMax.y, derived.interiorMax.z],
      wallThicknessMeters: derived.wallThicknessMeters,
      nearestActorMeters: derived.nearestActorMeters,
      authoredWorldZ: 5.35,
      policy:
        "authored_wide_pullback_is_outside_a_closed_generated_shell_so_the_preview_eye_is_derived_from_measured_room_and_cast_bounds",
    };
    interiorPreviewCameraApplied = true;
  }

  function renderSceneFrame(
    timestamp?: number,
    qualitySource: NonNullable<OpenClinXrFrameStats["qualitySource"]> = "webxr_animation_loop",
  ): void {
    const now = typeof timestamp === "number" ? timestamp : performance.now();
    lastRenderLoopAtMs = now;
    const deltaSeconds = Math.min((now - lastAnimateAtMs) / 1000, 0.05);
    lastAnimateAtMs = now;
    resize();
    applyInteriorPreviewCameraOnce();
    const roomScalePose = sampleRoomScalePose({
      camera,
      renderer,
      presenting: Boolean(activeXrSession && renderer.xr.isPresenting),
    });
    const locomotionEvidence = applyLocomotion({
      deltaSeconds,
      keyboardLocomotion,
      locomotionRig,
      now,
      renderer,
      session: activeXrSession,
      lastInputObservedAtMs,
      lastLocomotionAtMs,
      handModelCount: handModelsInstalled ? 2 : 0,
      handModelStatus,
      activeHandRepresentationKind,
      handAssetLoadErrors,
      handGestureLocomotionState,
      previousRoomScalePose,
      roomScalePose,
    });
    previousRoomScalePose = roomScalePose ?? previousRoomScalePose;
    const inputEvidence: OpenClinXrInputEvidence = {
      ...locomotionEvidence,
      xrHandSelectState: maybeCompleteTraceActionFromHandSelect({
        renderer,
        handSelectState,
        now,
        controllerInputActive: locomotionEvidence.inputSourceKinds?.includes("xr_gamepad") === true,
        isFullVrPresenting: () => Boolean(activeXrSession && renderer.xr.isPresenting),
        onSelect: () => {
          // XR hand pose ray (wrist → index tip): hit body region → clinical touch;
          // miss → fall through to normal trace advance.
          if (tryClinicalTouchFromHandPose(renderer, "xr_hand_select")) return true;
          return completeNextTraceActionFromXrSelect(
            () => Boolean(activeXrSession && renderer.xr.isPresenting),
            "xr_hand_select",
          );
        },
      }),
    };
    recordHandSelectTraceInteractionDetail(inputEvidence.xrHandSelectState, now);
    if ((inputEvidence.activeLocomotionSource ?? "none") !== "none" && inputEvidence.locomotionDelta) {
      lastObservedLocomotionSummary = {
        source: inputEvidence.activeLocomotionSource ?? "none",
        distanceMeters: inputEvidence.locomotionDelta.distanceMeters,
        turnRadians: inputEvidence.locomotionDelta.turnRadians,
        atMs: now,
      };
    }
    const examineeLocomotionEvidence = buildExamineeLocomotionEvidence({
      inputEvidence,
      startPose: examineeLocomotionStartPose,
      distanceMeters: examineeLocomotionDistanceMeters,
      turnRadians: examineeLocomotionTurnRadians,
      sampleCount: examineeLocomotionSampleCount,
    });
    if (examineeLocomotionEvidence) {
      examineeLocomotionStartPose = examineeLocomotionEvidence.startPose;
      examineeLocomotionDistanceMeters = examineeLocomotionEvidence.distanceMeters;
      examineeLocomotionTurnRadians = examineeLocomotionEvidence.turnRadians;
      examineeLocomotionSampleCount = examineeLocomotionEvidence.sampleCount;
      updateExamineeLocomotionTrail(examineeLocomotionTrail, examineeLocomotionEvidence);
      window.__openClinXrExamineeLocomotionEvidence = examineeLocomotionEvidence;
    }
    lastInputObservedAtMs = inputEvidence.lastInputObservedAtMs ?? lastInputObservedAtMs;
    lastLocomotionAtMs = inputEvidence.lastLocomotionAtMs;
    window.__openClinXrInputEvidence = inputEvidence;
    updatePortalTransitionEvidence(locomotionRig, camera);
    updateVrPanels(inputEvidence);
    // Wire gen drive from scaffold/replay metadata to live humanoid update; fallback keeps prior procedural motion.
    const floorDrive = floor.userData.genDrive ?? floor.userData.pedsRuntimeDrive;
    const genDriveForHumanoid = window.__openClinXrPedsDrive ?? (isGeneratedRuntimeDrive(floorDrive) ? floorDrive : null);
    updateGeneratedHumanoidAnimations(deltaSeconds, now, camera, genDriveForHumanoid);
    applyPhysicsBoneTransforms(now); // capture-gated; extracted module
    updateEnvironmentRealismAnimations(deltaSeconds, now);
    // Deeper visual cue from drive in per-frame for live transitions on env world in launched player (richer integration of caseDerived env + gen drive/emotion). Uses deeperVisualCue from handoff (set at load from pedsRuntimeDrive/scaffold) and current emotion cues. Modulates emissive/scale on gltfEnvContainer/children for affect (e.g. anxious/urgent). Called every frame in renderSceneFrame (and fallback). Makes the virtual env world react dynamically in the full WebXR/desktop experience when running the app. (Previously only at load; now live per drive.)
    if (typeof gltfEnvContainer !== 'undefined' && gltfEnvContainer) {
      const cueData = gltfEnvContainer.userData.deeperVisualCueApplied || (typeof floor !== 'undefined' && floor ? floor.userData.caseDerivedVirtualEnvGltfHandoff?.deeperVisualCueApplied : null) || { cue: 'neutral', intensity: 0.1, richerCuesApplied: false };
      const baseIntensity = cueData.intensity || 0.1;
      const isAffect = cueData.cue && (cueData.cue.includes('anx') || cueData.cue.includes('fright') || cueData.cue.includes('urgent') || cueData.cue.includes('parent'));
      const targetIntensity = isAffect ? Math.min(baseIntensity * 1.8, 0.35) : baseIntensity * 0.6;
      gltfEnvContainer.traverse((obj) => {
        if (obj instanceof Mesh && !Array.isArray(obj.material) && typeof obj.material.emissiveIntensity === 'number') {
          obj.material.emissiveIntensity = targetIntensity;
        }
        if (obj.scale && isAffect) {
          const s = 1 + Math.sin(now / 800) * 0.015;
          obj.scale.setScalar(s);
        }
      });
    }
    const captureSummary = recordFrame(now, {
      qualitySource,
      isPresenting: isImmersiveFrameEvidenceActive({
        rendererPresenting: renderer.xr.isPresenting,
        activeXrSession: Boolean(activeXrSession),
        immersiveSessionActive,
      }),
      visibilityState: document.visibilityState,
    });
    latestRuntimeInteractionEvidence = buildRuntimeInteractionEvidenceSnapshot({
      now,
      inputEvidence,
      captureSummary,
      humanoidSpeechEvidence: window.__openClinXrHumanoidSpeechEvidence ?? null,
    });
    // Standing-idle sway only. A supine root's orientation is owned by the plant hold
    // (applySupinePoseHoldingIncline + stored hinge quat); a per-frame yaw here re-derives the
    // actor quaternion away from the stored tip and lifts the head off the pillow (#181).
    const patientActorSupine = patient.userData?.openClinXrActorPosture === "supine"
      || (Array.isArray(patient.children)
        && patient.children.some((c) => c.userData?.openClinXrActorPosture === "supine"));
    patient.rotation.y = patientActorSupine ? patient.rotation.y : Math.sin(now / 1200) * 0.08;
    nurse.rotation.y = Math.sin(now / 900) * 0.12;
    renderer.render(scene, camera);
  }

  function buildRuntimeInteractionEvidenceSnapshot(input: {
    now: number;
    inputEvidence: OpenClinXrInputEvidence;
    captureSummary: ManualPerformanceCaptureSummary;
    humanoidSpeechEvidence: HumanoidSpeechEvidence | null;
  }): RuntimeInteractionEvidence {
    return {
      capturedAtMs: input.now,
      activeLocomotionSource: input.inputEvidence.activeLocomotionSource ?? null,
      locomotionAttempt: input.inputEvidence.locomotionAttempt ?? null,
      locomotionDistanceMeters: input.captureSummary.locomotionDistanceMeters,
      locomotionTurnRadians: input.captureSummary.locomotionTurnRadians,
      locomotionProbeReadiness: input.captureSummary.locomotionProbeSummary?.readiness ?? null,
      locomotionProbePrimaryReason: input.captureSummary.locomotionProbeSummary?.primaryReason ?? null,
      locomotionProbeReasonCodes: input.captureSummary.locomotionProbeSummary?.reasonCodes ?? null,
      handSelectStatus: input.inputEvidence.xrHandSelectState?.status ?? null,
      handSelectDwellMs: input.inputEvidence.xrHandSelectState?.dwellMs ?? null,
      handSelectFiredCount: input.inputEvidence.xrHandSelectState?.firedCount ?? null,
      handSelectBlockedReason: input.inputEvidence.xrHandSelectState?.blockedReason ?? null,
      activeEmotionState: input.humanoidSpeechEvidence?.activeEmotionState ?? null,
      activeExpressionTransitionMs: input.humanoidSpeechEvidence?.activeExpressionTransitionMs ?? null,
      activeExpressionCueCount: input.humanoidSpeechEvidence?.activeExpressionCueIds?.length ?? 0,
      activeBodyMotionMode: input.humanoidSpeechEvidence?.activeBodyMotionMode ?? null,
      activeBodyMotionIntensity: input.humanoidSpeechEvidence?.activeBodyMotionIntensity ?? null,
      activeMouthOpenness: input.humanoidSpeechEvidence?.activeMouthOpenness ?? null,
      activeEyeBlinkIntensity: input.humanoidSpeechEvidence?.activeEyeBlinkIntensity ?? null,
      gazeTargetKind: input.humanoidSpeechEvidence?.gazeTargetKind ?? null,
      gazeTargetActorId: input.humanoidSpeechEvidence?.gazeTargetActorId ?? null,
    };
  }

  renderer.setAnimationLoop(animate);
  window.setInterval(fallbackAnimationLoop, flatPreviewFallbackFrameMs);
  recordDynamicSceneObjectNamingEvidence(scene);
  recordBootPhase("station_render_loop_started");

  return {
    async startImmersiveSession(): Promise<void> {
      if (activeXrSession) {
        await activeXrSession.end();
        return;
      }

      const navigatorWithXr = navigator as NavigatorWithXr;
      if (!navigatorWithXr.xr) {
        xrStatus.textContent = "WebXR unavailable";
        recordXrEntryEvidence("failed", "navigator.xr unavailable");
        return;
      }

      enterXrButton.disabled = true;
      xrStatus.textContent = "Entering Full VR";
      recordXrEntryEvidence("requesting");
      try {
        const session = await navigatorWithXr.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
        });
        activeXrSession = session;
        session.addEventListener("end", () => {
          activeXrSession = undefined;
          immersiveSessionActive = false;
          enterXrButton.disabled = false;
          enterXrButton.textContent = "Enter Full VR";
          xrStatus.textContent = "Full VR ready";
          recordXrEntryEvidence("ended");
        }, { once: true });
        await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
        installHandModelsOnce();
        immersiveSessionActive = true;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Exit Full VR";
        xrStatus.textContent = "In Full VR";
        requestAnimationFrame(() => updateManualEvidencePanel());
        recordXrEntryEvidence("started");
      } catch (error) {
        activeXrSession = undefined;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Enter Full VR";
        xrStatus.textContent = "WebXR entry blocked";
        recordXrEntryEvidence("failed", error);
      }
    },
  };

  function fallbackAnimationLoop(): void {
    const now = performance.now();
    if (now - lastRenderLoopAtMs > flatPreviewFallbackFrameMs) {
      renderSceneFrame(now, "flat_preview_fallback");
    }
  }

  function installHandModelsOnce(): void {
    if (handModelsInstalled || handModelStatus === "failed") {
      return;
    }
    try {
      addHandModels(renderer, scene, {
        onMeshReady: () => {
          activeHandRepresentationKind = meshHandRepresentationKind;
        },
        onMeshLoadError: (url) => {
          activeHandRepresentationKind = primitiveHandRepresentationKind;
          handModelStatus = "failed";
          handAssetLoadErrors = [...new Set([...handAssetLoadErrors, url])];
          recordBootPhase("hand_mesh_asset_load_failed", url);
        },
      });
      handModelsInstalled = true;
      handModelStatus = "installed";
    } catch {
      activeHandRepresentationKind = primitiveHandRepresentationKind;
      handModelStatus = "failed";
      handAssetLoadErrors = [...new Set([...handAssetLoadErrors, localHandMeshPath])];
    }
  }

  function updateVrPanels(inputEvidence: OpenClinXrInputEvidence): void {
    const summary = summarizeTraceReadiness(state);
    const dialogueText = dialogueLine.textContent ?? initialDialogueText;
    const handGestureSourceActive = inputEvidence.inputSourceKinds?.includes("xr_hand_gesture") === true;
    const captureSummary = window.__openClinXrManualPerformanceCaptureSummary ?? null;
    const captureReadinessStatus = formatCaptureReadinessStatus(captureSummary);
    const examFlowEvidence = updateExamFlowEvidence();
    const panelSignature = [
      dialogueText,
      summary.observedCount,
      summary.missingCount,
      examFlowEvidence.scenarioIndex,
      examFlowEvidence.phase,
      examFlowEvidence.encounterElapsedSeconds,
      examFlowEvidence.noteElapsedSeconds,
      examFlowEvidence.noteTextLength,
      examFlowEvidence.canAdvanceToNextEncounter ? "exam-flow-ready" : "exam-flow-not-ready",
      immersiveSessionActive ? "in-full-vr" : "preview",
      inputEvidence.handModelStatus,
      inputEvidence.handRepresentationKind ?? "unknown",
      inputEvidence.handInputsObserved,
      inputEvidence.lastLocomotionAtMs,
      inputEvidence.activeLocomotionSource,
      handGestureSourceActive ? "hand-gesture-active" : "hand-gesture-inactive",
      inputEvidence.xrHandGestureState?.armed ? "gesture-armed" : "gesture-not-armed",
      inputEvidence.xrHandGestureState?.dwellMs ?? 0,
      inputEvidence.xrHandGestureState?.blockedReason ?? "none",
      inputEvidence.xrHandSelectState?.status ?? "select-idle",
      inputEvidence.xrHandSelectState?.firedCount ?? 0,
      inputEvidence.xrHandSelectState?.blockedReason ?? "select-none",
      inputEvidence.rigPosition.x,
      inputEvidence.rigPosition.z,
      lastObservedLocomotionSummary?.source ?? "no-last-source",
      lastObservedLocomotionSummary?.distanceMeters ?? 0,
      lastObservedLocomotionSummary?.turnRadians ?? 0,
      inputEvidence.locomotionDelta?.distanceMeters ?? 0,
      inputEvidence.locomotionDelta?.turnRadians ?? 0,
      captureReadinessStatus,
      captureSummary?.technicalGaps[0] ?? "no-technical-gap",
      captureSummary?.locomotionProbeSummary?.primaryReason ?? "no-locomotion-probe",
      window.__openClinXrHumanoidSpeechEvidence?.activeEmotionState ?? "no-active-emotion",
      window.__openClinXrHumanoidSpeechEvidence?.activeExpressionTransitionMs ?? "no-expression-transition",
      window.__openClinXrHumanoidSpeechEvidence?.activeExpressionCueIds?.includes("emotion_aligned_expression_transition_cue") ? "emotion-transition-cue-present" : "emotion-transition-cue-missing",
      window.__openClinXrHumanoidSpeechEvidence?.activeActorRuntimeRealismRequirement?.actorId ?? "no-active-actor-realism-requirement",
      window.__openClinXrHumanoidSpeechEvidence?.activeActorRuntimeRealismRequirement?.requiredCueIds.join(",") ?? "no-active-actor-realism-cues",
      window.__openClinXrConversationTurnStateEvidence?.currentTurn ?? 0,
      window.__openClinXrConversationTurnStateEvidence?.historyCoverage.coveragePercent ?? 0,
      window.__openClinXrConversationTurnStateEvidence?.nextActorId ?? "no-next-actor",
      window.__openClinXrConversationTurnStateEvidence?.lastBargeInOutcome ?? "no-barge-in",
    ].join("|");
    if (panelSignature === lastPanelSignature) {
      return;
    }
    lastPanelSignature = panelSignature;
    clinicalPanel.update(clinicalPanelLinesForSelectedStation());
    dialoguePanel.update([
      dialogueText,
      `Trace ${summary.observedCount}/${state.requiredTraceTags.length}; missing ${summary.missingCount}`,
    ]);
    actorRealismPanel.update(formatActiveActorRealismRequirementLines(window.__openClinXrHumanoidSpeechEvidence ?? null));
    actorRealismPanel.mesh.visible = shouldShowActorRealismRequirementPanel(window.__openClinXrHumanoidSpeechEvidence ?? null);
    inputPanel.update([
      immersiveSessionActive ? "Session: In Full VR" : "Session: Desktop preview",
      `Exam: ${examFlowEvidence.scenarioIndex + 1}/${examFlowEvidence.totalScenarios} ${examFlowEvidence.phase}; next ${examFlowEvidence.nextScenarioId ?? "complete"}`,
      `Note: ${examFlowEvidence.noteTextLength} chars; ${examFlowEvidence.canAdvanceToNextEncounter ? "ready to advance" : "not ready"}`,
      `Hands: ${inputEvidence.handModelStatus}; observed ${inputEvidence.handInputsObserved}; rep ${inputEvidence.handRepresentationKind ?? "unknown"}`,
      inputEvidence.xrHandGestureState?.armed
        ? `Gesture: armed; dwell ${inputEvidence.xrHandGestureState.dwellMs}ms`
        : `Gesture: ${inputEvidence.xrHandGestureState?.blockedReason ?? "not armed"}`,
      `Trace hand select: ${formatHandSelectStatus(inputEvidence.xrHandSelectState)}`,
      formatRuntimeLocomotionLine(inputEvidence, captureSummary),
      `Speech affect: ${formatHumanoidSpeechAffectEvidence(window.__openClinXrHumanoidSpeechEvidence ?? null)}`,
      `Capture: ${captureReadinessStatus}; gap ${formatTechnicalGapStatus(captureSummary)}`,
    ]);
    conversationPanel.update(formatConversationTurnStatePanelLines());
    if (!cleanHumanoidSourceComparatorCapture && shouldShowInSceneEvidencePanels()) {
      conversationPanel.mesh.visible = true;
    }
  }
}

function applyCleanEncounterVisualReviewActorFraming(actor: Group, actorId: string): void {
  // #83: frame from the SELECTED scenario (URL), not the local ED fixture bundle id.
  // Telehealth patient_chair seating never applied while bundle stayed ed_chest_pain_*.
  applyEncounterActorFraming({
    actor,
    actorId,
    scenarioId: selectedScenarioId(),
    role: runtimeActorRole(actorId) ?? String(actor.userData.openClinXrActorRole ?? ""),
    posture: (actor.userData.openClinXrActorPosture as ActorPosture | undefined) ?? undefined,
    skipFraming:
      isHumanoidFaceDetailCaptureMode()
      || isActorPoseReviewCaptureMode()
      || isActorCloseRealismCaptureMode(),
    onWardrobeCue: addGeneratedHumanoidRoleContinuityWardrobeCue,
  });
}

function resolveActiveEnvironmentId(): string {
  const scenarioId = selectedScenarioId();
  const scenario =
    scenarioBank.find((candidate) => candidate.scenarioId === scenarioId)
    ?? scenarioBank.find((candidate) => candidate.scenarioId === encounterRuntimeAssetBundle.scenarioId)
    ?? edChestPainScenario;
  return scenario.environment?.environmentId ?? "ed_exam_bay_v1";
}

function addScenarioSpecificClinicalSetDressing(scene: Scene, doorwayTheme: ScenarioDoorwayVisualTheme): void {
  if (shouldUseCleanHumanoidSourceComparatorCapture()) {
    return;
  }
  const sid = encounterRuntimeAssetBundle.scenarioId;
  // caseDerivedVirtualEnvironment props (peds/ed/ob) from factory; pure three primitives.
  if (sid !== "ob_headache_preeclampsia_triage_v1" && sid !== "peds_asthma_parent_anxiety_v1" && sid !== "ed_chest_pain_priority_v1") {
    return;
  }
  const linenMaterial = new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.86 });
  const accentMaterial = new MeshStandardMaterial({ color: new Color(doorwayTheme.panelAccent), roughness: 0.78 });
  if (sid === "ob_headache_preeclampsia_triage_v1") {
    const bedFrame = new Mesh(new BoxGeometry(1.75, 0.16, 0.72), new MeshStandardMaterial({ color: 0xd8dee8, roughness: 0.72 }));
    bedFrame.name = `${runtimeSceneObjectPrefix()}.ob-triage-recliner-bed-frame`;
    bedFrame.position.set(-1.62, 0.42, -0.22);
    bedFrame.userData.openClinXrScenarioSetDressing =
      "ob_triage_recliner_generated_from_encounter_context";
    scene.add(bedFrame);
    const pillow = new Mesh(new BoxGeometry(0.46, 0.1, 0.34), linenMaterial.clone());
    pillow.name = `${runtimeSceneObjectPrefix()}.ob-triage-pillow`;
    pillow.position.set(-2.08, 0.62, -0.2);
    pillow.rotation.z = -0.06;
    pillow.userData.openClinXrScenarioSetDressing = "ob_headache_reclined_patient_context";
    scene.add(pillow);
    const blanket = new Mesh(new BoxGeometry(0.82, 0.055, 0.66), new MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.9 }));
    blanket.name = `${runtimeSceneObjectPrefix()}.ob-triage-blanket`;
    blanket.position.set(-1.45, 0.57, -0.18);
    blanket.userData.openClinXrScenarioSetDressing = "ob_triage_bed_linen_context";
    scene.add(blanket);
    const bpCuff = new Mesh(new BoxGeometry(0.2, 0.07, 0.03), new MeshStandardMaterial({ color: 0x111827, roughness: 0.74 }));
    bpCuff.name = `${runtimeSceneObjectPrefix()}.ob-severe-bp-cuff-on-side-rail`;
    bpCuff.position.set(-1.62, 0.73, 0.2);
    bpCuff.rotation.y = -0.12;
    bpCuff.userData.openClinXrScenarioSetDressing = "severe_blood_pressure_repeat_workflow_cue";
    scene.add(bpCuff);
    const urineCup = new Mesh(new CylinderGeometry(0.065, 0.05, 0.12, 18), new MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.66, transparent: true, opacity: 0.78 }));
    urineCup.name = `${runtimeSceneObjectPrefix()}.ob-urine-protein-cup-cue`;
    urineCup.position.set(0.18, 0.74, -0.58);
    urineCup.userData.openClinXrScenarioSetDressing = "preeclampsia_urine_protein_context_cue";
    scene.add(urineCup);
    const wallMonitor = new Group();
    wallMonitor.name = `${runtimeSceneObjectPrefix()}.ob-wall-vitals-monitor-group`;
    wallMonitor.userData.openClinXrScenarioSetDressing = 'severe_range_bp_vitals_monitor_generated_from_ob_case_definition';
    const monitorBack = new Mesh(new BoxGeometry(0.48, 0.28, 0.035), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.68 }));
    monitorBack.name = `${runtimeSceneObjectPrefix()}.ob-wall-vitals-monitor`;
    monitorBack.position.set(0.82, 1.42, -0.83);
    wallMonitor.add(monitorBack);
    const bpTrace = new Mesh(new BoxGeometry(0.36, 0.035, 0.018), new MeshBasicMaterial({ color: 0x60a5fa }));
    bpTrace.name = `${runtimeSceneObjectPrefix()}.ob-wall-vitals-severe-bp-trace`;
    bpTrace.position.set(0.82, 1.45, -0.8);
    wallMonitor.add(bpTrace);
    const privacyCurtain = new Mesh(new BoxGeometry(0.035, 1.12, 0.86), new MeshStandardMaterial({ color: 0xe9d5ff, roughness: 0.92, transparent: true, opacity: 0.62 }));
    privacyCurtain.name = `${runtimeSceneObjectPrefix()}.ob-triage-privacy-curtain-edge`;
    privacyCurtain.position.set(1.42, 0.92, -0.18);
    privacyCurtain.userData.openClinXrScenarioSetDressing = 'ob_triage_privacy_boundary_generated_from_encounter_environment';
    privacyCurtain.visible = false;
    privacyCurtain.userData.openClinXrObVisualReviewPolicy = "hidden_after_visual_review_showed_edge_artifact";
    scene.add(privacyCurtain);
    scene.add(wallMonitor);
    const escalationFolder = new Mesh(new BoxGeometry(0.44, 0.035, 0.3), accentMaterial);
    escalationFolder.name = `${runtimeSceneObjectPrefix()}.ob-escalation-plan-folder`;
    escalationFolder.position.set(0.5, 0.71, -0.56);
    escalationFolder.rotation.y = 0.1;
    escalationFolder.userData.openClinXrScenarioSetDressing = "ob_escalation_plan_workflow_cue";
    scene.add(escalationFolder);
    return;
  }
  // Render caseDerivedVirtualEnvironment room props for peds/ed (desktop-usable).
  if (sid === "peds_asthma_parent_anxiety_v1") {
    // props from case: exam_table, oxygen_delivery_system, peak_flow_meter, parent_chair, wall_chart (matches packet.ts caseDerivedVirtualEnvironment + runtime-state scaffold)
    const tableMat = new MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.7 });
    const examTable = new Mesh(new BoxGeometry(1.6, 0.82, 0.7), tableMat);
    examTable.name = `${runtimeSceneObjectPrefix()}.peds-exam-table`;
    examTable.position.set(-0.8, 0.41, -0.65);
    examTable.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "exam_table_from_peds_asthma_clinic_exam_room";
    scene.add(examTable);
    const o2Tank = new Mesh(new CylinderGeometry(0.12, 0.12, 0.9, 12), new MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.6 }));
    o2Tank.name = `${runtimeSceneObjectPrefix()}.peds-oxygen-delivery-system`;
    o2Tank.position.set(1.1, 0.45, -0.35);
    o2Tank.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "oxygen_delivery_system_case_spec";
    scene.add(o2Tank);
    const peak = new Mesh(new BoxGeometry(0.22, 0.12, 0.18), new MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 }));
    peak.name = `${runtimeSceneObjectPrefix()}.peds-peak-flow-meter`;
    peak.position.set(0.6, 0.82, -0.9);
    peak.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "peak_flow_meter_parent_communication_cue";
    scene.add(peak);
    const chairSeat = new Mesh(new BoxGeometry(0.48, 0.08, 0.48), new MeshStandardMaterial({ color: 0x334155, roughness: 0.85 }));
    chairSeat.name = `${runtimeSceneObjectPrefix()}.peds-parent-chair-seat`;
    chairSeat.position.set(1.6, 0.38, -1.1);
    scene.add(chairSeat);
    const chairBack = new Mesh(new BoxGeometry(0.48, 0.55, 0.06), new MeshStandardMaterial({ color: 0x334155, roughness: 0.85 }));
    chairBack.name = `${runtimeSceneObjectPrefix()}.peds-parent-chair-back`;
    chairBack.position.set(1.6, 0.68, -1.32);
    scene.add(chairBack);
    const chart = new Mesh(new BoxGeometry(0.6, 0.4, 0.02), new MeshStandardMaterial({ color: 0xfefce8, roughness: 0.9 }));
    chart.name = `${runtimeSceneObjectPrefix()}.peds-wall-chart`;
    chart.position.set(-2.9, 1.6, -1.55);
    chart.rotation.y = 1.57;
    chart.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "wall_chart_clinic_review_cue";
    scene.add(chart);
  }
  if (sid === "ed_chest_pain_priority_v1") {
    // #97: skip case-derived gurney — procedural stretcher slot is the single visible bed.
    const monBack = new Mesh(new BoxGeometry(0.55, 0.32, 0.04), new MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 }));
    monBack.name = `${runtimeSceneObjectPrefix()}.ed-cardiac-monitor`;
    monBack.position.set(-2.6, 1.45, -1.4);
    monBack.rotation.y = 0.8;
    monBack.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "cardiac_monitor_priority_vitals";
    scene.add(monBack);
    const cart = new Mesh(new BoxGeometry(0.55, 0.7, 0.35), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.55 }));
    cart.name = `${runtimeSceneObjectPrefix()}.ed-crash-cart`;
    cart.position.set(2.1, 0.35, -0.4);
    cart.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "crash_cart_urgent_escalation";
    scene.add(cart);
    const ivPole = new Mesh(new CylinderGeometry(0.03, 0.03, 1.4, 6), new MeshStandardMaterial({ color: 0x64748b, roughness: 0.7 }));
    ivPole.name = `${runtimeSceneObjectPrefix()}.ed-iv-stand`;
    ivPole.position.set(-1.8, 0.7, -0.95);
    ivPole.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "iv_stand_fluid_case";
    scene.add(ivPole);
    const defib = new Mesh(new BoxGeometry(0.38, 0.28, 0.18), new MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 }));
    defib.name = `${runtimeSceneObjectPrefix()}.ed-defibrillator`;
    defib.position.set(1.7, 0.9, -1.25);
    defib.rotation.y = -0.4;
    defib.userData.openClinXrCaseDerivedVirtualEnvironmentProp = "defibrillator_chest_pain_priority";
    scene.add(defib);
  }
}

function recordDynamicSceneObjectNamingEvidence(scene: Scene): DynamicSceneObjectNamingEvidence {
  const namedObjects: string[] = [];
  scene.traverse((object) => {
    if (object.name.trim().length > 0) namedObjects.push(object.name);
  });
  const scenarioPrefix = `${runtimeSceneObjectPrefix()}.`;
  const stableIwsdkObjectNameSet = new Set<string>(iwsdkStationSceneObjectNames);
  const stableIwsdkLegacyObjectNames = namedObjects.filter((name) => stableIwsdkObjectNameSet.has(name));
  const stableIwsdkLegacyObjectNameSet = new Set(stableIwsdkLegacyObjectNames);
  const hardcodedEdPrefixLeakNames = namedObjects.filter((name) =>
    name.startsWith("openclinxr.ed-chest-pain.") && !stableIwsdkLegacyObjectNameSet.has(name)
  );
  const sampleScenarioPrefixedObjectNames = namedObjects.filter((name) => name.startsWith(scenarioPrefix)).slice(0, 40);
  const evidence: DynamicSceneObjectNamingEvidence = {
    source: "window.__openClinXrDynamicSceneObjectNamingEvidence",
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    selectedScenarioId: selectedScenarioId(),
    selectedScenarioMatchesBundle: !isSelectedScenarioRuntimeBundleMismatch(),
    totalNamedObjects: namedObjects.length,
    scenarioPrefixedObjectCount: namedObjects.filter((name) => name.startsWith(scenarioPrefix)).length,
    stableIwsdkLegacyObjectNameCount: stableIwsdkLegacyObjectNames.length,
    stableIwsdkLegacyObjectNames: stableIwsdkLegacyObjectNames.slice(0, 40),
    hardcodedEdPrefixLeakCount: hardcodedEdPrefixLeakNames.length,
    hardcodedEdPrefixLeakNames: hardcodedEdPrefixLeakNames.slice(0, 40),
    sampleScenarioPrefixedObjectNames,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness"],
  };
  window.__openClinXrDynamicSceneObjectNamingEvidence = evidence;
  return evidence;
}

function formatRuntimeLocomotionLine(
  inputEvidence: OpenClinXrInputEvidence,
  captureSummary: ManualPerformanceCaptureSummary | null,
): string {
  const currentSource = inputEvidence.activeLocomotionSource ?? "none";
  if (currentSource !== "none") {
    const structured = window.__openClinXrExamineeLocomotionEvidence;
    const structuredSummary = structured
      ? ` path ${structured.distanceMeters}m/${structured.sampleCount} samples`
      : "";
    return `Movement: active ${currentSource}; d ${inputEvidence.locomotionDelta?.distanceMeters ?? 0}m; turn ${inputEvidence.locomotionDelta?.turnRadians ?? 0}rad;${structuredSummary} ${formatLocomotionProbeSummary(captureSummary?.locomotionProbeSummary ?? null)}`;
  }
  if (lastObservedLocomotionSummary) {
    const ageMs = Math.max(0, Math.round(performance.now() - lastObservedLocomotionSummary.atMs));
    const structured = window.__openClinXrExamineeLocomotionEvidence;
    const structuredSummary = structured
      ? ` path ${structured.distanceMeters}m/${structured.sampleCount} samples`
      : "";
    return `Movement: last ${lastObservedLocomotionSummary.source} ${ageMs}ms ago; d ${lastObservedLocomotionSummary.distanceMeters}m; turn ${lastObservedLocomotionSummary.turnRadians}rad;${structuredSummary} ${formatLocomotionProbeSummary(captureSummary?.locomotionProbeSummary ?? null)}`;
  }
  return `Movement: none observed; ${formatLocomotionProbeSummary(captureSummary?.locomotionProbeSummary ?? null)}`;
}

function formatHandSelectStatus(state: XrHandSelectStateEvidence | undefined): string {
  if (!state) {
    return "idle";
  }
  const reason = state.blockedReason ? `; ${state.blockedReason}` : "";
  const fired = state.firedCount > 0 ? `; fired ${state.firedCount}` : "";
  return `${state.status}; dwell ${state.dwellMs}ms${fired}${reason}`;
}

function formatCaptureReadinessStatus(summary: ManualPerformanceCaptureSummary | null): string {
  if (!summary) {
    return "pending capture";
  }
  const status = summary.manualValidationReady ? "ready" : `${summary.blockers.length} blockers`;
  return `${status}; vr ${summary.immersiveFramesObserved ?? 0}; window ${summary.sampleWindowSize ?? 0}`;
}

function formatTechnicalGapStatus(summary: ManualPerformanceCaptureSummary | null): string {
  return summary?.technicalGaps[0] ?? "none";
}

function createExamineeLocomotionTrail(): Group {
  const trail = new Group();
  trail.name = "openclinxr.examinee-locomotion-trail-cue";
  const visibleInSceneOnlyReview = !isSceneOnlyVisualReviewCaptureMode();
  const ring = new Mesh(
    new CylinderGeometry(0.2, 0.2, 0.012, 32),
    new MeshBasicMaterial({ color: 0x2f80ed, transparent: true, opacity: 0.38 }),
  );
  ring.name = "examinee_runtime_position_ring_cue";
  ring.position.y = 0.012;
  ring.visible = visibleInSceneOnlyReview;
  trail.add(ring);
  const heading = new Mesh(
    new BoxGeometry(0.055, 0.018, 0.32),
    new MeshBasicMaterial({ color: 0x113f75, transparent: true, opacity: 0.6 }),
  );
  heading.name = "examinee_runtime_heading_cue";
  heading.position.set(0, 0.04, -0.18);
  heading.visible = visibleInSceneOnlyReview;
  trail.add(heading);
  trail.visible = false;
  return trail;
}

function buildExamineeLocomotionEvidence(input: {
  inputEvidence: OpenClinXrInputEvidence;
  startPose: RigPoseEvidence | null;
  distanceMeters: number;
  turnRadians: number;
  sampleCount: number;
}): ExamineeLocomotionEvidence | null {
  const source = input.inputEvidence.activeLocomotionSource ?? "none";
  const delta = input.inputEvidence.locomotionDelta;
  if (source === "none" || !delta) {
    return null;
  }
  const currentPose: RigPoseEvidence = {
    x: input.inputEvidence.rigPosition.x,
    z: input.inputEvidence.rigPosition.z,
    yawRadians: Number((input.turnRadians + delta.turnRadians).toFixed(3)),
  };
  return {
    source: source === "mixed" ? "mixed" : source,
    startPose: input.startPose ?? currentPose,
    currentPose,
    distanceMeters: Number((input.distanceMeters + delta.distanceMeters).toFixed(3)),
    turnRadians: Number((input.turnRadians + delta.turnRadians).toFixed(3)),
    sampleCount: input.sampleCount + 1,
    pathCueIds: [
      "examinee_runtime_position_ring_cue",
      "examinee_runtime_heading_cue",
      "structured_examinee_locomotion_path_evidence",
    ],
    notEvidenceFor: [
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "motion_comfort_validation",
    ],
  };
}

function updateExamineeLocomotionTrail(trail: Group, evidence: ExamineeLocomotionEvidence): void {
  if (isSceneOnlyVisualReviewCaptureMode()) {
    trail.visible = false;
    for (const child of trail.children) {
      child.visible = false;
    }
    trail.userData.openClinXrDynamicScenePolicy = "hidden_in_scene_only_visual_review_while_locomotion_evidence_remains_window_backed";
    return;
  }
  trail.visible = true;
  trail.position.set(evidence.currentPose.x, 0.01, evidence.currentPose.z);
  trail.rotation.y = evidence.currentPose.yawRadians;
  trail.userData.openClinXrExamineeLocomotionEvidence = evidence;
}

/**
 * #91: clinical idle owns arm hang (clinical-idle-posture.ts). Role maps keep head +
 * whole-root silhouette only — pre-fix showed role arm eulers overwrote hang and left
 * family wrists under 0.25 m drop / patient arms with z=±0.74 plank abduction.
 * Pediatric asthma keeps hands-near-chest (case-driven distress), still wrist-below-shoulder.
 */
function applyGeneratedHumanoidRoleSpecificPosture(humanoid: Group, actorId: string): void {
  const actorRole = runtimeActorRole(actorId);
  if (actorId === runtimePatientActorId()) {
    if (isPediatricAsthmaRuntimeScenario()) {
      const pediatricRespiratoryDistressRotations = new Map<string, { x?: number; y?: number; z?: number }>([
        ["head", { x: -0.18, y: 0.1 }],
        // Hands near chest for work-of-breathing — hang-compatible drop, not T-pose plank.
        ["upper_armL", { x: -1.34, y: 0.16, z: -0.5 }],
        ["forearmL", { x: -0.78, y: -0.2, z: 0.62 }],
        ["handL", { x: 0.18, y: 0.14, z: -0.24 }],
        ["upper_armR", { x: -1.22, y: -0.12, z: 0.44 }],
        ["forearmR", { x: -0.7, y: 0.2, z: -0.58 }],
        ["handR", { x: 0.18, y: -0.14, z: 0.24 }],
      ]);
      applyHumanoidJointRotationsByAlias(
        humanoid,
        pediatricRespiratoryDistressRotations,
        "pediatric_asthma_hunched_hands_near_chest",
      );
      humanoid.scale.set(0.78, 0.74, 0.78);
      humanoid.rotation.x = -0.14;
      humanoid.rotation.y = 0.08;
      humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
        "pediatric_patient_smaller_silhouette_cue",
        "pediatric_asthma_hunched_work_of_breathing_pose_cue",
        "patient_hands_near_chest_respiratory_distress_cue",
        "pediatric_patient_case_role_distinct_from_adult_actor_pose_cue",
      ];
      return;
    }
    // Head only — arms remain clinical-idle hang (#91). Rejected: re-planking with z=±0.74.
    const patientRotations = new Map<string, { x?: number; y?: number; z?: number }>([
      ["head", { x: -0.12, y: 0.08 }],
    ]);
    applyHumanoidJointRotationsByAlias(humanoid, patientRotations, "patient_low_guarded_clinical_attention_pose");
    humanoid.rotation.x = -0.08;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "patient_chest_pain_guarding_pose_cue",
      "patient_reclined_distress_attention_cue",
    ];
    applyScenarioDerivedPatientPosture(humanoid);
    return;
  }
  if (actorId === runtimeClinicalTeamActorId()) {
    const clinicalTeamRotations = new Map<string, { x?: number; y?: number; z?: number }>([
      ["head", { x: -0.04, y: -0.1 }],
    ]);
    applyHumanoidJointRotationsByAlias(humanoid, clinicalTeamRotations, "clinical_team_low_asymmetric_attention_pose");
    humanoid.scale.set(1.04, 1.08, 1.04);
    humanoid.rotation.y = -0.16;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      actorRole === "nurse" ? "nurse_adult_clinical_silhouette_cue" : "clinical_team_adult_silhouette_cue",
      "nurse_monitor_workflow_attention_pose_cue",
      "nurse_asymmetric_equipment_attention_pose_cue",
    ];
    applyScenarioDerivedClinicalTeamPosture(humanoid);
    return;
  }
  if (actorId === runtimeFamilyActorId()) {
    const familyRotations = new Map<string, { x?: number; y?: number; z?: number }>([
      ["head", { x: -0.08, y: 0.14 }],
    ]);
    applyHumanoidJointRotationsByAlias(humanoid, familyRotations, "family_low_anxious_observer_pose");
    humanoid.scale.set(1.05, 1.04, 1.05);
    humanoid.rotation.y = 0.18;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "adult_family_member_silhouette_cue",
      "family_worried_observer_pose_cue",
      "parent_asymmetric_anxiety_pose_cue",
    ];
    applyScenarioDerivedFamilyPosture(humanoid);
  }
}

function applyScenarioDerivedPatientPosture(humanoid: Group): void {
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    humanoid.rotation.x = -0.04;
    humanoid.rotation.y = -0.18;
    humanoid.rotation.z = 0.04;
    humanoid.scale.set(1.02, 1, 1.04);
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "ob_preeclampsia_seated_headache_attention_pose_cue",
      "ob_pregnancy_weight_shift_silhouette_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "ob_preeclampsia_headache_weight_shift";
    return;
  }
  if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    humanoid.rotation.x = -0.16;
    humanoid.rotation.y = 0.2;
    humanoid.rotation.z = -0.06;
    humanoid.scale.set(0.98, 0.96, 1);
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "clinic_rlq_pain_forward_guarding_pose_cue",
      "interpreter_mediated_attention_shift_pose_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "clinic_abdominal_pain_forward_guarding";
    return;
  }
  if (scenarioId === "oncology_bad_news_family_v1") {
    humanoid.rotation.x = -0.03;
    humanoid.rotation.y = 0.12;
    humanoid.rotation.z = -0.035;
    humanoid.scale.set(0.96, 0.94, 0.98);
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "oncology_serious_news_softened_seated_pose_cue",
      "family_conversation_attention_pose_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "oncology_bad_news_softened_seated";
    return;
  }
  if (scenarioId === "postop_fever_consult_pressure_v1") {
    humanoid.rotation.x = -0.1;
    humanoid.rotation.y = -0.08;
    humanoid.rotation.z = 0.05;
    humanoid.scale.set(1, 0.97, 1.02);
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "postop_fever_guarded_abdominal_dressing_pose_cue",
      "consult_pressure_attention_pose_cue",
      "case_definition_driven_patient_pose_not_chest_pain_default",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "postop_fever_guarded_abdomen";
  }
}

function applyScenarioDerivedClinicalTeamPosture(humanoid: Group): void {
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    humanoid.rotation.y = -0.28;
    humanoid.rotation.z = -0.04;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "ob_bp_repeat_workflow_attention_pose_cue",
      "preeclampsia_escalation_clinician_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "ob_bp_escalation_clinical_team";
  } else if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    humanoid.rotation.y = 0.34;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "clinic_interpreter_triangle_attention_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "clinic_interpreter_triangle";
  } else if (scenarioId === "oncology_bad_news_family_v1") {
    humanoid.rotation.y = -0.08;
    humanoid.rotation.x = -0.03;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "oncology_soft_consult_seated_attention_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "oncology_soft_consult_attention";
  } else if (scenarioId === "postop_fever_consult_pressure_v1") {
    humanoid.rotation.y = -0.34;
    humanoid.rotation.z = 0.05;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "postop_surgery_resident_time_pressure_pose_cue",
      "case_definition_driven_clinical_team_pose",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "postop_time_pressure_consult";
  }
}

function applyScenarioDerivedFamilyPosture(humanoid: Group): void {
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;
  if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    humanoid.rotation.y = -0.32;
    humanoid.rotation.z = 0.035;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "clinic_interpreter_attention_pose_cue",
      "case_definition_driven_family_or_interpreter_pose",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "clinic_interpreter_attention";
  } else if (scenarioId === "oncology_bad_news_family_v1") {
    humanoid.rotation.y = 0.26;
    humanoid.rotation.x = -0.06;
    humanoid.rotation.z = 0.05;
    humanoid.userData.openClinXrRoleSpecificPostureCueIds = [
      "oncology_family_emotion_support_pose_cue",
      "case_definition_driven_family_or_interpreter_pose",
    ];
    humanoid.userData.openClinXrScenarioDerivedPosture = "oncology_family_emotional_support";
  } else if (scenarioId === "peds_asthma_parent_anxiety_v1") {
    humanoid.userData.openClinXrScenarioDerivedPosture = "pediatric_parent_anxiety_support";
  }
}

function configureSemanticRolePoseOverlay(mesh: Mesh, cueId: string): void {
  mesh.userData.openClinXrRolePoseCueId = cueId;
  mesh.userData.openClinXrRuntimeVisibilityPolicy = "semantic_role_pose_overlay_hidden_unless_affordance_or_debug_capture";
  if (!shouldShowRuntimeAffordanceMarkers()) {
    mesh.visible = false;
  }
}

type HumanoidCueMode = "generated_glb" | "primitive_fallback";

function shouldShowProceduralHumanoidDetailCues(faceCueMode: HumanoidCueMode): boolean {
  // #368: capture mode is NOT a reason to draw the hand-authored face/role cue
  // primitives. An actor with real face geometry renders its real face in every
  // capture mode; only a primitive_fallback body (no face geometry) and the
  // deliberate affordance/debug marker surface still show them.
  return faceCueMode === "primitive_fallback" || shouldShowRuntimeAffordanceMarkers();
}

function addRoleSpecificHumanoidVisuals(
  humanoid: Group,
  actorId: string,
  faceCueMode: HumanoidCueMode = "generated_glb",
): void {
  addActorSpecificIdentityVariantCue(humanoid, actorId, faceCueMode);
  const showProceduralRoleCues = shouldShowProceduralHumanoidDetailCues(faceCueMode);
  if (!showProceduralRoleCues) {
    humanoid.userData.openClinXrProceduralRoleCuePolicy =
      "hidden_for_generated_glb_normal_runtime_to_keep_encounter_view_clean_and_asset_driven";
    return;
  }
  if (actorId === runtimePatientActorId()) {
    const leftRespiratoryArmCue = new Mesh(new BoxGeometry(0.05, 0.42, 0.045), new MeshStandardMaterial({ color: 0x0e8c92, roughness: 0.72, transparent: true, opacity: 0.86 }));
    leftRespiratoryArmCue.name = `${runtimeSceneObjectPrefix()}.pediatric-patient-left-arm-hunched-breathing-pose-cue`;
    leftRespiratoryArmCue.position.set(-0.17, 1.2, 0.345);
    leftRespiratoryArmCue.rotation.z = -0.68;
    configureSemanticRolePoseOverlay(leftRespiratoryArmCue, "pediatric_patient_left_arm_hunched_breathing_pose_cue");
    humanoid.add(leftRespiratoryArmCue);
    const rightRespiratoryArmCue = new Mesh(new BoxGeometry(0.05, 0.42, 0.045), new MeshStandardMaterial({ color: 0x0e8c92, roughness: 0.72, transparent: true, opacity: 0.86 }));
    rightRespiratoryArmCue.name = `${runtimeSceneObjectPrefix()}.pediatric-patient-right-arm-hunched-breathing-pose-cue`;
    rightRespiratoryArmCue.position.set(0.17, 1.2, 0.345);
    rightRespiratoryArmCue.rotation.z = 0.68;
    configureSemanticRolePoseOverlay(rightRespiratoryArmCue, "pediatric_patient_right_arm_hunched_breathing_pose_cue");
    humanoid.add(rightRespiratoryArmCue);
    const gown = new Mesh(new BoxGeometry(0.24, 0.1, 0.014), new MeshStandardMaterial({ color: 0xcfe5ee, roughness: 0.86, transparent: true, opacity: 0.72 }));
    gown.name = `${runtimeSceneObjectPrefix()}.patient-hospital-gown-torso`;
    gown.position.set(0, 1.26, 0.322);
    humanoid.add(gown);
    const pediatricHeightBand = new Mesh(new BoxGeometry(0.2, 0.045, 0.012), new MeshStandardMaterial({ color: 0x91d5ff, roughness: 0.74, transparent: true, opacity: 0.66 }));
    pediatricHeightBand.name = `${runtimeSceneObjectPrefix()}.pediatric-small-stature-band-cue`;
    pediatricHeightBand.position.set(0, 1.05, 0.33);
    humanoid.add(pediatricHeightBand);
    const blanket = new Mesh(new BoxGeometry(0.28, 0.08, 0.016), new MeshStandardMaterial({ color: 0xd8e6ef, roughness: 0.9, transparent: true, opacity: 0.68 }));
    blanket.name = `${runtimeSceneObjectPrefix()}.patient-bedside-blanket-cue`;
    blanket.position.set(0, 0.86, 0.326);
    humanoid.add(blanket);
    const chestGuard = new Mesh(new BoxGeometry(0.22, 0.05, 0.038), new MeshStandardMaterial({ color: 0xf2d0bd, roughness: 0.72 }));
    chestGuard.name = `${runtimeSceneObjectPrefix()}.patient-hand-to-chest-distress-cue`;
    chestGuard.position.set(0.02, 1.29, 0.335);
    humanoid.add(chestGuard);
    recordRoleDistinctHumanoidCue(actorId, "patient_hand_to_chest_distress_cue", chestGuard.name);
    addScenarioSpecificPatientCue(humanoid, actorId);
    if (isPediatricAsthmaRuntimeScenario()) {
      const nebulizerMask = new Mesh(new BoxGeometry(0.13, 0.07, 0.018), new MeshStandardMaterial({ color: 0xdce8ef, roughness: 0.52, transparent: true, opacity: 0.78 }));
      nebulizerMask.name = `${runtimeSceneObjectPrefix()}.pediatric-nebulizer-mask-face-cue`;
      nebulizerMask.position.set(0, 1.47, 0.344);
      humanoid.add(nebulizerMask);
      recordRoleDistinctHumanoidCue(actorId, "pediatric_nebulizer_mask_face_cue", nebulizerMask.name);
      const cannulaTubing = new Mesh(new CylinderGeometry(0.008, 0.008, 0.42, 8), new MeshStandardMaterial({ color: 0xe5f3ff, roughness: 0.48, transparent: true, opacity: 0.82 }));
      cannulaTubing.name = `${runtimeSceneObjectPrefix()}.pediatric-oxygen-tubing-work-of-breathing-cue`;
      cannulaTubing.position.set(-0.15, 1.34, 0.35);
      cannulaTubing.rotation.z = 0.52;
      humanoid.add(cannulaTubing);
      recordRoleDistinctHumanoidCue(actorId, "pediatric_oxygen_tubing_work_of_breathing_cue", cannulaTubing.name);
    }
    return;
  }
  if (actorId === runtimeClinicalTeamActorId()) {
    const badge = new Mesh(new BoxGeometry(0.12, 0.08, 0.016), new MeshStandardMaterial({ color: 0xf8f5df, roughness: 0.62 }));
    badge.name = `${runtimeSceneObjectPrefix()}.nurse-role-badge-cue`;
    badge.position.set(-0.16, 1.24, 0.31);
    humanoid.add(badge);
    const scrubVNeck = new Mesh(new BoxGeometry(0.18, 0.12, 0.014), new MeshStandardMaterial({ color: 0x073f4f, roughness: 0.82, transparent: true, opacity: 0.78 }));
    scrubVNeck.name = `${runtimeSceneObjectPrefix()}.nurse-scrub-v-neck-role-cue`;
    scrubVNeck.position.set(0, 1.31, 0.316);
    scrubVNeck.rotation.z = 0.78;
    humanoid.add(scrubVNeck);
    const nurseReachArm = new Mesh(new BoxGeometry(0.05, 0.54, 0.045), new MeshStandardMaterial({ color: 0x0b7b94, roughness: 0.72, transparent: true, opacity: 0.84 }));
    nurseReachArm.name = `${runtimeSceneObjectPrefix()}.nurse-reaching-to-oxygen-equipment-pose-cue`;
    nurseReachArm.position.set(-0.22, 1.16, 0.34);
    nurseReachArm.rotation.z = -0.88;
    configureSemanticRolePoseOverlay(nurseReachArm, "nurse_reaching_to_oxygen_equipment_pose_cue");
    humanoid.add(nurseReachArm);
    const scrubPocket = new Mesh(new BoxGeometry(0.2, 0.12, 0.018), new MeshStandardMaterial({ color: 0x0a4f5a, roughness: 0.8 }));
    scrubPocket.name = `${runtimeSceneObjectPrefix()}.nurse-scrub-pocket-cue`;
    scrubPocket.position.set(0.14, 1.08, 0.31);
    humanoid.add(scrubPocket);
    const stethoscope = new Mesh(new CylinderGeometry(0.006, 0.006, 0.34, 8), new MeshStandardMaterial({ color: 0x17212b, roughness: 0.58 }));
    stethoscope.name = `${runtimeSceneObjectPrefix()}.nurse-stethoscope-clinical-role-cue`;
    stethoscope.position.set(0.02, 1.2, 0.325);
    stethoscope.rotation.z = 0.42;
    humanoid.add(stethoscope);
    recordRoleDistinctHumanoidCue(actorId, "nurse_stethoscope_clinical_role_cue", stethoscope.name);
    addScenarioSpecificClinicalTeamCue(humanoid, actorId);
    return;
  }
  if (actorId === runtimeFamilyActorId()) {
    const cardigan = new Mesh(new BoxGeometry(0.18, 0.22, 0.014), new MeshStandardMaterial({ color: 0x9a6a45, roughness: 0.84, transparent: true, opacity: 0.72 }));
    cardigan.name = `${runtimeSceneObjectPrefix()}.family-civilian-cardigan-cue`;
    cardigan.position.set(-0.08, 1.16, 0.322);
    humanoid.add(cardigan);
    const civilianShoulderBag = new Mesh(new BoxGeometry(0.08, 0.18, 0.03), new MeshStandardMaterial({ color: 0x5b3a24, roughness: 0.88, transparent: true, opacity: 0.8 }));
    civilianShoulderBag.name = `${runtimeSceneObjectPrefix()}.parent-civilian-shoulder-bag-cue`;
    civilianShoulderBag.position.set(-0.22, 1.0, 0.33);
    humanoid.add(civilianShoulderBag);
    const parentSupportArm = new Mesh(new BoxGeometry(0.052, 0.5, 0.046), new MeshStandardMaterial({ color: 0x93603a, roughness: 0.74, transparent: true, opacity: 0.86 }));
    parentSupportArm.name = `${runtimeSceneObjectPrefix()}.parent-supportive-hand-to-chest-pose-cue`;
    parentSupportArm.position.set(0.1, 1.2, 0.34);
    parentSupportArm.rotation.z = 0.72;
    configureSemanticRolePoseOverlay(parentSupportArm, "parent_supportive_hand_to_chest_pose_cue");
    humanoid.add(parentSupportArm);
    const parentConcernCue = new Mesh(new BoxGeometry(0.1, 0.06, 0.014), new MeshStandardMaterial({ color: 0xf3d6ba, roughness: 0.74, transparent: true, opacity: 0.76 }));
    parentConcernCue.name = `${runtimeSceneObjectPrefix()}.family-parent-hand-to-chest-anxiety-cue`;
    parentConcernCue.position.set(0.13, 1.28, 0.335);
    humanoid.add(parentConcernCue);
    recordRoleDistinctHumanoidCue(actorId, "family_parent_hand_to_chest_anxiety_cue", parentConcernCue.name);
    addScenarioSpecificFamilyCue(humanoid, actorId);
  }
}

function recordRoleDistinctHumanoidCue(actorId: string, cueId: string, sceneObjectName: string): void {
  const existing = window.__openClinXrRoleDistinctHumanoidCueEvidence;
  const cues = existing?.cues ?? [];
  if (!cues.some((cue) => cue.actorId === actorId && cue.cueId === cueId && cue.sceneObjectName === sceneObjectName)) {
    cues.push({
      actorId,
      role: runtimeActorRole(actorId) ?? null,
      cueId,
      sceneObjectName,
    });
  }
  window.__openClinXrRoleDistinctHumanoidCueEvidence = {
    source: "window.__openClinXrRoleDistinctHumanoidCueEvidence",
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    cueCount: cues.length,
    cues,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "animation_quality"],
  };
}

function addScenarioExpectationPanel(scene: Scene, stationContext: ReturnType<typeof stationContextForSelectedScenario>): void {
  if (shouldUseCleanHumanoidSourceComparatorCapture()) {
    return;
  }
  const doorwayTheme = scenarioDoorwayVisualTheme();
  const scenarioPanel = createReadableVrTextPanel({
    name: `${runtimeSceneObjectPrefix()}.scenario-expectation-visual-review-panel`,
    title: stationContext.title,
    lines: [
      stationContext.chiefConcern,
      stationContext.initialVitals,
      stationContext.interruption,
    ],
    widthMeters: 2.25,
    heightMeters: 0.82,
    background: doorwayTheme.panelBackground,
    accent: doorwayTheme.panelAccent,
  });
  scenarioPanel.mesh.position.set(-1.08, 1.72, -1.46);
  scenarioPanel.mesh.rotation.y = 0.12;
  scenarioPanel.mesh.userData.openClinXrMultimodalReviewCue =
    "scenario_expectations_visible_inside_3d_scene_for_adversarial_visual_comparison";
  // Review affordance belongs to the reusable pre-encounter volume, not the learner exam volume;
  // the portal hider hides it on entry by this group-membership marker, not its name (#468).
  scenarioPanel.mesh.userData.openClinXrPortalInteriorReviewAffordance = true;
  if (reusableExteriorAnteroom) {
    reusableExteriorAnteroom.add(scenarioPanel.mesh);
  } else {
    scene.add(scenarioPanel.mesh);
  }
}

function addScenarioSpecificPatientCue(humanoid: Group, actorId: string): void {
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    const pregnancyCue = new Mesh(new SphereGeometry(0.16, 24, 16), new MeshStandardMaterial({ color: 0xe5c3a6, roughness: 0.78 }));
    pregnancyCue.name = `${runtimeSceneObjectPrefix()}.ob-pregnancy-abdomen-silhouette-cue`;
    pregnancyCue.position.set(0, 1.02, 0.34);
    pregnancyCue.scale.set(1.15, 0.78, 0.5);
    humanoid.add(pregnancyCue);
    recordRoleDistinctHumanoidCue(actorId, "ob_pregnancy_abdomen_silhouette_cue", pregnancyCue.name);
  } else if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    const rlqCue = new Mesh(new BoxGeometry(0.12, 0.08, 0.018), new MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.74 }));
    rlqCue.name = `${runtimeSceneObjectPrefix()}.clinic-rlq-abdominal-pain-cue`;
    rlqCue.position.set(0.09, 1.0, 0.35);
    humanoid.add(rlqCue);
    recordRoleDistinctHumanoidCue(actorId, "clinic_rlq_abdominal_pain_cue", rlqCue.name);
  } else if (scenarioId === "oncology_bad_news_family_v1") {
    const blanketCue = new Mesh(new BoxGeometry(0.34, 0.12, 0.018), new MeshStandardMaterial({ color: 0xbfd7ea, roughness: 0.9, transparent: true, opacity: 0.86 }));
    blanketCue.name = `${runtimeSceneObjectPrefix()}.oncology-consult-soft-blanket-cue`;
    blanketCue.position.set(0, 0.88, 0.33);
    humanoid.add(blanketCue);
    recordRoleDistinctHumanoidCue(actorId, "oncology_serious_news_soft_consult_cue", blanketCue.name);
  } else if (scenarioId === "postop_fever_consult_pressure_v1") {
    const dressingCue = new Mesh(new BoxGeometry(0.24, 0.1, 0.02), new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.82 }));
    dressingCue.name = `${runtimeSceneObjectPrefix()}.postop-abdominal-dressing-cue`;
    dressingCue.position.set(0, 1.0, 0.35);
    humanoid.add(dressingCue);
    recordRoleDistinctHumanoidCue(actorId, "postop_abdominal_dressing_fever_cue", dressingCue.name);
  }
}

function addScenarioSpecificClinicalTeamCue(humanoid: Group, actorId: string): void {
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;
  if (scenarioId === "ob_headache_preeclampsia_triage_v1") {
    const bpCuffCue = new Mesh(new BoxGeometry(0.2, 0.08, 0.025), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.72 }));
    bpCuffCue.name = `${runtimeSceneObjectPrefix()}.ob-blood-pressure-cuff-workflow-cue`;
    bpCuffCue.position.set(-0.22, 1.1, 0.34);
    humanoid.add(bpCuffCue);
    recordRoleDistinctHumanoidCue(actorId, "ob_bp_repeat_escalation_workflow_cue", bpCuffCue.name);
  } else if (scenarioId === "postop_fever_consult_pressure_v1") {
    const scrubCapCue = new Mesh(new BoxGeometry(0.24, 0.07, 0.02), new MeshStandardMaterial({ color: 0x2563eb, roughness: 0.72 }));
    scrubCapCue.name = `${runtimeSceneObjectPrefix()}.postop-surgery-resident-scrub-cap-cue`;
    scrubCapCue.position.set(0, 1.56, 0.32);
    humanoid.add(scrubCapCue);
    recordRoleDistinctHumanoidCue(actorId, "postop_surgery_resident_pressure_cue", scrubCapCue.name);
  }
}

function addScenarioSpecificFamilyCue(humanoid: Group, actorId: string): void {
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;
  if (scenarioId === "oncology_bad_news_family_v1") {
    const tissueCue = new Mesh(new BoxGeometry(0.1, 0.06, 0.03), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 }));
    tissueCue.name = `${runtimeSceneObjectPrefix()}.oncology-family-tissue-emotion-cue`;
    tissueCue.position.set(0.18, 1.2, 0.35);
    humanoid.add(tissueCue);
    recordRoleDistinctHumanoidCue(actorId, "oncology_family_emotion_tissue_cue", tissueCue.name);
  } else if (scenarioId === "clinic_abdominal_pain_interpreter_v1") {
    const interpreterBoundaryCue = new Mesh(new BoxGeometry(0.22, 0.06, 0.018), new MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.76 }));
    interpreterBoundaryCue.name = `${runtimeSceneObjectPrefix()}.clinic-family-interpreter-boundary-cue`;
    interpreterBoundaryCue.position.set(0, 1.32, 0.34);
    humanoid.add(interpreterBoundaryCue);
    recordRoleDistinctHumanoidCue(actorId, "clinic_family_interpreter_boundary_cue", interpreterBoundaryCue.name);
  }
}

function addActorSpecificIdentityVariantCue(
  humanoid: Group,
  actorId: string,
  faceCueMode: HumanoidCueMode = "generated_glb",
): void {
  const actorRole = runtimeActorRole(actorId) ?? "actor";
  const actorHash = Array.from(actorId).reduce((hash, char) => hash + char.charCodeAt(0), 0);
  const hairPalette = [0x2f2118, 0x5c4033, 0x1f2937, 0x7c4a24, 0x111827];
  const accentPalette = [0x2563eb, 0x0f766e, 0xb45309, 0xbe123c, 0x6d28d9];
  const skinPalette = [0xf2d2b6, 0xc58f67, 0x8d5b3f, 0xe6b98f, 0x6f432f];
  const doorwayTheme = scenarioDoorwayVisualTheme();
  const hairColor = hairPalette[actorHash % hairPalette.length] ?? 0x2f2118;
  const skinColor = skinPalette[(actorHash + 2) % skinPalette.length] ?? 0xc58f67;
  const accentColor = actorRole === "patient" ? doorwayTheme.reusedAssetAccentColor : accentPalette[(actorHash + actorRole.length) % accentPalette.length] ?? doorwayTheme.reusedAssetAccentColor;
  const facialExpressionColor = actorRole === "patient" ? 0xbe123c : actorRole.includes("family") || actorRole.includes("parent") ? 0x92400e : 0x1d4ed8;
  const showProceduralFaceOverlay = shouldShowProceduralHumanoidDetailCues(faceCueMode);
  const cueIds = [
    "actor_specific_hair_face_variant_cue",
    "actor_specific_clothing_accent_variant_cue",
    "actor_specific_clothing_layer_silhouette_cue",
  ];
  const hairCapName = `${runtimeSceneObjectPrefix()}.${actorId}.actor-specific-hair-cap-variant-cue`;
  if (showProceduralFaceOverlay) {
    const hairCap = new Mesh(new SphereGeometry(0.155, 18, 10), new MeshStandardMaterial({ color: hairColor, roughness: 0.86 }));
    hairCap.name = hairCapName;
    hairCap.position.set(0, 1.78, 0.19);
    hairCap.scale.set(0.62, 0.16, 0.34);
    humanoid.add(hairCap);
  }
  if (showProceduralFaceOverlay) {
    cueIds.push("visible_eye_gaze_anchor_cue", "emotion_mouth_viseme_anchor_cue", "emotion_brow_tension_cue");
    const faceTonePatch = new Mesh(new SphereGeometry(0.105, 18, 12), new MeshStandardMaterial({ color: skinColor, roughness: 0.78, transparent: true, opacity: 0.88 }));
    faceTonePatch.name = `${runtimeSceneObjectPrefix()}.${actorId}.actor-specific-face-tone-and-cheek-volume-cue`;
    faceTonePatch.position.set(0, 1.62, 0.315);
    faceTonePatch.scale.set(0.82, 0.95, 0.24);
    humanoid.add(faceTonePatch);
    const leftEye = new Mesh(new SphereGeometry(0.018, 10, 8), new MeshStandardMaterial({ color: 0x111827, roughness: 0.48 }));
    leftEye.name = `${runtimeSceneObjectPrefix()}.${actorId}.left-eye-gaze-anchor-cue`;
    leftEye.position.set(-0.044, 1.642, 0.345);
    humanoid.add(leftEye);
    const rightEye = new Mesh(new SphereGeometry(0.018, 10, 8), new MeshStandardMaterial({ color: 0x111827, roughness: 0.48 }));
    rightEye.name = `${runtimeSceneObjectPrefix()}.${actorId}.right-eye-gaze-anchor-cue`;
    rightEye.position.set(0.044, 1.642, 0.345);
    humanoid.add(rightEye);
    const mouth = new Mesh(new BoxGeometry(0.075, 0.012, 0.01), new MeshStandardMaterial({ color: facialExpressionColor, roughness: 0.62 }));
    mouth.name = `${runtimeSceneObjectPrefix()}.${actorId}.emotion-mouth-line-viseme-anchor-cue`;
    mouth.position.set(0, 1.585, 0.35);
    mouth.rotation.z = actorRole === "patient" ? -0.08 : actorRole.includes("family") || actorRole.includes("parent") ? 0.12 : 0;
    humanoid.add(mouth);
    const brow = new Mesh(new BoxGeometry(0.13, 0.012, 0.008), new MeshStandardMaterial({ color: hairColor, roughness: 0.7 }));
    brow.name = `${runtimeSceneObjectPrefix()}.${actorId}.emotion-brow-tension-cue`;
    brow.position.set(0, 1.675, 0.346);
    brow.rotation.z = actorRole === "patient" ? -0.08 : actorRole.includes("family") || actorRole.includes("parent") ? 0.1 : 0.02;
    humanoid.add(brow);
    recordRoleDistinctHumanoidCue(actorId, "visible_eye_gaze_anchor_cue", leftEye.name);
    recordRoleDistinctHumanoidCue(actorId, "visible_eye_gaze_anchor_cue", rightEye.name);
    recordRoleDistinctHumanoidCue(actorId, "emotion_mouth_viseme_anchor_cue", mouth.name);
    recordRoleDistinctHumanoidCue(actorId, "emotion_brow_tension_cue", brow.name);
  }
  const torsoLayerName = `${runtimeSceneObjectPrefix()}.${actorId}.actor-specific-clothing-layer-silhouette-cue`;
  const roleAccentName = `${runtimeSceneObjectPrefix()}.${actorId}.actor-specific-role-accent-cue`;
  if (showProceduralFaceOverlay) {
    const torsoLayer = new Mesh(new BoxGeometry(0.31, 0.44, 0.018), new MeshStandardMaterial({ color: accentColor, roughness: 0.82, transparent: true, opacity: 0.38 }));
    torsoLayer.name = torsoLayerName;
    torsoLayer.position.set(0, 1.14, 0.315);
    humanoid.add(torsoLayer);
    const roleAccent = new Mesh(new BoxGeometry(0.2, 0.035, 0.016), new MeshStandardMaterial({ color: accentColor, roughness: 0.7 }));
    roleAccent.name = roleAccentName;
    roleAccent.position.set(0, 1.21, 0.34);
    humanoid.add(roleAccent);
  }
  humanoid.userData.openClinXrActorSpecificIdentityVariantCue = {
    actorId,
    actorRole,
    hairColor,
    skinColor,
    accentColor,
    cueIds,
    faceCueMode,
    proceduralCueVisibilityPolicy: showProceduralFaceOverlay
      ? "visible_for_fallback_or_explicit_visual_review_capture"
      : "metadata_only_for_generated_glb_normal_runtime_to_avoid_reused_proxy_clutter",
    reusedAssetAccentColor: doorwayTheme.reusedAssetAccentColor,
    runtimeThemePolicy: "actor_identity_cues_derive_from_encounter_runtime_theme_when_assets_are_reused",
    notEvidenceFor: "production humanoid asset readiness or validated identity realism",
  };
  recordRoleDistinctHumanoidCue(actorId, "actor_specific_hair_face_variant_cue", hairCapName);
  recordRoleDistinctHumanoidCue(actorId, "actor_specific_clothing_layer_silhouette_cue", torsoLayerName);
  recordRoleDistinctHumanoidCue(actorId, "actor_specific_clothing_accent_variant_cue", roleAccentName);
}

function createClinicalPanel(): ReadableVrTextPanel {
  const panel = createReadableVrTextPanel({
    name: iwsdkStationSceneObjects.clinicalPanel,
    title: "Simulated EHR",
    lines: clinicalPanelLinesForSelectedStation(),
    widthMeters: 2.3,
    heightMeters: 1.15,
    background: "#fff8e5",
    accent: "#7d4f28",
  });
  panel.mesh.position.set(-1.55, 2.62, -1.42);
  panel.mesh.rotation.y = 0.34;
  return panel;
}

function clinicalPanelLinesForSelectedStation(): string[] {
  return [
    `Chief concern: ${selectedStationContext.chiefConcern}`,
    `Vitals/context: ${selectedStationContext.initialVitals}`,
    `Interruption: ${selectedStationContext.interruption}`,
    `Scenario: ${selectedStationContext.title}`,
    `Bundle scenario: ${encounterRuntimeAssetBundle.scenarioId}${isSelectedScenarioRuntimeBundleMismatch() ? ` (selected ${selectedScenarioId()} mismatch hidden)` : " (selected match)"}`,
    `Station context: ${encounterRuntimeAssetBundle.sceneManifest.stationContext?.title ?? "manifest stationContext missing"}`,
    `Actor roster: ${encounterRuntimeAssetBundle.actors.map((actor) => `${actor.actorId}:${actor.role}`).join(", ") || "none"}`,
    `Equipment IDs: ${encounterRuntimeAssetBundle.equipment.map((equipment) => equipment.equipmentId).join(", ") || "none"}`,
    `Dialogue turns: ${(encounterRuntimeAssetBundle.sceneManifest.dialogueTurns ?? []).map((turn) => `${turn.traceTag}->${turn.actorId}`).join(", ") || "none"}`,
    `Room props: ${encounterRuntimeAssetBundle.sceneManifest.roomProps.map((prop) => prop.propId).join(", ") || "none"}`,
  ];
}

const readableVrTextPanelEvidence = new Map<string, ReadableVrTextPanelEvidence>();

function publishReadableVrTextPanelEvidence(evidence: ReadableVrTextPanelEvidence): void {
  readableVrTextPanelEvidence.set(evidence.name, evidence);
  window.__openClinXrTextPanelEvidence = {
    source: "window.__openClinXrTextPanelEvidence",
    panelCount: readableVrTextPanelEvidence.size,
    panels: [...readableVrTextPanelEvidence.values()].sort((left, right) => left.name.localeCompare(right.name)),
    limitations: ["metadata_only_requires_foreground_headset_confirmation"],
  };
}

function createReadableVrTextPanel(options: {
  name: string;
  title: string;
  lines: readonly string[];
  widthMeters: number;
  heightMeters: number;
  background: string;
  accent: string;
}): ReadableVrTextPanel {
  const panelCanvas = document.createElement("canvas");
  panelCanvas.width = 1280;
  panelCanvas.height = 640;
  const context = panelCanvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create VR text panel canvas context");
  }
  const panelContext = context;
  const texture = new CanvasTexture(panelCanvas);
  const panel = new Mesh(
    new PlaneGeometry(options.widthMeters, options.heightMeters),
    new MeshBasicMaterial({ map: texture, side: DoubleSide }),
  );
  panel.name = options.name;

  function update(lines: readonly string[]): void {
    panelContext.fillStyle = options.background;
    panelContext.fillRect(0, 0, panelCanvas.width, panelCanvas.height);
    panelContext.fillStyle = options.accent;
    panelContext.fillRect(0, 0, 22, panelCanvas.height);
    panelContext.fillStyle = "#172332";
    panelContext.font = "700 62px Arial";
    panelContext.fillText(options.title, 58, 92);
    panelContext.font = "38px Arial";
    let y = 162;
    for (const line of lines) {
      y = drawWrappedText(panelContext, line, 58, y, panelCanvas.width - 116, 50) + 14;
    }
    texture.needsUpdate = true;
    publishReadableVrTextPanelEvidence(buildReadableVrTextPanelEvidence({
      name: options.name,
      title: options.title,
      lines,
      canvasPixels: { width: panelCanvas.width, height: panelCanvas.height },
      worldMeters: { width: options.widthMeters, height: options.heightMeters },
      updatedAtMs: performance.now(),
    }));
  }

  update(options.lines);
  return { mesh: panel, update };
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    context.fillText(line, x, currentY);
  }
  return currentY + lineHeight;
}

function addControllerAffordances(
  renderer: WebGLRenderer,
  scene: Scene,
  onSelect: (event: XrSelectControllerEvent) => void,
): void {
  const controllerModelFactory = new XRControllerModelFactory();
  const gripNames = [
    iwsdkStationSceneObjects.controllerGripLeft,
    iwsdkStationSceneObjects.controllerGripRight,
  ];
  // framing-polish-parent-nurse-garment-ui-xr-v1: default XR controller models sit mid-frame as teal/chevron
  // boards over the torso during desktop sleeve-deform capture — hide until immersive present.
  const hideControllersForCleanCapture = shouldUseCleanHumanoidSourceComparatorCapture()
    || isRealGarmentSleeveDeformCapture()
    || isHumanoidMouthGazePoseReviewCaptureMode();
  for (let index = 0; index < 2; index += 1) {
    const controller = renderer.xr.getController(index);
    controller.name = `${runtimeSceneObjectPrefix()}.controller-${index + 1}`;
    (controller as unknown as { addEventListener(type: "select", listener: (event: XrSelectControllerEvent) => void): void })
      .addEventListener("select", onSelect);
    const ray = new Line(
      new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -3)]),
      new LineBasicMaterial({ color: 0xd9c493 }),
    );
    ray.name = `${runtimeSceneObjectPrefix()}.controller-ray-${index + 1}`;
    controller.add(ray);
    if (hideControllersForCleanCapture) {
      controller.visible = false;
      controller.userData.openClinXrComparatorVisibilityPolicy = "hidden_xr_controller_for_clean_humanoid_garment_capture";
    }
    scene.add(controller);
    const controllerGrip = renderer.xr.getControllerGrip(index);
    controllerGrip.userData.openClinXrIwsdkStableObjectName = gripNames[index] ?? null;
    controllerGrip.name = `${runtimeSceneObjectPrefix()}.controller-grip-${index + 1}`;
    controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
    if (hideControllersForCleanCapture) {
      controllerGrip.visible = false;
      controllerGrip.userData.openClinXrComparatorVisibilityPolicy = "hidden_xr_controller_grip_for_clean_humanoid_garment_capture";
    }
    scene.add(controllerGrip);
  }
}

function addHandModels(renderer: WebGLRenderer, scene: Scene, input: {
  onMeshReady: () => void;
  onMeshLoadError: (url: string) => void;
}): void {
  let loadedMeshCount = 0;
  const primitiveFallbacks: Mesh[] = [];
  const meshLoadingManager = new LoadingManager();
  meshLoadingManager.onError = (url) => input.onMeshLoadError(url);
  const meshLoader = new GLTFLoader(meshLoadingManager).setPath(localHandMeshPath);
  const handModelFactory = new XRHandModelFactory(meshLoader, () => {
    loadedMeshCount += 1;
    if (loadedMeshCount >= 2) {
      for (const fallback of primitiveFallbacks) {
        fallback.visible = false;
      }
      input.onMeshReady();
    }
  });
  handModelFactory.setPath(localHandMeshPath);
  for (let index = 0; index < 2; index += 1) {
    const hand = renderer.xr.getHand(index);
    hand.name = `${runtimeSceneObjectPrefix()}.hand-${index + 1}`;
    hand.addEventListener("connected", (event) => {
      const data = "data" in event ? event.data as { handedness?: string } : undefined;
      if (data?.handedness) {
        hand.userData.openClinXrHandedness = data.handedness;
      }
    });
    const meshHandModel = handModelFactory.createHandModel(hand, meshHandModelProfile);
    meshHandModel.name = `${runtimeSceneObjectPrefix()}.hand-model-mesh-${index + 1}`;
    const primitiveFallback = handModelFactory.createHandModel(hand, primitiveHandModelProfile);
    primitiveFallback.name = `${runtimeSceneObjectPrefix()}.hand-model-primitive-fallback-${index + 1}`;
    primitiveFallbacks.push(primitiveFallback as Mesh);
    hand.add(meshHandModel, primitiveFallback);
    scene.add(hand);
  }
}

type KeyboardLocomotionState = {
  forward: number;
  strafe: number;
  turn: number;
};

type XrHandGestureLocomotionState = {
  hands: Record<"left" | "right", XrHandGestureHandState>;
  lastTurnAtMs: number | null;
};

type XrHandGestureHandState = {
  pinchingSinceMs: number | null;
  neutralOffsetX: number;
  neutralOffsetZ: number;
  armed: boolean;
};

type XrHandGestureLocomotionResult = LocomotionVectorEvidence & {
  handInputsObserved: number;
  state: XrHandGestureStateEvidence;
  diagnostics: LocomotionAttemptDiagnosticsEvidence["handGestureHands"];
};

type XrHandGestureVectorResult = LocomotionVectorEvidence & {
  armed: boolean;
  dwellMs: number;
  blockedReason?: XrHandGestureStateEvidence["blockedReason"] | "below_deadzone" | "turn_cooldown";
  diagnostic: LocomotionAttemptDiagnosticsEvidence["handGestureHands"][number];
};

type XrHandSelectState = {
  pinchingSinceMs: number | null;
  neutralOffsetX: number;
  neutralOffsetZ: number;
  firedDuringPinch: boolean;
  firedCount: number;
  lastFiredAtMs: number | null;
};

const handGestureDwellMs = 450;
const handGestureDeadzoneMeters = 0.045;
const handGestureTurnDeadzoneMeters = 0.055;
const handGestureTurnCooldownMs = 450;
const handSelectDwellMs = 650;
const handSelectMovementToleranceMeters = 0.025;
const handSelectCooldownMs = 850;
const handPinchDistanceThresholdMeters = 0.035;
const xrGamepadDeadzone = 0.18;

function createKeyboardLocomotion(): KeyboardLocomotionState {
  const state = { forward: 0, strafe: 0, turn: 0 };
  const pressedKeys = new Set<string>();

  const update = (event: KeyboardEvent, pressed: boolean): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (pressed) {
      pressedKeys.add(event.code);
    } else {
      pressedKeys.delete(event.code);
    }
    state.forward = (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp") ? 1 : 0)
      + (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown") ? -1 : 0);
    state.strafe = (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight") ? 1 : 0)
      + (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft") ? -1 : 0);
    state.turn = (pressedKeys.has("KeyE") ? -1 : 0) + (pressedKeys.has("KeyQ") ? 1 : 0);
  };

  window.addEventListener("keydown", (event) => update(event, true));
  window.addEventListener("keyup", (event) => update(event, false));
  return state;
}

function createXrHandGestureLocomotionState(): XrHandGestureLocomotionState {
  return {
    hands: {
      left: createXrHandGestureHandState(),
      right: createXrHandGestureHandState(),
    },
    lastTurnAtMs: null,
  };
}

function createXrHandGestureHandState(): XrHandGestureHandState {
  return {
    pinchingSinceMs: null,
    neutralOffsetX: 0,
    neutralOffsetZ: 0,
    armed: false,
  };
}

function createXrHandSelectState(): XrHandSelectState {
  return {
    pinchingSinceMs: null,
    neutralOffsetX: 0,
    neutralOffsetZ: 0,
    firedDuringPinch: false,
    firedCount: 0,
    lastFiredAtMs: null,
  };
}

function applyLocomotion(input: {
  deltaSeconds: number;
  keyboardLocomotion: KeyboardLocomotionState;
  locomotionRig: Group;
  now: number;
  renderer: WebGLRenderer;
  session: XrSession | undefined;
  lastInputObservedAtMs: number | null;
  lastLocomotionAtMs: number | null;
  handModelCount: number;
  handModelStatus: OpenClinXrInputEvidence["handModelStatus"];
  activeHandRepresentationKind?: OpenClinXrInputEvidence["handRepresentationKind"];
  handAssetLoadErrors?: string[];
  handGestureLocomotionState: XrHandGestureLocomotionState;
  previousRoomScalePose: RigPoseEvidence | null;
  roomScalePose: RigPoseEvidence | null;
}): OpenClinXrInputEvidence {
  const xrLocomotion = readXrGamepadLocomotion(input.session);
  const keyboardVector: LocomotionVectorEvidence = {
    forward: clampUnit(input.keyboardLocomotion.forward),
    strafe: clampUnit(input.keyboardLocomotion.strafe),
    turn: clampUnit(input.keyboardLocomotion.turn),
  };
  const xrVector: LocomotionVectorEvidence = {
    forward: xrLocomotion.forward,
    strafe: xrLocomotion.strafe,
    turn: xrLocomotion.turn,
  };
  const xrHandGestureLocomotion = readXrHandGestureLocomotion({
    renderer: input.renderer,
    gestureState: input.handGestureLocomotionState,
    now: input.now,
    otherLocomotionSourceActive: isLocomotionVectorActive(keyboardVector) || isLocomotionVectorActive(xrVector),
  });
  const xrHandGestureVector: LocomotionVectorEvidence = {
    forward: xrHandGestureLocomotion.forward,
    strafe: xrHandGestureLocomotion.strafe,
    turn: xrHandGestureLocomotion.turn,
  };
  const forward = clampUnit(keyboardVector.forward + xrVector.forward + xrHandGestureVector.forward);
  const strafe = clampUnit(keyboardVector.strafe + xrVector.strafe + xrHandGestureVector.strafe);
  const turn = clampUnit(keyboardVector.turn + xrVector.turn + xrHandGestureVector.turn);
  const speedMetersPerSecond = 1.35;
  const previousRigPose: RigPoseEvidence = {
    x: Number(input.locomotionRig.position.x.toFixed(3)),
    z: Number(input.locomotionRig.position.z.toFixed(3)),
    yawRadians: Number(input.locomotionRig.rotation.y.toFixed(3)),
  };

  input.locomotionRig.rotation.y += turn * input.deltaSeconds * 1.8;
  const yaw = input.locomotionRig.rotation.y;
  const forwardVector = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rightVector = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  input.locomotionRig.position
    .addScaledVector(forwardVector, forward * speedMetersPerSecond * input.deltaSeconds)
    .addScaledVector(rightVector, strafe * speedMetersPerSecond * input.deltaSeconds);
  input.locomotionRig.position.x = clamp(input.locomotionRig.position.x, -2.75, 2.75);
  input.locomotionRig.position.z = clamp(input.locomotionRig.position.z, -2.25, 2.25);

  return buildManualPerformanceInputEvidence({
    handModelCount: input.handModelCount,
    handModelStatus: input.handModelStatus,
    ...(input.activeHandRepresentationKind ? { activeHandRepresentationKind: input.activeHandRepresentationKind } : {}),
    ...(input.handAssetLoadErrors && input.handAssetLoadErrors.length > 0 ? { handAssetLoadErrors: input.handAssetLoadErrors } : {}),
    handInputsObserved: Math.max(xrLocomotion.handInputsObserved, xrHandGestureLocomotion.handInputsObserved),
    keyboardVector,
    xrVector,
    xrHandGestureVector,
    xrHandGestureState: xrHandGestureLocomotion.state,
    locomotionDiagnostics: {
      claimScope: "attempt_diagnostics_only",
      gamepadDeadzone: xrGamepadDeadzone,
      handPinchThresholdMeters: handPinchDistanceThresholdMeters,
      handGestureDeadzoneMeters,
      handGestureTurnDeadzoneMeters,
      gamepadSources: xrLocomotion.diagnostics,
      handGestureHands: xrHandGestureLocomotion.diagnostics,
    },
    xrInputSources: xrLocomotion.inputSources,
    now: input.now,
    previousLastInputObservedAtMs: input.lastInputObservedAtMs,
    previousLastLocomotionAtMs: input.lastLocomotionAtMs,
    previousRigPose,
    rigPosition: {
      x: Number(input.locomotionRig.position.x.toFixed(3)),
      z: Number(input.locomotionRig.position.z.toFixed(3)),
    },
    rigYawRadians: Number(input.locomotionRig.rotation.y.toFixed(3)),
    previousRoomScalePose: input.previousRoomScalePose,
    roomScalePose: input.roomScalePose,
  });
}

function sampleRoomScalePose(input: {
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  presenting: boolean;
}): RigPoseEvidence | null {
  if (!input.presenting) {
    return null;
  }
  input.renderer.xr.updateCamera(input.camera);
  return {
    x: Number(input.camera.position.x.toFixed(3)),
    z: Number(input.camera.position.z.toFixed(3)),
    yawRadians: 0,
  };
}

function readXrHandGestureLocomotion(input: {
  renderer: WebGLRenderer;
  gestureState: XrHandGestureLocomotionState;
  now: number;
  otherLocomotionSourceActive: boolean;
}): XrHandGestureLocomotionResult {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  let handInputsObserved = 0;
  let leftPinch = false;
  let rightPinch = false;
  let dwellMs = 0;
  let armed = false;
  let blockedReason: NonNullable<XrHandGestureStateEvidence["blockedReason"]> = "not_pinching";
  const diagnostics: LocomotionAttemptDiagnosticsEvidence["handGestureHands"] = [];

  for (let index = 0; index < 2; index += 1) {
    const hand = input.renderer.xr.getHand(index) as XrHandGroup;
    if (isTrackedHandVisible(hand)) {
      handInputsObserved += 1;
    }
    const handedness = handednessForHand(hand, index);
    if (isXrHandPinching(hand)) {
      if (handedness === "right") {
        rightPinch = true;
      } else {
        leftPinch = true;
      }
    }
    const gesture = readHandGestureVector({
      hand,
      index,
      now: input.now,
      gestureState: input.gestureState,
      otherLocomotionSourceActive: input.otherLocomotionSourceActive,
    });
    forward += gesture.forward;
    strafe += gesture.strafe;
    turn += gesture.turn;
    dwellMs = Math.max(dwellMs, gesture.dwellMs);
    armed = armed || gesture.armed;
    if (isXrHandGestureStateBlockedReason(gesture.blockedReason)) {
      blockedReason = gesture.blockedReason;
    }
    diagnostics.push(gesture.diagnostic);
  }

  const state: XrHandGestureStateEvidence = {
    armed,
    dwellMs,
    leftPinch,
    rightPinch,
    gestureDeadzoneMeters: handGestureDeadzoneMeters,
    turnCooldownMs: handGestureTurnCooldownMs,
  };
  if (!armed) {
    state.blockedReason = blockedReason;
  }

  return {
    forward: clampUnit(forward),
    strafe: clampUnit(strafe),
    turn: clampUnit(turn),
    handInputsObserved,
    state,
    diagnostics,
  };
}

function isXrHandGestureStateBlockedReason(
  reason: XrHandGestureVectorResult["blockedReason"],
): reason is NonNullable<XrHandGestureStateEvidence["blockedReason"]> {
  return reason === "not_pinching"
    || reason === "arming_dwell"
    || reason === "missing_joints"
    || reason === "other_locomotion_source_active";
}

function readHandGestureVector(input: {
  hand: XrHandGroup;
  index: number;
  now: number;
  gestureState: XrHandGestureLocomotionState;
  otherLocomotionSourceActive: boolean;
}): XrHandGestureVectorResult {
  const handedness = handednessForHand(input.hand, input.index);
  const state = input.gestureState.hands[handedness];

  const wrist = input.hand.joints?.wrist;
  const indexTip = input.hand.joints?.["index-finger-tip"];
  const thumbTip = input.hand.joints?.["thumb-tip"];
  const jointsVisible = {
    wrist: Boolean(wrist?.visible),
    indexTip: Boolean(indexTip?.visible),
    thumbTip: Boolean(thumbTip?.visible),
  };
  const pinchDistanceMeters = indexTip?.visible && thumbTip?.visible
    ? indexTip.position.distanceTo(thumbTip.position)
    : null;
  const pinching = pinchDistanceMeters !== null && pinchDistanceMeters <= handPinchDistanceThresholdMeters;
  if (!wrist?.visible || !indexTip?.visible || !thumbTip?.visible) {
    resetHandGestureHandState(state);
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs: 0,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "missing_joints",
    });
  }

  if (!pinching) {
    resetHandGestureHandState(state);
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs: 0,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "not_pinching",
    });
  }

  if (input.otherLocomotionSourceActive) {
    resetHandGestureHandState(state);
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs: 0,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "other_locomotion_source_active",
    });
  }

  const gestureOriginMeters = handGestureLocomotionOriginMeters({
    wrist: { x: wrist.position.x, z: wrist.position.z },
    indexTip: { x: indexTip.position.x, z: indexTip.position.z },
    thumbTip: { x: thumbTip.position.x, z: thumbTip.position.z },
  });
  if (state.pinchingSinceMs === null) {
    state.pinchingSinceMs = input.now;
    state.neutralOffsetX = gestureOriginMeters.x;
    state.neutralOffsetZ = gestureOriginMeters.z;
    state.armed = false;
  }

  const dwellMs = Math.max(0, input.now - state.pinchingSinceMs);
  if (dwellMs < handGestureDwellMs) {
    return handGestureResult({
      handedness,
      jointsVisible,
      pinchDistanceMeters,
      pinching,
      armed: false,
      dwellMs,
      relativeOffsetMeters: null,
      movementCrossedDeadzone: false,
      blockedReason: "arming_dwell",
    });
  }
  state.armed = true;
  const relativeOffsetMeters = handGestureRelativeOffsetMeters({
    neutralOriginMeters: {
      x: state.neutralOffsetX,
      z: state.neutralOffsetZ,
    },
    current: {
      wrist: { x: wrist.position.x, z: wrist.position.z },
      indexTip: { x: indexTip.position.x, z: indexTip.position.z },
      thumbTip: { x: thumbTip.position.x, z: thumbTip.position.z },
    },
  });

  const turnCoolingDown = handedness === "right"
    && input.gestureState.lastTurnAtMs !== null
    && input.now - input.gestureState.lastTurnAtMs < handGestureTurnCooldownMs;
  const mappedGesture = mapHandGestureLocomotionVector({
    handedness,
    relativeOffsetMeters,
    movementDeadzoneMeters: handGestureDeadzoneMeters,
    turnDeadzoneMeters: handGestureTurnDeadzoneMeters,
    movementSensitivity: 5,
    turnSensitivity: 4,
    turnCoolingDown,
  });

  if (handedness === "right") {
    if (turnCoolingDown && mappedGesture.turnCrossedDeadzone && mappedGesture.forward === 0 && mappedGesture.strafe === 0) {
      return handGestureResult({
        handedness,
        jointsVisible,
        pinchDistanceMeters,
        pinching,
        armed: true,
        dwellMs,
        relativeOffsetMeters,
        movementCrossedDeadzone: true,
        blockedReason: "turn_cooldown",
      });
    }
    if (mappedGesture.turn !== 0) {
      input.gestureState.lastTurnAtMs = input.now;
    }
  }

  return handGestureResult({
    forward: mappedGesture.forward,
    strafe: mappedGesture.strafe,
    turn: mappedGesture.turn,
    handedness,
    jointsVisible,
    pinchDistanceMeters,
    pinching,
    armed: true,
    dwellMs,
    relativeOffsetMeters,
    movementCrossedDeadzone: mappedGesture.movementCrossedDeadzone,
    ...(mappedGesture.movementCrossedDeadzone ? {} : { blockedReason: "below_deadzone" }),
  });
}

function handGestureResult(input: Partial<LocomotionVectorEvidence> & {
  handedness: "left" | "right";
  jointsVisible: LocomotionAttemptDiagnosticsEvidence["handGestureHands"][number]["jointsVisible"];
  pinchDistanceMeters: number | null;
  pinching: boolean;
  armed: boolean;
  dwellMs: number;
  relativeOffsetMeters: { x: number; z: number } | null;
  movementCrossedDeadzone: boolean;
  blockedReason?: XrHandGestureVectorResult["blockedReason"];
}): XrHandGestureVectorResult {
  const blockedReason = input.blockedReason;
  return {
    forward: input.forward ?? 0,
    strafe: input.strafe ?? 0,
    turn: input.turn ?? 0,
    armed: input.armed,
    dwellMs: input.dwellMs,
    ...(blockedReason ? { blockedReason } : {}),
    diagnostic: {
      handedness: input.handedness,
      jointsVisible: input.jointsVisible,
      pinchDistanceMeters: input.pinchDistanceMeters,
      pinching: input.pinching,
      armed: input.armed,
      dwellMs: input.dwellMs,
      relativeOffsetMeters: input.relativeOffsetMeters,
      movementCrossedDeadzone: input.movementCrossedDeadzone,
      ...(blockedReason ? { blockedReason } : {}),
    },
  };
}

function maybeCompleteTraceActionFromHandSelect(input: {
  renderer: WebGLRenderer;
  handSelectState: XrHandSelectState;
  now: number;
  controllerInputActive: boolean;
  isFullVrPresenting: () => boolean;
  onSelect: () => boolean;
}): XrHandSelectStateEvidence {
  const hand = input.renderer.xr.getHand(1) as XrHandGroup;
  const rightPinch = isXrHandPinching(hand);
  if (!input.isFullVrPresenting()) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "trace_unavailable",
    });
  }
  if (!rightPinch) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "idle",
      armed: false,
      rightPinch,
      blockedReason: "not_pinching",
    });
  }
  if (input.controllerInputActive) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "controller_input_active",
    });
  }

  const wrist = hand.joints?.wrist;
  const indexTip = hand.joints?.["index-finger-tip"];
  const thumbTip = hand.joints?.["thumb-tip"];
  if (!wrist?.visible || !indexTip?.visible || !thumbTip?.visible) {
    resetHandSelectState(input.handSelectState);
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "missing_joints",
    });
  }

  const offsetX = indexTip.position.x - wrist.position.x;
  const offsetZ = indexTip.position.z - wrist.position.z;
  if (input.handSelectState.pinchingSinceMs === null) {
    input.handSelectState.pinchingSinceMs = input.now;
    input.handSelectState.neutralOffsetX = offsetX;
    input.handSelectState.neutralOffsetZ = offsetZ;
    input.handSelectState.firedDuringPinch = false;
  }

  const dwellMs = Math.max(0, input.now - input.handSelectState.pinchingSinceMs);
  const movementMeters = Math.hypot(
    offsetX - input.handSelectState.neutralOffsetX,
    offsetZ - input.handSelectState.neutralOffsetZ,
  );
  if (movementMeters > handSelectMovementToleranceMeters) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: false,
      rightPinch,
      blockedReason: "moving_too_much",
    });
  }
  if (dwellMs < handSelectDwellMs) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "arming",
      armed: false,
      rightPinch,
      blockedReason: "arming_dwell",
    });
  }
  const coolingDown = input.handSelectState.lastFiredAtMs !== null
    && input.now - input.handSelectState.lastFiredAtMs < handSelectCooldownMs;
  if (coolingDown && !input.handSelectState.firedDuringPinch) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: true,
      rightPinch,
      blockedReason: "cooldown",
    });
  }
  if (input.handSelectState.firedDuringPinch) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "ready",
      armed: true,
      rightPinch,
    });
  }

  const fired = input.onSelect();
  if (!fired) {
    return handSelectEvidence(input.handSelectState, input.now, {
      status: "blocked",
      armed: true,
      rightPinch,
      blockedReason: "trace_unavailable",
    });
  }
  input.handSelectState.firedDuringPinch = true;
  input.handSelectState.firedCount += 1;
  input.handSelectState.lastFiredAtMs = input.now;
  return handSelectEvidence(input.handSelectState, input.now, {
    status: "fired",
    armed: true,
    rightPinch,
  });
}

function handSelectEvidence(
  state: XrHandSelectState,
  now: number,
  evidence: Pick<XrHandSelectStateEvidence, "status" | "armed" | "rightPinch"> & {
    blockedReason?: XrHandSelectStateEvidence["blockedReason"];
  },
): XrHandSelectStateEvidence {
  return {
    status: evidence.status,
    armed: evidence.armed,
    dwellMs: state.pinchingSinceMs === null ? 0 : Number(Math.max(0, now - state.pinchingSinceMs).toFixed(2)),
    rightPinch: evidence.rightPinch,
    firedCount: state.firedCount,
    lastFiredAtMs: state.lastFiredAtMs === null ? null : Number(state.lastFiredAtMs.toFixed(2)),
    ...(evidence.blockedReason ? { blockedReason: evidence.blockedReason } : {}),
  };
}

function recordHandSelectTraceInteractionDetail(
  evidence: XrHandSelectStateEvidence | undefined,
  now: number,
): void {
  if (!evidence) {
    return;
  }
  if (evidence.status === "idle" && !evidence.rightPinch) {
    return;
  }
  window.__openClinXrTraceLatencyEvidence = {
    lastTraceTag: window.__openClinXrTraceLatencyEvidence?.source === "xr_hand_select"
      ? window.__openClinXrTraceLatencyEvidence.lastTraceTag
      : null,
    lastSelectLatencyMs: window.__openClinXrTraceLatencyEvidence?.source === "xr_hand_select"
      ? window.__openClinXrTraceLatencyEvidence.lastSelectLatencyMs
      : null,
    source: "xr_hand_select",
    measuredAtMs: Number(now.toFixed(2)),
    productionControllerLatencySubstitute: false,
    interactionDetail: {
      modality: "hand_pinch_select",
      handedness: "right",
      status: evidence.status,
      ...(evidence.blockedReason ? { blockedReason: evidence.blockedReason } : {}),
      dwellMs: evidence.dwellMs,
      firedCount: evidence.firedCount,
      rightPinch: evidence.rightPinch,
    },
  };
}

function resetHandSelectState(state: XrHandSelectState): void {
  state.pinchingSinceMs = null;
  state.neutralOffsetX = 0;
  state.neutralOffsetZ = 0;
  state.firedDuringPinch = false;
}

function resetHandGestureHandState(state: XrHandGestureHandState): void {
  state.pinchingSinceMs = null;
  state.neutralOffsetX = 0;
  state.neutralOffsetZ = 0;
  state.armed = false;
}

function handednessForHand(hand: XrHandGroup, index: number): "left" | "right" {
  return hand.userData.openClinXrHandedness === "right" || index === 1 ? "right" : "left";
}

function isTrackedHandVisible(hand: XrHandGroup): boolean {
  return Boolean(hand.visible || hand.joints?.wrist?.visible || hand.joints?.["index-finger-tip"]?.visible);
}

function isXrHandPinching(hand: XrHandGroup): boolean {
  const indexTip = hand.joints?.["index-finger-tip"];
  const thumbTip = hand.joints?.["thumb-tip"];
  if (!indexTip?.visible || !thumbTip?.visible) {
    return false;
  }
  return indexTip.position.distanceTo(thumbTip.position) <= handPinchDistanceThresholdMeters;
}

function readXrGamepadLocomotion(session: XrSession | undefined): {
  forward: number;
  strafe: number;
  turn: number;
  handInputsObserved: number;
  inputSources: XrInputSourceEvidence[];
  diagnostics: LocomotionAttemptDiagnosticsEvidence["gamepadSources"];
} {
  let forward = 0;
  let strafe = 0;
  let turn = 0;
  let handInputsObserved = 0;
  const inputSources: XrInputSourceEvidence[] = [];
  const diagnostics: LocomotionAttemptDiagnosticsEvidence["gamepadSources"] = [];

  for (const source of session?.inputSources ?? []) {
    if (source.hand) {
      handInputsObserved += 1;
    }
    const axes = source.gamepad?.axes ?? [];
    inputSources.push({
      handedness: source.handedness ?? "unknown",
      hasHand: Boolean(source.hand),
      hasGamepad: Boolean(source.gamepad),
      axisCount: axes.length,
    });
    const selectedXAxisIndex = axes[2] === undefined ? (axes[0] === undefined ? null : 0) : 2;
    const selectedYAxisIndex = axes[3] === undefined ? (axes[1] === undefined ? null : 1) : 3;
    const xAxis = deadzone(selectedXAxisIndex === null ? 0 : axes[selectedXAxisIndex] ?? 0);
    const yAxis = deadzone(selectedYAxisIndex === null ? 0 : axes[selectedYAxisIndex] ?? 0);
    if (source.gamepad) {
      diagnostics.push({
        handedness: source.handedness ?? "unknown",
        rawAxes: Array.from(axes),
        selectedXAxisIndex,
        selectedYAxisIndex,
        xAxisAfterDeadzone: xAxis,
        yAxisAfterDeadzone: yAxis,
        activeAfterDeadzone: xAxis !== 0 || yAxis !== 0,
        contribution: source.handedness === "right" ? "turn" : "move",
      });
    }
    if (source.handedness === "right") {
      turn += xAxis;
      continue;
    }
    strafe += xAxis;
    forward += -yAxis;
  }

  return {
    forward: clampUnit(forward),
    strafe: clampUnit(strafe),
    turn: clampUnit(turn),
    handInputsObserved,
    inputSources,
    diagnostics,
  };
}

const deadzone = (v: number) => Math.abs(v) < xrGamepadDeadzone ? 0 : clampUnit(v);
const isLocomotionVectorActive = (vector: LocomotionVectorEvidence) =>
  Math.abs(vector.forward) > 0 || Math.abs(vector.strafe) > 0 || Math.abs(vector.turn) > 0;
const clampUnit = (value: number) => clamp(value, -1, 1);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const actorMesh = (color: number): Group => createPrimitiveActorMesh(color);

function createVirtualDeviceActorAffordance(actorId: string): Group {
  const placement = runtimeActorPlacement(actorId, {
    slotKind: "family_or_observer",
    position: { x: -2.0, y: 1.05, z: 0.7 },
    scale: { x: 0.72, y: 0.72, z: 0.72 },
    verticalOffsetMeters: 0,
    labelPrefix: "Remote",
  });
  return buildVirtualDeviceActorAffordance({
    actorId,
    placement,
    createAffordanceMarker,
    createActorNameplate,
    actorNameplateLabel,
    registerSlot: (id, group) => { virtualDeviceActorSlotsByActorId.set(id, group); },
  });
}

function createActorNameplate(label: string, accentColor: number): Mesh {
  const canvasElement = document.createElement("canvas");
  canvasElement.width = 512;
  canvasElement.height = 128;
  const context = canvasElement.getContext("2d");
  if (!context) {
    throw new Error("Unable to create actor nameplate canvas context");
  }
  context.fillStyle = "rgba(16, 24, 32, 0.86)";
  context.fillRect(0, 0, canvasElement.width, canvasElement.height);
  context.fillStyle = `#${accentColor.toString(16).padStart(6, "0")}`;
  context.fillRect(0, 0, 18, canvasElement.height);
  context.font = "700 34px Verdana, sans-serif";
  context.fillStyle = "#fff8e5";
  context.textBaseline = "middle";
  context.fillText(label, 38, canvasElement.height / 2);
  const texture = new CanvasTexture(canvasElement);
  const nameplate = new Mesh(
    new PlaneGeometry(0.95, 0.24),
    new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide }),
  );
  nameplate.name = `${runtimeSceneObjectPrefix()}.actor-nameplate.${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/-$/u, "")}`;
  nameplate.position.set(0, 1.48, 0);
  if (!shouldShowInSceneIdentityLabels()) {
    nameplate.visible = false;
    nameplate.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_identity_debug_capture";
  }
  return nameplate;
}

function createDetailedEdRoomProps(
  manifestProps: readonly EncounterRuntimeRoomProp[],
  fixtureOwnedRoles: readonly string[] = [],
  exclusiveMountedEquipmentIds: ReadonlySet<string> = new Set(),
): Group[] {
  const fallbackPositions = [
    { x: -2.15, y: 0.65, z: -1.02 },
    { x: 1.92, y: 0.82, z: -1.05 },
    { x: -1.55, y: 0.58, z: 0.96 },
    { x: 1.52, y: 0.58, z: 0.92 },
  ];
  const owned = new Set(fixtureOwnedRoles);
  const out: Group[] = [];
  for (const [propIndex, prop] of manifestProps.entries()) {
    if (!shouldRenderRoomPropInVisualReview(prop)) continue;
    // #186: fixture owns seating/door/board/surface — roomProp is metadata-only for that role.
    if (roomPropSuppressedByFixtureOwnership(prop.propId, owned)) continue;
    const { color, accentColor } = roomPropColourNumbers(prop);
    const built = roomProp(
      prop.propId,
      color,
      accentColor,
      hasVector3(prop.position)
        ? prop.position
        : fallbackPositions[propIndex % fallbackPositions.length] ?? { x: -2.15, y: 0.65, z: -1.02 },
      hasVector3(prop.scale) ? prop.scale : { x: 0.42, y: 0.42, z: 0.42 },
      prop.label ?? prop.propId.replaceAll("-", " "),
      Array.isArray(prop.affordanceCueIds) ? prop.affordanceCueIds : [`${prop.propId}:visual_context`],
      exclusiveMountedEquipmentIds,
      typeof prop.semanticRole === "string" ? prop.semanticRole : null,
    );
    if (built) out.push(built);
  }
  return out;
}

function updateEnvironmentRealismAnimations(deltaSeconds: number, nowMs: number): void {
  const evidence = window.__openClinXrEnvironmentStateEvidence;
  const activeProps = new Set(evidence?.activePropIds ?? []);
  const pulse = evidence?.environmentMotionCueMode === "deterministic_visual_pulse"
    ? 0.5 + Math.sin(nowMs / 260) * 0.5
    : 0;
  for (const [propId, group] of environmentReactiveProps) {
    const active = activeProps.has(propId);
    const baseY = typeof group.userData.openClinXrBaseY === "number" ? group.userData.openClinXrBaseY : group.position.y;
    group.position.y = baseY + (active ? pulse * 0.018 : 0);
    group.children.forEach((child) => {
      if (child.name.includes(".label")) {
        child.visible = active || propId === "doorway-station-sign" || propId === "patient-handoff-whiteboard";
      }
      if (child.name.includes("glb-affordance")) {
        child.rotation.y += deltaSeconds * (active ? 1.6 : 0.35);
      }
    });
  }
}

function roomProp(
  propId: string,
  color: number,
  accentColor: number,
  position: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number },
  label: string,
  affordanceCueIds: string[] = [`${propId}:visual_context`],
  exclusiveMountedEquipmentIds: ReadonlySet<string> = new Set(),
  semanticRole: string | null = null,
): Group | null {
  // #185: builder-backed props use station-equipment-builders (ignore scale); XOR skips duals.
  // #223: cue/overlay props keep affordance tags without a scaled unit-box body.
  const group = buildRoomPropGroup({
    propId,
    color,
    accentColor,
    position,
    scale,
    label,
    affordanceCueIds,
    semanticRole,
    namePrefix: runtimeRoomPropObjectPrefix(),
    exclusiveMountedEquipmentIds,
    createAffordanceMarker,
    createActorNameplate,
    addFallbackDetailVisuals: addDetailedRoomPropVisuals,
  });
  if (group) environmentReactiveProps.set(propId, group);
  return group;
}

function runtimeRoomPropObjectPrefix(): string {
  return `openclinxr.${encounterRuntimeAssetBundle.scenarioId}.room-prop`;
}

function runtimeSceneObjectPrefix(): string {
  return `openclinxr.${encounterRuntimeAssetBundle.scenarioId}`;
}

function addDetailedRoomPropVisuals(
  group: Group,
  propId: string,
  label: string,
  scale: { x: number; y: number; z: number },
  color: number,
  accentColor: number,
): void {
  const semanticKey = `${propId} ${label}`.toLowerCase();
  const detailCueIds: string[] = [];
  const addDetail = (mesh: Mesh, name: string, cueId: string): void => {
    mesh.name = `${group.name}.${name}`;
    mesh.userData.openClinXrDetailCueId = cueId;
    group.add(mesh);
    detailCueIds.push(cueId);
  };

  if (semanticKey.includes("tissue") || semanticKey.includes("empathy") || semanticKey.includes("communication")) {
    addDetail(new Mesh(
      new BoxGeometry(0.34, 0.08, 0.18),
      new MeshStandardMaterial({ color: 0xced9e6, roughness: 0.74 }),
    ), "tissue-box", "manifest_prop_tissue_box_for_empathy_workflow");
    addDetail(new Mesh(
      new BoxGeometry(0.16, 0.018, 0.12),
      new MeshStandardMaterial({ color: 0xf7f8f2, roughness: 0.92 }),
    ), "raised-tissue", "manifest_prop_visible_tissue_for_emotional_disclosure");
    group.children.at(-1)?.position.set(0, scale.y + 0.08, 0);
  } else if (semanticKey.includes("chair") || semanticKey.includes("visitor") || semanticKey.includes("caregiver") || semanticKey.includes("objective")) {
    const chairMaterial = new MeshStandardMaterial({ color: 0x465766, roughness: 0.82 });
    const seat = new Mesh(new BoxGeometry(0.42, 0.08, 0.42), chairMaterial);
    seat.position.set(0, scale.y + 0.02, 0);
    addDetail(seat, "chair-seat", "manifest_prop_chair_seat_for_family_presence");
    const back = new Mesh(new BoxGeometry(0.42, 0.48, 0.06), chairMaterial);
    back.position.set(0, scale.y + 0.27, -0.2);
    addDetail(back, "chair-back", "manifest_prop_chair_back_for_seated_actor_context");
    for (const [index, x] of [-0.16, 0.16].entries()) {
      for (const z of [-0.16, 0.16]) {
        const leg = new Mesh(new CylinderGeometry(0.018, 0.018, 0.34, 8), chairMaterial);
        leg.position.set(x, scale.y - 0.15, z);
        addDetail(leg, `chair-leg-${index}-${z > 0 ? "front" : "back"}`, "manifest_prop_chair_leg_scale_cue");
      }
    }
  } else if (semanticKey.includes("whiteboard") || semanticKey.includes("handoff") || semanticKey.includes("review")) {
    const board = new Mesh(
      new BoxGeometry(Math.max(scale.x * 1.8, 0.9), Math.max(scale.y * 1.2, 0.42), 0.025),
      new MeshStandardMaterial({ color: 0xf4f8f2, roughness: 0.55 }),
    );
    board.position.set(0, scale.y + 0.14, -0.03);
    addDetail(board, "whiteboard-surface", "manifest_prop_whiteboard_clinical_context_surface");
    const markerRail = new Mesh(new BoxGeometry(0.58, 0.025, 0.035), new MeshStandardMaterial({ color: accentColor, roughness: 0.58 }));
    markerRail.position.set(0, scale.y - 0.12, 0.015);
    addDetail(markerRail, "marker-rail", "manifest_prop_whiteboard_marker_rail_readability_cue");
  } else if (semanticKey.includes("door") || semanticKey.includes("sign") || semanticKey.includes("primary-context")) {
    const plate = new Mesh(
      new BoxGeometry(Math.max(scale.x * 1.7, 0.64), Math.max(scale.y * 0.9, 0.24), 0.035),
      new MeshStandardMaterial({ color: 0xf5ead0, roughness: 0.68 }),
    );
    plate.position.set(0, scale.y + 0.08, 0);
    addDetail(plate, "doorway-sign-plate", "manifest_prop_doorway_sign_station_orientation_cue");
    const stripe = new Mesh(new BoxGeometry(0.58, 0.028, 0.045), new MeshStandardMaterial({ color: accentColor, roughness: 0.5 }));
    stripe.position.set(0, scale.y + 0.22, 0.025);
    addDetail(stripe, "doorway-sign-accent", "manifest_prop_doorway_sign_accent_cue");
  } else if (semanticKey.includes("supply") || semanticKey.includes("cart") || semanticKey.includes("tray")) {
    for (let shelfIndex = 0; shelfIndex < 3; shelfIndex += 1) {
      const shelf = new Mesh(
        new BoxGeometry(Math.max(scale.x * 1.4, 0.38), 0.035, Math.max(scale.z * 1.4, 0.28)),
        new MeshStandardMaterial({ color: shelfIndex % 2 === 0 ? color : 0xe4e8e8, roughness: 0.72 }),
      );
      shelf.position.set(0, scale.y - 0.14 + shelfIndex * 0.15, 0);
      addDetail(shelf, `cart-shelf-${shelfIndex}`, "manifest_prop_supply_cart_shelf_workflow_cue");
    }
  } else {
    const accentBand = new Mesh(
      new BoxGeometry(Math.max(scale.x * 1.08, 0.16), 0.025, Math.max(scale.z * 1.08, 0.08)),
      new MeshStandardMaterial({ color: accentColor, roughness: 0.62 }),
    );
    accentBand.position.set(0, scale.y + 0.035, 0);
    addDetail(accentBand, "semantic-accent-band", "manifest_prop_semantic_detail_accent_cue");
  }

  group.userData.openClinXrDynamicRoomPropDetailCueIds = detailCueIds;
}

function createAffordanceMarker(cueId: string, color: number): Mesh {
  const marker = new Mesh(
    new SphereGeometry(0.055, 16, 12),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.82 }),
  );
  marker.name = `${runtimeSceneObjectPrefix()}.glb-affordance.${cueId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  marker.userData.openClinXrAffordanceCueId = cueId;
  if (!shouldShowRuntimeAffordanceMarkers()) {
    marker.visible = false;
    marker.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_affordance_evidence_capture";
  }
  return marker;
}

function createHumanoidSpeechMouthCue(assetId: string, _color: number): Mesh {
  const cue = new Mesh(
    new BoxGeometry(0.13, 0.03, 0.014),
    new MeshBasicMaterial({ color: 0x7a3434, transparent: true, opacity: 0.58 }),
  );
  cue.name = `${runtimeSceneObjectPrefix()}.phoneme-mouth-cue.${assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  cue.position.set(0, 1.445, 0.306);
  cue.visible = false;
  cue.userData.openClinXrAffordances = ["phoneme_viseme_dialogue_cue", "visible_runtime_mouth_shape_cue"];
  return cue;
}

function createHumanoidEyeGazeCue(assetId: string, color: number): Line {
  const cue = new Line(
    new BufferGeometry().setFromPoints([
      new Vector3(0, 1.57, 0.29),
      new Vector3(0, 1.57, -0.55),
    ]),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  );
  cue.name = `${runtimeSceneObjectPrefix()}.eye-gaze-cue.${assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  cue.visible = false;
  cue.userData.openClinXrAffordances = ["dialogue_gaze_target_cue"];
  return cue;
}

function createHumanoidEyeFocusCue(assetId: string): Group {
  const group = new Group();
  group.name = `${runtimeSceneObjectPrefix()}.eye-focus-cue.${assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-")}`;
  group.position.set(0, 1.57, 0.302);
  group.visible = false;
  group.userData.openClinXrAffordances = ["dialogue_eye_focus_target_cue", "visible_runtime_eye_focus_cue"];

  const eyeMaterial = new MeshBasicMaterial({ color: 0xf8fbff, transparent: true, opacity: 0.32 });
  const pupilMaterial = new MeshBasicMaterial({ color: 0x07121c, transparent: true, opacity: 0.4 });
  for (const x of [-0.045, 0.045]) {
    const eye = new Mesh(new SphereGeometry(0.012, 12, 8), eyeMaterial);
    eye.position.set(x, 0, 0);
    group.add(eye);
    const pupil = new Mesh(new SphereGeometry(0.0045, 8, 6), pupilMaterial);
    pupil.position.set(x, 0, 0.012);
    group.add(pupil);
  }
  return group;
}

function createHumanoidExpressionCue(assetId: string): Group {
  const safeAssetId = assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-");
  const group = new Group();
  group.name = `${runtimeSceneObjectPrefix()}.runtime-expression-cue.${safeAssetId}`;
  group.userData.openClinXrAffordances = [
    "scenario_emotion_expression_cue",
    "visible_runtime_eyebrow_jaw_cheek_cue",
  ];

  const browMaterial = new MeshBasicMaterial({ color: 0x26150d, transparent: true, opacity: 0.28 });
  for (const [name, x, rotation] of [["left", -0.068, -0.18], ["right", 0.068, 0.18]] as const) {
    const brow = new Mesh(new BoxGeometry(0.055, 0.006, 0.008), browMaterial);
    brow.name = `${runtimeSceneObjectPrefix()}.${name}-expressive-brow.${safeAssetId}`;
    brow.position.set(x, 1.625, 0.303);
    brow.rotation.z = rotation;
    group.add(brow);
  }

  const cheekMaterial = new MeshBasicMaterial({ color: 0xd8a07a, transparent: true, opacity: 0.18 });
  for (const x of [-0.115, 0.115]) {
    const cheek = new Mesh(new SphereGeometry(0.022, 10, 6), cheekMaterial);
    cheek.name = `${runtimeSceneObjectPrefix()}.emotion-cheek.${safeAssetId}`;
    cheek.position.set(x, 1.49, 0.297);
    cheek.scale.set(1.35, 0.65, 0.18);
    group.add(cheek);
  }

  const jaw = new Mesh(new BoxGeometry(0.095, 0.012, 0.010), new MeshBasicMaterial({ color: 0x7a3434, transparent: true, opacity: 0.24 }));
  jaw.name = `${runtimeSceneObjectPrefix()}.runtime-jaw-viseme-target.${safeAssetId}`;
  jaw.position.set(0, 1.405, 0.305);
  group.add(jaw);
  return group;
}

function createRuntimeHumanoidDetailCues(assetId: string): Group {
  const safeAssetId = assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-");
  const group = new Group();
  group.name = `${runtimeSceneObjectPrefix()}.generated-humanoid-detail-cues.${safeAssetId}`;
  group.userData.openClinXrAffordances = [
    "generated_humanoid_hair_clothing_eye_detail_cue",
    "generated_humanoid_asset_surface_detail_preferred",
  ];
  group.userData.openClinXrRuntimeDetailPolicy = {
    mode: "asset_surface_features_only_no_runtime_proxy_overlay",
    reason: "Local real Anny source + Blender procedural candidate GLB carries source topology plus surface hair, clothing, eye, brow, and lip geometry; runtime overlays must not obscure the generated humanoid.",
    notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
  };
  return group;
}

function createHumanoidInteractionCollisionCues(assetId: string): Group {
  const safeAssetId = assetId.replaceAll(/[^a-z0-9:_-]+/gi, "-");
  const group = new Group();
  group.name = `${runtimeSceneObjectPrefix()}.humanoid-interaction-collision.${safeAssetId}`;
  group.userData.openClinXrAffordances = [
    "face_lip_eye_rig_contract_cue",
    "ragdoll_collision_proxy_cue",
    "physician_interaction_target_cue",
  ];

  const collisionProxy = new Mesh(
    new BoxGeometry(0.56, 1.56, 0.34),
    new MeshBasicMaterial({ color: 0x58f5c6, transparent: true, opacity: 0.08, wireframe: true }),
  );
  collisionProxy.name = `${runtimeSceneObjectPrefix()}.ragdoll-collision-proxy.${safeAssetId}`;
  collisionProxy.position.set(0, 0.94, 0);
  collisionProxy.userData.openClinXrRagdollCollisionProxy = "local_interaction_volume_not_physics_claim";

  const interactionTarget = new Mesh(
    new BoxGeometry(0.46, 0.84, 0.035),
    new MeshBasicMaterial({ color: 0xf4d35e, transparent: true, opacity: 0.035, wireframe: true }),
  );
  interactionTarget.name = `${runtimeSceneObjectPrefix()}.physician-interaction-target.${safeAssetId}`;
  interactionTarget.position.set(0, 1.08, -0.22);
  interactionTarget.userData.openClinXrPhysicianInteractionTarget = "local_ray_or_hand_overlap_target";

  group.add(collisionProxy, interactionTarget);
  group.visible = false;
  group.userData.openClinXrRuntimeVisibilityPolicy = "hidden_by_default_semantic_collision_contract_only";
  return group;
}

// ---------------------------------------------------------------------------
// Animation-driven clinical-touch interaction (examinee examines the patient).
// Case-def bodyMechanics.touchResponses -> invisible per-region hit boxes ->
// raycast (pointer + XR ray) -> handleClinicalTouch fires a one-shot response
// clip + emotion transition + reflexive dialogue + durable trace/actor-turn.
// respondToTouch() is the seam where live physics later swaps in behind the
// identical trigger. notEvidenceFor clinical validity / scoring.
// ---------------------------------------------------------------------------
type ClinicalTouchResponseConfig = {
  region: string;
  responseKind: string;
  forceThreshold: number;
  emotionEventId: string;
  emotion: HumanoidExpressionEmotion;
  responseClip: string;
  dialogueLine: string;
  traceTag: string;
};

const clinicalTouchRegionTargets: Mesh[] = [];
const clinicalTouchConfigByActorRegion = new Map<string, { actorId: string; config: ClinicalTouchResponseConfig }>();
const clinicalTouchRaycaster = new Raycaster();

// Local-to-humanoid placement for each anatomical region hit box (front = -Z).
const CLINICAL_TOUCH_REGION_LAYOUT: Record<string, { x: number; y: number; z: number; w: number; h: number; d: number }> = {
  chest_R: { x: -0.12, y: 1.28, z: -0.14, w: 0.22, h: 0.24, d: 0.22 },
  chest_L: { x: 0.12, y: 1.28, z: -0.14, w: 0.22, h: 0.24, d: 0.22 },
  abdomen_ruq: { x: -0.11, y: 1.06, z: -0.12, w: 0.2, h: 0.2, d: 0.2 },
  abdomen_rlq: { x: -0.1, y: 0.92, z: -0.12, w: 0.2, h: 0.2, d: 0.2 },
  abdomen_luq: { x: 0.11, y: 1.06, z: -0.12, w: 0.2, h: 0.2, d: 0.2 },
  abdomen_llq: { x: 0.1, y: 0.92, z: -0.12, w: 0.2, h: 0.2, d: 0.2 },
  abdomen_epigastric: { x: 0, y: 1.14, z: -0.12, w: 0.22, h: 0.18, d: 0.2 },
  abdomen_suprapubic: { x: 0, y: 0.86, z: -0.12, w: 0.22, h: 0.18, d: 0.2 },
  neck_anterior: { x: 0, y: 1.5, z: -0.1, w: 0.16, h: 0.14, d: 0.16 },
  neck_posterior: { x: 0, y: 1.5, z: 0.1, w: 0.16, h: 0.14, d: 0.16 },
};
const CLINICAL_TOUCH_REGION_FALLBACK = { x: 0, y: 1.1, z: -0.12, w: 0.24, h: 0.24, d: 0.22 };

function registerClinicalTouchRegions(actorId: string, humanoid: Group, responses: ClinicalTouchResponseConfig[]): void {
  if (responses.length === 0) return;
  const group = new Group();
  group.name = `${runtimeSceneObjectPrefix()}.clinical-touch-regions.${actorId}`;
  group.userData.openClinXrClinicalTouchRegionHost = "examinee_touch_hit_targets_invisible_raycastable";
  for (const cfg of responses) {
    // Touch-response routing: a guarding touch resolves its clip FROM THE REGION, so six distinct
    // regions cannot collapse onto one produced RLQ clip the way shipped rows once did. The row's
    // authored clip is kept for every other response kind.
    const config = cfg.responseKind === "guarding" && cfg.responseClip !== responseClipForBodyRegion(cfg.region)
      ? { ...cfg, responseClip: responseClipForBodyRegion(cfg.region) }
      : cfg;
    const layout = CLINICAL_TOUCH_REGION_LAYOUT[cfg.region] ?? CLINICAL_TOUCH_REGION_FALLBACK;
    const box = new Mesh(
      new BoxGeometry(layout.w, layout.h, layout.d),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    box.name = `${runtimeSceneObjectPrefix()}.clinical-touch-region.${actorId}.${cfg.region}`;
    box.position.set(layout.x, layout.y, layout.z);
    box.visible = true; // must stay visible to be raycastable; invisible via opacity 0
    box.frustumCulled = false;
    box.userData.openClinXrTouchRegionId = cfg.region;
    box.userData.openClinXrTouchRegionActorId = actorId;
    box.userData.openClinXrTouchRegionResponseKind = cfg.responseKind;
    group.add(box);
    clinicalTouchRegionTargets.push(box);
    clinicalTouchConfigByActorRegion.set(`${actorId}:${cfg.region}`, { actorId, config });
  }
  humanoid.add(group);
  (window as unknown as { __openClinXrClinicalTouchRegionsReady?: unknown }).__openClinXrClinicalTouchRegionsReady = {
    actorId,
    regions: responses.map((response) => response.region),
    count: clinicalTouchRegionTargets.length,
  };
}

function resolveClinicalTouchTarget(): { actorId: string; regionId: string } | null {
  if (clinicalTouchRegionTargets.length === 0) return null;
  const hit = clinicalTouchRaycaster.intersectObjects(clinicalTouchRegionTargets, false)[0];
  if (!hit) return null;
  const regionId = hit.object.userData.openClinXrTouchRegionId as string | undefined;
  const actorId = hit.object.userData.openClinXrTouchRegionActorId as string | undefined;
  if (!regionId || !actorId) return null;
  return { actorId, regionId };
}

function tryClinicalTouchFromNdc(
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  source: OpenClinXrTraceLatencyEvidence["source"],
): boolean {
  clinicalTouchRaycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
  const target = resolveClinicalTouchTarget();
  return target ? handleClinicalTouch(target.actorId, target.regionId, source) : false;
}

function tryClinicalTouchFromWorldRay(
  origin: Vector3,
  direction: Vector3,
  source: OpenClinXrTraceLatencyEvidence["source"],
): boolean {
  clinicalTouchRaycaster.set(origin, direction.clone().normalize());
  const target = resolveClinicalTouchTarget();
  return target ? handleClinicalTouch(target.actorId, target.regionId, source) : false;
}

function tryClinicalTouchFromControllerEvent(
  event: XrSelectControllerEvent,
  source: OpenClinXrTraceLatencyEvidence["source"],
): boolean {
  const controller = (event as unknown as { target?: Group }).target;
  if (!controller) return false;
  controller.updateMatrixWorld(true);
  const origin = new Vector3().setFromMatrixPosition(controller.matrixWorld);
  const direction = new Vector3(0, 0, -1).transformDirection(controller.matrixWorld);
  return tryClinicalTouchFromWorldRay(origin, direction, source);
}

/** XR hand pose ray: origin at wrist, direction through index-finger tip. */
function tryClinicalTouchFromHandPose(
  renderer: WebGLRenderer,
  source: OpenClinXrTraceLatencyEvidence["source"],
): boolean {
  const hand = renderer.xr.getHand(1) as XrHandGroup;
  const wrist = hand?.joints?.wrist;
  const indexTip = hand?.joints?.["index-finger-tip"];
  if (!wrist?.visible || !indexTip?.visible) return false;
  wrist.updateWorldMatrix(true, false);
  indexTip.updateWorldMatrix(true, false);
  const origin = new Vector3().setFromMatrixPosition(wrist.matrixWorld);
  const tip = new Vector3().setFromMatrixPosition(indexTip.matrixWorld);
  const direction = tip.sub(origin);
  if (direction.lengthSq() < 1e-8) return false;
  return tryClinicalTouchFromWorldRay(origin, direction.normalize(), source);
}

function playOneShotResponseClip(actorId: string, clipName: string): boolean {
  const slot = generatedHumanoidAnimationSlotsByActorId.get(actorId);
  if (!slot?.mixer || !slot.responseClips) return false;
  const clip = slot.responseClips.find((candidate) => candidate.name === clipName);
  if (!clip) return false;
  const mixer = slot.mixer;
  const action = mixer.clipAction(clip);
  action.stop();
  action.reset();
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.enabled = true;
  action.setEffectiveWeight(1);

  // Pause looping role/idle actions while the one-shot response plays.
  const responseClipNames = new Set(clinicalTouchResponseClipNamesForActor(actorId));
  const idleActions: ReturnType<AnimationMixer["clipAction"]>[] = [];
  for (const other of slot.responseClips) {
    if (other.name === clipName || responseClipNames.has(other.name)) continue;
    const otherAction = mixer.existingAction(other);
    if (otherAction?.isRunning()) {
      otherAction.fadeOut(0.1);
      idleActions.push(otherAction);
    }
  }

  const onFinished = (event: { action?: ReturnType<AnimationMixer["clipAction"]> }) => {
    if (event.action !== action) return;
    mixer.removeEventListener("finished", onFinished as (e: unknown) => void);
    action.fadeOut(0.12);
    for (const idle of idleActions) {
      if (!idle) continue;
      idle.reset().fadeIn(0.18).play();
    }
  };
  mixer.addEventListener("finished", onFinished as (e: unknown) => void);
  action.play();
  return true;
}

// Slice F seam: animation-driven today; a "physics" mode later gates the baked
// replay (applyPhysicsBoneTransforms) on this hit without changing the caller.
function respondToTouch(actorId: string, config: ClinicalTouchResponseConfig, mode: "animation" | "physics"): boolean {
  if (mode === "physics") return false;
  return playOneShotResponseClip(actorId, config.responseClip);
}

function handleClinicalTouch(
  actorId: string,
  regionId: string,
  source: OpenClinXrTraceLatencyEvidence["source"],
): boolean {
  const entry = clinicalTouchConfigByActorRegion.get(`${actorId}:${regionId}`);
  if (!entry) return false;
  const cfg = entry.config;
  const slot = generatedHumanoidAnimationSlotsByActorId.get(actorId);
  const now = performance.now();

  const clipPlayed = respondToTouch(actorId, cfg, "animation");
  // Durable multi-region trace + remote actor-turn first (Q4), then the reflexive line wins activeSpeech.
  completeTraceActionFromInput(cfg.traceTag, source, {
    clinicalTouch: true,
    actorId,
    region: regionId,
    responseKind: cfg.responseKind,
    dialogueLine: cfg.dialogueLine,
    emotion: cfg.emotion,
    responseClip: cfg.responseClip,
    notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
  });
  if (slot) startHumanoidEmotionTransition(slot, cfg.emotion, now);
  triggerHumanoidDialogue(actorId, cfg.dialogueLine, { kind: "learner_camera", actorId: null }, cfg.emotion);

  (window as unknown as { __openClinXrClinicalTouchEvidence?: unknown }).__openClinXrClinicalTouchEvidence = {
    schemaVersion: "openclinxr.clinical-touch.v1",
    actorId,
    region: regionId,
    responseKind: cfg.responseKind,
    responseClip: cfg.responseClip,
    clipPlayed,
    emotion: cfg.emotion,
    emotionTransitioned: Boolean(slot),
    dialogueFired: true,
    dialogueLine: cfg.dialogueLine,
    traceTag: cfg.traceTag,
    traceEventType: `clinical.touch.${cfg.responseKind}`,
    source,
    atMs: Number(now.toFixed(1)),
    notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
  };
  return true;
}

/**
 * #315: frame a comparator capture on the NAMED actor after it loads.
 * `peds_anny_real_garment_parent` names the family actor, `..._nurse` the clinical-team
 * actor. The camera is constructed before any humanoid exists, so authored numbers were
 * always a guess about where an actor would end up (two hand-fixes reverted — see the
 * planted contract header). Reuse the proven fit-to-bounds solve (frameCamera) against
 * the loaded actor's world AABB, and record the model assetId it framed so a gate can
 * check recorded intent — a test cannot see a picture and byte size is not identity.
 */
function frameComparatorCaptureOnNamedActor(actorId: string, humanoid: Object3D, modelAssetId: string): void {
  const comparator = selectedHumanoidSourceComparator();
  if (comparator !== "peds_anny_real_garment_parent" && comparator !== "peds_anny_real_garment_nurse") return;
  if (!shouldUseCleanHumanoidSourceComparatorCapture()) return;
  const namedActorId = comparator === "peds_anny_real_garment_parent"
    ? runtimeFamilyActorId()
    : runtimeClinicalTeamActorId();
  if (!namedActorId || actorId !== namedActorId) return;
  const cam = comparatorCaptureCamera;
  if (!cam) return;
  // World matrices must be current for the freshly-added subtree (#315 parent-aware solve).
  comparatorCaptureSceneRoot?.updateMatrixWorld(true);
  const bounds = computeMeshBounds(humanoid);
  if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) return;
  const center = bounds.getCenter(new Vector3());
  const frameSpanFraction = frameCamera(cam, bounds, "front");
  cam.userData.openClinXrCameraFraming =
    `clean_${comparator}_source_comparator_fit_to_bounds_named_actor_${namedActorId}_no_authored_numbers`;
  cam.userData.openClinXrComparatorFrameSpanFraction = frameSpanFraction;
  window.__openClinXrComparatorCameraTargetActorId = modelAssetId;
  // #315 follow-up: recorded framing dump — NDC projection of the framed subject's
  // world center plus every actor slot's visibility/NDC, so a framing miss is a
  // measurement, not a pixel guess. A slot with visible=false cannot be the figure
  // in the frame even though the camera aims at it.
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const projectNdc = (point: Vector3): { x: number; y: number; z: number } => {
    const p = point.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    return { x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)), z: Number(p.z.toFixed(3)) };
  };
  const slotRows: NonNullable<NonNullable<Window["__openClinXrComparatorFramingDump"]>["slots"]> = [];
  comparatorCaptureSceneRoot?.updateMatrixWorld(true);
  comparatorCaptureSceneRoot?.traverse((o) => {
    const slotKind = (o as { userData?: { openClinXrSlotKind?: string } }).userData?.openClinXrSlotKind;
    const slotActorId = (o as { userData?: { openClinXrActorId?: string } }).userData?.openClinXrActorId;
    if (typeof slotKind !== "string" || typeof slotActorId !== "string" || slotActorId.length === 0) return;
    const slotBounds = computeMeshBounds(o as Object3D);
    if (!Number.isFinite(slotBounds.min.x)) return;
    const slotCenter = slotBounds.getCenter(new Vector3());
    slotRows.push({
      slotKind,
      actorId: slotActorId,
      visible: (o as { visible: boolean }).visible,
      worldCenter: { x: Number(slotCenter.x.toFixed(3)), y: Number(slotCenter.y.toFixed(3)), z: Number(slotCenter.z.toFixed(3)) },
      ndc: projectNdc(slotCenter),
    });
  });
  const worldPos = new Vector3();
  cam.getWorldPosition(worldPos);
  window.__openClinXrComparatorFramingDump = {
    comparator,
    namedActorId,
    boundsMin: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    boundsMax: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    boundsCenter: { x: center.x, y: center.y, z: center.z },
    camPositionLocal: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
    camWorldPosition: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
    camParentName: cam.parent?.name ?? null,
    camParentMatrixWorld: cam.parent ? Array.from(cam.parent.matrixWorld.elements) : null,
    frameSpanFraction,
    ndcBoundsCenter: projectNdc(center),
    namedActorSlotVisible: humanoid.parent?.visible ?? null,
    slots: slotRows,
  };
}

/**
 * Tag SEPARATE phenotype real-garment meshes with cyan + sleeveDeform userData.
 * ONLY meshes named openclinxr_real_garment* / real_garment_from_phenotype* (or their
 * :y_up_capture_evidence static clone). NEVER cyan-tag anny_base multi-prim role clothing
 * slots (parent_top/nurse_top/lower/soft_trim) — those produce a giant pants blob while torso stays bare.
 */
function loadGeneratedHumanoidIntoActorSlot(
  actorSlot: Group,
  options: {
    assetPath: string;
    assetId: string;
    objectName: string;
    actorId: string;
    roleTintColor: number;
    verticalOffsetMeters: number;
    posture?: ActorPosture | undefined;
  },
): void {
  const primitiveFallbackChildren = [...actorSlot.children];
  for (const child of primitiveFallbackChildren) {
    child.visible = false;
  }
  const humanoidLoader = new GLTFLoader();
  humanoidLoader.setMeshoptDecoder(MeshoptDecoder);
  const actorSpecificAssetPath = runtimeHumanoidVariantAssetPath(options.actorId, options.assetPath);
  const humanoidSourceProvenance = generatedHumanoidSourceProvenance(actorSpecificAssetPath);
  recordSceneAssetStatus({
    assetId: options.assetId,
    assetPath: actorSpecificAssetPath,
    sceneObjectName: options.objectName,
    status: "pending",
    fallbackActive: false,
    ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
  });
  humanoidLoader.load(
    actorSpecificAssetPath,
    (gltf) => {
      const humanoid = gltf.scene;
      try { assertHumanoidRootUpright(humanoid); } catch (guardError) {
        // #67: refuse #58-class non-identity armature root before the figure is shown.
        console.error("[ui-xr] humanoid load refused by upright guard", actorSpecificAssetPath, guardError);
        recordSceneAssetStatus({ assetId: options.assetId, assetPath: actorSpecificAssetPath, sceneObjectName: options.objectName, status: "failed", fallbackActive: true, ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}) });
        for (const child of primitiveFallbackChildren) child.visible = true;
        return;
      }
      // #187: compose failures after a successful fetch must not leave a silent pending+primitive slot.
      try {
      humanoid.name = options.objectName;
      // #72 floor-standing zeros ED offsets; #105 elevated+scale re-solves so feet land near floor.
      const effectiveVerticalOffset = resolveEffectiveVerticalOffsetMeters({
        slotLocalY: actorSlot.position.y,
        verticalOffsetMeters: options.verticalOffsetMeters,
        slotScaleY: actorSlot.scale.y,
      });
      humanoid.position.set(0, effectiveVerticalOffset, 0);
      humanoid.userData.openClinXrEffectiveVerticalOffsetMeters = effectiveVerticalOffset;
      humanoid.userData.openClinXrRequestedVerticalOffsetMeters = options.verticalOffsetMeters;
      humanoid.rotation.y = 0;
      humanoid.scale.set(1, 1, 1);
      // #83: never default missing slotKind to primary_patient — that seated every telehealth actor.
      const slotKind =
        (typeof actorSlot.userData.openClinXrSlotKind === "string" && actorSlot.userData.openClinXrSlotKind.length > 0
          ? actorSlot.userData.openClinXrSlotKind
          : undefined)
        ?? "unknown_slot";
      const posture = options.posture
        ?? resolveActorPosture({
          scenarioId: selectedScenarioId(),
          environmentId: resolveActiveEnvironmentId(),
          slotKind,
        });
      humanoid.userData.openClinXrActorId = options.actorId;
      humanoid.userData.openClinXrAssetPath = actorSpecificAssetPath;
      actorSlot.userData.openClinXrActorPosture = posture;
      actorSlot.userData.openClinXrActorId = options.actorId;
      // #219: body-param library figures need flipped upper_arm Z hang (hm08 rest sense ≠ Anny).
      // Tag before clinical idle so load + frame-loop apply the library hang map.
      if (/body-param-.*-library\.glb/i.test(actorSpecificAssetPath)) {
        humanoid.userData.openClinXrHumanoidRail = "library";
        actorSlot.userData.openClinXrHumanoidRail = "library";
      }
      if (posture === "supine") applySupinePose(humanoid);
      else applyPosturePose(humanoid, posture);
      neutralizeGeneratedHumanoidMorphTargets(humanoid);
      const humanoidSourceComparator = selectedHumanoidSourceComparator();
      const isRealGarmentPrimaryActor =
        ((humanoidSourceComparator === "peds_anny_real_garment_patient" || humanoidSourceComparator === "ed_anny_real_garment_patient") && options.actorId === runtimePatientActorId())
        || (humanoidSourceComparator === "peds_anny_real_garment_parent" && (options.actorId === runtimePatientActorId() || options.actorId === runtimeFamilyActorId()))
        || (humanoidSourceComparator === "peds_anny_real_garment_nurse" && (options.actorId === runtimePatientActorId() || options.actorId === runtimeClinicalTeamActorId()));
      const cleanSourceComparatorCapture = shouldUseCleanHumanoidSourceComparatorCapture() && humanoidSourceComparator !== null && (
        options.actorId === runtimePatientActorId()
        || (humanoidSourceComparator === "peds_anny_real_garment_parent" && options.actorId === runtimeFamilyActorId())
        || (humanoidSourceComparator === "peds_anny_real_garment_nurse" && options.actorId === runtimeClinicalTeamActorId())
      );
      if (cleanSourceComparatorCapture) {
        actorSlot.traverse((object) => {
          if (object === actorSlot) return;
          object.visible = false;
          object.userData.openClinXrComparatorVisibilityPolicy = "hidden_preload_primitive_and_runtime_scaffolding_for_clean_source_capture";
        });
      }
      if (humanoidSourceComparator === "mpfb_ob_patient" && options.actorId === runtimePatientActorId()) {
        humanoid.position.y += 0.32;
        humanoid.scale.set(0.92, 0.92, 0.92);
        humanoid.userData.openClinXrHumanoidComparatorTransform =
          "mpfb_ob_patient_source_alignment_for_webxr_visual_comparison_only";
      }
      if (humanoidSourceComparator === "charmorph_antonia_patient" && options.actorId === runtimePatientActorId()) {
        humanoid.position.y += 0.24;
        humanoid.rotation.y = 0;
        humanoid.scale.set(1.08, 1.08, 1.08);
        humanoid.userData.openClinXrHumanoidComparatorTransform =
          "charmorph_antonia_patient_source_alignment_for_webxr_visual_comparison_only_target_facing";
      }
      if ((humanoidSourceComparator === "charmorph_reom_patient" || humanoidSourceComparator === "reom_local_fitted_garment_patient" || humanoidSourceComparator === "reom_local_authored_curved_garment_patient" || humanoidSourceComparator === "reom_shirts01_cc0_patient" || humanoidSourceComparator === "reom_toigo_basic_tucked_tshirt_patient" || humanoidSourceComparator === "reom_namuhekam_polo_patient") && options.actorId === runtimePatientActorId()) {
        humanoid.position.y += 0.2;
        humanoid.rotation.y = 0;
        humanoid.scale.set(1.04, 1.04, 1.04);
        humanoid.userData.openClinXrHumanoidComparatorTransform =
          `${humanoidSourceComparator}_source_alignment_for_webxr_visual_comparison_only_target_facing`;
      }
      if (
        (humanoidSourceComparator === "peds_anny_real_garment_patient"
          || humanoidSourceComparator === "ed_anny_real_garment_patient"
          || humanoidSourceComparator === "peds_anny_real_garment_parent"
          || humanoidSourceComparator === "peds_anny_real_garment_nurse")
        && isRealGarmentPrimaryActor
      ) {
        const taggedGarment = applyRealGarmentEvidenceSurfaces(humanoid, humanoidSourceComparator);
        humanoid.userData.openClinXrRealGarmentTopology = "embedded_from_phenotype_garmentLayers";
        const promotionByComparator: Record<string, string> = {
          peds_anny_real_garment_patient: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_peds_real_garment",
          peds_anny_real_garment_parent: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_peds_parent_real_garment",
          peds_anny_real_garment_nurse: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_peds_nurse_real_garment",
          ed_anny_real_garment_patient: "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_ed_gown_geo_reorchestrate",
        };
        humanoid.userData.openClinXrPromotionFlow =
          promotionByComparator[humanoidSourceComparator]
          ?? "promotionStatus_realismGrade_realGarmentRegionFromPhenotype_notEvidenceFor_in_runtime_evidence_for_ed_gown_geo_reorchestrate";
        // Seed MouthGaze garmentGeometry on primary load (not gated on patient-speech timing).
        if (
          taggedGarment
          && isRealGarmentSleeveDeformCapture()
          && options.actorId === runtimePatientActorId()
        ) {
          // #314: derive source/cue from the ACTUAL loaded asset (actorSpecificAssetPath)
          // rather than the comparator — the parent/nurse comparators cast the patient
          // primary to the child (peds_patient_child.glb), so a comparator-keyed cue
          // would label the child's exam tshirt with the parent cardigan's provenance.
          const garmentSource = actorSpecificAssetPath;
          const sleeveDeformCue = sleeveDeformCueForAssetPath(actorSpecificAssetPath, humanoidSourceComparator);
          const existingMouth = window.__openClinXrMouthGazePoseComparatorEvidence;
          window.__openClinXrMouthGazePoseComparatorEvidence = {
            source: "window.__openClinXrMouthGazePoseComparatorEvidence",
            captureMode: selectedCaptureMode(),
            comparator: humanoidSourceComparator as MouthGazePoseComparatorEvidence["comparator"],
            scenarioId: humanoidSourceComparator === "ed_anny_real_garment_patient" ? "ed_chest_pain_priority_v2" : "peds_asthma_parent_anxiety_v1",
            actorId: options.actorId,
            dialogueText: existingMouth?.dialogueText ?? "",
            traceTag: "work_of_breathing_assessment",
            activeViseme: existingMouth?.activeViseme ?? "sil",
            activeMouthOpenness: existingMouth?.activeMouthOpenness ?? 0,
            activeEmotionState: existingMouth?.activeEmotionState ?? "neutral",
            activeExpressionTransitionMs: existingMouth?.activeExpressionTransitionMs ?? 0,
            activeExpressionWeights: existingMouth?.activeExpressionWeights ?? {
              mouthOpen: 0, browConcern: 0, cheekTension: 0,
            },
            gazeProbePlayback: existingMouth?.gazeProbePlayback ?? null,
            activeGazeProbeAnimationClipName: existingMouth?.activeGazeProbeAnimationClipName ?? null,
            morphTargetAppliedTargetCount: existingMouth?.morphTargetAppliedTargetCount ?? 0,
            morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue_with_emotion_transition",
            emotionTransitionCuePresent: existingMouth?.emotionTransitionCuePresent ?? false,
            visemeTimelineComparatorEvidencePresent: existingMouth?.visemeTimelineComparatorEvidencePresent ?? false,
            activeDialogueTurnRef: existingMouth?.activeDialogueTurnRef,
            liveSource: existingMouth?.liveSource,
            garmentGeometry: {
              name: taggedGarment.name || "real_garment_mesh",
              visible: taggedGarment.visible,
              source: garmentSource,
              hasVisibleVolume: true,
              hasSeamFoldHints: true,
              sleeveDeform: sleeveDeformCue,
            },
            notEvidenceFor: [
              "production phoneme timing",
              "validated facial animation",
              "clinical affect scoring",
              "b_plus_visual_realism_gate",
              "quest_readiness",
              "production_asset_readiness",
              "learner_readiness",
            ],
          };
        }
      }
      if (!cleanSourceComparatorCapture) {
        tintGeneratedSceneMaterials(humanoid, options.roleTintColor, options.actorId);
      } else {
        humanoid.userData.openClinXrSourceComparatorMaterialPolicy =
          "source_materials_preserved_for_clean_comparator_capture_no_runtime_tint";
      }
      humanoid.userData.openClinXrClinicalIdlePoseClipPresent = hasAuthoredClinicalIdlePoseClip(gltf.animations);
      // #153: skip standing clinical idle / role posture on supine — they overwrite the
      // recumbent limb map at load (frame loop already guards; load path did not).
      if (!cleanSourceComparatorCapture && posture !== "supine") {
        applyGeneratedHumanoidClinicalIdlePosture(humanoid);
        applyGeneratedHumanoidRoleSpecificPosture(humanoid, options.actorId);
      } else if (cleanSourceComparatorCapture) {
        humanoid.userData.openClinXrSourceComparatorPosturePolicy =
          "source_pose_preserved_for_clean_comparator_capture_no_runtime_posture_override";
      } else {
        humanoid.userData.openClinXrSupineLoadPosturePolicy =
          "clinical_idle_and_role_posture_skipped_for_supine_recumbent_map";
      }
      if (cleanSourceComparatorCapture) {
        humanoid.userData.openClinXrRoleSpecificVisualsPolicy = "skipped_for_clean_source_comparator_capture";
        suppressRuntimeDiagnosticOverlaysForSourceComparator(humanoid);
        humanoid.traverse((object) => {
          if (object instanceof Mesh) {
            object.frustumCulled = false;
            object.userData.openClinXrComparatorCullingPolicy =
              "frustum_culling_disabled_for_clean_source_comparator_capture_after_skinned_mesh_bounds_hid_body";
          }
        });
      } else {
        addRoleSpecificHumanoidVisuals(humanoid, options.actorId);
      }
      if (shouldShowHumanoidSourceComparatorDebugFaceCues() && (humanoidSourceComparator === "charmorph_antonia_patient" || humanoidSourceComparator === "charmorph_reom_patient") && options.actorId === runtimePatientActorId()) {
        addHumanoidSourceComparatorFaceReviewCues(humanoid);
      }
      if (!cleanSourceComparatorCapture && encounterRuntimeAssetBundle.scenarioId === 'ob_headache_preeclampsia_triage_v1') {
        const role = (runtimeActorRole(options.actorId) ?? '').toLowerCase();
        if (role.includes('patient')) addGeneratedHumanoidRoleContinuityWardrobeCue(humanoid, 'patient');
        else if (role.includes('nurse') || role.includes('clinical') || role.includes('consultant') || role.includes('therapist')) addGeneratedHumanoidRoleContinuityWardrobeCue(humanoid, 'clinical');
        else if (role.includes('family') || role.includes('spouse') || role.includes('parent')) addGeneratedHumanoidRoleContinuityWardrobeCue(humanoid, 'family');
      }
      humanoid.userData.openClinXrAffordances = ["dialogue_target", "clinical_observation_target"];
      const dialogueTargetMarker = createAffordanceMarker(`${options.objectName}:dialogue_target`, options.roleTintColor);
      if (isHumanoidMouthGazePoseReviewCaptureMode() || cleanSourceComparatorCapture || isRealGarmentSleeveDeformCapture()) {
        dialogueTargetMarker.visible = false;
        dialogueTargetMarker.userData.openClinXrCaptureVisibilityPolicy = "hidden_for_mouth_gaze_pose_realism_review";
      }
      humanoid.add(dialogueTargetMarker);
      if (!cleanSourceComparatorCapture) {
        humanoid.add(createRuntimeHumanoidDetailCues(options.assetId));
        humanoid.add(createHumanoidInteractionCollisionCues(options.assetId));
      }
      const mouthCue = createHumanoidSpeechMouthCue(options.assetId, options.roleTintColor);
      humanoid.add(mouthCue);
      const gazeCue = createHumanoidEyeGazeCue(options.assetId, options.roleTintColor);
      humanoid.add(gazeCue);
      const eyeFocusCue = createHumanoidEyeFocusCue(options.assetId);
      humanoid.add(eyeFocusCue);
      const expressionCue = createHumanoidExpressionCue(options.assetId);
      humanoid.add(expressionCue);
      if (cleanSourceComparatorCapture) {
        for (const cleanCaptureCue of [mouthCue, gazeCue, eyeFocusCue, expressionCue]) {
          cleanCaptureCue.visible = false;
          cleanCaptureCue.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_clean_source_comparator_capture";
        }
      }
      actorSlot.add(humanoid);
      // #315: after the named actor loads, frame the comparator capture on IT (not the
      // patient at the origin) via the proven fit-to-bounds solve, and record the target.
      frameComparatorCaptureOnNamedActor(options.actorId, humanoid, options.assetId);
      if (isCaptureShadowPath(selectedCaptureMode())) markActorCastShadow(humanoid);
      if (isHumanoidMouthGazePoseReviewCaptureMode()) {
        // #315 follow-up: the review subject is the comparator's NAMED actor — family for
        // _parent, clinical for _nurse, patient for the patient comparators. This block
        // previously hard-hid every non-patient slot, which re-hid the named parent/nurse
        // slots after the slot-visibility change and blanked the frame (7,479-byte PNG).
        const subjectForReview = comparatorCaptureSubjectActorId();
        if (options.actorId !== subjectForReview) {
          actorSlot.visible = false;
          actorSlot.userData.openClinXrCaptureVisibilityPolicy = "hide_non_named_subject_actors_for_primary_humanoid_mouth_gaze_pose_review";
        }
      }
      const roleAnimationClipNames = roleAnimationClipNamesForActor(options.actorId);
      const gazeProbeAnimationClipNames = gazeProbeAnimationClipNamesFromGltf(gltf.animations);
      const activeRoleAnimationClipName = gltf.animations.find((clip): clip is AnimationClip =>
        clip instanceof AnimationClip && roleAnimationClipNames.includes(clip.name)
      )?.name ?? null;
      const activeGazeProbeAnimationClipName = gltf.animations.find((clip): clip is AnimationClip =>
        clip instanceof AnimationClip && gazeProbeAnimationClipNames.includes(clip.name)
      )?.name ?? null;
      registerGeneratedHumanoidAnimation({
        assetId: options.assetId,
        actorId: options.actorId,
        actorSlot,
        humanoid,
        mouthCue,
        gazeCue,
        eyeFocusCue,
        expressionCue,
        animationClips: gltf.animations,
        roleAnimationClipNames,
        gazeProbeAnimationClipNames,
        playbackEnabled: !cleanSourceComparatorCapture || isRealGarmentSleeveDeformCapture(),
        fixedSourcePoseSampleSeconds: cleanSourceComparatorCapture && !isRealGarmentSleeveDeformCapture() ? 0.18 : null,
      });
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: actorSpecificAssetPath,
        sceneObjectName: options.objectName,
        status: "loaded",
        fallbackActive: false,
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "dialogue_target",
          "clinical_observation_target",
          "generated_humanoid_hair_clothing_eye_detail_cue",
          "phoneme_viseme_dialogue_cue",
          "dialogue_gaze_target_cue",
          "dialogue_eye_focus_target_cue",
          "scenario_emotion_expression_cue",
          "visible_runtime_mouth_shape_cue",
          "visible_runtime_eye_focus_cue",
          "visible_runtime_eyebrow_jaw_cheek_cue",
          "face_lip_eye_rig_contract_cue",
          "ragdoll_collision_proxy_cue",
          "physician_interaction_target_cue",
          ...(humanoid.userData.openClinXrClinicalIdlePoseClipPresent ? ["authored_clinical_idle_pose_clip_cue"] : []),
        ]),
        animationPlayback: cleanSourceComparatorCapture
          ? "source_comparator_fixed_pose_sampled"
          : gltf.animations.length > 0
            ? roleAnimationClipNames.length > 0
              ? "gltf_role_animation_clip_playing"
              : "gltf_animation_clips_playing"
            : "procedural_dialogue_expression_gaze_fallback",
        roleAnimationClipNames,
        activeRoleAnimationClipName,
        gazeProbeAnimationClipNames,
        activeGazeProbeAnimationClipName,
        gazeProbePlayback: cleanSourceComparatorCapture ? "not_applicable" : activeGazeProbeAnimationClipName ? "gltf_gaze_probe_clip_playing" : "gaze_probe_clip_missing",
        ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
      });
      recordBootPhase("generated_humanoid_asset_loaded");
      } catch (composeError) {
        // Loud-and-degrade (#187): keep the session up, restore the primitive, surface the cause.
        console.error("[ui-xr] humanoid compose failed after GLB load", actorSpecificAssetPath, composeError);
        for (const child of primitiveFallbackChildren) child.visible = true;
        recordSceneAssetStatus({
          assetId: options.assetId,
          assetPath: actorSpecificAssetPath,
          sceneObjectName: options.objectName,
          status: "failed",
          fallbackActive: true,
          ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
        });
        recordBootPhase("generated_humanoid_asset_compose_failed", composeError);
      }
    },
    undefined,
    (error) => {
      // #187: loader path was silent vs upright-guard console.error — loud-and-degrade both paths.
      console.error("[ui-xr] humanoid GLB load failed", actorSpecificAssetPath, error);
      for (const child of primitiveFallbackChildren) {
        child.visible = true;
      }
      applyGeneratedHumanoidRoleSpecificPosture(actorSlot, options.actorId);
      addRoleSpecificHumanoidVisuals(actorSlot, options.actorId, "primitive_fallback");
      actorSlot.userData.openClinXrGeneratedHumanoidFallbackPolicy =
        "primitive_actor_restored_when_generated_humanoid_asset_unavailable_to_avoid_empty_encounter_scene";
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: actorSpecificAssetPath,
        sceneObjectName: options.objectName,
        status: "failed",
        fallbackActive: true,
        ...(humanoidSourceProvenance ? { humanoidSourceProvenance } : {}),
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "primitive_actor_restored_after_generated_humanoid_load_failed",
          "case_definition_driven_role_pose_applied_to_fallback_actor",
        ]),
      });
      recordBootPhase("generated_humanoid_asset_load_failed", error);
    },
  );
}

function shouldUseCleanHumanoidSourceComparatorCapture(): boolean {
  const captureMode = selectedCaptureMode();
  // framing-polish-parent-nurse-garment-ui-xr-v1 (Q5): sleeve-deform / real-garment body-motion capture must declutter
  // teal dialogue/clinical/input panels, nameplates, equipment boxes, and XR controller models so the cyan
  // phenotype garment torso+sleeve volume is skeptic-visible (not occluded by affordance boards).
  return captureMode.includes("source-clean")
    || new URLSearchParams(window.location.search).get("humanoidSourceCleanCapture") === "1"
    || isRealGarmentSleeveDeformCapture();
}

function suppressRuntimeDiagnosticOverlaysForSourceComparator(humanoid: Group): void {
  // Never hide phenotype real-garment meshes (name includes openclinxr_real_garment / casual_top / scrub).
  const scaffoldingNamePattern = /comparator|diagnostic|gown|blanket|wrist_band|visible_lip|eye_focus|hair_cap|patient_lap|patient_gown|patient_visible|actor-specific|specific|clothing|accent|pregnancy|abdomen|belly|morph_target|wardrobe|torso|cue/u;
  const protectGarmentPattern = /openclinxr_real_garment|real_garment_from_phenotype|real_garment_peds|casual_top|scrub_top|cardigan/i;
  humanoid.traverse((object) => {
    const name = object.name.toLowerCase();
    if (protectGarmentPattern.test(object.name) || object.userData?.openClinXrGarmentEvidenceSurface || object.userData?.openClinXrSleeveDeformEvidence) {
      object.visible = true;
      return;
    }
    if (!scaffoldingNamePattern.test(name)) return;
    object.visible = false;
    object.userData.openClinXrComparatorVisibilityPolicy = "hidden_for_source_realism_review_to_avoid_scaffolding_dominating_grade";
  });
  humanoid.userData.openClinXrSourceComparatorScaffoldingSuppressed =
    "source_fitted_mesh_prioritized_over_runtime_or_generator_debug_overlays_for_realism_scoring";
}

function shouldShowHumanoidSourceComparatorDebugFaceCues(): boolean {
  const captureMode = selectedCaptureMode();
  return captureMode.includes("debug-face-cue") || new URLSearchParams(window.location.search).get("humanoidComparatorDebugFaceCues") === "1";
}

function addHumanoidSourceComparatorFaceReviewCues(humanoid: Group): void {
  const eyeMaterial = new MeshStandardMaterial({ color: 0x111827, roughness: 0.48 });
  const lipMaterial = new MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.56 });
  for (const z of [-0.36, 0.36]) {
    const leftEye = new Mesh(new SphereGeometry(0.018, 16, 8), eyeMaterial.clone());
    leftEye.name = `${runtimeSceneObjectPrefix()}.charmorph-comparator-left-eye-visible-review-cue`;
    leftEye.position.set(-0.035, 1.58, z);
    humanoid.add(leftEye);
    const rightEye = new Mesh(new SphereGeometry(0.018, 16, 8), eyeMaterial.clone());
    rightEye.name = `${runtimeSceneObjectPrefix()}.charmorph-comparator-right-eye-visible-review-cue`;
    rightEye.position.set(0.035, 1.58, z);
    humanoid.add(rightEye);
    const mouth = new Mesh(new BoxGeometry(0.085, 0.018, 0.012), lipMaterial.clone());
    mouth.name = `${runtimeSceneObjectPrefix()}.charmorph-comparator-mouth-viseme-visible-review-cue`;
    mouth.position.set(0, 1.535, z);
    humanoid.add(mouth);
  }
  humanoid.userData.openClinXrHumanoidComparatorFaceReviewCue =
    "visible_eye_mouth_cues_for_webxr_adversarial_screenshot_review_only";
}

function runtimeHumanoidVariantAssetPath(actorId: string, fallbackPath: string): string {
  const role = (runtimeActorRole(actorId) ?? '').toLowerCase();
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;

  // #144: OB bake-off comparators only. Default cast must use resolveHumanoidVariantOrCastPath
  // (same six regenerated humanoids as psych) — do NOT fall back to stale
  // /xr-assets/humanoids/variants/ob-*-generated-human.glb (pre-#103 torn/nude mesh path).
  if (scenarioId === 'ob_headache_preeclampsia_triage_v1') {
    const humanoidSourceComparator = selectedHumanoidSourceComparator();
    if (humanoidSourceComparator === "mpfb_ob_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/mpfb-ob-patient-aisha-rigged-candidate.glb';
    }
    if (humanoidSourceComparator === "charmorph_antonia_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/charmorph-antonia-ob-patient-candidate.glb';
    }
    if (humanoidSourceComparator === "charmorph_reom_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/charmorph-reom-ob-patient-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_local_fitted_garment_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/makeclothes-hm08-scrub-shirt-library.glb';
    }
    if (humanoidSourceComparator === "reom_local_authored_curved_garment_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-local-authored-curved-clinical-top-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_shirts01_cc0_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-shirts01-cc0-elvs-crude-tshirt-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_toigo_basic_tucked_tshirt_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-toigo-basic-tucked-tshirt-candidate.glb';
    }
    if (humanoidSourceComparator === "reom_namuhekam_polo_patient" && actorId === runtimePatientActorId()) {
      return '/xr-assets/humanoids/candidates/reom-namuhekam-polo-clearance-candidate.glb';
    }
    // No default variant short-circuit — fall through to cast SSOT below.
  }

  if (scenarioId === 'peds_asthma_parent_anxiety_v1') {
    const humanoidSourceComparator = selectedHumanoidSourceComparator();
    if (humanoidSourceComparator === "peds_anny_comfy_masked_skin") {
      if (actorId === runtimePatientActorId() || role === "patient") {
        return "/cagematch/anny-comfy-masked-skin/current/peds_patient_child.glb";
      }
      if (actorId === runtimeFamilyActorId() || role === "parent" || role === "family") {
        return "/cagematch/anny-comfy-masked-skin/current/peds_anxious_parent.glb";
      }
      if (actorId === runtimeClinicalTeamActorId() || role === "nurse") {
        return "/cagematch/anny-comfy-masked-skin/current/peds_nurse_kevin.glb";
      }
    }
    if (humanoidSourceComparator === "peds_anny_mpfb2_eye_rig_patient" && (actorId === runtimePatientActorId() || role === "patient")) {
      return "/cagematch/anny-mpfb2-eye-rig/current/peds_patient_child_mpfb2_eye_rig.glb";
    }
    if (humanoidSourceComparator === "peds_anny_school_age_mpfb2_eye_patient" && (actorId === runtimePatientActorId() || role === "patient")) {
      return "/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb";
    }
    if (humanoidSourceComparator === "peds_anny_real_garment_patient" && (actorId === runtimePatientActorId() || role === "patient")) {
      return "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb";
    }
    // ui-xr-parent-nurse-runtime-comparator-v1: parent/nurse real-garment on patient primary (camera center) AND role slot; no re-orchestrate
    // #314: patient (child) and family/parent are DIFFERENT actors — the patient must
    // never resolve to the parent GLB. Split the cast: patient → child, family → parent.
    if (humanoidSourceComparator === "peds_anny_real_garment_parent") {
      if (actorId === runtimePatientActorId() || role === "patient") {
        return "/generated-humanoids/peds_patient_child.glb";
      }
      if (actorId === runtimeFamilyActorId() || role === "parent" || role === "family") {
        return "/generated-humanoids/peds_anxious_parent.glb";
      }
    }
    // #314: same split for the nurse comparator — patient → child, clinical team → nurse.
    if (humanoidSourceComparator === "peds_anny_real_garment_nurse") {
      if (actorId === runtimePatientActorId() || role === "patient") {
        return "/generated-humanoids/peds_patient_child.glb";
      }
      if (actorId === runtimeClinicalTeamActorId() || role === "nurse") {
        return "/generated-humanoids/peds_nurse_kevin.glb";
      }
    }
    const pedsHandoff = (encounterRuntimeAssetBundle as LearnerRuntimeAssetBundle & { pedsHumanoidMaterializationHandoff?: PedsHumanoidMaterializationHandoff }).pedsHumanoidMaterializationHandoff;
    if (pedsHandoff?.assets?.length) {
      const targetRole = (actorId === runtimePatientActorId() || role === 'patient')
        ? "patient"
        : (actorId === runtimeClinicalTeamActorId() || role === 'nurse')
          ? "nurse"
          : "anxious_parent";
      const asset = pedsHandoff.assets.find((a) => a.actorRole === targetRole);
      const handoffPath = asset?.runtimeAssetPath || asset?.assetPath;
      // #278: cast SSOT is authoritative for re-cast roles — handoff routes only when it agrees.
      if (handoffPath && handoffPath === resolveHumanoidVariantOrCastPath({ scenarioId, actorId, role, fallbackPath })) return handoffPath;
    }
    // #366: cast SSOT is authoritative for the default (non-comparator, non-handoff) path.
    // The previous hardcoded fallback returned the Anny child for the patient and hm08 library
    // bodies for parent/nurse — the exact mis-load #366 measured in the learner view while the
    // casting table already resolved all three roles to MPFB. Route through the same SSOT the
    // ED/OB/default branches use instead of a second, stale resolution site.
    return resolveHumanoidVariantOrCastPath({ scenarioId, actorId, role, fallbackPath });
  }

  if (scenarioId === 'ed_chest_pain_priority_v1' || scenarioId === 'ed_chest_pain_priority_v2') {
    const humanoidSourceComparator = selectedHumanoidSourceComparator();
    const comparatorOverride =
      humanoidSourceComparator === "ed_anny_real_garment_patient" && (actorId === runtimePatientActorId() || role === "patient")
        ? "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb"
        : null;
    // #85: age-band casting SSOT — adult ED roles resolve to adult cast, never peds_patient_child.
    return resolveHumanoidVariantOrCastPath({ scenarioId, actorId, role, fallbackPath, comparatorOverridePath: comparatorOverride });
  }

  // #111: cast SSOT only — no older|elder|geriatric|delirium substring short-circuit.
  return resolveHumanoidVariantOrCastPath({ scenarioId, actorId, role, fallbackPath });
}

function selectedHumanoidSourceComparator(): "mpfb_ob_patient" | "charmorph_antonia_patient" | "charmorph_reom_patient" | "reom_local_fitted_garment_patient" | "reom_local_authored_curved_garment_patient" | "reom_shirts01_cc0_patient" | "reom_toigo_basic_tucked_tshirt_patient" | "reom_namuhekam_polo_patient" | "peds_anny_mpfb2_eye_rig_patient" | "peds_anny_school_age_mpfb2_eye_patient" | "peds_anny_comfy_masked_skin" | "peds_anny_real_garment_patient" | "peds_anny_real_garment_parent" | "peds_anny_real_garment_nurse" | "ed_anny_real_garment_patient" | null {
  const selected = new URLSearchParams(window.location.search).get("humanoidSourceComparator")?.trim();
  return selected === "mpfb_ob_patient" || selected === "charmorph_antonia_patient" || selected === "charmorph_reom_patient" || selected === "reom_local_fitted_garment_patient" || selected === "reom_local_authored_curved_garment_patient" || selected === "reom_shirts01_cc0_patient" || selected === "reom_toigo_basic_tucked_tshirt_patient" || selected === "reom_namuhekam_polo_patient" || selected === "peds_anny_mpfb2_eye_rig_patient" || selected === "peds_anny_school_age_mpfb2_eye_patient" || selected === "peds_anny_comfy_masked_skin" || selected === "peds_anny_real_garment_patient" || selected === "peds_anny_real_garment_parent" || selected === "peds_anny_real_garment_nurse" || selected === "ed_anny_real_garment_patient" ? selected : null;
}

function pedsAsthmaPatientBundleVisemeUtterance(): string {
  const bundleTurn = (encounterRuntimeAssetBundle.sceneManifest.dialogueTurns ?? []).find(
    (turn) => turn.traceTag === "work_of_breathing_assessment" && turn.actorId === runtimePatientActorId(),
  );
  return bundleTurn?.text ?? "Maya Johnson: It is hard to breathe and my chest feels tight.";
}

function neutralizeGeneratedHumanoidMorphTargets(humanoid: Group): void {
  let meshCount = 0;
  let influenceCount = 0;
  const targetNames = new Set<string>();
  humanoid.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    meshCount++;
    const targetDictionary = object.morphTargetDictionary ?? {};
    const morphTargetCount = Math.max(
      object.morphTargetInfluences?.length ?? 0,
      Object.keys(targetDictionary).length,
    );
    if (!object.morphTargetInfluences || object.morphTargetInfluences.length !== morphTargetCount) {
      object.morphTargetInfluences = Array.from({ length: morphTargetCount }, () => 0);
    }
    for (let index = 0; index < object.morphTargetInfluences.length; index++) {
      object.morphTargetInfluences[index] = 0;
      influenceCount++;
    }
    for (const targetName of Object.keys(targetDictionary)) {
      targetNames.add(targetName);
    }
    object.userData.openClinXrNeutralMorphTargetPolicy =
      "all_imported_morph_targets_zeroed_until_runtime_speech_expression_sets_controlled_weights";
  });
  humanoid.userData.openClinXrNeutralMorphTargetPolicy = {
    mode: "zero_imported_default_morph_weights_on_load",
    meshCount,
    influenceCount,
    targetNames: [...targetNames].sort(),
    reason: "generated_anny_mpfb2_candidates_can_export_nonzero_default_viseme_expression_weights_that_hide_the_body_in_clean_review",
  };
}

function registerGeneratedHumanoidAnimation(input: {
  assetId: string;
  actorId: string;
  actorSlot: Group;
  humanoid: Group;
  mouthCue: Mesh;
  gazeCue: Line;
  eyeFocusCue: Group;
  expressionCue: Group;
  animationClips: unknown[];
  roleAnimationClipNames: string[];
  gazeProbeAnimationClipNames: string[];
  playbackEnabled: boolean;
  fixedSourcePoseSampleSeconds: number | null;
}): void {
  // #83: seated figures keep a mixer only for non-leg facial/upper clips when role clips exist.
  // Falling back to ALL glTF clips played standing armature tracks that overwrote the sit every frame
  // (re-apply helped only when it ran; full-body tracks + missing role names = bind/stand forever).
  const isSeated =
    input.humanoid.userData.openClinXrActorPosture === "seated"
    || input.actorSlot.userData.openClinXrActorPosture === "seated";
  const isSupine =
    input.humanoid.userData.openClinXrActorPosture === "supine"
    || input.actorSlot.userData.openClinXrActorPosture === "supine";
  // #574: the #574 carve-out — a NAMED seated-rig role clip may play on a seated actor.
  // The clip was retargeted from a seated source take, so performing it does not fight the
  // sit (translation channels are constant; legs re-folded per frame by applyPosturePose).
  const oneShotResponseClipNames = new Set(clinicalTouchResponseClipNamesForActor(input.actorId));
  const selectedRoleClips = input.animationClips.filter((clip): clip is AnimationClip =>
    clip instanceof AnimationClip
    && input.roleAnimationClipNames.includes(clip.name)
    && !oneShotResponseClipNames.has(clip.name)
  );
  const seatedRoleClipPlayable =
    isSeated && !isSupine
    && selectedRoleClips.length > 0
    && selectedRoleClips.every((clip) => seatedRoleClipIsPlayable(
      clip.name,
      { translationBoneNames: animatedTranslationBoneNames(clip.tracks) },
    ));
  // #150: no mixer for supine — standing tracks undo the recumbent plant.
  // #83 invariant intact for every other seated actor: no mixer without the carve-out.
  const mixer = input.playbackEnabled && input.animationClips.length > 0 && (!isSeated || seatedRoleClipPlayable) && !isSupine
    ? new AnimationMixer(input.humanoid)
    : undefined;
  // Response clips are registered on roleAnimationClipNames for discoverability but must not
  // auto-loop as role idle — they are one-shot via handleClinicalTouch / respondToTouch.
  const selectedGazeProbeClips = input.animationClips.filter((clip): clip is AnimationClip =>
    clip instanceof AnimationClip && input.gazeProbeAnimationClipNames.includes(clip.name)
  );
  // Never fall back to "play every clip" for seated/supine — neutral armatureAction is standing.
  const clipsToPlay = selectedRoleClips.length > 0
    ? [...selectedRoleClips, ...selectedGazeProbeClips]
    : isSeated || isSupine
      ? []
      : input.animationClips.filter((clip): clip is AnimationClip => clip instanceof AnimationClip);
  const fixedSourcePoseClip = selectedRoleClips[0] ?? input.animationClips.find((clip): clip is AnimationClip => clip instanceof AnimationClip);
  if (!input.playbackEnabled && fixedSourcePoseClip && input.fixedSourcePoseSampleSeconds !== null) {
    const fixedPoseMixer = new AnimationMixer(input.humanoid);
    fixedPoseMixer.clipAction(fixedSourcePoseClip).play();
    fixedPoseMixer.setTime(input.fixedSourcePoseSampleSeconds);
    input.humanoid.updateMatrixWorld(true);
  }
  if (mixer) {
    for (const clip of clipsToPlay) {
      mixer.clipAction(clip)?.play();
    }
  }
  // Seated: procedural sit is authoritative; re-apply once after any fixed-pose sample so legs stay folded.
  // #87: plant pelvis onto the chair seat (height from descent, not from hip fold past 95°).
  if (isSeated) {
    applyPosturePose(input.humanoid, "seated");
    // Aim flush with seat top; post-loop scale breathing opens gap slightly (still < 0.12).
    const plant = plantSeatedPelvisOnSeat(input.humanoid, PATIENT_CHAIR_SEAT_HEIGHT_METERS, 0.0);
    input.humanoid.userData.openClinXrSeatedPlantDeltaY = plant.deltaY;
    input.humanoid.userData.openClinXrSeatedPlantPelvisBefore = plant.pelvisBefore;
    input.humanoid.updateMatrixWorld(true);
  }
  if (isSupine) {
    const deckStretcher = findProceduralStretcherInSceneOf(input.actorSlot);
    applyAndPlantSupineOnDeck(input.humanoid, {
      deckTopWorldY: STRETCHER_DECK_TOP_METERS,
      deckCenter: { x: input.actorSlot.position.x, z: input.actorSlot.position.z },
      ...(deckStretcher ? { stretcher: deckStretcher } : {}),
    });
  }
  const activeRoleAnimationClipName = selectedRoleClips[0]?.name;
  const activeGazeProbeAnimationClipName = selectedGazeProbeClips[0]?.name;
  // #574 evidence: the carve-out decision is stamped so captures and tests can read
  // WHICH seated actor got a mixer and why, instead of re-deriving it from source.
  input.humanoid.userData.openClinXrSeatedRoleClipCarveout =
    mixer && isSeated && seatedRoleClipPlayable
      ? {
          admitted: true,
          clipNames: selectedRoleClips.map((clip) => clip.name),
          policy: "seated_role_clip_policy.seatedRoleClipIsPlayable",
        }
      : { admitted: false, clipNames: [] as string[], policy: "seated_role_clip_policy.seatedRoleClipIsPlayable" };
  const slot = {
    assetId: input.assetId,
    actorId: input.actorId,
    root: input.humanoid,
    actorSlot: input.actorSlot,
    baseY: input.humanoid.position.y,
    baseX: input.humanoid.position.x,
    baseScaleX: input.humanoid.scale.x,
    baseScaleY: input.humanoid.scale.y,
    baseScaleZ: input.humanoid.scale.z,
    baseRotationY: input.humanoid.rotation.y,
    baseZ: input.humanoid.position.z,
    phaseOffsetMs: generatedHumanoidAnimationSlots.length * 480,
    mouthCue: input.mouthCue,
    gazeCue: input.gazeCue,
    eyeFocusCue: input.eyeFocusCue,
    expressionCue: input.expressionCue,
    emotionExpression: createHumanoidEmotionExpressionState(),
    sourceComparatorFreezeEnabled: !input.playbackEnabled && input.fixedSourcePoseSampleSeconds !== null,
    responseClips: input.animationClips.filter((clip): clip is AnimationClip => clip instanceof AnimationClip),
    ...(mixer ? { mixer } : {}),
    ...(activeRoleAnimationClipName ? { activeRoleAnimationClipName } : {}),
    ...(activeGazeProbeAnimationClipName ? { activeGazeProbeAnimationClipName } : {}),
  };
  generatedHumanoidAnimationSlots.push(slot);
  generatedHumanoidAnimationSlotsByActorId.set(input.actorId, slot);
  generatedHumanoidActorSlotsByActorId.set(input.actorId, input.actorSlot);
  // Register case-driven clinical-touch hit regions for this actor, if any.
  const clinicalTouchScenario =
    scenarioBank.find((candidate) => candidate.scenarioId === selectedScenarioId()) ?? edChestPainScenario;
  const clinicalTouchActor = clinicalTouchScenario.actors.find((actor) => actor.actorId === input.actorId);
  if (clinicalTouchActor?.bodyMechanics?.touchResponses?.length) {
    registerClinicalTouchRegions(input.actorId, input.humanoid, clinicalTouchActor.bodyMechanics.touchResponses);
  }
  input.humanoid.userData.openClinXrAnimationPlayback = !input.playbackEnabled && fixedSourcePoseClip && input.fixedSourcePoseSampleSeconds !== null
    ? "source_comparator_fixed_pose_sampled"
    : mixer
    ? activeRoleAnimationClipName
      ? "gltf_role_animation_clip_playing"
      : "gltf_animation_clips_playing"
    : input.playbackEnabled ? "procedural_idle_breathing_fallback" : "source_comparator_animation_suppressed";
  input.humanoid.userData.openClinXrRoleAnimationClipNames = input.roleAnimationClipNames;
  input.humanoid.userData.openClinXrActiveRoleAnimationClipName = activeRoleAnimationClipName ?? null;
  input.humanoid.userData.openClinXrGazeProbeAnimationClipNames = input.gazeProbeAnimationClipNames;
  input.humanoid.userData.openClinXrActiveGazeProbeAnimationClipName = activeGazeProbeAnimationClipName ?? null;
  if (slot.sourceComparatorFreezeEnabled) {
    input.humanoid.userData.openClinXrSourceComparatorRuntimeFreezePolicy =
      "runtime_pose_speech_gaze_emotion_updates_disabled_for_clean_source_body_capture";
  }
  const comparatorForDialogue = selectedHumanoidSourceComparator();
  // parent/nurse real-garment primary is patient slot (role GLB centered for capture)
  if (input.actorId === runtimePatientActorId() && !slot.sourceComparatorFreezeEnabled) {
    const comparator = comparatorForDialogue;
    const isRealGarmentOrSchoolOrEd = comparator === "peds_anny_school_age_mpfb2_eye_patient" || comparator === "peds_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse" || comparator === "ed_anny_real_garment_patient";
    const dialogueText = isRealGarmentOrSchoolOrEd && comparator !== "ed_anny_real_garment_patient" && input.actorId === runtimePatientActorId()
      ? pedsAsthmaPatientBundleVisemeUtterance()
      : dialogueLine.textContent?.trim() || initialDialogueText;
    window.requestAnimationFrame(() => {
      triggerHumanoidDialogue(input.actorId, dialogueText, {
        kind: "learner_camera",
        actorId: null,
      }, isRealGarmentOrSchoolOrEd && comparator !== "ed_anny_real_garment_patient" ? "anxious" : undefined);
      if (isRealGarmentOrSchoolOrEd) {
        input.humanoid.userData.openClinXrVisemeTimelineComparatorEvidence = {
          comparator,
          dialogueText,
          traceTag: "work_of_breathing_assessment",
          mappingMode: "deterministic_text_phoneme_viseme_runtime_cue",
          morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue",
          notEvidenceFor: "production phoneme timing, validated facial animation, or clinical affect scoring",
        };
        // garmentGeometry surface prepared; real-garment (phenotype.garmentLayers) + school-age use embedded clothing regions from real topology
      }
    });
  }
  schedulePedsActorPlayerRuntimePlaybackIfReady();
  recordBootPhase(mixer ? "generated_humanoid_animation_clips_started" : "generated_humanoid_procedural_idle_started");
}

function schedulePedsActorPlayerRuntimePlaybackIfReady(): void {
  if (pedsActorPlayerRuntimePlaybackScheduled || !isPediatricAsthmaRuntimeScenario()) {
    return;
  }
  if (generatedHumanoidAnimationSlots.some((slot) => slot.sourceComparatorFreezeEnabled)) {
    return;
  }
  const turns = pedsActorPlayerRuntimeTurns();
  const requiredActorIds = Array.from(new Set(turns.map((turn) => turn.actorId)));
  if (!requiredActorIds.every((actorId) => generatedHumanoidAnimationSlotsByActorId.has(actorId))) {
    recordPedsActorPlayerRuntimePlaybackEvidence({
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
  pedsActorPlayerRuntimePlaybackScheduled = true;
  let turnIndex = 0;
  const playNextTurn = (): void => {
    const nowMs = performance.now();
    if (nowMs - pedsActorPlayerRuntimePlaybackLastTraceAtMs < 3800 || nowMs < pedsActorPlayerRuntimeSequenceActiveUntilMs) {
      return;
    }
    const turn = turns[turnIndex % turns.length];
    if (!turn) return;
    playPedsActorPlayerRuntimeTurn(turn, {
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
  recordBootPhase("peds_actor_player_runtime_playback_scheduled");
}

function triggerPedsAdaptiveDialogueBranch(
  branch: PedsAdaptiveDialogueBranchResolution,
  triggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"],
): boolean {
  if (!isPediatricAsthmaRuntimeScenario()) {
    return false;
  }
  const bundleTurns = pedsActorPlayerBundleDialogueTurns();
  const turns = branch.adaptiveTraceTags
    .map((cue) => bundleTurns.find((turn) => turn.cue === cue))
    .filter((turn): turn is PedsActorPlayerRuntimeTurn => Boolean(turn));
  if (turns.length === 0 || turns.some((turn) => !generatedHumanoidAnimationSlotsByActorId.has(turn.actorId))) {
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
  playPedsActorPlayerRuntimeSequence(sequence, pedsActorPlayerRuntimeTurns());
  const pedsRealGarmentOrSchoolComparator = ["peds_anny_school_age_mpfb2_eye_patient", "peds_anny_real_garment_patient", "peds_anny_real_garment_parent", "peds_anny_real_garment_nurse", "ed_anny_real_garment_patient"].includes(selectedHumanoidSourceComparator() || "") 
    ? (selectedHumanoidSourceComparator() as "peds_anny_school_age_mpfb2_eye_patient" | "peds_anny_real_garment_patient" | "peds_anny_real_garment_parent" | "peds_anny_real_garment_nurse" | "ed_anny_real_garment_patient")
    : undefined;
  window.__openClinXrPedsAdaptiveDialogueEvidence = {
    source: "window.__openClinXrPedsAdaptiveDialogueEvidence",
    scenarioId: selectedHumanoidSourceComparator() === "ed_anny_real_garment_patient" ? "ed_chest_pain_priority_v1" : "peds_asthma_parent_anxiety_v1",
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
          ? { realGarmentPatientAssetPath: "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb" }
          : pedsRealGarmentOrSchoolComparator === "peds_anny_real_garment_parent"
            ? { realGarmentParentAssetPath: "/generated-humanoids/peds_anxious_parent.glb" }
            : pedsRealGarmentOrSchoolComparator === "peds_anny_real_garment_nurse"
              ? { realGarmentNurseAssetPath: "/generated-humanoids/peds_nurse_kevin.glb" }
              : pedsRealGarmentOrSchoolComparator === "ed_anny_real_garment_patient"
                ? { edRealGarmentPatientAssetPath: "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb", promotionFlow: "ed_gown_geo_reorchestrate:promotionStatus_from_rigging_report+realGarmentRegionFromPhenotype" }
                : { schoolAgePatientAssetPath: "/cagematch/anny-school-age/current/peds_patient_child_mpfb2_eye.glb" }),
      }
      : {}),
    notEvidenceFor: branch.reviewSafeMetadata.notEvidenceFor,
  };
  recordPedsActorPlayerRuntimePlaybackEvidence({
    scheduled: pedsActorPlayerRuntimePlaybackScheduled,
    turns: pedsActorPlayerRuntimeTurns(),
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

function triggerPedsActorPlayerRuntimeTurnForTrace(traceTag: string): boolean {
  if (!isPediatricAsthmaRuntimeScenario()) {
    return false;
  }
  const turns = pedsActorPlayerRuntimeTurns();
  const sequence = pedsActorPlayerRuntimeSequenceForTrace(traceTag, turns);
  if (!sequence || sequence.turns.some((turn) => !generatedHumanoidAnimationSlotsByActorId.has(turn.actorId))) {
    return false;
  }
  pedsActorPlayerRuntimePlaybackLastTraceAtMs = performance.now();
  pedsActorPlayerRuntimeSequenceActiveUntilMs = pedsActorPlayerRuntimePlaybackLastTraceAtMs + (sequence.turns.length * 1250) + 2600;
  playPedsActorPlayerRuntimeSequence(sequence, turns);
  return true;
}

function pedsActorPlayerTurnForTraceTag(traceTag: string, turns = pedsActorPlayerRuntimeTurns()): PedsActorPlayerRuntimeTurn | undefined {
  const bundleTurn = pedsActorPlayerTurnFromRuntimeBundleTrace(traceTag);
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

function pedsActorPlayerRuntimeSequenceForTrace(
  traceTag: string,
  fallbackTurns = pedsActorPlayerRuntimeTurns(),
): PedsActorPlayerRuntimeSequenceEvidence | undefined {
  const bundleTurns = pedsActorPlayerBundleDialogueTurns();
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
    .filter((turn): turn is PedsActorPlayerRuntimeTurn => Boolean(turn));
  const uniqueBundleTurns = dedupePedsActorPlayerRuntimeTurns(requestedBundleTurns);
  if (uniqueBundleTurns.length > 0) {
    return {
      sequenceId: `bundle_sequence_${traceTag}`,
      traceTag,
      source: uniqueBundleTurns.length > 1 ? "bundle_dialogue_sequence" : "single_runtime_turn",
      turns: uniqueBundleTurns,
    };
  }
  const fallbackTurn = pedsActorPlayerTurnForTraceTag(traceTag, fallbackTurns);
  return fallbackTurn
    ? {
      sequenceId: `fallback_sequence_${traceTag}`,
      traceTag,
      source: "single_runtime_turn",
      turns: [fallbackTurn],
    }
    : undefined;
}

function dedupePedsActorPlayerRuntimeTurns(turns: PedsActorPlayerRuntimeTurn[]): PedsActorPlayerRuntimeTurn[] {
  const seen = new Set<string>();
  return turns.filter((turn) => {
    const key = `${turn.actorId}:${turn.turnId}:${turn.cue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pedsActorPlayerBundleDialogueTurns(): PedsActorPlayerRuntimeTurn[] {
  return (encounterRuntimeAssetBundle.sceneManifest.dialogueTurns ?? []).map((runtimeTurn) => ({
    actorId: runtimeTurn.actorId,
    turnId: `bundle_${runtimeTurn.traceTag}`,
    cue: runtimeTurn.traceTag,
    text: runtimeTurn.text,
    // affectTimeline remains bundle provenance only; live FACE is plan.dialogueEmotionTo.
    emotion: resolveLiveActorTurnForTrace(runtimeTurn.traceTag)?.faceEmotion ?? "neutral",
    gazeTargetKind: runtimeTurn.gazeTargetKind,
    gazeTargetActorId: runtimeTurn.gazeTargetActorId,
    roleAnimationClipName: roleAnimationClipNamesForActor(runtimeTurn.actorId)[0] ?? "",
    source: "bundle_dialogue_turn",
  }));
}

function pedsActorPlayerTurnFromRuntimeBundleTrace(traceTag: string): PedsActorPlayerRuntimeTurn | undefined {
  return pedsActorPlayerBundleDialogueTurns().find((turn) => turn.cue === traceTag);
}

function normalizePedsActorPlayerEmotion(emotion: string): HumanoidExpressionEmotion {
  const normalized = emotion.toLowerCase();
  if (normalized.includes("pain") || normalized.includes("frightened")) return "pain";
  if (normalized.includes("anxious")) return "anxious";
  if (normalized.includes("concern")) return "concerned";
  if (normalized.includes("reassur")) return "reassured";
  return "neutral";
}

function playPedsActorPlayerRuntimeTurn(
  turn: PedsActorPlayerRuntimeTurn,
  input: {
    turns: PedsActorPlayerRuntimeTurn[];
    latestTurnIndex: number;
    latestTriggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"];
    latestTraceTag: string | null;
    latestSequence: PedsActorPlayerRuntimeSequenceEvidence | null;
    latestSequenceStepIndex: number;
  },
): void {
  for (const slot of generatedHumanoidAnimationSlots) {
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
  const activeSlot = generatedHumanoidAnimationSlotsByActorId.get(turn.actorId);
  if (activeSlot) {
    delete activeSlot.root.userData.openClinXrSequenceListeningCue;
  }
  const nowMs = performance.now();
  const listenerCue = applyPedsActorPlayerSequenceListenerCues(turn, input.latestSequence, nowMs);
  const liveTurn = resolveLiveActorTurnForTrace(turn.cue);
  triggerHumanoidDialogue(turn.actorId, liveTurn?.caption ?? turn.text, {
    kind: turn.gazeTargetKind,
    actorId: turn.gazeTargetActorId,
  }, liveTurn?.faceEmotion ?? turn.emotion, undefined, liveTurn ? "plan.dialogueEmotionTo" : undefined);
  recordPedsActorPlayerRuntimePlaybackEvidence({
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
  dialogueLine.textContent = turn.text;
}

function applyPedsActorPlayerSequenceListenerCues(
  activeTurn: PedsActorPlayerRuntimeTurn,
  sequence: PedsActorPlayerRuntimeSequenceEvidence | null,
  nowMs: number,
): { actorIds: string[]; coupledSignalIds: string[] } {
  if (!sequence || sequence.turns.length <= 1) {
    return { actorIds: [], coupledSignalIds: [] };
  }
  const activeActorSlot = generatedHumanoidActorSlotsByActorId.get(activeTurn.actorId);
  if (!activeActorSlot) {
    return { actorIds: [], coupledSignalIds: [] };
  }
  const targetWorld = activeActorSlot.getWorldPosition(new Vector3());
  targetWorld.y += 1.18;
  const listenerActorIds = Array.from(new Set(sequence.turns
    .map((turn) => turn.actorId)
    .filter((actorId) => actorId !== activeTurn.actorId)));
  const coupledSignalIds = [
    "sequence_listener_gaze_to_active_speaker",
    "sequence_listener_expression_residual",
    "sequence_listener_body_attention_shift",
  ];
  for (const listenerActorId of listenerActorIds) {
    const slot = generatedHumanoidAnimationSlotsByActorId.get(listenerActorId);
    if (!slot || slot.activeSpeech || slot.sourceComparatorFreezeEnabled) {
      continue;
    }
    const gazeOrigin = new Vector3(0, 1.57, 0.29);
    const targetLocal = slot.root.worldToLocal(targetWorld.clone());
    const boundedTarget = targetLocal.sub(gazeOrigin).clampLength(0.35, 1.15).add(gazeOrigin);
    slot.gazeCue.geometry.setFromPoints([gazeOrigin, boundedTarget]);
    slot.gazeCue.visible = true;
    orientHumanoidEyeFocusCue(slot, gazeOrigin, boundedTarget);
    orientHumanoidTowardGazeTarget(slot, targetWorld);
    startHumanoidEmotionTransition(slot, listenerEmotionForSequence(activeTurn), nowMs);
    const expressionState = updateHumanoidEmotionExpression(slot, nowMs);
    slot.expressionCue.visible = true;
    slot.expressionCue.scale.set(1 + expressionState.weights.cheekTension * 0.12, 1 + expressionState.weights.browConcern * 0.09, 1);
    applyHumanoidMorphTargetCue(slot, 0.025, "rest", expressionState.weights);
    slot.root.userData.openClinXrSequenceListeningCue = {
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

function listenerEmotionForSequence(activeTurn: PedsActorPlayerRuntimeTurn): HumanoidExpressionEmotion {
  if (activeTurn.emotion === "pain" || activeTurn.emotion === "anxious") {
    return "concerned";
  }
  if (activeTurn.emotion === "reassured") {
    return "reassured";
  }
  return "concerned";
}

function playPedsActorPlayerRuntimeSequence(sequence: PedsActorPlayerRuntimeSequenceEvidence, fallbackTurns: PedsActorPlayerRuntimeTurn[]): void {
  sequence.turns.forEach((turn, stepIndex) => {
    window.setTimeout(() => {
      playPedsActorPlayerRuntimeTurn(turn, {
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

function pedsActorPlayerRuntimeTurns(): PedsActorPlayerRuntimeTurn[] {
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

function recordPedsActorPlayerRuntimePlaybackEvidence(input: {
  scheduled: boolean;
  turns: PedsActorPlayerRuntimeTurn[];
  latestTurnIndex: number;
  latestTurn: PedsActorPlayerRuntimeTurn | null;
  latestTriggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"];
  latestTraceTag: string | null;
  latestSequence: PedsActorPlayerRuntimeSequenceEvidence | null;
  latestSequenceStepIndex: number;
  latestListenerActorIds: string[];
  latestCoupledSignalIds: string[];
}): void {
  const bundleDialogueTurnCount = encounterRuntimeAssetBundle.sceneManifest.dialogueTurns?.length ?? 0;
  window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence = {
    source: "window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence",
    scenarioId: (selectedHumanoidSourceComparator() === "ed_anny_real_garment_patient" ? "ed_chest_pain_priority_v1" : "peds_asthma_parent_anxiety_v1"),
    playbackMode: "local_desktop_preview_from_bundle_dialogue_or_actor_player_samples",
    sourceArtifactPath: "docs/openclinxr/model-vetting-actor-player-runtime-evidence-peds-asthma-parent-anxiety-2026-06-05.json",
    scheduled: input.scheduled,
    actorCount: Array.from(new Set(input.turns.map((turn) => turn.actorId))).length,
    turnCount: input.turns.length,
    bundleDialogueTurnCount,
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
    latestSequenceTurnCount: input.latestSequence?.turns.length ?? 0,
    latestSequenceActorIds: input.latestSequence
      ? Array.from(new Set(input.latestSequence.turns.map((turn) => turn.actorId)))
      : [],
    latestListenerActorIds: input.latestListenerActorIds,
    latestCoupledSignalIds: input.latestCoupledSignalIds,
    activeGeneratedActorSlotCount: generatedHumanoidAnimationSlotsByActorId.size,
    activeHumanoidSpeechEvidenceActorId: window.__openClinXrHumanoidSpeechEvidence?.activeActorId ?? null,
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
  };
}

function hasAuthoredClinicalIdlePoseClip(animationClips: unknown[]): boolean {
  return animationClips.some((clip) =>
    clip instanceof AnimationClip && /clinical|idle|relaxed|conversation|consult/i.test(clip.name)
  );
}

function gazeProbeAnimationClipNamesFromGltf(animationClips: unknown[]): string[] {
  return animationClips
    .filter((clip): clip is AnimationClip => clip instanceof AnimationClip && clip.name.startsWith("openclinxr_mpfb2_eye_look_probe"))
    .map((clip) => clip.name);
}

/**
 * #574: true when this actor's seated role-clip carve-out admitted clips at register
 * time (userData stamped by registerGeneratedHumanoidAnimation). The frame loop holds
 * the standing clinical-idle arm hang for such actors so the clip's upper-body
 * performance is not overwritten every frame.
 */
function seatedRoleClipAutoLoopActive(humanoidRoot: Object3D, actorId: string): boolean {
  void actorId;
  const carveout = humanoidRoot.userData.openClinXrSeatedRoleClipCarveout as
    | { admitted?: boolean }
    | undefined;
  return carveout?.admitted === true;
}

function updateGeneratedHumanoidAnimations(deltaSeconds: number, nowMs: number, camera: PerspectiveCamera, drive?: GeneratedRuntimeDrive | null): void {
  const actorCues: RuntimeHumanoidActingCueEvidence["actorCues"] = [];
  for (const slot of generatedHumanoidAnimationSlots) {
    if (slot.sourceComparatorFreezeEnabled) {
      slot.mouthCue.visible = false;
      slot.gazeCue.visible = false;
      slot.eyeFocusCue.visible = false;
      slot.expressionCue.visible = false;
      slot.root.userData.openClinXrBodyMotionCue = {
        cueIds: ["source_comparator_runtime_pose_freeze_cue"],
        mode: "source_comparator_runtime_pose_updates_disabled",
        intensity: 0,
        notEvidenceFor: "runtime acting, body-motion realism, Quest headset kinematic certification, or production animation quality",
      };
      actorCues.push({
        actorId: slot.actorId,
        role: runtimeActorRole(slot.actorId) ?? null,
        cueIds: slot.root.userData.openClinXrBodyMotionCue.cueIds,
        bodyMotionMode: "source_comparator_runtime_pose_updates_disabled",
      });
      continue;
    }
    slot.mixer?.update(deltaSeconds);
    const isSupineFrame =
      slot.root.userData.openClinXrActorPosture === "supine"
      || slot.actorSlot.userData.openClinXrActorPosture === "supine";
    const isSeatedFrame =
      slot.root.userData.openClinXrActorPosture === "seated"
      || slot.actorSlot.userData.openClinXrActorPosture === "seated";
    // #574: while a seated-rig role clip performs under the carve-out, the standing
    // clinical-idle arm hang would pin arms/head over the clip every frame — hold both.
    // Legs stay owned by applyPosturePose either way.
    const seatedClipPerforming = isSeatedFrame && seatedRoleClipAutoLoopActive(slot.root, slot.actorId);
    // Supine: skip standing clinical-idle arm hang (would fight recumbent limb map).
    if (!isSupineFrame && !seatedClipPerforming) {
      applyGeneratedHumanoidClinicalIdlePosture(slot.root);
      applyGeneratedHumanoidRoleSpecificPosture(slot.root, slot.actorId);
    }
    // #81/#83: re-apply seated pose after mixer/clinical idle so legs stay folded (rotation-only sit).
    // #150: re-apply supine after idle path so arm hang does not undo recumbent limbs.
    // Do not re-plant every frame (would fight baseY); plant once at register, keep baseY.
    if (isSeatedFrame) {
      applyPosturePose(slot.root, "seated");
    }
    if (isSupineFrame) {
      applySupinePoseHoldingIncline(slot.root); // #171 re-tip after flat basis
    }
    const t = (nowMs + slot.phaseOffsetMs) / 1000;
    const breathing = Math.sin(t * 1.15);
    const isSpeaking = slot.activeSpeech !== undefined;
    const dialogueLean = isSpeaking ? -0.035 + Math.sin(t * 2.6) * 0.008 : Math.sin(t * 0.51) * 0.006;
    const emotionalSway = Math.sin(t * 0.43) * 0.012;
    const dialogueWeightShift = isSpeaking ? Math.sin(t * 3.1) * 0.008 : 0;
    const pediatricAsthmaOverlay = pediatricAsthmaActingOverlayForSlot(slot, t, isSpeaking);
    // Live apply from gen drive (loco/gaze/lip from case spec -> replay/drive for peds/ed) to humanoid for posture/loco/gaze/lip-sync/viseme in player (desktop fallback + WebXR). Makes the generated behavior drive actual humanoid motion in launched experience (Q1/2 blueprint->runtime consumption). Fallback to prior procedural if no drive. Smallest wire.
    if (drive && !isSupineFrame) {
      const locomotion = generatedDriveScalar(drive.locomotion);
      if (locomotion !== null) {
        slot.root.position.z = slot.baseZ + locomotion * 0.6;
      }
      const gaze = generatedDriveScalar(drive.gazeAversion ?? drive.gaze);
      if (gaze !== null) applyGazeToHumanoid(slot.root, gaze); // #311: drive the eye bones, not the actor root
      const viseme = generatedDriveScalar(drive.lipSyncViseme ?? drive.lipSync);
      if (viseme !== null) applyGeneratedScalarVisemeToRoot(slot.root, viseme); // #63 named viseme_*
    }
    // baseY includes seated/supine plant. #150: hold plant XZ + root Z (no standing lean/sway).
    if (isSupineFrame) {
      holdSupinePlantFrame(slot.root, {
        x: slot.baseX, y: slot.baseY, z: slot.baseZ,
        scaleX: slot.baseScaleX, scaleY: slot.baseScaleY, scaleZ: slot.baseScaleZ,
      }, breathing);
      reapplySupineHeadToStoredPillow(slot.root); // #171 keep head on raised pillow after hold
    } else {
      slot.root.position.y = slot.baseY + breathing * 0.018;
      slot.root.position.x = emotionalSway + dialogueWeightShift;
      slot.root.rotation.x = dialogueLean + pediatricAsthmaOverlay.rotationX;
      slot.root.rotation.z = Math.sin(t * 0.72) * 0.012 + pediatricAsthmaOverlay.rotationZ;
      slot.root.scale.x = slot.baseScaleX + pediatricAsthmaOverlay.scaleXDelta;
      slot.root.scale.y = slot.baseScaleY + breathing * 0.012 + pediatricAsthmaOverlay.scaleYDelta;
      slot.root.scale.z = slot.baseScaleZ + pediatricAsthmaOverlay.scaleZDelta;
    }
    slot.root.userData.openClinXrBodyMotionCue = {
      cueIds: isSpeaking
        ? [
            "scenario_dialogue_body_lean_cue",
            "idle_breathing_sway_cue",
            "emotion_microstep_weight_shift_cue",
            ...pediatricAsthmaOverlay.cueIds,
          ]
        : ["idle_breathing_sway_cue", ...pediatricAsthmaOverlay.cueIds],
      mode: pediatricAsthmaOverlay.cueIds.length > 0
        ? "scenario_pediatric_respiratory_distress_idle_overlay"
        : isSpeaking ? "scenario_dialogue_body_motion_runtime" : "procedural_idle_body_motion",
      intensity: Number((Math.abs(dialogueLean) + Math.abs(dialogueWeightShift) + Math.abs(breathing) * 0.02 + pediatricAsthmaOverlay.intensity).toFixed(3)),
      notEvidenceFor: "full-body motion-capture realism or Quest headset kinematic certification",
    };
    if (pediatricAsthmaOverlay.gazeTargetActorId) {
      slot.root.userData.openClinXrIdleGazeAlternationCue = {
        targetActorId: pediatricAsthmaOverlay.gazeTargetActorId,
        cueIds: ["pediatric_patient_idle_gaze_alternates_parent_nurse_learner"],
        notEvidenceFor: "production eye tracking or validated clinical communication scoring",
      };
    }
    actorCues.push({
      actorId: slot.actorId,
      role: runtimeActorRole(slot.actorId) ?? null,
      cueIds: slot.root.userData.openClinXrBodyMotionCue.cueIds,
      respiratoryRateCueHz: pediatricAsthmaOverlay.respiratoryRateCueHz,
      gazeAlternationTargetActorId: pediatricAsthmaOverlay.gazeTargetActorId,
      bodyMotionMode: slot.root.userData.openClinXrBodyMotionCue.mode,
    });
    updateHumanoidSpeechCue(slot, nowMs, camera);
  }
  recordRuntimeHumanoidActingCueEvidence(actorCues);
  updateVirtualDeviceActorSpeechPulses(nowMs);
}

/** Capture-gated physics bone apply (#83 split from main for file-size freeze). */
function applyPhysicsBoneTransforms(nowMs: number): void {
  applyPhysicsBoneTransformsImpl({
    enabled: isPhysicsClinicalTouchCapture(),
    nowMs,
    patientSlot: generatedHumanoidAnimationSlots.find((s) => s.actorId === runtimePatientActorId()),
  });
}

function isGeneratedRuntimeDrive(value: unknown): value is GeneratedRuntimeDrive {
  return typeof value === "object" && value !== null;
}

function pediatricAsthmaActingOverlayForSlot(
  slot: GeneratedHumanoidAnimationSlot,
  t: number,
  isSpeaking: boolean,
): {
  cueIds: string[];
  intensity: number;
  rotationX: number;
  rotationZ: number;
  scaleXDelta: number;
  scaleYDelta: number;
  scaleZDelta: number;
  respiratoryRateCueHz?: number | undefined;
  gazeTargetActorId?: string | null | undefined;
} {
  if (!isPediatricAsthmaRuntimeScenario()) {
    return { cueIds: [], intensity: 0, rotationX: 0, rotationZ: 0, scaleXDelta: 0, scaleYDelta: 0, scaleZDelta: 0 };
  }
  if (slot.actorId !== runtimePatientActorId()) {
    return { cueIds: ["scenario_actor_idle_attention_shift_cue"], intensity: 0.01, rotationX: 0, rotationZ: 0, scaleXDelta: 0, scaleYDelta: 0, scaleZDelta: 0 };
  }
  const respiratoryRateCueHz = 0.78;
  const respiratoryPulse = Math.max(0, Math.sin(t * Math.PI * 2 * respiratoryRateCueHz));
  const targetActorId = Math.sin(t * 0.34) > 0 ? runtimeFamilyActorId() : runtimeClinicalTeamActorId();
  return {
    cueIds: [
      "pediatric_asthma_visible_work_of_breathing_idle_cue",
      "pediatric_patient_shoulder_hunch_respiratory_distress_cue",
      "pediatric_patient_idle_gaze_alternates_parent_nurse_learner",
      ...(isSpeaking ? ["pediatric_dialogue_breathing_overlay_preserved_while_speaking"] : []),
    ],
    intensity: Number((0.028 + respiratoryPulse * 0.032).toFixed(3)),
    rotationX: -0.018 - respiratoryPulse * 0.018,
    rotationZ: Math.sin(t * 1.7) * 0.01,
    scaleXDelta: respiratoryPulse * 0.012,
    scaleYDelta: -respiratoryPulse * 0.006,
    scaleZDelta: respiratoryPulse * 0.028,
    respiratoryRateCueHz,
    gazeTargetActorId: targetActorId,
  };
}

function recordRuntimeHumanoidActingCueEvidence(actorCues: RuntimeHumanoidActingCueEvidence["actorCues"]): void {
  window.__openClinXrRuntimeHumanoidActingCueEvidence = {
    source: "window.__openClinXrRuntimeHumanoidActingCueEvidence",
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    actorCount: actorCues.length,
    activeCueIds: Array.from(new Set(actorCues.flatMap((cue) => cue.cueIds))).sort(),
    actorCues,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "animation_quality"],
  };
}

function triggerHumanoidDialogueForTrace(tag: string, text: string): void {
  const actorId = localDialogueActorIdForTraceTag(tag);
  const gazeTarget = localDialogueGazeTargetForTraceTag(tag);
  const runtimeTurn = runtimeDialogueTurnForTraceTag(tag);
  const liveTurn = resolveLiveActorTurnForTrace(tag);
  const emotion = liveTurn?.faceEmotion;
  const caption = liveTurn?.caption ?? text;
  const actorRuntimeRealismRequirement = runtimeTurn?.caseDefinitionRuntimeSignals?.actorRuntimeRealismRequirement;
  if (!actorId) {
    window.__openClinXrHumanoidSpeechEvidence ??= buildHumanoidSpeechEvidence(null, null, null, [], [], null);
    return;
  }
  const emotionSource = liveTurn ? "plan.dialogueEmotionTo" as const : undefined;
  if (liveTurn) {
    window.__openClinXrLiveActorTurnConsumption = liveTurn;
  }
  if (runtimeActorEmbodiment(encounterRuntimeAssetBundle, actorId) === "virtual_device") {
    const emotionContext = scenarioDialogueEmotionContext(actorId, caption, emotion, emotionSource);
    window.__openClinXrHumanoidSpeechEvidence = buildHumanoidSpeechEvidence(
      actorId,
      `virtual_device:${actorId}`,
      caption,
      phonemesForText(caption),
      [],
      gazeTarget,
      emotionContext,
      actorRuntimeRealismRequirement,
    );
    recordBootPhase("virtual_device_dialogue_routed");
    activeVirtualDeviceSpeechByActorId.set(actorId, {
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
      startedAtMs: performance.now(),
      durationMs: humanoidDialogueDurationMs(phonemesForText(caption).length),
    });
    return;
  }
  triggerHumanoidDialogue(actorId, caption, gazeTarget, emotion, actorRuntimeRealismRequirement, emotionSource);
}

type HumanoidDialogueGazeTarget = {
  kind: "learner_camera" | "actor";
  actorId: string | null;
};

function triggerHumanoidDialogue(
  actorId: string,
  text: string,
  gazeTarget: HumanoidDialogueGazeTarget,
  explicitEmotion?: HumanoidExpressionEmotion,
  actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
  emotionSource?: HumanoidDialogueEmotionContext["source"],
): void {
  const slot = generatedHumanoidAnimationSlotsByActorId.get(actorId);
  const phonemeSequence = phonemesForText(text);
  const visemeSequence = visemesForText(text);
  const emotionContext = scenarioDialogueEmotionContext(actorId, text, explicitEmotion, emotionSource);
  const emotion = emotionContext.emotion;
  if (!slot) {
    window.__openClinXrHumanoidSpeechEvidence = buildHumanoidSpeechEvidence(
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
    actorRuntimeRealismRequirement,
    phonemeSequence,
    visemeSequence,
    startedAtMs: performance.now(),
    durationMs: humanoidDialogueDurationMs(phonemeSequence.length),
  };
  startHumanoidEmotionTransition(slot, emotion, performance.now());
  // #722 baked lip-sync join: when this line has a served cue file (content-hash named, like the
  // bake), drive the wire with the bake's real Rhubarb timing; absent cues keep the text-derived timeline.
  attachBakedCuesToSpeech(slot, text, selectedScenarioId());
  slot.root.userData.openClinXrDialoguePhonemeMapping = {
    actorId,
    phonemeSequence,
    visemeSequence,
    gazeTargetKind: gazeTarget.kind,
    gazeTargetActorId: gazeTarget.actorId,
    mappingMode: "deterministic_text_phoneme_viseme_runtime_cue",
  };
  window.__openClinXrHumanoidSpeechEvidence = buildHumanoidSpeechEvidence(
    actorId,
    slot.assetId,
    text,
    phonemeSequence,
    visemeSequence,
    gazeTarget,
    emotionContext,
    actorRuntimeRealismRequirement,
  );
  recordBootPhase("humanoid_dialogue_phoneme_mapping_started");
}

function humanoidDialogueDurationMs(phonemeCount: number): number {
  const baseDurationMs = Math.max(900, Math.min(4800, phonemeCount * 90));
  return isHumanoidMouthGazePoseReviewCaptureMode() ? Math.max(baseDurationMs, 45_000) : baseDurationMs;
}

function updateHumanoidSpeechCue(slot: GeneratedHumanoidAnimationSlot, nowMs: number, camera: PerspectiveCamera): void {
  const speech = slot.activeSpeech;
  if (!speech) {
    slot.mouthCue.visible = false;
    slot.gazeCue.visible = false;
    slot.eyeFocusCue.visible = false;
    slot.expressionCue.visible = false;
    slot.expressionCue.scale.set(1, 1, 1);
    resetHumanoidFaceRigControls(slot);
    (slot as any)._liveAffectRamp = undefined;
    startHumanoidEmotionTransition(slot, "neutral", nowMs);
    applyHumanoidMorphTargetCue(slot, 0, "rest", updateHumanoidEmotionExpression(slot, nowMs).weights);
    slot.root.rotation.y += normalizeAngle(slot.baseRotationY - slot.root.rotation.y) * 0.08;
    return;
  }
  if (shouldUseCleanHumanoidSourceComparatorCapture()) {
    slot.mouthCue.visible = false;
    slot.gazeCue.visible = false;
    slot.eyeFocusCue.visible = false;
    slot.expressionCue.visible = false;
    slot.expressionCue.scale.set(1, 1, 1);
    return;
  }
  const progress = (nowMs - speech.startedAtMs) / speech.durationMs;
  if (progress >= 1) {
    slot.activeSpeech = undefined;
    slot.mouthCue.visible = false;
    slot.gazeCue.visible = false;
    slot.eyeFocusCue.visible = false;
    slot.expressionCue.visible = false;
    slot.expressionCue.scale.set(1, 1, 1);
    resetHumanoidFaceRigControls(slot);
    (slot as any)._liveAffectRamp = undefined;
    startHumanoidEmotionTransition(slot, "neutral", nowMs);
    applyHumanoidMorphTargetCue(slot, 0, "rest", updateHumanoidEmotionExpression(slot, nowMs).weights);
    return;
  }
  // Live bind: dialogueTurns + adaptive policy + affectTimeline → lipsync/emotion.
  // Peds adaptive: timed emotion ramp + viseme/emotion weights into effWeights (timeline or pre-bake).
  let viseme = "rest";
  let openness = 0.35;
  let activeDialogueTurnRef: any ;
  let liveSource: "live_blueprint_dialogue_emotion_source" | undefined ;
  if (encounterRuntimeAssetBundle?.scenarioId === "peds_asthma_parent_anxiety_v1" && speech.actorId) {
    const bundleTurns = pedsActorPlayerBundleDialogueTurns();
    const matchingTurn = bundleTurns.find((t: any) => t.actorId === speech.actorId);
    const rtTurn = matchingTurn ? runtimeDialogueTurnForTraceTag(matchingTurn.cue) : undefined;
    if (matchingTurn && rtTurn) {
      try {
        // live from turn metadata (bundle dialogueTurn + full affectTimeline + peds policy emotion) using local viseme/phoneme fns
        // (mirrors @openclinxr/model-vetting viseme-timeline + emotion-transition helpers; import not safe in ui-xr browser runtime)
        const ttext = matchingTurn.text || speech.text;
        const phon = phonemesForText(ttext);
        const vseq = visemesForText(ttext);
        const p = Math.min(1, Math.max(0, progress));
        const lidx = Math.min(vseq.length - 1, Math.max(0, Math.floor(p * vseq.length)));
        viseme = vseq[lidx] ?? "rest";
        openness = visemeOpenness(viseme) * (0.65 + Math.sin(nowMs / 58) * 0.18);
        const timeline = (rtTurn as any).affectTimeline ?? (matchingTurn as any).affectTimeline;
        const liveTurn = resolveLiveActorTurnForTrace(matchingTurn.cue);
        const turnEmotion = liveTurn?.faceEmotion ?? speech.emotion;
        const bundleAffectEmotion = timeline?.emotion
          ? normalizePedsActorPlayerEmotion(String(timeline.emotion))
          : speech.emotion;
        const elapsedMs = nowMs - speech.startedAtMs;
        const rampIntensity = computeAffectRampIntensity(elapsedMs, speech.durationMs, timeline);
        (slot as any)._liveAffectRamp = timeline ? {
          emotion: turnEmotion,
          intensity: Number(rampIntensity.toFixed(3)),
          onsetMs: timeline.onsetMs,
          transitionMs: timeline.transitionMs,
          decayMs: timeline.decayMs,
          sourceIntensity: timeline.intensity,
        } : undefined;
        activeDialogueTurnRef = {
          traceTag: matchingTurn.cue,
          turnId: (matchingTurn as any).turnId,
          source: "bundle_dialogue_turn",
          affectTimelineEmotion: bundleAffectEmotion,
          affectTimeline: timeline ? {
            emotion: timeline.emotion,
            intensity: timeline.intensity,
            onsetMs: timeline.onsetMs,
            transitionMs: timeline.transitionMs,
            decayMs: timeline.decayMs,
            liveRampIntensity: Number(rampIntensity.toFixed(3)),
          } : null,
        };
        liveSource = "live_blueprint_dialogue_emotion_source";
      } catch {
        (slot as any)._liveAffectRamp = undefined;
        // pre-bake fallback
      }
    }
  }
  if (viseme === "rest" && openness === 0.35 && speech.visemeSequence && speech.visemeSequence.length) {
    // pre-bake fallback path (when no live turn applied)
    const index = Math.min(speech.visemeSequence.length - 1, Math.max(0, Math.floor(progress * speech.visemeSequence.length)));
    viseme = speech.visemeSequence[index] ?? "rest";
    openness = visemeOpenness(viseme) * (0.65 + Math.sin(nowMs / 58) * 0.18);
  }
  slot.mouthCue.visible = true;
  slot.mouthCue.scale.set(1 + openness * 1.4, 1 + openness * 3.6, 1);
  const expressionState = updateHumanoidEmotionExpression(slot, nowMs);
  // Timeline-driven affect ramp from bundle turn onset/transition/decayMs.
  // to drive scaled peak weights via expressionWeightsForEmotion + light blend with transitioned state into effWeights for rig/morph.
  const ramp = (slot as any)._liveAffectRamp;
  let effWeights = expressionState.weights;
  if (ramp && ramp.intensity > 0.01) {
    const peakW = expressionWeightsForEmotion(ramp.emotion || expressionState.targetEmotion);
    const i = ramp.intensity;
    effWeights = {
      mouthOpen: Math.min(0.95, peakW.mouthOpen * i * 0.85 + expressionState.weights.mouthOpen * 0.15),
      browConcern: Math.min(0.95, peakW.browConcern * i * 0.85 + expressionState.weights.browConcern * 0.15),
      cheekTension: Math.min(0.95, peakW.cheekTension * i * 0.85 + expressionState.weights.cheekTension * 0.15),
    };
  }
  slot.expressionCue.visible = true;
  slot.expressionCue.scale.set(1 + effWeights.cheekTension * 0.22, 1 + effWeights.browConcern * 0.16, 1);
  slot.expressionCue.position.y = -openness * 0.012 + effWeights.browConcern * 0.012;
  slot.root.userData.openClinXrRuntimeExpressionCue = {
    expressionSource: liveSource ? "live_blueprint_dialogue_emotion_source" : "scenario_dialogue_viseme_gaze_runtime",
    currentViseme: viseme,
    currentEmotion: expressionState.currentEmotion,
    targetEmotion: expressionState.targetEmotion,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionTransitionMs: Number(Math.max(0, nowMs - expressionState.transitionStartedAtMs).toFixed(0)),
    expressionWeights: roundHumanoidExpressionWeights(effWeights),
    cueIds: [
      "visible_runtime_mouth_shape_cue",
      "visible_runtime_eye_focus_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "emotion_aligned_expression_transition_cue",
    ],
  };
  slot.mouthCue.userData.openClinXrCurrentPhoneme = speech.phonemeSequence[0] ?? "sil";
  slot.mouthCue.userData.openClinXrCurrentViseme = viseme;
  const eyeMotion = computeHumanoidEyeMotionMetrics(speech, nowMs);
  applyHumanoidFaceRigControls(slot, openness, viseme, speech, camera, eyeMotion, effWeights);
  window.__openClinXrHumanoidSpeechEvidence = {
    ...(window.__openClinXrHumanoidSpeechEvidence ??
      buildHumanoidSpeechEvidence(
        speech.actorId,
        speech.assetId,
        speech.text,
        speech.phonemeSequence,
        speech.visemeSequence,
        { kind: speech.gazeTargetKind, actorId: speech.gazeTargetActorId },
        speech.emotionContext,
        speech.actorRuntimeRealismRequirement,
      )),
    activePhoneme: speech.phonemeSequence[0] ?? "sil",
    activeViseme: viseme,
    activeMouthOpenness: Number(openness.toFixed(3)),
    activeEyeBlinkIntensity: eyeMotion.blinkIntensity,
    activeEyeMicroSaccadeYaw: eyeMotion.microSaccadeYaw,
    activeEyeMicroSaccadePitch: eyeMotion.microSaccadePitch,
    activeEmotionState: expressionState.targetEmotion,
    emotionSource: speech.emotionContext.source,
    scenarioBaselineMood: speech.emotionContext.baselineMood,
    scenarioEmotionCueIds: speech.emotionContext.cueIds,
    activeActorRuntimeRealismRequirement: speech.actorRuntimeRealismRequirement,
    activeExpressionTransitionMs: Number(Math.max(0, nowMs - expressionState.transitionStartedAtMs).toFixed(0)),
    activeExpressionWeights: roundHumanoidExpressionWeights(effWeights),
    activeExpressionCueIds: [
      "visible_runtime_mouth_shape_cue",
      "visible_runtime_eye_focus_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "emotion_aligned_expression_transition_cue",
      "dialogue_eye_micro_saccade_blink_cue",
      "generated_eyelid_blink_control_cue",
    ],
    activeBodyMotionCueIds: [
      "scenario_dialogue_body_lean_cue",
      "idle_breathing_sway_cue",
      "emotion_microstep_weight_shift_cue",
    ],
    activeBodyMotionIntensity: Number((openness + 0.18).toFixed(3)),
    activeBodyMotionMode: "scenario_dialogue_body_motion_runtime",
    activeDialogueTurnRef,
    liveSource,
  };
  recordMouthGazePoseComparatorEvidence(slot, speech, viseme, openness, expressionState, nowMs);
  updateHumanoidGazeCue(slot, speech, camera);
}

function recordMouthGazePoseComparatorEvidence(
  slot: GeneratedHumanoidAnimationSlot,
  speech: HumanoidSpeechPlayback,
  viseme: string,
  openness: number,
  expressionState: HumanoidEmotionExpressionState,
  nowMs: number,
): void {
  if (!isHumanoidMouthGazePoseReviewCaptureMode()) {
    return;
  }
  const comparator = selectedHumanoidSourceComparator();
  const isPedsRealGarmentOrSchoolForEvidence = comparator === "peds_anny_school_age_mpfb2_eye_patient" || comparator === "peds_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse" || comparator === "ed_anny_real_garment_patient";
  // parent/nurse: evidence primary is patient slot (role GLB resolved onto camera-centered primary)
  const evidencePrimaryActorId = runtimePatientActorId();
  if (!isPedsRealGarmentOrSchoolForEvidence || speech.actorId !== evidencePrimaryActorId) {
    return;
  }
  const morphCue = slot.root.userData.openClinXrMorphTargetRuntimeCue as {
    appliedTargetCount?: number;
  } | undefined;
  const liveTurnForMouth = (window.__openClinXrHumanoidSpeechEvidence as any)?.activeDialogueTurnRef;
  const liveSrcForMouth = (window.__openClinXrHumanoidSpeechEvidence as any)?.liveSource;
  let garmentGeometry: MouthGazePoseComparatorEvidence["garmentGeometry"] = null;
  if (comparator === "peds_anny_real_garment_patient" || comparator === "ed_anny_real_garment_patient" || comparator === "peds_anny_real_garment_parent" || comparator === "peds_anny_real_garment_nurse") {
    const tagged = applyRealGarmentEvidenceSurfaces(slot.root, comparator);
    if (tagged) {
      // #314: derive source/cue from the ACTUAL loaded asset (set at compose) so the
      // parent/nurse comparators do not label the child primary's tshirt as the cardigan.
      const loadedAssetPath =
        typeof slot.root.userData.openClinXrAssetPath === "string" ? slot.root.userData.openClinXrAssetPath : "";
      const garmentSource =
        loadedAssetPath
        || (comparator === "ed_anny_real_garment_patient"
          ? "/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb"
          : comparator === "peds_anny_real_garment_parent"
            ? "/generated-humanoids/peds_anxious_parent.glb"
            : comparator === "peds_anny_real_garment_nurse"
              ? "/generated-humanoids/peds_nurse_kevin.glb"
              : "/cagematch/anny-real-garment/current/peds_patient_child_real_garment.glb");
      const sleeveDeformCue = sleeveDeformCueForAssetPath(loadedAssetPath, comparator);
      garmentGeometry = {
        name: tagged.name || "real_garment_mesh",
        visible: tagged.visible,
        source: garmentSource,
        hasVisibleVolume: true,
        hasSeamFoldHints: true,
        sleeveDeform: sleeveDeformCue,
      };
    }
  }
  window.__openClinXrMouthGazePoseComparatorEvidence = {
    source: "window.__openClinXrMouthGazePoseComparatorEvidence",
    captureMode: selectedCaptureMode(),
    comparator,
    scenarioId: comparator === "ed_anny_real_garment_patient" ? "ed_chest_pain_priority_v2" : "peds_asthma_parent_anxiety_v1",
    actorId: speech.actorId,
    dialogueText: speech.text,
    traceTag: "work_of_breathing_assessment",
    activeViseme: viseme,
    activeMouthOpenness: Number(openness.toFixed(3)),
    activeEmotionState: expressionState.targetEmotion,
    activeExpressionTransitionMs: Number(Math.max(0, nowMs - expressionState.transitionStartedAtMs).toFixed(0)),
    activeExpressionWeights: roundHumanoidExpressionWeights(expressionState.weights),
    gazeProbePlayback: typeof slot.root.userData.openClinXrAnimationPlayback === "string"
      && slot.activeGazeProbeAnimationClipName
      ? "gltf_gaze_probe_clip_playing"
      : null,
    activeGazeProbeAnimationClipName: slot.activeGazeProbeAnimationClipName ?? null,
    morphTargetAppliedTargetCount: morphCue?.appliedTargetCount ?? 0,
    morphTargetPlaybackMode: "glb_morph_target_timeline_from_bundle_dialogue_with_emotion_transition",
    emotionTransitionCuePresent: Boolean(slot.root.userData.openClinXrEmotionExpressionTransitionCue),
    visemeTimelineComparatorEvidencePresent: Boolean(slot.root.userData.openClinXrVisemeTimelineComparatorEvidence),
    activeDialogueTurnRef: liveTurnForMouth,
    liveSource: liveSrcForMouth,
    garmentGeometry,
    notEvidenceFor: [
      "production phoneme timing",
      "validated facial animation",
      "clinical affect scoring",
      "b_plus_visual_realism_gate",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
    ],
  };
  // Real-garment traverse: garmentLayers meshes, frustum off, cyan, sleeveDeform userData.
}

function applyHumanoidFaceRigControls(
  slot: GeneratedHumanoidAnimationSlot,
  openness: number,
  viseme: string,
  speech: HumanoidSpeechPlayback,
  camera: PerspectiveCamera,
  eyeMotion: HumanoidEyeMotionMetrics,
  expressionWeights: HumanoidExpressionWeights,
): void {
  const upperLip = slot.root.getObjectByName("openclinxr_upper_lip_sync_control");
  const lowerLip = slot.root.getObjectByName("openclinxr_lower_lip_sync_control");
  const leftEye = slot.root.getObjectByName("openclinxr_left_eye_gaze_control");
  const rightEye = slot.root.getObjectByName("openclinxr_right_eye_gaze_control");
  const leftUpperEyelid = slot.root.getObjectByName("openclinxr_left_upper_eyelid_blink_control");
  const rightUpperEyelid = slot.root.getObjectByName("openclinxr_right_upper_eyelid_blink_control");

  offsetRigControl(upperLip, 0, openness * 0.006, openness * 0.004);
  offsetRigControl(lowerLip, 0, -openness * 0.024, openness * 0.01);
  applyHumanoidMorphTargetCue(slot, openness, viseme, expressionWeights);

  const gazeOrigin = new Vector3(0, 1.57, 0.29);
  const targetWorld = resolveHumanoidGazeTargetWorld(speech, camera);
  const targetLocal = slot.root.worldToLocal(targetWorld.clone());
  const offset = targetLocal.sub(gazeOrigin).clampLength(0.35, 1.15);
  const horizontal = Math.max(0.001, Math.hypot(offset.x, offset.z));
  const yaw = Math.atan2(offset.x, -offset.z) * 0.35;
  const pitch = -Math.atan2(offset.y, horizontal) * 0.28;
  const { blinkIntensity, microSaccadeYaw, microSaccadePitch } = eyeMotion;
  rotateRigControl(leftEye, pitch + microSaccadePitch, yaw + microSaccadeYaw, 0);
  rotateRigControl(rightEye, pitch + microSaccadePitch * 0.92, yaw + microSaccadeYaw * 0.9, 0);
  scaleRigControl(leftEye, 1, 1 - blinkIntensity * 0.72, 1 + blinkIntensity * 0.08);
  scaleRigControl(rightEye, 1, 1 - blinkIntensity * 0.72, 1 + blinkIntensity * 0.08);
  offsetRigControl(leftUpperEyelid, 0, -blinkIntensity * 0.002, -blinkIntensity * 0.012);
  offsetRigControl(rightUpperEyelid, 0, -blinkIntensity * 0.002, -blinkIntensity * 0.012);
  scaleRigControl(leftUpperEyelid, 1, 1 + blinkIntensity * 1.8, 1);
  scaleRigControl(rightUpperEyelid, 1, 1 + blinkIntensity * 1.8, 1);
  applyBlinkClosureToRoot(slot.root, blinkIntensity);

  slot.root.userData.openClinXrFaceRigRuntimeCue = {
    currentViseme: viseme,
    currentEmotion: speech.emotion,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionWeights: roundHumanoidExpressionWeights(expressionWeights),
    activeControlNames: [
      "openclinxr_upper_lip_sync_control",
      "openclinxr_lower_lip_sync_control",
      "openclinxr_left_eye_gaze_control",
      "openclinxr_right_eye_gaze_control",
      "openclinxr_left_upper_eyelid_blink_control",
      "openclinxr_right_upper_eyelid_blink_control",
    ],
    blinkIntensity: Number(blinkIntensity.toFixed(3)),
    microSaccadeYaw: Number(microSaccadeYaw.toFixed(3)),
    microSaccadePitch: Number(microSaccadePitch.toFixed(3)),
    cueIds: ["dialogue_viseme_and_gaze_mapping", "face_lip_eye_rig_contract_cue", "dialogue_eye_micro_saccade_blink_cue", "generated_eyelid_blink_control_cue", "emotion_aligned_expression_transition_cue"],
    notEvidenceFor: "production facial animation quality or validated phoneme timing",
  };
}

type HumanoidEyeMotionMetrics = {
  blinkIntensity: number;
  microSaccadeYaw: number;
  microSaccadePitch: number;
};

function computeHumanoidEyeMotionMetrics(speech: HumanoidSpeechPlayback, nowMs: number): HumanoidEyeMotionMetrics {
  const elapsedMs = Math.max(0, nowMs - speech.startedAtMs);
  const microSaccadeYaw = Math.sin(elapsedMs / 173) * 0.018 + Math.sin(elapsedMs / 421) * 0.011;
  const microSaccadePitch = Math.sin(elapsedMs / 229) * 0.012;
  const blinkPhase = elapsedMs % 4300;
  const blinkWindow = blinkPhase > 3940 && blinkPhase < 4140 ? (blinkPhase - 3940) / 200 : 0;
  const blinkIntensity = blinkWindow > 0 ? Math.sin(Math.PI * blinkWindow) : 0;
  return {
    blinkIntensity: Number(blinkIntensity.toFixed(3)),
    microSaccadeYaw: Number(microSaccadeYaw.toFixed(3)),
    microSaccadePitch: Number(microSaccadePitch.toFixed(3)),
  };
}

function createHumanoidEmotionExpressionState(): HumanoidEmotionExpressionState {
  const weights = expressionWeightsForEmotion("neutral");
  return {
    currentEmotion: "neutral",
    targetEmotion: "neutral",
    weights: { ...weights },
    targetWeights: { ...weights },
    transitionStartedAtMs: performance.now(),
    transitionDurationMs: 850,
  };
}

function startHumanoidEmotionTransition(slot: GeneratedHumanoidAnimationSlot, emotion: HumanoidExpressionEmotion, nowMs: number): void {
  if (slot.emotionExpression.targetEmotion === emotion) {
    return;
  }
  slot.emotionExpression.currentEmotion = slot.emotionExpression.targetEmotion;
  slot.emotionExpression.targetEmotion = emotion;
  slot.emotionExpression.targetWeights = expressionWeightsForEmotion(emotion);
  slot.emotionExpression.transitionStartedAtMs = nowMs;
  slot.emotionExpression.transitionDurationMs = emotion === "pain" || emotion === "anxious" ? 650 : 950;
}

function updateHumanoidEmotionExpression(slot: GeneratedHumanoidAnimationSlot, nowMs: number): HumanoidEmotionExpressionState {
  const state = slot.emotionExpression;
  const progress = Math.min(1, Math.max(0, (nowMs - state.transitionStartedAtMs) / state.transitionDurationMs));
  const eased = progress * progress * (3 - 2 * progress);
  state.weights = {
    mouthOpen: lerp(state.weights.mouthOpen, state.targetWeights.mouthOpen, eased * 0.34),
    browConcern: lerp(state.weights.browConcern, state.targetWeights.browConcern, eased * 0.34),
    cheekTension: lerp(state.weights.cheekTension, state.targetWeights.cheekTension, eased * 0.34),
  };
  slot.root.userData.openClinXrEmotionExpressionTransitionCue = {
    currentEmotion: state.currentEmotion,
    targetEmotion: state.targetEmotion,
    transitionProgress: Number(progress.toFixed(3)),
    transitionDurationMs: state.transitionDurationMs,
    weights: roundHumanoidExpressionWeights(state.weights),
    cueIds: ["emotion_aligned_expression_transition_cue", "visible_runtime_eyebrow_jaw_cheek_cue"],
    notEvidenceFor: "validated affect recognition, clinical scoring, or production facial animation quality",
  };
  return state;
}

function rememberLiveActorTurnFromPayload(
  tag: string,
  payload?: Record<string, unknown>,
): LiveActorTurnConsumption | undefined {
  const parsed = liveActorTurnFromPayload(payload);
  if (!parsed) {
    return resolveLiveActorTurnForTrace(tag);
  }
  const consumed = consumeLiveActorTurn(parsed.plan, parsed.execution);
  registerLiveActorTurn(consumed.plan, consumed.execution, tag);
  window.__openClinXrLiveActorTurnConsumption = consumed;
  return consumed;
}

function scenarioDialogueEmotionContext(
  actorId: string,
  _text: string,
  explicitEmotion?: HumanoidExpressionEmotion,
  emotionSource?: HumanoidDialogueEmotionContext["source"],
): HumanoidDialogueEmotionContext {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === encounterRuntimeAssetBundle.scenarioId)
    ?? scenarioBank.find((candidate) => candidate.scenarioId === selectedScenarioId())
    ?? edChestPainScenario;
  const actor = scenario.actors.find((candidate) => candidate.actorId === actorId);
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
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, alpha));
}

function roundHumanoidExpressionWeights(weights: HumanoidExpressionWeights): HumanoidExpressionWeights {
  return {
    mouthOpen: Number(weights.mouthOpen.toFixed(3)),
    browConcern: Number(weights.browConcern.toFixed(3)),
    cheekTension: Number(weights.cheekTension.toFixed(3)),
  };
}

function resetHumanoidFaceRigControls(slot: GeneratedHumanoidAnimationSlot): void {
  offsetRigControl(slot.root.getObjectByName("openclinxr_upper_lip_sync_control"), 0, 0, 0);
  offsetRigControl(slot.root.getObjectByName("openclinxr_lower_lip_sync_control"), 0, 0, 0);
  for (const controlName of ["openclinxr_left_eye_gaze_control", "openclinxr_right_eye_gaze_control"]) {
    const control = slot.root.getObjectByName(controlName);
    rotateRigControl(control, 0, 0, 0);
    scaleRigControl(control, 1, 1, 1);
  }
  for (const controlName of ["openclinxr_left_upper_eyelid_blink_control", "openclinxr_right_upper_eyelid_blink_control"]) {
    const control = slot.root.getObjectByName(controlName);
    offsetRigControl(control, 0, 0, 0);
    scaleRigControl(control, 1, 1, 1);
  }
}

function applyHumanoidMorphTargetCue(
  slot: GeneratedHumanoidAnimationSlot,
  openness: number,
  viseme: string,
  expressionWeights: HumanoidExpressionWeights,
): void {
  let applied = 0;
  // #730: runtime's own alias resolution, recorded for the capture's mouth-open-channel.json.
  const resolvedTargets: Record<string, string | null> = { openclinxr_mouth_open: null, openclinxr_brow_concern: null, openclinxr_cheek_tension: null };
  slot.root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.morphTargetDictionary || !object.morphTargetInfluences) {
      return;
    }
    collectResolvedMorphTargets(object.morphTargetDictionary, resolvedTargets);
    const mouthOpenIndex = resolveMorphIndex(object.morphTargetDictionary, "openclinxr_mouth_open");
    const browConcernIndex = resolveMorphIndex(object.morphTargetDictionary, "openclinxr_brow_concern");
    const cheekTensionIndex = resolveMorphIndex(object.morphTargetDictionary, "openclinxr_cheek_tension");
    if (typeof mouthOpenIndex === "number") {
      // #730: bound the openness write by the viseme channel's graded cap (bypassed at 0.95).
      object.morphTargetInfluences[mouthOpenIndex] = Math.min(MOUTH_OPEN_CAP, Math.max(0, openness + expressionWeights.mouthOpen * 0.18));
      applied++;
    }
    if (typeof browConcernIndex === "number") {
      object.morphTargetInfluences[browConcernIndex] = Math.min(0.95, Math.max(0, expressionWeights.browConcern + (viseme === "rest" ? 0 : 0.05)));
      applied++;
    }
    if (typeof cheekTensionIndex === "number") {
      object.morphTargetInfluences[cheekTensionIndex] = Math.min(0.95, Math.max(0, expressionWeights.cheekTension + openness * 0.22));
      applied++;
    }
  });
  // #63 vertical: phonemes → driveVisemeTimeline → applyVisemeWeights (named viseme_*, not index 0)
  const named = applyNamedSpeechVisemes(slot, performance.now());
  if (named.activeTargetName) applied += 1;
  slot.root.userData.openClinXrMorphTargetRuntimeCue = {
    currentViseme: named.activeTargetName ?? viseme,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionWeights: roundHumanoidExpressionWeights(expressionWeights),
    appliedTargetCount: applied,
    // #730: the runtime's own resolution of the canonical names onto the live dictionaries —
    // recorded for the viseme-drive capture's mouth-open-channel.json known-good.
    resolvedTargets,
    targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension", ...(named.activeTargetName ? [named.activeTargetName] : [])],
    cueIds: ["dialogue_viseme_and_gaze_mapping", "visible_runtime_mouth_shape_cue", "emotion_aligned_expression_transition_cue", "named_viseme_morph_drive"],
    notEvidenceFor: "production phoneme timing, validated facial animation, or clinical affect scoring",
  };
}

function offsetRigControl(control: ReturnType<Group["getObjectByName"]>, x: number, y: number, z: number): void {
  if (!control) {
    return;
  }
  const base = ensureRigControlBase(control);
  control.position.set(base.position.x + x, base.position.y + y, base.position.z + z);
}

function rotateRigControl(control: ReturnType<Group["getObjectByName"]>, x: number, y: number, z: number): void {
  if (!control) {
    return;
  }
  const base = ensureRigControlBase(control);
  control.rotation.set(base.rotation.x + x, base.rotation.y + y, base.rotation.z + z);
}

function scaleRigControl(control: ReturnType<Group["getObjectByName"]>, x: number, y: number, z: number): void {
  if (!control) {
    return;
  }
  const base = ensureRigControlBase(control);
  control.scale.set(base.scale.x * x, base.scale.y * y, base.scale.z * z);
}

function ensureRigControlBase(control: NonNullable<ReturnType<Group["getObjectByName"]>>): {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
} {
  const existing = control.userData.openClinXrRigControlBaseTransform;
  if (
    existing
    && typeof existing === "object"
    && "position" in existing
    && "rotation" in existing
    && "scale" in existing
  ) {
    return existing as {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
      scale: { x: number; y: number; z: number };
    };
  }
  const base = {
    position: { x: control.position.x, y: control.position.y, z: control.position.z },
    rotation: { x: control.rotation.x, y: control.rotation.y, z: control.rotation.z },
    scale: { x: control.scale.x, y: control.scale.y, z: control.scale.z },
  };
  control.userData.openClinXrRigControlBaseTransform = base;
  return base;
}

function updateVirtualDeviceActorSpeechPulses(nowMs: number): void {
  for (const [actorId, speech] of activeVirtualDeviceSpeechByActorId) {
    const device = virtualDeviceActorSlotsByActorId.get(actorId);
    if (!device) {
      activeVirtualDeviceSpeechByActorId.delete(actorId);
      continue;
    }
    const progress = (nowMs - speech.startedAtMs) / speech.durationMs;
    if (progress >= 1) {
      device.scale.setScalar(1);
      device.userData.openClinXrVirtualDeviceSpeechPulse = "idle";
      activeVirtualDeviceSpeechByActorId.delete(actorId);
      continue;
    }
    const pulse = 1 + Math.sin(nowMs / 95) * 0.055;
    device.scale.setScalar(pulse);
    device.userData.openClinXrVirtualDeviceSpeechPulse = "active_non_humanoid_dialogue_pulse";
  }
}

function updateHumanoidGazeCue(
  slot: GeneratedHumanoidAnimationSlot,
  speech: HumanoidSpeechPlayback,
  camera: PerspectiveCamera,
): void {
  const gazeOrigin = new Vector3(0, 1.57, 0.29);
  const targetWorld = resolveHumanoidGazeTargetWorld(speech, camera);
  const targetLocal = slot.root.worldToLocal(targetWorld.clone());
  const boundedTarget = targetLocal.sub(gazeOrigin).clampLength(0.35, 1.15).add(gazeOrigin);
  slot.gazeCue.geometry.setFromPoints([gazeOrigin, boundedTarget]);
  slot.gazeCue.visible = true;
  orientHumanoidEyeFocusCue(slot, gazeOrigin, boundedTarget);
  orientHumanoidTowardGazeTarget(slot, targetWorld);
  slot.gazeCue.userData.openClinXrCurrentGazeTargetKind = speech.gazeTargetKind;
  slot.gazeCue.userData.openClinXrCurrentGazeTargetActorId = speech.gazeTargetActorId;
  slot.eyeFocusCue.userData.openClinXrCurrentGazeTargetKind = speech.gazeTargetKind;
  slot.eyeFocusCue.userData.openClinXrCurrentGazeTargetActorId = speech.gazeTargetActorId;
}

function orientHumanoidEyeFocusCue(slot: GeneratedHumanoidAnimationSlot, gazeOrigin: Vector3, boundedTarget: Vector3): void {
  const offset = boundedTarget.clone().sub(gazeOrigin);
  const horizontal = Math.max(0.001, Math.hypot(offset.x, offset.z));
  slot.eyeFocusCue.visible = true;
  slot.eyeFocusCue.rotation.y = Math.atan2(offset.x, -offset.z);
  slot.eyeFocusCue.rotation.x = -Math.atan2(offset.y, horizontal) * 0.45;
}

function orientHumanoidTowardGazeTarget(slot: GeneratedHumanoidAnimationSlot, targetWorld: Vector3): void {
  const targetInActorSlot = slot.actorSlot.worldToLocal(targetWorld.clone());
  const direction = targetInActorSlot.sub(slot.root.position);
  const desiredYaw = Math.atan2(direction.x, direction.z) + Math.PI;
  const boundedYaw = slot.baseRotationY + clampDialogueFacingYaw(normalizeAngle(desiredYaw - slot.baseRotationY));
  slot.root.rotation.y += normalizeAngle(boundedYaw - slot.root.rotation.y) * 0.14;
  slot.root.userData.openClinXrDialogueFacingCue = "speaking_humanoid_turns_toward_gaze_target";
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clampDialogueFacingYaw(value: number): number {
  return Math.min(0.42, Math.max(-0.42, value));
}

function resolveHumanoidGazeTargetWorld(speech: HumanoidSpeechPlayback, camera: PerspectiveCamera): Vector3 {
  if (speech.gazeTargetKind === "actor" && speech.gazeTargetActorId) {
    const targetActorSlot = generatedHumanoidActorSlotsByActorId.get(speech.gazeTargetActorId);
    if (targetActorSlot) {
      const position = targetActorSlot.getWorldPosition(new Vector3());
      position.y += 1.18;
      return position;
    }
  }
  return camera.getWorldPosition(new Vector3());
}

function buildHumanoidSpeechEvidence(
  actorId: string | null,
  assetId: string | null,
  text: string | null,
  phonemeSequence: string[],
  visemeSequence: string[],
  gazeTarget: HumanoidDialogueGazeTarget | null,
  emotionContext?: HumanoidDialogueEmotionContext,
  actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
): HumanoidSpeechEvidence {
  return {
    source: "local_dialogue_phoneme_viseme_mapping",
    activeActorId: actorId,
    activeAssetId: assetId,
    lastText: text,
    phonemeSequence,
    visemeSequence,
    emotionSource: emotionContext?.source,
    scenarioBaselineMood: emotionContext?.baselineMood,
    scenarioEmotionCueIds: emotionContext?.cueIds,
    activeActorRuntimeRealismRequirement: actorRuntimeRealismRequirement,
    activeActorRealismLaunchBadge: actorRuntimeRealismRequirement
      ? buildRuntimeActorRealismLaunchBadge(actorRuntimeRealismRequirement)
      : undefined,
    gazeTargetKind: gazeTarget?.kind ?? null,
    gazeTargetActorId: gazeTarget?.actorId ?? null,
    notEvidenceFor: [
      "clinical_speech_quality",
      "production_lip_sync",
      "production_eye_tracking",
      "scoring_validity",
    ],
  };
}

function buildRuntimeActorRealismLaunchBadge(
  requirement: NonNullable<HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"]>,
): NonNullable<HumanoidSpeechEvidence["activeActorRealismLaunchBadge"]> {
  return {
    actorId: requirement.actorId,
    actorRole: requirement.role,
    status: "realismBlocked",
    blockers: [
      "actor_specific_humanoid_realism_gate_not_attached",
      "runtime_realism_evidence_not_attached_to_actor_badge",
      "humanoid_visual_qa_evidence_not_attached_to_actor_badge",
    ],
    claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only",
  };
}

function localDialogueActorIdForTraceTag(tag: string): string | undefined {
  const runtimeTurn = runtimeDialogueTurnForTraceTag(tag);
  if (runtimeTurn) return runtimeTurn.actorId;
  const actorIds: Record<string, string | undefined> = {
    history_opqrst: runtimePatientActorId(),
    risk_factor_question: runtimePatientActorId(),
    associated_symptom_question: runtimePatientActorId(),
    vitals_review: runtimeClinicalTeamActorId(),
    ecg_request: runtimeClinicalTeamActorId(),
    urgent_escalation: runtimeFamilyActorId(),
    team_communication: runtimeClinicalTeamActorId(),
    family_communication: runtimeFamilyActorId(),
    empathy_statement: runtimePatientActorId(),
  };
  return actorIds[tag] ?? actorIdForTraceTag(tag, selectedScenarioId());
}

function localDialogueGazeTargetForTraceTag(tag: string): HumanoidDialogueGazeTarget {
  const runtimeTurn = runtimeDialogueTurnForTraceTag(tag);
  if (runtimeTurn) {
    return {
      kind: runtimeTurn.gazeTargetKind,
      actorId: runtimeTurn.gazeTargetActorId,
    };
  }
  const actorTargets: Record<string, string | undefined> = {
    team_communication: runtimeClinicalTeamActorId(),
    family_communication: runtimeFamilyActorId(),
  };
  const actorTarget = actorTargets[tag];
  return actorTarget
    ? { kind: "actor", actorId: actorTarget }
    : { kind: "learner_camera", actorId: null };
}

function visemeOpenness(viseme: string): number {
  const openness: Record<string, number> = {
    rest: 0,
    closed: 0.08,
    teeth: 0.2,
    rounded: 0.34,
    wide: 0.46,
    mid: 0.52,
    open: 0.78,
  };
  return openness[viseme] ?? 0.35;
}

function computeAffectRampIntensity(elapsedMs: number, durationMs: number, timeline: any): number {
  // Timed emotion ramp driven by explicit affectTimeline (onset/transition/decayMs + intensity) from bundle turn.
  // Used for peds_asthma_parent_anxiety_v1 live bundle turns in updateHumanoidSpeechCue.
  // Prefers explicit timeline data; linear ramp-up then hold+decay in final decay window.
  if (!timeline || typeof timeline.intensity !== "number") return 0;
  const peak = Math.max(0, Math.min(1, timeline.intensity));
  const onset = Number(timeline.onsetMs ?? 0);
  const trans = Number(timeline.transitionMs ?? 500);
  const dec = Number(timeline.decayMs ?? 700);
  if (elapsedMs < onset) return 0;
  const rampEnd = onset + trans;
  if (elapsedMs < rampEnd) {
    const t = (elapsedMs - onset) / Math.max(1, trans);
    return peak * Math.min(1, Math.max(0, t));
  }
  const decayStart = Math.max(rampEnd, durationMs - dec);
  if (elapsedMs < decayStart) return peak;
  const d = (elapsedMs - decayStart) / Math.max(1, dec);
  return peak * Math.max(0, 1 - d);
}

function tintGeneratedSceneMaterials(root: Group, tintColor: number, actorId?: string): void {
  const tint = new Color(tintColor);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const surfaceOverride = generatedHumanoidSurfaceMaterialOverride(object, actorId);
    if (surfaceOverride) {
      object.material = surfaceOverride;
      return;
    }
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => tintGeneratedMaterial(material, tint));
      return;
    }
    object.material = tintGeneratedMaterial(object.material, tint);
  });
}

function generatedHumanoidSurfaceMaterialOverride(object: Mesh, actorId?: string): Mesh["material"] | null {
  const actorKey = actorId ?? "";
  if (object.name.includes("anny_surface_scrub")) {
    const color = actorKey.includes("patient_aisha")
      ? 0x527f94
      : actorKey.includes("partner_omar")
        ? 0x6b503d
        : 0x0b6874;
    const material = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 });
    material.userData.openClinXrMaterialPolicy = "runtime_actor_source_variant_clothing_color_without_overlay_mask";
    return material;
  }
  if (object.name.includes("anny_surface_hair")) {
    const color = actorKey.includes("ob_nurse") ? 0x24140d : 0x1d130e;
    const material = new MeshStandardMaterial({ color, roughness: 0.92 });
    material.userData.openClinXrMaterialPolicy = "runtime_actor_source_variant_hair_color_without_overlay_mask";
    return material;
  }
  return null;
}

function tintGeneratedMaterial(material: Mesh["material"], tint: Color): Mesh["material"] {
  if (!(material instanceof MeshStandardMaterial)) {
    return material;
  }
  if (material.name.includes("openclinxr_legacy_blocky_mesh")) {
    const hiddenLegacy = material.clone();
    hiddenLegacy.transparent = true;
    hiddenLegacy.opacity = 0;
    hiddenLegacy.depthWrite = false;
    hiddenLegacy.userData.openClinXrMaterialPolicy =
      "hide_legacy_blocky_review_mesh_in_normal_runtime_so_generated_anny_actor_surface_drives_visual_realism";
    return hiddenLegacy;
  }
  if (material.name.includes("anny_mesh_skin_warm_review")) {
    const skin = material.clone();
    skin.color.setHex(0xd3a184);
    skin.roughness = 0.82;
    skin.metalness = 0;
    skin.userData.openClinXrMaterialPolicy = "runtime_warm_skin_tone_for_generated_anny_humanoid";
    return skin;
  }
  if (material.name.includes("anny_mesh_lip_region_review")) {
    const lips = material.clone();
    lips.color.setHex(0x9f5f57);
    lips.roughness = 0.76;
    lips.metalness = 0;
    lips.userData.openClinXrMaterialPolicy = "runtime_subtle_lip_region_contrast_for_generated_anny_humanoid";
    return lips;
  }
  if (material.name.includes("anny_mesh_nose_mouth_shadow_review")) {
    const shadow = material.clone();
    shadow.color.setHex(0x8f695a);
    shadow.roughness = 0.88;
    shadow.metalness = 0;
    shadow.userData.openClinXrMaterialPolicy = "runtime_subtle_nose_mouth_shadow_for_generated_anny_humanoid";
    return shadow;
  }
  if (material.name.startsWith("anny_") || material.name.includes("review")) {
    const preserved = material.clone();
    preserved.userData.openClinXrMaterialPolicy = "preserve_anny_authored_skin_face_clothing_contrast";
    return preserved;
  }
  const cloned = material.clone();
  cloned.color.lerp(tint, 0.18);
  return cloned;
}

function addPediatricRespiratoryEquipmentCues(slot: Group, equipmentId: string): void {
  if (!isPediatricAsthmaRuntimeScenario()) return;
  const key = equipmentId.toLowerCase();
  const addCue = (mesh: Mesh, cueId: string, localPosition: { x: number; y: number; z: number }, rotationZ = 0): void => {
    mesh.name = `${runtimeSceneObjectPrefix()}.equipment-cue.${cueId}`;
    mesh.position.set(localPosition.x, localPosition.y, localPosition.z);
    mesh.rotation.z = rotationZ;
    slot.add(mesh);
    recordPediatricRespiratoryEquipmentCue(equipmentId, cueId, mesh.name);
  };
  if (/nebulizer|mask/u.test(key)) {
    addCue(
      new Mesh(new BoxGeometry(0.22, 0.12, 0.035), new MeshStandardMaterial({ color: 0xe8f4fb, roughness: 0.5, transparent: true, opacity: 0.82 })),
      "pediatric_nebulizer_mask_readability_cue",
      { x: 0, y: 1.02, z: -0.24 },
    );
    addCue(
      new Mesh(new CylinderGeometry(0.01, 0.01, 0.76, 8), new MeshStandardMaterial({ color: 0xd9efff, roughness: 0.46, transparent: true, opacity: 0.82 })),
      "pediatric_nebulizer_tubing_line_cue",
      { x: -0.22, y: 0.72, z: -0.16 },
      0.94,
    );
  }
  if (/oxygen|wall_port/u.test(key)) {
    addCue(
      new Mesh(new CylinderGeometry(0.05, 0.05, 0.045, 18), new MeshStandardMaterial({ color: 0x92d3f5, roughness: 0.42 })),
      "oxygen_wall_port_round_connector_cue",
      { x: 0.16, y: 1.08, z: -0.18 },
    );
    addCue(
      new Mesh(new CylinderGeometry(0.008, 0.008, 0.9, 8), new MeshStandardMaterial({ color: 0xdaf1ff, roughness: 0.44, transparent: true, opacity: 0.78 })),
      "oxygen_tubing_clear_line_cue",
      { x: -0.16, y: 0.72, z: -0.2 },
      -0.72,
    );
  }
  if (/pulse_ox|oximeter|monitor/u.test(key)) {
    addCue(
      new Mesh(new BoxGeometry(0.12, 0.045, 0.08), new MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 })),
      "pulse_ox_finger_clip_readability_cue",
      { x: -0.18, y: 0.82, z: -0.2 },
    );
    addCue(
      new Mesh(new BoxGeometry(0.18, 0.08, 0.02), new MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.72 })),
      "pulse_ox_spo2_screen_91_cue",
      { x: 0.06, y: 1.08, z: -0.205 },
    );
  }
  if (/stretcher|bed/u.test(key)) {
    addCue(
      new Mesh(new BoxGeometry(0.72, 0.035, 0.03), new MeshStandardMaterial({ color: 0x9fb4c7, roughness: 0.68, transparent: true, opacity: 0.5 })),
      "low_translucent_pediatric_bed_rail_cue",
      { x: 0, y: 0.82, z: -0.24 },
    );
  }
}

function recordPediatricRespiratoryEquipmentCue(equipmentId: string, cueId: string, sceneObjectName: string): void {
  const existing = window.__openClinXrPediatricRespiratoryEquipmentCueEvidence;
  const cues = existing?.cues ?? [];
  if (!cues.some((cue) => cue.equipmentId === equipmentId && cue.cueId === cueId && cue.sceneObjectName === sceneObjectName)) {
    cues.push({ equipmentId, cueId, sceneObjectName });
  }
  window.__openClinXrPediatricRespiratoryEquipmentCueEvidence = {
    source: "window.__openClinXrPediatricRespiratoryEquipmentCueEvidence",
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    cueCount: cues.length,
    cues,
    notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "equipment_asset_readiness"],
  };
}

function resolveEmulatorRuntimeAssetUrl(asset: EncounterRuntimeAsset): string {
  if (asset.kind === "humanoid_model") {
    return resolveLocalHumanoidRuntimeAssetUrl(asset, (a) => resolveRuntimeAssetUrl(a as EncounterRuntimeAsset));
  }
  const blobName = asset.blob.blobName.replace(/^\/+/u, "");
  const fileName = blobName.split("/").at(-1);
  if (!fileName) {
    return resolveRuntimeAssetUrl(asset);
  }
  if (asset.kind === "environment_model") {
    return `/xr-assets/environment/${resolveLocalEnvironmentRuntimeAssetFileName(fileName)}`;
  }
  if (asset.kind === "equipment_model") {
    return `/xr-assets/medical-equipment/${resolveLocalEquipmentRuntimeAssetFileName(fileName)}`;
  }
  return resolveRuntimeAssetUrl(asset);
}

function runtimeGeneratedSceneObjectName(asset: EncounterRuntimeAsset): string {
  return asset.assetId.replace(/[^a-z0-9:_-]+/giu, "-");
}

function loadGeneratedEquipmentIntoSceneSlot(
  sceneSlot: Group,
  options: {
    assetPath: string;
    assetId: string;
    objectName: string;
  },
): void {
  const primitiveFallbackChildren = [...sceneSlot.children];
  const primitiveFallbackVisible = shouldShowPrimitiveAssetFallbacks();
  runtimeEquipmentSlotsByAssetId.set(options.assetId, sceneSlot);
  sceneSlot.userData.openClinXrRuntimeEquipmentAssetId = options.assetId;
  addPediatricRespiratoryEquipmentCues(sceneSlot, options.assetId);
  for (const child of primitiveFallbackChildren) {
    child.visible = primitiveFallbackVisible;
    if (!primitiveFallbackVisible) {
      child.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_fallback_debug_capture";
    }
  }
  const equipmentLoader = new GLTFLoader();
  recordSceneAssetStatus({
    assetId: options.assetId,
    assetPath: options.assetPath,
    sceneObjectName: options.objectName,
    status: "pending",
    fallbackActive: primitiveFallbackVisible,
  });
  equipmentLoader.load(
    options.assetPath,
    (gltf) => {
      const equipment = gltf.scene;
      equipment.name = options.objectName;
      equipment.userData.openClinXrAffordances = ["selectable_equipment_reference", "clinical_workflow_cue"];
      equipment.add(createAffordanceMarker(`${options.objectName}:equipment_reference`, 0x35d39b));
      if (shouldSuppressGeneratedEquipmentModel(options.assetId, options.assetPath)) {
        recordSceneAssetStatus({
          assetId: options.assetId,
          assetPath: options.assetPath,
          sceneObjectName: options.objectName,
          status: "loaded",
          fallbackActive: true,
          affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
            "case_definition_equipment_loaded_from_runtime_bundle",
            "mismatched_placeholder_equipment_glb_suppressed",
            "semantic_pediatric_equipment_cues_visible",
          ]),
          animationPlayback: "not_applicable",
        });
        recordBootPhase("generated_equipment_placeholder_suppressed");
        return;
      }
      for (const child of primitiveFallbackChildren) {
        child.visible = false;
      }
      sceneSlot.add(normalizeGltfEquipmentMount(equipment, sceneSlot));
      sceneSlot.userData.openClinXrEquipmentSource = "gltf";
      if (window.__openClinXrEnvironmentStateEvidence) {
        applyRuntimeEquipmentTraceVisuals(window.__openClinXrEnvironmentStateEvidence);
      }
      refreshDeclaredEquipmentMountEvidenceFromScene();
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "loaded",
        fallbackActive: false,
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "selectable_equipment_reference",
          "clinical_workflow_cue",
        ]),
        animationPlayback: "not_applicable",
      });
      recordBootPhase("generated_equipment_asset_loaded");
    },
    undefined,
    (error) => {
      for (const child of primitiveFallbackChildren) {
        child.visible = primitiveFallbackVisible;
      }
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "failed",
        fallbackActive: primitiveFallbackVisible,
      });
      recordBootPhase("generated_equipment_asset_load_failed", error);
    },
  );
}

function loadGeneratedEnvironmentIntoSceneSlot(
  sceneSlot: Group,
  options: {
    assetPath: string;
    assetId: string;
    objectName: string;
  },
): void {
  const environmentLoader = new GLTFLoader();
  recordSceneAssetStatus({
    assetId: options.assetId,
    assetPath: options.assetPath,
    sceneObjectName: options.objectName,
    status: "pending",
    fallbackActive: false,
  });
  environmentLoader.load(
    options.assetPath,
    (gltf) => {
      const environment = gltf.scene;
      environment.name = options.objectName;
      environment.userData.openClinXrAffordances = ["room_boundary_reference", "spatial_orientation_cue"];
      Object.assign(environment.userData, prepareLoadedEnvironmentShell(environment)); // #97 axis+bed
      environment.add(createAffordanceMarker(`${options.objectName}:room_boundary`, 0xf4d35e));
      sceneSlot.add(environment);
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "loaded",
        fallbackActive: false,
        affordanceCueIds: runtimeAssetAffordanceCueIds(options.assetId, [
          "room_boundary_reference",
          "spatial_orientation_cue",
        ]),
        animationPlayback: "not_applicable",
      });
      recordBootPhase("generated_environment_asset_loaded");
    },
    undefined,
    (error) => {
      recordSceneAssetStatus({
        assetId: options.assetId,
        assetPath: options.assetPath,
        sceneObjectName: options.objectName,
        status: "failed",
        fallbackActive: false,
      });
      recordBootPhase("generated_environment_asset_load_failed", error);
    },
  );
}

const frameDeltasMs: number[] = [];
let framesObserved = 0;
let previewFramesObserved = 0;
let immersiveFramesObserved = 0;
let firstFrameAtMs: number | null = null;
let lastFrameAtMs: number | undefined;

function recordFrame(now: number, evidence: {
  qualitySource: NonNullable<OpenClinXrFrameStats["qualitySource"]>;
  isPresenting: boolean;
  visibilityState: string;
}): ManualPerformanceCaptureSummary {
  if (lastFrameAtMs !== undefined) {
    frameDeltasMs.push(now - lastFrameAtMs);
    if (frameDeltasMs.length > 180) {
      frameDeltasMs.shift();
    }
  }
  firstFrameAtMs ??= now;
  lastFrameAtMs = now;
  framesObserved += 1;
  if (evidence.isPresenting) {
    immersiveFramesObserved += 1;
  } else {
    previewFramesObserved += 1;
  }
  window.__openClinXrFrameStats = buildRuntimeFrameStats({
    frameDeltasMs,
    framesObserved,
    firstFrameAtMs,
    latestFrameAtMs: now,
    previewFramesObserved,
    immersiveFramesObserved,
    qualitySource: evidence.qualitySource,
    isPresenting: evidence.isPresenting,
    visibilityState: evidence.visibilityState,
  });
  window.__openClinXrManualPerformanceDraft = buildManualPerformanceDraft({
    generatedAt: new Date().toISOString(),
    elapsedSecond: state.elapsedSecond,
    foregroundPageConfirmed: document.visibilityState === "visible",
    traceInteractionPassed: state.completedTraceTags.length > 0,
    frameStats: window.__openClinXrFrameStats,
    controllerSelectLatencyMs: lastTraceSelectLatencyMs,
    experienceModeEvidence: window.__openClinXrExperienceModeEvidence ?? xrExperienceModeEvidence,
    inputEvidence: window.__openClinXrInputEvidence ?? null,
    traceLatencyEvidence: window.__openClinXrTraceLatencyEvidence ?? null,
    reproducibilityEvidence: buildRuntimeReproducibilityEvidence(),
    immersiveSessionStarted: immersiveSessionActive,
  });
  const captureSummary = buildManualPerformanceCaptureSummary({
    draft: window.__openClinXrManualPerformanceDraft,
    frameStats: window.__openClinXrFrameStats,
    now,
  });
  window.__openClinXrManualPerformanceCaptureSummary = captureSummary;
  if (framesObserved === 1 || framesObserved % 30 === 0) {
    updateManualEvidencePanel();
  }
  return captureSummary;
}

function updateManualEvidencePanel(): string {
  const now = performance.now();
  const summary = buildManualPerformanceCaptureSummary({
    draft: window.__openClinXrManualPerformanceDraft ?? null,
    frameStats: window.__openClinXrFrameStats ?? null,
    now,
  });
  window.__openClinXrManualPerformanceCaptureSummary = summary;
  updateRuntimePosturePanel(summary);
  evidenceFrames.textContent = [
    `${summary.framesObserved ?? 0} / ${summary.sampleWindowSize ?? 0}`,
    `vr ${summary.immersiveFramesObserved ?? 0}`,
    `preview ${summary.previewFramesObserved ?? 0}`,
    summary.immersiveFrameEvidenceReady ? "frame evidence ready" : "frame gap",
  ].join(" | ");
  evidenceLoop.textContent = [
    summary.qualitySource ?? "pending",
    summary.isPresenting ? "presenting" : "not presenting",
    summary.visibilityState ?? "unknown",
    summary.frameStatsFresh === null ? "freshness pending" : summary.frameStatsFresh ? `${summary.frameStatsAgeMs}ms fresh` : `${summary.frameStatsAgeMs}ms stale`,
  ].join(" | ");
  evidenceInput.textContent = [
    `${summary.handInputsObserved ?? 0} hand inputs`,
    `hand rep ${summary.handRepresentationKind ?? "unknown"}`,
    summary.inputSourceKinds.length > 0 ? summary.inputSourceKinds.join(", ") : "no source",
  ].join(" | ");
  evidenceSceneAssets.textContent = formatSceneAssetEvidenceStatus(window.__openClinXrSceneAssetEvidence ?? null);
  evidenceSpeechAffect.textContent = [
    formatHumanoidSpeechAffectEvidence(window.__openClinXrHumanoidSpeechEvidence ?? null),
    formatCaseDefinedHumanoidPerformanceContractEvidence(window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence ?? null),
  ].join(" | ");
  evidenceActorPlayer.textContent = formatActorPlayerRuntimeMetadataSummary(
    window.__openClinXrActorPlayerRuntimeMetadataSummary ?? null,
    window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
  );
  evidenceLocomotion.textContent = [
    formatPortalTransitionEvidence(window.__openClinXrPortalTransitionEvidence ?? null),
    summary.activeLocomotionSource ?? "none",
    summary.locomotionEvidenceReady ? "locomotion ready" : "locomotion gap",
    `attempt ${summary.locomotionAttempt ?? "unknown"}`,
    summary.lastLocomotionAtMs === null ? "no movement timestamp" : `moved ${summary.lastLocomotionAtMs}ms`,
    summary.locomotionDistanceMeters === null ? "no distance delta" : `d ${summary.locomotionDistanceMeters}m`,
    summary.locomotionTurnRadians === null ? "no turn delta" : `turn ${summary.locomotionTurnRadians}rad`,
    formatLocomotionPathQuality(summary.locomotionPathQuality),
    formatLocomotionDiagnosticSummary(summary.locomotionDiagnosticSummary),
    formatLocomotionProbeSummary(summary.locomotionProbeSummary),
  ].join(" | ");
  evidenceTrace.textContent = [
    summary.traceLatencySource ?? "no trace source",
    summary.headsetSelectLatencyReady ? "headset latency ready" : "headset latency gap",
    `attempt ${summary.traceInteractionAttempt ?? "unknown"}`,
    summary.handSelectStatus === null
      ? "hand select unavailable"
      : `hand select ${summary.handSelectStatus}; dwell ${summary.handSelectDwellMs ?? 0}ms; fired ${summary.handSelectFiredCount ?? 0}${summary.handSelectBlockedReason ? `; ${summary.handSelectBlockedReason}` : ""}`,
    summary.lastTraceTag ?? "no tag",
    summary.lastTraceLatencyMs === null ? "no latency" : `${summary.lastTraceLatencyMs}ms`,
  ].join(" | ");
  evidenceValidation.textContent = [
    summary.manualValidationReady ? "manual validation ready" : "draft only",
    summary.blockers.length === 0 ? "no blockers" : `${summary.blockers.length} blockers`,
    `gap ${formatTechnicalGapStatus(summary)}`,
  ].join(" | ");
  copyEvidenceStatus.textContent = formatManualEvidenceCopyStatus(summary, evidenceCopyDisposition);
  const manualPerformanceDraft = window.__openClinXrManualPerformanceDraft ?? null;
  const payload = JSON.stringify({
    ...buildManualPerformanceEvidencePayload({
    manualPerformanceDraft,
    captureSummary: summary,
    runtimeAssetBundleId: window.__openClinXrSelectedRuntimeAssetBundleId ?? null,
    learnerRuntimeUseGateEvidence: window.__openClinXrLearnerRuntimeUseGateEvidence ?? null,
    runtimeSceneManifestEvidence: window.__openClinXrRuntimeSceneManifestEvidence ?? null,
    textPanelEvidence: window.__openClinXrTextPanelEvidence ?? null,
    traceActionHandoffEvidence: window.__openClinXrTraceActionHandoffEvidence ?? null,
    sceneAssetEvidence: window.__openClinXrSceneAssetEvidence ?? null,
    environmentStateEvidence: window.__openClinXrEnvironmentStateEvidence ?? null,
    humanoidSpeechEvidence: window.__openClinXrHumanoidSpeechEvidence ?? null,
    caseDefinedHumanoidPerformanceContractEvidence: window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence ?? null,
    actorPlayerRuntimeMetadataSummary: window.__openClinXrActorPlayerRuntimeMetadataSummary ?? null,
    examineeLocomotionEvidence: window.__openClinXrExamineeLocomotionEvidence ?? null,
    runtimeInteractionEvidence: latestRuntimeInteractionEvidence,
    traceInteractionEvidenceSummary: window.__openClinXrTraceInteractionEvidenceSummary ?? null,
    }),
    portalTransitionEvidence: window.__openClinXrPortalTransitionEvidence ?? null,
    pedsActorPlayerRuntimePlaybackEvidence: window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence ?? null,
    examFlowEvidence: window.__openClinXrExamFlowEvidence ?? null,
    examRunSummaryEvidence: window.__openClinXrExamRunSummaryEvidence ?? null,
  }, null, 2);
  manualEvidenceJson.value = payload;
  return payload;
}

function formatSceneAssetEvidenceStatus(evidence: SceneAssetEvidence | null): string {
  if (!evidence) {
    return "generated assets pending";
  }
  return [
    `${evidence.loadedCount}/${evidence.expectedAssetCount} generated loaded`,
    evidence.failedCount === 0 ? "no load failures" : `${evidence.failedCount} failed`,
    evidence.fallbackActiveCount === 0 ? "no fallbacks active" : `${evidence.fallbackActiveCount} fallbacks active`,
    `${evidence.assets.reduce((count, asset) => count + (asset.affordanceCueIds?.length ?? 0), 0)} affordance cues`,
    `${evidence.assets.filter((asset) => asset.animationPlayback === "gltf_role_animation_clip_playing").length} role clips active`,
    ...evidence.assets
      .filter((asset) => asset.activeRoleAnimationClipName)
      .map((asset) => `${asset.sceneObjectName} ${asset.activeRoleAnimationClipName}`),
  ].join(" | ");
}

function formatCaseDefinedHumanoidPerformanceContractEvidence(evidence: CaseDefinedHumanoidPerformanceContractEvidence | null): string {
  if (!evidence) {
    return "case humanoid contract pending";
  }
  return [
    `case humanoid contract ${evidence.actorCount} actors`,
    `locomotion ${evidence.locomotionActorRoles.length}`,
    `expression ${evidence.expressionActorRoles.length}`,
    `gaze ${evidence.gazeActorRoles.length}`,
    `lip-sync ${evidence.lipSyncActorRoles.length}`,
    `interactivity ${evidence.interactiveActorRoles.length}`,
    `emotion states ${evidence.emotionStateCount}`,
    `viseme ${String(evidence.dialogueDrivenVisemeMappingRequired)}`,
    evidence.claimBoundary,
    `not readiness ${evidence.notEvidenceFor.join(",")}`,
  ].join(" | ");
}

function formatActorPlayerRuntimeMetadataSummary(
  evidence: ActorPlayerRuntimeMetadataSummary | null,
  playback: PedsActorPlayerRuntimePlaybackEvidence | null = null,
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
      ? `live preview ${playback.latestTriggerSource ?? "pending"} ${playback.latestTraceTag ?? "no-trace"} ${playback.latestTurnSource ?? "unknown-source"} ${playback.latestActorId ?? "pending"} ${playback.latestCue ?? "pending"} emotion ${playback.latestEmotion ?? "pending"} ${playback.latestRoleAnimationClipName ?? "no-role-clip"} sequence ${playback.latestSequenceSource ?? "none"} ${playback.latestSequenceStepIndex + 1}/${playback.latestSequenceTurnCount || 0} actors ${playback.latestSequenceActorIds.join(",") || "none"} listeners ${playback.latestListenerActorIds.join(",") || "none"} coupled ${playback.latestCoupledSignalIds.join(",") || "none"} bundle ${playback.bundleDialogueTurnCount} fallback ${playback.fallbackTurnCount}`
      : "live preview pending",
    `blocked ${blockers || "none"}`,
    evidence.claimBoundary,
    playback?.claimBoundary ?? "local_actor_player_runtime_preview_not_started",
    `not readiness ${evidence.notEvidenceFor.join(",")}`,
  ].join(" | ");
}

/**
 * Case-driven one-shot response clip names (bodyMechanics.touchResponses.responseClip).
 * Registered alongside role clips for discoverability; played only via handleClinicalTouch.
 */
function clinicalTouchResponseClipNamesForActor(actorId: string): string[] {
  const scenario =
    scenarioBank.find((candidate) => candidate.scenarioId === selectedScenarioId()) ?? edChestPainScenario;
  const actor = scenario.actors.find((candidate) => candidate.actorId === actorId);
  const responses = actor?.bodyMechanics?.touchResponses ?? [];
  return responses.map((response) => response.responseClip).filter((name): name is string => Boolean(name));
}

function roleAnimationClipNamesForActor(actorId: string): string[] {
  const fromMetadata =
    window.__openClinXrActorPlayerRuntimeMetadataSummary?.actorSummaries.find((actor) => actor.actorId === actorId)
      ?.roleAnimationClipNames ?? [];
  // ED / non-peds paths have no actor-player metadata; keep a stable idle clip so we do not
  // auto-play every GLB animation (including the guard/withdraw one-shot) as role idle.
  const base =
    fromMetadata.length > 0
      ? fromMetadata
      : ["openclinxr_clinical_idle_breathing", "openclinxr_conversation_listen_nod"];
  // Register clinical-touch response clips here (discoverable via roleAnimationClipNamesForActor);
  // registerGeneratedHumanoidAnimation excludes them from auto-loop playback.
  return [...new Set([...base, ...clinicalTouchResponseClipNamesForActor(actorId)])];
}

function formatLocomotionDiagnosticSummary(
  summary: ManualPerformanceCaptureSummary["locomotionDiagnosticSummary"],
): string {
  if (!summary) {
    return "diag pending";
  }
  const reasons = summary.handGestureBlockedReasons.length > 0
    ? summary.handGestureBlockedReasons.join(",")
    : "none";
  return `diag gp ${summary.activeGamepadSourceCount}/${summary.gamepadSourceCount}; hand ${summary.pinchingHandCount}/${summary.handGestureHandCount}; blocked ${reasons}`;
}

function formatLocomotionPathQuality(
  summary: ManualPerformanceCaptureSummary["locomotionPathQuality"],
): string {
  if (!summary) {
    return "path no delta";
  }
  return summary.blockers.length === 0
    ? `path samples ${summary.sampleCount}; curve observed`
    : `path samples ${summary.sampleCount}; blocked ${summary.blockers.join(",")}`;
}

function formatLocomotionProbeSummary(
  summary: ManualPerformanceCaptureSummary["locomotionProbeSummary"],
): string {
  if (!summary) {
    return "probe pending";
  }
  return `probe ${summary.primaryReason}; ctrl ${summary.controllerSources.activeAfterDeadzone}/${summary.controllerSources.total}; hand ${summary.handGesture.pinching}/${summary.handGesture.handsObserved}`;
}

function formatPortalTransitionEvidence(evidence: PortalTransitionEvidence | null): string {
  if (!evidence) {
    return "portal pending";
  }
  return [
    `portal ${evidence.side}`,
    evidence.encounterEntered ? "entered dynamic encounter" : "outside encounter",
    evidence.encounterStartedByPortal ? "portal started encounter" : "portal start pending",
    evidence.reusableExteriorHiddenForEncounterView ? "exterior shell hidden" : "exterior shell visible",
    `note ${evidence.noteCaptureLocation}`,
  ].join("; ");
}

let start = performance.now();
function tick(): void {
  state = { ...state, elapsedSecond: Math.floor((performance.now() - start) / 1000) };
  clock.textContent = formatStationClock(state.elapsedSecond);
  if (examFormRunState) {
    examFormRunState = tickExamFormRunClock(examFormRunState, formElapsedSecondForCurrentStation());
    updateExamFormRunEvidence();
  }
  advanceExamFlowForElapsedTime();
  advanceExamNoteForElapsedTime();
  updateExamFlowEvidence();
  requestAnimationFrame(tick);
}

start = performance.now();
recordBootPhase("controls_start");
recordLearnerRuntimeUseGateEvidence(encounterRuntimeAssetBundle, "local_fixture_fallback", null);
renderControls();
updateReadiness();
updateRuntimePosturePanel(null);
updateTraceActionHandoffEvidence();
updateExamFlowEvidence();
recordBootPhase("controls_ready");
void initializeRemoteTraceSession(stationApi);
void updateXrStatus();
let stationScene: StationSceneRuntime | undefined;
void bootStationScene();
enterXrButton.addEventListener("click", () => {
  if (!stationScene) {
    xrStatus.textContent = "Station boot blocked";
    return;
  }
  void stationScene.startImmersiveSession();
});
tick();
recordBootPhase("clock_started");
// #710 dev-only speak fixture bridge: no-op unless the capture URL carries
// openclinxrSpeakFixture=1 (see apps/ui-xr/src/speak-fixture-bridge.ts).
initSpeakFixtureBridge({
  triggerDialogue: (actorId: string, text: string): void => {
    triggerHumanoidDialogue(actorId, text, { kind: "learner_camera", actorId: null });
  },
});
async function bootStationScene(): Promise<void> {
  await initializeLearnerRuntimeAssetBundle(stationApi);
  refreshStationContextFromRuntimeBundle();
  renderControls();
  updateReadiness();
  updateTraceActionHandoffEvidence();
  try {
    stationScene = createStationScene();
    recordBootPhase("station_scene_ready");
    window.setInterval(updateManualEvidencePanel, 1000);
  } catch (error) {
    recordBootPhase("station_scene_failed", error);
    window.__openClinXrLastStationSceneBootErrorStack = error instanceof Error ? error.stack ?? error.message : String(error);
    xrStatus.textContent = "Station boot blocked";
    sceneBootMessage.hidden = false;
    const sceneBootMessageText = sceneBootMessage.querySelector("span");
    if (sceneBootMessageText) {
      sceneBootMessageText.textContent = `3D scene blocked: ${formatUnknownError(error)}. Use Quest/manual evidence before readiness claims.`;
    }
  }
}
