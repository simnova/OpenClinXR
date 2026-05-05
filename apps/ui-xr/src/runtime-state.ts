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

export type ManualPerformanceInputEvidence = {
  handModelCount: number;
  handModelStatus: "pending_immersive_session" | "installed" | "failed";
  handInputsObserved: number;
  locomotionMode: "experimental_keyboard_and_thumbstick_dolly";
  lastInputObservedAtMs?: number | null;
  lastLocomotionAtMs: number | null;
  activeLocomotionSource?: "none" | "keyboard" | "xr_gamepad" | "xr_hand_gesture" | "mixed";
  inputSourceCount?: number;
  inputSourceKinds?: RuntimeInputSourceKind[];
  keyboardVector?: LocomotionVectorEvidence;
  xrVector?: LocomotionVectorEvidence;
  xrHandGestureVector?: LocomotionVectorEvidence;
  xrInputSources?: XrInputSourceEvidence[];
  rigPosition: { x: number; z: number };
};

export type RuntimeInputSourceKind = "keyboard" | "xr_gamepad" | "xr_hand" | "xr_hand_gesture";

export type LocomotionVectorEvidence = {
  forward: number;
  strafe: number;
  turn: number;
};

export type XrInputSourceEvidence = {
  handedness: string;
  hasHand: boolean;
  hasGamepad: boolean;
  axisCount: number;
};

export type ManualPerformanceInputEvidenceInput = {
  handModelCount: number;
  handModelStatus: ManualPerformanceInputEvidence["handModelStatus"];
  handInputsObserved: number;
  keyboardVector: LocomotionVectorEvidence;
  xrVector: LocomotionVectorEvidence;
  xrHandGestureVector?: LocomotionVectorEvidence;
  xrInputSources: XrInputSourceEvidence[];
  now: number;
  previousLastInputObservedAtMs: number | null;
  previousLastLocomotionAtMs: number | null;
  rigPosition: { x: number; z: number };
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
  source: "dom_click_trace_button" | "xr_controller_select";
  measuredAtMs: number | null;
  productionControllerLatencySubstitute: false;
};

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
    textReadable: true;
    immersiveSessionStarted: boolean;
    consoleErrors: string[];
  };
  experience: XrExperienceModeEvidence;
  input: ManualPerformanceInputEvidence | null;
  traceLatencyProxy: ManualPerformanceTraceLatencyEvidence | null;
  performance: ManualPerformanceMetrics;
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
  sampleWindowSize: number | null;
  previewFramesObserved: number | null;
  immersiveFramesObserved: number | null;
  isPresenting: boolean | null;
  visibilityState: string | null;
  qualitySource: ManualPerformanceFrameStats["qualitySource"] | null;
  handInputsObserved: number | null;
  activeLocomotionSource: ManualPerformanceInputEvidence["activeLocomotionSource"] | null;
  inputSourceKinds: RuntimeInputSourceKind[];
  lastLocomotionAtMs: number | null;
  traceLatencySource: ManualPerformanceTraceLatencyEvidence["source"] | null;
  lastTraceTag: string | null;
  lastTraceLatencyMs: number | null;
  draftAvailable: boolean;
  manualValidationReady: boolean;
  satisfiedConditions: string[];
  blockers: string[];
};

export type ManualPerformanceCaptureSummaryInput = {
  draft?: ManualPerformanceDraft | null | undefined;
  frameStats?: ManualPerformanceFrameStats | null | undefined;
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
  handTrackingPosture: "optional_feature_with_primitive_hand_model";
  locomotionPosture: "experimental_keyboard_and_thumbstick_dolly";
};

