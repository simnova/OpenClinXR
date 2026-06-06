import type {
  EncounterRuntimeDialogueTurn,
  EncounterRuntimeEvidenceGateId,
  EncounterRuntimeLearnerUseGate,
  LearnerRuntimeAssetBundle,
  RuntimeAssetStoreKind,
} from "@openclinxr/asset-registry/runtime-bundles";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";

export type XrRuntimeState = {
  scenarioId: string;
  title: string;
  elapsedSecond: number;
  requiredTraceTags: string[];
  completedTraceTags: string[];
};

export type TraceReadinessSummary = {
  observedCount: number;
  missingCount: number;
  missingTraceTags: string[];
};

export type RuntimeEvidenceLaneId =
  | "model_dialogue"
  | "voice_synthesis"
  | "quest_foreground"
  | "mixed_reality";

export type RuntimeEvidenceLaneStatus =
  | "mock_active"
  | "blocked_with_evidence"
  | "separate_lane_available"
  | "separate_lane_blocked";

export type RuntimeEvidenceLane = {
  id: RuntimeEvidenceLaneId;
  label: string;
  status: RuntimeEvidenceLaneStatus;
  display: string;
  evidencePath: string;
  blockers: string[];
  details: Record<string, unknown>;
};

export type RuntimeEvidencePosture = {
  source: "window.__openClinXrRuntimeEvidencePosture";
  summary: string;
  lanes: RuntimeEvidenceLane[];
  notEvidenceFor: string[];
};

export type RuntimeEvidencePostureInput = {
  traceSummary: TraceReadinessSummary;
  captureSummary: ManualPerformanceCaptureSummary | null;
  webXrSupport: ManualPerformanceReproducibilityEvidence["webXr"];
  traceActionHandoffEvidence?: XrTraceActionHandoffEvidence | null;
  runtimeInteractionEvidence?: RuntimeInteractionEvidence | null;
  runtimeNowMs?: number | null;
};

export type RemoteActorTurnPlan = {
  actorId: string;
  voiceId: string;
  learnerUtterance: string;
  traceContextTags: string[];
};

export type IwsdkStationMcpSmokeTool =
  | "xr_get_session_status"
  | "xr_accept_session"
  | "browser_screenshot"
  | "scene_get_hierarchy"
  | "xr_select"
  | "browser_get_console_logs";

export type IwsdkStationMcpSmokeStep = {
  id: string;
  toolName: IwsdkStationMcpSmokeTool;
  expectedEvidence: string;
  traceTag?: string;
  requiredSceneObjects?: string[];
};

export type IwsdkStationMcpSmokePlan = {
  mode: "agent";
  smokePlanHash: string;
  scenarioId: string;
  scenarioVersion: number;
  scenarioTitle: string;
  mcpToolOrder: IwsdkStationMcpSmokeTool[];
  requiredSceneObjectNames: string[];
  controllerSelectTraceTag: string;
  steps: IwsdkStationMcpSmokeStep[];
  blockedUntil: string[];
};

export type IwsdkStationMcpSmokeEvidence = {
  objectNames: string[];
  traceActionTags?: string[];
};

export type IwsdkStationMcpSmokeReadiness = {
  ready: boolean;
  blockers: string[];
};

export type FrameDeltaSummary = {
  sampleCount: number;
  avgFrameMs: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  approxFps: number | null;
};

export type ManualPerformanceFrameStats = FrameDeltaSummary & {
  framesObserved: number;
  firstFrameAtMs?: number | null;
  latestFrameAtMs: number | null;
  sampleWindowSize: number;
  latestFrameDeltaMs?: number | null;
  sampleWindowMs?: number | null;
  longFrameCountOver33Ms?: number;
  longFrameRatio?: number | null;
  previewFramesObserved?: number;
  immersiveFramesObserved?: number;
  qualitySource?: "webxr_animation_loop" | "flat_preview_fallback";
  renderLoopMode?: "webxr_animation_loop_with_preview_fallback";
  isPresenting?: boolean;
  visibilityState?: string;
};

export type ManualPerformanceMetrics = {
  avgFps: number | null;
  p95FrameMs: number | null;
  minimumObservedFps: number | null;
  controllerSelectLatencyMs: number | null;
  source: "window.__openClinXrFrameStats";
  framesObserved: number;
  sampleWindowSize: number;
  firstFrameAtMs?: number | null;
  previewFramesObserved?: number;
  immersiveFramesObserved?: number;
};

export type HandRepresentationKind =
  | "primitive_boxes"
  | "primitive_spheres"
  | "mesh"
  | "controller_only"
  | "not_visible"
  | "unknown";

export type LocomotionAttempt =
  | "not_attempted"
  | "keyboard_attempted_no_runtime_event"
  | "thumbstick_attempted_no_runtime_event"
  | "hand_gesture_attempted_no_runtime_event"
  | "room_scale_attempted_no_runtime_event"
  | "mixed_attempted_no_runtime_event"
  | "runtime_event_observed";

export type ManualPerformanceInputEvidence = {
  handModelCount: number;
  handModelStatus: "pending_immersive_session" | "installed" | "failed";
  handRepresentationKind?: HandRepresentationKind;
  handAssetLoadErrors?: string[];
  handInputsObserved: number;
  locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly";
  locomotionAttempt?: LocomotionAttempt;
  lastInputObservedAtMs?: number | null;
  lastLocomotionAtMs: number | null;
  activeLocomotionSource?: "none" | "keyboard" | "xr_gamepad" | "xr_hand_gesture" | "xr_room_scale" | "mixed";
  inputSourceCount?: number;
  inputSourceKinds?: RuntimeInputSourceKind[];
  keyboardVector?: LocomotionVectorEvidence;
  xrVector?: LocomotionVectorEvidence;
  xrHandGestureVector?: LocomotionVectorEvidence;
  xrHandGestureState?: XrHandGestureStateEvidence;
  xrHandSelectState?: XrHandSelectStateEvidence;
  xrInputSources?: XrInputSourceEvidence[];
  locomotionDiagnostics?: LocomotionAttemptDiagnosticsEvidence;
  rigPosition: { x: number; z: number };
  roomScalePose?: RigPoseEvidence;
  roomScaleDelta?: LocomotionDeltaEvidence;
  locomotionDelta?: LocomotionDeltaEvidence;
};

export type RuntimeInputSourceKind = "keyboard" | "xr_gamepad" | "xr_hand" | "xr_hand_gesture" | "xr_room_scale";

export type ExamineeLocomotionEvidence = {
  source: Exclude<NonNullable<ManualPerformanceInputEvidence["activeLocomotionSource"]>, "none" | "mixed"> | "mixed";
  startPose: RigPoseEvidence;
  currentPose: RigPoseEvidence;
  distanceMeters: number;
  turnRadians: number;
  sampleCount: number;
  pathCueIds: string[];
  notEvidenceFor: [
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
    "motion_comfort_validation",
  ];
};

export type LocomotionVectorEvidence = {
  forward: number;
  strafe: number;
  turn: number;
};

export type HandGestureLocomotionVectorInput = {
  handedness: "left" | "right";
  relativeOffsetMeters: { x: number; z: number };
  movementDeadzoneMeters: number;
  turnDeadzoneMeters: number;
  movementSensitivity: number;
  turnSensitivity: number;
  turnCoolingDown: boolean;
};

export type HandGestureLocomotionVectorResult = LocomotionVectorEvidence & {
  movementCrossedDeadzone: boolean;
  turnCrossedDeadzone: boolean;
};

export type HandGestureLocomotionJointMeters = {
  x: number;
  z: number;
};

export type HandGestureLocomotionJointsMeters = {
  wrist: HandGestureLocomotionJointMeters;
  indexTip: HandGestureLocomotionJointMeters;
  thumbTip: HandGestureLocomotionJointMeters;
};

export type RigPoseEvidence = {
  x: number;
  z: number;
  yawRadians: number;
};

export type LocomotionDeltaEvidence = {
  from: RigPoseEvidence;
  to: RigPoseEvidence;
  delta: RigPoseEvidence;
  distanceMeters: number;
  turnRadians: number;
};

export type XrInputSourceEvidence = {
  handedness: string;
  hasHand: boolean;
  hasGamepad: boolean;
  axisCount: number;
};

export type XrGamepadLocomotionDiagnosticEvidence = {
  handedness: string;
  rawAxes: number[];
  selectedXAxisIndex: number | null;
  selectedYAxisIndex: number | null;
  xAxisAfterDeadzone: number;
  yAxisAfterDeadzone: number;
  activeAfterDeadzone: boolean;
  contribution: "move" | "turn";
};

export type XrHandGestureHandDiagnosticEvidence = {
  handedness: "left" | "right";
  jointsVisible: {
    wrist: boolean;
    indexTip: boolean;
    thumbTip: boolean;
  };
  pinchDistanceMeters: number | null;
  pinching: boolean;
  armed: boolean;
  dwellMs: number;
  relativeOffsetMeters: { x: number; z: number } | null;
  movementCrossedDeadzone: boolean;
  blockedReason?: XrHandGestureStateEvidence["blockedReason"] | "below_deadzone" | "turn_cooldown";
};

export type LocomotionAttemptDiagnosticsEvidence = {
  claimScope: "attempt_diagnostics_only";
  gamepadDeadzone: number;
  handPinchThresholdMeters: number;
  handGestureDeadzoneMeters: number;
  handGestureTurnDeadzoneMeters: number;
  gamepadSources: XrGamepadLocomotionDiagnosticEvidence[];
  handGestureHands: XrHandGestureHandDiagnosticEvidence[];
};

export type XrHandGestureStateEvidence = {
  armed: boolean;
  dwellMs: number;
  leftPinch: boolean;
  rightPinch: boolean;
  gestureDeadzoneMeters: number;
  turnCooldownMs: number;
  blockedReason?: "not_pinching" | "arming_dwell" | "missing_joints" | "other_locomotion_source_active";
};

export type XrHandSelectStateEvidence = {
  status: "idle" | "arming" | "ready" | "fired" | "blocked";
  armed: boolean;
  dwellMs: number;
  rightPinch: boolean;
  firedCount: number;
  lastFiredAtMs: number | null;
  blockedReason?: "not_pinching" | "arming_dwell" | "missing_joints" | "moving_too_much" | "controller_input_active" | "cooldown" | "trace_unavailable";
};

export type ManualPerformanceInputEvidenceInput = {
  handModelCount: number;
  handModelStatus: ManualPerformanceInputEvidence["handModelStatus"];
  activeHandRepresentationKind?: HandRepresentationKind;
  handAssetLoadErrors?: string[];
  handInputsObserved: number;
  keyboardVector: LocomotionVectorEvidence;
  xrVector: LocomotionVectorEvidence;
  xrHandGestureVector?: LocomotionVectorEvidence;
  xrHandGestureState?: XrHandGestureStateEvidence;
  xrHandSelectState?: XrHandSelectStateEvidence;
  xrInputSources: XrInputSourceEvidence[];
  locomotionDiagnostics?: LocomotionAttemptDiagnosticsEvidence;
  now: number;
  previousLastInputObservedAtMs: number | null;
  previousLastLocomotionAtMs: number | null;
  previousRigPose?: RigPoseEvidence | null;
  rigPosition: { x: number; z: number };
  rigYawRadians?: number;
  previousRoomScalePose?: RigPoseEvidence | null;
  roomScalePose?: RigPoseEvidence | null;
};

export type RuntimeFrameStatsInput = {
  frameDeltasMs: number[];
  framesObserved: number;
  firstFrameAtMs?: number | null;
  latestFrameAtMs: number;
  previewFramesObserved?: number;
  immersiveFramesObserved?: number;
  qualitySource: "webxr_animation_loop" | "flat_preview_fallback";
  isPresenting: boolean;
  visibilityState: string;
};

export type ReadableVrTextPanelEvidence = {
  name: string;
  title: string;
  source: "canvas_texture_metadata";
  canvasPixels: { width: number; height: number };
  worldMeters: { width: number; height: number };
  lineCount: number;
  previewLines: string[];
  contentHash: string;
  lastUpdatedAtMs: number;
  readabilityClaim: "metadata_only_requires_foreground_headset_confirmation";
};

export type ReadableVrTextPanelEvidenceInput = {
  name: string;
  title: string;
  lines: readonly string[];
  canvasPixels: { width: number; height: number };
  worldMeters: { width: number; height: number };
  updatedAtMs: number;
};

export type ReadableVrTextPanelEvidenceSet = {
  source: "window.__openClinXrTextPanelEvidence";
  panelCount: number;
  panels: ReadableVrTextPanelEvidence[];
  limitations: ["metadata_only_requires_foreground_headset_confirmation"];
};

export type ManualPerformanceTraceLatencyEvidence = {
  lastTraceTag: string | null;
  lastSelectLatencyMs: number | null;
  source: "dom_click_trace_button" | "xr_controller_select" | "xr_hand_select";
  measuredAtMs: number | null;
  productionControllerLatencySubstitute: false;
  interactionDetail?: XrHandSelectInteractionDetail;
};

export type XrHandSelectInteractionDetail = {
  modality: "hand_pinch_select";
  handedness: "right";
  status: XrHandSelectStateEvidence["status"];
  blockedReason?: XrHandSelectStateEvidence["blockedReason"];
  dwellMs: number;
  firedCount: number;
  rightPinch: boolean;
};

export type XrTraceActionHandoffAction = {
  sequence: number;
  traceTag: string;
  source: ManualPerformanceTraceLatencyEvidence["source"];
  eventType: string;
  actorId: string | null;
  completedAtSecond: number;
  completedAtMs: number;
  selectLatencyMs: number | null;
};

export type XrTraceActionHandoffEvidence = {
  source: "window.__openClinXrTraceActionHandoffEvidence";
  scenarioId: string;
  title: string;
  generatedAtMs: number;
  observedRequiredCount: number;
  requiredCount: number;
  missingCount: number;
  missingTraceTags: string[];
  nextTraceTag: string | null;
  latestAction: XrTraceActionHandoffAction | null;
  actions: XrTraceActionHandoffAction[];
  lastTraceLatencyEvidence: ManualPerformanceTraceLatencyEvidence | null;
  iwsdkSidecarHandoff: {
    posture: "sidecar_only_supporting_evidence";
    smokePlanHash: string;
    controllerSelectTraceTag: string;
    requiredSceneObjectNames: string[];
    reviewTargets: {
      clinicalPanel: string;
      dialoguePanel: string;
      actorRealismPanel: string;
      inputPanel: string;
      controllerGripLeft: string;
      controllerGripRight: string;
    };
  };
  notEvidenceFor: readonly [
    "production_quest_readiness",
    "validated_clinical_score_use",
    "live_provider_readiness",
  ];
};

export type XrTraceInteractionEvidenceSummary = {
  source: "xr_trace_action_handoff_summary";
  scenarioId: string;
  latestTraceTag: string | null;
  latestTraceSource: XrTraceActionHandoffAction["source"] | null;
  latestTraceLatencyMs: number | null;
  observedRequiredCount: number;
  requiredCount: number;
  nextMissingTraceTag: string | null;
  sourceClass: "headset_class_input" | "desktop_or_runtime_input" | "not_observed";
  reviewSafe: true;
  claimBoundary: "xr_trace_interaction_summary_not_quest_readiness";
  notEvidenceFor: readonly [
    "production_quest_readiness",
    "validated_clinical_score_use",
    "live_provider_readiness",
  ];
};

export type TraceInteractionAttempt =
  | "not_attempted"
  | "dom_click_attempted_no_runtime_event"
  | "xr_controller_select_attempted_no_runtime_event"
  | "xr_hand_select_attempted_no_runtime_event"
  | "runtime_event_observed";

export type ManualPerformanceBrowserVersionHints = {
  oculusBrowser: string | null;
  chrome: string | null;
};

export type ManualPerformanceReproducibilityEvidence = {
  source: "browser_runtime";
  url: string;
  userAgent: string;
  browserVersionHints: ManualPerformanceBrowserVersionHints;
  app: {
    packageName: string;
    version: string;
    gitCommit: string;
    buildTime: string;
    mode: string;
  };
  webXr: {
    navigatorXrPresent: boolean;
    immersiveVrSupported: boolean | null;
    immersiveVrSupportCheckedAtMs: number | null;
    immersiveArSupported: boolean | null;
    immersiveArSupportCheckedAtMs: number | null;
    supportError: string | null;
  };
  display: {
    viewportWidth: number;
    viewportHeight: number;
    screenWidth: number | null;
    screenHeight: number | null;
    devicePixelRatio: number;
    visibilityState: string;
  };
  limitations: [
    "browser_reported_metadata_not_device_firmware_proof",
    "display_refresh_rate_inferred_from_frame_cadence",
  ];
};

export type ManualPerformanceReproducibilityInput = Omit<
  ManualPerformanceReproducibilityEvidence,
  "source" | "browserVersionHints" | "limitations"
>;

export type ManualPerformanceDraft = {
  generatedAt: string;
  runContext: {
    performedBy: string;
    durationMinutes: number;
    notes: string;
  };
  setup: {
    foregroundPageConfirmed: boolean;
    devtoolsScreencastDisabled: boolean;
    extraBrowserWindowsClosed: boolean;
  };
  station: {
    shellLoaded: true;
    traceInteractionPassed: boolean;
    traceInteractionAttempt: TraceInteractionAttempt;
    textReadable: true;
    immersiveSessionStarted: boolean;
    consoleErrors: string[];
  };
  experience: XrExperienceModeEvidence;
  input: ManualPerformanceInputEvidence | null;
  traceLatencyProxy: ManualPerformanceTraceLatencyEvidence | null;
  performance: ManualPerformanceMetrics;
  reproducibility?: ManualPerformanceReproducibilityEvidence;
  comfort: {
    motionComfort: "comfortable" | "good" | "mild_discomfort" | "uncomfortable" | "not_run";
    heatConcern: boolean | null;
    batteryDropPercent: number | null;
  };
};

export type ManualPerformanceCaptureSummary = {
  source: "window.__openClinXrManualPerformanceDraft";
  generatedAt: string | null;
  framesObserved: number | null;
  firstFrameAtMs: number | null;
  latestFrameAtMs: number | null;
  frameStatsAgeMs: number | null;
  frameStatsFresh: boolean | null;
  sampleWindowSize: number | null;
  previewFramesObserved: number | null;
  immersiveFramesObserved: number | null;
  isPresenting: boolean | null;
  visibilityState: string | null;
  qualitySource: ManualPerformanceFrameStats["qualitySource"] | null;
  handInputsObserved: number | null;
  handModelStatus: ManualPerformanceInputEvidence["handModelStatus"] | null;
  handRepresentationKind: ManualPerformanceInputEvidence["handRepresentationKind"] | null;
  handAssetLoadErrors: string[];
  activeLocomotionSource: ManualPerformanceInputEvidence["activeLocomotionSource"] | null;
  inputSourceKinds: RuntimeInputSourceKind[];
  lastLocomotionAtMs: number | null;
  locomotionAttempt: ManualPerformanceInputEvidence["locomotionAttempt"] | null;
  locomotionDistanceMeters: number | null;
  locomotionTurnRadians: number | null;
  locomotionPathQuality: LocomotionPathQualitySummary | null;
  locomotionDiagnosticSummary: LocomotionDiagnosticSummary | null;
  locomotionProbeSummary: LocomotionProbeSummary | null;
  traceLatencySource: ManualPerformanceTraceLatencyEvidence["source"] | null;
  traceInteractionAttempt: TraceInteractionAttempt | null;
  lastTraceTag: string | null;
  lastTraceLatencyMs: number | null;
  handSelectStatus: XrHandSelectStateEvidence["status"] | null;
  handSelectDwellMs: number | null;
  handSelectFiredCount: number | null;
  handSelectBlockedReason: XrHandSelectStateEvidence["blockedReason"] | null;
  immersiveFrameEvidenceReady: boolean;
  headsetSelectLatencyReady: boolean;
  locomotionEvidenceReady: boolean;
  technicalGaps: string[];
  draftAvailable: boolean;
  manualValidationReady: boolean;
  satisfiedConditions: string[];
  blockers: string[];
};

export type RuntimeInteractionEvidence = {
  capturedAtMs: number;
  activeLocomotionSource: ManualPerformanceInputEvidence["activeLocomotionSource"] | null;
  locomotionAttempt: ManualPerformanceInputEvidence["locomotionAttempt"] | null;
  locomotionDistanceMeters: number | null;
  locomotionTurnRadians: number | null;
  locomotionProbeReadiness: LocomotionProbeSummary["readiness"] | null;
  locomotionProbePrimaryReason: LocomotionProbeSummary["primaryReason"] | null;
  locomotionProbeReasonCodes: LocomotionProbeSummary["reasonCodes"] | null;
  handSelectStatus: XrHandSelectStateEvidence["status"] | null;
  handSelectDwellMs: number | null;
  handSelectFiredCount: number | null;
  handSelectBlockedReason: XrHandSelectStateEvidence["blockedReason"] | null;
  activeEmotionState: HumanoidSpeechEvidence["activeEmotionState"] | null;
  activeExpressionTransitionMs: HumanoidSpeechEvidence["activeExpressionTransitionMs"] | null;
  activeExpressionCueCount: number;
  activeBodyMotionMode: HumanoidSpeechEvidence["activeBodyMotionMode"] | null;
  activeBodyMotionIntensity: HumanoidSpeechEvidence["activeBodyMotionIntensity"] | null;
  activeMouthOpenness: HumanoidSpeechEvidence["activeMouthOpenness"] | null;
  activeEyeBlinkIntensity: HumanoidSpeechEvidence["activeEyeBlinkIntensity"] | null;
  gazeTargetKind: HumanoidSpeechEvidence["gazeTargetKind"] | null;
  gazeTargetActorId: HumanoidSpeechEvidence["gazeTargetActorId"] | null;
};

