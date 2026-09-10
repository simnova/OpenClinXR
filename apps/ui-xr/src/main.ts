import {
  type ActorPosture,
  resolveActorPosture,
  seatedVerticalOffsetForSeatHeight,
  supineVerticalOffsetSeed,
} from "@openclinxr/asset-registry";
import {
  findRuntimeActorAsset,
  findRuntimeActorAssetByRole,
  findRuntimeEquipmentAsset,
} from "@openclinxr/asset-registry/runtime-bundle-lookups";
import {
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  type EncounterRuntimeAsset,
  type EncounterRuntimeRoomProp,
  type LearnerRuntimeAssetBundle,
  resolveRuntimeAssetUrl,
} from "@openclinxr/asset-registry/runtime-bundles";
import {
  arbitrateTurnTaking,
  buildHistoryTakingCoverageSpec,
  type HistoryTakingCoverageState,
  initialHistoryTakingCoverageState,
  updateHistoryTakingCoverage,
} from "@openclinxr/conversation-policy";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { responseClipForBodyRegion, scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import {
  createActorDialogueStore,
  type ActorDialoguePlaybackEvidence as PedsActorPlayerRuntimePlaybackEvidenceFromStore,
  type ActorDialogueSequence as PedsActorPlayerRuntimeSequenceEvidenceFromStore,
  type ActorDialogueTurn as PedsActorPlayerRuntimeTurnFromStore,
  type ActorDialogueAdaptiveEvidence as PedsAdaptiveDialogueEvidenceFromStore,
} from "@openclinxr/xr-actor-dialogue";
import {
  addActorSpecificIdentityVariantCue as addPackageActorSpecificIdentityVariantCue,
  addHumanoidSourceComparatorFaceReviewCues as addPackageHumanoidSourceComparatorFaceReviewCues,
  addReusableExteriorPreEncounterRoom as addPackageReusableExteriorPreEncounterRoom,
  addScenarioSpecificClinicalSetDressing as addPackageScenarioSpecificClinicalSetDressing,
  addRoleSpecificHumanoidVisuals as addRoleSpecificHumanoidVisualsPackage,
  addScenarioSpecificClinicalTeamCue as addScenarioSpecificClinicalTeamCuePackage,
  addScenarioSpecificFamilyCue as addScenarioSpecificFamilyCuePackage,
  addScenarioSpecificPatientCue as addScenarioSpecificPatientCuePackage,
  clinicalTouchResponseClipNamesForActor as clinicalPackageTouchResponseClipNamesForActor,
  comparatorCaptureSubjectActorId as comparatorPackageCaptureSubjectActorId,
  configureSemanticRolePoseOverlay as configureSemanticRolePoseOverlayPackage,
  frameComparatorCaptureOnNamedActor as framePackageComparatorCaptureOnNamedActor,
  gazeProbeAnimationClipNamesFromGltf as gazePackageProbeAnimationClipNamesFromGltf,
  hasAuthoredClinicalIdlePoseClip as hasPackageAuthoredClinicalIdlePoseClip,
  loadGeneratedEnvironmentIntoSceneSlot as loadPackageGeneratedEnvironmentIntoSceneSlot,
  loadGeneratedEquipmentIntoSceneSlot as loadPackageGeneratedEquipmentIntoSceneSlot,
  neutralizeGeneratedHumanoidMorphTargets as neutralizePackageGeneratedHumanoidMorphTargets,
  type AssetLoadingContext as PackageAssetLoadingContext,
  type AssetLoadingScenarioTheme as PackageAssetLoadingScenarioTheme,
  type HumanoidCueMode as PackageHumanoidCueMode,
  pedsAsthmaPatientBundleVisemeUtterance as pedsPackageAsthmaPatientBundleVisemeUtterance,
  registerGeneratedHumanoidAnimation as registerPackageGeneratedHumanoidAnimation,
  roleAnimationClipNamesForActor as rolePackageAnimationClipNamesForActor,
  runtimeHumanoidVariantAssetPath as runtimePackageHumanoidVariantAssetPath,
  selectedHumanoidSourceComparator as selectedPackageHumanoidSourceComparator,
  shouldShowProceduralHumanoidDetailCues as shouldShowProceduralHumanoidDetailCuesPackage,
  suppressRuntimeDiagnosticOverlaysForSourceComparator as suppressPackageRuntimeDiagnosticOverlaysForSourceComparator,
  tintGeneratedSceneMaterials as tintPackageGeneratedSceneMaterials,
} from "@openclinxr/xr-asset-loading";
import {
  buildCaseDefinedHumanoidPerformanceContractEvidence as buildPackageCaseDefinedHumanoidPerformanceContractEvidence,
  buildRuntimeSceneManifestEvidence as buildPackageRuntimeSceneManifestEvidence,
  formatCaseDefinedHumanoidPerformanceContractEvidence as formatPackageCaseDefinedHumanoidPerformanceContractEvidence,
  formatSceneAssetEvidenceStatus as formatPackageSceneAssetEvidenceStatus,
  formatUnknownError as formatPackageUnknownError,
  isGeneratedPlaceholderSourceForDifferentScenario as isPackageGeneratedPlaceholderSourceForDifferentScenario,
  isHumanoidMouthGazePoseReviewCaptureMode as isPackageHumanoidMouthGazePoseReviewCaptureMode,
  isPhysicsClinicalTouchCapture as isPackagePhysicsClinicalTouchCapture,
  isRealGarmentSleeveDeformCapture as isPackageRealGarmentSleeveDeformCapture,
  isSceneOnlyVisualReviewCaptureMode as isPackageSceneOnlyVisualReviewCaptureMode,
  roundPerformanceNow as packageRoundPerformanceNow,
  runtimeAssetAffordanceCueIds as packageRuntimeAssetAffordanceCueIds,
  publishRuntimeActorSlotAssignmentEvidence as publishPackageRuntimeActorSlotAssignmentEvidence,
  recordLearnerRuntimeUseGateEvidence as recordPackageLearnerRuntimeUseGateEvidence,
  recordSceneAssetStatus as recordPackageSceneAssetStatus,
  recordXrEntryEvidence as recordPackageXrEntryEvidence,
  refreshDeclaredEquipmentMountEvidenceFromScene as refreshPackageDeclaredEquipmentMountEvidenceFromScene,
  resolveRuntimeSlotAssignment as resolvePackageRuntimeSlotAssignment,
  shouldRenderRoomPropInVisualReview as shouldPackageRenderRoomPropInVisualReview,
  shouldShowActorRealismRequirementPanel as shouldPackageShowActorRealismRequirementPanel,
  shouldShowInSceneEvidencePanels as shouldPackageShowInSceneEvidencePanels,
  shouldShowInSceneIdentityLabels as shouldPackageShowInSceneIdentityLabels,
  shouldShowPrimitiveAssetFallbacks as shouldPackageShowPrimitiveAssetFallbacks,
  shouldShowRuntimeAffordanceMarkers as shouldPackageShowRuntimeAffordanceMarkers,
  shouldSuppressGeneratedEquipmentModel as shouldPackageSuppressGeneratedEquipmentModel,
  shouldUseLearnerRuntimeAssetBundle,
} from "@openclinxr/xr-capture-evidence";
import { type ActorTurnPlayback, applyNamedSpeechVisemes,
  consumeLiveActorTurn,
  formatActiveActorRealismRequirementLines,
  formatHumanoidSpeechAffectEvidence, initSpeakFixtureBridge,
  type LiveActorTurnConsumption,
  liveActorTurnFromPayload,loadBakedMouthCuesForUtterance, playFrozenActorTurnOnSlot,
  registerLiveActorTurn,
  resolveLiveActorTurnForTrace } from "@openclinxr/xr-dialogue";
import {
  advanceFormRunClock as advancePackageFormRunClock,
  buildExamFlowEvidence as buildPackageExamFlowEvidence,
  buildExamFormRunEvidence as buildPackageExamFormRunEvidence,
  buildExamRunSummaryEvidence as buildPackageExamRunSummaryEvidence,
  createExamFlowStore,
  createFormRunState as createPackageFormRunState,
  type ExamFlowRuntimeAccessors,
  type ExamRunStationOutcome as PackageExamRunStationOutcome,
  type OpenClinXrExamFlowEvidence as PackageOpenClinXrExamFlowEvidence,
  type OpenClinXrExamFormRunEvidence as PackageOpenClinXrExamFormRunEvidence,
  type OpenClinXrExamRunSummaryEvidence as PackageOpenClinXrExamRunSummaryEvidence,
  persistFormRunQueueSnapshot as persistPackageFormRunQueueSnapshot,
  readExamRunSummaryOutcomes as readPackageExamRunSummaryOutcomes,
  recordStationOutcome as recordPackageStationOutcome,
  recordStationOutcomeOnFormRun,
} from "@openclinxr/xr-exam-flow";
import {
  applyHumanoidMorphTargetCue as applyPackageHumanoidMorphTargetCue,
  buildHumanoidSpeechEvidence as buildPackageHumanoidSpeechEvidence,
  createHumanoidEmotionExpressionState as createPackageHumanoidEmotionExpressionState,
  isGeneratedRuntimeDrive as isPackageGeneratedRuntimeDrive,
  orientHumanoidEyeFocusCue as orientPackageHumanoidEyeFocusCue,
  orientHumanoidTowardGazeTarget as orientPackageHumanoidTowardGazeTarget,
  type GeneratedHumanoidAnimationSlot as PackageGeneratedHumanoidAnimationSlot,
  type HumanoidActingCueRecord as PackageHumanoidActingCueRecord,
  type HumanoidAnimationRuntimeContext as PackageHumanoidAnimationRuntimeContext,
  type HumanoidDialogueEmotionContext as PackageHumanoidDialogueEmotionContext,
  type HumanoidDialogueGazeTarget as PackageHumanoidDialogueGazeTarget,
  type HumanoidEmotionExpressionState as PackageHumanoidEmotionExpressionState,
  type HumanoidExpressionEmotion as PackageHumanoidExpressionEmotion,
  type HumanoidExpressionWeights as PackageHumanoidExpressionWeights,
  type HumanoidSpeechPlayback as PackageHumanoidSpeechPlayback,
  type MouthGazePoseComparatorEvidenceRecord as PackageMouthGazePoseComparatorEvidenceRecord,
  type RuntimeHumanoidActingCueEvidenceRecord as PackageRuntimeHumanoidActingCueEvidenceRecord,
  resolveHumanoidGazeTargetWorld as resolvePackageHumanoidGazeTargetWorld,
  startHumanoidEmotionTransition as startPackageHumanoidEmotionTransition,
  updateGeneratedHumanoidAnimations as updatePackageGeneratedHumanoidAnimations,
  updateHumanoidEmotionExpression as updatePackageHumanoidEmotionExpression,
} from "@openclinxr/xr-humanoid-animation";
import { applyStationBedsideStanceLock, createStationBedsideApproachState, updateStationBedsideApproach } from "@openclinxr/xr-humanoid-animation/station-bedside-approach";
import {
  applyDeterministicPortalPreviewStart as applyPackageDeterministicPortalPreviewStart,
  applyGeneratedHumanoidRoleSpecificPosture as applyPackageGeneratedHumanoidRoleSpecificPosture,
  applyLocomotion as applyPackageLocomotion,
  buildExamineeLocomotionEvidence as buildPackageExamineeLocomotionEvidence,
  createExamineeLocomotionTrail as createPackageExamineeLocomotionTrail,
  createKeyboardLocomotion as createPackageKeyboardLocomotion,
  createXrHandGestureLocomotionState as createPackageXrHandGestureLocomotionState,
  createXrHandSelectState as createPackageXrHandSelectState,
  formatHandSelectStatus as formatPackageHandSelectStatus,
  formatPortalTransitionEvidence as formatPackagePortalTransitionEvidence,
  maybeCompleteTraceActionFromHandSelect as maybePackageCompleteTraceActionFromHandSelect,
  type PortalTransitionEvidence as PackagePortalTransitionEvidence,
  type XrHandGroup as PackageXrHandGroup,
  type XrInputSourceWithGamepad as PackageXrInputSourceWithGamepad,
  PORTAL_THRESHOLD_Z,
  type PortalTransitionContext,
  parsePortalPreviewStart,
  type RolePostureContext,
  recordHandSelectTraceLatency,
  sampleRoomScalePose as samplePackageRoomScalePose,
  updateExamineeLocomotionTrail as updatePackageExamineeLocomotionTrail,
  updatePortalTransitionEvidence as updatePackagePortalTransitionEvidence,
  type XrSessionLike,
} from "@openclinxr/xr-locomotion";
import {animatedTranslationBoneNames, 
  applyAndPlantSupineOnDeck, 
  applyGeneratedHumanoidClinicalIdlePosture,applyPosturePose, applySupinePose, 
  describeRuntimeBundleScenarioMatch,plantSeatedPelvisOnSeat, 
  resolveEffectiveVerticalOffsetMeters,seatedRoleClipIsPlayable 
} from "@openclinxr/xr-pose";
import {
  type ActorPlayerRuntimeMetadataSummary,
  actorIdForTraceTag,
  actorResponseTextFromApiResult,
  buildConversationTurnStateEvidence,
  buildManualPerformanceCaptureSummary,
  buildManualPerformanceDraft,
  buildManualPerformanceEvidencePayload,
  buildManualPerformanceReproducibility,
  buildReadableVrTextPanelEvidence,
  buildRuntimeEvidencePosture,
  buildRuntimeFrameStats,
  buildXrRuntimeReadinessDecision,
  buildXrTraceActionHandoffEvidence,
  buildXrTraceInteractionEvidenceSummary,
  type CaseDefinedHumanoidPerformanceContractEvidence,
  type ConversationTurnStateEvidence,
  completeTraceAction,
  createInitialRuntimeState,
  createRuntimeStateFromBundle,
  type EnvironmentStateEvidence,
  type ExamFormRunState,
  type ExamineeLocomotionEvidence,
  ensureAndPublishActorPlacementSsot,
  eventTypeForTraceTag,
  formatManualEvidenceCopyStatus,
  formatStationClock,type GeneratedDriveScalarValue, 
  type HumanoidSpeechEvidence,
  isImmersiveFrameEvidenceActive,
  iwsdkStationSceneObjectNames,
  iwsdkStationSceneObjects,
  type LearnerRuntimeUseGateEvidence,
  localHandMeshPath,
  type ManualEvidenceCopyDisposition,
  type ManualPerformanceCaptureSummary,
  type ManualPerformanceDraft,
  type ManualPerformanceFrameStats,
  type ManualPerformanceInputEvidence,
  type ManualPerformanceReproducibilityEvidence,
  type ManualPerformanceTraceLatencyEvidence,
  meshHandModelProfile,
  meshHandRepresentationKind,
  primitiveHandModelProfile,
  primitiveHandRepresentationKind,
  type ReadableVrTextPanelEvidence,
  type ReadableVrTextPanelEvidenceSet,
  type RigPoseEvidence,
  type RuntimeEvidencePosture,
  type RuntimeInteractionEvidence,
  type RuntimeMaterializationEvidenceAttachmentSummary,
  type RuntimeRemainingRuntimeBlockerReasons,
  type RuntimeSceneManifestEvidence,
  type RuntimeSlotAssignment,
  remoteActorTurnForTraceTag,
  resolveLocalEnvironmentRuntimeAssetFileName,
  resolveLocalEquipmentRuntimeAssetFileName,
  type SceneAssetEvidence,
  summarizeTraceReadiness,
  supportedActorPlacementPosition,
  viewLearnerCanonicalExamPhase,
  type XrExperienceModeEvidence,
  type XrRuntimeReadinessDecision,
  type XrRuntimeState,
  type XrTraceActionHandoffAction,
  type XrTraceActionHandoffEvidence,
  type XrTraceInteractionEvidenceSummary,
  xrExperienceModeEvidence,
} from "@openclinxr/xr-runtime-state";
import { applyStationIdleSway } from "@openclinxr/xr-runtime-state/composed-body-direction";
import {
  type ExamRunQueryDeps,
  type ExamStationContext,
  booleanQueryParam as packageBooleanQueryParam,
  buildExamNavigationHref as packageBuildExamNavigationHref,
  configuredExamRunId as packageConfiguredExamRunId,
  configuredExamSequence as packageConfiguredExamSequence,
  formElapsedSecondForCurrentStation as packageFormElapsedSecondForCurrentStation,
  nextExamScenarioId as packageNextExamScenarioId,
  positiveIntegerQueryParam as packagePositiveIntegerQueryParam,
} from "@openclinxr/xr-runtime-wiring";
import {
  addGeneratedHumanoidRoleContinuityWardrobeCue,
  applyCleanEncounterVisualReviewActorFraming as applyEncounterActorFraming,applyRealGarmentEvidenceSurfaces,
  bootLearnerExamFormFromApi,createVirtualDeviceActorAffordance as buildVirtualDeviceActorAffordance,
  collectActorWorldBoxes,
  deriveInteriorPreviewCamera,
  resolveHumanoidVariantOrCastPath,
  resolveLocalHumanoidRuntimeAssetUrl, sleeveDeformCueForAssetPath
} from "@openclinxr/xr-scene";
import {
  addPediatricRespiratoryEquipmentCues as addPackagePediatricRespiratoryEquipmentCues,
  applyCleanEncounterVisualReviewActorFraming as applyPackageCleanEncounterVisualReviewActorFraming,
  applyEnvironmentStateVisuals as applyPackageEnvironmentStateVisuals,
  applyRuntimeEquipmentTraceVisuals as applyPackageRuntimeEquipmentTraceVisuals,
  clinicalPanelLinesForBundle as clinicalPackagePanelLinesForBundle,
  createActorNameplate as createPackageActorNameplate,
  createAffordanceMarker as createPackageAffordanceMarker,
  createClinicalPanel as createPackageClinicalPanel,
  createDetailedEdRoomProps as createPackageDetailedEdRoomProps,
  createHumanoidExpressionCue as createPackageHumanoidExpressionCue,
  createHumanoidEyeFocusCue as createPackageHumanoidEyeFocusCue,
  createHumanoidEyeGazeCue as createPackageHumanoidEyeGazeCue,
  createHumanoidInteractionCollisionCues as createPackageHumanoidInteractionCollisionCues,
  createHumanoidSpeechMouthCue as createPackageHumanoidSpeechMouthCue,
  createReadableVrTextPanel as createPackageReadableVrTextPanel,
  createRuntimeHumanoidDetailCues as createPackageRuntimeHumanoidDetailCues,
  createVirtualDeviceActorAffordance as createPackageVirtualDeviceActorAffordance,
  type DynamicSceneObjectNamingEvidence,
  type PediatricRespiratoryEquipmentCueEvidence,
  type ReadableVrTextPanel,
  type RoleDistinctHumanoidCueEvidence,
  recordDynamicSceneObjectNamingEvidence as recordPackageDynamicSceneObjectNamingEvidence,
  recordPediatricRespiratoryEquipmentCue as recordPackagePediatricRespiratoryEquipmentCue,
  recordRoleDistinctHumanoidCue as recordPackageRoleDistinctHumanoidCue,
  runtimeEquipmentIdsForTag as runtimePackageEquipmentIdsForTag,
  type SceneCueActorFramingContext,
  type SceneCueClinicalPanelContext,
  type SceneCueEnvironmentVisualContext,
  type SceneCueHumanoidCueContext,
  type SceneCueNameplateContext,
  type SceneCueNamingEvidenceContext,
  type SceneCuePediatricCueEvidenceContext,
  type SceneCuePediatricEquipmentContext,
  type SceneCueRoleCueEvidenceContext,
  type SceneCueRoomPropContext,
  type SceneCueTraceVisualContext,
  type SceneCueVirtualDeviceContext,
  updateEnvironmentRealismAnimations as updatePackageEnvironmentRealismAnimations,
} from "@openclinxr/xr-scene-cues";
import { 
  buildAssembledStationStartSessionInput,
  buildDeclaredEquipmentGeometry,
  buildGltfEquipmentPlaceholderSlot,buildRoomPropGroup, 
  collectDeclaredEquipmentEvidenceFromScene,
  countEquipmentGeometry,
  // Both factories are exported; this file types against the assembled one.
  createAssembledStationApiClient as createStationApiClient,
  createStationApiPersistenceSink, findProceduralStretcherInSceneOf, isCaptureShadowPath, markActorCastShadow,
  normalizeGltfEquipmentMount,PATIENT_CHAIR_SEAT_HEIGHT_METERS, 
  planStationEquipmentMounts,prepareLoadedEnvironmentShell, 
  REAL_EQUIPMENT_GLTF_BY_ID,resolveStationInteriorLightingVariantId, roomPropColourNumbers, 
  roomPropSuppressedByFixtureOwnership,STRETCHER_DECK_TOP_METERS, 
  type AssembledStationApiClient as StationApiClient,
  stampRoomPropAliasesOnEquipmentRoot,
  stampSuppressedDeclaredEquipmentOntoFixtures,stationContextForScenario, 
  syncRemoteAssembledPhase,} from "@openclinxr/xr-station";
import {
  assembleStationScene,
  buildStationRoomShell,
  actorNameplateLabel as packageActorNameplateLabel,
  runtimeGeneratedSceneObjectName as packageRuntimeGeneratedSceneObjectName,
  type StationRoomResult,
  stageStationActors,
  wireStationPointerInteraction,
} from "@openclinxr/xr-station-room";
import { applyEnvironmentAffectCue } from "@openclinxr/xr-station-room/station-environment-affect-cue";

const caseOwnedBedsideApproach = createStationBedsideApproachState();

import {
  type applyPedsActorPlayerSequenceListenerCues as applyPackagePedsActorPlayerSequenceListenerCues,
  buildHumanoidSpeechEvidence as buildPackageTraceHumanoidSpeechEvidence,
  buildRuntimeReproducibilityEvidence as buildPackageTraceRuntimeReproducibilityEvidence,
  createFrameAccumulator as createPackageTraceFrameAccumulator,
  createTraceSelectLatencyRecorder as createPackageTraceSelectLatencyRecorder,
  formatActorPlayerRuntimeMetadataSummary as formatPackageTraceActorPlayerRuntimeMetadataSummary,
  formatEnvironmentRoomSummary as formatPackageTraceEnvironmentRoomSummary,
  formatLearnerRuntimeUseGate as formatPackageTraceLearnerRuntimeUseGate,
  formatMaterializationAttachmentSummary as formatPackageTraceMaterializationAttachmentSummary,
  formatRemainingRuntimeBlockerReasons as formatPackageTraceRemainingRuntimeBlockerReasons,
  formatRuntimePostureLane as formatPackageTraceRuntimePostureLane,
  formatRuntimeReadinessDecision as formatPackageTraceRuntimeReadinessDecision,
  formatTechnicalGapStatus as formatPackageTraceTechnicalGapStatus,
  formatTraceInteractionEvidenceSummary as formatPackageTraceTraceInteractionEvidenceSummary,
  pedsActorPlayerRuntimeTurns as pedsPackageActorPlayerRuntimeTurns,
  type recordPedsActorPlayerRuntimePlaybackEvidence as recordPackagePedsActorPlayerRuntimePlaybackEvidence,
  recordFrame as recordPackageTraceFrame,
  recordTraceSelectLatency as recordPackageTraceTraceSelectLatency,
  ROOM_ENVIRONMENTAL_REALISM_CUE_IDS as roomPackageEnvironmentalRealismCueIds,
  updateEnvironmentStateForTrace as updatePackageTraceEnvironmentStateForTrace,
  updateManualEvidencePanel as updatePackageTraceManualEvidencePanel,
  updateTraceReadiness as updatePackageTraceReadiness,
  updateRuntimePosturePanel as updatePackageTraceRuntimePosturePanel,
  updateTraceActionHandoffEvidence as updatePackageTraceTraceActionHandoffEvidence,
  updateTraceInteractionEvidenceSummary as updatePackageTraceTraceInteractionEvidenceSummary,
  updateXrStatus as updatePackageTraceXrStatus,
} from "@openclinxr/xr-trace-readiness";
import {
  type AnimationClip,
  type AnimationMixer,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
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
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import {
  applyEdBayVisibleComparatorCameraPose,
  frameComparatorCaptureOnNamedActor as frameComparatorCaptureOnNamedActorImpl,
  isDeterministicCaptureClock,
  isEdBayVisibleCaptureMode,
  recordEdBayVisibleCameraPose,
  setComparatorCaptureCamera,
  setComparatorCaptureSceneRoot,
} from "./capture-comparator.js";
import { bootLearnerRuntimeFromAssembledExam, type PinnedEncounterBundleRuntimeTrace, resolveAssembledExamPinnedBundleId } from "./encounter-bundle-boot/index.js";
import { generatedHumanoidSourceProvenance } from "./generated-humanoid-source-provenance.js";
import { applyStationInteriorLightingForEnvironment } from "./lighting-rig-runtime.js";
import {
  type PedsAdaptiveDialogueBranchResolution,
  resolvePedsAdaptiveDialogueBranch,
} from "./peds-adaptive-dialogue-policy.js";
import { isPedsAsthmaScenario, learnerVisiblePedsDialogueForTraceTag } from "./peds-authored-turn-surface.js";
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

type XrSession = XrSessionLike & {
  addEventListener(type: "end", listener: () => void, options?: { once?: boolean }): void;
  end(): Promise<void>;
};

type RuntimeWebXrSupportEvidence = ManualPerformanceReproducibilityEvidence["webXr"];
let latestRuntimeInteractionEvidence: RuntimeInteractionEvidence | null = null;

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


type GeneratedRuntimeDrive = {
  locomotion?: boolean | number | string | GeneratedDriveScalarValue | null;
  gaze?: boolean | number | string | GeneratedDriveScalarValue | null;
  gazeAversion?: boolean | number | string | GeneratedDriveScalarValue | null;
  lipSync?: boolean | number | string | GeneratedDriveScalarValue | null;
  lipSyncViseme?: boolean | number | string | GeneratedDriveScalarValue | null;
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
  data?: PackageXrInputSourceWithGamepad;
};

type OpenClinXrXrEntryEvidence = {
  sessionMode: "immersive-vr";
  attempts: number;
  lastStatus: "not_requested" | "requesting" | "started" | "ended" | "failed";
  lastRequestedAtMs: number | null;
  lastUpdatedAtMs: number;
  lastError: string | null;
};

type OpenClinXrExamFlowEvidence = PackageOpenClinXrExamFlowEvidence;

type ExamRunStationOutcome = PackageExamRunStationOutcome;

type OpenClinXrExamRunSummaryEvidence = PackageOpenClinXrExamRunSummaryEvidence;

type OpenClinXrExamFormRunEvidence = PackageOpenClinXrExamFormRunEvidence;

type StationSceneRuntime = {
  startImmersiveSession(): Promise<void>;
};

type ActiveRuntimeAssetBundleSource = LearnerRuntimeUseGateEvidence["activeBundleSource"];

declare global {
  interface Window {
    __openClinXrMouthGazePoseComparatorEvidence?: PackageMouthGazePoseComparatorEvidenceRecord;
    __openClinXrRuntimeHumanoidActingCueEvidence?: PackageRuntimeHumanoidActingCueEvidenceRecord;
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
    // Comparator + ED-bay-visible window fields live in capture-comparator.ts.
    __openClinXrEnvironmentStateEvidence?: EnvironmentStateEvidence;
    __openClinXrHumanoidSpeechEvidence?: HumanoidSpeechEvidence;
    __openClinXrLiveActorTurnConsumption?: LiveActorTurnConsumption;
    __openClinXrCaseDefinedHumanoidPerformanceContractEvidence?: CaseDefinedHumanoidPerformanceContractEvidence;
    __openClinXrActorPlayerRuntimeMetadataSummary: ActorPlayerRuntimeMetadataSummary | undefined;
    __openClinXrPedsActorPlayerRuntimePlaybackEvidence?: PedsActorPlayerRuntimePlaybackEvidence;
    __openClinXrPedsAdaptiveDialogueEvidence?: PedsAdaptiveDialogueEvidence;
    __openClinXrConversationTurnStateEvidence?: ConversationTurnStateEvidence;
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
    __openClinXrPinnedEncounterBundleBootEvidence?: PinnedEncounterBundleRuntimeTrace;
    __openClinXrLastStationSceneBootErrorStack?: string;
    __openClinXrExamFlowEvidence?: OpenClinXrExamFlowEvidence;
    __openClinXrExamRunSummaryEvidence?: OpenClinXrExamRunSummaryEvidence;
    __openClinXrExamFormRunEvidence?: OpenClinXrExamFormRunEvidence;
    __openClinXrDynamicSceneObjectNamingEvidence?: DynamicSceneObjectNamingEvidence;
    __openClinXrRoleDistinctHumanoidCueEvidence?: RoleDistinctHumanoidCueEvidence;
     __openClinXrPediatricRespiratoryEquipmentCueEvidence?: PediatricRespiratoryEquipmentCueEvidence;
    __openClinXrDeclaredEquipmentMountEvidence?: DeclaredEquipmentMountEvidence;
    __openClinXrGltfEnvContainer?: Group;
    __openClinXrReusableExteriorAnteroom?: Group | null;
      __openClinXrPedsDrive?: GeneratedRuntimeDrive;
      __openClinXrPortalTransitionEvidence?: PackagePortalTransitionEvidence;
   }
 }

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

const defaultStaticGeneratedLearnerRuntimeAssetBundleScenarioId = "ed_chest_pain_priority_v1";

window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence = buildPackageCaseDefinedHumanoidPerformanceContractEvidence(selectedScenarioId());
window.__openClinXrActorPlayerRuntimeMetadataSummary = buildActorPlayerRuntimeMetadataSummary();

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

const runtimeEquipmentSlotsByAssetId = new Map<string, Group>();
// The bundle follows the SELECTED scenario, and the boot bindings resolve by ROLE. Both used to
// be ED literals, so every other case staged the ED cast while the runtime merely recorded a
// scenario_mismatch (:705-715) — measured on the loaded humanoid, which made the authored clinic
// placement unreachable and the brief's §7 step 2 impossible to exercise.
let encounterRuntimeAssetBundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
  scenarioId: selectedScenarioId(),
});
let patientRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAssetByRole(encounterRuntimeAssetBundle, ["patient"])?.model,
  "patient",
);
let nurseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAssetByRole(encounterRuntimeAssetBundle, ["nurse", "medical_assistant"])?.model,
  "clinical_staff",
);
let spouseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAssetByRole(encounterRuntimeAssetBundle, ["family_member", "family"])?.model,
  "family_member",
);
let additionalRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
  findRuntimeActorAssetByRole(encounterRuntimeAssetBundle, ["nurse", "medical_assistant"])?.model
    ?? findRuntimeActorAssetByRole(encounterRuntimeAssetBundle, ["patient"])?.model,
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
  window.__openClinXrRuntimeSceneManifestEvidence = buildAppRuntimeSceneManifestEvidence(bundle);
  recordPackageLearnerRuntimeUseGateEvidence(bundle, options.source, options.fallbackReason ?? null);
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
  publishPackageRuntimeActorSlotAssignmentEvidence(bundle, slots);
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
  const assignment = resolvePackageRuntimeSlotAssignment(bundle);
  if (bundle === encounterRuntimeAssetBundle) {
    cachedRuntimeSlotAssignment = assignment;
  }
  return assignment;
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
function comparatorCaptureSubjectActorIdImpl(): string {
  return comparatorPackageCaptureSubjectActorId(assetLoadingContext());
}
function actorNameplateLabel(prefix: string, actorId: string): string {
  return packageActorNameplateLabel(prefix, actorId);
}

