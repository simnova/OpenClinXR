import { describe, expect, it } from "vitest";
import {
  buildIwsdkStationMcpSmokePlan,
  iwsdkStationMcpSmokePlanHash,
} from "../../apps/ui-xr/src/runtime-state.js";
import {
  buildIwsdkUiXrStationParityContract,
  evaluateIwsdkSpikeMetrics,
} from "../../packages/openclinxr/iwsdk-spike/src/index.js";

describe("IWSDK UI-XR parity contract", () => {
  it("keeps the sidecar readiness contract aligned with the production XR smoke semantics", () => {
    const plan = buildIwsdkStationMcpSmokePlan();
    const contract = buildIwsdkUiXrStationParityContract();

    expect(plan.smokePlanHash).toBe(iwsdkStationMcpSmokePlanHash);
    expect(contract.smokePlanHash).toBe(plan.smokePlanHash);
    expect(contract.mcpToolOrder).toEqual(plan.steps.map((step) => step.toolName));
    expect(contract.requiredSceneObjectNames).toEqual(plan.requiredSceneObjectNames);
    expect(contract.controllerSelectTraceTag).toBe(plan.controllerSelectTraceTag);
    expect(evaluateIwsdkSpikeMetrics({
      installedNodeModulesMb: 0,
      injectedDevRuntimeKb: 0,
      appJsBundleKb: 0,
      bundleDeltaVsUiXrKb: 0,
      baselineAppBundleSource: contract.baselineAppBundleSource,
      smokePlanHash: contract.smokePlanHash,
      canvasNonblank: true,
      requiredSceneObjectNames: contract.requiredSceneObjectNames,
      observedSceneObjectNames: [...contract.requiredSceneObjectNames],
      controllerSelectTraceTag: contract.controllerSelectTraceTag,
      observedTraceActionTags: [contract.controllerSelectTraceTag],
      consoleErrorCount: 0,
    })).toEqual({
      readyForCommittedSpike: true,
      readyForProductionRuntime: false,
      blockers: [
        "missing_foreground_quest_preflight_ready",
        "missing_avg_fps",
        "missing_p95_frame_ms",
        "missing_controller_select_latency_ms",
      ],
    });
  });
});