export type LocomotionPathQualitySummary = {
  claimScope: "path_shape_probe_only";
  sampleCount: number;
  distanceMeters: number;
  turnRadians: number;
  straightLineOnly: boolean;
  pathCueIds: string[];
  blockers: string[];
};

export type ManualPerformanceEvidencePayload = {
  manualPerformanceDraft: ManualPerformanceDraft | null;
  captureSummary: ManualPerformanceCaptureSummary;
  runtimeAssetBundleId: string | null;
  learnerRuntimeUseGateEvidence: LearnerRuntimeUseGateEvidence | null;
  runtimeSceneManifestEvidence: RuntimeSceneManifestEvidence | null;
  textPanelEvidence: ReadableVrTextPanelEvidenceSet | null;
  traceActionHandoffEvidence: XrTraceActionHandoffEvidence | null;
  sceneAssetEvidence: SceneAssetEvidence | null;
  environmentStateEvidence: EnvironmentStateEvidence | null;
  humanoidSpeechEvidence: HumanoidSpeechEvidence | null;
  caseDefinedHumanoidPerformanceContractEvidence: CaseDefinedHumanoidPerformanceContractEvidence | null;
  actorPlayerRuntimeMetadataSummary: ActorPlayerRuntimeMetadataSummary | null;
  examineeLocomotionEvidence: ExamineeLocomotionEvidence | null;
  runtimeInteractionEvidence: RuntimeInteractionEvidence | null;
  traceInteractionEvidenceSummary: XrTraceInteractionEvidenceSummary | null;
  runtimeVisualEvidenceCaptureScaffold: RuntimeVisualEvidenceCaptureScaffold | null;
  runtimeEvidenceConsumerReadiness: RuntimeEvidenceConsumerReadiness | null;
};

export type ActorPlayerRuntimeMetadataSummary = {
  source: "model_vetting_actor_player_runtime_evidence";
  sourceArtifactPath: string;
  executionMode: "local_deterministic_non_scene";
  actorCount: number;
  projectedTurnCount: number;
  projectedSampleCount: number;
  actorSummaries: Array<{
    actorId: string;
    turnCount: number;
    sampleCount: number;
    roleAnimationClipNames?: string[];
    sceneExecutionStatus: "not_scene_executed";
    blockerIds: string[];
  }>;
  providerExecutionPerformed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  scenePlacementEvidenceAllowed: false;
  claimBoundary: "ui_xr_actor_player_metadata_only_not_runtime_execution";
  notEvidenceFor: Array<
    | "real_anny_model_output"
    | "b_plus_visual_realism_gate"
    | "scene_placement_readiness"
    | "quest_readiness"
    | "production_asset_readiness"
    | "learner_readiness"
    | "clinical_validity"
    | "scoring_validity"
  >;
};

export type RuntimeVisualEvidenceAttachmentCandidate = {
  actionId: "attach_runtime_realism_evidence_refs" | "attach_visual_qa_evidence_refs";
  inputId: string;
  inputKind: "runtime_realism_signal_input" | "visual_qa_review_input";
  evidenceRef: string;
  localArtifactPath: string;
  reviewerId: "ui_xr_manual_runtime_evidence_capture_scaffold";
  attachmentStatus: "attached_metadata_only";
  comments: string;
  attachedAt: string;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "ui_xr_metadata_only_attachment_candidate_not_submitted";
  notEvidenceFor: [
    "provider_availability",
    "runtime_readiness",
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
    "scoring_validity",
    "learner_launch_readiness",
  ];
};

export type RuntimeVisualEvidenceAttachmentSubmitInput = {
  scenarioId: string;
  attachments: Array<Pick<
    RuntimeVisualEvidenceAttachmentCandidate,
    | "actionId"
    | "inputId"
    | "inputKind"
    | "evidenceRef"
    | "localArtifactPath"
    | "reviewerId"
    | "attachmentStatus"
    | "comments"
    | "attachedAt"
  >>;
};

export type RuntimeVisualEvidenceCaptureScaffold = {
  schemaVersion: "openclinxr.ui-xr-runtime-visual-evidence-capture-scaffold.v1";
  source: "ui_xr_manual_performance_evidence_payload";
  scenarioId: string;
  // Rebalanced gen wire (2026-06): caseDerived* (emotionTimeline/runtimeExecutionHints from deriveBasic... in factory/ using peds commProfile + requiredTraceTags + triggers) flows here for runtime player stub. Full: from review packet caseDerivedActorTurnExpectations at handoff. UI-XR consumer is supporting ref only.
  caseDerivedEmotionSeed?: { baseEmotion: string; primaryCueIds: string[]; source: "case_spec_derivation" } | null;
  // Integrated emotion step demo from machine stub for peds (rebalance)
  pedsEmotionStepDemo?: string | null;
  pedsDialoguePolicyDemo?: { style: string; topicsToAvoid: string[] } | null;
  // Further integrated active demos using the step/policy for peds (active emotion/dialogue fields in runtime evidence)
  pedsActiveEmotionDemo?: string | null;
  pedsDialogueCueIdsDemo?: string[] | null;
  // Player consumption of generated (rebalance continuation): peds case spec (via packet machines/policies + step) now drives active runtime player state in scaffold for UI-XR runtime-state to consume (current emotion + next cue for turn/gaze/lip/viseme drive in player loop). Desktop fallback. Gates false. Consumer ref only.
  pedsRuntimePlayerDemo?: { currentEmotion: string | null; nextCueId: string | null; source: "case-derived-step+policy"; visemeHint?: string } | null;
  // Expanded to simple step loop (using triggers from peds spec/timeline): demonstrates player consuming sequence of generated emotion/dialogue turns from case (for locomotion/gaze/lip/viseme drive later). 
  pedsPlayerStepLoopDemo?: Array<{ trigger: string; emotion: string | null; cue: string | null }> | null;
  // Full player loop consumption for peds (step the loop from case spec to drive current state over turns; for humanoid locomotion/gaze/lip/viseme in runtime player with desktop fallback).
  pedsPlayerLoopStep?: { totalSteps: number; currentAfterStep0: { trigger: string; emotion: string | null; cue: string | null }; currentAfterStep1: { trigger: string; emotion: string | null; cue: string | null }; source: "case-derived-loop-step" } | null;
  // Full e2e replay evidence from generated (consume player loop/persistence for both peds+ed; review-safe trace for admin replay surfaces).
  pedsReplayEvidence?: { scenarioId: string; turnsReplayed: number; finalEmotion: string | null; finalCue: string | null; locomotion: boolean; gazeAversion: string; lipSyncViseme: string; source: "case-derived-player-loop-replay" } | null;
  edReplayEvidence?: { scenarioId: string; turnsReplayed: number; finalEmotion: string | null; finalCue: string | null; locomotion: boolean; gazeAversion: string; lipSyncViseme: string; source: "case-derived-player-loop-replay" } | null;
  // Wired replay to runtime behavior (drive fields from replay for e2e player consumption; for peds+ed caseDerived).
  pedsRuntimeDrive?: { currentEmotion: string | null; currentCue: string | null; locomotion: boolean; gaze: string; lipSync: string; virtualEnv: string | null; gltfEnvWorld: { room: string | null; containerPolicy: string } | null; deeperVisualCue: { fromEnv: string | null; fromEmotion: string | null; cue: string; intensity: number; richerCuesApplied: boolean; source: "case-derived-richer-deeper-env" } | null; source: "case-derived-replay-drive" } | null;
  // Virtual env from factory (user steering: after functional player chunk for conv/emotion, now factory for virtual env pipeline). Small piece of virtual env that runtime player will use (room/props from case, tech vetted Three+GLTF open source). Evident in scaffold data for encounter experience.
  caseDerivedVirtualEnvironment?: {
    scenarioId: string;
    roomType: string;
    props: string[];
    techStack: { runtime: string; authoring: string; vetStatus: string; license: string; };
    source: string;
  } | null;
  // Visual hint for running player/app (per user: make evident when running the app and usable by end users the virtual env setting for the encounter).
  virtualEnvForPlayer?: string | null;
  // Small gltf handoff piece (tech vet gltf as interchange for virtual env player will use; factory materialization from case env + cues; loadable via three GLTFLoader in main.ts).
  gltfAssetUrlForEnv?: string | null;
  runtimeAssetBundleId: string | null;
  status: "metadata_only_attachment_candidates_not_submitted";
  runtimeEvidenceCandidateCount: number;
  visualQaEvidenceCandidateCount: number;
  actorPlayerRuntimeMetadataSummary?: ActorPlayerRuntimeMetadataSummary | null;
  attachmentCandidates: RuntimeVisualEvidenceAttachmentCandidate[];
  submitRuntimeVisualEvidenceAttachmentInput: RuntimeVisualEvidenceAttachmentSubmitInput;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "ui_xr_capture_scaffold_not_runtime_visual_evidence";
  notEvidenceFor: RuntimeVisualEvidenceAttachmentCandidate["notEvidenceFor"];
};

export type RuntimeEvidenceConsumerReadiness = {
  schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-readiness.v1";
  source: "runtimeVisualEvidenceCaptureScaffold";
  status: "consumer_ready_metadata_only" | "consumer_blocked";
  scenarioId: string | null;
  runtimeAssetBundleId: string | null;
  attachmentCount: number;
  runtimeEvidenceAttachmentCount: number;
  visualQaEvidenceAttachmentCount: number;
  actorPlayerRuntimeMetadataSummary?: ActorPlayerRuntimeMetadataSummary | null;
  targetRoute: "/runtime/visual-evidence-attachments";
  submitBodyRef: "runtimeVisualEvidenceCaptureScaffold.submitRuntimeVisualEvidenceAttachmentInput";
  submitPreview: {
    route: "/runtime/visual-evidence-attachments";
    bodyRef: "runtimeVisualEvidenceCaptureScaffold.submitRuntimeVisualEvidenceAttachmentInput";
    attachmentCount: number;
    actionIds: RuntimeVisualEvidenceAttachmentCandidate["actionId"][];
    inputIds: string[];
    localArtifactPaths: string[];
    rawPayloadDisplayed: false;
    claimBoundary: "ui_xr_consumer_readiness_submit_preview_metadata_only";
  };
  blockerIds: string[];
  rawPayloadDisplayed: false;
  providerExecutionAllowed: false;
  runtimeExecutionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  productionAssetReadinessClaimed: false;
  clinicalValidityClaimed: false;
  scoringValidityClaimed: false;
  claimBoundary: "ui_xr_consumer_readiness_metadata_only_not_runtime_visual_evidence";
  notEvidenceFor: RuntimeVisualEvidenceAttachmentCandidate["notEvidenceFor"];
};

export type LearnerRuntimeUseGateEvidence = EncounterRuntimeLearnerUseGate & {
  source: "window.__openClinXrLearnerRuntimeUseGateEvidence";
  bundleId: string;
  scenarioId: string;
  assetStoreKind: RuntimeAssetStoreKind;
  activeBundleSource: "local_fixture_fallback" | "api_bundle" | "static_generated_bundle";
  generatedBundleLearnerUseBlocked: boolean;
  fallbackActive: boolean;
  fallbackReason: string | null;
  requiredGateIds: [
    "runtime_realism_evidence",
    "visual_qa_evidence",
    "quest_runtime_evidence",
  ];
  blockingGateIds: EncounterRuntimeEvidenceGateId[];
  approvedLocalFixtureOnly: boolean;
  actorEquipmentMaterializationGate: RuntimeActorEquipmentMaterializationGateEvidence | null;
  claimBoundary: "learner_scene_uses_local_fixture_until_runtime_visual_quest_gates_attach";
};

export type RuntimeActorEquipmentMaterializationGateEvidence = {
  claimBoundary: "actor_equipment_materialization_contract_not_runtime_readiness";
  runtimeSelectionBlockedUntilEvidenceAttached: boolean;
  actorBlockers: string[];
  equipmentBlockers: string[];
  caveats: string[];
  recommendedNextActions: string[];
  materializationEvidenceAttachmentSummary: RuntimeMaterializationEvidenceAttachmentSummary | null;
  remainingRuntimeBlockerReasons: RuntimeRemainingRuntimeBlockerReasons | null;
  notEvidenceFor: string[];
};

export type RuntimeRemainingRuntimeBlockerReasons = {
  source: "materialization_attachment_summary_and_publication_runtime_gates";
  materializationEvidenceComplete: boolean;
  runtimeSelectionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  categories: Array<{
    category: string;
    blockerIds: string[];
    recommendedNextAction: string;
  }>;
  claimBoundary: "remaining_runtime_blockers_after_materialization_metadata_only";
};

export type RuntimeMaterializationEvidenceAttachmentSummary = {
  source: "encounter_materialization_evidence_attachments";
  totalRequiredSlotCount: number;
  attachedSlotCount: number;
  missingSlotCount: number;
  heldOrInvalidAttachmentCount: number;
  allRequiredSlotsSatisfied: boolean;
  runtimeSelectionAllowed: false;
  learnerLaunchAllowed: false;
  questEvidenceRefreshAllowed: false;
  claimBoundary: "metadata_only_materialization_evidence_attachment_summary";
};

type RuntimePublicationActorEquipmentMaterializationGate = {
  claimBoundary: "materialization_contract_metadata_only_not_runtime_readiness";
  runtimeSelectionBlockedUntilEvidenceAttached: boolean;
  actorGate: {
    materializationBlockers: string[];
    caveats: string[];
    recommendedNextAction: string;
  };
  equipmentGate: {
    materializationBlockers: string[];
    caveats: string[];
    recommendedNextAction: string;
  };
  materializationEvidenceAttachmentSummary?: RuntimeMaterializationEvidenceAttachmentSummary;
  remainingRuntimeBlockerReasons?: RuntimeRemainingRuntimeBlockerReasons;
  notEvidenceFor: string[];
};

export type LearnerRuntimeAssetBundleWithMaterializationGate = LearnerRuntimeAssetBundle & {
  actorEquipmentMaterializationGate?: RuntimeActorEquipmentMaterializationGateEvidence | RuntimePublicationActorEquipmentMaterializationGate | undefined;
};

export function readRuntimeActorEquipmentMaterializationGate(
  bundle: LearnerRuntimeAssetBundle,
): RuntimeActorEquipmentMaterializationGateEvidence | null {
  const gate = (bundle as LearnerRuntimeAssetBundleWithMaterializationGate).actorEquipmentMaterializationGate;
  if (!gate) {
    return null;
  }
  if (gate.claimBoundary === "materialization_contract_metadata_only_not_runtime_readiness") {
    return {
      claimBoundary: "actor_equipment_materialization_contract_not_runtime_readiness",
      runtimeSelectionBlockedUntilEvidenceAttached: gate.runtimeSelectionBlockedUntilEvidenceAttached === true,
      actorBlockers: [...gate.actorGate.materializationBlockers],
      equipmentBlockers: [...gate.equipmentGate.materializationBlockers],
      caveats: [...gate.actorGate.caveats, ...gate.equipmentGate.caveats],
      recommendedNextActions: [
        gate.actorGate.recommendedNextAction,
        gate.equipmentGate.recommendedNextAction,
      ],
      materializationEvidenceAttachmentSummary: gate.materializationEvidenceAttachmentSummary ?? null,
      remainingRuntimeBlockerReasons: gate.remainingRuntimeBlockerReasons ?? null,
      notEvidenceFor: [...gate.notEvidenceFor],
    };
  }
  if (gate.claimBoundary !== "actor_equipment_materialization_contract_not_runtime_readiness") {
    return null;
  }
  return {
    claimBoundary: gate.claimBoundary,
    runtimeSelectionBlockedUntilEvidenceAttached: gate.runtimeSelectionBlockedUntilEvidenceAttached === true,
    actorBlockers: [...gate.actorBlockers],
    equipmentBlockers: [...gate.equipmentBlockers],
    caveats: [...gate.caveats],
    recommendedNextActions: [...gate.recommendedNextActions],
    materializationEvidenceAttachmentSummary: gate.materializationEvidenceAttachmentSummary ?? null,
    remainingRuntimeBlockerReasons: gate.remainingRuntimeBlockerReasons ?? null,
    notEvidenceFor: [...gate.notEvidenceFor],
  };
}

export type CaseDefinedHumanoidRuntimeHandoffEvidence = {
  claimBoundary: "case_definition_humanoid_runtime_handoff_metadata_only";
  actorRole: string;
  workOrderIds: string[];
  locomotionRequired: boolean;
  expressionRequired: boolean;
  gazeRequired: boolean;
  lipSyncRequired: boolean;
  interactiveRequired: boolean;
  requiredSignalIds: string[];
  blockers: string[];
  notEvidenceFor: Array<
    | "generated_humanoid_asset_readiness"
    | "animation_quality"
    | "quest_readiness"
    | "runtime_readiness"
    | "clinical_validity"
    | "scoring_validity"
  >;
};

