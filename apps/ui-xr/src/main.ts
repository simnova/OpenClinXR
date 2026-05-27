import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import {
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  ENCOUNTER_LEARNER_RUNTIME_REQUIRED_GATE_IDS,
  evaluateEncounterRuntimeLearnerUseGate,
  findRuntimeActorAsset,
  findRuntimeEquipmentAsset,
  resolveRuntimeAssetUrl,
  type EncounterRuntimeRoomProp,
  type EncounterRuntimeAsset,
  type LearnerRuntimeAssetBundle,
} from "@openclinxr/asset-registry/runtime-bundles";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LoadingManager,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  AnimationClip,
  AnimationMixer,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import {
  actorIdForTraceTag,
  actorResponseTextFromApiResult,
  buildManualPerformanceCaptureSummary,
  buildManualPerformanceEvidencePayload,
  buildManualPerformanceInputEvidence,
  buildManualPerformanceDraft,
  buildManualPerformanceReproducibility,
  buildReadableVrTextPanelEvidence,
  buildRuntimeFrameStats,
  buildRuntimeEvidencePosture,
  buildXrTraceActionHandoffEvidence,
  buildXrTraceInteractionEvidenceSummary,
  buildXrRuntimeReadinessDecision,
  completeTraceAction,
  createInitialRuntimeState,
  createRuntimeStateFromBundle,
  eventTypeForTraceTag,
  formatManualEvidenceCopyStatus,
  formatStationClock,
  iwsdkStationSceneObjects,
  iwsdkStationSceneObjectNames,
  isImmersiveFrameEvidenceActive,
  localHandMeshPath,
  handGestureLocomotionOriginMeters,
  handGestureRelativeOffsetMeters,
  mapHandGestureLocomotionVector,
  meshHandModelProfile,
  meshHandRepresentationKind,
  primitiveHandModelProfile,
  primitiveHandRepresentationKind,
  remoteActorTurnForTraceTag,
  summarizeTraceReadiness,
  type LocomotionAttemptDiagnosticsEvidence,
  type LocomotionVectorEvidence,
  type ExamineeLocomotionEvidence,
  type HumanoidSpeechEvidence,
  type EnvironmentStateEvidence,
  type CaseDefinedHumanoidRuntimeHandoffEvidence,
  type CaseDefinedHumanoidPerformanceContractEvidence,
  type ManualEvidenceCopyDisposition,
  type ManualPerformanceCaptureSummary,
  type ManualPerformanceDraft,
  type ManualPerformanceFrameStats,
  type ManualPerformanceInputEvidence,
  type ManualPerformanceReproducibilityEvidence,
  type ManualPerformanceTraceLatencyEvidence,
  type LearnerRuntimeUseGateEvidence,
  type RigPoseEvidence,
  type ReadableVrTextPanelEvidence,
  type ReadableVrTextPanelEvidenceSet,
  type RuntimeInteractionEvidence,
  type RuntimeEvidencePosture,
  type RuntimeSceneManifestEvidence,
  type SceneAssetEvidence,
  type XrRuntimeReadinessDecision,
  type XrTraceActionHandoffAction,
  type XrTraceActionHandoffEvidence,
  type XrTraceInteractionEvidenceSummary,
  type XrInputSourceEvidence,
  type XrHandGestureStateEvidence,
  type XrHandSelectStateEvidence,
  type XrExperienceModeEvidence,
  type XrRuntimeState,
  xrExperienceModeEvidence,
} from "./runtime-state.js";
import { createStationApiClient, type StationApiClient } from "./api-client.js";
import "./styles.css";

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
    bodyMotionMode: "procedural_idle_body_motion" | "scenario_dialogue_body_motion_runtime" | "scenario_pediatric_respiratory_distress_idle_overlay";
  }>;
  notEvidenceFor: Array<"quest_readiness" | "clinical_validity" | "scoring_validity" | "production_readiness" | "animation_quality">;
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
};

type OpenClinXrExamRunSummaryEvidence = {
  source: "local_exam_run_summary";
  examRunId: string;
  totalScenarios: number;
  stationOutcomes: ExamRunStationOutcome[];
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
    __openClinXrEnvironmentStateEvidence?: EnvironmentStateEvidence;
    __openClinXrHumanoidSpeechEvidence?: HumanoidSpeechEvidence;
    __openClinXrCaseDefinedHumanoidPerformanceContractEvidence?: CaseDefinedHumanoidPerformanceContractEvidence;
    __openClinXrDebugScene?: Scene;
    __openClinXrSelectedRuntimeAssetBundleId?: string;
    __openClinXrRuntimeSceneManifestEvidence?: RuntimeSceneManifestEvidence;
    __openClinXrLearnerRuntimeUseGateEvidence?: LearnerRuntimeUseGateEvidence;
    __openClinXrLastStationSceneBootErrorStack?: string;
    __openClinXrExamFlowEvidence?: OpenClinXrExamFlowEvidence;
    __openClinXrExamRunSummaryEvidence?: OpenClinXrExamRunSummaryEvidence;
    __openClinXrDynamicSceneObjectNamingEvidence?: DynamicSceneObjectNamingEvidence;
    __openClinXrRoleDistinctHumanoidCueEvidence?: RoleDistinctHumanoidCueEvidence;
     __openClinXrPediatricRespiratoryEquipmentCueEvidence?: PediatricRespiratoryEquipmentCueEvidence;
     __openClinXrRuntimeHumanoidActingCueEvidence?: RuntimeHumanoidActingCueEvidence;
     __openClinXrPortalTransitionEvidence?: PortalTransitionEvidence;
   }
 }

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence = buildCaseDefinedHumanoidPerformanceContractEvidence();

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
const defaultStaticGeneratedLearnerRuntimeAssetBundleScenarioId = "ed_chest_pain_priority_v1";
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
let ecgCartRuntimeAsset = requireEncounterRuntimeAsset(
  findRuntimeEquipmentAsset(encounterRuntimeAssetBundle, "ecg_cart_equipment")?.model,
  "ecg_cart_equipment",
);
let ivPoleRuntimeAsset = requireEncounterRuntimeAsset(
  findRuntimeEquipmentAsset(encounterRuntimeAssetBundle, "iv_stand_equipment")?.model,
  "iv_stand_equipment",
);

function useEncounterRuntimeAssetBundle(
  bundle: LearnerRuntimeAssetBundle,
  options: {
    source: ActiveRuntimeAssetBundleSource;
    fallbackReason?: string | null | undefined;
  } = { source: "local_fixture_fallback" },
): void {
  encounterRuntimeAssetBundle = bundle;
  window.__openClinXrSelectedRuntimeAssetBundleId = bundle.bundleId;
  window.__openClinXrRuntimeSceneManifestEvidence = buildRuntimeSceneManifestEvidence(bundle);
  recordLearnerRuntimeUseGateEvidence(bundle, options.source, options.fallbackReason ?? null);
  patientRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
    findRuntimeActorAsset(bundle, "patient_robert_hayes_v1")?.model
      ?? findRuntimeActorAssetByRole(bundle, ["patient"])?.model
      ?? bundle.actors[0]?.model,
    "primary_patient_actor",
  );
  nurseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
    findRuntimeActorAsset(bundle, "nurse_maria_alvarez_v1")?.model
      ?? findRuntimeHumanoidActorAssetByRole(bundle, ["nurse", "respiratory_therapist", "nurse_observer", "consultant"])?.model
      ?? bundle.actors[1]?.model
      ?? bundle.actors[0]?.model,
    "clinical_team_actor",
  );
  spouseRuntimeHumanoidAsset = requireEncounterRuntimeAsset(
    findRuntimeActorAsset(bundle, "spouse_anna_hayes_v1")?.model
      ?? findRuntimeHumanoidActorAssetByRole(bundle, ["spouse", "parent", "family", "consultant"])?.model
      ?? bundle.actors[2]?.model
      ?? bundle.actors[1]?.model
      ?? bundle.actors[0]?.model,
    "family_or_observer_actor",
  );
  ecgCartRuntimeAsset = requireEncounterRuntimeAsset(
    findRuntimeEquipmentAsset(bundle, "ecg_cart_equipment")?.model
      ?? bundle.equipment[0]?.model,
    "primary_equipment",
  );
  ivPoleRuntimeAsset = requireEncounterRuntimeAsset(
    findRuntimeEquipmentAsset(bundle, "iv_stand_equipment")?.model
      ?? bundle.equipment[1]?.model
      ?? bundle.equipment[0]?.model,
    "secondary_equipment",
  );
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

function findRuntimeActorAssetByRole(bundle: LearnerRuntimeAssetBundle, roles: string[]) {
  return bundle.actors.find((actor) => roles.includes(actor.role));
}

function findRuntimeHumanoidActorAssetByRole(bundle: LearnerRuntimeAssetBundle, roles: string[]) {
  return bundle.actors.find((actor) => roles.includes(actor.role) && actor.embodiment !== "virtual_device" && actor.embodiment !== "voice_only");
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
  return selectedScenarioId() !== encounterRuntimeAssetBundle.scenarioId;
}

function runtimePatientActorId(): string {
  return findRuntimeActorAsset(encounterRuntimeAssetBundle, "patient_robert_hayes_v1")?.actorId
    ?? findRuntimeActorAssetByRole(encounterRuntimeAssetBundle, ["patient"])?.actorId
    ?? encounterRuntimeAssetBundle.actors[0]?.actorId
    ?? "patient_robert_hayes_v1";
}

function runtimeClinicalTeamActorId(): string {
  return findRuntimeActorAsset(encounterRuntimeAssetBundle, "nurse_maria_alvarez_v1")?.actorId
    ?? findRuntimeHumanoidActorAssetByRole(encounterRuntimeAssetBundle, ["nurse", "respiratory_therapist", "nurse_observer", "consultant"])?.actorId
    ?? encounterRuntimeAssetBundle.actors[1]?.actorId
    ?? runtimePatientActorId();
}

function runtimeFamilyActorId(): string {
  return findRuntimeActorAsset(encounterRuntimeAssetBundle, "spouse_anna_hayes_v1")?.actorId
    ?? findRuntimeHumanoidActorAssetByRole(encounterRuntimeAssetBundle, ["spouse", "parent", "family", "consultant"])?.actorId
    ?? encounterRuntimeAssetBundle.actors[2]?.actorId
    ?? encounterRuntimeAssetBundle.actors[1]?.actorId
    ?? runtimePatientActorId();
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
  return {
    ...fallback,
    ...placement,
    position: hasVector3(placement?.position) ? placement.position : fallback.position,
    scale: hasVector3(placement?.scale) ? placement.scale : fallback.scale,
    verticalOffsetMeters: placement?.verticalOffsetMeters ?? fallback.verticalOffsetMeters,
    labelPrefix: placement?.labelPrefix ?? fallback.labelPrefix,
  };
}

function runtimeEquipmentPlacement(
  asset: EncounterRuntimeAsset,
  fallback: LearnerRuntimeAssetBundle["sceneManifest"]["equipmentPlacements"][string],
): LearnerRuntimeAssetBundle["sceneManifest"]["equipmentPlacements"][string] {
  const equipment = encounterRuntimeAssetBundle.equipment.find((item) => item.model.assetId === asset.assetId);
  const placement = equipment ? encounterRuntimeAssetBundle.sceneManifest.equipmentPlacements?.[equipment.equipmentId] : undefined;
  return {
    ...fallback,
    ...placement,
    position: hasVector3(placement?.position) ? placement.position : fallback.position,
    label: placement?.label ?? fallback.label,
    interactionCueIds: Array.isArray(placement?.interactionCueIds) ? placement.interactionCueIds : fallback.interactionCueIds,
  };
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
  return captureMode.includes("mouth-gaze-pose") || captureMode.includes("actor-pose") || captureMode.includes("pose-review");
}

