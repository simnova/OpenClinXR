import { edChestPainScenario } from "@openclinxr/scenario-fixtures";

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

export const stationTraceActionTags = [...edChestPainScenario.requiredTraceTags];

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
