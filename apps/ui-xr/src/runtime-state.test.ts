import { describe, expect, it } from "vitest";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import {
  completeTraceAction,
  buildManualPerformanceCaptureSummary,
  buildManualPerformanceInputEvidence,
  buildReadableVrTextPanelEvidence,
  buildRuntimeFrameStats,
  createInitialRuntimeState,
  actorResponseTextFromApiResult,
  buildManualPerformanceDraft,
  buildIwsdkStationMcpSmokePlan,
  evaluateIwsdkStationMcpSmokeEvidence,
  evaluateXrExperienceModeReadiness,
  findXrExperienceModeContract,
  formatStationClock,
  iwsdkStationMcpSmokePlanHash,
  iwsdkStationMcpSmokeToolOrder,
  iwsdkStationSceneObjectNames,
  iwsdkStationSceneObjects,
  remoteActorTurnForTraceTag,
  manualPerformanceMetricsFromFrameStats,
  stationTraceActionTags,
  summarizeFrameDeltas,
  summarizeTraceReadiness,
  xrExperienceModeEvidence,
  xrExperienceModeContracts,
} from "./runtime-state.js";

describe("XR runtime state", () => {
  it("formats station time without viewport-dependent sizing", () => {
    expect(formatStationClock(0)).toBe("00:00");
    expect(formatStationClock(65)).toBe("01:05");
    expect(formatStationClock(960)).toBe("16:00");
  });

  it("tracks required trace actions for the ED station", () => {
    let state = createInitialRuntimeState();
    state = completeTraceAction(state, "ecg_request");
    state = completeTraceAction(state, "team_communication");

    expect(state.completedTraceTags).toEqual(["ecg_request", "team_communication"]);
    expect(summarizeTraceReadiness(state).observedCount).toBe(2);
    expect(summarizeTraceReadiness(state).missingCount).toBeGreaterThan(0);
  });

  it("exposes every required ED trace tag for headset trace controls", () => {
    expect(stationTraceActionTags).toEqual(edChestPainScenario.requiredTraceTags);
  });

  it("states that the current headset runtime is full VR, not mixed reality passthrough", () => {
    expect(xrExperienceModeEvidence).toEqual({
      modeId: "full_vr",
      phaseLabel: "Phase 1 Full VR",
      requestedSessionMode: "immersive-vr",
      mixedRealityPassthroughImplemented: false,
      handTrackingPosture: "optional_feature_with_primitive_hand_model",
      locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
    });
  });

  it("keeps mixed reality as a separate approved lane with its own evidence contract", () => {
    expect(xrExperienceModeContracts.map((contract) => contract.modeId)).toEqual([
      "full_vr",
      "mixed_reality_passthrough",
    ]);

    expect(findXrExperienceModeContract("mixed_reality_passthrough")).toEqual({
      modeId: "mixed_reality_passthrough",
      phaseLabel: "Phase 1 Mixed Reality",
      requestedSessionMode: "immersive-ar",
      entryButtonLabel: "Enter Mixed Reality",
      sharesScenarioTraceContract: true,
      evidenceLane: "mixed_reality_manual_report",
      privacySafetyReviewRequired: true,
      requiredEvidence: [
        "immersive_ar_session_started",
        "passthrough_visibility_observed",
        "foreground_quest_mr_manual_report",
        "privacy_safety_review_completed",
        "room_boundary_and_occlusion_comfort_reported",
      ],
      prohibitedClaimsUntilReady: [
        "replacement_for_full_vr",
        "production_quest_readiness",
        "passthrough_privacy_readiness",
        "clinical_room_safety_readiness",
      ],
    });
  });

  it("scores Full VR and mixed reality readiness independently", () => {
    expect(evaluateXrExperienceModeReadiness({
      modeId: "full_vr",
      requestedSessionMode: "immersive-vr",
      manualReportModeId: "full_vr",
      sharesScenarioTraceContract: true,
    })).toEqual({
      ready: true,
      blockers: [],
    });

    expect(evaluateXrExperienceModeReadiness({
      modeId: "mixed_reality_passthrough",
      requestedSessionMode: "immersive-ar",
      manualReportModeId: "full_vr",
      passthroughObserved: false,
      privacySafetyReviewed: false,
      sharesScenarioTraceContract: true,
    })).toEqual({
      ready: false,
      blockers: [
        "missing_mixed_reality_manual_report",
        "missing_passthrough_observation",
        "missing_privacy_safety_review",
      ],
    });
  });

  it("plans remote actor turns without embedding hidden scenario facts", () => {
    expect(remoteActorTurnForTraceTag("risk_factor_question")).toEqual({
      actorId: "patient_robert_hayes_v1",
      voiceId: "mock-robert-hayes",
      learnerUtterance: "Do you have any heart risk factors or family history I should know about?",
      traceContextTags: ["risk_factor_question"],
    });
    expect(remoteActorTurnForTraceTag("family_communication")).toEqual({
      actorId: "spouse_anna_hayes_v1",
      voiceId: "mock-anna-hayes",
      learnerUtterance: "Anna, I know this is frightening. I will explain what we are doing and keep you updated.",
      traceContextTags: ["family_communication"],
    });

    const plannedTurns = stationTraceActionTags.map((tag) => remoteActorTurnForTraceTag(tag)).filter(Boolean);
    const serializedPlans = JSON.stringify(plannedTurns);
    expect(serializedPlans).not.toContain("walking upstairs");
    expect(serializedPlans).not.toContain("Father died");
    expect(serializedPlans).not.toContain("skipped blood pressure medication");
  });

  it("does not request remote dialogue for note submission", () => {
    expect(remoteActorTurnForTraceTag("patient_note_submitted")).toBeUndefined();
  });

  it("defines named scene hierarchy targets for IWSDK MCP inspection", () => {
    expect(iwsdkStationSceneObjectNames).toEqual([
      "openclinxr.ed-chest-pain.station-root",
      "openclinxr.ed-chest-pain.ambient-light",
      "openclinxr.ed-chest-pain.key-light",
      "openclinxr.ed-chest-pain.floor",
      "openclinxr.ed-chest-pain.bed",
      "openclinxr.ed-chest-pain.monitor",
      "openclinxr.ed-chest-pain.patient-robert-hayes",
      "openclinxr.ed-chest-pain.nurse-maria-alvarez",
      "openclinxr.ed-chest-pain.spouse-anna-hayes",
      "openclinxr.ed-chest-pain.wall-clock",
      "openclinxr.ed-chest-pain.in-vr-clinical-panel",
      "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
      "openclinxr.ed-chest-pain.in-vr-input-panel",
      "openclinxr.ed-chest-pain.controller-grip-left",
      "openclinxr.ed-chest-pain.controller-grip-right",
    ]);
    expect(new Set(iwsdkStationSceneObjectNames).size).toBe(iwsdkStationSceneObjectNames.length);
    expect(iwsdkStationSceneObjects.patientRobertHayes).toContain("patient-robert-hayes");
  });

  it("builds an IWSDK MCP smoke plan around the current station shell without installing IWSDK", () => {
    const plan = buildIwsdkStationMcpSmokePlan();

    expect(plan).toMatchObject({
      mode: "agent",
      smokePlanHash: iwsdkStationMcpSmokePlanHash,
      scenarioId: edChestPainScenario.scenarioId,
      scenarioVersion: edChestPainScenario.version,
      scenarioTitle: edChestPainScenario.title,
      controllerSelectTraceTag: "ecg_request",
      mcpToolOrder: iwsdkStationMcpSmokeToolOrder,
      blockedUntil: [
        "apps_ui_xr_iwsdk_sidecar_exists_with_exact_iwsdk_versions",
        "iwsdk_agent_tooling_evidence_records_32_tool_inventory",
        "physical_quest3_foreground_frame_pacing_still_required_for_production",
      ],
    });
    expect(plan.steps.map((step) => step.toolName)).toEqual([
      "xr_get_session_status",
      "xr_accept_session",
      "browser_screenshot",
      "scene_get_hierarchy",
      "xr_select",
      "browser_get_console_logs",
    ]);
    expect(plan.steps.find((step) => step.id === "scene-hierarchy")?.requiredSceneObjects).toEqual(iwsdkStationSceneObjectNames);
    expect(plan.steps.find((step) => step.id === "controller-select-trace")?.traceTag).toBe("ecg_request");
  });

  it("scores IWSDK MCP smoke evidence against scene names and controller trace semantics", () => {
    expect(evaluateIwsdkStationMcpSmokeEvidence({
      objectNames: [...iwsdkStationSceneObjectNames],
      traceActionTags: ["ecg_request"],
    })).toEqual({
      ready: true,
      blockers: [],
    });

    expect(evaluateIwsdkStationMcpSmokeEvidence({
      objectNames: iwsdkStationSceneObjectNames.filter((name) => name !== iwsdkStationSceneObjects.monitor),
      traceActionTags: ["history_opqrst"],
    })).toEqual({
      ready: false,
      blockers: [
        `missing_scene_object:${iwsdkStationSceneObjects.monitor}`,
        "missing_controller_select_trace_tag:ecg_request",
      ],
    });
  });

  it("extracts actor response text from the API result before voice synthesis", () => {
    expect(actorResponseTextFromApiResult({ response: { text: "I feel pressure in my chest." } })).toBe("I feel pressure in my chest.");
    expect(actorResponseTextFromApiResult({ response: { text: "" } })).toBeUndefined();
    expect(actorResponseTextFromApiResult({ response: { text: 123 } })).toBeUndefined();
  });

  it("summarizes rolling frame deltas for headset smoke evidence", () => {
    expect(summarizeFrameDeltas([])).toEqual({
      sampleCount: 0,
      avgFrameMs: null,
      p95FrameMs: null,
      maxFrameMs: null,
      approxFps: null,
    });

    expect(summarizeFrameDeltas([16, 17, 33])).toEqual({
      sampleCount: 3,
      avgFrameMs: 22,
      p95FrameMs: 33,
      maxFrameMs: 33,
      approxFps: 45.5,
    });
  });

  it("builds frame-quality evidence with render-loop posture and long-frame ratios", () => {
    expect(buildRuntimeFrameStats({
      frameDeltasMs: [16, 20, 40],
      framesObserved: 4,
      latestFrameAtMs: 1111.126,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    })).toEqual({
      sampleCount: 3,
      avgFrameMs: 25.33,
      p95FrameMs: 40,
      maxFrameMs: 40,
      approxFps: 39.5,
      framesObserved: 4,
      latestFrameAtMs: 1111.13,
      sampleWindowSize: 3,
      latestFrameDeltaMs: 40,
      sampleWindowMs: 76,
      longFrameCountOver33Ms: 1,
      longFrameRatio: 0.33,
      qualitySource: "webxr_animation_loop",
      renderLoopMode: "webxr_animation_loop_with_preview_fallback",
      isPresenting: true,
      visibilityState: "visible",
    });
  });

  it("builds richer manual input evidence and distinguishes deliberate hand-gesture locomotion", () => {
    expect(buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      keyboardVector: { forward: 1, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0.5, turn: 0 },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: true, axisCount: 4 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 456.789,
      previousLastInputObservedAtMs: 111.11,
      previousLastLocomotionAtMs: null,
      rigPosition: { x: 0.2, z: -0.3 },
    })).toEqual({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
      lastInputObservedAtMs: 456.79,
      lastLocomotionAtMs: 456.79,
      activeLocomotionSource: "mixed",
      inputSourceCount: 2,
      inputSourceKinds: ["keyboard", "xr_gamepad", "xr_hand"],
      keyboardVector: { forward: 1, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0.5, turn: 0 },
      xrHandGestureVector: { forward: 0, strafe: 0, turn: 0 },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: true, axisCount: 4 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      rigPosition: { x: 0.2, z: -0.3 },
    });

    expect(buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureVector: { forward: 0.4, strafe: -0.2, turn: 0.15 },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: false, axisCount: 0 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 567.891,
      previousLastInputObservedAtMs: 111.11,
      previousLastLocomotionAtMs: null,
      rigPosition: { x: 0.08, z: -0.12 },
    })).toMatchObject({
      lastInputObservedAtMs: 567.89,
      lastLocomotionAtMs: 567.89,
      activeLocomotionSource: "xr_hand_gesture",
      inputSourceKinds: ["xr_hand", "xr_hand_gesture"],
      xrHandGestureVector: { forward: 0.4, strafe: -0.2, turn: 0.15 },
    });

    expect(buildManualPerformanceInputEvidence({
      handModelCount: 2,
      handModelStatus: "installed",
      handInputsObserved: 2,
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
      xrHandGestureVector: { forward: 0, strafe: 0, turn: 0 },
      xrInputSources: [
        { handedness: "left", hasHand: true, hasGamepad: false, axisCount: 0 },
        { handedness: "right", hasHand: true, hasGamepad: false, axisCount: 0 },
      ],
      now: 789.123,
      previousLastInputObservedAtMs: 111.11,
      previousLastLocomotionAtMs: 222.22,
      rigPosition: { x: 0, z: 0 },
    })).toMatchObject({
      lastInputObservedAtMs: 789.12,
      lastLocomotionAtMs: 222.22,
      activeLocomotionSource: "none",
      inputSourceKinds: ["xr_hand"],
    });
  });

  it("builds metadata evidence for in-VR text panels without claiming headset readability", () => {
    const evidence = buildReadableVrTextPanelEvidence({
      name: "openclinxr.ed-chest-pain.in-vr-input-panel",
      title: "Input Evidence",
      lines: ["Session: In Full VR", "Hands: installed; observed 2"],
      canvasPixels: { width: 1280, height: 640 },
      worldMeters: { width: 1.65, height: 0.72 },
      updatedAtMs: 123.456,
    });

    expect(evidence).toMatchObject({
      name: "openclinxr.ed-chest-pain.in-vr-input-panel",
      title: "Input Evidence",
      source: "canvas_texture_metadata",
      canvasPixels: { width: 1280, height: 640 },
      worldMeters: { width: 1.65, height: 0.72 },
      lineCount: 2,
      previewLines: ["Session: In Full VR", "Hands: installed; observed 2"],
      lastUpdatedAtMs: 123.46,
      readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
    });
    expect(evidence.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("derives manual Quest performance metrics from rolling frame stats", () => {
    expect(manualPerformanceMetricsFromFrameStats({
      sampleCount: 3,
      avgFrameMs: 22,
      p95FrameMs: 33,
      maxFrameMs: 40,
      approxFps: 45.5,
      framesObserved: 4,
      sampleWindowSize: 3,
      latestFrameAtMs: 1234.56,
    })).toEqual({
      avgFps: 45.5,
      p95FrameMs: 33,
      minimumObservedFps: 25,
      controllerSelectLatencyMs: null,
      source: "window.__openClinXrFrameStats",
      framesObserved: 4,
      sampleWindowSize: 3,
    });
  });

  it("builds a Quest manual performance draft with explicit human-completion placeholders", () => {
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 92,
      foregroundPageConfirmed: true,
      traceInteractionPassed: true,
      controllerSelectLatencyMs: 87.5,
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
        lastLocomotionAtMs: 1234.56,
        rigPosition: { x: 0.1, z: -0.2 },
      },
      traceLatencyEvidence: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 87.5,
        source: "dom_click_trace_button",
        measuredAtMs: 1288.4,
        productionControllerLatencySubstitute: false,
      },
      frameStats: {
        sampleCount: 3,
        avgFrameMs: 16.7,
        p95FrameMs: 18,
        maxFrameMs: 22,
        approxFps: 59.9,
        framesObserved: 4,
        sampleWindowSize: 3,
        latestFrameAtMs: 1234.56,
      },
    });

    expect(draft).toEqual({
      generatedAt: "2026-05-04T00:00:00.000Z",
      runContext: {
        performedBy: "",
        durationMinutes: 1.53,
        notes: "Complete this during a foreground in-headset Quest Browser run.",
      },
      setup: {
        foregroundPageConfirmed: true,
        devtoolsScreencastDisabled: false,
        extraBrowserWindowsClosed: false,
      },
      station: {
        shellLoaded: true,
        traceInteractionPassed: true,
        textReadable: true,
        immersiveSessionStarted: false,
        consoleErrors: [],
      },
      experience: {
        modeId: "full_vr",
        phaseLabel: "Phase 1 Full VR",
        requestedSessionMode: "immersive-vr",
        mixedRealityPassthroughImplemented: false,
        handTrackingPosture: "optional_feature_with_primitive_hand_model",
        locomotionPosture: "experimental_keyboard_and_thumbstick_dolly",
      },
      input: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
        lastLocomotionAtMs: 1234.56,
        rigPosition: { x: 0.1, z: -0.2 },
      },
      traceLatencyProxy: {
        lastTraceTag: "ecg_request",
        lastSelectLatencyMs: 87.5,
        source: "dom_click_trace_button",
        measuredAtMs: 1288.4,
        productionControllerLatencySubstitute: false,
      },
      performance: {
        source: "window.__openClinXrFrameStats",
        framesObserved: 4,
        sampleWindowSize: 3,
        avgFps: 59.9,
        p95FrameMs: 18,
        minimumObservedFps: 45.5,
        controllerSelectLatencyMs: 87.5,
      },
      comfort: {
        motionComfort: "not_run",
        heatConcern: null,
        batteryDropPercent: null,
      },
    });
  });

  it("summarizes the live manual performance capture as an ingest draft with validation blockers", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: [11, 12, 18],
      framesObserved: 4,
      latestFrameAtMs: 1234.56,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 90,
      foregroundPageConfirmed: true,
      traceInteractionPassed: false,
      frameStats,
      immersiveSessionStarted: true,
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
        lastInputObservedAtMs: 1234.56,
        lastLocomotionAtMs: null,
        activeLocomotionSource: "none",
        inputSourceKinds: ["xr_hand"],
        rigPosition: { x: 0, z: 0 },
      },
    });

    expect(buildManualPerformanceCaptureSummary({ draft, frameStats })).toEqual({
      source: "window.__openClinXrManualPerformanceDraft",
      generatedAt: "2026-05-04T00:00:00.000Z",
      framesObserved: 4,
      sampleWindowSize: 3,
      isPresenting: true,
      visibilityState: "visible",
      qualitySource: "webxr_animation_loop",
      handInputsObserved: 2,
      activeLocomotionSource: "none",
      inputSourceKinds: ["xr_hand"],
      lastLocomotionAtMs: null,
      draftAvailable: true,
      manualValidationReady: false,
      satisfiedConditions: [
        "generated_at_valid",
        "foreground_page_confirmed",
        "station_shell_loaded",
        "text_readability_confirmed",
        "immersive_session_started",
        "experience_mode_full_vr_recorded",
        "hand_or_controller_input_observed",
        "console_errors_empty",
        "performance_source_openclinxr_frame_stats",
        "average_fps_72_or_higher",
        "p95_frame_ms_25_or_lower",
      ],
      blockers: [
        "performed_by_missing",
        "devtools_screencast_not_disabled",
        "extra_browser_windows_not_closed",
        "duration_under_10_minutes",
        "trace_interaction_not_confirmed",
        "locomotion_not_observed",
        "frame_sample_under_600_or_missing",
        "rolling_frame_window_under_120_or_missing",
        "minimum_fps_below_60_or_missing",
        "controller_select_latency_ms_above_150_or_missing",
        "motion_comfort_not_confirmed",
        "heat_concern_not_cleared",
        "battery_drop_not_recorded",
      ],
    });
    expect(buildManualPerformanceCaptureSummary({
      draft: undefined,
      frameStats: undefined,
    })).toMatchObject({
      draftAvailable: false,
      manualValidationReady: false,
      blockers: ["missing_manual_performance_draft", "missing_frame_stats"],
    });
  });

  it("reports manual validation readiness for a complete ten-minute capture preview", () => {
    const frameStats = buildRuntimeFrameStats({
      frameDeltasMs: Array.from({ length: 180 }, () => 13),
      framesObserved: 1200,
      latestFrameAtMs: 600_000,
      qualitySource: "webxr_animation_loop",
      isPresenting: true,
      visibilityState: "visible",
    });
    const draft = buildManualPerformanceDraft({
      generatedAt: "2026-05-04T00:00:00.000Z",
      elapsedSecond: 600,
      foregroundPageConfirmed: true,
      traceInteractionPassed: true,
      frameStats,
      controllerSelectLatencyMs: 87.5,
      immersiveSessionStarted: true,
      inputEvidence: {
        handModelCount: 2,
        handModelStatus: "installed",
        handInputsObserved: 2,
        locomotionMode: "experimental_keyboard_and_thumbstick_dolly",
        lastInputObservedAtMs: 1234.56,
        lastLocomotionAtMs: 1240,
        activeLocomotionSource: "xr_gamepad",
        inputSourceKinds: ["xr_gamepad", "xr_hand"],
        rigPosition: { x: 0.25, z: -0.3 },
      },
    });
    const completeDraft = {
      ...draft,
      runContext: {
        ...draft.runContext,
        performedBy: "Patrick Gidich",
      },
      setup: {
        ...draft.setup,
        devtoolsScreencastDisabled: true,
        extraBrowserWindowsClosed: true,
      },
      comfort: {
        motionComfort: "good" as const,
        heatConcern: false,
        batteryDropPercent: 4,
      },
    };

    expect(buildManualPerformanceCaptureSummary({ draft: completeDraft, frameStats })).toMatchObject({
      draftAvailable: true,
      manualValidationReady: true,
      satisfiedConditions: expect.arrayContaining(["motion_comfort_confirmed"]),
      blockers: [],
    });
  });
});
