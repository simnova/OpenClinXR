import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { buildIwsdkUiXrStationParityContract, type IwsdkSpikeMetrics } from "@openclinxr/iwsdk-spike";

export type IwsdkSidecarRuntimeState = {
  scenarioId: string;
  title: string;
  elapsedSecond: number;
  requiredTraceTags: string[];
  completedTraceTags: string[];
};

export type IwsdkSidecarReadinessSummary = {
  observedCount: number;
  missingCount: number;
  missingTraceTags: string[];
};

export type IwsdkSidecarRuntimeEvidence = {
  scenarioId: string;
  sidecar: "apps/ui-xr-iwsdk-spike";
  iwsdkCoreExportCount: number;
  iwsdkXrInputExportCount: number;
  phaseLabel: "Phase 1 Full VR";
  requestedSessionMode: "immersive-vr";
  mixedRealityPassthroughImplemented: false;
  handTrackingPosture: "optional_feature_with_primitive_hand_model";
  locomotionPosture: "experimental_keyboard_and_thumbstick_dolly";
  requiredSceneObjectNames: string[];
  traceActionTags: string[];
};

export type IwsdkSidecarXrSessionMode = "immersive-vr" | "immersive-ar";

export type IwsdkSidecarXrEntryStatus =
  | "not_requested"
  | "unsupported"
  | "requesting"
  | "started"
  | "ended"
  | "failed";

export type IwsdkSidecarXrEntryOutcome =
  | "not_requested"
  | "unsupported"
  | "request_in_flight"
  | "session_started"
  | "session_ended"
  | "activation_required"
  | "request_failed";

export type IwsdkSidecarXrEntryEvidence = {
  sessionMode: IwsdkSidecarXrSessionMode;
  autoAttemptEnabled: boolean;
  attempts: number;
  lastStatus: IwsdkSidecarXrEntryStatus;
  lastOutcome: IwsdkSidecarXrEntryOutcome;
  lastRequestedAtMs: number | null;
  lastUpdatedAtMs: number;
  lastError: string | null;
};

export type IwsdkSidecarFrameDeltaSummary = {
  sampleCount: number;
  avgFrameMs: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  approxFps: number | null;
};

export const iwsdkSidecarPrimitiveHandModelProfile = "spheres" as const;
export const iwsdkSidecarHandRepresentationKind = "primitive_spheres" as const;

export type IwsdkSidecarFrameQualitySource = "webxr_animation_loop" | "flat_preview_fallback";

export type IwsdkSidecarFrameStats = IwsdkSidecarFrameDeltaSummary & {
  framesObserved: number;
  latestFrameAtMs: number | null;
  sampleWindowSize: number;
  previewFramesObserved: number;
  immersiveFramesObserved: number;
  qualitySource: IwsdkSidecarFrameQualitySource;
  isPresenting: boolean;
  visibilityState: string;
};

export type IwsdkSidecarLocalMetricsEvidenceInput = {
  installedNodeModulesMb: number;
  injectedDevRuntimeKb: number;
  appJsBundleKb: number;
  bundleDeltaVsUiXrKb: number;
  baselineAppBundleSource: string;
  canvasNonblank: boolean;
  observedSceneObjectNames: string[];
  observedTraceActionTags: string[];
  frameDeltasMs: number[];
  consoleErrorCount: number;
};

export type IwsdkSidecarIwerInputProbeTool =
  | "xr_set_input_mode"
  | "xr_set_connected"
  | "xr_set_gamepad_state"
  | "xr_select";

export type IwsdkSidecarIwerInputProbeEvidenceInput = {
  generatedAt: string;
  sessionActive: boolean;
  sessionMode: string | null;
  attemptedToolNames: IwsdkSidecarIwerInputProbeTool[];
  successfulToolNames: IwsdkSidecarIwerInputProbeTool[];
  observedTraceActionTags: string[];
  controllerSelectTraceTag: string;
  consoleErrorCount: number;
};

export type IwsdkSidecarIwerInputProbeEvidence = IwsdkSidecarIwerInputProbeEvidenceInput & {
  schemaVersion: "openclinxr.iwer-controller-input-probe.v1";
  source: "iwer_mcp_emulation";
  readyForInputEmulationEvidence: boolean;
  readyForProductionRuntime: false;
  readyForPhysicalQuestClaim: false;
  blockers: string[];
  notEvidenceFor: readonly [
    "physical_quest_controller_latency",
    "physical_quest_hand_tracking_quality",
    "physical_quest_foreground_frame_pacing",
    "in_headset_text_readability",
    "production_runtime_readiness",
  ];
};

export type IwsdkSidecarIwerInputProbeReadiness = {
  readyForInputEmulationEvidence: boolean;
  blockers: string[];
};

const parityContract = buildIwsdkUiXrStationParityContract();