function hasVector3(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== "object") return false;
  const vector = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof vector.x === "number" && typeof vector.y === "number" && typeof vector.z === "number";
}

function runtimeActorPlacement(actorId: string, fallback: LearnerRuntimeAssetBundle["sceneManifest"]["actorPlacements"][string], mountedSupportInstanceIds: readonly string[] = []): LearnerRuntimeAssetBundle["sceneManifest"]["actorPlacements"][string] {
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
  const verticalOffsetMeters = seated
    ? seatedVerticalOffsetForSeatHeight(PATIENT_CHAIR_SEAT_HEIGHT_METERS)
    : supine ? supineVerticalOffsetSeed()
      : (placement?.verticalOffsetMeters ?? fallback.verticalOffsetMeters);
  const position = hasVector3(placement?.position) ? placement.position : fallback.position;
  const supported = supportedActorPlacementPosition({
    posture, actorId, slotKind, mountedSupportInstanceIds,
    scenarioId: selectedScenarioId(),
    environmentId: resolveActiveEnvironmentId(),
    resolvedPosition: position,
    ...(placement?.supportInstanceId ? { supportInstanceId: placement.supportInstanceId } : {}), ...(placement?.plantOffsetMeters ? { authoredOffsetMeters: placement.plantOffsetMeters } : {}),
  });
  if (supported.refusalReason) console.warn(`[actor-placement] ${actorId}: ${supported.refusalReason}`);
  return {
    ...fallback, ...placement,
    position: supported.position, placementProvenance: supported.provenance,
    scale: hasVector3(placement?.scale) ? placement.scale : fallback.scale, supportAcceptance: supported.supportAcceptance,
    verticalOffsetMeters,
    labelPrefix: placement?.labelPrefix ?? fallback.labelPrefix,
    posture,
  };
}

function runtimeActorEmbodimentImpl(bundle: LearnerRuntimeAssetBundle, actorId: string): LearnerRuntimeAssetBundle["actors"][number]["embodiment"] | undefined {
  return bundle.actors.find((actor) => actor.actorId === actorId)?.embodiment;
}

function buildAppRuntimeSceneManifestEvidence(bundle: LearnerRuntimeAssetBundle): RuntimeSceneManifestEvidence {
  return buildPackageRuntimeSceneManifestEvidence({
    bundle,
    selectedScenarioId: selectedScenarioId(),
    selectedScenarioMatchesBundle: runtimeBundleMatchesSelectedScenario(bundle),
    actorEmbodimentFor: runtimeActorEmbodimentImpl,
  });
}

function requireEncounterRuntimeAsset(asset: EncounterRuntimeAsset | undefined, assetId: string): EncounterRuntimeAsset {
  if (!asset) {
    throw new Error(`Missing encounter runtime asset ${assetId}`);
  }
  return asset;
}

