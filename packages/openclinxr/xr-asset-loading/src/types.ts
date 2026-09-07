/**
 * Generated-asset loading + role-visual context — extracted from apps/ui-xr/src/main.ts
 * (shrink-only SIZE_FREEZE). The app owns the module state and builds this object;
 * the package reads through it and never exports or holds a mutable value.
 */

import type {
  LearnerRuntimeAssetBundle,
  PedsHumanoidMaterializationHandoff,
} from "@openclinxr/asset-registry/runtime-bundles";
import type { Scenario } from "@openclinxr/shared-schemas";
import type {
  GeneratedHumanoidAnimationSlot,
  HumanoidExpressionEmotion,
} from "@openclinxr/xr-humanoid-animation";
import type { RolePostureContext } from "@openclinxr/xr-locomotion";
import type { SceneAssetEvidence } from "@openclinxr/xr-runtime-state";
import type {
  SceneCueClinicalPanelContext,
  SceneCueHumanoidCueContext,
  SceneCuePediatricCueEvidenceContext,
  SceneCuePediatricEquipmentContext,
  SceneCueRoleCueEvidenceContext,
} from "@openclinxr/xr-scene-cues";
import type { Group, Mesh } from "three";

export type HumanoidSourceComparator =
  | "mpfb_ob_patient"
  | "charmorph_antonia_patient"
  | "charmorph_reom_patient"
  | "reom_local_fitted_garment_patient"
  | "reom_local_authored_curved_garment_patient"
  | "reom_shirts01_cc0_patient"
  | "reom_toigo_basic_tucked_tshirt_patient"
  | "reom_namuhekam_polo_patient"
  | "peds_anny_mpfb2_eye_rig_patient"
  | "peds_anny_school_age_mpfb2_eye_patient"
  | "peds_anny_comfy_masked_skin"
  | "peds_anny_real_garment_patient"
  | "peds_anny_real_garment_parent"
  | "peds_anny_real_garment_nurse"
  | "ed_anny_real_garment_patient"
  | null;

export type AssetLoadingScenarioTheme = {
  backgroundColor: number;
  floorColor: number;
  panelBackground: string;
  panelAccent: string;
  reusedAssetAccentColor: number;
};

export type AssetLoadingPedsHandoffBundle = LearnerRuntimeAssetBundle & {
  pedsHumanoidMaterializationHandoff?: PedsHumanoidMaterializationHandoff;
};

export type HumanoidSourceProvenance = NonNullable<
  SceneAssetEvidence["assets"][number]["humanoidSourceProvenance"]
>;

