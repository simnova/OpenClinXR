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