async function initializeLearnerRuntimeAssetBundle(client: StationApiClient | undefined): Promise<void> {
  const pin = resolveAssembledExamPinnedBundleId({
    queryRuntimeAssetBundleId: new URLSearchParams(window.location.search).get("runtimeAssetBundleId"),
    storedRuntimeAssetBundleId: window.localStorage.getItem("openclinxr.runtimeAssetBundleId"),
  });
  if (pin) {
    const result = await bootLearnerRuntimeFromAssembledExam({
      station: {
        stationId: selectedStationId() ?? "",
        scenarioId: selectedScenarioId(),
        pinnedBundleId: pin,
        localScenarioName: selectedScenarioId(),
      },
      client,
    });
    window.__openClinXrPinnedEncounterBundleBootEvidence = result.runtimeTrace;
    if (result.bundle) {
      useEncounterRuntimeAssetBundle(result.bundle, {
        source: result.evidence.lookupPath === "offline_fixture" ? "local_fixture_fallback" : "api_bundle",
        fallbackReason: result.evidence.fallbackReason,
      });
      recordBootPhase(result.evidence.outcome === "offline_fixture_fallback" ? "learner_runtime_asset_bundle_fallback" : "learner_runtime_asset_bundle_loaded");
      return;
    }
    recordPackageLearnerRuntimeUseGateEvidence(
      encounterRuntimeAssetBundle,
      "api_bundle",
      result.evidence.fallbackReason ?? "pinned_bundle_refused",
    );
    recordBootPhase("learner_runtime_asset_bundle_api_generated_blocked_by_evidence_gates");
    return;
  }
  const bundleId = learnerRuntimeAssetBundleId();
  if (!client) {
    if (await initializeStaticGeneratedLearnerRuntimeAssetBundle()) {
      recordBootPhase("learner_runtime_asset_bundle_static_generated_loaded");
      return;
    }
    recordPackageLearnerRuntimeUseGateEvidence(
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
      recordPackageLearnerRuntimeUseGateEvidence(
        bundle,
        "api_bundle",
        `api_bundle_blocked:${bundle.bundleId}`,
      );
      recordBootPhase("learner_runtime_asset_bundle_api_generated_blocked_by_evidence_gates");
      return;
    }
    if (!runtimeBundleMatchesSelectedScenario(bundle)) {
      recordPackageLearnerRuntimeUseGateEvidence(
        bundle,
        "api_bundle",
        mismatchedRuntimeBundleFallbackReason(bundle, "api_bundle"),
      );
      throw new Error(`api learner runtime asset bundle scenario mismatch: selected ${selectedScenarioId()} bundle ${bundle.scenarioId}`);
    }
    useEncounterRuntimeAssetBundle(bundle, { source: "api_bundle" });
    recordBootPhase("learner_runtime_asset_bundle_loaded");
  } catch (error) {
    if (await initializeStaticGeneratedLearnerRuntimeAssetBundle()) {
      recordBootPhase("learner_runtime_asset_bundle_static_generated_loaded_after_api_fallback", error);
      return;
    }
    recordPackageLearnerRuntimeUseGateEvidence(
      encounterRuntimeAssetBundle,
      "local_fixture_fallback",
      mismatchedRuntimeBundleFallbackReason(encounterRuntimeAssetBundle, "local_fixture_fallback"),
    );
    recordBootPhase("learner_runtime_asset_bundle_fallback", error);
  }
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
      recordPackageLearnerRuntimeUseGateEvidence(
        bundle,
        "static_generated_bundle",
        mismatchedRuntimeBundleFallbackReason(bundle, "static_generated_bundle"),
      );
      recordBootPhase("learner_runtime_asset_bundle_static_generated_scenario_mismatch_suppressed");
      return false;
    }
    if (!shouldUseLearnerRuntimeAssetBundle(bundle)) {
      recordPackageLearnerRuntimeUseGateEvidence(
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
  return isPackageHumanoidMouthGazePoseReviewCaptureMode(
    selectedCaptureMode(),
    isRealGarmentSleeveDeformCapture(),
  );
}

function isRealGarmentSleeveDeformCapture(): boolean {
  return isPackageRealGarmentSleeveDeformCapture(selectedHumanoidSourceComparator());
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
  return isPackagePhysicsClinicalTouchCapture(selectedCaptureMode(), selectedHumanoidSourceComparator());
}

function isDynamicGeneratedEncounterSceneMode(): boolean {
  // #139: "generated learner station" is NOT roomProps.length. Empty scenery is still a
  // generated station; prop-count flipped emptied manifests into debug chrome (reverted 5430b3a).
  // Keep blocked-environment gate. Capture-mode escape hatches still surface markers/panels.
  // Rejected: props|equipment|actors density, dummy prop, three-flag split (peer: overbuild).
  return encounterRuntimeAssetBundle.environment.reviewStatus !== "blocked";
}

function isGeneratedPlaceholderSourceForDifferentScenario(source: string): boolean {
  return isPackageGeneratedPlaceholderSourceForDifferentScenario(
    source,
    encounterRuntimeAssetBundle.scenarioId,
    isDynamicGeneratedEncounterSceneMode(),
    isScenarioSpecificRuntimeFixtureForSelectedScenario,
  );
}

function shouldSuppressGeneratedEquipmentModel(_assetId: string, assetPath: string): boolean {
  // Real library medical-equipment GLBs are shared clinical equipment, never scenario-mismatched placeholders (#140 counterweight; #245 wall clock).
  return shouldPackageSuppressGeneratedEquipmentModel(
    assetPath,
    (path: string) => Object.values(REAL_EQUIPMENT_GLTF_BY_ID).some((fileName) =>
      path.toLowerCase().includes(`/medical-equipment/${fileName.toLowerCase()}`)),
    isGeneratedPlaceholderSourceForDifferentScenario,
  );
}

function refreshDeclaredEquipmentMountEvidenceFromSceneImpl(): void {
  refreshPackageDeclaredEquipmentMountEvidenceFromScene(collectDeclaredEquipmentEvidenceFromScene);
}

function shouldShowRuntimeAffordanceMarkers(): boolean {
  return shouldPackageShowRuntimeAffordanceMarkers(selectedCaptureMode(), isDynamicGeneratedEncounterSceneMode());
}

function shouldShowPrimitiveAssetFallbacks(): boolean {
  return shouldPackageShowPrimitiveAssetFallbacks(selectedCaptureMode(), isDynamicGeneratedEncounterSceneMode());
}

function shouldShowInSceneEvidencePanels(): boolean {
  return shouldPackageShowInSceneEvidencePanels(selectedCaptureMode(), isDynamicGeneratedEncounterSceneMode());
}

function shouldShowActorRealismRequirementPanel(evidence: HumanoidSpeechEvidence | null = window.__openClinXrHumanoidSpeechEvidence ?? null): boolean {
  return shouldPackageShowActorRealismRequirementPanel(
    selectedCaptureMode(),
    evidence?.activeActorRuntimeRealismRequirement ?? null,
    {
      cleanComparatorCapture: shouldUseCleanHumanoidSourceComparatorCapture(),
      edBayVisibleCapture: isEdBayVisibleComparatorCapture(),
      evidencePanelsVisible: shouldShowInSceneEvidencePanels(),
      mouthGazePoseReview: isHumanoidMouthGazePoseReviewCaptureMode(),
    },
  );
}

function shouldShowInSceneIdentityLabels(): boolean {
  return shouldPackageShowInSceneIdentityLabels(selectedCaptureMode(), isDynamicGeneratedEncounterSceneMode());
}

function isSceneOnlyVisualReviewCaptureMode(): boolean {
  return isPackageSceneOnlyVisualReviewCaptureMode(
    selectedCaptureMode(),
    shouldUseCleanHumanoidSourceComparatorCapture() && !isEdBayVisibleComparatorCapture(),
  );
}

function shouldRenderRoomPropInVisualReview(prop: EncounterRuntimeRoomProp): boolean {
  return shouldPackageRenderRoomPropInVisualReview(prop, isSceneOnlyVisualReviewCaptureMode());
}

function uiXrQueryDeps(): ExamRunQueryDeps {
  return {
    readQueryParam: (name: string) => new URLSearchParams(window.location.search).get(name),
    readStoredValue: (key: string) => window.localStorage.getItem(key),
    writeStoredValue: (key: string, value: string) => {
      window.localStorage.setItem(key, value);
    },
  };
}

function uiXrExamStationContext(): ExamStationContext {
  return examFlowExamStationContext();
}

function configuredExamSequence(): string[] {
  return examFlowConfiguredExamSequence();
}

function positiveIntegerQueryParam(name: string, fallback: number): number {
  return packagePositiveIntegerQueryParam(uiXrQueryDeps(), name, fallback);
}

function booleanQueryParam(name: string, fallback: boolean): boolean {
  return packageBooleanQueryParam(uiXrQueryDeps(), name, fallback);
}

function configuredExamRunId(): string {
  return examFlowConfiguredExamRunId();
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

type GeneratedHumanoidAnimationSlot = PackageGeneratedHumanoidAnimationSlot;
type HumanoidExpressionEmotion = PackageHumanoidExpressionEmotion;
type HumanoidExpressionWeights = PackageHumanoidExpressionWeights;
type HumanoidEmotionExpressionState = PackageHumanoidEmotionExpressionState;
type HumanoidSpeechPlayback = PackageHumanoidSpeechPlayback;
type HumanoidDialogueGazeTarget = PackageHumanoidDialogueGazeTarget;
type HumanoidDialogueEmotionContext = PackageHumanoidDialogueEmotionContext;
type PedsActorPlayerRuntimeTurn = PedsActorPlayerRuntimeTurnFromStore;
type PedsActorPlayerRuntimeSequenceEvidence = PedsActorPlayerRuntimeSequenceEvidenceFromStore;
type MouthGazePoseComparatorEvidence = PackageMouthGazePoseComparatorEvidenceRecord;
type PedsAdaptiveDialogueEvidence = PedsAdaptiveDialogueEvidenceFromStore;
type PedsActorPlayerRuntimePlaybackEvidence = PedsActorPlayerRuntimePlaybackEvidenceFromStore;
const generatedHumanoidAnimationSlots: GeneratedHumanoidAnimationSlot[] = [];
const generatedHumanoidAnimationSlotsByActorId = new Map<string, GeneratedHumanoidAnimationSlot>();
const generatedHumanoidActorSlotsByActorId = new Map<string, Group>();
const virtualDeviceActorSlotsByActorId = new Map<string, Group>();
const activeVirtualDeviceSpeechByActorId = new Map<string, HumanoidSpeechPlayback>();
const humanoidAnimationContext: PackageHumanoidAnimationRuntimeContext = {
  slots: generatedHumanoidAnimationSlots,
  slotsByActorId: generatedHumanoidAnimationSlotsByActorId,
  actorSlotsByActorId: generatedHumanoidActorSlotsByActorId,
  virtualDeviceSlotsByActorId: virtualDeviceActorSlotsByActorId,
  activeVirtualDeviceSpeechByActorId,
  runtimePatientActorId: () => runtimePatientActorId(),
  runtimeFamilyActorId: () => runtimeFamilyActorId(),
  runtimeClinicalTeamActorId: () => runtimeClinicalTeamActorId(),
  runtimeActorRole: (actorId: string) => runtimeActorRole(actorId),
  isPediatricAsthmaRuntimeScenario: () => isPediatricAsthmaRuntimeScenario(),
  shouldUseCleanHumanoidSourceComparatorCapture: () => shouldUseCleanHumanoidSourceComparatorCapture(),
  humanoidDialogueDurationMs: (phonemeCount: number) => humanoidDialogueDurationMs(phonemeCount),
  applyIdlePosture: (root: Group) => { applyGeneratedHumanoidClinicalIdlePosture(root); },
  applyRolePosture: (root: Group, actorId: string) => { applyPackageGeneratedHumanoidRoleSpecificPosture(uiXrRolePostureContext(), root, actorId); },
  seatedClipPerforming: (root: Group, actorId: string) => seatedRoleClipAutoLoopActive(root, actorId),
  resolveGazeTargetWorld: (speech: PackageHumanoidSpeechPlayback, camera: PerspectiveCamera) => {
    if (speech.gazeTargetKind === "actor" && speech.gazeTargetActorId) {
      const targetActorSlot = generatedHumanoidActorSlotsByActorId.get(speech.gazeTargetActorId);
      if (targetActorSlot) {
        const position = targetActorSlot.getWorldPosition(new Vector3());
        position.y += 1.18;
        return position;
      }
    }
    return camera.getWorldPosition(new Vector3());
  },
  normalizeLiveEmotion: (emotion: string) => normalizePedsActorPlayerEmotion(emotion),
  liveTurnForCue: (cue: string) => {
    const live = resolveLiveActorTurnForTrace(cue);
    return live ? { faceEmotion: live.faceEmotion, caption: live.caption } : undefined;
  },
  bundleTurnsForScenario: () => pedsActorPlayerBundleDialogueTurns().map((turn) => ({
    actorId: turn.actorId,
    text: turn.text,
    cue: turn.cue,
  })),
  runtimeTurnForTraceTag: (tag: string) => runtimeDialogueTurnForTraceTag(tag),
  isDeterministicCaptureClock: () => isDeterministicCaptureClock(),
  isMouthGazePoseReviewCaptureMode: () => isHumanoidMouthGazePoseReviewCaptureMode(),
  selectedCaptureMode: () => selectedCaptureMode(),
  selectedHumanoidSourceComparator: () => selectedHumanoidSourceComparator(),
  scenarioIdForEvidence: () => encounterRuntimeAssetBundle.scenarioId,
  comparatorScenarioId: (comparator: string) => comparator === "ed_anny_real_garment_patient" ? "ed_chest_pain_priority_v2" : "peds_asthma_parent_anxiety_v1",
  assetPathForSlot: (slot: PackageGeneratedHumanoidAnimationSlot) => typeof slot.root.userData.openClinXrAssetPath === "string" ? slot.root.userData.openClinXrAssetPath : "",
  animationPlaybackForSlot: (slot: PackageGeneratedHumanoidAnimationSlot) => typeof slot.root.userData.openClinXrAnimationPlayback === "string" ? slot.root.userData.openClinXrAnimationPlayback : undefined,
  morphTargetAppliedTargetCount: (slot: PackageGeneratedHumanoidAnimationSlot) => {
    const cue = slot.root.userData.openClinXrMorphTargetRuntimeCue as { appliedTargetCount?: number } | undefined;
    return cue?.appliedTargetCount ?? 0;
  },
  visemeTimelineComparatorEvidencePresent: (slot: PackageGeneratedHumanoidAnimationSlot) => Boolean(slot.root.userData.openClinXrVisemeTimelineComparatorEvidence),
  emotionTransitionCuePresent: (slot: PackageGeneratedHumanoidAnimationSlot) => Boolean(slot.root.userData.openClinXrEmotionExpressionTransitionCue),
  currentSpeechEvidence: () => window.__openClinXrHumanoidSpeechEvidence ?? undefined,
  recordActingCueEvidence: (actorCues: PackageHumanoidActingCueRecord[]) => {
    window.__openClinXrRuntimeHumanoidActingCueEvidence = {
      source: "window.__openClinXrRuntimeHumanoidActingCueEvidence",
      scenarioId: encounterRuntimeAssetBundle.scenarioId,
      actorCount: actorCues.length,
      activeCueIds: Array.from(new Set(actorCues.flatMap((cue) => cue.cueIds))).sort(),
      actorCues,
      notEvidenceFor: ["quest_readiness", "clinical_validity", "scoring_validity", "production_readiness", "animation_quality"],
    };
  },
};
const actorDialogueStore = createActorDialogueStore({
  encounterBundle: () => encounterRuntimeAssetBundle,
  initialDialogueText: () => initialDialogueText,
  isPediatricAsthmaRuntimeScenario: () => isPediatricAsthmaRuntimeScenario(),
  isSelectedScenarioRuntimeBundleMismatch: () => isSelectedScenarioRuntimeBundleMismatch(),
  selectedScenarioId: () => selectedScenarioId(),
  selectedHumanoidSourceComparator: () => selectedHumanoidSourceComparator(),
  runtimePatientActorId: () => runtimePatientActorId(),
  runtimeClinicalTeamActorId: () => runtimeClinicalTeamActorId(),
  runtimeFamilyActorId: () => runtimeFamilyActorId(),
  actorIdForTraceTag: (tag, scenarioId) => actorIdForTraceTag(tag, scenarioId),
  recordBootPhase: (phase, error) => { recordBootPhase(phase, error); },
  nowMs: () => performance.now(),
  scheduleTimeout: (callback, delayMs) => { window.setTimeout(callback, delayMs); },
  scheduleInterval: (callback, delayMs) => { window.setInterval(callback, delayMs); },
  setDialogueLineText: (text) => { dialogueLine.textContent = text; },
  speechEvidence: () => window.__openClinXrHumanoidSpeechEvidence ?? undefined,
  writeSpeechEvidence: (evidence) => { window.__openClinXrHumanoidSpeechEvidence = evidence; },
  ensureMissingActorSpeechEvidence: () => {
    window.__openClinXrHumanoidSpeechEvidence ??= buildHumanoidSpeechEvidence(null, null, null, [], [], null);
  },
  writeAdaptiveEvidence: (evidence) => { window.__openClinXrPedsAdaptiveDialogueEvidence = evidence; },
  fallbackTurns: () => pedsActorPlayerRuntimeTurns(),
  liveTurnForTrace: (tag) => resolveLiveActorTurnForTrace(tag),
  liveFaceEmotionForCue: (cue) => resolveLiveActorTurnForTrace(cue)?.faceEmotion,
  animationSlots: () => generatedHumanoidAnimationSlots,
  animationSlotForActor: (actorId) => generatedHumanoidAnimationSlotsByActorId.get(actorId),
  slotHasActor: (actorId) => generatedHumanoidAnimationSlotsByActorId.has(actorId),
  roleClipNameForActor: (actorId) => rolePackageAnimationClipNamesForActor(clipNameContext(), actorId)[0] ?? "",
  listenerCueContext: () => pedsActorListenerCuePanelContext(),
  playbackPanelContext: () => pedsActorPlayerPlaybackPanelContext(),
  virtualDeviceSpeechByActorId: () => activeVirtualDeviceSpeechByActorId,
  runtimeEmbodimentForActor: (actorId) => runtimeActorEmbodimentImpl(encounterRuntimeAssetBundle, actorId),
  reviewCaptureMode: () => isHumanoidMouthGazePoseReviewCaptureMode(),
  responseClipNames: (actorId) => clinicalPackageTouchResponseClipNamesForActor(clipNameContext(), actorId),
  playClip: (actorId, clipName) => playOneShotResponseClip(actorId, clipName),
  playFrozenTurn: (plan, execution, gazeTarget, requirement) =>
    playLiveFrozenActorTurn(plan, execution, gazeTarget, requirement),
  startFaceTransition: (actorId, emotion, nowMs) => {
    const live = generatedHumanoidAnimationSlotsByActorId.get(actorId);
    if (live) startHumanoidEmotionTransition(live, emotion, nowMs);
  },
});
function initialDialogueTextForSelectedScenario(): string {
  return actorDialogueStore.initialDialogueTextForSelectedScenario();
}
function runtimeDialogueTurnForTraceTag(tag: string) {
  return actorDialogueStore.runtimeDialogueTurnForTraceTag(tag);
}
function schedulePedsActorPlayerRuntimePlaybackIfReady(): void {
  actorDialogueStore.schedulePedsActorPlayerRuntimePlaybackIfReady();
}
function triggerPedsAdaptiveDialogueBranch(
  branch: PedsAdaptiveDialogueBranchResolution,
  triggerSource: PedsActorPlayerRuntimePlaybackEvidence["latestTriggerSource"],
): boolean {
  return actorDialogueStore.triggerPedsAdaptiveDialogueBranch(branch, triggerSource);
}
function triggerPedsActorPlayerRuntimeTurnForTrace(traceTag: string): boolean {
  return actorDialogueStore.triggerPedsActorPlayerRuntimeTurnForTrace(traceTag);
}
function _dedupePedsActorPlayerRuntimeTurns(turns: PedsActorPlayerRuntimeTurn[]): PedsActorPlayerRuntimeTurn[] {
  return actorDialogueStore.dedupePedsActorPlayerRuntimeTurns(turns);
}
function pedsActorPlayerBundleDialogueTurns(): PedsActorPlayerRuntimeTurn[] {
  return actorDialogueStore.pedsActorPlayerBundleDialogueTurns();
}
function normalizePedsActorPlayerEmotion(emotion: string): HumanoidExpressionEmotion {
  return actorDialogueStore.normalizePedsActorPlayerEmotion(emotion);
}
function _playPedsActorPlayerRuntimeTurn(
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
  actorDialogueStore.playPedsActorPlayerRuntimeTurn(turn, input);
}
function _applyPedsActorPlayerSequenceListenerCues(
  activeTurn: PedsActorPlayerRuntimeTurn,
  sequence: PedsActorPlayerRuntimeSequenceEvidence | null,
  nowMs: number,
): { actorIds: string[]; coupledSignalIds: string[] } {
  return actorDialogueStore.applyPedsActorPlayerSequenceListenerCues(activeTurn, sequence, nowMs);
}
function _playPedsActorPlayerRuntimeSequence(sequence: PedsActorPlayerRuntimeSequenceEvidence, fallbackTurns: PedsActorPlayerRuntimeTurn[]): void {
  actorDialogueStore.playPedsActorPlayerRuntimeSequence(sequence, fallbackTurns);
}
function _recordPedsActorPlayerRuntimePlaybackEvidence(input: {
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
  actorDialogueStore.recordPedsActorPlayerRuntimePlaybackEvidence(input);
}
function triggerHumanoidDialogueForTrace(tag: string, text: string): void {
  actorDialogueStore.triggerHumanoidDialogueForTrace(tag, text);
}
function triggerHumanoidDialogue(
  actorId: string,
  text: string,
  gazeTarget: HumanoidDialogueGazeTarget,
  explicitEmotion?: HumanoidExpressionEmotion,
  actorRuntimeRealismRequirement?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
  emotionSource?: HumanoidDialogueEmotionContext["source"],
): void {
  actorDialogueStore.triggerHumanoidDialogue(actorId, text, gazeTarget, explicitEmotion, actorRuntimeRealismRequirement, emotionSource);
}
function humanoidDialogueDurationMs(phonemeCount: number): number {
  return actorDialogueStore.humanoidDialogueDurationMs(phonemeCount);
}
function _scenarioDialogueEmotionContext(
  actorId: string,
  text: string,
  explicitEmotion?: HumanoidExpressionEmotion,
  emotionSource?: HumanoidDialogueEmotionContext["source"],
): HumanoidDialogueEmotionContext {
  return actorDialogueStore.scenarioDialogueEmotionContext(actorId, text, explicitEmotion, emotionSource);
}
function localDialogueActorIdForTraceTag(tag: string): string | undefined {
  return actorDialogueStore.localDialogueActorIdForTraceTag(tag);
}
function localDialogueGazeTargetForTraceTag(tag: string): HumanoidDialogueGazeTarget {
  return actorDialogueStore.localDialogueGazeTargetForTraceTag(tag);
}
const environmentReactiveProps = new Map<string, Group>();
let lastObservedLocomotionSummary: {
  source: NonNullable<OpenClinXrInputEvidence["activeLocomotionSource"]>;
  distanceMeters: number;
  turnRadians: number;
  atMs: number;
} | null = null;
const roomEnvironmentalRealismCueIds = roomPackageEnvironmentalRealismCueIds;


function formatUnknownError(error: unknown): string {
  return formatPackageUnknownError(error);
}

recordPackageXrEntryEvidence("not_requested");

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
window.__openClinXrRuntimeSceneManifestEvidence = buildAppRuntimeSceneManifestEvidence(encounterRuntimeAssetBundle);
let remoteStationRunId: string | undefined;
let immersiveSessionActive = false;
const traceSelectLatencyRecorder = createPackageTraceSelectLatencyRecorder();
function currentTraceSelectLatencyMs(): number | null {
  return traceSelectLatencyRecorder.currentLatencyMs();
}
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
const examPhaseTraceStorageKey = `openclinxr.canonicalExamPhaseTrace.${examRunId}.${examScenarioId}`;
const examStationRunId = `station_run_${examRunId}_${examScenarioId}_${examScenarioIndex + 1}`;
const examNoteStorageKey = `openclinxr.patientNote.${examRunId}.${examScenarioId}`;
const examRunSummaryStorageKey = `openclinxr.examRunSummary.${examRunId}`;
let examFormRunState: ExamFormRunState | null = null;

const examFormRunPersistenceSink = stationApi ? createStationApiPersistenceSink(stationApi) : undefined;

const examFlowStore = createExamFlowStore(
  {
    examRunId,
    stationRunId: examStationRunId,
    scenarioId: examScenarioId,
    stationOrder: examScenarioIndex + 1,
    encounterSeconds: examEncounterDurationSeconds,
    noteSeconds: examNoteDurationSeconds,
    autoAdvanceOnNoteTimeout: examAutoAdvanceOnNoteTimeout,
  },
  {
    getElapsedSecond: (): number => state.elapsedSecond,
    getFormElapsedSecond: (): number => formElapsedSecondForCurrentStation(),
    getNoteText: (): string => patientNoteText.value,
    getFormRunState: (): ExamFormRunState | null => examFormRunState,
    setFormRunState: (next: ExamFormRunState | null): void => {
      examFormRunState = next;
    },
    getPersistenceSink: () => examFormRunPersistenceSink,
    getNextScenarioId: (): string | null => nextExamScenarioId(),
    navigateToScenario: (nextScenarioId: string): void => {
      navigateToExamScenario(nextScenarioId);
    },
    syncRemotePhase: ({ atSecond, noteText, kind }: { atSecond: number; noteText: string; kind: "end_encounter" | "submit_note" | "encounter_timer_elapsed" | "note_timer_elapsed" }): void => {
      void syncRemoteAssembledPhase({
        client: stationApi,
        stationRunId: remoteStationRunId,
        kind,
        atSecond,
        noteText,
      });
    },
    persistPhaseTrace: (store: import("@openclinxr/xr-runtime-state").LearnerCanonicalPhaseTraceStore): void => {
      window.localStorage.setItem(
        examPhaseTraceStorageKey,
        JSON.stringify({ persistedEvents: store.persistedEvents, localEvents: store.localEvents }),
      );
    },
    readPhaseTraceJson: (): string | null => window.localStorage.getItem(examPhaseTraceStorageKey),
    persistOutcomes: (outcomes: ExamRunStationOutcome[]): void => {
      window.localStorage.setItem(examRunSummaryStorageKey, JSON.stringify(outcomes));
    },
    readOutcomes: (): ExamRunStationOutcome[] => readExamRunSummaryOutcomes(),
    updateFormEvidence: (): void => {
      updateExamFormRunEvidence();
    },
  } satisfies ExamFlowRuntimeAccessors,
);

function examFlowExamStationContext(): ExamStationContext {
  return {
    sequence: examNormalizedSequence,
    scenarioIndex: examScenarioIndex,
    scenarioId: examScenarioId,
    examRunId,
    timing: {
      encounterSeconds: examEncounterDurationSeconds,
      noteSeconds: examNoteDurationSeconds,
      autoAdvanceOnNoteTimeout: examAutoAdvanceOnNoteTimeout,
    },
  };
}

function examFlowConfiguredExamSequence(): string[] {
  return packageConfiguredExamSequence(uiXrQueryDeps());
}

function examFlowConfiguredExamRunId(): string {
  return packageConfiguredExamRunId(uiXrQueryDeps());
}

examFormRunState = createPackageFormRunState({
  examRunId,
  scenarioId: examScenarioId,
  normalizedSequence: examNormalizedSequence,
});
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
    buildPackageCaseDefinedHumanoidPerformanceContractEvidence(selectedScenarioId());
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
void (async () => {
  await initializeRemoteTraceSession(stationApi);
  await bootLearnerExamFormFromApi({
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
      updateExamFlowEvidence();
    },
    presentationSink: examFlowCaseSource,
    phaseTrace: {
      getStore: () => examFlowStore.getPhaseStore(),
      setStore: (next) => {
        window.localStorage.setItem(
          examPhaseTraceStorageKey,
          JSON.stringify({ persistedEvents: next.persistedEvents, localEvents: next.localEvents }),
        );
      },
      presentationSink: examFlowAdvance,
      ...(remoteStationRunId ? { stationRunId: remoteStationRunId } : {}),
    },
  });
})();
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
patientNoteText.value = window.localStorage.getItem(examNoteStorageKey) ?? "";

patientNoteText.addEventListener("input", () => {
  window.localStorage.setItem(examNoteStorageKey, patientNoteText.value);
  updateExamFlowEvidence();
});

function applyExamFlowIntent(kind: "end_encounter" | "submit_note" | "encounter_timer_elapsed" | "note_timer_elapsed"): void {
  examFlowStore.applyIntent(kind);
}

endEncounterButton.addEventListener("click", () => {
  applyExamFlowIntent("end_encounter");
});

submitNoteButton.addEventListener("click", () => {
  applyExamFlowIntent("submit_note");
});

copyEvidenceButton.addEventListener("click", () => {
  const payload = updateManualEvidencePanel();
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(payload)
      .then(() => {
        examFlowStore.setCopyDisposition("copied");
        updateManualEvidencePanel();
      })
      .catch(() => {
        examFlowStore.setCopyDisposition("copy_blocked");
        updateManualEvidencePanel();
      });
    return;
  }
  examFlowStore.setCopyDisposition("clipboard_unavailable");
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
  return packageNextExamScenarioId(examFormRunState, {
    sequence: examNormalizedSequence,
    scenarioIndex: examScenarioIndex,
  });
}

function navigateToExamScenario(nextScenarioIdParam: string): void {
  window.location.assign(
    packageBuildExamNavigationHref(window.location.href, nextScenarioIdParam, uiXrExamStationContext()),
  );
}

function formElapsedSecondForCurrentStation(): number {
  return packageFormElapsedSecondForCurrentStation(examFormRunState, state.elapsedSecond);
}

function updateExamFormRunEvidence(): OpenClinXrExamFormRunEvidence | null {
  const evidence = buildPackageExamFormRunEvidence(examFormRunState);
  if (!evidence) {
    delete window.__openClinXrExamFormRunEvidence;
    return null;
  }
  window.__openClinXrExamFormRunEvidence = evidence;
  return evidence;
}

function readExamRunSummaryOutcomes(): ExamRunStationOutcome[] {
  return readPackageExamRunSummaryOutcomes(
    (key: string) => window.localStorage.getItem(key),
    examRunSummaryStorageKey,
  );
}

function updateExamRunSummaryEvidence(): OpenClinXrExamRunSummaryEvidence {
  const evidence = buildPackageExamRunSummaryEvidence({
    examRunId,
    totalScenarios: examNormalizedSequence.length,
    outcomes: readExamRunSummaryOutcomes(),
    formRunState: examFormRunState,
  });
  window.__openClinXrExamRunSummaryEvidence = evidence;
  return evidence;
}

function _recordExamRunStationOutcome(): void {
  const formSecond = formElapsedSecondForCurrentStation();
  const formRunState = examFormRunState;
  if (formRunState) {
    const phaseView = viewLearnerCanonicalExamPhase(examFlowStore.getPhaseStore());
    const advanced = recordStationOutcomeOnFormRun(formRunState, {
      phase: phaseView.phase,
      noteSubmitted: phaseView.noteSubmitted,
      advanceReason: examFlowStore.getRefusalReason() ?? phaseView.lastAdvanceReason,
      formSecond,
    });
    if (advanced) {
      examFormRunState = advanced;
      updateExamFormRunEvidence();
      if (examFormRunPersistenceSink) {
        void persistPackageFormRunQueueSnapshot(examFormRunState, examFormRunPersistenceSink, {
          snapshotId: `queue_snapshot_${examRunId}_station_${examScenarioIndex + 1}`,
        }).catch(() => {
          // Best-effort; local outcomes still recorded.
        });
      }
    }
  }

  const outcomes = readExamRunSummaryOutcomes();
  const withoutCurrent = recordPackageStationOutcome({
    scenarioId: examScenarioId,
    scenarioIndex: examScenarioIndex,
    formRunState: examFormRunState,
    phaseView: viewLearnerCanonicalExamPhase(examFlowStore.getPhaseStore()),
    refusalReason: examFlowStore.getRefusalReason(),
    noteTextLength: patientNoteText.value.trim().length,
    formSecond,
    outcomes,
  });
  window.localStorage.setItem(examRunSummaryStorageKey, JSON.stringify(withoutCurrent));
  updateExamRunSummaryEvidence();
}

function updateExamFlowEvidence(): OpenClinXrExamFlowEvidence {
  const nextScenarioId = nextExamScenarioId();
  const phaseView = viewLearnerCanonicalExamPhase(examFlowStore.getPhaseStore());
  const evidence = buildPackageExamFlowEvidence({
    phaseView,
    examRunId,
    scenarioId: examScenarioId,
    scenarioIndex: examScenarioIndex,
    totalScenarios: examNormalizedSequence.length,
    encounterSeconds: examEncounterDurationSeconds,
    noteSeconds: examNoteDurationSeconds,
    autoAdvanceOnNoteTimeout: examAutoAdvanceOnNoteTimeout,
    nextScenarioId,
    refusalReason: examFlowStore.getRefusalReason(),
    elapsedSecond: state.elapsedSecond,
    noteTextLength: patientNoteText.value.trim().length,
  });
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
    : [evidence.fallbackLabel, evidence.lastAdvanceReason ?? "complete encounter, then submit a non-empty patient note"].filter(Boolean).join(" — ");
  endEncounterButton.disabled = evidence.phase !== "encounter";
  submitNoteButton.disabled = evidence.phase !== "note";
  return evidence;
}

function advanceExamFlowForElapsedTime(): void {
  examFlowStore.advanceForElapsedTime();
}

function advanceExamNoteForElapsedTime(): void {
  examFlowStore.advanceNoteForElapsedTime();
}

function recordTraceSelectLatency(
  startedAtMs: number,
  tag: string,
  source: OpenClinXrTraceLatencyEvidence["source"],
): number {
  const latencyMs = recordPackageTraceTraceSelectLatency(
    traceSelectLatencyRecorder,
    startedAtMs,
    tag,
    source,
  );
  window.__openClinXrTraceLatencyEvidence = {
    lastTraceTag: tag,
    lastSelectLatencyMs: latencyMs,
    source,
    measuredAtMs: Number(performance.now().toFixed(2)),
    productionControllerLatencySubstitute: false,
  };
  return latencyMs;
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
      completedAtMs: packageRoundPerformanceNow(),
      selectLatencyMs,
      ...(region ? { region } : {}),
    },
  ];
  updateTraceActionHandoffEvidence();
  void recordRemoteTraceAction(tag, payload);
}

