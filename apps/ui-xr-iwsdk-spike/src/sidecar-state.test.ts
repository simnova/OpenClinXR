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
  summarizeIwsdkSidecarFrameDeltas,
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
      requestedSessionMode: "immersive-vr",
      mixedRealityPassthroughImplemented: false,
    }));
  });

  it("summarizes sidecar frame deltas for Quest CDP and manual headset evidence", () => {
    expect(summarizeIwsdkSidecarFrameDeltas([])).toEqual({
      sampleCount: 0,
      avgFrameMs: null,
      p95FrameMs: null,
      maxFrameMs: null,
      approxFps: null,
    });

    expect(summarizeIwsdkSidecarFrameDeltas([10, 20, 30, 40])).toEqual({
      sampleCount: 4,
      avgFrameMs: 25,
      p95FrameMs: 40,
      maxFrameMs: 40,
      approxFps: 40,
    });
  });

  it("uses the approved IWSDK Phase 1 packages in the browser entrypoint", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain('from "@iwsdk/core"');
    expect(source).toContain('from "@iwsdk/xr-input"');
    expect(source).not.toContain("apps/ui-xr/src");
    expect(source).not.toContain("@openclinxr/ui-xr");
  });

  it("exposes an explicit immersive VR entry path for Quest Browser", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const stateSource = readFileSync(new URL("./sidecar-state.ts", import.meta.url), "utf8");

    expect(stateSource).toContain("Phase 1 VR");
    expect(source).toContain("Enter VR");
    expect(source).toContain('requestSession("immersive-vr"');
    expect(source).not.toContain('requestSession("immersive-ar"');
    expect(source).toContain('"hand-tracking"');
    expect(source).toContain("renderer.xr.enabled = true");
    expect(source).toContain("renderer.setAnimationLoop");
  });

  it("renders clinical text and controller affordances inside the immersive scene", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("CanvasTexture");
    expect(source).toContain("openclinxr.ed-chest-pain.in-vr-clinical-panel");
    expect(source).toContain("renderer.xr.getController");
    expect(source).toContain("openclinxr.ed-chest-pain.controller-ray");
  });
});