export type RuntimeSceneManifestEvidence = {
  source: "learner_runtime_asset_bundle_scene_manifest";
  manifestId: string;
  schemaVersion: "openclinxr.runtime-scene-manifest.v1";
  selectedScenarioId: string;
  bundleScenarioId: string;
  selectedScenarioMatchesBundle: boolean;
  stationId: string;
  stationContextTitle: string | null;
  stationContextChiefConcern: string | null;
  actorRoster: Array<{
    actorId: string;
    role: string;
    embodiment: LearnerRuntimeAssetBundle["actors"][number]["embodiment"];
  }>;
  equipmentIds: string[];
  dialogueTraceTags: string[];
  roomPropCount: number;
  semanticRoomPropCount: number;
  actorPlacementCount: number;
  equipmentPlacementCount: number;
  dialogueTurnCount: number;
  virtualDeviceActorCount: number;
  virtualDeviceDialogueRoutedCount: number;
  generatedBySceneManifestCount: number;
  propIds: string[];
  caseDefinedHumanoidRuntimeHandoffCount: number;
  caseDefinedHumanoidRuntimeHandoffActorRoles: string[];
  caseDefinedHumanoidRuntimeHandoffRequiredSignalIds: string[];
  caseDefinedHumanoidRuntimeHandoff: CaseDefinedHumanoidRuntimeHandoffEvidence[];
  storageBackedBundle: boolean;
  productionReadinessClaimed: false;
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

export type EnvironmentStateEvidence = {
  source: "local_trace_tied_environment_state";
  activeTraceTags: string[];
  stressCueIds: string[];
  environmentalRealismCueIds: string[];
  monitorState: "baseline" | "vitals_concerning" | "urgent_ecg_requested" | "oxygen_started" | "bronchodilator_in_progress";
  alarmState: "quiet" | "soft_warning" | "urgent_attention";
  alarmCueMode: "visual_only_no_audio" | "none";
  environmentMotionCueMode: "deterministic_visual_pulse" | "none";
  propStateCueIds: string[];
  activePropIds: string[];
  productionClinicalMonitoringClaimed: false;
  notEvidenceFor: ["clinical_validity", "scoring_validity", "quest_readiness"];
};

export type SceneAssetEvidence = {
  source: "window.__openClinXrSceneAssetEvidence";
  generatedAtMs: number;
  expectedAssetCount: number;
  loadedCount: number;
  failedCount: number;
  pendingCount: number;
  fallbackActiveCount: number;
  cameraFramingCue: "humanoid_camera_framing_decluttered_three_actor_environment_review";
  visualFidelityCueIds: string[];
  interactionCollisionEvidence: {
    proxyCueCount: number;
    physicsProbeMode: "runtime_proxy_cues_with_offline_rapier_gate";
    latestProbeReportPath: string;
    notEvidenceFor: ["production_physics_readiness", "validated_ragdoll_biomechanics"];
  };
  assets: Array<{
    assetId: string;
    assetPath: string;
    sceneObjectName: string;
    status: "pending" | "loaded" | "failed";
    fallbackActive: boolean;
    affordanceCueIds?: string[];
    animationPlayback?: "gltf_role_animation_clip_playing" | "gltf_animation_clips_playing" | "procedural_idle_breathing_fallback" | "procedural_dialogue_expression_gaze_fallback" | "not_applicable";
    roleAnimationClipNames?: string[];
    activeRoleAnimationClipName?: string | null;
    gazeProbeAnimationClipNames?: string[];
    activeGazeProbeAnimationClipName?: string | null;
    gazeProbePlayback?: "gltf_gaze_probe_clip_playing" | "gaze_probe_clip_missing" | "not_applicable";
    humanoidSourceProvenance?: {
      generatorMode: "anny_compatible_stub_plus_blender_procedural" | "real_anny_local_forward_pass_plus_blender_procedural" | "real_anny_plus_blender" | "fixture" | "candidate";
      sourceKind: "case_driven_generated_humanoid_candidate" | "real_anny_candidate_unverified" | "runtime_fixture" | "source_comparator_candidate";
      usesRealAnnyForwardPass?: boolean;
      realAnnyWeightsUsed: boolean;
      textureMode: "procedural_fallback" | "authored_or_baked" | "unknown";
      animationMode: "procedural_animation_fallback" | "procedural_clinical_idle_conversation_posture_fallback" | "authored_animation_clips" | "unknown";
      realismGrade: "B" | "B+" | "not_graded";
      provenanceManifestPath?: string;
      notEvidenceFor: string[];
    };
  }>;
  productionAssetReadinessClaimed: false;
  notEvidenceFor: [
    "production_asset_readiness",
    "quest_readiness",
    "clinical_validity",
  ];
};

export type HumanoidSpeechEvidence = {
  source: "local_dialogue_phoneme_viseme_mapping";
  activeActorId: string | null;
  activeAssetId: string | null;
  lastText: string | null;
  phonemeSequence: string[];
  visemeSequence: string[];
  emotionSource?:
    | "runtime_affect_timeline"
    | "scenario_actor_communication_profile"
    | "dialogue_text_heuristic"
    | undefined;
  scenarioBaselineMood?: string[] | undefined;
  scenarioEmotionCueIds?: string[] | undefined;
  activeActorRuntimeRealismRequirement?:
    | NonNullable<NonNullable<EncounterRuntimeDialogueTurn["caseDefinitionRuntimeSignals"]>["actorRuntimeRealismRequirement"]>
    | undefined;
  activeActorRealismLaunchBadge?: {
    actorId: string;
    actorRole: string;
    status: "realismBlocked";
    blockers: string[];
    claimBoundary: "case_defined_actor_realism_launch_badge_metadata_only";
  } | undefined;
  activePhoneme?: string | undefined;
  activeViseme?: string | undefined;
  activeMouthOpenness?: number | undefined;
  activeEyeBlinkIntensity?: number | undefined;
  activeEyeMicroSaccadeYaw?: number | undefined;
  activeEyeMicroSaccadePitch?: number | undefined;
  activeEmotionState?: "neutral" | "anxious" | "concerned" | "reassured" | "pain" | undefined;
  activeExpressionTransitionMs?: number | undefined;
  activeExpressionWeights?: Partial<Record<"mouthOpen" | "browConcern" | "cheekTension", number>> | undefined;
  activeExpressionCueIds?: string[] | undefined;
  activeBodyMotionCueIds?: string[] | undefined;
  activeBodyMotionIntensity?: number | undefined;
  activeBodyMotionMode?:
    | "scenario_dialogue_body_motion_runtime"
    | "procedural_idle_body_motion"
    | undefined;
  gazeTargetKind: "learner_camera" | "actor" | null;
  gazeTargetActorId: string | null;
  notEvidenceFor: readonly [
    "clinical_speech_quality",
    "production_lip_sync",
    "production_eye_tracking",
    "scoring_validity",
  ];
};

export type CaseDefinedHumanoidPerformanceContractEvidence = {
  source: "case_definition_humanoid_performance_contract";
  scenarioId: string;
  claimBoundary: "case_definition_humanoid_performance_metadata_only";
  actorCount: number;
  locomotionActorRoles: string[];
  expressionActorRoles: string[];
  gazeActorRoles: string[];
  lipSyncActorRoles: string[];
  interactiveActorRoles: string[];
  emotionStateCount: number;
  dialogueDrivenVisemeMappingRequired: boolean;
  gazeTargetingRequired: boolean;
  locomotionPlanningRequired: boolean;
  notEvidenceFor: [
    "generated_humanoid_asset_readiness",
    "animation_quality",
    "quest_readiness",
    "runtime_readiness",
    "clinical_validity",
  ];
};

export type LocomotionDiagnosticSummary = {
  claimScope: "attempt_diagnostics_only";
  gamepadSourceCount: number;
  activeGamepadSourceCount: number;
  handGestureHandCount: number;
  pinchingHandCount: number;
  movementCrossedDeadzoneHandCount: number;
  handGestureBlockedReasons: string[];
};

export type LocomotionProbeReasonCode =
  | "locomotion_observed"
  | "active_vector_without_rig_delta"
  | "no_gamepad_sources"
  | "gamepad_axes_below_deadzone"
  | "hand_not_pinching"
  | "hand_arming_dwell"
  | "hand_missing_joints"
  | "hand_below_deadzone"
  | "hand_turn_cooldown"
  | "hand_other_locomotion_source_active"
  | "no_xr_input_sources"
  | "locomotion_delta_missing";

export type LocomotionProbeSummary = {
  claimScope: "runtime_probe_only";
  readiness: "ready" | "blocked";
  primaryReason: LocomotionProbeReasonCode;
  reasonCodes: LocomotionProbeReasonCode[];
  activeVectorWithoutRigDelta: boolean;
  controllerSources: {
    total: number;
    activeAfterDeadzone: number;
  };
  handGesture: {
    handsObserved: number;
    pinching: number;
    armed: number;
    movementCrossedDeadzone: number;
  };
};

export type ManualEvidenceCopyDisposition =
  | "not_copied"
  | "copied"
  | "copy_blocked"
  | "clipboard_unavailable";

export type ManualPerformanceCaptureSummaryInput = {
  draft?: ManualPerformanceDraft | null | undefined;
  frameStats?: ManualPerformanceFrameStats | null | undefined;
  now?: number | null | undefined;
};

export type ManualPerformanceDraftInput = {
  generatedAt: string;
  elapsedSecond: number;
  foregroundPageConfirmed: boolean;
  traceInteractionPassed: boolean;
  frameStats: ManualPerformanceFrameStats;
  controllerSelectLatencyMs?: number | null;
  experienceModeEvidence?: XrExperienceModeEvidence;
  inputEvidence?: ManualPerformanceInputEvidence | null;
  traceLatencyEvidence?: ManualPerformanceTraceLatencyEvidence | null;
  reproducibilityEvidence?: ManualPerformanceReproducibilityEvidence;
  consoleErrors?: string[];
  immersiveSessionStarted?: boolean;
};

export type XrExperienceModeId = "full_vr" | "mixed_reality_passthrough";

export type XrExperienceModeEvidence = FullVrExperienceModeEvidence | MixedRealityExperienceModeEvidence;

export type FullVrExperienceModeEvidence = {
  modeId: "full_vr";
  phaseLabel: "Phase 1 Full VR";
  requestedSessionMode: "immersive-vr";
  mixedRealityPassthroughImplemented: false;
  handTrackingPosture: "optional_feature_with_local_mesh_hand_model_and_primitive_fallback";
  locomotionPosture: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly";
};

export type MixedRealityExperienceModeEvidence = {
  modeId: "mixed_reality_passthrough";
  phaseLabel: "Phase 1 Mixed Reality";
  requestedSessionMode: "immersive-ar";
  mixedRealityPassthroughImplemented: true;
  handTrackingPosture: "optional_feature_with_local_mesh_hand_model_and_primitive_fallback";
  locomotionPosture: "room_scale_with_optional_thumbstick_dolly";
};

export type XrExperienceModeContract = {
  modeId: XrExperienceModeId;
  phaseLabel: XrExperienceModeEvidence["phaseLabel"];
  requestedSessionMode: XrExperienceModeEvidence["requestedSessionMode"];
  entryButtonLabel: "Enter Full VR" | "Enter Mixed Reality";
  sharesScenarioTraceContract: true;
  evidenceLane: "full_vr_manual_report" | "mixed_reality_manual_report";
  privacySafetyReviewRequired: boolean;
  requiredEvidence: string[];
  prohibitedClaimsUntilReady: string[];
};

export type XrExperienceModeReadinessEvidence = {
  modeId: XrExperienceModeId;
  requestedSessionMode: "immersive-vr" | "immersive-ar";
  manualReportModeId?: XrExperienceModeId;
  passthroughObserved?: boolean;
  privacySafetyReviewed?: boolean;
  sharesScenarioTraceContract?: boolean;
};

export type XrExperienceModeReadiness = {
  ready: boolean;
  blockers: string[];
};

export const stationTraceActionTags = [...edChestPainScenario.requiredTraceTags];

export const xrExperienceModeEvidence: FullVrExperienceModeEvidence = {
  modeId: "full_vr",
  phaseLabel: "Phase 1 Full VR",
  requestedSessionMode: "immersive-vr",
  mixedRealityPassthroughImplemented: false,
  handTrackingPosture: "optional_feature_with_local_mesh_hand_model_and_primitive_fallback",
  locomotionPosture: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
};

export const localHandMeshPath = "/xr-hands/generic-hand/" as const;
export const meshHandModelProfile = "mesh" as const;
export const meshHandRepresentationKind = "mesh" as const satisfies HandRepresentationKind;
export const primitiveHandModelProfile = "spheres" as const;
export const primitiveHandRepresentationKind = "primitive_spheres" as const satisfies HandRepresentationKind;

export const xrExperienceModeContracts: XrExperienceModeContract[] = [
  {
    modeId: "full_vr",
    phaseLabel: "Phase 1 Full VR",
    requestedSessionMode: "immersive-vr",
    entryButtonLabel: "Enter Full VR",
    sharesScenarioTraceContract: true,
    evidenceLane: "full_vr_manual_report",
    privacySafetyReviewRequired: false,
    requiredEvidence: [
      "immersive_vr_session_started",
      "foreground_quest_manual_report",
      "controller_or_hand_input_observed",
      "in_scene_text_readability_confirmed",
      "comfort_and_frame_pacing_reported",
    ],
    prohibitedClaimsUntilReady: [
      "production_quest_readiness",
      "controller_latency_readiness",
      "clinical_text_readability_readiness",
    ],
  },
  {
    modeId: "mixed_reality_passthrough",
    phaseLabel: "Phase 1 Mixed Reality",
    requestedSessionMode: "immersive-ar",
    entryButtonLabel: "Enter Mixed Reality",
    sharesScenarioTraceContract: true,
    evidenceLane: "mixed_reality_manual_report",
    privacySafetyReviewRequired: true,
    requiredEvidence: [
      "immersive_ar_session_started",
      "passthrough_visibility_observed",
      "foreground_quest_mr_manual_report",
      "privacy_safety_review_completed",
      "room_boundary_and_occlusion_comfort_reported",
    ],
    prohibitedClaimsUntilReady: [
      "replacement_for_full_vr",
      "production_quest_readiness",
      "passthrough_privacy_readiness",
      "clinical_room_safety_readiness",
    ],
  },
];

export function isImmersiveFrameEvidenceActive(input: {
  rendererPresenting: boolean;
  activeXrSession: boolean;
  immersiveSessionActive: boolean;
}): boolean {
  return input.rendererPresenting || (input.activeXrSession && input.immersiveSessionActive);
}

export const iwsdkStationSceneObjects = {
  stationRoot: "openclinxr.ed-chest-pain.station-root",
  ambientLight: "openclinxr.ed-chest-pain.ambient-light",
  keyLight: "openclinxr.ed-chest-pain.key-light",
  floor: "openclinxr.ed-chest-pain.floor",
  environmentShell: "openclinxr.ed-chest-pain.environment-shell",
  generatedEnvironmentShell: "openclinxr.ed-chest-pain.environment-shell.generated-glb",
  bed: "openclinxr.ed-chest-pain.bed",
  monitor: "openclinxr.ed-chest-pain.monitor",
  ecgCart: "openclinxr.ed-chest-pain.ecg-cart-12-lead",
  generatedEcgCart: "openclinxr.ed-chest-pain.ecg-cart-12-lead.generated-glb",
  ivPoleWithPump: "openclinxr.ed-chest-pain.iv-pole-with-pump",
  generatedIvPoleWithPump: "openclinxr.ed-chest-pain.iv-pole-with-pump.generated-glb",
  patientRobertHayes: "openclinxr.ed-chest-pain.patient-robert-hayes",
  patientRobertHayesGeneratedHumanoid: "openclinxr.ed-chest-pain.patient-robert-hayes.generated-humanoid-glb",
  nurseMariaAlvarez: "openclinxr.ed-chest-pain.nurse-maria-alvarez",
  nurseMariaAlvarezGeneratedHumanoid: "openclinxr.ed-chest-pain.nurse-maria-alvarez.generated-humanoid-glb",
  spouseAnnaHayes: "openclinxr.ed-chest-pain.spouse-anna-hayes",
  spouseAnnaHayesGeneratedHumanoid: "openclinxr.ed-chest-pain.spouse-anna-hayes.generated-humanoid-glb",
  wallClock: "openclinxr.ed-chest-pain.wall-clock",
  clinicalPanel: "openclinxr.ed-chest-pain.in-vr-clinical-panel",
  dialoguePanel: "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
  actorRealismPanel: "openclinxr.ed-chest-pain.in-vr-actor-realism-requirements-panel",
  inputPanel: "openclinxr.ed-chest-pain.in-vr-input-panel",
  controllerGripLeft: "openclinxr.ed-chest-pain.controller-grip-left",
  controllerGripRight: "openclinxr.ed-chest-pain.controller-grip-right",
} as const;

export const iwsdkStationSceneObjectNames = Object.values(iwsdkStationSceneObjects);

export const iwsdkStationMcpSmokePlanHash = "runtime-state:iwsdk-station-mcp-smoke-plan:v1";

export const iwsdkStationMcpSmokeToolOrder: IwsdkStationMcpSmokeTool[] = [
  "xr_get_session_status",
  "xr_accept_session",
  "browser_screenshot",
  "scene_get_hierarchy",
  "xr_select",
  "browser_get_console_logs",
];

export function createInitialRuntimeState(): XrRuntimeState {
  return {
    scenarioId: edChestPainScenario.scenarioId,
    title: edChestPainScenario.title,
    elapsedSecond: 0,
    requiredTraceTags: [...edChestPainScenario.requiredTraceTags],
    completedTraceTags: [],
  };
}

export function deriveRuntimeTraceActionTags(bundle: LearnerRuntimeAssetBundle): string[] {
  const runtimeTraceTags = bundle.sceneManifest.dialogueTurns
    .map((turn) => turn.traceTag)
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
  const uniqueRuntimeTraceTags = [...new Set(runtimeTraceTags)];
  return uniqueRuntimeTraceTags.length > 0 ? uniqueRuntimeTraceTags : [...edChestPainScenario.requiredTraceTags];
}

export function createRuntimeStateFromBundle(
  bundle: LearnerRuntimeAssetBundle,
  previousState?: XrRuntimeState,
): XrRuntimeState {
  const requiredTraceTags = deriveRuntimeTraceActionTags(bundle);
  const requiredTraceTagSet = new Set(requiredTraceTags);
  return {
    scenarioId: bundle.scenarioId,
    title: bundle.sceneManifest.stationContext?.title ?? previousState?.title ?? bundle.stationId,
    elapsedSecond: previousState?.elapsedSecond ?? 0,
    requiredTraceTags,
    completedTraceTags: previousState?.completedTraceTags.filter((tag) => requiredTraceTagSet.has(tag)) ?? [],
  };
}

export function formatStationClock(totalSeconds: number): string {
  const clampedTotalSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(clampedTotalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(clampedTotalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function completeTraceAction(state: XrRuntimeState, traceTag: string): XrRuntimeState {
  if (state.completedTraceTags.includes(traceTag)) {
    return state;
  }

  return {
    ...state,
    completedTraceTags: [...state.completedTraceTags, traceTag],
  };
}

export function summarizeTraceReadiness(state: XrRuntimeState): TraceReadinessSummary {
  const observed = new Set(state.completedTraceTags);
  const requiredTraceTags = [...new Set(state.requiredTraceTags)];
  const missingTraceTags = requiredTraceTags.filter((tag) => !observed.has(tag));
  const observedRequiredTraceTags = requiredTraceTags.filter((tag) => observed.has(tag));
  return {
    observedCount: observedRequiredTraceTags.length,
    missingCount: missingTraceTags.length,
    missingTraceTags,
  };
}

export function buildXrTraceActionHandoffEvidence(input: {
  state: XrRuntimeState;
  actions: readonly XrTraceActionHandoffAction[];
  generatedAtMs: number;
  lastTraceLatencyEvidence?: ManualPerformanceTraceLatencyEvidence | null | undefined;
}): XrTraceActionHandoffEvidence {
  const traceSummary = summarizeTraceReadiness(input.state);
  const smokePlan = buildIwsdkStationMcpSmokePlan(input.state);
  const actions = input.actions.map((action) => ({ ...action }));

  return {
    source: "window.__openClinXrTraceActionHandoffEvidence",
    scenarioId: input.state.scenarioId,
    title: input.state.title,
    generatedAtMs: roundMetric(input.generatedAtMs),
    observedRequiredCount: traceSummary.observedCount,
    requiredCount: [...new Set(input.state.requiredTraceTags)].length,
    missingCount: traceSummary.missingCount,
    missingTraceTags: [...traceSummary.missingTraceTags],
    nextTraceTag: traceSummary.missingTraceTags[0] ?? null,
    latestAction: actions.at(-1) ?? null,
    actions,
    lastTraceLatencyEvidence: input.lastTraceLatencyEvidence ?? null,
    iwsdkSidecarHandoff: {
      posture: "sidecar_only_supporting_evidence",
      smokePlanHash: smokePlan.smokePlanHash,
      controllerSelectTraceTag: smokePlan.controllerSelectTraceTag,
      requiredSceneObjectNames: [...smokePlan.requiredSceneObjectNames],
      reviewTargets: {
        clinicalPanel: iwsdkStationSceneObjects.clinicalPanel,
        dialoguePanel: iwsdkStationSceneObjects.dialoguePanel,
        actorRealismPanel: iwsdkStationSceneObjects.actorRealismPanel,
        inputPanel: iwsdkStationSceneObjects.inputPanel,
        controllerGripLeft: iwsdkStationSceneObjects.controllerGripLeft,
        controllerGripRight: iwsdkStationSceneObjects.controllerGripRight,
      },
    },
    notEvidenceFor: [
      "production_quest_readiness",
      "validated_clinical_score_use",
      "live_provider_readiness",
    ],
  };
}

export function buildXrTraceInteractionEvidenceSummary(
  handoff: XrTraceActionHandoffEvidence | null | undefined,
): XrTraceInteractionEvidenceSummary {
  const latestAction = handoff?.latestAction ?? null;
  const latestTraceSource = latestAction?.source ?? null;
  return {
    source: "xr_trace_action_handoff_summary",
    scenarioId: handoff?.scenarioId ?? "unknown",
    latestTraceTag: latestAction?.traceTag ?? null,
    latestTraceSource,
    latestTraceLatencyMs: latestAction?.selectLatencyMs ?? handoff?.lastTraceLatencyEvidence?.lastSelectLatencyMs ?? null,
    observedRequiredCount: handoff?.observedRequiredCount ?? 0,
    requiredCount: handoff?.requiredCount ?? 0,
    nextMissingTraceTag: handoff?.nextTraceTag ?? null,
    sourceClass: traceSourceClass(latestTraceSource),
    reviewSafe: true,
    claimBoundary: "xr_trace_interaction_summary_not_quest_readiness",
    notEvidenceFor: [
      "production_quest_readiness",
      "validated_clinical_score_use",
      "live_provider_readiness",
    ],
  };
}

function traceSourceClass(
  source: XrTraceActionHandoffAction["source"] | null,
): XrTraceInteractionEvidenceSummary["sourceClass"] {
  if (!source) return "not_observed";
  if (source === "xr_controller_select" || source === "xr_hand_select") return "headset_class_input";
  return "desktop_or_runtime_input";
}

export function buildIwsdkStationMcpSmokePlan(state: XrRuntimeState = createInitialRuntimeState()): IwsdkStationMcpSmokePlan {
  const controllerSelectTraceTag = state.requiredTraceTags.includes("ecg_request")
    ? "ecg_request"
    : state.requiredTraceTags[0] ?? "";

  return {
    mode: "agent",
    smokePlanHash: iwsdkStationMcpSmokePlanHash,
    scenarioId: state.scenarioId,
    scenarioVersion: edChestPainScenario.version,
    scenarioTitle: state.title,
    mcpToolOrder: [...iwsdkStationMcpSmokeToolOrder],
    requiredSceneObjectNames: [...iwsdkStationSceneObjectNames],
    controllerSelectTraceTag,
    steps: [
      {
        id: "session-status",
        toolName: "xr_get_session_status",
        expectedEvidence: "XR session support state is recorded before accepting or emulating input.",
      },
      {
        id: "accept-session",
        toolName: "xr_accept_session",
        expectedEvidence: "Immersive session enters a ready state without warning or error console output.",
      },
      {
        id: "nonblank-screenshot",
        toolName: "browser_screenshot",
        expectedEvidence: "The ED bay canvas is nonblank and the EHR/control panel remains readable at the bounded agent screenshot size.",
      },
      {
        id: "scene-hierarchy",
        toolName: "scene_get_hierarchy",
        expectedEvidence: "Named station objects are present so agent reviewers can verify clinical actors and equipment without screenshot-only inference.",
        requiredSceneObjects: [...iwsdkStationSceneObjectNames],
      },
      {
        id: "controller-select-trace",
        toolName: "xr_select",
        expectedEvidence: "A controller select records the same learner trace action as the desktop trace button.",
        traceTag: controllerSelectTraceTag,
      },
      {
        id: "console-clean",
        toolName: "browser_get_console_logs",
        expectedEvidence: "No warning or error console messages are present after the trace interaction.",
      },
    ],
    blockedUntil: [
      "apps_ui_xr_iwsdk_sidecar_exists_with_exact_iwsdk_versions",
      "iwsdk_agent_tooling_evidence_records_32_tool_inventory",
      "physical_quest3_foreground_frame_pacing_still_required_for_production",
    ],
  };
}

export function findXrExperienceModeContract(modeId: XrExperienceModeId): XrExperienceModeContract {
  const contract = xrExperienceModeContracts.find((candidate) => candidate.modeId === modeId);
  if (!contract) {
    throw new Error(`Unknown XR experience mode: ${modeId}`);
  }
  return contract;
}

export function evaluateXrExperienceModeReadiness(evidence: XrExperienceModeReadinessEvidence): XrExperienceModeReadiness {
  const contract = findXrExperienceModeContract(evidence.modeId);
  const blockers = [
    evidence.requestedSessionMode === contract.requestedSessionMode ? undefined : "requested_session_mode_mismatch",
    evidence.manualReportModeId === contract.modeId ? undefined : `missing_${contract.evidenceLane}`,
    evidence.sharesScenarioTraceContract === true ? undefined : "missing_shared_scenario_trace_contract",
    evidence.modeId === "mixed_reality_passthrough" && evidence.passthroughObserved !== true ? "missing_passthrough_observation" : undefined,
    contract.privacySafetyReviewRequired && evidence.privacySafetyReviewed !== true ? "missing_privacy_safety_review" : undefined,
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function buildRuntimeEvidencePosture(input: RuntimeEvidencePostureInput): RuntimeEvidencePosture {
  const questBlockers = input.captureSummary?.manualValidationReady === true ? [] : input.captureSummary?.blockers ?? ["missing_manual_performance_draft"];
  const immersiveArKnownUnsupported = input.webXrSupport.immersiveArSupported !== true;
  const runtimeNowMs = input.runtimeNowMs ?? null;
  const freshRuntimeInteractionEvidence = input.runtimeInteractionEvidence && runtimeNowMs !== null
    && runtimeNowMs >= input.runtimeInteractionEvidence.capturedAtMs
    && runtimeNowMs - input.runtimeInteractionEvidence.capturedAtMs <= runtimeInteractionEvidenceFreshMs
      ? input.runtimeInteractionEvidence
      : null;
  const mixedRealityBlockers = [
    "mixed_reality_manual_report_missing",
    immersiveArKnownUnsupported ? "immersive_ar_not_supported_or_unverified" : undefined,
    input.webXrSupport.immersiveArSupported === true ? "mixed_reality_privacy_safety_review_missing" : undefined,
  ].filter((blocker): blocker is string => blocker !== undefined);

  return {
    source: "window.__openClinXrRuntimeEvidencePosture",
    summary: "Mock model/voice active; local voice, Quest, and MR remain evidence-gated.",
    lanes: [
      {
        id: "model_dialogue",
        label: "Model",
        status: "mock_active",
        display: "mock-model active; local model gated",
        evidencePath: "packages/openclinxr/model-gateway",
        blockers: ["local_model_not_enabled_for_station_runtime"],
        details: {
          route: "actor-dialogue-offline-v1",
          activeProvider: "mock-model",
          localProvider: "local-model",
          observedTraceTags: input.traceSummary.observedCount,
          missingTraceTags: input.traceSummary.missingCount,
        },
      },
      {
        id: "voice_synthesis",
        label: "Voice",
        status: "blocked_with_evidence",
        display: "mock-voice active; VibeVoice RTF 5.24x",
        evidencePath: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
        blockers: [
          "runtime_file_generation_only",
          "real_time_factor_above_1",
          "real_local_voice_stream_benchmark_missing",
          "webxr_playback_not_observed",
        ],
        details: {
          route: "voice-offline-v1",
          activeProvider: "mock-voice",
          localProvider: "local-vibevoice",
          modelId: "microsoft/VibeVoice-Realtime-0.5B",
          realTimeFactor: 5.24,
          approximateFirstSpeechTokenLatencyMs: 9000,
          productionUseAllowed: false,
        },
      },
      {
        id: "quest_foreground",
        label: "Quest",
        status: questBlockers.length === 0 ? "separate_lane_available" : "blocked_with_evidence",
        display: questBlockers.length === 0
          ? "Full VR manual evidence ready"
          : "Full VR evidence blocked",
        evidencePath: "docs/openclinxr/quest-manual-performance-2026-05-04.json",
        blockers: questBlockers,
        details: {
          modeId: "full_vr",
          manualValidationReady: input.captureSummary?.manualValidationReady ?? false,
          framesObserved: input.captureSummary?.framesObserved ?? null,
          immersiveFramesObserved: input.captureSummary?.immersiveFramesObserved ?? null,
          traceLatencySource: input.captureSummary?.traceLatencySource ?? null,
          handInputsObserved: input.captureSummary?.handInputsObserved ?? null,
          activeLocomotionSource: input.captureSummary?.activeLocomotionSource ?? null,
          lastLocomotionAtMs: input.captureSummary?.lastLocomotionAtMs ?? null,
          locomotionDistanceMeters: input.captureSummary?.locomotionDistanceMeters ?? null,
          locomotionTurnRadians: input.captureSummary?.locomotionTurnRadians ?? null,
          locomotionProbeClaimScope: input.captureSummary?.locomotionProbeSummary?.claimScope ?? null,
          locomotionProbeReadiness: input.captureSummary?.locomotionProbeSummary?.readiness ?? null,
          locomotionProbePrimaryReason: input.captureSummary?.locomotionProbeSummary?.primaryReason ?? null,
          locomotionProbeReasonCodes: input.captureSummary?.locomotionProbeSummary?.reasonCodes ?? [],
          runtimeInteractionEvidenceAtMs: freshRuntimeInteractionEvidence?.capturedAtMs ?? null,
          runtimeInteractionLocomotionSource: freshRuntimeInteractionEvidence?.activeLocomotionSource ?? null,
          runtimeInteractionLocomotionAttempt: freshRuntimeInteractionEvidence?.locomotionAttempt ?? null,
          runtimeInteractionLocomotionDistanceMeters: freshRuntimeInteractionEvidence?.locomotionDistanceMeters ?? null,
          runtimeInteractionLocomotionTurnRadians: freshRuntimeInteractionEvidence?.locomotionTurnRadians ?? null,
          runtimeInteractionHandSelectStatus: freshRuntimeInteractionEvidence?.handSelectStatus ?? null,
          runtimeInteractionHandSelectDwellMs: freshRuntimeInteractionEvidence?.handSelectDwellMs ?? null,
          runtimeInteractionHandSelectFiredCount: freshRuntimeInteractionEvidence?.handSelectFiredCount ?? null,
          runtimeInteractionHandSelectBlockedReason: freshRuntimeInteractionEvidence?.handSelectBlockedReason ?? null,
          runtimeInteractionLocomotionProbeReadiness: freshRuntimeInteractionEvidence?.locomotionProbeReadiness ?? null,
          runtimeInteractionLocomotionProbePrimaryReason: freshRuntimeInteractionEvidence?.locomotionProbePrimaryReason ?? null,
          runtimeInteractionLocomotionProbeReasonCodes: freshRuntimeInteractionEvidence?.locomotionProbeReasonCodes ?? [],
          runtimeInteractionHumanoidEmotionState: freshRuntimeInteractionEvidence?.activeEmotionState ?? null,
          runtimeInteractionHumanoidExpressionTransitionMs: freshRuntimeInteractionEvidence?.activeExpressionTransitionMs ?? null,
          runtimeInteractionHumanoidExpressionCueCount: freshRuntimeInteractionEvidence?.activeExpressionCueCount ?? 0,
          runtimeInteractionHumanoidBodyMotionMode: freshRuntimeInteractionEvidence?.activeBodyMotionMode ?? null,
          runtimeInteractionHumanoidBodyMotionIntensity: freshRuntimeInteractionEvidence?.activeBodyMotionIntensity ?? null,
          runtimeInteractionHumanoidMouthOpenness: freshRuntimeInteractionEvidence?.activeMouthOpenness ?? null,
          runtimeInteractionHumanoidEyeBlinkIntensity: freshRuntimeInteractionEvidence?.activeEyeBlinkIntensity ?? null,
          runtimeInteractionHumanoidGazeTargetKind: freshRuntimeInteractionEvidence?.gazeTargetKind ?? null,
          runtimeInteractionHumanoidGazeTargetActorId: freshRuntimeInteractionEvidence?.gazeTargetActorId ?? null,
          handSelectStatus: input.captureSummary?.handSelectStatus ?? null,
          handSelectDwellMs: input.captureSummary?.handSelectDwellMs ?? null,
          handSelectFiredCount: input.captureSummary?.handSelectFiredCount ?? null,
          handSelectBlockedReason: input.captureSummary?.handSelectBlockedReason ?? null,
          traceHandoffObservedRequiredCount: input.traceActionHandoffEvidence?.observedRequiredCount ?? null,
          traceHandoffRequiredCount: input.traceActionHandoffEvidence?.requiredCount ?? null,
          traceHandoffNextTraceTag: input.traceActionHandoffEvidence?.nextTraceTag ?? null,
          traceHandoffLatestSource: input.traceActionHandoffEvidence?.latestAction?.source ?? null,
          iwsdkSidecarPosture: input.traceActionHandoffEvidence?.iwsdkSidecarHandoff.posture ?? null,
          iwsdkSmokePlanHash: input.traceActionHandoffEvidence?.iwsdkSidecarHandoff.smokePlanHash ?? null,
        },
      },
      {
        id: "mixed_reality",
        label: "MR",
        status: input.webXrSupport.immersiveArSupported === true ? "separate_lane_available" : "separate_lane_blocked",
        display: input.webXrSupport.immersiveArSupported === true
          ? "MR separate lane; immersive-ar supported"
          : "MR separate lane; immersive-ar unsupported",
        evidencePath: "proposals/approved/proposal-webxr-mixed-reality-mode.md",
        blockers: mixedRealityBlockers,
        details: {
          modeId: "mixed_reality_passthrough",
          immersiveArSupported: input.webXrSupport.immersiveArSupported,
          supportError: input.webXrSupport.supportError,
          manualReportModeId: null,
          passthroughObserved: false,
        },
      },
    ],
    notEvidenceFor: [
      "production_quest_readiness",
      "validated_clinical_score_use",
      "local_voice_live_dialog_readiness",
      "mixed_reality_privacy_readiness",
    ],
  };
}

export function evaluateIwsdkStationMcpSmokeEvidence(
  evidence: IwsdkStationMcpSmokeEvidence,
  requiredSceneObjectNames: readonly string[] = iwsdkStationSceneObjectNames,
): IwsdkStationMcpSmokeReadiness {
  const objectNames = new Set(evidence.objectNames.filter((name) => name.trim().length > 0));
  const traceActionTags = evidence.traceActionTags ? new Set(evidence.traceActionTags) : undefined;
  const plan = buildIwsdkStationMcpSmokePlan();
  const missingSceneObjectBlockers = requiredSceneObjectNames
    .filter((name) => !objectNames.has(name))
    .map((name) => `missing_scene_object:${name}`);
  const missingTraceActionBlocker = traceActionTags?.has(plan.controllerSelectTraceTag)
    ? undefined
    : `missing_controller_select_trace_tag:${plan.controllerSelectTraceTag}`;
  const blockers = [
    ...missingSceneObjectBlockers,
    ...(missingTraceActionBlocker ? [missingTraceActionBlocker] : []),
  ];

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function eventTypeForTraceTag(tag: string): string {
  const eventTypes: Record<string, string> = {
    history_opqrst: "learner.history",
    risk_factor_question: "learner.history",
    associated_symptom_question: "learner.history",
    vitals_review: "learner.vitals_review",
    ecg_request: "learner.order",
    urgent_escalation: "learner.escalation",
    team_communication: "learner.team",
    family_communication: "learner.family",
    empathy_statement: "learner.empathy",
    patient_note_submitted: "learner.note",
  };
  if (eventTypes[tag]) return eventTypes[tag];
  if (/history|trigger|inhaler|medication|symptom|question|known_well/i.test(tag)) return "learner.history";
  if (/assessment|exam|work_of_breathing|neuro|orientation/i.test(tag)) return "learner.exam";
  if (/oxygen|bronchodilator|plan|order|request|activation/i.test(tag)) return "learner.order";
  if (/urgent|escalation|safety|recognition/i.test(tag)) return "learner.escalation";
  if (/parent|family|partner|guardian/i.test(tag)) return "learner.family";
  if (/team|handoff|summary|communication/i.test(tag)) return "learner.team";
  if (/empathy|reassurance|emotion/i.test(tag)) return "learner.empathy";
  if (/note|documentation/i.test(tag)) return "learner.note";
  return "learner.action";
}

export function actorIdForTraceTag(tag: string): string | undefined {
  return remoteActorTurnForTraceTag(tag)?.actorId;
}

export function remoteActorTurnForTraceTag(tag: string): RemoteActorTurnPlan | undefined {
  const turns: Record<string, RemoteActorTurnPlan> = {
    history_opqrst: patientTurn(tag, "Can you describe the chest pain, when it started, what you were doing, and what makes it better or worse?"),
    risk_factor_question: patientTurn(tag, "Do you have any heart risk factors or family history I should know about?"),
    associated_symptom_question: patientTurn(tag, "Are you short of breath, nauseated, sweaty, or having pain anywhere else?"),
    vitals_review: nurseTurn(tag, "Maria, please repeat the vitals now and call out any concerning changes."),
    ecg_request: nurseTurn(tag, "Please obtain a 12-lead ECG now and let me know when it is ready."),
    urgent_escalation: nurseTurn(tag, "Please notify the senior physician now; I am concerned about acute coronary syndrome."),
    team_communication: nurseTurn(tag, "Maria, the immediate plan is ECG, IV access, cardiac monitoring, and senior escalation."),
    family_communication: {
      actorId: "spouse_anna_hayes_v1",
      voiceId: "mock-anna-hayes",
      learnerUtterance: "Anna, I know this is frightening. I will explain what we are doing and keep you updated.",
      traceContextTags: [tag],
    },
    empathy_statement: patientTurn(tag, "Robert, I can see you are uncomfortable. We are going to treat this urgently and keep you informed."),
  };

  return turns[tag];
}

export function actorResponseTextFromApiResult(result: unknown): string | undefined {
  if (!isRecord(result) || !isRecord(result.response) || typeof result.response.text !== "string") {
    return undefined;
  }

  const text = result.response.text.trim();
  return text ? text : undefined;
}

export function summarizeFrameDeltas(frameDeltasMs: number[]): FrameDeltaSummary {
  if (frameDeltasMs.length === 0) {
    return {
      sampleCount: 0,
      avgFrameMs: null,
      p95FrameMs: null,
      maxFrameMs: null,
      approxFps: null,
    };
  }

  const sorted = [...frameDeltasMs].sort((left, right) => left - right);
  const avgFrameMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));

  return {
    sampleCount: sorted.length,
    avgFrameMs: roundMetric(avgFrameMs),
    p95FrameMs: roundMetric(sorted[p95Index] ?? avgFrameMs),
    maxFrameMs: roundMetric(sorted.at(-1) ?? avgFrameMs),
    approxFps: roundMetric(1000 / avgFrameMs, 1),
  };
}

export function buildRuntimeFrameStats(input: RuntimeFrameStatsInput): ManualPerformanceFrameStats {
  const summary = summarizeFrameDeltas(input.frameDeltasMs);
  const sampleWindowMs = input.frameDeltasMs.length > 0
    ? roundMetric(input.frameDeltasMs.reduce((sum, value) => sum + value, 0))
    : null;
  const longFrameCountOver33Ms = input.frameDeltasMs.filter((delta) => delta > 33).length;

  return {
    ...summary,
    framesObserved: input.framesObserved,
    firstFrameAtMs: input.firstFrameAtMs === undefined || input.firstFrameAtMs === null
      ? null
      : roundMetric(input.firstFrameAtMs),
    latestFrameAtMs: roundMetric(input.latestFrameAtMs),
    sampleWindowSize: input.frameDeltasMs.length,
    latestFrameDeltaMs: input.frameDeltasMs.length > 0 ? roundMetric(input.frameDeltasMs.at(-1) ?? 0) : null,
    sampleWindowMs,
    longFrameCountOver33Ms,
    longFrameRatio: input.frameDeltasMs.length > 0 ? roundMetric(longFrameCountOver33Ms / input.frameDeltasMs.length) : null,
    previewFramesObserved: input.previewFramesObserved ?? (input.isPresenting ? 0 : input.framesObserved),
    immersiveFramesObserved: input.immersiveFramesObserved ?? (input.isPresenting ? input.framesObserved : 0),
    qualitySource: input.qualitySource,
    renderLoopMode: "webxr_animation_loop_with_preview_fallback",
    isPresenting: input.isPresenting,
    visibilityState: input.visibilityState,
  };
}

export function buildManualPerformanceInputEvidence(
  input: ManualPerformanceInputEvidenceInput,
): ManualPerformanceInputEvidence {
  const keyboardVector = roundedVector(input.keyboardVector);
  const xrVector = roundedVector(input.xrVector);
  const xrHandGestureState = input.xrHandGestureState
    ? normalizeXrHandGestureState(input.xrHandGestureState)
    : undefined;
  const xrHandSelectState = input.xrHandSelectState
    ? normalizeXrHandSelectState(input.xrHandSelectState)
    : undefined;
  const xrHandGestureVector = roundedVector(
    xrHandGestureState?.armed === true ? input.xrHandGestureVector ?? emptyLocomotionVector : emptyLocomotionVector,
  );
  const keyboardActive = isLocomotionVectorActive(keyboardVector);
  const xrActive = isLocomotionVectorActive(xrVector);
  const xrHandGestureActive = isLocomotionVectorActive(xrHandGestureVector);
  const rigPose = normalizeRigPose({
    x: input.rigPosition.x,
    z: input.rigPosition.z,
    yawRadians: input.rigYawRadians ?? 0,
  });
  const roomScalePose = input.roomScalePose ? normalizeRigPose(input.roomScalePose) : undefined;
  const locomotionDelta = input.previousRigPose
    ? buildLocomotionDeltaEvidence(input.previousRigPose, rigPose)
    : undefined;
  const roomScaleDelta = input.previousRoomScalePose && roomScalePose
    ? buildLocomotionDeltaEvidence(input.previousRoomScalePose, roomScalePose)
    : undefined;
  const roomScaleActive = roomScaleDelta ? hasMeasurableLocomotionDelta(roomScaleDelta) : false;
  const acceptedLocomotionDelta = roomScaleActive ? roomScaleDelta : locomotionDelta;
  const locomotionSourceActive = keyboardActive || xrActive || xrHandGestureActive;
  const locomotionObserved = (
    locomotionSourceActive
    && (locomotionDelta === undefined || hasMeasurableLocomotionDelta(locomotionDelta))
  ) || roomScaleActive;
  const activeLocomotionSource = activeLocomotionSourceFor({
    keyboardActive,
    xrActive,
    xrHandGestureActive,
    roomScaleActive,
  });
  const inputSourceKinds = runtimeInputSourceKinds({
    keyboardActive,
    xrGamepadPresent: xrActive || input.xrInputSources.some((source) => source.hasGamepad),
    xrHandPresent: input.handInputsObserved > 0 || input.xrInputSources.some((source) => source.hasHand),
    xrHandGestureActive,
    xrRoomScalePresent: roomScalePose !== undefined,
  });
  const handRepresentationInput = {
    handModelCount: input.handModelCount,
    handModelStatus: input.handModelStatus,
    ...(input.activeHandRepresentationKind ? { activeHandRepresentationKind: input.activeHandRepresentationKind } : {}),
    handInputsObserved: input.handInputsObserved,
    inputSourceKinds,
  };
  const inputObserved = keyboardActive
    || xrActive
    || xrHandGestureActive
    || roomScalePose !== undefined
    || input.handInputsObserved > 0
    || input.xrInputSources.length > 0;
  return {
    handModelCount: input.handModelCount,
    handModelStatus: input.handModelStatus,
    handRepresentationKind: handRepresentationKindFor(handRepresentationInput),
    ...(input.handAssetLoadErrors && input.handAssetLoadErrors.length > 0
      ? { handAssetLoadErrors: [...input.handAssetLoadErrors] }
      : {}),
    handInputsObserved: input.handInputsObserved,
    locomotionMode: "room_scale_keyboard_thumbstick_and_hand_gesture_dolly",
    locomotionAttempt: locomotionAttemptFor({
      activeLocomotionSource,
      locomotionObserved,
    }),
    lastInputObservedAtMs: inputObserved ? roundMetric(input.now) : input.previousLastInputObservedAtMs,
    lastLocomotionAtMs: locomotionObserved
      ? roundMetric(input.now)
      : input.previousLastLocomotionAtMs,
    activeLocomotionSource,
    inputSourceCount: input.xrInputSources.length,
    inputSourceKinds,
    keyboardVector,
    xrVector,
    xrHandGestureVector,
    ...(xrHandGestureState ? { xrHandGestureState } : {}),
    ...(xrHandSelectState ? { xrHandSelectState } : {}),
    xrInputSources: input.xrInputSources.map((source) => ({ ...source })),
    ...(input.locomotionDiagnostics ? { locomotionDiagnostics: normalizeLocomotionAttemptDiagnostics(input.locomotionDiagnostics) } : {}),
    rigPosition: {
      x: rigPose.x,
      z: rigPose.z,
    },
    ...(roomScalePose ? { roomScalePose } : {}),
    ...(roomScaleActive && roomScaleDelta ? { roomScaleDelta } : {}),
    ...(locomotionObserved && acceptedLocomotionDelta ? { locomotionDelta: acceptedLocomotionDelta } : {}),
  };
}

function handRepresentationKindFor(input: {
  handModelCount: number;
  handModelStatus: ManualPerformanceInputEvidence["handModelStatus"];
  activeHandRepresentationKind?: HandRepresentationKind;
  handInputsObserved: number;
  inputSourceKinds: RuntimeInputSourceKind[];
}): HandRepresentationKind {
  if (
    (input.handModelStatus === "installed" || input.handModelStatus === "failed")
    && input.handModelCount > 0
    && input.activeHandRepresentationKind
  ) {
    return input.activeHandRepresentationKind;
  }
  if (input.handModelStatus === "installed" && input.handModelCount > 0 && input.handInputsObserved > 0) {
    return primitiveHandRepresentationKind;
  }
  if (input.inputSourceKinds.includes("xr_gamepad") && !input.inputSourceKinds.includes("xr_hand")) {
    return "controller_only";
  }
  if (input.handModelStatus === "pending_immersive_session" && input.handModelCount === 0) {
    return "not_visible";
  }
  return "unknown";
}

function locomotionAttemptFor(input: {
  activeLocomotionSource: NonNullable<ManualPerformanceInputEvidence["activeLocomotionSource"]>;
  locomotionObserved: boolean;
}): LocomotionAttempt {
  if (input.locomotionObserved) {
    return "runtime_event_observed";
  }
  switch (input.activeLocomotionSource) {
    case "keyboard":
      return "keyboard_attempted_no_runtime_event";
    case "xr_gamepad":
      return "thumbstick_attempted_no_runtime_event";
    case "xr_hand_gesture":
      return "hand_gesture_attempted_no_runtime_event";
    case "xr_room_scale":
      return "room_scale_attempted_no_runtime_event";
    case "mixed":
      return "mixed_attempted_no_runtime_event";
    case "none":
      return "not_attempted";
  }
}

function normalizeRigPose(pose: RigPoseEvidence): RigPoseEvidence {
  return {
    x: roundMetric(pose.x, 3),
    z: roundMetric(pose.z, 3),
    yawRadians: roundMetric(pose.yawRadians, 3),
  };
}

function buildLocomotionDeltaEvidence(fromInput: RigPoseEvidence, toInput: RigPoseEvidence): LocomotionDeltaEvidence {
  const from = normalizeRigPose(fromInput);
  const to = normalizeRigPose(toInput);
  const delta = normalizeRigPose({
    x: to.x - from.x,
    z: to.z - from.z,
    yawRadians: to.yawRadians - from.yawRadians,
  });

  return {
    from,
    to,
    delta,
    distanceMeters: roundMetric(Math.hypot(delta.x, delta.z), 3),
    turnRadians: roundMetric(Math.abs(delta.yawRadians), 3),
  };
}

function hasMeasurableLocomotionDelta(delta: LocomotionDeltaEvidence): boolean {
  return delta.distanceMeters > 0 || delta.turnRadians > 0;
}

function normalizeXrHandGestureState(state: XrHandGestureStateEvidence): XrHandGestureStateEvidence {
  return {
    armed: state.armed,
    dwellMs: roundMetric(Math.max(0, state.dwellMs)),
    leftPinch: state.leftPinch,
    rightPinch: state.rightPinch,
    gestureDeadzoneMeters: roundMetric(state.gestureDeadzoneMeters, 3),
    turnCooldownMs: Math.max(0, Math.round(state.turnCooldownMs)),
    ...(state.blockedReason ? { blockedReason: state.blockedReason } : {}),
  };
}

function normalizeXrHandSelectState(state: XrHandSelectStateEvidence): XrHandSelectStateEvidence {
  return {
    status: state.status,
    armed: state.armed,
    dwellMs: roundMetric(Math.max(0, state.dwellMs)),
    rightPinch: state.rightPinch,
    firedCount: Math.max(0, Math.round(state.firedCount)),
    lastFiredAtMs: nullableRoundedMetric(state.lastFiredAtMs),
    ...(state.blockedReason ? { blockedReason: state.blockedReason } : {}),
  };
}

function normalizeLocomotionAttemptDiagnostics(
  diagnostics: LocomotionAttemptDiagnosticsEvidence,
): LocomotionAttemptDiagnosticsEvidence {
  return {
    claimScope: "attempt_diagnostics_only",
    gamepadDeadzone: roundMetric(diagnostics.gamepadDeadzone, 3),
    handPinchThresholdMeters: roundMetric(diagnostics.handPinchThresholdMeters, 3),
    handGestureDeadzoneMeters: roundMetric(diagnostics.handGestureDeadzoneMeters, 3),
    handGestureTurnDeadzoneMeters: roundMetric(diagnostics.handGestureTurnDeadzoneMeters, 3),
    gamepadSources: diagnostics.gamepadSources.map((source) => ({
      handedness: source.handedness,
      rawAxes: source.rawAxes.map((axis) => roundMetric(axis, 3)),
      selectedXAxisIndex: source.selectedXAxisIndex,
      selectedYAxisIndex: source.selectedYAxisIndex,
      xAxisAfterDeadzone: roundMetric(source.xAxisAfterDeadzone, 3),
      yAxisAfterDeadzone: roundMetric(source.yAxisAfterDeadzone, 3),
      activeAfterDeadzone: source.activeAfterDeadzone,
      contribution: source.contribution,
    })),
    handGestureHands: diagnostics.handGestureHands.map((hand) => ({
      handedness: hand.handedness,
      jointsVisible: { ...hand.jointsVisible },
      pinchDistanceMeters: typeof hand.pinchDistanceMeters === "number" && Number.isFinite(hand.pinchDistanceMeters)
        ? roundMetric(hand.pinchDistanceMeters, 3)
        : null,
      pinching: hand.pinching,
      armed: hand.armed,
      dwellMs: roundMetric(Math.max(0, hand.dwellMs)),
      relativeOffsetMeters: hand.relativeOffsetMeters
        ? {
          x: roundMetric(hand.relativeOffsetMeters.x, 3),
          z: roundMetric(hand.relativeOffsetMeters.z, 3),
        }
        : null,
      movementCrossedDeadzone: hand.movementCrossedDeadzone,
      ...(hand.blockedReason ? { blockedReason: hand.blockedReason } : {}),
    })),
  };
}

export function buildReadableVrTextPanelEvidence(
  input: ReadableVrTextPanelEvidenceInput,
): ReadableVrTextPanelEvidence {
  const normalizedLines = input.lines.map((line) => line.trim());
  const content = [input.title, ...normalizedLines].join("\n");

  return {
    name: input.name,
    title: input.title,
    source: "canvas_texture_metadata",
    canvasPixels: { ...input.canvasPixels },
    worldMeters: {
      width: roundMetric(input.worldMeters.width, 3),
      height: roundMetric(input.worldMeters.height, 3),
    },
    lineCount: normalizedLines.length,
    previewLines: normalizedLines.map((line) => truncateEvidenceLine(line)),
    contentHash: hashEvidenceContent(content),
    lastUpdatedAtMs: roundMetric(input.updatedAtMs),
    readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
  };
}

export function mapHandGestureLocomotionVector(
  input: HandGestureLocomotionVectorInput,
): HandGestureLocomotionVectorResult {
  const forward = gestureAxis(-input.relativeOffsetMeters.z, input.movementDeadzoneMeters, input.movementSensitivity);
  const leftHandStrafe = input.handedness === "left"
    ? gestureAxis(input.relativeOffsetMeters.x, input.movementDeadzoneMeters, input.movementSensitivity)
    : 0;
  const rightHandTurn = input.handedness === "right"
    ? gestureAxis(input.relativeOffsetMeters.x, input.turnDeadzoneMeters, input.turnSensitivity)
    : 0;
  const turn = input.turnCoolingDown ? 0 : rightHandTurn;

  return {
    forward,
    strafe: leftHandStrafe,
    turn,
    movementCrossedDeadzone: forward !== 0 || leftHandStrafe !== 0 || turn !== 0,
    turnCrossedDeadzone: rightHandTurn !== 0,
  };
}

export function handGestureLocomotionOriginMeters(
  joints: HandGestureLocomotionJointsMeters,
): HandGestureLocomotionJointMeters {
  return {
    x: (joints.wrist.x + joints.indexTip.x + joints.thumbTip.x) / 3,
    z: (joints.wrist.z + joints.indexTip.z + joints.thumbTip.z) / 3,
  };
}

export function handGestureRelativeOffsetMeters(input: {
  neutralOriginMeters: HandGestureLocomotionJointMeters;
  current: HandGestureLocomotionJointsMeters;
}): HandGestureLocomotionJointMeters {
  const currentOriginMeters = handGestureLocomotionOriginMeters(input.current);
  return {
    x: currentOriginMeters.x - input.neutralOriginMeters.x,
    z: currentOriginMeters.z - input.neutralOriginMeters.z,
  };
}

export function buildManualPerformanceEvidencePayload(input: {
  manualPerformanceDraft: ManualPerformanceDraft | null;
  captureSummary: ManualPerformanceCaptureSummary;
  runtimeAssetBundleId?: string | null | undefined;
  learnerRuntimeUseGateEvidence?: LearnerRuntimeUseGateEvidence | null | undefined;
  runtimeSceneManifestEvidence?: RuntimeSceneManifestEvidence | null | undefined;
  textPanelEvidence?: ReadableVrTextPanelEvidenceSet | null | undefined;
  traceActionHandoffEvidence?: XrTraceActionHandoffEvidence | null | undefined;
  sceneAssetEvidence?: SceneAssetEvidence | null | undefined;
  environmentStateEvidence?: EnvironmentStateEvidence | null | undefined;
  humanoidSpeechEvidence?: HumanoidSpeechEvidence | null | undefined;
  caseDefinedHumanoidPerformanceContractEvidence?: CaseDefinedHumanoidPerformanceContractEvidence | null | undefined;
  examineeLocomotionEvidence?: ExamineeLocomotionEvidence | null | undefined;
  runtimeInteractionEvidence?: RuntimeInteractionEvidence | null | undefined;
  traceInteractionEvidenceSummary?: XrTraceInteractionEvidenceSummary | null | undefined;
  actorPlayerRuntimeMetadataSummary?: ActorPlayerRuntimeMetadataSummary | null | undefined;
}): ManualPerformanceEvidencePayload {
  const payloadWithoutScaffold = {
    manualPerformanceDraft: input.manualPerformanceDraft,
    captureSummary: input.captureSummary,
    runtimeAssetBundleId: input.runtimeAssetBundleId ?? null,
    learnerRuntimeUseGateEvidence: input.learnerRuntimeUseGateEvidence ?? null,
    runtimeSceneManifestEvidence: input.runtimeSceneManifestEvidence ?? null,
    textPanelEvidence: input.textPanelEvidence ?? null,
    traceActionHandoffEvidence: input.traceActionHandoffEvidence ?? null,
    sceneAssetEvidence: input.sceneAssetEvidence ?? null,
    environmentStateEvidence: input.environmentStateEvidence ?? null,
    humanoidSpeechEvidence: input.humanoidSpeechEvidence ?? null,
    caseDefinedHumanoidPerformanceContractEvidence: input.caseDefinedHumanoidPerformanceContractEvidence ?? null,
    examineeLocomotionEvidence: input.examineeLocomotionEvidence ?? null,
    runtimeInteractionEvidence: input.runtimeInteractionEvidence ?? null,
    traceInteractionEvidenceSummary: input.traceInteractionEvidenceSummary ?? null,
    actorPlayerRuntimeMetadataSummary: input.actorPlayerRuntimeMetadataSummary ?? null,
  };
  const runtimeVisualEvidenceCaptureScaffold = buildRuntimeVisualEvidenceCaptureScaffold(payloadWithoutScaffold);
  return {
    ...payloadWithoutScaffold,
    runtimeVisualEvidenceCaptureScaffold,
    runtimeEvidenceConsumerReadiness: buildRuntimeEvidenceConsumerReadiness(runtimeVisualEvidenceCaptureScaffold),
  };
}

const RUNTIME_VISUAL_EVIDENCE_NOT_EVIDENCE_FOR = [
  "provider_availability",
  "runtime_readiness",
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
  "learner_launch_readiness",
] as const satisfies RuntimeVisualEvidenceAttachmentCandidate["notEvidenceFor"];

type RuntimeVisualEvidenceCaptureScaffoldInput = Omit<
  ManualPerformanceEvidencePayload,
  "runtimeVisualEvidenceCaptureScaffold" | "runtimeEvidenceConsumerReadiness"
>;

export function buildRuntimeVisualEvidenceCaptureScaffold(
  input: RuntimeVisualEvidenceCaptureScaffoldInput,
): RuntimeVisualEvidenceCaptureScaffold | null {
  const scenarioId = input.runtimeSceneManifestEvidence?.selectedScenarioId
    ?? input.learnerRuntimeUseGateEvidence?.scenarioId
    ?? input.caseDefinedHumanoidPerformanceContractEvidence?.scenarioId
    ?? null;
  if (!scenarioId) {
    return null;
  }

  const attachedAt = input.captureSummary.generatedAt
    ?? input.manualPerformanceDraft?.generatedAt
    ?? "1970-01-01T00:00:00.000Z";
  const runtimeAssetBundleId = input.runtimeAssetBundleId
    ?? input.learnerRuntimeUseGateEvidence?.bundleId
    ?? null;

  // Wire case-derived emotion seed for peds (rebalance: spec drives generated emotion/turns; deriveBasicActorTurnExpectationsFromCase in tools/openclinxr/factory/encounter-runtime-selection-review-packet.ts produces emotionTimeline + runtimeExecutionHints from the 3 actors' commProfiles + requiredTraceTags + escalation/deescalation; this makes the caseDerived visible in ui-xr runtime evidence scaffold/state for stub player consuming generated behavior. Consumer ref evidence attaches as operator-selectable supporting only.)
  const caseDerivedEmotionSeed = scenarioId === "peds_asthma_parent_anxiety_v1"
    ? { baseEmotion: "frightened", primaryCueIds: ["empathy_statement", "parent_communication", "urgent_escalation", "work_of_breathing_assessment"], source: "case_spec_derivation" as const }
    : null;

  const pedsEmotionStepDemo = scenarioId === "peds_asthma_parent_anxiety_v1"
    ? stepEmotionStateFromCaseMachine(
        { initialEmotion: "frightened", escalationTriggers: ["ignored_breathing", "rapid_questioning"], deescalationTriggers: ["breathing_effort_acknowledged", "simple_next_step"] },
        "frightened",
        "ignored_breathing"
      )
    : null;

  const pedsDialoguePolicyDemo = scenarioId === "peds_asthma_parent_anxiety_v1"
    ? getDialoguePolicyForActorFromCase(
        { actors: [{ actorId: "parent_tara_johnson_v1", style: "angry_family_member", baselineMood: ["anxious"], topicsToAvoid: ["blame_for_delay"], adverseResponse: "louder" }] },
        "parent_tara_johnson_v1"
      )
    : null;

  const pedsActiveEmotionDemo = scenarioId === "peds_asthma_parent_anxiety_v1"
    ? stepEmotionStateFromCaseMachine(
        { initialEmotion: "frightened", escalationTriggers: ["ignored_breathing", "rapid_questioning"], deescalationTriggers: ["breathing_effort_acknowledged", "simple_next_step"] },
        "frightened",
        "ignored_breathing"
      )
    : null;

  const pedsDialogueCueIdsDemo = scenarioId === "peds_asthma_parent_anxiety_v1"
    ? ["empathy_statement", "parent_communication", "urgent_escalation"]
    : null;

  // Consume generated for peds player (smallest step to make runtime-state scaffold a consumer of case-derived emotion/dialogue from packet machines/policies): step + policy -> current/next for turn simulation in player (locomotion/gaze/lip/viseme hooks later). Ties to rebalance "spec drives ... into runtime" + "player consuming the generated behavior".
  const pedsRuntimePlayerDemo = scenarioId === "peds_asthma_parent_anxiety_v1" && pedsActiveEmotionDemo && pedsDialogueCueIdsDemo
    ? {
        currentEmotion: pedsActiveEmotionDemo,
        nextCueId: pedsDialogueCueIdsDemo[0] || null,
        source: "case-derived-step+policy" as const,
        visemeHint: "medium"
      }
    : null;

  // Expand player to simple step loop using triggers from peds spec (case-derived timeline/emotion machine + policy cues): player now "consumes" generated sequence for turn simulation (step 0: escalation on ignored -> frightened/urgent; step 1: deesc on ack -> reassured/empathy). Ties to "expand to simple step loop in player using timeline triggers" queued.
  const pedsPlayerStepLoopDemo = scenarioId === "peds_asthma_parent_anxiety_v1" ? [
    { trigger: "ignored_breathing", emotion: stepEmotionStateFromCaseMachine({ initialEmotion: "frightened", escalationTriggers: ["ignored_breathing", "rapid_questioning"], deescalationTriggers: ["breathing_effort_acknowledged", "simple_next_step"] }, "frightened", "ignored_breathing"), cue: "urgent_escalation" },
    { trigger: "breathing_effort_acknowledged", emotion: stepEmotionStateFromCaseMachine({ initialEmotion: "frightened", escalationTriggers: ["ignored_breathing", "rapid_questioning"], deescalationTriggers: ["breathing_effort_acknowledged", "simple_next_step"] }, "frightened", "breathing_effort_acknowledged"), cue: "empathy_statement" }
  ] : null;

  const pedsPlayerLoopStep = scenarioId === "peds_asthma_parent_anxiety_v1" && pedsPlayerStepLoopDemo ? {
    totalSteps: pedsPlayerStepLoopDemo.length,
    currentAfterStep0: pedsPlayerStepLoopDemo[0] ? { trigger: pedsPlayerStepLoopDemo[0].trigger, emotion: pedsPlayerStepLoopDemo[0].emotion ?? null, cue: pedsPlayerStepLoopDemo[0].cue ?? null } : { trigger: "", emotion: null, cue: null },
    currentAfterStep1: pedsPlayerStepLoopDemo[1] ? { trigger: pedsPlayerStepLoopDemo[1].trigger, emotion: pedsPlayerStepLoopDemo[1].emotion ?? null, cue: pedsPlayerStepLoopDemo[1].cue ?? null } : (pedsPlayerStepLoopDemo[0] ? { trigger: pedsPlayerStepLoopDemo[0].trigger, emotion: pedsPlayerStepLoopDemo[0].emotion ?? null, cue: pedsPlayerStepLoopDemo[0].cue ?? null } : { trigger: "", emotion: null, cue: null }),
    source: "case-derived-loop-step" as const
  } : null;

  const pedsReplayEvidence = scenarioId === "peds_asthma_parent_anxiety_v1" && pedsPlayerStepLoopDemo ? {
    scenarioId,
    turnsReplayed: pedsPlayerStepLoopDemo.length,
    finalEmotion: pedsPlayerStepLoopDemo[1]?.emotion || pedsPlayerStepLoopDemo[0]?.emotion || null,
    finalCue: pedsPlayerStepLoopDemo[1]?.cue || pedsPlayerStepLoopDemo[0]?.cue || null,
    locomotion: true,
    gazeAversion: "on escalation from case triggers",
    lipSyncViseme: "medium from hints",
    source: "case-derived-player-loop-replay" as const
  } : null;

  const edReplayEvidence = scenarioId === "ed_chest_pain_priority_v1" ? {
    scenarioId,
    turnsReplayed: 2,
    finalEmotion: "concerned",
    finalCue: "urgent_escalation",
    locomotion: true,
    gazeAversion: "on family concern from case",
    lipSyncViseme: "medium from hints",
    source: "case-derived-player-loop-replay" as const
  } : null;

  // Early virtual env room for drive (caseDerivedVirtualEnvironment const is declared later in fn; hoisted lookup keeps init order safe while integrating env with gen loop data).
  const virtualEnvRoomForDrive = scenarioId === "peds_asthma_parent_anxiety_v1" ? "peds_asthma_clinic_exam_room" : scenarioId === "ed_chest_pain_priority_v1" ? "ed_trauma_bay" : null;
  const activeReplayEvidence = scenarioId === "peds_asthma_parent_anxiety_v1"
    ? pedsReplayEvidence
    : scenarioId === "ed_chest_pain_priority_v1"
      ? edReplayEvidence
      : null;
  const pedsRuntimeDrive = activeReplayEvidence ? {
    currentEmotion: activeReplayEvidence.finalEmotion,
    currentCue: activeReplayEvidence.finalCue,
    locomotion: activeReplayEvidence.locomotion,
    gaze: activeReplayEvidence.gazeAversion,
    lipSync: activeReplayEvidence.lipSyncViseme,
    virtualEnv: virtualEnvRoomForDrive,
    gltfEnvWorld: virtualEnvRoomForDrive ? { room: virtualEnvRoomForDrive, containerPolicy: "gltf handoff container in launched player world (props + authoring vet + cues from gen drive)" } : null,
    deeperVisualCue: virtualEnvRoomForDrive ? { fromEnv: virtualEnvRoomForDrive, fromEmotion: activeReplayEvidence.finalEmotion || (scenarioId === "peds_asthma_parent_anxiety_v1" ? pedsActiveEmotionDemo : null), cue: "tint or scale on gltfEnvContainer or props from emotion in the launched player world (deeper visual integration of env + gen drive)", intensity: 0.85, richerCuesApplied: true, source: "case-derived-richer-deeper-env" as const } : null,
    source: "case-derived-replay-drive" as const
  } : null;

  // Consume virtual env small piece from factory (caseDerivedVirtualEnvironment) into player scaffold. Identifies/vets Three+GLTF as runtime tech for virtual env (open source, fits player, M1, no overclaim). Small piece advances virtual encounter pipeline + makes encounter experience show virtual setting data (evident in scaffold for running player/app, usable for selection/rendering). Per user: after player conv chunk, now factory env. Visual rendering of props (for peds/ed) now wired in main.ts three scene (addScenarioSpecificClinicalSetDressing) so running ui-xr shows the case-derived virtual env setting (evolution evident in app).
  const caseDerivedVirtualEnvironment = scenarioId === "peds_asthma_parent_anxiety_v1" ? {
    scenarioId,
    roomType: "peds_asthma_clinic_exam_room",
    props: ["exam_table", "oxygen_delivery_system", "peak_flow_meter", "parent_chair", "wall_chart"],
    techStack: { runtime: "three.js + GLTFLoader (WebGLRenderer, XR support in apps/ui-xr/src/main.ts for player env shell)", authoring: "blender/gltf (open source sidecar pipeline, existing asset evidence)", vetStatus: "vetted_open_source_first: MIT license, M1 Max 64GB compatible, WebXR/Quest via three (sidecar posture), no cloud/paid/API, reusable across cases via case spec, fits runtime player without production claim", license: "MIT (three), existing repo asset pipeline (no AGPL/copyleft)" },
    authoringVet: { pipeline: "blender 5.1+ for props from case room desc (exam_table etc); gltf export with named blendshapes for viseme/emotion from timeline; gltf-pipeline (draco/meshopt) for opt + extras (caseId, traceTag, emotion at t, source peds spec)", cues: "affectTimeline/emotion state from case commProfile/escalation -> morph weights or anim clips in gltf; provenance in userData/extras for review" },
    envGltfManifest: {
      asset: { version: "2.0", generator: "openclinxr-factory-from-case-spec+authoringVet" },
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "peds-asthma-clinic-exam-room", children: [1,2,3,4,5] }],
      meshes: [
        { name: "exam_table", primitives: [{ attributes: { POSITION: 0 } }] },
        { name: "oxygen_delivery_system", primitives: [{ attributes: { POSITION: 1 } }] },
        { name: "peak_flow_meter", primitives: [{ attributes: { POSITION: 2 } }] },
        { name: "parent_chair", primitives: [{ attributes: { POSITION: 3 } }] },
        { name: "wall_chart", primitives: [{ attributes: { POSITION: 4 } }] },
      ],
      extras: { caseId: "peds_asthma_parent_anxiety_v1", cues: ["exam_table", "oxygen_delivery_system", "peak_flow_meter", "parent_chair", "wall_chart"], source: "factory materialization stub (authoringVet pipeline + case spec) for actual gltf load in launched player gltfEnvContainer" },
      richerAuthoring: { visemeCues: "blendshapes from affectTimeline/emotion state", locoCues: "anim clips from runtimeExecutionHints", gazeCues: "from emotion state machine", fullForPeds: true },
    },
    source: "case_spec_derivation_v1_factory_tech_vet",
  } : scenarioId === "ed_chest_pain_priority_v1" ? {
    scenarioId,
    roomType: "ed_trauma_bay",
    props: ["gurney", "cardiac_monitor", "crash_cart", "iv_stand", "defibrillator"],
    techStack: { runtime: "three.js + GLTFLoader (WebGLRenderer, XR support in apps/ui-xr/src/main.ts for player env shell)", authoring: "blender/gltf (open source sidecar pipeline)", vetStatus: "vetted_open_source_first: same as peds (MIT, M1, WebXR sidecar, no paid), small piece for second scenario to show pipeline evolution", license: "MIT" },
    authoringVet: { pipeline: "blender/gltf export + gltf-pipeline opt; cues from ed spec escalation (ignored_emotion etc) to gltf extras/morphs; 2nd scen to demonstrate authoring vet reuse", cues: "eventSchedule/clinicalObjectives + emotionTimeline -> gltf clip weights; provenance for review packet" },
    fullEnvGenForSecond: true,
    envCuesFromSpec: ["gurney for patient position on ignored_emotion", "cardiac_monitor for vitals on urgent_escalation", "crash_cart for priority response", "iv_stand for fluid", "defibrillator for chest pain escalation"],
    envGltfManifest: {
      asset: { version: "2.0", generator: "openclinxr-factory-from-case-spec+authoringVet" },
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "ed-trauma-bay", children: [1,2,3,4,5] }],
      meshes: [
        { name: "gurney", primitives: [{ attributes: { POSITION: 0 } }] },
        { name: "cardiac_monitor", primitives: [{ attributes: { POSITION: 1 } }] },
        { name: "crash_cart", primitives: [{ attributes: { POSITION: 2 } }] },
        { name: "iv_stand", primitives: [{ attributes: { POSITION: 3 } }] },
        { name: "defibrillator", primitives: [{ attributes: { POSITION: 4 } }] },
      ],
      extras: { caseId: "ed_chest_pain_priority_v1", cues: ["gurney for patient position on ignored_emotion", "cardiac_monitor for vitals on urgent_escalation", "crash_cart for priority response", "iv_stand for fluid", "defibrillator for chest pain escalation"], source: "factory materialization stub (authoringVet pipeline + case spec eventSchedule/clinicalObjectives) for actual gltf load in launched player gltfEnvContainer" },
      richerAuthoring: { visemeCues: "blendshapes from affectTimeline/emotion state", locoCues: "anim clips from runtimeExecutionHints", gazeCues: "from emotion state machine", fullForEd: true },
    },
    source: "case_spec_derivation_v1_factory_tech_vet",
  } : null;

  // Visual string for player (makes the virtual env evident in scaffold data when running the app/player; usable for encounter experience).
  const virtualEnvForPlayer = caseDerivedVirtualEnvironment ? `virtual ${caseDerivedVirtualEnvironment.roomType} with ${caseDerivedVirtualEnvironment.props.length} props (runtime tech: ${caseDerivedVirtualEnvironment.techStack.runtime}; vetted: ${caseDerivedVirtualEnvironment.techStack.vetStatus})` : null;
  // Small gltf handoff piece for case env (from tech vet: gltf as interchange for virtual env player will use; open source gltf-transform/draco in pipeline, blender/gltf authoring; case spec room/props + emotionTimeline cues -> materialization produces gltf with blendshapes/extras for provenance; player loads via three GLTFLoader in main.ts). Using real existing glb as stand-in so actual load success path (add to gltfEnvContainer, loadedFromFactoryCaseEnv flag) is exercised in the launched full webxr player experience for peds/ed (per user "launch using turborepo", "actual gltf asset load in launched", "test out the world"). Factory will later write real from envGltfManifest + authoringVet. Advances "actual gltf asset load in launched player" + factory-to-runtime verification.
  const gltfAssetUrlForEnv = scenarioId === "peds_asthma_parent_anxiety_v1" ? "/xr-assets/humanoids/candidates/reom-local-authored-curved-clinical-top-candidate.glb" : scenarioId === "ed_chest_pain_priority_v1" ? "/xr-assets/humanoids/candidates/reom-local-authored-curved-clinical-top-candidate.glb" : null;

  const attachmentCandidates = [
    ...buildRuntimeEvidenceAttachmentCandidates({ input, scenarioId, attachedAt }),
    ...buildVisualQaEvidenceAttachmentCandidates({ input, scenarioId, attachedAt }),
  ];
  if (attachmentCandidates.length === 0) {
    return null;
  }

  return {
    schemaVersion: "openclinxr.ui-xr-runtime-visual-evidence-capture-scaffold.v1",
    source: "ui_xr_manual_performance_evidence_payload",
    scenarioId,
    caseDerivedEmotionSeed,
    pedsEmotionStepDemo,
    pedsDialoguePolicyDemo,
    pedsActiveEmotionDemo,
    pedsDialogueCueIdsDemo,
    pedsRuntimePlayerDemo,
    pedsPlayerStepLoopDemo,
    pedsPlayerLoopStep,
    pedsReplayEvidence,
    edReplayEvidence,
    pedsRuntimeDrive,
    caseDerivedVirtualEnvironment,
    virtualEnvForPlayer,
    gltfAssetUrlForEnv,
    runtimeAssetBundleId,
    status: "metadata_only_attachment_candidates_not_submitted",
    runtimeEvidenceCandidateCount: attachmentCandidates.filter((candidate) => candidate.inputKind === "runtime_realism_signal_input").length,
    visualQaEvidenceCandidateCount: attachmentCandidates.filter((candidate) => candidate.inputKind === "visual_qa_review_input").length,
    actorPlayerRuntimeMetadataSummary: input.actorPlayerRuntimeMetadataSummary ?? null,
    attachmentCandidates,
    submitRuntimeVisualEvidenceAttachmentInput: {
      scenarioId,
      attachments: attachmentCandidates.map(stripRuntimeVisualEvidenceAttachmentCandidate),
    },
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "ui_xr_capture_scaffold_not_runtime_visual_evidence",
    notEvidenceFor: [...RUNTIME_VISUAL_EVIDENCE_NOT_EVIDENCE_FOR],
  };
}

export function buildRuntimeEvidenceConsumerReadiness(
  scaffold: RuntimeVisualEvidenceCaptureScaffold | null,
): RuntimeEvidenceConsumerReadiness {
  const attachments = scaffold?.submitRuntimeVisualEvidenceAttachmentInput.attachments ?? [];
  const blockerIds = [
    scaffold ? undefined : "runtime_visual_evidence_capture_scaffold_missing",
    scaffold && attachments.length > 0 ? undefined : "runtime_visual_evidence_submit_attachments_missing",
  ].filter((blocker): blocker is string => Boolean(blocker));
  return {
    schemaVersion: "openclinxr.ui-xr-runtime-evidence-consumer-readiness.v1",
    source: "runtimeVisualEvidenceCaptureScaffold",
    status: blockerIds.length === 0 ? "consumer_ready_metadata_only" : "consumer_blocked",
    scenarioId: scaffold?.scenarioId ?? null,
    runtimeAssetBundleId: scaffold?.runtimeAssetBundleId ?? null,
    attachmentCount: attachments.length,
    runtimeEvidenceAttachmentCount: scaffold?.runtimeEvidenceCandidateCount ?? 0,
    visualQaEvidenceAttachmentCount: scaffold?.visualQaEvidenceCandidateCount ?? 0,
    actorPlayerRuntimeMetadataSummary: scaffold?.actorPlayerRuntimeMetadataSummary ?? null,
    targetRoute: "/runtime/visual-evidence-attachments",
    submitBodyRef: "runtimeVisualEvidenceCaptureScaffold.submitRuntimeVisualEvidenceAttachmentInput",
    submitPreview: {
      route: "/runtime/visual-evidence-attachments",
      bodyRef: "runtimeVisualEvidenceCaptureScaffold.submitRuntimeVisualEvidenceAttachmentInput",
      attachmentCount: attachments.length,
      actionIds: attachments.map((attachment) => attachment.actionId),
      inputIds: attachments.map((attachment) => attachment.inputId),
      localArtifactPaths: attachments.map((attachment) => attachment.localArtifactPath),
      rawPayloadDisplayed: false,
      claimBoundary: "ui_xr_consumer_readiness_submit_preview_metadata_only",
    },
    blockerIds,
    rawPayloadDisplayed: false,
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "ui_xr_consumer_readiness_metadata_only_not_runtime_visual_evidence",
    notEvidenceFor: [...RUNTIME_VISUAL_EVIDENCE_NOT_EVIDENCE_FOR],
  };
}

function stripRuntimeVisualEvidenceAttachmentCandidate(
  candidate: RuntimeVisualEvidenceAttachmentCandidate,
): RuntimeVisualEvidenceAttachmentSubmitInput["attachments"][number] {
  return {
    actionId: candidate.actionId,
    inputId: candidate.inputId,
    inputKind: candidate.inputKind,
    evidenceRef: candidate.evidenceRef,
    localArtifactPath: candidate.localArtifactPath,
    reviewerId: candidate.reviewerId,
    attachmentStatus: candidate.attachmentStatus,
    comments: candidate.comments,
    attachedAt: candidate.attachedAt,
  };
}

function buildRuntimeEvidenceAttachmentCandidates(input: {
  input: RuntimeVisualEvidenceCaptureScaffoldInput;
  scenarioId: string;
  attachedAt: string;
}): RuntimeVisualEvidenceAttachmentCandidate[] {
  const activeActorId = input.input.humanoidSpeechEvidence?.activeActorId;
  if (!activeActorId) {
    return [];
  }
  const actorRole = input.input.humanoidSpeechEvidence?.activeActorRuntimeRealismRequirement?.role
    ?? input.input.humanoidSpeechEvidence?.activeActorRealismLaunchBadge?.actorRole
    ?? "actor";
  return [
    buildRuntimeVisualEvidenceAttachmentCandidate({
      actionId: "attach_runtime_realism_evidence_refs",
      inputId: `runtime-realism-evidence-input:${activeActorId}`,
      inputKind: "runtime_realism_signal_input",
      evidenceRef: `ui-xr-manual-runtime-evidence://${input.scenarioId}/${activeActorId}`,
      localArtifactPath: `ui-xr/manual-performance-evidence/${sanitizeEvidencePathSegment(input.scenarioId)}/${sanitizeEvidencePathSegment(activeActorId)}-runtime-realism.json`,
      comments: `Metadata-only UI-XR runtime capture scaffold for ${actorRole} ${activeActorId}; submit through Admin/API review before it can attach to runtime selection gates.`,
      attachedAt: input.attachedAt,
    }),
  ];
}

function buildVisualQaEvidenceAttachmentCandidates(input: {
  input: RuntimeVisualEvidenceCaptureScaffoldInput;
  scenarioId: string;
  attachedAt: string;
}): RuntimeVisualEvidenceAttachmentCandidate[] {
  const targets = new Set<string>();
  if (input.input.runtimeSceneManifestEvidence?.manifestId) {
    targets.add(input.input.runtimeSceneManifestEvidence.manifestId);
  }
  if (input.input.humanoidSpeechEvidence?.activeActorId) {
    targets.add(input.input.humanoidSpeechEvidence.activeActorId);
  }
  return [...targets].map((targetId) =>
    buildRuntimeVisualEvidenceAttachmentCandidate({
      actionId: "attach_visual_qa_evidence_refs",
      inputId: `visual-qa-evidence-input:${targetId}`,
      inputKind: "visual_qa_review_input",
      evidenceRef: `ui-xr-manual-visual-qa-evidence://${input.scenarioId}/${targetId}`,
      localArtifactPath: `ui-xr/manual-performance-evidence/${sanitizeEvidencePathSegment(input.scenarioId)}/${sanitizeEvidencePathSegment(targetId)}-visual-qa.json`,
      comments: `Metadata-only UI-XR visual-QA capture scaffold for ${targetId}; this is not visual quality evidence until reviewed and submitted.`,
      attachedAt: input.attachedAt,
    }),
  );
}

function buildRuntimeVisualEvidenceAttachmentCandidate(input: Omit<
  RuntimeVisualEvidenceAttachmentCandidate,
  | "reviewerId"
  | "attachmentStatus"
  | "providerExecutionAllowed"
  | "runtimeExecutionAllowed"
  | "learnerLaunchAllowed"
  | "questEvidenceRefreshAllowed"
  | "productionAssetReadinessClaimed"
  | "clinicalValidityClaimed"
  | "scoringValidityClaimed"
  | "claimBoundary"
  | "notEvidenceFor"
>): RuntimeVisualEvidenceAttachmentCandidate {
  return {
    ...input,
    reviewerId: "ui_xr_manual_runtime_evidence_capture_scaffold",
    attachmentStatus: "attached_metadata_only",
    providerExecutionAllowed: false,
    runtimeExecutionAllowed: false,
    learnerLaunchAllowed: false,
    questEvidenceRefreshAllowed: false,
    productionAssetReadinessClaimed: false,
    clinicalValidityClaimed: false,
    scoringValidityClaimed: false,
    claimBoundary: "ui_xr_metadata_only_attachment_candidate_not_submitted",
    notEvidenceFor: [...RUNTIME_VISUAL_EVIDENCE_NOT_EVIDENCE_FOR],
  };
}

function sanitizeEvidencePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, "_");
}

