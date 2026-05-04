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
  phaseLabel: "Phase 1 VR";
  requestedSessionMode: "immersive-vr";
  mixedRealityPassthroughImplemented: false;
  handTrackingPosture: "optional_feature_requested_no_articulated_hand_mesh";
  locomotionPosture: "physical_room_scale_only";
  requiredSceneObjectNames: string[];
  traceActionTags: string[];
};

export type IwsdkSidecarFrameDeltaSummary = {
  sampleCount: number;
  avgFrameMs: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  approxFps: number | null;
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

export function buildIwsdkSidecarRuntimeEvidence(input: {
  iwsdkCoreExportCount: number;
  iwsdkXrInputExportCount: number;
}): IwsdkSidecarRuntimeEvidence {
  return {
    scenarioId: edChestPainScenario.scenarioId,
    sidecar: "apps/ui-xr-iwsdk-spike",
    iwsdkCoreExportCount: input.iwsdkCoreExportCount,
    iwsdkXrInputExportCount: input.iwsdkXrInputExportCount,
    phaseLabel: "Phase 1 VR",
    requestedSessionMode: "immersive-vr",
    mixedRealityPassthroughImplemented: false,
    handTrackingPosture: "optional_feature_requested_no_articulated_hand_mesh",
    locomotionPosture: "physical_room_scale_only",
    requiredSceneObjectNames: [...iwsdkSidecarSceneObjectNames],
    traceActionTags: [...iwsdkSidecarTraceActionTags],
  };
}

function roundMetric(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