export const iwsdkSidecarSceneObjectNames = [...parityContract.requiredSceneObjectNames];
export const iwsdkSidecarTraceActionTags = [...edChestPainScenario.requiredTraceTags];
export const iwsdkSidecarSmokePlanHash = parityContract.smokePlanHash;
export const iwsdkSidecarControllerSelectTraceTag = parityContract.controllerSelectTraceTag;

export function createIwsdkSidecarRuntimeState(): IwsdkSidecarRuntimeState {
  return {
    scenarioId: edChestPainScenario.scenarioId,
    title: edChestPainScenario.title,
    elapsedSecond: 0,
    requiredTraceTags: [...iwsdkSidecarTraceActionTags],
    completedTraceTags: [],
  };
}

export function completeIwsdkSidecarTraceAction(
  state: IwsdkSidecarRuntimeState,
  traceTag: string,
): IwsdkSidecarRuntimeState {
  if (state.completedTraceTags.includes(traceTag)) {
    return state;
  }
  return {
    ...state,
    completedTraceTags: [...state.completedTraceTags, traceTag],
  };
}

export function summarizeIwsdkSidecarReadiness(state: IwsdkSidecarRuntimeState): IwsdkSidecarReadinessSummary {
  const observed = new Set(state.completedTraceTags);
  const missingTraceTags = state.requiredTraceTags.filter((tag) => !observed.has(tag));
  return {
    observedCount: state.completedTraceTags.length,
    missingCount: missingTraceTags.length,
    missingTraceTags,
  };
}

export function formatIwsdkSidecarClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function summarizeIwsdkSidecarFrameDeltas(frameDeltasMs: number[]): IwsdkSidecarFrameDeltaSummary {
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
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    sampleCount: sorted.length,
    avgFrameMs: roundMetric(avgFrameMs),
    p95FrameMs: roundMetric(sorted[p95Index] ?? avgFrameMs),
    maxFrameMs: roundMetric(sorted.at(-1) ?? avgFrameMs),
    approxFps: roundMetric(1000 / avgFrameMs, 1),
  };
}

export function buildIwsdkSidecarFrameStats(input: {
  frameDeltasMs: number[];
  framesObserved: number;
  latestFrameAtMs: number | null;
  previewFramesObserved: number;
  immersiveFramesObserved: number;
  qualitySource: IwsdkSidecarFrameQualitySource;
  isPresenting: boolean;
  visibilityState: string;
}): IwsdkSidecarFrameStats {
  return {
    ...summarizeIwsdkSidecarFrameDeltas(input.frameDeltasMs),
    framesObserved: input.framesObserved,
    latestFrameAtMs: input.latestFrameAtMs,
    sampleWindowSize: input.frameDeltasMs.length,
    previewFramesObserved: input.previewFramesObserved,
    immersiveFramesObserved: input.immersiveFramesObserved,
    qualitySource: input.qualitySource,
    isPresenting: input.isPresenting,
    visibilityState: input.visibilityState,
  };
}

export function buildIwsdkSidecarRuntimeEvidence(input: {
  iwsdkCoreExportCount: number;
  iwsdkXrInputExportCount: number;
}): IwsdkSidecarRuntimeEvidence {
  return {
    scenarioId: edChestPainScenario.scenarioId,
    sidecar: "apps/ui-xr-iwsdk-spike",
    iwsdkCoreExportCount: input.iwsdkCoreExportCount,
    iwsdkXrInputExportCount: input.iwsdkXrInputExportCount,
    phaseLabel: "Phase 1 Full VR",
    requestedSessionMode: "immersive-vr",
    mixedRealityPassthroughImplemented: false,
    handTrackingPosture: "optional_feature_with_primitive_hand_model",
    locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
    requiredSceneObjectNames: [...iwsdkSidecarSceneObjectNames],
    traceActionTags: [...iwsdkSidecarTraceActionTags],
  };
}

export function buildIwsdkSidecarXrEntryEvidence(input: {
  sessionMode: IwsdkSidecarXrSessionMode;
  nowMs: number;
  autoAttemptEnabled: boolean;
}): IwsdkSidecarXrEntryEvidence {
  return {
    sessionMode: input.sessionMode,
    autoAttemptEnabled: input.autoAttemptEnabled,
    attempts: 0,
    lastStatus: "not_requested",
    lastOutcome: "not_requested",
    lastRequestedAtMs: null,
    lastUpdatedAtMs: input.nowMs,
    lastError: null,
  };
}

export function recordIwsdkSidecarXrEntryEvidence(
  current: IwsdkSidecarXrEntryEvidence,
  status: IwsdkSidecarXrEntryStatus,
  input: {
    nowMs: number;
    error?: unknown;
  },
): IwsdkSidecarXrEntryEvidence {
  const requesting = status === "requesting";
  const lastError = input.error === undefined ? null : formatUnknownError(input.error);
  return {
    ...current,
    attempts: current.attempts + (requesting ? 1 : 0),
    lastStatus: status,
    lastOutcome: classifyIwsdkSidecarXrEntryOutcome(status, lastError),
    lastRequestedAtMs: requesting ? input.nowMs : current.lastRequestedAtMs,
    lastUpdatedAtMs: input.nowMs,
    lastError,
  };
}

