import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIwsdkUiXrStationParityContract } from "@openclinxr/iwsdk-spike";
import {
  buildIwsdkSidecarRuntimeEvidence,
  completeIwsdkSidecarTraceAction,
  createIwsdkSidecarRuntimeState,
  formatIwsdkSidecarClock,
  iwsdkSidecarControllerSelectTraceTag,
  iwsdkSidecarSceneObjectNames,
  iwsdkSidecarSmokePlanHash,
  summarizeIwsdkSidecarReadiness,
} from "./sidecar-state.js";

describe("IWSDK sidecar runtime state", () => {
  it("mirrors the production XR parity contract without importing ui-xr internals", () => {
    const parity = buildIwsdkUiXrStationParityContract();

    expect(iwsdkSidecarSceneObjectNames).toEqual(parity.requiredSceneObjectNames);
    expect(iwsdkSidecarSmokePlanHash).toBe(parity.smokePlanHash);
    expect(iwsdkSidecarControllerSelectTraceTag).toBe(parity.controllerSelectTraceTag);
  });

  it("tracks trace readiness for the ED chest pain sidecar station", () => {
    const initial = createIwsdkSidecarRuntimeState();
    const updated = completeIwsdkSidecarTraceAction(initial, iwsdkSidecarControllerSelectTraceTag);

    expect(formatIwsdkSidecarClock(125)).toBe("02:05");
    expect(summarizeIwsdkSidecarReadiness(updated)).toEqual({
      observedCount: 1,
      missingCount: initial.requiredTraceTags.length - 1,
      missingTraceTags: initial.requiredTraceTags.filter((tag) => tag !== iwsdkSidecarControllerSelectTraceTag),
    });
  });

  it("records IWSDK runtime export counts as sidecar evidence", () => {
    const state = createIwsdkSidecarRuntimeState();

    expect(buildIwsdkSidecarRuntimeEvidence({
      iwsdkCoreExportCount: 7,
      iwsdkXrInputExportCount: 3,
    })).toEqual(expect.objectContaining({
      scenarioId: state.scenarioId,
      sidecar: "apps/ui-xr-iwsdk-spike",
      iwsdkCoreExportCount: 7,
      iwsdkXrInputExportCount: 3,
      requiredSceneObjectNames: iwsdkSidecarSceneObjectNames,
    }));
  });

  it("uses the approved IWSDK Phase 1 packages in the browser entrypoint", () => {
    const source = readFileSync("src/main.ts", "utf8");

    expect(source).toContain('from "@iwsdk/core"');
    expect(source).toContain('from "@iwsdk/xr-input"');
    expect(source).not.toContain("apps/ui-xr/src");
    expect(source).not.toContain("@openclinxr/ui-xr");
  });
});