export type MixedRealityExperienceModeEvidence = {
  modeId: "mixed_reality_passthrough";
  phaseLabel: "Phase 1 Mixed Reality";
  requestedSessionMode: "immersive-ar";
  mixedRealityPassthroughImplemented: true;
  handTrackingPosture: "optional_feature_with_primitive_hand_model";
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
  handTrackingPosture: "optional_feature_with_primitive_hand_model",
  locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
};

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
  const xrHandGestureVector = roundedVector(input.xrHandGestureVector ?? emptyLocomotionVector);
  const keyboardActive = isLocomotionVectorActive(keyboardVector);
  const xrActive = isLocomotionVectorActive(xrVector);
  const xrHandGestureActive = isLocomotionVectorActive(xrHandGestureVector);
  const inputObserved = keyboardActive
    || xrActive
    || xrHandGestureActive
    || input.handInputsObserved > 0
    || input.xrInputSources.length > 0;
  const activeLocomotionSource = activeLocomotionSourceFor({
    keyboardActive,
    xrActive,
    xrHandGestureActive,
  });
  const inputSourceKinds = runtimeInputSourceKinds({
    keyboardActive,
    xrGamepadPresent: xrActive || input.xrInputSources.some((source) => source.hasGamepad),
    xrHandPresent: input.handInputsObserved > 0 || input.xrInputSources.some((source) => source.hasHand),
    xrHandGestureActive,
  });

  return {
    handModelCount: input.handModelCount,
    handModelStatus: input.handModelStatus,
    handInputsObserved: input.handInputsObserved,
    locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
    lastInputObservedAtMs: inputObserved ? roundMetric(input.now) : input.previousLastInputObservedAtMs,
    lastLocomotionAtMs: keyboardActive || xrActive || xrHandGestureActive
      ? roundMetric(input.now)
      : input.previousLastLocomotionAtMs,
    activeLocomotionSource,
    inputSourceCount: input.xrInputSources.length,
    inputSourceKinds,
    keyboardVector,
    xrVector,
    xrHandGestureVector,
    xrInputSources: input.xrInputSources.map((source) => ({ ...source })),
    rigPosition: {
      x: roundMetric(input.rigPosition.x, 3),
      z: roundMetric(input.rigPosition.z, 3),
    },
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
}): NonNullable<ManualPerformanceInputEvidence["activeLocomotionSource"]> {
  const activeCount = [input.keyboardActive, input.xrActive, input.xrHandGestureActive].filter(Boolean).length;
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
  return "none";
}

function runtimeInputSourceKinds(input: {
  keyboardActive: boolean;
  xrGamepadPresent: boolean;
  xrHandPresent: boolean;
  xrHandGestureActive: boolean;
}): RuntimeInputSourceKind[] {
  return [
    input.keyboardActive ? "keyboard" : undefined,
    input.xrGamepadPresent ? "xr_gamepad" : undefined,
    input.xrHandPresent ? "xr_hand" : undefined,
    input.xrHandGestureActive ? "xr_hand_gesture" : undefined,
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
      textReadable: true,
      immersiveSessionStarted: input.immersiveSessionStarted ?? false,
      consoleErrors: input.consoleErrors ?? [],
    },
    experience: input.experienceModeEvidence ?? xrExperienceModeEvidence,
    input: input.inputEvidence ?? null,
    traceLatencyProxy: input.traceLatencyEvidence ?? null,
    performance: {
      ...manualPerformanceMetricsFromFrameStats(input.frameStats),
      controllerSelectLatencyMs: input.controllerSelectLatencyMs ?? null,
    },
    comfort: {
      motionComfort: "not_run",
      heatConcern: null,
      batteryDropPercent: null,
    },
  };
}

