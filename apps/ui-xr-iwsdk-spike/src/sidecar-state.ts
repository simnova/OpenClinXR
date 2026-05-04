import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { buildIwsdkUiXrStationParityContract } from "@openclinxr/iwsdk-spike";

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
  requiredSceneObjectNames: string[];
  traceActionTags: string[];
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

export function buildIwsdkSidecarRuntimeEvidence(input: {
  iwsdkCoreExportCount: number;
  iwsdkXrInputExportCount: number;
}): IwsdkSidecarRuntimeEvidence {
  return {
    scenarioId: edChestPainScenario.scenarioId,
    sidecar: "apps/ui-xr-iwsdk-spike",
    iwsdkCoreExportCount: input.iwsdkCoreExportCount,
    iwsdkXrInputExportCount: input.iwsdkXrInputExportCount,
    requiredSceneObjectNames: [...iwsdkSidecarSceneObjectNames],
    traceActionTags: [...iwsdkSidecarTraceActionTags],
  };
}
