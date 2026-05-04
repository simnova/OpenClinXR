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
  latestFrameAtMs: number | null;
  sampleWindowSize: number;
};

export type ManualPerformanceMetrics = {
  avgFps: number | null;
  p95FrameMs: number | null;
  minimumObservedFps: number | null;
  source: "window.__openClinXrFrameStats";
  framesObserved: number;
  sampleWindowSize: number;
};

export const stationTraceActionTags = [...edChestPainScenario.requiredTraceTags];

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
} as const;

export const iwsdkStationSceneObjectNames = Object.values(iwsdkStationSceneObjects);

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

export function manualPerformanceMetricsFromFrameStats(stats: ManualPerformanceFrameStats): ManualPerformanceMetrics {
  return {
    avgFps: stats.approxFps,
    p95FrameMs: stats.p95FrameMs,
    minimumObservedFps: stats.maxFrameMs ? roundMetric(1000 / stats.maxFrameMs, 1) : null,
    source: "window.__openClinXrFrameStats",
    framesObserved: stats.framesObserved,
    sampleWindowSize: stats.sampleWindowSize,
  };
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
