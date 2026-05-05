import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIwsdkUiXrStationParityContract } from "@openclinxr/iwsdk-spike";
import {
  buildIwsdkSidecarLocalMetricsEvidence,
  buildIwsdkSidecarIwerInputProbeEvidence,
  buildIwsdkSidecarXrEntryEvidence,
  buildIwsdkSidecarRuntimeEvidence,
  completeIwsdkSidecarTraceAction,
  createIwsdkSidecarRuntimeState,
  evaluateIwsdkSidecarIwerInputProbeEvidence,
  recordIwsdkSidecarXrEntryEvidence,
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
      handTrackingPosture: "optional_feature_with_primitive_hand_model",
      locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
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

  it("adapts local sidecar observations into IWSDK shell metrics without headset-only claims", () => {
    expect(buildIwsdkSidecarLocalMetricsEvidence({
      installedNodeModulesMb: 24,
      injectedDevRuntimeKb: 0,
      appJsBundleKb: 504,
      bundleDeltaVsUiXrKb: 24,
      baselineAppBundleSource: "apps/ui-xr/dist/assets/index-D2UAcKLL.js",
      canvasNonblank: true,
      observedSceneObjectNames: iwsdkSidecarSceneObjectNames,
      observedTraceActionTags: [iwsdkSidecarControllerSelectTraceTag],
      frameDeltasMs: [12, 13, 14, 15],
      consoleErrorCount: 0,
    })).toEqual({
      installedNodeModulesMb: 24,
      injectedDevRuntimeKb: 0,
      appJsBundleKb: 504,
      bundleDeltaVsUiXrKb: 24,
      baselineAppBundleSource: "apps/ui-xr/dist/assets/index-D2UAcKLL.js",
      smokePlanHash: iwsdkSidecarSmokePlanHash,
      canvasNonblank: true,
      requiredSceneObjectNames: iwsdkSidecarSceneObjectNames,
      observedSceneObjectNames: iwsdkSidecarSceneObjectNames,
      controllerSelectTraceTag: iwsdkSidecarControllerSelectTraceTag,
      observedTraceActionTags: [iwsdkSidecarControllerSelectTraceTag],
      avgFps: 74.1,
      p95FrameMs: 15,
      consoleErrorCount: 0,
    });
  });

  it("classifies sidecar XR entry attempts without overclaiming IWER or user-activation outcomes", () => {
    const initial = buildIwsdkSidecarXrEntryEvidence({
      nowMs: 10,
      sessionMode: "immersive-vr",
      autoAttemptEnabled: true,
    });
    const requesting = recordIwsdkSidecarXrEntryEvidence(initial, "requesting", { nowMs: 20 });
    const activationBlocked = recordIwsdkSidecarXrEntryEvidence(requesting, "failed", {
      nowMs: 30,
      error: new DOMException("requestSession requires user activation", "NotAllowedError"),
    });
    const unsupported = recordIwsdkSidecarXrEntryEvidence(initial, "unsupported", { nowMs: 40 });
    const started = recordIwsdkSidecarXrEntryEvidence(requesting, "started", { nowMs: 50 });

    expect(initial).toEqual({
      sessionMode: "immersive-vr",
      autoAttemptEnabled: true,
      attempts: 0,
      lastStatus: "not_requested",
      lastOutcome: "not_requested",
      lastRequestedAtMs: null,
      lastUpdatedAtMs: 10,
      lastError: null,
    });
    expect(requesting.attempts).toBe(1);
    expect(activationBlocked).toEqual(expect.objectContaining({
      attempts: 1,
      lastStatus: "failed",
      lastOutcome: "activation_required",
      lastError: "NotAllowedError: requestSession requires user activation",
    }));
    expect(unsupported.lastOutcome).toBe("unsupported");
    expect(started.lastOutcome).toBe("session_started");
  });

  it("scores IWER controller/input probes as emulation-only evidence", () => {
    const evidence = buildIwsdkSidecarIwerInputProbeEvidence({
      generatedAt: "2026-05-05T00:00:00.000Z",
      sessionActive: true,
      sessionMode: "immersive-vr",
      attemptedToolNames: ["xr_set_input_mode", "xr_set_connected", "xr_set_gamepad_state", "xr_select"],
      successfulToolNames: ["xr_set_input_mode", "xr_set_connected", "xr_set_gamepad_state", "xr_select"],
      observedTraceActionTags: [iwsdkSidecarControllerSelectTraceTag],
      controllerSelectTraceTag: iwsdkSidecarControllerSelectTraceTag,
      consoleErrorCount: 0,
    });

    expect(evidence).toEqual(expect.objectContaining({
      schemaVersion: "openclinxr.iwer-controller-input-probe.v1",
      source: "iwer_mcp_emulation",
      readyForInputEmulationEvidence: true,
      readyForPhysicalQuestClaim: false,
      readyForProductionRuntime: false,
      blockers: [],
      notEvidenceFor: expect.arrayContaining([
        "physical_quest_controller_latency",
        "physical_quest_hand_tracking_quality",
      ]),
    }));
    expect(evaluateIwsdkSidecarIwerInputProbeEvidence(evidence)).toEqual({
      readyForInputEmulationEvidence: true,
      blockers: [],
    });
  });

  it("rejects IWER input probes that lack an active emulated session or select trace", () => {
    const evidence = buildIwsdkSidecarIwerInputProbeEvidence({
      generatedAt: "2026-05-05T00:00:00.000Z",
      sessionActive: false,
      sessionMode: null,
      attemptedToolNames: ["xr_set_input_mode", "xr_select"],
      successfulToolNames: ["xr_set_input_mode"],
      observedTraceActionTags: [],
      controllerSelectTraceTag: iwsdkSidecarControllerSelectTraceTag,
      consoleErrorCount: 1,
    });

    expect(evaluateIwsdkSidecarIwerInputProbeEvidence(evidence)).toEqual({
      readyForInputEmulationEvidence: false,
      blockers: [
        "iwer_input_probe_session_not_active",
        "iwer_input_probe_session_mode_not_immersive_vr",
        "iwer_input_probe_missing_required_successful_tool:xr_set_connected",
        "iwer_input_probe_missing_required_successful_tool:xr_set_gamepad_state",
        "iwer_input_probe_missing_required_successful_tool:xr_select",
        `iwer_input_probe_missing_trace_tag:${iwsdkSidecarControllerSelectTraceTag}`,
        "iwer_input_probe_console_errors_present",
      ],
    });
  });

  it("uses the approved IWSDK Phase 1 packages in the browser entrypoint", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain('import("@iwsdk/core")');
    expect(source).toContain('import("@iwsdk/xr-input")');
    expect(source).toContain("hydrateIwsdkPackageEvidence");
    expect(source).not.toContain("apps/ui-xr/src");
    expect(source).not.toContain("@openclinxr/ui-xr");
  });

  it("exposes separate immersive VR and gated Mixed Reality entry paths for Quest Browser", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const stateSource = readFileSync(new URL("./sidecar-state.ts", import.meta.url), "utf8");

    expect(stateSource).toContain("Phase 1 Full VR");
    expect(source).toContain("Enter Full VR");
    expect(source).toContain("Enter Mixed Reality");
    expect(source).toContain("hasApprovedMixedRealityOperatorGate");
    expect(source).toContain("buildMixedRealitySupportState");
    expect(source).toContain('requestSession("immersive-vr"');
    expect(source).toContain('requestSession("immersive-ar"');
    expect(source).toContain('"hand-tracking"');
    expect(source).toContain("renderer.xr.enabled = true");
    expect(source).toContain("renderer.setAnimationLoop");
  });

  it("exposes a query-gated IWER XR entry evidence probe without running it by default", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("__openClinXrIwerSessionEntryEvidence");
    expect(source).toContain("iwerAutoEnterVr=true");
    expect(source).toContain("recordIwerSessionEntryEvidence");
    expect(source).toContain("hasIwerAutoEnterVrProbe");
    expect(source).toContain("void stationScene.startFullVrSession({ entrySource: \"iwer_auto_entry_probe\" })");
  });

  it("uses a transparent rendering policy only while presenting Mixed Reality", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("new WebGLRenderer({ canvas, antialias: true, alpha: true })");
    expect(source).toContain("applyPresentationPolicy");
    expect(source).toContain("scene.background = null");
    expect(source).toContain("renderer.setClearAlpha(0)");
    expect(source).toContain("floor.visible = mode !== \"mixed-reality\"");
    expect(source.indexOf("applyPresentationPolicy(\"full-vr\")")).toBeLessThan(
      source.indexOf('requestSession("immersive-vr"'),
    );
    expect(source.indexOf("applyPresentationPolicy(\"mixed-reality\")")).toBeLessThan(
      source.indexOf('requestSession("immersive-ar"'),
    );
  });

  it("does not resize the renderer while an immersive headset session is presenting", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("renderer.xr.isPresenting");
    expect(source.indexOf("renderer.xr.isPresenting")).toBeLessThan(source.indexOf("renderer.setSize(width, height, false)"));
  });

  it("renders clinical text and controller affordances inside the immersive scene", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("CanvasTexture");
    expect(source).toContain("createReadableVrTextPanel");
    expect(source).toContain("openclinxr.ed-chest-pain.in-vr-clinical-panel");
    expect(source).toContain("openclinxr.ed-chest-pain.in-vr-dialogue-panel");
    expect(source).toContain("openclinxr.ed-chest-pain.in-vr-input-panel");
    expect(source).toContain("renderer.xr.getController");
    expect(source).toContain("XRControllerModelFactory");
    expect(source).toContain("renderer.xr.getControllerGrip");
    expect(source).toContain("openclinxr.ed-chest-pain.controller-ray");
    expect(source).toContain("openclinxr.ed-chest-pain.controller-grip-left");
    expect(source).toContain("openclinxr.ed-chest-pain.controller-grip-right");
  });

  it("adds primitive hand models and experimental locomotion affordances", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("XRHandModelFactory");
    expect(source).toContain("renderer.xr.getHand");
    expect(source).toContain("openclinxr.ed-chest-pain.hand-model");
    expect(source).toContain("installHandModelsOnce");
    expect(source).toContain("handModelStatus");
    expect(source).toContain("__openClinXrBootEvidence");
    expect(source).toContain("applyLocomotion");
    expect(source).toContain("readXrGamepadLocomotion");
    expect(source).toContain("fallbackAnimationLoop");
    expect(source).toContain("__openClinXrInputEvidence");
  });

  it("publishes richer sidecar input and text-panel evidence for IWER probes", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("__openClinXrTextPanelEvidence");
    expect(source).toContain("publishReadableVrTextPanelEvidence");
    expect(source).toContain("activeLocomotionSource");
    expect(source).toContain("inputSourceCount");
    expect(source).toContain("inputSourceKinds");
    expect(source).toContain("keyboardVector");
    expect(source).toContain("xrVector");
  });

  it("keeps the cleaner IWER visual evidence layout query-gated", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("iwerEvidenceView=wide");
    expect(source).toContain("hasIwerWideEvidenceView");
    expect(source).toContain("applyEvidenceCaptureLayout");
    expect(source).toContain("__openClinXrIwerEvidenceViewEvidence");
    expect(source).toContain("wide_iwer_capture");
  });

  it("prioritizes panel visibility only in the IWER visual evidence layout", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain("prioritizeEvidencePanelVisibility");
    expect(source).toContain("mesh.renderOrder = 50");
    expect(source).toContain("depthTest = false");
    expect(source).toContain("depthWrite = false");
  });
});