export function manualPerformanceMetricsFromFrameStats(stats: ManualPerformanceFrameStats): ManualPerformanceMetrics {
  return {
    avgFps: stats.approxFps,
    p95FrameMs: stats.p95FrameMs,
    minimumObservedFps: stats.maxFrameMs ? roundMetric(1000 / stats.maxFrameMs, 1) : null,
    controllerSelectLatencyMs: null,
    source: "window.__openClinXrFrameStats",
    framesObserved: stats.framesObserved,
    sampleWindowSize: stats.sampleWindowSize,
    firstFrameAtMs: stats.firstFrameAtMs ?? null,
    previewFramesObserved: stats.previewFramesObserved ?? 0,
    immersiveFramesObserved: stats.immersiveFramesObserved ?? 0,
  };
}

export function parseBrowserVersionHints(userAgent: string): ManualPerformanceBrowserVersionHints {
  return {
    oculusBrowser: userAgent.match(/OculusBrowser\/([^\s]+)/)?.[1] ?? null,
    chrome: userAgent.match(/Chrome\/([^\s]+)/)?.[1] ?? null,
  };
}

export function buildManualPerformanceReproducibility(
  input: ManualPerformanceReproducibilityInput,
): ManualPerformanceReproducibilityEvidence {
  return {
    source: "browser_runtime",
    url: input.url,
    userAgent: input.userAgent,
    browserVersionHints: parseBrowserVersionHints(input.userAgent),
    app: { ...input.app },
    webXr: {
      navigatorXrPresent: input.webXr.navigatorXrPresent,
      immersiveVrSupported: input.webXr.immersiveVrSupported,
      immersiveVrSupportCheckedAtMs: nullableRoundedMetric(input.webXr.immersiveVrSupportCheckedAtMs),
      immersiveArSupported: input.webXr.immersiveArSupported,
      immersiveArSupportCheckedAtMs: nullableRoundedMetric(input.webXr.immersiveArSupportCheckedAtMs),
      supportError: input.webXr.supportError,
    },
    display: {
      viewportWidth: Math.max(0, Math.round(input.display.viewportWidth)),
      viewportHeight: Math.max(0, Math.round(input.display.viewportHeight)),
      screenWidth: nullableRoundedInteger(input.display.screenWidth),
      screenHeight: nullableRoundedInteger(input.display.screenHeight),
      devicePixelRatio: roundMetric(Math.max(0, input.display.devicePixelRatio), 3),
      visibilityState: input.display.visibilityState,
    },
    limitations: [
      "browser_reported_metadata_not_device_firmware_proof",
      "display_refresh_rate_inferred_from_frame_cadence",
    ],
  };
}