function updateEnvironmentStateForTrace(tag: string): EnvironmentStateEvidence {
  const evidence = updatePackageTraceEnvironmentStateForTrace(
    {
      previousActiveTraceTags: () => window.__openClinXrEnvironmentStateEvidence?.activeTraceTags ?? [],
      equipmentIdsForTag: runtimeEquipmentIdsForTraceTag,
      realismCueIds: [...roomEnvironmentalRealismCueIds],
      applyEnvironmentStateVisuals,
      applyRuntimeEquipmentTraceVisuals,
      environmentStateWritten: (record) => {
        window.__openClinXrEnvironmentStateEvidence = record;
      },
    },
    tag,
  );
  roomStateSummary.textContent = formatPackageTraceEnvironmentRoomSummary(evidence);
  return evidence;
}

function sceneCueScenarioPrefix(): string {
  return `openclinxr.${encounterRuntimeAssetBundle.scenarioId}`;
}

const sceneCueTextPanelEvidence = new Map<string, ReadableVrTextPanelEvidence>();

function sceneCueClinicalPanel(): SceneCueClinicalPanelContext {
  return {
    clinicalPanelObjectName: iwsdkStationSceneObjects.clinicalPanel,
    evidenceStore: sceneCueTextPanelEvidence,
    clinicalPanelLines: clinicalPanelLinesForSelectedStation,
    buildTextPanelEvidence: buildReadableVrTextPanelEvidence,
  };
}

function sceneCueNameplate(): SceneCueNameplateContext {
  return {
    scenarioObjectPrefix: sceneCueScenarioPrefix(),
    shouldShowIdentityLabels: shouldShowInSceneIdentityLabels,
  };
}

function sceneCueHumanoidCues(): SceneCueHumanoidCueContext {
  return {
    scenarioObjectPrefix: sceneCueScenarioPrefix(),
    shouldShowAffordanceMarkers: shouldShowRuntimeAffordanceMarkers,
  };
}