function isDynamicGeneratedEncounterSceneMode(): boolean {
  return encounterRuntimeAssetBundle.sceneManifest.roomProps.length > 0
    && encounterRuntimeAssetBundle.environment.reviewStatus !== "blocked";
}

function isGeneratedPlaceholderSourceForDifferentScenario(source: string): boolean {
  const scenarioSlug = encounterRuntimeAssetBundle.scenarioId.replaceAll("_", "-");
  const normalizedSource = source.toLowerCase();
  return isDynamicGeneratedEncounterSceneMode()
    && !normalizedSource.includes(encounterRuntimeAssetBundle.scenarioId.toLowerCase())
    && !normalizedSource.includes(scenarioSlug.toLowerCase());
}

function isGeneratedPlaceholderAssetForDifferentScenario(asset: EncounterRuntimeAsset): boolean {
  return isGeneratedPlaceholderSourceForDifferentScenario(`${asset.blob.blobName} ${asset.blob.url ?? ""}`);
}

function shouldSuppressGeneratedEnvironmentShell(asset: EncounterRuntimeAsset): boolean {
  return isGeneratedPlaceholderAssetForDifferentScenario(asset);
}

function shouldSuppressGeneratedEquipmentModel(assetId: string, assetPath: string): boolean {
  return isGeneratedPlaceholderSourceForDifferentScenario(assetPath);
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
    || captureMode.includes("visual-cleanup");
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
  const runtimeInitialDialogueText = encounterRuntimeAssetBundle.sceneManifest.stationContext?.initialDialogueText;
  if (!isSelectedScenarioRuntimeBundleMismatch() && runtimeInitialDialogueText) return runtimeInitialDialogueText;
  if (selectedScenarioId() === "peds_asthma_parent_anxiety_v1") {
    return "Jordan Williams: My chest feels tight and it is hard to breathe.";
  }
  if (selectedScenarioId() === "psych_suicidal_ideation_safety_v1") {
    return "Morgan Lee: I do not feel safe being alone right now.";
  }
  if (selectedScenarioId() === "telehealth_diabetes_health_literacy_v1") {
    return "Luis Martinez: I want to follow the plan, but the instructions are hard to understand.";
  }
  if (selectedScenarioId() === "ob_headache_preeclampsia_triage_v1") {
    return "Aisha Khan: My headache is getting worse, and the lights are bothering my eyes.";
  }
  if (selectedScenarioId() === "ed_stroke_alert_handoff_v1") {
    return "Samuel Brooks: My right arm feels weak, and I cannot get the words out clearly.";
  }
  if (selectedScenarioId() === "stepdown_sepsis_nurse_escalation_v1") {
    return "Helen Carter: I feel worse than this morning, and I am shaking again.";
  }
  if (selectedScenarioId() === "clinic_abdominal_pain_interpreter_v1") {
    return "Lucia Morales: The pain is mostly on the lower right side, and I need the interpreter.";
  }
  if (selectedScenarioId() === "oncology_bad_news_family_v1") {
    return "David Miller: I want my sister here before we talk about the scan results.";
  }
  if (selectedScenarioId() === "postop_fever_consult_pressure_v1") {
    return "Priya Shah: My belly hurts more today, and I have chills.";
  }
  if (selectedScenarioId() !== "ed_chest_pain_priority_v1") return "Patient: I am ready to begin this encounter.";
  return "Robert Hayes: It feels heavy, like someone is sitting on my chest.";
}

function stationContextForSelectedScenario(): {
  title: string;
  subtitle: string;
  chiefConcern: string;
  initialVitals: string;
  interruption: string;
  stageAriaLabel: string;
  canvasAriaLabel: string;
} {
  const runtimeContext = encounterRuntimeAssetBundle.sceneManifest.stationContext;
  if (!isSelectedScenarioRuntimeBundleMismatch() && runtimeContext) {
    return {
      title: runtimeContext.title,
      subtitle: runtimeContext.subtitle,
      chiefConcern: runtimeContext.chiefConcern,
      initialVitals: runtimeContext.initialVitals,
      interruption: runtimeContext.interruption,
      stageAriaLabel: runtimeContext.stageAriaLabel,
      canvasAriaLabel: runtimeContext.canvasAriaLabel,
    };
  }
  if (selectedScenarioId() === "peds_asthma_parent_anxiety_v1") {
    return {
      title: "Pediatric Asthma",
      subtitle: "Child, anxious parent, and respiratory therapist in a time-boxed pediatric respiratory encounter.",
      chiefConcern: "Shortness of breath and wheezing after activity",
      initialVitals: "HR 124, RR 32, SpO2 93%, mild retractions",
      interruption: "Parent anxiety escalates while respiratory status is reassessed",
      stageAriaLabel: "Pediatric asthma station scene",
      canvasAriaLabel: "3D pediatric respiratory room preview",
    };
  }
  if (selectedScenarioId() === "psych_suicidal_ideation_safety_v1") {
    return {
      title: "Psych Safety Assessment",
      subtitle: "Patient and observer in a time-boxed suicide-risk and safety-planning encounter.",
      chiefConcern: "Suicidal ideation and inability to commit to being alone safely",
      initialVitals: "Calm but withdrawn; no acute medical instability documented",
      interruption: "Observer requests explicit safety plan and escalation threshold",
      stageAriaLabel: "Psychiatric safety assessment station scene",
      canvasAriaLabel: "3D psychiatric safety assessment room preview",
    };
  }
  if (selectedScenarioId() === "telehealth_diabetes_health_literacy_v1") {
    return {
      title: "Telehealth Diabetes Plan",
      subtitle: "Patient and daughter in a time-boxed telehealth counseling encounter focused on teach-back and access barriers.",
      chiefConcern: "Diabetes medication confusion and difficulty following portal instructions",
      initialVitals: "Remote visit; home glucose logs variable with recent hypoglycemia concern",
      interruption: "Daughter begins answering for the patient unless communication is redirected respectfully",
      stageAriaLabel: "Telehealth diabetes health-literacy station scene",
      canvasAriaLabel: "3D telehealth counseling room preview",
    };
  }
  if (selectedScenarioId() === "ob_headache_preeclampsia_triage_v1") {
    return {
      title: "OB Headache Preeclampsia Triage",
      subtitle: "Pregnant patient, partner, and OB nurse in a time-boxed triage encounter with fetal monitor and blood-pressure equipment.",
      chiefConcern: "Severe headache with visual sensitivity in late pregnancy",
      initialVitals: "BP cue requires repeat measurement and escalation consideration",
      interruption: "Partner anxiety rises while nurse requests a concise escalation plan",
      stageAriaLabel: "OB preeclampsia triage station scene",
      canvasAriaLabel: "3D OB triage room preview",
    };
  }
  if (selectedScenarioId() === "ed_stroke_alert_handoff_v1") {
    return {
      title: "ED Stroke Alert Handoff",
      subtitle: "Patient, family member, and stroke nurse in a time-critical handoff with clock and bedside monitor cues.",
      chiefConcern: "Acute speech difficulty and right-sided weakness",
      initialVitals: "Bedside monitor and last-known-well clock drive urgency",
      interruption: "Family member adds timeline details while stroke nurse presses for handoff clarity",
      stageAriaLabel: "ED stroke alert handoff station scene",
      canvasAriaLabel: "3D stroke alert room preview",
    };
  }
  if (selectedScenarioId() === "stepdown_sepsis_nurse_escalation_v1") {
    return {
      title: "Stepdown Sepsis Escalation",
      subtitle: "Deteriorating patient with nurse and respiratory therapist in a stepdown escalation encounter.",
      chiefConcern: "Worsening fever, chills, and respiratory concern after earlier stability",
      initialVitals: "Monitor and IV pump cues support escalation and closed-loop team communication",
      interruption: "Respiratory therapist requests prioritization while nurse seeks escalation orders",
      stageAriaLabel: "Stepdown sepsis escalation station scene",
      canvasAriaLabel: "3D stepdown sepsis room preview",
    };
  }
  if (selectedScenarioId() === "clinic_abdominal_pain_interpreter_v1") {
    return {
      title: "Clinic Abdominal Pain Interpreter",
      subtitle: "Patient, father, and remote interpreter tablet in an ambulatory abdominal-pain encounter.",
      chiefConcern: "Right-lower-quadrant abdominal pain with interpreter-mediated history",
      initialVitals: "Exam table and abdominal exam zone cues anchor the focused assessment",
      interruption: "Family member answers out of turn unless the learner uses interpreter best practices",
      stageAriaLabel: "Clinic abdominal pain interpreter station scene",
      canvasAriaLabel: "3D clinic interpreter room preview",
    };
  }
  if (selectedScenarioId() === "oncology_bad_news_family_v1") {
    return {
      title: "Oncology Bad News Family",
      subtitle: "Patient and sister in a quiet oncology consultation focused on serious-news communication.",
      chiefConcern: "Reviewing difficult scan results with family present",
      initialVitals: "Chairs and tissue-box cues support emotionally realistic disclosure workflow",
      interruption: "Family emotion escalates and requires empathy before further explanation",
      stageAriaLabel: "Oncology serious-news family station scene",
      canvasAriaLabel: "3D oncology consultation room preview",
    };
  }
  if (selectedScenarioId() === "postop_fever_consult_pressure_v1") {
    return {
      title: "Postop Fever Consult Pressure",
      subtitle: "Postoperative patient with floor nurse and surgery resident under consult-pressure dynamics.",
      chiefConcern: "Fever, worsening abdominal pain, and chills after surgery",
      initialVitals: "Post-op bed and abdominal dressing cues drive focused exam and escalation",
      interruption: "Consultant pressure risks premature closure unless the learner maintains safety priorities",
      stageAriaLabel: "Postoperative fever consult-pressure station scene",
      canvasAriaLabel: "3D postoperative fever room preview",
    };
  }
  if (selectedScenarioId() !== "ed_chest_pain_priority_v1") {
    const title = titleFromScenarioId(selectedScenarioId());
    return {
      title,
      subtitle: "Scenario-bank generated encounter with actor, room prop, equipment, and dialogue evidence selected by runtime bundle.",
      chiefConcern: "Generated scenario objective pending review",
      initialVitals: "Generated environment evidence pending headset validation",
      interruption: "Trace event cue pending review",
      stageAriaLabel: `${title} station scene`,
      canvasAriaLabel: `3D ${title} preview`,
    };
  }
  return {
    title: "ED Chest Pain",
    subtitle: "Patient, spouse, and nurse in a time-boxed emergency department encounter.",
    chiefConcern: "Crushing substernal chest pressure",
    initialVitals: "BP 152/92, HR 104, RR 20, SpO2 96%",
    interruption: "Nurse repeats vitals at minute seven",
    stageAriaLabel: "Emergency department station scene",
    canvasAriaLabel: "3D emergency department bay preview",
  };
}