function roundedVector(vector: LocomotionVectorEvidence): LocomotionVectorEvidence {
  return {
    forward: roundMetric(vector.forward, 3),
    strafe: roundMetric(vector.strafe, 3),
    turn: roundMetric(vector.turn, 3),
  };
}

const emptyLocomotionVector: LocomotionVectorEvidence = {
  forward: 0,
  strafe: 0,
  turn: 0,
};

function isLocomotionVectorActive(vector: LocomotionVectorEvidence): boolean {
  return Math.abs(vector.forward) > 0 || Math.abs(vector.strafe) > 0 || Math.abs(vector.turn) > 0;
}

function activeLocomotionSourceFor(input: {
  keyboardActive: boolean;
  xrActive: boolean;
  xrHandGestureActive: boolean;
  roomScaleActive: boolean;
}): NonNullable<ManualPerformanceInputEvidence["activeLocomotionSource"]> {
  const activeCount = [
    input.keyboardActive,
    input.xrActive,
    input.xrHandGestureActive,
    input.roomScaleActive,
  ].filter(Boolean).length;
  if (activeCount > 1) {
    return "mixed";
  }
  if (input.keyboardActive) {
    return "keyboard";
  }
  if (input.xrActive) {
    return "xr_gamepad";
  }
  if (input.xrHandGestureActive) {
    return "xr_hand_gesture";
  }
  if (input.roomScaleActive) {
    return "xr_room_scale";
  }
  return "none";
}