export function buildManualPerformanceCaptureSummary(
  input: ManualPerformanceCaptureSummaryInput,
): ManualPerformanceCaptureSummary {
  const frameStats = input.frameStats ?? null;
  const preview = previewManualPerformanceValidation(input.draft ?? null, frameStats);
  const inputEvidence = input.draft?.input ?? null;

  return {
    source: "window.__openClinXrManualPerformanceDraft",
    generatedAt: input.draft?.generatedAt ?? null,
    framesObserved: frameStats?.framesObserved ?? null,
    firstFrameAtMs: frameStats?.firstFrameAtMs ?? null,
    sampleWindowSize: frameStats?.sampleWindowSize ?? null,
    previewFramesObserved: frameStats?.previewFramesObserved ?? null,
    immersiveFramesObserved: frameStats?.immersiveFramesObserved ?? null,
    isPresenting: frameStats?.isPresenting ?? null,
    visibilityState: frameStats?.visibilityState ?? null,
    qualitySource: frameStats?.qualitySource ?? null,
    handInputsObserved: inputEvidence?.handInputsObserved ?? null,
    activeLocomotionSource: inputEvidence?.activeLocomotionSource ?? null,
    inputSourceKinds: [...(inputEvidence?.inputSourceKinds ?? [])],
    lastLocomotionAtMs: inputEvidence?.lastLocomotionAtMs ?? null,
    traceLatencySource: input.draft?.traceLatencyProxy?.source ?? null,
    lastTraceTag: input.draft?.traceLatencyProxy?.lastTraceTag ?? null,
    lastTraceLatencyMs: input.draft?.traceLatencyProxy?.lastSelectLatencyMs ?? null,
    draftAvailable: Boolean(input.draft && frameStats),
    manualValidationReady: preview.blockers.length === 0,
    satisfiedConditions: preview.satisfiedConditions,
    blockers: preview.blockers,
  };
}

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
      ].filter((blocker): blocker is string => typeof blocker === "string"),
    };
  }

  const inputEvidence = draft.input;
  const framesObserved = draft.performance.framesObserved;
  const sampleWindowSize = draft.performance.sampleWindowSize;
  const avgFps = draft.performance.avgFps;
  const p95FrameMs = draft.performance.p95FrameMs;
  const minimumObservedFps = draft.performance.minimumObservedFps;
  const controllerSelectLatencyMs = draft.performance.controllerSelectLatencyMs;
  const batteryDropPercent = draft.comfort.batteryDropPercent;
  const framesObservedValid = isNonNegativeInteger(framesObserved);
  const sampleWindowSizeValid = isNonNegativeInteger(sampleWindowSize);
  const sampleWindowWithinObservedFrames = framesObservedValid
    && sampleWindowSizeValid
    && sampleWindowSize <= framesObserved;
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
  const batteryDropPercentValid = isPercentInRange(batteryDropPercent);
  const motionComfortConfirmed = isMotionComfortConfirmed(draft.comfort.motionComfort);

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
    hasObservedLocomotion(inputEvidence) ? undefined : "locomotion_not_observed",
    draft.station.consoleErrors.length === 0 ? undefined : "console_errors_present",
    draft.performance.source === "window.__openClinXrFrameStats" ? undefined : "performance_source_not_openclinxr_frame_stats",
    framesObservedValid && framesObserved >= 600 ? undefined : "frame_sample_under_600_or_missing",
    sampleWindowWithinObservedFrames && sampleWindowSize >= 120 ? undefined : "rolling_frame_window_under_120_or_missing",
    avgFpsPlausible && avgFps >= 72 ? undefined : "average_fps_below_72_or_missing",
    minimumObservedFpsPlausible && minimumFpsAtOrBelowAverage && minimumObservedFps >= 60
      ? undefined
      : "minimum_fps_below_60_or_missing",
    p95FrameMsValid && p95FrameMs <= 25 ? undefined : "p95_frame_ms_above_25_or_missing",
    controllerSelectLatencyMsValid && controllerSelectLatencyMs <= 150
      ? undefined
      : "controller_select_latency_ms_above_150_or_missing",
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
    sampleWindowWithinObservedFrames && sampleWindowSize >= 120 ? "rolling_frame_window_120_or_more" : undefined,
    avgFpsPlausible && avgFps >= 72 ? "average_fps_72_or_higher" : undefined,
    minimumObservedFpsPlausible && minimumFpsAtOrBelowAverage && minimumObservedFps >= 60
      ? "minimum_fps_60_or_higher"
      : undefined,
    p95FrameMsValid && p95FrameMs <= 25 ? "p95_frame_ms_25_or_lower" : undefined,
    controllerSelectLatencyMsValid && controllerSelectLatencyMs <= 150
      ? "controller_select_latency_150ms_or_lower"
      : undefined,
    motionComfortConfirmed ? "motion_comfort_confirmed" : undefined,
    draft.comfort.heatConcern === false ? "heat_concern_cleared" : undefined,
    batteryDropPercentValid && batteryDropPercent <= 20 ? "battery_drop_recorded_under_20" : undefined,
  ].filter((condition): condition is string => typeof condition === "string");

  return { satisfiedConditions, blockers };
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

function hasObservedLocomotion(value: ManualPerformanceDraft["input"]): boolean {
  return typeof value?.lastLocomotionAtMs === "number"
    && Number.isFinite(value.lastLocomotionAtMs)
    && value.lastLocomotionAtMs >= 0;
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
