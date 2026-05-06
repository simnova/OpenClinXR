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

export type LocomotionVectorEvidence = {
  forward: number;
  strafe: number;
  turn: number;
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
  locomotionDiagnosticSummary: LocomotionDiagnosticSummary | null;
  locomotionProbeSummary: LocomotionProbeSummary | null;
  traceLatencySource: ManualPerformanceTraceLatencyEvidence["source"] | null;
  traceInteractionAttempt: TraceInteractionAttempt | null;
  lastTraceTag: string | null;
  lastTraceLatencyMs: number | null;
  immersiveFrameEvidenceReady: boolean;
  headsetSelectLatencyReady: boolean;
  locomotionEvidenceReady: boolean;
  technicalGaps: string[];
  draftAvailable: boolean;
  manualValidationReady: boolean;
  satisfiedConditions: string[];
  blockers: string[];
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
  bed: "openclinxr.ed-chest-pain.bed",
  monitor: "openclinxr.ed-chest-pain.monitor",
  patientRobertHayes: "openclinxr.ed-chest-pain.patient-robert-hayes",
  nurseMariaAlvarez: "openclinxr.ed-chest-pain.nurse-maria-alvarez",
  spouseAnnaHayes: "openclinxr.ed-chest-pain.spouse-anna-hayes",
  wallClock: "openclinxr.ed-chest-pain.wall-clock",
  clinicalPanel: "openclinxr.ed-chest-pain.in-vr-clinical-panel",
  dialoguePanel: "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
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

export function formatStationClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
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
  const missingTraceTags = state.requiredTraceTags.filter((tag) => !observed.has(tag));
  return {
    observedCount: state.completedTraceTags.length,
    missingCount: missingTraceTags.length,
    missingTraceTags,
  };
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
  return eventTypes[tag] ?? "learner.action";
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
  }
  return "not_attempted";
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
    locomotionDiagnosticSummary: summarizeLocomotionDiagnostics(inputEvidence?.locomotionDiagnostics),
    locomotionProbeSummary,
    traceLatencySource: input.draft?.traceLatencyProxy?.source ?? null,
    traceInteractionAttempt: input.draft?.station.traceInteractionAttempt ?? null,
    lastTraceTag: input.draft?.traceLatencyProxy?.lastTraceTag ?? null,
    lastTraceLatencyMs: input.draft?.traceLatencyProxy?.lastSelectLatencyMs ?? null,
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

function roundMetric(value: number, fractionDigits = 2): number {
  return Number(value.toFixed(fractionDigits));
}