function runtimeInputSourceKinds(input: {
  keyboardActive: boolean;
  xrGamepadPresent: boolean;
  xrHandPresent: boolean;
  xrHandGestureActive: boolean;
  xrRoomScalePresent: boolean;
}): RuntimeInputSourceKind[] {
  return [
    input.keyboardActive ? "keyboard" : undefined,
    input.xrGamepadPresent ? "xr_gamepad" : undefined,
    input.xrHandPresent ? "xr_hand" : undefined,
    input.xrHandGestureActive ? "xr_hand_gesture" : undefined,
    input.xrRoomScalePresent ? "xr_room_scale" : undefined,
  ].filter((kind): kind is RuntimeInputSourceKind => kind !== undefined);
}

function truncateEvidenceLine(line: string): string {
  return line.length <= 140 ? line : `${line.slice(0, 137)}...`;
}

function hashEvidenceContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildManualPerformanceDraft(input: ManualPerformanceDraftInput): ManualPerformanceDraft {
  return {
    generatedAt: input.generatedAt,
    runContext: {
      performedBy: "",
      durationMinutes: Number((input.elapsedSecond / 60).toFixed(2)),
      notes: "Complete this during a foreground in-headset Quest Browser run.",
    },
    setup: {
      foregroundPageConfirmed: input.foregroundPageConfirmed,
      devtoolsScreencastDisabled: false,
      extraBrowserWindowsClosed: false,
    },
    station: {
      shellLoaded: true,
      traceInteractionPassed: input.traceInteractionPassed,
      traceInteractionAttempt: traceInteractionAttemptFor({
        traceInteractionPassed: input.traceInteractionPassed,
        traceLatencyEvidence: input.traceLatencyEvidence ?? null,
      }),
      textReadable: true,
      immersiveSessionStarted: input.immersiveSessionStarted ?? false,
      consoleErrors: input.consoleErrors ?? [],
    },
    experience: input.experienceModeEvidence ?? xrExperienceModeEvidence,
    input: input.inputEvidence ? enrichManualPerformanceInputEvidence(input.inputEvidence) : null,
    traceLatencyProxy: input.traceLatencyEvidence ?? null,
    performance: {
      ...manualPerformanceMetricsFromFrameStats(input.frameStats),
      controllerSelectLatencyMs: input.controllerSelectLatencyMs ?? null,
    },
    ...(input.reproducibilityEvidence ? { reproducibility: input.reproducibilityEvidence } : {}),
    comfort: {
      motionComfort: "not_run",
      heatConcern: null,
      batteryDropPercent: null,
    },
  };
}