function sceneCueVirtualDevice(): SceneCueVirtualDeviceContext {
  return {
    resolvePlacement: (actorId: string) =>
      runtimeActorPlacement(actorId, {
        slotKind: "family_or_observer",
        position: { x: -2.0, y: 1.05, z: 0.7 },
        scale: { x: 0.72, y: 0.72, z: 0.72 },
        verticalOffsetMeters: 0,
        labelPrefix: "Remote",
      }),
    actorNameplateLabel,
    registerSlot: (id: string, group: Group) => {
      virtualDeviceActorSlotsByActorId.set(id, group);
    },
    buildVirtualDeviceAffordance: buildVirtualDeviceActorAffordance,
  };
}

function sceneCueRoomProps(): SceneCueRoomPropContext {
  return {
    scenarioObjectPrefix: sceneCueScenarioPrefix(),
    createAffordanceMarker: (cueId: string, color: number) => createAffordanceMarker(cueId, color),
    createActorNameplate: (label: string, accentColor: number) => createActorNameplate(label, accentColor),
    roomPropObjectPrefix: `openclinxr.${encounterRuntimeAssetBundle.scenarioId}.room-prop`,
    shouldRenderRoomProp: shouldRenderRoomPropInVisualReview,
    roomPropColourNumbers,
    roomPropSuppressedByFixtureOwnership,
    buildRoomPropGroup,
    hasVector3,
    registerReactiveProp: (propId: string, group: Group) => {
      environmentReactiveProps.set(propId, group);
    },
  };
}

function sceneCueTraceVisuals(): SceneCueTraceVisualContext {
  return {
    equipmentSlots: runtimeEquipmentSlotsByAssetId,
    equipmentIdsForTag: runtimeEquipmentIdsForTraceTag,
    scenarioObjectPrefix: sceneCueScenarioPrefix(),
  };
}

function sceneCueEnvironmentVisuals(): SceneCueEnvironmentVisualContext {
  return { reactiveProps: environmentReactiveProps };
}

function sceneCueNamingEvidence(): SceneCueNamingEvidenceContext {
  return {
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    selectedScenarioId: selectedScenarioId(),
    selectedScenarioMatchesBundle: !isSelectedScenarioRuntimeBundleMismatch(),
    stableIwsdkObjectNames: iwsdkStationSceneObjectNames,
    scenarioObjectPrefix: sceneCueScenarioPrefix(),
  };
}

function sceneCueRoleCueEvidence(): SceneCueRoleCueEvidenceContext {
  return {
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    runtimeActorRole,
  };
}

function sceneCuePediatricEquipment(): SceneCuePediatricEquipmentContext {
  return {
    scenarioObjectPrefix: sceneCueScenarioPrefix(),
    isPediatricScenario: isPediatricAsthmaRuntimeScenario,
  };
}

function sceneCuePediatricEvidence(): SceneCuePediatricCueEvidenceContext {
  return { scenarioId: encounterRuntimeAssetBundle.scenarioId };
}

function sceneCueActorFraming(): SceneCueActorFramingContext {
  return {
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    runtimeActorRole,
    selectedScenarioId,
    skipFraming:
      isHumanoidFaceDetailCaptureMode() || isActorPoseReviewCaptureMode() || isActorCloseRealismCaptureMode(),
    applyActorFraming: applyEncounterActorFraming,
    onWardrobeCue: addGeneratedHumanoidRoleContinuityWardrobeCue,
  };
}

function applyRuntimeEquipmentTraceVisuals(evidence: EnvironmentStateEvidence): void {
  applyPackageRuntimeEquipmentTraceVisuals(sceneCueTraceVisuals(), evidence);
}


function runtimeEquipmentIdsForTraceTag(tag: string): string[] {
  return runtimePackageEquipmentIdsForTag(
    encounterRuntimeAssetBundle.equipment.map((equipment) => equipment.equipmentId),
    tag,
  );
}

function applyEnvironmentStateVisuals(evidence: EnvironmentStateEvidence): void {
  applyPackageEnvironmentStateVisuals(sceneCueEnvironmentVisuals(), evidence);
}

function updateTraceActionHandoffEvidence(): XrTraceActionHandoffEvidence {
  return updatePackageTraceTraceActionHandoffEvidence({
    runtimeState: () => state,
    handoffActions: () => traceActionHandoffActions,
    lastTraceLatencyEvidence: () => window.__openClinXrTraceLatencyEvidence ?? null,
    buildHandoffEvidence: (input) => buildXrTraceActionHandoffEvidence(input),
    roundPerformanceNow: () => packageRoundPerformanceNow(),
    handoffWritten: (evidence) => {
      window.__openClinXrTraceActionHandoffEvidence = evidence;
    },
    interactionSummaryWritten: (summary) => {
      window.__openClinXrTraceInteractionEvidenceSummary = summary;
      evidenceTraceInteraction.textContent = formatPackageTraceTraceInteractionEvidenceSummary(summary);
    },
    buildInteractionSummary: (handoff) => buildXrTraceInteractionEvidenceSummary(handoff),
  });
}