export function buildIwsdkSidecarLocalMetricsEvidence(input: IwsdkSidecarLocalMetricsEvidenceInput): IwsdkSpikeMetrics {
  const frameSummary = summarizeIwsdkSidecarFrameDeltas(input.frameDeltasMs);
  const metrics: IwsdkSpikeMetrics = {
    installedNodeModulesMb: input.installedNodeModulesMb,
    injectedDevRuntimeKb: input.injectedDevRuntimeKb,
    appJsBundleKb: input.appJsBundleKb,
    bundleDeltaVsUiXrKb: input.bundleDeltaVsUiXrKb,
    baselineAppBundleSource: input.baselineAppBundleSource,
    smokePlanHash: iwsdkSidecarSmokePlanHash,
    canvasNonblank: input.canvasNonblank,
    requiredSceneObjectNames: [...iwsdkSidecarSceneObjectNames],
    observedSceneObjectNames: [...input.observedSceneObjectNames],
    controllerSelectTraceTag: iwsdkSidecarControllerSelectTraceTag,
    observedTraceActionTags: [...input.observedTraceActionTags],
    consoleErrorCount: input.consoleErrorCount,
  };

  if (frameSummary.approxFps !== null) {
    metrics.avgFps = frameSummary.approxFps;
  }
  if (frameSummary.p95FrameMs !== null) {
    metrics.p95FrameMs = frameSummary.p95FrameMs;
  }

  return metrics;
}

export function buildIwsdkSidecarIwerInputProbeEvidence(
  input: IwsdkSidecarIwerInputProbeEvidenceInput,
): IwsdkSidecarIwerInputProbeEvidence {
  const baseEvidence = {
    schemaVersion: "openclinxr.iwer-controller-input-probe.v1" as const,
    source: "iwer_mcp_emulation" as const,
    ...input,
    readyForProductionRuntime: false as const,
    readyForPhysicalQuestClaim: false as const,
    notEvidenceFor: [
      "physical_quest_controller_latency",
      "physical_quest_hand_tracking_quality",
      "physical_quest_foreground_frame_pacing",
      "in_headset_text_readability",
      "production_runtime_readiness",
    ] as const,
  };
  const readiness = evaluateIwsdkSidecarIwerInputProbeEvidence(baseEvidence);

  return {
    ...baseEvidence,
    readyForInputEmulationEvidence: readiness.readyForInputEmulationEvidence,
    blockers: readiness.blockers,
  };
}

export function evaluateIwsdkSidecarIwerInputProbeEvidence(input: {
  sessionActive?: boolean;
  sessionMode?: string | null;
  successfulToolNames?: string[];
  observedTraceActionTags?: string[];
  controllerSelectTraceTag?: string;
  consoleErrorCount?: number;
}): IwsdkSidecarIwerInputProbeReadiness {
  const successfulToolNames = input.successfulToolNames ?? [];
  const observedTraceActionTags = input.observedTraceActionTags ?? [];
  const controllerSelectTraceTag = input.controllerSelectTraceTag ?? iwsdkSidecarControllerSelectTraceTag;
  const requiredTools: IwsdkSidecarIwerInputProbeTool[] = [
    "xr_set_input_mode",
    "xr_set_connected",
    "xr_set_gamepad_state",
    "xr_select",
  ];
  const blockers = [
    input.sessionActive === true ? undefined : "iwer_input_probe_session_not_active",
    input.sessionMode === "immersive-vr" ? undefined : "iwer_input_probe_session_mode_not_immersive_vr",
    ...requiredTools.map((toolName) => (
      successfulToolNames.includes(toolName)
        ? undefined
        : `iwer_input_probe_missing_required_successful_tool:${toolName}`
    )),
    observedTraceActionTags.includes(controllerSelectTraceTag)
      ? undefined
      : `iwer_input_probe_missing_trace_tag:${controllerSelectTraceTag}`,
    input.consoleErrorCount === 0 ? undefined : "iwer_input_probe_console_errors_present",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    readyForInputEmulationEvidence: blockers.length === 0,
    blockers,
  };
}

function classifyIwsdkSidecarXrEntryOutcome(
  status: IwsdkSidecarXrEntryStatus,
  error: string | null,
): IwsdkSidecarXrEntryOutcome {
  if (status === "not_requested") {
    return "not_requested";
  }
  if (status === "unsupported") {
    return "unsupported";
  }
  if (status === "requesting") {
    return "request_in_flight";
  }
  if (status === "started") {
    return "session_started";
  }
  if (status === "ended") {
    return "session_ended";
  }
  const normalizedError = error?.toLowerCase() ?? "";
  if (
    normalizedError.includes("activation")
    || normalizedError.includes("user gesture")
    || normalizedError.includes("notallowederror")
    || normalizedError.includes("securityerror")
  ) {
    return "activation_required";
  }
  return "request_failed";
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function roundMetric(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