function titleFromScenarioId(scenarioId: string): string {
  return scenarioId
    .replace(/_v\d+$/u, "")
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  baseRotationY: number;
  phaseOffsetMs: number;
  mouthCue: Mesh;
  gazeCue: Line;
  eyeFocusCue: Group;
  expressionCue: Group;
  emotionExpression: HumanoidEmotionExpressionState;
  activeSpeech?: HumanoidSpeechPlayback | undefined;
  mixer?: AnimationMixer;
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
  startedAtMs: number;
  durationMs: number;
};
type HumanoidDialogueEmotionContext = {
  emotion: HumanoidExpressionEmotion;
  source: "runtime_affect_timeline" | "scenario_actor_communication_profile" | "dialogue_text_heuristic";
  baselineMood: string[];
  cueIds: string[];
};
const generatedHumanoidAnimationSlots: GeneratedHumanoidAnimationSlot[] = [];
const generatedHumanoidAnimationSlotsByActorId = new Map<string, GeneratedHumanoidAnimationSlot>();
const generatedHumanoidActorSlotsByActorId = new Map<string, Group>();
const virtualDeviceActorSlotsByActorId = new Map<string, Group>();
const activeVirtualDeviceSpeechByActorId = new Map<string, HumanoidSpeechPlayback>();
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
      notEvidenceFor: ["production_physics_readiness", "validated_ragdoll_biomechanics"],
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
          <div><dt>Initial vitals</dt><dd>${selectedStationContext.initialVitals}</dd></div>
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
  state = createRuntimeStateFromBundle(encounterRuntimeAssetBundle, state);
  window.__openClinXrCaseDefinedHumanoidPerformanceContractEvidence =
    buildCaseDefinedHumanoidPerformanceContractEvidence(encounterRuntimeAssetBundle.scenarioId);
  initialDialogueText = initialDialogueTextForSelectedScenario();
  selectedStationContext = stationContextForSelectedScenario();
  document.querySelector<HTMLElement>(".stage")?.setAttribute("aria-label", selectedStationContext.stageAriaLabel);
  document.querySelector<HTMLElement>("#station-canvas")?.setAttribute("aria-label", selectedStationContext.canvasAriaLabel);
  const title = document.querySelector<HTMLElement>("header h1");
  if (title) title.textContent = selectedStationContext.title;
  const subtitle = document.querySelector<HTMLElement>("header .subtle");
  if (subtitle) subtitle.textContent = selectedStationContext.subtitle;
  const ehrValues = document.querySelectorAll<HTMLElement>(".ehr-panel dd");
  ehrValues[0]!.textContent = selectedStationContext.chiefConcern;
  ehrValues[1]!.textContent = selectedStationContext.initialVitals;
  ehrValues[2]!.textContent = selectedStationContext.interruption;
  const dialogue = document.querySelector<HTMLElement>("#dialogue-line");
  if (dialogue) dialogue.textContent = initialDialogueText;
}

const canvas = requireElement<HTMLCanvasElement>("#station-canvas");
const clock = requireElement<HTMLElement>("#station-clock");
const traceSummary = requireElement<HTMLElement>("#trace-summary");
const traceActions = requireElement<HTMLElement>("#trace-actions");
const examFlowStation = requireElement<HTMLElement>("#exam-flow-station");
const examFlowTimer = requireElement<HTMLElement>("#exam-flow-timer");
const examFlowAdvance = requireElement<HTMLElement>("#exam-flow-advance");
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