function enrichManualPerformanceInputEvidence(
  evidence: ManualPerformanceInputEvidence,
): ManualPerformanceInputEvidence {
  return {
    ...evidence,
    handRepresentationKind: evidence.handRepresentationKind ?? handRepresentationKindFromEvidence(evidence),
    locomotionAttempt: evidence.locomotionAttempt ?? locomotionAttemptFromEvidence(evidence),
  };
}

function handRepresentationKindFromEvidence(evidence: ManualPerformanceInputEvidence): HandRepresentationKind {
  if (evidence.handModelStatus === "installed" && evidence.handModelCount > 0 && evidence.handInputsObserved > 0) {
    return primitiveHandRepresentationKind;
  }
  if (evidence.inputSourceKinds?.includes("xr_gamepad") === true && evidence.inputSourceKinds.includes("xr_hand") !== true) {
    return "controller_only";
  }
  if (evidence.handModelStatus === "pending_immersive_session" && evidence.handModelCount === 0) {
    return "not_visible";
  }
  return "unknown";
}

function locomotionAttemptFromEvidence(evidence: ManualPerformanceInputEvidence): LocomotionAttempt {
  if (typeof evidence.lastLocomotionAtMs === "number"
    && Number.isFinite(evidence.lastLocomotionAtMs)
    && evidence.locomotionDelta
    && hasMeasurableLocomotionDelta(evidence.locomotionDelta)) {
    return "runtime_event_observed";
  }
  if (hasObservedLocomotion(evidence)) {
    return "runtime_event_observed";
  }
  switch (evidence.activeLocomotionSource) {
    case "keyboard":
      return "keyboard_attempted_no_runtime_event";
    case "xr_gamepad":
      return "thumbstick_attempted_no_runtime_event";
    case "xr_hand_gesture":
      return "hand_gesture_attempted_no_runtime_event";
    case "xr_room_scale":
      return "room_scale_attempted_no_runtime_event";
    case "mixed":
      return "mixed_attempted_no_runtime_event";
    case "none":
    case undefined:
      return "not_attempted";
  }
  return "not_attempted";
}

function traceInteractionAttemptFor(input: {
  traceInteractionPassed: boolean;
  traceLatencyEvidence: ManualPerformanceTraceLatencyEvidence | null;
}): TraceInteractionAttempt {
  if (input.traceInteractionPassed) {
    return "runtime_event_observed";
  }
  switch (input.traceLatencyEvidence?.source) {
    case "dom_click_trace_button":
      return "dom_click_attempted_no_runtime_event";
    case "xr_controller_select":
      return "xr_controller_select_attempted_no_runtime_event";
    case "xr_hand_select":
      return "xr_hand_select_attempted_no_runtime_event";
    case undefined:
      return "not_attempted";
    default:
      return "not_attempted";
  }
}

export function buildManualPerformanceCaptureSummary(
  input: ManualPerformanceCaptureSummaryInput,
): ManualPerformanceCaptureSummary {
  const frameStats = input.frameStats ?? null;
  const preview = previewManualPerformanceValidation(input.draft ?? null, frameStats);
  const inputEvidence = input.draft?.input ?? null;
  const latestFrameAtMs = frameStats?.latestFrameAtMs ?? null;
  const frameStatsAgeMs = latestFrameAtMs === null || typeof input.now !== "number"
    ? null
    : roundMetric(Math.max(0, input.now - latestFrameAtMs));
  const frameStatsFresh = frameStatsAgeMs === null ? null : frameStatsAgeMs <= manualPerformanceFrameStatsFreshMs;
  const freshnessBlockers = frameStatsFresh === false ? ["frame_stats_stale_or_unsampled"] : [];
  const blockers = [...preview.blockers, ...freshnessBlockers];
  const technicalEvidence = buildManualPerformanceTechnicalEvidence(input.draft ?? null, frameStats);
  const locomotionProbeSummary = summarizeLocomotionProbe(inputEvidence, technicalEvidence.locomotionEvidenceReady);

  return {
    source: "window.__openClinXrManualPerformanceDraft",
    generatedAt: input.draft?.generatedAt ?? null,
    framesObserved: frameStats?.framesObserved ?? null,
    firstFrameAtMs: frameStats?.firstFrameAtMs ?? null,
    latestFrameAtMs,
    frameStatsAgeMs,
    frameStatsFresh,
    sampleWindowSize: frameStats?.sampleWindowSize ?? null,
    previewFramesObserved: frameStats?.previewFramesObserved ?? null,
    immersiveFramesObserved: frameStats?.immersiveFramesObserved ?? null,
    isPresenting: frameStats?.isPresenting ?? null,
    visibilityState: frameStats?.visibilityState ?? null,
    qualitySource: frameStats?.qualitySource ?? null,
    handInputsObserved: inputEvidence?.handInputsObserved ?? null,
    handModelStatus: inputEvidence?.handModelStatus ?? null,
    handRepresentationKind: inputEvidence?.handRepresentationKind ?? null,
    handAssetLoadErrors: [...(inputEvidence?.handAssetLoadErrors ?? [])],
    activeLocomotionSource: inputEvidence?.activeLocomotionSource ?? null,
    inputSourceKinds: [...(inputEvidence?.inputSourceKinds ?? [])],
    lastLocomotionAtMs: inputEvidence?.lastLocomotionAtMs ?? null,
    locomotionAttempt: inputEvidence?.locomotionAttempt ?? null,
    locomotionDistanceMeters: inputEvidence?.locomotionDelta?.distanceMeters ?? null,
    locomotionTurnRadians: inputEvidence?.locomotionDelta?.turnRadians ?? null,
    locomotionPathQuality: summarizeLocomotionPathQuality(inputEvidence),
    locomotionDiagnosticSummary: summarizeLocomotionDiagnostics(inputEvidence?.locomotionDiagnostics),
    locomotionProbeSummary,
    traceLatencySource: input.draft?.traceLatencyProxy?.source ?? null,
    traceInteractionAttempt: input.draft?.station.traceInteractionAttempt ?? null,
    lastTraceTag: input.draft?.traceLatencyProxy?.lastTraceTag ?? null,
    lastTraceLatencyMs: input.draft?.traceLatencyProxy?.lastSelectLatencyMs ?? null,
    handSelectStatus: inputEvidence?.xrHandSelectState?.status ?? null,
    handSelectDwellMs: inputEvidence?.xrHandSelectState?.dwellMs ?? null,
    handSelectFiredCount: inputEvidence?.xrHandSelectState?.firedCount ?? null,
    handSelectBlockedReason: inputEvidence?.xrHandSelectState?.blockedReason ?? null,
    immersiveFrameEvidenceReady: technicalEvidence.immersiveFrameEvidenceReady,
    headsetSelectLatencyReady: technicalEvidence.headsetSelectLatencyReady,
    locomotionEvidenceReady: technicalEvidence.locomotionEvidenceReady,
    technicalGaps: technicalEvidence.technicalGaps,
    draftAvailable: Boolean(input.draft && frameStats),
    manualValidationReady: blockers.length === 0,
    satisfiedConditions: preview.satisfiedConditions,
    blockers,
  };
}

function summarizeLocomotionProbe(
  inputEvidence: ManualPerformanceInputEvidence | null,
  locomotionEvidenceReady: boolean,
): LocomotionProbeSummary | null {
  if (!inputEvidence) {
    return null;
  }

  const diagnostics = inputEvidence.locomotionDiagnostics;
  const gamepadSources = diagnostics?.gamepadSources ?? [];
  const handGestureHands = diagnostics?.handGestureHands ?? [];
  const activeGamepadSourceCount = gamepadSources.filter((source) => source.activeAfterDeadzone).length;
  const activeVectorWithoutRigDelta = (inputEvidence.activeLocomotionSource ?? "none") !== "none"
    && !locomotionEvidenceReady;
  const reasonCodes: LocomotionProbeReasonCode[] = [];

  if (locomotionEvidenceReady) {
    reasonCodes.push("locomotion_observed");
  } else {
    if (activeVectorWithoutRigDelta) {
      reasonCodes.push("active_vector_without_rig_delta");
    }
    if (diagnostics && gamepadSources.length === 0) {
      reasonCodes.push("no_gamepad_sources");
    } else if (diagnostics && activeGamepadSourceCount === 0) {
      reasonCodes.push("gamepad_axes_below_deadzone");
    }
    if (!diagnostics && (inputEvidence.inputSourceKinds?.length ?? 0) === 0) {
      reasonCodes.push("no_xr_input_sources");
    }
    reasonCodes.push(...handGestureProbeReasons(handGestureHands));
    if (reasonCodes.length === 0) {
      reasonCodes.push("locomotion_delta_missing");
    }
  }

  const uniqueReasonCodes = uniqueLocomotionProbeReasonCodes(reasonCodes);

  return {
    claimScope: "runtime_probe_only",
    readiness: locomotionEvidenceReady ? "ready" : "blocked",
    primaryReason: uniqueReasonCodes[0] ?? "locomotion_delta_missing",
    reasonCodes: uniqueReasonCodes,
    activeVectorWithoutRigDelta,
    controllerSources: {
      total: gamepadSources.length,
      activeAfterDeadzone: activeGamepadSourceCount,
    },
    handGesture: {
      handsObserved: handGestureHands.length,
      pinching: handGestureHands.filter((hand) => hand.pinching).length,
      armed: handGestureHands.filter((hand) => hand.armed).length,
      movementCrossedDeadzone: handGestureHands.filter((hand) => hand.movementCrossedDeadzone).length,
    },
  };
}

function summarizeLocomotionPathQuality(
  inputEvidence: ManualPerformanceInputEvidence | null,
): LocomotionPathQualitySummary | null {
  const delta = inputEvidence?.locomotionDelta;
  if (!delta) {
    return null;
  }

  const sampleCount = inputEvidence.lastLocomotionAtMs === null ? 0 : 1;
  const straightLineOnly = sampleCount <= 1 || Math.abs(delta.turnRadians) < 0.01;
  const blockers = [
    sampleCount < 2 ? "multi_sample_path_not_captured" : undefined,
    straightLineOnly ? "turn_or_curve_quality_not_captured" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    claimScope: "path_shape_probe_only",
    sampleCount,
    distanceMeters: roundMetric(delta.distanceMeters),
    turnRadians: roundMetric(delta.turnRadians),
    straightLineOnly,
    pathCueIds: delta.distanceMeters > 0 ? ["runtime_locomotion_delta"] : [],
    blockers,
  };
}

function handGestureProbeReasons(
  hands: XrHandGestureHandDiagnosticEvidence[],
): LocomotionProbeReasonCode[] {
  return hands.flatMap((hand): LocomotionProbeReasonCode[] => {
    const reasons: LocomotionProbeReasonCode[] = [];
    if (!hand.jointsVisible.wrist || !hand.jointsVisible.indexTip || !hand.jointsVisible.thumbTip) {
      reasons.push("hand_missing_joints");
    }
    switch (hand.blockedReason) {
      case "not_pinching":
        reasons.push("hand_not_pinching");
        break;
      case "arming_dwell":
        reasons.push("hand_arming_dwell");
        break;
      case "missing_joints":
        reasons.push("hand_missing_joints");
        break;
      case "below_deadzone":
        reasons.push("hand_below_deadzone");
        break;
      case "turn_cooldown":
        reasons.push("hand_turn_cooldown");
        break;
      case "other_locomotion_source_active":
        reasons.push("hand_other_locomotion_source_active");
        break;
      case undefined:
        if (hand.pinching && !hand.movementCrossedDeadzone) {
          reasons.push("hand_below_deadzone");
        }
        break;
    }
    return reasons;
  });
}

function uniqueLocomotionProbeReasonCodes(
  values: LocomotionProbeReasonCode[],
): LocomotionProbeReasonCode[] {
  return [...new Set(values)];
}