export type AssetLoadingContext = {
  scenarioId: () => string;
  encounterBundle: () => AssetLoadingPedsHandoffBundle;
  scenarioTheme: () => AssetLoadingScenarioTheme;
  sceneObjectPrefix: () => string;
  runtimeActorRole: (actorId: string) => string | undefined;
  runtimePatientActorId: () => string;
  runtimeClinicalTeamActorId: () => string;
  runtimeFamilyActorId: () => string;
  isPediatricAsthmaScenario: () => boolean;
  selectedCaptureMode: () => string;
  selectedHumanoidSourceComparator: () => HumanoidSourceComparator;
  shouldShowAffordanceMarkers: () => boolean;
  shouldUseCleanSourceComparatorCapture: () => boolean;
  isEdBayVisibleComparatorCapture: () => boolean;
  shouldShowComparatorDebugFaceCues: () => boolean;
  isMouthGazePoseReviewCaptureMode: () => boolean;
  isCaptureShadowPath: (captureMode: string) => boolean;
  isRealGarmentSleeveDeformCapture: () => boolean;
  recordBootPhase: (phase: string, error?: unknown) => void;
  roleCueEvidence: () => SceneCueRoleCueEvidenceContext;
  pediatricEvidence: () => SceneCuePediatricCueEvidenceContext;
  pediatricEquipment: () => SceneCuePediatricEquipmentContext;
  humanoidCues: () => SceneCueHumanoidCueContext;
  clinicalPanel: () => SceneCueClinicalPanelContext;
  createReadablePanel: (options: {
    name: string;
    title: string;
    lines: readonly string[];
    widthMeters: number;
    heightMeters: number;
    background: string;
    accent: string;
  }) => { mesh: Mesh };
  recordRoleDistinctCue: (actorId: string, cueId: string, sceneObjectName: string) => void;
  recordPediatricEquipmentCue: (equipmentId: string, cueId: string, sceneObjectName: string) => void;
  addPediatricEquipmentCues: (slot: Group, equipmentId: string) => void;
  sourceProvenanceForPath: (assetPath: string) => HumanoidSourceProvenance | undefined;
  resolveCastPath: (input: {
    scenarioId: string;
    actorId: string;
    role: string;
    fallbackPath: string;
    comparatorOverridePath?: string | null;
  }) => string;
  normalizeEquipmentMount: (equipment: Group, slot: Group) => Group;
  prepareEnvironmentShell: (environment: Group) => Record<string, unknown>;
  animationSlots: () => GeneratedHumanoidAnimationSlot[];
  pushAnimationSlot: (slot: GeneratedHumanoidAnimationSlot) => void;
  setAnimationSlotByActor: (actorId: string, slot: GeneratedHumanoidAnimationSlot) => void;
  setActorSlotByActor: (actorId: string, slot: Group) => void;
  registerTouchRegions: (actorId: string, humanoid: Group, responses: unknown[]) => void;
  triggerDialogue: (
    actorId: string,
    text: string,
    gazeTarget: { kind: "learner_camera" | "actor"; actorId: string | null },
    explicitEmotion?: HumanoidExpressionEmotion,
  ) => void;
  dialogueText: () => { line: string; initial: string };
  visemeUtterance: () => string;
  schedulePedsPlaybackIfReady: () => void;
  touchResponseClipNames: (actorId: string) => string[];
  roleClipNames: (actorId: string) => string[];
  gazeProbeClipNames: (animationClips: unknown[]) => string[];
  morphTargetsNeutralized: (humanoid: Group) => void;
  realGarmentSurfaces: (humanoid: Group, comparator: string) => { name: string; visible: boolean } | null;
  sleeveDeformCue: (assetPath: string, comparator: string) => string | undefined;
  suppressOverlaysForComparator: (humanoid: Group) => void;
  faceReviewCues: (humanoid: Group) => void;
  frameCaptureOnNamedActor: (input: {
    actorId: string;
    humanoid: Group;
    modelAssetId: string;
    comparator: string | null;
    namedActorId: string | null;
    cleanCapture: boolean;
  }) => void;
  comparatorSubjectActorId: () => string;
  recordEdBayCameraPose: () => void;
  resolveEffectiveVerticalOffset: (input: {
    slotLocalY: number;
    verticalOffsetMeters: number;
    slotScaleY: number;
  }) => number;
  resolvePosture: (input: { scenarioId: string; environmentId: string; slotKind: string }) => string;
  activeEnvironmentId: () => string;
  applyPosture: (humanoid: Group, posture: string) => void;
  applySupine: (humanoid: Group) => void;
  applyClinicalIdle: (humanoid: Group) => void;
  applyRolePosture: (humanoid: Group, actorId: string) => void;
  applyRoleWardrobeCue: (humanoid: Group, role: string) => void;
  tintSceneMaterials: (root: Group, tintColor: number, actorId?: string) => void;
  clinicalIdleClipPresent: (animationClips: unknown[]) => boolean;
  seatedClipPlayable: (
    clipName: string,
    input: { translationBoneNames: string[] },
  ) => boolean;
  translationBoneNames: (tracks: unknown[]) => string[];
  plantSeatedPelvis: (humanoid: Group, seatHeight: number, lift: number) => { deltaY: number; pelvisBefore: number | null };
  seatedChairHeight: () => number;
  findStretcherInScene: (slot: Group) => import("three").Object3D | null;
  applyAndPlantSupineDeck: (humanoid: Group, input: { deckTopWorldY: number; deckCenter: { x: number; z: number }; stretcher?: import("three").Object3D }) => void;
  stretcherDeckTopWorldY: () => number;
  humanoidDialogueDurationMs: (phonemeCount: number) => number;
  createEmotionState: () => GeneratedHumanoidAnimationSlot["emotionExpression"];
  affordanceMarker: (cueId: string, color: number) => Mesh;
  detailCues: (assetId: string) => Group;
  collisionCues: (assetId: string) => Group;
  mouthCue: (assetId: string, color: number) => Mesh;
  gazeCue: (assetId: string, color: number) => import("three").Line;
  eyeFocusCue: (assetId: string) => Group;
  expressionCue: (assetId: string) => Group;
  recordSceneAsset: (record: Record<string, unknown>) => void;
  affordanceCueIds: (assetId: string, cueIds: string[]) => string[];
  shouldSuppressEquipmentModel: (assetId: string, assetPath: string) => boolean;
  shouldShowPrimitiveFallbacks: () => boolean;
  refreshEquipmentMountEvidence: () => void;
  applyEquipmentTraceVisuals: () => void;
  environmentStatePresent: () => boolean;
  rolePostureContext: () => RolePostureContext;
  seedMouthGazeGarmentGeometry: (input: {
    comparator: string;
    actorId: string;
    garmentName: string;
    garmentVisible: boolean;
    garmentSource: string;
    sleeveDeformCue: string | undefined;
  }) => void;
  markActorCastShadow: (humanoid: Group) => void;
  clinicalTouchScenario: () => Scenario | undefined;
  selectedScenarioId: () => string;
  scenarioForId: (scenarioId: string) => Scenario | undefined;
  actorMetadataRoleClipNames: (actorId: string) => readonly string[];
  registerEquipmentSlot: (assetId: string, slot: Group) => void;
};