function readExamRunSummaryOutcomes(): ExamRunStationOutcome[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(examRunSummaryStorageKey) ?? "[]") as ExamRunStationOutcome[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function updateExamRunSummaryEvidence(): OpenClinXrExamRunSummaryEvidence {
  const evidence: OpenClinXrExamRunSummaryEvidence = {
    source: "local_exam_run_summary",
    examRunId,
    totalScenarios: examNormalizedSequence.length,
    stationOutcomes: readExamRunSummaryOutcomes(),
  };
  window.__openClinXrExamRunSummaryEvidence = evidence;
  return evidence;
}

function recordExamRunStationOutcome(): void {
  const outcomes = readExamRunSummaryOutcomes();
  const nextOutcome: ExamRunStationOutcome = {
    scenarioId: examScenarioId,
    scenarioIndex: examScenarioIndex,
    phase: examFlowPhase,
    noteTextLength: patientNoteText.value.trim().length,
    noteSubmitted: examNoteSubmitted,
    lastAdvanceReason: examLastAdvanceReason,
    recordedAtIso: new Date().toISOString(),
  };
  const withoutCurrent = outcomes.filter((outcome) => outcome.scenarioId !== examScenarioId);
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

function completeTraceActionFromInput(tag: string, source: OpenClinXrTraceLatencyEvidence["source"]): void {
  const traceSelectStartedAtMs = performance.now();
  state = completeTraceAction(state, tag);
  const dialogueText = dialogueFor(tag);
  dialogueLine.textContent = dialogueText;
  triggerHumanoidDialogueForTrace(tag, dialogueText);
  updateEnvironmentStateForTrace(tag);
  renderControls();
  updateReadiness();
  const selectLatencyMs = recordTraceSelectLatency(traceSelectStartedAtMs, tag, source);
  traceActionHandoffActions = [
    ...traceActionHandoffActions,
    {
      sequence: traceActionHandoffActions.length + 1,
      traceTag: tag,
      source,
      eventType: eventTypeForTraceTag(tag),
      actorId: localDialogueActorIdForTraceTag(tag) ?? null,
      completedAtSecond: state.elapsedSecond,
      completedAtMs: roundPerformanceNow(),
      selectLatencyMs,
    },
  ];
  updateTraceActionHandoffEvidence();
  void recordRemoteTraceAction(tag);
}

function updateEnvironmentStateForTrace(tag: string): EnvironmentStateEvidence {
  const activeTraceTags = Array.from(new Set([...(window.__openClinXrEnvironmentStateEvidence?.activeTraceTags ?? []), tag]));
  const activeRuntimeEquipmentIds = activeTraceTags.flatMap(runtimeEquipmentIdsForTraceTag);
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
  roomStateSummary.textContent = [
    `monitor ${evidence.monitorState}`,
    `alarm ${evidence.alarmState}`,
    evidence.activePropIds.length > 0 ? `active ${evidence.activePropIds.join(", ")}` : "no active props",
  ].join(" | ");
  return evidence;
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

async function recordRemoteTraceAction(tag: string): Promise<void> {
  if (!stationApi || !remoteStationRunId) {
    return;
  }

  const atSecond = state.elapsedSecond;
  try {
    const actorId = actorIdForTraceTag(tag);
    await stationApi.recordTraceAction(remoteStationRunId, {
      eventType: eventTypeForTraceTag(tag),
      atSecond,
      tag,
      ...(actorId ? { actorId } : {}),
    });
  } catch {
    remoteStationRunId = undefined;
    return;
  }

  const actorTurn = remoteActorTurnForTraceTag(tag);
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
      dialogueLine.textContent = text;
      triggerHumanoidDialogue(actorTurn.actorId, text, localDialogueGazeTargetForTraceTag(tag));
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
  const lines: Record<string, string> = scenarioId === "peds_asthma_parent_anxiety_v1"
    ? {
        history_opqrst: "Jordan Williams: It started after recess and my chest feels tight.",
        vitals_review: "Respiratory therapist: Oxygen saturation is borderline, and work of breathing is increasing.",
        ecg_request: "Respiratory therapist: I will switch this to a nebulizer treatment and reassess breath sounds.",
        urgent_escalation: "Tanya Williams: Please tell me if they need a higher level of care.",
        team_communication: "Respiratory therapist: I will stay at bedside while you update the parent and reassess.",
        family_communication: "Tanya Williams: I am scared, but I can help keep Jordan calm.",
        empathy_statement: "Jordan Williams: I feel better when someone explains what is happening.",
        patient_note_submitted: "System: Patient note saved for faculty review.",
      }
    : {
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
  return [
    sourceText,
    generatedText,
    gateText,
    evidence.fallbackReason ? `fallback ${evidence.fallbackReason}` : "no production/clinical/scoring claim",
  ].join(" | ");
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
  const flatPreviewFallbackFrameMs = 1000 / 30;

  const scene = new Scene();
  scene.name = iwsdkStationSceneObjects.stationRoot;
  window.__openClinXrDebugScene = scene;
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
  const selectedScenarioRuntimeMismatch = isSelectedScenarioRuntimeBundleMismatch();
  const selectedStationContext = stationContextForSelectedScenario();
  const camera = new PerspectiveCamera(faceDetailCapture ? 48 : generatedSceneOverviewCapture ? 60 : actorCloseCapture ? 42 : 52, 1, 0.1, 100);
  if (faceDetailCapture) {
    camera.position.set(-0.72, 1.54, 3.25);
    camera.lookAt(-0.72, 1.44, -0.12);
    camera.userData.openClinXrCameraFraming = "runtime_patient_humanoid_face_lip_eye_detail_capture";
  } else if (generatedSceneOverviewCapture) {
    camera.position.set(0.18, 1.32, 4.35);
    camera.lookAt(0.02, 1.02, -0.08);
    camera.userData.openClinXrCameraFraming = "generated_scene_overview_multi_actor_dynamic_encounter_capture_clinical_focus";
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
  }
  locomotionRig.add(camera);

  const ambient = new HemisphereLight(0xf4f0dc, 0x223042, 2.2);
  ambient.name = iwsdkStationSceneObjects.ambientLight;
  scene.add(ambient);

  const key = new DirectionalLight(0xffffff, 2.5);
  key.name = iwsdkStationSceneObjects.keyLight;
  key.position.set(3, 5, 4);
  scene.add(key);

  addReusableExteriorPreEncounterRoom(scene, doorwayTheme);

  const floor = new Mesh(new BoxGeometry(7, 0.08, 3.45), new MeshStandardMaterial({ color: doorwayTheme.floorColor, roughness: 0.8 }));
  floor.name = iwsdkStationSceneObjects.floor;
  floor.position.set(0, -0.04, -0.78);
  floor.userData.openClinXrSceneNecessityPolicy = "dynamic_encounter_world_floor_anchor_beyond_reusable_portal_threshold";
  floor.userData.openClinXrEncounterSpecificRuntimeTheme = "floor_color_derived_from_selected_encounter_runtime_bundle";
  floor.userData.openClinXrPortalBoundaryPolicy = "belongs_to_dynamic_world_on_encounter_side_of_doorway";
  scene.add(floor);
  addDynamicEncounterRoomShell(scene, doorwayTheme);
  addScenarioSpecificClinicalSetDressing(scene, doorwayTheme);

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
  } else {
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
  } else if (actorPoseReviewCapture) {
    monitor.position.set(1.95, 1.35, -0.92);
    monitor.userData.openClinXrCaptureDeclutterPolicy = "moved_aside_for_actor_pose_review_only";
  }
  scene.add(monitor);

  for (const prop of createDetailedEdRoomProps(encounterRuntimeAssetBundle.sceneManifest.roomProps)) {
    if (selectedScenarioRuntimeMismatch) {
      prop.visible = false;
      prop.userData.openClinXrDynamicScenePolicy = "hidden_because_selected_scenario_specific_3d_bundle_missing";
    } else if (actorPoseReviewCapture) {
      prop.visible = false;
      prop.userData.openClinXrCaptureDeclutterPolicy = "hidden_for_actor_pose_review_only";
    } else if (encounterRuntimeAssetBundle.scenarioId === "ob_headache_preeclampsia_triage_v1") {
      prop.visible = false;
      prop.userData.openClinXrObVisualReviewPolicy = "hidden_when_ob_specific_set_dressing_supplies_required_context_without_generic_prop_artifacts";
    }
    scene.add(prop);
  }

  const ecgCartPlacement = runtimeEquipmentPlacement(ecgCartRuntimeAsset, {
    position: { x: 1.6, y: 0, z: 0.28 },
    label: runtimeAssetDisplayLabel(ecgCartRuntimeAsset, "Equipment"),
    interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"],
  });
  const ecgCart = equipmentSlotMesh(0xf3f5f0, 0x111820);
  ecgCart.name = iwsdkStationSceneObjects.ecgCart;
  ecgCart.position.set(ecgCartPlacement.position.x, ecgCartPlacement.position.y, ecgCartPlacement.position.z);
  ecgCart.visible = !selectedScenarioRuntimeMismatch;
  if (encounterRuntimeAssetBundle.scenarioId === "ob_headache_preeclampsia_triage_v1") {
    ecgCart.visible = false;
    ecgCart.userData.openClinXrObVisualReviewPolicy = "hidden_to_prevent_non_ob_edge_equipment_artifact_in_portal_entry_evidence";
  }
  ecgCart.userData.openClinXrRuntimeEquipmentPlacementCueIds = ecgCartPlacement.interactionCueIds;
  ecgCart.add(createActorNameplate(ecgCartPlacement.label, 0x286b54));
  scene.add(ecgCart);
  loadGeneratedEquipmentIntoSceneSlot(ecgCart, {
    assetPath: resolveEmulatorRuntimeAssetUrl(ecgCartRuntimeAsset),
    assetId: ecgCartRuntimeAsset.assetId,
    objectName: runtimeGeneratedSceneObjectName(ecgCartRuntimeAsset),
  });

  const ivPolePlacement = runtimeEquipmentPlacement(ivPoleRuntimeAsset, {
    position: { x: 0.95, y: 0, z: 0.98 },
    label: runtimeAssetDisplayLabel(ivPoleRuntimeAsset, "Equipment"),
    interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue"],
  });
  const ivPole = equipmentSlotMesh(0xd8dde1, 0x2b3034);
  ivPole.name = iwsdkStationSceneObjects.ivPoleWithPump;
  ivPole.position.set(ivPolePlacement.position.x, ivPolePlacement.position.y, ivPolePlacement.position.z);
  ivPole.visible = !selectedScenarioRuntimeMismatch;
  if (encounterRuntimeAssetBundle.scenarioId === "ob_headache_preeclampsia_triage_v1") {
    ivPole.visible = false;
    ivPole.userData.openClinXrObVisualReviewPolicy = "hidden_to_prevent_non_ob_edge_equipment_artifact_in_portal_entry_evidence";
  }
  ivPole.userData.openClinXrRuntimeEquipmentPlacementCueIds = ivPolePlacement.interactionCueIds;
  ivPole.add(createActorNameplate(ivPolePlacement.label, 0x5a6f9f));
  scene.add(ivPole);
  loadGeneratedEquipmentIntoSceneSlot(ivPole, {
    assetPath: resolveEmulatorRuntimeAssetUrl(ivPoleRuntimeAsset),
    assetId: ivPoleRuntimeAsset.assetId,
    objectName: runtimeGeneratedSceneObjectName(ivPoleRuntimeAsset),
  });

  const loadedEquipmentAssetIds = new Set([ecgCartRuntimeAsset.assetId, ivPoleRuntimeAsset.assetId]);
  const additionalEquipmentPositions = [
    { x: 2.05, y: 0, z: -0.18 },
    { x: -0.62, y: 0, z: -0.58 },
    { x: -1.72, y: 0, z: 0.28 },
    { x: 1.9, y: 0, z: 0.82 },
  ];
  for (const [equipmentIndex, runtimeEquipment] of encounterRuntimeAssetBundle.equipment.entries()) {
    if (loadedEquipmentAssetIds.has(runtimeEquipment.model.assetId)) {
      continue;
    }
    const fallbackPosition = additionalEquipmentPositions[equipmentIndex % additionalEquipmentPositions.length] ?? { x: 1.9, y: 0, z: 0.82 };
    const placement = runtimeEquipmentPlacement(runtimeEquipment.model, {
      position: fallbackPosition,
      label: runtimeAssetDisplayLabel(runtimeEquipment.model, "Equipment"),
      interactionCueIds: ["selectable_equipment_reference", "clinical_workflow_cue", "dynamic_encounter_equipment_context"],
    });
    const slot = equipmentSlotMesh(0xe8eef3, 0x2563eb);
    slot.name = `${runtimeSceneObjectPrefix()}.generated-equipment-slot.${runtimeEquipment.equipmentId}`;
    slot.position.set(placement.position.x, placement.position.y, placement.position.z);
    slot.visible = !selectedScenarioRuntimeMismatch;
    if (encounterRuntimeAssetBundle.scenarioId === "ob_headache_preeclampsia_triage_v1") {
      slot.visible = false;
      slot.userData.openClinXrObVisualReviewPolicy = "hidden_when_ob_specific_set_dressing_supplies_required_equipment_context";
    }
    slot.userData.openClinXrRuntimeEquipmentPlacementCueIds = placement.interactionCueIds;
    slot.userData.openClinXrDynamicEncounterEquipmentSlot = "case_definition_equipment_loaded_from_runtime_bundle";
    slot.add(createActorNameplate(placement.label, 0x2563eb));
    scene.add(slot);
    loadGeneratedEquipmentIntoSceneSlot(slot, {
      assetPath: resolveEmulatorRuntimeAssetUrl(runtimeEquipment.model),
      assetId: runtimeEquipment.model.assetId,
      objectName: runtimeGeneratedSceneObjectName(runtimeEquipment.model),
    });
  }

  const patientPlacement = runtimeActorPlacement(runtimePatientActorId(), {
    slotKind: "primary_patient",
    position: { x: -0.72, y: 1.06, z: -0.12 },
    scale: { x: 1.1, y: 1.1, z: 1.1 },
    verticalOffsetMeters: -0.98,
    labelPrefix: "Patient",
  });
  const patient = actorMesh(0x8fb9aa);
  patient.name = iwsdkStationSceneObjects.patientRobertHayes;
  patient.position.set(patientPlacement.position.x, patientPlacement.position.y, patientPlacement.position.z);
  patient.visible = !selectedScenarioRuntimeMismatch;
  patient.scale.set(patientPlacement.scale.x, patientPlacement.scale.y, patientPlacement.scale.z);
  applyCleanEncounterVisualReviewActorFraming(patient, runtimePatientActorId());
  patient.add(createActorNameplate(actorNameplateLabel(patientPlacement.labelPrefix, runtimePatientActorId()), 0x286b54));
  scene.add(patient);
  loadGeneratedHumanoidIntoActorSlot(patient, {
    assetPath: resolveEmulatorRuntimeAssetUrl(patientRuntimeHumanoidAsset),
    assetId: patientRuntimeHumanoidAsset.assetId,
    objectName: runtimeGeneratedSceneObjectName(patientRuntimeHumanoidAsset),
    actorId: runtimePatientActorId(),
    roleTintColor: 0x8fb9aa,
    verticalOffsetMeters: patientPlacement.verticalOffsetMeters,
  });

  const nursePlacement = runtimeActorPlacement(runtimeClinicalTeamActorId(), {
    slotKind: "clinical_team",
    position: { x: 1.45, y: 0.95, z: 0.55 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Team",
  });
  const nurse = actorMesh(0x5a9bd5);
  nurse.name = iwsdkStationSceneObjects.nurseMariaAlvarez;
  nurse.position.set(nursePlacement.position.x, nursePlacement.position.y, nursePlacement.position.z);
  nurse.visible = !selectedScenarioRuntimeMismatch;
  nurse.scale.set(nursePlacement.scale.x, nursePlacement.scale.y, nursePlacement.scale.z);
  applyCleanEncounterVisualReviewActorFraming(nurse, runtimeClinicalTeamActorId());
  nurse.add(createActorNameplate(actorNameplateLabel(nursePlacement.labelPrefix, runtimeClinicalTeamActorId()), 0x2f65a7));
  scene.add(nurse);
  loadGeneratedHumanoidIntoActorSlot(nurse, {
    assetPath: resolveEmulatorRuntimeAssetUrl(nurseRuntimeHumanoidAsset),
    assetId: nurseRuntimeHumanoidAsset.assetId,
    objectName: runtimeGeneratedSceneObjectName(nurseRuntimeHumanoidAsset),
    actorId: runtimeClinicalTeamActorId(),
    roleTintColor: 0x5a9bd5,
    verticalOffsetMeters: nursePlacement.verticalOffsetMeters,
  });

  const spousePlacement = runtimeActorPlacement(runtimeFamilyActorId(), {
    slotKind: "family_or_observer",
    position: { x: -2.0, y: 0.95, z: 0.7 },
    scale: { x: 1, y: 1, z: 1 },
    verticalOffsetMeters: -0.95,
    labelPrefix: "Family",
  });
  const spouse = actorMesh(0xd5a75a);
  spouse.name = iwsdkStationSceneObjects.spouseAnnaHayes;
  spouse.position.set(spousePlacement.position.x, spousePlacement.position.y, spousePlacement.position.z);
  spouse.visible = !selectedScenarioRuntimeMismatch;
  if (isPediatricAsthmaRuntimeScenario()) {
    spouse.position.x = Math.max(spouse.position.x, -1.42);
    spouse.position.z = 0.42;
    spouse.rotation.y = -0.26;
    spouse.userData.openClinXrDynamicScenePolicy = "parent_actor_reframed_from_case_defined_parent_chair_zone_for_visible_three_actor_review";
  }
  spouse.scale.set(spousePlacement.scale.x, spousePlacement.scale.y, spousePlacement.scale.z);
  applyCleanEncounterVisualReviewActorFraming(spouse, runtimeFamilyActorId());
  spouse.add(createActorNameplate(actorNameplateLabel(spousePlacement.labelPrefix, runtimeFamilyActorId()), 0x9b642d));
  scene.add(spouse);
  loadGeneratedHumanoidIntoActorSlot(spouse, {
    assetPath: resolveEmulatorRuntimeAssetUrl(spouseRuntimeHumanoidAsset),
    assetId: spouseRuntimeHumanoidAsset.assetId,
    objectName: runtimeGeneratedSceneObjectName(spouseRuntimeHumanoidAsset),
    actorId: runtimeFamilyActorId(),
    roleTintColor: 0xd5a75a,
    verticalOffsetMeters: spousePlacement.verticalOffsetMeters,
  });

  for (const virtualActor of encounterRuntimeAssetBundle.actors.filter((actor) => actor.embodiment === "virtual_device")) {
    if (!selectedScenarioRuntimeMismatch) {
      scene.add(createVirtualDeviceActorAffordance(virtualActor.actorId));
    }
  }

  const clockMesh = new Mesh(new CylinderGeometry(0.25, 0.25, 0.05, 48), new MeshStandardMaterial({ color: 0xf3e8c9 }));
  clockMesh.name = iwsdkStationSceneObjects.wallClock;
  clockMesh.rotation.x = Math.PI / 2;
  clockMesh.position.set(0.9, 3.35, -1.2);
  if (!shouldShowPrimitiveAssetFallbacks()) {
    clockMesh.visible = false;
    clockMesh.userData.openClinXrDynamicScenePolicy = "hidden_in_generated_encounter_scene_unless_fallback_debug_capture";
  }
  scene.add(clockMesh);
  const clinicalPanel = createClinicalPanel();
  if (!shouldShowInSceneEvidencePanels()) {
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
  if (!shouldShowInSceneEvidencePanels()) {
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
  if (!shouldShowInSceneEvidencePanels()) {
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
  let lastPanelSignature = "";
  addControllerAffordances(renderer, scene, (event) => {
    completeNextTraceActionFromXrSelect(
      () => Boolean(activeXrSession && renderer.xr.isPresenting),
      classifyXrSelectSource(event),
    );
  });
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

  function renderSceneFrame(
    timestamp?: number,
    qualitySource: NonNullable<OpenClinXrFrameStats["qualitySource"]> = "webxr_animation_loop",
  ): void {
    const now = typeof timestamp === "number" ? timestamp : performance.now();
    lastRenderLoopAtMs = now;
    const deltaSeconds = Math.min((now - lastAnimateAtMs) / 1000, 0.05);
    lastAnimateAtMs = now;
    resize();
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
        onSelect: () => completeNextTraceActionFromXrSelect(
          () => Boolean(activeXrSession && renderer.xr.isPresenting),
          "xr_hand_select",
        ),
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
    updateGeneratedHumanoidAnimations(deltaSeconds, now, camera);
    updateEnvironmentRealismAnimations(deltaSeconds, now);
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
    patient.rotation.y = Math.sin(now / 1200) * 0.08;
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
  }
}

function addGeneratedHumanoidRoleContinuityWardrobeCue(actor: Group, roleCue: 'patient' | 'clinical' | 'family'): void {
  actor.userData.openClinXrDynamicWardrobeCuePolicy =
    'suppressed_in_default_runtime_after_visual_evidence_showed_overlay_artifacts_reduce_realism';
  actor.userData.openClinXrDynamicWardrobeCueRole = roleCue;
}
function applyCleanEncounterVisualReviewActorFraming(actor: Group, actorId: string): void {
  if (
    isHumanoidFaceDetailCaptureMode() ||
    isActorPoseReviewCaptureMode() ||
    isActorCloseRealismCaptureMode()
  ) {
    return;
  }

  const role = (runtimeActorRole(actorId) ?? String(actor.userData.openClinXrActorRole ?? '')).toLowerCase();
  const scenarioId = encounterRuntimeAssetBundle.scenarioId;

  if (scenarioId === 'ob_headache_preeclampsia_triage_v1') {
    if (role.includes('patient')) {
      actor.position.set(-1.34, 0.58, -0.3);
      actor.rotation.y = 0.18;
      actor.scale.set(0.44, 0.42, 0.44);
      actor.userData.openClinXrEncounterStaging = 'ob_patient_seated_recliner_proof_frame_not_free_standing_on_bed';
      addGeneratedHumanoidRoleContinuityWardrobeCue(actor, 'patient');
      return;
    }

    if (role.includes('nurse') || role.includes('clinical') || role.includes('consultant') || role.includes('therapist')) {
      actor.position.set(-0.22, 0.42, -0.04);
      actor.rotation.y = -0.24;
      actor.scale.setScalar(0.5);
      actor.userData.openClinXrEncounterStaging = 'ob_nurse_bedside_escalation_plan_position';
      addGeneratedHumanoidRoleContinuityWardrobeCue(actor, 'clinical');
      return;
    }

    if (role.includes('family') || role.includes('spouse') || role.includes('parent')) {
      actor.position.set(0.26, 0.42, -0.2);
      actor.rotation.y = -0.34;
      actor.scale.setScalar(0.46);
      actor.userData.openClinXrEncounterStaging = 'ob_partner_peripheral_observer_without_occluding_patient';
      addGeneratedHumanoidRoleContinuityWardrobeCue(actor, 'family');
      return;
    }
  }

  if (role.includes('patient')) {
    actor.position.set(-0.9, 0, 0.08);
    actor.rotation.y = 0.16;
    actor.scale.setScalar(0.88);
  } else if (role.includes('nurse') || role.includes('clinical') || role.includes('consultant') || role.includes('therapist')) {
    actor.position.set(0.64, 0, 0.3);
    actor.rotation.y = -0.18;
    actor.scale.setScalar(0.86);
  } else if (role.includes('family') || role.includes('parent') || role.includes('spouse')) {
    actor.position.set(1.42, 0, 0.04);
    actor.rotation.y = -0.34;
    actor.scale.setScalar(0.82);
  }

  actor.userData.openClinXrEncounterStaging ??=
    'deterministic_clean_encounter_review_framing_keeps_case_defined_actors_visible_without_cropping';
}

function addDynamicEncounterRoomShell(scene: Scene, doorwayTheme: ScenarioDoorwayVisualTheme): void {
  if (shouldUseCleanHumanoidSourceComparatorCapture()) {
    return;
  }
  const wallMaterial = new MeshStandardMaterial({
    color: new Color(doorwayTheme.panelBackground),
    roughness: 0.88,
    metalness: 0,
  });
  const trimMaterial = new MeshStandardMaterial({
    color: new Color(doorwayTheme.panelAccent).lerp(new Color(0xffffff), 0.55),
    roughness: 0.8,
    metalness: 0,
  });
  const backWall = new Mesh(new BoxGeometry(7, 2.65, 0.08), wallMaterial.clone());
  backWall.name = `${runtimeSceneObjectPrefix()}.dynamic-encounter-back-wall`;
  backWall.position.set(0, 1.28, -1.68);
  backWall.userData.openClinXrDynamicScenePolicy =
    "case_theme_room_shell_generated_for_encounter_side_visual_review_not_reusable_exterior_room";
  scene.add(backWall);
  const leftWall = new Mesh(new BoxGeometry(0.08, 2.65, 3.1), wallMaterial.clone());
  leftWall.name = `${runtimeSceneObjectPrefix()}.dynamic-encounter-left-wall`;
  leftWall.position.set(-3.45, 1.28, -0.08);
  leftWall.userData.openClinXrDynamicScenePolicy =
    "case_theme_room_shell_generated_for_encounter_side_visual_review_not_reusable_exterior_room";
  scene.add(leftWall);
  const rightWall = new Mesh(new BoxGeometry(0.08, 2.65, 3.1), wallMaterial.clone());
  rightWall.name = `${runtimeSceneObjectPrefix()}.dynamic-encounter-right-wall`;
  rightWall.position.set(3.45, 1.28, -0.08);
  rightWall.userData.openClinXrDynamicScenePolicy =
    "case_theme_room_shell_generated_for_encounter_side_visual_review_not_reusable_exterior_room";
  scene.add(rightWall);
  const wallTrim = new Mesh(new BoxGeometry(6.7, 0.06, 0.035), trimMaterial);
  wallTrim.name = `${runtimeSceneObjectPrefix()}.dynamic-encounter-wall-protection-rail`;
  wallTrim.position.set(0, 1.02, -1.62);
  wallTrim.userData.openClinXrDynamicScenePolicy =
    "encounter_specific_clinical_wall_trim_generated_from_runtime_theme";
  scene.add(wallTrim);
}

function addScenarioSpecificClinicalSetDressing(scene: Scene, doorwayTheme: ScenarioDoorwayVisualTheme): void {
  if (shouldUseCleanHumanoidSourceComparatorCapture()) {
    return;
  }
  if (encounterRuntimeAssetBundle.scenarioId !== "ob_headache_preeclampsia_triage_v1") {
    return;
  }
  const linenMaterial = new MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.86 });
  const accentMaterial = new MeshStandardMaterial({ color: new Color(doorwayTheme.panelAccent), roughness: 0.78 });
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

function applyGeneratedHumanoidClinicalIdlePosture(humanoid: Group): void {
  const postureRotations = new Map<string, { x?: number; y?: number; z?: number }>([
    ["upper_arm.L", { z: -0.24, y: 0.04 }],
    ["forearm.L", { z: -0.12, y: -0.06 }],
    ["hand.L", { z: -0.05, y: -0.02 }],
    ["upper_arm.R", { z: 0.24, y: -0.04 }],
    ["forearm.R", { z: 0.12, y: 0.06 }],
    ["hand.R", { z: 0.05, y: 0.02 }],
    ["upper_armL", { x: -1.42, y: 0.08, z: -0.22 }],
    ["forearmL", { x: -0.18, y: -0.08, z: 0.14 }],
    ["handL", { x: 0.04, y: 0.02, z: -0.04 }],
    ["upper_armR", { x: -1.42, y: -0.08, z: 0.22 }],
    ["forearmR", { x: -0.18, y: 0.08, z: -0.14 }],
    ["handR", { x: 0.04, y: -0.02, z: 0.04 }],
    ["head", { x: -0.04 }],
  ]);
  humanoid.traverse((object) => {
    const rotation = postureRotations.get(object.name);
    if (!rotation) return;
    if (rotation.x !== undefined) object.rotation.x = rotation.x;
    if (rotation.y !== undefined) object.rotation.y = rotation.y;
    if (rotation.z !== undefined) object.rotation.z = rotation.z;
    object.userData.openClinXrClinicalIdlePosture = "relaxed_arms_scenario_conversation_pose";
  });
  humanoid.userData.openClinXrClinicalIdlePostureCueIds = [
    "relaxed_upper_arm_pose_cue",
    "bent_forearm_conversation_pose_cue",
    "head_attention_posture_cue",
    "arms_lowered_from_generator_bind_pose_cue",
  ];
}

const humanoidJointAliases = new Map<string, string[]>([
  ["head", ["head", "neck"]],
  ["upper_armL", ["upper_arml", "upperarm_l", "leftarm", "left_arm", "leftupperarm", "left_upper_arm", "mixamorigleftarm"]],
  ["forearmL", ["forearml", "forearm_l", "leftforearm", "left_forearm", "leftlowerarm", "left_lower_arm", "mixamorigleftforearm"]],
  ["handL", ["handl", "hand_l", "lefthand", "left_hand", "mixamoriglefthand"]],
  ["upper_armR", ["upper_armr", "upperarm_r", "rightarm", "right_arm", "rightupperarm", "right_upper_arm", "mixamorigrightarm"]],
  ["forearmR", ["forearmr", "forearm_r", "rightforearm", "right_forearm", "rightlowerarm", "right_lower_arm", "mixamorigrightforearm"]],
  ["handR", ["handr", "hand_r", "righthand", "right_hand", "mixamorigrighthand"]],
]);

function applyHumanoidJointRotationsByAlias(
  humanoid: Group,
  rotations: Map<string, { x?: number; y?: number; z?: number }>,
  poseId: string,
): void {
  humanoid.traverse((object) => {
    const normalizedName = object.name.toLowerCase().replaceAll(/[^a-z0-9_]+/g, "");
    for (const [jointId, aliases] of humanoidJointAliases) {
      if (!aliases.some((alias) => normalizedName.includes(alias))) {
        continue;
      }
      const rotation = rotations.get(jointId);
      if (!rotation) {
        continue;
      }
      if (rotation.x !== undefined) object.rotation.x = rotation.x;
      if (rotation.y !== undefined) object.rotation.y = rotation.y;
      if (rotation.z !== undefined) object.rotation.z = rotation.z;
      object.userData.openClinXrRoleSpecificPose = poseId;
      break;
    }
  });
}

function applyGeneratedHumanoidRoleSpecificPosture(humanoid: Group, actorId: string): void {
  const actorRole = runtimeActorRole(actorId);
  if (actorId === runtimePatientActorId()) {
    if (isPediatricAsthmaRuntimeScenario()) {
      const pediatricRespiratoryDistressRotations = new Map<string, { x?: number; y?: number; z?: number }>([
        ["head", { x: -0.18, y: 0.1 }],
        ["upper_armL", { x: -1.34, y: 0.16, z: -0.5 }],
        ["forearmL", { x: -0.78, y: -0.2, z: 0.62 }],
        ["handL", { x: 0.18, y: 0.14, z: -0.24 }],
        ["upper_armR", { x: -1.22, y: -0.12, z: 0.44 }],
        ["forearmR", { x: -0.7, y: 0.2, z: -0.58 }],
        ["handR", { x: 0.18, y: -0.14, z: 0.24 }],
      ]);
      humanoid.traverse((object) => {
        const rotation = pediatricRespiratoryDistressRotations.get(object.name);
        if (!rotation) return;
        if (rotation.x !== undefined) object.rotation.x = rotation.x;
        if (rotation.y !== undefined) object.rotation.y = rotation.y;
        if (rotation.z !== undefined) object.rotation.z = rotation.z;
        object.userData.openClinXrRoleSpecificPose = "pediatric_asthma_hunched_hands_near_chest";
      });
      applyHumanoidJointRotationsByAlias(humanoid, pediatricRespiratoryDistressRotations, "pediatric_asthma_hunched_hands_near_chest");
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
    const patientRotations = new Map<string, { x?: number; y?: number; z?: number }>([
      ["head", { x: -0.12, y: 0.08 }],
      ["upper_armL", { x: -0.34, y: 0.08, z: -0.74 }],
      ["forearmL", { x: -0.24, y: -0.12, z: 0.36 }],
      ["handL", { x: 0.06, y: 0.08, z: -0.08 }],
      ["upper_armR", { x: -0.34, y: -0.08, z: 0.74 }],
      ["forearmR", { x: -0.24, y: 0.12, z: -0.36 }],
      ["handR", { x: 0.06, y: -0.08, z: 0.08 }],
    ]);
    humanoid.traverse((object) => {
      const rotation = patientRotations.get(object.name);
      if (!rotation) return;
      if (rotation.x !== undefined) object.rotation.x = rotation.x;
      if (rotation.y !== undefined) object.rotation.y = rotation.y;
      if (rotation.z !== undefined) object.rotation.z = rotation.z;
      object.userData.openClinXrRoleSpecificPose = "patient_low_guarded_clinical_attention_pose";
    });
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
      ["upper_armL", { x: -0.28, y: 0.14, z: -0.2 }],
      ["forearmL", { x: -0.16, y: -0.12, z: 0.2 }],
      ["handL", { x: 0.08, y: 0.06, z: -0.14 }],
      ["upper_armR", { x: -0.42, y: -0.18, z: 0.26 }],
      ["forearmR", { x: -0.16, y: 0.14, z: -0.24 }],
      ["handR", { x: 0.04, y: -0.1, z: 0.18 }],
    ]);
    humanoid.traverse((object) => {
      const rotation = clinicalTeamRotations.get(object.name);
      if (!rotation) return;
      if (rotation.x !== undefined) object.rotation.x = rotation.x;
      if (rotation.y !== undefined) object.rotation.y = rotation.y;
      if (rotation.z !== undefined) object.rotation.z = rotation.z;
      object.userData.openClinXrRoleSpecificPose = "clinical_team_low_asymmetric_attention_pose";
    });
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
      ["upper_armL", { x: -0.3, y: 0.16, z: -0.2 }],
      ["forearmL", { x: -0.22, y: -0.18, z: 0.26 }],
      ["handL", { x: 0.08, y: 0.18, z: -0.18 }],
      ["upper_armR", { x: -0.36, y: -0.16, z: 0.22 }],
      ["forearmR", { x: -0.26, y: 0.16, z: -0.28 }],
      ["handR", { x: 0.12, y: -0.18, z: 0.2 }],
    ]);
    humanoid.traverse((object) => {
      const rotation = familyRotations.get(object.name);
      if (!rotation) return;
      if (rotation.x !== undefined) object.rotation.x = rotation.x;
      if (rotation.y !== undefined) object.rotation.y = rotation.y;
      if (rotation.z !== undefined) object.rotation.z = rotation.z;
      object.userData.openClinXrRoleSpecificPose = "family_low_anxious_observer_pose";
    });
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
  return faceCueMode === "primitive_fallback" || isHumanoidFaceDetailCaptureMode() || shouldShowRuntimeAffordanceMarkers();
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
  scene.add(scenarioPanel.mesh);
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
  let hairCapName = `${runtimeSceneObjectPrefix()}.${actorId}.actor-specific-hair-cap-variant-cue`;
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
  } else if (faceCueMode === "generated_glb" && isHumanoidFaceDetailCaptureMode()) {
    addGeneratedGlbClothingContinuityCue(humanoid, actorId, accentColor);
  }
  let torsoLayerName = `${runtimeSceneObjectPrefix()}.${actorId}.actor-specific-clothing-layer-silhouette-cue`;
  let roleAccentName = `${runtimeSceneObjectPrefix()}.${actorId}.actor-specific-role-accent-cue`;
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

function addGeneratedGlbClothingContinuityCue(humanoid: Group, actorId: string, accentColor: number): void {
  const scrubMaterial = new MeshStandardMaterial({
    color: accentColor,
    roughness: 0.82,
    metalness: 0.02,
    transparent: true,
    opacity: 0.92,
  });
  scrubMaterial.userData.openClinXrMaterialPolicy =
    "generated_glb_scrub_continuity_layer_covering_exposed_legacy_shoulder_seams_without_debug_proxy_markers";
  const neckline = new Mesh(new BoxGeometry(0.36, 0.065, 0.018), scrubMaterial.clone());
  neckline.name = `${runtimeSceneObjectPrefix()}.${actorId}.generated-glb-scrub-neckline-continuity-cue`;
  neckline.position.set(0, 1.405, 0.322);
  humanoid.add(neckline);
  const leftShoulder = new Mesh(new SphereGeometry(0.105, 18, 10), scrubMaterial.clone());
  leftShoulder.name = `${runtimeSceneObjectPrefix()}.${actorId}.generated-glb-left-scrub-shoulder-continuity-cue`;
  leftShoulder.position.set(-0.18, 1.395, 0.29);
  leftShoulder.scale.set(1.3, 0.34, 0.42);
  humanoid.add(leftShoulder);
  const rightShoulder = new Mesh(new SphereGeometry(0.105, 18, 10), scrubMaterial.clone());
  rightShoulder.name = `${runtimeSceneObjectPrefix()}.${actorId}.generated-glb-right-scrub-shoulder-continuity-cue`;
  rightShoulder.position.set(0.18, 1.395, 0.29);
  rightShoulder.scale.set(1.3, 0.34, 0.42);
  humanoid.add(rightShoulder);
  recordRoleDistinctHumanoidCue(actorId, "generated_glb_scrub_continuity_cue", neckline.name);
  recordRoleDistinctHumanoidCue(actorId, "generated_glb_scrub_continuity_cue", leftShoulder.name);
  recordRoleDistinctHumanoidCue(actorId, "generated_glb_scrub_continuity_cue", rightShoulder.name);
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
    scene.add(controller);
    const controllerGrip = renderer.xr.getControllerGrip(index);
    controllerGrip.userData.openClinXrIwsdkStableObjectName = gripNames[index] ?? null;
    controllerGrip.name = `${runtimeSceneObjectPrefix()}.controller-grip-${index + 1}`;
    controllerGrip.add(controllerModelFactory.createControllerModel(controllerGrip));
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

function deadzone(value: number): number {
  return Math.abs(value) < xrGamepadDeadzone ? 0 : clampUnit(value);
}

function isLocomotionVectorActive(vector: LocomotionVectorEvidence): boolean {
  return Math.abs(vector.forward) > 0 || Math.abs(vector.strafe) > 0 || Math.abs(vector.turn) > 0;
}

function clampUnit(value: number): number {
  return clamp(value, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function actorMesh(color: number): Group {
  const group = new Group();
  const body = new Mesh(new CapsuleGeometry(0.22, 0.7, 8, 16), new MeshStandardMaterial({ color, roughness: 0.7 }));
  body.position.y = 0.55;
  const head = new Mesh(new SphereGeometry(0.2, 24, 16), new MeshStandardMaterial({ color: 0xcaa889, roughness: 0.75 }));
  head.position.y = 1.15;
  group.add(body, head);
  return group;
}

function createVirtualDeviceActorAffordance(actorId: string): Group {
  const placement = runtimeActorPlacement(actorId, {
    slotKind: "family_or_observer",
    position: { x: -2.0, y: 1.05, z: 0.7 },
    scale: { x: 0.72, y: 0.72, z: 0.72 },
    verticalOffsetMeters: 0,
    labelPrefix: "Remote",
  });
  const group = new Group();
  group.name = `openclinxr.virtual-device-actor.${actorId}`;
  group.position.set(placement.position.x, placement.position.y + 0.18, placement.position.z);
  group.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
  const tablet = new Mesh(
    new BoxGeometry(0.38, 0.28, 0.035),
    new MeshStandardMaterial({ color: 0x101820, emissive: 0x12324a, roughness: 0.5 }),
  );
  tablet.name = `${group.name}.tablet-body`;
  const screen = new Mesh(
    new PlaneGeometry(0.32, 0.21),
    new MeshBasicMaterial({ color: 0x79d4ff, transparent: true, opacity: 0.88, side: DoubleSide }),
  );
  screen.name = `${group.name}.remote-screen`;
  screen.position.set(0, 0, -0.021);
  group.add(tablet, screen);
  const marker = createAffordanceMarker(`${actorId}:virtual_device_dialogue_target`, 0x79d4ff);
  marker.position.set(0, 0.22, 0);
  group.add(marker);
  const labelPlate = createActorNameplate(actorNameplateLabel(placement.labelPrefix, actorId), 0x79d4ff);
  labelPlate.position.set(0, 0.38, 0);
  labelPlate.scale.set(0.42, 0.42, 0.42);
  group.add(labelPlate);
  group.userData.openClinXrVirtualDeviceActor = actorId;
  group.userData.openClinXrAffordances = ["virtual_device_dialogue_target", "remote_actor_presence_cue"];
  virtualDeviceActorSlotsByActorId.set(actorId, group);
  return group;
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

function createDetailedEdRoomProps(manifestProps: readonly EncounterRuntimeRoomProp[]): Group[] {
  const fallbackPositions = [
    { x: -2.15, y: 0.65, z: -1.02 },
    { x: 1.92, y: 0.82, z: -1.05 },
    { x: -1.55, y: 0.58, z: 0.96 },
    { x: 1.52, y: 0.58, z: 0.92 },
  ];
  return manifestProps.filter((prop) => shouldRenderRoomPropInVisualReview(prop)).map((prop, propIndex) => roomProp(
    prop.propId,
    Number.isFinite(Number.parseInt(prop.colorHex, 16)) ? Number.parseInt(prop.colorHex, 16) : 0xd9dde3,
    Number.isFinite(Number.parseInt(prop.accentColorHex, 16)) ? Number.parseInt(prop.accentColorHex, 16) : 0x2563eb,
    hasVector3(prop.position)
      ? prop.position
      : fallbackPositions[propIndex % fallbackPositions.length] ?? { x: -2.15, y: 0.65, z: -1.02 },
    hasVector3(prop.scale) ? prop.scale : { x: 0.42, y: 0.42, z: 0.42 },
    prop.label ?? prop.propId.replaceAll("-", " "),
    Array.isArray(prop.affordanceCueIds) ? prop.affordanceCueIds : [`${prop.propId}:visual_context`],
  ));
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
): Group {
  const group = new Group();
  group.name = `${runtimeRoomPropObjectPrefix()}.${propId}`;
  group.position.set(position.x, position.y, position.z);
  group.userData.openClinXrBaseY = position.y;
  environmentReactiveProps.set(propId, group);
  const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color, roughness: 0.7 }));
  body.name = `${group.name}.body`;
  body.scale.set(scale.x, scale.y, scale.z);
  group.add(body);
  addDetailedRoomPropVisuals(group, propId, label, scale, color, accentColor);
  const marker = createAffordanceMarker(affordanceCueIds[0] ?? `${propId}:visual_context`, accentColor);
  marker.position.set(0, scale.y + 0.08, 0);
  group.add(marker);
  const labelPlate = createActorNameplate(label, accentColor);
  labelPlate.name = `${group.name}.label`;
  labelPlate.position.set(0, scale.y + 0.18, 0);
  labelPlate.scale.set(0.48, 0.48, 0.48);
  group.add(labelPlate);
  group.userData.openClinXrAffordances = ["room_context_cue", "clinical_environment_reference", "runtime_scene_manifest_prop"];
  group.userData.openClinXrRuntimeSceneManifestAffordanceCueIds = affordanceCueIds;
  group.userData.openClinXrDynamicEncounterAssetPolicy = "room_prop_rendered_from_active_encounter_scene_manifest_not_hardcoded_shared_world";
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

function createHumanoidSpeechMouthCue(assetId: string, color: number): Mesh {
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
    reason: "Anny-derived GLB now carries surface hair, clothing, eye, brow, and lip geometry; runtime overlays must not obscure the generated humanoid.",
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

function loadGeneratedHumanoidIntoActorSlot(
  actorSlot: Group,
  options: {
    assetPath: string;
    assetId: string;
    objectName: string;
    actorId: string;
    roleTintColor: number;
    verticalOffsetMeters: number;
  },
): void {
  const primitiveFallbackChildren = [...actorSlot.children];
  for (const child of primitiveFallbackChildren) {
    child.visible = false;
  }
  const humanoidLoader = new GLTFLoader();
  const actorSpecificAssetPath = runtimeHumanoidVariantAssetPath(options.actorId, options.assetPath);
  recordSceneAssetStatus({
    assetId: options.assetId,
    assetPath: actorSpecificAssetPath,
    sceneObjectName: options.objectName,
    status: "pending",
    fallbackActive: false,
  });
  humanoidLoader.load(
    actorSpecificAssetPath,
    (gltf) => {
      const humanoid = gltf.scene;
      humanoid.name = options.objectName;
      humanoid.position.set(0, options.verticalOffsetMeters, 0);
      humanoid.rotation.y = 0;
      humanoid.scale.set(1, 1, 1);
      const humanoidSourceComparator = selectedHumanoidSourceComparator();
      const cleanSourceComparatorCapture = shouldUseCleanHumanoidSourceComparatorCapture() && humanoidSourceComparator !== null && options.actorId === runtimePatientActorId();
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
      tintGeneratedSceneMaterials(humanoid, options.roleTintColor, options.actorId);
      humanoid.userData.openClinXrClinicalIdlePoseClipPresent = hasAuthoredClinicalIdlePoseClip(gltf.animations);
      applyGeneratedHumanoidClinicalIdlePosture(humanoid);
      applyGeneratedHumanoidRoleSpecificPosture(humanoid, options.actorId);
      if (cleanSourceComparatorCapture) {
        humanoid.userData.openClinXrRoleSpecificVisualsPolicy = "skipped_for_clean_source_comparator_capture";
        suppressRuntimeDiagnosticOverlaysForSourceComparator(humanoid);
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
      if (isHumanoidMouthGazePoseReviewCaptureMode()) {
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
      if (isHumanoidMouthGazePoseReviewCaptureMode() && options.actorId !== runtimePatientActorId()) {
        actorSlot.visible = false;
        actorSlot.userData.openClinXrCaptureVisibilityPolicy = "hide_secondary_actors_for_primary_humanoid_mouth_gaze_pose_review";
      }
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
        animationPlayback: gltf.animations.length > 0
          ? "gltf_animation_clips_playing"
          : "procedural_dialogue_expression_gaze_fallback",
      });
      recordBootPhase("generated_humanoid_asset_loaded");
    },
    undefined,
    (error) => {
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
  return captureMode.includes("source-clean") || new URLSearchParams(window.location.search).get("humanoidSourceCleanCapture") === "1";
}

function suppressRuntimeDiagnosticOverlaysForSourceComparator(humanoid: Group): void {
  const scaffoldingNamePattern = /comparator|diagnostic|gown|blanket|wrist_band|visible_lip|eye_focus|hair_cap|patient_lap|patient_gown|patient_visible|actor-specific|specific|clothing|accent|pregnancy|abdomen|belly|morph_target|wardrobe|torso|cue/u;
  humanoid.traverse((object) => {
    const name = object.name.toLowerCase();
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
      return '/xr-assets/humanoids/candidates/reom-local-fitted-scrub-top-candidate.glb';
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
    if (actorId === runtimePatientActorId()) return '/xr-assets/humanoids/variants/ob-patient-aisha-generated-human.glb';
    if (actorId === runtimeClinicalTeamActorId()) return '/xr-assets/humanoids/variants/ob-nurse-williams-generated-human.glb';
    if (actorId === runtimeFamilyActorId()) return '/xr-assets/humanoids/variants/ob-partner-omar-generated-human.glb';
  }

  if (scenarioId === 'peds_asthma_parent_anxiety_v1' && role === 'patient') {
    return '/xr-assets/humanoids/variants/pediatric-school-age-generated-human.glb';
  }

  if (/older|elder|geriatric|delirium/u.test(`${scenarioId} ${actorId} ${role}`)) {
    return '/xr-assets/humanoids/variants/older-adult-kyphotic-generated-human.glb';
  }

  return fallbackPath;
}

function selectedHumanoidSourceComparator(): "mpfb_ob_patient" | "charmorph_antonia_patient" | "charmorph_reom_patient" | "reom_local_fitted_garment_patient" | "reom_local_authored_curved_garment_patient" | "reom_shirts01_cc0_patient" | "reom_toigo_basic_tucked_tshirt_patient" | "reom_namuhekam_polo_patient" | null {
  const selected = new URLSearchParams(window.location.search).get("humanoidSourceComparator")?.trim();
  return selected === "mpfb_ob_patient" || selected === "charmorph_antonia_patient" || selected === "charmorph_reom_patient" || selected === "reom_local_fitted_garment_patient" || selected === "reom_local_authored_curved_garment_patient" || selected === "reom_shirts01_cc0_patient" || selected === "reom_toigo_basic_tucked_tshirt_patient" || selected === "reom_namuhekam_polo_patient" ? selected : null;
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
}): void {
  const mixer = input.animationClips.length > 0 ? new AnimationMixer(input.humanoid) : undefined;
  if (mixer) {
    for (const clip of input.animationClips) {
      if (clip instanceof AnimationClip) {
        mixer.clipAction(clip)?.play();
      }
    }
  }
  const slot = {
    assetId: input.assetId,
    actorId: input.actorId,
    root: input.humanoid,
    actorSlot: input.actorSlot,
    baseY: input.humanoid.position.y,
    baseScaleX: input.humanoid.scale.x,
    baseScaleY: input.humanoid.scale.y,
    baseScaleZ: input.humanoid.scale.z,
    baseRotationY: input.humanoid.rotation.y,
    phaseOffsetMs: generatedHumanoidAnimationSlots.length * 480,
    mouthCue: input.mouthCue,
    gazeCue: input.gazeCue,
    eyeFocusCue: input.eyeFocusCue,
    expressionCue: input.expressionCue,
    emotionExpression: createHumanoidEmotionExpressionState(),
    ...(mixer ? { mixer } : {}),
  };
  generatedHumanoidAnimationSlots.push(slot);
  generatedHumanoidAnimationSlotsByActorId.set(input.actorId, slot);
  generatedHumanoidActorSlotsByActorId.set(input.actorId, input.actorSlot);
  input.humanoid.userData.openClinXrAnimationPlayback = mixer
    ? "gltf_animation_clips_playing"
    : "procedural_idle_breathing_fallback";
  if (input.actorId === runtimePatientActorId()) {
    window.requestAnimationFrame(() => {
      triggerHumanoidDialogue(input.actorId, dialogueLine.textContent?.trim() || initialDialogueText, {
        kind: "learner_camera",
        actorId: null,
      });
    });
  }
  recordBootPhase(mixer ? "generated_humanoid_animation_clips_started" : "generated_humanoid_procedural_idle_started");
}

function hasAuthoredClinicalIdlePoseClip(animationClips: unknown[]): boolean {
  return animationClips.some((clip) =>
    clip instanceof AnimationClip && /clinical|idle|relaxed|conversation|consult/i.test(clip.name)
  );
}

function updateGeneratedHumanoidAnimations(deltaSeconds: number, nowMs: number, camera: PerspectiveCamera): void {
  const actorCues: RuntimeHumanoidActingCueEvidence["actorCues"] = [];
  for (const slot of generatedHumanoidAnimationSlots) {
    slot.mixer?.update(deltaSeconds);
    applyGeneratedHumanoidClinicalIdlePosture(slot.root);
    applyGeneratedHumanoidRoleSpecificPosture(slot.root, slot.actorId);
    const t = (nowMs + slot.phaseOffsetMs) / 1000;
    const breathing = Math.sin(t * 1.15);
    const isSpeaking = slot.activeSpeech !== undefined;
    const dialogueLean = isSpeaking ? -0.035 + Math.sin(t * 2.6) * 0.008 : Math.sin(t * 0.51) * 0.006;
    const emotionalSway = Math.sin(t * 0.43) * 0.012;
    const dialogueWeightShift = isSpeaking ? Math.sin(t * 3.1) * 0.008 : 0;
    const pediatricAsthmaOverlay = pediatricAsthmaActingOverlayForSlot(slot, t, isSpeaking);
    slot.root.position.y = slot.baseY + breathing * 0.018;
    slot.root.position.x = emotionalSway + dialogueWeightShift;
    slot.root.rotation.x = dialogueLean + pediatricAsthmaOverlay.rotationX;
    slot.root.rotation.z = Math.sin(t * 0.72) * 0.012 + pediatricAsthmaOverlay.rotationZ;
    slot.root.scale.x = slot.baseScaleX + pediatricAsthmaOverlay.scaleXDelta;
    slot.root.scale.y = slot.baseScaleY + breathing * 0.012 + pediatricAsthmaOverlay.scaleYDelta;
    slot.root.scale.z = slot.baseScaleZ + pediatricAsthmaOverlay.scaleZDelta;
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
  const emotion = runtimeTurn?.affectTimeline?.emotion ?? emotionForDialogueText(text);
  const actorRuntimeRealismRequirement = runtimeTurn?.caseDefinitionRuntimeSignals?.actorRuntimeRealismRequirement;
  if (!actorId) {
    window.__openClinXrHumanoidSpeechEvidence ??= buildHumanoidSpeechEvidence(null, null, null, [], [], null);
    return;
  }
  if (runtimeActorEmbodiment(encounterRuntimeAssetBundle, actorId) === "virtual_device") {
    window.__openClinXrHumanoidSpeechEvidence = buildHumanoidSpeechEvidence(
      actorId,
      `virtual_device:${actorId}`,
      text,
      phonemeSequenceForDialogue(text),
      [],
      gazeTarget,
      undefined,
      actorRuntimeRealismRequirement,
    );
    recordBootPhase("virtual_device_dialogue_routed");
    activeVirtualDeviceSpeechByActorId.set(actorId, {
      actorId,
      assetId: `virtual_device:${actorId}`,
      gazeTargetKind: gazeTarget.kind,
      gazeTargetActorId: gazeTarget.actorId,
      text,
      emotion,
      emotionContext: scenarioDialogueEmotionContext(actorId, text, emotion),
      actorRuntimeRealismRequirement,
      phonemeSequence: phonemeSequenceForDialogue(text),
      visemeSequence: [],
      startedAtMs: performance.now(),
      durationMs: humanoidDialogueDurationMs(phonemeSequenceForDialogue(text).length),
    });
    return;
  }
  triggerHumanoidDialogue(actorId, text, gazeTarget, emotion, actorRuntimeRealismRequirement);
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
): void {
  const slot = generatedHumanoidAnimationSlotsByActorId.get(actorId);
  const phonemeSequence = phonemeSequenceForDialogue(text);
  const visemeSequence = phonemeSequence.map(visemeForPhoneme);
  const emotionContext = scenarioDialogueEmotionContext(actorId, text, explicitEmotion);
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
    startHumanoidEmotionTransition(slot, "neutral", nowMs);
    applyHumanoidMorphTargetCue(slot, 0, "rest", updateHumanoidEmotionExpression(slot, nowMs).weights);
    return;
  }
  const index = Math.min(speech.visemeSequence.length - 1, Math.max(0, Math.floor(progress * speech.visemeSequence.length)));
  const viseme = speech.visemeSequence[index] ?? "rest";
  const openness = visemeOpenness(viseme) * (0.65 + Math.sin(nowMs / 58) * 0.18);
  slot.mouthCue.visible = true;
  slot.mouthCue.scale.set(1 + openness * 1.4, 1 + openness * 3.6, 1);
  const expressionState = updateHumanoidEmotionExpression(slot, nowMs);
  slot.expressionCue.visible = true;
  slot.expressionCue.scale.set(1 + expressionState.weights.cheekTension * 0.22, 1 + expressionState.weights.browConcern * 0.16, 1);
  slot.expressionCue.position.y = -openness * 0.012 + expressionState.weights.browConcern * 0.012;
  slot.root.userData.openClinXrRuntimeExpressionCue = {
    expressionSource: "scenario_dialogue_viseme_gaze_runtime",
    currentViseme: viseme,
    currentEmotion: expressionState.currentEmotion,
    targetEmotion: expressionState.targetEmotion,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionTransitionMs: Number(Math.max(0, nowMs - expressionState.transitionStartedAtMs).toFixed(0)),
    expressionWeights: roundHumanoidExpressionWeights(expressionState.weights),
    cueIds: [
      "visible_runtime_mouth_shape_cue",
      "visible_runtime_eye_focus_cue",
      "visible_runtime_eyebrow_jaw_cheek_cue",
      "emotion_aligned_expression_transition_cue",
    ],
  };
  slot.mouthCue.userData.openClinXrCurrentPhoneme = speech.phonemeSequence[index] ?? "sil";
  slot.mouthCue.userData.openClinXrCurrentViseme = viseme;
  const eyeMotion = computeHumanoidEyeMotionMetrics(speech, nowMs);
  applyHumanoidFaceRigControls(slot, openness, viseme, speech, camera, eyeMotion, expressionState.weights);
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
    activePhoneme: speech.phonemeSequence[index] ?? "sil",
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
    activeExpressionWeights: roundHumanoidExpressionWeights(expressionState.weights),
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
  };
  updateHumanoidGazeCue(slot, speech, camera);
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

function expressionWeightsForEmotion(emotion: HumanoidExpressionEmotion): HumanoidExpressionWeights {
  const weights: Record<HumanoidExpressionEmotion, HumanoidExpressionWeights> = {
    neutral: { mouthOpen: 0.04, browConcern: 0.08, cheekTension: 0.08 },
    anxious: { mouthOpen: 0.18, browConcern: 0.62, cheekTension: 0.48 },
    concerned: { mouthOpen: 0.12, browConcern: 0.72, cheekTension: 0.36 },
    reassured: { mouthOpen: 0.08, browConcern: 0.18, cheekTension: 0.18 },
    pain: { mouthOpen: 0.34, browConcern: 0.86, cheekTension: 0.72 },
  };
  return weights[emotion];
}

function emotionForDialogueText(text: string): HumanoidExpressionEmotion {
  const spoken = text.toLowerCase();
  if (/pain|crushing|tight|pressure|hurts|can't breathe|short of breath/u.test(spoken)) return "pain";
  if (/worried|scared|urgent|anxious|need to know|what does this mean|could be his heart/u.test(spoken)) return "anxious";
  if (/concern|include us|please|help|support/u.test(spoken)) return "concerned";
  if (/thank|better|reassur|understand|okay/u.test(spoken)) return "reassured";
  return "neutral";
}

function scenarioDialogueEmotionContext(
  actorId: string,
  text: string,
  explicitEmotion?: HumanoidExpressionEmotion,
): HumanoidDialogueEmotionContext {
  const scenario = scenarioBank.find((candidate) => candidate.scenarioId === encounterRuntimeAssetBundle.scenarioId)
    ?? scenarioBank.find((candidate) => candidate.scenarioId === selectedScenarioId())
    ?? edChestPainScenario;
  const actor = scenario.actors.find((candidate) => candidate.actorId === actorId);
  const baselineMood = actor?.communicationProfile?.baselineMood ?? [];
  const actorProfileText = [
    ...baselineMood,
    ...(actor?.communicationProfile?.escalationTriggers ?? []),
    ...(actor?.communicationProfile?.deescalationTriggers ?? []),
    actor?.demeanor ?? "",
  ].join(" ");
  const profileEmotion = emotionForScenarioActorProfile(actorProfileText);
  return {
    emotion: explicitEmotion ?? profileEmotion ?? emotionForDialogueText(text),
    source: explicitEmotion
      ? "runtime_affect_timeline"
      : profileEmotion
        ? "scenario_actor_communication_profile"
        : "dialogue_text_heuristic",
    baselineMood,
    cueIds: [
      "scenario_actor_baseline_mood_emotion_mapping",
      "scenario_dialogue_emotion_transition_cue",
      "case_definition_driven_expression_selection",
    ],
  };
}

function emotionForScenarioActorProfile(profileText: string): HumanoidExpressionEmotion | undefined {
  const profile = profileText.toLowerCase();
  if (/pain|uncomfortable|breathless|wheeze|distress/u.test(profile)) return "pain";
  if (/frightened|anxious|worried|fearful|protective|urgent|scared|frustrated/u.test(profile)) return "anxious";
  if (/concerned|focused|watchful|safety|ready to act/u.test(profile)) return "concerned";
  if (/reassur|calm|polite|helpful/u.test(profile)) return "reassured";
  return undefined;
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
  slot.root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.morphTargetDictionary || !object.morphTargetInfluences) {
      return;
    }
    const mouthOpenIndex = object.morphTargetDictionary.openclinxr_mouth_open;
    const browConcernIndex = object.morphTargetDictionary.openclinxr_brow_concern;
    const cheekTensionIndex = object.morphTargetDictionary.openclinxr_cheek_tension;
    if (typeof mouthOpenIndex === "number") {
      object.morphTargetInfluences[mouthOpenIndex] = Math.min(0.95, Math.max(0, openness + expressionWeights.mouthOpen * 0.18));
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
  slot.root.userData.openClinXrMorphTargetRuntimeCue = {
    currentViseme: viseme,
    mouthOpenness: Number(openness.toFixed(3)),
    expressionWeights: roundHumanoidExpressionWeights(expressionWeights),
    appliedTargetCount: applied,
    targetNames: ["openclinxr_mouth_open", "openclinxr_brow_concern", "openclinxr_cheek_tension"],
    cueIds: ["dialogue_viseme_and_gaze_mapping", "visible_runtime_mouth_shape_cue", "emotion_aligned_expression_transition_cue"],
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
  return actorIds[tag] ?? actorIdForTraceTag(tag);
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

function phonemeSequenceForDialogue(text: string): string[] {
  const spoken = text.replace(/^[^:]+:\s*/u, "").toLowerCase();
  const sequence: string[] = [];
  for (const char of spoken) {
    if (/[aeiou]/u.test(char)) sequence.push(char);
    else if (/[bmp]/u.test(char)) sequence.push("m");
    else if (/[fv]/u.test(char)) sequence.push("f");
    else if (/[tdnlsz]/u.test(char)) sequence.push("t");
    else if (/[kgqcr]/u.test(char)) sequence.push("k");
    else if (/[wy]/u.test(char)) sequence.push("w");
    else if (/[.!?]/u.test(char)) sequence.push("sil");
  }
  return sequence.length > 0 ? sequence.slice(0, 48) : ["sil"];
}

function visemeForPhoneme(phoneme: string): string {
  if (phoneme === "sil") return "rest";
  if (phoneme === "m") return "closed";
  if (phoneme === "f") return "teeth";
  if (phoneme === "w") return "rounded";
  if (phoneme === "a" || phoneme === "o") return "open";
  if (phoneme === "e" || phoneme === "i") return "wide";
  return "mid";
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

function equipmentSlotMesh(primaryColor: number, accentColor: number): Group {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(0.42, 0.72, 0.32), new MeshStandardMaterial({ color: primaryColor, roughness: 0.72 }));
  body.position.y = 0.46;
  const accent = new Mesh(new BoxGeometry(0.32, 0.18, 0.04), new MeshStandardMaterial({ color: accentColor, roughness: 0.65 }));
  accent.position.set(0, 0.92, -0.18);
  group.add(body, accent);
  return group;
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
  const blobName = asset.blob.blobName.replace(/^\/+/u, "");
  const fileName = blobName.split("/").at(-1);
  if (!fileName) {
    return resolveRuntimeAssetUrl(asset);
  }
  if (asset.kind === "humanoid_model") {
    return `/xr-assets/humanoids/${fileName}`;
  }
  if (asset.kind === "environment_model") {
    return `/xr-assets/environment/${fileName}`;
  }
  if (asset.kind === "equipment_model") {
    return `/xr-assets/medical-equipment/${fileName}`;
  }
  return resolveRuntimeAssetUrl(asset);
}

function runtimeGeneratedSceneObjectName(asset: EncounterRuntimeAsset): string {
  return asset.assetId.replace(/[^a-z0-9:_-]+/giu, "-");
}

function runtimeAssetDisplayLabel(asset: EncounterRuntimeAsset, fallback: string): string {
  const rawSegment = asset.assetId.split(".").at(-2) ?? fallback;
  const label = rawSegment
    .replace(/_equipment$/u, "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return label || fallback;
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
      sceneSlot.add(equipment);
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
    examineeLocomotionEvidence: window.__openClinXrExamineeLocomotionEvidence ?? null,
    runtimeInteractionEvidence: latestRuntimeInteractionEvidence,
    traceInteractionEvidenceSummary: window.__openClinXrTraceInteractionEvidenceSummary ?? null,
    }),
    portalTransitionEvidence: window.__openClinXrPortalTransitionEvidence ?? null,
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
  ].join(" | ");
}

function formatHumanoidSpeechAffectEvidence(evidence: HumanoidSpeechEvidence | null): string {
  if (!evidence?.activeActorId) {
    return "speech affect pending";
  }
  const weights = evidence.activeExpressionWeights;
  const actorRequirement = evidence.activeActorRuntimeRealismRequirement;
  const weightSummary = weights
    ? `mouth ${weights.mouthOpen ?? 0}; brow ${weights.browConcern ?? 0}; cheek ${weights.cheekTension ?? 0}`
    : "weights pending";
  const actorRequirementSummary = actorRequirement
    ? [
        `actor ${actorRequirement.role}:${actorRequirement.actorId}`,
        `locomotion ${String(actorRequirement.locomotionRequired)}`,
        `expression ${String(actorRequirement.expressionRequired)}`,
        `gaze ${String(actorRequirement.gazeRequired)}`,
        `lip-sync ${String(actorRequirement.lipSyncRequired)}`,
        `interaction ${String(actorRequirement.interactionRequired)}`,
        `cues ${actorRequirement.requiredCueIds.length}`,
      ].join("; ")
    : "actor realism requirement pending";
  return [
    evidence.activeEmotionState ? `emotion ${evidence.activeEmotionState}` : "emotion pending",
    typeof evidence.activeExpressionTransitionMs === "number" ? `transition ${evidence.activeExpressionTransitionMs}ms` : "transition pending",
    weightSummary,
    actorRequirementSummary,
    evidence.activeExpressionCueIds?.includes("emotion_aligned_expression_transition_cue") ? "emotion transition cue present" : "emotion transition cue missing",
  ].join(" | ");
}

function formatActiveActorRealismRequirementLines(evidence: HumanoidSpeechEvidence | null): string[] {
  const requirement = evidence?.activeActorRuntimeRealismRequirement;
  const launchBadge = evidence?.activeActorRealismLaunchBadge;
  if (!requirement) {
    return [
      "No active dialogue actor requirement yet.",
      "Select a trace action to show case-defined obligations.",
      "Boundary: display only, not readiness proof.",
    ];
  }
  const dimensions = [
    requirement.locomotionRequired ? "locomotion" : "",
    requirement.expressionRequired ? "expression" : "",
    requirement.gazeRequired ? "gaze" : "",
    requirement.lipSyncRequired ? "lip-sync" : "",
    requirement.interactionRequired ? "interaction" : "",
  ].filter(Boolean);
  return [
    `${requirement.role}: ${requirement.actorId}`,
    `Badge: ${launchBadge?.status ?? "realismBlocked"} until actor-specific humanoid gate evidence attaches`,
    `Mood: ${requirement.baselineMood.join(", ") || "not specified"}`,
    `Required: ${dimensions.join(", ") || "metadata pending"}`,
    `Cue IDs: ${requirement.requiredCueIds.slice(0, 3).join(", ")}`,
    requirement.requiredCueIds.length > 3 ? `+${requirement.requiredCueIds.length - 3} more cues in copied evidence` : "All active cues shown",
    "Not Quest/clinical/scoring readiness.",
  ];
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
    sceneBootMessage.querySelector("span")!.textContent = `3D scene blocked: ${formatUnknownError(error)}. Use Quest/manual evidence before readiness claims.`;
  }
}