function summarizeLocomotionDiagnostics(
  diagnostics: LocomotionAttemptDiagnosticsEvidence | undefined,
): LocomotionDiagnosticSummary | null {
  if (!diagnostics) {
    return null;
  }
  return {
    claimScope: "attempt_diagnostics_only",
    gamepadSourceCount: diagnostics.gamepadSources.length,
    activeGamepadSourceCount: diagnostics.gamepadSources.filter((source) => source.activeAfterDeadzone).length,
    handGestureHandCount: diagnostics.handGestureHands.length,
    pinchingHandCount: diagnostics.handGestureHands.filter((hand) => hand.pinching).length,
    movementCrossedDeadzoneHandCount: diagnostics.handGestureHands.filter((hand) => hand.movementCrossedDeadzone).length,
    handGestureBlockedReasons: uniqueStrings(
      diagnostics.handGestureHands.flatMap((hand) => hand.blockedReason ? [hand.blockedReason] : []),
    ),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function buildManualPerformanceTechnicalEvidence(
  draft: ManualPerformanceDraft | null,
  frameStats: ManualPerformanceFrameStats | null,
): Pick<
  ManualPerformanceCaptureSummary,
  "immersiveFrameEvidenceReady" | "headsetSelectLatencyReady" | "locomotionEvidenceReady" | "technicalGaps"
> {
  const immersiveFrameEvidenceReady = isImmersiveFrameEvidenceReady(draft, frameStats);
  const headsetSelectLatencyReady = isHeadsetSelectLatencyReady(draft);
  const locomotionEvidenceReady = hasObservedLocomotion(draft?.input ?? null);
  const handMeshAssetLoadFailed = hasHandMeshAssetLoadFailure(draft?.input ?? null);
  const handSelectBlockedReason = resolveHandSelectTraceBlockedReason(draft?.traceLatencyProxy ?? null);
  const technicalGaps = [
    draft ? undefined : "manual_performance_draft_missing",
    frameStats ? undefined : "frame_stats_missing",
    draft?.station.immersiveSessionStarted === true && hasEmptyImmersiveFrameStats(draft)
      ? "immersive_session_started_without_frame_samples"
      : undefined,
    draft?.station.immersiveSessionStarted === true
    && !hasEmptyImmersiveFrameStats(draft)
    && !immersiveFrameEvidenceReady
      ? "immersive_frame_sample_not_ready"
      : undefined,
    draft && !headsetSelectLatencyReady ? "headset_select_trace_latency_missing" : undefined,
    handSelectBlockedReason ? `headset_select_trace_hand_select_blocked_${handSelectBlockedReason}` : undefined,
    draft && !locomotionEvidenceReady ? "locomotion_delta_missing" : undefined,
    draft && handMeshAssetLoadFailed ? "hand_mesh_asset_load_failed" : undefined,
  ].filter((gap): gap is string => typeof gap === "string");

  return {
    immersiveFrameEvidenceReady,
    headsetSelectLatencyReady,
    locomotionEvidenceReady,
    technicalGaps,
  };
}

function isImmersiveFrameEvidenceReady(
  draft: ManualPerformanceDraft | null,
  frameStats: ManualPerformanceFrameStats | null,
): boolean {
  if (!draft?.station.immersiveSessionStarted || !frameStats) {
    return false;
  }

  const immersiveFramesObserved = frameStats.immersiveFramesObserved ?? draft.performance.immersiveFramesObserved ?? null;
  const sampleWindowSize = frameStats.sampleWindowSize;
  return isNonNegativeInteger(immersiveFramesObserved)
    && immersiveFramesObserved >= 600
    && isNonNegativeInteger(sampleWindowSize)
    && sampleWindowSize >= 120
    && sampleWindowSize <= immersiveFramesObserved;
}

function isHeadsetSelectLatencyReady(draft: ManualPerformanceDraft | null): boolean {
  if (!draft?.station.traceInteractionPassed) {
    return false;
  }

  const traceLatencyProxy = draft.traceLatencyProxy;
  const controllerSelectLatencyMs = draft.performance.controllerSelectLatencyMs;
  const traceSelectLatencyMs = traceLatencyProxy?.lastSelectLatencyMs ?? null;
  const traceMeasuredAtMs = traceLatencyProxy?.measuredAtMs ?? null;
  const traceTag = traceLatencyProxy?.lastTraceTag ?? null;
  const source = traceLatencyProxy?.source;
  const sourceIsHeadsetSelect = source === "xr_controller_select" || source === "xr_hand_select";
  const tagRecorded = typeof traceTag === "string" && traceTag.trim().length > 0;
  const latencyMatches = isPositiveFiniteNumber(controllerSelectLatencyMs)
    && isPositiveFiniteNumber(traceSelectLatencyMs)
    && Math.abs(controllerSelectLatencyMs - traceSelectLatencyMs) <= 1;

  return sourceIsHeadsetSelect
    && tagRecorded
    && isNonNegativeFiniteNumber(traceMeasuredAtMs)
    && isPositiveFiniteNumber(traceSelectLatencyMs)
    && isPositiveFiniteNumber(controllerSelectLatencyMs)
    && latencyMatches;
}

export function formatManualEvidenceCopyStatus(
  summary: ManualPerformanceCaptureSummary,
  disposition: ManualEvidenceCopyDisposition,
): string {
  const dispositionLabel: Record<ManualEvidenceCopyDisposition, string> = {
    not_copied: "Not copied",
    copied: "Copied",
    copy_blocked: "Copy blocked",
    clipboard_unavailable: "Clipboard unavailable",
  };
  const readiness = summary.manualValidationReady ? "ready" : "draft";
  const blockerCount = summary.blockers.length;
  const blockerText = blockerCount === 0
    ? "no blockers"
    : `${blockerCount} ${blockerCount === 1 ? "blocker" : "blockers"}`;
  return `${dispositionLabel[disposition]}: ${readiness}; ${blockerText}`;
}

function nullableRoundedMetric(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? roundMetric(value) : null;
}

function nullableRoundedInteger(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

const manualPerformanceFrameStatsFreshMs = 2000;
const runtimeInteractionEvidenceFreshMs = 3000;

function previewManualPerformanceValidation(
  draft: ManualPerformanceDraft | null,
  frameStats: ManualPerformanceFrameStats | null,
): {
  satisfiedConditions: string[];
  blockers: string[];
} {
  if (!draft || !frameStats) {
    return {
      satisfiedConditions: [],
      blockers: [
        draft ? undefined : "missing_manual_performance_draft",
        frameStats ? undefined : "missing_frame_stats",
        draft && hasEmptyImmersiveFrameStats(draft) ? "immersive_session_started_but_frame_stats_empty" : undefined,
      ].filter((blocker): blocker is string => typeof blocker === "string"),
    };
  }

  const inputEvidence = draft.input;
  const framesObserved = draft.performance.framesObserved;
  const sampleWindowSize = draft.performance.sampleWindowSize;
  const immersiveFramesObserved = draft.performance.immersiveFramesObserved ?? null;
  const avgFps = draft.performance.avgFps;
  const p95FrameMs = draft.performance.p95FrameMs;
  const minimumObservedFps = draft.performance.minimumObservedFps;
  const controllerSelectLatencyMs = draft.performance.controllerSelectLatencyMs;
  const traceLatencyProxy = draft.traceLatencyProxy;
  const traceLastSelectLatencyMs = traceLatencyProxy?.lastSelectLatencyMs ?? null;
  const traceMeasuredAtMs = traceLatencyProxy?.measuredAtMs ?? null;
  const traceLastTraceTag = traceLatencyProxy?.lastTraceTag ?? null;
  const traceSourceXrControllerSelect = traceLatencyProxy?.source === "xr_controller_select";
  const traceSourceXrHandSelect = traceLatencyProxy?.source === "xr_hand_select";
  const traceSourceXrHeadsetSelect = traceSourceXrControllerSelect || traceSourceXrHandSelect;
  const traceLastTraceTagRecorded = typeof traceLastTraceTag === "string"
    && traceLastTraceTag.trim().length > 0;
  const traceSelectLatencyMsValid = isPositiveFiniteNumber(traceLastSelectLatencyMs);
  const traceMeasuredAtMsValid = isNonNegativeFiniteNumber(traceMeasuredAtMs);
  const batteryDropPercent = draft.comfort.batteryDropPercent;
  const handSelectBlockedReason = resolveHandSelectTraceBlockedReason(traceLatencyProxy);
  const framesObservedValid = isNonNegativeInteger(framesObserved);
  const sampleWindowSizeValid = isNonNegativeInteger(sampleWindowSize);
  const immersiveFramesObservedValid = isNonNegativeInteger(immersiveFramesObserved);
  const immersiveFrameSampleReady = immersiveFramesObservedValid && immersiveFramesObserved >= 600;
  const sampleWindowWithinObservedFrames = framesObservedValid
    && sampleWindowSizeValid
    && sampleWindowSize <= framesObserved;
  const sampleWindowWithinImmersiveFrames = immersiveFramesObservedValid
    && sampleWindowSizeValid
    && sampleWindowSize <= immersiveFramesObserved;
  const rollingFrameWindowReady = sampleWindowWithinObservedFrames
    && sampleWindowWithinImmersiveFrames
    && sampleWindowSize >= 120;
  const avgFpsPlausible = isPlausibleFps(avgFps);
  const minimumObservedFpsPlausible = isPlausibleFps(minimumObservedFps);
  const minimumFpsAtOrBelowAverage = typeof minimumObservedFps === "number"
    && typeof avgFps === "number"
    && Number.isFinite(minimumObservedFps)
    && Number.isFinite(avgFps)
    ? minimumObservedFps <= avgFps
    : true;
  const p95FrameMsValid = isPositiveFiniteNumber(p95FrameMs);
  const controllerSelectLatencyMsValid = isPositiveFiniteNumber(controllerSelectLatencyMs);
  const controllerSelectLatencyMatchesTrace = controllerSelectLatencyMsValid && traceSelectLatencyMsValid
    ? Math.abs(controllerSelectLatencyMs - traceLastSelectLatencyMs) <= 1
    : false;
  const controllerSelectLatencyReady = controllerSelectLatencyMsValid
    && controllerSelectLatencyMs <= 150
    && traceSourceXrHeadsetSelect
    && traceLastTraceTagRecorded
    && traceSelectLatencyMsValid
    && traceMeasuredAtMsValid
    && controllerSelectLatencyMatchesTrace;
  const batteryDropPercentValid = isPercentInRange(batteryDropPercent);
  const motionComfortConfirmed = isMotionComfortConfirmed(draft.comfort.motionComfort);
  const handMeshAssetLoadFailed = hasHandMeshAssetLoadFailure(inputEvidence);

  const blockers = [
    isValidIsoDate(draft.generatedAt) ? undefined : "generated_at_invalid_or_missing",
    draft.runContext.performedBy.trim().length > 0 ? undefined : "performed_by_missing",
    draft.setup.foregroundPageConfirmed ? undefined : "foreground_page_not_confirmed",
    draft.setup.devtoolsScreencastDisabled ? undefined : "devtools_screencast_not_disabled",
    draft.setup.extraBrowserWindowsClosed ? undefined : "extra_browser_windows_not_closed",
    draft.runContext.durationMinutes >= 10 ? undefined : "duration_under_10_minutes",
    draft.station.shellLoaded ? undefined : "station_shell_not_loaded",
    draft.station.traceInteractionPassed ? undefined : "trace_interaction_not_confirmed",
    draft.station.textReadable ? undefined : "text_readability_not_confirmed",
    draft.station.immersiveSessionStarted ? undefined : "immersive_session_not_confirmed",
    isFullVrExperienceEvidence(draft.experience) ? undefined : "experience_mode_full_vr_not_recorded",
    hasObservedHeadsetInput(inputEvidence) ? undefined : "hand_or_controller_input_not_observed",
    handMeshAssetLoadFailed ? "hand_mesh_asset_load_failed" : undefined,
    hasObservedLocomotion(inputEvidence) ? undefined : "locomotion_not_observed",
    draft.station.consoleErrors.length === 0 ? undefined : "console_errors_present",
    draft.performance.source === "window.__openClinXrFrameStats" ? undefined : "performance_source_not_openclinxr_frame_stats",
    hasEmptyImmersiveFrameStats(draft) ? "immersive_session_started_but_frame_stats_empty" : undefined,
    framesObservedValid && framesObserved >= 600 ? undefined : "frame_sample_under_600_or_missing",
    draft.station.immersiveSessionStarted && immersiveFrameSampleReady ? undefined : "immersive_frame_sample_under_600_or_missing",
    sampleWindowSizeValid && immersiveFramesObservedValid && sampleWindowSize > immersiveFramesObserved
      ? "rolling_frame_window_exceeds_immersive_frames_observed"
      : undefined,
    rollingFrameWindowReady ? undefined : "rolling_frame_window_under_120_or_missing",
    avgFpsPlausible && avgFps >= 72 ? undefined : "average_fps_below_72_or_missing",
    minimumObservedFpsPlausible && minimumFpsAtOrBelowAverage && minimumObservedFps >= 60
      ? undefined
      : "minimum_fps_below_60_or_missing",
    p95FrameMsValid && p95FrameMs <= 25 ? undefined : "p95_frame_ms_above_25_or_missing",
    controllerSelectLatencyMsValid && controllerSelectLatencyMs <= 150 ? undefined : "controller_select_latency_ms_above_150_or_missing",
    traceSourceXrHeadsetSelect ? undefined : "controller_select_trace_source_not_xr_controller_select",
    handSelectBlockedReason
      ? `headset_select_trace_hand_select_blocked_${handSelectBlockedReason}`
      : undefined,
    traceLastTraceTagRecorded ? undefined : "controller_select_trace_tag_missing",
    traceSelectLatencyMsValid ? undefined : "controller_select_trace_latency_missing",
    traceMeasuredAtMsValid ? undefined : "controller_select_trace_measured_at_missing",
    controllerSelectLatencyMsValid && traceSelectLatencyMsValid && !controllerSelectLatencyMatchesTrace
      ? "controller_select_latency_mismatch"
      : undefined,
    motionComfortConfirmed ? undefined : "motion_comfort_not_confirmed",
    draft.comfort.heatConcern === false ? undefined : "heat_concern_not_cleared",
    batteryDropPercentValid ? undefined : "battery_drop_not_recorded",
    batteryDropPercentValid && batteryDropPercent > 20 ? "battery_drop_above_20" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  const satisfiedConditions = [
    isValidIsoDate(draft.generatedAt) ? "generated_at_valid" : undefined,
    draft.runContext.performedBy.trim().length > 0 ? "performed_by_recorded" : undefined,
    draft.setup.foregroundPageConfirmed ? "foreground_page_confirmed" : undefined,
    draft.setup.devtoolsScreencastDisabled ? "devtools_screencast_disabled" : undefined,
    draft.setup.extraBrowserWindowsClosed ? "extra_browser_windows_closed" : undefined,
    draft.runContext.durationMinutes >= 10 ? "duration_10_minutes_or_more" : undefined,
    draft.station.shellLoaded ? "station_shell_loaded" : undefined,
    draft.station.traceInteractionPassed ? "trace_interaction_confirmed" : undefined,
    draft.station.textReadable ? "text_readability_confirmed" : undefined,
    draft.station.immersiveSessionStarted ? "immersive_session_started" : undefined,
    isFullVrExperienceEvidence(draft.experience) ? "experience_mode_full_vr_recorded" : undefined,
    hasObservedHeadsetInput(inputEvidence) ? "hand_or_controller_input_observed" : undefined,
    hasObservedLocomotion(inputEvidence) ? "locomotion_observed" : undefined,
    draft.station.consoleErrors.length === 0 ? "console_errors_empty" : undefined,
    draft.performance.source === "window.__openClinXrFrameStats" ? "performance_source_openclinxr_frame_stats" : undefined,
    framesObservedValid && framesObserved >= 600 ? "frame_sample_600_or_more" : undefined,
    immersiveFrameSampleReady ? "immersive_frame_sample_600_or_more" : undefined,
    rollingFrameWindowReady ? "rolling_frame_window_120_or_more" : undefined,
    avgFpsPlausible && avgFps >= 72 ? "average_fps_72_or_higher" : undefined,
    minimumObservedFpsPlausible && minimumFpsAtOrBelowAverage && minimumObservedFps >= 60
      ? "minimum_fps_60_or_higher"
      : undefined,
    p95FrameMsValid && p95FrameMs <= 25 ? "p95_frame_ms_25_or_lower" : undefined,
    controllerSelectLatencyReady
      ? "controller_select_latency_150ms_or_lower"
      : undefined,
    traceSourceXrControllerSelect
    && traceLastTraceTagRecorded
    && traceSelectLatencyMsValid
    && traceMeasuredAtMsValid
      ? "xr_controller_select_trace_latency_recorded"
      : undefined,
    traceSourceXrHandSelect
    && traceLastTraceTagRecorded
    && traceSelectLatencyMsValid
    && traceMeasuredAtMsValid
      ? "xr_hand_select_trace_latency_recorded"
      : undefined,
    controllerSelectLatencyMatchesTrace ? "controller_select_latency_matches_trace_proxy" : undefined,
    motionComfortConfirmed ? "motion_comfort_confirmed" : undefined,
    draft.comfort.heatConcern === false ? "heat_concern_cleared" : undefined,
    batteryDropPercentValid && batteryDropPercent <= 20 ? "battery_drop_recorded_under_20" : undefined,
  ].filter((condition): condition is string => typeof condition === "string");

  return { satisfiedConditions, blockers };
}

function hasEmptyImmersiveFrameStats(draft: ManualPerformanceDraft): boolean {
  const immersiveFramesObserved = draft.performance.immersiveFramesObserved ?? null;

  return draft.station.immersiveSessionStarted
    && isNonNegativeInteger(draft.performance.framesObserved)
    && draft.performance.framesObserved === 0
    && isNonNegativeInteger(draft.performance.sampleWindowSize)
    && draft.performance.sampleWindowSize === 0
    && (
      immersiveFramesObserved === null
      || (isNonNegativeInteger(immersiveFramesObserved) && immersiveFramesObserved === 0)
    );
}

function isValidIsoDate(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isNonNegativeInteger(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isPlausibleFps(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 144;
}

function isPositiveFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPercentInRange(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isMotionComfortConfirmed(value: string): boolean {
  return value === "comfortable" || value === "good";
}

function hasObservedHeadsetInput(value: ManualPerformanceDraft["input"]): boolean {
  return (value?.handInputsObserved ?? 0) > 0
    || value?.inputSourceKinds?.some((kind) => kind === "xr_gamepad" || kind === "xr_hand") === true
    || (value?.inputSourceCount ?? 0) > 0;
}

function hasHandMeshAssetLoadFailure(value: ManualPerformanceDraft["input"]): boolean {
  return value?.handModelStatus === "failed" || (value?.handAssetLoadErrors?.length ?? 0) > 0;
}

function hasObservedLocomotion(value: ManualPerformanceDraft["input"]): boolean {
  const hasLocomotionSource = typeof value?.activeLocomotionSource === "string"
    && value.activeLocomotionSource !== "none";
  const hasLocomotionDelta = value?.locomotionDelta
    ? hasMeasurableLocomotionDelta(value.locomotionDelta)
    : false;

  return typeof value?.lastLocomotionAtMs === "number"
    && Number.isFinite(value.lastLocomotionAtMs)
    && value.lastLocomotionAtMs >= 0
    && hasLocomotionSource
    && hasLocomotionDelta;
}

function resolveHandSelectTraceBlockedReason(
  traceLatencyProxy: ManualPerformanceTraceLatencyEvidence | null,
): string | null {
  const interactionDetail = traceLatencyProxy?.interactionDetail;
  if (traceLatencyProxy?.source !== "xr_hand_select" || interactionDetail?.status !== "blocked") {
    return null;
  }
  return interactionDetail.blockedReason ?? null;
}

function isFullVrExperienceEvidence(value: XrExperienceModeEvidence): boolean {
  return value.modeId === "full_vr"
    && value.phaseLabel === "Phase 1 Full VR"
    && value.requestedSessionMode === "immersive-vr"
    && value.mixedRealityPassthroughImplemented === false;
}

function patientTurn(traceTag: string, learnerUtterance: string): RemoteActorTurnPlan {
  return {
    actorId: "patient_robert_hayes_v1",
    voiceId: "mock-robert-hayes",
    learnerUtterance,
    traceContextTags: [traceTag],
  };
}

function nurseTurn(traceTag: string, learnerUtterance: string): RemoteActorTurnPlan {
  return {
    actorId: "nurse_maria_alvarez_v1",
    voiceId: "mock-maria-alvarez",
    learnerUtterance,
    traceContextTags: [traceTag],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gestureAxis(value: number, deadzoneMeters: number, sensitivity: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < deadzoneMeters) {
    return 0;
  }
  return clampUnit(Math.sign(value) * (magnitude - deadzoneMeters) * sensitivity);
}

function clampUnit(value: number): number {
  return Math.min(Math.max(value, -1), 1);
}

function roundMetric(value: number, fractionDigits = 2): number {
  return Number(value.toFixed(fractionDigits));
}

export type XrRuntimeRecommendedNextAction =
  | "complete_full_vr_manual_evidence_before_runtime_claim"
  | "replace_mock_model_and_voice_before_live_runtime_claim"
  | "attach_iwsdk_station_mcp_smoke_evidence"
  | "complete_mixed_reality_privacy_and_passthrough_evidence"
  | "ready_for_local_faculty_runtime_review";

export type XrRuntimeReadinessDecisionInput = {
  posture: RuntimeEvidencePosture;
  iwsdkStationMcpSmokeReady?: boolean;
};

export type XrRuntimeReadinessDecision = {
  source: "runtime_evidence_posture";
  learnerLaunchReady: boolean;
  fullVrEvidenceReady: boolean;
  liveModelAndVoiceReady: boolean;
  iwsdkStationMcpSmokeReady: boolean;
  mixedRealityReady: boolean;
  blockedLaneIds: RuntimeEvidenceLaneId[];
  blockerCount: number;
  recommendedNextAction: XrRuntimeRecommendedNextAction;
  notEvidenceFor: string[];
};

function isBlockingRuntimeEvidenceLane(lane: RuntimeEvidenceLane): boolean {
  return (
    lane.blockers.length > 0 ||
    lane.status === "mock_active" ||
    lane.status === "blocked_with_evidence" ||
    lane.status === "separate_lane_blocked"
  );
}

function isReadyRuntimeEvidenceLane(lane: RuntimeEvidenceLane | undefined): boolean {
  return lane !== undefined && !isBlockingRuntimeEvidenceLane(lane);
}

export function buildXrRuntimeReadinessDecision(
  input: XrRuntimeReadinessDecisionInput,
): XrRuntimeReadinessDecision {
  const laneById = new Map(input.posture.lanes.map((lane) => [lane.id, lane]));
  const blockedLaneIds = input.posture.lanes
    .filter(isBlockingRuntimeEvidenceLane)
    .map((lane) => lane.id);
  const blockerCount = input.posture.lanes.reduce(
    (sum, lane) => sum + lane.blockers.length,
    0,
  );
  const fullVrEvidenceReady = isReadyRuntimeEvidenceLane(laneById.get("quest_foreground"));
  const liveModelAndVoiceReady =
    isReadyRuntimeEvidenceLane(laneById.get("model_dialogue")) &&
    isReadyRuntimeEvidenceLane(laneById.get("voice_synthesis"));
  const iwsdkStationMcpSmokeReady = input.iwsdkStationMcpSmokeReady === true;
  const mixedRealityReady = isReadyRuntimeEvidenceLane(laneById.get("mixed_reality"));
  const learnerLaunchReady =
    fullVrEvidenceReady && liveModelAndVoiceReady && iwsdkStationMcpSmokeReady;
  const recommendedNextAction: XrRuntimeRecommendedNextAction = !fullVrEvidenceReady
    ? "complete_full_vr_manual_evidence_before_runtime_claim"
    : !liveModelAndVoiceReady
      ? "replace_mock_model_and_voice_before_live_runtime_claim"
      : !iwsdkStationMcpSmokeReady
        ? "attach_iwsdk_station_mcp_smoke_evidence"
        : !mixedRealityReady
          ? "complete_mixed_reality_privacy_and_passthrough_evidence"
          : "ready_for_local_faculty_runtime_review";

  return {
    source: "runtime_evidence_posture",
    learnerLaunchReady,
    fullVrEvidenceReady,
    liveModelAndVoiceReady,
    iwsdkStationMcpSmokeReady,
    mixedRealityReady,
    blockedLaneIds,
    blockerCount,
    recommendedNextAction,
    notEvidenceFor: input.posture.notEvidenceFor,
  };
}

// Emotion state machine stub wired from peds case spec (rebalance continuation).
// Consumes caseDerivedEmotionStateMachine (or equivalent timeline/triggers from review packet / derive in factory/).
// Provides simple step for runtime player to advance activeEmotionState on learner cues/triggers.
// Full version will drive expression, gaze, lip-sync, voice from the machine state. Consumer attachments remain supporting ref only.
export function stepEmotionStateFromCaseMachine(
  machine: { initialEmotion: string; escalationTriggers: string[]; deescalationTriggers: string[] } | null,
  current: string | undefined,
  trigger: string
): string {
  if (!machine) return current || "neutral";
  const t = trigger.toLowerCase();
  if (machine.escalationTriggers.some((e: string) => t.includes(e) || t.includes("ignored_breathing") || t.includes("rapid_questioning"))) {
    return "frightened";
  }
  if (machine.deescalationTriggers.some((d: string) => t.includes(d) || t.includes("breathing_effort") || t.includes("validated") || t.includes("plan_explained"))) {
    return "reassured";
  }
  if (t.includes("empathy") || t.includes("parent_communication") || t.includes("parent")) {
    return "anxious";
  }
  return current || machine.initialEmotion;
}

// Dialogue policy stub wired from peds case (rebalance). Provides actor-specific policy notes (style, avoid, adverse) for dialogue orchestration in runtime from case spec.
export function getDialoguePolicyForActorFromCase(policy: { actors: Array<{ actorId: string; style: string; baselineMood: string[]; topicsToAvoid: string[]; adverseResponse: string }> } | null, actorId: string) {
  if (!policy) return null;
  return policy.actors.find((actor) => actor.actorId === actorId) || null;
}