function _updateTraceInteractionEvidenceSummary(
  handoff: XrTraceActionHandoffEvidence | null | undefined,
): XrTraceInteractionEvidenceSummary {
  const summary = updatePackageTraceTraceInteractionEvidenceSummary(
    {
      buildSummary: (input) => buildXrTraceInteractionEvidenceSummary(input),
      interactionSummaryWritten: () => {},
    },
    handoff,
  );
  window.__openClinXrTraceInteractionEvidenceSummary = summary;
  evidenceTraceInteraction.textContent = formatPackageTraceTraceInteractionEvidenceSummary(summary);
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
    const session = await client.startSession(
      buildAssembledStationStartSessionInput({
        learnerId: "quest3_local_learner",
        scenarioId: examScenarioId,
        examRun: examFormRunState,
      }),
    );
    const observedFormAtSecond = formElapsedSecondForCurrentStation();
    await client.startEncounter(session.stationRunId, { atSecond: observedFormAtSecond });
    remoteStationRunId = session.stationRunId; // ADMISSION FIRST: assigned above this await, a refused encounter kept its run id (SC-02).
  } catch {
    remoteStationRunId = undefined; // was `if (!remoteStationRunId) remoteStationRunId = undefined`, a guard that could never fire here.
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

function traceReadinessPanelContext(): Parameters<typeof updatePackageTraceReadiness>[0] {
  return {
    runtimeState: () => state,
    panels: {
      traceSummary,
      postureSummary,
      postureModel,
      postureVoice,
      postureQuest,
      postureMr,
      postureBundleGate,
      postureLaunch,
    },
    summarizeTraceReadiness: (input) => summarizeTraceReadiness(input),
    buildRuntimeEvidencePosture: (input) =>
      buildRuntimeEvidencePosture(input as Parameters<typeof buildRuntimeEvidencePosture>[0]),
    buildReadinessDecision: (input) => buildXrRuntimeReadinessDecision(input),
    formatPostureLane: (lane) => formatRuntimePostureLane(lane),
    formatReadinessDecision: (decision) => formatRuntimeReadinessDecision(decision),
    formatLearnerRuntimeUseGate: (evidence) => formatLearnerRuntimeUseGate(evidence),
    roundPerformanceNow: () => packageRoundPerformanceNow(),
    latestRuntimeInteractionEvidence: () => latestRuntimeInteractionEvidence,
    webXrSupportEvidence: () => runtimeWebXrSupportEvidence,
    handoffEvidence: () => window.__openClinXrTraceActionHandoffEvidence ?? null,
    captureSummary: () => window.__openClinXrManualPerformanceCaptureSummary ?? null,
    learnerRuntimeUseGateEvidence: () => window.__openClinXrLearnerRuntimeUseGateEvidence ?? null,
    postureWritten: (posture, decision) => {
      window.__openClinXrRuntimeEvidencePosture = posture;
      window.__openClinXrRuntimeReadinessDecision = decision;
    },
  };
}

function updateReadiness(): void {
  updatePackageTraceReadiness(traceReadinessPanelContext());
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

async function updateXrStatus(): Promise<void> {
  const navigatorWithXr = navigator as NavigatorWithXr;
  await updatePackageTraceXrStatus(
    {
      supportEvidence: () => runtimeWebXrSupportEvidence,
      captureSummary: () => window.__openClinXrManualPerformanceCaptureSummary ?? null,
      traceReadinessForPanel: (captureSummary) => updateRuntimePosturePanel(captureSummary),
      roundPerformanceNow: () => packageRoundPerformanceNow(),
      formatUnknownError,
      statusWritten: (evidence) => {
        runtimeWebXrSupportEvidence = evidence;
      },
    },
    navigatorWithXr.xr
      ? {
          isSessionSupported: (mode) => navigatorWithXr.xr?.isSessionSupported(mode) ?? Promise.resolve(false),
        }
      : undefined,
    (outcome) => {
      if (!navigatorWithXr.xr) {
        xrStatus.textContent = "WebXR unavailable";
        enterXrButton.disabled = true;
        return;
      }
      if (outcome.blocked && !outcome.immersiveVrSupported) {
        xrStatus.textContent = runtimeWebXrSupportEvidence.supportError === "navigator.xr_missing"
          ? "WebXR unavailable"
          : outcome.available
            ? "Full VR ready"
            : "WebXR unavailable";
        enterXrButton.disabled = true;
        if (runtimeWebXrSupportEvidence.supportError?.startsWith("immersive_vr:")) {
          xrStatus.textContent = "WebXR check blocked";
        }
        return;
      }
      xrStatus.textContent = outcome.immersiveVrSupported ? "Full VR ready" : "WebXR unavailable";
      enterXrButton.disabled = !outcome.immersiveVrSupported;
    },
  );
}

function buildRuntimeReproducibilityEvidence(): ManualPerformanceReproducibilityEvidence {
  return buildPackageTraceRuntimeReproducibilityEvidence({
    appMetadata: () => __OPENCLINXR_UI_XR_APP_METADATA__,
    webXrSupportEvidence: () => runtimeWebXrSupportEvidence,
    viewportSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
    screenSize: () => ({ width: window.screen?.width ?? null, height: window.screen?.height ?? null }),
    devicePixelRatio: () => window.devicePixelRatio,
    visibilityState: () => document.visibilityState,
    pageUrl: () => window.location.href,
    userAgent: () => navigator.userAgent,
    buildReproducibility: (input) => buildManualPerformanceReproducibility(input),
  });
}

function updateRuntimePosturePanel(captureSummary: ManualPerformanceCaptureSummary | null): RuntimeEvidencePosture {
  return updatePackageTraceRuntimePosturePanel(traceReadinessPanelContext(), captureSummary);
}

function formatLearnerRuntimeUseGate(evidence: LearnerRuntimeUseGateEvidence | null): string {
  return formatPackageTraceLearnerRuntimeUseGate(
    evidence,
    (summary) => formatMaterializationAttachmentSummary(summary),
    (reasons) => formatRemainingRuntimeBlockerReasons(reasons),
  );
}

function formatRemainingRuntimeBlockerReasons(
  reasons: RuntimeRemainingRuntimeBlockerReasons | null | undefined,
): string {
  return formatPackageTraceRemainingRuntimeBlockerReasons(reasons);
}

function formatMaterializationAttachmentSummary(
  summary: RuntimeMaterializationEvidenceAttachmentSummary | null | undefined,
): string {
  return formatPackageTraceMaterializationAttachmentSummary(summary);
}

function formatRuntimePostureLane(lane: RuntimeEvidencePosture["lanes"][number] | undefined): string {
  return formatPackageTraceRuntimePostureLane(lane);
}

function formatRuntimeReadinessDecision(decision: XrRuntimeReadinessDecision): string {
  return formatPackageTraceRuntimeReadinessDecision(decision);
}

type ScenarioDoorwayVisualTheme = PackageAssetLoadingScenarioTheme;

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

function _addReusableExteriorPreEncounterRoom(scene: Scene, doorwayTheme: ScenarioDoorwayVisualTheme): void {
  addPackageReusableExteriorPreEncounterRoom(assetLoadingContext(), scene, doorwayTheme, (room) => { reusableExteriorAnteroom = room; });
}

const portalThresholdZ = PORTAL_THRESHOLD_Z;
let portalEncounterEntered = false;
let portalEncounterStartedByPortal = false;
let portalLastTransitionReason: string | null = null;
let reusableExteriorAnteroom: Group | null = null;

function uiXrPortalTransitionContext(): PortalTransitionContext {
  return {
    portalThresholdZ,
    portalEncounterEntered,
    portalEncounterStartedByPortal,
    portalLastTransitionReason,
    reusableExteriorAnteroom,
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    examPhase: viewLearnerCanonicalExamPhase(examFlowStore.getPhaseStore()).phase,
    deterministicPreviewStart: parsePortalPreviewStart(window.location.search),
    setPortalEncounterEntered: (value: boolean) => { portalEncounterEntered = value; },
    setPortalEncounterStartedByPortal: (value: boolean) => { portalEncounterStartedByPortal = value; },
    setPortalLastTransitionReason: (value: string | null) => { portalLastTransitionReason = value; },
  };
}

function uiXrRolePostureContext(): RolePostureContext {
  return {
    actorRole: (actorId: string) => runtimeActorRole(actorId),
    isPatient: (actorId: string) => actorId === runtimePatientActorId(),
    isClinicalTeam: (actorId: string) => actorId === runtimeClinicalTeamActorId(),
    isFamily: (actorId: string) => actorId === runtimeFamilyActorId(),
    isPediatricAsthmaScenario: () => isPediatricAsthmaRuntimeScenario(),
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
  };
}

/**
 * Clip-name context — scenario + metadata reads for animation-clip helpers.
 */
function clipNameContext(): Parameters<typeof clinicalPackageTouchResponseClipNamesForActor>[0] {
  return {
    selectedScenarioId: () => selectedScenarioId(),
    scenarioForId: (scenarioId) => scenarioBank.find((candidate) => candidate.scenarioId === scenarioId),
    actorMetadataRoleClipNames: (actorId) =>
      window.__openClinXrActorPlayerRuntimeMetadataSummary?.actorSummaries.find((actor) => actor.actorId === actorId)
        ?.roleAnimationClipNames ?? [],
    touchResponseClipNames: (actorId) => clinicalTouchResponseClipNamesForActor(actorId),
  };
}

/**
 * Asset-loading context — the app owns module state; the package reads through this object.
 * main.ts creates it once; @openclinxr/xr-asset-loading never exports or holds a mutable value.
 */
function assetLoadingContext(): PackageAssetLoadingContext {
  return {
    scenarioId: () => encounterRuntimeAssetBundle.scenarioId,
    encounterBundle: () => encounterRuntimeAssetBundle,
    scenarioTheme: () => scenarioDoorwayVisualTheme(),
    sceneObjectPrefix: () => runtimeSceneObjectPrefix(),
    runtimeActorRole: (actorId: string) => runtimeActorRole(actorId),
    runtimePatientActorId: () => runtimePatientActorId(),
    runtimeClinicalTeamActorId: () => runtimeClinicalTeamActorId(),
    runtimeFamilyActorId: () => runtimeFamilyActorId(),
    isPediatricAsthmaScenario: () => isPediatricAsthmaRuntimeScenario(),
    selectedCaptureMode: () => selectedCaptureMode(),
    selectedHumanoidSourceComparator: () => selectedHumanoidSourceComparator(),
    shouldShowAffordanceMarkers: () => shouldShowRuntimeAffordanceMarkers(),
    shouldUseCleanSourceComparatorCapture: () => shouldUseCleanHumanoidSourceComparatorCapture(),
    isEdBayVisibleComparatorCapture: () => isEdBayVisibleComparatorCapture(),
    shouldShowComparatorDebugFaceCues: () => shouldShowHumanoidSourceComparatorDebugFaceCues(),
    isMouthGazePoseReviewCaptureMode: () => isHumanoidMouthGazePoseReviewCaptureMode(),
    isCaptureShadowPath: (captureMode: string) => isCaptureShadowPath(captureMode),
    isRealGarmentSleeveDeformCapture: () => isRealGarmentSleeveDeformCapture(),
    recordBootPhase: (phase: string, error?: unknown) => { recordBootPhase(phase, error); },
    roleCueEvidence: () => sceneCueRoleCueEvidence(),
    pediatricEvidence: () => sceneCuePediatricEvidence(),
    pediatricEquipment: () => sceneCuePediatricEquipment(),
    humanoidCues: () => sceneCueHumanoidCues(),
    clinicalPanel: () => sceneCueClinicalPanel(),
    createReadablePanel: (options) => createReadableVrTextPanel(options),
    recordRoleDistinctCue: (actorId, cueId, sceneObjectName) => { recordRoleDistinctHumanoidCue(actorId, cueId, sceneObjectName); },
    recordPediatricEquipmentCue: (equipmentId, cueId, sceneObjectName) => { recordPediatricRespiratoryEquipmentCue(equipmentId, cueId, sceneObjectName); },
    addPediatricEquipmentCues: (slot, equipmentId) => { addPediatricRespiratoryEquipmentCues(slot, equipmentId); },
    sourceProvenanceForPath: (assetPath: string) => generatedHumanoidSourceProvenance(assetPath),
    resolveCastPath: (input) => resolveHumanoidVariantOrCastPath(input),
    normalizeEquipmentMount: (equipment, slot) => normalizeGltfEquipmentMount(equipment, slot),
    prepareEnvironmentShell: (environment) => prepareLoadedEnvironmentShell(environment),
    animationSlots: () => generatedHumanoidAnimationSlots,
    pushAnimationSlot: (slot) => { generatedHumanoidAnimationSlots.push(slot); },
    setAnimationSlotByActor: (actorId, slot) => { generatedHumanoidAnimationSlotsByActorId.set(actorId, slot); },
    setActorSlotByActor: (actorId, slot) => { generatedHumanoidActorSlotsByActorId.set(actorId, slot); },
    registerTouchRegions: (actorId, humanoid, responses) => { registerClinicalTouchRegions(actorId, humanoid, responses as ClinicalTouchResponseConfig[]); },
    triggerDialogue: (actorId, text, gazeTarget, explicitEmotion) => { triggerHumanoidDialogue(actorId, text, gazeTarget, explicitEmotion); },
    dialogueText: () => ({ line: dialogueLine.textContent ?? "", initial: initialDialogueText }),
    visemeUtterance: () => pedsAsthmaPatientBundleVisemeUtterance(),
    schedulePedsPlaybackIfReady: () => { schedulePedsActorPlayerRuntimePlaybackIfReady(); },
    touchResponseClipNames: (actorId) => clinicalTouchResponseClipNamesForActor(actorId),
    roleClipNames: (actorId) => roleAnimationClipNamesForActor(actorId),
    gazeProbeClipNames: (animationClips) => gazeProbeAnimationClipNamesFromGltf(animationClips),
    morphTargetsNeutralized: (humanoid) => { neutralizeGeneratedHumanoidMorphTargets(humanoid); },
    realGarmentSurfaces: (humanoid, comparator) => applyRealGarmentEvidenceSurfaces(humanoid, comparator),
    sleeveDeformCue: (assetPath, comparator) => sleeveDeformCueForAssetPath(assetPath, comparator),
    suppressOverlaysForComparator: (humanoid) => { suppressRuntimeDiagnosticOverlaysForSourceComparator(humanoid); },
    faceReviewCues: (humanoid) => { addHumanoidSourceComparatorFaceReviewCues(humanoid); },
    frameCaptureOnNamedActor: (input) => {
      frameComparatorCaptureOnNamedActorImpl({
        actorId: input.actorId,
        humanoid: input.humanoid,
        modelAssetId: input.modelAssetId,
        comparator: input.comparator,
        namedActorId: input.namedActorId,
        cleanCapture: input.cleanCapture,
      });
    },
    comparatorSubjectActorId: () => comparatorCaptureSubjectActorIdImpl(),
    recordEdBayCameraPose: () => { recordEdBayVisibleCameraPose(); },
    resolveEffectiveVerticalOffset: (input) => resolveEffectiveVerticalOffsetMeters(input),
    resolvePosture: (input) => resolveActorPosture(input),
    activeEnvironmentId: () => resolveActiveEnvironmentId(),
    applyPosture: (humanoid, posture) => { applyPosturePose(humanoid, posture as ActorPosture); },
    applySupine: (humanoid) => { applySupinePose(humanoid); },
    applyClinicalIdle: (humanoid) => { applyGeneratedHumanoidClinicalIdlePosture(humanoid); },
    applyRolePosture: (humanoid, actorId) => { applyPackageGeneratedHumanoidRoleSpecificPosture(uiXrRolePostureContext(), humanoid, actorId); },
    applyRoleWardrobeCue: (humanoid, role) => { addGeneratedHumanoidRoleContinuityWardrobeCue(humanoid, role as "patient" | "clinical" | "family"); },
    tintSceneMaterials: (root, tintColor, actorId) => { tintGeneratedSceneMaterials(root, tintColor, actorId); },
    clinicalIdleClipPresent: (animationClips) => hasAuthoredClinicalIdlePoseClip(animationClips),
    seatedClipPlayable: (clipName, input) => seatedRoleClipIsPlayable(clipName, input),
    translationBoneNames: (tracks) => animatedTranslationBoneNames(tracks as AnimationClip["tracks"]),
    plantSeatedPelvis: (humanoid, seatHeight, lift) => plantSeatedPelvisOnSeat(humanoid, seatHeight, lift),
    seatedChairHeight: () => PATIENT_CHAIR_SEAT_HEIGHT_METERS,
    findStretcherInScene: (slot) => findProceduralStretcherInSceneOf(slot),
    applyAndPlantSupineDeck: (humanoid, input) => { applyAndPlantSupineOnDeck(humanoid, input); },
    stretcherDeckTopWorldY: () => STRETCHER_DECK_TOP_METERS,
    humanoidDialogueDurationMs: (phonemeCount) => humanoidDialogueDurationMs(phonemeCount),
    createEmotionState: () => createHumanoidEmotionExpressionState(),
    affordanceMarker: (cueId, color) => createAffordanceMarker(cueId, color),
    detailCues: (assetId) => createRuntimeHumanoidDetailCues(assetId),
    collisionCues: (assetId) => createHumanoidInteractionCollisionCues(assetId),
    mouthCue: (assetId, color) => createHumanoidSpeechMouthCue(assetId, color),
    gazeCue: (assetId, color) => createHumanoidEyeGazeCue(assetId, color),
    eyeFocusCue: (assetId) => createHumanoidEyeFocusCue(assetId),
    expressionCue: (assetId) => createHumanoidExpressionCue(assetId),
    recordSceneAsset: (record) => { recordPackageSceneAssetStatus(record as never); },
    affordanceCueIds: (assetId, cueIds) => packageRuntimeAssetAffordanceCueIds(assetId, cueIds),
    shouldSuppressEquipmentModel: (assetId, assetPath) => shouldSuppressGeneratedEquipmentModel(assetId, assetPath),
    shouldShowPrimitiveFallbacks: () => shouldShowPrimitiveAssetFallbacks(),
    refreshEquipmentMountEvidence: () => { refreshDeclaredEquipmentMountEvidenceFromSceneImpl(); },
    applyEquipmentTraceVisuals: () => {
      const evidence = window.__openClinXrEnvironmentStateEvidence;
      if (evidence) applyRuntimeEquipmentTraceVisuals(evidence);
    },
    environmentStatePresent: () => Boolean(window.__openClinXrEnvironmentStateEvidence),
    rolePostureContext: () => uiXrRolePostureContext(),
    seedMouthGazeGarmentGeometry: (input) => {
      const existingMouth = window.__openClinXrMouthGazePoseComparatorEvidence;
      window.__openClinXrMouthGazePoseComparatorEvidence = {
        source: "window.__openClinXrMouthGazePoseComparatorEvidence",
        captureMode: selectedCaptureMode(),
        comparator: input.comparator as MouthGazePoseComparatorEvidence["comparator"],
        scenarioId: input.comparator === "ed_anny_real_garment_patient" ? "ed_chest_pain_priority_v2" : "peds_asthma_parent_anxiety_v1",
        actorId: input.actorId,
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
          name: input.garmentName,
          visible: input.garmentVisible,
          source: input.garmentSource,
          hasVisibleVolume: true,
          hasSeamFoldHints: true,
          ...(input.sleeveDeformCue === undefined ? {} : { sleeveDeform: input.sleeveDeformCue }),
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
    },
    markActorCastShadow: (humanoid) => { markActorCastShadow(humanoid); },
    clinicalTouchScenario: () => scenarioBank.find((candidate) => candidate.scenarioId === selectedScenarioId()),
    selectedScenarioId: () => selectedScenarioId(),
    scenarioForId: (scenarioId) => scenarioBank.find((candidate) => candidate.scenarioId === scenarioId),
    actorMetadataRoleClipNames: (actorId) =>
      window.__openClinXrActorPlayerRuntimeMetadataSummary?.actorSummaries.find((actor) => actor.actorId === actorId)
        ?.roleAnimationClipNames ?? [],
    registerEquipmentSlot: (assetId, slot) => { runtimeEquipmentSlotsByAssetId.set(assetId, slot); },
  };
}


async function createStationScene(): Promise<StationSceneRuntime> {
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
  setComparatorCaptureSceneRoot(scene);
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
  applyPackageDeterministicPortalPreviewStart(uiXrPortalTransitionContext(), locomotionRig);
  scene.add(locomotionRig);

  const faceDetailCapture = isHumanoidFaceDetailCaptureMode();
  const actorPoseReviewCapture = isActorPoseReviewCaptureMode();
  const actorCloseCapture = isActorCloseRealismCaptureMode() || actorPoseReviewCapture;
  const generatedSceneOverviewCapture = isGeneratedSceneOverviewCaptureMode();
  const cleanHumanoidSourceComparatorCapture = shouldUseCleanHumanoidSourceComparatorCapture();
  const edBayVisibleCapture = isEdBayVisibleComparatorCapture();
  const hideRoomForCleanCapture = cleanHumanoidSourceComparatorCapture && !edBayVisibleCapture;
  const selectedScenarioRuntimeMismatch = isSelectedScenarioRuntimeBundleMismatch();
  reportRuntimeBundleScenarioMatch();
  const _selectedStationContext = stationContextForSelectedScenario();
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
      applyEdBayVisibleComparatorCameraPose(camera, selectedHumanoidSourceComparator());
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
  setComparatorCaptureCamera(camera);

  // Build station room shell and load environment assets (extracted to @openclinxr/xr-station-room)
  const stationRoomResult: StationRoomResult = await buildStationRoomShell(
    {
      scenarioId: () => selectedScenarioId(),
      encounterBundle: () => encounterRuntimeAssetBundle,
      scenarioTheme: () => scenarioDoorwayVisualTheme(),
      sceneObjectPrefix: () => runtimeSceneObjectPrefix(),
      selectedCaptureMode: () => selectedCaptureMode(),
      isCaptureShadowPath,
      hideRoomForCleanCapture: () => hideRoomForCleanCapture,
      edBayVisibleCapture: () => edBayVisibleCapture,
      selectedScenarioRuntimeMismatch: () => selectedScenarioRuntimeMismatch,
      activeEnvironmentId: () => resolveActiveEnvironmentId(),
      stationInteriorLightingVariantId: () => resolveStationInteriorLightingVariantId(new URLSearchParams(window.location.search).get("stationLighting")),
      runtimeSceneObjectPrefix: () => runtimeSceneObjectPrefix(),
      assetLoadingContext: () => assetLoadingContext(),
      recordBootPhase,
      iwsdkStationSceneObjects,
      applyStationInteriorLightingForEnvironment,
      addScenarioExpectationPanel,
      resolveEmulatorRuntimeAssetUrl,
      isDynamicGeneratedEncounterSceneMode,
    },
    scene,
    renderer,
    camera,
  );

  const stationEnvironment = stationRoomResult.stationEnvironment;
  const floor = stationRoomResult.floor;
  const gltfEnvContainer = stationRoomResult.gltfEnvContainer;
  const _environmentShell = stationRoomResult.environmentShell;
  const _bed = stationRoomResult.bed;
  const _monitor = stationRoomResult.monitor;
  const fixtureOwnedRoles = stationRoomResult.fixtureOwnedRoles;

  // room stage: an out-of-order or repeated stage is a type error (station-scene-assembly.ts).
  const stagedScene = assembleStationScene(scene).room(() => stationRoomResult);
  // Store references for later use (e.g., gltfEnvContainer for glTF loading, reusableExteriorAnteroom for scenario panel)
  const fixturesAssembly = stagedScene.fixtures(() => {
  scene.userData.openClinXrStationEnvironment = {
    environmentId: resolveActiveEnvironmentId(),
    floorColor: stationEnvironment.userData.floorColor,
    roomDepthMeters: stationEnvironment.userData.roomDepthMeters,
    environmentFallbackActive: stationEnvironment.userData.environmentFallbackActive,
  };
  // Store glTF container for later access
  window.__openClinXrGltfEnvContainer = gltfEnvContainer;
  // Store reusable exterior anteroom for scenario panel
  window.__openClinXrReusableExteriorAnteroom = reusableExteriorAnteroom;

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
    } else if (hideRoomForCleanCapture || actorPoseReviewCapture) {
      prop.visible = false;
      prop.userData.openClinXrCaptureDeclutterPolicy = hideRoomForCleanCapture
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
    if (hideRoomForCleanCapture) {
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
      loadPackageGeneratedEquipmentIntoSceneSlot(assetLoadingContext(), slot, {
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
  return { declaredEquipmentMountEvidenceItems: equipmentEvidenceItems };
  });

  // #122 — unique slot fill (four mounts live in @openclinxr/xr-station-room actor-staging.ts).
  const actorsAssembly = fixturesAssembly.actors(() => {
  const { patient, nurse } = stageStationActors(
    {
      encounterBundle: () => encounterRuntimeAssetBundle,
      slotAssignment: () => resolveRuntimeSlotAssignment(),
      assetLoadingContext: () => assetLoadingContext(),
      actorPlacement: (actorId, fallback, mounted) => runtimeActorPlacement(actorId, fallback, mounted),
      actorIdForSlot: (slotKind) =>
        slotKind === "primary_patient"
          ? runtimePatientActorId()
          : slotKind === "clinical_team"
            ? runtimeClinicalTeamActorId()
            : slotKind === "family_or_observer"
              ? runtimeFamilyActorId()
              : runtimeAdditionalActorId(),
      humanoidAssetForSlot: (slotKind) =>
        slotKind === "primary_patient"
          ? patientRuntimeHumanoidAsset
          : slotKind === "clinical_team"
            ? nurseRuntimeHumanoidAsset
            : slotKind === "family_or_observer"
              ? spouseRuntimeHumanoidAsset
              : additionalRuntimeHumanoidAsset,
      resolveAssetUrl: (asset) => resolveEmulatorRuntimeAssetUrl(asset),
      createActorNameplate: (label, accent) => createActorNameplate(label, accent),
      applyActorFraming: (actor, actorId) => { applyCleanEncounterVisualReviewActorFraming(actor, actorId); },
      createVirtualDeviceActorAffordance: (actorId) => createVirtualDeviceActorAffordance(actorId),
      scenarioRuntimeMismatch: () => selectedScenarioRuntimeMismatch,
      cleanComparatorCapture: () => cleanHumanoidSourceComparatorCapture,
      readActorSlotAssignment: () => window.__openClinXrActorSlotAssignment,
    },
    scene,
  );
  return { patient, nurse };
  });
  const panelsAssembly = actorsAssembly.panels(() => {
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
  return { clinicalPanel, dialoguePanel, actorRealismPanel, inputPanel, conversationPanel };
  });
  const interactionAssembly = panelsAssembly.interaction(() => {
  addControllerAffordances(renderer, scene, (event) => {
    // XR ray: a controller select that hits a body region is a clinical touch;
    // otherwise fall through to the position-independent trace advance.
    if (tryClinicalTouchFromControllerEvent(event, "xr_controller_select")) return;
    completeNextTraceActionFromXrSelect(
      () => Boolean(activeXrSession && renderer.xr.isPresenting),
      classifyXrSelectSource(event),
    );
  });
  // Desktop pointer ray and headless projection hook (@openclinxr/xr-station-room).
  wireStationPointerInteraction({ renderer, camera, tryClinicalTouchFromNdc, clinicalTouchRegionTargets: () => clinicalTouchRegionTargets });
  return {};
  });
  // Everything after interaction stays OUTSIDE the builder: resize, animate, renderSceneFrame,
  // updateVrPanels, startImmersiveSession and the XR session lifetime are the root's job.
  const assembledStationScene = interactionAssembly.build();
  const panelSignatureState = { lastPanelSignature: "" };
  window.__openClinXrDeclaredEquipmentMountEvidence = {
    source: "window.__openClinXrDeclaredEquipmentMountEvidence",
    scenarioId: encounterRuntimeAssetBundle.scenarioId,
    items: assembledStationScene.fixtures.declaredEquipmentMountEvidenceItems,
    notEvidenceFor: [
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "production_readiness",
      "equipment_asset_readiness",
    ],
  };
  const { patient, nurse } = assembledStationScene.actors;
  const { clinicalPanel, dialoguePanel, actorRealismPanel, inputPanel, conversationPanel } = assembledStationScene.panels;
  const keyboardLocomotion = createPackageKeyboardLocomotion();
  let handModelStatus: OpenClinXrInputEvidence["handModelStatus"] = "pending_immersive_session";
  let handModelsInstalled = false;
  let activeHandRepresentationKind: OpenClinXrInputEvidence["handRepresentationKind"] = primitiveHandRepresentationKind;
  let handAssetLoadErrors: string[] = [];
  let lastInputObservedAtMs: number | null = null;
  let examineeLocomotionStartPose: RigPoseEvidence | null = null;
  let examineeLocomotionDistanceMeters = 0;
  let examineeLocomotionTurnRadians = 0;
  let examineeLocomotionSampleCount = 0;
  const examineeLocomotionTrail = createPackageExamineeLocomotionTrail(isSceneOnlyVisualReviewCaptureMode());
  scene.add(examineeLocomotionTrail);
  const handGestureLocomotionState = createPackageXrHandGestureLocomotionState();
  const handSelectState = createPackageXrHandSelectState();

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
    // Deterministic capture clock: fixed t=0 instead of wall-clock rAF time.
    const now = isDeterministicCaptureClock()
      ? bootStartedAtMs
      : typeof timestamp === "number" ? timestamp : performance.now();
    lastRenderLoopAtMs = now;
    // Fixed 16ms step under the deterministic clock; wall-clock delta otherwise.
    const deltaSeconds = isDeterministicCaptureClock()
      ? 1 / 60
      : Math.min((now - lastAnimateAtMs) / 1000, 0.05);
    lastAnimateAtMs = now;
    resize();
    applyInteriorPreviewCameraOnce();
    const roomScalePose = samplePackageRoomScalePose({
      camera,
      renderer,
      presenting: Boolean(activeXrSession && renderer.xr.isPresenting),
    });
    const locomotionEvidence = applyPackageLocomotion({
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
      xrHandSelectState: maybePackageCompleteTraceActionFromHandSelect({
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
    {
      const latency = recordHandSelectTraceLatency(
        inputEvidence.xrHandSelectState,
        now,
        window.__openClinXrTraceLatencyEvidence ?? null,
      );
      if (latency) {
        window.__openClinXrTraceLatencyEvidence = latency;
      }
    }
    if ((inputEvidence.activeLocomotionSource ?? "none") !== "none" && inputEvidence.locomotionDelta) {
      lastObservedLocomotionSummary = {
        source: inputEvidence.activeLocomotionSource ?? "none",
        distanceMeters: inputEvidence.locomotionDelta.distanceMeters,
        turnRadians: inputEvidence.locomotionDelta.turnRadians,
        atMs: now,
      };
    }
    const examineeLocomotionEvidence = buildPackageExamineeLocomotionEvidence({
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
      updatePackageExamineeLocomotionTrail(examineeLocomotionTrail, examineeLocomotionEvidence, isSceneOnlyVisualReviewCaptureMode());
      window.__openClinXrExamineeLocomotionEvidence = examineeLocomotionEvidence;
    }
    lastInputObservedAtMs = inputEvidence.lastInputObservedAtMs ?? lastInputObservedAtMs;
    lastLocomotionAtMs = inputEvidence.lastLocomotionAtMs;
    window.__openClinXrInputEvidence = inputEvidence;
    {
      const portalEvidence = updatePackagePortalTransitionEvidence(uiXrPortalTransitionContext(), locomotionRig, camera);
      portalEncounterEntered = portalEvidence.encounterEntered;
      portalEncounterStartedByPortal = portalEvidence.encounterStartedByPortal;
      portalLastTransitionReason = portalEvidence.lastTransitionReason;
      if (portalEvidence !== undefined) {
        window.__openClinXrPortalTransitionEvidence = portalEvidence;
      }
    }
    updateVrPanels(inputEvidence);
    // THE CASE-OWNED PRODUCER RUNS FIRST, and it is the reason the read below is no longer dead.
    // Measured on the unchanged tree at 86dc0300, nothing in apps, packages or tools ever wrote
    // `floor.userData.genDrive` or `floor.userData.pedsRuntimeDrive`, so the only non-null value
    // this frame could take came from `window.__openClinXrPedsDrive` — a recorder global.
    const approachFrame = updateStationBedsideApproach(
      caseOwnedBedsideApproach,
      {
        scene,
        physicianSlot: generatedHumanoidActorSlotsByActorId.get(runtimeAdditionalActorId()) ?? null,
        physicianActorId: runtimeAdditionalActorId(),
        firstClinicalSlotActorId: runtimeClinicalTeamActorId(),
        firstClinicalSlotRole: runtimeActorRole(runtimeClinicalTeamActorId()) ?? "",
        patientActorId: runtimePatientActorId(),
        placements: encounterRuntimeAssetBundle.sceneManifest.actorPlacements ?? {},
        runId: remoteStationRunId ?? "local_station_run",
        animationSlot: generatedHumanoidAnimationSlotsByActorId.get(runtimeAdditionalActorId()),
        // `!== false`: an ABSENT slot is not a revoked one, and `?? false` collapsed the two. Measured
        // in a browser: the walk stopped with "support acceptance was lost" when the room GLB landed.
        supportAccepted: generatedHumanoidActorSlotsByActorId.get(runtimePatientActorId())?.userData?.openClinXrPlacementAccepted !== false,
      },
      { nowMs: now, deltaSeconds },
    );
    floor.userData.genDrive = approachFrame ? { locomotion: approachFrame.locomotion, driveSource: approachFrame.driveSource } : floor.userData.genDrive;
    const floorDrive = floor.userData.genDrive ?? floor.userData.pedsRuntimeDrive;
    const genDriveForHumanoid = window.__openClinXrPedsDrive ?? (isGeneratedRuntimeDrive(floorDrive) ? floorDrive : null);
    updateGeneratedHumanoidAnimations(deltaSeconds, now, camera, genDriveForHumanoid);
    applyStationBedsideStanceLock(caseOwnedBedsideApproach); // AFTER the pose: a lock reading last frame's pose cancels nothing.
    applyPhysicsBoneTransforms(now); // capture-gated; extracted module
    updateEnvironmentRealismAnimations(deltaSeconds, now);
    // Per-frame affect modulation of the loaded environment container. The behaviour moved to
    // @openclinxr/xr-station-room station-environment-affect-cue.ts unchanged — its thresholds, its
    // cue-name matching and its 800 ms breathing scale are byte-for-byte what ran here — because a
    // composition root composes and boots rather than deciding.
    applyEnvironmentAffectCue({ container: gltfEnvContainer, floorUserData: floor?.userData ?? null, nowMs: now });
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
    // Standing-idle sway, composed onto each actor's persistent heading. The supine exclusion (a
    // recumbent root's orientation is owned by the plant hold) and the compose-not-assign rule moved
    // with it to @openclinxr/xr-runtime-state, unchanged.
    applyStationIdleSway({ patient, nurse, nowMs: now });
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
        recordPackageXrEntryEvidence("failed", "navigator.xr unavailable");
        return;
      }

      enterXrButton.disabled = true;
      xrStatus.textContent = "Entering Full VR";
      recordPackageXrEntryEvidence("requesting");
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
          recordPackageXrEntryEvidence("ended");
        }, { once: true });
        await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
        installHandModelsOnce();
        immersiveSessionActive = true;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Exit Full VR";
        xrStatus.textContent = "In Full VR";
        requestAnimationFrame(() => updateManualEvidencePanel());
        recordPackageXrEntryEvidence("started");
      } catch (error) {
        activeXrSession = undefined;
        enterXrButton.disabled = false;
        enterXrButton.textContent = "Enter Full VR";
        xrStatus.textContent = "WebXR entry blocked";
        recordPackageXrEntryEvidence("failed", error);
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
    if (panelSignature === panelSignatureState.lastPanelSignature) {
      return;
    }
    panelSignatureState.lastPanelSignature = panelSignature;
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
      `Trace hand select: ${formatPackageHandSelectStatus(inputEvidence.xrHandSelectState)}`,
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
  applyPackageCleanEncounterVisualReviewActorFraming(sceneCueActorFraming(), actor, actorId);
}

function resolveActiveEnvironmentId(): string {
  // SC-03: the PERSISTED room wins; the bank below cannot see an authored case, so every authored encounter fell through to the ED bay and mounted the ED bay's stretcher.
  const persisted = encounterRuntimeAssetBundle.sceneManifest.environmentId; if (persisted) return persisted;
  const scenarioId = selectedScenarioId();
  const scenario =
    scenarioBank.find((candidate) => candidate.scenarioId === scenarioId)
    ?? scenarioBank.find((candidate) => candidate.scenarioId === encounterRuntimeAssetBundle.scenarioId)
    ?? edChestPainScenario;
  return scenario.environment?.environmentId ?? "ed_exam_bay_v1";
}

function _addScenarioSpecificClinicalSetDressing(scene: Scene, doorwayTheme: ScenarioDoorwayVisualTheme): void {
  addPackageScenarioSpecificClinicalSetDressing(assetLoadingContext(), scene, doorwayTheme);
}
function recordDynamicSceneObjectNamingEvidence(scene: Scene): DynamicSceneObjectNamingEvidence {
  return recordPackageDynamicSceneObjectNamingEvidence(sceneCueNamingEvidence(), scene);
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


function formatCaptureReadinessStatus(summary: ManualPerformanceCaptureSummary | null): string {
  if (!summary) {
    return "pending capture";
  }
  const status = summary.manualValidationReady ? "ready" : `${summary.blockers.length} blockers`;
  return `${status}; vr ${summary.immersiveFramesObserved ?? 0}; window ${summary.sampleWindowSize ?? 0}`;
}

function formatTechnicalGapStatus(summary: ManualPerformanceCaptureSummary | null): string {
  return formatPackageTraceTechnicalGapStatus(summary);
}

function _configureSemanticRolePoseOverlay(mesh: Mesh, cueId: string): void {
  configureSemanticRolePoseOverlayPackage(assetLoadingContext(), mesh, cueId);
}
function _shouldShowProceduralHumanoidDetailCues(faceCueMode: PackageHumanoidCueMode): boolean {
  return shouldShowProceduralHumanoidDetailCuesPackage(assetLoadingContext(), faceCueMode);
}
function _addRoleSpecificHumanoidVisuals(
  humanoid: Group,
  actorId: string,
  faceCueMode: PackageHumanoidCueMode = "generated_glb",
): void {
  addRoleSpecificHumanoidVisualsPackage(assetLoadingContext(), humanoid, actorId, faceCueMode);
}
function recordRoleDistinctHumanoidCue(actorId: string, cueId: string, sceneObjectName: string): void {
  recordPackageRoleDistinctHumanoidCue(sceneCueRoleCueEvidence(), actorId, cueId, sceneObjectName);
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

function _addScenarioSpecificPatientCue(humanoid: Group, actorId: string): void {
  addScenarioSpecificPatientCuePackage(assetLoadingContext(), humanoid, actorId);
}
function _addScenarioSpecificClinicalTeamCue(humanoid: Group, actorId: string): void {
  addScenarioSpecificClinicalTeamCuePackage(assetLoadingContext(), humanoid, actorId);
}
function _addScenarioSpecificFamilyCue(humanoid: Group, actorId: string): void {
  addScenarioSpecificFamilyCuePackage(assetLoadingContext(), humanoid, actorId);
}
function _addActorSpecificIdentityVariantCue(
  humanoid: Group,
  actorId: string,
  faceCueMode: PackageHumanoidCueMode = "generated_glb",
): void {
  addPackageActorSpecificIdentityVariantCue(assetLoadingContext(), humanoid, actorId, faceCueMode);
}
function createClinicalPanel(): ReadableVrTextPanel {
  return createPackageClinicalPanel(sceneCueClinicalPanel());
}

function clinicalPanelLinesForSelectedStation(): string[] {
  return clinicalPackagePanelLinesForBundle({
    chiefConcern: selectedStationContext.chiefConcern,
    initialVitals: selectedStationContext.initialVitals,
    interruption: selectedStationContext.interruption,
    title: selectedStationContext.title,
    bundleScenarioId: encounterRuntimeAssetBundle.scenarioId,
    selectedScenarioId: selectedScenarioId(),
    selectedScenarioMatchesBundle: !isSelectedScenarioRuntimeBundleMismatch(),
    stationContextTitle: encounterRuntimeAssetBundle.sceneManifest.stationContext?.title,
    actorRoster:
      encounterRuntimeAssetBundle.actors.map((actor) => `${actor.actorId}:${actor.role}`).join(", ") || "none",
    equipmentIds:
      encounterRuntimeAssetBundle.equipment.map((equipment) => equipment.equipmentId).join(", ") || "none",
    dialogueTurns:
      (encounterRuntimeAssetBundle.sceneManifest.dialogueTurns ?? []).map((turn) => `${turn.traceTag}->${turn.actorId}`).join(", ") || "none",
    roomProps: encounterRuntimeAssetBundle.sceneManifest.roomProps.map((prop) => prop.propId).join(", ") || "none",
  });
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
  return createPackageReadableVrTextPanel(sceneCueClinicalPanel(), options);
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


function createVirtualDeviceActorAffordance(actorId: string): Group {
  return createPackageVirtualDeviceActorAffordance(
    sceneCueVirtualDevice(),
    (cueId: string, color: number) => createAffordanceMarker(cueId, color),
    (label: string, accentColor: number) => createActorNameplate(label, accentColor),
  )(actorId);
}

function createActorNameplate(label: string, accentColor: number): Mesh {
  return createPackageActorNameplate(sceneCueNameplate(), label, accentColor);
}

function createDetailedEdRoomProps(
  manifestProps: readonly EncounterRuntimeRoomProp[],
  fixtureOwnedRoles: readonly string[] = [],
  exclusiveMountedEquipmentIds: ReadonlySet<string> = new Set(),
): Group[] {
  return createPackageDetailedEdRoomProps(sceneCueRoomProps(), manifestProps, fixtureOwnedRoles, exclusiveMountedEquipmentIds);
}

function updateEnvironmentRealismAnimations(deltaSeconds: number, nowMs: number): void {
  updatePackageEnvironmentRealismAnimations(sceneCueEnvironmentVisuals(), deltaSeconds, nowMs);
}


function runtimeSceneObjectPrefix(): string {
  return `openclinxr.${encounterRuntimeAssetBundle.scenarioId}`;
}

function createAffordanceMarker(cueId: string, color: number): Mesh {
  return createPackageAffordanceMarker(sceneCueHumanoidCues(), cueId, color);
}

function createHumanoidSpeechMouthCue(assetId: string, _color: number): Mesh {
  return createPackageHumanoidSpeechMouthCue(sceneCueHumanoidCues(), assetId, _color);
}

function createHumanoidEyeGazeCue(assetId: string, color: number): Line {
  return createPackageHumanoidEyeGazeCue(sceneCueHumanoidCues(), assetId, color);
}

function createHumanoidEyeFocusCue(assetId: string): Group {
  return createPackageHumanoidEyeFocusCue(sceneCueHumanoidCues(), assetId);
}

function createHumanoidExpressionCue(assetId: string): Group {
  return createPackageHumanoidExpressionCue(sceneCueHumanoidCues(), assetId);
}

function createRuntimeHumanoidDetailCues(assetId: string): Group {
  return createPackageRuntimeHumanoidDetailCues(sceneCueHumanoidCues(), assetId);
}

function createHumanoidInteractionCollisionCues(assetId: string): Group {
  return createPackageHumanoidInteractionCollisionCues(sceneCueHumanoidCues(), assetId);
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
  const hand = renderer.xr.getHand(1) as PackageXrHandGroup;
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
  const responseClipNames = new Set(clinicalPackageTouchResponseClipNamesForActor(clipNameContext(), actorId));
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
 * Solve lives in capture-comparator.ts; main.ts only resolves the named actor.
 */
function _frameComparatorCaptureOnNamedActor(actorId: string, humanoid: Object3D, modelAssetId: string): void {
  framePackageComparatorCaptureOnNamedActor(assetLoadingContext(), actorId, humanoid as Group, modelAssetId);
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

// ED-bay-visible: keeps room shell/floor/set-dressing while preserving comparator
// framing, garment evidence, and mouth-gaze evidence. Void stays default.
function isEdBayVisibleComparatorCapture(): boolean {
  return isEdBayVisibleCaptureMode(selectedCaptureMode());
}

function suppressRuntimeDiagnosticOverlaysForSourceComparator(humanoid: Group): void {
  suppressPackageRuntimeDiagnosticOverlaysForSourceComparator(humanoid);
}
function shouldShowHumanoidSourceComparatorDebugFaceCues(): boolean {
  const captureMode = selectedCaptureMode();
  return captureMode.includes("debug-face-cue") || new URLSearchParams(window.location.search).get("humanoidComparatorDebugFaceCues") === "1";
}

function addHumanoidSourceComparatorFaceReviewCues(humanoid: Group): void {
  addPackageHumanoidSourceComparatorFaceReviewCues(assetLoadingContext(), humanoid);
}
function _runtimeHumanoidVariantAssetPath(actorId: string, fallbackPath: string): string {
  return runtimePackageHumanoidVariantAssetPath(assetLoadingContext(), actorId, fallbackPath);
}
function selectedHumanoidSourceComparator(): ReturnType<typeof selectedPackageHumanoidSourceComparator> {
  return selectedPackageHumanoidSourceComparator();
}
function pedsAsthmaPatientBundleVisemeUtterance(): string {
  return pedsPackageAsthmaPatientBundleVisemeUtterance(assetLoadingContext());
}
function neutralizeGeneratedHumanoidMorphTargets(humanoid: Group): void {
  neutralizePackageGeneratedHumanoidMorphTargets(humanoid);
}
function _registerGeneratedHumanoidAnimation(input: {
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
  registerPackageGeneratedHumanoidAnimation(assetLoadingContext(), input);
}
function pedsActorPlayerRuntimeTurns(): PedsActorPlayerRuntimeTurn[] {
  return pedsPackageActorPlayerRuntimeTurns() as PedsActorPlayerRuntimeTurn[];
}

function pedsActorListenerCuePanelContext(): Parameters<typeof applyPackagePedsActorPlayerSequenceListenerCues>[0] {
  return {
    actorSlotsByActorId: generatedHumanoidActorSlotsByActorId,
    animationSlotsByActorId:
      generatedHumanoidAnimationSlotsByActorId as unknown as Parameters<
        typeof applyPackagePedsActorPlayerSequenceListenerCues
      >[0]["animationSlotsByActorId"],
    orientEyeFocusCue: (slot, gazeOrigin, boundedTarget) =>
      orientHumanoidEyeFocusCue(slot as unknown as GeneratedHumanoidAnimationSlot, gazeOrigin, boundedTarget),
    orientTowardGazeTarget: (slot, targetWorld) =>
      orientHumanoidTowardGazeTarget(slot as unknown as GeneratedHumanoidAnimationSlot, targetWorld),
    startEmotionTransition: (slot, emotion, nowMs) =>
      startHumanoidEmotionTransition(slot as unknown as GeneratedHumanoidAnimationSlot, emotion as HumanoidExpressionEmotion, nowMs),
    updateEmotionExpression: (slot, nowMs) => {
      const emotionState = updateHumanoidEmotionExpression(slot as unknown as GeneratedHumanoidAnimationSlot, nowMs);
      return {
        targetEmotion: emotionState.targetEmotion as "concerned" | "reassured" | "neutral" | "anxious" | "pain",
        weights: emotionState.weights,
      };
    },
    applyMorphTargetCue: (slot, openness, viseme, weights) =>
      applyHumanoidMorphTargetCue(
        slot as unknown as GeneratedHumanoidAnimationSlot,
        openness,
        viseme,
        weights as unknown as HumanoidExpressionWeights,
      ),
    createVector: (x, y, z) => new Vector3(x, y, z),
  };
}

function pedsActorPlayerPlaybackPanelContext(): Parameters<typeof recordPackagePedsActorPlayerRuntimePlaybackEvidence>[0] {
  return {
    dialogueTurnCount: () => encounterRuntimeAssetBundle.sceneManifest.dialogueTurns?.length ?? 0,
    selectedHumanoidSourceComparator: () => selectedHumanoidSourceComparator(),
    activeGeneratedActorSlotCount: () => generatedHumanoidAnimationSlotsByActorId.size,
    activeHumanoidSpeechEvidenceActorId: () => window.__openClinXrHumanoidSpeechEvidence?.activeActorId ?? null,
    playbackEvidenceWritten: (evidence) => {
      window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence = evidence as PedsActorPlayerRuntimePlaybackEvidence;
    },
  };
}

function playLiveFrozenActorTurn(
  plan: LiveActorTurnConsumption["plan"],
  execution: LiveActorTurnConsumption["execution"],
  gazeTarget: HumanoidDialogueGazeTarget,
  req?: HumanoidSpeechEvidence["activeActorRuntimeRealismRequirement"],
): ActorTurnPlayback {
  const slot = generatedHumanoidAnimationSlotsByActorId.get(plan.actorId);
  return playFrozenActorTurnOnSlot(plan, execution, {
    nowMs: performance.now(),
    clipNames: slot?.responseClips?.map((clip) => clip.name) ?? [],
    getSlot: (id) => generatedHumanoidAnimationSlotsByActorId.get(id),
    speak: (ctx) => {
      triggerHumanoidDialogue(ctx.actorId, ctx.spokenText, gazeTarget, ctx.faceEmotion, req, "plan.dialogueEmotionTo");
      return true;
    },
    playClip: playOneShotResponseClip,
    startFaceTransition: (id, emotion, nowMs) => { const live = generatedHumanoidAnimationSlotsByActorId.get(id); if (live) startHumanoidEmotionTransition(live, emotion, nowMs); },
  });
}

function hasAuthoredClinicalIdlePoseClip(animationClips: unknown[]): boolean {
  return hasPackageAuthoredClinicalIdlePoseClip(animationClips);
}
function gazeProbeAnimationClipNamesFromGltf(animationClips: unknown[]): string[] {
  return gazePackageProbeAnimationClipNamesFromGltf(animationClips);
}
function seatedRoleClipAutoLoopActive(humanoidRoot: Object3D, actorId: string): boolean {
  void actorId;
  const carveout = humanoidRoot.userData.openClinXrSeatedRoleClipCarveout as
    | { admitted?: boolean }
    | undefined;
  return carveout?.admitted === true;
}

function updateGeneratedHumanoidAnimations(deltaSeconds: number, nowMs: number, camera: PerspectiveCamera, drive?: GeneratedRuntimeDrive | null): void {
  updatePackageGeneratedHumanoidAnimations(humanoidAnimationContext, deltaSeconds, nowMs, camera, drive ?? null);
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
  return isPackageGeneratedRuntimeDrive(value);
}



function createHumanoidEmotionExpressionState(): HumanoidEmotionExpressionState {
  return createPackageHumanoidEmotionExpressionState({ deterministicClock: isDeterministicCaptureClock() });
}

function startHumanoidEmotionTransition(slot: GeneratedHumanoidAnimationSlot, emotion: HumanoidExpressionEmotion, nowMs: number): void {
  startPackageHumanoidEmotionTransition(slot, emotion, nowMs);
}

function updateHumanoidEmotionExpression(slot: GeneratedHumanoidAnimationSlot, nowMs: number): HumanoidEmotionExpressionState {
  return updatePackageHumanoidEmotionExpression(slot, nowMs);
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
  return consumed;
}

function applyHumanoidMorphTargetCue(
  slot: GeneratedHumanoidAnimationSlot,
  openness: number,
  viseme: string,
  expressionWeights: HumanoidExpressionWeights,
): void {
  applyPackageHumanoidMorphTargetCue(slot, openness, viseme, expressionWeights, applyNamedSpeechVisemes);
}









function orientHumanoidEyeFocusCue(slot: GeneratedHumanoidAnimationSlot, gazeOrigin: Vector3, boundedTarget: Vector3): void {
  orientPackageHumanoidEyeFocusCue(slot, gazeOrigin, boundedTarget);
}


function orientHumanoidTowardGazeTarget(slot: GeneratedHumanoidAnimationSlot, targetWorld: Vector3): void {
  orientPackageHumanoidTowardGazeTarget(slot, targetWorld);
}




function _resolveHumanoidGazeTargetWorld(speech: HumanoidSpeechPlayback, camera: PerspectiveCamera): Vector3 {
  return resolvePackageHumanoidGazeTargetWorld(humanoidAnimationContext, speech, camera);
}

function tintGeneratedSceneMaterials(root: Group, tintColor: number, actorId?: string): void {
  tintPackageGeneratedSceneMaterials(root, tintColor, actorId);
}
function addPediatricRespiratoryEquipmentCues(slot: Group, equipmentId: string): void {
  addPackagePediatricRespiratoryEquipmentCues(
    sceneCuePediatricEquipment(),
    (childEquipmentId: string, cueId: string, sceneObjectName: string) =>
      recordPediatricRespiratoryEquipmentCue(childEquipmentId, cueId, sceneObjectName),
    slot,
    equipmentId,
  );
}

function recordPediatricRespiratoryEquipmentCue(equipmentId: string, cueId: string, sceneObjectName: string): void {
  recordPackagePediatricRespiratoryEquipmentCue(sceneCuePediatricEvidence(), equipmentId, cueId, sceneObjectName);
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
  return packageRuntimeGeneratedSceneObjectName(asset);
}

function _loadGeneratedEquipmentIntoSceneSlot(
  sceneSlot: Group,
  options: {
    assetPath: string;
    assetId: string;
    objectName: string;
  },
): void {
  loadPackageGeneratedEquipmentIntoSceneSlot(assetLoadingContext(), sceneSlot, options);
}
function _loadGeneratedEnvironmentIntoSceneSlot(
  sceneSlot: Group,
  options: {
    assetPath: string;
    assetId: string;
    objectName: string;
  },
): void {
  loadPackageGeneratedEnvironmentIntoSceneSlot(assetLoadingContext(), sceneSlot, options);
}

const traceFrameAccumulator = createPackageTraceFrameAccumulator();

function frameRecordingPanelContext(): Parameters<typeof recordPackageTraceFrame>[1] {
  return {
    elapsedSecond: () => state.elapsedSecond,
    completedTraceTags: () => state.completedTraceTags,
    lastTraceSelectLatencyMs: () => currentTraceSelectLatencyMs(),
    experienceModeEvidence: () => window.__openClinXrExperienceModeEvidence ?? xrExperienceModeEvidence,
    experienceModeFallback: xrExperienceModeEvidence,
    inputEvidence: () => window.__openClinXrInputEvidence ?? null,
    traceLatencyEvidence: () => window.__openClinXrTraceLatencyEvidence ?? null,
    reproducibilityEvidence: () => buildRuntimeReproducibilityEvidence(),
    immersiveSessionStarted: () => immersiveSessionActive,
    foregroundPageConfirmed: () => document.visibilityState === "visible",
    generatedAt: () => new Date().toISOString(),
    nowMs: () => performance.now(),
    frameStatsWritten: (stats) => {
      window.__openClinXrFrameStats = stats;
    },
    draftWritten: (draft) => {
      window.__openClinXrManualPerformanceDraft = draft;
    },
    captureSummaryWritten: (summary) => {
      window.__openClinXrManualPerformanceCaptureSummary = summary;
    },
    afterFirstOrThirtiethFrame: () => {
      updateManualEvidencePanel();
    },
    buildFrameStats: (input) => buildRuntimeFrameStats(input),
    buildDraft: (input) =>
      buildManualPerformanceDraft({
        generatedAt: input.generatedAt,
        elapsedSecond: input.elapsedSecond,
        foregroundPageConfirmed: input.foregroundPageConfirmed,
        traceInteractionPassed: input.traceInteractionPassed,
        frameStats: input.frameStats,
        controllerSelectLatencyMs: input.controllerSelectLatencyMs,
        ...(input.experienceModeEvidence === undefined ? {} : { experienceModeEvidence: input.experienceModeEvidence }),
        ...(input.inputEvidence == null ? {} : { inputEvidence: input.inputEvidence }),
        ...(input.traceLatencyEvidence == null ? {} : { traceLatencyEvidence: input.traceLatencyEvidence }),
        reproducibilityEvidence: input.reproducibilityEvidence,
        immersiveSessionStarted: input.immersiveSessionStarted,
      }),
    buildCaptureSummary: (input) => buildManualPerformanceCaptureSummary(input),
  };
}

function recordFrame(now: number, evidence: {
  qualitySource: NonNullable<OpenClinXrFrameStats["qualitySource"]>;
  isPresenting: boolean;
  visibilityState: string;
}): ManualPerformanceCaptureSummary {
  return recordPackageTraceFrame(traceFrameAccumulator, frameRecordingPanelContext(), now, evidence);
}

function manualEvidencePanelContext(): Parameters<typeof updatePackageTraceManualEvidencePanel>[0] {
  const readiness = traceReadinessPanelContext();
  void readiness;
  const full: Parameters<typeof updatePackageTraceManualEvidencePanel>[0] = {
    runtimeState: () => state,
    panels: {
      traceSummary,
      postureSummary,
      postureModel,
      postureVoice,
      postureQuest,
      postureMr,
      postureBundleGate,
      postureLaunch,
      evidenceFrames,
      evidenceLoop,
      evidenceInput,
      evidenceSceneAssets,
      evidenceSpeechAffect,
      evidenceActorPlayer,
      evidenceLocomotion,
      evidenceTraceInteraction,
      evidenceTrace,
      evidenceValidation,
      copyEvidenceStatus,
      manualEvidenceJson,
    },
    summarizeTraceReadiness: (input) => summarizeTraceReadiness(input),
    buildRuntimeEvidencePosture: (input) =>
      buildRuntimeEvidencePosture(input as Parameters<typeof buildRuntimeEvidencePosture>[0]),
    buildReadinessDecision: (input) => buildXrRuntimeReadinessDecision(input),
    formatPostureLane: (lane) => formatRuntimePostureLane(lane),
    formatReadinessDecision: (decision) => formatRuntimeReadinessDecision(decision),
    formatLearnerRuntimeUseGate: (evidence) => formatLearnerRuntimeUseGate(evidence),
    roundPerformanceNow: () => packageRoundPerformanceNow(),
    latestRuntimeInteractionEvidence: () => latestRuntimeInteractionEvidence,
    webXrSupportEvidence: () => runtimeWebXrSupportEvidence,
    handoffEvidence: () => window.__openClinXrTraceActionHandoffEvidence ?? null,
    captureSummary: () => window.__openClinXrManualPerformanceCaptureSummary ?? null,
    learnerRuntimeUseGateEvidence: () => window.__openClinXrLearnerRuntimeUseGateEvidence ?? null,
    postureWritten: (posture, decision) => {
      window.__openClinXrRuntimeEvidencePosture = posture;
      window.__openClinXrRuntimeReadinessDecision = decision;
    },
    frameStats: () => window.__openClinXrFrameStats ?? null,
    draft: () => window.__openClinXrManualPerformanceDraft ?? null,
    copyDisposition: () => examFlowStore.getCopyDisposition(),
    formatSceneAssetEvidenceStatus: (evidence) => formatPackageSceneAssetEvidenceStatus(evidence as SceneAssetEvidence | null),
    formatHumanoidSpeechAffectEvidence: (evidence) => formatHumanoidSpeechAffectEvidence(evidence),
    formatPerformanceContractEvidence: (evidence) =>
      formatPackageCaseDefinedHumanoidPerformanceContractEvidence(evidence as CaseDefinedHumanoidPerformanceContractEvidence | null),
    formatActorPlayerRuntimeMetadataSummary: (evidence, playback) =>
      formatActorPlayerRuntimeMetadataSummary(
        evidence as ActorPlayerRuntimeMetadataSummary | null,
        playback as PedsActorPlayerRuntimePlaybackEvidence | null,
      ),
    formatPortalTransitionEvidence: (evidence) =>
      formatPackagePortalTransitionEvidence(evidence as PackagePortalTransitionEvidence | null),
    formatLocomotionPathQuality: (quality) => formatLocomotionPathQuality(quality),
    formatLocomotionDiagnosticSummary: (summary) => formatLocomotionDiagnosticSummary(summary),
    formatLocomotionProbeSummary: (summary) => formatLocomotionProbeSummary(summary),
    formatTechnicalGapStatus: (summary) => formatTechnicalGapStatus(summary),
    formatManualEvidenceCopyStatus: (summary, disposition) =>
      formatManualEvidenceCopyStatus(summary, disposition as ManualEvidenceCopyDisposition),
    buildCaptureSummary: (input) => buildManualPerformanceCaptureSummary(input),
    buildEvidencePayload: (input) =>
      buildManualPerformanceEvidencePayload({
        ...input,
        runtimeSceneManifestEvidence: input.runtimeSceneManifestEvidence as never,
        textPanelEvidence: input.textPanelEvidence as never,
        sceneAssetEvidence: input.sceneAssetEvidence as never,
        caseDefinedHumanoidPerformanceContractEvidence: input.caseDefinedHumanoidPerformanceContractEvidence as never,
        actorPlayerRuntimeMetadataSummary: input.actorPlayerRuntimeMetadataSummary as never,
        examineeLocomotionEvidence: input.examineeLocomotionEvidence as never,
      }) as unknown as Record<string, unknown>,
    sceneAssetEvidence: () => window.__openClinXrSceneAssetEvidence as unknown as Record<string, unknown> | null,
    humanoidSpeechEvidence: () => window.__openClinXrHumanoidSpeechEvidence ?? null,
    performanceContractEvidence: () =>
      window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence as unknown as Record<string, unknown> | null,
    actorPlayerRuntimeMetadataSummary: () =>
      window.__openClinXrActorPlayerRuntimeMetadataSummary as unknown as Record<string, unknown> | null,
    examineeLocomotionEvidence: () =>
      window.__openClinXrExamineeLocomotionEvidence as unknown as Record<string, unknown> | null,
    selectedRuntimeAssetBundleId: () => window.__openClinXrSelectedRuntimeAssetBundleId ?? null,
    runtimeSceneManifestEvidence: () =>
      window.__openClinXrRuntimeSceneManifestEvidence as unknown as Record<string, unknown> | null,
    textPanelEvidence: () => window.__openClinXrTextPanelEvidence as unknown as Record<string, unknown> | null,
    environmentStateEvidence: () => window.__openClinXrEnvironmentStateEvidence ?? null,
    pedsActorPlayerRuntimePlaybackEvidence: () =>
      window.__openClinXrPedsActorPlayerRuntimePlaybackEvidence as unknown as Record<string, unknown> | null,
    portalTransitionEvidence: () =>
      window.__openClinXrPortalTransitionEvidence as unknown as Record<string, unknown> | null,
    examFlowEvidence: () => window.__openClinXrExamFlowEvidence as unknown as Record<string, unknown> | null,
    examRunSummaryEvidence: () => window.__openClinXrExamRunSummaryEvidence as unknown as Record<string, unknown> | null,
    interactionSummary: () => window.__openClinXrTraceInteractionEvidenceSummary ?? null,
    captureSummaryWritten: (summary) => {
      window.__openClinXrManualPerformanceCaptureSummary = summary;
    },
  };
  return full;
}

function updateManualEvidencePanel(): string {
  return updatePackageTraceManualEvidencePanel(manualEvidencePanelContext());
}



function formatActorPlayerRuntimeMetadataSummary(
  evidence: ActorPlayerRuntimeMetadataSummary | null,
  playback: PedsActorPlayerRuntimePlaybackEvidence | null = null,
): string {
  return formatPackageTraceActorPlayerRuntimeMetadataSummary(
    evidence as unknown as Parameters<typeof formatPackageTraceActorPlayerRuntimeMetadataSummary>[0],
    playback as unknown as Parameters<typeof formatPackageTraceActorPlayerRuntimeMetadataSummary>[1],
  );
}

function clinicalTouchResponseClipNamesForActor(actorId: string): string[] {
  return clinicalPackageTouchResponseClipNamesForActor(clipNameContext(), actorId);
}
function roleAnimationClipNamesForActor(actorId: string): string[] {
  return rolePackageAnimationClipNamesForActor(clipNameContext(), actorId);
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


let start = performance.now();
function tick(): void {
  // Deterministic capture clock: freeze the wall-clock encounter timer at 00:00
  // so DOM timer text is run-identical (PNG byte-identical, not just 3D-identical).
  const tickNow = isDeterministicCaptureClock() ? start : performance.now();
  state = { ...state, elapsedSecond: Math.floor((tickNow - start) / 1000) };
  clock.textContent = formatStationClock(state.elapsedSecond);
  if (examFormRunState) {
    const ticked = advancePackageFormRunClock(examFormRunState, formElapsedSecondForCurrentStation());
    if (ticked) {
      examFormRunState = ticked;
      updateExamFormRunEvidence();
    }
  }
  advanceExamFlowForElapsedTime();
  advanceExamNoteForElapsedTime();
  updateExamFlowEvidence();
  requestAnimationFrame(tick);
}

start = performance.now();
recordBootPhase("controls_start");
recordPackageLearnerRuntimeUseGateEvidence(encounterRuntimeAssetBundle, "local_fixture_fallback", null);
renderControls();
updateReadiness();
updateRuntimePosturePanel(null);
updateTraceActionHandoffEvidence();
updateExamFlowEvidence();
recordBootPhase("controls_ready");
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
  return buildPackageTraceHumanoidSpeechEvidence(
    {
      buildEvidence: (a, b, c, d, e, f, g, h) =>
        buildPackageHumanoidSpeechEvidence(
          a,
          b,
          c,
          d,
          e,
          f,
          g as unknown as PackageHumanoidDialogueEmotionContext | undefined,
          h,
        ),
    },
    actorId,
    assetId,
    text,
    phonemeSequence,
    visemeSequence,
    gazeTarget,
    emotionContext,
    actorRuntimeRealismRequirement,
  );
}


async function bootStationScene(): Promise<void> {
  await initializeLearnerRuntimeAssetBundle(stationApi);
  refreshStationContextFromRuntimeBundle();
  renderControls();
  updateReadiness();
  updateTraceActionHandoffEvidence();
  try {
    stationScene = await createStationScene();
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
